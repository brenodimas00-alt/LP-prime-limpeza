-- B3. Domínio no banco: as MESMAS regras de src/domain (validacao.js, calendario.js, pacote.js, dinheiro.js, brcode.js),
-- portadas pra PL/pgSQL no schema privado. O banco recalcula tudo a partir de public.precos/regioes/feriados; o total
-- que vem do navegador é ignorado. Paridade conferida por scripts/testa-paridade.mjs (JS x SQL, mesmos casos).
-- Erro de negócio: raise com message = CÓDIGO estável (docs/API.md), detail = mensagem legível, hint = detalhes em JSON.

create extension if not exists unaccent with schema extensions;

create or replace function privado.erro(p_codigo text, p_mensagem text, p_detalhes jsonb default null) returns void
language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = 'P0001', message = p_codigo, detail = coalesce(p_mensagem, p_codigo), hint = coalesce(p_detalhes::text, '');
end $$;

-- ---------- configuração vigente ----------
create or replace function privado.cfg() returns jsonb
language sql stable security definer set search_path = '' as $$
  select p.tabela
         || jsonb_build_object('feriados', coalesce((select jsonb_agg(to_char(f.data, 'YYYY-MM-DD') order by f.data) from public.feriados f), '[]'::jsonb))
         || jsonb_build_object('datasBloqueadas', coalesce((select jsonb_agg(to_char(f.data, 'YYYY-MM-DD') order by f.data) from public.feriados f where f.bloqueia), '[]'::jsonb))
    from public.precos p where p.vigente_desde <= now() order by p.vigente_desde desc, p.id desc limit 1
$$;

create or replace function privado.hoje_sp() returns date
language sql stable set search_path = '' as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;

create or replace function privado.sem_acento(t text) returns text
language sql stable set search_path = '' as $$ select lower(trim(extensions.unaccent(coalesce(t, '')))) $$;

-- ---------- validações (validacao.js) ----------
create or replace function privado.so_digitos(t text) returns text
language sql immutable set search_path = '' as $$ select regexp_replace(coalesce(t, ''), '\D', '', 'g') $$;

create or replace function privado.v_telefone(v text) returns text
language plpgsql immutable set search_path = '' as $$
declare d text := privado.so_digitos(v);
begin
  if d = '' then return 'Informe o telefone com DDD'; end if;
  if length(d) not in (10, 11) then return 'Telefone deve ter DDD + 8 ou 9 dígitos'; end if;
  if substr(d, 1, 2)::int not in (11,12,13,14,15,16,17,18,19,21,22,24,27,28,31,32,33,34,35,37,38,41,42,43,44,45,46,47,48,49,
      51,53,54,55,61,62,63,64,65,66,67,68,69,71,73,74,75,77,79,81,82,83,84,85,86,87,88,89,91,92,93,94,95,96,97,98,99) then
    return 'DDD inválido'; end if;
  if length(d) = 11 and substr(d, 3, 1) <> '9' then return 'Celular deve começar com 9 depois do DDD'; end if;
  if substr(d, 3) ~ '^(\d)\1+$' then return 'Telefone inválido'; end if;
  return '';
end $$;

create or replace function privado.v_cpf(v text) returns text
language plpgsql immutable set search_path = '' as $$
declare d text := privado.so_digitos(v); n int; soma int; dv int;
begin
  if d = '' then return 'Informe o CPF'; end if;
  if length(d) <> 11 or d ~ '^(\d)\1{10}$' then return 'CPF inválido'; end if;
  foreach n in array array[9, 10] loop
    soma := 0;
    for i in 1..n loop soma := soma + substr(d, i, 1)::int * (n + 2 - i); end loop;
    dv := ((soma * 10) % 11) % 10;
    if dv <> substr(d, n + 1, 1)::int then return 'CPF inválido (dígito verificador)'; end if;
  end loop;
  return '';
end $$;

create or replace function privado.normalizar_cnpj(v text) returns text
language sql immutable set search_path = '' as $$ select regexp_replace(upper(coalesce(v, '')), '[^0-9A-Z]', '', 'g') $$;

create or replace function privado.dv_cnpj(base text) returns int
language plpgsql immutable set search_path = '' as $$
declare pesos int[] := case when length(base) = 12 then array[5,4,3,2,9,8,7,6,5,4,3,2] else array[6,5,4,3,2,9,8,7,6,5,4,3,2] end;
        soma int := 0; r int;
begin
  for i in 1..length(base) loop soma := soma + (ascii(substr(base, i, 1)) - 48) * pesos[i]; end loop;
  r := soma % 11;
  return case when r < 2 then 0 else 11 - r end;
end $$;

create or replace function privado.v_cnpj(v text) returns text
language plpgsql immutable set search_path = '' as $$
declare c text := privado.normalizar_cnpj(v); d1 int; d2 int;
begin
  if c = '' then return 'Informe o CNPJ'; end if;
  if c !~ '^[0-9A-Z]{12}[0-9]{2}$' then return 'CNPJ deve ter 12 letras/números + 2 dígitos'; end if;
  if c ~ '^(.)\1{13}$' then return 'CNPJ inválido'; end if;
  d1 := privado.dv_cnpj(substr(c, 1, 12)); d2 := privado.dv_cnpj(substr(c, 1, 12) || d1::text);
  if (d1::text || d2::text) <> substr(c, 13, 2) then return 'CNPJ inválido (dígito verificador)'; end if;
  return '';
end $$;

create or replace function privado.v_email(v text) returns text
language plpgsql immutable set search_path = '' as $$
declare s text := trim(coalesce(v, ''));
begin
  if s = '' then return 'Informe o e-mail'; end if;
  if length(s) > 254 or s !~ '^[^[:space:]@<>()]+@[^[:space:]@<>()]+\.[A-Za-z]{2,}$' then return 'E-mail inválido'; end if;
  return '';
end $$;

create or replace function privado.v_nome(v text, rotulo text default 'o nome') returns text
language plpgsql immutable set search_path = '' as $$
declare s text := trim(coalesce(v, ''));
begin
  if s = '' then return 'Informe ' || rotulo; end if;
  if length(s) < 3 or length(s) > 120 then return 'Use entre 3 e 120 caracteres'; end if;
  if s ~ '[<>{}]' then return 'Use só letras, números e pontuação comum'; end if;
  return '';
end $$;

create or replace function privado.v_texto(v text, rotulo text, max int default 120) returns text
language plpgsql immutable set search_path = '' as $$
declare s text := trim(coalesce(v, ''));
begin
  if s = '' then return 'Informe ' || rotulo; end if;
  if length(s) > max then return 'Máximo de ' || max || ' caracteres'; end if;
  if s ~ '[<>{}]' then return 'Use só letras, números e pontuação comum'; end if;
  return '';
end $$;

/** Valida endereço: {campo: erro}. */
create or replace function privado.v_endereco(e jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare r jsonb := '{}'; cep text := privado.so_digitos(e ->> 'cep'); m text;
begin
  if cep = '' then r := r || '{"cep": "Informe o CEP"}';
  elsif length(cep) <> 8 or cep = '00000000' then r := r || '{"cep": "CEP deve ter 8 dígitos"}'; end if;
  m := privado.v_texto(e ->> 'logradouro', 'a rua'); if m <> '' then r := r || jsonb_build_object('logradouro', m); end if;
  m := privado.v_texto(e ->> 'numero', 'o número', 10); if m <> '' then r := r || jsonb_build_object('numero', m); end if;
  if length(coalesce(e ->> 'complemento', '')) > 60 then r := r || '{"complemento": "Máximo de 60 caracteres"}'; end if;
  m := privado.v_texto(e ->> 'bairro', 'o bairro', 80); if m <> '' then r := r || jsonb_build_object('bairro', m); end if;
  m := privado.v_texto(e ->> 'cidade', 'a cidade', 80); if m <> '' then r := r || jsonb_build_object('cidade', m); end if;
  if upper(coalesce(e ->> 'uf', '')) not in ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO') then
    r := r || '{"uf": "UF inválida"}'; end if;
  return r;
end $$;

/** Normaliza e valida o cliente (normalizarCliente + validarCliente). Levanta DADOS_INVALIDOS com {campo: erro}. */
create or replace function privado.normalizar_cliente(d jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  limpa text := '\s+';
  e jsonb := coalesce(d -> 'endereco', '{}');
  c jsonb;
  erros jsonb := '{}';
  m text;
begin
  c := jsonb_build_object(
    'tipo', d ->> 'tipo',
    'nome', regexp_replace(trim(coalesce(d ->> 'nome', '')), limpa, ' ', 'g'),
    'telefone', privado.so_digitos(d ->> 'telefone'),
    'email', lower(regexp_replace(trim(coalesce(d ->> 'email', '')), limpa, ' ', 'g')),
    'endereco', jsonb_build_object(
      'cep', privado.so_digitos(e ->> 'cep'),
      'logradouro', regexp_replace(trim(coalesce(e ->> 'logradouro', '')), limpa, ' ', 'g'),
      'numero', regexp_replace(trim(coalesce(e ->> 'numero', '')), limpa, ' ', 'g'),
      'complemento', regexp_replace(trim(coalesce(e ->> 'complemento', '')), limpa, ' ', 'g'),
      'bairro', regexp_replace(trim(coalesce(e ->> 'bairro', '')), limpa, ' ', 'g'),
      'cidade', regexp_replace(trim(coalesce(e ->> 'cidade', '')), limpa, ' ', 'g'),
      'uf', upper(coalesce(e ->> 'uf', ''))));
  if coalesce(d ->> 'tipo', '') not in ('residencial', 'empresa') then erros := erros || '{"tipo": "Escolha residencial ou empresa"}'; end if;
  m := privado.v_nome(c ->> 'nome'); if m <> '' then erros := erros || jsonb_build_object('nome', m); end if;
  m := privado.v_telefone(c ->> 'telefone'); if m <> '' then erros := erros || jsonb_build_object('telefone', m); end if;
  m := privado.v_email(c ->> 'email'); if m <> '' then erros := erros || jsonb_build_object('email', m); end if;
  if d ->> 'tipo' = 'empresa' then
    c := c || jsonb_build_object('cnpj', privado.normalizar_cnpj(d ->> 'cnpj'),
                                 'razaoSocial', regexp_replace(trim(coalesce(d ->> 'razaoSocial', '')), limpa, ' ', 'g'),
                                 'responsavel', regexp_replace(trim(coalesce(d ->> 'responsavel', '')), limpa, ' ', 'g'));
    m := privado.v_cnpj(c ->> 'cnpj'); if m <> '' then erros := erros || jsonb_build_object('cnpj', m); end if;
    m := privado.v_texto(c ->> 'razaoSocial', 'a razão social'); if m <> '' then erros := erros || jsonb_build_object('razaoSocial', m); end if;
    m := privado.v_nome(c ->> 'responsavel', 'o responsável'); if m <> '' then erros := erros || jsonb_build_object('responsavel', m); end if;
  elsif coalesce(d ->> 'cpf', '') <> '' then
    c := c || jsonb_build_object('cpf', privado.so_digitos(d ->> 'cpf'));
    m := privado.v_cpf(c ->> 'cpf'); if m <> '' then erros := erros || jsonb_build_object('cpf', m); end if;
  end if;
  select erros || coalesce(jsonb_object_agg('endereco.' || k, v), '{}') into erros from jsonb_each(privado.v_endereco(c -> 'endereco')) as x(k, v);
  if erros <> '{}' then
    perform privado.erro('DADOS_INVALIDOS', (select v #>> '{}' from jsonb_each(erros) as y(k, v) limit 1), erros);
  end if;
  return c;
end $$;

-- ---------- calendário (calendario.js) ----------
create or replace function privado.dia_semana(d date) returns int
language sql immutable set search_path = '' as $$ select extract(dow from d)::int $$;

create or replace function privado.data_bloqueada(d date, cfg jsonb) returns boolean
language sql stable set search_path = '' as $$
  select (cfg -> 'diasBloqueados') @> to_jsonb(privado.dia_semana(d)) or (cfg -> 'datasBloqueadas') @> to_jsonb(to_char(d, 'YYYY-MM-DD'))
$$;

create or replace function privado.eh_sabado_ou_feriado(d date, cfg jsonb) returns boolean
language sql stable set search_path = '' as $$
  select privado.dia_semana(d) = 6 or (cfg -> 'feriados') @> to_jsonb(to_char(d, 'YYYY-MM-DD'))
$$;

create or replace function privado.proximo_permitido(d date, cfg jsonb) returns date
language plpgsql stable set search_path = '' as $$
declare maxd int := coalesce((cfg #>> '{regrasCalendario,buscaDeslocamentoMaxDias}')::int, 7);
begin
  for i in 0..maxd loop
    if not privado.data_bloqueada(d + i, cfg) then return d + i; end if;
  end loop;
  perform privado.erro('DATA_INVALIDA', 'Sem dia disponível em até ' || maxd || ' dias após ' || to_char(d, 'YYYY-MM-DD'));
end $$;

create or replace function privado.somar_meses_clamp(d date, k int, dia_alvo int) returns date
language plpgsql immutable set search_path = '' as $$
declare inicio date := (date_trunc('month', d) + make_interval(months => k))::date;
        ultimo int := extract(day from (inicio + interval '1 month - 1 day'))::int;
begin
  return make_date(extract(year from inicio)::int, extract(month from inicio)::int, least(dia_alvo, ultimo));
end $$;

create or replace function privado.dia_util_anterior(d date, cfg jsonb) returns date
language plpgsql stable set search_path = '' as $$
declare x date := d - 1;
begin
  for i in 1..15 loop
    if privado.dia_semana(x) not in (0, 6) and not ((cfg -> 'feriados') @> to_jsonb(to_char(x, 'YYYY-MM-DD'))) then return x; end if;
    x := x - 1;
  end loop;
  perform privado.erro('DATA_INVALIDA', 'Sem dia útil antes de ' || to_char(d, 'YYYY-MM-DD'));
end $$;

/** Ocorrências: [{sequencia, data, original, deslocada}]. A primeira é a escolhida; as outras vão pro próximo permitido. */
create or replace function privado.gerar_ocorrencias(freq text, qtd int, primeira date, cfg jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare lista jsonb := '[]'; original date; dt date; anterior date; dia int := extract(day from primeira)::int;
begin
  if qtd is null or qtd < 1 then perform privado.erro('DADOS_INVALIDOS', 'Quantidade de diárias inválida'); end if;
  if freq = 'avulso' and qtd <> 1 then perform privado.erro('DADOS_INVALIDOS', 'Avulso é sempre 1 diária'); end if;
  if freq not in ('avulso', 'semanal', 'quinzenal', 'mensal') then perform privado.erro('DADOS_INVALIDOS', 'Frequência inválida: ' || coalesce(freq, '')); end if;
  for k in 0..qtd - 1 loop
    original := case when k = 0 then primeira when freq = 'semanal' then primeira + 7 * k when freq = 'quinzenal' then primeira + 14 * k
                     else privado.somar_meses_clamp(primeira, k, dia) end;
    dt := case when k = 0 then original else privado.proximo_permitido(original, cfg) end;
    if anterior is not null and dt <= anterior then
      perform privado.erro('DATA_INVALIDA', 'Ocorrência ' || (k + 1) || ' colide com a anterior (' || to_char(dt, 'YYYY-MM-DD') || ')');
    end if;
    lista := lista || jsonb_build_object('sequencia', k + 1, 'data', to_char(dt, 'YYYY-MM-DD'), 'original', to_char(original, 'YYYY-MM-DD'), 'deslocada', dt <> original);
    anterior := dt;
  end loop;
  return lista;
end $$;

create or replace function privado.nome_dia(d date) returns text
language sql immutable set search_path = '' as $$
  select (array['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'])[extract(dow from d)::int + 1]
$$;

/** Problemas das ocorrências: [{sequencia, data, motivo}] (vazio = ok). */
create or replace function privado.validar_ocorrencias(ocs jsonb, hoje date, regiao_atendida boolean, cfg jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare o jsonb; d date; dif int; r jsonb := '[]';
        antecedencia int := coalesce((cfg #>> '{regrasCalendario,antecedenciaMinimaDias}')::int, 1);
        horizonte int := coalesce((cfg #>> '{regrasCalendario,horizonteMaximoDias}')::int, 120);
begin
  for o in select * from jsonb_array_elements(ocs) loop
    d := (o ->> 'data')::date; dif := d - hoje;
    if dif < 0 then r := r || jsonb_build_object('sequencia', o -> 'sequencia', 'data', o -> 'data', 'motivo', 'data no passado');
    elsif dif < antecedencia then r := r || jsonb_build_object('sequencia', o -> 'sequencia', 'data', o -> 'data', 'motivo', 'antecedência mínima de ' || antecedencia || ' dia(s)'); end if;
    if (o ->> 'sequencia')::int = 1 and dif > horizonte then r := r || jsonb_build_object('sequencia', 1, 'data', o -> 'data', 'motivo', 'no máximo ' || horizonte || ' dias à frente'); end if;
    if privado.data_bloqueada(d, cfg) then r := r || jsonb_build_object('sequencia', o -> 'sequencia', 'data', o -> 'data', 'motivo', 'não atendemos ' || privado.nome_dia(d)); end if;
    if not regiao_atendida then r := r || jsonb_build_object('sequencia', o -> 'sequencia', 'data', o -> 'data', 'motivo', 'região não atendida'); end if;
  end loop;
  return r;
end $$;

create or replace function privado.regiao(endereco jsonb) returns public.regioes
language sql stable security definer set search_path = '' as $$
  select r.* from public.regioes r
   where r.ativa and privado.sem_acento(r.cidade) = privado.sem_acento(endereco ->> 'cidade') and privado.sem_acento(r.uf) = privado.sem_acento(endereco ->> 'uf')
   limit 1
$$;

-- ---------- dinheiro (dinheiro.js) ----------
create or replace function privado.parcelar(restante bigint, n int, modo text) returns bigint[]
language plpgsql immutable set search_path = '' as $$
declare base bigint; r bigint[];
begin
  if modo = 'no_primeiro' then return array[restante] || array_fill(0::bigint, array[n - 1]); end if;
  base := restante / n;
  r := array_fill(base, array[n]);
  r[n] := r[n] + (restante - base * n);
  return r;
end $$;

-- ---------- pacote (pacote.js) ----------
create or replace function privado.eh_inteiro(v jsonb) returns boolean
language sql immutable set search_path = '' as $$ select jsonb_typeof(v) = 'number' and (v #>> '{}') ~ '^-?\d+$' $$;

create or replace function privado.tem_valor(v jsonb) returns boolean
language sql immutable set search_path = '' as $$ select v is not null and jsonb_typeof(v) <> 'null' and v <> '""'::jsonb $$;

create or replace function privado.validar_especificacao(esp jsonb, cfg jsonb) returns text[]
language plpgsql stable set search_path = '' as $$
declare
  P jsonb := cfg -> 'PRECOS';
  e text[] := '{}';
  tipo jsonb := P -> 'tiposServico' -> (esp ->> 'tipoServico');
  dur jsonb := P -> 'duracoes' -> (esp ->> 'duracaoHoras');
  hx jsonb := case when coalesce(jsonb_typeof(esp -> 'horasExtras'), 'null') = 'null' then '0'::jsonb else esp -> 'horasExtras' end;
  q jsonb := esp -> 'quantidadeDiarias';
  qi int;
begin
  if coalesce(esp ->> 'tipoCliente', '') not in ('residencial', 'empresa') then e := e || 'Tipo de cliente inválido'; end if;
  if P -> 'naoOferecidos' ? coalesce(esp ->> 'tipoServico', '') then e := e || (P -> 'naoOferecidos' ->> (esp ->> 'tipoServico'));
  elsif tipo is null then e := e || 'Tipo de serviço inválido'; end if;
  if dur is null then e := e || 'Escolha a duração da diária (2, 4, 6 ou 8 horas)'; end if;
  if coalesce((tipo ->> 'exclusivo')::boolean, false) then
    if privado.tem_valor(esp -> 'pecas') and (not privado.eh_inteiro(esp -> 'pecas') or (esp ->> 'pecas')::int not between 1 and 500) then e := e || 'Quantidade de peças inválida'; end if;
    if (esp -> 'passadoriaCombinada') = 'true' then e := e || 'Passadoria exclusiva não combina com adicional de passadoria'; end if;
  else
    if not privado.tem_valor(esp -> 'metragem') then e := e || 'Informe a metragem aproximada';
    elsif not privado.eh_inteiro(esp -> 'metragem') or (esp ->> 'metragem')::int < (P #>> '{metragem,minimo}')::int or (esp ->> 'metragem')::int > (P #>> '{metragem,maximo}')::int then
      e := e || ('Metragem deve ser um inteiro entre ' || (P #>> '{metragem,minimo}') || ' e ' || (P #>> '{metragem,maximo}') || ' m²');
    elsif dur ? 'metragemMaxima' and (esp ->> 'metragem')::int > (dur ->> 'metragemMaxima')::int then
      e := e || ('A diária de ' || (esp ->> 'duracaoHoras') || ' horas é só para locais até ' || (dur ->> 'metragemMaxima') || ' m²');
    end if;
  end if;
  if not privado.eh_inteiro(hx) or (hx #>> '{}')::int < 0 or (hx #>> '{}')::int > (P ->> 'horasExtrasMaximo')::int then e := e || ('Horas extras: de 0 a ' || (P ->> 'horasExtrasMaximo')); end if;
  if esp ? 'passadoriaCombinada' and jsonb_typeof(esp -> 'passadoriaCombinada') not in ('boolean', 'null') then e := e || 'passadoriaCombinada inválido'; end if;
  if esp ? 'semLocalAlmoco' and jsonb_typeof(esp -> 'semLocalAlmoco') not in ('boolean', 'null') then e := e || 'semLocalAlmoco inválido'; end if;
  if coalesce(esp ->> 'frequencia', '') not in ('avulso', 'semanal', 'quinzenal', 'mensal') then e := e || 'Frequência inválida'; end if;
  if not privado.eh_inteiro(q) or (q #>> '{}')::int < (P #>> '{quantidadeDiarias,minimo}')::int or (q #>> '{}')::int > (P #>> '{quantidadeDiarias,maximo}')::int then
    e := e || ('Quantidade de diárias deve ser entre ' || (P #>> '{quantidadeDiarias,minimo}') || ' e ' || (P #>> '{quantidadeDiarias,maximo}'));
  end if;
  qi := case when privado.eh_inteiro(q) then (q #>> '{}')::int end;
  if esp ->> 'frequencia' = 'avulso' and qi is distinct from 1 then e := e || 'Avulso é sempre 1 diária'; end if;
  if esp ->> 'frequencia' <> 'avulso' and qi is not null and qi < 2 then e := e || 'Com frequência, escolha 2 ou mais diárias (ou mude pra avulso)'; end if;
  if esp ->> 'tipoCliente' = 'empresa' and esp ->> 'frequencia' = 'avulso' then e := e || 'Para empresa a frequência é obrigatória'; end if;
  return e;
end $$;

create or replace function privado.recomendar(tabela jsonb, valor int) returns int
language sql immutable set search_path = '' as $$
  select (f ->> 'horas')::int from jsonb_array_elements(tabela) f where valor <= (f ->> 'ate')::int order by (f ->> 'ate')::int limit 1
$$;

/** Preço-base de UMA diária (calcularPacote). */
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
           'cobrancaRestante', cfg ->> 'cobrancaRestante', 'prazoRestante', coalesce(cfg ->> 'prazoRestante', 'no_dia'),
           'totalCentavos', 0, 'entradaCentavos', 0, 'restanteCentavos', 0, 'descontoMensalCentavos', 0);
end $$;

/** Atendimentos com valor do dia, desconto mensal e parcelas (gerarAtendimentos). Devolve {itens, descontos, pacote}. */
create or replace function privado.gerar_atendimentos(pacote jsonb, primeira date, turno text, hoje date, endereco jsonb, cfg jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  ocs jsonb; probs jsonb; reg public.regioes; atendida boolean := true; codigo text;
  itens jsonb := '[]'; o jsonb; taxa bigint; total bigint := 0; desconto bigint := 0; entrada bigint; restante bigint; parcelas bigint[];
  descontos jsonb := '[]'; faixa jsonb; n int; i int := 0; vence date;
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
  -- desconto mensal por mês de calendário
  for o in select jsonb_build_object('mes', left(x ->> 'data', 7), 'diarias', count(*)) from jsonb_array_elements(itens) x group by left(x ->> 'data', 7) order by 1 loop
    select f into faixa from jsonb_array_elements(cfg #> '{PRECOS,descontoMensal}') f where (o ->> 'diarias')::int >= (f ->> 'minimoDiarias')::int order by (f ->> 'minimoDiarias')::int desc limit 1;
    if faixa is not null then
      descontos := descontos || jsonb_build_object('mes', o -> 'mes', 'diarias', o -> 'diarias', 'centavos', (faixa ->> 'centavos')::bigint);
      desconto := desconto + (faixa ->> 'centavos')::bigint;
    end if;
    faixa := null;
  end loop;
  total := total - desconto;
  entrada := total / 2; restante := total - entrada;
  n := jsonb_array_length(itens);
  parcelas := privado.parcelar(restante, n, pacote ->> 'cobrancaRestante');
  select jsonb_agg(x || jsonb_build_object('parcelaCentavos', parcelas[ord::int],
           'venceEm', case when pacote ->> 'prazoRestante' = 'dia_util_anterior_14h' then to_char(privado.dia_util_anterior((x ->> 'data')::date, cfg), 'YYYY-MM-DD') else x ->> 'data' end)
         || case when pacote ->> 'prazoRestante' = 'dia_util_anterior_14h' then '{"venceAs": "14:00"}'::jsonb else '{}'::jsonb end order by ord)
    into itens from jsonb_array_elements(itens) with ordinality as t(x, ord);
  return jsonb_build_object('itens', itens, 'descontos', descontos,
    'pacote', pacote || jsonb_build_object('totalCentavos', total, 'entradaCentavos', entrada, 'restanteCentavos', restante, 'descontoMensalCentavos', desconto));
end $$;

-- ---------- Pix (brcode.js) ----------
create or replace function privado.crc16(t text) returns text
language plpgsql immutable set search_path = '' as $$
declare b bytea := convert_to(t, 'UTF8'); crc int := 65535;
begin
  for i in 0..length(b) - 1 loop
    crc := crc # (get_byte(b, i) << 8);
    for j in 1..8 loop
      crc := case when (crc & 32768) <> 0 then ((crc << 1) # 4129) & 65535 else (crc << 1) & 65535 end;
    end loop;
  end loop;
  return lpad(upper(to_hex(crc)), 4, '0');
end $$;

create or replace function privado.texto_pix(s text, max int) returns text
language sql stable set search_path = '' as $$
  select left(upper(trim(regexp_replace(regexp_replace(extensions.unaccent(coalesce(s, '')), '[^A-Za-z0-9 .\-]', '', 'g'), '\s+', ' ', 'g'))), max)
$$;

create or replace function privado.campo_pix(id text, v text) returns text
language plpgsql immutable set search_path = '' as $$
begin
  if length(v) > 99 then perform privado.erro('DADOS_INVALIDOS', 'Campo ' || id || ' passa de 99 caracteres'); end if;
  return id || lpad(length(v)::text, 2, '0') || v;
end $$;

/** BR Code estático; null quando a config Pix está incompleta (a tela avisa, como no mock). */
create or replace function privado.brcode(valor bigint, txid text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare pix jsonb := (select c.valor from public.configuracao c where c.chave = 'pix'); nome text; cidade text; sem_crc text;
begin
  if pix is null or valor <= 0 then return null; end if;
  if coalesce(trim(pix ->> 'chave'), '') in ('', 'PREENCHER') or coalesce(trim(pix ->> 'nomeRecebedor'), '') in ('', 'PREENCHER')
     or coalesce(trim(pix ->> 'cidadeRecebedor'), '') in ('', 'PREENCHER') then return null; end if;
  nome := privado.texto_pix(pix ->> 'nomeRecebedor', 25); cidade := privado.texto_pix(pix ->> 'cidadeRecebedor', 15);
  if nome = '' or cidade = '' then return null; end if;
  sem_crc := privado.campo_pix('00', '01')
    || privado.campo_pix('26', privado.campo_pix('00', 'br.gov.bcb.pix') || privado.campo_pix('01', trim(pix ->> 'chave')))
    || privado.campo_pix('52', '0000') || privado.campo_pix('53', '986')
    || privado.campo_pix('54', (valor / 100)::text || '.' || lpad((valor % 100)::text, 2, '0'))
    || privado.campo_pix('58', 'BR') || privado.campo_pix('59', nome) || privado.campo_pix('60', cidade)
    || privado.campo_pix('62', privado.campo_pix('05', txid)) || '6304';
  return sem_crc || privado.crc16(sem_crc);
end $$;

create or replace function privado.novo_txid() returns text
language plpgsql volatile set search_path = '' as $$
declare a text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; b bytea := extensions.gen_random_bytes(25); s text := '';
begin
  for i in 0..24 loop s := s || substr(a, (get_byte(b, i) % 32) + 1, 1); end loop;
  return s;
end $$;

/** Pra paridade (só service role): calcula o pacote como o JS, sem gravar. */
create or replace function public.paridade_pacote(p_esp jsonb, p_primeira date, p_turno text, p_hoje date, p_endereco jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare cfg jsonb := privado.cfg(); base jsonb;
begin
  base := privado.calcular_pacote(p_esp || case when p_endereco is not null then jsonb_build_object('endereco', p_endereco) else '{}' end, cfg);
  return privado.gerar_atendimentos(base, p_primeira, p_turno, p_hoje, p_endereco, cfg);
end $$;
create or replace function public.paridade_brcode(p_valor bigint, p_txid text) returns text
language sql stable security definer set search_path = '' as $$ select privado.brcode(p_valor, p_txid) $$;
create or replace function public.paridade_validacao(p_cliente jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$ select privado.normalizar_cliente(p_cliente) $$;
revoke execute on function public.paridade_pacote(jsonb, date, text, date, jsonb), public.paridade_brcode(bigint, text), public.paridade_validacao(jsonb) from public, anon, authenticated;
grant execute on function public.paridade_pacote(jsonb, date, text, date, jsonb), public.paridade_brcode(bigint, text), public.paridade_validacao(jsonb) to service_role;
