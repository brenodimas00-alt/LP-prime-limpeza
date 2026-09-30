-- O1 (fase 2, bloco 3): observabilidade.
-- 1) Erros do site e das Edge Functions numa tabela só, agrupados por assinatura (origem + mensagem limpa + página),
--    com contagem e último ocorrido. Nunca guarda dado pessoal: a mensagem é limpa aqui (e-mail, números longos, query
--    string e token saem). Erro novo (ou que volta depois de 24 h) gera o I10 pra equipe e aparece no painel.
-- 2) Batimento do worker de automações; rotina de vigia (pg_cron a cada 5 min) registra "worker parado" quando ele some.
-- 3) Funil sem cookie: contagem por dia de abriu a calculadora, iniciou e concluiu a solicitação e pagou (as duas últimas
--    contadas no banco, pelo pedido e pela confirmação do pagamento). Flag o1_funil.
-- 4) Saúde do sistema no painel: último ciclo do worker, fila atrasada, falhas em 24 h, erros e último backup.

insert into public.config_flags (chave, ligada, padrao, descricao) values
  ('o1_funil', true, true, 'Contagem anônima do funil (calculadora, solicitação iniciada e concluída, pagamento), sem cookie')
on conflict (chave) do nothing;

-- ---------------------------------------------------------------- erros
create table public.erros (
  assinatura text primary key,
  origem text not null check (char_length(origem) <= 60),
  mensagem text not null check (char_length(mensagem) <= 300),
  pagina text check (char_length(pagina) <= 120),
  contagem bigint not null default 1,
  primeiro_em timestamptz not null default now(),
  ultimo_em timestamptz not null default now(),
  avisado_em timestamptz
);
create index erros_ultimo on public.erros (ultimo_em desc);
alter table public.erros enable row level security;
alter table public.erros force row level security;
-- leitura só pela RPC do painel

/** Tira dado pessoal de um texto de erro: e-mail, sequência de 4+ dígitos, query string, token/JWT, uuid. */
create or replace function privado.limpar_erro(t text) returns text
language sql immutable set search_path = '' as $$
  select left(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(coalesce(t, ''),
    '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+', '<email>', 'g'),
    '[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}(\.[A-Za-z0-9_-]+)?', '<token>', 'g'),
    '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '<id>', 'gi'),
    '\?[^\s]*', '', 'g'),
    '\d[\d.\-/ ()]{3,}\d', '<n>', 'g'), 300)
$$;

create or replace function privado.registrar_erro(p_origem text, p_mensagem text, p_pagina text) returns void
language plpgsql security definer set search_path = '' as $$
declare o text := left(regexp_replace(coalesce(p_origem, 'desconhecida'), '[^a-z0-9:_ -]', '', 'gi'), 60);
        m text := privado.limpar_erro(p_mensagem); pg text := left(regexp_replace(coalesce(p_pagina, ''), '[?#].*$', ''), 120);
        a text; e public.erros;
begin
  if m = '' then return; end if;
  a := md5(o || '|' || m || '|' || pg);
  insert into public.erros as x (assinatura, origem, mensagem, pagina) values (a, o, m, nullif(pg, ''))
  on conflict (assinatura) do update set contagem = x.contagem + 1, ultimo_em = now()
  returning * into e;
  -- erro novo, ou que voltou depois de 24 h sem aviso: I10 pra equipe (uma vez por janela)
  if e.avisado_em is null or e.avisado_em < now() - interval '24 hours' then
    update public.erros set avisado_em = now() where assinatura = a;
    perform privado.evento('erro_sistema', jsonb_build_object('erroId', a), jsonb_build_object('origem', o, 'erro', m));
  end if;
end $$;

/** Do navegador (anônimo ou logado): limite por IP; nada volta pro navegador além de ok. */
create or replace function public.registrar_erro(p_origem text, p_mensagem text, p_pagina text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare ip text := coalesce(nullif(split_part(coalesce(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-forwarded-for', ''), ',', 1), ''), 'sem-ip');
begin
  if coalesce(p_origem, '') !~ '^site(:[a-z0-9_-]{1,40})?$' then return false; end if;
  if not privado.limite_acao('erro:' || ip, 30, interval '1 hour') then return false; end if;
  perform privado.registrar_erro(p_origem, p_mensagem, p_pagina);
  return true;
end $$;
revoke execute on function public.registrar_erro(text, text, text) from public;
grant execute on function public.registrar_erro(text, text, text) to anon, authenticated;

/** Das Edge Functions (serviço). */
create or replace function public.erro_servico(p_origem text, p_mensagem text) returns void
language sql security definer set search_path = '' as $$ select privado.registrar_erro(p_origem, p_mensagem, null) $$;
revoke execute on function public.erro_servico(text, text) from public, anon, authenticated;
grant execute on function public.erro_servico(text, text) to service_role;

-- ---------------------------------------------------------------- batimento do worker e vigia
create table privado.batimentos (componente text primary key, em timestamptz not null default now(), resultado jsonb);
create or replace function public.batimento(p_componente text, p_resultado jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into privado.batimentos (componente, em, resultado) values (left(p_componente, 40), now(), p_resultado)
  on conflict (componente) do update set em = now(), resultado = excluded.resultado
$$;
revoke execute on function public.batimento(text, jsonb) from public, anon, authenticated;
grant execute on function public.batimento(text, jsonb) to service_role;

/** Worker sem batimento há mais de 5 minutos (com o motor ligado): erro "worker parado" (e o I10). */
create or replace function privado.vigiar_worker() returns boolean
language plpgsql security definer set search_path = '' as $$
declare ultimo timestamptz := (select em from privado.batimentos where componente = 'worker');
begin
  if not privado.flag('automacoes_motor') then return false; end if;
  if ultimo is null or ultimo < now() - interval '5 minutes' then
    perform privado.registrar_erro('vigia', 'worker de automações parado: sem ciclo há mais de 5 minutos', null);
    return true;
  end if;
  return false;
end $$;
select cron.schedule('prime-vigia-worker', '*/5 * * * *', $$select privado.vigiar_worker()$$);

-- ---------------------------------------------------------------- backup
create table privado.backups (id bigserial primary key, em timestamptz not null default now(), tamanho_bytes bigint, destino text);
create or replace function public.registrar_backup(p_tamanho bigint, p_destino text) returns void
language sql security definer set search_path = '' as $$ insert into privado.backups (tamanho_bytes, destino) values (p_tamanho, left(p_destino, 120)) $$;
revoke execute on function public.registrar_backup(bigint, text) from public, anon, authenticated;
grant execute on function public.registrar_backup(bigint, text) to service_role;

-- ---------------------------------------------------------------- funil
create table public.funil_diario (
  dia date not null,
  evento text not null check (evento in ('abriu_calculadora', 'iniciou_solicitacao', 'concluiu_solicitacao', 'pagou')),
  total bigint not null default 0,
  primary key (dia, evento)
);
alter table public.funil_diario enable row level security;
alter table public.funil_diario force row level security;
create or replace function privado.contar_funil(p_evento text) returns void
language sql security definer set search_path = '' as $$
  insert into public.funil_diario as f (dia, evento, total) select privado.hoje_sp(), p_evento, 1 where privado.flag('o1_funil')
  on conflict (dia, evento) do update set total = f.total + 1
$$;
/** Do navegador: só os dois eventos que acontecem na tela; limite por IP. Sem cookie, sem id de pessoa. */
create or replace function public.registrar_funil(p_evento text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare ip text := coalesce(nullif(split_part(coalesce(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-forwarded-for', ''), ',', 1), ''), 'sem-ip');
begin
  if p_evento not in ('abriu_calculadora', 'iniciou_solicitacao') then return false; end if;
  if not privado.limite_acao('funil:' || ip, 60, interval '1 hour') then return false; end if;
  perform privado.contar_funil(p_evento);
  return true;
end $$;
revoke execute on function public.registrar_funil(text) from public;
grant execute on function public.registrar_funil(text) to anon, authenticated;
create or replace function privado.funil_pedido() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not new.ficticio then perform privado.contar_funil('concluiu_solicitacao'); end if;
  return new;
end $$;
create trigger funil_pedido after insert on public.pedidos for each row execute function privado.funil_pedido();
create or replace function privado.funil_pagou() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'confirmado' and old.status is distinct from 'confirmado'
     and not exists (select 1 from public.pedidos p where p.id = new.pedido_id and p.ficticio) then perform privado.contar_funil('pagou'); end if;
  return new;
end $$;
create trigger funil_pagou after update of status on public.pagamentos for each row execute function privado.funil_pagou();

-- ---------------------------------------------------------------- saúde (painel)
create or replace function public.saude_sistema() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator(); w privado.batimentos;
begin
  perform privado.exigir_prime(s);
  select * into w from privado.batimentos where componente = 'worker';
  return jsonb_build_object(
    'worker', jsonb_build_object('ultimoCiclo', w.em, 'parado', w.em is null or w.em < now() - interval '5 minutes', 'resultado', w.resultado, 'motorLigado', privado.flag('automacoes_motor')),
    'filaAtrasada', jsonb_build_object('eventos', (select count(*) from public.eventos where status = 'pendente' and criado_em < now() - interval '10 minutes'),
                                        'execucoes', (select count(*) from public.automacao_execucoes where estado = 'agendada' and agendada_para < now() - interval '10 minutes')),
    'falhas24h', (select count(*) from public.automacao_execucoes where estado = 'falhou' and atualizado_em > now() - interval '24 hours'),
    'erros24h', (select coalesce(sum(contagem), 0) from public.erros where ultimo_em > now() - interval '24 hours'),
    'ultimoBackup', (select max(em) from privado.backups),
    'erros', (select coalesce(jsonb_agg(jsonb_build_object('assinatura', left(e.assinatura, 8), 'origem', e.origem, 'mensagem', e.mensagem, 'pagina', e.pagina,
                'contagem', e.contagem, 'primeiroEm', e.primeiro_em, 'ultimoEm', e.ultimo_em) order by e.ultimo_em desc), '[]')
              from (select * from public.erros order by ultimo_em desc limit 30) e),
    'funil', (select coalesce(jsonb_object_agg(evento, total), '{}') from (select evento, sum(total) total from public.funil_diario where dia > privado.hoje_sp() - 30 group by evento) f));
end $$;
revoke execute on function public.saude_sistema() from public, anon;
grant execute on function public.saude_sistema() to authenticated;

-- ---------------------------------------------------------------- I10 no catálogo (gerado por scripts/gera-seed-automacoes.mjs)
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('erro_sistema', 'painel', 1, 'Erro novo no sistema ({{origem}}): {{erro}}. Detalhes em Visão geral, Saúde do sistema.', null, array['origem', 'erro']::text[], array['origem', 'erro']::text[], null, true);
insert into public.automacao_regras (codigo, template_codigo, descricao, categoria, destinatario, canais_ordem, gatilho, atraso, condicoes, cancelamento, entidade, marco, do_dia, validade_min, ligada) values ('I10', 'erro_sistema', 'Erro novo no sistema ou worker parado (O1)', 'interno', 'equipe_prime', array['painel']::text[], '{"tipo":"evento","eventos":["erro_sistema"]}'::jsonb, '{"tipo":"imediato"}'::jsonb, '{}'::jsonb, array[]::text[], 'erro', null, false, null, true);
