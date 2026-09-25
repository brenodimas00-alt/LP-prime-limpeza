-- B6 (revisão do Codex): cada tentativa de upload gera outro caminho no bucket; com o caminho no conteúdo da
-- idempotência, repetir o MESMO arquivo com a MESMA chave dava CONFLITO_IDEMPOTENCIA. O conteúdo passa a ser o arquivo
-- (hash) e os dados do cadastro; a function apaga o objeto da repetição.
create or replace function public.registrar_documento(p_dados jsonb, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; d public.diaristas; x public.documentos; conteudo jsonb; did uuid; v_caminho text; meta jsonb;
        v_tipo text := coalesce(p_dados ->> 'tipo', ''); v_ext text; v_mime text; v_tam int; v_hash text := p_dados ->> 'hashSha256';
begin
  conteudo := jsonb_build_object('diaristaId', p_dados -> 'diaristaId', 'tipo', p_dados -> 'tipo', 'nomeArquivo', p_dados -> 'nomeArquivo',
    'hashSha256', p_dados -> 'hashSha256');
  if v_tipo not in ('rg_frente', 'rg_verso', 'cnh_frente', 'cnh_verso', 'cpf', 'comprovante_residencia', 'foto_perfil', 'antecedentes') then perform privado.erro('DADOS_INVALIDOS', 'Tipo de documento inválido'); end if;
  did := privado.uuid_ou_nulo(p_dados ->> 'diaristaId');
  if did is null then perform privado.erro('DADOS_INVALIDOS', 'Id do cadastro inválido'); end if;
  if v_hash is not null and v_hash !~ '^[0-9a-f]{64}$' then perform privado.erro('DADOS_INVALIDOS', 'Hash inválido'); end if;
  r := privado.idem_ler('salvarDocumento', s, p_chave, conteudo);
  if r is not null then return r; end if;
  perform set_config('app.ator', s ->> 'ator', true);
  d := privado.rascunho_da_sessao(s, did);
  if d.status <> 'rascunho' then perform privado.erro('ATOR_SEM_PERMISSAO', 'Cadastro já enviado; fale com a Prime pra trocar documentos'); end if;
  v_caminho := p_dados ->> 'storagePath';
  if v_caminho is null or v_caminho !~ ('^' || d.usuario_id || '/' || d.id || '/' || v_tipo || '-[0-9a-f-]{36}\.(jpg|png|pdf)$') then
    perform privado.erro('DADOS_INVALIDOS', 'Caminho do arquivo inválido');
  end if;
  -- tipo e tamanho vêm do objeto gravado (a function validou os bytes), não do que o chamador declara
  select o.metadata into meta from storage.objects o where o.bucket_id = 'documentos-diaristas' and o.name = v_caminho;
  if meta is null then perform privado.erro('DADOS_INVALIDOS', 'Arquivo não encontrado no armazenamento'); end if;
  v_mime := meta ->> 'mimetype'; v_tam := (meta ->> 'size')::int; v_ext := substring(v_caminho from '\.([a-z]+)$');
  if v_mime is null or (v_mime, v_ext) not in (('image/jpeg', 'jpg'), ('image/png', 'png'), ('application/pdf', 'pdf')) then perform privado.erro('DADOS_INVALIDOS', 'Formato não aceito: use JPG, PNG ou PDF'); end if;
  if v_tam is null or v_tam < 1 or v_tam > 5242880 then perform privado.erro('DADOS_INVALIDOS', 'Arquivo maior que 5 MB'); end if;
  update public.documentos set excluido_em = now() where diarista_id = d.id and tipo = p_dados ->> 'tipo' and excluido_em is null;
  insert into public.documentos (diarista_id, tipo, nome_arquivo, mime, tamanho, storage_path, hash_sha256)
  values (d.id, v_tipo, left(coalesce(p_dados ->> 'nomeArquivo', 'arquivo'), 120), v_mime, v_tam, v_caminho, v_hash) returning * into x;
  r := privado.j_documento(x);
  perform privado.idem_gravar('salvarDocumento', s, p_chave, conteudo, r);
  return r;
end $$;
