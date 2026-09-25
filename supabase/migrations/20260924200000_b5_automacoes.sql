-- B5: automações reais. A fila (eventos -> notificacoes) é consumida pela Edge Function "notificacoes", que roda o
-- mesmo motor JS do mock (src/automacoes) sobre o Postgres. pg_cron chama a function a cada minuto por pg_net.
-- Provedor travado no código por ambiente: fora do projeto de produção é SEMPRE 'simulado' (ver provedores.js).

-- ---------- colunas da fila ----------
alter table public.eventos
  add column if not exists tentar_apos timestamptz,   -- backoff depois de falha no processamento
  add column if not exists erro text;                 -- última falha (visível no painel)
alter table public.notificacoes
  add column if not exists motivo text;               -- por que foi cancelada (cancelamento, reagendamento, obsoleta)
create index if not exists eventos_pendentes on public.eventos (seq) where status = 'pendente';

-- ---------- JSON no formato do front (camelCase), como os outros j_* ----------
create or replace function privado.iso(t timestamptz) returns text
language sql immutable set search_path = '' as $$
  select to_char(t at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

-- id vindo do front que não é UUID vira "não encontrado" (sem erro de cast)
create or replace function privado.uuid_ou_nulo(t text) returns uuid
language sql immutable set search_path = '' as $$
  select case when t ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then t::uuid end
$$;

create or replace function privado.j_evento(e public.eventos) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', e.id, 'tipo', e.tipo, 'refs', e.refs, 'dados', e.dados, 'status', e.status, 'seq', e.seq,
    'tentativas', e.tentativas, 'erro', e.erro, 'tentarApos', privado.iso(e.tentar_apos), 'processadoEm', privado.iso(e.processado_em),
    'criadoEm', privado.iso(e.criado_em))
$$;

create or replace function privado.j_notificacao(n public.notificacoes) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', n.id, 'gatilho', n.gatilho, 'canal', n.canal, 'destinatario', n.destinatario, 'template', n.template,
    'variaveis', n.variaveis, 'agendadaPara', privado.iso(n.agendada_para), 'status', n.status, 'provedor', n.provedor, 'refs', n.refs,
    'chaveIdempotencia', n.chave_idempotencia, 'previa', n.previa, 'wamid', n.wamid, 'enviadaEm', privado.iso(n.enviada_em),
    'erro', n.erro, 'tentativas', n.tentativas, 'motivo', n.motivo, 'criadoEm', privado.iso(n.criado_em))
$$;

-- ---------- leitura do painel (mesma assinatura; agora com provedor, motivo, erro e tentativas) ----------
create or replace function public.listar_notificacoes(p_filtro jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator();
begin
  perform privado.exigir_prime(s);
  return jsonb_build_object('itens', (select coalesce(jsonb_agg(privado.j_notificacao(n) order by coalesce(n.agendada_para, n.criado_em), n.criado_em), '[]')
    from public.notificacoes n where (p_filtro ->> 'pedidoId' is null or n.refs ->> 'pedidoId' = p_filtro ->> 'pedidoId')
      and (p_filtro ->> 'diaristaId' is null or n.refs ->> 'diaristaId' = p_filtro ->> 'diaristaId' or n.destinatario ->> 'id' = p_filtro ->> 'diaristaId')
      and (p_filtro ->> 'status' is null or n.status = p_filtro ->> 'status')));
end $$;

create or replace function public.listar_eventos(p_filtro jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator();
begin
  perform privado.exigir_prime(s);
  return jsonb_build_object('itens', (select coalesce(jsonb_agg(privado.j_evento(e) order by e.seq), '[]')
    from public.eventos e where p_filtro ->> 'status' is null or e.status = p_filtro ->> 'status'));
end $$;

-- Saúde da fila pro painel: o que está atrasado ou com erro.
create or replace function public.saude_notificacoes() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator();
begin
  perform privado.exigir_prime(s);
  return jsonb_build_object(
    'eventosPendentes', (select count(*) from public.eventos where status = 'pendente'),
    'eventosAtrasados', (select count(*) from public.eventos where status = 'pendente' and criado_em < now() - interval '10 minutes'),
    'eventosComErro', (select count(*) from public.eventos where status = 'erro'),
    'notificacoesAtrasadas', (select count(*) from public.notificacoes where status = 'pendente' and agendada_para < now() - interval '10 minutes'),
    'notificacoesComErro', (select count(*) from public.notificacoes where status = 'erro'),
    'ultimaExecucao', (select privado.iso(max(d.end_time)) from cron.job_run_details d join cron.job j on j.jobid = d.jobid
                        where j.jobname = 'prime-notificacoes' and d.status = 'succeeded'));
end $$;

-- A Prime manda de novo uma notificação que desistiu (status erro). Idempotente pela chave.
create or replace function public.reenviar_notificacao(p_dados jsonb, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; n public.notificacoes; conteudo jsonb := jsonb_build_object('id', p_dados -> 'id');
begin
  perform privado.exigir_prime(s);
  r := privado.idem_ler('reenviarNotificacao', s, p_chave, conteudo);
  if r is not null then return r; end if;
  select * into n from public.notificacoes where id = privado.uuid_ou_nulo(p_dados ->> 'id') for update;
  if not found then perform privado.erro('NAO_ENCONTRADO', 'Notificação não encontrada'); end if;
  if n.status <> 'erro' then perform privado.erro('TRANSICAO_PROIBIDA', 'Só notificação com erro pode ser enviada de novo'); end if;
  update public.notificacoes set status = 'pendente', tentativas = 0, agendada_para = now(), erro = null, motivo = null where id = n.id returning * into n;
  r := jsonb_build_object('notificacao', privado.j_notificacao(n));
  perform privado.idem_gravar('reenviarNotificacao', s, p_chave, conteudo, r);
  return r;
end $$;

-- A Prime reprocessa um evento que desistiu (status erro).
create or replace function public.reprocessar_evento(p_dados jsonb, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; e public.eventos; conteudo jsonb := jsonb_build_object('id', p_dados -> 'id');
begin
  perform privado.exigir_prime(s);
  r := privado.idem_ler('reprocessarEvento', s, p_chave, conteudo);
  if r is not null then return r; end if;
  select * into e from public.eventos where id = privado.uuid_ou_nulo(p_dados ->> 'id') for update;
  if not found then perform privado.erro('NAO_ENCONTRADO', 'Evento não encontrado'); end if;
  if e.status <> 'erro' then perform privado.erro('TRANSICAO_PROIBIDA', 'Só evento com erro pode ser reprocessado'); end if;
  update public.eventos set status = 'pendente', tentativas = 0, tentar_apos = null, erro = null where id = e.id returning * into e;
  r := jsonb_build_object('evento', privado.j_evento(e));
  perform privado.idem_gravar('reprocessarEvento', s, p_chave, conteudo, r);
  return r;
end $$;

do $$ declare f text; begin
  foreach f in array array['saude_notificacoes()', 'reenviar_notificacao(jsonb, text)', 'reprocessar_evento(jsonb, text)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;

-- ---------- agendador ----------
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Chama a Edge Function. URL e segredo ficam no Vault (scripts/configura-worker.mjs), nunca em migration.
create or replace function privado.disparar_worker(p_motivo text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare u text; k text;
begin
  select decrypted_secret into u from vault.decrypted_secrets where name = 'prime_worker_url';
  select decrypted_secret into k from vault.decrypted_secrets where name = 'prime_worker_segredo';
  if u is null or k is null then return null; end if;  -- worker ainda não configurado neste projeto
  return net.http_post(url := u, body := jsonb_build_object('motivo', p_motivo),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-worker-segredo', k), timeout_milliseconds := 55000);
end $$;

-- Varredura: fila atrasada (worker não rodou ou caiu) = dispara de novo. Erro definitivo fica pro painel.
create or replace function privado.varrer_fila() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare ev int; nt int;
begin
  select count(*) into ev from public.eventos where status = 'pendente' and criado_em < now() - interval '5 minutes'
    and (tentar_apos is null or tentar_apos <= now());
  select count(*) into nt from public.notificacoes where status = 'pendente' and agendada_para < now() - interval '5 minutes';
  if ev + nt > 0 then perform privado.disparar_worker('varredura'); end if;
  return jsonb_build_object('eventosAtrasados', ev, 'notificacoesAtrasadas', nt);
end $$;

revoke all on function privado.disparar_worker(text), privado.varrer_fila() from public;

-- Horários em UTC (Brasil sem horário de verão desde 2019): 21h UTC = 18h e 12h UTC = 9h em America/Sao_Paulo.
-- O worker de minuto já envia cada notificação no horário gravado nela; os jobs nomeados deixam os horários da
-- regra visíveis no cron e garantem a rodada mesmo se o de minuto estiver pausado.
select cron.schedule('prime-notificacoes', '* * * * *', $$select privado.disparar_worker('minuto')$$);
select cron.schedule('prime-lembrete-vespera', '0 21 * * *', $$select privado.disparar_worker('lembrete_vespera_18h')$$);
select cron.schedule('prime-lembrete-pagamento', '0 12 * * *', $$select privado.disparar_worker('lembrete_prazo_pagamento_9h')$$);
select cron.schedule('prime-varredura-fila', '*/10 * * * *', $$select privado.varrer_fila()$$);
select cron.schedule('prime-limpeza-cron', '30 6 * * *', $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$);
