-- P2 (fase 2, bloco 3): agenda por profissional, disponibilidade, bloqueios (férias, folga), conflito na atribuição e
-- sugestão de profissionais. Regras no banco: sobreposição e bloqueio impedem; fora do dia, do turno ou da região da
-- profissional é AVISO (a Prime confirma "atribuir mesmo assim"). Flag p2_disponibilidade (ligada) desliga os avisos
-- e os bloqueios na atribuição (a sobreposição continua valendo sempre).

insert into public.config_flags (chave, ligada, padrao, descricao) values
  ('p2_disponibilidade', true, true, 'Atribuição confere bloqueios (férias, folga) e avisa quando a diária está fora da disponibilidade da profissional')
on conflict (chave) do nothing;

alter table public.configuracao drop constraint configuracao_chave_check;
alter table public.configuracao add constraint configuracao_chave_check check (chave in ('pix', 'contato', 'auth', 'documentos', 'regioes_diarista'));
-- regiões que a profissional marca (mesma lista de src/config/precos.js regioesDiarista; testa-agenda-p2 confere)
insert into public.configuracao (chave, valor) values ('regioes_diarista', '["BH - Centro-Sul", "BH - Pampulha", "BH - Oeste", "BH - Barreiro", "BH - Noroeste", "BH - Norte",
  "BH - Nordeste", "BH - Leste", "BH - Venda Nova", "Contagem", "Santa Luzia", "Ribeirão das Neves", "Sabará", "Betim", "Ibirité", "Vespasiano", "Nova Lima"]')
on conflict (chave) do nothing;

create table public.bloqueios_profissional (
  id uuid primary key default gen_random_uuid(),
  diarista_id uuid not null references public.diaristas (id) on delete cascade,
  de date not null,
  ate date not null,
  motivo text not null check (motivo in ('ferias', 'folga', 'outro')),
  observacao text check (char_length(observacao) <= 200),
  criado_por uuid references auth.users (id) on delete set null,
  criado_em timestamptz not null default now(),
  check (ate >= de and ate - de <= 366)
);
create index bloqueios_profissional_periodo on public.bloqueios_profissional (diarista_id, de, ate);
alter table public.bloqueios_profissional enable row level security;
alter table public.bloqueios_profissional force row level security;
grant select on public.bloqueios_profissional to authenticated;
create policy prime_ou_dona on public.bloqueios_profissional for select to authenticated
  using ((select privado.eh_prime()) or diarista_id = (select privado.minha_diarista_id()));
create trigger auditoria after insert or update or delete on public.bloqueios_profissional for each row execute function privado.auditar();
-- agenda da semana por profissional e por data
create index if not exists atendimentos_diarista_data on public.atendimentos (diarista_id, data) where status <> 'cancelado';

-- ---------------------------------------------------------------- regras puras
/** Janela da diária cabe nos turnos: manhã termina até 13:00, tarde começa a partir de 12:00, integral qualquer. */
create or replace function privado.cabe_no_turno(p_turnos jsonb, p_inicio time, p_minutos int) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(p_turnos ? 'integral', false)
      or (coalesce(p_turnos ? 'manha', false) and coalesce(p_turnos ? 'tarde', false))
      or (coalesce(p_turnos ? 'manha', false) and p_inicio + make_interval(mins => p_minutos) <= time '13:00')
      or (coalesce(p_turnos ? 'tarde', false) and p_inicio >= time '12:00')
$$;

/** Região da profissional cobre a cidade do atendimento (BH por regional: qualquer "BH - ..." cobre Belo Horizonte). */
create or replace function privado.cobre_regiao(p_regioes jsonb, p_cidade text) returns boolean
language sql immutable set search_path = '' as $$
  select exists (select 1 from jsonb_array_elements_text(coalesce(p_regioes, '[]')) r
                  where lower(r) = lower(coalesce(p_cidade, ''))
                     or (lower(coalesce(p_cidade, '')) = 'belo horizonte' and r like 'BH - %'))
$$;

/**
 * Conflitos de pôr a profissional na diária (data e hora já as novas). tipo: sobreposicao | bloqueio (impedem) e
 * dia | turno | regiao (avisos). Ignora a própria diária.
 */
create or replace function privado.conflitos_diaria(p_diarista uuid, p_atendimento uuid, p_data date, p_inicio time, p_minutos int, p_cidade text) returns jsonb
language plpgsql stable set search_path = '' as $$
declare d public.diaristas; r jsonb := '[]'; alvo public.atendimentos; x public.atendimentos; b public.bloqueios_profissional; disp jsonb;
begin
  select * into d from public.diaristas where id = p_diarista;
  if not found then return r; end if;
  alvo.data := p_data; alvo.hora_inicio := p_inicio; alvo.duracao_minutos := p_minutos;
  for x in select * from public.atendimentos where diarista_id = p_diarista and id is distinct from p_atendimento and status <> 'cancelado' and data = p_data loop
    if privado.sobrepoe(alvo, x) then
      r := r || jsonb_build_object('tipo', 'sobreposicao', 'impede', true, 'mensagem', 'Já tem diária das ' || to_char(x.hora_inicio, 'HH24:MI') || ' às ' || to_char(x.hora_inicio + make_interval(mins => x.duracao_minutos), 'HH24:MI'));
    end if;
  end loop;
  if privado.flag('p2_disponibilidade') then
    for b in select * from public.bloqueios_profissional where diarista_id = p_diarista and p_data between de and ate loop
      r := r || jsonb_build_object('tipo', 'bloqueio', 'impede', true, 'mensagem',
        case b.motivo when 'ferias' then 'De férias' when 'folga' then 'De folga' else 'Indisponível' end || ' de ' || to_char(b.de, 'DD/MM') || ' a ' || to_char(b.ate, 'DD/MM'));
    end loop;
    disp := coalesce(d.disponibilidade, '{}');
    if jsonb_typeof(disp -> 'dias') = 'array' and not (disp -> 'dias') @> to_jsonb(extract(dow from p_data)::int) then
      r := r || jsonb_build_object('tipo', 'dia', 'impede', false, 'mensagem', 'Não costuma trabalhar neste dia da semana');
    end if;
    if jsonb_typeof(disp -> 'turnos') = 'array' and not privado.cabe_no_turno(disp -> 'turnos', p_inicio, p_minutos) then
      r := r || jsonb_build_object('tipo', 'turno', 'impede', false, 'mensagem', 'Horário fora do turno que ela atende');
    end if;
    if jsonb_typeof(disp -> 'regioes') = 'array' and p_cidade is not null and not privado.cobre_regiao(disp -> 'regioes', p_cidade) then
      r := r || jsonb_build_object('tipo', 'regiao', 'impede', false, 'mensagem', 'Não atende ' || p_cidade);
    end if;
  end if;
  return r;
end $$;

create or replace function privado.cidade_do_atendimento(a public.atendimentos) returns text
language sql stable set search_path = '' as $$
  select coalesce(p.endereco, c.endereco) ->> 'cidade' from public.pedidos p join public.clientes c on c.id = p.cliente_id where p.id = a.pedido_id
$$;

-- ---------------------------------------------------------------- atribuir (redefinida a partir de 20260930100000)
create or replace function public.atribuir_diarista(p_id uuid, p_dados jsonb, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; a public.atendimentos; d public.diaristas; did uuid; confl jsonb; avisos jsonb;
        forcar boolean := coalesce((p_dados ->> 'atribuirMesmoAssim')::boolean, false);
        conteudo jsonb := jsonb_build_object('id', p_id, 'diaristaId', p_dados -> 'diaristaId', 'mesmoAssim', forcar);
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
  confl := privado.conflitos_diaria(did, a.id, a.data, a.hora_inicio, a.duracao_minutos, privado.cidade_do_atendimento(a));
  if exists (select 1 from jsonb_array_elements(confl) c where (c ->> 'impede')::boolean) then
    perform privado.erro('CONDICAO_NAO_ATENDIDA', split_part(d.nome, ' ', 1) || ' não pode em ' || to_char(a.data, 'DD/MM') || ': '
      || (select string_agg(lower(c ->> 'mensagem'), '; ') from jsonb_array_elements(confl) c where (c ->> 'impede')::boolean), jsonb_build_object('conflitos', confl));
  end if;
  avisos := (select coalesce(jsonb_agg(c), '[]') from jsonb_array_elements(confl) c where not (c ->> 'impede')::boolean);
  if jsonb_array_length(avisos) > 0 and not forcar then
    perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Fora da disponibilidade de ' || split_part(d.nome, ' ', 1) || ': '
      || (select string_agg(lower(c ->> 'mensagem'), '; ') from jsonb_array_elements(avisos) c) || '. Confirme pra atribuir mesmo assim.', jsonb_build_object('avisos', avisos));
  end if;
  update public.atendimentos set diarista_id = did, versao = versao + 1 where id = a.id returning * into a;
  perform privado.evento('atendimento_atribuido', jsonb_build_object('pedidoId', a.pedido_id, 'atendimentoId', a.id, 'diaristaId', did), jsonb_build_object('anterior', null, 'versao', a.versao));
  r := jsonb_build_object('atendimento', privado.j_atendimento(a), 'avisos', avisos);
  perform privado.idem_gravar('atribuirDiarista', s, p_chave, conteudo, r);
  return r;
end $$;

-- ---------------------------------------------------------------- reagendar respeita bloqueio (redefinida a partir de 20260930100000)
create or replace function privado.aplicar_transicao(p_id uuid, p_evento text, s jsonb, p_dados jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare a public.atendimentos; alvo public.atendimentos; novo public.atendimentos; p public.pedidos; probs jsonb; cfg jsonb; tipo text; d public.diaristas; ocupada public.atendimentos; nova date; confl jsonb;
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
      -- P2: férias e folga impedem (os avisos de disponibilidade ficam pra tela, antes de confirmar)
      confl := privado.conflitos_diaria(a.diarista_id, a.id, alvo.data, alvo.hora_inicio, a.duracao_minutos, null);
      if exists (select 1 from jsonb_array_elements(confl) c where c ->> 'tipo' = 'bloqueio') then
        perform privado.erro('CONDICAO_NAO_ATENDIDA', split_part(coalesce(d.nome, 'A profissional'), ' ', 1) || ' não pode em ' || to_char(nova, 'DD/MM') || ': '
          || (select string_agg(lower(c ->> 'mensagem'), '; ') from jsonb_array_elements(confl) c where c ->> 'tipo' = 'bloqueio'), jsonb_build_object('conflitos', confl));
      end if;
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

-- ---------------------------------------------------------------- RPCs do painel
/** Disponibilidade da profissional (dias 0-6, turnos, regiões): a Prime edita no painel. */
create or replace function public.definir_disponibilidade(p_diarista uuid, p_disp jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); d public.diaristas; regioes jsonb := (select c.valor from public.configuracao c where c.chave = 'regioes_diarista');
begin
  perform privado.exigir_prime(s);
  perform set_config('app.ator', 'prime', true);
  if jsonb_typeof(p_disp) <> 'object' or jsonb_typeof(p_disp -> 'dias') <> 'array' or jsonb_typeof(p_disp -> 'turnos') <> 'array' or jsonb_typeof(p_disp -> 'regioes') <> 'array'
     or jsonb_array_length(p_disp -> 'dias') = 0 or jsonb_array_length(p_disp -> 'turnos') = 0 or jsonb_array_length(p_disp -> 'regioes') = 0
     or exists (select 1 from jsonb_array_elements(p_disp -> 'dias') x where jsonb_typeof(x) <> 'number' or (x #>> '{}') !~ '^[0-6]$')
     or exists (select 1 from jsonb_array_elements_text(p_disp -> 'turnos') x where x not in ('manha', 'tarde', 'integral'))
     or exists (select 1 from jsonb_array_elements_text(p_disp -> 'regioes') x where regioes is not null and not regioes ? x) then
    perform privado.erro('DADOS_INVALIDOS', 'Marque pelo menos um dia, um turno e uma região válidos');
  end if;
  update public.diaristas set disponibilidade = jsonb_build_object('dias', p_disp -> 'dias', 'turnos', p_disp -> 'turnos', 'regioes', p_disp -> 'regioes')
   where id = p_diarista returning * into d;
  if not found then perform privado.erro('NAO_ENCONTRADO', 'Profissional não encontrada'); end if;
  return jsonb_build_object('id', d.id, 'disponibilidade', d.disponibilidade);
end $$;

create or replace function public.criar_bloqueio(p_diarista uuid, p_dados jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); b public.bloqueios_profissional; de date; ate date; afetadas int;
begin
  perform privado.exigir_prime(s);
  perform set_config('app.ator', 'prime', true);
  begin de := (p_dados ->> 'de')::date; ate := (p_dados ->> 'ate')::date; exception when others then perform privado.erro('DADOS_INVALIDOS', 'Datas inválidas'); end;
  if de is null or ate is null or ate < de or ate - de > 366 then perform privado.erro('DADOS_INVALIDOS', 'Período inválido (até 1 ano)'); end if;
  if coalesce(p_dados ->> 'motivo', '') not in ('ferias', 'folga', 'outro') then perform privado.erro('DADOS_INVALIDOS', 'Motivo: férias, folga ou outro'); end if;
  if not exists (select 1 from public.diaristas where id = p_diarista) then perform privado.erro('NAO_ENCONTRADO', 'Profissional não encontrada'); end if;
  insert into public.bloqueios_profissional (diarista_id, de, ate, motivo, observacao, criado_por)
  values (p_diarista, de, ate, p_dados ->> 'motivo', nullif(left(trim(coalesce(p_dados ->> 'observacao', '')), 200), ''), auth.uid()) returning * into b;
  -- diárias dela que caem no período: a Prime precisa trocar a profissional (a tela lista)
  select count(*) into afetadas from public.atendimentos where diarista_id = p_diarista and status in ('agendado', 'confirmado') and data between de and ate;
  return jsonb_build_object('id', b.id, 'diariasNoPeriodo', afetadas);
end $$;

create or replace function public.remover_bloqueio(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator();
begin
  perform privado.exigir_prime(s);
  perform set_config('app.ator', 'prime', true);
  delete from public.bloqueios_profissional where id = p_id;
  if not found then perform privado.erro('NAO_ENCONTRADO', 'Bloqueio não encontrado'); end if;
  return jsonb_build_object('removido', true);
end $$;

/** Conflitos de uma mudança antes de confirmar (arrastar na agenda, trocar profissional): a tela mostra e pede confirmação. */
create or replace function public.conflitos_atendimento(p_id uuid, p_dados jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator(); a public.atendimentos; did uuid; nova date; hora time;
begin
  perform privado.exigir_prime(s);
  select * into a from public.atendimentos where id = p_id;
  if not found then perform privado.erro('NAO_ENCONTRADO', 'Atendimento não encontrado'); end if;
  begin
    did := coalesce(nullif(p_dados ->> 'diaristaId', '')::uuid, a.diarista_id);
    nova := coalesce(nullif(p_dados ->> 'data', '')::date, a.data);
    hora := coalesce(nullif(p_dados ->> 'horaInicio', '')::time, a.hora_inicio);
  exception when others then perform privado.erro('DADOS_INVALIDOS', 'Dados inválidos'); end;
  if did is null then return '[]'::jsonb; end if;
  return privado.conflitos_diaria(did, a.id, nova, hora, a.duracao_minutos, privado.cidade_do_atendimento(a));
end $$;

/**
 * Sugestão de profissionais pra uma diária (a Prime escolhe): aprovadas, sem sobreposição nem bloqueio primeiro; depois
 * as que atendem a região, as que estão no dia e turno, e a menor carga da semana (seg a dom da data).
 */
create or replace function public.sugerir_profissionais(p_atendimento uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator(); a public.atendimentos; cidade text; ini date; fim date;
begin
  perform privado.exigir_prime(s);
  select * into a from public.atendimentos where id = p_atendimento;
  if not found then perform privado.erro('NAO_ENCONTRADO', 'Atendimento não encontrado'); end if;
  cidade := privado.cidade_do_atendimento(a);
  ini := a.data - ((extract(isodow from a.data)::int) - 1); fim := ini + 6;
  return (select coalesce(jsonb_agg(x order by (x ->> 'livre')::boolean desc, (x ->> 'regiao')::boolean desc, (x ->> 'disponivel')::boolean desc, (x ->> 'cargaSemana')::int, x ->> 'nome'), '[]')
    from (select jsonb_build_object('id', d.id, 'nome', d.nome, 'atual', d.id = a.diarista_id,
            'livre', not exists (select 1 from jsonb_array_elements(c.confl) e where (e ->> 'impede')::boolean),
            'regiao', not exists (select 1 from jsonb_array_elements(c.confl) e where e ->> 'tipo' = 'regiao'),
            'disponivel', not exists (select 1 from jsonb_array_elements(c.confl) e where e ->> 'tipo' in ('dia', 'turno')),
            'cargaSemana', (select count(*) from public.atendimentos w where w.diarista_id = d.id and w.status <> 'cancelado' and w.data between ini and fim and w.id <> a.id),
            'conflitos', c.confl) x
          from public.diaristas d
          cross join lateral (select privado.conflitos_diaria(d.id, a.id, a.data, a.hora_inicio, a.duracao_minutos, cidade) confl) c
          where d.status = 'aprovada') t);
end $$;

/**
 * Agenda por profissional no período (semana ou dia): diárias com horário, cliente (primeiro nome e bairro), situação,
 * e os bloqueios. Diárias sem profissional vêm em "semProfissional". Máximo de 31 dias por consulta.
 */
create or replace function public.agenda_profissionais(p_de date, p_ate date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator();
begin
  perform privado.exigir_prime(s);
  if p_de is null or p_ate is null or p_ate < p_de or p_ate - p_de > 31 then perform privado.erro('DADOS_INVALIDOS', 'Período de até 31 dias'); end if;
  return jsonb_build_object(
    'profissionais', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'nome', d.nome, 'disponibilidade', d.disponibilidade,
        'bloqueios', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'de', b.de, 'ate', b.ate, 'motivo', b.motivo, 'observacao', b.observacao) order by b.de), '[]')
                        from public.bloqueios_profissional b where b.diarista_id = d.id and b.ate >= p_de and b.de <= p_ate)) order by d.nome), '[]')
      from public.diaristas d where d.status = 'aprovada'),
    'diarias', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'pedidoId', a.pedido_id, 'data', a.data, 'horaInicio', to_char(a.hora_inicio, 'HH24:MI'),
        'duracaoMinutos', a.duracao_minutos, 'status', a.status, 'diaristaId', a.diarista_id, 'pedidoStatus', p.status,
        'cliente', split_part(c.nome, ' ', 1), 'bairro', coalesce(p.endereco, c.endereco) ->> 'bairro', 'cidade', coalesce(p.endereco, c.endereco) ->> 'cidade',
        'servico', p.pacote ->> 'tipoServico') order by a.data, a.hora_inicio), '[]')
      from public.atendimentos a join public.pedidos p on p.id = a.pedido_id join public.clientes c on c.id = p.cliente_id
      where a.data between p_de and p_ate and a.status <> 'cancelado'));
end $$;

revoke execute on function public.definir_disponibilidade(uuid, jsonb), public.criar_bloqueio(uuid, jsonb), public.remover_bloqueio(uuid),
  public.conflitos_atendimento(uuid, jsonb), public.sugerir_profissionais(uuid), public.agenda_profissionais(date, date) from public, anon;
grant execute on function public.definir_disponibilidade(uuid, jsonb), public.criar_bloqueio(uuid, jsonb), public.remover_bloqueio(uuid),
  public.conflitos_atendimento(uuid, jsonb), public.sugerir_profissionais(uuid), public.agenda_profissionais(date, date) to authenticated;
