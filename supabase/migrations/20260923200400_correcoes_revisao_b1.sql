-- B1, revisão do Codex: vínculo duplo não acumula acesso; notas de avaliação completas e nota final coerente.

-- Conta vinculada a cliente E a diarista só usa o vínculo do papel atual.
create or replace function privado.meu_cliente_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select c.id from public.clientes c where c.usuario_id = auth.uid() and privado.papel() = 'cliente'
$$;

create or replace function privado.minha_diarista_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select d.id from public.diaristas d where d.usuario_id = auth.uid() and privado.papel() = 'diarista'
$$;

-- Notas: objeto com EXATAMENTE os 4 critérios, inteiros de 1 a 5 ('{}' passava porque o CHECK dava NULL).
create or replace function privado.notas_validas(n jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(n) = 'object'
     and (select array_agg(k order by k) from jsonb_object_keys(n) k) = array['comunicacao', 'cuidado', 'pontualidade', 'qualidade']
     and (select bool_and(jsonb_typeof(v) = 'number' and (v #>> '{}') ~ '^[1-5]$') from jsonb_each(n) as e(k, v))
$$;

create or replace function privado.nota_final(n jsonb) returns numeric
language sql immutable set search_path = '' as $$
  select round(((n ->> 'pontualidade')::int + (n ->> 'qualidade')::int + (n ->> 'cuidado')::int + (n ->> 'comunicacao')::int) / 4.0, 1)
$$;

alter table public.avaliacoes drop constraint avaliacoes_notas_check;
alter table public.avaliacoes add constraint avaliacoes_notas_validas check (coalesce(privado.notas_validas(notas), false));
alter table public.avaliacoes add constraint avaliacoes_nota_final_coerente check (nota_final = privado.nota_final(notas));
