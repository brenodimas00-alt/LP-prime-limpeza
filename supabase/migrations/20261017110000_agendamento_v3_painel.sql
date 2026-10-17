-- Autoagendamento v3, V6: painel e automações (spec seção 4; itens 34, 38 a 46).
-- 1) Confirmação da disponibilidade de pedido v3: nasce SÓ a 1ª cobrança (integral; ou metade_1 do pacote; ou a de
--    faturamento empresarial, "A faturar", sem pagamento antecipado), o cupom e a condição de uso único são consumidos
--    aqui (item 43), na mesma transação. Pagamento das parcelas: integral/faturamento confirmam todas as diárias; metade_1 as
--    da primeira metade; metade_2 as da segunda.
-- 2) Rotina da 2ª parcela do pacote (item 39, 0.7): roda de 15 em 15 min e age a partir do horário configurado
--    (PRECOS.v3.pagamento.horaRotina, padrão 08:00), gera a cobrança da segunda metade na data de envio (2 dias antes do
--    vencimento) com o marco pela agenda VIGENTE, uma vez por pedido (índice único pedido + parcela), e dispara o evento
--    que manda a mensagem C17. Remarcação recalcula marco e vencimento de 2ª parcela ainda pendente.
-- 3) Mensagens: C01 com o número da solicitação; C04 diz a que se refere a cobrança; C02 não sai pra faturamento; C17 nova.
-- 4) Motivo padronizado de recusa e de cancelamento (rótulo escolhido no painel vira código no pedido, pro dashboard).
-- 5) RPCs do painel: cadastros sem solicitação, ficha do cliente (endereços, condição comercial, faturamento), cupons,
--    conteúdo do agendamento, feriados e faixas de CEP. Escrita de regra comercial só prime_admin.

-- ---------------------------------------------------------------- serialização (pedido e atendimento v3 no painel)
create or replace function privado.j_atendimento(a public.atendimentos) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object('id', a.id, 'pedidoId', a.pedido_id, 'sequencia', a.sequencia, 'data', to_char(a.data, 'YYYY-MM-DD'), 'turno', a.turno,
    'horaInicio', to_char(a.hora_inicio, 'HH24:MI'), 'duracaoMinutos', a.duracao_minutos,
    'diaristaId', a.diarista_id, 'status', a.status, 'historico', a.historico, 'valorDiaCentavos', a.valor_dia_centavos, 'taxaDiaCentavos', a.taxa_dia_centavos,
    'deslocada', a.deslocada, 'dataOriginal', case when a.data_original is not null then to_char(a.data_original, 'YYYY-MM-DD') end, 'versao', a.versao,
    'enderecoId', a.endereco_id, 'endereco', a.endereco, 'servico', a.servico, 'caracteristicas', a.caracteristicas, 'localRefeicao', a.local_refeicao,
    'duracaoRecomendadaHoras', a.duracao_recomendada_horas, 'justificativa', a.justificativa, 'taxas', a.taxas, 'itens', a.itens,
    'criadoEm', to_char(a.criado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
$$;

create or replace function privado.j_pedido(p public.pedidos) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object('id', p.id, 'clienteId', p.cliente_id, 'pacote', p.pacote, 'status', p.status, 'historico', p.historico,
    'cancelamento', p.cancelamento, 'recusa', p.recusa, 'preferenciaProfissional', p.preferencia_profissional, 'observacaoDisponibilidade', p.observacao_disponibilidade,
    'endereco', p.endereco, 'dadosInformados', p.dados_informados, 'aceiteCondicoes', p.aceite_condicoes,
    'numeroSolicitacao', p.numero_solicitacao, 'modalidade', p.modalidade, 'origemCliente', p.origem_cliente,
    'cupomCodigo', (select c.codigo from public.cupons c where c.id = p.cupom_id), 'condicaoComercialId', p.condicao_comercial_id,
    'pacoteEnderecoNovo', case when p.pacote_endereco_novo then true end, 'faturamento', case when p.faturamento then true end,
    'atendimentoIds', (select coalesce(jsonb_agg(a.id order by a.sequencia), '[]') from public.atendimentos a where a.pedido_id = p.id),
    'criadoEm', to_char(p.criado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
$$;

create or replace function privado.j_pagamento_v3(g public.pagamentos) returns jsonb
language sql stable set search_path = '' as $$
  select privado.j_pagamento(g) || jsonb_strip_nulls(jsonb_build_object('marco', g.marco, 'marcoData', to_char(g.marco_data, 'YYYY-MM-DD'),
    'envioEm', to_char(g.envio_em, 'YYYY-MM-DD'), 'enviadoEm', g.enviado_em, 'formaFaturamento', g.forma_faturamento, 'nfEmitir', g.nf_emitir))
$$;

-- ---------------------------------------------------------------- parcelas v3
/** Parcelas previstas pela agenda VIGENTE do pedido (diárias não canceladas) e o total do pedido. */
create or replace function privado.v3_parcelas_do_pedido(p public.pedidos) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_datas text[]; v_fat jsonb;
begin
  select array_agg(to_char(a.data, 'YYYY-MM-DD') order by a.data) into v_datas from public.atendimentos a where a.pedido_id = p.id and a.status <> 'cancelado';
  if p.faturamento then
    select jsonb_build_object('prazoDias', f.prazo_dias, 'forma', f.forma, 'nf', f.nf) into v_fat from public.faturamento_empresarial f where f.cliente_id = p.cliente_id;
    v_fat := coalesce(v_fat, '{"prazoDias": 0, "forma": "pix", "nf": true}');
  end if;
  return privado.v3_parcelas(p.modalidade, coalesce(v_datas, '{}'), p.total_centavos, v_fat, privado.cfg_v3());
end $$;

/** Cria a cobrança de uma parcela v3 (com marco, envio e dados do faturamento). */
create or replace function privado.v3_nova_parcela(p public.pedidos, c jsonb, p_chave text) returns public.pagamentos
language plpgsql security definer set search_path = '' as $$
declare g public.pagamentos; v_fat public.faturamento_empresarial;
begin
  g := privado.nova_cobranca(p.id, null, c || '{"descontoCentavos": 0}', p_chave);
  if c ->> 'parcela' = 'faturamento' then select * into v_fat from public.faturamento_empresarial where cliente_id = p.cliente_id; end if;
  update public.pagamentos set marco = c ->> 'marco', marco_data = (c ->> 'marcoData')::date, envio_em = (c ->> 'envioEm')::date,
    enviado_em = case when c ->> 'parcela' = 'metade_2' then now() end,
    forma_faturamento = case when c ->> 'parcela' = 'faturamento' then coalesce(v_fat.forma, 'pix') end,
    nf_emitir = case when c ->> 'parcela' = 'faturamento' then coalesce(v_fat.nf, true) end,
    brcode = case when c ->> 'parcela' = 'faturamento' and coalesce(v_fat.forma, 'pix') = 'transferencia' then null else brcode end
   where id = g.id returning * into g;
  return g;
end $$;

-- ---------------------------------------------------------------- confirmação (redefinida a partir de 20260930100000)
create or replace function public.confirmar_disponibilidade(p_id uuid, p_dados jsonb, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; p public.pedidos; obs text; cobr jsonb; c jsonb; g public.pagamentos; ids jsonb := '[]'; agora text := privado.agora_iso();
        conteudo jsonb; aj record; at public.atendimentos; ajustes jsonb; v3 boolean; v_permitidos text[]; v_cup public.cupons; v_usos int;
begin
  perform privado.exigir_prime(s);
  obs := left(regexp_replace(trim(coalesce(p_dados ->> 'observacao', '')), '\s+', ' ', 'g'), 300);
  ajustes := case when jsonb_typeof(p_dados -> 'horarios') = 'object' then p_dados -> 'horarios' else '{}' end;
  conteudo := jsonb_build_object('id', p_id, 'obs', obs) || case when ajustes <> '{}' then jsonb_build_object('ajustes', ajustes) else '{}' end;
  r := privado.idem_ler('confirmarDisponibilidade', s, p_chave, conteudo);
  if r is not null then return r; end if;
  perform set_config('app.ator', 'prime', true);
  select * into p from public.pedidos where id = p_id for update;
  if not found then perform privado.erro('NAO_ENCONTRADO', 'Pedido não encontrado'); end if;
  if p.status <> 'solicitado' then perform privado.erro('TRANSICAO_PROIBIDA', 'Não é possível "confirmar_disponibilidade" com o pedido "' || p.status || '"'); end if;
  v3 := p.pacote ->> 'versao' = '3';
  for aj in select key, value from jsonb_each(ajustes) loop
    select * into at from public.atendimentos where id = (case when aj.key ~ '^[0-9a-f-]{36}$' then aj.key::uuid end) and pedido_id = p.id for update;
    if not found then perform privado.erro('DADOS_INVALIDOS', 'Diária de outro pedido'); end if;
    v_permitidos := case when v3 then privado.v3_horarios(at.duracao_minutos / 60, at.data, privado.cfg_v3()) else privado.horarios_inicio(at.duracao_minutos / 60, privado.cfg()) end;
    if jsonb_typeof(aj.value) <> 'string' or not (aj.value #>> '{}') = any(v_permitidos) then
      perform privado.erro('DATA_INVALIDA', 'Horário ' || (aj.value #>> '{}') || ' fora do horário de trabalho para ' || (at.duracao_minutos / 60) || ' horas'); end if;
    if at.hora_inicio <> (aj.value #>> '{}')::time then
      if at.diarista_id is not null then
        perform 1 from public.diaristas where id = at.diarista_id for update;
        at.hora_inicio := (aj.value #>> '{}')::time;
        if exists (select 1 from public.atendimentos x where x.diarista_id = at.diarista_id and x.id <> at.id and x.status <> 'cancelado' and privado.sobrepoe(at, x)) then
          perform privado.erro('CONDICAO_NAO_ATENDIDA', 'A profissional já tem outra diária nesse horário em ' || to_char(at.data, 'DD/MM') || '. Escolha outro horário ou troque a profissional.');
        end if;
      end if;
      update public.atendimentos set hora_inicio = (aj.value #>> '{}')::time, turno = null, versao = versao + 1 where id = at.id;
    end if;
  end loop;
  if v3 then
    -- v3: só a 1ª cobrança agora (a 2ª parcela do pacote nasce na rotina da manhã, na data de envio)
    for c in select x from jsonb_array_elements(privado.v3_parcelas_do_pedido(p)) x where x ->> 'parcela' <> 'metade_2' loop
      g := privado.v3_nova_parcela(p, c, p_chave || ':' || (c ->> 'parcela'));
      ids := ids || to_jsonb(g.id);
    end loop;
    -- cupom e condição de uso único: consumidos na contratação confirmada (item 43)
    if p.cupom_id is not null then
      select * into v_cup from public.cupons where id = p.cupom_id for update;
      insert into public.cupons_uso (cupom_id, pedido_id, cliente_id, desconto_centavos)
      values (p.cupom_id, p.id, p.cliente_id, coalesce((select sum((d ->> 'centavos')::bigint) from jsonb_array_elements(p.pacote -> 'descontos') d where d ->> 'codigo' = 'cupom'), 0))
      on conflict (pedido_id) do nothing;
    end if;
    if p.condicao_comercial_id is not null then
      update public.condicoes_comerciais set consumida_em = now(), consumida_pedido = p.id
       where id = p.condicao_comercial_id and validade = 'uso_unico' and consumida_em is null;
    end if;
  else
    cobr := privado.calcular_cobrancas((select coalesce(jsonb_agg(jsonb_build_object('sequencia', a.sequencia, 'data', to_char(a.data, 'YYYY-MM-DD'), 'valorDiaCentavos', a.valor_dia_centavos)), '[]')
                                          from public.atendimentos a where a.pedido_id = p.id and a.status <> 'cancelado'),
                                       coalesce(p.pacote ->> 'modoPagamento', 'por_diaria'), privado.cfg());
    for c in select * from jsonb_array_elements(cobr) loop
      g := privado.nova_cobranca(p.id, case when c ->> 'parcela' = 'diaria' then (select a.id from public.atendimentos a where a.pedido_id = p.id and a.sequencia = (c ->> 'sequencia')::int) end,
                                 c, p_chave || ':' || (c ->> 'parcela') || ':' || coalesce(c ->> 'sequencia', '0'));
      ids := ids || to_jsonb(g.id);
    end loop;
  end if;
  if v3 and p.faturamento then
    -- faturamento empresarial autorizado: sem pagamento antecipado; a cobrança fica "A faturar" (item 40)
    update public.pedidos set status = 'confirmado', observacao_disponibilidade = nullif(obs, ''),
      historico = historico || jsonb_build_array(
        jsonb_build_object('de', 'solicitado', 'para', 'disponibilidade_confirmada', 'evento', 'confirmar_disponibilidade', 'em', agora, 'ator', 'prime'),
        jsonb_build_object('de', 'disponibilidade_confirmada', 'para', 'confirmado', 'evento', 'faturamento_empresarial', 'em', agora, 'ator', 'sistema'))
     where id = p.id returning * into p;
    for at in select * from public.atendimentos where pedido_id = p.id and status = 'agendado' order by sequencia loop
      perform privado.aplicar_transicao(at.id, 'confirmar', '{"ator": "sistema"}', null);
    end loop;
  else
    update public.pedidos set status = 'aguardando_pagamento', observacao_disponibilidade = nullif(obs, ''),
      historico = historico || jsonb_build_array(
        jsonb_build_object('de', 'solicitado', 'para', 'disponibilidade_confirmada', 'evento', 'confirmar_disponibilidade', 'em', agora, 'ator', 'prime'),
        jsonb_build_object('de', 'disponibilidade_confirmada', 'para', 'aguardando_pagamento', 'evento', 'emitir_cobranca', 'em', agora, 'ator', 'sistema'))
     where id = p.id returning * into p;
  end if;
  perform privado.evento('disponibilidade_confirmada', jsonb_build_object('pedidoId', p.id, 'clienteId', p.cliente_id), jsonb_build_object('pagamentos', ids, 'faturamento', p.faturamento));
  for g in select * from public.pagamentos where pedido_id = p.id and id in (select (x #>> '{}')::uuid from jsonb_array_elements(ids) x) order by vence_em loop
    perform privado.evento('cobranca_emitida', jsonb_strip_nulls(jsonb_build_object('pedidoId', p.id, 'clienteId', p.cliente_id, 'pagamentoId', g.id, 'atendimentoId', g.atendimento_id)));
  end loop;
  r := privado.pedido_completo(p.id) - 'cliente';
  perform privado.idem_gravar('confirmarDisponibilidade', s, p_chave, conteudo, r);
  return r;
end $$;

-- ---------------------------------------------------------------- pagamento das parcelas v3
create or replace function privado.elegibilidade(g public.pagamentos) returns jsonb
language plpgsql stable set search_path = '' as $$
declare p public.pedidos; a public.atendimentos;
begin
  if g.status = 'confirmado' then return '{"pagavel": false, "motivo": "Pagamento já confirmado pela Prime"}'; end if;
  if g.status = 'estornado' then return '{"pagavel": false, "motivo": "Pagamento estornado"}'; end if;
  if g.status = 'cancelado' then return '{"pagavel": false, "motivo": "Cobrança cancelada"}'; end if;
  select * into p from public.pedidos where id = g.pedido_id;
  if p.status not in ('aguardando_pagamento', 'confirmado', 'concluido') then return '{"pagavel": false, "motivo": "Este pedido não está aguardando pagamento"}'; end if;
  if g.parcela in ('pacote', 'integral', 'metade_1', 'metade_2', 'faturamento') then return '{"pagavel": true}'; end if;
  if g.parcela in ('diaria', 'hora_extra') then
    select * into a from public.atendimentos where id = g.atendimento_id;
    if a.id is null then return '{"pagavel": false, "motivo": "Diária não encontrada"}'; end if;
    if a.status = 'cancelado' then return '{"pagavel": false, "motivo": "Diária cancelada"}'; end if;
    return '{"pagavel": true}';
  end if;
  return '{"pagavel": false, "motivo": "Cobrança antiga. Fale com a Prime."}';
end $$;

/** Diárias que uma cobrança paga: integral/faturamento/pacote todas; metade_1 as antes do marco; metade_2 a partir dele. */
create or replace function privado.v3_cobre(g public.pagamentos, a public.atendimentos) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_marco date;
begin
  if g.parcela in ('pacote', 'integral', 'faturamento') then return true; end if;
  if g.parcela in ('metade_1', 'metade_2') then
    v_marco := privado.v3_marco((select array_agg(to_char(x.data, 'YYYY-MM-DD')) from public.atendimentos x where x.pedido_id = g.pedido_id and x.status <> 'cancelado'))::date;
    return case when g.parcela = 'metade_1' then a.data < v_marco else a.data >= v_marco end;
  end if;
  return a.id = g.atendimento_id;
end $$;

create or replace function public.confirmar_pagamento(p_id uuid, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; g public.pagamentos; p public.pedidos; el jsonb; a public.atendimentos; conteudo jsonb := jsonb_build_object('id', p_id); ats jsonb;
begin
  perform privado.exigir_prime(s);
  r := privado.idem_ler('confirmarPagamento', s, p_chave, conteudo);
  if r is not null then return r; end if;
  perform set_config('app.ator', s ->> 'ator', true);
  select * into g from public.pagamentos where id = p_id;
  if not found then perform privado.erro('NAO_ENCONTRADO', 'Pagamento não encontrado'); end if;
  select * into p from public.pedidos where id = g.pedido_id for update;
  select * into g from public.pagamentos where id = p_id for update;
  el := privado.elegibilidade(g);
  if not (el ->> 'pagavel')::boolean then perform privado.erro('PAGAMENTO_NAO_ELEGIVEL', el ->> 'motivo'); end if;
  update public.pagamentos set status = 'confirmado', confirmado_em = now(), confirmado_por = auth.uid(), metodo = case when s ->> 'ator' = 'prime' then 'manual' else metodo end
   where id = g.id returning * into g;
  perform privado.evento('pagamento_confirmado', jsonb_strip_nulls(jsonb_build_object('pedidoId', g.pedido_id, 'pagamentoId', g.id, 'atendimentoId', g.atendimento_id, 'clienteId', p.cliente_id)), jsonb_build_object('parcela', g.parcela));
  for a in select * from public.atendimentos where pedido_id = p.id and status = 'agendado' order by sequencia loop
    if privado.v3_cobre(g, a) then perform privado.aplicar_transicao(a.id, 'confirmar', '{"ator": "sistema"}', null); end if;
  end loop;
  p := privado.atualizar_status_pedido(p.id, 'sistema', 'pagamento_confirmado');
  select coalesce(jsonb_agg(privado.j_atendimento(x) order by x.sequencia), '[]') into ats from public.atendimentos x where x.pedido_id = p.id;
  r := jsonb_build_object('pagamento', privado.j_pagamento(g), 'pedido', privado.j_pedido(p), 'atendimentos', ats);
  perform privado.idem_gravar('confirmarPagamento', s, p_chave, conteudo, r);
  return r;
end $$;

create or replace function privado.dados_recibo(g public.pagamentos) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'pagador', c.nome, 'tipoDocumento', c.tipo_documento, 'documento', c.documento, 'razaoSocial', c.razao_social,
    'valorCentavos', g.valor_centavos, 'metodo', g.metodo, 'confirmadoEm', g.confirmado_em, 'pedidoId', p.id,
    'referente', case g.parcela
      when 'pacote' then 'Pacote de diárias de limpeza'
      when 'integral' then 'Solicitação nº ' || lpad(p.numero_solicitacao::text, 6, '0')
      when 'metade_1' then 'Pacote de diárias, 1ª parte (solicitação nº ' || lpad(p.numero_solicitacao::text, 6, '0') || ')'
      when 'metade_2' then 'Pacote de diárias, 2ª parte (solicitação nº ' || lpad(p.numero_solicitacao::text, 6, '0') || ')'
      when 'faturamento' then 'Faturamento empresarial (solicitação nº ' || lpad(p.numero_solicitacao::text, 6, '0') || ')'
      when 'hora_extra' then 'Hora extra da diária de limpeza de ' || to_char(a.data, 'DD/MM/YYYY')
      else 'Diária de limpeza de ' || to_char(a.data, 'DD/MM/YYYY') || coalesce(', das ' || to_char(a.hora_inicio, 'HH24:MI') || ' às ' || to_char(a.hora_inicio + make_interval(mins => a.duracao_minutos), 'HH24:MI'), '') end)
  from public.pedidos p join public.clientes c on c.id = p.cliente_id left join public.atendimentos a on a.id = g.atendimento_id
  where p.id = g.pedido_id
$$;

-- ---------------------------------------------------------------- 2ª parcela do pacote (item 39)
/**
 * Rotina da manhã: gera a 2ª parcela dos pacotes v3 cuja data de envio chegou (pela agenda vigente). Antes do horário da
 * rotina não faz nada. Idempotente: o índice único (pedido, parcela) não deixa duas; a chave é pedido + 'metade_2'.
 * @returns quantas cobranças gerou
 */
create or replace function privado.v3_rotina_parcela2(p_agora timestamptz default now()) returns int
language plpgsql security definer set search_path = '' as $$
declare cfg jsonb := privado.cfg_v3(); v_hoje date := (p_agora at time zone 'America/Sao_Paulo')::date; v_hora text := to_char(p_agora at time zone 'America/Sao_Paulo', 'HH24:MI');
        p public.pedidos; c jsonb; g public.pagamentos; n int := 0;
begin
  if v_hora < coalesce(cfg #>> '{PRECOS,v3,pagamento,horaRotina}', '08:00') then return 0; end if;
  perform set_config('app.ator', 'sistema', true);
  for p in select x.* from public.pedidos x
            where x.modalidade = 'pacote' and x.pacote ->> 'versao' = '3' and not x.faturamento and x.status in ('aguardando_pagamento', 'confirmado')
              and exists (select 1 from public.pagamentos m where m.pedido_id = x.id and m.parcela = 'metade_1' and m.status <> 'cancelado')
              and not exists (select 1 from public.pagamentos m where m.pedido_id = x.id and m.parcela = 'metade_2' and m.status <> 'cancelado')
            for update skip locked loop
    select x into c from jsonb_array_elements(privado.v3_parcelas_do_pedido(p)) x where x ->> 'parcela' = 'metade_2';
    if c is null or (c ->> 'envioEm')::date > v_hoje then continue; end if;
    -- o valor da 2ª parcela é o total menos o que a 1ª cobrou (a 1ª pode ter sido calculada antes de uma mudança)
    c := c || jsonb_build_object('valorCentavos', p.total_centavos - coalesce((select valor_centavos from public.pagamentos where pedido_id = p.id and parcela = 'metade_1' and status <> 'cancelado' limit 1), 0));
    begin
      g := privado.v3_nova_parcela(p, c, 'parcela2:' || p.id);
    exception when unique_violation then continue;
    end;
    perform privado.evento('cobranca_emitida', jsonb_build_object('pedidoId', p.id, 'clienteId', p.cliente_id, 'pagamentoId', g.id));
    perform privado.evento('cobranca_parcela2_emitida', jsonb_build_object('pedidoId', p.id, 'clienteId', p.cliente_id, 'pagamentoId', g.id), jsonb_build_object('valorCentavos', g.valor_centavos));
    n := n + 1;
  end loop;
  return n;
end $$;
select cron.schedule('prime-cobranca-parcela2', '*/15 * * * *', $$select privado.v3_rotina_parcela2(now())$$);

/** Teste e painel: roda a rotina num instante dado (só papel de serviço). */
create or replace function public.rodar_rotina_parcela2(p_agora timestamptz) returns int
language sql security definer set search_path = '' as $$ select privado.v3_rotina_parcela2(p_agora) $$;
revoke execute on function public.rodar_rotina_parcela2(timestamptz) from public, anon, authenticated;
grant execute on function public.rodar_rotina_parcela2(timestamptz) to service_role;

/** Remarcação muda a agenda: a 2ª parcela ainda pendente acompanha o marco, o vencimento e a data de envio. */
create or replace function privado.v3_recalcular_parcela2() returns trigger
language plpgsql security definer set search_path = '' as $$
declare p public.pedidos; c jsonb;
begin
  if new.data is not distinct from old.data and new.status is not distinct from old.status then return new; end if;
  select * into p from public.pedidos where id = new.pedido_id;
  if p.modalidade is distinct from 'pacote' or p.pacote ->> 'versao' is distinct from '3' then return new; end if;
  select x into c from jsonb_array_elements(privado.v3_parcelas_do_pedido(p)) x where x ->> 'parcela' = 'metade_2';
  if c is null then return new; end if;
  update public.pagamentos set marco_data = (c ->> 'marcoData')::date, vence_em = (c ->> 'venceEm')::date, envio_em = (c ->> 'envioEm')::date
   where pedido_id = p.id and parcela = 'metade_2' and status = 'pendente'
     and (marco_data is distinct from (c ->> 'marcoData')::date or vence_em is distinct from (c ->> 'venceEm')::date);
  return new;
end $$;
create trigger v3_recalcular_parcela2 after update of data, status on public.atendimentos for each row execute function privado.v3_recalcular_parcela2();

-- ---------------------------------------------------------------- motivos padronizados (dashboard)
create or replace function public.motivos_padrao() returns jsonb
language sql immutable set search_path = '' as $$
  select '{
    "recusa": [
      {"codigo": "sem_disponibilidade", "rotulo": "Sem disponibilidade na data ou no horário"},
      {"codigo": "fora_da_area", "rotulo": "Endereço fora da área atendida"},
      {"codigo": "servico_nao_realizado", "rotulo": "Serviço que a Prime não realiza"},
      {"codigo": "endereco_pacote", "rotulo": "Endereço novo no pacote não aprovado"},
      {"codigo": "dados_incompletos", "rotulo": "Dados incompletos ou sem retorno da cliente"},
      {"codigo": "outro", "rotulo": "Outro"}],
    "cancelamento": [
      {"codigo": "pedido_cliente", "rotulo": "Pedido da cliente"},
      {"codigo": "pagamento_nao_identificado", "rotulo": "Pagamento não identificado no prazo"},
      {"codigo": "sem_profissional", "rotulo": "Sem profissional disponível"},
      {"codigo": "imprevisto_local", "rotulo": "Imprevisto no local (sem água, sem energia)"},
      {"codigo": "outro", "rotulo": "Outro"}]
  }'::jsonb
$$;
grant execute on function public.motivos_padrao() to authenticated;

/** O painel escreve "Rótulo: detalhe"; o código do rótulo vai junto no pedido. */
create or replace function privado.codigo_do_motivo() returns trigger
language plpgsql security definer set search_path = '' as $$
declare m jsonb;
begin
  if new.recusa is not null and old.recusa is null and not new.recusa ? 'codigo' then
    select x into m from jsonb_array_elements(public.motivos_padrao() -> 'recusa') x where new.recusa ->> 'motivo' like (x ->> 'rotulo') || '%' order by length(x ->> 'rotulo') desc limit 1;
    if m is not null then new.recusa := new.recusa || jsonb_build_object('codigo', m ->> 'codigo'); end if;
  end if;
  if new.cancelamento is not null and old.cancelamento is null and not new.cancelamento ? 'codigo' then
    select x into m from jsonb_array_elements(public.motivos_padrao() -> 'cancelamento') x where new.cancelamento ->> 'motivo' like (x ->> 'rotulo') || '%' order by length(x ->> 'rotulo') desc limit 1;
    if m is not null then new.cancelamento := new.cancelamento || jsonb_build_object('codigo', m ->> 'codigo'); end if;
  end if;
  return new;
end $$;
create trigger codigo_do_motivo before update of recusa, cancelamento on public.pedidos for each row execute function privado.codigo_do_motivo();

-- ---------------------------------------------------------------- RPCs do painel
create or replace function privado.exigir_admin(s jsonb) returns void
language plpgsql stable set search_path = '' as $$
begin
  perform privado.exigir_prime(s);
  if s ->> 'papel' <> 'prime_admin' then perform privado.erro('ATOR_SEM_PERMISSAO', 'Só a administração da Prime muda esta configuração'); end if;
end $$;

/** Item 34: cadastros que nunca enviaram solicitação (só os do site; não mistura com quem já solicitou). */
create or replace function public.listar_cadastros_sem_solicitacao(p_filtro jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator(); v_status text := nullif(p_filtro ->> 'status', ''); v_lim int := least(greatest(coalesce((p_filtro ->> 'limite')::int, 50), 1), 200);
        v_pag int := greatest(coalesce((p_filtro ->> 'pagina')::int, 1), 1);
begin
  perform privado.exigir_prime(s);
  return jsonb_build_object(
    'total', (select count(*) from public.clientes c where c.origem = 'site' and c.anonimizado_em is null and (v_status is null or c.status_prospeccao = v_status)
               and not exists (select 1 from public.pedidos p where p.cliente_id = c.id)),
    'itens', coalesce((select jsonb_agg(x order by x ->> 'criadoEm' desc) from (
      select jsonb_build_object('id', c.id, 'nome', c.nome, 'telefone', c.telefone, 'email', c.email, 'tipo', c.tipo, 'status', c.status_prospeccao,
        'baseLegal', c.base_legal, 'temAcesso', c.usuario_id is not null, 'pendencias', to_jsonb(c.pendencias),
        'criadoEm', to_char(c.criado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) x
        from public.clientes c
       where c.origem = 'site' and c.anonimizado_em is null and (v_status is null or c.status_prospeccao = v_status)
         and not exists (select 1 from public.pedidos p where p.cliente_id = c.id)
       order by c.criado_em desc limit v_lim offset (v_pag - 1) * v_lim) z), '[]'));
end $$;

create or replace function public.definir_status_prospeccao(p_cliente uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform privado.exigir_prime(privado.ator());
  if p_status not in ('novo', 'contatado', 'sem_interesse', 'convertido') then perform privado.erro('DADOS_INVALIDOS', 'Situação inválida'); end if;
  update public.clientes set status_prospeccao = p_status where id = p_cliente and anonimizado_em is null;
  if not found then perform privado.erro('NAO_ENCONTRADO', 'Cliente não encontrado'); end if;
end $$;

/** Ficha do cliente (v3): endereços (ativos, inativos e de uso único), condição comercial (ativa e histórico) e faturamento. */
create or replace function public.ficha_cliente_v3(p_cliente uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator(); c public.clientes;
begin
  perform privado.exigir_prime(s);
  select * into c from public.clientes where id = p_cliente;
  if not found then perform privado.erro('NAO_ENCONTRADO', 'Cliente não encontrado'); end if;
  return jsonb_build_object('id', c.id, 'nome', c.nome, 'tipo', c.tipo,
    'enderecos', coalesce((select jsonb_agg(privado.j_endereco(e) || jsonb_build_object('inativadoMotivo', e.inativado_motivo, 'substituidoPor', e.substituido_por)
                           order by e.ativo desc, e.principal desc, e.criado_em desc) from public.enderecos e where e.cliente_id = c.id), '[]'),
    'condicao', (select to_jsonb(x) - 'cliente_id' from public.condicoes_comerciais x where x.cliente_id = c.id and x.ativa),
    'condicoesAnteriores', coalesce((select jsonb_agg(to_jsonb(x) - 'cliente_id' order by x.criado_em desc) from public.condicoes_comerciais x where x.cliente_id = c.id and not x.ativa), '[]'),
    'faturamento', (select to_jsonb(f) - 'cliente_id' from public.faturamento_empresarial f where f.cliente_id = c.id));
end $$;

/** Item 42: uma condição ativa por cliente; salvar uma nova encerra a anterior (histórico fica). p_dados nulo = "Nenhum". */
create or replace function public.salvar_condicao_comercial(p_cliente uuid, p_dados jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); n public.condicoes_comerciais; v_mod text[];
begin
  perform privado.exigir_admin(s);
  perform 1 from public.clientes where id = p_cliente and anonimizado_em is null for update;
  if not found then perform privado.erro('NAO_ENCONTRADO', 'Cliente não encontrado'); end if;
  update public.condicoes_comerciais set ativa = false where cliente_id = p_cliente and ativa;
  if p_dados is null or jsonb_typeof(p_dados) <> 'object' or coalesce(p_dados ->> 'tipo', '') = '' then return null; end if;
  select coalesce(array_agg(x), '{}') into v_mod from jsonb_array_elements_text(coalesce(p_dados -> 'modalidades', '[]')) x;
  begin
    insert into public.condicoes_comerciais (cliente_id, tipo, valor, modalidades, quantidade_minima, validade, valido_ate, acumula, observacao_interna, criado_por)
    values (p_cliente, p_dados ->> 'tipo', (p_dados ->> 'valor')::bigint, v_mod, nullif(p_dados ->> 'quantidadeMinima', '')::int, p_dados ->> 'validade',
            nullif(p_dados ->> 'validoAte', '')::date, coalesce((p_dados ->> 'acumula')::boolean, false), left(coalesce(p_dados ->> 'observacao', ''), 500), (s ->> 'id')::uuid)
    returning * into n;
  exception when check_violation or invalid_text_representation or numeric_value_out_of_range then
    perform privado.erro('DADOS_INVALIDOS', 'Confira o tipo, o valor (percentual de 1 a 100), as modalidades e a validade (período pede a data).');
  end;
  return to_jsonb(n) - 'cliente_id';
end $$;

/** Itens 40 e 41: faturamento empresarial só por aqui, só pra cliente empresa. */
create or replace function public.salvar_faturamento(p_cliente uuid, p_dados jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); f public.faturamento_empresarial;
begin
  perform privado.exigir_admin(s);
  if (select tipo from public.clientes where id = p_cliente and anonimizado_em is null) is distinct from 'empresa' then
    perform privado.erro('DADOS_INVALIDOS', 'Faturamento empresarial é só para cliente empresa');
  end if;
  begin
    insert into public.faturamento_empresarial (cliente_id, autorizado, forma, prazo_dias, nf, observacao, atualizado_por, atualizado_em)
    values (p_cliente, coalesce((p_dados ->> 'autorizado')::boolean, false), coalesce(p_dados ->> 'forma', 'pix'), coalesce((p_dados ->> 'prazoDias')::int, 0),
            coalesce((p_dados ->> 'nf')::boolean, true), left(coalesce(p_dados ->> 'observacao', ''), 500), (s ->> 'id')::uuid, now())
    on conflict (cliente_id) do update set autorizado = excluded.autorizado, forma = excluded.forma, prazo_dias = excluded.prazo_dias, nf = excluded.nf,
      observacao = excluded.observacao, atualizado_por = excluded.atualizado_por, atualizado_em = now()
    returning * into f;
  exception when check_violation or invalid_text_representation then
    perform privado.erro('DADOS_INVALIDOS', 'Confira a forma (PIX ou transferência) e o prazo (0 a 120 dias).');
  end;
  return to_jsonb(f) - 'cliente_id';
end $$;

/** "Solicitar remoção" (item 9): a Prime inativa o endereço; nada é apagado. */
create or replace function public.inativar_endereco(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform privado.exigir_prime(privado.ator());
  update public.enderecos set ativo = false, principal = false, inativado_em = now(), inativado_motivo = 'remocao_solicitada' where id = p_id and ativo;
  if not found then perform privado.erro('NAO_ENCONTRADO', 'Endereço não encontrado ou já inativo'); end if;
end $$;

/** Cupons (item 35). */
create or replace function public.listar_cupons() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform privado.exigir_prime(privado.ator());
  return coalesce((select jsonb_agg(to_jsonb(c) || jsonb_build_object('usos', (select count(*) from public.cupons_uso u where u.cupom_id = c.id)) order by c.criado_em desc)
                     from public.cupons c), '[]');
end $$;
create or replace function public.salvar_cupom(p_dados jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); c public.cupons; v_mod text[];
begin
  perform privado.exigir_admin(s);
  select coalesce(array_agg(x), '{}') into v_mod from jsonb_array_elements_text(coalesce(p_dados -> 'modalidades', '[]')) x;
  begin
    insert into public.cupons (codigo, tipo, valor, modalidades, primeira_contratacao, valido_ate, limite_de_uso, acumula, ativo, criado_por)
    values (upper(trim(p_dados ->> 'codigo')), p_dados ->> 'tipo', (p_dados ->> 'valor')::bigint, v_mod, coalesce((p_dados ->> 'primeiraContratacao')::boolean, false),
            nullif(p_dados ->> 'validoAte', '')::date, nullif(p_dados ->> 'limiteDeUso', '')::int, coalesce((p_dados ->> 'acumula')::boolean, false),
            coalesce((p_dados ->> 'ativo')::boolean, true), (s ->> 'id')::uuid)
    on conflict (codigo) do update set tipo = excluded.tipo, valor = excluded.valor, modalidades = excluded.modalidades, primeira_contratacao = excluded.primeira_contratacao,
      valido_ate = excluded.valido_ate, limite_de_uso = excluded.limite_de_uso, acumula = excluded.acumula, ativo = excluded.ativo
    returning * into c;
  exception when check_violation or invalid_text_representation or not_null_violation then
    perform privado.erro('DADOS_INVALIDOS', 'Confira o código (3 a 30 letras e números), o tipo e o valor (percentual de 1 a 100).');
  end;
  return to_jsonb(c);
end $$;

/** Conteúdo do agendamento (itens 4 e 8): tipos de imóvel por segmento e o "Ver mais" de cada serviço. */
create or replace function public.salvar_conteudo_agendamento(p_dados jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare k text;
begin
  perform privado.exigir_admin(privado.ator());
  if jsonb_typeof(p_dados -> 'tiposImovel') <> 'object' or jsonb_typeof(p_dados -> 'verMais') <> 'object' then perform privado.erro('DADOS_INVALIDOS', 'Conteúdo inválido'); end if;
  foreach k in array array['residencial', 'empresa'] loop
    if jsonb_typeof(p_dados #> array['tiposImovel', k]) <> 'array' or jsonb_array_length(p_dados #> array['tiposImovel', k]) < 2
       or not (p_dados #> array['tiposImovel', k]) ? 'Outro'
       or exists (select 1 from jsonb_array_elements(p_dados #> array['tiposImovel', k]) t where jsonb_typeof(t) <> 'string' or char_length(t #>> '{}') not between 2 and 40) then
      perform privado.erro('DADOS_INVALIDOS', 'Tipos de imóvel: de 2 a 40 letras cada, sempre com "Outro" no fim');
    end if;
  end loop;
  if exists (select 1 from jsonb_each(p_dados -> 'verMais') x where jsonb_typeof(x.value -> 'naoInclui') <> 'array' or jsonb_typeof(x.value -> 'observacoes') <> 'array') then
    perform privado.erro('DADOS_INVALIDOS', '"Ver mais": cada serviço com a lista do que não inclui e as observações');
  end if;
  insert into public.configuracao (chave, valor) values ('agendamento', jsonb_build_object('tiposImovel', p_dados -> 'tiposImovel', 'verMais', p_dados -> 'verMais'))
  on conflict (chave) do update set valor = excluded.valor, atualizado_em = now();
  return public.conteudo_agendamento();
end $$;

/** Feriados (0.3: cobram, não bloqueiam; "bloqueia" continua possível) e faixas de CEP (0.2, Vila da Serra). */
create or replace function public.listar_feriados_e_faixas() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform privado.exigir_prime(privado.ator());
  return jsonb_build_object(
    'feriados', coalesce((select jsonb_agg(jsonb_build_object('data', to_char(f.data, 'YYYY-MM-DD'), 'descricao', f.descricao, 'bloqueia', f.bloqueia) order by f.data) from public.feriados f where f.data >= privado.hoje_sp() - 30), '[]'),
    'faixasCep', coalesce((select jsonb_agg(to_jsonb(x) order by x.cep_inicio) from public.faixas_cep x), '[]'));
end $$;
create or replace function public.salvar_feriado(p_data date, p_descricao text, p_bloqueia boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform privado.exigir_admin(privado.ator());
  insert into public.feriados (data, descricao, bloqueia) values (p_data, left(coalesce(trim(p_descricao), ''), 80), coalesce(p_bloqueia, false))
  on conflict (data) do update set descricao = excluded.descricao, bloqueia = excluded.bloqueia;
end $$;
create or replace function public.remover_feriado(p_data date) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform privado.exigir_admin(privado.ator());
  delete from public.feriados where data = p_data;
end $$;
create or replace function public.salvar_faixa_cep(p_dados jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare f public.faixas_cep;
begin
  perform privado.exigir_admin(privado.ator());
  begin
    if privado.tem_valor(p_dados -> 'id') then
      update public.faixas_cep set nome = trim(p_dados ->> 'nome'), cep_inicio = privado.so_digitos(p_dados ->> 'cepInicio'), cep_fim = privado.so_digitos(p_dados ->> 'cepFim'),
        taxa_centavos = (p_dados ->> 'taxaCentavos')::bigint, ativa = coalesce((p_dados ->> 'ativa')::boolean, true)
       where id = (p_dados ->> 'id')::uuid returning * into f;
    else
      insert into public.faixas_cep (nome, cep_inicio, cep_fim, taxa_centavos, ativa)
      values (trim(p_dados ->> 'nome'), privado.so_digitos(p_dados ->> 'cepInicio'), privado.so_digitos(p_dados ->> 'cepFim'), (p_dados ->> 'taxaCentavos')::bigint, coalesce((p_dados ->> 'ativa')::boolean, true))
      returning * into f;
    end if;
  exception when check_violation or invalid_text_representation or not_null_violation then
    perform privado.erro('DADOS_INVALIDOS', 'Confira o nome, os CEPs (8 números, início menor que o fim) e a taxa.');
  end;
  return to_jsonb(f);
end $$;

revoke execute on function public.listar_cadastros_sem_solicitacao(jsonb), public.definir_status_prospeccao(uuid, text), public.ficha_cliente_v3(uuid),
  public.salvar_condicao_comercial(uuid, jsonb), public.salvar_faturamento(uuid, jsonb), public.inativar_endereco(uuid), public.listar_cupons(),
  public.salvar_cupom(jsonb), public.salvar_conteudo_agendamento(jsonb), public.listar_feriados_e_faixas(), public.salvar_feriado(date, text, boolean),
  public.remover_feriado(date), public.salvar_faixa_cep(jsonb) from public, anon;
grant execute on function public.listar_cadastros_sem_solicitacao(jsonb), public.definir_status_prospeccao(uuid, text), public.ficha_cliente_v3(uuid),
  public.salvar_condicao_comercial(uuid, jsonb), public.salvar_faturamento(uuid, jsonb), public.inativar_endereco(uuid), public.listar_cupons(),
  public.salvar_cupom(jsonb), public.salvar_conteudo_agendamento(jsonb), public.listar_feriados_e_faixas(), public.salvar_feriado(date, text, boolean),
  public.remover_feriado(date), public.salvar_faixa_cep(jsonb) to authenticated;

-- ---------------------------------------------------------------- mensagens (gerado de src/automacoes/catalogo.js)
update public.templates set ativo = false where codigo = 'solicitacao_recebida' and canal in ('whatsapp', 'email') and ativo;
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('solicitacao_recebida', 'whatsapp', (select coalesce(max(versao), 0) + 1 from public.templates where codigo = 'solicitacao_recebida' and canal = 'whatsapp'), 'Oi, {{nome}}! Recebemos sua solicitação de atendimento na Prime (nº {{numero}}): {{resumo}}. A solicitação ainda não é a confirmação: agora a Prime verifica a disponibilidade e responde por aqui. Você acompanha em {{link}}
Qualquer dúvida, é só responder.', null, array['nome', 'numero', 'resumo', 'link']::text[], array['nome', 'numero', 'resumo', 'link']::text[], 'UTILITY', true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('solicitacao_recebida', 'email', (select coalesce(max(versao), 0) + 1 from public.templates where codigo = 'solicitacao_recebida' and canal = 'email'), 'Oi, {{nome}}! Recebemos sua solicitação de atendimento na Prime (nº {{numero}}): {{resumo}}. A solicitação ainda não é a confirmação: agora a Prime verifica a disponibilidade e responde por aqui. Você acompanha em {{link}}
Qualquer dúvida, é só responder.', 'Recebemos sua solicitação', array['nome', 'numero', 'resumo', 'link']::text[], array['nome', 'numero', 'resumo', 'link']::text[], null, true);
update public.templates set ativo = false where codigo = 'lembrete_prazo_pagamento' and canal in ('whatsapp', 'email') and ativo;
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('lembrete_prazo_pagamento', 'whatsapp', (select coalesce(max(versao), 0) + 1 from public.templates where codigo = 'lembrete_prazo_pagamento' and canal = 'whatsapp'), 'Oi, {{nome}}. Lembrete da Prime: o pagamento antecipado de {{valor}} ({{oque}}) vence {{prazo}}. Os detalhes estão em {{link}}
Se já pagou, pode desconsiderar esta mensagem.', null, array['nome', 'valor', 'oque', 'prazo', 'link']::text[], array['nome', 'valor', 'oque', 'prazo', 'link']::text[], 'UTILITY', true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('lembrete_prazo_pagamento', 'email', (select coalesce(max(versao), 0) + 1 from public.templates where codigo = 'lembrete_prazo_pagamento' and canal = 'email'), 'Oi, {{nome}}. Lembrete da Prime: o pagamento antecipado de {{valor}} ({{oque}}) vence {{prazo}}. Os detalhes estão em {{link}}
Se já pagou, pode desconsiderar esta mensagem.', 'Lembrete do prazo de pagamento', array['nome', 'valor', 'oque', 'prazo', 'link']::text[], array['nome', 'valor', 'oque', 'prazo', 'link']::text[], null, true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('cobranca_parcela2', 'whatsapp', 1, 'Oi, {{nome}}. Chegou a segunda parte do pagamento do seu pacote na Prime: {{valor}}, com vencimento até {{prazo}}. O PIX e os detalhes estão em {{link}}
Se já pagou, pode desconsiderar esta mensagem.', null, array['nome', 'valor', 'prazo', 'link']::text[], array['nome', 'valor', 'prazo', 'link']::text[], 'UTILITY', true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('cobranca_parcela2', 'email', 1, 'Oi, {{nome}}. Chegou a segunda parte do pagamento do seu pacote na Prime: {{valor}}, com vencimento até {{prazo}}. O PIX e os detalhes estão em {{link}}
Se já pagou, pode desconsiderar esta mensagem.', 'Segunda parte do pagamento do pacote', array['nome', 'valor', 'prazo', 'link']::text[], array['nome', 'valor', 'prazo', 'link']::text[], null, true);
insert into public.automacao_regras (codigo, template_codigo, descricao, categoria, destinatario, canais_ordem, gatilho, atraso, condicoes, cancelamento, entidade, marco, do_dia, validade_min, ligada) values ('C17', 'cobranca_parcela2', 'Segunda parte do pagamento do pacote, gerada pela rotina da manhã (agendamento v3, item 39)', 'atendimento', 'cliente', array['whatsapp', 'email', 'painel']::text[], '{"tipo":"evento","eventos":["cobranca_parcela2_emitida"]}'::jsonb, '{"tipo":"imediato"}'::jsonb, '{"pagamentoStatus":["pendente"]}'::jsonb, array['pagamento_confirmado', 'pedido_cancelado']::text[], 'pagamento', null, false, null, true);
-- semFaturamento (C02): a condição nova entra na lista das válidas (mesma lista de CONDICOES_PERMITIDAS do catálogo)
create or replace function privado.condicoes_validas(c jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(c) = 'object' and not exists (
    select 1 from jsonb_each(c) x
     where x.key not in ('pedidoStatus', 'atendimentoStatus', 'pagamentoStatus', 'mesmaData', 'mesmaProfissional', 'mesmoPrazo', 'semAvaliacao', 'temCobranca', 'temProfissional', 'semFaturamento')
        or (x.key like '%Status' and jsonb_typeof(x.value) <> 'array')
        or (x.key not like '%Status' and x.value <> 'true'::jsonb))
$$;
update public.automacao_regras set condicoes = '{"temCobranca":true,"semFaturamento":true,"pedidoStatus":["aguardando_pagamento","confirmado"]}'::jsonb where codigo = 'C02';

-- ---------------------------------------------------------------- remarcação e cancelamento em pedido v3
/**
 * Remarcação de diária v3: a regra antiga (valor-base do pacote + taxa de sábado/feriado da tabela v2) não vale. Antes de
 * gravar, a diária ganha as taxas de sábado e feriado da DATA NOVA pela regra v3 (refeição e deslocamento ficam).
 */
create or replace function privado.v3_taxas_da_data() returns trigger
language plpgsql security definer set search_path = '' as $$
declare cfg jsonb; V jsonb; sab boolean; fer boolean; t_sab bigint; t_fer bigint; v_itens jsonb;
begin
  if new.data is not distinct from old.data or new.itens is null then return new; end if;
  if (select pacote ->> 'versao' from public.pedidos where id = new.pedido_id) is distinct from '3' then return new; end if;
  cfg := privado.cfg_v3(); V := cfg #> '{PRECOS,v3}';
  sab := privado.dia_semana(new.data) = 6;
  fer := coalesce((cfg -> 'feriados') @> to_jsonb(to_char(new.data, 'YYYY-MM-DD')), false);
  t_sab := case when sab and (not fer or coalesce((V #>> '{taxas,acumulaSabadoFeriado}')::boolean, false)) then (V #>> '{taxas,sabadoCentavos}')::bigint else 0 end;
  t_fer := case when fer then (V #>> '{taxas,feriadoCentavos}')::bigint else 0 end;
  select coalesce(jsonb_agg(i order by o), '[]') into v_itens from jsonb_array_elements(new.itens) with ordinality x(i, o) where i ->> 'codigo' not in ('sabado', 'feriado');
  -- as taxas do dia entram logo depois da diária e do serviço (mesma ordem do cálculo)
  select coalesce(jsonb_agg(i order by k, o), '[]') into v_itens from (
    select i, o, case when i ->> 'codigo' = 'diaria' or i ->> 'codigo' like 'servico:%' then 0 else 2 end k from jsonb_array_elements(v_itens) with ordinality x(i, o)
    union all select jsonb_build_object('codigo', 'sabado', 'descricao', 'Sábado', 'centavos', t_sab), 1, 1 where t_sab > 0
    union all select jsonb_build_object('codigo', 'feriado', 'descricao', 'Feriado', 'centavos', t_fer), 2, 1 where t_fer > 0) z;
  new.itens := v_itens;
  new.taxas := coalesce(new.taxas, '{}') || jsonb_build_object('sabado', t_sab, 'feriado', t_fer);
  new.taxa_dia_centavos := t_sab + t_fer;
  new.valor_dia_centavos := (select sum((i ->> 'centavos')::bigint) from jsonb_array_elements(v_itens) i);
  return new;
end $$;
create trigger v3_taxas_da_data before update of data on public.atendimentos for each row execute function privado.v3_taxas_da_data();

/** Recálculo das cobranças pendentes (redefinida a partir de 20260924120000): pedido v3 tem a regra própria. */
create or replace function privado.recalcular_cobrancas_pendentes(p_pedido uuid) returns void
language plpgsql set search_path = '' as $$
declare cfg jsonb := privado.cfg(); p public.pedidos; ativos jsonb; esperadas jsonb; g record; e jsonb; descontos jsonb; desc_total bigint; total bigint; concedido jsonb := '{}'; o record; d bigint; valor bigint;
        v_p1 bigint;
begin
  select * into p from public.pedidos where id = p_pedido;
  if p.pacote ->> 'versao' = '3' then
    -- v3: total = diárias ativas menos o desconto da contratação (o mesmo que a cliente viu; PENDÊNCIA: cancelamento parcial)
    select greatest(0, coalesce(sum(a.valor_dia_centavos), 0) - coalesce((p.pacote ->> 'descontoCentavos')::bigint, 0)) into total
      from public.atendimentos a where a.pedido_id = p_pedido and a.status <> 'cancelado';
    if total <> p.total_centavos then
      update public.pedidos set total_centavos = total, pacote = pacote || jsonb_build_object('totalCentavos', total) where id = p_pedido returning * into p;
    end if;
    for e in select x from jsonb_array_elements(privado.v3_parcelas_do_pedido(p)) x loop
      valor := (e ->> 'valorCentavos')::bigint;
      if e ->> 'parcela' = 'metade_2' then
        select valor_centavos into v_p1 from public.pagamentos where pedido_id = p_pedido and parcela = 'metade_1' and status <> 'cancelado' limit 1;
        valor := total - coalesce(v_p1, total - valor);
      end if;
      update public.pagamentos set valor_centavos = valor, vence_em = (e ->> 'venceEm')::date, vence_as = (e ->> 'venceAs')::time,
          marco_data = (e ->> 'marcoData')::date, envio_em = coalesce((e ->> 'envioEm')::date, envio_em), brcode = case when brcode is null then null else privado.brcode(valor, pix_txid) end
       where pedido_id = p_pedido and parcela = e ->> 'parcela' and status = 'pendente'
         and (valor_centavos <> valor or vence_em is distinct from (e ->> 'venceEm')::date or marco_data is distinct from (e ->> 'marcoData')::date);
    end loop;
    return;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'sequencia', a.sequencia, 'data', to_char(a.data, 'YYYY-MM-DD'), 'valorDiaCentavos', a.valor_dia_centavos)), '[]')
    into ativos from public.atendimentos a where a.pedido_id = p_pedido and a.status <> 'cancelado';
  -- total do pedido = diárias ativas menos os descontos por mês (mesma regra de gerar_atendimentos)
  descontos := '[]'; desc_total := 0;
  for o in select left(x ->> 'data', 7) mes, count(*)::int n from jsonb_array_elements(ativos) x group by 1 loop
    select f into e from jsonb_array_elements(cfg #> '{PRECOS,descontoMensal}') f where o.n >= (f ->> 'minimoDiarias')::int order by (f ->> 'minimoDiarias')::int desc limit 1;
    if e is not null then desc_total := desc_total + (e ->> 'centavos')::bigint; end if;
    e := null;
  end loop;
  select coalesce(sum((x ->> 'valorDiaCentavos')::bigint), 0) - desc_total into total from jsonb_array_elements(ativos) x;
  if total <> p.total_centavos then
    update public.pedidos set total_centavos = total, pacote = pacote || jsonb_build_object('totalCentavos', total, 'descontoMensalCentavos', desc_total) where id = p_pedido;
  end if;
  if coalesce(p.pacote ->> 'modoPagamento', 'por_diaria') <> 'por_diaria' then return; end if;
  for o in select left(to_char(a.data, 'YYYY-MM-DD'), 7) mes, sum(x.desconto_centavos) s from public.pagamentos x join public.atendimentos a on a.id = x.atendimento_id
            where x.pedido_id = p_pedido and x.parcela = 'diaria' and x.status in ('informado_pelo_cliente', 'confirmado') and x.desconto_centavos > 0 group by 1 loop
    concedido := concedido || jsonb_build_object(o.mes, o.s);
  end loop;
  esperadas := privado.calcular_cobrancas(ativos, 'por_diaria', cfg);
  for g in select x.id, x.valor_centavos, x.vence_em, x.pix_txid, a.sequencia, a.valor_dia_centavos, left(to_char(a.data, 'YYYY-MM-DD'), 7) mes
             from public.pagamentos x join public.atendimentos a on a.id = x.atendimento_id
            where x.pedido_id = p_pedido and x.parcela = 'diaria' and x.status = 'pendente' and a.status <> 'cancelado' for update of x loop
    select c into e from jsonb_array_elements(esperadas) c where (c ->> 'sequencia')::int = g.sequencia;
    if e is not null then
      d := greatest(0, (e ->> 'descontoCentavos')::bigint - coalesce((concedido ->> g.mes)::bigint, 0));
      valor := g.valor_dia_centavos - d;
      if valor <> g.valor_centavos or (e ->> 'venceEm')::date <> g.vence_em then
        update public.pagamentos set valor_centavos = valor, desconto_centavos = d, vence_em = (e ->> 'venceEm')::date, vence_as = (e ->> 'venceAs')::time,
          brcode = privado.brcode(valor, g.pix_txid) where id = g.id;
      end if;
    end if;
    e := null;
  end loop;
end $$;

/** Diária paga (redefinida a partir de 20260924100000): parcela v3 que cobre a diária confirmada, ou faturamento autorizado (não antecipa). */
create or replace function privado.diaria_paga(a public.atendimentos) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.pagamentos g where g.pedido_id = a.pedido_id
                   and ((g.status = 'confirmado' and (g.parcela = 'pacote' or (g.parcela = 'diaria' and g.atendimento_id = a.id)
                         or (g.parcela in ('integral', 'metade_1', 'metade_2') and privado.v3_cobre(g, a))))
                        or (g.parcela = 'faturamento' and g.status <> 'cancelado')))
$$;
revoke all on function privado.diaria_paga(public.atendimentos) from public;

-- ---------------------------------------------------------------- remarcação (redefinida a partir de 20261001100000)
-- v3: horários de 15 em 15 min pela regra do dia, várias profissionais no mesmo dia e o valor pelas taxas v3 (gatilho acima).
create or replace function privado.aplicar_transicao(p_id uuid, p_evento text, s jsonb, p_dados jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare a public.atendimentos; alvo public.atendimentos; novo public.atendimentos; p public.pedidos; probs jsonb; cfg jsonb; tipo text; d public.diaristas; ocupada public.atendimentos; nova date; confl jsonb;
begin
  -- ordem de locks: pedido -> atendimento (igual a cancelar_pedido e confirmar_pagamento)
  select * into a from public.atendimentos where id = p_id;
  if not found then perform privado.erro('NAO_ENCONTRADO', 'Atendimento não encontrado'); end if;
  select * into p from public.pedidos where id = a.pedido_id for update;
  select * into a from public.atendimentos where id = p_id for update;
  if p_evento = 'reagendar' then
    cfg := privado.cfg();
    if coalesce(p_dados ->> 'data', '') !~ '^\d{4}-\d{2}-\d{2}$' then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Reagendamento exige nova data e horário'); end if;
    if coalesce(p_dados ->> 'horaInicio', '') <> '' then
      if (p_dados ->> 'horaInicio') !~ '^([01]\d|2[0-3]):[0-5]\d$' then perform privado.erro('DADOS_INVALIDOS', 'Horário inválido'); end if;
      if not (p_dados ->> 'horaInicio') = any(case when p.pacote ->> 'versao' = '3' then privado.v3_horarios(a.duracao_minutos / 60, (p_dados ->> 'data')::date, privado.cfg_v3())
                                                   else privado.horarios_inicio(a.duracao_minutos / 60, cfg) end) then
        perform privado.erro('DATA_INVALIDA', 'Horário ' || (p_dados ->> 'horaInicio') || ' fora do horário de trabalho para ' || (a.duracao_minutos / 60) || ' horas'); end if;
    end if;
    probs := privado.validar_ocorrencias(jsonb_build_array(jsonb_build_object('sequencia', a.sequencia, 'data', p_dados ->> 'data')), privado.hoje_sp(), true, cfg);
    if jsonb_array_length(probs) > 0 then perform privado.erro('DATA_INVALIDA', (select string_agg(x ->> 'motivo', '; ') from jsonb_array_elements(probs) x), probs); end if;
    nova := (p_dados ->> 'data')::date;
    -- v3: em "mais de uma profissional no mesmo dia" as diárias do pedido dividem a data
    if p.modalidade is distinct from 'multi_profissional' and exists (select 1 from public.atendimentos i where i.pedido_id = a.pedido_id and i.id <> a.id and i.status <> 'cancelado' and i.data = nova) then
      perform privado.erro('DATA_INVALIDA', 'Já existe diária deste pedido nessa data'); end if;
    if a.diarista_id is not null then
      select * into d from public.diaristas where id = a.diarista_id for update; -- serializa com atribuir/remarcar da mesma diarista (revisão do GPT)
      -- horário real da diária na data nova (v2: hora informada; caminho antigo: hora do turno)
      alvo := a; alvo.data := nova;
      alvo.hora_inicio := coalesce(nullif(p_dados ->> 'horaInicio', '')::time, case p_dados ->> 'turno' when 'tarde' then time '13:00' when 'manha' then time '08:00' when 'integral' then time '08:00' end, a.hora_inicio);
      select * into ocupada from public.atendimentos x where x.diarista_id = a.diarista_id and x.id <> a.id and x.status <> 'cancelado' and privado.sobrepoe(alvo, x) limit 1;
      if found then perform privado.erro('CONDICAO_NAO_ATENDIDA', split_part(coalesce(d.nome, 'A profissional'), ' ', 1) || ' já tem diária em ' || to_char(nova, 'YYYY-MM-DD') || ' nesse horário'); end if;
      -- P2: férias e folga impedem (os avisos de disponibilidade ficam pra tela, antes de confirmar)
      confl := privado.conflitos_diaria(a.diarista_id, a.id, alvo.data, alvo.hora_inicio, a.duracao_minutos, null);
      if exists (select 1 from jsonb_array_elements(confl) c where c ->> 'tipo' = 'bloqueio') then
        perform privado.erro('CONDICAO_NAO_ATENDIDA', split_part(coalesce(d.nome, 'A profissional'), ' ', 1) || ' não pode em ' || to_char(nova, 'DD/MM') || ': '
          || (select string_agg(lower(c ->> 'mensagem'), '; ') from jsonb_array_elements(confl) c where c ->> 'tipo' = 'bloqueio'), jsonb_build_object('conflitos', confl));
      end if;
    end if;
  end if;
  novo := privado.transicionar(a, p_evento, s, p_dados);
  -- v3: as taxas da data nova vêm do gatilho privado.v3_taxas_da_data (a regra v2 de valor-base não vale)
  if p_evento = 'reagendar' and p.pacote ->> 'versao' is distinct from '3' then
    novo.taxa_dia_centavos := case when privado.eh_sabado_ou_feriado(novo.data, cfg) then (cfg #>> '{PRECOS,taxaSabadoFeriadoCentavos}')::bigint else 0 end;
    novo.valor_dia_centavos := (p.pacote ->> 'valorDiaBaseCentavos')::bigint + novo.taxa_dia_centavos;
  end if;
  update public.atendimentos set status = novo.status, versao = novo.versao, historico = novo.historico, data = novo.data, turno = novo.turno, hora_inicio = novo.hora_inicio, deslocada = novo.deslocada,
    taxa_dia_centavos = novo.taxa_dia_centavos, valor_dia_centavos = novo.valor_dia_centavos where id = a.id;
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
