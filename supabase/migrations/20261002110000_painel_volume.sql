-- Teste de volume (30/09, projeto prime-carga com ~2 anos de operação: 30 mil pedidos, 51 mil diárias): o painel não abria.
-- A abertura baixava TODAS as diárias (listar_atendimentos sem filtro: estouro do tempo de 8 s) e depois chamava obter_pedido
-- uma vez por pedido (milhares de chamadas); a pesquisa de satisfação devolvia todas as avaliações (7 MB).
-- 1) painel_operacao: numa chamada, só o que as abas usam: diárias ativas (sem profissional: todas; com profissional: as
--    próximas 2 semanas), os pedidos completos de Solicitações e das cobranças pendentes ou informadas (formato de
--    obter_pedido) e os recebidos dos últimos p_dias dias em linha leve (pagamento, pedido, cliente e a diária).
-- 2) listar_avaliacoes: com p_filtro.limite devolve só as últimas N e a média por profissional calculada sobre TODAS.

create or replace function public.painel_operacao(p_dias integer default 7) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator(); dias int := least(greatest(coalesce(p_dias, 7), 1), 90);
begin
  perform privado.exigir_prime(s);
  return jsonb_build_object(
    'atendimentos', (select coalesce(jsonb_agg(jsonb_build_object(
        'atendimento', privado.j_atendimento(a),
        'pedido', jsonb_strip_nulls(jsonb_build_object('id', p.id, 'status', p.status, 'pacote', p.pacote, 'preferenciaProfissional', p.preferencia_profissional, 'endereco', p.endereco)),
        'cliente', jsonb_build_object('id', c.id, 'nome', c.nome, 'telefone', c.telefone, 'endereco', coalesce(p.endereco, c.endereco)),
        'diarista', case when d.id is not null then jsonb_build_object('id', d.id, 'nome', d.nome, 'status', d.status) end) order by a.data, a.hora_inicio, a.sequencia), '[]')
      from public.atendimentos a join public.pedidos p on p.id = a.pedido_id join public.clientes c on c.id = p.cliente_id left join public.diaristas d on d.id = a.diarista_id
      -- sem profissional: todas; com profissional: só as próximas 2 semanas (a agenda mostra o resto)
      where a.status in ('agendado', 'confirmado') and (a.diarista_id is null or a.data between privado.hoje_sp() - 1 and privado.hoje_sp() + 14)),
    'pedidos', (select coalesce(jsonb_agg(privado.pedido_completo(x.id) order by x.criado_em desc), '[]') from (
        select p.id, p.criado_em from public.pedidos p where p.status = 'solicitado'
        union
        select p.id, p.criado_em from public.pagamentos g join public.pedidos p on p.id = g.pedido_id where g.status in ('pendente', 'informado_pelo_cliente')
        ) x),
    -- recebidos (confirmados ou estornados nos últimos p_dias): linha leve, só o que a aba Pagamentos mostra
    'recebidos', (select coalesce(jsonb_agg(jsonb_build_object('pagamento', privado.j_pagamento(g), 'pedido', jsonb_build_object('id', p.id, 'status', p.status),
        'cliente', jsonb_build_object('id', c.id, 'nome', c.nome), 'atendimento', case when a.id is not null then jsonb_build_object('id', a.id, 'data', to_char(a.data, 'YYYY-MM-DD')) end)
        order by coalesce(g.confirmado_em, g.atualizado_em) desc), '[]')
      from public.pagamentos g join public.pedidos p on p.id = g.pedido_id join public.clientes c on c.id = p.cliente_id left join public.atendimentos a on a.id = g.atendimento_id
      where (g.status = 'confirmado' and g.confirmado_em > now() - make_interval(days => dias))
         or (g.status = 'estornado' and g.atualizado_em > now() - make_interval(days => dias))),
    'diasConfirmados', dias);
end $$;
revoke all on function public.painel_operacao(integer) from public, anon;
grant execute on function public.painel_operacao(integer) to authenticated;

-- estornos recentes (a linha do tempo do estorno fica em atualizado_em)
create index if not exists pagamentos_estornado_atualizado on public.pagamentos (atualizado_em) where status = 'estornado';
-- solicitações abertas (status + data já tem índice em pedidos_status)

create or replace function public.listar_avaliacoes(p_filtro jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator(); lim int;
begin
  perform privado.exigir_prime(s);
  begin lim := (p_filtro ->> 'limite')::int; exception when others then lim := null; end;
  if lim is not null then lim := least(greatest(lim, 1), 1000); end if;
  return jsonb_build_object(
    'itens', (select coalesce(jsonb_agg(jsonb_build_object('avaliacao', privado.j_avaliacao(v),
        'atendimento', jsonb_build_object('id', a.id, 'data', to_char(a.data, 'YYYY-MM-DD')), 'diarista', case when d.id is not null then jsonb_build_object('id', d.id, 'nome', d.nome) end) order by v.criado_em desc), '[]')
      from (select v.* from public.avaliacoes v join public.atendimentos a on a.id = v.atendimento_id
             where p_filtro ->> 'diaristaId' is null or a.diarista_id = (p_filtro ->> 'diaristaId')::uuid
             order by v.criado_em desc limit lim) v
      join public.atendimentos a on a.id = v.atendimento_id left join public.diaristas d on d.id = a.diarista_id),
    -- média por profissional sobre TODAS as avaliações (só quando a lista vem limitada; sem limite a tela calcula)
    'medias', case when lim is not null then (select coalesce(jsonb_agg(jsonb_build_object('id', coalesce(d.id::text, '—'), 'nome', coalesce(d.nome, 'Sem diarista'),
        'n', m.n, 'media', m.media) order by m.media desc, m.n desc), '[]')
      from (select a.diarista_id, count(*)::int n, round(avg(v.nota_final), 1) media from public.avaliacoes v join public.atendimentos a on a.id = v.atendimento_id
             where p_filtro ->> 'diaristaId' is null or a.diarista_id = (p_filtro ->> 'diaristaId')::uuid group by a.diarista_id) m
      left join public.diaristas d on d.id = m.diarista_id) end,
    'total', case when lim is not null then (select count(*)::int from public.avaliacoes v join public.atendimentos a on a.id = v.atendimento_id
      where p_filtro ->> 'diaristaId' is null or a.diarista_id = (p_filtro ->> 'diaristaId')::uuid) end);
end $$;

-- 3) listas_relacionamento (aba Relacionamento, 2 s no volume): mesmo resultado, calculado em conjunto. Consentimento de
--    todas as clientes numa consulta (era uma chamada por cliente); reativação numa passada só pelas diárias (última diária
--    realizada e se há diária futura); renovação por faixa de datas do mês (usa o índice de data, date_trunc não usava).
create or replace function public.listas_relacionamento() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator(); hoje date := privado.hoje_sp(); dias int; ren jsonb; reat jsonb;
        ini date := date_trunc('month', privado.hoje_sp())::date; fim date := (date_trunc('month', privado.hoje_sp()) + interval '1 month')::date;
begin
  perform privado.exigir_prime(s);
  dias := coalesce((select (r.atraso ->> 'dias')::int from public.automacao_regras r where r.codigo = 'M02'), 60);
  -- _cons_mkt: consentimento de marketing vigente por cliente (o último registro de cada tipo; mesma regra de privado.consentiu_marketing)
  with _cons_mkt as (
    select x.titular_id, coalesce(bool_or(x.concedido) filter (where x.tipo = 'marketing_whatsapp'), false) whatsapp, coalesce(bool_or(x.concedido) filter (where x.tipo = 'marketing_email'), false) email
      from (select distinct on (c.titular_id, c.tipo) c.titular_id, c.tipo, c.concedido from public.consentimentos c
             where c.titular_tipo = 'cliente' and c.tipo in ('marketing_whatsapp', 'marketing_email') order by c.titular_id, c.tipo, c.em desc, c.id desc) x
     group by x.titular_id)
  select coalesce(jsonb_agg(x order by x ->> 'nome', x ->> 'clienteId'), '[]') into ren from (
    select distinct on (p.cliente_id) jsonb_build_object('clienteId', c.id, 'nome', c.nome, 'telefone', privado.mascarar_telefone(c.telefone), 'pedidoId', p.id,
      'consentimento', jsonb_build_object('whatsapp', coalesce(k.whatsapp, false), 'email', coalesce(k.email, false))) x
      from public.atendimentos a join public.pedidos p on p.id = a.pedido_id join public.clientes c on c.id = p.cliente_id and c.anonimizado_em is null
      left join _cons_mkt k on k.titular_id = c.id
     where a.data >= ini and a.data < fim and a.status <> 'cancelado'
       and p.pacote ->> 'frequencia' <> 'avulso' and p.status not in ('cancelado', 'recusado', 'solicitado')
     order by p.cliente_id, p.criado_em desc) t;
  with _cons_mkt as (
    select x.titular_id, coalesce(bool_or(x.concedido) filter (where x.tipo = 'marketing_whatsapp'), false) whatsapp, coalesce(bool_or(x.concedido) filter (where x.tipo = 'marketing_email'), false) email
      from (select distinct on (c.titular_id, c.tipo) c.titular_id, c.tipo, c.concedido from public.consentimentos c
             where c.titular_tipo = 'cliente' and c.tipo in ('marketing_whatsapp', 'marketing_email') order by c.titular_id, c.tipo, c.em desc, c.id desc) x
     group by x.titular_id)
  select coalesce(jsonb_agg(x order by x ->> 'ultima', x ->> 'clienteId'), '[]') into reat from (
    select jsonb_build_object('clienteId', c.id, 'nome', c.nome, 'telefone', privado.mascarar_telefone(c.telefone), 'ultima', u.ultima,
      'consentimento', jsonb_build_object('whatsapp', coalesce(k.whatsapp, false), 'email', coalesce(k.email, false))) x
      from (select p.cliente_id, max(a.data) filter (where a.status in ('finalizado', 'avaliado')) ultima,
                   bool_or(a.data >= hoje and a.status <> 'cancelado') futura
              from public.atendimentos a join public.pedidos p on p.id = a.pedido_id group by p.cliente_id) u
      join public.clientes c on c.id = u.cliente_id and c.anonimizado_em is null
      left join _cons_mkt k on k.titular_id = c.id
     where u.ultima <= hoje - dias and not coalesce(u.futura, false)) t;
  return jsonb_build_object('diasReativacao', dias,
    'renovacao', jsonb_build_object('total', jsonb_array_length(ren), 'comConsentimento', (select count(*) from jsonb_array_elements(ren) e where (e #>> '{consentimento,whatsapp}')::boolean or (e #>> '{consentimento,email}')::boolean), 'itens', (select coalesce(jsonb_agg(e), '[]') from (select e from jsonb_array_elements(ren) e limit 200) z),
      'regraLigada', (select ligada from public.automacao_regras where codigo = 'M01')),
    'reativacao', jsonb_build_object('total', jsonb_array_length(reat), 'comConsentimento', (select count(*) from jsonb_array_elements(reat) e where (e #>> '{consentimento,whatsapp}')::boolean or (e #>> '{consentimento,email}')::boolean), 'itens', (select coalesce(jsonb_agg(e), '[]') from (select e from jsonb_array_elements(reat) e limit 200) z),
      'regraLigada', (select ligada from public.automacao_regras where codigo = 'M02')));
end $$;

-- 4) Automações: a lista de envios ordena por agendada_para (ordenava a tabela inteira: 1,5 s, 5 s com cache frio) e a
--    linha do tempo por cliente filtra contexto->>'clienteId' (pedido e profissional já tinham índice).
create index if not exists automacao_execucoes_lista on public.automacao_execucoes (agendada_para desc, criado_em desc) where not teste;
create index if not exists automacao_execucoes_cliente on public.automacao_execucoes ((contexto ->> 'clienteId'));
