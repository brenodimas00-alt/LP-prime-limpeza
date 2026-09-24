-- Ajustes da cliente (24/09/2026): o cliente SOLICITA, a Prime verifica a disponibilidade e só então vem a cobrança, com
-- pagamento antecipado e INTEGRAL (substitui o 50/50). Mesmas regras de src/domain/estados.js, src/domain/pacote.js
-- (calcularCobrancas) e src/app/casos-de-uso.js. Migration NOVA: nenhuma anterior é editada e nenhum registro é alterado;
-- os valores antigos (aguardando_entrada, ativo, entrada, dia) continuam aceitos só pra histórico.

-- ---------- pedidos ----------
alter table public.pedidos drop constraint pedidos_status_check;
alter table public.pedidos add constraint pedidos_status_check check (status in (
  'rascunho', 'aguardando_entrada', 'ativo',
  'solicitado', 'disponibilidade_confirmada', 'aguardando_pagamento', 'confirmado', 'concluido', 'recusado', 'cancelado'));
alter table public.pedidos alter column entrada_centavos drop not null, alter column restante_centavos drop not null;
alter table public.pedidos drop constraint pedidos_check;
alter table public.pedidos add constraint pedidos_entrada_restante_check check (
  (entrada_centavos is null and restante_centavos is null) or entrada_centavos + restante_centavos = total_centavos);
alter table public.pedidos
  add column preferencia_profissional text check (char_length(preferencia_profissional) <= 120),
  add column observacao_disponibilidade text check (char_length(observacao_disponibilidade) <= 300),
  add column recusa jsonb check (recusa is null or jsonb_typeof(recusa) = 'object');
alter table public.pedidos add constraint pedidos_recusado_com_motivo check (status <> 'recusado' or (recusa ->> 'motivo') is not null);

-- ---------- pagamentos ----------
alter table public.pagamentos drop constraint pagamentos_parcela_check;
alter table public.pagamentos add constraint pagamentos_parcela_check check (parcela in ('entrada', 'dia', 'diaria', 'pacote'));
alter table public.pagamentos drop constraint pagamentos_check;
alter table public.pagamentos add constraint pagamentos_atendimento_da_parcela check ((parcela in ('dia', 'diaria')) = (atendimento_id is not null));
alter table public.pagamentos drop constraint pagamentos_status_check;
alter table public.pagamentos add constraint pagamentos_status_check check (status in ('pendente', 'informado_pelo_cliente', 'confirmado', 'cancelado', 'estornado'));
alter table public.pagamentos
  add column desconto_centavos bigint not null default 0 check (desconto_centavos >= 0),
  add column estorno jsonb check (estorno is null or jsonb_typeof(estorno) = 'object');
alter table public.pagamentos add constraint pagamentos_estornado_com_motivo check (status <> 'estornado' or (estorno ->> 'motivo') is not null);
-- uma cobrança ativa por diária e uma por pacote
create unique index pagamentos_diaria_ativa on public.pagamentos (atendimento_id) where parcela = 'diaria' and status not in ('cancelado', 'estornado');
create unique index pagamentos_pacote_ativo on public.pagamentos (pedido_id) where parcela = 'pacote' and status not in ('cancelado', 'estornado');

-- ---------- tabela vigente: pagamento integral (a linha antiga fica pro histórico) ----------
insert into public.precos (vigente_desde, tabela) values ('2026-09-24T00:00:00Z', '{"PRECOS":{"duracoes":{"2":{"centavos":13800,"metragemMaxima":30},"4":{"centavos":17500},"6":{"centavos":20300},"8":{"centavos":22000}},"horaExtraCentavos":3000,"horasExtrasMaximo":4,"metragem":{"minimo":10,"maximo":1000},"recomendacaoPorMetragem":[{"ate":50,"horas":4},{"ate":80,"horas":6},{"ate":120,"horas":8}],"avisoTempo":"Vidros, geladeira, armários internos e revestimentos exigem mais tempo.","tiposServico":{"residencial":{"nome":"Limpeza residencial","centavos":0},"empresarial":{"nome":"Limpeza empresarial ou comercial","centavos":1000},"condominial":{"nome":"Limpeza condominial","centavos":1000},"pre_pos_mudanca":{"nome":"Pré ou pós-mudança","centavos":2000},"pre_pos_evento":{"nome":"Pré ou pós-evento","centavos":2000},"passadoria":{"nome":"Passadoria de roupas (serviço exclusivo)","centavos":0,"exclusivo":true}},"naoOferecidos":{"pos_obra":"No momento não realizamos limpeza pós-obra."},"passadoriaCombinada":{"centavos":5500,"aviso":"A passadoria combinada é para pouca demanda, dentro das mesmas horas da limpeza."},"recomendacaoPassadoria":[{"ate":15,"horas":2,"descricao":"até 15 peças básicas"},{"ate":25,"horas":4,"descricao":"até 25 peças básicas e sociais leves"},{"ate":40,"horas":6,"descricao":"até 40 peças mistas"},{"ate":60,"horas":8,"descricao":"até 60 peças ou peças sociais elaboradas"}],"avisoPassadoria":"Peças delicadas ou muito amarrotadas exigem mais tempo.","taxaSabadoFeriadoCentavos":2000,"taxaSemLocalAlmocoCentavos":2500,"descontoMensal":[{"minimoDiarias":5,"centavos":4000},{"minimoDiarias":3,"centavos":2000}],"quantidadeDiarias":{"minimo":1,"maximo":12}},"pagamento":{"formas":["pix","transferencia","deposito"],"prazo":"dia_util_anterior_14h","horaPrazo":"14:00","pacoteDeUmaVez":false},"diasBloqueados":[0],"regrasCalendario":{"antecedenciaMinimaDias":1,"horizonteMaximoDias":120,"buscaDeslocamentoMaxDias":7},"regrasNotificacao":{"fuso":"America/Sao_Paulo","horaLembreteVespera":18,"horaLembretePagamento":9,"minutosAposFinalizado":120},"regioesDiarista":["BH - Centro-Sul","BH - Pampulha","BH - Oeste","BH - Barreiro","BH - Noroeste","BH - Norte","BH - Nordeste","BH - Leste","BH - Venda Nova","Contagem","Santa Luzia","Ribeirão das Neves","Sabará","Betim","Ibirité","Vespasiano","Nova Lima"]}'::jsonb);

-- ---------- domínio: pacote e cobranças (pacote.js) ----------
/** Preço-base de UMA diária (calcularPacote), agora com modoPagamento no lugar de entrada/restante. */
create or replace function privado.calcular_pacote(esp jsonb, cfg jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  P jsonb := cfg -> 'PRECOS';
  erros text[] := privado.validar_especificacao(esp, cfg);
  tipo jsonb; itens jsonb; hx int; reg public.regioes; taxa bigint := 0; base bigint; rec int; exclusivo boolean;
begin
  if array_length(erros, 1) > 0 then perform privado.erro('DADOS_INVALIDOS', array_to_string(erros, '; '), to_jsonb(erros)); end if;
  tipo := P -> 'tiposServico' -> (esp ->> 'tipoServico');
  exclusivo := coalesce((tipo ->> 'exclusivo')::boolean, false);
  itens := jsonb_build_array(jsonb_build_object('codigo', 'diaria', 'descricao', 'Diária de ' || (esp ->> 'duracaoHoras') || ' horas', 'centavos', (P -> 'duracoes' -> (esp ->> 'duracaoHoras') ->> 'centavos')::bigint));
  hx := coalesce((esp ->> 'horasExtras')::int, 0);
  if hx > 0 then itens := itens || jsonb_build_object('codigo', 'hora_extra', 'descricao', hx || ' hora(s) extra(s)', 'centavos', hx * (P ->> 'horaExtraCentavos')::bigint); end if;
  if (tipo ->> 'centavos')::bigint > 0 then itens := itens || jsonb_build_object('codigo', 'servico:' || (esp ->> 'tipoServico'), 'descricao', tipo ->> 'nome', 'centavos', (tipo ->> 'centavos')::bigint); end if;
  if (esp -> 'passadoriaCombinada') = 'true' then itens := itens || jsonb_build_object('codigo', 'passadoria_combinada', 'descricao', 'Passadoria combinada (pouca demanda)', 'centavos', (P #>> '{passadoriaCombinada,centavos}')::bigint); end if;
  if (esp -> 'semLocalAlmoco') = 'true' then itens := itens || jsonb_build_object('codigo', 'sem_local_almoco', 'descricao', 'Sem local para esquentar o almoço', 'centavos', (P ->> 'taxaSemLocalAlmocoCentavos')::bigint); end if;
  if esp ? 'endereco' and jsonb_typeof(esp -> 'endereco') = 'object' then
    reg := privado.regiao(esp -> 'endereco');
    if reg.cidade is null then perform privado.erro('REGIAO_NAO_ATENDIDA', 'Ainda não atendemos ' || coalesce(nullif(esp #>> '{endereco,cidade}', ''), 'essa cidade')); end if;
    if reg.sob_consulta then perform privado.erro('REGIAO_SOB_CONSULTA', reg.cidade || ': atendimento sob consulta. Fale com a Prime pelo WhatsApp.'); end if;
    taxa := coalesce(reg.taxa_centavos, 0);
    if taxa > 0 then itens := itens || jsonb_build_object('codigo', 'deslocamento', 'descricao', 'Taxa de deslocamento (' || reg.cidade || ')', 'centavos', taxa); end if;
  end if;
  select sum((i ->> 'centavos')::bigint) into base from jsonb_array_elements(itens) i;
  rec := case when exclusivo then (case when privado.tem_valor(esp -> 'pecas') then coalesce(privado.recomendar(P -> 'recomendacaoPassadoria', (esp ->> 'pecas')::int), 8) end)
              else privado.recomendar(P -> 'recomendacaoPorMetragem', (esp ->> 'metragem')::int) end;
  return jsonb_build_object('tipoServico', esp ->> 'tipoServico', 'duracaoHoras', (esp ->> 'duracaoHoras')::int, 'horasExtras', hx)
      || case when exclusivo then (case when privado.tem_valor(esp -> 'pecas') then jsonb_build_object('pecas', (esp ->> 'pecas')::int) else '{}' end)
              else jsonb_build_object('metragem', (esp ->> 'metragem')::int) end
      || jsonb_build_object(
           'passadoriaCombinada', coalesce((esp ->> 'passadoriaCombinada')::boolean, false), 'semLocalAlmoco', coalesce((esp ->> 'semLocalAlmoco')::boolean, false),
           'quantidadeDiarias', (esp ->> 'quantidadeDiarias')::int, 'frequencia', esp ->> 'frequencia', 'itensDia', itens,
           'valorDiaBaseCentavos', base, 'taxaDeslocamentoCentavos', taxa, 'recomendacaoHoras', rec,
           'modoPagamento', case when coalesce((cfg #>> '{pagamento,pacoteDeUmaVez}')::boolean, false) then 'pacote' else 'por_diaria' end,
           'totalCentavos', 0, 'descontoMensalCentavos', 0);
end $$;

/**
 * Cobranças do pagamento antecipado e integral (calcularCobrancas). p_itens: diárias ATIVAS {sequencia, data, valorDiaCentavos}.
 * por_diaria: uma por diária; o desconto do mês (sobre o total do mês) entra inteiro na cobrança da última diária do mês.
 * pacote: uma cobrança com o total. Vence até horaPrazo (14h) do dia útil anterior à diária (a primeira, no pacote).
 */
create or replace function privado.calcular_cobrancas(p_itens jsonb, p_modo text, cfg jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare ord jsonb; descontos jsonb := '{}'; faixa jsonb; o record; desc_total bigint := 0; total bigint; ult jsonb := '{}'; r jsonb;
        hora text := coalesce(cfg #>> '{pagamento,horaPrazo}', '14:00');
begin
  if p_itens is null or jsonb_array_length(p_itens) = 0 then return '[]'; end if;
  select jsonb_agg(x order by x ->> 'data', (x ->> 'sequencia')::int) into ord from jsonb_array_elements(p_itens) x;
  for o in select left(x ->> 'data', 7) mes, count(*)::int n from jsonb_array_elements(ord) x group by 1 order by 1 loop
    select f into faixa from jsonb_array_elements(cfg #> '{PRECOS,descontoMensal}') f where o.n >= (f ->> 'minimoDiarias')::int order by (f ->> 'minimoDiarias')::int desc limit 1;
    if faixa is not null then
      descontos := descontos || jsonb_build_object(o.mes, (faixa ->> 'centavos')::bigint);
      desc_total := desc_total + (faixa ->> 'centavos')::bigint;
    end if;
    faixa := null;
  end loop;
  if p_modo = 'pacote' then
    select sum((x ->> 'valorDiaCentavos')::bigint) into total from jsonb_array_elements(ord) x;
    return jsonb_build_array(jsonb_build_object('parcela', 'pacote', 'valorCentavos', total - desc_total, 'descontoCentavos', desc_total,
      'venceEm', to_char(privado.dia_util_anterior((ord -> 0 ->> 'data')::date, cfg), 'YYYY-MM-DD'), 'venceAs', hora));
  end if;
  if coalesce(p_modo, '') <> 'por_diaria' then perform privado.erro('DADOS_INVALIDOS', 'modoPagamento desconhecido: ' || coalesce(p_modo, '')); end if;
  for o in select left(x ->> 'data', 7) mes, (x ->> 'sequencia')::int seq from jsonb_array_elements(ord) with ordinality t(x, n) order by n loop
    ult := ult || jsonb_build_object(o.mes, o.seq);
  end loop;
  select jsonb_agg(jsonb_build_object('parcela', 'diaria', 'sequencia', (z.x ->> 'sequencia')::int, 'valorCentavos', (z.x ->> 'valorDiaCentavos')::bigint - z.d,
           'descontoCentavos', z.d, 'venceEm', to_char(privado.dia_util_anterior((z.x ->> 'data')::date, cfg), 'YYYY-MM-DD'), 'venceAs', hora) order by z.n)
    into r
    from (select t.x, t.n, case when (ult ->> left(t.x ->> 'data', 7))::int = (t.x ->> 'sequencia')::int then coalesce((descontos ->> left(t.x ->> 'data', 7))::bigint, 0) else 0 end d
            from jsonb_array_elements(ord) with ordinality t(x, n)) z;
  return r;
end $$;

/** Atendimentos com valor do dia, desconto mensal, total e cobranças (gerarAtendimentos). Devolve {itens, descontos, cobrancas, pacote}. */
create or replace function privado.gerar_atendimentos(pacote jsonb, primeira date, turno text, hoje date, endereco jsonb, cfg jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  ocs jsonb; probs jsonb; reg public.regioes; atendida boolean := true; codigo text;
  itens jsonb := '[]'; o jsonb; taxa bigint; total bigint := 0; desconto bigint := 0; descontos jsonb := '[]'; faixa jsonb;
begin
  if turno is null or turno not in ('manha', 'tarde', 'integral') then perform privado.erro('DADOS_INVALIDOS', 'Turno inválido'); end if;
  if (pacote ->> 'duracaoHoras')::int >= 8 and turno <> 'integral' then perform privado.erro('DADOS_INVALIDOS', 'Diária de 8 horas é sempre integral'); end if;
  if (pacote ->> 'duracaoHoras')::int < 8 and turno = 'integral' then perform privado.erro('DADOS_INVALIDOS', 'Escolha manhã ou tarde pra diárias de até 6 horas'); end if;
  if primeira is null then perform privado.erro('DATA_INVALIDA', 'Data inválida'); end if;
  ocs := privado.gerar_ocorrencias(pacote ->> 'frequencia', (pacote ->> 'quantidadeDiarias')::int, primeira, cfg);
  if endereco is not null then reg := privado.regiao(endereco); atendida := reg.cidade is not null and not reg.sob_consulta; end if;
  probs := privado.validar_ocorrencias(ocs, hoje, atendida, cfg);
  if jsonb_array_length(probs) > 0 then
    codigo := case when probs @> '[{"motivo": "região não atendida"}]' then (case when reg.sob_consulta then 'REGIAO_SOB_CONSULTA' else 'REGIAO_NAO_ATENDIDA' end) else 'DATA_INVALIDA' end;
    perform privado.erro(codigo, (select string_agg('Diária ' || (p ->> 'sequencia') || ' (' || (p ->> 'data') || '): ' || (p ->> 'motivo'), '; ') from jsonb_array_elements(probs) p), probs);
  end if;
  for o in select * from jsonb_array_elements(ocs) loop
    taxa := case when privado.eh_sabado_ou_feriado((o ->> 'data')::date, cfg) then (cfg #>> '{PRECOS,taxaSabadoFeriadoCentavos}')::bigint else 0 end;
    itens := itens || (o || jsonb_build_object('turno', turno, 'taxaDiaCentavos', taxa, 'valorDiaCentavos', (pacote ->> 'valorDiaBaseCentavos')::bigint + taxa));
    total := total + (pacote ->> 'valorDiaBaseCentavos')::bigint + taxa;
  end loop;
  -- desconto mensal por mês de calendário (sobre o total do mês; faixas não somam)
  for o in select jsonb_build_object('mes', left(x ->> 'data', 7), 'diarias', count(*)) from jsonb_array_elements(itens) x group by left(x ->> 'data', 7) order by 1 loop
    select f into faixa from jsonb_array_elements(cfg #> '{PRECOS,descontoMensal}') f where (o ->> 'diarias')::int >= (f ->> 'minimoDiarias')::int order by (f ->> 'minimoDiarias')::int desc limit 1;
    if faixa is not null then
      descontos := descontos || jsonb_build_object('mes', o -> 'mes', 'diarias', o -> 'diarias', 'centavos', (faixa ->> 'centavos')::bigint);
      desconto := desconto + (faixa ->> 'centavos')::bigint;
    end if;
    faixa := null;
  end loop;
  return jsonb_build_object('itens', itens, 'descontos', descontos, 'cobrancas', privado.calcular_cobrancas(itens, pacote ->> 'modoPagamento', cfg),
    'pacote', pacote || jsonb_build_object('totalCentavos', total - desconto, 'descontoMensalCentavos', desconto));
end $$;

-- ---------- serialização ----------
create or replace function privado.j_pedido(p public.pedidos) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object('id', p.id, 'clienteId', p.cliente_id, 'pacote', p.pacote, 'status', p.status, 'historico', p.historico,
    'cancelamento', p.cancelamento, 'recusa', p.recusa, 'preferenciaProfissional', p.preferencia_profissional, 'observacaoDisponibilidade', p.observacao_disponibilidade,
    'atendimentoIds', (select coalesce(jsonb_agg(a.id order by a.sequencia), '[]') from public.atendimentos a where a.pedido_id = p.id),
    'criadoEm', to_char(p.criado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
$$;

create or replace function privado.j_pagamento(g public.pagamentos) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object('id', g.id, 'pedidoId', g.pedido_id, 'atendimentoId', g.atendimento_id, 'parcela', g.parcela, 'valorCentavos', g.valor_centavos,
    'descontoCentavos', g.desconto_centavos, 'metodo', g.metodo, 'pixTxid', g.pix_txid, 'status', g.status, 'estorno', g.estorno,
    'venceEm', case when g.vence_em is not null then to_char(g.vence_em, 'YYYY-MM-DD') end,
    'venceAs', case when g.vence_as is not null then to_char(g.vence_as, 'HH24:MI') end,
    'informadoEm', case when g.informado_em is not null then to_char(g.informado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
    'confirmadoEm', case when g.confirmado_em is not null then to_char(g.confirmado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
    'chaveIdempotencia', g.chave_idempotencia, 'criadoEm', to_char(g.criado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
    || case when g.brcode is null then '{"brcode": null}'::jsonb else jsonb_build_object('brcode', g.brcode) end
$$;

create or replace function privado.pedido_completo(p_id uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('pedido', privado.j_pedido(p), 'cliente', privado.j_cliente(c),
    'atendimentos', (select coalesce(jsonb_agg(privado.j_atendimento(a) order by a.sequencia), '[]') from public.atendimentos a where a.pedido_id = p.id),
    'pagamentos', (select coalesce(jsonb_agg(privado.j_pagamento(g) order by g.vence_em, g.criado_em), '[]') from public.pagamentos g where g.pedido_id = p.id))
    from public.pedidos p join public.clientes c on c.id = p.cliente_id where p.id = p_id
$$;

-- ---------- máquina de estados ----------
create or replace function privado.transicoes() returns jsonb
language sql immutable set search_path = '' as $$ select '{
  "confirmar": {"de": ["agendado"], "para": "confirmado", "atores": ["prime", "sistema"], "condicoes": ["pagamentoConfirmado"]},
  "sair_a_caminho": {"de": ["confirmado"], "para": "diarista_a_caminho", "atores": ["diarista", "prime"], "condicoes": ["diaristaAprovadaAtribuida"]},
  "iniciar": {"de": ["diarista_a_caminho"], "para": "em_andamento", "atores": ["diarista", "prime"], "condicoes": []},
  "finalizar": {"de": ["em_andamento"], "para": "finalizado", "atores": ["diarista", "prime"], "condicoes": []},
  "avaliar": {"de": ["finalizado"], "para": "avaliado", "atores": ["cliente", "sistema"], "condicoes": []},
  "cancelar": {"de": ["agendado", "confirmado", "diarista_a_caminho"], "para": "cancelado", "atores": ["cliente", "prime", "sistema"], "condicoes": []},
  "reagendar": {"de": ["agendado", "confirmado"], "para": null, "atores": ["cliente", "prime"], "condicoes": ["dataNova"]}
}'::jsonb $$;

/** A diária está paga? (a cobrança dela ou a do pacote confirmada) */
create or replace function privado.diaria_paga(a public.atendimentos) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from public.pagamentos g where g.pedido_id = a.pedido_id and g.status = 'confirmado'
                   and (g.parcela = 'pacote' or (g.parcela = 'diaria' and g.atendimento_id = a.id)))
$$;

create or replace function privado.algum_pagamento_confirmado(p_pedido uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from public.pagamentos g where g.pedido_id = p_pedido and g.status = 'confirmado')
$$;

create or replace function privado.transicionar(a public.atendimentos, p_evento text, s jsonb, p_dados jsonb) returns public.atendimentos
language plpgsql set search_path = '' as $$
declare t jsonb := privado.transicoes() -> p_evento; p public.pedidos; d public.diaristas; para text; c text; novo public.atendimentos;
begin
  if t is null then perform privado.erro('EVENTO_INVALIDO', 'Evento desconhecido: ' || coalesce(p_evento, '')); end if;
  if s ->> 'ator' not in ('cliente', 'prime', 'diarista', 'sistema') then perform privado.erro('ATOR_SEM_PERMISSAO', 'Ator inválido: ' || coalesce(s ->> 'ator', '')); end if;
  if not (t -> 'de') ? a.status then perform privado.erro('TRANSICAO_PROIBIDA', 'Não é possível "' || p_evento || '" a partir de "' || a.status || '"'); end if;
  if not (t -> 'atores') ? (s ->> 'ator') then perform privado.erro('ATOR_SEM_PERMISSAO', '"' || (s ->> 'ator') || '" não pode executar "' || p_evento || '"'); end if;
  select * into p from public.pedidos where id = a.pedido_id;
  if s ->> 'ator' = 'cliente' and (s ->> 'id' is null or (s ->> 'id')::uuid <> p.cliente_id) then perform privado.erro('ATOR_SEM_PERMISSAO', 'Cliente não é o dono deste pedido'); end if;
  if s ->> 'ator' = 'diarista' and (s ->> 'id' is null or (s ->> 'id')::uuid is distinct from a.diarista_id) then perform privado.erro('ATOR_SEM_PERMISSAO', 'Diarista não é a atribuída a este atendimento'); end if;
  for c in select * from jsonb_array_elements_text(t -> 'condicoes') loop
    if c = 'pagamentoConfirmado' and not privado.diaria_paga(a) then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'O pagamento desta diária ainda não foi confirmado'); end if;
    if c = 'diaristaAprovadaAtribuida' then
      if a.diarista_id is null then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Nenhuma diarista atribuída'); end if;
      select * into d from public.diaristas where id = a.diarista_id;
      if d.status <> 'aprovada' then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Diarista não está aprovada'); end if;
    end if;
    if c = 'dataNova' and (coalesce(p_dados ->> 'data', '') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(p_dados ->> 'turno', '') = '') then
      perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Reagendamento exige nova data e turno'); end if;
  end loop;
  para := coalesce(t ->> 'para', a.status);
  novo := a;
  novo.status := para; novo.versao := a.versao + 1;
  novo.historico := a.historico || jsonb_build_object('de', a.status, 'para', para, 'evento', p_evento, 'em', privado.agora_iso(), 'ator', s ->> 'ator');
  if p_evento = 'reagendar' then novo.data := (p_dados ->> 'data')::date; novo.turno := p_dados ->> 'turno'; novo.deslocada := false; end if;
  return novo;
end $$;

/** Status do pedido derivado (derivarStatusPedido): terminais não voltam; antes da cobrança o status é da Prime. */
create or replace function privado.derivar_status_pedido(p_status text, p_pedido uuid) returns text
language plpgsql stable set search_path = '' as $$
declare st text[]; tem_ativo boolean; tem_realizado boolean;
begin
  if p_status in ('cancelado', 'concluido', 'recusado', 'rascunho') then return p_status; end if;
  select array_agg(a.status) into st from public.atendimentos a where a.pedido_id = p_pedido;
  if st is not null and array_length(st, 1) > 0 and not exists (select 1 from unnest(st) x where x <> 'cancelado') then return 'cancelado'; end if;
  tem_ativo := exists (select 1 from unnest(st) x where x in ('agendado', 'confirmado', 'diarista_a_caminho', 'em_andamento'));
  tem_realizado := exists (select 1 from unnest(st) x where x in ('finalizado', 'avaliado'));
  if not tem_ativo and tem_realizado then return 'concluido'; end if;
  if p_status = 'aguardando_pagamento' and privado.algum_pagamento_confirmado(p_pedido) then return 'confirmado'; end if;
  return p_status;
end $$;

/** Elegibilidade (elegibilidadePagamento): a cobrança antecipada vale enquanto a diária (ou o pacote) não foi cancelada. */
create or replace function privado.elegibilidade(g public.pagamentos) returns jsonb
language plpgsql stable set search_path = '' as $$
declare p public.pedidos; a public.atendimentos;
begin
  if g.status = 'confirmado' then return '{"pagavel": false, "motivo": "Pagamento já confirmado pela Prime"}'; end if;
  if g.status = 'estornado' then return '{"pagavel": false, "motivo": "Pagamento estornado"}'; end if;
  if g.status = 'cancelado' then return '{"pagavel": false, "motivo": "Cobrança cancelada"}'; end if;
  select * into p from public.pedidos where id = g.pedido_id;
  if p.status not in ('aguardando_pagamento', 'confirmado', 'concluido') then return '{"pagavel": false, "motivo": "Este pedido não está aguardando pagamento"}'; end if;
  if g.parcela = 'pacote' then return '{"pagavel": true}'; end if;
  if g.parcela = 'diaria' then
    select * into a from public.atendimentos where id = g.atendimento_id;
    if a.id is null then return '{"pagavel": false, "motivo": "Diária não encontrada"}'; end if;
    if a.status = 'cancelado' then return '{"pagavel": false, "motivo": "Diária cancelada"}'; end if;
    return '{"pagavel": true}';
  end if;
  return '{"pagavel": false, "motivo": "Cobrança antiga. Fale com a Prime."}';
end $$;

/**
 * Diária cancelada ou remarcada depois da cobrança: cobranças PENDENTES do pedido são recalculadas (o desconto do mês
 * segue as diárias ativas). Informada ou confirmada não muda: diferença é acerto manual da Prime.
 */
create or replace function privado.recalcular_cobrancas_pendentes(p_pedido uuid) returns void
language plpgsql set search_path = '' as $$
declare cfg jsonb := privado.cfg(); p public.pedidos; esperadas jsonb; g record; e jsonb;
begin
  select * into p from public.pedidos where id = p_pedido;
  if coalesce(p.pacote ->> 'modoPagamento', 'por_diaria') <> 'por_diaria' then return; end if;
  esperadas := privado.calcular_cobrancas((select coalesce(jsonb_agg(jsonb_build_object('sequencia', a.sequencia, 'data', to_char(a.data, 'YYYY-MM-DD'), 'valorDiaCentavos', a.valor_dia_centavos)), '[]')
                                             from public.atendimentos a where a.pedido_id = p_pedido and a.status <> 'cancelado'), 'por_diaria', cfg);
  for g in select x.id, x.valor_centavos, x.vence_em, x.pix_txid, a.sequencia from public.pagamentos x join public.atendimentos a on a.id = x.atendimento_id
            where x.pedido_id = p_pedido and x.parcela = 'diaria' and x.status = 'pendente' and a.status <> 'cancelado' for update of x loop
    select c into e from jsonb_array_elements(esperadas) c where (c ->> 'sequencia')::int = g.sequencia;
    if e is not null and ((e ->> 'valorCentavos')::bigint <> g.valor_centavos or (e ->> 'venceEm')::date <> g.vence_em) then
      update public.pagamentos set valor_centavos = (e ->> 'valorCentavos')::bigint, desconto_centavos = (e ->> 'descontoCentavos')::bigint,
        vence_em = (e ->> 'venceEm')::date, vence_as = (e ->> 'venceAs')::time, brcode = privado.brcode((e ->> 'valorCentavos')::bigint, g.pix_txid)
       where id = g.id;
    end if;
    e := null;
  end loop;
end $$;

create or replace function privado.aplicar_transicao(p_id uuid, p_evento text, s jsonb, p_dados jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare a public.atendimentos; novo public.atendimentos; p public.pedidos; probs jsonb; cfg jsonb; tipo text;
begin
  select * into a from public.atendimentos where id = p_id for update;
  if not found then perform privado.erro('NAO_ENCONTRADO', 'Atendimento não encontrado'); end if;
  perform 1 from public.pedidos where id = a.pedido_id for update;
  if p_evento = 'reagendar' then
    cfg := privado.cfg();
    if coalesce(p_dados ->> 'data', '') !~ '^\d{4}-\d{2}-\d{2}$' then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Reagendamento exige nova data e turno'); end if;
    probs := privado.validar_ocorrencias(jsonb_build_array(jsonb_build_object('sequencia', a.sequencia, 'data', p_dados ->> 'data')), privado.hoje_sp(), true, cfg);
    if jsonb_array_length(probs) > 0 then perform privado.erro('DATA_INVALIDA', (select string_agg(x ->> 'motivo', '; ') from jsonb_array_elements(probs) x), probs); end if;
    if exists (select 1 from public.atendimentos i where i.pedido_id = a.pedido_id and i.id <> a.id and i.status <> 'cancelado' and i.data = (p_dados ->> 'data')::date) then
      perform privado.erro('DATA_INVALIDA', 'Já existe diária deste pedido nessa data'); end if;
  end if;
  novo := privado.transicionar(a, p_evento, s, p_dados);
  update public.atendimentos set status = novo.status, versao = novo.versao, historico = novo.historico, data = novo.data, turno = novo.turno, deslocada = novo.deslocada where id = a.id;
  if p_evento = 'cancelar' then
    update public.pagamentos set status = 'cancelado' where atendimento_id = a.id and status in ('pendente', 'informado_pelo_cliente');
  end if;
  if p_evento in ('cancelar', 'reagendar') then perform privado.recalcular_cobrancas_pendentes(a.pedido_id); end if;
  p := privado.atualizar_status_pedido(a.pedido_id, s ->> 'ator', 'atendimento_' || p_evento);
  tipo := case when p_evento = 'reagendar' then 'atendimento_reagendado' else 'atendimento_' || novo.status end;
  perform privado.evento(tipo, jsonb_strip_nulls(jsonb_build_object('pedidoId', p.id, 'atendimentoId', a.id, 'diaristaId', a.diarista_id, 'clienteId', p.cliente_id)), jsonb_build_object('versao', novo.versao));
  select * into novo from public.atendimentos where id = a.id;
  return jsonb_build_object('atendimento', privado.j_atendimento(novo), 'pedido', privado.j_pedido(p));
end $$;

-- ---------- solicitação (sem cobrança) ----------
create or replace function privado.nova_cobranca(p_pedido uuid, p_atendimento uuid, c jsonb, p_chave text) returns public.pagamentos
language plpgsql set search_path = '' as $$
declare txid text := privado.novo_txid(); g public.pagamentos;
begin
  insert into public.pagamentos (pedido_id, atendimento_id, parcela, valor_centavos, desconto_centavos, metodo, pix_txid, brcode, status, vence_em, vence_as, chave_idempotencia)
  values (p_pedido, p_atendimento, c ->> 'parcela', (c ->> 'valorCentavos')::bigint, (c ->> 'descontoCentavos')::bigint, 'pix', txid,
          privado.brcode((c ->> 'valorCentavos')::bigint, txid), 'pendente', (c ->> 'venceEm')::date, (c ->> 'venceAs')::time, p_chave) returning * into g;
  return g;
end $$;

create or replace function privado.normalizar_preferencia(v text) returns text
language plpgsql immutable set search_path = '' as $$
declare t text := regexp_replace(trim(coalesce(v, '')), '\s+', ' ', 'g');
begin
  if char_length(t) > 120 then perform privado.erro('DADOS_INVALIDOS', 'Preferência com no máximo 120 caracteres', '{"preferenciaProfissional": "No máximo 120 caracteres"}'); end if;
  return nullif(t, '');
end $$;

/** Cria a SOLICITAÇÃO: pedido + atendimentos, sem cobrança. Preço SEMPRE recalculado aqui. */
create or replace function privado.gravar_solicitacao(c public.clientes, p_pacote jsonb, p_primeira text, p_turno text, p_preferencia text, p_ficticio boolean) returns jsonb
language plpgsql set search_path = '' as $$
declare cfg jsonb := privado.cfg(); esp jsonb; base jsonb; g jsonb; pacote jsonb; p public.pedidos; it jsonb; primeira date;
begin
  if coalesce(p_primeira, '') !~ '^\d{4}-\d{2}-\d{2}$' then perform privado.erro('DATA_INVALIDA', 'Data inválida: ' || coalesce(p_primeira, '')); end if;
  begin primeira := p_primeira::date; exception when others then perform privado.erro('DATA_INVALIDA', 'Data inválida: ' || p_primeira); end;
  esp := coalesce(p_pacote, '{}') || jsonb_build_object('tipoCliente', c.tipo, 'endereco', c.endereco);
  base := privado.calcular_pacote(esp, cfg);
  g := privado.gerar_atendimentos(base, primeira, p_turno, privado.hoje_sp(), c.endereco, cfg);
  pacote := g -> 'pacote';
  insert into public.pedidos (cliente_id, pacote, status, historico, total_centavos, entrada_centavos, restante_centavos, preferencia_profissional, ficticio)
  values (c.id, pacote, 'solicitado', jsonb_build_array(jsonb_build_object('de', 'rascunho', 'para', 'solicitado', 'evento', 'solicitar', 'em', privado.agora_iso(), 'ator', 'cliente')),
          (pacote ->> 'totalCentavos')::bigint, null, null, p_preferencia, p_ficticio) returning * into p;
  for it in select * from jsonb_array_elements(g -> 'itens') loop
    insert into public.atendimentos (pedido_id, sequencia, data, turno, status, valor_dia_centavos, taxa_dia_centavos, deslocada, data_original)
    values (p.id, (it ->> 'sequencia')::int, (it ->> 'data')::date, it ->> 'turno', 'agendado', (it ->> 'valorDiaCentavos')::bigint, (it ->> 'taxaDiaCentavos')::bigint,
            (it ->> 'deslocada')::boolean, case when (it ->> 'deslocada')::boolean then (it ->> 'original')::date end);
  end loop;
  perform privado.evento('pedido_criado', jsonb_build_object('pedidoId', p.id, 'clienteId', c.id));
  return privado.pedido_completo(p.id);
end $$;

/**
 * Autoagendamento (SOLICITAÇÃO): o cliente LOGADO solicita. Cadastro existente é reaproveitado (sem duplicar).
 * p_dados: {cliente, pacote, primeiraData, turno, preferenciaProfissional}. Devolve {cliente, pedido, atendimentos, pagamentos: []}.
 */
create or replace function public.confirmar_autoagendamento(p_dados jsonb, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; c jsonb; cli public.clientes; conteudo jsonb; res jsonb; doc text; tipo_doc text; pref text;
begin
  if s ->> 'ator' <> 'cliente' or s ->> 'usuarioId' is null then perform privado.erro('ATOR_SEM_PERMISSAO', 'Entre na sua conta pra agendar'); end if;
  c := privado.normalizar_cliente(p_dados -> 'cliente');
  pref := privado.normalizar_preferencia(p_dados ->> 'preferenciaProfissional');
  conteudo := jsonb_build_object('cliente', c, 'pacote', p_dados -> 'pacote', 'primeiraData', p_dados -> 'primeiraData', 'turno', p_dados -> 'turno', 'preferencia', pref);
  r := privado.idem_ler('confirmarAutoagendamento', s, p_chave, conteudo);
  if r is not null then return r; end if;
  perform set_config('app.ator', 'cliente', true);
  select * into cli from public.clientes where usuario_id = (s ->> 'usuarioId')::uuid for update;
  tipo_doc := case when c ? 'cnpj' then 'cnpj' when c ? 'cpf' then 'cpf' end;
  doc := coalesce(c ->> 'cnpj', c ->> 'cpf');
  if found then
    if cli.documento is not null and doc is not null and (cli.tipo_documento, cli.documento) <> (tipo_doc, doc) then
      perform privado.erro('DADOS_INVALIDOS', 'O CPF/CNPJ informado não confere com o do seu cadastro. Fale com a Prime.', jsonb_build_object(coalesce(tipo_doc, 'cpf'), 'Não confere com o cadastro'));
    end if;
    update public.clientes set tipo = c ->> 'tipo', nome = c ->> 'nome', telefone = c ->> 'telefone', email = coalesce(email, c ->> 'email'),
      tipo_documento = coalesce(tipo_documento, tipo_doc), documento = coalesce(documento, doc),
      razao_social = c ->> 'razaoSocial', responsavel = c ->> 'responsavel', endereco = c -> 'endereco'
     where id = cli.id returning * into cli;
  else
    insert into public.clientes (usuario_id, tipo, nome, telefone, email, tipo_documento, documento, razao_social, responsavel, endereco, origem, ficticio)
    values ((s ->> 'usuarioId')::uuid, c ->> 'tipo', c ->> 'nome', c ->> 'telefone', c ->> 'email', tipo_doc, doc, c ->> 'razaoSocial', c ->> 'responsavel', c -> 'endereco', 'site',
            coalesce((select (u.raw_user_meta_data ->> 'ficticio')::boolean from auth.users u where u.id = (s ->> 'usuarioId')::uuid), false))
    returning * into cli;
  end if;
  res := privado.gravar_solicitacao(cli, p_dados -> 'pacote', p_dados ->> 'primeiraData', p_dados ->> 'turno', pref, cli.ficticio);
  perform privado.idem_gravar('confirmarAutoagendamento', s, p_chave, conteudo, res);
  return res;
exception when unique_violation then
  perform privado.erro('DADOS_INVALIDOS', 'Já existe cadastro com este CPF/CNPJ. Entre com a conta dele ou fale com a Prime.', jsonb_build_object(coalesce(tipo_doc, 'cpf'), 'Já cadastrado'));
end $$;

-- ---------- Prime: disponibilidade, recusa e estorno ----------
/**
 * A Prime confirma a disponibilidade e a cobrança nasce na mesma transação: solicitado -> disponibilidade_confirmada ->
 * aguardando_pagamento. Com o Asaas (B4) a emissão vira chamada externa e o pedido pode parar em disponibilidade_confirmada.
 */
create or replace function public.confirmar_disponibilidade(p_id uuid, p_dados jsonb, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; p public.pedidos; obs text; cobr jsonb; c jsonb; g public.pagamentos; ids jsonb := '[]'; agora text := privado.agora_iso();
        conteudo jsonb;
begin
  perform privado.exigir_prime(s);
  obs := left(regexp_replace(trim(coalesce(p_dados ->> 'observacao', '')), '\s+', ' ', 'g'), 300);
  conteudo := jsonb_build_object('id', p_id, 'obs', obs);
  r := privado.idem_ler('confirmarDisponibilidade', s, p_chave, conteudo);
  if r is not null then return r; end if;
  perform set_config('app.ator', 'prime', true);
  select * into p from public.pedidos where id = p_id for update;
  if not found then perform privado.erro('NAO_ENCONTRADO', 'Pedido não encontrado'); end if;
  if p.status <> 'solicitado' then perform privado.erro('TRANSICAO_PROIBIDA', 'Não é possível "confirmar_disponibilidade" com o pedido "' || p.status || '"'); end if;
  cobr := privado.calcular_cobrancas((select coalesce(jsonb_agg(jsonb_build_object('sequencia', a.sequencia, 'data', to_char(a.data, 'YYYY-MM-DD'), 'valorDiaCentavos', a.valor_dia_centavos)), '[]')
                                        from public.atendimentos a where a.pedido_id = p.id and a.status <> 'cancelado'),
                                     coalesce(p.pacote ->> 'modoPagamento', 'por_diaria'), privado.cfg());
  for c in select * from jsonb_array_elements(cobr) loop
    g := privado.nova_cobranca(p.id, case when c ->> 'parcela' = 'diaria' then (select a.id from public.atendimentos a where a.pedido_id = p.id and a.sequencia = (c ->> 'sequencia')::int) end,
                               c, p_chave || ':' || (c ->> 'parcela') || ':' || coalesce(c ->> 'sequencia', '0'));
    ids := ids || to_jsonb(g.id);
  end loop;
  update public.pedidos set status = 'aguardando_pagamento', observacao_disponibilidade = nullif(obs, ''),
    historico = historico || jsonb_build_array(
      jsonb_build_object('de', 'solicitado', 'para', 'disponibilidade_confirmada', 'evento', 'confirmar_disponibilidade', 'em', agora, 'ator', 'prime'),
      jsonb_build_object('de', 'disponibilidade_confirmada', 'para', 'aguardando_pagamento', 'evento', 'emitir_cobranca', 'em', agora, 'ator', 'sistema'))
   where id = p.id returning * into p;
  perform privado.evento('disponibilidade_confirmada', jsonb_build_object('pedidoId', p.id, 'clienteId', p.cliente_id), jsonb_build_object('pagamentos', ids));
  for g in select * from public.pagamentos where pedido_id = p.id and id in (select (x #>> '{}')::uuid from jsonb_array_elements(ids) x) order by vence_em loop
    perform privado.evento('cobranca_emitida', jsonb_strip_nulls(jsonb_build_object('pedidoId', p.id, 'clienteId', p.cliente_id, 'pagamentoId', g.id, 'atendimentoId', g.atendimento_id)));
  end loop;
  r := privado.pedido_completo(p.id) - 'cliente';
  perform privado.idem_gravar('confirmarDisponibilidade', s, p_chave, conteudo, r);
  return r;
end $$;

/** Sem disponibilidade: a Prime recusa com motivo; diárias futuras e cobranças abertas caem. Não recusa pedido já pago. */
create or replace function public.recusar_solicitacao(p_id uuid, p_dados jsonb, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; p public.pedidos; a public.atendimentos; novo public.atendimentos; m text; agora text := privado.agora_iso(); conteudo jsonb;
begin
  perform privado.exigir_prime(s);
  m := regexp_replace(trim(coalesce(p_dados ->> 'motivo', '')), '\s+', ' ', 'g');
  if char_length(m) < 3 or char_length(m) > 300 then perform privado.erro('DADOS_INVALIDOS', 'Escreva o motivo (de 3 a 300 caracteres)', '{"motivo": "Escreva o motivo"}'); end if;
  conteudo := jsonb_build_object('id', p_id, 'm', m);
  r := privado.idem_ler('recusarSolicitacao', s, p_chave, conteudo);
  if r is not null then return r; end if;
  perform set_config('app.ator', 'prime', true);
  select * into p from public.pedidos where id = p_id for update;
  if not found then perform privado.erro('NAO_ENCONTRADO', 'Pedido não encontrado'); end if;
  if p.status not in ('solicitado', 'disponibilidade_confirmada', 'aguardando_pagamento') then
    perform privado.erro('TRANSICAO_PROIBIDA', 'Não é possível "recusar" com o pedido "' || p.status || '"'); end if;
  if privado.algum_pagamento_confirmado(p.id) then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Pedido com pagamento confirmado: cancele as diárias e registre o estorno'); end if;
  for a in select * from public.atendimentos where pedido_id = p.id and status in ('agendado', 'confirmado', 'diarista_a_caminho') order by sequencia for update loop
    novo := privado.transicionar(a, 'cancelar', '{"ator": "prime"}', null);
    update public.atendimentos set status = novo.status, versao = novo.versao, historico = novo.historico where id = a.id;
  end loop;
  update public.pagamentos set status = 'cancelado' where pedido_id = p.id and status in ('pendente', 'informado_pelo_cliente');
  update public.pedidos set status = 'recusado', recusa = jsonb_build_object('em', agora, 'motivo', m, 'ator', 'prime'),
    historico = historico || jsonb_build_object('de', p.status, 'para', 'recusado', 'evento', 'recusar', 'em', agora, 'ator', 'prime')
   where id = p.id;
  perform privado.evento('solicitacao_recusada', jsonb_build_object('pedidoId', p.id, 'clienteId', p.cliente_id), jsonb_build_object('motivo', m));
  r := privado.pedido_completo(p.id) - 'cliente';
  perform privado.idem_gravar('recusarSolicitacao', s, p_chave, conteudo, r);
  return r;
end $$;

/** Imprevisto sem substituição: registro MANUAL do estorno de um pagamento confirmado; diárias cobertas e futuras caem. */
create or replace function public.registrar_estorno(p_id uuid, p_dados jsonb, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; g public.pagamentos; a public.atendimentos; m text; conteudo jsonb; ats jsonb; p public.pedidos;
begin
  perform privado.exigir_prime(s);
  m := regexp_replace(trim(coalesce(p_dados ->> 'motivo', '')), '\s+', ' ', 'g');
  if char_length(m) < 3 or char_length(m) > 300 then perform privado.erro('DADOS_INVALIDOS', 'Escreva o motivo do estorno (de 3 a 300 caracteres)', '{"motivo": "Escreva o motivo"}'); end if;
  conteudo := jsonb_build_object('pagamentoId', p_id, 'm', m);
  r := privado.idem_ler('registrarEstorno', s, p_chave, conteudo);
  if r is not null then return r; end if;
  perform set_config('app.ator', 'prime', true);
  select * into g from public.pagamentos where id = p_id for update;
  if not found then perform privado.erro('NAO_ENCONTRADO', 'Pagamento não encontrado'); end if;
  perform 1 from public.pedidos where id = g.pedido_id for update;
  if g.status <> 'confirmado' then perform privado.erro('PAGAMENTO_NAO_ELEGIVEL', 'Só dá pra estornar pagamento confirmado'); end if;
  update public.pagamentos set status = 'estornado', estorno = jsonb_build_object('em', privado.agora_iso(), 'motivo', m, 'ator', 'prime') where id = g.id returning * into g;
  for a in select * from public.atendimentos where pedido_id = g.pedido_id and (g.parcela = 'pacote' or id = g.atendimento_id)
             and status in ('agendado', 'confirmado', 'diarista_a_caminho') order by sequencia loop
    perform privado.aplicar_transicao(a.id, 'cancelar', '{"ator": "prime"}', null);
  end loop;
  perform privado.evento('estorno_registrado', jsonb_strip_nulls(jsonb_build_object('pedidoId', g.pedido_id, 'pagamentoId', g.id, 'atendimentoId', g.atendimento_id)), jsonb_build_object('motivo', m));
  select * into p from public.pedidos where id = g.pedido_id;
  select coalesce(jsonb_agg(privado.j_atendimento(x) order by x.sequencia), '[]') into ats from public.atendimentos x where x.pedido_id = g.pedido_id;
  r := jsonb_build_object('pagamento', privado.j_pagamento(g), 'pedido', privado.j_pedido(p), 'atendimentos', ats);
  perform privado.idem_gravar('registrarEstorno', s, p_chave, conteudo, r);
  return r;
end $$;

-- ---------- pagamento ----------
/** Confirmação manual pela Prime (o webhook do Asaas, B4, chama a mesma como ator sistema). */
create or replace function public.confirmar_pagamento(p_id uuid, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; g public.pagamentos; p public.pedidos; el jsonb; a public.atendimentos; conteudo jsonb := jsonb_build_object('id', p_id); ats jsonb;
begin
  perform privado.exigir_prime(s);
  r := privado.idem_ler('confirmarPagamento', s, p_chave, conteudo);
  if r is not null then return r; end if;
  perform set_config('app.ator', s ->> 'ator', true);
  select * into g from public.pagamentos where id = p_id for update;
  if not found then perform privado.erro('NAO_ENCONTRADO', 'Pagamento não encontrado'); end if;
  select * into p from public.pedidos where id = g.pedido_id for update;
  el := privado.elegibilidade(g);
  if not (el ->> 'pagavel')::boolean then perform privado.erro('PAGAMENTO_NAO_ELEGIVEL', el ->> 'motivo'); end if;
  update public.pagamentos set status = 'confirmado', confirmado_em = now(), confirmado_por = auth.uid(), metodo = case when s ->> 'ator' = 'prime' then 'manual' else metodo end
   where id = g.id returning * into g;
  perform privado.evento('pagamento_confirmado', jsonb_strip_nulls(jsonb_build_object('pedidoId', g.pedido_id, 'pagamentoId', g.id, 'atendimentoId', g.atendimento_id, 'clienteId', p.cliente_id)), jsonb_build_object('parcela', g.parcela));
  -- a diária paga (ou todas, no pacote) vira confirmada; o pedido fica confirmado no primeiro pagamento
  for a in select * from public.atendimentos where pedido_id = p.id and status = 'agendado' and (g.parcela = 'pacote' or id = g.atendimento_id) order by sequencia loop
    perform privado.aplicar_transicao(a.id, 'confirmar', '{"ator": "sistema"}', null);
  end loop;
  p := privado.atualizar_status_pedido(p.id, 'sistema', 'pagamento_confirmado');
  select coalesce(jsonb_agg(privado.j_atendimento(x) order by x.sequencia), '[]') into ats from public.atendimentos x where x.pedido_id = p.id;
  r := jsonb_build_object('pagamento', privado.j_pagamento(g), 'pedido', privado.j_pedido(p), 'atendimentos', ats);
  perform privado.idem_gravar('confirmarPagamento', s, p_chave, conteudo, r);
  return r;
end $$;

create or replace function public.cancelar_pedido(p_id uuid, p_dados jsonb, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; p public.pedidos; a public.atendimentos; novo public.atendimentos; cancelados uuid[] := '{}'; novo_status text; motivo text;
        conteudo jsonb := jsonb_build_object('id', p_id, 'motivo', p_dados -> 'motivo');
begin
  r := privado.idem_ler('cancelarPedido', s, p_chave, conteudo);
  if r is not null then return r; end if;
  perform set_config('app.ator', s ->> 'ator', true);
  select * into p from public.pedidos where id = p_id for update;
  if not found or not privado.pode_ver_pedido(s, p) then perform privado.erro('NAO_ENCONTRADO', 'Pedido não encontrado'); end if;
  if s ->> 'ator' not in ('cliente', 'prime') then perform privado.erro('ATOR_SEM_PERMISSAO', 'Sem permissão'); end if;
  if p.status in ('cancelado', 'concluido', 'recusado') then perform privado.erro('TRANSICAO_PROIBIDA', 'Pedido já está ' || p.status); end if;
  for a in select * from public.atendimentos where pedido_id = p.id order by sequencia for update loop
    if a.status in ('agendado', 'confirmado', 'diarista_a_caminho') then
      novo := privado.transicionar(a, 'cancelar', s, null);
      update public.atendimentos set status = novo.status, versao = novo.versao, historico = novo.historico where id = a.id;
      cancelados := cancelados || a.id;
    end if;
  end loop;
  perform privado.recalcular_cobrancas_pendentes(p.id);
  -- cobranças abertas das diárias canceladas (e a do pacote, se nada dele vai acontecer) caem; pago continua pago
  update public.pagamentos set status = 'cancelado' where pedido_id = p.id and status in ('pendente', 'informado_pelo_cliente')
     and ((parcela = 'diaria' and atendimento_id = any(cancelados))
          or (parcela = 'pacote' and not exists (select 1 from public.atendimentos x where x.pedido_id = p.id and x.status <> 'cancelado')));
  novo_status := privado.derivar_status_pedido(p.status, p.id);
  motivo := regexp_replace(trim(coalesce(p_dados ->> 'motivo', '')), '\s+', ' ', 'g');
  update public.pedidos set status = novo_status,
    historico = case when novo_status <> p.status then historico || jsonb_build_object('de', p.status, 'para', novo_status, 'evento', 'cancelar_pedido', 'em', privado.agora_iso(), 'ator', s ->> 'ator') else historico end,
    cancelamento = jsonb_build_object('em', privado.agora_iso(), 'ator', s ->> 'ator', 'motivo', motivo, 'atendimentosCancelados', to_jsonb(cancelados))
   where id = p.id;
  perform privado.evento('pedido_cancelado', jsonb_build_object('pedidoId', p.id, 'clienteId', p.cliente_id), jsonb_build_object('atendimentosCancelados', to_jsonb(cancelados)));
  r := privado.pedido_completo(p.id) - 'cliente';
  perform privado.idem_gravar('cancelarPedido', s, p_chave, conteudo, r);
  return r;
end $$;

create or replace function public.obter_atendimento(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator(); a public.atendimentos; p public.pedidos; c public.clientes; d public.diaristas; g public.pagamentos; v public.avaliacoes;
begin
  select * into a from public.atendimentos where id = p_id;
  if found then select * into p from public.pedidos where id = a.pedido_id; end if;
  if not found or not (privado.pode_ver_pedido(s, p) or (s ->> 'ator' = 'diarista' and (s ->> 'id')::uuid is not distinct from a.diarista_id and a.diarista_id is not null)) then
    perform privado.erro('NAO_ENCONTRADO', 'Atendimento não encontrado'); end if;
  select * into c from public.clientes where id = p.cliente_id;
  if a.diarista_id is not null then select * into d from public.diaristas where id = a.diarista_id; end if;
  select * into g from public.pagamentos where status <> 'cancelado' and ((parcela = 'diaria' and atendimento_id = a.id) or (parcela = 'pacote' and pedido_id = a.pedido_id))
   order by (parcela = 'diaria') desc, criado_em desc limit 1;
  select * into v from public.avaliacoes where atendimento_id = a.id;
  return jsonb_build_object('atendimento', privado.j_atendimento(a), 'pedido', privado.j_pedido(p),
    'cliente', jsonb_build_object('id', c.id, 'nome', c.nome, 'endereco', jsonb_build_object('bairro', c.endereco ->> 'bairro', 'cidade', c.endereco ->> 'cidade')),
    'diarista', case when d.id is not null then jsonb_build_object('id', d.id, 'nome', d.nome, 'status', d.status) end,
    -- diarista não vê cobrança
    'pagamento', case when g.id is not null and s ->> 'ator' <> 'diarista' then privado.j_pagamento(g) end, 'avaliacao', case when v.id is not null then privado.j_avaliacao(v) end);
end $$;

-- ---------- privilégios ----------
do $$ declare f text; begin
  foreach f in array array['confirmar_disponibilidade(uuid, jsonb, text)', 'recusar_solicitacao(uuid, jsonb, text)', 'registrar_estorno(uuid, jsonb, text)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;
revoke all on function privado.calcular_cobrancas(jsonb, text, jsonb), privado.diaria_paga(public.atendimentos), privado.algum_pagamento_confirmado(uuid),
  privado.recalcular_cobrancas_pendentes(uuid), privado.nova_cobranca(uuid, uuid, jsonb, text), privado.normalizar_preferencia(text),
  privado.gravar_solicitacao(public.clientes, jsonb, text, text, text, boolean) from public, anon, authenticated;
