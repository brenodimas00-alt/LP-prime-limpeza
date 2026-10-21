-- Painel v2, B3 (spec-painel-v2, seção 2): o Início ligado a dados reais e os estados novos. Tudo aditivo: nenhuma regra de
-- negócio existente muda; leitura e escrita só pela equipe Prime (configuração: só administração), por RPC.
-- Estados novos:
--  - escalas: escala do dia (Em preparação / Revisada / Publicada), com histórico, publicação idempotente por versão
--    (republicar só depois de mudança) e reabertura com motivo. Publicar dispara D09 pra cada profissional escalada.
--  - standby_decisoes: stand-by é profissional aprovada que trabalha nesse dia da semana, sem diária e sem bloqueio no dia;
--    "Liberar" registra a dispensa; "Confirmar" registra a prontidão (designar numa diária usa atribuir_diarista).
--  - solicitacoes_profissional: adiantamento e reembolso de transporte (Uber), pendente/aprovada/recusada com motivo.
--  - diaristas.habilidades; motivos padronizados editáveis (privado.motivos_padrao passa a ler a tabela); meta mensal.
--  - propor_nova_data (C18), recusar_informe_pagamento (C19), aprovar_endereco_pacote.
-- Leitura (um RPC por bloco, cada bloco carrega sozinho): painel_solicitacoes_novas, painel_diarias, painel_pendencias,
-- painel_standby, painel_alertas, painel_indicadores_home; painel_resumo passa a contar as pendências completas.

-- ---------------------------------------------------------------- tabelas
create table public.escalas (
  data date primary key,
  estado text not null default 'em_preparacao' check (estado in ('em_preparacao', 'revisada', 'publicada')),
  versao int not null default 0,
  revisada_em timestamptz, revisada_por uuid,
  publicada_em timestamptz, publicada_por uuid,
  historico jsonb not null default '[]',
  atualizado_em timestamptz not null default now()
);
create table public.standby_decisoes (
  diarista_id uuid not null references public.diaristas (id),
  data date not null,
  estado text not null check (estado in ('confirmada', 'liberada')),
  motivo text,
  decidido_por uuid,
  em timestamptz not null default now(),
  primary key (diarista_id, data)
);
create table public.solicitacoes_profissional (
  id uuid primary key default gen_random_uuid(),
  diarista_id uuid not null references public.diaristas (id),
  atendimento_id uuid references public.atendimentos (id),
  tipo text not null check (tipo in ('adiantamento', 'reembolso_transporte')),
  valor_centavos bigint not null check (valor_centavos > 0 and valor_centavos <= 500000),
  descricao text not null default '' check (char_length(descricao) <= 280),
  estado text not null default 'pendente' check (estado in ('pendente', 'aprovada', 'recusada')),
  motivo text check (char_length(motivo) <= 280),
  criado_por uuid, criado_em timestamptz not null default now(),
  decidido_por uuid, decidido_em timestamptz,
  ficticio boolean not null default false
);
create index solicitacoes_profissional_pendentes on public.solicitacoes_profissional (estado) where estado = 'pendente';
create table public.motivos (
  tipo text not null check (tipo in ('recusa', 'cancelamento')),
  codigo text not null check (codigo ~ '^[a-z0-9_]{3,40}$'),
  rotulo text not null check (char_length(rotulo) between 3 and 80),
  ativo boolean not null default true,
  ordem int not null default 0,
  atualizado_em timestamptz not null default now(),
  primary key (tipo, codigo)
);
insert into public.motivos (tipo, codigo, rotulo, ordem)
select k, x ->> 'codigo', x ->> 'rotulo', o::int from jsonb_each(privado.motivos_padrao()) j(k, v), jsonb_array_elements(j.v) with ordinality t(x, o);
alter table public.diaristas add column habilidades text[] not null default '{}'
  check (habilidades <@ array['residencial', 'empresarial', 'passadoria', 'pre_pos_mudanca', 'pre_pos_evento', 'pos_obra']);
alter table public.pedidos add column proposta_data jsonb;
alter table public.pagamentos add column conferencia jsonb;
alter table public.configuracao drop constraint configuracao_chave_check;
alter table public.configuracao add constraint configuracao_chave_check check (chave in ('pix', 'contato', 'auth', 'documentos', 'regioes_diarista', 'repasse', 'agendamento', 'meta_diarias'));
insert into public.configuracao (chave, valor) values ('meta_diarias', '{"percentual": 10}') on conflict (chave) do nothing;

do $$ declare t text; begin
  foreach t in array array['escalas', 'standby_decisoes', 'solicitacoes_profissional', 'motivos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

/** A lista (ativos) agora vem da tabela; "outro" sempre existe e fica por último. */
create or replace function privado.motivos_padrao() returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'recusa', coalesce((select jsonb_agg(jsonb_build_object('codigo', codigo, 'rotulo', rotulo) order by codigo = 'outro', ordem, rotulo) from public.motivos where tipo = 'recusa' and (ativo or codigo = 'outro')), '[]'),
    'cancelamento', coalesce((select jsonb_agg(jsonb_build_object('codigo', codigo, 'rotulo', rotulo) order by codigo = 'outro', ordem, rotulo) from public.motivos where tipo = 'cancelamento' and (ativo or codigo = 'outro')), '[]'))
$$;

-- ---------------------------------------------------------------- auxiliares
create or replace function privado.p_endereco(a public.atendimentos, p public.pedidos, c public.clientes) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(case when jsonb_typeof(a.endereco) = 'object' then a.endereco end, case when jsonb_typeof(p.endereco) = 'object' then p.endereco end, c.endereco, '{}')
$$;
create or replace function privado.p_ambientes(car jsonb) returns int
language sql immutable set search_path = '' as $$
  select coalesce((car ->> 'ambientesTotal')::int,
    (select sum(case when value ~ '^\d+$' then value::int else 0 end)::int from jsonb_each_text(case when jsonb_typeof(car -> 'ambientes') = 'object' then car -> 'ambientes' else '{}' end)))
$$;
create or replace function privado.p_nome_usuario(u uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(nullif(x.raw_user_meta_data ->> 'nome', ''), split_part(x.email, '@', 1)) from auth.users x where x.id = u
$$;
revoke all on function privado.p_nome_usuario(uuid) from public;

/** Situação do pagamento de uma diária pra primeira camada: pago (com a forma), a faturar ou pendente. */
create or replace function privado.p_pagamento_da_diaria(a public.atendimentos) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from public.pagamentos g where g.pedido_id = a.pedido_id and g.parcela = 'faturamento' and g.status <> 'cancelado') then jsonb_build_object('estado', 'a_faturar')
    when privado.diaria_paga(a) then jsonb_build_object('estado', 'pago', 'forma', coalesce((select case when g.metodo ilike '%cart%' then 'cartao' else 'pix' end from public.pagamentos g
                                     where g.pedido_id = a.pedido_id and g.status = 'confirmado' order by g.confirmado_em desc nulls last limit 1), 'pix'))
    else jsonb_build_object('estado', 'pendente', 'forma', 'pix') end
$$;
revoke all on function privado.p_pagamento_da_diaria(public.atendimentos) from public;

-- ---------------------------------------------------------------- leitura: solicitações novas
create or replace function public.painel_solicitacoes_novas(p_limite int default 20) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator(); v_lim int := least(greatest(coalesce(p_limite, 20), 1), 100);
begin
  perform privado.exigir_prime(s);
  return (select jsonb_build_object('total', (select count(*) from public.pedidos where status = 'solicitado'), 'itens', coalesce(jsonb_agg(x order by x ->> 'primeiraData', x ->> 'horaInicio'), '[]'))
    from (select jsonb_build_object('pedidoId', p.id, 'numero', p.numero_solicitacao, 'criadoEm', p.criado_em, 'modalidade', p.modalidade,
        'cliente', jsonb_build_object('id', c.id, 'nome', c.nome, 'telefone', c.telefone, 'tipo', c.tipo),
        'local', jsonb_build_object('bairro', e ->> 'bairro', 'cidade', e ->> 'cidade'),
        'servico', coalesce(a.servico, p.pacote ->> 'tipoServico'), 'quantidade', (select count(*) from public.atendimentos x where x.pedido_id = p.id and x.status <> 'cancelado'),
        'primeiraData', a.data, 'horaInicio', to_char(a.hora_inicio, 'HH24:MI'), 'horas', round(coalesce(a.duracao_minutos, (p.pacote ->> 'duracaoHoras')::int * 60) / 60.0, 1),
        'imovel', jsonb_build_object('metragem', coalesce((a.caracteristicas ->> 'metragem')::numeric, (p.pacote ->> 'metragem')::numeric), 'ambientes', privado.p_ambientes(a.caracteristicas),
                                     'pecas', (a.caracteristicas ->> 'pecas')::int, 'animais', coalesce((a.caracteristicas #>> '{animais,tem}')::boolean, false), 'refeicao', a.local_refeicao),
        'valorCentavos', p.total_centavos, 'origem', p.origem_cliente, 'enderecoNovoPacote', p.pacote_endereco_novo, 'proposta', p.proposta_data) x
      from (select * from public.pedidos where status = 'solicitado' order by criado_em limit v_lim) p
      join public.clientes c on c.id = p.cliente_id
      left join lateral (select * from public.atendimentos x where x.pedido_id = p.id and x.status <> 'cancelado' order by x.data, x.hora_inicio nulls last limit 1) a on true
      cross join lateral (select privado.p_endereco(a, p, c) e) en) y);
end $$;

-- ---------------------------------------------------------------- leitura: diárias do dia (hoje / amanhã) + escala
create or replace function public.painel_diarias(p_data date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator(); esc public.escalas; itens jsonb;
begin
  perform privado.exigir_prime(s);
  if p_data is null then perform privado.erro('DADOS_INVALIDOS', 'Informe a data'); end if;
  select * into esc from public.escalas where data = p_data;
  select coalesce(jsonb_agg(x order by x ->> 'horaInicio', x ->> 'id'), '[]') into itens
    from (select jsonb_build_object('id', a.id, 'pedidoId', p.id, 'numero', p.numero_solicitacao, 'horaInicio', to_char(a.hora_inicio, 'HH24:MI'), 'duracaoMinutos', a.duracao_minutos,
        'status', a.status, 'servico', coalesce(a.servico, p.pacote ->> 'tipoServico'), 'modalidade', p.modalidade,
        'cliente', jsonb_build_object('id', c.id, 'nome', c.nome, 'telefone', c.telefone),
        'local', jsonb_build_object('logradouro', e ->> 'logradouro', 'numero', e ->> 'numero', 'complemento', e ->> 'complemento', 'bairro', e ->> 'bairro', 'cidade', e ->> 'cidade',
                                    'pontoReferencia', coalesce(e ->> 'pontoReferencia', e ->> 'ponto_referencia'), 'tipoImovel', coalesce(e ->> 'tipoImovel', e ->> 'tipo_imovel')),
        'profissional', case when d.id is not null then jsonb_build_object('id', d.id, 'nome', d.nome, 'telefone', d.telefone, 'habilidades', to_jsonb(d.habilidades)) end,
        'pagamento', privado.p_pagamento_da_diaria(a), 'nota', (select v.nota_final from public.avaliacoes v where v.atendimento_id = a.id),
        'caracteristicas', a.caracteristicas, 'localRefeicao', a.local_refeicao, 'justificativa', a.justificativa,
        'observacao', p.observacao_disponibilidade, 'historico', a.historico) x
      from public.atendimentos a join public.pedidos p on p.id = a.pedido_id join public.clientes c on c.id = p.cliente_id
      left join public.diaristas d on d.id = a.diarista_id
      cross join lateral (select privado.p_endereco(a, p, c) e) en
     where a.data = p_data and a.status <> 'cancelado' and p.status not in ('solicitado', 'recusado', 'cancelado')) y;
  return jsonb_build_object('data', p_data, 'itens', itens,
    'confirmadas', (select count(*) from jsonb_array_elements(itens) i where i ->> 'status' <> 'agendado' and i -> 'profissional' <> 'null'::jsonb),
    'pendentes', (select count(*) from jsonb_array_elements(itens) i where i ->> 'status' = 'agendado' or i -> 'profissional' = 'null'::jsonb),
    'escala', jsonb_build_object('estado', coalesce(esc.estado, 'em_preparacao'), 'versao', coalesce(esc.versao, 0), 'publicadaEm', esc.publicada_em,
      'publicadaPor', privado.p_nome_usuario(esc.publicada_por), 'revisadaEm', esc.revisada_em,
      'alteradaDepois', esc.estado = 'publicada' and exists (select 1 from public.atendimentos a where a.data = p_data and a.atualizado_em > esc.publicada_em)));
end $$;

-- ---------------------------------------------------------------- leitura: precisa de você (prioridade e ação direta)
create or replace function privado.painel_pendencias_lista() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_hoje date := privado.hoje_sp(); v_agora timestamptz := now(); r jsonb := '[]';
begin
  -- diária sem profissional (pedido já confirmado): hoje/amanhã urgente, até 7 dias normal
  r := r || coalesce((select jsonb_agg(jsonb_build_object('id', 'sem:' || a.id, 'tipo', 'sem_profissional', 'categoria', 'escala', 'urgente', a.data <= v_hoje + 1,
      'titulo', 'Diária ' || case when a.data = v_hoje then 'de hoje' when a.data = v_hoje + 1 then 'de amanhã' else 'de ' || to_char(a.data, 'DD/MM') end || ' sem profissional',
      'sub', concat_ws(' · ', to_char(a.data, 'DD/MM') || coalesce(' · ' || to_char(a.hora_inicio, 'HH24:MI'), ''), coalesce(privado.p_endereco(a, p, c) ->> 'bairro', '')),
      'ref', jsonb_build_object('atendimentoId', a.id, 'pedidoId', p.id, 'data', a.data), 'em', a.data) order by a.data, a.hora_inicio)
    from public.atendimentos a join public.pedidos p on p.id = a.pedido_id join public.clientes c on c.id = p.cliente_id
   where a.diarista_id is null and a.status in ('agendado', 'confirmado') and p.status in ('aguardando_pagamento', 'confirmado') and a.data between v_hoje and v_hoje + 7), '[]');
  -- substituição: a profissional designada ficou impedida (férias, folga, outra diária no mesmo horário)
  r := r || coalesce((select jsonb_agg(jsonb_build_object('id', 'sub:' || a.id, 'tipo', 'substituicao', 'categoria', 'escala', 'urgente', a.data <= v_hoje + 1,
      'titulo', 'Substituir ' || split_part(d.nome, ' ', 1) || ' em ' || to_char(a.data, 'DD/MM'),
      'sub', (select string_agg(x ->> 'mensagem', '; ') from jsonb_array_elements(cf.c) x where (x ->> 'impede')::boolean),
      'ref', jsonb_build_object('atendimentoId', a.id, 'pedidoId', a.pedido_id, 'diaristaId', d.id, 'data', a.data), 'em', a.data) order by a.data)
    from public.atendimentos a join public.diaristas d on d.id = a.diarista_id
    cross join lateral (select privado.conflitos_diaria(d.id, a.id, a.data, a.hora_inicio, a.duracao_minutos, null) c) cf
   where a.status in ('agendado', 'confirmado') and a.data between v_hoje and v_hoje + 7
     and exists (select 1 from jsonb_array_elements(cf.c) x where (x ->> 'impede')::boolean)), '[]');
  -- pagamento informado pela cliente: conferir no extrato
  r := r || coalesce((select jsonb_agg(jsonb_build_object('id', 'pag:' || g.id, 'tipo', 'pagamento_informado', 'categoria', 'financeiro', 'urgente', g.informado_em < v_agora - interval '2 hours',
      'titulo', 'Conferir pagamento de ' || split_part(c.nome, ' ', 1),
      'sub', concat_ws(' · ', 'R$ ' || to_char(g.valor_centavos / 100.0, 'FM999G990D00'), 'informado ' || to_char(g.informado_em at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI')),
      'ref', jsonb_build_object('pagamentoId', g.id, 'pedidoId', p.id, 'valorCentavos', g.valor_centavos), 'em', g.informado_em) order by g.informado_em)
    from public.pagamentos g join public.pedidos p on p.id = g.pedido_id join public.clientes c on c.id = p.cliente_id where g.status = 'informado_pelo_cliente'), '[]');
  -- pagamento vencido sem informe: liberar a vaga ou dar prazo
  r := r || coalesce((select jsonb_agg(jsonb_build_object('id', 'venc:' || g.id, 'tipo', 'pagamento_vencido', 'categoria', 'financeiro', 'urgente', true,
      'titulo', 'Pagamento vencido de ' || split_part(c.nome, ' ', 1),
      'sub', concat_ws(' · ', 'R$ ' || to_char(g.valor_centavos / 100.0, 'FM999G990D00'), 'venceu ' || to_char(g.vence_em, 'DD/MM')),
      'ref', jsonb_build_object('pagamentoId', g.id, 'pedidoId', p.id), 'em', g.vence_em) order by g.vence_em)
    from public.pagamentos g join public.pedidos p on p.id = g.pedido_id join public.clientes c on c.id = p.cliente_id
   where g.status = 'pendente' and g.vence_em is not null and p.status not in ('cancelado', 'recusado')
     and (g.vence_em::timestamp + coalesce(g.vence_as, time '14:00')) at time zone 'America/Sao_Paulo' <= v_agora), '[]');
  -- adiantamento e reembolso (Uber)
  r := r || coalesce((select jsonb_agg(jsonb_build_object('id', 'sol:' || x.id, 'tipo', x.tipo, 'categoria', 'financeiro', 'urgente', false,
      'titulo', case x.tipo when 'adiantamento' then 'Aprovar adiantamento' else 'Uber / transporte' end,
      'sub', concat_ws(' · ', d.nome, 'R$ ' || to_char(x.valor_centavos / 100.0, 'FM999G990D00'), nullif(x.descricao, '')),
      'ref', jsonb_build_object('solicitacaoId', x.id, 'diaristaId', d.id, 'atendimentoId', x.atendimento_id), 'em', x.criado_em) order by x.criado_em)
    from public.solicitacoes_profissional x join public.diaristas d on d.id = x.diarista_id where x.estado = 'pendente'), '[]');
  -- hora extra registrada pela profissional
  r := r || coalesce((select jsonb_agg(jsonb_build_object('id', 'he:' || h.id, 'tipo', 'hora_extra', 'categoria', 'financeiro', 'urgente', false,
      'titulo', 'Hora extra pra aprovar', 'sub', concat_ws(' · ', split_part(d.nome, ' ', 1), h.horas || 'h', to_char(a.data, 'DD/MM')),
      'ref', jsonb_build_object('horaExtraId', h.id, 'atendimentoId', a.id), 'em', h.registrada_em) order by h.registrada_em)
    from public.horas_extras h join public.atendimentos a on a.id = h.atendimento_id left join public.diaristas d on d.id = a.diarista_id where h.status = 'registrada'), '[]');
  -- pacote com endereço novo (item 46 do v3)
  r := r || coalesce((select jsonb_agg(jsonb_build_object('id', 'end:' || p.id, 'tipo', 'pacote_endereco_novo', 'categoria', 'contratos', 'urgente', false,
      'titulo', 'Pacote com endereço novo', 'sub', concat_ws(' · ', c.nome, 'nº ' || lpad(p.numero_solicitacao::text, 6, '0')),
      'ref', jsonb_build_object('pedidoId', p.id), 'em', p.criado_em) order by p.criado_em)
    from public.pedidos p join public.clientes c on c.id = p.cliente_id where p.status = 'solicitado' and p.pacote_endereco_novo), '[]');
  -- cadastro de profissional pra analisar e documento vencido
  r := r || coalesce((select jsonb_agg(jsonb_build_object('id', 'cad:' || d.id, 'tipo', 'cadastro_profissional', 'categoria', 'contratos', 'urgente', false,
      'titulo', 'Cadastro de profissional pra analisar', 'sub', d.nome, 'ref', jsonb_build_object('diaristaId', d.id), 'em', d.atualizado_em) order by d.atualizado_em)
    from public.diaristas d where d.status = 'pendente'), '[]');
  r := r || coalesce((select jsonb_agg(jsonb_build_object('id', 'doc:' || x.id, 'tipo', 'documento_vencido', 'categoria', 'contratos', 'urgente', false,
      'titulo', 'Documento vencido', 'sub', concat_ws(' · ', d.nome, x.tipo, 'venceu ' || to_char(x.valido_ate, 'DD/MM')),
      'ref', jsonb_build_object('diaristaId', d.id, 'documentoId', x.id), 'em', x.valido_ate) order by x.valido_ate)
    from public.documentos x join public.diaristas d on d.id = x.diarista_id
   where x.excluido_em is null and x.valido_ate < v_hoje and d.status = 'aprovada'
     and not exists (select 1 from public.documentos y where y.diarista_id = x.diarista_id and y.tipo = x.tipo and y.excluido_em is null and y.criado_em > x.criado_em)), '[]');
  -- ocorrência aberta (parada há mais de 48 h: urgente)
  r := r || coalesce((select jsonb_agg(jsonb_build_object('id', 'oc:' || o.id, 'tipo', 'ocorrencia', 'categoria', 'ocorrencias', 'urgente', o.atualizado_em < v_agora - interval '48 hours',
      'titulo', 'Ocorrência ' || case when o.estado = 'aberto' then 'aberta' else 'em análise' end, 'sub', concat_ws(' · ', c.nome, left(o.descricao, 60)),
      'ref', jsonb_build_object('ocorrenciaId', o.id, 'atendimentoId', o.atendimento_id), 'em', o.criado_em) order by o.criado_em)
    from public.ocorrencias o join public.clientes c on c.id = o.cliente_id where o.estado in ('aberto', 'em_analise')), '[]');
  -- falha de automação (últimos 7 dias): reprocessar
  r := r || coalesce((select jsonb_agg(jsonb_build_object('id', 'aut:' || e.id, 'tipo', 'falha_automacao', 'categoria', 'automacoes', 'urgente', false,
      'titulo', 'Mensagem automática não saiu', 'sub', concat_ws(' · ', coalesce(rg.descricao, e.regra), left(coalesce(e.motivo, ''), 60)),
      'ref', jsonb_build_object('execucaoId', e.id), 'em', e.atualizado_em) order by e.atualizado_em desc)
    from public.automacao_execucoes e left join public.automacao_regras rg on rg.codigo = e.regra
   where e.estado = 'falhou' and not e.teste and e.atualizado_em > v_agora - interval '7 days'), '[]');
  return r;
end $$;
revoke all on function privado.painel_pendencias_lista() from public;

create or replace function public.painel_pendencias() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator(); l jsonb;
begin
  perform privado.exigir_prime(s);
  l := privado.painel_pendencias_lista();
  return jsonb_build_object('itens', (select coalesce(jsonb_agg(x order by (x ->> 'urgente')::boolean desc, x ->> 'em'), '[]') from jsonb_array_elements(l) x),
    'urgentes', (select count(*) from jsonb_array_elements(l) x where (x ->> 'urgente')::boolean));
end $$;

create or replace function public.painel_resumo() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator(); l jsonb;
begin
  perform privado.exigir_prime(s);
  l := privado.painel_pendencias_lista();
  return jsonb_build_object('solicitacoesNovas', (select count(*) from public.pedidos where status = 'solicitado'),
    'pendencias', jsonb_array_length(l), 'urgentes', (select count(*) from jsonb_array_elements(l) x where (x ->> 'urgente')::boolean));
end $$;

-- ---------------------------------------------------------------- leitura: stand-by do dia
create or replace function public.painel_standby(p_data date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator(); v_data date := coalesce(p_data, privado.hoje_sp());
begin
  perform privado.exigir_prime(s);
  return jsonb_build_object('data', v_data, 'itens', coalesce((select jsonb_agg(jsonb_build_object('diaristaId', d.id, 'nome', d.nome, 'telefone', d.telefone, 'habilidades', to_jsonb(d.habilidades),
      'turnos', d.disponibilidade -> 'turnos', 'regioes', d.disponibilidade -> 'regioes', 'estado', coalesce(sd.estado, 'standby')) order by sd.estado nulls first, d.nome)
    from public.diaristas d left join public.standby_decisoes sd on sd.diarista_id = d.id and sd.data = v_data
   where d.status = 'aprovada' and jsonb_typeof(d.disponibilidade -> 'dias') = 'array' and (d.disponibilidade -> 'dias') @> to_jsonb(extract(dow from v_data)::int)
     and not exists (select 1 from public.atendimentos a where a.diarista_id = d.id and a.data = v_data and a.status <> 'cancelado')
     and not exists (select 1 from public.bloqueios_profissional b where b.diarista_id = d.id and v_data between b.de and b.ate)
     and coalesce(sd.estado, '') <> 'liberada'), '[]'));
end $$;

-- ---------------------------------------------------------------- leitura: alertas específicos e progressivos
create or replace function public.painel_alertas() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator(); v_hoje date := privado.hoje_sp(); r jsonb := '[]'; n7 int;
begin
  perform privado.exigir_prime(s);
  -- pacote (2+ diárias) cuja última diária é amanhã: nome; mais de 2 vencendo em 7 dias: agrupado
  r := r || coalesce((select jsonb_agg(jsonb_build_object('tipo', 'pacote_vence', 'titulo', 'Pacote de ' || split_part(c.nome, ' ', 1) || ' vence amanhã',
      'sub', 'Última de ' || u.n || ' diárias: hora de oferecer a renovação', 'ref', jsonb_build_object('pedidoId', p.id, 'clienteId', c.id)))
    from public.pedidos p join public.clientes c on c.id = p.cliente_id
    cross join lateral (select max(a.data) ultima, count(*) n from public.atendimentos a where a.pedido_id = p.id and a.status <> 'cancelado') u
   where p.status = 'confirmado' and u.n >= 2 and u.ultima = v_hoje + 1), '[]');
  select count(*) into n7 from public.pedidos p cross join lateral (select max(a.data) ultima, count(*) n from public.atendimentos a where a.pedido_id = p.id and a.status <> 'cancelado') u
   where p.status = 'confirmado' and u.n >= 2 and u.ultima between v_hoje + 2 and v_hoje + 7;
  if n7 > 2 then r := r || jsonb_build_object('tipo', 'pacotes_semana', 'titulo', n7 || ' pacotes vencem nos próximos 7 dias', 'sub', 'Veja a lista de renovação', 'ref', '{}');
  elsif n7 > 0 then
    r := r || coalesce((select jsonb_agg(jsonb_build_object('tipo', 'pacote_vence', 'titulo', 'Pacote de ' || split_part(c.nome, ' ', 1) || ' vence em ' || to_char(u.ultima, 'DD/MM'),
        'sub', 'Última de ' || u.n || ' diárias', 'ref', jsonb_build_object('pedidoId', p.id, 'clienteId', c.id)))
      from public.pedidos p join public.clientes c on c.id = p.cliente_id
      cross join lateral (select max(a.data) ultima, count(*) n from public.atendimentos a where a.pedido_id = p.id and a.status <> 'cancelado') u
     where p.status = 'confirmado' and u.n >= 2 and u.ultima between v_hoje + 2 and v_hoje + 7), '[]');
  end if;
  -- documento de profissional vencendo em até 15 dias
  r := r || coalesce((select jsonb_agg(jsonb_build_object('tipo', 'documento_vence', 'titulo', 'Documento de ' || split_part(d.nome, ' ', 1) || ' vence ' ||
        case when x.valido_ate = v_hoje then 'hoje' when x.valido_ate = v_hoje + 1 then 'amanhã' else 'em ' || (x.valido_ate - v_hoje) || ' dias' end,
      'sub', x.tipo, 'ref', jsonb_build_object('diaristaId', d.id, 'documentoId', x.id)) order by x.valido_ate)
    from public.documentos x join public.diaristas d on d.id = x.diarista_id
   where x.excluido_em is null and d.status = 'aprovada' and x.valido_ate between v_hoje and v_hoje + 15
     and not exists (select 1 from public.documentos y where y.diarista_id = x.diarista_id and y.tipo = x.tipo and y.excluido_em is null and y.criado_em > x.criado_em)), '[]');
  -- avaliação baixa (nota final até 3) nos últimos 7 dias
  r := r || coalesce((select jsonb_agg(jsonb_build_object('tipo', 'avaliacao_baixa', 'titulo', 'Avaliação baixa recebida: ' || to_char(v.nota_final, 'FM0D0'),
      'sub', concat_ws(' · ', 'Cliente: ' || c.nome, 'nº ' || lpad(p.numero_solicitacao::text, 6, '0')), 'ref', jsonb_build_object('atendimentoId', a.id, 'pedidoId', p.id, 'clienteId', c.id)) order by v.criado_em desc)
    from public.avaliacoes v join public.atendimentos a on a.id = v.atendimento_id join public.pedidos p on p.id = a.pedido_id join public.clientes c on c.id = p.cliente_id
   where v.nota_final <= 3 and v.criado_em > now() - interval '7 days'), '[]');
  return jsonb_build_object('itens', r);
end $$;

-- ---------------------------------------------------------------- leitura: indicadores da Home
create or replace function public.painel_indicadores_home(p_mes text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator(); v_hoje date := privado.hoje_sp(); ini date; fim date; ant_ini date; pct numeric; ant int; real int; agend int; meta int;
begin
  perform privado.exigir_prime(s);
  ini := case when p_mes ~ '^\d{4}-\d{2}$' then (p_mes || '-01')::date else date_trunc('month', v_hoje)::date end;
  fim := (ini + interval '1 month')::date - 1; ant_ini := (ini - interval '1 month')::date;
  pct := coalesce((select (valor ->> 'percentual')::numeric from public.configuracao where chave = 'meta_diarias'), 10);
  select count(*) into ant from public.atendimentos where status in ('finalizado', 'avaliado') and data between ant_ini and ini - 1;
  select count(*) into real from public.atendimentos where status in ('finalizado', 'avaliado') and data between ini and fim;
  select count(*) into agend from public.atendimentos a join public.pedidos p on p.id = a.pedido_id
   where a.status in ('agendado', 'confirmado', 'diarista_a_caminho', 'em_andamento') and a.data between greatest(ini, v_hoje) and fim and p.status in ('aguardando_pagamento', 'confirmado');
  meta := ceil(ant * (1 + pct / 100.0));
  return jsonb_build_object('mes', to_char(ini, 'YYYY-MM'),
    'meta', jsonb_build_object('percentual', pct, 'mesAnterior', ant, 'meta', meta, 'realizadas', real, 'agendadas', agend, 'faltam', greatest(meta - real - agend, 0)),
    'cancelamentos', (select coalesce(jsonb_agg(jsonb_build_object('codigo', k, 'rotulo', coalesce(m.rotulo, case when k = 'sem_motivo' then 'Sem motivo registrado' else k end), 'total', n) order by n desc, k), '[]')
      from (select coalesce(p.cancelamento ->> 'codigo', 'sem_motivo') k, count(*) n
              from public.atendimentos a join public.pedidos p on p.id = a.pedido_id
             where a.status = 'cancelado' and a.data between ini and fim group by 1) t
      left join public.motivos m on m.tipo = 'cancelamento' and m.codigo = t.k),
    'regioes', (select coalesce(jsonb_agg(jsonb_build_object('cidade', cidade, 'total', n, 'bairros', b) order by n desc, cidade), '[]')
      from (select coalesce(nullif(e ->> 'cidade', ''), 'Sem cidade') cidade, count(*) n,
                   jsonb_agg(coalesce(nullif(e ->> 'bairro', ''), 'Sem bairro')) bs
              from public.atendimentos a join public.pedidos p on p.id = a.pedido_id join public.clientes c on c.id = p.cliente_id
              cross join lateral (select privado.p_endereco(a, p, c) e) en
             where a.data between ini and fim and a.status <> 'cancelado' and p.status in ('aguardando_pagamento', 'confirmado', 'concluido')
             group by 1) t
      cross join lateral (select coalesce(jsonb_agg(jsonb_build_object('bairro', bairro, 'total', q) order by q desc, bairro), '[]') b
                            from (select x #>> '{}' bairro, count(*) q from jsonb_array_elements(t.bs) x group by 1) z) bb));
end $$;

-- ---------------------------------------------------------------- escrita: escala
create or replace function public.marcar_escala(p_data date, p_acao text, p_motivo text, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; esc public.escalas; mot text := left(regexp_replace(trim(coalesce(p_motivo, '')), '\s+', ' ', 'g'), 280);
        conteudo jsonb := jsonb_build_object('data', p_data, 'acao', p_acao, 'motivo', mot); a record; n int := 0;
begin
  perform privado.exigir_prime(s);
  if p_data is null or p_acao not in ('revisar', 'publicar', 'reabrir') then perform privado.erro('DADOS_INVALIDOS', 'Ação de escala inválida'); end if;
  r := privado.idem_ler('marcarEscala', s, p_chave, conteudo);
  if r is not null then return r; end if;
  if p_data < privado.hoje_sp() then perform privado.erro('DATA_INVALIDA', 'A escala de um dia que já passou não muda'); end if;
  insert into public.escalas (data) values (p_data) on conflict (data) do nothing;
  select * into esc from public.escalas where data = p_data for update;
  if p_acao = 'reabrir' then
    if char_length(mot) < 3 then perform privado.erro('DADOS_INVALIDOS', 'Escreva o motivo da reabertura'); end if;
    if esc.estado = 'em_preparacao' then perform privado.erro('TRANSICAO_PROIBIDA', 'A escala já está em preparação'); end if;
    update public.escalas set estado = 'em_preparacao', atualizado_em = now(),
      historico = historico || jsonb_build_object('de', esc.estado, 'para', 'em_preparacao', 'em', privado.agora_iso(), 'por', auth.uid(), 'motivo', mot) where data = p_data returning * into esc;
  elsif p_acao = 'revisar' then
    if esc.estado <> 'em_preparacao' then perform privado.erro('TRANSICAO_PROIBIDA', 'Só uma escala em preparação vira revisada'); end if;
    update public.escalas set estado = 'revisada', revisada_em = now(), revisada_por = auth.uid(), atualizado_em = now(),
      historico = historico || jsonb_build_object('de', esc.estado, 'para', 'revisada', 'em', privado.agora_iso(), 'por', auth.uid()) where data = p_data returning * into esc;
  else
    -- publicar de novo só se algo mudou depois da última publicação (senão é o mesmo resultado)
    if esc.estado = 'publicada' and not exists (select 1 from public.atendimentos x where x.data = p_data and x.atualizado_em > esc.publicada_em) then
      perform privado.erro('TRANSICAO_PROIBIDA', 'A escala já está publicada e nada mudou desde então');
    end if;
    if exists (select 1 from public.atendimentos x join public.pedidos p on p.id = x.pedido_id where x.data = p_data and x.diarista_id is null
                and x.status in ('agendado', 'confirmado') and p.status in ('aguardando_pagamento', 'confirmado')) then
      perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Ainda há diária sem profissional nesse dia. Designe antes de publicar.');
    end if;
    update public.escalas set estado = 'publicada', versao = versao + 1, publicada_em = now(), publicada_por = auth.uid(), atualizado_em = now(),
      historico = historico || jsonb_build_object('de', esc.estado, 'para', 'publicada', 'em', privado.agora_iso(), 'por', auth.uid(), 'versao', esc.versao + 1) where data = p_data returning * into esc;
    for a in select x.id, x.pedido_id, x.diarista_id from public.atendimentos x join public.pedidos p on p.id = x.pedido_id
              where x.data = p_data and x.diarista_id is not null and x.status in ('confirmado', 'agendado') and p.status in ('aguardando_pagamento', 'confirmado') loop
      perform privado.evento('escala_publicada', jsonb_build_object('atendimentoId', a.id, 'pedidoId', a.pedido_id, 'diaristaId', a.diarista_id), jsonb_build_object('data', p_data, 'versao', esc.versao));
      n := n + 1;
    end loop;
  end if;
  r := jsonb_build_object('escala', jsonb_build_object('data', esc.data, 'estado', esc.estado, 'versao', esc.versao, 'publicadaEm', esc.publicada_em, 'publicadaPor', privado.p_nome_usuario(esc.publicada_por)), 'avisadas', n);
  perform privado.idem_gravar('marcarEscala', s, p_chave, conteudo, r);
  return r;
end $$;

-- ---------------------------------------------------------------- escrita: stand-by
create or replace function public.decidir_standby(p_diarista uuid, p_data date, p_decisao text, p_motivo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); sd public.standby_decisoes;
begin
  perform privado.exigir_prime(s);
  if p_decisao not in ('confirmada', 'liberada') or p_data is null then perform privado.erro('DADOS_INVALIDOS', 'Decisão inválida'); end if;
  if not exists (select 1 from public.diaristas where id = p_diarista and status = 'aprovada') then perform privado.erro('NAO_ENCONTRADO', 'Profissional não encontrada'); end if;
  insert into public.standby_decisoes (diarista_id, data, estado, motivo, decidido_por) values (p_diarista, p_data, p_decisao, nullif(left(trim(coalesce(p_motivo, '')), 280), ''), auth.uid())
  on conflict (diarista_id, data) do update set estado = excluded.estado, motivo = excluded.motivo, decidido_por = excluded.decidido_por, em = now()
  returning * into sd;
  return jsonb_build_object('diaristaId', sd.diarista_id, 'data', sd.data, 'estado', sd.estado);
end $$;

-- ---------------------------------------------------------------- escrita: adiantamento e reembolso
create or replace function public.registrar_solicitacao_profissional(p_dados jsonb, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; x public.solicitacoes_profissional; v_dia uuid; v_at uuid; v_valor bigint;
begin
  if s ->> 'ator' not in ('prime', 'diarista') then perform privado.erro('ATOR_SEM_PERMISSAO', 'Sem permissão'); end if;
  r := privado.idem_ler('registrarSolicitacaoProfissional', s, p_chave, p_dados);
  if r is not null then return r; end if;
  v_dia := case when s ->> 'ator' = 'diarista' then (s ->> 'id')::uuid else (p_dados ->> 'diaristaId')::uuid end;
  if not exists (select 1 from public.diaristas where id = v_dia and status = 'aprovada') then perform privado.erro('NAO_ENCONTRADO', 'Profissional não encontrada'); end if;
  v_at := nullif(p_dados ->> 'atendimentoId', '')::uuid;
  if v_at is not null and not exists (select 1 from public.atendimentos where id = v_at and diarista_id = v_dia) then perform privado.erro('DADOS_INVALIDOS', 'Diária de outra profissional'); end if;
  begin v_valor := (p_dados ->> 'valorCentavos')::bigint; exception when others then v_valor := null; end;
  if p_dados ->> 'tipo' not in ('adiantamento', 'reembolso_transporte') or v_valor is null or v_valor <= 0 or v_valor > 500000 then
    perform privado.erro('DADOS_INVALIDOS', 'Informe o tipo e um valor entre R$ 0,01 e R$ 5.000,00'); end if;
  insert into public.solicitacoes_profissional (diarista_id, atendimento_id, tipo, valor_centavos, descricao, criado_por, ficticio)
  values (v_dia, v_at, p_dados ->> 'tipo', v_valor, left(trim(coalesce(p_dados ->> 'descricao', '')), 280), auth.uid(), coalesce((select ficticio from public.diaristas where id = v_dia), false))
  returning * into x;
  r := jsonb_build_object('id', x.id, 'estado', x.estado);
  perform privado.idem_gravar('registrarSolicitacaoProfissional', s, p_chave, p_dados, r);
  return r;
end $$;

create or replace function public.decidir_solicitacao_profissional(p_id uuid, p_decisao text, p_motivo text, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; x public.solicitacoes_profissional; mot text := left(regexp_replace(trim(coalesce(p_motivo, '')), '\s+', ' ', 'g'), 280);
        conteudo jsonb := jsonb_build_object('id', p_id, 'decisao', p_decisao, 'motivo', mot);
begin
  perform privado.exigir_prime(s);
  r := privado.idem_ler('decidirSolicitacaoProfissional', s, p_chave, conteudo);
  if r is not null then return r; end if;
  if p_decisao not in ('aprovada', 'recusada') then perform privado.erro('DADOS_INVALIDOS', 'Decisão inválida'); end if;
  if p_decisao = 'recusada' and char_length(mot) < 3 then perform privado.erro('DADOS_INVALIDOS', 'Escreva o motivo da recusa'); end if;
  select * into x from public.solicitacoes_profissional where id = p_id for update;
  if not found then perform privado.erro('NAO_ENCONTRADO', 'Pedido não encontrado'); end if;
  if x.estado <> 'pendente' then perform privado.erro('TRANSICAO_PROIBIDA', 'Este pedido já foi decidido'); end if;
  update public.solicitacoes_profissional set estado = p_decisao, motivo = nullif(mot, ''), decidido_por = auth.uid(), decidido_em = now() where id = p_id returning * into x;
  insert into public.auditoria (tabela, registro_id, operacao, ator_user_id, ator_papel, ator_contexto, depois)
  values ('solicitacoes_profissional', p_id, 'UPDATE', auth.uid(), privado.papel(), 'prime', jsonb_build_object('estado', x.estado, 'motivo', x.motivo));
  r := jsonb_build_object('id', x.id, 'estado', x.estado);
  perform privado.idem_gravar('decidirSolicitacaoProfissional', s, p_chave, conteudo, r);
  return r;
end $$;

create or replace function public.listar_solicitacoes_profissional(p_filtro jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator(); v_estado text := nullif(p_filtro ->> 'estado', '');
begin
  perform privado.exigir_prime(s);
  return jsonb_build_object('itens', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'tipo', x.tipo, 'valorCentavos', x.valor_centavos, 'descricao', x.descricao, 'estado', x.estado,
      'motivo', x.motivo, 'criadoEm', x.criado_em, 'decididoEm', x.decidido_em, 'profissional', jsonb_build_object('id', d.id, 'nome', d.nome), 'atendimentoId', x.atendimento_id) order by x.criado_em desc)
    from public.solicitacoes_profissional x join public.diaristas d on d.id = x.diarista_id where v_estado is null or x.estado = v_estado limit 200), '[]'));
end $$;

-- ---------------------------------------------------------------- escrita: habilidades, motivos, meta
create or replace function public.salvar_habilidades(p_diarista uuid, p_habilidades text[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); d public.diaristas;
begin
  perform privado.exigir_prime(s);
  if not coalesce(p_habilidades, '{}') <@ array['residencial', 'empresarial', 'passadoria', 'pre_pos_mudanca', 'pre_pos_evento', 'pos_obra'] then perform privado.erro('DADOS_INVALIDOS', 'Habilidade desconhecida'); end if;
  update public.diaristas set habilidades = (select coalesce(array_agg(distinct h order by h), '{}') from unnest(coalesce(p_habilidades, '{}')) h) where id = p_diarista returning * into d;
  if not found then perform privado.erro('NAO_ENCONTRADO', 'Profissional não encontrada'); end if;
  return jsonb_build_object('id', d.id, 'habilidades', to_jsonb(d.habilidades));
end $$;

create or replace function public.listar_motivos() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator();
begin
  perform privado.exigir_prime(s);
  return jsonb_build_object('itens', coalesce((select jsonb_agg(jsonb_build_object('tipo', tipo, 'codigo', codigo, 'rotulo', rotulo, 'ativo', ativo, 'ordem', ordem) order by tipo, codigo = 'outro', ordem, rotulo) from public.motivos), '[]'));
end $$;

create or replace function public.salvar_motivo(p_dados jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); m public.motivos; v_rot text := left(regexp_replace(trim(coalesce(p_dados ->> 'rotulo', '')), '\s+', ' ', 'g'), 80); v_cod text;
begin
  perform privado.exigir_admin(s);
  if p_dados ->> 'tipo' not in ('recusa', 'cancelamento') or char_length(v_rot) < 3 then perform privado.erro('DADOS_INVALIDOS', 'Escolha o tipo e escreva o motivo (3 letras ou mais)'); end if;
  if v_rot ~ ':' then perform privado.erro('DADOS_INVALIDOS', 'O motivo não pode ter dois-pontos (separa o detalhe)'); end if;
  v_cod := coalesce(nullif(p_dados ->> 'codigo', ''), left(trim(both '_' from regexp_replace(lower(translate(v_rot, 'áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ', 'aaaaeeiooouc' || 'AAAAEEIOOOUC')), '[^a-z0-9]+', '_', 'g')), 40));
  if v_cod = 'outro' and coalesce((p_dados ->> 'ativo')::boolean, true) = false then perform privado.erro('DADOS_INVALIDOS', '"Outro" fica sempre disponível'); end if;
  insert into public.motivos (tipo, codigo, rotulo, ativo, ordem) values (p_dados ->> 'tipo', v_cod, v_rot, coalesce((p_dados ->> 'ativo')::boolean, true),
    coalesce((p_dados ->> 'ordem')::int, (select coalesce(max(ordem), 0) + 1 from public.motivos where tipo = p_dados ->> 'tipo')))
  on conflict (tipo, codigo) do update set rotulo = excluded.rotulo, ativo = excluded.ativo, ordem = coalesce((p_dados ->> 'ordem')::int, public.motivos.ordem), atualizado_em = now()
  returning * into m;
  return jsonb_build_object('tipo', m.tipo, 'codigo', m.codigo, 'rotulo', m.rotulo, 'ativo', m.ativo);
end $$;

create or replace function public.salvar_meta(p_percentual numeric) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator();
begin
  perform privado.exigir_admin(s);
  if p_percentual is null or p_percentual < 0 or p_percentual > 100 then perform privado.erro('DADOS_INVALIDOS', 'Meta entre 0% e 100% sobre o mês anterior'); end if;
  insert into public.configuracao (chave, valor) values ('meta_diarias', jsonb_build_object('percentual', p_percentual))
  on conflict (chave) do update set valor = excluded.valor, atualizado_em = now();
  return jsonb_build_object('percentual', p_percentual);
end $$;

-- ---------------------------------------------------------------- escrita: negociar data, endereço novo, informe de pagamento
create or replace function public.propor_nova_data(p_pedido uuid, p_dados jsonb, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; p public.pedidos; a public.atendimentos; v_data date; v_hora text := p_dados ->> 'horaInicio'; v_msg text;
begin
  perform privado.exigir_prime(s);
  r := privado.idem_ler('proporNovaData', s, p_chave, jsonb_build_object('id', p_pedido) || coalesce(p_dados, '{}'));
  if r is not null then return r; end if;
  select * into p from public.pedidos where id = p_pedido for update;
  if not found then perform privado.erro('NAO_ENCONTRADO', 'Solicitação não encontrada'); end if;
  if p.status <> 'solicitado' then perform privado.erro('TRANSICAO_PROIBIDA', 'Só dá pra negociar a data de uma solicitação nova'); end if;
  begin v_data := (p_dados ->> 'data')::date; exception when others then v_data := null; end;
  if v_data is null or v_data <= privado.hoje_sp() then perform privado.erro('DATA_INVALIDA', 'Escolha uma data a partir de amanhã'); end if;
  if extract(dow from v_data) = 0 then perform privado.erro('DATA_INVALIDA', 'A Prime não atende aos domingos'); end if;
  select * into a from public.atendimentos where pedido_id = p.id and status <> 'cancelado' order by data, hora_inicio limit 1;
  if coalesce(v_hora, '') !~ '^([01]\d|2[0-3]):[0-5]\d$' or (a.duracao_minutos is not null and p.pacote ->> 'versao' = '3'
       and not v_hora = any(privado.v3_horarios(a.duracao_minutos / 60, v_data, privado.cfg_v3()))) then
    perform privado.erro('DATA_INVALIDA', 'Horário fora do horário de trabalho para essa duração'); end if;
  v_msg := left(regexp_replace(trim(coalesce(p_dados ->> 'mensagem', '')), '\s+', ' ', 'g'), 280);
  update public.pedidos set proposta_data = jsonb_build_object('data', v_data, 'horaInicio', v_hora, 'mensagem', nullif(v_msg, ''), 'dataPedida', a.data,
      'em', privado.agora_iso(), 'por', auth.uid(), 'validaAte', (now() + interval '48 hours')),
    historico = historico || jsonb_build_object('de', p.status, 'para', p.status, 'evento', 'propor_nova_data', 'em', privado.agora_iso(), 'ator', 'prime', 'data', v_data, 'horaInicio', v_hora)
   where id = p.id returning * into p;
  perform privado.evento('proposta_nova_data', jsonb_build_object('pedidoId', p.id, 'clienteId', p.cliente_id), p.proposta_data);
  r := jsonb_build_object('pedidoId', p.id, 'proposta', p.proposta_data);
  perform privado.idem_gravar('proporNovaData', s, p_chave, jsonb_build_object('id', p_pedido) || coalesce(p_dados, '{}'), r);
  return r;
end $$;

create or replace function public.aprovar_endereco_pacote(p_pedido uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); p public.pedidos;
begin
  perform privado.exigir_prime(s);
  update public.pedidos set pacote_endereco_novo = false,
    historico = historico || jsonb_build_object('de', status, 'para', status, 'evento', 'endereco_novo_aprovado', 'em', privado.agora_iso(), 'ator', 'prime')
   where id = p_pedido and status = 'solicitado' and pacote_endereco_novo returning * into p;
  if not found then perform privado.erro('TRANSICAO_PROIBIDA', 'Não há endereço novo pra aprovar nesta solicitação'); end if;
  return jsonb_build_object('pedidoId', p.id, 'enderecoNovoPacote', p.pacote_endereco_novo);
end $$;

/** Pix informado e não encontrado no extrato: volta pra pendente (o prazo continua) e a cliente é avisada (C19). */
create or replace function public.recusar_informe_pagamento(p_pagamento uuid, p_motivo text, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; g public.pagamentos; p public.pedidos; mot text := left(regexp_replace(trim(coalesce(p_motivo, '')), '\s+', ' ', 'g'), 280);
        conteudo jsonb := jsonb_build_object('id', p_pagamento, 'motivo', mot);
begin
  perform privado.exigir_prime(s);
  r := privado.idem_ler('recusarInformePagamento', s, p_chave, conteudo);
  if r is not null then return r; end if;
  if char_length(mot) < 3 then perform privado.erro('DADOS_INVALIDOS', 'Escreva o motivo'); end if;
  select * into g from public.pagamentos where id = p_pagamento;
  if not found then perform privado.erro('NAO_ENCONTRADO', 'Pagamento não encontrado'); end if;
  select * into p from public.pedidos where id = g.pedido_id for update;
  select * into g from public.pagamentos where id = p_pagamento for update;
  if g.status <> 'informado_pelo_cliente' then perform privado.erro('TRANSICAO_PROIBIDA', 'Este pagamento não está aguardando conferência'); end if;
  update public.pagamentos set status = 'pendente', informado_em = null, atualizado_em = now(),
    conferencia = coalesce(conferencia, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('resultado', 'nao_identificado', 'motivo', mot, 'em', privado.agora_iso(), 'por', auth.uid()))
   where id = g.id returning * into g;
  perform privado.evento('pagamento_nao_identificado', jsonb_build_object('pedidoId', p.id, 'clienteId', p.cliente_id, 'pagamentoId', g.id), jsonb_build_object('motivo', mot));
  r := jsonb_build_object('pagamento', privado.j_pagamento(g));
  perform privado.idem_gravar('recusarInformePagamento', s, p_chave, conteudo, r);
  return r;
end $$;

-- ---------------------------------------------------------------- permissões
do $$ declare f text; begin
  foreach f in array array[
    'painel_solicitacoes_novas(int)', 'painel_diarias(date)', 'painel_pendencias()', 'painel_resumo()', 'painel_standby(date)', 'painel_alertas()', 'painel_indicadores_home(text)',
    'marcar_escala(date, text, text, text)', 'decidir_standby(uuid, date, text, text)', 'registrar_solicitacao_profissional(jsonb, text)',
    'decidir_solicitacao_profissional(uuid, text, text, text)', 'listar_solicitacoes_profissional(jsonb)', 'salvar_habilidades(uuid, text[])', 'listar_motivos()',
    'salvar_motivo(jsonb)', 'salvar_meta(numeric)', 'propor_nova_data(uuid, jsonb, text)', 'aprovar_endereco_pacote(uuid)', 'recusar_informe_pagamento(uuid, text, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on function privado.p_endereco(public.atendimentos, public.pedidos, public.clientes), privado.p_ambientes(jsonb) from public;

-- ---------------------------------------------------------------- mensagens novas (gerado por scripts/gera-seed-automacoes.mjs a partir do catálogo)
-- C18 proposta de outra data, C19 pagamento não identificado, D09 escala publicada. Os templates novos precisam de aprovação na Meta.
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('proposta_nova_data', 'whatsapp', 1, 'Oi, {{nome}}. Sobre a sua solicitação nº {{numero}}: a Prime não tem disponibilidade na data pedida, mas pode atender em {{data}}, {{horario}}. Responda esta mensagem pra confirmar ou sugerir outra data.', null, array['nome', 'numero', 'data', 'horario']::text[], array['nome', 'numero', 'data', 'horario']::text[], 'UTILITY', true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('proposta_nova_data', 'email', 1, 'Oi, {{nome}}. Sobre a sua solicitação nº {{numero}}: a Prime não tem disponibilidade na data pedida, mas pode atender em {{data}}, {{horario}}. Responda esta mensagem pra confirmar ou sugerir outra data.', 'Proposta de outra data para a sua solicitação', array['nome', 'numero', 'data', 'horario']::text[], array['nome', 'numero', 'data', 'horario']::text[], null, true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('pagamento_nao_identificado', 'whatsapp', 1, 'Oi, {{nome}}. Ainda não encontramos o pagamento de {{valor}} referente a {{oque}}. O PIX e o prazo continuam em {{link}}
Se já pagou, responda esta mensagem com o comprovante.', null, array['nome', 'valor', 'oque', 'link']::text[], array['nome', 'valor', 'oque', 'link']::text[], 'UTILITY', true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('pagamento_nao_identificado', 'email', 1, 'Oi, {{nome}}. Ainda não encontramos o pagamento de {{valor}} referente a {{oque}}. O PIX e o prazo continuam em {{link}}
Se já pagou, responda esta mensagem com o comprovante.', 'Pagamento ainda não identificado', array['nome', 'valor', 'oque', 'link']::text[], array['nome', 'valor', 'oque', 'link']::text[], null, true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('escala_publicada', 'whatsapp', 1, 'Oi, {{nome}}! A escala de {{data}} foi publicada. Sua diária: {{horario}}, {{endereco}}. Qualquer dúvida, responda esta mensagem.', null, array['nome', 'data', 'horario', 'endereco']::text[], array['nome', 'data', 'horario', 'endereco']::text[], 'UTILITY', true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('escala_publicada', 'email', 1, 'Oi, {{nome}}! A escala de {{data}} foi publicada. Sua diária: {{horario}}, {{endereco}}. Qualquer dúvida, responda esta mensagem.', 'Escala publicada', array['nome', 'data', 'horario', 'endereco']::text[], array['nome', 'data', 'horario', 'endereco']::text[], null, true);
insert into public.automacao_regras (codigo, template_codigo, descricao, categoria, destinatario, canais_ordem, gatilho, atraso, condicoes, cancelamento, entidade, marco, do_dia, validade_min, ligada) values ('C18', 'proposta_nova_data', 'Proposta de outra data pra solicitação nova (painel v2, Negociar data)', 'atendimento', 'cliente', array['whatsapp', 'email', 'painel']::text[], '{"tipo":"evento","eventos":["proposta_nova_data"]}'::jsonb, '{"tipo":"imediato"}'::jsonb, '{"pedidoStatus":["solicitado"]}'::jsonb, array[]::text[], 'pedido', null, false, null, true);
insert into public.automacao_regras (codigo, template_codigo, descricao, categoria, destinatario, canais_ordem, gatilho, atraso, condicoes, cancelamento, entidade, marco, do_dia, validade_min, ligada) values ('C19', 'pagamento_nao_identificado', 'Pagamento informado e não encontrado no extrato (painel v2)', 'atendimento', 'cliente', array['whatsapp', 'email', 'painel']::text[], '{"tipo":"evento","eventos":["pagamento_nao_identificado"]}'::jsonb, '{"tipo":"imediato"}'::jsonb, '{"pagamentoStatus":["pendente"]}'::jsonb, array['pagamento_confirmado', 'pedido_cancelado']::text[], 'pagamento', null, false, null, true);
insert into public.automacao_regras (codigo, template_codigo, descricao, categoria, destinatario, canais_ordem, gatilho, atraso, condicoes, cancelamento, entidade, marco, do_dia, validade_min, ligada) values ('D09', 'escala_publicada', 'Escala do dia publicada pela equipe (painel v2): horário e endereço de cada diária', 'atendimento', 'diarista', array['whatsapp', 'email', 'painel']::text[], '{"tipo":"evento","eventos":["escala_publicada"]}'::jsonb, '{"tipo":"imediato"}'::jsonb, '{"mesmaProfissional":true}'::jsonb, array['atendimento_cancelado']::text[], 'atendimento', null, false, null, true);
