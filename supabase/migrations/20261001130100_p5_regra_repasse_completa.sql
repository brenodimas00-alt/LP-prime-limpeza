-- P5, achado do teste: regra "por carga" com carga faltando passava (bool_and ignora NULL de chave ausente).
create or replace function privado.regra_repasse_valida(r jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select case r ->> 'tipo'
    when 'percentual' then coalesce((r ->> 'percentual') ~ '^\d{1,3}(\.\d{1,2})?$' and (r ->> 'percentual')::numeric between 1 and 100, false)
    when 'por_carga' then coalesce((select bool_and(coalesce(r #>> array['valores', k] ~ '^\d{1,7}$', false)) from unnest(array['2', '4', '6', '8']) k), false)
                          and coalesce((r ->> 'horaExtraCentavos') ~ '^\d{1,6}$', false)
    else false end
$$;
