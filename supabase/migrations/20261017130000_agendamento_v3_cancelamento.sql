-- Agendamento v3: cancelar o pedido de um pacote que fica com uma diária só (as outras canceladas) dava DATA_INVALIDA sem
-- mensagem: o marco da 2ª metade ficava nulo e dia_util_anterior(null) estourava. Pacote com menos de 2 datas ativas vira
-- cobrança única (igual ao JS, calcularParcelas) e a 2ª metade ainda não paga cai. Achado do teste de preview (V7).
create or replace function privado.v3_parcelas(p_modalidade text, datas text[], total bigint, fat jsonb, cfg jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare pg jsonb := cfg #> '{PRECOS,v3,pagamento}'; ds text[]; p1 bigint; mc text; v1 date; v2 date;
begin
  select array_agg(d order by d) into ds from (select distinct unnest(datas) d) z;
  if ds is null then return '[]'; end if;
  if privado.v3_obj(fat) then
    return jsonb_build_array(jsonb_build_object('parcela', 'faturamento', 'marco', 'confirmacao', 'valorCentavos', total,
      'venceEm', to_char(ds[cardinality(ds)]::date + coalesce((fat ->> 'prazoDias')::int, 0), 'YYYY-MM-DD'), 'venceAs', null));
  end if;
  v1 := privado.dia_util_anterior(ds[1]::date, cfg);
  -- pacote que ficou com uma data só (cancelamento das outras): não há segunda metade, a cobrança é única
  if p_modalidade <> 'pacote' or cardinality(ds) < 2 then
    return jsonb_build_array(jsonb_build_object('parcela', 'integral', 'marco', 'confirmacao', 'valorCentavos', total, 'venceEm', to_char(v1, 'YYYY-MM-DD'), 'venceAs', pg ->> 'horaPrazo'));
  end if;
  p1 := round(total * (pg ->> 'percentualPrimeiraParcela')::numeric / 100);
  mc := privado.v3_marco(ds);
  v2 := privado.dia_util_anterior(mc::date, cfg);
  return jsonb_build_array(
    jsonb_build_object('parcela', 'metade_1', 'marco', 'confirmacao', 'valorCentavos', p1, 'venceEm', to_char(v1, 'YYYY-MM-DD'), 'venceAs', pg ->> 'horaPrazo'),
    jsonb_build_object('parcela', 'metade_2', 'marco', 'segunda_metade', 'marcoData', mc, 'valorCentavos', total - p1, 'venceEm', to_char(v2, 'YYYY-MM-DD'),
      'venceAs', pg ->> 'horaPrazo', 'envioEm', to_char(v2 - (pg ->> 'parcela2DiasAntesEnvio')::int, 'YYYY-MM-DD')));
end $$;

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
    -- sem segunda metade (pacote reduzido a uma data): a 2ª parcela ainda não paga cai
    if p.modalidade = 'pacote' and not exists (select 1 from jsonb_array_elements(privado.v3_parcelas_do_pedido(p)) x where x ->> 'parcela' = 'metade_2') then
      update public.pagamentos set status = 'cancelado' where pedido_id = p_pedido and parcela = 'metade_2' and status in ('pendente', 'informado_pelo_cliente');
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
