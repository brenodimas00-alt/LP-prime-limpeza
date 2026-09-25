-- F2: diarista nova pelo site ganha conta (e-mail + senha própria) no primeiro passo do cadastro, antes dos documentos
-- (o upload exige a dona logada, B6). Só a function "conta" (papel de serviço) chama.
create or replace function public.conta_criar_rascunho_diarista(p_user uuid, p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d public.diaristas;
begin
  perform set_config('app.ator', 'diarista', true);
  if p_id is null or exists (select 1 from public.diaristas where id = p_id) or exists (select 1 from public.diaristas where usuario_id = p_user) then
    perform privado.erro('DADOS_INVALIDOS', 'Cadastro já existe. Entre pela área da diarista.');
  end if;
  insert into public.diaristas (id, usuario_id, status, ficticio)
  values (p_id, p_user, 'rascunho', coalesce((select (u.raw_user_meta_data ->> 'ficticio')::boolean from auth.users u where u.id = p_user), false))
  returning * into d;
  update public.perfis set papel = 'diarista' where user_id = p_user and papel = 'cliente';
  return jsonb_build_object('id', d.id, 'status', d.status);
end $$;
revoke execute on function public.conta_criar_rascunho_diarista(uuid, uuid) from public, anon, authenticated;
grant execute on function public.conta_criar_rascunho_diarista(uuid, uuid) to service_role;
