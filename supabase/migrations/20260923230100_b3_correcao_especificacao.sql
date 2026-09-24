-- B3: correção achada pelo teste de paridade (JS x SQL): `texto[] || 'literal'` era lido como array literal.
-- Todas as mensagens passam por array_append.
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
  if coalesce(esp ->> 'tipoCliente', '') not in ('residencial', 'empresa') then e := array_append(e, 'Tipo de cliente inválido'); end if;
  if P -> 'naoOferecidos' ? coalesce(esp ->> 'tipoServico', '') then e := array_append(e, (P -> 'naoOferecidos' ->> (esp ->> 'tipoServico')));
  elsif tipo is null then e := array_append(e, 'Tipo de serviço inválido'); end if;
  if dur is null then e := array_append(e, 'Escolha a duração da diária (2, 4, 6 ou 8 horas)'); end if;
  if coalesce((tipo ->> 'exclusivo')::boolean, false) then
    if privado.tem_valor(esp -> 'pecas') and (not privado.eh_inteiro(esp -> 'pecas') or (esp ->> 'pecas')::int not between 1 and 500) then e := array_append(e, 'Quantidade de peças inválida'); end if;
    if (esp -> 'passadoriaCombinada') = 'true' then e := array_append(e, 'Passadoria exclusiva não combina com adicional de passadoria'); end if;
  else
    if not privado.tem_valor(esp -> 'metragem') then e := array_append(e, 'Informe a metragem aproximada');
    elsif not privado.eh_inteiro(esp -> 'metragem') or (esp ->> 'metragem')::int < (P #>> '{metragem,minimo}')::int or (esp ->> 'metragem')::int > (P #>> '{metragem,maximo}')::int then
      e := array_append(e, ('Metragem deve ser um inteiro entre ' || (P #>> '{metragem,minimo}') || ' e ' || (P #>> '{metragem,maximo}') || ' m²'));
    elsif dur ? 'metragemMaxima' and (esp ->> 'metragem')::int > (dur ->> 'metragemMaxima')::int then
      e := array_append(e, ('A diária de ' || (esp ->> 'duracaoHoras') || ' horas é só para locais até ' || (dur ->> 'metragemMaxima') || ' m²'));
    end if;
  end if;
  if not privado.eh_inteiro(hx) or (hx #>> '{}')::int < 0 or (hx #>> '{}')::int > (P ->> 'horasExtrasMaximo')::int then e := array_append(e, ('Horas extras: de 0 a ' || (P ->> 'horasExtrasMaximo'))); end if;
  if esp ? 'passadoriaCombinada' and jsonb_typeof(esp -> 'passadoriaCombinada') not in ('boolean', 'null') then e := array_append(e, 'passadoriaCombinada inválido'); end if;
  if esp ? 'semLocalAlmoco' and jsonb_typeof(esp -> 'semLocalAlmoco') not in ('boolean', 'null') then e := array_append(e, 'semLocalAlmoco inválido'); end if;
  if coalesce(esp ->> 'frequencia', '') not in ('avulso', 'semanal', 'quinzenal', 'mensal') then e := array_append(e, 'Frequência inválida'); end if;
  if not privado.eh_inteiro(q) or (q #>> '{}')::int < (P #>> '{quantidadeDiarias,minimo}')::int or (q #>> '{}')::int > (P #>> '{quantidadeDiarias,maximo}')::int then
    e := array_append(e, ('Quantidade de diárias deve ser entre ' || (P #>> '{quantidadeDiarias,minimo}') || ' e ' || (P #>> '{quantidadeDiarias,maximo}')));
  end if;
  qi := case when privado.eh_inteiro(q) then (q #>> '{}')::int end;
  if esp ->> 'frequencia' = 'avulso' and qi is distinct from 1 then e := array_append(e, 'Avulso é sempre 1 diária'); end if;
  if esp ->> 'frequencia' <> 'avulso' and qi is not null and qi < 2 then e := array_append(e, 'Com frequência, escolha 2 ou mais diárias (ou mude pra avulso)'); end if;
  if esp ->> 'tipoCliente' = 'empresa' and esp ->> 'frequencia' = 'avulso' then e := array_append(e, 'Para empresa a frequência é obrigatória'); end if;
  return e;
end $$;

