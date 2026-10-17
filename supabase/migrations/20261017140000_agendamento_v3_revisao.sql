-- Agendamento v3: achados da revisão do Codex no V7.
-- 1) pacote reduzido a uma data: a 1ª parcela é a cobrança única (cobre a diária restante e vira o total se ainda aberta);
-- 2) saldo zero ou negativo na 2ª parcela (diárias canceladas depois da 1ª paga): a parcela aberta cai e a rotina não gera;
-- 3) confirmação reconfere o cupom (limite de usos, primeira contratação) e a condição de uso único, que outro pedido pode
--    ter usado depois do envio: a Prime vê o motivo e decide (recusa ou combina);
-- 4) total zero (desconto de 100%): confirma sem cobrança e a diária conta como paga.

create or replace function privado.v3_cobre(g public.pagamentos, a public.atendimentos) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_marco date;
begin
  if g.parcela in ('pacote', 'integral', 'faturamento') then return true; end if;
  if g.parcela in ('metade_1', 'metade_2') then
    v_marco := privado.v3_marco((select array_agg(to_char(x.data, 'YYYY-MM-DD')) from public.atendimentos x where x.pedido_id = g.pedido_id and x.status <> 'cancelado'))::date;
    -- pacote reduzido a uma data (sem marco): a 1ª parcela é a cobrança única e cobre tudo
    if v_marco is null then return g.parcela = 'metade_1'; end if;
    return case when g.parcela = 'metade_1' then a.data < v_marco else a.data >= v_marco end;
  end if;
  return a.id = g.atendimento_id;
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
    -- sem segunda metade (pacote reduzido a uma data): a 1ª parcela ainda aberta vira a cobrança única (o total) e a 2ª cai
    if p.modalidade = 'pacote' and not exists (select 1 from jsonb_array_elements(privado.v3_parcelas_do_pedido(p)) x where x ->> 'parcela' = 'metade_2') then
      update public.pagamentos set status = 'cancelado' where pedido_id = p_pedido and parcela = 'metade_2' and status in ('pendente', 'informado_pelo_cliente');
      if total > 0 then
        update public.pagamentos set valor_centavos = total, brcode = case when brcode is null then null else privado.brcode(total, pix_txid) end
         where pedido_id = p_pedido and parcela = 'metade_1' and status = 'pendente' and valor_centavos <> total;
      end if;
    end if;
    for e in select x from jsonb_array_elements(privado.v3_parcelas_do_pedido(p)) x loop
      valor := (e ->> 'valorCentavos')::bigint;
      if e ->> 'parcela' = 'metade_2' then
        select valor_centavos into v_p1 from public.pagamentos where pedido_id = p_pedido and parcela = 'metade_1' and status <> 'cancelado' limit 1;
        valor := total - coalesce(v_p1, total - valor);
      end if;
      -- nada a cobrar (a 1ª já cobriu o total, ou o total zerou): a parcela aberta cai em vez de ficar com valor zero ou negativo
      if valor <= 0 then
        update public.pagamentos set status = 'cancelado' where pedido_id = p_pedido and parcela = e ->> 'parcela' and status in ('pendente', 'informado_pelo_cliente');
        continue;
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
    if (c ->> 'valorCentavos')::bigint <= 0 then continue; end if; -- a 1ª já cobriu o total (diárias canceladas): não há 2ª parcela
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

create or replace function privado.diaria_paga(a public.atendimentos) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.pagamentos g where g.pedido_id = a.pedido_id
                   and ((g.status = 'confirmado' and (g.parcela = 'pacote' or (g.parcela = 'diaria' and g.atendimento_id = a.id)
                         or (g.parcela in ('integral', 'metade_1', 'metade_2') and privado.v3_cobre(g, a))))
                        or (g.parcela = 'faturamento' and g.status <> 'cancelado')))
      -- v3 com total zero (desconto de 100%): nada a pagar
      or exists (select 1 from public.pedidos x where x.id = a.pedido_id and x.pacote ->> 'versao' = '3' and x.total_centavos = 0)
$$;

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
    for c in select x from jsonb_array_elements(privado.v3_parcelas_do_pedido(p)) x where x ->> 'parcela' <> 'metade_2' and p.total_centavos > 0 loop
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
  -- v3: o cupom e a condição de uso único foram conferidos no envio; outro pedido pode ter usado antes desta confirmação
  if v3 and p.cupom_id is not null then
    select * into v_cup from public.cupons where id = p.cupom_id for update;
    select count(*)::int into v_usos from public.cupons_uso u where u.cupom_id = p.cupom_id and u.pedido_id <> p.id;
    if v_cup.limite_de_uso is not null and v_usos >= v_cup.limite_de_uso then
      perform privado.erro('CONDICAO_NAO_ATENDIDA', 'O cupom ' || v_cup.codigo || ' atingiu o limite de usos depois do envio desta solicitação. Recuse com o motivo ou combine o valor com a cliente.'); end if;
    if v_cup.primeira_contratacao and exists (select 1 from public.pedidos x where x.cliente_id = p.cliente_id and x.id <> p.id
                                                and x.status in ('disponibilidade_confirmada', 'aguardando_pagamento', 'confirmado', 'concluido')) then
      perform privado.erro('CONDICAO_NAO_ATENDIDA', 'O cupom ' || v_cup.codigo || ' é só pra primeira contratação, e esta cliente já tem outra confirmada. Recuse com o motivo ou combine o valor com a cliente.'); end if;
  end if;
  if v3 and p.condicao_comercial_id is not null and exists (select 1 from public.condicoes_comerciais k where k.id = p.condicao_comercial_id
                                                              and k.validade = 'uso_unico' and k.consumida_em is not null and k.consumida_pedido is distinct from p.id) then
    perform privado.erro('CONDICAO_NAO_ATENDIDA', 'A condição comercial de uso único já foi usada em outra contratação. Recuse com o motivo ou combine o valor com a cliente.'); end if;
  -- faturamento autorizado ou total zero (desconto de 100%): confirma sem pagamento antecipado
  if v3 and (p.faturamento or p.total_centavos = 0) then
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
