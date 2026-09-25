-- B2/B7, revisão do Codex:
-- 1) ticket de login preso à tentativa: senha errada de uma tentativa não derruba o ticket de outra tentativa correta em paralelo;
-- 2) completar_email retomável: reserva por cliente (lock), e-mail gravado só junto do vínculo, conta órfã de queda anterior é reaproveitada.

alter table privado.tickets add column tentativa bigint;

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
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return jsonb_build_object('invalido', true); end if;
  perform pg_advisory_xact_lock(hashtextextended('login:' || v_email, 0));
  if p_ip is not null then perform pg_advisory_xact_lock(hashtextextended('login-ip:' || host(p_ip), 0)); end if;
  select max(a.em) into v_ult_sucesso from public.acessos a where a.email = v_email and a.resultado = 'sucesso';
  select count(*), max(a.em) into v_falhas, v_ult_falha from public.acessos a
   where a.email = v_email and a.resultado in ('falha', 'pendente')
     and a.em > greatest(coalesce(v_ult_sucesso, '-infinity'::timestamptz), now() - interval '24 hours');
  for v_faixa in select f from jsonb_array_elements(v_cfg -> 'bloqueio_email') f order by (f ->> 'falhas')::int desc loop
    if v_falhas >= (v_faixa ->> 'falhas')::int then v_ate := v_ult_falha + make_interval(mins => (v_faixa ->> 'minutos')::int); exit; end if;
  end loop;
  if p_ip is not null then
    select count(*), max(a.em) into v_ip_falhas, v_ip_ult from public.acessos a
     where a.ip = p_ip and a.resultado in ('falha', 'pendente') and a.em > now() - make_interval(mins => (v_cfg -> 'bloqueio_ip' ->> 'janela_minutos')::int);
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
  insert into public.acessos (user_id, email, resultado, ip, dispositivo) values (v_user, v_email, 'pendente', p_ip, left(p_dispositivo, 300)) returning id into v_id;
  if v_user is not null then insert into privado.tickets (tipo, user_id, expira_em, tentativa) values ('login', v_user, now() + interval '30 seconds', v_id); end if;
  return jsonb_build_object('tentativa', v_id, 'existe', v_user is not null);
end $$;

create or replace function public.login_finalizar(p_tentativa bigint, p_sucesso boolean, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.acessos set resultado = case when p_sucesso then 'sucesso' else 'falha' end, motivo = left(p_motivo, 200), finalizado_em = now()
   where id = p_tentativa and resultado = 'pendente';
  -- só o ticket DESTA tentativa; um login correto em paralelo mantém o dele
  delete from privado.tickets where tipo = 'login' and tentativa = p_tentativa;
end $$;

-- completar_email retomável, sem lock de sessão (pool de conexões): iniciar valida e aponta órfãs; a function cria/reaproveita
-- a conta (marca em app_metadata, que o usuário NÃO edita); concluir fecha e-mail + vínculo + pendências numa transação com
-- "usuario_id is null" (chamada concorrente perde e a function apaga a conta que criou).
drop function if exists public.conta_completar_email(uuid, uuid, text);
drop function if exists public.conta_vincular_usuario(uuid, uuid, uuid);

create or replace function privado.marca_importacao(p_documento text) returns text
language sql immutable set search_path = '' as $$ select encode(extensions.digest(convert_to('prime-importacao:' || p_documento, 'UTF8'), 'sha256'), 'hex') $$;

create or replace function public.conta_completar_email_iniciar(p_ator uuid, p_cliente uuid, p_email text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(trim(p_email)); v_c public.clientes; v_marca text; v_mesmo uuid; v_orfas uuid[];
begin
  if not exists (select 1 from public.perfis where user_id = p_ator and not bloqueado and papel in ('prime_admin', 'prime_atendimento')) then
    raise exception 'ATOR_SEM_PERMISSAO' using errcode = 'P0001'; end if;
  select * into v_c from public.clientes where id = p_cliente;
  if not found then raise exception 'NAO_ENCONTRADO' using errcode = 'P0001'; end if;
  if v_c.origem <> 'importado' or v_c.usuario_id is not null or v_c.documento is null then raise exception 'CONDICAO_NAO_ATENDIDA' using errcode = 'P0001'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'DADOS_INVALIDOS' using errcode = 'P0001'; end if;
  v_marca := privado.marca_importacao(v_c.documento);
  -- contas órfãs deste cliente (queda entre criar a conta e vincular): mesma marca, sem cliente vinculado
  select array_agg(u.id) into v_orfas from auth.users u where u.raw_app_meta_data ->> 'marca_importacao' = v_marca and not exists (select 1 from public.clientes c where c.usuario_id = u.id);
  select u.id into v_mesmo from auth.users u where lower(u.email) = v_email;
  if v_mesmo is not null and not (v_mesmo = any(coalesce(v_orfas, '{}'))) then raise exception 'EMAIL_EM_USO' using errcode = 'P0001'; end if;
  if exists (select 1 from public.clientes c where c.email = v_email and c.id <> p_cliente and c.usuario_id is not null) then raise exception 'EMAIL_EM_USO' using errcode = 'P0001'; end if;
  return jsonb_build_object('documento', v_c.documento, 'email', v_email, 'marca', v_marca, 'reaproveitar', v_mesmo,
    'apagar', (select coalesce(jsonb_agg(x), '[]') from unnest(coalesce(v_orfas, '{}')) x where x is distinct from v_mesmo));
end $$;

create or replace function public.conta_completar_email_concluir(p_ator uuid, p_cliente uuid, p_email text, p_user uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_ator, 'role', 'authenticated')::text, true);
  perform set_config('app.ator', 'prime', true);
  update public.clientes set email = lower(trim(p_email)), usuario_id = p_user,
         pendencias = array(select x from unnest(pendencias) x where x not in ('sem_email', 'email_invalido', 'email_repetido', 'email_em_uso'))
   where id = p_cliente and usuario_id is null;
  return found;
end $$;

revoke execute on function public.conta_completar_email_iniciar(uuid, uuid, text), public.conta_completar_email_concluir(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.conta_completar_email_iniciar(uuid, uuid, text), public.conta_completar_email_concluir(uuid, uuid, text, uuid) to service_role;
