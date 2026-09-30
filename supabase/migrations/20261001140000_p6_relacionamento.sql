-- P6 (fase 2, bloco 3): relacionamento e exportações.
-- 1) Listas no painel: clientes pra renovação (M01) e pra reativação (M02), com quantos têm consentimento de novidades.
--    O envio continua só com a Prime ligando a regra (Automações).
-- 2) Link da renovação (autoagendamento/?repetir=<pedido>): a cliente dona recebe os dados do pacote e as mesmas datas
--    no mês seguinte (dia não atendido anda pro próximo dia válido), pra conferir e enviar como nova solicitação.
-- 3) Exportações CSV (clientes, pedidos, pagamentos, repasses): só prime_admin, auditadas, com limite por hora, CPF e
--    contato mascarados por padrão; completo só com o pedido explícito (e a tela confirma antes).

insert into public.config_flags (chave, ligada, padrao, descricao) values
  ('p6_exportacoes', true, true, 'Exportar planilhas (clientes, pedidos, pagamentos, repasses) pelo painel')
on conflict (chave) do nothing;

-- ---------------------------------------------------------------- limite genérico por ação (também usado no P7)
create table if not exists privado.limites_acao (chave text not null, em timestamptz not null default now());
create index if not exists limites_acao_chave on privado.limites_acao (chave, em);
/** true se ainda cabe (e conta); false se passou de p_max na janela. Serializado pela chave. */
create or replace function privado.limite_acao(p_chave text, p_max int, p_janela interval) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtext('limite:' || p_chave));
  if (select count(*) from privado.limites_acao where chave = p_chave and em > now() - p_janela) >= p_max then return false; end if;
  insert into privado.limites_acao (chave) values (p_chave);
  delete from privado.limites_acao where chave = p_chave and em < now() - interval '2 days';
  return true;
end $$;

-- ---------------------------------------------------------------- máscaras (listagens e exportação padrão)
/** CPF com os 3 do meio visíveis (***.456.789-**, como pede a spec); CNPJ com a raiz do meio. */
create or replace function privado.mascarar_documento(tipo text, d text) returns text
language sql immutable set search_path = '' as $$
  select case when d is null then null
    when tipo = 'cnpj' and char_length(d) = 14 then '**.' || substr(d, 3, 3) || '.' || substr(d, 6, 3) || '/****-**'
    when char_length(d) = 11 then '***.' || substr(d, 4, 3) || '.' || substr(d, 7, 3) || '-**'
    else '***' end
$$;
create or replace function privado.mascarar_telefone(t text) returns text
language sql immutable set search_path = '' as $$
  select case when t is null then null when char_length(t) >= 10 then '(' || left(t, 2) || ') ' || case when char_length(t) = 11 then substr(t, 3, 1) else '' end || '****-' || right(t, 4) else '***' end
$$;
create or replace function privado.mascarar_email(e text) returns text
language sql immutable set search_path = '' as $$
  select case when e is null or position('@' in e) = 0 then e else left(e, 1) || '***@' || split_part(e, '@', 2) end
$$;

create or replace function privado.consentiu_marketing(p_cliente uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('whatsapp', coalesce((c ->> 'marketing_whatsapp')::boolean, false), 'email', coalesce((c ->> 'marketing_email')::boolean, false))
  from (select privado.consentimentos_atuais('cliente', p_cliente) c) x
$$;

-- ---------------------------------------------------------------- listas
/** Renovação (M01: pacote com diária neste mês) e reativação (M02: sem diária há N dias e nada marcado). Até 200 por lista. */
create or replace function public.listas_relacionamento() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator(); hoje date := privado.hoje_sp(); dias int; ren jsonb; reat jsonb;
begin
  perform privado.exigir_prime(s);
  dias := coalesce((select (r.atraso ->> 'dias')::int from public.automacao_regras r where r.codigo = 'M02'), 60);
  select coalesce(jsonb_agg(x order by x ->> 'nome'), '[]') into ren from (
    select distinct on (p.cliente_id) jsonb_build_object('clienteId', c.id, 'nome', c.nome, 'telefone', privado.mascarar_telefone(c.telefone), 'pedidoId', p.id,
      'consentimento', privado.consentiu_marketing(c.id)) x
      from public.pedidos p join public.clientes c on c.id = p.cliente_id and c.anonimizado_em is null
      join public.atendimentos a on a.pedido_id = p.id and a.status <> 'cancelado' and date_trunc('month', a.data) = date_trunc('month', hoje)
     where p.pacote ->> 'frequencia' <> 'avulso' and p.status not in ('cancelado', 'recusado', 'solicitado')
     order by p.cliente_id, p.criado_em desc) t;
  select coalesce(jsonb_agg(x order by x ->> 'ultima'), '[]') into reat from (
    select jsonb_build_object('clienteId', c.id, 'nome', c.nome, 'telefone', privado.mascarar_telefone(c.telefone), 'ultima', max(a.data),
      'consentimento', privado.consentiu_marketing(c.id)) x
      from public.atendimentos a join public.pedidos p on p.id = a.pedido_id join public.clientes c on c.id = p.cliente_id and c.anonimizado_em is null
     where a.status in ('finalizado', 'avaliado')
     group by c.id having max(a.data) <= hoje - dias
       and not exists (select 1 from public.atendimentos a2 join public.pedidos p2 on p2.id = a2.pedido_id where p2.cliente_id = c.id and a2.data >= hoje and a2.status <> 'cancelado')) t;
  return jsonb_build_object('diasReativacao', dias,
    'renovacao', jsonb_build_object('total', jsonb_array_length(ren), 'comConsentimento', (select count(*) from jsonb_array_elements(ren) e where (e #>> '{consentimento,whatsapp}')::boolean or (e #>> '{consentimento,email}')::boolean), 'itens', (select coalesce(jsonb_agg(e), '[]') from (select e from jsonb_array_elements(ren) e limit 200) z),
      'regraLigada', (select ligada from public.automacao_regras where codigo = 'M01')),
    'reativacao', jsonb_build_object('total', jsonb_array_length(reat), 'comConsentimento', (select count(*) from jsonb_array_elements(reat) e where (e #>> '{consentimento,whatsapp}')::boolean or (e #>> '{consentimento,email}')::boolean), 'itens', (select coalesce(jsonb_agg(e), '[]') from (select e from jsonb_array_elements(reat) e limit 200) z),
      'regraLigada', (select ligada from public.automacao_regras where codigo = 'M02')));
end $$;

/** Link da renovação: só a cliente dona do pedido. Mesmas datas (mesmo dia) no mês seguinte ao de hoje, ajustadas. */
create or replace function public.dados_renovacao(p_pedido uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator(); p public.pedidos; c public.clientes; cfg jsonb := privado.cfg(); hoje date := privado.hoje_sp();
        base date := (date_trunc('month', privado.hoje_sp()) + interval '1 month')::date; datas jsonb := '[]'; a record; d date; tentativas int;
begin
  select * into p from public.pedidos where id = p_pedido;
  if not found or s ->> 'ator' <> 'cliente' or p.cliente_id is distinct from (s ->> 'id')::uuid then perform privado.erro('NAO_ENCONTRADO', 'Pedido não encontrado'); end if;
  select * into c from public.clientes where id = p.cliente_id;
  for a in select distinct on (extract(day from x.data)) x.data, x.hora_inicio from public.atendimentos x
            where x.pedido_id = p.id and x.status <> 'cancelado' order by extract(day from x.data), x.data desc loop
    -- mesmo dia no mês seguinte (31 em mês de 30 vira o último dia); domingo, feriado bloqueado ou repetido anda pra frente
    d := least(base + (extract(day from a.data)::int - 1), (base + interval '1 month' - interval '1 day')::date);
    tentativas := 0;
    while (extract(dow from d) = 0 or datas @> to_jsonb(to_char(d, 'YYYY-MM-DD'))) and tentativas < 7 loop d := d + 1; tentativas := tentativas + 1; end loop;
    datas := datas || to_jsonb(to_char(d, 'YYYY-MM-DD'));
  end loop;
  return jsonb_build_object('tipoCliente', c.tipo, 'tipoServico', p.pacote ->> 'tipoServico', 'duracaoHoras', (p.pacote ->> 'duracaoHoras')::int,
    'metragem', p.pacote -> 'metragem', 'semLocalAlmoco', p.pacote -> 'semLocalAlmoco', 'endereco', coalesce(p.endereco, c.endereco),
    'horario', (select to_char(x.hora_inicio, 'HH24:MI') from public.atendimentos x where x.pedido_id = p.id and x.status <> 'cancelado' order by x.data desc limit 1),
    'datas', (select coalesce(jsonb_agg(v order by v), '[]') from jsonb_array_elements_text(datas) v where v::date > hoje));
end $$;

-- ---------------------------------------------------------------- exportações
/** Linhas pra planilha. Mascarado por padrão; completo só com p_completo (a tela pede confirmação). Auditado e limitado. */
create or replace function public.exportar(p_tipo text, p_completo boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); linhas jsonb; completo boolean := coalesce(p_completo, false);
begin
  perform privado.exigir_prime(s);
  if s ->> 'papel' <> 'prime_admin' then perform privado.erro('ATOR_SEM_PERMISSAO', 'Só a administração da Prime exporta planilhas'); end if;
  if not privado.flag('p6_exportacoes') then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Exportação desligada'); end if;
  if p_tipo not in ('clientes', 'pedidos', 'pagamentos', 'repasses') then perform privado.erro('DADOS_INVALIDOS', 'Planilha desconhecida'); end if;
  if not privado.limite_acao('exportar:' || auth.uid(), 20, interval '1 hour') then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Muitas exportações seguidas. Tente de novo em uma hora.'); end if;
  if p_tipo = 'clientes' then
    select coalesce(jsonb_agg(jsonb_build_object('nome', c.nome, 'tipo', c.tipo, 'documento', case when completo then c.documento else privado.mascarar_documento(c.tipo_documento, c.documento) end,
      'telefone', case when completo then c.telefone else privado.mascarar_telefone(c.telefone) end, 'email', case when completo then c.email else privado.mascarar_email(c.email) end,
      'cidade', c.endereco ->> 'cidade', 'origem', c.origem, 'cadastradoEm', to_char(c.criado_em at time zone 'America/Sao_Paulo', 'YYYY-MM-DD'),
      'pedidos', (select count(*) from public.pedidos p where p.cliente_id = c.id),
      'ultimaDiaria', (select to_char(max(a.data), 'YYYY-MM-DD') from public.atendimentos a join public.pedidos p on p.id = a.pedido_id where p.cliente_id = c.id and a.status in ('finalizado', 'avaliado')))
      order by c.nome), '[]') into linhas from public.clientes c where c.anonimizado_em is null;
  elsif p_tipo = 'pedidos' then
    select coalesce(jsonb_agg(jsonb_build_object('pedido', left(p.id::text, 8), 'cliente', c.nome, 'servico', p.pacote ->> 'tipoServico', 'situacao', p.status,
      'solicitadoEm', to_char(p.criado_em at time zone 'America/Sao_Paulo', 'YYYY-MM-DD'), 'diarias', (select count(*) from public.atendimentos a where a.pedido_id = p.id and a.status <> 'cancelado'),
      'primeiraData', (select to_char(min(a.data), 'YYYY-MM-DD') from public.atendimentos a where a.pedido_id = p.id), 'totalCentavos', p.total_centavos,
      'cidade', coalesce(p.endereco, c.endereco) ->> 'cidade') order by p.criado_em desc), '[]') into linhas
      from public.pedidos p join public.clientes c on c.id = p.cliente_id;
  elsif p_tipo = 'pagamentos' then
    select coalesce(jsonb_agg(jsonb_build_object('pedido', left(g.pedido_id::text, 8), 'cliente', c.nome, 'cobranca', g.parcela, 'valorCentavos', g.valor_centavos, 'situacao', g.status,
      'vence', to_char(g.vence_em, 'YYYY-MM-DD'), 'confirmadoEm', to_char(g.confirmado_em at time zone 'America/Sao_Paulo', 'YYYY-MM-DD'), 'metodo', g.metodo,
      'recibo', (select r.numero from public.recibos r where r.pagamento_id = g.id)) order by g.criado_em desc), '[]') into linhas
      from public.pagamentos g join public.pedidos p on p.id = g.pedido_id join public.clientes c on c.id = p.cliente_id;
  else
    select coalesce(jsonb_agg(jsonb_build_object('mes', to_char(r.mes, 'YYYY-MM-DD'), 'profissional', d.nome, 'cpf', case when completo then d.cpf else privado.mascarar_documento('cpf', d.cpf) end,
      'diarias', r.diarias, 'horas', r.horas, 'horasExtras', r.horas_extras, 'valorCentavos', r.valor_centavos) order by r.mes desc, d.nome), '[]') into linhas
      from public.repasses r join public.diaristas d on d.id = r.diarista_id;
  end if;
  insert into public.auditoria (tabela, operacao, ator_user_id, ator_papel, ator_contexto, depois)
  values ('exportacao', 'INSERT', auth.uid(), privado.papel(), 'prime', jsonb_build_object('tipo', p_tipo, 'completo', completo, 'linhas', jsonb_array_length(linhas)));
  return jsonb_build_object('tipo', p_tipo, 'completo', completo, 'linhas', linhas);
end $$;

revoke execute on function public.listas_relacionamento(), public.dados_renovacao(uuid), public.exportar(text, boolean) from public, anon;
grant execute on function public.listas_relacionamento(), public.dados_renovacao(uuid), public.exportar(text, boolean) to authenticated;
