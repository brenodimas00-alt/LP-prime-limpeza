-- P4 (fase 2, bloco 3): atendimento acompanhado.
-- 1) Localização aproximada no check-in (saída, chegada, check-out), SÓ com o consentimento atual da profissional,
--    arredondada (~100 m), visível só pra Prime e apagada em 30 dias (pg_cron). Flag p4_localizacao.
-- 2) Checklist por tipo de serviço (editável pela prime_admin), marcado no check-out; item não feito exige motivo.
-- 3) Ocorrência pós-atendimento aberta pela cliente (tipo, descrição, foto opcional pela function documentos),
--    chamado no painel (aberto, em análise, resolvido) com histórico; I05 ao abrir e C15 a cada mudança. Flag p4_ocorrencias.

insert into public.config_flags (chave, ligada, padrao, descricao) values
  ('p4_localizacao', true, true, 'Localização aproximada da profissional no check-in, com o consentimento dela'),
  ('p4_ocorrencias', true, true, 'Cliente abre ocorrência depois do atendimento; chamado no painel')
on conflict (chave) do nothing;

-- ---------------------------------------------------------------- localização
create table public.localizacoes_atendimento (
  id bigserial primary key,
  atendimento_id uuid not null references public.atendimentos (id) on delete cascade,
  diarista_id uuid not null references public.diaristas (id) on delete cascade,
  evento text not null check (evento in ('sair_a_caminho', 'iniciar', 'finalizar')),
  lat numeric(7, 3) not null check (lat between -90 and 90),
  lon numeric(7, 3) not null check (lon between -180 and 180),
  precisao_m int check (precisao_m between 0 and 100000),
  registrada_em timestamptz not null default now(),
  unique (atendimento_id, evento)
);
create index localizacoes_retencao on public.localizacoes_atendimento (registrada_em);
alter table public.localizacoes_atendimento enable row level security;
alter table public.localizacoes_atendimento force row level security;
grant select on public.localizacoes_atendimento to authenticated;
create policy so_prime on public.localizacoes_atendimento for select to authenticated using ((select privado.eh_prime()));

/** Profissional da diária, com consentimento ATUAL: grava arredondado (3 casas, ~100 m). Repetir não duplica. */
create or replace function public.registrar_localizacao(p_atendimento uuid, p_dados jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); a public.atendimentos; lat numeric; lon numeric; prec int; ev text := p_dados ->> 'evento';
begin
  if s ->> 'ator' <> 'diarista' then perform privado.erro('ATOR_SEM_PERMISSAO', 'Só a profissional da diária'); end if;
  if not privado.flag('p4_localizacao') then return jsonb_build_object('gravada', false, 'motivo', 'desligada'); end if;
  if coalesce((privado.consentimentos_atuais('diarista', (s ->> 'id')::uuid) ->> 'localizacao_profissional')::boolean, false) is not true then
    return jsonb_build_object('gravada', false, 'motivo', 'sem_consentimento');
  end if;
  if ev not in ('sair_a_caminho', 'iniciar', 'finalizar') then perform privado.erro('DADOS_INVALIDOS', 'Evento inválido'); end if;
  begin lat := round((p_dados ->> 'lat')::numeric, 3); lon := round((p_dados ->> 'lon')::numeric, 3); prec := least(greatest(round((p_dados ->> 'precisao')::numeric), 0), 100000)::int;
  exception when others then perform privado.erro('DADOS_INVALIDOS', 'Localização inválida'); end;
  if lat is null or lon is null or lat not between -90 and 90 or lon not between -180 and 180 then perform privado.erro('DADOS_INVALIDOS', 'Localização inválida'); end if;
  select * into a from public.atendimentos where id = p_atendimento;
  if not found or a.diarista_id is distinct from (s ->> 'id')::uuid then perform privado.erro('NAO_ENCONTRADO', 'Diária não encontrada'); end if;
  -- só junto do próprio check-in: o evento já aconteceu na diária, há menos de 2 horas
  if not exists (select 1 from jsonb_array_elements(a.historico) h where h ->> 'evento' = ev and (h ->> 'em')::timestamptz > now() - interval '2 hours') then
    perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Localização só junto do check-in');
  end if;
  insert into public.localizacoes_atendimento (atendimento_id, diarista_id, evento, lat, lon, precisao_m)
  values (a.id, a.diarista_id, ev, lat, lon, prec) on conflict (atendimento_id, evento) do nothing;
  return jsonb_build_object('gravada', true);
end $$;

/** Retenção: localização some em 30 dias (pg_cron, todo dia). */
create or replace function privado.apagar_localizacoes_antigas() returns int
language sql security definer set search_path = '' as $$
  with x as (delete from public.localizacoes_atendimento where registrada_em < now() - interval '30 days' returning 1) select count(*)::int from x
$$;
select cron.schedule('prime-retencao-localizacao', '15 7 * * *', $$select privado.apagar_localizacoes_antigas()$$);

-- revogar o consentimento apaga o que já foi guardado dela
create or replace function privado.localizacao_revogada() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.tipo = 'localizacao_profissional' and not new.concedido then delete from public.localizacoes_atendimento where diarista_id = new.titular_id; end if;
  return new;
end $$;
create trigger localizacao_revogada after insert on public.consentimentos for each row execute function privado.localizacao_revogada();

/** Check-ins de uma diária pra Prime: horário de cada etapa (histórico) e a localização, quando houver. */
create or replace function public.checkins_atendimento(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator(); a public.atendimentos;
begin
  perform privado.exigir_prime(s);
  select * into a from public.atendimentos where id = p_id;
  if not found then perform privado.erro('NAO_ENCONTRADO', 'Diária não encontrada'); end if;
  return (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('evento', h ->> 'evento', 'em', h ->> 'em', 'ator', h ->> 'ator',
      'lat', l.lat, 'lon', l.lon, 'precisao', l.precisao_m)) order by h ->> 'em'), '[]')
    from jsonb_array_elements(a.historico) h left join public.localizacoes_atendimento l on l.atendimento_id = a.id and l.evento = h ->> 'evento'
    where h ->> 'evento' in ('sair_a_caminho', 'iniciar', 'finalizar'));
end $$;

-- ---------------------------------------------------------------- checklist
create table public.checklists (
  tipo_servico text primary key check (tipo_servico in ('residencial', 'empresarial', 'condominial', 'pre_pos_mudanca', 'pre_pos_evento', 'passadoria')),
  itens jsonb not null check (jsonb_typeof(itens) = 'array' and jsonb_array_length(itens) <= 30),
  atualizado_por uuid references auth.users (id) on delete set null,
  atualizado_em timestamptz not null default now()
);
alter table public.checklists enable row level security;
alter table public.checklists force row level security;
grant select on public.checklists to authenticated;
create policy leitura on public.checklists for select to authenticated using ((select privado.papel()) is not null);
create trigger auditoria after insert or update or delete on public.checklists for each row execute function privado.auditar();
-- semente: "O que está incluído" de cada serviço (src/config/agendamento.js; testa-atendimento-p4 confere)
insert into public.checklists (tipo_servico, itens) values
  ('residencial', '["Limpeza dos pisos e dos revestimentos de paredes","Limpeza completa de banheiros","Limpeza de espelhos e vidros","Limpeza externa e interna de fogão (incluindo forno), micro-ondas e air fryer","Organização de roupas expostas e arrumação de camas","Limpeza interna de janelas","Lavagem de louças","Limpeza da superfície de móveis","Limpeza externa e interna de geladeira","Remoção do lixo","Limpeza de portas","Área externa: limpeza de pisos em garagem, quintal, varanda e terraço"]'::jsonb),
  ('empresarial', '["Remoção de poeira e limpeza de superfícies, mesas e balcões","Desinfecção de áreas de contato frequente, como maçanetas e corrimãos","Lavagem de pisos","Limpeza de vidros, espelhos e janelas","Higienização de banheiros","Organização de áreas de trabalho","Reposição de materiais de higiene","Coleta e descarte do lixo"]'::jsonb),
  ('condominial', '["Varrer e lavar áreas comuns: corredores, halls, áreas de lazer e outros espaços compartilhados","Limpeza de superfícies, escadas e elevadores","Retirada e descarte do lixo","Limpeza de portas, interfones e áreas de convivência"]'::jsonb),
  ('pre_pos_mudanca', '["Pisos: varrição e lavagem","Superfícies: bancadas, prateleiras e outras superfícies livres de poeira","Vidros e janelas: limpeza interna","Banheiros: higienização completa, com desinfecção de pias, vasos sanitários e chuveiros","Cozinha: limpeza das áreas de preparo de alimentos, como bancadas e armários"]'::jsonb),
  ('pre_pos_evento', '[]'::jsonb),
  ('passadoria', '["Passar as roupas separadas pelo cliente, dentro da carga horária contratada","O ferro de passar e a tábua são fornecidos pelo cliente","Não inclui limpeza: o atendimento é só de passadoria"]'::jsonb)
;

create table public.checklist_respostas (
  atendimento_id uuid primary key references public.atendimentos (id) on delete cascade,
  itens jsonb not null,
  registrado_em timestamptz not null default now()
);
alter table public.checklist_respostas enable row level security;
alter table public.checklist_respostas force row level security;
grant select on public.checklist_respostas to authenticated;
create policy prime_ou_profissional on public.checklist_respostas for select to authenticated
  using ((select privado.eh_prime()) or exists (select 1 from public.atendimentos a where a.id = atendimento_id and a.diarista_id = (select privado.minha_diarista_id())));
create trigger auditoria after insert or update or delete on public.checklist_respostas for each row execute function privado.auditar();

/** prime_admin edita a lista de um serviço (1 a 30 itens, 3 a 160 caracteres, sem repetir). */
create or replace function public.salvar_checklist(p_tipo text, p_itens jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); limpos jsonb;
begin
  perform privado.exigir_prime(s);
  if s ->> 'papel' <> 'prime_admin' then perform privado.erro('ATOR_SEM_PERMISSAO', 'Só a administração edita o checklist'); end if;
  if jsonb_typeof(p_itens) <> 'array' then perform privado.erro('DADOS_INVALIDOS', 'Lista inválida'); end if;
  select coalesce(jsonb_agg(t order by o), '[]') into limpos from (select distinct on (lower(t)) t, o from (
    select regexp_replace(trim(x), '\s+', ' ', 'g') t, o from jsonb_array_elements_text(p_itens) with ordinality e(x, o)) y where t <> '' order by lower(t), o) z;
  if jsonb_array_length(limpos) > 30 or exists (select 1 from jsonb_array_elements_text(limpos) t where char_length(t) not between 3 and 160) then
    perform privado.erro('DADOS_INVALIDOS', 'Até 30 itens, cada um com 3 a 160 caracteres');
  end if;
  perform set_config('app.ator', 'prime', true);
  update public.checklists set itens = limpos, atualizado_por = auth.uid(), atualizado_em = now() where tipo_servico = p_tipo;
  if not found then perform privado.erro('NAO_ENCONTRADO', 'Serviço não encontrado'); end if;
  return jsonb_build_object('tipoServico', p_tipo, 'itens', limpos);
end $$;

/** Checklist da diária (a lista do serviço + a resposta, se já marcada). Profissional da diária ou Prime. */
create or replace function public.checklist_atendimento(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator(); a public.atendimentos; p public.pedidos;
begin
  select * into a from public.atendimentos where id = p_id;
  if not found or not (s ->> 'ator' in ('prime', 'sistema') or (s ->> 'ator' = 'diarista' and a.diarista_id = (s ->> 'id')::uuid)) then
    perform privado.erro('NAO_ENCONTRADO', 'Diária não encontrada'); end if;
  select * into p from public.pedidos where id = a.pedido_id;
  return jsonb_build_object('tipoServico', p.pacote ->> 'tipoServico',
    'itens', coalesce((select c.itens from public.checklists c where c.tipo_servico = p.pacote ->> 'tipoServico'), '[]'),
    'resposta', (select r.itens from public.checklist_respostas r where r.atendimento_id = a.id),
    'registradoEm', (select r.registrado_em from public.checklist_respostas r where r.atendimento_id = a.id));
end $$;

/** Check-out: a profissional marca cada item da lista do serviço; não feito exige motivo. Diária em andamento. */
create or replace function public.registrar_checklist(p_atendimento uuid, p_itens jsonb, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; a public.atendimentos; p public.pedidos; lista jsonb; resp jsonb := '[]'; t text; x jsonb; conteudo jsonb := jsonb_build_object('id', p_atendimento, 'itens', p_itens);
begin
  if s ->> 'ator' <> 'diarista' then perform privado.erro('ATOR_SEM_PERMISSAO', 'Só a profissional da diária'); end if;
  r := privado.idem_ler('registrarChecklist', s, p_chave, conteudo);
  if r is not null then return r; end if;
  select * into a from public.atendimentos where id = p_atendimento for update;
  if not found or a.diarista_id is distinct from (s ->> 'id')::uuid then perform privado.erro('NAO_ENCONTRADO', 'Diária não encontrada'); end if;
  if a.status <> 'em_andamento' then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'O checklist é marcado no check-out, com a diária em andamento'); end if;
  if exists (select 1 from public.checklist_respostas where atendimento_id = a.id) then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Checklist já registrado'); end if;
  select * into p from public.pedidos where id = a.pedido_id;
  lista := coalesce((select c.itens from public.checklists c where c.tipo_servico = p.pacote ->> 'tipoServico'), '[]');
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) <> jsonb_array_length(lista) then perform privado.erro('DADOS_INVALIDOS', 'Marque todos os itens do checklist'); end if;
  for t in select jsonb_array_elements_text(lista) loop
    select e into x from jsonb_array_elements(p_itens) e where e ->> 'texto' = t limit 1;
    if x is null or jsonb_typeof(x -> 'feito') <> 'boolean' then perform privado.erro('DADOS_INVALIDOS', 'Marque todos os itens do checklist', jsonb_build_object('item', t)); end if;
    if not (x ->> 'feito')::boolean and char_length(trim(coalesce(x ->> 'motivo', ''))) < 3 then
      perform privado.erro('DADOS_INVALIDOS', 'Diga por que não foi feito: ' || t, jsonb_build_object('item', t)); end if;
    resp := resp || jsonb_strip_nulls(jsonb_build_object('texto', t, 'feito', (x ->> 'feito')::boolean,
      'motivo', case when not (x ->> 'feito')::boolean then left(regexp_replace(trim(x ->> 'motivo'), '\s+', ' ', 'g'), 200) end));
  end loop;
  perform set_config('app.ator', 'diarista', true);
  insert into public.checklist_respostas (atendimento_id, itens) values (a.id, resp);
  r := jsonb_build_object('itens', resp, 'naoFeitos', (select count(*) from jsonb_array_elements(resp) e where not (e ->> 'feito')::boolean));
  perform privado.idem_gravar('registrarChecklist', s, p_chave, conteudo, r);
  return r;
end $$;

-- ---------------------------------------------------------------- ocorrências
create table public.ocorrencias (
  id uuid primary key default gen_random_uuid(),
  atendimento_id uuid not null references public.atendimentos (id) on delete cascade,
  cliente_id uuid not null references public.clientes (id) on delete cascade,
  tipo text not null check (tipo in ('dano', 'item_nao_feito', 'atraso', 'comportamento', 'outro')),
  descricao text not null check (char_length(descricao) between 10 and 1000),
  estado text not null default 'aberto' check (estado in ('aberto', 'em_analise', 'resolvido')),
  historico jsonb not null default '[]',
  foto_path text,
  foto_mime text check (foto_mime in ('image/jpeg', 'image/png')),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index ocorrencias_estado on public.ocorrencias (estado, criado_em desc);
create index ocorrencias_cliente on public.ocorrencias (cliente_id, criado_em desc);
alter table public.ocorrencias enable row level security;
alter table public.ocorrencias force row level security;
grant select on public.ocorrencias to authenticated;
create policy prime_ou_cliente on public.ocorrencias for select to authenticated
  using ((select privado.eh_prime()) or cliente_id = (select privado.meu_cliente_id()));
create trigger auditoria after insert or update or delete on public.ocorrencias for each row execute function privado.auditar();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ocorrencias', 'ocorrencias', false, 5242880, array['image/jpeg', 'image/png']) on conflict (id) do nothing;

create or replace function privado.j_ocorrencia(o public.ocorrencias) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', o.id, 'atendimentoId', o.atendimento_id, 'clienteId', o.cliente_id, 'tipo', o.tipo, 'descricao', o.descricao,
    'estado', o.estado, 'historico', o.historico, 'temFoto', o.foto_path is not null, 'criadoEm', o.criado_em, 'atualizadoEm', o.atualizado_em)
$$;
create or replace function privado.rotulo_ocorrencia(e text) returns text
language sql immutable set search_path = '' as $$
  select case e when 'aberto' then 'aberto' when 'em_analise' then 'em análise' when 'resolvido' then 'resolvido' end
$$;

/** Cliente dona abre sobre uma diária realizada nos últimos 30 dias. Até 5 por dia por cliente. */
create or replace function public.abrir_ocorrencia(p_atendimento uuid, p_dados jsonb, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; a public.atendimentos; p public.pedidos; o public.ocorrencias; d text; tp text := p_dados ->> 'tipo';
        conteudo jsonb;
begin
  if not privado.flag('p4_ocorrencias') then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Abertura de ocorrência pelo site desligada. Fale com a Prime.'); end if;
  if s ->> 'ator' <> 'cliente' then perform privado.erro('ATOR_SEM_PERMISSAO', 'Só a cliente da diária abre ocorrência'); end if;
  d := regexp_replace(trim(coalesce(p_dados ->> 'descricao', '')), '\s+', ' ', 'g');
  if tp not in ('dano', 'item_nao_feito', 'atraso', 'comportamento', 'outro') then perform privado.erro('DADOS_INVALIDOS', 'Escolha o tipo', '{"tipo": "Escolha o tipo"}'); end if;
  if char_length(d) not between 10 and 1000 then perform privado.erro('DADOS_INVALIDOS', 'Conte o que aconteceu (de 10 a 1000 caracteres)', '{"descricao": "De 10 a 1000 caracteres"}'); end if;
  conteudo := jsonb_build_object('atendimento', p_atendimento, 'tipo', tp, 'd', d);
  r := privado.idem_ler('abrirOcorrencia', s, p_chave, conteudo);
  if r is not null then return r; end if;
  select * into a from public.atendimentos where id = p_atendimento;
  if found then select * into p from public.pedidos where id = a.pedido_id; end if;
  if not found or p.cliente_id is distinct from (s ->> 'id')::uuid then perform privado.erro('NAO_ENCONTRADO', 'Diária não encontrada'); end if;
  if a.status not in ('finalizado', 'avaliado') then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Ocorrência se abre depois do atendimento'); end if;
  if a.data < privado.hoje_sp() - 30 then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Passaram mais de 30 dias da diária. Fale com a Prime.'); end if;
  perform pg_advisory_xact_lock(hashtext('ocorrencia:' || p.cliente_id));
  if (select count(*) from public.ocorrencias where cliente_id = p.cliente_id and criado_em > now() - interval '1 day') >= 5 then
    perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Muitas ocorrências hoje. Fale com a Prime pelo WhatsApp.'); end if;
  perform set_config('app.ator', 'cliente', true);
  insert into public.ocorrencias (atendimento_id, cliente_id, tipo, descricao, historico)
  values (a.id, p.cliente_id, tp, d, jsonb_build_array(jsonb_build_object('estado', 'aberto', 'em', privado.agora_iso(), 'ator', 'cliente'))) returning * into o;
  perform privado.evento('ocorrencia_aberta', jsonb_build_object('pedidoId', p.id, 'atendimentoId', a.id, 'clienteId', p.cliente_id, 'ocorrenciaId', o.id), jsonb_build_object('tipo', tp));
  r := jsonb_build_object('ocorrencia', privado.j_ocorrencia(o));
  perform privado.idem_gravar('abrirOcorrencia', s, p_chave, conteudo, r);
  return r;
end $$;

/** Prime muda o estado (com comentário opcional, que a cliente vê). C15 pra cliente a cada mudança. */
create or replace function public.atualizar_ocorrencia(p_id uuid, p_dados jsonb, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; o public.ocorrencias; a public.atendimentos; novo text := p_dados ->> 'estado'; com text; conteudo jsonb;
begin
  perform privado.exigir_prime(s);
  com := nullif(left(regexp_replace(trim(coalesce(p_dados ->> 'comentario', '')), '\s+', ' ', 'g'), 500), '');
  if novo not in ('aberto', 'em_analise', 'resolvido') then perform privado.erro('DADOS_INVALIDOS', 'Estado inválido'); end if;
  conteudo := jsonb_build_object('id', p_id, 'estado', novo, 'c', com);
  r := privado.idem_ler('atualizarOcorrencia', s, p_chave, conteudo);
  if r is not null then return r; end if;
  select * into o from public.ocorrencias where id = p_id for update;
  if not found then perform privado.erro('NAO_ENCONTRADO', 'Ocorrência não encontrada'); end if;
  if o.estado = novo and com is null then perform privado.erro('TRANSICAO_PROIBIDA', 'O chamado já está ' || privado.rotulo_ocorrencia(novo)); end if;
  perform set_config('app.ator', 'prime', true);
  update public.ocorrencias set estado = novo, atualizado_em = now(),
    historico = historico || jsonb_strip_nulls(jsonb_build_object('estado', novo, 'em', privado.agora_iso(), 'ator', 'prime', 'comentario', com))
   where id = o.id returning * into o;
  select * into a from public.atendimentos where id = o.atendimento_id;
  perform privado.evento('ocorrencia_atualizada', jsonb_build_object('pedidoId', a.pedido_id, 'atendimentoId', a.id, 'clienteId', o.cliente_id, 'ocorrenciaId', o.id),
    jsonb_build_object('estado', privado.rotulo_ocorrencia(novo), 'n', jsonb_array_length(o.historico)));
  r := jsonb_build_object('ocorrencia', privado.j_ocorrencia(o));
  perform privado.idem_gravar('atualizarOcorrencia', s, p_chave, conteudo, r);
  return r;
end $$;

/** Prime: todas (filtro por estado), com cliente e diária. Cliente: as dela. */
create or replace function public.listar_ocorrencias(p_filtro jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator();
begin
  if s ->> 'ator' = 'cliente' then
    return (select coalesce(jsonb_agg(privado.j_ocorrencia(o) || jsonb_build_object('data', a.data) order by o.criado_em desc), '[]')
      from public.ocorrencias o join public.atendimentos a on a.id = o.atendimento_id
      where o.cliente_id = (s ->> 'id')::uuid and (p_filtro ->> 'atendimentoId' is null or o.atendimento_id::text = p_filtro ->> 'atendimentoId'));
  end if;
  perform privado.exigir_prime(s);
  return (select coalesce(jsonb_agg(privado.j_ocorrencia(o) || jsonb_build_object('data', a.data, 'cliente', c.nome, 'profissional', d.nome) order by o.criado_em desc), '[]')
    from public.ocorrencias o join public.atendimentos a on a.id = o.atendimento_id join public.clientes c on c.id = o.cliente_id left join public.diaristas d on d.id = a.diarista_id
    where (p_filtro ->> 'estado' is null or o.estado = p_filtro ->> 'estado'));
end $$;

/** A function documentos anexa a foto (já validada e gravada no bucket) pela cliente dona, uma vez. */
create or replace function public.anexar_foto_ocorrencia(p_id uuid, p_path text, p_mime text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); o public.ocorrencias;
begin
  select * into o from public.ocorrencias where id = p_id for update;
  if not found or s ->> 'ator' <> 'cliente' or o.cliente_id is distinct from (s ->> 'id')::uuid then perform privado.erro('NAO_ENCONTRADO', 'Ocorrência não encontrada'); end if;
  if o.foto_path is not null then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Esta ocorrência já tem foto'); end if;
  if p_mime not in ('image/jpeg', 'image/png') or p_path !~ ('^' || auth.uid() || '/' || o.id || '\.(jpg|png)$') then perform privado.erro('DADOS_INVALIDOS', 'Foto inválida'); end if;
  perform set_config('app.ator', 'cliente', true);
  update public.ocorrencias set foto_path = p_path, foto_mime = p_mime, atualizado_em = now() where id = o.id returning * into o;
  return jsonb_build_object('ocorrencia', privado.j_ocorrencia(o));
end $$;

/** Prime abre a foto (a function assina a URL curta). */
create or replace function public.foto_ocorrencia(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator(); o public.ocorrencias;
begin
  perform privado.exigir_prime(s);
  select * into o from public.ocorrencias where id = p_id;
  if not found or o.foto_path is null then perform privado.erro('NAO_ENCONTRADO', 'Foto não encontrada'); end if;
  return jsonb_build_object('path', o.foto_path);
end $$;

revoke execute on function public.registrar_localizacao(uuid, jsonb), public.checkins_atendimento(uuid), public.salvar_checklist(text, jsonb),
  public.checklist_atendimento(uuid), public.registrar_checklist(uuid, jsonb, text), public.abrir_ocorrencia(uuid, jsonb, text),
  public.atualizar_ocorrencia(uuid, jsonb, text), public.listar_ocorrencias(jsonb), public.anexar_foto_ocorrencia(uuid, text, text), public.foto_ocorrencia(uuid) from public, anon;
grant execute on function public.registrar_localizacao(uuid, jsonb), public.checkins_atendimento(uuid), public.salvar_checklist(text, jsonb),
  public.checklist_atendimento(uuid), public.registrar_checklist(uuid, jsonb, text), public.abrir_ocorrencia(uuid, jsonb, text),
  public.atualizar_ocorrencia(uuid, jsonb, text), public.listar_ocorrencias(jsonb), public.anexar_foto_ocorrencia(uuid, text, text), public.foto_ocorrencia(uuid) to authenticated;
