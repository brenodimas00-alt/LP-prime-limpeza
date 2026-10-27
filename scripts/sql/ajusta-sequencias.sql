-- Depois de restaurar um backup (scripts/restaura.sh e o ensaio local): cada sequência de coluna serial/identity de
-- public e auth sobe pro maior valor existente. O dump traz o setval do momento do backup; restaurar por cima de um banco
-- que mudou depois voltaria a sequência pra trás e o próximo insert colidiria.
do $$ declare r record; m bigint; begin
  for r in select s.oid::regclass seq, d.refobjid::regclass tab, a.attname col from pg_class s
    join pg_depend d on d.objid = s.oid and d.deptype in ('a', 'i') join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
    join pg_namespace n on n.oid = s.relnamespace where s.relkind = 'S' and n.nspname in ('public', 'auth') loop
    execute format('select max(%I) from %s', r.col, r.tab) into m;
    if m is not null then perform setval(r.seq, greatest(m, (select last_value from pg_sequences where format('%I.%I', schemaname, sequencename)::regclass = r.seq))); end if;
  end loop; end $$;
