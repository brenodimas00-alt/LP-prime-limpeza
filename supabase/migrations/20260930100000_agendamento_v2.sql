-- Agendamento v2 (spec-agendamento-v2.txt + autoagendamento-isa.txt + decisões da Gabs de 28/09/2026). Migration ADITIVA:
-- nenhuma coluna apagada, nenhum dado removido. Espelha src/domain/agenda.js e src/domain/horario.js (paridade testada em
-- scripts/testa-paridade.mjs).
-- 1) Horário exato: atendimentos.hora_inicio + duracao_minutos (backfill manhã 08:00, tarde 13:00, integral 08:00; duração
--    pela carga contratada, somando as horas extras antigas). turno fica nullable e deprecated.
-- 2) Pedido guarda o endereço do atendimento, os dados informados (quando vinculado a um cadastro existente) e o aceite
--    das Condições do atendimento (versão e data).
-- 3) Configuração nova na tabela vigente de preços: limites de duração por tipo de cliente, cômodos, serviços por tipo e
--    horários de trabalho (08:00 até 18:30, de 30 em 30 min, segunda a sábado).

-- ---------------------------------------------------------------- esquema
alter table public.atendimentos
  add column hora_inicio time,
  add column duracao_minutos int check (duracao_minutos between 60 and 720);
alter table public.atendimentos alter column turno drop not null;

update public.atendimentos a set
  hora_inicio = case a.turno when 'tarde' then time '13:00' else time '08:00' end,
  duracao_minutos = ((coalesce((p.pacote ->> 'duracaoHoras')::int, case when a.turno = 'integral' then 8 else 4 end)
                      + coalesce((p.pacote ->> 'horasExtras')::int, 0)) * 60)
  from public.pedidos p where p.id = a.pedido_id and a.hora_inicio is null;

/**
 * Compatibilidade: caminho antigo que ainda grava só o turno (seed, reagendamento por turno) ganha hora e duração aqui.
 * Código novo grava hora_inicio e duracao_minutos direto e deixa turno nulo.
 */
create or replace function privado.atendimento_horario() returns trigger
language plpgsql set search_path = '' as $$
declare p jsonb;
begin
  if tg_op = 'UPDATE' and new.turno is distinct from old.turno and new.turno is not null and new.hora_inicio is not distinct from old.hora_inicio then
    new.hora_inicio := case new.turno when 'tarde' then time '13:00' else time '08:00' end;
  end if;
  if new.hora_inicio is null and new.turno is not null then
    new.hora_inicio := case new.turno when 'tarde' then time '13:00' else time '08:00' end;
  end if;
  if new.duracao_minutos is null then
    select pacote into p from public.pedidos where id = new.pedido_id;
    new.duracao_minutos := (coalesce((p ->> 'duracaoHoras')::int, case when new.turno = 'integral' then 8 else 4 end) + coalesce((p ->> 'horasExtras')::int, 0)) * 60;
  end if;
  return new;
end $$;
create trigger atendimentos_horario before insert or update on public.atendimentos for each row execute function privado.atendimento_horario();

alter table public.atendimentos add constraint atendimentos_horario_definido check (hora_inicio is not null and duracao_minutos is not null);
create index atendimentos_data_hora on public.atendimentos (data, hora_inicio);

alter table public.pedidos
  add column endereco jsonb check (endereco is null or jsonb_typeof(endereco) = 'object'),
  add column dados_informados jsonb check (dados_informados is null or jsonb_typeof(dados_informados) = 'object'),
  add column aceite_condicoes jsonb check (aceite_condicoes is null or (jsonb_typeof(aceite_condicoes) = 'object' and aceite_condicoes ? 'versao'));

-- Condições do atendimento (documento versionado; o texto está em /condicoes/). Tabela própria: documentos_legais tem a
-- versão como chave (referenciada pelos aceites de termos) e as duas versões podem cair no mesmo dia.
create table public.condicoes_atendimento (
  versao text primary key check (versao ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  vigente_desde timestamptz not null,
  resumo text not null check (char_length(resumo) between 3 and 500)
);
alter table public.condicoes_atendimento enable row level security;
alter table public.condicoes_atendimento force row level security;
revoke all on public.condicoes_atendimento from anon, authenticated;
insert into public.condicoes_atendimento (versao, vigente_desde, resumo)
values ('2026-09-29', '2026-09-29 00:00:00-03', 'Primeira versão das Condições do atendimento (base: texto do sistema antigo da Prime; pendente de aprovação da cliente e revisão jurídica).');

create or replace function privado.versao_condicoes() returns text
language sql stable security definer set search_path = '' as $$
  select c.versao from public.condicoes_atendimento c where c.vigente_desde <= now() order by c.vigente_desde desc limit 1
$$;
create or replace function public.versao_condicoes() returns text
language sql stable security definer set search_path = '' as $$ select privado.versao_condicoes() $$;
grant execute on function public.versao_condicoes() to anon, authenticated;

-- ---------------------------------------------------------------- configuração (nova linha da tabela vigente)
insert into public.precos (vigente_desde, tabela)
select now(), jsonb_set(p.tabela, '{PRECOS}', (p.tabela -> 'PRECOS') || '{
    "limitesDuracao": {
      "residencial": [{"horas": 2, "comodos": 3, "metragem": 30}, {"horas": 4, "comodos": 5, "metragem": 50}, {"horas": 6, "comodos": 8, "metragem": 80}, {"horas": 8, "comodos": 10, "metragem": 120}],
      "empresa": [{"horas": 2, "comodos": 4, "metragem": 40}, {"horas": 4, "comodos": 6, "metragem": 60}, {"horas": 6, "comodos": 9, "metragem": 90}, {"horas": 8, "comodos": 11, "metragem": 130}]
    },
    "comodos": {"tipos": ["quartos", "banheiros", "salas", "cozinhas", "areaExterna"], "maximoPorTipo": 20},
    "pecas": {"maximo": 200},
    "servicosPorTipoCliente": {
      "residencial": ["residencial", "pre_pos_mudanca", "pre_pos_evento", "passadoria"],
      "empresa": ["empresarial", "condominial", "pre_pos_mudanca", "pre_pos_evento"]
    }
  }'::jsonb) || '{"horariosTrabalho": {"dias": [1, 2, 3, 4, 5, 6], "primeiroInicio": "08:00", "fimExpediente": "18:30", "intervaloMinutos": 30}}'::jsonb
  from public.precos p where p.vigente_desde <= now() order by p.vigente_desde desc, p.id desc limit 1;

-- ---------------------------------------------------------------- domínio (agenda.js / horario.js)
create or replace function privado.min_hm(h text) returns int
language sql immutable set search_path = '' as $$ select split_part(h, ':', 1)::int * 60 + split_part(h, ':', 2)::int $$;

create or replace function privado.hm(m int) returns text
language sql immutable set search_path = '' as $$ select lpad((m / 60)::text, 2, '0') || ':' || lpad((m % 60)::text, 2, '0') $$;

create or replace function privado.data_ok(v jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare d date;
begin
  if jsonb_typeof(v) is distinct from 'string' or (v #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
  d := (v #>> '{}')::date;
  return to_char(d, 'YYYY-MM-DD') = v #>> '{}';
exception when others then return false;
end $$;

/** horariosDeInicio: de primeiroInicio até fimExpediente − duração, de intervaloMinutos em intervaloMinutos. */
create or replace function privado.horarios_inicio(p_horas int, cfg jsonb) returns text[]
language sql stable set search_path = '' as $$
  select coalesce(array_agg(privado.hm(m) order by m), '{}')
    from generate_series(privado.min_hm(cfg #>> '{horariosTrabalho,primeiroInicio}'),
                         privado.min_hm(cfg #>> '{horariosTrabalho,fimExpediente}') - p_horas * 60,
                         (cfg #>> '{horariosTrabalho,intervaloMinutos}')::int) m
$$;

create or replace function privado.total_comodos(c jsonb, cfg jsonb) returns int
language sql stable set search_path = '' as $$
  select coalesce(sum(case when privado.eh_inteiro(c -> t) then (c ->> t)::int else 0 end), 0)::int
    from jsonb_array_elements_text(cfg #> '{PRECOS,comodos,tipos}') t
   where jsonb_typeof(c) = 'object'
$$;

/** estimarDuracao: menor carga cujo limite comporta a metragem (se informada) E o total de cômodos (se houver). */
create or replace function privado.estimar_duracao(e jsonb, cfg jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare tab jsonb := cfg -> 'PRECOS' -> 'limitesDuracao' -> (case when e ->> 'tipoCliente' = 'empresa' then 'empresa' else 'residencial' end);
        total int := privado.total_comodos(e -> 'comodos', cfg); m numeric; f jsonb;
begin
  m := case when privado.tem_valor(e -> 'metragem') then (e ->> 'metragem')::numeric end;
  if m is null and total = 0 then return jsonb_build_object('horas', null, 'motivo', 'sem_dados', 'totalComodos', 0); end if;
  select x into f from jsonb_array_elements(tab) with ordinality t(x, n)
   where (m is null or m <= (x ->> 'metragem')::numeric) and (total = 0 or total <= (x ->> 'comodos')::int) order by n limit 1;
  if f is null then return jsonb_build_object('horas', null, 'motivo', 'acima', 'totalComodos', total); end if;
  return jsonb_build_object('horas', (f ->> 'horas')::int, 'motivo', 'ok', 'totalComodos', total);
end $$;

/** regrasAgenda: os dias fora de horariosTrabalho.dias somam aos bloqueados. */
create or replace function privado.cfg_agenda(cfg jsonb) returns jsonb
language sql stable set search_path = '' as $$
  select cfg || jsonb_build_object('diasBloqueados', (
    select coalesce(jsonb_agg(distinct d order by d), '[]') from (
      select (x #>> '{}')::int d from jsonb_array_elements(coalesce(cfg -> 'diasBloqueados', '[]')) x
      union select d from generate_series(0, 6) d where not coalesce(cfg #> '{horariosTrabalho,dias}', '[1,2,3,4,5,6]') @> to_jsonb(d)) z))
$$;

/** motivoDataIndisponivel (null = pode). cfg já passado por cfg_agenda. */
create or replace function privado.motivo_data(v jsonb, hoje date, cfg jsonb) returns text
language plpgsql stable set search_path = '' as $$
declare d date; dif int;
        ant int := coalesce((cfg #>> '{regrasCalendario,antecedenciaMinimaDias}')::int, 1);
        hor int := coalesce((cfg #>> '{regrasCalendario,horizonteMaximoDias}')::int, 120);
begin
  if not privado.data_ok(v) then return 'data inválida'; end if;
  d := (v #>> '{}')::date; dif := d - hoje;
  if dif < 0 then return 'data no passado'; end if;
  if dif < ant then return 'antecedência mínima de ' || ant || ' dia(s)'; end if;
  if dif > hor then return 'no máximo ' || hor || ' dias à frente'; end if;
  if (cfg -> 'diasBloqueados') @> to_jsonb(privado.dia_semana(d)) then return 'não atendemos ' || privado.nome_dia(d); end if;
  if (cfg -> 'datasBloqueadas') @> to_jsonb(v #>> '{}') then return 'a Prime não atende nesta data'; end if;
  return null;
end $$;

/** validarSolicitacao: mesmas mensagens e mesma ordem do JS. */
create or replace function privado.validar_solicitacao(sol jsonb, cfg jsonb) returns text[]
language plpgsql stable set search_path = '' as $$
declare P jsonb := cfg -> 'PRECOS'; e text[] := '{}'; a jsonb := sol -> 'agenda'; tipo jsonb; passadoria boolean; lim2 jsonb; mx int;
        comodos_ok boolean;
begin
  if jsonb_typeof(sol) is distinct from 'object' then return array['Solicitação não informada']; end if;
  if coalesce(sol ->> 'tipoCliente', '') not in ('residencial', 'empresa') then e := e || 'Escolha onde será realizada a limpeza'::text; end if;
  tipo := P -> 'tiposServico' -> (sol ->> 'tipoServico');
  if P -> 'naoOferecidos' ? coalesce(sol ->> 'tipoServico', '') then e := e || (P -> 'naoOferecidos' ->> (sol ->> 'tipoServico'));
  elsif tipo is null or not coalesce((P -> 'servicosPorTipoCliente' -> (sol ->> 'tipoCliente')) ? (sol ->> 'tipoServico'), false) then e := e || 'Escolha o serviço'::text; end if;
  if not privado.eh_inteiro(sol -> 'duracaoHoras') or not (P -> 'duracoes') ? (sol ->> 'duracaoHoras') then e := e || 'Escolha a duração da diária (2, 4, 6 ou 8 horas)'::text; end if;
  passadoria := coalesce((tipo ->> 'exclusivo')::boolean, false);
  if passadoria then
    if privado.tem_valor(sol -> 'pecas') and (not privado.eh_inteiro(sol -> 'pecas') or (sol ->> 'pecas')::int < 1 or (sol ->> 'pecas')::int > (P #>> '{pecas,maximo}')::int) then
      e := e || ('Quantidade de peças: de 1 a ' || (P #>> '{pecas,maximo}'));
    end if;
  else
    if privado.tem_valor(sol -> 'metragem') and (not privado.eh_inteiro(sol -> 'metragem') or (sol ->> 'metragem')::numeric < (P #>> '{metragem,minimo}')::int or (sol ->> 'metragem')::numeric > (P #>> '{metragem,maximo}')::int) then
      e := e || ('Metragem deve ser um inteiro entre ' || (P #>> '{metragem,minimo}') || ' e ' || (P #>> '{metragem,maximo}') || ' m²');
    end if;
    if privado.tem_valor(sol -> 'comodos') then
      comodos_ok := jsonb_typeof(sol -> 'comodos') = 'object'
        and not exists (select 1 from jsonb_object_keys(sol -> 'comodos') k where not (P #> '{comodos,tipos}') ? k)
        and not exists (select 1 from jsonb_each(sol -> 'comodos') x where not privado.eh_inteiro(x.value) or (x.value #>> '{}')::int < 0 or (x.value #>> '{}')::int > (P #>> '{comodos,maximoPorTipo}')::int);
      if not comodos_ok then e := e || 'Quantidade de cômodos inválida'::text; end if;
    end if;
    lim2 := P -> 'limitesDuracao' -> (case when sol ->> 'tipoCliente' = 'empresa' then 'empresa' else 'residencial' end) -> 0;
    if privado.eh_inteiro(sol -> 'duracaoHoras') and (sol ->> 'duracaoHoras')::int = (lim2 ->> 'horas')::int and cardinality(e) = 0
       and ((privado.tem_valor(sol -> 'metragem') and (sol ->> 'metragem')::numeric > (lim2 ->> 'metragem')::int) or privado.total_comodos(sol -> 'comodos', cfg) > (lim2 ->> 'comodos')::int) then
      e := e || ('A diária de ' || (lim2 ->> 'horas') || ' horas é só para locais até ' || (lim2 ->> 'metragem') || ' m² e ' || (lim2 ->> 'comodos') || ' cômodos');
    end if;
  end if;
  if sol ? 'semLocalAlmoco' and jsonb_typeof(sol -> 'semLocalAlmoco') is distinct from 'boolean' then e := e || 'Resposta sobre o almoço inválida'::text; end if;
  mx := (P #>> '{quantidadeDiarias,maximo}')::int;
  if jsonb_typeof(a) is distinct from 'object' or coalesce(a ->> 'modo', '') not in ('unica', 'datas_escolhidas', 'recorrente') then
    return e || 'Escolha como deseja agendar'::text;
  end if;
  if a ->> 'modo' = 'unica' and (jsonb_typeof(a -> 'datas') is distinct from 'array' or jsonb_array_length(a -> 'datas') <> 1) then e := e || 'Escolha a data da diária'::text; end if;
  if a ->> 'modo' = 'datas_escolhidas' then
    if jsonb_typeof(a -> 'datas') is distinct from 'array' or jsonb_array_length(a -> 'datas') < 2 then e := e || 'Escolha pelo menos 2 datas'::text;
    elsif jsonb_array_length(a -> 'datas') > mx then e := e || ('No máximo ' || mx || ' diárias por solicitação');
    elsif (select count(distinct x) from jsonb_array_elements(a -> 'datas') x) <> jsonb_array_length(a -> 'datas') then e := e || 'A mesma data foi escolhida duas vezes'::text; end if;
  end if;
  if a ->> 'modo' = 'recorrente' then
    if coalesce(a ->> 'frequencia', '') not in ('semanal', 'quinzenal', 'mensal') then e := e || 'Escolha a frequência (semanal, quinzenal ou mensal)'::text; end if;
    if not privado.eh_inteiro(a -> 'quantidade') or (a ->> 'quantidade')::int < 2 or (a ->> 'quantidade')::int > mx then e := e || ('Quantidade de diárias: de 2 a ' || mx); end if;
    if not privado.data_ok(a -> 'primeiraData') then e := e || 'Escolha a data da primeira diária'::text; end if;
  end if;
  if a ->> 'modo' <> 'recorrente' and jsonb_typeof(a -> 'datas') = 'array' and exists (select 1 from jsonb_array_elements(a -> 'datas') x where not privado.data_ok(x)) then
    e := e || 'Data inválida'::text;
  end if;
  return e;
end $$;

/** datasDaAgenda: recorrente pela frequência (com deslocamento de dia bloqueado); senão as datas escolhidas, ordenadas. */
create or replace function privado.datas_da_agenda(a jsonb, cfg jsonb) returns jsonb
language sql stable set search_path = '' as $$
  select case when a ->> 'modo' = 'recorrente'
    then privado.gerar_ocorrencias(a ->> 'frequencia', (a ->> 'quantidade')::int, (a ->> 'primeiraData')::date, cfg)
    else (select jsonb_agg(jsonb_build_object('sequencia', n, 'data', d, 'original', d, 'deslocada', false) order by n)
            from (select x #>> '{}' d, row_number() over (order by x #>> '{}') n from jsonb_array_elements(a -> 'datas') x) z)
  end
$$;

/** cotarSolicitacao: {itens, descontos, cobrancas, pacote}. Mesmos códigos de erro do JS. */
create or replace function privado.cotar_solicitacao(sol jsonb, hoje date, endereco jsonb, cfg0 jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  cfg jsonb := privado.cfg_agenda(cfg0); P jsonb := cfg0 -> 'PRECOS'; erros text[] := privado.validar_solicitacao(sol, cfg0);
  tipo jsonb; itens_dia jsonb; reg public.regioes; taxa_desl bigint := 0; base bigint; datas jsonb; opcoes text[]; probs jsonb := '[]';
  o jsonb; h text; motivo text; itens jsonb := '[]'; taxa bigint; descontos jsonb := '[]'; desconto bigint := 0; total bigint := 0; faixa jsonb; m record;
  modo_pg text; passadoria boolean; est jsonb; pacote jsonb; dur int;
begin
  if cardinality(erros) > 0 then perform privado.erro('DADOS_INVALIDOS', array_to_string(erros, '; '), to_jsonb(erros)); end if;
  tipo := P -> 'tiposServico' -> (sol ->> 'tipoServico');
  dur := (sol ->> 'duracaoHoras')::int;
  itens_dia := jsonb_build_array(jsonb_build_object('codigo', 'diaria', 'descricao', 'Diária de ' || dur || ' horas', 'centavos', (P -> 'duracoes' -> (dur::text) ->> 'centavos')::bigint));
  if (tipo ->> 'centavos')::bigint > 0 then itens_dia := itens_dia || jsonb_build_object('codigo', 'servico:' || (sol ->> 'tipoServico'), 'descricao', tipo ->> 'nome', 'centavos', (tipo ->> 'centavos')::bigint); end if;
  if (sol -> 'semLocalAlmoco') = 'true' then itens_dia := itens_dia || jsonb_build_object('codigo', 'sem_local_almoco', 'descricao', 'Sem local para guardar e esquentar a refeição', 'centavos', (P ->> 'taxaSemLocalAlmocoCentavos')::bigint); end if;
  if jsonb_typeof(endereco) = 'object' then
    reg := privado.regiao(endereco);
    if reg.cidade is null then perform privado.erro('REGIAO_NAO_ATENDIDA', 'Ainda não atendemos ' || coalesce(nullif(endereco ->> 'cidade', ''), 'essa cidade')); end if;
    if reg.sob_consulta then perform privado.erro('REGIAO_SOB_CONSULTA', reg.cidade || ': atendimento sob consulta. Fale com a Prime pelo WhatsApp.'); end if;
    taxa_desl := coalesce(reg.taxa_centavos, 0);
    if taxa_desl > 0 then itens_dia := itens_dia || jsonb_build_object('codigo', 'deslocamento', 'descricao', 'Taxa de deslocamento (' || reg.cidade || ')', 'centavos', taxa_desl); end if;
  end if;
  select sum((i ->> 'centavos')::bigint) into base from jsonb_array_elements(itens_dia) i;
  datas := privado.datas_da_agenda(sol -> 'agenda', cfg);
  opcoes := privado.horarios_inicio(dur, cfg);
  for o in select * from jsonb_array_elements(datas) loop
    motivo := privado.motivo_data(o -> 'data', hoje, cfg);
    if motivo is not null then probs := probs || jsonb_build_object('sequencia', o -> 'sequencia', 'data', o -> 'data', 'motivo', motivo); end if;
    h := coalesce(nullif(sol #>> array['agenda', 'horarios', o ->> 'data'], ''), nullif(sol #>> '{agenda,horario}', ''));
    if h is null then probs := probs || jsonb_build_object('sequencia', o -> 'sequencia', 'data', o -> 'data', 'motivo', 'escolha o horário');
    elsif not h = any(opcoes) then probs := probs || jsonb_build_object('sequencia', o -> 'sequencia', 'data', o -> 'data', 'motivo', 'horário ' || h || ' fora do horário de trabalho para ' || dur || ' horas'); end if;
  end loop;
  if jsonb_array_length(probs) > 0 then
    perform privado.erro('DATA_INVALIDA', (select string_agg('Diária ' || (pb ->> 'sequencia') || ' (' || (pb ->> 'data') || '): ' || (pb ->> 'motivo'), '; ') from jsonb_array_elements(probs) pb), probs);
  end if;
  for o in select * from jsonb_array_elements(datas) loop
    taxa := case when privado.eh_sabado_ou_feriado((o ->> 'data')::date, cfg) then (P ->> 'taxaSabadoFeriadoCentavos')::bigint else 0 end;
    h := coalesce(nullif(sol #>> array['agenda', 'horarios', o ->> 'data'], ''), sol #>> '{agenda,horario}');
    itens := itens || (o || jsonb_build_object('horaInicio', h, 'duracaoMinutos', dur * 60, 'taxaDiaCentavos', taxa, 'valorDiaCentavos', base + taxa));
    total := total + base + taxa;
  end loop;
  for m in select left(x ->> 'data', 7) mes, count(*)::int n from jsonb_array_elements(itens) x group by 1 order by 1 loop
    select f into faixa from jsonb_array_elements(P -> 'descontoMensal') f where m.n >= (f ->> 'minimoDiarias')::int order by (f ->> 'minimoDiarias')::int desc limit 1;
    if faixa is not null then
      descontos := descontos || jsonb_build_object('mes', m.mes, 'diarias', m.n, 'centavos', (faixa ->> 'centavos')::bigint);
      desconto := desconto + (faixa ->> 'centavos')::bigint;
    end if;
    faixa := null;
  end loop;
  modo_pg := case when coalesce((cfg #>> '{pagamento,pacoteDeUmaVez}')::boolean, false) then 'pacote' else 'por_diaria' end;
  passadoria := coalesce((tipo ->> 'exclusivo')::boolean, false);
  est := case when passadoria then null else privado.estimar_duracao(sol, cfg0) end;
  pacote := jsonb_build_object('versao', 2, 'tipoCliente', sol ->> 'tipoCliente', 'tipoServico', sol ->> 'tipoServico', 'duracaoHoras', dur, 'horasExtras', 0)
    || case when passadoria then (case when privado.tem_valor(sol -> 'pecas') then jsonb_build_object('pecas', (sol ->> 'pecas')::int) else '{}' end)
            else (case when privado.tem_valor(sol -> 'metragem') then jsonb_build_object('metragem', (sol ->> 'metragem')::int) else '{}' end)
              || (case when privado.total_comodos(sol -> 'comodos', cfg0) > 0 then jsonb_build_object('comodos', (
                    select jsonb_object_agg(k, (sol -> 'comodos' ->> k)::int) from jsonb_array_elements_text(P #> '{comodos,tipos}') k
                     where privado.eh_inteiro(sol -> 'comodos' -> k) and (sol -> 'comodos' ->> k)::int > 0)) else '{}' end) end
    || jsonb_build_object('passadoriaCombinada', false, 'semLocalAlmoco', coalesce((sol ->> 'semLocalAlmoco')::boolean, false),
         'modoAgenda', sol #>> '{agenda,modo}', 'frequencia', case when sol #>> '{agenda,modo}' = 'recorrente' then sol #>> '{agenda,frequencia}' else 'avulso' end,
         'quantidadeDiarias', jsonb_array_length(itens), 'itensDia', itens_dia, 'valorDiaBaseCentavos', base, 'taxaDeslocamentoCentavos', taxa_desl,
         'recomendacaoHoras', case when passadoria then (case when privado.tem_valor(sol -> 'pecas') then to_jsonb(coalesce(privado.recomendar(P -> 'recomendacaoPassadoria', (sol ->> 'pecas')::int), 8)) else 'null'::jsonb end)
                                   else est -> 'horas' end,
         'modoPagamento', modo_pg, 'totalCentavos', total - desconto, 'descontoMensalCentavos', desconto);
  return jsonb_build_object('itens', itens, 'descontos', descontos, 'cobrancas', privado.calcular_cobrancas(itens, modo_pg, cfg), 'pacote', pacote);
end $$;

/** Paridade (testes, papel de serviço): cotação e estimativa com "hoje" e endereço dados. */
create or replace function public.paridade_agenda(p_sol jsonb, p_hoje date, p_endereco jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$ select privado.cotar_solicitacao(p_sol, p_hoje, p_endereco, privado.cfg()) $$;
create or replace function public.paridade_estimativa(p_entrada jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$ select privado.estimar_duracao(p_entrada, privado.cfg()) $$;
revoke execute on function public.paridade_agenda(jsonb, date, jsonb) from public, anon, authenticated;
revoke execute on function public.paridade_estimativa(jsonb) from public, anon, authenticated;
grant execute on function public.paridade_agenda(jsonb, date, jsonb) to service_role;
grant execute on function public.paridade_estimativa(jsonb) to service_role;

-- ---------------------------------------------------------------- serialização
create or replace function privado.j_atendimento(a public.atendimentos) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object('id', a.id, 'pedidoId', a.pedido_id, 'sequencia', a.sequencia, 'data', to_char(a.data, 'YYYY-MM-DD'), 'turno', a.turno,
    'horaInicio', to_char(a.hora_inicio, 'HH24:MI'), 'duracaoMinutos', a.duracao_minutos,
    'diaristaId', a.diarista_id, 'status', a.status, 'historico', a.historico, 'valorDiaCentavos', a.valor_dia_centavos, 'taxaDiaCentavos', a.taxa_dia_centavos,
    'deslocada', a.deslocada, 'dataOriginal', case when a.data_original is not null then to_char(a.data_original, 'YYYY-MM-DD') end, 'versao', a.versao,
    'criadoEm', to_char(a.criado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
$$;

create or replace function privado.j_pedido(p public.pedidos) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object('id', p.id, 'clienteId', p.cliente_id, 'pacote', p.pacote, 'status', p.status, 'historico', p.historico,
    'cancelamento', p.cancelamento, 'recusa', p.recusa, 'preferenciaProfissional', p.preferencia_profissional, 'observacaoDisponibilidade', p.observacao_disponibilidade,
    'endereco', p.endereco, 'dadosInformados', p.dados_informados, 'aceiteCondicoes', p.aceite_condicoes,
    'atendimentoIds', (select coalesce(jsonb_agg(a.id order by a.sequencia), '[]') from public.atendimentos a where a.pedido_id = p.id),
    'criadoEm', to_char(p.criado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
$$;

-- ---------------------------------------------------------------- solicitação v2
/** Endereço do atendimento normalizado (mesmas regras do cadastro). Erros com a chave "endereco.<campo>". */
create or replace function privado.normalizar_endereco(e0 jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare e jsonb := coalesce(e0, '{}'); limpa text := '\s+'; c jsonb; erros jsonb;
begin
  c := jsonb_build_object('cep', privado.so_digitos(e ->> 'cep'),
    'logradouro', regexp_replace(trim(coalesce(e ->> 'logradouro', '')), limpa, ' ', 'g'), 'numero', regexp_replace(trim(coalesce(e ->> 'numero', '')), limpa, ' ', 'g'),
    'complemento', regexp_replace(trim(coalesce(e ->> 'complemento', '')), limpa, ' ', 'g'), 'bairro', regexp_replace(trim(coalesce(e ->> 'bairro', '')), limpa, ' ', 'g'),
    'cidade', regexp_replace(trim(coalesce(e ->> 'cidade', '')), limpa, ' ', 'g'), 'uf', upper(coalesce(e ->> 'uf', '')));
  select coalesce(jsonb_object_agg('endereco.' || k, v), '{}') into erros from jsonb_each(privado.v_endereco(c)) as x(k, v);
  if erros <> '{}' then perform privado.erro('DADOS_INVALIDOS', (select v #>> '{}' from jsonb_each(erros) as y(k, v) limit 1), erros); end if;
  return c;
end $$;

/**
 * Grava a SOLICITAÇÃO v2: pedido (com endereço do atendimento, aceite das condições e, se vinculada a cadastro existente,
 * os dados informados) + diárias com hora e duração, sem cobrança. Preço sempre recalculado aqui; se diferir do que o
 * cliente viu na revisão (tabela nova), recusa pra ele revisar de novo.
 */
create or replace function privado.gravar_solicitacao_v2(c public.clientes, p_dados jsonb, p_informados jsonb, p_ficticio boolean) returns jsonb
language plpgsql set search_path = '' as $$
declare cfg jsonb := privado.cfg(); ende jsonb; g jsonb; pacote jsonb; p public.pedidos; it jsonb; esperado jsonb := p_dados -> 'valorEsperadoCentavos';
begin
  if (p_dados ->> 'aceiteCondicoes') is distinct from privado.versao_condicoes() then
    perform privado.erro('CONDICAO_NAO_ATENDIDA', case when coalesce(p_dados ->> 'aceiteCondicoes', '') = '' then 'Aceite as condições do atendimento para enviar.'
      else 'As condições do atendimento mudaram. Leia a versão nova e aceite de novo.' end, '{"aceiteCondicoes": "Aceite as condições do atendimento"}');
  end if;
  ende := privado.normalizar_endereco(p_dados -> 'endereco');
  g := privado.cotar_solicitacao(p_dados -> 'solicitacao', privado.hoje_sp(), ende, cfg);
  pacote := g -> 'pacote';
  -- o valor que a pessoa viu na revisão é obrigatório: sem ele não se envia (revisão do GPT)
  if not privado.tem_valor(esperado) or jsonb_typeof(esperado) <> 'number' then
    perform privado.erro('DADOS_INVALIDOS', 'Confira o valor na revisão antes de enviar.', '{"valor": "Confira o valor na revisão"}');
  end if;
  if (esperado #>> '{}')::numeric is distinct from (pacote ->> 'totalCentavos')::numeric then
    perform privado.erro('CONDICAO_NAO_ATENDIDA', 'O valor foi atualizado. Confira a revisão antes de enviar.', jsonb_build_object('valor', (pacote ->> 'totalCentavos')::bigint, 'precoMudou', true));
  end if;
  insert into public.pedidos (cliente_id, pacote, status, historico, total_centavos, entrada_centavos, restante_centavos, ficticio, endereco, dados_informados, aceite_condicoes)
  values (c.id, pacote, 'solicitado', jsonb_build_array(jsonb_build_object('de', 'rascunho', 'para', 'solicitado', 'evento', 'solicitar', 'em', privado.agora_iso(), 'ator', 'cliente')),
          (pacote ->> 'totalCentavos')::bigint, null, null, p_ficticio, ende, p_informados, jsonb_build_object('versao', p_dados ->> 'aceiteCondicoes', 'em', privado.agora_iso()))
  returning * into p;
  for it in select * from jsonb_array_elements(g -> 'itens') loop
    insert into public.atendimentos (pedido_id, sequencia, data, turno, hora_inicio, duracao_minutos, status, valor_dia_centavos, taxa_dia_centavos, deslocada, data_original)
    values (p.id, (it ->> 'sequencia')::int, (it ->> 'data')::date, null, (it ->> 'horaInicio')::time, (it ->> 'duracaoMinutos')::int, 'agendado',
            (it ->> 'valorDiaCentavos')::bigint, (it ->> 'taxaDiaCentavos')::bigint, (it ->> 'deslocada')::boolean, case when (it ->> 'deslocada')::boolean then (it ->> 'original')::date end);
  end loop;
  perform privado.evento('pedido_criado', jsonb_build_object('pedidoId', p.id, 'clienteId', c.id));
  return privado.pedido_completo(p.id);
end $$;

/** Cotação da revisão (pública, não grava): {pacote, itens, descontos}. p_dados: {solicitacao, endereco}. */
create or replace function public.cotar_solicitacao(p_dados jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare g jsonb;
begin
  g := privado.cotar_solicitacao(p_dados -> 'solicitacao', privado.hoje_sp(), case when jsonb_typeof(p_dados -> 'endereco') = 'object' then p_dados -> 'endereco' end, privado.cfg());
  return jsonb_build_object('pacote', g -> 'pacote', 'itens', g -> 'itens', 'descontos', g -> 'descontos');
end $$;

/** Solicitação da cliente LOGADA: vinculada ao cadastro dela, que não muda (edição só em Minha conta). */
create or replace function public.solicitar_atendimento(p_dados jsonb, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; cli public.clientes; conteudo jsonb;
begin
  if s ->> 'ator' <> 'cliente' or s ->> 'id' is null then perform privado.erro('ATOR_SEM_PERMISSAO', 'Entre na sua conta pra solicitar'); end if;
  conteudo := jsonb_build_object('solicitacao', p_dados -> 'solicitacao', 'endereco', p_dados -> 'endereco', 'aceite', p_dados -> 'aceiteCondicoes', 'valor', p_dados -> 'valorEsperadoCentavos');
  r := privado.idem_ler('solicitarAtendimento', s, p_chave, conteudo);
  if r is not null then return r; end if;
  perform set_config('app.ator', 'cliente', true);
  select * into cli from public.clientes where id = (s ->> 'id')::uuid for update;
  if cli.tipo is distinct from p_dados #>> '{solicitacao,tipoCliente}' then
    perform privado.erro('DADOS_INVALIDOS', 'Sua conta é de ' || case when cli.tipo = 'empresa' then 'empresa' else 'pessoa física' end || '. Escolha o tipo de local da sua conta ou fale com a Prime.');
  end if;
  r := privado.gravar_solicitacao_v2(cli, p_dados, null, cli.ficticio);
  perform privado.idem_gravar('solicitarAtendimento', s, p_chave, conteudo, r);
  return r;
end $$;

/**
 * Solicitação SEM login (só a function "conta", papel de serviço; spec 1.4). CPF/CNPJ já cadastrado: vinculada ao cadastro
 * existente, sem sobrescrever, e o digitado fica em dados_informados. Cadastro novo: cliente sem acesso ainda (a function cria
 * o acesso pela regra padrão e chama conta_vincular_acesso); e-mail já usado por outra conta: fica sem acesso, com pendência.
 * Devolve {pedidoId, clienteId, criarAcesso}; a function responde ao navegador sempre igual ({enviado: true}).
 */
create or replace function public.conta_solicitar(p_dados jsonb, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := '{"ator": "publico"}'; r jsonb; c jsonb; conteudo jsonb; tipo_doc text; doc text; nasc date; cli public.clientes; email_em_uso boolean;
        ficticio boolean; res jsonb; criar boolean := false;
begin
  c := privado.normalizar_cliente((p_dados -> 'cliente') || jsonb_build_object('endereco', p_dados -> 'endereco'));
  if c ->> 'tipo' = 'residencial' then
    if coalesce(c ->> 'cpf', '') = '' then perform privado.erro('DADOS_INVALIDOS', 'Informe o CPF', '{"cpf": "Informe o CPF"}'); end if;
    begin nasc := (p_dados #>> '{cliente,dataNascimento}')::date; exception when others then nasc := null; end;
    if nasc is null or nasc < '1900-01-01' or nasc > privado.hoje_sp() or coalesce(p_dados #>> '{cliente,dataNascimento}', '') !~ '^\d{4}-\d{2}-\d{2}$' then
      perform privado.erro('DADOS_INVALIDOS', 'Informe a data de nascimento', '{"dataNascimento": "Informe a data de nascimento"}'); end if;
    c := c || jsonb_build_object('dataNascimento', to_char(nasc, 'YYYY-MM-DD'));
  end if;
  if c ->> 'tipo' is distinct from p_dados #>> '{solicitacao,tipoCliente}' then perform privado.erro('DADOS_INVALIDOS', 'Tipo de cliente diferente do serviço escolhido'); end if;
  conteudo := jsonb_build_object('cliente', c, 'solicitacao', p_dados -> 'solicitacao', 'aceite', p_dados -> 'aceiteCondicoes', 'valor', p_dados -> 'valorEsperadoCentavos');
  r := privado.idem_ler('contaSolicitar', s, p_chave, conteudo);
  if r is not null then return r; end if;
  perform set_config('app.ator', 'cliente', true);
  tipo_doc := case when c ? 'cnpj' then 'cnpj' else 'cpf' end;
  doc := coalesce(c ->> 'cnpj', c ->> 'cpf');
  -- serializa solicitações simultâneas do mesmo documento (dois cadastros "novos" iguais)
  perform pg_advisory_xact_lock(hashtextextended('cliente-doc:' || tipo_doc || ':' || doc, 0));
  select * into cli from public.clientes where tipo_documento = tipo_doc and documento = doc and anonimizado_em is null for update;
  if found then
    res := privado.gravar_solicitacao_v2(cli, p_dados, c, cli.ficticio);
  else
    email_em_uso := exists (select 1 from auth.users u where lower(u.email) = c ->> 'email') or exists (select 1 from public.clientes x where x.email = c ->> 'email');
    ficticio := (c ->> 'email') ~ '^teste-[a-z0-9-]+@example\.com$';
    insert into public.clientes (usuario_id, tipo, nome, telefone, email, tipo_documento, documento, razao_social, responsavel, endereco, data_nascimento, origem, ficticio, pendencias)
    values (null, c ->> 'tipo', c ->> 'nome', c ->> 'telefone', c ->> 'email', tipo_doc, doc, c ->> 'razaoSocial', c ->> 'responsavel', c -> 'endereco',
            (c ->> 'dataNascimento')::date, 'site', ficticio, case when email_em_uso then array['email_em_uso'] else '{}'::text[] end)
    returning * into cli;
    criar := not email_em_uso;
    res := privado.gravar_solicitacao_v2(cli, p_dados, null, ficticio);
  end if;
  r := jsonb_build_object('pedidoId', res #>> '{pedido,id}', 'clienteId', cli.id, 'criarAcesso', criar);
  perform privado.idem_gravar('contaSolicitar', s, p_chave, conteudo, r);
  return r;
end $$;

/** Liga o acesso recém-criado (Auth) ao cliente novo da solicitação; registra o aceite dos termos e as novidades autorizadas. */
create or replace function public.conta_vincular_acesso(p_cliente uuid, p_user uuid, p_versao text, p_marketing jsonb default '[]') returns void
language plpgsql security definer set search_path = '' as $$
declare k text;
begin
  if p_versao is distinct from privado.versao_legal() then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Os termos mudaram. Recarregue a página e leia a versão nova.'); end if;
  update public.clientes set usuario_id = p_user where id = p_cliente and usuario_id is null;
  if not found then return; end if;
  insert into public.aceites_termos (user_id, titular_tipo, titular_id, versao, origem)
  values (p_user, 'cliente', p_cliente, p_versao, 'cadastro_cliente') on conflict (titular_tipo, titular_id, versao) do nothing;
  for k in select x from jsonb_array_elements_text(coalesce(p_marketing, '[]')) x where x in ('marketing_whatsapp', 'marketing_email') loop
    insert into public.consentimentos (user_id, titular_tipo, titular_id, tipo, concedido, canal, origem) values (p_user, 'cliente', p_cliente, k, true, 'site', 'cadastro_cliente');
  end loop;
end $$;

/**
 * Repetição depois de uma falha entre o Auth e o vínculo: o usuário foi criado pelo site (origem "site", sem cadastro de
 * cliente ou diarista ligado, sem papel da equipe, criado há menos de 1 dia e depois deste cadastro) e ficou órfão. Liga ao cliente novo e devolve
 * o id; se o e-mail é de outra conta de verdade, devolve null (a function marca a pendência).
 */
create or replace function public.conta_vincular_orfao(p_cliente uuid, p_email text, p_versao text, p_marketing jsonb default '[]') returns uuid
language plpgsql security definer set search_path = '' as $$
declare u uuid;
begin
  select au.id into u from auth.users au
   where lower(au.email) = lower(p_email) and au.raw_user_meta_data ->> 'origem' = 'site' and au.created_at > now() - interval '1 day'
     -- nasceu DEPOIS deste cadastro (a tentativa dele): ninguém liga o próprio cadastro a uma conta alheia recém-criada
     and au.created_at >= (select c.criado_em from public.clientes c where c.id = p_cliente)
     and not exists (select 1 from public.clientes c where c.usuario_id = au.id)
     and not exists (select 1 from public.diaristas d where d.usuario_id = au.id)
     and not exists (select 1 from public.perfis pf where pf.user_id = au.id and pf.papel in ('prime_admin', 'prime_atendimento', 'diarista'))
   limit 1;
  if u is null then return null; end if;
  perform public.conta_vincular_acesso(p_cliente, u, p_versao, p_marketing);
  return case when exists (select 1 from public.clientes where id = p_cliente and usuario_id = u) then u end;
end $$;

/** Acesso não pôde ser criado (e-mail já no Auth): o cliente fica sem acesso, com a pendência pra Prime resolver no painel. */
create or replace function public.conta_marcar_pendencia(p_cliente uuid, p_pendencia text) returns void
language sql security definer set search_path = '' as $$
  update public.clientes set pendencias = array(select distinct unnest(pendencias || p_pendencia)) where id = p_cliente and usuario_id is null
$$;

-- ---------------------------------------------------------------- horário real: sobreposição, reagendamento, confirmação
create or replace function privado.sobrepoe(a public.atendimentos, x public.atendimentos) returns boolean
language sql immutable set search_path = '' as $$
  select a.data = x.data and a.hora_inicio < x.hora_inicio + make_interval(mins => x.duracao_minutos)
     and x.hora_inicio < a.hora_inicio + make_interval(mins => a.duracao_minutos)
$$;

create or replace function public.atribuir_diarista(p_id uuid, p_dados jsonb, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; a public.atendimentos; d public.diaristas; ocupada public.atendimentos; conteudo jsonb := jsonb_build_object('id', p_id, 'diaristaId', p_dados -> 'diaristaId'); did uuid;
begin
  perform privado.exigir_prime(s);
  r := privado.idem_ler('atribuirDiarista', s, p_chave, conteudo);
  if r is not null then return r; end if;
  perform set_config('app.ator', 'prime', true);
  begin did := (p_dados ->> 'diaristaId')::uuid; exception when others then perform privado.erro('NAO_ENCONTRADO', 'Diarista não encontrado'); end;
  select * into a from public.atendimentos where id = p_id for update;
  if not found then perform privado.erro('NAO_ENCONTRADO', 'Atendimento não encontrado'); end if;
  if a.status not in ('agendado', 'confirmado') then perform privado.erro('TRANSICAO_PROIBIDA', 'Só dá pra atribuir antes da diarista sair'); end if;
  select * into d from public.diaristas where id = did for update; -- serializa atribuições da mesma diarista (corrida)
  if not found then perform privado.erro('NAO_ENCONTRADO', 'Diarista não encontrado'); end if;
  if d.status <> 'aprovada' then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Diarista não está aprovada'); end if;
  if a.diarista_id = did then r := jsonb_build_object('atendimento', privado.j_atendimento(a)); perform privado.idem_gravar('atribuirDiarista', s, p_chave, conteudo, r); return r; end if;
  -- v2: horário real (hora de início + duração); diária antiga já tem hora e duração pelo backfill
  select * into ocupada from public.atendimentos x where x.diarista_id = did and x.id <> a.id and x.status <> 'cancelado' and privado.sobrepoe(a, x) limit 1;
  if found then perform privado.erro('CONDICAO_NAO_ATENDIDA', split_part(d.nome, ' ', 1) || ' já tem diária em ' || to_char(a.data, 'YYYY-MM-DD') || ' nesse horário'); end if;
  update public.atendimentos set diarista_id = did, versao = versao + 1 where id = a.id returning * into a;
  perform privado.evento('atendimento_atribuido', jsonb_build_object('pedidoId', a.pedido_id, 'atendimentoId', a.id, 'diaristaId', did), jsonb_build_object('anterior', null, 'versao', a.versao));
  r := jsonb_build_object('atendimento', privado.j_atendimento(a));
  perform privado.idem_gravar('atribuirDiarista', s, p_chave, conteudo, r);
  return r;
end $$;

-- ---------------------------------------------------------------- reagendamento, confirmação e listagens pelo horário real
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
    if c = 'dataNova' and (coalesce(p_dados ->> 'data', '') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(p_dados ->> 'horaInicio', p_dados ->> 'turno', '') = '') then
      perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Reagendamento exige nova data e horário'); end if;
  end loop;
  para := coalesce(t ->> 'para', a.status);
  novo := a;
  novo.status := para; novo.versao := a.versao + 1;
  novo.historico := a.historico || jsonb_build_object('de', a.status, 'para', para, 'evento', p_evento, 'em', privado.agora_iso(), 'ator', s ->> 'ator');
  if p_evento = 'reagendar' then
    novo.data := (p_dados ->> 'data')::date; novo.deslocada := false;
    -- v2: hora exata (a duração é a da carga e não muda); turno só no caminho antigo (o gatilho acerta a hora pelo turno)
    if coalesce(p_dados ->> 'horaInicio', '') <> '' then novo.hora_inicio := (p_dados ->> 'horaInicio')::time; novo.turno := null; else novo.turno := p_dados ->> 'turno'; end if;
  end if;
  return novo;
end $$;

create or replace function privado.aplicar_transicao(p_id uuid, p_evento text, s jsonb, p_dados jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare a public.atendimentos; alvo public.atendimentos; novo public.atendimentos; p public.pedidos; probs jsonb; cfg jsonb; tipo text; d public.diaristas; ocupada public.atendimentos; nova date;
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
      if not (p_dados ->> 'horaInicio') = any(privado.horarios_inicio(a.duracao_minutos / 60, cfg)) then
        perform privado.erro('DATA_INVALIDA', 'Horário ' || (p_dados ->> 'horaInicio') || ' fora do horário de trabalho para ' || (a.duracao_minutos / 60) || ' horas'); end if;
    end if;
    probs := privado.validar_ocorrencias(jsonb_build_array(jsonb_build_object('sequencia', a.sequencia, 'data', p_dados ->> 'data')), privado.hoje_sp(), true, cfg);
    if jsonb_array_length(probs) > 0 then perform privado.erro('DATA_INVALIDA', (select string_agg(x ->> 'motivo', '; ') from jsonb_array_elements(probs) x), probs); end if;
    nova := (p_dados ->> 'data')::date;
    if exists (select 1 from public.atendimentos i where i.pedido_id = a.pedido_id and i.id <> a.id and i.status <> 'cancelado' and i.data = nova) then
      perform privado.erro('DATA_INVALIDA', 'Já existe diária deste pedido nessa data'); end if;
    if a.diarista_id is not null then
      select * into d from public.diaristas where id = a.diarista_id for update; -- serializa com atribuir/remarcar da mesma diarista (revisão do GPT)
      -- horário real da diária na data nova (v2: hora informada; caminho antigo: hora do turno)
      alvo := a; alvo.data := nova;
      alvo.hora_inicio := coalesce(nullif(p_dados ->> 'horaInicio', '')::time, case p_dados ->> 'turno' when 'tarde' then time '13:00' when 'manha' then time '08:00' when 'integral' then time '08:00' end, a.hora_inicio);
      select * into ocupada from public.atendimentos x where x.diarista_id = a.diarista_id and x.id <> a.id and x.status <> 'cancelado' and privado.sobrepoe(alvo, x) limit 1;
      if found then perform privado.erro('CONDICAO_NAO_ATENDIDA', split_part(coalesce(d.nome, 'A profissional'), ' ', 1) || ' já tem diária em ' || to_char(nova, 'YYYY-MM-DD') || ' nesse horário'); end if;
    end if;
  end if;
  novo := privado.transicionar(a, p_evento, s, p_dados);
  if p_evento = 'reagendar' then
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

create or replace function public.confirmar_disponibilidade(p_id uuid, p_dados jsonb, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; p public.pedidos; obs text; cobr jsonb; c jsonb; g public.pagamentos; ids jsonb := '[]'; agora text := privado.agora_iso();
        conteudo jsonb; aj record; at public.atendimentos; ajustes jsonb;
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
  -- v2: a Prime ajusta a hora de início de cada diária antes de confirmar (dentro do horário de trabalho)
  for aj in select key, value from jsonb_each(ajustes) loop
    select * into at from public.atendimentos where id = (case when aj.key ~ '^[0-9a-f-]{36}$' then aj.key::uuid end) and pedido_id = p.id for update;
    if not found then perform privado.erro('DADOS_INVALIDOS', 'Diária de outro pedido'); end if;
    if jsonb_typeof(aj.value) <> 'string' or not (aj.value #>> '{}') = any(privado.horarios_inicio(at.duracao_minutos / 60, privado.cfg())) then
      perform privado.erro('DATA_INVALIDA', 'Horário ' || (aj.value #>> '{}') || ' fora do horário de trabalho para ' || (at.duracao_minutos / 60) || ' horas'); end if;
    if at.hora_inicio <> (aj.value #>> '{}')::time then
      -- profissional já atribuída: o horário novo não pode cruzar outra diária dela (revisão do GPT)
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

create or replace function public.listar_atendimentos(p_filtro jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator();
begin
  perform privado.exigir_prime(s);
  return jsonb_build_object('itens', (select coalesce(jsonb_agg(jsonb_build_object(
      'atendimento', privado.j_atendimento(a),
      'pedido', jsonb_strip_nulls(jsonb_build_object('id', p.id, 'status', p.status, 'pacote', p.pacote, 'preferenciaProfissional', p.preferencia_profissional, 'endereco', p.endereco)),
      'cliente', jsonb_build_object('id', c.id, 'nome', c.nome, 'telefone', c.telefone, 'endereco', coalesce(p.endereco, c.endereco)),
      'diarista', case when d.id is not null then jsonb_build_object('id', d.id, 'nome', d.nome, 'status', d.status) end) order by a.data, a.hora_inicio, a.sequencia), '[]')
    from public.atendimentos a join public.pedidos p on p.id = a.pedido_id join public.clientes c on c.id = p.cliente_id left join public.diaristas d on d.id = a.diarista_id
    where (p_filtro ->> 'de' is null or a.data >= (p_filtro ->> 'de')::date) and (p_filtro ->> 'ate' is null or a.data <= (p_filtro ->> 'ate')::date)
      and (p_filtro ->> 'status' is null or a.status = p_filtro ->> 'status')));
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
    'cliente', jsonb_build_object('id', c.id, 'nome', c.nome, 'endereco', jsonb_build_object('bairro', coalesce(p.endereco, c.endereco) ->> 'bairro', 'cidade', coalesce(p.endereco, c.endereco) ->> 'cidade')),
    'diarista', case when d.id is not null then jsonb_build_object('id', d.id, 'nome', d.nome, 'status', d.status) end,
    -- diarista não vê cobrança
    'pagamento', case when g.id is not null and s ->> 'ator' <> 'diarista' then privado.j_pagamento(g) end, 'avaliacao', case when v.id is not null then privado.j_avaliacao(v) end);
end $$;

-- ---------------------------------------------------------------- privilégios
revoke execute on function public.cotar_solicitacao(jsonb) from public;
grant execute on function public.cotar_solicitacao(jsonb) to anon, authenticated, service_role;
revoke execute on function public.solicitar_atendimento(jsonb, text) from public, anon;
grant execute on function public.solicitar_atendimento(jsonb, text) to authenticated, service_role;
do $$ declare f text; begin
  foreach f in array array['conta_solicitar(jsonb, text)', 'conta_vincular_acesso(uuid, uuid, text, jsonb)', 'conta_marcar_pendencia(uuid, text)', 'conta_vincular_orfao(uuid, text, text, jsonb)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
revoke all on function privado.gravar_solicitacao_v2(public.clientes, jsonb, jsonb, boolean), privado.cotar_solicitacao(jsonb, date, jsonb, jsonb),
  privado.normalizar_endereco(jsonb), privado.atendimento_horario() from public, anon, authenticated;
