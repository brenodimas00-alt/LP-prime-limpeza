-- AUT (fase 2, bloco 2): motor de automações v2. Regras e templates como dado (painel edita dentro de limites),
-- execuções com chave única regra:entidade_tipo:entidade_id:marco, mensagens por canal/tentativa, limite diário com
-- reserva atômica, webhook do WhatsApp (status e mensagens recebidas) e flag do motor. O motor em si é JS
-- (src/automacoes/v2, o mesmo do mock) rodando na Edge Function "notificacoes" com a porta _shared/porta-pg.js.
-- Tudo novo com RLS forçada e sem acesso direto: leitura e escrita só por RPC (painel) ou pelo worker (serviço).

-- ---------------------------------------------------------------- configuração
create table public.automacao_config (
  id boolean primary key default true check (id),
  valor jsonb not null check (jsonb_typeof(valor) = 'object'),
  atualizado_por uuid references auth.users (id) on delete set null,
  atualizado_em timestamptz not null default now()
);
insert into public.automacao_config (valor) values (jsonb_build_object(
  'silencioInicio', '20:00', 'silencioFim', '08:00', 'horaDiaUtil', '09:00',
  'limites', jsonb_build_object('lembrete', 3, 'marketing', 1),
  -- modo teste do painel: contato FICTÍCIO (em produção, trocar por um número da equipe; homologação é sempre simulado)
  'contatoTeste', jsonb_build_object('nome', 'Contato de teste', 'telefone', '31900000001', 'email', 'teste@prime-homolog.example')));

insert into public.config_flags (chave, ligada, padrao, descricao)
values ('automacoes_motor', true, true, 'Motor de automações: planejar e enviar mensagens (desligado, a fila acumula e nada sai)');

-- ---------------------------------------------------------------- templates (versionados; 1 ativo por código e canal)
create table public.templates (
  codigo text not null check (codigo ~ '^[a-z0-9_]{3,60}$'),
  canal text not null check (canal in ('whatsapp', 'email', 'painel')),
  versao int not null check (versao >= 1),
  corpo text not null check (char_length(corpo) between 10 and 1024),
  assunto text check (char_length(assunto) <= 120),
  variaveis_permitidas text[] not null,
  variaveis_obrigatorias text[] not null,
  categoria_meta text check (categoria_meta in ('UTILITY', 'MARKETING')),
  ativo boolean not null default false,
  criado_por uuid references auth.users (id) on delete set null,
  criado_em timestamptz not null default now(),
  primary key (codigo, canal, versao),
  check (variaveis_obrigatorias <@ variaveis_permitidas)
);
create unique index templates_um_ativo on public.templates (codigo, canal) where ativo;

/** Problemas de um corpo (mesmas regras de catalogo.validarCorpo). Vazio = ok. */
create or replace function privado.validar_corpo_template(p_corpo text, p_permitidas text[], p_canal text) returns text[]
language plpgsql immutable set search_path = '' as $$
declare e text[] := '{}'; v text; sem text;
begin
  if p_corpo is null or char_length(trim(p_corpo)) < 10 then e := e || 'texto curto demais'::text; end if;
  if char_length(coalesce(p_corpo, '')) > 1024 then e := e || 'texto com mais de 1.024 caracteres'::text; end if;
  for v in select (regexp_matches(coalesce(p_corpo, ''), '\{\{([^}]*)\}\}', 'g'))[1] loop
    if not (v = any(p_permitidas)) then e := e || ('variável não permitida: {{' || v || '}}'); end if;
  end loop;
  sem := regexp_replace(coalesce(p_corpo, ''), '\{\{\w+\}\}', '', 'g');
  if sem ~ '\{\{|\}\}' then e := e || 'chaves soltas: use {{variavel}}'::text; end if;
  if p_canal = 'whatsapp' then
    if p_corpo ~ '^\s*\{\{' then e := e || 'não pode começar com variável (regra da Meta)'::text; end if;
    if p_corpo ~ '\{\{\w+\}\}\s*[.!?]?\s*$' then e := e || 'não pode terminar com variável (regra da Meta)'::text; end if;
    if p_corpo ~ '\{\{\w+\}\}\s*\{\{' then e := e || 'duas variáveis seguidas (regra da Meta)'::text; end if;
    if p_corpo ~ '\*' then e := e || 'sem asterisco'::text; end if;
  end if;
  return e;
end $$;

-- ---------------------------------------------------------------- regras
create or replace function privado.condicoes_validas(c jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(c) = 'object' and not exists (
    select 1 from jsonb_each(c) x
     where x.key not in ('pedidoStatus', 'atendimentoStatus', 'pagamentoStatus', 'mesmaData', 'mesmaProfissional', 'mesmoPrazo', 'semAvaliacao', 'temCobranca', 'temProfissional')
        or (x.key like '%Status' and jsonb_typeof(x.value) <> 'array')
        or (x.key not like '%Status' and x.value <> 'true'::jsonb))
$$;

create table public.automacao_regras (
  codigo text primary key check (codigo ~ '^[CMDI][0-9]{2}$'),
  template_codigo text not null,
  descricao text not null check (char_length(descricao) between 3 and 200),
  categoria text not null check (categoria in ('atendimento', 'lembrete', 'marketing', 'interno')),
  destinatario text not null check (destinatario in ('cliente', 'diarista', 'diaristas_afetadas', 'equipe_prime')),
  canais_ordem text[] not null check (cardinality(canais_ordem) between 1 and 3 and canais_ordem <@ array['whatsapp', 'email', 'painel']::text[]),
  gatilho jsonb not null check (gatilho ->> 'tipo' in ('evento', 'agenda')),
  atraso jsonb not null check (jsonb_typeof(atraso) = 'object' and atraso ? 'tipo'),
  condicoes jsonb not null default '{}' check (privado.condicoes_validas(condicoes)),
  cancelamento text[] not null default '{}',
  entidade text not null,
  marco text,
  do_dia boolean not null default false,
  validade_min int check (validade_min between 30 and 20160),
  ligada boolean not null,
  versao int not null default 1,
  atualizado_por uuid references auth.users (id) on delete set null,
  atualizado_em timestamptz not null default now(),
  -- marketing nunca cai no painel (não é aviso de atendimento) e interno só vai pro painel
  check (categoria <> 'marketing' or not ('painel' = any(canais_ordem))),
  check (destinatario <> 'equipe_prime' or canais_ordem = array['painel']::text[])
);

-- ---------------------------------------------------------------- execuções, mensagens e limite
create table public.automacao_execucoes (
  id uuid primary key default gen_random_uuid(),
  regra text not null references public.automacao_regras (codigo),
  template_codigo text,
  regra_versao int not null default 1,
  entidade_tipo text not null,
  entidade_id text not null,
  marco text not null,
  chave_idempotencia text not null unique,
  destinatario jsonb not null check (destinatario ? 'tipo'),
  titular_tipo text check (titular_tipo in ('cliente', 'diarista')),
  titular_id uuid,
  categoria text not null,
  agendada_para timestamptz not null,
  valida_ate timestamptz not null,
  estado text not null check (estado in ('agendada', 'enviando', 'enviada', 'entregue', 'lida', 'falhou', 'cancelada', 'ignorada')),
  motivo text check (char_length(motivo) <= 500),
  tentativas int not null default 0 check (tentativas between 0 and 10),
  proxima_tentativa timestamptz,
  canal_idx int not null default 0,
  contexto jsonb not null default '{}',
  teste boolean not null default false,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index automacao_execucoes_vencidas on public.automacao_execucoes (agendada_para) where estado = 'agendada';
create index automacao_execucoes_enviando on public.automacao_execucoes (atualizado_em) where estado = 'enviando';
create index automacao_execucoes_regra on public.automacao_execucoes (regra, estado, criado_em desc);
create index automacao_execucoes_titular on public.automacao_execucoes (titular_id, criado_em desc);
create index automacao_execucoes_pedido on public.automacao_execucoes ((contexto ->> 'pedidoId'));
create index automacao_execucoes_atendimento on public.automacao_execucoes ((contexto ->> 'atendimentoId'));
create index automacao_execucoes_pagamento on public.automacao_execucoes ((contexto ->> 'pagamentoId'));
create index automacao_execucoes_diarista on public.automacao_execucoes ((contexto ->> 'diaristaId'));

create table public.mensagens (
  id uuid primary key default gen_random_uuid(),
  execucao_id uuid not null references public.automacao_execucoes (id) on delete cascade,
  canal text not null check (canal in ('whatsapp', 'email', 'painel')),
  destino text,
  conteudo text,
  assunto text,
  template_codigo text,
  template_versao int,
  provedor text,
  id_externo text,
  estado text not null check (estado in ('enviando', 'enviada', 'simulada', 'entregue', 'lida', 'falhou')),
  erro jsonb,
  entregue_em timestamptz,
  lida_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index mensagens_execucao on public.mensagens (execucao_id, criado_em);
create unique index mensagens_id_externo on public.mensagens (id_externo) where id_externo is not null;

create table public.automacao_limites (
  titular_tipo text not null, titular_id uuid not null, categoria text not null, dia date not null,
  usados int not null check (usados >= 0),
  primary key (titular_tipo, titular_id, categoria, dia)
);

-- ---------------------------------------------------------------- WhatsApp (AUT.5): status, recebidas, janela de 24h
create table public.mensagem_status (
  id_externo text not null, status text not null check (status in ('sent', 'delivered', 'read', 'failed')),
  em timestamptz not null, erro jsonb, recebido_em timestamptz not null default now(),
  primary key (id_externo, status)
);
create table public.mensagens_recebidas (
  id_externo text primary key, telefone text not null, texto text, tipo text, recebida_em timestamptz not null,
  acao text, criado_em timestamptz not null default now()
);
create table public.whatsapp_janelas (telefone text primary key, ultima_entrada_em timestamptz not null);

do $$ declare t text; begin
  foreach t in array array['automacao_config', 'templates', 'automacao_regras', 'automacao_execucoes', 'mensagens', 'automacao_limites',
                           'mensagem_status', 'mensagens_recebidas', 'whatsapp_janelas'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- JSON pro painel (camelCase, destino mascarado)
create or replace function privado.mascarar_destino(canal text, d text) returns text
language sql immutable set search_path = '' as $$
  select case when d is null then null
    when canal = 'whatsapp' then '(' || substr(regexp_replace(d, '\D', '', 'g'), 1, 2) || ') ****-' || right(regexp_replace(d, '\D', '', 'g'), 4)
    when canal = 'email' then left(d, 1) || '***@' || split_part(d, '@', 2)
    else d end
$$;

create or replace function privado.j_execucao(e public.automacao_execucoes) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', e.id, 'regra', e.regra, 'template', e.template_codigo, 'entidadeTipo', e.entidade_tipo, 'entidadeId', e.entidade_id,
    'marco', e.marco, 'destinatario', e.destinatario, 'categoria', e.categoria, 'agendadaPara', privado.iso(e.agendada_para),
    'validaAte', privado.iso(e.valida_ate), 'estado', e.estado, 'motivo', e.motivo, 'tentativas', e.tentativas, 'canalIdx', e.canal_idx,
    'teste', e.teste, 'criadoEm', privado.iso(e.criado_em), 'atualizadoEm', privado.iso(e.atualizado_em),
    'refs', jsonb_build_object('pedidoId', e.contexto ->> 'pedidoId', 'atendimentoId', e.contexto ->> 'atendimentoId', 'pagamentoId', e.contexto ->> 'pagamentoId',
      'diaristaId', e.contexto ->> 'diaristaId', 'clienteId', e.contexto ->> 'clienteId'),
    'mensagens', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'canal', m.canal, 'destino', privado.mascarar_destino(m.canal, m.destino),
      'conteudo', m.conteudo, 'estado', m.estado, 'provedor', m.provedor, 'erro', m.erro, 'templateVersao', m.template_versao,
      'criadoEm', privado.iso(m.criado_em), 'entregueEm', privado.iso(m.entregue_em), 'lidaEm', privado.iso(m.lida_em)) order by m.criado_em)
      from public.mensagens m where m.execucao_id = e.id), '[]'::jsonb))
$$;

-- ---------------------------------------------------------------- RPCs do painel
create or replace function public.listar_regras_automacao() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not privado.eh_prime() then perform privado.erro('ATOR_SEM_PERMISSAO', 'Só a Prime vê as automações.'); end if;
  return jsonb_build_object('regras', coalesce((select jsonb_agg(jsonb_build_object('codigo', r.codigo, 'template', r.template_codigo, 'descricao', r.descricao,
      'categoria', r.categoria, 'destinatario', r.destinatario, 'canais', r.canais_ordem, 'gatilho', r.gatilho, 'atraso', r.atraso, 'condicoes', r.condicoes,
      'cancelamento', r.cancelamento, 'ligada', r.ligada, 'versao', r.versao, 'atualizadoEm', privado.iso(r.atualizado_em)) order by r.codigo) from public.automacao_regras r), '[]'),
    'config', (select valor from public.automacao_config), 'motorLigado', privado.flag('automacoes_motor'));
end $$;

/** Horário 'HH:MM' dentro de [06:00, 21:00]. */
create or replace function privado.hora_ok(h jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(h) = 'string' and (h #>> '{}') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and (h #>> '{}') between '06:00' and '21:00'
$$;
create or replace function privado.inteiro_entre(v jsonb, a int, b int) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(v) = 'number' and (v #>> '{}') ~ '^[0-9]+$' and (v #>> '{}')::int between a and b
$$;
/** Atraso editado: mesmo tipo do original e só os campos editáveis, dentro dos limites (catalogo.LIMITES). */
create or replace function privado.atraso_valido(orig jsonb, novo jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare t text := orig ->> 'tipo'; x jsonb;
begin
  if novo ->> 'tipo' is distinct from t then return false; end if;
  if exists (select 1 from jsonb_object_keys(novo) k where k not in (select jsonb_object_keys(orig))) then return false; end if;
  if novo ? 'hora' and not privado.hora_ok(novo -> 'hora') then return false; end if;
  case t
    when 'apos' then return privado.inteiro_entre(novo -> 'minutos', 60, 4320);
    when 'apos_inicio_turno' then return privado.inteiro_entre(novo -> 'minutos', 10, 180);
    when 'antes_prazo' then
      if jsonb_typeof(novo -> 'minutos') <> 'array' or jsonb_array_length(novo -> 'minutos') not between 1 and 3 then return false; end if;
      for x in select jsonb_array_elements(novo -> 'minutos') loop if not privado.inteiro_entre(x, 30, 2880) then return false; end if; end loop;
      return true;
    when 'antes_vencimento_documento' then
      if jsonb_typeof(novo -> 'dias') <> 'array' or jsonb_array_length(novo -> 'dias') not between 1 and 3 then return false; end if;
      for x in select jsonb_array_elements(novo -> 'dias') loop if not privado.inteiro_entre(x, 1, 60) then return false; end if; end loop;
      return true;
    when 'inatividade' then return privado.inteiro_entre(novo -> 'dias', 30, 365) and privado.inteiro_entre(novo -> 'intervaloDias', 30, 365);
    when 'mensal' then return privado.inteiro_entre(novo -> 'dia', 1, 28);
    when 'semanal' then return privado.inteiro_entre(novo -> 'diaSemana', 1, 6);
    else return true; -- imediato, vespera, diario, aniversario, prazo_vencido: só a hora (já conferida)
  end case;
end $$;

create or replace function public.atualizar_regra_automacao(p_codigo text, p_dados jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.automacao_regras; novo_atraso jsonb; canais text[]; lig boolean;
begin
  if not privado.eh_prime_admin() then perform privado.erro('ATOR_SEM_PERMISSAO', 'Só a administração da Prime altera automações.'); end if;
  select * into r from public.automacao_regras where codigo = p_codigo for update;
  if not found then perform privado.erro('NAO_ENCONTRADO', 'Regra não encontrada.'); end if;
  if exists (select 1 from jsonb_object_keys(coalesce(p_dados, '{}')) k where k not in ('ligada', 'atraso', 'canais')) then
    perform privado.erro('DADOS_INVALIDOS', 'Só dá pra mudar liga/desliga, horário/atraso e a ordem dos canais.');
  end if;
  lig := coalesce((p_dados ->> 'ligada')::boolean, r.ligada);
  novo_atraso := r.atraso || coalesce(p_dados -> 'atraso', '{}');
  if not privado.atraso_valido(r.atraso, novo_atraso) then perform privado.erro('DADOS_INVALIDOS', 'Horário ou atraso fora dos limites permitidos.', '{"atraso": "Fora dos limites"}'); end if;
  canais := coalesce((select array_agg(x) from jsonb_array_elements_text(p_dados -> 'canais') x), r.canais_ordem);
  -- só reordena os canais que a regra já tem (não inventa canal; interno continua só painel)
  if not (canais <@ r.canais_ordem and r.canais_ordem <@ canais and cardinality(canais) = cardinality(r.canais_ordem)) then
    perform privado.erro('DADOS_INVALIDOS', 'A ordem dos canais tem que ter os mesmos canais da regra.', '{"canais": "Canais inválidos"}');
  end if;
  if (lig, novo_atraso, canais) is not distinct from (r.ligada, r.atraso, r.canais_ordem) then return jsonb_build_object('codigo', r.codigo, 'versao', r.versao); end if;
  update public.automacao_regras set ligada = lig, atraso = novo_atraso, canais_ordem = canais, versao = versao + 1, atualizado_por = auth.uid(), atualizado_em = now() where codigo = p_codigo;
  insert into public.auditoria (tabela, registro_id, operacao, ator_user_id, ator_papel, ator_contexto, antes, depois)
  values ('automacao_regras', null, 'UPDATE', auth.uid(), privado.papel(), 'prime',
          jsonb_build_object('codigo', r.codigo, 'ligada', r.ligada, 'atraso', r.atraso, 'canais', r.canais_ordem),
          jsonb_build_object('codigo', r.codigo, 'ligada', lig, 'atraso', novo_atraso, 'canais', canais));
  return jsonb_build_object('codigo', r.codigo, 'versao', r.versao + 1);
end $$;

create or replace function public.listar_templates(p_codigo text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not privado.eh_prime() then perform privado.erro('ATOR_SEM_PERMISSAO', 'Só a Prime vê os templates.'); end if;
  return coalesce((select jsonb_agg(jsonb_build_object('codigo', t.codigo, 'canal', t.canal, 'versao', t.versao, 'corpo', t.corpo, 'assunto', t.assunto,
    'permitidas', t.variaveis_permitidas, 'categoriaMeta', t.categoria_meta, 'ativo', t.ativo, 'criadoEm', privado.iso(t.criado_em)) order by t.canal, t.versao desc)
    from public.templates t where t.codigo = p_codigo), '[]');
end $$;

/** Nova versão ativa do template (a anterior fica no histórico). Variável fora da lista permitida = recusa. */
create or replace function public.salvar_template(p_codigo text, p_canal text, p_corpo text, p_assunto text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.templates; erros text[]; v int; obrig text[];
begin
  if not privado.eh_prime_admin() then perform privado.erro('ATOR_SEM_PERMISSAO', 'Só a administração da Prime edita templates.'); end if;
  select * into a from public.templates where codigo = p_codigo and canal = p_canal and ativo for update;
  if not found then perform privado.erro('NAO_ENCONTRADO', 'Template não encontrado.'); end if;
  erros := privado.validar_corpo_template(p_corpo, a.variaveis_permitidas, p_canal);
  if cardinality(erros) > 0 then perform privado.erro('DADOS_INVALIDOS', array_to_string(erros, '; '), jsonb_build_object('corpo', array_to_string(erros, '; '))); end if;
  if p_corpo = a.corpo and p_assunto is not distinct from a.assunto then return jsonb_build_object('codigo', a.codigo, 'canal', a.canal, 'versao', a.versao); end if;
  obrig := coalesce((select array_agg(distinct x[1]) from regexp_matches(p_corpo, '\{\{(\w+)\}\}', 'g') x), '{}');
  select max(versao) + 1 into v from public.templates where codigo = p_codigo and canal = p_canal;
  update public.templates set ativo = false where codigo = p_codigo and canal = p_canal and ativo;
  insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo, criado_por)
  values (p_codigo, p_canal, v, p_corpo, case when p_canal = 'email' then coalesce(p_assunto, a.assunto) end, a.variaveis_permitidas, obrig, a.categoria_meta, true, auth.uid());
  insert into public.auditoria (tabela, registro_id, operacao, ator_user_id, ator_papel, ator_contexto, antes, depois)
  values ('templates', null, 'INSERT', auth.uid(), privado.papel(), 'prime', jsonb_build_object('codigo', p_codigo, 'canal', p_canal, 'versao', a.versao),
          jsonb_build_object('codigo', p_codigo, 'canal', p_canal, 'versao', v));
  return jsonb_build_object('codigo', p_codigo, 'canal', p_canal, 'versao', v);
end $$;

create or replace function public.restaurar_template(p_codigo text, p_canal text, p_versao int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t public.templates;
begin
  select * into t from public.templates where codigo = p_codigo and canal = p_canal and versao = p_versao;
  if not found then perform privado.erro('NAO_ENCONTRADO', 'Versão não encontrada.'); end if;
  return public.salvar_template(p_codigo, p_canal, t.corpo, t.assunto); -- vira uma versão NOVA com o texto antigo
end $$;

/** Linha do tempo (cliente, pedido, profissional, regra, estado). Destino sempre mascarado. */
create or replace function public.listar_execucoes(p_filtro jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare lim int := least(greatest(coalesce((p_filtro ->> 'limite')::int, 50), 1), 200); pag int := greatest(coalesce((p_filtro ->> 'pagina')::int, 0), 0);
begin
  if not privado.eh_prime() then perform privado.erro('ATOR_SEM_PERMISSAO', 'Só a Prime vê as automações.'); end if;
  return (select jsonb_build_object('itens', coalesce(jsonb_agg(privado.j_execucao(e) order by e.agendada_para desc, e.criado_em desc), '[]'), 'pagina', pag, 'limite', lim)
    from (select * from public.automacao_execucoes e
           where (p_filtro ->> 'clienteId' is null or e.contexto ->> 'clienteId' = p_filtro ->> 'clienteId' or (e.titular_tipo = 'cliente' and e.titular_id::text = p_filtro ->> 'clienteId'))
             and (p_filtro ->> 'pedidoId' is null or e.contexto ->> 'pedidoId' = p_filtro ->> 'pedidoId')
             and (p_filtro ->> 'diaristaId' is null or e.contexto ->> 'diaristaId' = p_filtro ->> 'diaristaId' or (e.titular_tipo = 'diarista' and e.titular_id::text = p_filtro ->> 'diaristaId'))
             and (p_filtro ->> 'regra' is null or e.regra = p_filtro ->> 'regra')
             and (p_filtro ->> 'estado' is null or e.estado = p_filtro ->> 'estado')
             and (coalesce((p_filtro ->> 'teste')::boolean, false) or not e.teste or p_filtro ->> 'regra' is not null)
           order by e.agendada_para desc, e.criado_em desc limit lim offset pag * lim) e);
end $$;

/** Reenviar (falhou/cancelada/ignorada), cancelar (agendada) ou enviar agora (agendada). Auditado e idempotente. */
create or replace function public.acao_execucao(p_id uuid, p_acao text, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; e public.automacao_execucoes; conteudo jsonb := jsonb_build_object('id', p_id, 'acao', p_acao);
begin
  if not privado.eh_prime_admin() then perform privado.erro('ATOR_SEM_PERMISSAO', 'Só a administração da Prime age sobre as automações.'); end if;
  r := privado.idem_ler('acaoExecucao', s, p_chave, conteudo);
  if r is not null then return r; end if;
  select * into e from public.automacao_execucoes where id = p_id for update;
  if not found then perform privado.erro('NAO_ENCONTRADO', 'Execução não encontrada.'); end if;
  if p_acao = 'cancelar' and e.estado = 'agendada' then
    update public.automacao_execucoes set estado = 'cancelada', motivo = 'cancelada pela Prime', atualizado_em = now() where id = p_id returning * into e;
  elsif p_acao = 'enviar_agora' and e.estado = 'agendada' then
    -- as regras de envio (silêncio, consentimento, limite) continuam valendo no worker
    update public.automacao_execucoes set agendada_para = now(), motivo = 'enviar agora (Prime)', atualizado_em = now() where id = p_id returning * into e;
  elsif p_acao = 'reenviar' and e.estado in ('falhou', 'cancelada', 'ignorada') then
    update public.automacao_execucoes set estado = 'agendada', agendada_para = now(), valida_ate = greatest(valida_ate, now() + interval '2 hours'),
      tentativas = 0, canal_idx = 0, motivo = 'reenvio pela Prime', contexto = contexto - 'limiteReservado', atualizado_em = now() where id = p_id returning * into e;
  else
    perform privado.erro('TRANSICAO_PROIBIDA', 'Esta ação não vale para uma execução ' || e.estado || '.');
  end if;
  insert into public.auditoria (tabela, registro_id, operacao, ator_user_id, ator_papel, ator_contexto, depois)
  values ('automacao_execucoes', p_id, 'UPDATE', auth.uid(), privado.papel(), 'prime', jsonb_build_object('acao', p_acao, 'regra', e.regra, 'estado', e.estado));
  r := jsonb_build_object('execucao', privado.j_execucao(e));
  perform privado.idem_gravar('acaoExecucao', s, p_chave, conteudo, r);
  return r;
end $$;

/** Modo teste: dispara a regra para o contato fictício da configuração, com os dados de exemplo do template. */
create or replace function public.testar_regra_automacao(p_codigo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.automacao_regras; cfg jsonb := (select valor from public.automacao_config); t public.templates; vars jsonb; v_id uuid;
begin
  if not privado.eh_prime_admin() then perform privado.erro('ATOR_SEM_PERMISSAO', 'Só a administração da Prime usa o modo teste.'); end if;
  select * into r from public.automacao_regras where codigo = p_codigo;
  if not found then perform privado.erro('NAO_ENCONTRADO', 'Regra não encontrada.'); end if;
  if cfg -> 'contatoTeste' ->> 'telefone' is null then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Configure o contato de teste.'); end if;
  select * into t from public.templates where codigo = r.template_codigo and ativo order by (canal = r.canais_ordem[1]) desc limit 1;
  select jsonb_object_agg(v, 'Exemplo ' || v) into vars from unnest(t.variaveis_permitidas) v;
  insert into public.automacao_execucoes (regra, template_codigo, entidade_tipo, entidade_id, marco, chave_idempotencia, destinatario, categoria,
    agendada_para, valida_ate, estado, contexto, teste)
  values (r.codigo, r.template_codigo, 'teste', gen_random_uuid()::text, 'teste', 'teste:' || gen_random_uuid(), jsonb_build_object('tipo', 'teste', 'id', 'teste'),
    r.categoria, now(), now() + interval '1 hour', 'agendada',
    jsonb_build_object('destinoTeste', (cfg -> 'contatoTeste') || '{"tipo": "teste", "id": "teste"}'::jsonb, 'variaveisTeste', coalesce(vars, '{}'::jsonb)), true)
  returning automacao_execucoes.id into v_id;
  insert into public.auditoria (tabela, registro_id, operacao, ator_user_id, ator_papel, ator_contexto, depois)
  values ('automacao_execucoes', v_id, 'INSERT', auth.uid(), privado.papel(), 'prime', jsonb_build_object('teste', r.codigo));
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.metricas_automacoes(p_de date default null, p_ate date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare de timestamptz := coalesce(p_de, (now() at time zone 'America/Sao_Paulo')::date - 30)::timestamp at time zone 'America/Sao_Paulo';
        ate timestamptz := (coalesce(p_ate, (now() at time zone 'America/Sao_Paulo')::date) + 1)::timestamp at time zone 'America/Sao_Paulo';
begin
  if not privado.eh_prime() then perform privado.erro('ATOR_SEM_PERMISSAO', 'Só a Prime vê as métricas.'); end if;
  return jsonb_build_object(
    'porRegra', coalesce((select jsonb_object_agg(x.regra, x.c) from (
      select e.regra, jsonb_build_object('agendadas', count(*) filter (where e.estado = 'agendada'), 'enviadas', count(*) filter (where e.estado in ('enviada', 'entregue', 'lida')),
        'entregues', count(*) filter (where e.estado in ('entregue', 'lida')), 'lidas', count(*) filter (where e.estado = 'lida'), 'falhas', count(*) filter (where e.estado = 'falhou'),
        'canceladas', count(*) filter (where e.estado = 'cancelada'), 'ignoradas', count(*) filter (where e.estado = 'ignorada')) c
        from public.automacao_execucoes e where not e.teste and e.agendada_para >= de and e.agendada_para < ate group by e.regra) x), '{}'),
    'pesquisa', (select jsonb_build_object('pedidas', count(*), 'respondidas', count(v.id),
        'taxa', case when count(*) = 0 then null else round(100.0 * count(v.id) / count(*), 1) end)
      from public.automacao_execucoes e left join public.avaliacoes v on v.atendimento_id::text = e.contexto ->> 'atendimentoId'
      where e.regra = 'C10' and not e.teste and e.estado in ('enviada', 'entregue', 'lida') and e.agendada_para >= de and e.agendada_para < ate));
end $$;

create or replace function public.saude_automacoes() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not privado.eh_prime() then perform privado.erro('ATOR_SEM_PERMISSAO', 'Só a Prime vê a saúde das automações.'); end if;
  return jsonb_build_object(
    'motorLigado', privado.flag('automacoes_motor'),
    'eventosPendentes', (select count(*) from public.eventos where status = 'pendente'),
    'eventosAtrasados', (select count(*) from public.eventos where status = 'pendente' and criado_em < now() - interval '10 minutes'),
    'eventosComErro', (select count(*) from public.eventos where status = 'erro'),
    'execucoesAtrasadas', (select count(*) from public.automacao_execucoes where estado = 'agendada' and agendada_para < now() - interval '10 minutes'),
    'falhas24h', (select count(*) from public.automacao_execucoes where estado = 'falhou' and atualizado_em > now() - interval '24 hours'),
    'ultimaExecucao', (select privado.iso(max(d.end_time)) from cron.job_run_details d join cron.job j on j.jobid = d.jobid
                        where j.jobname = 'prime-notificacoes' and d.status = 'succeeded'));
end $$;

create or replace function public.configurar_automacoes(p_valor jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare atual jsonb := (select valor from public.automacao_config for update); novo jsonb;
begin
  if not privado.eh_prime_admin() then perform privado.erro('ATOR_SEM_PERMISSAO', 'Só a administração da Prime altera a configuração.'); end if;
  novo := atual || (coalesce(p_valor, '{}') - array(select k from jsonb_object_keys(coalesce(p_valor, '{}')) k where k not in ('silencioInicio', 'silencioFim', 'horaDiaUtil', 'limites', 'contatoTeste')));
  if not ((novo ->> 'silencioInicio') ~ '^(1[89]|2[0-3]):[0-5][0-9]$' and (novo ->> 'silencioFim') ~ '^0[5-9]:[0-5][0-9]$' and privado.hora_ok(novo -> 'horaDiaUtil')
          and privado.inteiro_entre(novo -> 'limites' -> 'lembrete', 1, 10) and privado.inteiro_entre(novo -> 'limites' -> 'marketing', 0, 3)) then
    perform privado.erro('DADOS_INVALIDOS', 'Configuração fora dos limites (silêncio começa entre 18h e 23h e termina entre 5h e 9h; limites de 1 a 10 lembretes e 0 a 3 de novidades).');
  end if;
  update public.automacao_config set valor = novo, atualizado_por = auth.uid(), atualizado_em = now();
  insert into public.auditoria (tabela, registro_id, operacao, ator_user_id, ator_papel, ator_contexto, antes, depois)
  values ('automacao_config', null, 'UPDATE', auth.uid(), privado.papel(), 'prime', atual, novo);
  return novo;
end $$;

-- ---------------------------------------------------------------- webhook do WhatsApp (só a Edge Function, papel de serviço)
/** Status de uma mensagem. Idempotente por (id externo, status); o estado só avança (sent < delivered < read; failed à parte). */
create or replace function public.webhook_status(p_id_externo text, p_status text, p_em timestamptz, p_erro jsonb default null) returns text
language plpgsql security definer set search_path = '' as $$
declare m public.mensagens; ordem int; atual int;
begin
  insert into public.mensagem_status (id_externo, status, em, erro) values (p_id_externo, p_status, p_em, p_erro) on conflict do nothing;
  if not found then return 'repetido'; end if;
  select * into m from public.mensagens where id_externo = p_id_externo for update;
  if not found then return 'desconhecido'; end if;
  ordem := case p_status when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 else 0 end;
  atual := case m.estado when 'enviada' then 1 when 'entregue' then 2 when 'lida' then 3 else 0 end;
  if p_status = 'failed' then
    if m.estado in ('entregue', 'lida') then return 'ignorado'; end if;
    update public.mensagens set estado = 'falhou', erro = coalesce(p_erro, '{}'), atualizado_em = now() where id = m.id;
    update public.automacao_execucoes set estado = 'falhou', motivo = 'o WhatsApp informou falha na entrega', atualizado_em = now()
     where id = m.execucao_id and estado in ('enviada', 'entregue');
    perform privado.evento('envio_falhou', jsonb_build_object('execucaoId', m.execucao_id), jsonb_build_object('regra', (select regra from public.automacao_execucoes where id = m.execucao_id),
      'cliente', 'destinatário', 'telefoneMascarado', privado.mascarar_destino('whatsapp', m.destino), 'erro', coalesce(p_erro ->> 'title', 'falha informada pelo WhatsApp')));
    return 'falhou';
  end if;
  if ordem <= atual then return 'sem mudança'; end if;
  update public.mensagens set estado = case ordem when 1 then 'enviada' when 2 then 'entregue' else 'lida' end,
    entregue_em = case when ordem >= 2 then coalesce(entregue_em, p_em) else entregue_em end, lida_em = case when ordem = 3 then p_em else lida_em end, atualizado_em = now()
   where id = m.id;
  update public.automacao_execucoes set estado = case ordem when 2 then 'entregue' when 3 then 'lida' else estado end, atualizado_em = now()
   where id = m.execucao_id and estado in ('enviada', 'entregue') and ordem >= 2;
  return 'atualizado';
end $$;

/**
 * Mensagem recebida: idempotente pelo id; renova a janela de 24h; "SAIR" revoga o marketing por WhatsApp de quem tem esse
 * telefone (um evento de confirmação única por mensagem); o resto vira aviso pra equipe (I09).
 */
create or replace function public.webhook_mensagem(p_id_externo text, p_telefone text, p_texto text, p_tipo text, p_em timestamptz) returns text
language plpgsql security definer set search_path = '' as $$
declare tel text := right(regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g'), 11); v_acao text; c record; n int := 0;
begin
  insert into public.mensagens_recebidas (id_externo, telefone, texto, tipo, recebida_em) values (p_id_externo, tel, left(p_texto, 1000), p_tipo, p_em) on conflict do nothing;
  if not found then return 'repetida'; end if;
  insert into public.whatsapp_janelas (telefone, ultima_entrada_em) values (tel, p_em)
  on conflict (telefone) do update set ultima_entrada_em = greatest(public.whatsapp_janelas.ultima_entrada_em, excluded.ultima_entrada_em);
  if upper(trim(translate(coalesce(p_texto, ''), 'áàãâéêíóôõúç.!', 'aaaaeeiooouc'))) in ('SAIR', 'PARAR', 'STOP') then
    for c in select id, usuario_id from public.clientes where telefone = tel and anonimizado_em is null loop
      if coalesce((privado.consentimentos_atuais('cliente', c.id) ->> 'marketing_whatsapp')::boolean, false) then
        perform pg_advisory_xact_lock(hashtextextended('consentimento:' || c.id || ':marketing_whatsapp', 0));
        insert into public.consentimentos (user_id, titular_tipo, titular_id, tipo, concedido, canal, origem) values (c.usuario_id, 'cliente', c.id, 'marketing_whatsapp', false, 'whatsapp', 'opt_out');
        n := n + 1;
      end if;
    end loop;
    v_acao := case when n > 0 then 'opt_out' else 'opt_out_sem_consentimento' end;
  else
    perform privado.evento('mensagem_recebida', jsonb_build_object('conversaId', p_id_externo),
      jsonb_build_object('telefoneMascarado', privado.mascarar_destino('whatsapp', tel), 'texto', left(coalesce(p_texto, '(' || coalesce(p_tipo, 'mídia') || ')'), 300),
        'cliente', (select nome from public.clientes where telefone = tel and anonimizado_em is null limit 1)));
    v_acao := 'equipe';
  end if;
  update public.mensagens_recebidas set acao = v_acao where id_externo = p_id_externo;
  return v_acao;
end $$;

-- ---------------------------------------------------------------- integração com o L1
/** Revogação de marketing (Minha conta ou SAIR) gera a confirmação única (C16) no canal revogado. */
create or replace function privado.aviso_revogacao() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not new.concedido and new.tipo like 'marketing_%' and new.titular_tipo = 'cliente' and new.origem in ('minha_conta', 'opt_out') then
    perform privado.evento('marketing_revogado', jsonb_build_object('clienteId', new.titular_id), jsonb_build_object('canal', replace(new.tipo, 'marketing_', '')));
  end if;
  return new;
end $$;
create trigger aviso_revogacao after insert on public.consentimentos for each row execute function privado.aviso_revogacao();

/** Exclusão de dados (anonimização da cliente): cancela o que estava agendado e apaga o texto e o destino das mensagens dela. */
create or replace function privado.automacoes_na_exclusao() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.anonimizado_em is null and new.anonimizado_em is not null then
    update public.automacao_execucoes set estado = 'cancelada', motivo = 'titular excluiu os dados', atualizado_em = now()
     where estado in ('agendada', 'enviando') and ((titular_tipo = 'cliente' and titular_id = new.id) or contexto ->> 'clienteId' = new.id::text);
    update public.mensagens m set destino = null, conteudo = '[removido a pedido da titular]', assunto = null
      from public.automacao_execucoes e where e.id = m.execucao_id and ((e.titular_tipo = 'cliente' and e.titular_id = new.id) or e.contexto ->> 'clienteId' = new.id::text);
    update public.automacao_execucoes set contexto = contexto - 'dados' where (titular_tipo = 'cliente' and titular_id = new.id) or contexto ->> 'clienteId' = new.id::text;
  end if;
  return new;
end $$;
create trigger automacoes_na_exclusao after update of anonimizado_em on public.clientes for each row execute function privado.automacoes_na_exclusao();

-- mensagens antigas do B5: as pendentes deixam de valer (o motor v2 replaneja pelos eventos e pela varredura da agenda)
update public.notificacoes set status = 'cancelada', motivo = 'motor de automações v2: substituída' where status = 'pendente';

-- ---------------------------------------------------------------- permissões
do $$ declare f text; begin
  foreach f in array array['listar_regras_automacao()', 'atualizar_regra_automacao(text, jsonb)', 'listar_templates(text)', 'salvar_template(text, text, text, text)',
    'restaurar_template(text, text, int)', 'listar_execucoes(jsonb)', 'acao_execucao(uuid, text, text)', 'testar_regra_automacao(text)',
    'metricas_automacoes(date, date)', 'saude_automacoes()', 'configurar_automacoes(jsonb)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['webhook_status(text, text, timestamptz, jsonb)', 'webhook_mensagem(text, text, text, text, timestamptz)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- "Baixar meus dados" (L1) passa a incluir as mensagens enviadas à própria pessoa
create or replace function public.meus_dados() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t jsonb := privado.titular(); v_id uuid := (t ->> 'id')::uuid; r jsonb;
begin
  if not privado.flag('lgpd_portal_titular') then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Fale com a Prime para receber seus dados.'); end if;
  if t ->> 'tipo' = 'cliente' then
    r := jsonb_build_object(
      'cadastro', (select to_jsonb(c) - 'importacao' - 'ficticio' - 'usuario_id' from public.clientes c where c.id = v_id),
      'pedidos', coalesce((select jsonb_agg(to_jsonb(p) - 'ficticio' - 'observacao_disponibilidade' order by p.criado_em) from public.pedidos p where p.cliente_id = v_id), '[]'),
      'diarias', coalesce((select jsonb_agg(jsonb_build_object('pedido', a.pedido_id, 'data', a.data, 'turno', a.turno, 'status', a.status, 'valorDiaCentavos', a.valor_dia_centavos) order by a.data)
                           from public.atendimentos a join public.pedidos p on p.id = a.pedido_id where p.cliente_id = v_id), '[]'),
      'pagamentos', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'pedido', g.pedido_id, 'valorCentavos', g.valor_centavos, 'metodo', g.metodo, 'status', g.status,
                              'venceEm', g.vence_em, 'informadoEm', g.informado_em, 'confirmadoEm', g.confirmado_em, 'estorno', g.estorno) order by g.criado_em)
                              from public.pagamentos g join public.pedidos p on p.id = g.pedido_id where p.cliente_id = v_id), '[]'),
      'pesquisas', coalesce((select jsonb_agg(jsonb_build_object('diaria', v.atendimento_id, 'notas', v.notas, 'comentario', v.comentario, 'em', v.criado_em))
                             from public.avaliacoes v join public.atendimentos a on a.id = v.atendimento_id join public.pedidos p on p.id = a.pedido_id where p.cliente_id = v_id), '[]'));
  else
    r := jsonb_build_object(
      'cadastro', (select to_jsonb(d) - 'ficticio' - 'usuario_id' - 'decisao' - 'historico' from public.diaristas d where d.id = v_id),
      'documentos', coalesce((select jsonb_agg(jsonb_build_object('tipo', x.tipo, 'enviadoEm', x.criado_em, 'arquivoApagado', x.excluido_em is not null)) from public.documentos x where x.diarista_id = v_id), '[]'),
      'diarias', coalesce((select jsonb_agg(jsonb_build_object('data', a.data, 'turno', a.turno, 'status', a.status) order by a.data) from public.atendimentos a where a.diarista_id = v_id), '[]'));
  end if;
  r := r || jsonb_build_object(
    'geradoEm', now(), 'titular', t ->> 'tipo',
    'acessos', coalesce((select jsonb_agg(jsonb_build_object('em', x.em, 'resultado', x.resultado, 'dispositivo', x.dispositivo) order by x.em desc)
                         from (select * from public.acessos a where a.user_id = auth.uid() order by a.em desc limit 200) x), '[]'),
    'aceites', coalesce((select jsonb_agg(jsonb_build_object('versao', a.versao, 'em', a.aceito_em, 'origem', a.origem) order by a.aceito_em)
                         from public.aceites_termos a where a.titular_tipo = t ->> 'tipo' and a.titular_id = v_id), '[]'),
    'mensagens', coalesce((select jsonb_agg(jsonb_build_object('canal', x.canal, 'conteudo', x.conteudo, 'estado', x.estado, 'em', x.criado_em) order by x.criado_em)
                           from public.mensagens x join public.automacao_execucoes e on e.id = x.execucao_id
                          where e.titular_tipo = t ->> 'tipo' and e.titular_id = v_id and x.canal <> 'painel'), '[]'),
    'consentimentos', coalesce((select jsonb_agg(jsonb_build_object('tipo', c.tipo, 'concedido', c.concedido, 'em', c.em, 'origem', c.origem) order by c.em)
                                from public.consentimentos c where c.titular_tipo = t ->> 'tipo' and c.titular_id = v_id), '[]'));
  insert into public.pedidos_titular (user_id, titular_tipo, titular_id, tipo, estado, executado_em) values (auth.uid(), t ->> 'tipo', v_id, 'acesso', 'executado', now());
  return r;
end $$;

-- semente gerada por scripts/gera-seed-automacoes.mjs a partir de src/automacoes/catalogo.js
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('solicitacao_recebida', 'whatsapp', 1, 'Oi, {{nome}}! Recebemos sua solicitação de atendimento na Prime: {{resumo}}. A solicitação ainda não é a confirmação: agora a Prime verifica a disponibilidade e responde por aqui. Você acompanha em {{link}}
Qualquer dúvida, é só responder.', null, array['nome', 'resumo', 'link']::text[], array['nome', 'resumo', 'link']::text[], 'UTILITY', true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('solicitacao_recebida', 'email', 1, 'Oi, {{nome}}! Recebemos sua solicitação de atendimento na Prime: {{resumo}}. A solicitação ainda não é a confirmação: agora a Prime verifica a disponibilidade e responde por aqui. Você acompanha em {{link}}
Qualquer dúvida, é só responder.', 'Recebemos sua solicitação', array['nome', 'resumo', 'link']::text[], array['nome', 'resumo', 'link']::text[], null, true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('disponibilidade_confirmada', 'whatsapp', 1, 'Oi, {{nome}}! A Prime confirmou a disponibilidade para {{resumo}}. O valor total é {{total}}. Para confirmar, faça o pagamento antecipado de {{valor}} por PIX, transferência ou depósito até {{prazo}} e envie o comprovante. Detalhes e link de pagamento: {{link}}
Dúvidas? É só responder.', null, array['nome', 'resumo', 'total', 'valor', 'prazo', 'link']::text[], array['nome', 'resumo', 'total', 'valor', 'prazo', 'link']::text[], 'UTILITY', true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('disponibilidade_confirmada', 'email', 1, 'Oi, {{nome}}! A Prime confirmou a disponibilidade para {{resumo}}. O valor total é {{total}}. Para confirmar, faça o pagamento antecipado de {{valor}} por PIX, transferência ou depósito até {{prazo}} e envie o comprovante. Detalhes e link de pagamento: {{link}}
Dúvidas? É só responder.', 'Disponibilidade confirmada: falta o pagamento', array['nome', 'resumo', 'total', 'valor', 'prazo', 'link']::text[], array['nome', 'resumo', 'total', 'valor', 'prazo', 'link']::text[], null, true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('solicitacao_recusada', 'whatsapp', 1, 'Oi, {{nome}}. Verificamos sua solicitação para {{resumo}} e, desta vez, não temos disponibilidade. Motivo: {{motivo}}. Se quiser, responda esta mensagem e a Prime ajuda a encontrar outra data.', null, array['nome', 'resumo', 'motivo']::text[], array['nome', 'resumo', 'motivo']::text[], 'UTILITY', true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('solicitacao_recusada', 'email', 1, 'Oi, {{nome}}. Verificamos sua solicitação para {{resumo}} e, desta vez, não temos disponibilidade. Motivo: {{motivo}}. Se quiser, responda esta mensagem e a Prime ajuda a encontrar outra data.', 'Sobre a sua solicitação', array['nome', 'resumo', 'motivo']::text[], array['nome', 'resumo', 'motivo']::text[], null, true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('lembrete_prazo_pagamento', 'whatsapp', 1, 'Oi, {{nome}}. Lembrete da Prime: o pagamento antecipado de {{valor}}, da diária de {{data}}, vence {{prazo}}. Os detalhes estão em {{link}}
Se já pagou, pode desconsiderar esta mensagem.', null, array['nome', 'valor', 'data', 'prazo', 'link']::text[], array['nome', 'valor', 'data', 'prazo', 'link']::text[], 'UTILITY', true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('lembrete_prazo_pagamento', 'email', 1, 'Oi, {{nome}}. Lembrete da Prime: o pagamento antecipado de {{valor}}, da diária de {{data}}, vence {{prazo}}. Os detalhes estão em {{link}}
Se já pagou, pode desconsiderar esta mensagem.', 'Lembrete do prazo de pagamento', array['nome', 'valor', 'data', 'prazo', 'link']::text[], array['nome', 'valor', 'data', 'prazo', 'link']::text[], null, true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('pagamento_confirmado', 'whatsapp', 1, 'Oi, {{nome}}! A Prime confirmou o pagamento de {{oque}}. Seu atendimento está confirmado. Acompanhe em {{link}}
Na véspera, a gente te lembra por aqui.', null, array['nome', 'oque', 'link']::text[], array['nome', 'oque', 'link']::text[], 'UTILITY', true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('pagamento_confirmado', 'email', 1, 'Oi, {{nome}}! A Prime confirmou o pagamento de {{oque}}. Seu atendimento está confirmado. Acompanhe em {{link}}
Na véspera, a gente te lembra por aqui.', 'Pagamento confirmado', array['nome', 'oque', 'link']::text[], array['nome', 'oque', 'link']::text[], null, true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('lembrete_vespera', 'whatsapp', 1, 'Oi, {{nome}}! Passando pra lembrar: {{quando}} tem atendimento da Prime no período da {{periodo}}, com {{carga}}. O material de limpeza é seu; para área externa, deixe uma mangueira disponível. Se precisar mudar algo, responda esta mensagem.', null, array['nome', 'quando', 'periodo', 'carga']::text[], array['nome', 'quando', 'periodo', 'carga']::text[], 'UTILITY', true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('lembrete_vespera', 'email', 1, 'Oi, {{nome}}! Passando pra lembrar: {{quando}} tem atendimento da Prime no período da {{periodo}}, com {{carga}}. O material de limpeza é seu; para área externa, deixe uma mangueira disponível. Se precisar mudar algo, responda esta mensagem.', 'Lembrete: seu atendimento é amanhã', array['nome', 'quando', 'periodo', 'carga']::text[], array['nome', 'quando', 'periodo', 'carga']::text[], null, true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('profissional_designada', 'whatsapp', 1, 'Oi, {{nome}}. A profissional designada pela Prime para a diária de {{data}} é {{profissional}}. Qualquer dúvida, responda esta mensagem.', null, array['nome', 'data', 'profissional']::text[], array['nome', 'data', 'profissional']::text[], 'UTILITY', true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('profissional_designada', 'email', 1, 'Oi, {{nome}}. A profissional designada pela Prime para a diária de {{data}} é {{profissional}}. Qualquer dúvida, responda esta mensagem.', 'Profissional designada', array['nome', 'data', 'profissional']::text[], array['nome', 'data', 'profissional']::text[], null, true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('profissional_a_caminho', 'whatsapp', 1, 'Oi, {{nome}}. A profissional designada pela Prime, {{profissional}}, já está a caminho do seu endereço. Qualquer imprevisto, responda esta mensagem.', null, array['nome', 'profissional']::text[], array['nome', 'profissional']::text[], 'UTILITY', true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('profissional_a_caminho', 'email', 1, 'Oi, {{nome}}. A profissional designada pela Prime, {{profissional}}, já está a caminho do seu endereço. Qualquer imprevisto, responda esta mensagem.', 'A profissional está a caminho', array['nome', 'profissional']::text[], array['nome', 'profissional']::text[], null, true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('atendimento_iniciado', 'whatsapp', 1, 'Oi, {{nome}}! A profissional {{profissional}} chegou e começou o atendimento de hoje. A Prime avisa quando terminar.', null, array['nome', 'profissional']::text[], array['nome', 'profissional']::text[], 'UTILITY', true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('atendimento_iniciado', 'email', 1, 'Oi, {{nome}}! A profissional {{profissional}} chegou e começou o atendimento de hoje. A Prime avisa quando terminar.', 'Atendimento iniciado', array['nome', 'profissional']::text[], array['nome', 'profissional']::text[], null, true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('atendimento_finalizado', 'whatsapp', 1, 'Oi, {{nome}}. O atendimento de hoje terminou. Pode responder a pesquisa de satisfação da Prime? Sua resposta vai direto para a equipe da Prime: {{link}}
Obrigada!', null, array['nome', 'link']::text[], array['nome', 'link']::text[], 'UTILITY', true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('atendimento_finalizado', 'email', 1, 'Oi, {{nome}}. O atendimento de hoje terminou. Pode responder a pesquisa de satisfação da Prime? Sua resposta vai direto para a equipe da Prime: {{link}}
Obrigada!', 'Como foi o atendimento?', array['nome', 'link']::text[], array['nome', 'link']::text[], null, true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('lembrete_pesquisa', 'whatsapp', 1, 'Oi, {{nome}}. Ainda dá tempo de responder a pesquisa sobre o atendimento de {{data}}. Leva menos de um minuto: {{link}}
Obrigada!', null, array['nome', 'data', 'link']::text[], array['nome', 'data', 'link']::text[], 'UTILITY', true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('lembrete_pesquisa', 'email', 1, 'Oi, {{nome}}. Ainda dá tempo de responder a pesquisa sobre o atendimento de {{data}}. Leva menos de um minuto: {{link}}
Obrigada!', 'Sua opinião sobre o atendimento', array['nome', 'data', 'link']::text[], array['nome', 'data', 'link']::text[], null, true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('remarcacao_confirmada', 'whatsapp', 1, 'Oi, {{nome}}. Seu atendimento foi remarcado para {{quando}}, no período da {{periodo}}. Se precisar de outro ajuste, responda esta mensagem.', null, array['nome', 'quando', 'periodo']::text[], array['nome', 'quando', 'periodo']::text[], 'UTILITY', true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('remarcacao_confirmada', 'email', 1, 'Oi, {{nome}}. Seu atendimento foi remarcado para {{quando}}, no período da {{periodo}}. Se precisar de outro ajuste, responda esta mensagem.', 'Atendimento remarcado', array['nome', 'quando', 'periodo']::text[], array['nome', 'quando', 'periodo']::text[], null, true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('estorno_registrado', 'whatsapp', 1, 'Oi, {{nome}}. A Prime registrou o estorno de {{valor}} ({{oque}}). Se tiver qualquer dúvida, responda esta mensagem.', null, array['nome', 'valor', 'oque']::text[], array['nome', 'valor', 'oque']::text[], 'UTILITY', true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('estorno_registrado', 'email', 1, 'Oi, {{nome}}. A Prime registrou o estorno de {{valor}} ({{oque}}). Se tiver qualquer dúvida, responda esta mensagem.', 'Estorno registrado', array['nome', 'valor', 'oque']::text[], array['nome', 'valor', 'oque']::text[], null, true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('hora_extra_registrada', 'whatsapp', 1, 'Oi, {{nome}}. A Prime registrou {{horas}} de hora extra na diária de {{data}}, no valor de {{valor}}. O pagamento está em {{link}}
Dúvidas? É só responder.', null, array['nome', 'horas', 'data', 'valor', 'link']::text[], array['nome', 'horas', 'data', 'valor', 'link']::text[], 'UTILITY', true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('hora_extra_registrada', 'email', 1, 'Oi, {{nome}}. A Prime registrou {{horas}} de hora extra na diária de {{data}}, no valor de {{valor}}. O pagamento está em {{link}}
Dúvidas? É só responder.', 'Hora extra registrada', array['nome', 'horas', 'data', 'valor', 'link']::text[], array['nome', 'horas', 'data', 'valor', 'link']::text[], null, true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('ocorrencia_atualizada', 'whatsapp', 1, 'Oi, {{nome}}. O chamado sobre a diária de {{data}} está {{estado}}. Acompanhe em {{link}}
Se quiser acrescentar algo, é só responder.', null, array['nome', 'data', 'estado', 'link']::text[], array['nome', 'data', 'estado', 'link']::text[], 'UTILITY', true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('ocorrencia_atualizada', 'email', 1, 'Oi, {{nome}}. O chamado sobre a diária de {{data}} está {{estado}}. Acompanhe em {{link}}
Se quiser acrescentar algo, é só responder.', 'Seu chamado foi atualizado', array['nome', 'data', 'estado', 'link']::text[], array['nome', 'data', 'estado', 'link']::text[], null, true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('optout_confirmado', 'whatsapp', 1, 'Oi, {{nome}}. Pronto: você não vai mais receber mensagens de novidades da Prime por este canal. As mensagens do seu atendimento continuam normalmente.', null, array['nome']::text[], array['nome']::text[], 'UTILITY', true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('optout_confirmado', 'email', 1, 'Oi, {{nome}}. Pronto: você não vai mais receber mensagens de novidades da Prime por este canal. As mensagens do seu atendimento continuam normalmente.', 'Você saiu das mensagens de novidades', array['nome']::text[], array['nome']::text[], null, true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('renovacao_pacote', 'whatsapp', 1, 'Oi, {{nome}}! Quer manter as mesmas diárias em {{mes}}? A solicitação já vem preenchida com as datas do seu pacote: {{link}}
Se não quiser mais receber estas mensagens, responda SAIR.', null, array['nome', 'mes', 'link']::text[], array['nome', 'mes', 'link']::text[], 'MARKETING', true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('renovacao_pacote', 'email', 1, 'Oi, {{nome}}! Quer manter as mesmas diárias em {{mes}}? A solicitação já vem preenchida com as datas do seu pacote: {{link}}
Se não quiser mais receber estas mensagens, responda SAIR.', 'Renove o seu pacote', array['nome', 'mes', 'link']::text[], array['nome', 'mes', 'link']::text[], null, true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('reativacao', 'whatsapp', 1, 'Oi, {{nome}}! Faz um tempo desde a sua última diária com a Prime. Quando precisar, é só solicitar por {{link}}
Se não quiser mais receber estas mensagens, responda SAIR.', null, array['nome', 'link']::text[], array['nome', 'link']::text[], 'MARKETING', true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('reativacao', 'email', 1, 'Oi, {{nome}}! Faz um tempo desde a sua última diária com a Prime. Quando precisar, é só solicitar por {{link}}
Se não quiser mais receber estas mensagens, responda SAIR.', 'A Prime está por aqui', array['nome', 'link']::text[], array['nome', 'link']::text[], null, true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('aniversario_cliente', 'whatsapp', 1, 'Feliz aniversário, {{nome}}! A equipe da Prime deseja um dia muito especial para você.
Se não quiser mais receber estas mensagens, responda SAIR.', null, array['nome']::text[], array['nome']::text[], 'MARKETING', true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('aniversario_cliente', 'email', 1, 'Feliz aniversário, {{nome}}! A equipe da Prime deseja um dia muito especial para você.
Se não quiser mais receber estas mensagens, responda SAIR.', 'Feliz aniversário', array['nome']::text[], array['nome']::text[], null, true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('cadastro_recebido', 'whatsapp', 1, 'Oi, {{nome}}! Recebemos seu cadastro na Prime. Vamos analisar seus documentos e responder por aqui em até {{dias}} dias úteis.', null, array['nome', 'dias']::text[], array['nome', 'dias']::text[], 'UTILITY', true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('cadastro_recebido', 'email', 1, 'Oi, {{nome}}! Recebemos seu cadastro na Prime. Vamos analisar seus documentos e responder por aqui em até {{dias}} dias úteis.', 'Recebemos seu cadastro', array['nome', 'dias']::text[], array['nome', 'dias']::text[], null, true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('cadastro_aprovado', 'whatsapp', 1, 'Parabéns, {{nome}}! Seu cadastro na Prime foi aprovado. As próximas diárias chegam por aqui.', null, array['nome']::text[], array['nome']::text[], 'UTILITY', true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('cadastro_aprovado', 'email', 1, 'Parabéns, {{nome}}! Seu cadastro na Prime foi aprovado. As próximas diárias chegam por aqui.', 'Cadastro aprovado', array['nome']::text[], array['nome']::text[], null, true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('cadastro_reprovado', 'whatsapp', 1, 'Oi, {{nome}}. Analisamos seu cadastro e, por enquanto, não conseguimos seguir. Se quiser conversar sobre isso, responda esta mensagem.', null, array['nome']::text[], array['nome']::text[], 'UTILITY', true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('cadastro_reprovado', 'email', 1, 'Oi, {{nome}}. Analisamos seu cadastro e, por enquanto, não conseguimos seguir. Se quiser conversar sobre isso, responda esta mensagem.', 'Sobre o seu cadastro', array['nome']::text[], array['nome']::text[], null, true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('diaria_designada', 'whatsapp', 1, 'Oi, {{nome}}! Você tem uma diária confirmada: {{data}}, período da {{periodo}}. Endereço: {{endereco}}. Qualquer dúvida, responda esta mensagem.', null, array['nome', 'data', 'periodo', 'endereco']::text[], array['nome', 'data', 'periodo', 'endereco']::text[], 'UTILITY', true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('diaria_designada', 'email', 1, 'Oi, {{nome}}! Você tem uma diária confirmada: {{data}}, período da {{periodo}}. Endereço: {{endereco}}. Qualquer dúvida, responda esta mensagem.', 'Nova diária confirmada', array['nome', 'data', 'periodo', 'endereco']::text[], array['nome', 'data', 'periodo', 'endereco']::text[], null, true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('lembrete_vespera_profissional', 'whatsapp', 1, 'Oi, {{nome}}. Lembrete: {{quando}} você tem diária no período da {{periodo}}. Endereço: {{endereco}}. Bom trabalho!', null, array['nome', 'quando', 'periodo', 'endereco']::text[], array['nome', 'quando', 'periodo', 'endereco']::text[], 'UTILITY', true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('lembrete_vespera_profissional', 'email', 1, 'Oi, {{nome}}. Lembrete: {{quando}} você tem diária no período da {{periodo}}. Endereço: {{endereco}}. Bom trabalho!', 'Lembrete: diária de amanhã', array['nome', 'quando', 'periodo', 'endereco']::text[], array['nome', 'quando', 'periodo', 'endereco']::text[], null, true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('lembrete_checkin', 'whatsapp', 1, 'Oi, {{nome}}. A diária de hoje, período da {{periodo}}, ainda está sem check-in. Se já chegou, avise pela sua agenda; se teve imprevisto, responda esta mensagem.', null, array['nome', 'periodo']::text[], array['nome', 'periodo']::text[], 'UTILITY', true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('lembrete_checkin', 'email', 1, 'Oi, {{nome}}. A diária de hoje, período da {{periodo}}, ainda está sem check-in. Se já chegou, avise pela sua agenda; se teve imprevisto, responda esta mensagem.', 'Check-in da diária de hoje', array['nome', 'periodo']::text[], array['nome', 'periodo']::text[], null, true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('documento_vencendo', 'whatsapp', 1, 'Oi, {{nome}}. Seu documento {{documento}} vence em {{dias}} dias. Envie a versão atualizada pelo seu cadastro para continuar recebendo diárias.', null, array['nome', 'documento', 'dias']::text[], array['nome', 'documento', 'dias']::text[], 'UTILITY', true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('documento_vencendo', 'email', 1, 'Oi, {{nome}}. Seu documento {{documento}} vence em {{dias}} dias. Envie a versão atualizada pelo seu cadastro para continuar recebendo diárias.', 'Documento vencendo', array['nome', 'documento', 'dias']::text[], array['nome', 'documento', 'dias']::text[], null, true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('diaria_cancelada_ou_remarcada', 'whatsapp', 1, 'Oi, {{nome}}. A diária de {{data}}, período da {{periodo}}, {{oque}} e saiu da sua agenda. Qualquer dúvida, responda esta mensagem.', null, array['nome', 'data', 'periodo', 'oque']::text[], array['nome', 'data', 'periodo', 'oque']::text[], 'UTILITY', true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('diaria_cancelada_ou_remarcada', 'email', 1, 'Oi, {{nome}}. A diária de {{data}}, período da {{periodo}}, {{oque}} e saiu da sua agenda. Qualquer dúvida, responda esta mensagem.', 'Mudança na sua agenda', array['nome', 'data', 'periodo', 'oque']::text[], array['nome', 'data', 'periodo', 'oque']::text[], null, true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('nova_solicitacao', 'painel', 1, 'Nova solicitação de {{cliente}}: {{resumo}}. Verificar a disponibilidade.', null, array['cliente', 'resumo']::text[], array['cliente', 'resumo']::text[], null, true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('pagamento_informado', 'painel', 1, '{{cliente}} avisou que pagou {{valor}} ({{oque}}). Conferir o extrato e confirmar.', null, array['cliente', 'valor', 'oque']::text[], array['cliente', 'valor', 'oque']::text[], null, true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('checkin_atrasado', 'painel', 1, 'Diária de {{cliente}} ({{periodo}}) sem check-in da profissional {{profissional}}. Falar com ela.', null, array['cliente', 'periodo', 'profissional']::text[], array['cliente', 'periodo', 'profissional']::text[], null, true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('pagamento_vencido', 'painel', 1, 'O prazo de pagamento de {{cliente}} ({{valor}}, diária de {{data}}) venceu. Decidir: liberar a vaga ou dar mais prazo.', null, array['cliente', 'valor', 'data']::text[], array['cliente', 'valor', 'data']::text[], null, true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('ocorrencia_aberta', 'painel', 1, '{{cliente}} abriu uma ocorrência sobre a diária de {{data}}. Analisar o chamado.', null, array['cliente', 'data']::text[], array['cliente', 'data']::text[], null, true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('resumo_diario', 'painel', 1, 'Hoje: {{diarias}} diárias, {{checkins}} check-ins esperados, {{pendencias}} pagamentos pendentes e {{ocorrencias}} ocorrências abertas.', null, array['diarias', 'checkins', 'pendencias', 'ocorrencias']::text[], array['diarias', 'checkins', 'pendencias', 'ocorrencias']::text[], null, true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('resumo_semanal', 'painel', 1, 'Semana {{semana}}: {{solicitacoes}} solicitações, {{recusas}} recusas, {{diarias}} diárias realizadas e {{recebido}} recebidos.', null, array['semana', 'solicitacoes', 'recusas', 'diarias', 'recebido']::text[], array['semana', 'solicitacoes', 'recusas', 'diarias', 'recebido']::text[], null, true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('falha_envio', 'painel', 1, 'Não foi possível enviar {{regra}} para {{cliente}} ({{telefone}}): {{erro}}. Fazer o contato manualmente.', null, array['regra', 'cliente', 'telefone', 'erro']::text[], array['regra', 'cliente', 'telefone', 'erro']::text[], null, true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('mensagem_recebida', 'painel', 1, 'Mensagem de {{cliente}} ({{telefone}}) no WhatsApp: {{texto}}', null, array['cliente', 'telefone', 'texto']::text[], array['cliente', 'telefone', 'texto']::text[], null, true);
insert into public.automacao_regras (codigo, template_codigo, descricao, categoria, destinatario, canais_ordem, gatilho, atraso, condicoes, cancelamento, entidade, marco, do_dia, validade_min, ligada) values ('C01', 'solicitacao_recebida', 'Solicitação recebida', 'atendimento', 'cliente', array['whatsapp', 'email', 'painel']::text[], '{"tipo":"evento","eventos":["pedido_criado"]}'::jsonb, '{"tipo":"imediato"}'::jsonb, '{}'::jsonb, array[]::text[], 'pedido', null, false, null, true);
insert into public.automacao_regras (codigo, template_codigo, descricao, categoria, destinatario, canais_ordem, gatilho, atraso, condicoes, cancelamento, entidade, marco, do_dia, validade_min, ligada) values ('C02', 'disponibilidade_confirmada', 'Disponibilidade confirmada, com valor, formas e prazo de pagamento', 'atendimento', 'cliente', array['whatsapp', 'email', 'painel']::text[], '{"tipo":"evento","eventos":["disponibilidade_confirmada"]}'::jsonb, '{"tipo":"imediato"}'::jsonb, '{"temCobranca":true,"pedidoStatus":["aguardando_pagamento","confirmado"]}'::jsonb, array['pedido_cancelado']::text[], 'pedido', null, false, null, true);
insert into public.automacao_regras (codigo, template_codigo, descricao, categoria, destinatario, canais_ordem, gatilho, atraso, condicoes, cancelamento, entidade, marco, do_dia, validade_min, ligada) values ('C03', 'solicitacao_recusada', 'Solicitação recusada, com o motivo', 'atendimento', 'cliente', array['whatsapp', 'email', 'painel']::text[], '{"tipo":"evento","eventos":["solicitacao_recusada"]}'::jsonb, '{"tipo":"imediato"}'::jsonb, '{}'::jsonb, array[]::text[], 'pedido', null, false, null, true);
insert into public.automacao_regras (codigo, template_codigo, descricao, categoria, destinatario, canais_ordem, gatilho, atraso, condicoes, cancelamento, entidade, marco, do_dia, validade_min, ligada) values ('C04', 'lembrete_prazo_pagamento', 'Lembrete do prazo de pagamento (24h e 3h antes)', 'lembrete', 'cliente', array['whatsapp', 'email', 'painel']::text[], '{"tipo":"agenda"}'::jsonb, '{"tipo":"antes_prazo","minutos":[1440,180]}'::jsonb, '{"pagamentoStatus":["pendente"],"pedidoStatus":["aguardando_pagamento","confirmado"],"mesmoPrazo":true}'::jsonb, array['pagamento_confirmado', 'pedido_cancelado', 'solicitacao_recusada', 'atendimento_cancelado']::text[], 'pagamento', null, false, null, true);
insert into public.automacao_regras (codigo, template_codigo, descricao, categoria, destinatario, canais_ordem, gatilho, atraso, condicoes, cancelamento, entidade, marco, do_dia, validade_min, ligada) values ('C05', 'pagamento_confirmado', 'Pagamento confirmado', 'atendimento', 'cliente', array['whatsapp', 'email', 'painel']::text[], '{"tipo":"evento","eventos":["pagamento_confirmado"]}'::jsonb, '{"tipo":"imediato"}'::jsonb, '{}'::jsonb, array[]::text[], 'pagamento', null, false, null, true);
insert into public.automacao_regras (codigo, template_codigo, descricao, categoria, destinatario, canais_ordem, gatilho, atraso, condicoes, cancelamento, entidade, marco, do_dia, validade_min, ligada) values ('C06', 'lembrete_vespera', 'Lembrete da véspera', 'lembrete', 'cliente', array['whatsapp', 'email', 'painel']::text[], '{"tipo":"agenda"}'::jsonb, '{"tipo":"vespera","hora":"18:00"}'::jsonb, '{"atendimentoStatus":["confirmado"],"mesmaData":true}'::jsonb, array['atendimento_cancelado', 'pedido_cancelado', 'atendimento_reagendado']::text[], 'atendimento', null, false, null, true);
insert into public.automacao_regras (codigo, template_codigo, descricao, categoria, destinatario, canais_ordem, gatilho, atraso, condicoes, cancelamento, entidade, marco, do_dia, validade_min, ligada) values ('C07', 'profissional_designada', 'Profissional designada ou trocada (primeiro nome)', 'atendimento', 'cliente', array['whatsapp', 'email', 'painel']::text[], '{"tipo":"evento","eventos":["atendimento_atribuido"]}'::jsonb, '{"tipo":"imediato"}'::jsonb, '{"atendimentoStatus":["agendado","confirmado"],"mesmaProfissional":true}'::jsonb, array['atendimento_cancelado', 'pedido_cancelado']::text[], 'atendimento', null, false, null, true);
insert into public.automacao_regras (codigo, template_codigo, descricao, categoria, destinatario, canais_ordem, gatilho, atraso, condicoes, cancelamento, entidade, marco, do_dia, validade_min, ligada) values ('C08', 'profissional_a_caminho', 'Profissional a caminho', 'atendimento', 'cliente', array['whatsapp', 'email', 'painel']::text[], '{"tipo":"evento","eventos":["atendimento_diarista_a_caminho"]}'::jsonb, '{"tipo":"imediato"}'::jsonb, '{}'::jsonb, array[]::text[], 'atendimento', null, true, 180, true);
insert into public.automacao_regras (codigo, template_codigo, descricao, categoria, destinatario, canais_ordem, gatilho, atraso, condicoes, cancelamento, entidade, marco, do_dia, validade_min, ligada) values ('C09', 'atendimento_iniciado', 'Atendimento iniciado', 'atendimento', 'cliente', array['whatsapp', 'email', 'painel']::text[], '{"tipo":"evento","eventos":["atendimento_em_andamento"]}'::jsonb, '{"tipo":"imediato"}'::jsonb, '{}'::jsonb, array[]::text[], 'atendimento', null, true, 180, true);
insert into public.automacao_regras (codigo, template_codigo, descricao, categoria, destinatario, canais_ordem, gatilho, atraso, condicoes, cancelamento, entidade, marco, do_dia, validade_min, ligada) values ('C10', 'atendimento_finalizado', 'Atendimento finalizado, com a pesquisa de satisfação', 'atendimento', 'cliente', array['whatsapp', 'email', 'painel']::text[], '{"tipo":"evento","eventos":["atendimento_finalizado"]}'::jsonb, '{"tipo":"imediato"}'::jsonb, '{}'::jsonb, array[]::text[], 'atendimento', null, true, 720, true);
insert into public.automacao_regras (codigo, template_codigo, descricao, categoria, destinatario, canais_ordem, gatilho, atraso, condicoes, cancelamento, entidade, marco, do_dia, validade_min, ligada) values ('C11', 'lembrete_pesquisa', 'Lembrete da pesquisa (24h depois, uma vez)', 'lembrete', 'cliente', array['whatsapp', 'email', 'painel']::text[], '{"tipo":"evento","eventos":["atendimento_finalizado"]}'::jsonb, '{"tipo":"apos","minutos":1440}'::jsonb, '{"atendimentoStatus":["finalizado"],"semAvaliacao":true}'::jsonb, array['atendimento_avaliado']::text[], 'atendimento', 'unico', false, null, true);
insert into public.automacao_regras (codigo, template_codigo, descricao, categoria, destinatario, canais_ordem, gatilho, atraso, condicoes, cancelamento, entidade, marco, do_dia, validade_min, ligada) values ('C12', 'remarcacao_confirmada', 'Remarcação confirmada', 'atendimento', 'cliente', array['whatsapp', 'email', 'painel']::text[], '{"tipo":"evento","eventos":["atendimento_reagendado"]}'::jsonb, '{"tipo":"imediato"}'::jsonb, '{}'::jsonb, array[]::text[], 'atendimento', null, false, null, true);
insert into public.automacao_regras (codigo, template_codigo, descricao, categoria, destinatario, canais_ordem, gatilho, atraso, condicoes, cancelamento, entidade, marco, do_dia, validade_min, ligada) values ('C13', 'estorno_registrado', 'Estorno registrado', 'atendimento', 'cliente', array['whatsapp', 'email', 'painel']::text[], '{"tipo":"evento","eventos":["estorno_registrado"]}'::jsonb, '{"tipo":"imediato"}'::jsonb, '{}'::jsonb, array[]::text[], 'pagamento', null, false, null, true);
insert into public.automacao_regras (codigo, template_codigo, descricao, categoria, destinatario, canais_ordem, gatilho, atraso, condicoes, cancelamento, entidade, marco, do_dia, validade_min, ligada) values ('C14', 'hora_extra_registrada', 'Hora extra aprovada, com valor e link (evento do bloco 3, P3)', 'atendimento', 'cliente', array['whatsapp', 'email', 'painel']::text[], '{"tipo":"evento","eventos":["hora_extra_aprovada"]}'::jsonb, '{"tipo":"imediato"}'::jsonb, '{}'::jsonb, array[]::text[], 'atendimento', null, false, null, true);
insert into public.automacao_regras (codigo, template_codigo, descricao, categoria, destinatario, canais_ordem, gatilho, atraso, condicoes, cancelamento, entidade, marco, do_dia, validade_min, ligada) values ('C15', 'ocorrencia_atualizada', 'Ocorrência atualizada (evento do bloco 3, P4)', 'atendimento', 'cliente', array['whatsapp', 'email', 'painel']::text[], '{"tipo":"evento","eventos":["ocorrencia_atualizada"]}'::jsonb, '{"tipo":"imediato"}'::jsonb, '{}'::jsonb, array[]::text[], 'atendimento', null, false, null, true);
insert into public.automacao_regras (codigo, template_codigo, descricao, categoria, destinatario, canais_ordem, gatilho, atraso, condicoes, cancelamento, entidade, marco, do_dia, validade_min, ligada) values ('C16', 'optout_confirmado', 'Confirmação única de que a pessoa saiu das mensagens de novidades', 'atendimento', 'cliente', array['whatsapp', 'email']::text[], '{"tipo":"evento","eventos":["marketing_revogado"]}'::jsonb, '{"tipo":"imediato"}'::jsonb, '{}'::jsonb, array[]::text[], 'cliente', null, false, null, true);
insert into public.automacao_regras (codigo, template_codigo, descricao, categoria, destinatario, canais_ordem, gatilho, atraso, condicoes, cancelamento, entidade, marco, do_dia, validade_min, ligada) values ('M01', 'renovacao_pacote', 'Renovação do pacote (dia 25)', 'marketing', 'cliente', array['whatsapp', 'email']::text[], '{"tipo":"agenda"}'::jsonb, '{"tipo":"mensal","dia":25,"hora":"09:00"}'::jsonb, '{}'::jsonb, array[]::text[], 'cliente', null, false, null, false);
insert into public.automacao_regras (codigo, template_codigo, descricao, categoria, destinatario, canais_ordem, gatilho, atraso, condicoes, cancelamento, entidade, marco, do_dia, validade_min, ligada) values ('M02', 'reativacao', 'Reativação: sem diária há 60 dias (no máximo a cada 90)', 'marketing', 'cliente', array['whatsapp', 'email']::text[], '{"tipo":"agenda"}'::jsonb, '{"tipo":"inatividade","dias":60,"intervaloDias":90,"hora":"09:00"}'::jsonb, '{}'::jsonb, array[]::text[], 'cliente', null, false, null, false);
insert into public.automacao_regras (codigo, template_codigo, descricao, categoria, destinatario, canais_ordem, gatilho, atraso, condicoes, cancelamento, entidade, marco, do_dia, validade_min, ligada) values ('M03', 'aniversario_cliente', 'Aniversário da cliente, 9h', 'marketing', 'cliente', array['whatsapp', 'email']::text[], '{"tipo":"agenda"}'::jsonb, '{"tipo":"aniversario","hora":"09:00"}'::jsonb, '{}'::jsonb, array[]::text[], 'cliente', null, false, null, false);
insert into public.automacao_regras (codigo, template_codigo, descricao, categoria, destinatario, canais_ordem, gatilho, atraso, condicoes, cancelamento, entidade, marco, do_dia, validade_min, ligada) values ('D01', 'cadastro_recebido', 'Cadastro recebido', 'atendimento', 'diarista', array['whatsapp', 'email', 'painel']::text[], '{"tipo":"evento","eventos":["diarista_cadastrada"]}'::jsonb, '{"tipo":"imediato"}'::jsonb, '{}'::jsonb, array[]::text[], 'diarista', null, false, null, true);
insert into public.automacao_regras (codigo, template_codigo, descricao, categoria, destinatario, canais_ordem, gatilho, atraso, condicoes, cancelamento, entidade, marco, do_dia, validade_min, ligada) values ('D02', 'cadastro_aprovado', 'Cadastro aprovado', 'atendimento', 'diarista', array['whatsapp', 'email', 'painel']::text[], '{"tipo":"evento","eventos":["diarista_aprovada"]}'::jsonb, '{"tipo":"imediato"}'::jsonb, '{}'::jsonb, array[]::text[], 'diarista', null, false, null, true);
insert into public.automacao_regras (codigo, template_codigo, descricao, categoria, destinatario, canais_ordem, gatilho, atraso, condicoes, cancelamento, entidade, marco, do_dia, validade_min, ligada) values ('D03', 'cadastro_reprovado', 'Cadastro reprovado (sem expor o motivo interno)', 'atendimento', 'diarista', array['whatsapp', 'email', 'painel']::text[], '{"tipo":"evento","eventos":["diarista_reprovada"]}'::jsonb, '{"tipo":"imediato"}'::jsonb, '{}'::jsonb, array[]::text[], 'diarista', null, false, null, true);
insert into public.automacao_regras (codigo, template_codigo, descricao, categoria, destinatario, canais_ordem, gatilho, atraso, condicoes, cancelamento, entidade, marco, do_dia, validade_min, ligada) values ('D04', 'diaria_designada', 'Diária designada, com endereço completo (só com o atendimento confirmado)', 'atendimento', 'diarista', array['whatsapp', 'email', 'painel']::text[], '{"tipo":"evento","eventos":["atendimento_atribuido","pagamento_confirmado"]}'::jsonb, '{"tipo":"imediato"}'::jsonb, '{"atendimentoStatus":["confirmado"],"mesmaProfissional":true}'::jsonb, array['atendimento_cancelado', 'pedido_cancelado']::text[], 'atendimento', 'designacao', false, null, true);
insert into public.automacao_regras (codigo, template_codigo, descricao, categoria, destinatario, canais_ordem, gatilho, atraso, condicoes, cancelamento, entidade, marco, do_dia, validade_min, ligada) values ('D05', 'lembrete_vespera_profissional', 'Lembrete da véspera (profissional), 17h', 'lembrete', 'diarista', array['whatsapp', 'email', 'painel']::text[], '{"tipo":"agenda"}'::jsonb, '{"tipo":"vespera","hora":"17:00"}'::jsonb, '{"atendimentoStatus":["confirmado"],"mesmaData":true,"mesmaProfissional":true}'::jsonb, array['atendimento_cancelado', 'pedido_cancelado', 'atendimento_reagendado']::text[], 'atendimento', null, false, null, true);
insert into public.automacao_regras (codigo, template_codigo, descricao, categoria, destinatario, canais_ordem, gatilho, atraso, condicoes, cancelamento, entidade, marco, do_dia, validade_min, ligada) values ('D06', 'lembrete_checkin', 'Sem check-in 30 minutos depois do início do turno', 'atendimento', 'diarista', array['whatsapp', 'email', 'painel']::text[], '{"tipo":"agenda"}'::jsonb, '{"tipo":"apos_inicio_turno","minutos":30}'::jsonb, '{"atendimentoStatus":["confirmado"],"mesmaData":true,"mesmaProfissional":true}'::jsonb, array[]::text[], 'atendimento', null, true, null, true);
insert into public.automacao_regras (codigo, template_codigo, descricao, categoria, destinatario, canais_ordem, gatilho, atraso, condicoes, cancelamento, entidade, marco, do_dia, validade_min, ligada) values ('D07', 'documento_vencendo', 'Documento vencendo em 15 e 3 dias (validade do bloco 3, P5)', 'lembrete', 'diarista', array['whatsapp', 'email', 'painel']::text[], '{"tipo":"agenda"}'::jsonb, '{"tipo":"antes_vencimento_documento","dias":[15,3],"hora":"09:00"}'::jsonb, '{}'::jsonb, array[]::text[], 'documento', null, false, null, true);
insert into public.automacao_regras (codigo, template_codigo, descricao, categoria, destinatario, canais_ordem, gatilho, atraso, condicoes, cancelamento, entidade, marco, do_dia, validade_min, ligada) values ('D08', 'diaria_cancelada_ou_remarcada', 'Diária cancelada, remarcada ou trocada de profissional', 'atendimento', 'diaristas_afetadas', array['whatsapp', 'email', 'painel']::text[], '{"tipo":"evento","eventos":["atendimento_cancelado","atendimento_reagendado","pedido_cancelado","atendimento_atribuido"]}'::jsonb, '{"tipo":"imediato"}'::jsonb, '{}'::jsonb, array[]::text[], 'atendimento', null, false, null, true);
insert into public.automacao_regras (codigo, template_codigo, descricao, categoria, destinatario, canais_ordem, gatilho, atraso, condicoes, cancelamento, entidade, marco, do_dia, validade_min, ligada) values ('I01', 'nova_solicitacao', 'Nova solicitação', 'interno', 'equipe_prime', array['painel']::text[], '{"tipo":"evento","eventos":["pedido_criado"]}'::jsonb, '{"tipo":"imediato"}'::jsonb, '{}'::jsonb, array[]::text[], 'pedido', null, false, null, true);
insert into public.automacao_regras (codigo, template_codigo, descricao, categoria, destinatario, canais_ordem, gatilho, atraso, condicoes, cancelamento, entidade, marco, do_dia, validade_min, ligada) values ('I02', 'pagamento_informado', 'Cliente avisou que pagou: conferir', 'interno', 'equipe_prime', array['painel']::text[], '{"tipo":"evento","eventos":["pagamento_informado"]}'::jsonb, '{"tipo":"imediato"}'::jsonb, '{}'::jsonb, array[]::text[], 'pagamento', null, false, null, true);
insert into public.automacao_regras (codigo, template_codigo, descricao, categoria, destinatario, canais_ordem, gatilho, atraso, condicoes, cancelamento, entidade, marco, do_dia, validade_min, ligada) values ('I03', 'checkin_atrasado', 'Check-in atrasado (30 minutos depois do início)', 'interno', 'equipe_prime', array['painel']::text[], '{"tipo":"agenda"}'::jsonb, '{"tipo":"apos_inicio_turno","minutos":30}'::jsonb, '{"atendimentoStatus":["confirmado"],"mesmaData":true}'::jsonb, array[]::text[], 'atendimento', null, false, null, true);
insert into public.automacao_regras (codigo, template_codigo, descricao, categoria, destinatario, canais_ordem, gatilho, atraso, condicoes, cancelamento, entidade, marco, do_dia, validade_min, ligada) values ('I04', 'pagamento_vencido', 'Prazo de pagamento vencido: liberar vaga ou dar prazo', 'interno', 'equipe_prime', array['painel']::text[], '{"tipo":"agenda"}'::jsonb, '{"tipo":"prazo_vencido"}'::jsonb, '{"pagamentoStatus":["pendente"],"mesmoPrazo":true}'::jsonb, array['pagamento_confirmado', 'pedido_cancelado']::text[], 'pagamento', null, false, null, true);
insert into public.automacao_regras (codigo, template_codigo, descricao, categoria, destinatario, canais_ordem, gatilho, atraso, condicoes, cancelamento, entidade, marco, do_dia, validade_min, ligada) values ('I05', 'ocorrencia_aberta', 'Ocorrência aberta pela cliente (evento do bloco 3, P4)', 'interno', 'equipe_prime', array['painel']::text[], '{"tipo":"evento","eventos":["ocorrencia_aberta"]}'::jsonb, '{"tipo":"imediato"}'::jsonb, '{}'::jsonb, array[]::text[], 'atendimento', null, false, null, true);
insert into public.automacao_regras (codigo, template_codigo, descricao, categoria, destinatario, canais_ordem, gatilho, atraso, condicoes, cancelamento, entidade, marco, do_dia, validade_min, ligada) values ('I06', 'resumo_diario', 'Resumo do dia, 7h', 'interno', 'equipe_prime', array['painel']::text[], '{"tipo":"agenda"}'::jsonb, '{"tipo":"diario","hora":"07:00"}'::jsonb, '{}'::jsonb, array[]::text[], 'dia', null, false, null, true);
insert into public.automacao_regras (codigo, template_codigo, descricao, categoria, destinatario, canais_ordem, gatilho, atraso, condicoes, cancelamento, entidade, marco, do_dia, validade_min, ligada) values ('I07', 'resumo_semanal', 'Resumo da semana, segunda 8h', 'interno', 'equipe_prime', array['painel']::text[], '{"tipo":"agenda"}'::jsonb, '{"tipo":"semanal","diaSemana":1,"hora":"08:00"}'::jsonb, '{}'::jsonb, array[]::text[], 'dia', null, false, null, true);
insert into public.automacao_regras (codigo, template_codigo, descricao, categoria, destinatario, canais_ordem, gatilho, atraso, condicoes, cancelamento, entidade, marco, do_dia, validade_min, ligada) values ('I08', 'falha_envio', 'Envio que falhou de vez', 'interno', 'equipe_prime', array['painel']::text[], '{"tipo":"evento","eventos":["envio_falhou"]}'::jsonb, '{"tipo":"imediato"}'::jsonb, '{}'::jsonb, array[]::text[], 'execucao', null, false, null, true);
insert into public.automacao_regras (codigo, template_codigo, descricao, categoria, destinatario, canais_ordem, gatilho, atraso, condicoes, cancelamento, entidade, marco, do_dia, validade_min, ligada) values ('I09', 'mensagem_recebida', 'Mensagem recebida no WhatsApp da Prime (responder pela equipe)', 'interno', 'equipe_prime', array['painel']::text[], '{"tipo":"evento","eventos":["mensagem_recebida"]}'::jsonb, '{"tipo":"imediato"}'::jsonb, '{}'::jsonb, array[]::text[], 'conversa', null, false, null, true);
