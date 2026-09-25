-- B2. Ações administrativas de conta (chamadas pela Edge Function "conta" com o id de quem age), auditadas com autor.

-- Bloqueia/desbloqueia. Atendimento da Prime bloqueia cliente e diarista; só admin mexe em usuário da Prime.
create or replace function public.conta_definir_bloqueio(p_ator uuid, p_alvo uuid, p_bloquear boolean, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_papel_ator text; v_papel_alvo text;
begin
  select papel into v_papel_ator from public.perfis where user_id = p_ator and not bloqueado;
  select papel into v_papel_alvo from public.perfis where user_id = p_alvo;
  if v_papel_ator not in ('prime_admin', 'prime_atendimento') then raise exception 'ATOR_SEM_PERMISSAO' using errcode = 'P0001'; end if;
  if v_papel_alvo is null then raise exception 'NAO_ENCONTRADO' using errcode = 'P0001'; end if;
  if v_papel_alvo in ('prime_admin', 'prime_atendimento') and v_papel_ator <> 'prime_admin' then
    raise exception 'ATOR_SEM_PERMISSAO' using errcode = 'P0001';
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_ator, 'role', 'authenticated')::text, true);
  perform set_config('app.ator', 'prime', true);
  update public.perfis set bloqueado = p_bloquear, bloqueado_em = case when p_bloquear then now() end,
         bloqueado_motivo = case when p_bloquear then nullif(left(p_motivo, 200), '') end
   where user_id = p_alvo;
end $$;

-- Registro de ação de conta (troca/definição/redefinição de senha) na auditoria, sem a senha.
create or replace function public.conta_registrar_acao(p_ator uuid, p_alvo uuid, p_acao text, p_detalhe jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into public.auditoria (tabela, registro_id, operacao, ator_user_id, ator_papel, ator_contexto, depois)
  values ('auth.users', p_alvo, 'UPDATE', p_ator, (select papel from public.perfis where user_id = p_ator), 'conta:' || p_acao,
          coalesce(p_detalhe, '{}'::jsonb) - 'senha')
$$;

revoke execute on function public.conta_definir_bloqueio(uuid, uuid, boolean, text), public.conta_registrar_acao(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.conta_definir_bloqueio(uuid, uuid, boolean, text), public.conta_registrar_acao(uuid, uuid, text, jsonb) to service_role;
