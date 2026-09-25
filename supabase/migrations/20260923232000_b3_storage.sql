-- B3. Documentos das diaristas: bucket PRIVADO, upload só pela dona no caminho do próprio cadastro, leitura só da dona e da
-- Prime (URL assinada). Validação de tipo/tamanho aqui e no registro (registrar_documento); assinatura real do arquivo
-- (magic bytes) na Edge Function entra no B6.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documentos-diaristas', 'documentos-diaristas', false, 5242880, array['image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg', 'image/png', 'application/pdf'];

-- diaristas/<diarista_id>/<tipo>-<uuid>.<ext>, e o cadastro (rascunho ou enviado) é da usuária logada
create or replace function privado.dona_do_caminho(p_nome text) returns boolean
language sql stable security definer set search_path = '' as $$
  select (storage.foldername(p_nome))[1] = 'diaristas'
     and (storage.foldername(p_nome))[2] ~ '^[0-9a-f-]{36}$'
     and exists (select 1 from public.diaristas d where d.id = (storage.foldername(p_nome))[2]::uuid and d.usuario_id = auth.uid() and privado.papel() is not null)
$$;
grant execute on function privado.dona_do_caminho(text) to authenticated;

create policy diarista_envia on storage.objects for insert to authenticated
  with check (bucket_id = 'documentos-diaristas' and privado.dona_do_caminho(name));
create policy diarista_ou_prime_le on storage.objects for select to authenticated
  using (bucket_id = 'documentos-diaristas' and (privado.dona_do_caminho(name) or (select privado.eh_prime())));
-- sem update/delete pelo front: substituição de documento é um objeto novo; exclusão é do job de retenção (B6)

/** Abre (ou devolve) o rascunho do cadastro da usuária logada, ANTES do primeiro upload. Idempotente. */
create or replace function public.iniciar_cadastro_diarista(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); d public.diaristas;
begin
  if s ->> 'usuarioId' is null then perform privado.erro('ATOR_SEM_PERMISSAO', 'Entre na sua conta pra continuar o cadastro'); end if;
  perform set_config('app.ator', s ->> 'ator', true);
  d := privado.rascunho_da_sessao(s, p_id);
  return jsonb_build_object('id', d.id, 'status', d.status);
end $$;
revoke execute on function public.iniciar_cadastro_diarista(uuid) from public, anon;
grant execute on function public.iniciar_cadastro_diarista(uuid) to authenticated, service_role;

/** Metadados de um documento (dona ou Prime); o conteúdo sai por URL assinada do bucket. */
create or replace function public.obter_documento(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator(); x public.documentos; d public.diaristas;
begin
  select * into x from public.documentos where id = p_id and excluido_em is null;
  if found then select * into d from public.diaristas where id = x.diarista_id; end if;
  if not found or not (privado.dia_pode_ver(s, d.id) or (d.status = 'rascunho' and d.usuario_id = (s ->> 'usuarioId')::uuid)) then perform privado.erro('NAO_ENCONTRADO', 'Documento não encontrado'); end if;
  return privado.j_documento(x);
end $$;
revoke execute on function public.obter_documento(uuid) from public, anon;
grant execute on function public.obter_documento(uuid) to authenticated, service_role;
