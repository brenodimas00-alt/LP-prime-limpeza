-- B2. Autenticação: a senha do Auth é HMAC(pepper, senha digitada) e toda entrada por senha passa pela Edge Function
-- "conta", que aplica o bloqueio progressivo e grava em acessos. Dois hooks do Auth fecham os atalhos:
--  - hook_token: login por SENHA só vira sessão com ticket de uso único emitido pela function; usuário bloqueado não
--    recebe nem renova token; o papel vai no JWT (claim "papel") pra conveniência do front.
--  - hook_antes_de_criar_usuario: conta de e-mail só nasce com ticket de cadastro (function, importação ou teste).

alter table public.configuracao drop constraint configuracao_chave_check;
alter table public.configuracao add constraint configuracao_chave_check check (chave in ('pix', 'contato', 'auth'));
-- Regra de senha configurável (espelhada em src/config/app.js). PENDENCIA: confirmar com a cliente se os novos também usam os 6 dígitos.
insert into public.configuracao (chave, valor) values ('auth', jsonb_build_object(
  'senha_minima_site', 8,
  'regra_importados', 'seis_digitos_documento',
  'bloqueio_email', jsonb_build_array(
    jsonb_build_object('falhas', 5, 'minutos', 5), jsonb_build_object('falhas', 10, 'minutos', 30),
    jsonb_build_object('falhas', 15, 'minutos', 120), jsonb_build_object('falhas', 20, 'minutos', 1440)),
  'bloqueio_ip', jsonb_build_object('falhas', 30, 'janela_minutos', 15, 'minutos', 15)
));

create table privado.tickets (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('login', 'cadastro')),
  user_id uuid,
  email text,
  expira_em timestamptz not null,
  criado_em timestamptz not null default now(),
  check ((tipo = 'login') = (user_id is not null)),
  check ((tipo = 'cadastro') = (email is not null))
);
create index tickets_login on privado.tickets (user_id, expira_em) where tipo = 'login';
create index tickets_cadastro on privado.tickets (email, expira_em) where tipo = 'cadastro';

-- ---------- hooks (executados pelo supabase_auth_admin) ----------
create or replace function public.hook_token(event jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (event ->> 'user_id')::uuid;
  v_metodo text := event ->> 'authentication_method';
  v_perfil public.perfis;
  v_ticket uuid;
  v_claims jsonb := event -> 'claims';
begin
  select * into v_perfil from public.perfis where user_id = v_user;
  if v_perfil.bloqueado then
    return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'Acesso bloqueado. Fale com a Prime.'));
  end if;
  if v_metodo = 'password' then
    delete from privado.tickets
     where id = (select t.id from privado.tickets t where t.tipo = 'login' and t.user_id = v_user and t.expira_em > now() order by t.criado_em limit 1)
    returning id into v_ticket;
    if v_ticket is null then
      return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'Entre pela página da Prime.'));
    end if;
  end if;
  v_claims := jsonb_set(v_claims, '{papel}', to_jsonb(coalesce(v_perfil.papel, 'cliente')));
  return jsonb_build_object('claims', v_claims);
end $$;

create or replace function public.hook_antes_de_criar_usuario(event jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_provedor text := coalesce(event -> 'user' -> 'app_metadata' ->> 'provider', 'email');
  v_email text := lower(event -> 'user' ->> 'email');
  v_ticket uuid;
begin
  if v_provedor <> 'email' then return '{}'::jsonb; end if; -- Google e afins: fluxo próprio do provedor
  delete from privado.tickets
   where id = (select t.id from privado.tickets t where t.tipo = 'cadastro' and t.email = v_email and t.expira_em > now() order by t.criado_em limit 1)
  returning id into v_ticket;
  if v_ticket is null then
    return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'Crie sua conta pelo site da Prime.'));
  end if;
  return '{}'::jsonb;
end $$;

revoke execute on function public.hook_token(jsonb), public.hook_antes_de_criar_usuario(jsonb) from public, anon, authenticated;
grant execute on function public.hook_token(jsonb), public.hook_antes_de_criar_usuario(jsonb) to supabase_auth_admin;

-- ---------- tentativa de login: bloqueio progressivo por e-mail e por IP ----------
-- Só a Edge Function (service role) chama. A tentativa é RESERVADA sob lock antes de ir ao Auth: tentativas
-- simultâneas contam como falha até serem finalizadas, então não dá pra furar o limite em paralelo.
create or replace function public.login_iniciar(p_email text, p_ip inet, p_dispositivo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(trim(p_email));
  v_cfg jsonb := (select c.valor from public.configuracao c where c.chave = 'auth');
  v_ult_sucesso timestamptz;
  v_falhas int; v_ult_falha timestamptz;
  v_ate timestamptz;
  v_faixa jsonb;
  v_ip_falhas int; v_ip_ult timestamptz;
  v_user uuid;
  v_id bigint;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return jsonb_build_object('invalido', true);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('login:' || v_email, 0));
  if p_ip is not null then perform pg_advisory_xact_lock(hashtextextended('login-ip:' || host(p_ip), 0)); end if;

  select max(a.em) into v_ult_sucesso from public.acessos a where a.email = v_email and a.resultado = 'sucesso';
  select count(*), max(a.em) into v_falhas, v_ult_falha from public.acessos a
   where a.email = v_email and a.resultado in ('falha', 'pendente')
     and a.em > greatest(coalesce(v_ult_sucesso, '-infinity'::timestamptz), now() - interval '24 hours');
  for v_faixa in select f from jsonb_array_elements(v_cfg -> 'bloqueio_email') f order by (f ->> 'falhas')::int desc loop
    if v_falhas >= (v_faixa ->> 'falhas')::int then
      v_ate := v_ult_falha + make_interval(mins => (v_faixa ->> 'minutos')::int);
      exit;
    end if;
  end loop;
  if p_ip is not null then
    select count(*), max(a.em) into v_ip_falhas, v_ip_ult from public.acessos a
     where a.ip = p_ip and a.resultado in ('falha', 'pendente')
       and a.em > now() - make_interval(mins => (v_cfg -> 'bloqueio_ip' ->> 'janela_minutos')::int);
    if v_ip_falhas >= (v_cfg -> 'bloqueio_ip' ->> 'falhas')::int then
      v_ate := greatest(coalesce(v_ate, '-infinity'::timestamptz), v_ip_ult + make_interval(mins => (v_cfg -> 'bloqueio_ip' ->> 'minutos')::int));
    end if;
  end if;

  select u.id into v_user from auth.users u where lower(u.email) = v_email;
  if v_ate is not null and v_ate > now() then
    insert into public.acessos (user_id, email, resultado, motivo, ip, dispositivo, finalizado_em)
    values (v_user, v_email, 'bloqueado', 'muitas tentativas', p_ip, left(p_dispositivo, 300), now());
    return jsonb_build_object('bloqueado', true, 'ate', v_ate, 'segundos', ceil(extract(epoch from v_ate - now())));
  end if;

  insert into public.acessos (user_id, email, resultado, ip, dispositivo)
  values (v_user, v_email, 'pendente', p_ip, left(p_dispositivo, 300)) returning id into v_id;
  if v_user is not null then
    insert into privado.tickets (tipo, user_id, expira_em) values ('login', v_user, now() + interval '30 seconds');
  end if;
  return jsonb_build_object('tentativa', v_id, 'existe', v_user is not null);
end $$;

create or replace function public.login_finalizar(p_tentativa bigint, p_sucesso boolean, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  update public.acessos set resultado = case when p_sucesso then 'sucesso' else 'falha' end,
         motivo = left(p_motivo, 200), finalizado_em = now()
   where id = p_tentativa and resultado = 'pendente'
  returning user_id into v_user;
  -- ticket não usado (senha errada) não fica valendo
  if not p_sucesso and v_user is not null then delete from privado.tickets where tipo = 'login' and user_id = v_user; end if;
end $$;

-- Ticket de cadastro (function de conta, importação e testes). Vale 60 s.
create or replace function public.conta_ticket_cadastro(p_email text) returns void
language sql security definer set search_path = '' as $$
  insert into privado.tickets (tipo, email, expira_em) values ('cadastro', lower(trim(p_email)), now() + interval '60 seconds')
$$;

-- Ticket de login avulso (troca de senha confere a atual entrando de novo). Vale 30 s.
create or replace function public.conta_ticket_login(p_user uuid) returns void
language sql security definer set search_path = '' as $$
  insert into privado.tickets (tipo, user_id, expira_em) values ('login', p_user, now() + interval '30 seconds')
$$;

-- Usuário por e-mail (só service role): a function precisa do id pra emitir o ticket e checar o perfil.
create or replace function public.conta_usuario_por_email(p_email text) returns uuid
language sql stable security definer set search_path = '' as $$
  select u.id from auth.users u where lower(u.email) = lower(trim(p_email))
$$;

revoke execute on function public.login_iniciar(text, inet, text), public.login_finalizar(bigint, boolean, text),
  public.conta_ticket_cadastro(text), public.conta_ticket_login(uuid), public.conta_usuario_por_email(text) from public, anon, authenticated;
grant execute on function public.login_iniciar(text, inet, text), public.login_finalizar(bigint, boolean, text),
  public.conta_ticket_cadastro(text), public.conta_ticket_login(uuid), public.conta_usuario_por_email(text) to service_role;

-- limpeza de tickets vencidos (chamada pela function; pg_cron entra no B5)
create or replace function public.conta_limpar_tickets() returns int
language sql security definer set search_path = '' as $$
  with d as (delete from privado.tickets where expira_em < now() - interval '1 hour' returning 1) select count(*)::int from d
$$;
revoke execute on function public.conta_limpar_tickets() from public, anon, authenticated;
grant execute on function public.conta_limpar_tickets() to service_role;
