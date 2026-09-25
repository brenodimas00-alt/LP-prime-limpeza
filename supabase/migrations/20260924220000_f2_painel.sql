-- F2: leituras e ações do painel da Prime que ainda não existiam no banco.
-- - listar_clientes: base importada + site, com filtro de pendências, sem acesso, busca, último acesso e bloqueio.
-- - editar_precos (só prime_admin): nova linha em precos a partir da vigente, só nos valores em centavos da tabela.

create or replace function public.listar_clientes(p_filtro jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator(); lim int; pag int; busca text; digitos text; pend text; sem_acesso boolean;
begin
  perform privado.exigir_prime(s);
  lim := least(greatest(coalesce((p_filtro ->> 'limite')::int, 50), 1), 100);
  pag := greatest(coalesce((p_filtro ->> 'pagina')::int, 0), 0);
  busca := nullif(trim(coalesce(p_filtro ->> 'busca', '')), '');
  digitos := nullif(regexp_replace(coalesce(busca, ''), '\D', '', 'g'), '');
  pend := nullif(p_filtro ->> 'pendencia', '');
  sem_acesso := coalesce((p_filtro ->> 'semAcesso')::boolean, false);
  return (
    with filtrados as (
      select c.* from public.clientes c
      where (busca is null or c.nome ilike '%' || busca || '%' or c.email ilike '%' || busca || '%'
             or (digitos is not null and char_length(digitos) >= 4 and (c.documento like digitos || '%' or c.telefone like '%' || digitos || '%')))
        and (pend is null or (pend = 'qualquer' and cardinality(c.pendencias) > 0) or pend = any(c.pendencias))
        and (not sem_acesso or c.usuario_id is null)
    ), pagina as (
      select f.* from filtrados f order by f.nome, f.id limit lim offset pag * lim
    )
    select jsonb_build_object(
      'total', (select count(*) from filtrados),
      'pagina', pag, 'limite', lim,
      'contagemPendencias', (select coalesce(jsonb_object_agg(p, n), '{}') from (
          select unnest(c.pendencias) p, count(*) n from public.clientes c group by 1) x),
      'semAcesso', (select count(*) from public.clientes where usuario_id is null),
      'itens', (select coalesce(jsonb_agg(privado.j_cliente(g) || jsonb_build_object(
          'usuarioId', g.usuario_id, 'temAcesso', g.usuario_id is not null,
          'bloqueado', coalesce(pf.bloqueado, false),
          'ultimoAcesso', (select privado.iso(max(a.em)) from public.acessos a where a.user_id = g.usuario_id and a.resultado = 'sucesso'),
          'pedidos', (select count(*) from public.pedidos pd where pd.cliente_id = g.id)) order by g.nome, g.id), '[]')
        from pagina g left join public.perfis pf on pf.user_id = g.usuario_id)
    ));
end $$;

-- Valores editáveis pelo painel: chave -> caminho no JSON da tabela vigente. Nada de estrutura, só centavos.
create or replace function privado.caminho_preco(p_chave text) returns text[]
language sql immutable set search_path = '' as $$
  select case
    when p_chave ~ '^duracao\.(2|4|6|8)$' then array['PRECOS', 'duracoes', split_part(p_chave, '.', 2), 'centavos']
    when p_chave = 'horaExtra' then array['PRECOS', 'horaExtraCentavos']
    when p_chave ~ '^tipo\.(residencial|empresarial|condominial|pre_pos_mudanca|pre_pos_evento|passadoria)$' then array['PRECOS', 'tiposServico', split_part(p_chave, '.', 2), 'centavos']
    when p_chave = 'passadoriaCombinada' then array['PRECOS', 'passadoriaCombinada', 'centavos']
    when p_chave = 'taxaSabadoFeriado' then array['PRECOS', 'taxaSabadoFeriadoCentavos']
    when p_chave = 'taxaSemLocalAlmoco' then array['PRECOS', 'taxaSemLocalAlmocoCentavos']
  end
$$;

create or replace function public.editar_precos(p_dados jsonb, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; t jsonb; k text; v jsonb; caminho text[]; i int; conteudo jsonb := jsonb_build_object('valores', p_dados -> 'valores');
begin
  perform privado.exigir_prime(s);
  if not privado.eh_prime_admin() then perform privado.erro('ATOR_SEM_PERMISSAO', 'Só a administração da Prime muda preços'); end if;
  if jsonb_typeof(p_dados -> 'valores') is distinct from 'object' or p_dados -> 'valores' = '{}' then perform privado.erro('DADOS_INVALIDOS', 'Nada pra mudar'); end if;
  r := privado.idem_ler('editarPrecos', s, p_chave, conteudo);
  if r is not null then return r; end if;
  perform pg_advisory_xact_lock(hashtext('editar_precos'));
  select tabela into t from public.precos where vigente_desde <= now() order by vigente_desde desc limit 1;
  for k, v in select * from jsonb_each(p_dados -> 'valores') loop
    i := null; -- não herdar a faixa da volta anterior
    if k ~ '^descontoMensal\.[0-9]+$' then
      -- faixa do desconto do mês pelo mínimo de diárias (3 ou 5 hoje)
      select idx - 1 into i from jsonb_array_elements(t -> 'PRECOS' -> 'descontoMensal') with ordinality e(x, idx)
       where (x ->> 'minimoDiarias') = split_part(k, '.', 2);
      if i is null then perform privado.erro('DADOS_INVALIDOS', 'Faixa de desconto inexistente: ' || k); end if;
      caminho := array['PRECOS', 'descontoMensal', i::text, 'centavos'];
    else
      caminho := privado.caminho_preco(k);
    end if;
    if caminho is null then perform privado.erro('DADOS_INVALIDOS', 'Valor não editável: ' || left(k, 40)); end if;
    if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric <> trunc((v #>> '{}')::numeric) or (v #>> '{}')::numeric not between 0 and 100000 then
      perform privado.erro('DADOS_INVALIDOS', 'Valor inválido em ' || k || ' (centavos, de 0 a 100000)');
    end if;
    if t #> caminho is null then perform privado.erro('DADOS_INVALIDOS', 'Valor não existe na tabela vigente: ' || k); end if;
    t := jsonb_set(t, caminho, v);
  end loop;
  insert into public.precos (vigente_desde, tabela, criado_por) values (now(), t, auth.uid());
  r := jsonb_build_object('tabela', t, 'vigenteDesde', privado.iso(now()));
  perform privado.idem_gravar('editarPrecos', s, p_chave, conteudo, r);
  return r;
end $$;

-- Histórico de mudanças de preço pro painel (quem mudou e quando).
create or replace function public.listar_precos() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator();
begin
  perform privado.exigir_prime(s);
  return jsonb_build_object('itens', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'vigenteDesde', privado.iso(p.vigente_desde),
      'criadoPor', p.criado_por, 'tabela', p.tabela) order by p.vigente_desde desc), '[]') from (select * from public.precos order by vigente_desde desc limit 10) p));
end $$;

do $$ declare f text; begin
  foreach f in array array['listar_clientes(jsonb)', 'editar_precos(jsonb, text)', 'listar_precos()'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;
