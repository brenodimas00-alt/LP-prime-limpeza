-- Login da cliente (decisão da cliente em áudio, 24/09/2026): campo único "CPF, e-mail ou celular", tipo detectado na
-- Edge Function "conta". Senha: por e-mail ou celular, os 6 primeiros caracteres do CPF/CNPJ (é o que o Auth guarda, com
-- pepper); pelo CPF, a data de nascimento DDMMAAAA (conferida aqui, no servidor). Senha própria (trocada pela cliente)
-- vale pra qualquer via. Mesma regra pra importados e clientes novos. Bloqueio progressivo por CONTA (qualquer via) e IP.

alter table public.perfis add column senha_propria boolean not null default false;
-- quem criou conta pelo site antes desta regra escolheu a própria senha (hoje só usuários de teste)
update public.perfis p set senha_propria = true
 where exists (select 1 from public.clientes c where c.usuario_id = p.user_id and c.origem = 'site');

alter table public.acessos alter column email drop not null;
alter table public.acessos
  add column identificador text check (char_length(identificador) <= 254),
  add column tipo_identificador text check (tipo_identificador in ('email', 'cpf', 'celular'));
create index acessos_identificador on public.acessos (identificador, em desc);

/**
 * Resolve o identificador (só a function, com a chave secreta). Devolve o usuário, se a senha é própria e o que a regra
 * padrão precisa. Celular de mais de um cliente: duplicado (não entra). Nunca devolve nada pro navegador.
 */
create or replace function public.login_resolver(p_tipo text, p_valor text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid; v_email text; v_c public.clientes; v_n int; v_perfil public.perfis;
begin
  if p_tipo = 'email' then
    select u.id, lower(u.email) into v_user, v_email from auth.users u where lower(u.email) = lower(trim(p_valor));
    if v_user is not null then select * into v_c from public.clientes where usuario_id = v_user; end if;
  elsif p_tipo = 'cpf' then
    select * into v_c from public.clientes where tipo_documento = 'cpf' and documento = p_valor;
    v_user := v_c.usuario_id;
  elsif p_tipo = 'celular' then
    select count(*)::int into v_n from public.clientes where telefone = p_valor;
    if v_n > 1 then return jsonb_build_object('duplicado', true); end if;
    select * into v_c from public.clientes where telefone = p_valor;
    v_user := v_c.usuario_id;
  else
    return '{}'::jsonb;
  end if;
  if v_user is null then return '{}'::jsonb; end if;
  if v_email is null then select lower(u.email) into v_email from auth.users u where u.id = v_user; end if;
  select * into v_perfil from public.perfis where user_id = v_user;
  return jsonb_build_object('user_id', v_user, 'email', v_email, 'papel', coalesce(v_perfil.papel, 'cliente'),
    'senha_propria', coalesce(v_perfil.senha_propria, false) or coalesce(v_perfil.papel, 'cliente') <> 'cliente',
    'doc6', case when v_c.documento is not null then left(v_c.documento, 6) end,
    'nascimento', case when v_c.data_nascimento is not null then to_char(v_c.data_nascimento, 'DDMMYYYY') end);
end $$;

/**
 * Tentativa de login (reservada sob lock antes de ir ao Auth). Bloqueio progressivo por CONTA quando o identificador
 * resolve pra um usuário (e-mail, CPF e celular somam juntos); senão pelo identificador. Mais o limite por IP.
 */
create or replace function public.login_iniciar_id(p_tipo text, p_ident text, p_user uuid, p_email text, p_ip inet, p_dispositivo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ident text := left(coalesce(p_ident, ''), 254);
  v_cfg jsonb := (select c.valor from public.configuracao c where c.chave = 'auth');
  v_ult_sucesso timestamptz; v_falhas int; v_ult_falha timestamptz; v_ate timestamptz; v_faixa jsonb;
  v_ip_falhas int; v_ip_ult timestamptz; v_id bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('login:' || coalesce(p_user::text, 'id:' || v_ident), 0));
  if p_ip is not null then perform pg_advisory_xact_lock(hashtextextended('login-ip:' || host(p_ip), 0)); end if;
  if p_user is not null then
    select max(a.em) into v_ult_sucesso from public.acessos a where a.user_id = p_user and a.resultado = 'sucesso';
    select count(*), max(a.em) into v_falhas, v_ult_falha from public.acessos a
     where a.user_id = p_user and a.resultado in ('falha', 'pendente')
       and a.em > greatest(coalesce(v_ult_sucesso, '-infinity'::timestamptz), now() - interval '24 hours');
  else
    select count(*), max(a.em) into v_falhas, v_ult_falha from public.acessos a
     where a.identificador = v_ident and a.resultado in ('falha', 'pendente') and a.em > now() - interval '24 hours';
  end if;
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
  if v_ate is not null and v_ate > now() then
    insert into public.acessos (user_id, email, identificador, tipo_identificador, resultado, motivo, ip, dispositivo, finalizado_em)
    values (p_user, p_email, v_ident, p_tipo, 'bloqueado', 'muitas tentativas', p_ip, left(p_dispositivo, 300), now());
    return jsonb_build_object('bloqueado', true, 'ate', v_ate, 'segundos', ceil(extract(epoch from v_ate - now())));
  end if;
  insert into public.acessos (user_id, email, identificador, tipo_identificador, resultado, ip, dispositivo)
  values (p_user, p_email, v_ident, p_tipo, 'pendente', p_ip, left(p_dispositivo, 300)) returning id into v_id;
  if p_user is not null then insert into privado.tickets (tipo, user_id, expira_em, tentativa) values ('login', p_user, now() + interval '30 seconds', v_id); end if;
  return jsonb_build_object('tentativa', v_id);
end $$;

/** Marca se a senha é própria (troca e recuperação: true; redefinição pela Prime: volta pra regra padrão). */
create or replace function public.conta_senha_propria(p_user uuid, p_propria boolean) returns void
language sql security definer set search_path = '' as $$ update public.perfis set senha_propria = p_propria where user_id = p_user $$;

-- ---------- cadastro de cliente novo pela function (sem confirmação de e-mail; senha = regra padrão) ----------
create table privado.cadastros_ip (ip inet not null, em timestamptz not null default now());
create index cadastros_ip_em on privado.cadastros_ip (ip, em desc);

/** Limite de cadastros por IP (10 por hora). Registra a tentativa. */
create or replace function public.conta_cadastro_permitido(p_ip inet) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if p_ip is null then return true; end if;
  perform pg_advisory_xact_lock(hashtextextended('cadastro-ip:' || host(p_ip), 0));
  if (select count(*) from privado.cadastros_ip where ip = p_ip and em > now() - interval '1 hour') >= 10 then return false; end if;
  insert into privado.cadastros_ip (ip) values (p_ip);
  delete from privado.cadastros_ip where em < now() - interval '1 day';
  return true;
end $$;

/**
 * Valida os dados do cliente novo ANTES de criar a conta no Auth: mesmas regras do agendamento, mais CPF e nascimento
 * obrigatórios pra pessoa física (a senha sai deles). Devolve o cliente normalizado e o documento.
 */
create or replace function public.conta_validar_cliente_novo(p_dados jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c jsonb := privado.normalizar_cliente(p_dados); nasc date; doc text; tipo_doc text;
begin
  if c ->> 'tipo' = 'residencial' then
    if coalesce(c ->> 'cpf', '') = '' then perform privado.erro('DADOS_INVALIDOS', 'Informe o CPF (os 6 primeiros números são a sua senha)', '{"cpf": "Informe o CPF"}'); end if;
    begin nasc := (p_dados ->> 'dataNascimento')::date; exception when others then nasc := null; end;
    if nasc is null or nasc < '1900-01-01' or nasc > privado.hoje_sp() or coalesce(p_dados ->> 'dataNascimento', '') !~ '^\d{4}-\d{2}-\d{2}$' then
      perform privado.erro('DADOS_INVALIDOS', 'Informe a data de nascimento', '{"dataNascimento": "Informe a data de nascimento"}'); end if;
    c := c || jsonb_build_object('dataNascimento', to_char(nasc, 'YYYY-MM-DD'));
  end if;
  tipo_doc := case when c ? 'cnpj' then 'cnpj' else 'cpf' end;
  doc := coalesce(c ->> 'cnpj', c ->> 'cpf');
  if exists (select 1 from public.clientes where tipo_documento = tipo_doc and documento = doc) then
    perform privado.erro('DOCUMENTO_EM_USO', 'Já existe cadastro com este ' || upper(tipo_doc) || '. Entre com CPF, e-mail ou celular.', jsonb_build_object(tipo_doc, 'Já cadastrado: entre na sua conta'));
  end if;
  if exists (select 1 from auth.users u where lower(u.email) = c ->> 'email') then
    perform privado.erro('EMAIL_EM_USO', 'Já existe conta com este e-mail. Entre na sua conta.', '{"email": "Já existe conta com este e-mail"}');
  end if;
  return jsonb_build_object('cliente', c, 'tipoDocumento', tipo_doc, 'documento', doc);
end $$;

/** Cria o cadastro do cliente novo já vinculado à conta (a function cria a conta no Auth antes). */
create or replace function public.conta_cadastrar_cliente(p_user uuid, p_dados jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v jsonb := public.conta_validar_cliente_novo(p_dados); c jsonb := v -> 'cliente'; v_id uuid;
begin
  perform set_config('app.ator', 'cliente', true);
  insert into public.clientes (usuario_id, tipo, nome, telefone, email, tipo_documento, documento, razao_social, responsavel, endereco, data_nascimento, origem, ficticio)
  values (p_user, c ->> 'tipo', c ->> 'nome', c ->> 'telefone', c ->> 'email', v ->> 'tipoDocumento', v ->> 'documento', c ->> 'razaoSocial', c ->> 'responsavel',
          c -> 'endereco', (c ->> 'dataNascimento')::date, 'site',
          coalesce((select (u.raw_user_meta_data ->> 'ficticio')::boolean from auth.users u where u.id = p_user), false))
  returning id into v_id;
  return v_id;
end $$;

revoke execute on function public.login_resolver(text, text), public.login_iniciar_id(text, text, uuid, text, inet, text), public.conta_senha_propria(uuid, boolean),
  public.conta_cadastro_permitido(inet), public.conta_validar_cliente_novo(jsonb), public.conta_cadastrar_cliente(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.login_resolver(text, text), public.login_iniciar_id(text, text, uuid, text, inet, text), public.conta_senha_propria(uuid, boolean),
  public.conta_cadastro_permitido(inet), public.conta_validar_cliente_novo(jsonb), public.conta_cadastrar_cliente(uuid, jsonb) to service_role;

-- painel: a Prime vê a preferência da cliente na lista de atendimentos (atribuir/substituir profissional)
create or replace function public.listar_atendimentos(p_filtro jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator();
begin
  perform privado.exigir_prime(s);
  return jsonb_build_object('itens', (select coalesce(jsonb_agg(jsonb_build_object(
      'atendimento', privado.j_atendimento(a),
      'pedido', jsonb_strip_nulls(jsonb_build_object('id', p.id, 'status', p.status, 'pacote', p.pacote, 'preferenciaProfissional', p.preferencia_profissional)),
      'cliente', jsonb_build_object('id', c.id, 'nome', c.nome, 'telefone', c.telefone, 'endereco', c.endereco),
      'diarista', case when d.id is not null then jsonb_build_object('id', d.id, 'nome', d.nome, 'status', d.status) end) order by a.data, a.sequencia), '[]')
    from public.atendimentos a join public.pedidos p on p.id = a.pedido_id join public.clientes c on c.id = p.cliente_id left join public.diaristas d on d.id = a.diarista_id
    where (p_filtro ->> 'de' is null or a.data >= (p_filtro ->> 'de')::date) and (p_filtro ->> 'ate' is null or a.data <= (p_filtro ->> 'ate')::date)
      and (p_filtro ->> 'status' is null or a.status = p_filtro ->> 'status')));
end $$;
