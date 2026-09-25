-- B6: documentos das diaristas. Upload e leitura só pela Edge Function "documentos" (papel de serviço):
-- o bucket privado fica SEM policy pro front. A function confere tipo, tamanho (5 MB) e a assinatura real dos bytes,
-- grava em <user_id>/<diarista_id>/<tipo>-<uuid>.<ext> e registra; leitura só da Prime, por URL assinada curta,
-- com cada abertura registrada. Retenção: arquivos de reprovadas apagados depois de N dias (padrão 90, PENDENCIAS).

-- ---------- bucket sem acesso direto ----------
drop policy if exists diarista_envia on storage.objects;
drop policy if exists diarista_ou_prime_le on storage.objects;
drop function if exists privado.dona_do_caminho(text);

-- ---------- configuração (editável) ----------
alter table public.configuracao drop constraint configuracao_chave_check;
alter table public.configuracao add constraint configuracao_chave_check check (chave in ('pix', 'contato', 'auth', 'documentos'));
insert into public.configuracao (chave, valor)
values ('documentos', '{"retencaoReprovadasDias": 90, "uploadsPorHora": 30, "validadeUrlSegundos": 120}')
on conflict (chave) do nothing;

alter table public.documentos add column if not exists arquivo_apagado_em timestamptz;  -- objeto removido do bucket

-- ---------- quem abriu qual documento (LGPD: acesso auditado) ----------
create table public.acessos_documentos (
  id bigserial primary key,
  documento_id uuid not null references public.documentos (id) on delete cascade,
  diarista_id uuid not null references public.diaristas (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  papel text,
  em timestamptz not null default now()
);
create index acessos_documentos_diarista on public.acessos_documentos (diarista_id, em desc);
alter table public.acessos_documentos enable row level security;
alter table public.acessos_documentos force row level security;
revoke all on public.acessos_documentos from anon, authenticated;
grant select on public.acessos_documentos to authenticated;
create policy so_prime on public.acessos_documentos for select to authenticated using ((select privado.eh_prime()));

-- ---------- limite de envio por usuária ----------
create table privado.uploads_usuario (user_id uuid not null, em timestamptz not null default now());
create index uploads_usuario_em on privado.uploads_usuario (user_id, em desc);

create or replace function public.reservar_upload_documento() returns boolean
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); lim int;
begin
  if uid is null then return false; end if;
  perform pg_advisory_xact_lock(hashtext('upload:' || uid));
  select coalesce((valor ->> 'uploadsPorHora')::int, 30) into lim from public.configuracao where chave = 'documentos';
  if (select count(*) from privado.uploads_usuario where user_id = uid and em > now() - interval '1 hour') >= coalesce(lim, 30) then return false; end if;
  insert into privado.uploads_usuario (user_id) values (uid);
  delete from privado.uploads_usuario where em < now() - interval '1 day';
  return true;
end $$;

-- ---------- registro: só de objeto que a function já validou e gravou no caminho da dona ----------
create or replace function public.registrar_documento(p_dados jsonb, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; d public.diaristas; x public.documentos; conteudo jsonb; did uuid; caminho text; meta jsonb;
        tipo text := coalesce(p_dados ->> 'tipo', ''); ext text; mime text; tam int; hash text := p_dados ->> 'hashSha256';
begin
  conteudo := jsonb_build_object('diaristaId', p_dados -> 'diaristaId', 'tipo', p_dados -> 'tipo', 'nomeArquivo', p_dados -> 'nomeArquivo',
    'storagePath', p_dados -> 'storagePath', 'hashSha256', p_dados -> 'hashSha256');
  if tipo not in ('rg_frente', 'rg_verso', 'cnh_frente', 'cnh_verso', 'cpf', 'comprovante_residencia', 'foto_perfil', 'antecedentes') then perform privado.erro('DADOS_INVALIDOS', 'Tipo de documento inválido'); end if;
  did := privado.uuid_ou_nulo(p_dados ->> 'diaristaId');
  if did is null then perform privado.erro('DADOS_INVALIDOS', 'Id do cadastro inválido'); end if;
  if hash is not null and hash !~ '^[0-9a-f]{64}$' then perform privado.erro('DADOS_INVALIDOS', 'Hash inválido'); end if;
  r := privado.idem_ler('salvarDocumento', s, p_chave, conteudo);
  if r is not null then return r; end if;
  perform set_config('app.ator', s ->> 'ator', true);
  d := privado.rascunho_da_sessao(s, did);
  if d.status <> 'rascunho' then perform privado.erro('ATOR_SEM_PERMISSAO', 'Cadastro já enviado; fale com a Prime pra trocar documentos'); end if;
  caminho := p_dados ->> 'storagePath';
  if caminho is null or caminho !~ ('^' || d.usuario_id || '/' || d.id || '/' || tipo || '-[0-9a-f-]{36}\.(jpg|png|pdf)$') then
    perform privado.erro('DADOS_INVALIDOS', 'Caminho do arquivo inválido');
  end if;
  -- tipo e tamanho vêm do objeto gravado (a function validou os bytes), não do que o chamador declara
  select o.metadata into meta from storage.objects o where o.bucket_id = 'documentos-diaristas' and o.name = caminho;
  if meta is null then perform privado.erro('DADOS_INVALIDOS', 'Arquivo não encontrado no armazenamento'); end if;
  mime := meta ->> 'mimetype'; tam := (meta ->> 'size')::int; ext := substring(caminho from '\.([a-z]+)$');
  if mime is null or (mime, ext) not in (('image/jpeg', 'jpg'), ('image/png', 'png'), ('application/pdf', 'pdf')) then perform privado.erro('DADOS_INVALIDOS', 'Formato não aceito: use JPG, PNG ou PDF'); end if;
  if tam is null or tam < 1 or tam > 5242880 then perform privado.erro('DADOS_INVALIDOS', 'Arquivo maior que 5 MB'); end if;
  update public.documentos set excluido_em = now() where diarista_id = d.id and tipo = p_dados ->> 'tipo' and excluido_em is null;
  insert into public.documentos (diarista_id, tipo, nome_arquivo, mime, tamanho, storage_path, hash_sha256)
  values (d.id, tipo, left(coalesce(p_dados ->> 'nomeArquivo', 'arquivo'), 120), mime, tam, caminho, hash) returning * into x;
  r := privado.j_documento(x);
  perform privado.idem_gravar('salvarDocumento', s, p_chave, conteudo, r);
  return r;
end $$;

-- ---------- leitura: só Prime, registrada ----------
create or replace function public.abrir_documento(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); x public.documentos;
begin
  if not coalesce(s ->> 'ator' = 'prime', false) then perform privado.erro('NAO_ENCONTRADO', 'Documento não encontrado'); end if;
  select * into x from public.documentos where id = p_id and excluido_em is null and arquivo_apagado_em is null;
  if not found then perform privado.erro('NAO_ENCONTRADO', 'Documento não encontrado'); end if;
  insert into public.acessos_documentos (documento_id, diarista_id, user_id, papel) values (x.id, x.diarista_id, auth.uid(), privado.papel());
  return privado.j_documento(x) || jsonb_build_object('validadeUrlSegundos',
    coalesce((select (valor ->> 'validadeUrlSegundos')::int from public.configuracao where chave = 'documentos'), 120));
end $$;

-- ---------- retenção (só papel de serviço: a function "documentos", chamada pelo pg_cron) ----------
create or replace function public.documentos_para_apagar(p_limite int default 200) returns table (id uuid, storage_path text)
language sql stable security definer set search_path = '' as $$
  select x.id, x.storage_path from public.documentos x join public.diaristas d on d.id = x.diarista_id
  where x.arquivo_apagado_em is null
    and (x.excluido_em is not null  -- substituído por outro do mesmo tipo
      or (d.status = 'reprovada' and (d.decisao ->> 'em')::timestamptz < now() - make_interval(days =>
            coalesce((select (valor ->> 'retencaoReprovadasDias')::int from public.configuracao where chave = 'documentos'), 90))))
  order by x.criado_em limit least(greatest(p_limite, 1), 500)
$$;

create or replace function public.marcar_arquivos_apagados(p_ids uuid[]) returns int
language plpgsql security definer set search_path = '' as $$
declare n int; d record;
begin
  perform set_config('app.ator', 'sistema', true);
  for d in select x.diarista_id, count(*) q from public.documentos x where x.id = any(p_ids) and x.arquivo_apagado_em is null group by 1 loop
    update public.diaristas set historico = historico || jsonb_build_object('evento', 'documentos_apagados', 'quantidade', d.q, 'em', privado.agora_iso(), 'ator', 'sistema')
    where id = d.diarista_id;
  end loop;
  update public.documentos set arquivo_apagado_em = now(), excluido_em = coalesce(excluido_em, now()) where id = any(p_ids) and arquivo_apagado_em is null;
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.reservar_upload_documento(), public.abrir_documento(uuid) from public, anon;
grant execute on function public.reservar_upload_documento(), public.abrir_documento(uuid) to authenticated, service_role;
revoke execute on function public.documentos_para_apagar(int), public.marcar_arquivos_apagados(uuid[]) from public, anon, authenticated;
grant execute on function public.documentos_para_apagar(int), public.marcar_arquivos_apagados(uuid[]) to service_role;

-- ---------- agendador da retenção (URL no Vault, como o worker) ----------
create or replace function privado.disparar_retencao() returns bigint
language plpgsql security definer set search_path = '' as $$
declare u text; k text;
begin
  select decrypted_secret into u from vault.decrypted_secrets where name = 'prime_documentos_url';
  select decrypted_secret into k from vault.decrypted_secrets where name = 'prime_worker_segredo';
  if u is null or k is null then return null; end if;
  return net.http_post(url := u, body := jsonb_build_object('acao', 'retencao'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-worker-segredo', k), timeout_milliseconds := 55000);
end $$;
revoke all on function privado.disparar_retencao() from public;
select cron.schedule('prime-retencao-documentos', '0 7 * * *', $$select privado.disparar_retencao()$$);  -- 4h em São Paulo
