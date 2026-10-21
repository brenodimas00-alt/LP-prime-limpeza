-- Painel v2, B4 (spec-painel-v2, seção 3): leituras das telas reorganizadas. Só leitura e só equipe Prime; nenhuma regra
-- de negócio muda.
--  - painel_solicitacoes: a lista completa com os mesmos campos do bloco do Início, filtros por estado, modalidade, origem e
--    período (data da 1ª diária), paginada.
--  - painel_ficha_cliente: ficha com a linha do tempo única (pedidos, pagamentos, mensagens, ocorrências, acessos e aceites),
--    consentimentos e pedidos de dados (LGPD). Mensagem sem o conteúdo e com o destino mascarado.
--  - painel_profissionais: lista com habilidades, situação, stand-by de hoje, documentos vencidos e média das avaliações.

create or replace function public.painel_solicitacoes(p_filtro jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator(); f jsonb := coalesce(p_filtro, '{}'); v_lim int := least(greatest(coalesce((f ->> 'limite')::int, 50), 1), 200);
        v_pag int := greatest(coalesce((f ->> 'pagina')::int, 0), 0); v_de date; v_ate date; v_estados text[];
begin
  perform privado.exigir_prime(s);
  begin v_de := nullif(f ->> 'de', '')::date; v_ate := nullif(f ->> 'ate', '')::date; exception when others then perform privado.erro('DADOS_INVALIDOS', 'Período inválido'); end;
  v_estados := case f ->> 'estado' when 'novas' then array['solicitado'] when 'aguardando' then array['aguardando_pagamento', 'disponibilidade_confirmada']
    when 'confirmadas' then array['confirmado'] when 'concluidas' then array['concluido'] when 'recusadas' then array['recusado'] when 'canceladas' then array['cancelado'] else null end;
  return (with base as (
      select p.*, c.nome cnome, c.telefone ctel, c.tipo ctipo, c.id cid, a.data primeira, a.hora_inicio hora, a.servico serv, a.duracao_minutos dur, a.caracteristicas car, a.local_refeicao refe,
             privado.p_endereco(a, p, c) e, (select count(*) from public.atendimentos x where x.pedido_id = p.id and x.status <> 'cancelado') qtd
        from public.pedidos p join public.clientes c on c.id = p.cliente_id
        left join lateral (select * from public.atendimentos x where x.pedido_id = p.id order by x.status = 'cancelado', x.data, x.hora_inicio nulls last limit 1) a on true
       where (v_estados is null or p.status = any(v_estados))
         and (nullif(f ->> 'modalidade', '') is null or p.modalidade = f ->> 'modalidade')
         and (nullif(f ->> 'origem', '') is null or p.origem_cliente ->> 'origem' = f ->> 'origem')
         and (v_de is null or a.data >= v_de) and (v_ate is null or a.data <= v_ate))
    select jsonb_build_object('total', (select count(*) from base), 'pagina', v_pag, 'itens', coalesce((select jsonb_agg(x) from (
      select jsonb_build_object('pedidoId', b.id, 'numero', b.numero_solicitacao, 'criadoEm', b.criado_em, 'status', b.status, 'modalidade', b.modalidade,
        'cliente', jsonb_build_object('id', b.cid, 'nome', b.cnome, 'telefone', b.ctel, 'tipo', b.ctipo), 'local', jsonb_build_object('bairro', b.e ->> 'bairro', 'cidade', b.e ->> 'cidade'),
        'servico', coalesce(b.serv, b.pacote ->> 'tipoServico'), 'quantidade', b.qtd, 'primeiraData', b.primeira, 'horaInicio', to_char(b.hora, 'HH24:MI'),
        'horas', round(coalesce(b.dur, (b.pacote ->> 'duracaoHoras')::int * 60) / 60.0, 1),
        'imovel', jsonb_build_object('metragem', coalesce((b.car ->> 'metragem')::numeric, (b.pacote ->> 'metragem')::numeric), 'ambientes', privado.p_ambientes(b.car),
                                     'pecas', (b.car ->> 'pecas')::int, 'animais', coalesce((b.car #>> '{animais,tem}')::boolean, false), 'refeicao', b.refe),
        'valorCentavos', b.total_centavos, 'origem', b.origem_cliente, 'enderecoNovoPacote', b.pacote_endereco_novo, 'proposta', b.proposta_data,
        'recusa', b.recusa, 'cancelamento', b.cancelamento) x
        from base b order by case when b.status = 'solicitado' then 0 else 1 end, case when b.status = 'solicitado' then b.primeira end, b.criado_em desc
        limit v_lim offset v_pag * v_lim) y), '[]')) from (select 1) z);
end $$;

create or replace function public.painel_ficha_cliente(p_cliente uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator(); c public.clientes; tl jsonb := '[]';
begin
  perform privado.exigir_prime(s);
  select * into c from public.clientes where id = p_cliente and anonimizado_em is null;
  if not found then perform privado.erro('NAO_ENCONTRADO', 'Cliente não encontrada'); end if;
  -- pedidos (criação e mudanças de situação)
  tl := tl || coalesce((select jsonb_agg(jsonb_build_object('tipo', 'pedido', 'em', h ->> 'em', 'titulo', case h ->> 'para' when 'solicitado' then 'Solicitação enviada' when 'disponibilidade_confirmada' then 'Disponibilidade confirmada'
        when 'aguardando_pagamento' then 'Cobrança emitida' when 'confirmado' then 'Solicitação confirmada' when 'concluido' then 'Solicitação concluída' when 'cancelado' then 'Solicitação cancelada'
        when 'recusado' then 'Solicitação recusada' else coalesce(h ->> 'evento', h ->> 'para') end,
      'detalhe', concat_ws(' · ', 'nº ' || lpad(p.numero_solicitacao::text, 6, '0'), nullif(case when h ->> 'para' = 'recusado' then p.recusa ->> 'motivo' when h ->> 'para' = 'cancelado' then p.cancelamento ->> 'motivo' end, '')),
      'ref', jsonb_build_object('pedidoId', p.id)))
    from public.pedidos p cross join lateral jsonb_array_elements(p.historico) h where p.cliente_id = c.id and h ->> 'em' is not null), '[]');
  -- pagamentos confirmados ou estornados
  tl := tl || coalesce((select jsonb_agg(jsonb_build_object('tipo', 'pagamento', 'em', coalesce(g.confirmado_em, g.atualizado_em),
      'titulo', case g.status when 'confirmado' then 'Pagamento confirmado' else 'Pagamento estornado' end, 'detalhe', 'R$ ' || to_char(g.valor_centavos / 100.0, 'FM999G990D00'), 'ref', jsonb_build_object('pagamentoId', g.id)))
    from public.pagamentos g join public.pedidos p on p.id = g.pedido_id where p.cliente_id = c.id and g.status in ('confirmado', 'estornado')), '[]');
  -- mensagens enviadas pra cliente (sem conteúdo)
  tl := tl || coalesce((select jsonb_agg(jsonb_build_object('tipo', 'mensagem', 'em', e.atualizado_em, 'titulo', coalesce(r.descricao, e.regra),
      'detalhe', case e.estado when 'falhou' then 'não saiu' when 'cancelada' then 'cancelada' else 'enviada' end, 'ref', jsonb_build_object('execucaoId', e.id)))
    from public.automacao_execucoes e left join public.automacao_regras r on r.codigo = e.regra
   where e.titular_tipo = 'cliente' and e.titular_id = c.id and not e.teste and e.estado in ('enviada', 'entregue', 'lida', 'falhou')), '[]');
  -- ocorrências
  tl := tl || coalesce((select jsonb_agg(jsonb_build_object('tipo', 'ocorrencia', 'em', o.criado_em, 'titulo', 'Ocorrência ' || case o.estado when 'aberto' then 'aberta' when 'em_analise' then 'em análise' else 'resolvida' end,
      'detalhe', left(o.descricao, 120), 'ref', jsonb_build_object('ocorrenciaId', o.id)))
    from public.ocorrencias o where o.cliente_id = c.id), '[]');
  -- acessos (entradas na conta) e aceites
  if c.usuario_id is not null then
    tl := tl || coalesce((select jsonb_agg(jsonb_build_object('tipo', 'acesso', 'em', x.em, 'titulo', case when x.resultado = 'ok' then 'Entrou na conta' else 'Tentativa de entrada' end, 'detalhe', coalesce(x.dispositivo, ''), 'ref', '{}'::jsonb))
      from (select * from public.acessos where user_id = c.usuario_id order by em desc limit 20) x), '[]');
  end if;
  tl := tl || coalesce((select jsonb_agg(jsonb_build_object('tipo', 'acesso', 'em', a.aceito_em, 'titulo', 'Aceitou os termos', 'detalhe', 'versão ' || a.versao, 'ref', '{}'::jsonb))
    from public.aceites_termos a where a.titular_tipo = 'cliente' and a.titular_id = c.id), '[]');
  return jsonb_build_object(
    'cliente', jsonb_build_object('id', c.id, 'nome', c.nome, 'tipo', c.tipo, 'telefone', c.telefone, 'email', c.email, 'documento', privado.mascarar_documento(c.tipo_documento, c.documento),
      'razaoSocial', c.razao_social, 'responsavel', c.responsavel, 'origem', c.origem, 'criadoEm', c.criado_em, 'temAcesso', c.usuario_id is not null, 'pendencias', to_jsonb(c.pendencias)),
    'resumo', jsonb_build_object(
      'pedidos', (select count(*) from public.pedidos where cliente_id = c.id),
      'diariasFeitas', (select count(*) from public.atendimentos a join public.pedidos p on p.id = a.pedido_id where p.cliente_id = c.id and a.status in ('finalizado', 'avaliado')),
      'ultimaDiaria', (select max(a.data) from public.atendimentos a join public.pedidos p on p.id = a.pedido_id where p.cliente_id = c.id and a.status in ('finalizado', 'avaliado')),
      'proximaDiaria', (select min(a.data) from public.atendimentos a join public.pedidos p on p.id = a.pedido_id where p.cliente_id = c.id and a.status in ('agendado', 'confirmado') and a.data >= privado.hoje_sp()),
      'totalPagoCentavos', (select coalesce(sum(g.valor_centavos), 0) from public.pagamentos g join public.pedidos p on p.id = g.pedido_id where p.cliente_id = c.id and g.status = 'confirmado')),
    'linhaDoTempo', (select coalesce(jsonb_agg(x order by x ->> 'em' desc), '[]') from (select x from jsonb_array_elements(tl) x order by x ->> 'em' desc limit 80) y),
    'consentimentos', coalesce((select jsonb_agg(jsonb_build_object('tipo', k.tipo, 'concedido', k.concedido, 'em', k.em) order by k.em desc)
      from (select distinct on (tipo) * from public.consentimentos where titular_tipo = 'cliente' and titular_id = c.id order by tipo, em desc) k), '[]'),
    'pedidosDados', coalesce((select jsonb_agg(jsonb_build_object('tipo', t.tipo, 'estado', t.estado, 'criadoEm', t.criado_em) order by t.criado_em desc)
      from public.pedidos_titular t where t.titular_tipo = 'cliente' and t.titular_id = c.id), '[]'));
end $$;

create or replace function public.painel_profissionais(p_filtro jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator(); f jsonb := coalesce(p_filtro, '{}'); v_hoje date := privado.hoje_sp(); v_busca text := lower(trim(coalesce(f ->> 'busca', '')));
begin
  perform privado.exigir_prime(s);
  return jsonb_build_object('itens', coalesce((select jsonb_agg(x order by x ->> 'ordem', x ->> 'nome') from (
    select jsonb_build_object('id', d.id, 'nome', d.nome, 'telefone', d.telefone, 'status', d.status, 'habilidades', to_jsonb(d.habilidades), 'disponibilidade', d.disponibilidade,
      'ordem', case d.status when 'pendente' then '0' when 'aprovada' then '1' else '2' end,
      'diariasSemana', (select count(*) from public.atendimentos a where a.diarista_id = d.id and a.status <> 'cancelado' and a.data between v_hoje and v_hoje + 6),
      'hojeStandby', d.status = 'aprovada' and jsonb_typeof(d.disponibilidade -> 'dias') = 'array' and (d.disponibilidade -> 'dias') @> to_jsonb(extract(dow from v_hoje)::int)
                     and not exists (select 1 from public.atendimentos a where a.diarista_id = d.id and a.data = v_hoje and a.status <> 'cancelado')
                     and not exists (select 1 from public.bloqueios_profissional b where b.diarista_id = d.id and v_hoje between b.de and b.ate),
      'bloqueadaHoje', exists (select 1 from public.bloqueios_profissional b where b.diarista_id = d.id and v_hoje between b.de and b.ate),
      'documentosVencidos', (select count(*) from public.documentos x where x.diarista_id = d.id and x.excluido_em is null and x.valido_ate < v_hoje
                               and not exists (select 1 from public.documentos y where y.diarista_id = x.diarista_id and y.tipo = x.tipo and y.excluido_em is null and y.criado_em > x.criado_em)),
      'mediaAvaliacoes', (select round(avg(v.nota_final), 1) from public.avaliacoes v join public.atendimentos a on a.id = v.atendimento_id where a.diarista_id = d.id),
      'avaliacoes', (select count(*) from public.avaliacoes v join public.atendimentos a on a.id = v.atendimento_id where a.diarista_id = d.id)) x
      from public.diaristas d
     where d.status <> 'rascunho' and (nullif(f ->> 'status', '') is null or d.status = f ->> 'status')
       and (v_busca = '' or lower(d.nome) like '%' || v_busca || '%')) y), '[]'));
end $$;

do $$ declare f text; begin
  foreach f in array array['painel_solicitacoes(jsonb)', 'painel_ficha_cliente(uuid)', 'painel_profissionais(jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- A meta mensal (B3) fica fora da leitura pública de configuracao (o painel lê pela RPC painel_indicadores_home).
alter policy leitura_publica on public.configuracao using (chave not in ('repasse', 'meta_diarias'));
