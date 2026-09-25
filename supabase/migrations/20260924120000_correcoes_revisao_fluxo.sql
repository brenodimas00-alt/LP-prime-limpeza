-- Revisão do GPT sobre o fluxo novo (24/09/2026), corrigida com teste na bateria de contrato:
-- 1) estorno: cancelar a diária não sobrescreve `estornado` (o SQL já só cancelava aberta; fica igual ao JS corrigido);
-- 2) desconto do mês já concedido numa cobrança informada/confirmada não é dado de novo ao recalcular as pendentes, e o
--    total do pedido acompanha as diárias ativas;
-- 3) ordem de locks uniforme (pedido -> atendimento -> pagamento) pra confirmar, informar, estornar e transicionar não
--    entrarem em deadlock com cancelar_pedido;
-- 4) remarcar recalcula a taxa de sábado/feriado da data nova;
-- 5) remarcar diária já designada confere sobreposição com outras diárias da mesma profissional (regra de atribuir_diarista).

create or replace function privado.recalcular_cobrancas_pendentes(p_pedido uuid) returns void
language plpgsql set search_path = '' as $$
declare cfg jsonb := privado.cfg(); p public.pedidos; ativos jsonb; esperadas jsonb; g record; e jsonb; descontos jsonb; desc_total bigint; total bigint; concedido jsonb := '{}'; o record; d bigint; valor bigint;
begin
  select * into p from public.pedidos where id = p_pedido;
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
  -- desconto já concedido por mês em cobrança informada ou confirmada
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

create or replace function privado.aplicar_transicao(p_id uuid, p_evento text, s jsonb, p_dados jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare a public.atendimentos; novo public.atendimentos; p public.pedidos; probs jsonb; cfg jsonb; tipo text; d public.diaristas; ocupada public.atendimentos; nova date;
begin
  -- ordem de locks: pedido -> atendimento (igual a cancelar_pedido e confirmar_pagamento)
  select * into a from public.atendimentos where id = p_id;
  if not found then perform privado.erro('NAO_ENCONTRADO', 'Atendimento não encontrado'); end if;
  select * into p from public.pedidos where id = a.pedido_id for update;
  select * into a from public.atendimentos where id = p_id for update;
  if p_evento = 'reagendar' then
    cfg := privado.cfg();
    if coalesce(p_dados ->> 'data', '') !~ '^\d{4}-\d{2}-\d{2}$' then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Reagendamento exige nova data e turno'); end if;
    probs := privado.validar_ocorrencias(jsonb_build_array(jsonb_build_object('sequencia', a.sequencia, 'data', p_dados ->> 'data')), privado.hoje_sp(), true, cfg);
    if jsonb_array_length(probs) > 0 then perform privado.erro('DATA_INVALIDA', (select string_agg(x ->> 'motivo', '; ') from jsonb_array_elements(probs) x), probs); end if;
    nova := (p_dados ->> 'data')::date;
    if exists (select 1 from public.atendimentos i where i.pedido_id = a.pedido_id and i.id <> a.id and i.status <> 'cancelado' and i.data = nova) then
      perform privado.erro('DATA_INVALIDA', 'Já existe diária deste pedido nessa data'); end if;
    if a.diarista_id is not null then
      select * into d from public.diaristas where id = a.diarista_id;
      select * into ocupada from public.atendimentos x where x.diarista_id = a.diarista_id and x.id <> a.id and x.data = nova and x.status <> 'cancelado'
        and (x.turno = p_dados ->> 'turno' or x.turno = 'integral' or p_dados ->> 'turno' = 'integral') limit 1;
      if found then perform privado.erro('CONDICAO_NAO_ATENDIDA', split_part(coalesce(d.nome, 'A profissional'), ' ', 1) || ' já tem diária em ' || to_char(nova, 'YYYY-MM-DD') || ' nesse período'); end if;
    end if;
  end if;
  novo := privado.transicionar(a, p_evento, s, p_dados);
  if p_evento = 'reagendar' then
    novo.taxa_dia_centavos := case when privado.eh_sabado_ou_feriado(novo.data, cfg) then (cfg #>> '{PRECOS,taxaSabadoFeriadoCentavos}')::bigint else 0 end;
    novo.valor_dia_centavos := (p.pacote ->> 'valorDiaBaseCentavos')::bigint + novo.taxa_dia_centavos;
  end if;
  update public.atendimentos set status = novo.status, versao = novo.versao, historico = novo.historico, data = novo.data, turno = novo.turno, deslocada = novo.deslocada,
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

create or replace function public.informar_pagamento(p_id uuid, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; g public.pagamentos; p public.pedidos; el jsonb; conteudo jsonb := jsonb_build_object('id', p_id);
begin
  r := privado.idem_ler('informarPagamento', s, p_chave, conteudo);
  if r is not null then return r; end if;
  perform set_config('app.ator', s ->> 'ator', true);
  select * into g from public.pagamentos where id = p_id;
  if found then select * into p from public.pedidos where id = g.pedido_id for update; select * into g from public.pagamentos where id = p_id for update; end if;
  if not found or not privado.pode_ver_pedido(s, p) then perform privado.erro('NAO_ENCONTRADO', 'Pagamento não encontrado'); end if;
  if s ->> 'ator' not in ('cliente', 'prime') then perform privado.erro('ATOR_SEM_PERMISSAO', 'Só a cliente informa o pagamento'); end if;
  if g.status = 'informado_pelo_cliente' then r := privado.j_pagamento(g); perform privado.idem_gravar('informarPagamento', s, p_chave, conteudo, r); return r; end if;
  el := privado.elegibilidade(g);
  if not (el ->> 'pagavel')::boolean then perform privado.erro('PAGAMENTO_NAO_ELEGIVEL', el ->> 'motivo'); end if;
  update public.pagamentos set status = 'informado_pelo_cliente', informado_em = now() where id = g.id returning * into g;
  perform privado.evento('pagamento_informado', jsonb_strip_nulls(jsonb_build_object('pedidoId', g.pedido_id, 'pagamentoId', g.id, 'atendimentoId', g.atendimento_id, 'clienteId', p.cliente_id)));
  r := privado.j_pagamento(g);
  perform privado.idem_gravar('informarPagamento', s, p_chave, conteudo, r);
  return r;
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
  for a in select * from public.atendimentos where pedido_id = p.id and status = 'agendado' and (g.parcela = 'pacote' or id = g.atendimento_id) order by sequencia loop
    perform privado.aplicar_transicao(a.id, 'confirmar', '{"ator": "sistema"}', null);
  end loop;
  p := privado.atualizar_status_pedido(p.id, 'sistema', 'pagamento_confirmado');
  select coalesce(jsonb_agg(privado.j_atendimento(x) order by x.sequencia), '[]') into ats from public.atendimentos x where x.pedido_id = p.id;
  r := jsonb_build_object('pagamento', privado.j_pagamento(g), 'pedido', privado.j_pedido(p), 'atendimentos', ats);
  perform privado.idem_gravar('confirmarPagamento', s, p_chave, conteudo, r);
  return r;
end $$;

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
  select * into g from public.pagamentos where id = p_id;
  if not found then perform privado.erro('NAO_ENCONTRADO', 'Pagamento não encontrado'); end if;
  perform 1 from public.pedidos where id = g.pedido_id for update;
  select * into g from public.pagamentos where id = p_id for update;
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
