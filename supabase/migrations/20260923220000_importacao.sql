-- B7. Completar o e-mail de cliente importado sem acesso (painel da Prime): grava o e-mail e tira as pendências de
-- e-mail; a Edge Function "conta" cria o acesso na hora com a mesma regra (6 primeiros dígitos do documento) e vincula.

create or replace function public.conta_completar_email(p_ator uuid, p_cliente uuid, p_email text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(trim(p_email));
  v_c public.clientes;
begin
  if not exists (select 1 from public.perfis where user_id = p_ator and not bloqueado and papel in ('prime_admin', 'prime_atendimento')) then
    raise exception 'ATOR_SEM_PERMISSAO' using errcode = 'P0001';
  end if;
  select * into v_c from public.clientes where id = p_cliente for update;
  if not found then raise exception 'NAO_ENCONTRADO' using errcode = 'P0001'; end if;
  if v_c.origem <> 'importado' or v_c.usuario_id is not null or v_c.documento is null then raise exception 'CONDICAO_NAO_ATENDIDA' using errcode = 'P0001'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'DADOS_INVALIDOS' using errcode = 'P0001'; end if;
  if exists (select 1 from auth.users u where lower(u.email) = v_email)
     or exists (select 1 from public.clientes c where c.email = v_email and c.id <> p_cliente and c.usuario_id is not null) then
    raise exception 'EMAIL_EM_USO' using errcode = 'P0001';
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_ator, 'role', 'authenticated')::text, true);
  perform set_config('app.ator', 'prime', true);
  update public.clientes set email = v_email,
         pendencias = array(select x from unnest(pendencias) x where x not in ('sem_email', 'email_invalido', 'email_repetido', 'email_em_uso'))
   where id = p_cliente;
  return jsonb_build_object('documento', v_c.documento, 'email', v_email);
end $$;

create or replace function public.conta_vincular_usuario(p_ator uuid, p_cliente uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_ator, 'role', 'authenticated')::text, true);
  perform set_config('app.ator', 'prime', true);
  update public.clientes set usuario_id = p_user where id = p_cliente and usuario_id is null;
  if not found then raise exception 'CONDICAO_NAO_ATENDIDA' using errcode = 'P0001'; end if;
end $$;

revoke execute on function public.conta_completar_email(uuid, uuid, text), public.conta_vincular_usuario(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.conta_completar_email(uuid, uuid, text), public.conta_vincular_usuario(uuid, uuid, uuid) to service_role;
