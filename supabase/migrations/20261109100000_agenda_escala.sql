-- Agenda e Escala (spec-agenda-escala-isa, 09/11/2026; contrato em docs/AGENDA-ESCALA.md; regras puras em src/domain/escala.js).
-- A escala vira uma dimensão da diária, separada do atendimento.status (pagamento e execução): para_revisar -> revisada ->
-- aguardando_envio -> enviada -> aguardando_aceite -> confirmada (aceite da profissional). Pagamento pendente não bloqueia
-- nada da escala (seção 7). Nada aqui troca a profissional sozinho: a fixa com conflito vira alerta, a recusa e a remoção
-- deixam a diária sem profissional pra equipe decidir, e a rotina de preparação não repõe quem a equipe tirou.
-- Também: vínculo de profissional fixa por dia da semana no pacote (com histórico), stand-by como reserva (sem cliente
-- fictício), parceria do cliente (coroa), configuração da agenda (os pontos em aberto da cliente nascem desligados), as
-- pendências novas no "Precisa de você", a rotina diária de preparação e as mensagens C20, D10 e D11.

-- ---------------------------------------------------------------- colunas da escala na diária
alter table public.atendimentos
  add column escala_estado text not null default 'para_revisar'
    check (escala_estado in ('para_revisar', 'revisada', 'aguardando_envio', 'enviada', 'aguardando_aceite', 'confirmada')),
  add column escala_versao int not null default 0 check (escala_versao >= 0),
  add column designacao_origem text check (designacao_origem in ('fixa', 'sugerida', 'manual')),
  add column escala_envio jsonb check (escala_envio is null or jsonb_typeof(escala_envio) = 'object'),
  add column escala_recusa jsonb check (escala_recusa is null or jsonb_typeof(escala_recusa) = 'object'),
  add column escala_sugestao jsonb check (escala_sugestao is null or jsonb_typeof(escala_sugestao) = 'object'),
  add column escala_sem_auto boolean not null default false;
alter table public.atendimentos add constraint atendimentos_origem_com_profissional check (designacao_origem is null or diarista_id is not null);
alter table public.atendimentos add constraint atendimentos_escala_com_profissional check (escala_estado = 'para_revisar' or diarista_id is not null);
create index atendimentos_escala on public.atendimentos (data, escala_estado) where status <> 'cancelado';

-- Registros de antes: quem já tinha profissional numa diária paga recebeu a diária pelo fluxo antigo (D04) e não tinha
-- aceite; fica "confirmada" (sem alerta falso de sem resposta). Diária sem pagamento ainda não foi comunicada: para revisar.
update public.atendimentos set designacao_origem = 'manual' where diarista_id is not null;
update public.atendimentos set escala_estado = 'confirmada', escala_envio = jsonb_build_object('canal', 'whatsapp', 'origem', 'fluxo_anterior')
 where diarista_id is not null and status in ('confirmado', 'diarista_a_caminho', 'em_andamento', 'finalizado', 'avaliado');

alter table public.clientes add column parceria boolean not null default false;

-- ---------------------------------------------------------------- vínculo de profissional fixa (pacote)
create table public.vinculos_fixos (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos (id),
  dia_semana int not null check (dia_semana between 0 and 6),
  diarista_id uuid not null references public.diaristas (id),
  vigente_desde timestamptz not null default now(),
  encerrado_em timestamptz,
  criado_por uuid,
  encerrado_por uuid,
  motivo text check (motivo is null or char_length(motivo) <= 280)
);
create unique index vinculos_fixos_um_vigente on public.vinculos_fixos (pedido_id, dia_semana) where encerrado_em is null;
create index vinculos_fixos_diarista on public.vinculos_fixos (diarista_id) where encerrado_em is null;

-- ---------------------------------------------------------------- stand-by como reserva (a tabela do Início, estendida)
alter table public.standby_decisoes drop constraint standby_decisoes_estado_check;
alter table public.standby_decisoes add constraint standby_decisoes_estado_check check (estado in ('reservada', 'confirmada', 'utilizada', 'liberada'));
alter table public.standby_decisoes
  add column hora_inicio time,
  add column duracao_minutos int check (duracao_minutos between 60 and 720),
  add column regiao text check (regiao is null or char_length(regiao) <= 80),
  add column atendimento_id uuid references public.atendimentos (id),
  add column decidir_ate timestamptz,
  add column historico jsonb not null default '[]' check (jsonb_typeof(historico) = 'array');
alter table public.standby_decisoes add constraint standby_reserva_completa check (hora_inicio is null or (duracao_minutos is not null and decidir_ate is not null));
alter table public.standby_decisoes add constraint standby_utilizada_com_diaria check (estado <> 'utilizada' or atendimento_id is not null);

do $$ declare t text; begin
  foreach t in array array['vinculos_fixos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
create trigger auditoria after insert or update or delete on public.vinculos_fixos for each row execute function privado.auditar();
create trigger auditoria after insert or update or delete on public.standby_decisoes for each row execute function privado.auditar();

-- ---------------------------------------------------------------- configuração
alter table public.configuracao drop constraint configuracao_chave_check;
alter table public.configuracao add constraint configuracao_chave_check check (chave in ('pix', 'contato', 'auth', 'documentos', 'regioes_diarista', 'repasse', 'agendamento', 'meta_diarias', 'agenda_escala'));
insert into public.configuracao (chave, valor) values ('agenda_escala', '{}') on conflict (chave) do nothing;
-- a configuração da agenda é interna (histórico do canal tem quem trocou): fora da leitura pública
alter policy leitura_publica on public.configuracao using (chave not in ('repasse', 'meta_diarias', 'agenda_escala'));

/** Configuração com os padrões: o que a cliente ainda não decidiu nasce desligado (prazo sem resposta, verificação de pagamento). */
create or replace function privado.config_agenda() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('prazoSemRespostaMin', null, 'verificacaoPagamento', jsonb_build_object('ligada', false, 'hora', null),
                            'standbyAlertaMin', 60, 'canalAtivo', 'whatsapp', 'historicoCanal', '[]'::jsonb)
         || coalesce((select valor from public.configuracao where chave = 'agenda_escala'), '{}')
$$;
revoke all on function privado.config_agenda() from public;

-- ---------------------------------------------------------------- máquina de estados (banco decide)
/** Par (de, para) permitido. Mesmo estado sempre passa; volta pra para_revisar sempre passa (alteração, recusa). */
create or replace function privado.escala_par_valido(p_de text, p_para text) returns boolean
language sql immutable set search_path = '' as $$
  select p_de = p_para or p_para = 'para_revisar' or (p_de, p_para) in (
    ('para_revisar', 'revisada'), ('revisada', 'aguardando_envio'), ('aguardando_envio', 'enviada'),
    ('aguardando_envio', 'aguardando_aceite'), ('enviada', 'aguardando_aceite'),
    ('aguardando_envio', 'confirmada'), ('enviada', 'confirmada'), ('aguardando_aceite', 'confirmada'))
$$;

/**
 * Antes de gravar a diária: (1) mudança relevante (profissional, data, hora, duração, endereço, serviço) feita por outro
 * caminho (remarcar, atribuir antigo) volta pra para_revisar e sobe a versão; as RPCs da escala já sobem a versão e
 * não passam por aqui; (2) a transição tem que ser válida.
 */
create or replace function privado.escala_antes_gravar() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.escala_versao = old.escala_versao and (
       new.diarista_id is distinct from old.diarista_id or new.data is distinct from old.data or new.hora_inicio is distinct from old.hora_inicio
    or new.duracao_minutos is distinct from old.duracao_minutos or new.endereco is distinct from old.endereco or new.servico is distinct from old.servico) then
    new.escala_estado := 'para_revisar';
    new.escala_versao := old.escala_versao + 1;
    new.escala_envio := null;
    if new.diarista_id is distinct from old.diarista_id then
      new.designacao_origem := case when new.diarista_id is null then null else 'manual' end;
      new.escala_sugestao := null;
      new.escala_recusa := null;
    end if;
    return new;
  end if;
  if new.diarista_id is null then new.designacao_origem := null; end if;
  if not privado.escala_par_valido(old.escala_estado, new.escala_estado) then
    raise exception using errcode = 'P0001', message = 'TRANSICAO_PROIBIDA', detail = 'Escala: ' || old.escala_estado || ' -> ' || new.escala_estado;
  end if;
  return new;
end $$;
create trigger escala_antes_gravar before update on public.atendimentos for each row execute function privado.escala_antes_gravar();

-- ---------------------------------------------------------------- pré-designação (seção 4.2): mesma conta de pontuarCandidata
/** Critérios da seção 4.2 sem dado no sistema (ficam fora da conta e aparecem no "por quê"). */
create or replace function privado.escala_criterios_sem_dado() returns jsonb
language sql immutable set search_path = '' as $$ select '["deslocamento", "imovel", "perfil", "preferencia"]'::jsonb $$;

/** Número como o JS mostra: 4.0 -> "4", 4.8 -> "4,8". */
create or replace function privado.num_br(n numeric) returns text
language sql immutable set search_path = '' as $$
  select replace(case when n = trunc(n) then trunc(n)::text else rtrim(n::text, '0') end, '.', ',')
$$;

/** Média das notas da profissional (1 casa) e da pontualidade. */
create or replace function privado.escala_notas(p_diarista uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('nota', round(avg(v.nota_final)::numeric, 1), 'pontualidade', round(avg((v.notas ->> 'pontualidade')::numeric), 1))
    from public.avaliacoes v join public.atendimentos a on a.id = v.atendimento_id where a.diarista_id = p_diarista
$$;

/**
 * Pontua uma candidata pra uma diária (espelho de src/domain/escala.js, pontuarCandidata; testa-agenda-escala-banco
 * confere). Impeditivos: cadastro, dia, turno, férias/folga, outra diária no mesmo horário. Pesos: região +30,
 * habilidade +25, (nota - 3) * 10, (pontualidade - 3) * 5, histórico com a cliente +5 até 3, ocorrência em 90 dias -10,
 * outra diária no dia -5. Arredonda como o Math.round do JS.
 */
create or replace function privado.pontuar_candidata(a public.atendimentos, d public.diaristas, p_cidade text, p_cliente uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare mot text[] := '{}'; pts int := 0; imp boolean := false; disp jsonb := coalesce(d.disponibilidade, '{}'); n jsonb; outras int; hist int; oc int;
        v_ini time := coalesce(a.hora_inicio, time '08:00'); v_dur int := coalesce(a.duracao_minutos, 240);
begin
  if d.status <> 'aprovada' then return jsonb_build_object('impedida', true, 'pontos', 0, 'motivos', jsonb_build_array('cadastro não aprovado')); end if;
  if not coalesce(jsonb_typeof(disp -> 'dias') = 'array' and (disp -> 'dias') @> to_jsonb(extract(dow from a.data)::int), false) then imp := true; mot := mot || 'não trabalha nesse dia'::text; end if;
  if not coalesce(privado.cabe_no_turno(case when jsonb_typeof(disp -> 'turnos') = 'array' then disp -> 'turnos' else '[]' end, v_ini, v_dur), false) then imp := true; mot := mot || 'horário fora do turno dela'::text; end if;
  if exists (select 1 from public.bloqueios_profissional b where b.diarista_id = d.id and a.data between b.de and b.ate) then imp := true; mot := mot || 'férias ou folga'::text; end if;
  if exists (select 1 from public.atendimentos x where x.diarista_id = d.id and x.id <> a.id and x.status <> 'cancelado' and x.data = a.data
              and x.hora_inicio < v_ini + make_interval(mins => v_dur) and v_ini < x.hora_inicio + make_interval(mins => x.duracao_minutos)) then
    imp := true; mot := mot || 'outra diária no mesmo horário'::text;
  end if;
  if imp then return jsonb_build_object('impedida', true, 'pontos', 0, 'motivos', to_jsonb(mot)); end if;
  mot := mot || 'disponível e sem conflito'::text;
  if privado.cobre_regiao(case when jsonb_typeof(disp -> 'regioes') = 'array' then disp -> 'regioes' else '[]' end, p_cidade) then pts := pts + 30; mot := mot || ('atende ' || p_cidade); end if;
  if a.servico is not null and a.servico = any (d.habilidades) then pts := pts + 25; mot := mot || 'tem a habilidade do serviço'::text; end if;
  n := privado.escala_notas(d.id);
  if (n ->> 'nota') is not null then pts := pts + floor(((n ->> 'nota')::numeric - 3) * 10 + 0.5)::int; mot := mot || ('avaliação ' || privado.num_br((n ->> 'nota')::numeric)); end if;
  if (n ->> 'pontualidade') is not null then pts := pts + floor(((n ->> 'pontualidade')::numeric - 3) * 5 + 0.5)::int; end if;
  select count(*) into hist from public.atendimentos x join public.pedidos p on p.id = x.pedido_id
   where x.diarista_id = d.id and p.cliente_id = p_cliente and x.status in ('finalizado', 'avaliado');
  if hist > 0 then pts := pts + least(hist, 3) * 5; mot := mot || ('já atendeu esta cliente ' || hist || 'x'); end if;
  select count(*) into oc from public.ocorrencias o join public.atendimentos x on x.id = o.atendimento_id where x.diarista_id = d.id and o.criado_em > now() - interval '90 days';
  if oc > 0 then pts := pts - oc * 10; mot := mot || (oc || ' ocorrência(s) em 90 dias'); end if;
  select count(*) into outras from public.atendimentos x where x.diarista_id = d.id and x.id <> a.id and x.status <> 'cancelado' and x.data = a.data;
  if outras > 0 then pts := pts - outras * 5; mot := mot || (outras || ' outra(s) diária(s) no dia'); end if;
  return jsonb_build_object('impedida', false, 'pontos', pts, 'motivos', to_jsonb(mot));
end $$;

/** Candidatas (todas as aprovadas) com a pontuação, livres primeiro, maior pontuação, nome. */
create or replace function privado.escala_candidatas_lista(a public.atendimentos) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by (x ->> 'impedida')::boolean, (x ->> 'pontos')::int desc, x ->> 'nome', x ->> 'id'), '[]')
    from (select jsonb_build_object('id', d.id, 'nome', d.nome, 'nota', privado.escala_notas(d.id) -> 'nota', 'habilidades', to_jsonb(d.habilidades),
                 'regioes', coalesce(d.disponibilidade -> 'regioes', '[]'), 'atribuida', d.id = a.diarista_id) || privado.pontuar_candidata(a, d, privado.p_endereco(a, p, c) ->> 'cidade', p.cliente_id) x
            from public.diaristas d, public.pedidos p join public.clientes c on c.id = p.cliente_id
           where d.status = 'aprovada' and p.id = a.pedido_id) t
$$;

/** Vínculo fixo vigente da diária (pedido + dia da semana). */
create or replace function privado.vinculo_da_diaria(a public.atendimentos) returns public.vinculos_fixos
language sql stable security definer set search_path = '' as $$
  select v.* from public.vinculos_fixos v where v.pedido_id = a.pedido_id and v.dia_semana = extract(dow from a.data)::int and v.encerrado_em is null
$$;

/** Impedimento (sobreposição, férias/folga) de pôr a profissional na diária; null se pode. */
create or replace function privado.escala_impedimento(p_diarista uuid, a public.atendimentos) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select 'Já tem diária das ' || to_char(x.hora_inicio, 'HH24:MI') || ' às ' || to_char(x.hora_inicio + make_interval(mins => x.duracao_minutos), 'HH24:MI')
       from public.atendimentos x where x.diarista_id = p_diarista and x.id <> a.id and x.status <> 'cancelado' and privado.sobrepoe(a, x) limit 1),
    (select case b.motivo when 'ferias' then 'De férias' when 'folga' then 'De folga' else 'Indisponível' end || ' de ' || to_char(b.de, 'DD/MM') || ' a ' || to_char(b.ate, 'DD/MM')
       from public.bloqueios_profissional b where b.diarista_id = p_diarista and a.data between b.de and b.ate limit 1))
$$;

/** Alerta da fixa: a vinculada não pôde entrar (impedida) e a diária ficou sem ela. Nunca troca sozinho. */
create or replace function privado.escala_alerta_fixa(a public.atendimentos) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v public.vinculos_fixos; imp text; nome text;
begin
  v := privado.vinculo_da_diaria(a);
  if v.id is null or a.status not in ('agendado', 'confirmado') then return null; end if;
  if a.diarista_id is not null and a.diarista_id <> v.diarista_id then return null; end if; -- a equipe escolheu outra
  imp := privado.escala_impedimento(v.diarista_id, a);
  if imp is null then return null; end if;
  select d.nome into nome from public.diaristas d where d.id = v.diarista_id;
  return 'Fixa ' || split_part(nome, ' ', 1) || ' indisponível: ' || imp;
end $$;

-- ---------------------------------------------------------------- leitura
create or replace function privado.escala_item(a public.atendimentos) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare p public.pedidos; c public.clientes; d public.diaristas; e jsonb; v public.vinculos_fixos; car jsonb := coalesce(a.caracteristicas, '{}');
begin
  select * into p from public.pedidos where id = a.pedido_id;
  select * into c from public.clientes where id = p.cliente_id;
  if a.diarista_id is not null then select * into d from public.diaristas where id = a.diarista_id; end if;
  e := privado.p_endereco(a, p, c);
  v := privado.vinculo_da_diaria(a);
  return jsonb_build_object('id', a.id, 'pedidoId', p.id, 'numero', p.numero_solicitacao, 'data', a.data, 'horaInicio', to_char(a.hora_inicio, 'HH24:MI'), 'duracaoMinutos', a.duracao_minutos,
    'status', a.status, 'escalaEstado', a.escala_estado, 'escalaVersao', a.escala_versao, 'escalaEnvio', a.escala_envio, 'escalaRecusa', a.escala_recusa, 'escalaSugestao', a.escala_sugestao,
    'designacaoOrigem', a.designacao_origem, 'servico', coalesce(a.servico, p.pacote ->> 'tipoServico'), 'modalidade', p.modalidade, 'pacote', coalesce(p.modalidade = 'pacote', false),
    'cliente', jsonb_build_object('id', c.id, 'nome', c.nome, 'telefone', c.telefone, 'parceria', c.parceria),
    'local', jsonb_build_object('logradouro', e ->> 'logradouro', 'numero', e ->> 'numero', 'complemento', e ->> 'complemento', 'bairro', e ->> 'bairro', 'cidade', e ->> 'cidade', 'uf', e ->> 'uf', 'cep', e ->> 'cep'),
    'imovel', jsonb_build_object('metragem', coalesce((car ->> 'metragem')::numeric, (p.pacote ->> 'metragem')::numeric), 'comodos', privado.p_ambientes(car),
      'caes', coalesce((car #>> '{animais,tem}')::boolean, false) and coalesce((car #>> '{animais,caes}')::int, 0) > 0,
      'gatos', coalesce((car #>> '{animais,tem}')::boolean, false) and coalesce((car #>> '{animais,gatos}')::int, 0) > 0),
    'profissional', case when d.id is not null then jsonb_build_object('id', d.id, 'nome', d.nome, 'telefone', d.telefone, 'nota', privado.escala_notas(d.id) -> 'nota', 'habilidades', to_jsonb(d.habilidades)) end,
    'pagamento', privado.p_pagamento_da_diaria(a),
    'ocorrenciaAberta', exists (select 1 from public.ocorrencias o where o.atendimento_id = a.id and o.estado in ('aberto', 'em_analise')),
    'alertaFixa', privado.escala_alerta_fixa(a),
    'vinculoFixo', case when v.id is not null then jsonb_build_object('id', v.id, 'diaristaId', v.diarista_id, 'nome', (select x.nome from public.diaristas x where x.id = v.diarista_id)) end,
    'observacao', p.observacao_disponibilidade, 'prioridades', car -> 'prioridades', 'historico', a.historico);
end $$;

create or replace function public.agenda_escala(p_de date, p_ate date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator();
begin
  perform privado.exigir_prime(s);
  if p_de is null or p_ate is null or p_ate < p_de or p_ate - p_de > 30 then perform privado.erro('DADOS_INVALIDOS', 'Período de até 31 dias'); end if;
  return jsonb_build_object('de', p_de, 'ate', p_ate, 'agora', privado.agora_iso(), 'config', privado.config_agenda() - 'historicoCanal',
    'itens', coalesce((select jsonb_agg(privado.escala_item(a) order by a.data, a.hora_inicio, a.id)
      from public.atendimentos a join public.pedidos p on p.id = a.pedido_id where a.data between p_de and p_ate and p.status not in ('solicitado', 'recusado')), '[]'),
    'standby', coalesce((select jsonb_agg(jsonb_build_object('diaristaId', d.id, 'nome', d.nome, 'nota', privado.escala_notas(d.id) -> 'nota', 'data', sd.data,
        'horaInicio', to_char(sd.hora_inicio, 'HH24:MI'), 'duracaoMinutos', sd.duracao_minutos, 'regiao', sd.regiao, 'estado', sd.estado, 'decidirAte', sd.decidir_ate, 'atendimentoId', sd.atendimento_id)
        order by sd.data, sd.hora_inicio, d.nome)
      from public.standby_decisoes sd join public.diaristas d on d.id = sd.diarista_id
     where sd.data between p_de and p_ate and sd.hora_inicio is not null and sd.estado in ('reservada', 'confirmada')), '[]'));
end $$;

create or replace function public.agenda_contagens(p_de date, p_ate date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator();
begin
  perform privado.exigir_prime(s);
  if p_de is null or p_ate is null or p_ate < p_de or p_ate - p_de > 61 then perform privado.erro('DADOS_INVALIDOS', 'Período de até 62 dias'); end if;
  return jsonb_build_object('dias', (select jsonb_agg(jsonb_build_object('data', g.d::date, 'total',
      (select count(*) from public.atendimentos a join public.pedidos p on p.id = a.pedido_id where a.data = g.d::date and p.status not in ('solicitado', 'recusado'))) order by g.d)
    from generate_series(p_de, p_ate, interval '1 day') g(d)));
end $$;

create or replace function public.escala_candidatas(p_atendimento uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator(); a public.atendimentos;
begin
  perform privado.exigir_prime(s);
  select * into a from public.atendimentos where id = p_atendimento;
  if not found then perform privado.erro('NAO_ENCONTRADO', 'Diária não encontrada'); end if;
  return jsonb_build_object('atualId', a.diarista_id, 'origem', a.designacao_origem, 'sugestao', a.escala_sugestao, 'criteriosSemDado', privado.escala_criterios_sem_dado(),
    'itens', privado.escala_candidatas_lista(a));
end $$;

-- ---------------------------------------------------------------- escrita: helpers
/** Linha do histórico da diária (o status do atendimento não muda; a escala vai em escalaDe/escalaPara). */
create or replace function privado.escala_hist(a public.atendimentos, p_evento text, p_ator text, p_extra jsonb default '{}') returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(a.historico, '[]') || (jsonb_build_object('de', a.status, 'para', a.status, 'evento', p_evento, 'em', privado.agora_iso(), 'ator', p_ator, 'por', auth.uid()) || coalesce(p_extra, '{}'))
$$;

/** Diária que a escala ainda pode mexer: não cancelada, não começou, não terminou. */
create or replace function privado.escala_editavel(a public.atendimentos) returns void
language plpgsql stable set search_path = '' as $$
begin
  if a.id is null then perform privado.erro('NAO_ENCONTRADO', 'Diária não encontrada'); end if;
  if a.status not in ('agendado', 'confirmado') then perform privado.erro('TRANSICAO_PROIBIDA', 'Esta diária já começou, terminou ou foi cancelada'); end if;
end $$;

/** A profissional já recebeu a diária (envio feito): troca ou remoção precisa avisá-la (D08). */
create or replace function privado.escala_comunicada(a public.atendimentos) returns boolean
language sql immutable set search_path = '' as $$ select a.diarista_id is not null and a.escala_estado in ('aguardando_envio', 'enviada', 'aguardando_aceite', 'confirmada') $$;

/**
 * Põe a profissional na diária (fixa, sugerida ou manual), com a versão nova: volta pra para_revisar. Se a anterior já
 * tinha recebido, evento escala_alterada (D08 avisa a anterior). Não emite atendimento_atribuido: ninguém recebe nada
 * antes do envio.
 */
create or replace function privado.escala_designar(p_id uuid, p_diarista uuid, p_origem text, p_sugestao jsonb, p_ator text) returns public.atendimentos
language plpgsql security definer set search_path = '' as $$
declare a public.atendimentos; n public.atendimentos;
begin
  select * into a from public.atendimentos where id = p_id for update;
  update public.atendimentos set diarista_id = p_diarista, designacao_origem = case when p_diarista is null then null else p_origem end,
      escala_estado = 'para_revisar', escala_versao = escala_versao + 1, escala_envio = null, escala_sugestao = p_sugestao,
      escala_recusa = case when p_diarista is null then escala_recusa end, escala_sem_auto = (p_diarista is null and p_ator = 'prime'),
      historico = privado.escala_hist(a, case when p_diarista is null then 'escala_removida' else 'escala_' || p_origem end, p_ator,
        jsonb_build_object('diaristaId', p_diarista, 'anterior', a.diarista_id))
   where id = p_id returning * into n;
  if privado.escala_comunicada(a) and a.diarista_id is distinct from p_diarista then
    perform privado.evento('escala_alterada', jsonb_build_object('atendimentoId', a.id, 'pedidoId', a.pedido_id, 'diaristaId', p_diarista),
      jsonb_build_object('anterior', a.diarista_id, 'removida', p_diarista is null));
  end if;
  return n;
end $$;

-- ---------------------------------------------------------------- preparação (fixa + sugerida)
create or replace function privado.escala_preparar_interno(p_de date, p_ate date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.atendimentos; v public.vinculos_fixos; melhor jsonb; nf int := 0; ns int := 0; nsem int := 0; ncf int := 0;
begin
  for a in select x.* from public.atendimentos x join public.pedidos p on p.id = x.pedido_id
            where x.data between greatest(p_de, privado.hoje_sp()) and p_ate and x.status in ('agendado', 'confirmado') and x.diarista_id is null
              and not x.escala_sem_auto and p.status in ('aguardando_pagamento', 'confirmado')
            order by x.data, x.hora_inicio, x.id for update of x loop
    v := privado.vinculo_da_diaria(a);
    if v.id is not null then
      if privado.escala_impedimento(v.diarista_id, a) is null then
        perform privado.escala_designar(a.id, v.diarista_id, 'fixa', null, 'sistema'); nf := nf + 1;
      else ncf := ncf + 1; -- fixa impedida: alerta e pendência; nunca põe outra no lugar
      end if;
      continue;
    end if;
    select x into melhor from jsonb_array_elements(privado.escala_candidatas_lista(a)) x where not (x ->> 'impedida')::boolean limit 1;
    if melhor is null then nsem := nsem + 1; continue; end if;
    perform privado.escala_designar(a.id, (melhor ->> 'id')::uuid, 'sugerida',
      jsonb_build_object('pontos', (melhor ->> 'pontos')::int, 'motivos', melhor -> 'motivos', 'criteriosSemDado', privado.escala_criterios_sem_dado()), 'sistema');
    ns := ns + 1;
  end loop;
  return jsonb_build_object('fixas', nf, 'sugeridas', ns, 'semCandidata', nsem, 'conflitosFixa', ncf);
end $$;
revoke all on function privado.escala_preparar_interno(date, date) from public;

create or replace function public.escala_preparar(p_de date, p_ate date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator();
begin
  perform privado.exigir_prime(s);
  if p_de is null or p_ate is null or p_ate < p_de or p_ate - p_de > 30 then perform privado.erro('DADOS_INVALIDOS', 'Período de até 31 dias'); end if;
  return privado.escala_preparar_interno(p_de, p_ate);
end $$;

-- ---------------------------------------------------------------- vínculo fixo
/** Troca o vínculo do dia da semana e aplica nas diárias futuras ainda não comunicadas do pacote (sem impedimento e sem escolha manual). */
create or replace function privado.vinculo_trocar(p_pedido uuid, p_dia int, p_diarista uuid, p_motivo text, p_excluir uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.vinculos_fixos; a public.atendimentos; ap int := 0; cf int := 0;
begin
  update public.vinculos_fixos set encerrado_em = now(), encerrado_por = auth.uid(), motivo = coalesce(p_motivo, motivo)
   where pedido_id = p_pedido and dia_semana = p_dia and encerrado_em is null and diarista_id <> p_diarista;
  select * into v from public.vinculos_fixos where pedido_id = p_pedido and dia_semana = p_dia and encerrado_em is null;
  if v.id is null then
    insert into public.vinculos_fixos (pedido_id, dia_semana, diarista_id, criado_por, motivo) values (p_pedido, p_dia, p_diarista, auth.uid(), p_motivo) returning * into v;
  end if;
  for a in select * from public.atendimentos x where x.pedido_id = p_pedido and extract(dow from x.data)::int = p_dia and x.data >= privado.hoje_sp()
            and x.status in ('agendado', 'confirmado') and x.escala_estado in ('para_revisar', 'revisada') and x.id is distinct from p_excluir
            and (x.diarista_id is null or x.designacao_origem in ('fixa', 'sugerida')) and x.diarista_id is distinct from p_diarista
            order by x.data for update loop
    if privado.escala_impedimento(p_diarista, a) is null then perform privado.escala_designar(a.id, p_diarista, 'fixa', null, 'prime'); ap := ap + 1;
    else cf := cf + 1; end if;
  end loop;
  return jsonb_build_object('vinculo', jsonb_build_object('id', v.id, 'diaSemana', v.dia_semana, 'diaristaId', v.diarista_id), 'aplicadas', ap, 'comConflito', cf);
end $$;
revoke all on function privado.vinculo_trocar(uuid, int, uuid, text, uuid) from public;

create or replace function public.vinculos_fixos_do_pedido(p_pedido uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator();
begin
  perform privado.exigir_prime(s);
  return jsonb_build_object('itens', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'diaSemana', v.dia_semana, 'diaristaId', v.diarista_id, 'nome', d.nome,
      'vigenteDesde', v.vigente_desde, 'encerradoEm', v.encerrado_em, 'criadoPor', privado.p_nome_usuario(v.criado_por), 'encerradoPor', privado.p_nome_usuario(v.encerrado_por), 'motivo', v.motivo)
      order by v.dia_semana, v.encerrado_em desc nulls first, v.vigente_desde desc)
    from public.vinculos_fixos v join public.diaristas d on d.id = v.diarista_id where v.pedido_id = p_pedido), '[]'));
end $$;

create or replace function public.salvar_vinculo_fixo(p_pedido uuid, p_dados jsonb, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; p public.pedidos; v_dia int; v_dia_id uuid;
begin
  perform privado.exigir_admin(s);
  r := privado.idem_ler('salvarVinculoFixo', s, p_chave, jsonb_build_object('pedido', p_pedido, 'dados', p_dados));
  if r is not null then return r; end if;
  v_dia := case when (p_dados ->> 'diaSemana') ~ '^[0-6]$' then (p_dados ->> 'diaSemana')::int end;
  v_dia_id := case when (p_dados ->> 'diaristaId') ~ '^[0-9a-f-]{36}$' then (p_dados ->> 'diaristaId')::uuid end;
  if v_dia is null or v_dia_id is null then perform privado.erro('DADOS_INVALIDOS', 'Informe o dia da semana e a profissional'); end if;
  select * into p from public.pedidos where id = p_pedido for update;
  if not found then perform privado.erro('NAO_ENCONTRADO', 'Pacote não encontrado'); end if;
  if coalesce(p.modalidade, '') <> 'pacote' or p.status in ('cancelado', 'recusado', 'concluido') then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Profissional fixa só em pacote ativo'); end if;
  if not exists (select 1 from public.diaristas where id = v_dia_id and status = 'aprovada') then perform privado.erro('NAO_ENCONTRADO', 'Profissional não encontrada'); end if;
  r := privado.vinculo_trocar(p_pedido, v_dia, v_dia_id, left(nullif(trim(coalesce(p_dados ->> 'motivo', '')), ''), 280), null);
  perform privado.idem_gravar('salvarVinculoFixo', s, p_chave, jsonb_build_object('pedido', p_pedido, 'dados', p_dados), r);
  return r;
end $$;

create or replace function public.encerrar_vinculo_fixo(p_id uuid, p_motivo text, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; v public.vinculos_fixos;
begin
  perform privado.exigir_admin(s);
  r := privado.idem_ler('encerrarVinculoFixo', s, p_chave, jsonb_build_object('id', p_id, 'motivo', p_motivo));
  if r is not null then return r; end if;
  update public.vinculos_fixos set encerrado_em = now(), encerrado_por = auth.uid(), motivo = left(nullif(trim(coalesce(p_motivo, '')), ''), 280)
   where id = p_id and encerrado_em is null returning * into v;
  if v.id is null then perform privado.erro('NAO_ENCONTRADO', 'Vínculo vigente não encontrado'); end if;
  r := jsonb_build_object('id', v.id, 'encerradoEm', v.encerrado_em);
  perform privado.idem_gravar('encerrarVinculoFixo', s, p_chave, jsonb_build_object('id', p_id, 'motivo', p_motivo), r);
  return r;
end $$;

-- ---------------------------------------------------------------- alterar, remover, revisar, enviar, responder
create or replace function public.escala_alterar(p_id uuid, p_dados jsonb, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; a public.atendimentos; p public.pedidos; v_dia uuid; v_escopo text := coalesce(p_dados ->> 'escopo', 'so_esta'); imp text; n public.atendimentos;
begin
  perform privado.exigir_prime(s);
  r := privado.idem_ler('escalaAlterar', s, p_chave, jsonb_build_object('id', p_id, 'dados', p_dados));
  if r is not null then return r; end if;
  v_dia := case when (p_dados ->> 'diaristaId') ~ '^[0-9a-f-]{36}$' then (p_dados ->> 'diaristaId')::uuid end;
  if v_dia is null or v_escopo not in ('so_esta', 'vinculo_futuro') then perform privado.erro('DADOS_INVALIDOS', 'Escolha a profissional'); end if;
  select * into a from public.atendimentos where id = p_id for update;
  perform privado.escala_editavel(a);
  if not exists (select 1 from public.diaristas where id = v_dia and status = 'aprovada') then perform privado.erro('NAO_ENCONTRADO', 'Profissional não encontrada'); end if;
  imp := privado.escala_impedimento(v_dia, a);
  if imp is not null then perform privado.erro('CONDICAO_NAO_ATENDIDA', imp); end if;
  if v_escopo = 'vinculo_futuro' then
    perform privado.exigir_admin(s);
    select * into p from public.pedidos where id = a.pedido_id;
    if coalesce(p.modalidade, '') <> 'pacote' then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Vínculo fixo só em diária de pacote'); end if;
    perform privado.vinculo_trocar(a.pedido_id, extract(dow from a.data)::int, v_dia, 'Alterado na Agenda e Escala', a.id);
  end if;
  if a.diarista_id is distinct from v_dia or (v_escopo = 'vinculo_futuro' and a.designacao_origem is distinct from 'fixa') then
    n := privado.escala_designar(a.id, v_dia, case when v_escopo = 'vinculo_futuro' then 'fixa' else 'manual' end, null, 'prime');
    update public.atendimentos set escala_sem_auto = false where id = a.id returning * into n;
  else n := a;
  end if;
  r := jsonb_build_object('id', n.id, 'diaristaId', n.diarista_id, 'escalaEstado', n.escala_estado, 'escalaVersao', n.escala_versao, 'designacaoOrigem', n.designacao_origem);
  perform privado.idem_gravar('escalaAlterar', s, p_chave, jsonb_build_object('id', p_id, 'dados', p_dados), r);
  return r;
end $$;

create or replace function public.escala_remover(p_id uuid, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; a public.atendimentos; n public.atendimentos;
begin
  perform privado.exigir_prime(s);
  r := privado.idem_ler('escalaRemover', s, p_chave, jsonb_build_object('id', p_id));
  if r is not null then return r; end if;
  select * into a from public.atendimentos where id = p_id for update;
  perform privado.escala_editavel(a);
  if a.diarista_id is null then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'A diária já está sem profissional'); end if;
  n := privado.escala_designar(a.id, null, null, null, 'prime');
  r := jsonb_build_object('id', n.id, 'escalaEstado', n.escala_estado, 'escalaVersao', n.escala_versao, 'avisada', privado.escala_comunicada(a));
  perform privado.idem_gravar('escalaRemover', s, p_chave, jsonb_build_object('id', p_id), r);
  return r;
end $$;

create or replace function public.escala_revisar(p_id uuid, p_versao int, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; a public.atendimentos;
begin
  perform privado.exigir_prime(s);
  r := privado.idem_ler('escalaRevisar', s, p_chave, jsonb_build_object('id', p_id, 'versao', p_versao));
  if r is not null then return r; end if;
  select * into a from public.atendimentos where id = p_id for update;
  perform privado.escala_editavel(a);
  if p_versao is null or p_versao <> a.escala_versao then perform privado.erro('DESATUALIZADA', 'A diária mudou desde que você abriu. Confira de novo antes de revisar.'); end if;
  if a.diarista_id is null then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Selecione a profissional antes de revisar'); end if;
  if a.escala_estado <> 'para_revisar' then perform privado.erro('TRANSICAO_PROIBIDA', 'Esta diária já foi revisada'); end if;
  update public.atendimentos set escala_estado = 'revisada', historico = privado.escala_hist(a, 'escala_revisada', 'prime', jsonb_build_object('versao', a.escala_versao))
   where id = p_id returning * into a;
  r := jsonb_build_object('id', a.id, 'escalaEstado', a.escala_estado, 'escalaVersao', a.escala_versao);
  perform privado.idem_gravar('escalaRevisar', s, p_chave, jsonb_build_object('id', p_id, 'versao', p_versao), r);
  return r;
end $$;

/**
 * Envia as revisadas (individual, selecionadas ou todas): uma mensagem por diária, versão e profissional (D10). Nunca
 * reenvia o que já saiu; reenvio só depois de falha (reabre a mesma execução). Não olha o pagamento (seção 7).
 */
create or replace function public.escala_enviar(p_ids uuid[], p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; a public.atendimentos; v_id uuid; env jsonb := '[]'; ign jsonb := '[]'; canal text := privado.config_agenda() ->> 'canalAtivo'; reab int;
begin
  perform privado.exigir_prime(s);
  if p_ids is null or cardinality(p_ids) = 0 or cardinality(p_ids) > 300 then perform privado.erro('DADOS_INVALIDOS', 'Escolha de 1 a 300 diárias'); end if;
  r := privado.idem_ler('escalaEnviar', s, p_chave, to_jsonb((select array_agg(distinct x order by x) from unnest(p_ids) x)));
  if r is not null then return r; end if;
  for v_id in select distinct x from unnest(p_ids) x order by 1 loop
    select * into a from public.atendimentos where id = v_id for update;
    if a.id is null then ign := ign || jsonb_build_object('id', v_id, 'motivo', 'não encontrada'); continue; end if;
    if a.status not in ('agendado', 'confirmado') then ign := ign || jsonb_build_object('id', v_id, 'motivo', 'diária encerrada ou cancelada'); continue; end if;
    if a.diarista_id is null then ign := ign || jsonb_build_object('id', v_id, 'motivo', 'sem profissional'); continue; end if;
    if a.escala_estado = 'para_revisar' then ign := ign || jsonb_build_object('id', v_id, 'motivo', 'falta revisar'); continue; end if;
    if a.escala_estado = 'aguardando_envio' and coalesce((a.escala_envio ->> 'falhou')::boolean, false) then
      -- reenvio depois de falha: a mesma execução volta pra fila (a chave do motor é por versão)
      update public.automacao_execucoes set estado = 'agendada', tentativas = 0, canal_idx = 0, proxima_tentativa = null, agendada_para = now(),
          valida_ate = greatest(valida_ate, now() + interval '24 hours'), motivo = null, atualizado_em = now()
       where regra = 'D10' and estado = 'falhou' and contexto ->> 'atendimentoId' = a.id::text and (contexto #>> '{dados,versao}')::int = a.escala_versao;
      get diagnostics reab = row_count;
      if reab = 0 then perform privado.evento('diaria_enviada', jsonb_build_object('atendimentoId', a.id, 'pedidoId', a.pedido_id, 'diaristaId', a.diarista_id), jsonb_build_object('versao', a.escala_versao)); end if;
      update public.atendimentos set escala_envio = escala_envio || jsonb_build_object('falhou', false, 'reenviadaEm', privado.agora_iso()),
          historico = privado.escala_hist(a, 'escala_reenviada', 'prime', jsonb_build_object('versao', a.escala_versao)) where id = a.id;
      env := env || to_jsonb(a.id); continue;
    end if;
    if a.escala_estado <> 'revisada' then ign := ign || jsonb_build_object('id', v_id, 'motivo', 'já enviada'); continue; end if;
    update public.atendimentos set escala_estado = 'aguardando_envio',
        escala_envio = jsonb_build_object('enviadaEm', privado.agora_iso(), 'canal', canal, 'versao', a.escala_versao, 'chave', a.id || ':' || a.escala_versao || ':' || a.diarista_id, 'falhou', false, 'por', auth.uid()),
        historico = privado.escala_hist(a, 'escala_enviada', 'prime', jsonb_build_object('versao', a.escala_versao, 'canal', canal))
     where id = a.id;
    perform privado.evento('diaria_enviada', jsonb_build_object('atendimentoId', a.id, 'pedidoId', a.pedido_id, 'diaristaId', a.diarista_id), jsonb_build_object('versao', a.escala_versao));
    env := env || to_jsonb(a.id);
  end loop;
  r := jsonb_build_object('enviadas', env, 'ignoradas', ign);
  perform privado.idem_gravar('escalaEnviar', s, p_chave, to_jsonb((select array_agg(distinct x order by x) from unnest(p_ids) x)), r);
  return r;
end $$;

/**
 * Aceite ou recusa (webhook ou registro da equipe). Versão diferente da atual = resposta de uma designação antiga:
 * ignorada. Recusa deixa a diária sem profissional pra equipe (pendência), sem pôr outra no lugar.
 */
create or replace function privado.escala_aplicar_resposta(p_id uuid, p_resposta text, p_versao int, p_canal text, p_motivo text, p_ator text) returns text
language plpgsql security definer set search_path = '' as $$
declare a public.atendimentos; d public.diaristas; agora text := privado.agora_iso();
begin
  select * into a from public.atendimentos where id = p_id for update;
  if a.id is null then return 'nao_encontrada'; end if;
  if p_versao is distinct from a.escala_versao then return 'desatualizada'; end if;
  if a.diarista_id is null or a.status not in ('agendado', 'confirmado') then return 'encerrada'; end if;
  if a.escala_estado not in ('aguardando_envio', 'enviada', 'aguardando_aceite', 'confirmada') then return 'nao_enviada'; end if;
  if p_resposta = 'aceite' then
    if a.escala_estado = 'confirmada' then return 'repetida'; end if;
    update public.atendimentos set escala_estado = 'confirmada',
        escala_envio = coalesce(escala_envio, '{}') || jsonb_build_object('respondidaEm', agora, 'resposta', 'aceite', 'canalResposta', p_canal),
        historico = privado.escala_hist(a, 'escala_aceita', p_ator, jsonb_build_object('versao', a.escala_versao, 'canal', p_canal))
     where id = p_id;
    -- aceite: com a diária paga, a profissional recebe o endereço completo (D04, uma vez por profissional)
    perform privado.evento('escala_aceita', jsonb_build_object('atendimentoId', a.id, 'pedidoId', a.pedido_id, 'diaristaId', a.diarista_id), jsonb_build_object('versao', a.escala_versao));
    return 'aceite';
  end if;
  select * into d from public.diaristas where id = a.diarista_id;
  update public.atendimentos set diarista_id = null, designacao_origem = null, escala_estado = 'para_revisar', escala_versao = escala_versao + 1, escala_envio = null,
      escala_sugestao = null, escala_sem_auto = true,
      escala_recusa = jsonb_build_object('diaristaId', d.id, 'nome', d.nome, 'em', agora, 'canal', p_canal, 'motivo', left(nullif(trim(coalesce(p_motivo, '')), ''), 280)),
      historico = privado.escala_hist(a, 'escala_recusada', p_ator, jsonb_build_object('versao', a.escala_versao, 'canal', p_canal, 'diaristaId', d.id))
   where id = p_id;
  return 'recusa';
end $$;
revoke all on function privado.escala_aplicar_resposta(uuid, text, int, text, text, text) from public;

create or replace function public.escala_responder(p_id uuid, p_dados jsonb, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; v_resp text := p_dados ->> 'resposta'; v_versao int; res text;
begin
  perform privado.exigir_prime(s);
  if v_resp not in ('aceite', 'recusa') or coalesce(p_dados ->> 'versao', '') !~ '^\d{1,9}$' then perform privado.erro('DADOS_INVALIDOS', 'Informe a resposta e a versão'); end if;
  v_versao := (p_dados ->> 'versao')::int;
  r := privado.idem_ler('escalaResponder', s, p_chave, jsonb_build_object('id', p_id, 'dados', p_dados));
  if r is not null then return r; end if;
  res := privado.escala_aplicar_resposta(p_id, v_resp, v_versao, 'telefone', p_dados ->> 'motivo', 'prime');
  if res = 'nao_encontrada' then perform privado.erro('NAO_ENCONTRADO', 'Diária não encontrada'); end if;
  if res = 'desatualizada' then perform privado.erro('DESATUALIZADA', 'A diária mudou desde que você abriu. Confira de novo.'); end if;
  if res in ('encerrada', 'nao_enviada') then perform privado.erro('TRANSICAO_PROIBIDA', 'Esta diária não está aguardando resposta'); end if;
  r := jsonb_build_object('id', p_id, 'resultado', res);
  perform privado.idem_gravar('escalaResponder', s, p_chave, jsonb_build_object('id', p_id, 'dados', p_dados), r);
  return r;
end $$;

create or replace function public.escala_solicitar_confirmacao(p_id uuid, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; a public.atendimentos;
begin
  perform privado.exigir_prime(s);
  r := privado.idem_ler('escalaSolicitarConfirmacao', s, p_chave, jsonb_build_object('id', p_id));
  if r is not null then return r; end if;
  select * into a from public.atendimentos where id = p_id for update;
  perform privado.escala_editavel(a);
  if a.diarista_id is null or a.escala_estado not in ('aguardando_envio', 'enviada', 'aguardando_aceite') then perform privado.erro('TRANSICAO_PROIBIDA', 'Esta diária não está aguardando aceite'); end if;
  perform privado.evento('confirmacao_solicitada', jsonb_build_object('atendimentoId', a.id, 'pedidoId', a.pedido_id, 'diaristaId', a.diarista_id), jsonb_build_object('versao', a.escala_versao));
  update public.atendimentos set escala_envio = coalesce(escala_envio, '{}') || jsonb_build_object('confirmacaoSolicitadaEm', privado.agora_iso()),
      historico = privado.escala_hist(a, 'escala_confirmacao_solicitada', 'prime', '{}') where id = p_id;
  r := jsonb_build_object('id', a.id, 'solicitada', true);
  perform privado.idem_gravar('escalaSolicitarConfirmacao', s, p_chave, jsonb_build_object('id', p_id), r);
  return r;
end $$;

/**
 * Botão do WhatsApp: payload escala:<aceite|recusa>:<atendimento>:<versao>. Só o papel de serviço (a function do webhook).
 * Idempotente pelo id da mensagem; o remetente tem que ser a profissional designada (o uuid sozinho não autoriza).
 */
create or replace function public.webhook_resposta_escala(p_id_externo text, p_telefone text, p_payload text, p_em timestamptz) returns text
language plpgsql security definer set search_path = '' as $$
declare tel text := right(regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g'), 11); m text[]; a public.atendimentos; dtel text; res text;
begin
  insert into public.mensagens_recebidas (id_externo, telefone, texto, tipo, recebida_em) values (p_id_externo, tel, left(p_payload, 200), 'escala', p_em) on conflict do nothing;
  if not found then return 'repetida'; end if;
  insert into public.whatsapp_janelas (telefone, ultima_entrada_em) values (tel, p_em)
  on conflict (telefone) do update set ultima_entrada_em = greatest(public.whatsapp_janelas.ultima_entrada_em, excluded.ultima_entrada_em);
  m := regexp_match(coalesce(p_payload, ''), '^escala:(aceite|recusa):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(\d{1,9})$');
  if m is null then res := 'payload_invalido';
  else
    select * into a from public.atendimentos where id = m[2]::uuid;
    select right(regexp_replace(coalesce(d.telefone, ''), '\D', '', 'g'), 11) into dtel from public.diaristas d where d.id = a.diarista_id;
    if a.id is null or dtel is null or dtel <> tel then res := 'remetente_invalido';
    else res := privado.escala_aplicar_resposta(a.id, m[1], m[3]::int, 'whatsapp', null, 'sistema');
    end if;
  end if;
  update public.mensagens_recebidas set acao = 'escala:' || res where id_externo = p_id_externo;
  return res;
end $$;

-- ---------------------------------------------------------------- retorno do envio (D10): avança, nunca regride
create or replace function privado.escala_retorno_envio() returns trigger
language plpgsql security definer set search_path = '' as $$
declare a public.atendimentos; v_versao int; agora text := privado.agora_iso();
begin
  if new.regra <> 'D10' or new.estado is not distinct from old.estado or new.teste then return new; end if;
  if coalesce(new.contexto ->> 'atendimentoId', '') !~ '^[0-9a-f-]{36}$' or coalesce(new.contexto #>> '{dados,versao}', '') !~ '^\d{1,9}$' then return new; end if;
  v_versao := (new.contexto #>> '{dados,versao}')::int;
  select * into a from public.atendimentos where id = (new.contexto ->> 'atendimentoId')::uuid for update;
  if a.id is null or a.escala_versao <> v_versao or a.diarista_id is null then return new; end if; -- execução de uma designação antiga
  if new.estado = 'enviada' and a.escala_estado = 'aguardando_envio' then
    update public.atendimentos set escala_estado = 'enviada', escala_envio = coalesce(escala_envio, '{}') || jsonb_build_object('saiuEm', agora, 'falhou', false) where id = a.id;
  elsif new.estado in ('entregue', 'lida') and a.escala_estado in ('aguardando_envio', 'enviada') then
    update public.atendimentos set escala_estado = 'aguardando_aceite',
        escala_envio = coalesce(escala_envio, '{}') || jsonb_build_object('entregueEm', agora, 'falhou', false) || case when new.estado = 'lida' then jsonb_build_object('lidaEm', agora) else '{}' end where id = a.id;
  elsif new.estado = 'lida' and a.escala_estado in ('aguardando_aceite', 'confirmada') then
    update public.atendimentos set escala_envio = coalesce(escala_envio, '{}') || jsonb_build_object('lidaEm', coalesce(escala_envio ->> 'lidaEm', agora)) where id = a.id;
  elsif new.estado = 'falhou' and a.escala_estado in ('aguardando_envio', 'enviada') then
    update public.atendimentos set escala_envio = coalesce(escala_envio, '{}') || jsonb_build_object('falhou', true, 'falhouEm', agora, 'motivoFalha', left(coalesce(new.motivo, ''), 200)) where id = a.id;
  end if;
  return new;
end $$;
create trigger escala_retorno_envio after update of estado on public.automacao_execucoes for each row execute function privado.escala_retorno_envio();

-- ---------------------------------------------------------------- stand-by
create or replace function privado.standby_hist(sd public.standby_decisoes, p_evento text, p_extra jsonb default '{}') returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(sd.historico, '[]') || (jsonb_build_object('evento', p_evento, 'em', privado.agora_iso(), 'por', auth.uid()) || coalesce(p_extra, '{}'))
$$;

create or replace function public.standby_reservar(p_dados jsonb, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; v_dia uuid; v_data date; v_hora time; v_dur int; v_reg text; sd public.standby_decisoes; alvo public.atendimentos; ini timestamptz;
begin
  perform privado.exigir_prime(s);
  r := privado.idem_ler('standbyReservar', s, p_chave, p_dados);
  if r is not null then return r; end if;
  v_dia := case when (p_dados ->> 'diaristaId') ~ '^[0-9a-f-]{36}$' then (p_dados ->> 'diaristaId')::uuid end;
  v_data := case when (p_dados ->> 'data') ~ '^\d{4}-\d{2}-\d{2}$' then (p_dados ->> 'data')::date end;
  v_hora := case when (p_dados ->> 'horaInicio') ~ '^([01]\d|2[0-3]):[0-5]\d$' then (p_dados ->> 'horaInicio')::time end;
  v_dur := case when (p_dados ->> 'duracaoMinutos') ~ '^\d{2,3}$' then (p_dados ->> 'duracaoMinutos')::int end;
  v_reg := left(nullif(trim(coalesce(p_dados ->> 'regiao', '')), ''), 80);
  if v_dia is null or v_data is null or v_hora is null or v_dur is null or v_dur not between 60 and 720 then perform privado.erro('DADOS_INVALIDOS', 'Informe profissional, data, horário e duração'); end if;
  if v_data < privado.hoje_sp() then perform privado.erro('DATA_INVALIDA', 'Stand-by só pra hoje ou depois'); end if;
  if not exists (select 1 from public.diaristas where id = v_dia and status = 'aprovada') then perform privado.erro('NAO_ENCONTRADO', 'Profissional não encontrada'); end if;
  alvo.id := null; alvo.data := v_data; alvo.hora_inicio := v_hora; alvo.duracao_minutos := v_dur;
  if privado.escala_impedimento(v_dia, alvo) is not null then perform privado.erro('CONDICAO_NAO_ATENDIDA', privado.escala_impedimento(v_dia, alvo)); end if;
  select * into sd from public.standby_decisoes where diarista_id = v_dia and data = v_data for update;
  if sd.estado = 'utilizada' then perform privado.erro('TRANSICAO_PROIBIDA', 'Esta reserva já foi utilizada numa diária'); end if;
  ini := (v_data::timestamp + v_hora) at time zone 'America/Sao_Paulo';
  insert into public.standby_decisoes (diarista_id, data, estado, motivo, decidido_por, hora_inicio, duracao_minutos, regiao, decidir_ate, historico)
  values (v_dia, v_data, 'reservada', null, auth.uid(), v_hora, v_dur, v_reg, ini - make_interval(mins => (privado.config_agenda() ->> 'standbyAlertaMin')::int),
          jsonb_build_array(jsonb_build_object('evento', 'reservada', 'em', privado.agora_iso(), 'por', auth.uid())))
  on conflict (diarista_id, data) do update set estado = 'reservada', motivo = null, decidido_por = excluded.decidido_por, em = now(), hora_inicio = excluded.hora_inicio,
    duracao_minutos = excluded.duracao_minutos, regiao = excluded.regiao, decidir_ate = excluded.decidir_ate, atendimento_id = null,
    historico = public.standby_decisoes.historico || excluded.historico
  returning * into sd;
  r := jsonb_build_object('diaristaId', sd.diarista_id, 'data', sd.data, 'estado', sd.estado, 'decidirAte', sd.decidir_ate);
  perform privado.idem_gravar('standbyReservar', s, p_chave, p_dados, r);
  return r;
end $$;

create or replace function public.standby_confirmar(p_diarista uuid, p_data date, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; sd public.standby_decisoes;
begin
  perform privado.exigir_prime(s);
  r := privado.idem_ler('standbyConfirmar', s, p_chave, jsonb_build_object('d', p_diarista, 'data', p_data));
  if r is not null then return r; end if;
  select * into sd from public.standby_decisoes where diarista_id = p_diarista and data = p_data and hora_inicio is not null for update;
  if sd.diarista_id is null then perform privado.erro('NAO_ENCONTRADO', 'Reserva de stand-by não encontrada'); end if;
  if sd.estado <> 'reservada' then perform privado.erro('TRANSICAO_PROIBIDA', 'Esta reserva não está aguardando confirmação'); end if;
  update public.standby_decisoes set estado = 'confirmada', em = now(), historico = privado.standby_hist(sd, 'confirmada') where diarista_id = p_diarista and data = p_data returning * into sd;
  r := jsonb_build_object('diaristaId', sd.diarista_id, 'data', sd.data, 'estado', sd.estado);
  perform privado.idem_gravar('standbyConfirmar', s, p_chave, jsonb_build_object('d', p_diarista, 'data', p_data), r);
  return r;
end $$;

create or replace function public.standby_utilizar(p_diarista uuid, p_data date, p_atendimento uuid, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; sd public.standby_decisoes; a public.atendimentos; imp text; n public.atendimentos;
begin
  perform privado.exigir_prime(s);
  r := privado.idem_ler('standbyUtilizar', s, p_chave, jsonb_build_object('d', p_diarista, 'data', p_data, 'a', p_atendimento));
  if r is not null then return r; end if;
  select * into sd from public.standby_decisoes where diarista_id = p_diarista and data = p_data and hora_inicio is not null for update;
  if sd.diarista_id is null or sd.estado not in ('reservada', 'confirmada') then perform privado.erro('TRANSICAO_PROIBIDA', 'Não há reserva de stand-by ativa dessa profissional nesse dia'); end if;
  select * into a from public.atendimentos where id = p_atendimento for update;
  perform privado.escala_editavel(a);
  if a.data <> p_data then perform privado.erro('DADOS_INVALIDOS', 'A diária é de outro dia'); end if;
  imp := privado.escala_impedimento(p_diarista, a);
  if imp is not null then perform privado.erro('CONDICAO_NAO_ATENDIDA', imp); end if;
  n := privado.escala_designar(a.id, p_diarista, 'manual', null, 'prime');
  update public.atendimentos set escala_sem_auto = false where id = a.id;
  update public.standby_decisoes set estado = 'utilizada', atendimento_id = a.id, em = now(), historico = privado.standby_hist(sd, 'utilizada', jsonb_build_object('atendimentoId', a.id))
   where diarista_id = p_diarista and data = p_data returning * into sd;
  r := jsonb_build_object('diaristaId', sd.diarista_id, 'data', sd.data, 'estado', sd.estado, 'atendimentoId', a.id, 'escalaVersao', n.escala_versao);
  perform privado.idem_gravar('standbyUtilizar', s, p_chave, jsonb_build_object('d', p_diarista, 'data', p_data, 'a', p_atendimento), r);
  return r;
end $$;

create or replace function public.standby_liberar(p_diarista uuid, p_data date, p_motivo text, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; sd public.standby_decisoes; mot text := left(nullif(trim(coalesce(p_motivo, '')), ''), 280);
begin
  perform privado.exigir_prime(s);
  r := privado.idem_ler('standbyLiberar', s, p_chave, jsonb_build_object('d', p_diarista, 'data', p_data, 'm', mot));
  if r is not null then return r; end if;
  select * into sd from public.standby_decisoes where diarista_id = p_diarista and data = p_data and hora_inicio is not null for update;
  if sd.diarista_id is null or sd.estado not in ('reservada', 'confirmada') then perform privado.erro('TRANSICAO_PROIBIDA', 'Não há reserva de stand-by ativa dessa profissional nesse dia'); end if;
  update public.standby_decisoes set estado = 'liberada', motivo = mot, decidido_por = auth.uid(), em = now(), historico = privado.standby_hist(sd, 'liberada', jsonb_build_object('motivo', mot))
   where diarista_id = p_diarista and data = p_data returning * into sd;
  r := jsonb_build_object('diaristaId', sd.diarista_id, 'data', sd.data, 'estado', sd.estado);
  perform privado.idem_gravar('standbyLiberar', s, p_chave, jsonb_build_object('d', p_diarista, 'data', p_data, 'm', mot), r);
  return r;
end $$;

-- ---------------------------------------------------------------- configuração, canal e parceria
create or replace function public.config_agenda() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator();
begin
  perform privado.exigir_prime(s);
  return privado.config_agenda();
end $$;

/** Só administração. Prazo sem resposta e verificação de pagamento: a Prime define (padrão desligado); nunca cancela sozinho. */
create or replace function public.salvar_config_agenda(p_valor jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); atual jsonb := privado.config_agenda(); prazo jsonb := p_valor -> 'prazoSemRespostaMin'; vp jsonb := p_valor -> 'verificacaoPagamento';
        alerta jsonb := p_valor -> 'standbyAlertaMin'; novo jsonb;
begin
  perform privado.exigir_admin(s);
  if jsonb_typeof(p_valor) <> 'object' then perform privado.erro('DADOS_INVALIDOS', 'Configuração inválida'); end if;
  if prazo is not null and jsonb_typeof(prazo) <> 'null' and not privado.inteiro_entre(prazo, 5, 2880) then perform privado.erro('DADOS_INVALIDOS', 'Prazo sem resposta: de 5 minutos a 48 horas, ou vazio pra desligar'); end if;
  if vp is not null and (jsonb_typeof(vp) <> 'object' or jsonb_typeof(vp -> 'ligada') <> 'boolean'
      or (coalesce((vp ->> 'ligada')::boolean, false) and coalesce(vp ->> 'hora', '') !~ '^([01]\d|2[0-3]):[0-5]\d$')) then
    perform privado.erro('DADOS_INVALIDOS', 'Verificação de pagamento: informe o horário pra ligar');
  end if;
  if alerta is not null and not privado.inteiro_entre(alerta, 0, 480) then perform privado.erro('DADOS_INVALIDOS', 'Alerta do stand-by: de 0 a 480 minutos antes'); end if;
  novo := (select coalesce(valor, '{}') from public.configuracao where chave = 'agenda_escala')
    || case when p_valor ? 'prazoSemRespostaMin' then jsonb_build_object('prazoSemRespostaMin', case when jsonb_typeof(prazo) = 'null' then null else prazo end) else '{}' end
    || case when vp is not null then jsonb_build_object('verificacaoPagamento', jsonb_build_object('ligada', (vp ->> 'ligada')::boolean, 'hora', case when (vp ->> 'ligada')::boolean then vp ->> 'hora' end)) else '{}' end
    || case when alerta is not null then jsonb_build_object('standbyAlertaMin', alerta) else '{}' end;
  update public.configuracao set valor = novo where chave = 'agenda_escala';
  return privado.config_agenda() - 'historicoCanal';
end $$;

/** Troca manual do canal ativo (só administração), com histórico. Fase 1: é o indicador; o portal de contingência é da fase 2. */
create or replace function public.definir_canal_ativo(p_canal text, p_motivo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); atual jsonb := privado.config_agenda();
begin
  perform privado.exigir_admin(s);
  if p_canal not in ('whatsapp', 'portal') then perform privado.erro('DADOS_INVALIDOS', 'Canal inválido'); end if;
  if atual ->> 'canalAtivo' = p_canal then return atual; end if;
  update public.configuracao set valor = coalesce(valor, '{}') || jsonb_build_object('canalAtivo', p_canal, 'historicoCanal',
      (select coalesce(jsonb_agg(x order by o), '[]') from jsonb_array_elements(atual -> 'historicoCanal') with ordinality t(x, o) where o > jsonb_array_length(atual -> 'historicoCanal') - 49)
      || jsonb_build_array(jsonb_build_object('de', atual ->> 'canalAtivo', 'para', p_canal, 'em', privado.agora_iso(), 'por', auth.uid(), 'motivo', left(nullif(trim(coalesce(p_motivo, '')), ''), 280))))
   where chave = 'agenda_escala';
  return privado.config_agenda();
end $$;

create or replace function public.definir_parceria(p_cliente uuid, p_parceria boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); v boolean;
begin
  perform privado.exigir_admin(s);
  update public.clientes set parceria = coalesce(p_parceria, false) where id = p_cliente and anonimizado_em is null returning parceria into v;
  if v is null then perform privado.erro('NAO_ENCONTRADO', 'Cliente não encontrado'); end if;
  return jsonb_build_object('clienteId', p_cliente, 'parceria', v);
end $$;
create or replace function privado.painel_pendencias_lista() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_hoje date := privado.hoje_sp(); v_agora timestamptz := now(); r jsonb := '[]'; cfg jsonb := privado.config_agenda();
        v_prazo int := case when jsonb_typeof(cfg -> 'prazoSemRespostaMin') = 'number' then (cfg ->> 'prazoSemRespostaMin')::int end;
        v_verif boolean := coalesce((cfg #>> '{verificacaoPagamento,ligada}')::boolean, false) and coalesce(cfg #>> '{verificacaoPagamento,hora}', '') ~ '^\d{2}:\d{2}$';
        v_verif_em timestamptz;
begin
  -- Agenda e Escala: verificação de pagamento (só se a Prime ligar), no horário configurado do dia anterior
  if v_verif then v_verif_em := ((v_hoje)::timestamp + (cfg #>> '{verificacaoPagamento,hora}')::time) at time zone 'America/Sao_Paulo'; end if;
  -- diária sem profissional (pedido já confirmado): hoje/amanhã urgente, até 7 dias normal
  r := r || coalesce((select jsonb_agg(jsonb_build_object('id', 'sem:' || a.id, 'tipo', 'sem_profissional', 'categoria', 'escala', 'urgente', a.data <= v_hoje + 1,
      'titulo', 'Diária ' || case when a.data = v_hoje then 'de hoje' when a.data = v_hoje + 1 then 'de amanhã' else 'de ' || to_char(a.data, 'DD/MM') end || ' sem profissional',
      'sub', concat_ws(' · ', to_char(a.data, 'DD/MM') || coalesce(' · ' || to_char(a.hora_inicio, 'HH24:MI'), ''), coalesce(privado.p_endereco(a, p, c) ->> 'bairro', '')),
      'ref', jsonb_build_object('atendimentoId', a.id, 'pedidoId', p.id, 'data', a.data), 'em', a.data) order by a.data, a.hora_inicio)
    from public.atendimentos a join public.pedidos p on p.id = a.pedido_id join public.clientes c on c.id = p.cliente_id
   where a.diarista_id is null and a.status in ('agendado', 'confirmado') and p.status in ('aguardando_pagamento', 'confirmado') and a.data between v_hoje and v_hoje + 7
     and a.escala_recusa is null and privado.escala_alerta_fixa(a) is null), '[]'); -- recusa e fixa impedida têm pendência própria (abaixo)
  -- substituição: a profissional designada ficou impedida (férias, folga, outra diária no mesmo horário)
  r := r || coalesce((select jsonb_agg(jsonb_build_object('id', 'sub:' || a.id, 'tipo', 'substituicao', 'categoria', 'escala', 'urgente', a.data <= v_hoje + 1,
      'titulo', 'Substituir ' || split_part(d.nome, ' ', 1) || ' em ' || to_char(a.data, 'DD/MM'),
      'sub', (select string_agg(x ->> 'mensagem', '; ') from jsonb_array_elements(cf.c) x where (x ->> 'impede')::boolean),
      'ref', jsonb_build_object('atendimentoId', a.id, 'pedidoId', a.pedido_id, 'diaristaId', d.id, 'data', a.data), 'em', a.data) order by a.data)
    from public.atendimentos a join public.diaristas d on d.id = a.diarista_id
    cross join lateral (select privado.conflitos_diaria(d.id, a.id, a.data, a.hora_inicio, a.duracao_minutos, null) c) cf
   where a.status in ('agendado', 'confirmado') and a.data between v_hoje and v_hoje + 7
     and exists (select 1 from jsonb_array_elements(cf.c) x where (x ->> 'impede')::boolean)), '[]');
  -- pagamento informado pela cliente: conferir no extrato
  r := r || coalesce((select jsonb_agg(jsonb_build_object('id', 'pag:' || g.id, 'tipo', 'pagamento_informado', 'categoria', 'financeiro', 'urgente', g.informado_em < v_agora - interval '2 hours',
      'titulo', 'Conferir pagamento de ' || split_part(c.nome, ' ', 1),
      'sub', concat_ws(' · ', 'R$ ' || to_char(g.valor_centavos / 100.0, 'FM999G990D00'), 'informado ' || to_char(g.informado_em at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI')),
      'ref', jsonb_build_object('pagamentoId', g.id, 'pedidoId', p.id, 'valorCentavos', g.valor_centavos), 'em', g.informado_em) order by g.informado_em)
    from public.pagamentos g join public.pedidos p on p.id = g.pedido_id join public.clientes c on c.id = p.cliente_id where g.status = 'informado_pelo_cliente'), '[]');
  -- pagamento vencido sem informe: liberar a vaga ou dar prazo
  r := r || coalesce((select jsonb_agg(jsonb_build_object('id', 'venc:' || g.id, 'tipo', 'pagamento_vencido', 'categoria', 'financeiro', 'urgente', true,
      'titulo', 'Pagamento vencido de ' || split_part(c.nome, ' ', 1),
      'sub', concat_ws(' · ', 'R$ ' || to_char(g.valor_centavos / 100.0, 'FM999G990D00'), 'venceu ' || to_char(g.vence_em, 'DD/MM')),
      'ref', jsonb_build_object('pagamentoId', g.id, 'pedidoId', p.id), 'em', g.vence_em) order by g.vence_em)
    from public.pagamentos g join public.pedidos p on p.id = g.pedido_id join public.clientes c on c.id = p.cliente_id
   where g.status = 'pendente' and g.vence_em is not null and p.status not in ('cancelado', 'recusado')
     and (g.vence_em::timestamp + coalesce(g.vence_as, time '14:00')) at time zone 'America/Sao_Paulo' <= v_agora
     and not (v_verif and v_agora >= v_verif_em and exists (select 1 from public.atendimentos x where x.id = g.atendimento_id and x.data = v_hoje + 1))), '[]'); -- na verificação vira pendência da diária
  -- adiantamento e reembolso (Uber)
  r := r || coalesce((select jsonb_agg(jsonb_build_object('id', 'sol:' || x.id, 'tipo', x.tipo, 'categoria', 'financeiro', 'urgente', false,
      'titulo', case x.tipo when 'adiantamento' then 'Aprovar adiantamento' else 'Uber / transporte' end,
      'sub', concat_ws(' · ', d.nome, 'R$ ' || to_char(x.valor_centavos / 100.0, 'FM999G990D00'), nullif(x.descricao, '')),
      'ref', jsonb_build_object('solicitacaoId', x.id, 'diaristaId', d.id, 'atendimentoId', x.atendimento_id), 'em', x.criado_em) order by x.criado_em)
    from public.solicitacoes_profissional x join public.diaristas d on d.id = x.diarista_id where x.estado = 'pendente'), '[]');
  -- hora extra registrada pela profissional
  r := r || coalesce((select jsonb_agg(jsonb_build_object('id', 'he:' || h.id, 'tipo', 'hora_extra', 'categoria', 'financeiro', 'urgente', false,
      'titulo', 'Hora extra pra aprovar', 'sub', concat_ws(' · ', split_part(d.nome, ' ', 1), h.horas || 'h', to_char(a.data, 'DD/MM')),
      'ref', jsonb_build_object('horaExtraId', h.id, 'atendimentoId', a.id), 'em', h.registrada_em) order by h.registrada_em)
    from public.horas_extras h join public.atendimentos a on a.id = h.atendimento_id left join public.diaristas d on d.id = a.diarista_id where h.status = 'registrada'), '[]');
  -- pacote com endereço novo (item 46 do v3)
  r := r || coalesce((select jsonb_agg(jsonb_build_object('id', 'end:' || p.id, 'tipo', 'pacote_endereco_novo', 'categoria', 'contratos', 'urgente', false,
      'titulo', 'Pacote com endereço novo', 'sub', concat_ws(' · ', c.nome, 'nº ' || lpad(p.numero_solicitacao::text, 6, '0')),
      'ref', jsonb_build_object('pedidoId', p.id), 'em', p.criado_em) order by p.criado_em)
    from public.pedidos p join public.clientes c on c.id = p.cliente_id where p.status = 'solicitado' and p.pacote_endereco_novo), '[]');
  -- cadastro de profissional pra analisar e documento vencido
  r := r || coalesce((select jsonb_agg(jsonb_build_object('id', 'cad:' || d.id, 'tipo', 'cadastro_profissional', 'categoria', 'contratos', 'urgente', false,
      'titulo', 'Cadastro de profissional pra analisar', 'sub', d.nome, 'ref', jsonb_build_object('diaristaId', d.id), 'em', d.atualizado_em) order by d.atualizado_em)
    from public.diaristas d where d.status = 'pendente'), '[]');
  r := r || coalesce((select jsonb_agg(jsonb_build_object('id', 'doc:' || x.id, 'tipo', 'documento_vencido', 'categoria', 'contratos', 'urgente', false,
      'titulo', 'Documento vencido', 'sub', concat_ws(' · ', d.nome, x.tipo, 'venceu ' || to_char(x.valido_ate, 'DD/MM')),
      'ref', jsonb_build_object('diaristaId', d.id, 'documentoId', x.id), 'em', x.valido_ate) order by x.valido_ate)
    from public.documentos x join public.diaristas d on d.id = x.diarista_id
   where x.excluido_em is null and x.valido_ate < v_hoje and d.status = 'aprovada'
     and not exists (select 1 from public.documentos y where y.diarista_id = x.diarista_id and y.tipo = x.tipo and y.excluido_em is null and y.criado_em > x.criado_em)), '[]');
  -- ocorrência aberta (parada há mais de 48 h: urgente)
  r := r || coalesce((select jsonb_agg(jsonb_build_object('id', 'oc:' || o.id, 'tipo', 'ocorrencia', 'categoria', 'ocorrencias', 'urgente', o.atualizado_em < v_agora - interval '48 hours',
      'titulo', 'Ocorrência ' || case when o.estado = 'aberto' then 'aberta' else 'em análise' end, 'sub', concat_ws(' · ', c.nome, left(o.descricao, 60)),
      'ref', jsonb_build_object('ocorrenciaId', o.id, 'atendimentoId', o.atendimento_id), 'em', o.criado_em) order by o.criado_em)
    from public.ocorrencias o join public.clientes c on c.id = o.cliente_id where o.estado in ('aberto', 'em_analise')), '[]');
  -- falha de automação (últimos 7 dias): reprocessar
  r := r || coalesce((select jsonb_agg(jsonb_build_object('id', 'aut:' || e.id, 'tipo', 'falha_automacao', 'categoria', 'automacoes', 'urgente', false,
      'titulo', 'Mensagem automática não saiu', 'sub', concat_ws(' · ', coalesce(rg.descricao, e.regra), left(coalesce(e.motivo, ''), 60)),
      'ref', jsonb_build_object('execucaoId', e.id), 'em', e.atualizado_em) order by e.atualizado_em desc)
    from public.automacao_execucoes e left join public.automacao_regras rg on rg.codigo = e.regra
   where e.estado = 'falhou' and not e.teste and e.atualizado_em > v_agora - interval '7 days' and e.regra <> 'D10'), '[]'); -- D10: falha do envio da escala (abaixo)
  -- ---------- Agenda e Escala (mesmo registro da diária; ref leva direto pra ela)
  -- profissional recusou: a diária voltou pra equipe, sem ninguém no lugar
  r := r || coalesce((select jsonb_agg(jsonb_build_object('id', 'rec:' || a.id, 'tipo', 'recusa_profissional', 'categoria', 'escala', 'urgente', a.data <= v_hoje + 1,
      'titulo', split_part(a.escala_recusa ->> 'nome', ' ', 1) || ' recusou a diária de ' || to_char(a.data, 'DD/MM'),
      'sub', concat_ws(' · ', to_char(a.hora_inicio, 'HH24:MI'), c.nome, nullif(a.escala_recusa ->> 'motivo', '')),
      'ref', jsonb_build_object('atendimentoId', a.id, 'pedidoId', a.pedido_id, 'data', a.data), 'em', a.escala_recusa ->> 'em') order by a.data, a.hora_inicio)
    from public.atendimentos a join public.pedidos p on p.id = a.pedido_id join public.clientes c on c.id = p.cliente_id
   where a.diarista_id is null and a.escala_recusa is not null and a.status in ('agendado', 'confirmado') and a.data >= v_hoje and p.status in ('aguardando_pagamento', 'confirmado')), '[]');
  -- sem resposta depois do prazo configurado (sem prazo, sem alerta): continua aguardando, não é recusa
  if v_prazo is not null then
    r := r || coalesce((select jsonb_agg(jsonb_build_object('id', 'resp:' || a.id, 'tipo', 'sem_resposta', 'categoria', 'escala', 'urgente', a.data <= v_hoje,
        'titulo', split_part(d.nome, ' ', 1) || ' ainda não respondeu', 'sub', concat_ws(' · ', to_char(a.data, 'DD/MM') || ' ' || to_char(a.hora_inicio, 'HH24:MI'),
          'enviada ' || to_char((a.escala_envio ->> 'enviadaEm')::timestamptz at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI')),
        'ref', jsonb_build_object('atendimentoId', a.id, 'pedidoId', a.pedido_id, 'diaristaId', d.id, 'data', a.data), 'em', a.escala_envio ->> 'enviadaEm') order by a.data, a.hora_inicio)
      from public.atendimentos a join public.diaristas d on d.id = a.diarista_id
     where a.escala_estado in ('enviada', 'aguardando_aceite') and a.status in ('agendado', 'confirmado') and a.data >= v_hoje
       and (a.escala_envio ->> 'enviadaEm') is not null and (a.escala_envio ->> 'enviadaEm')::timestamptz + make_interval(mins => v_prazo) <= v_agora), '[]');
  end if;
  -- envio da escala que falhou: reenviar pela linha
  r := r || coalesce((select jsonb_agg(jsonb_build_object('id', 'fenv:' || a.id, 'tipo', 'falha_envio_escala', 'categoria', 'escala', 'urgente', a.data <= v_hoje + 1,
      'titulo', 'Envio da diária pra ' || split_part(d.nome, ' ', 1) || ' falhou', 'sub', concat_ws(' · ', to_char(a.data, 'DD/MM') || ' ' || to_char(a.hora_inicio, 'HH24:MI'), nullif(a.escala_envio ->> 'motivoFalha', '')),
      'ref', jsonb_build_object('atendimentoId', a.id, 'pedidoId', a.pedido_id, 'diaristaId', d.id, 'data', a.data), 'em', a.escala_envio ->> 'falhouEm') order by a.data, a.hora_inicio)
    from public.atendimentos a join public.diaristas d on d.id = a.diarista_id
   where coalesce((a.escala_envio ->> 'falhou')::boolean, false) and a.escala_estado in ('aguardando_envio', 'enviada') and a.status in ('agendado', 'confirmado') and a.data >= v_hoje), '[]');
  -- profissional fixa impedida (férias, folga, outra diária): a equipe decide; o sistema não põe outra
  r := r || coalesce((select jsonb_agg(jsonb_build_object('id', 'fixa:' || a.id, 'tipo', 'conflito_fixa', 'categoria', 'escala', 'urgente', a.data <= v_hoje + 1,
      'titulo', 'Fixa indisponível em ' || to_char(a.data, 'DD/MM'), 'sub', privado.escala_alerta_fixa(a),
      'ref', jsonb_build_object('atendimentoId', a.id, 'pedidoId', a.pedido_id, 'data', a.data), 'em', a.data) order by a.data, a.hora_inicio)
    from public.atendimentos a join public.pedidos p on p.id = a.pedido_id
   where a.diarista_id is null and a.status in ('agendado', 'confirmado') and a.data between v_hoje and v_hoje + 7 and p.status in ('aguardando_pagamento', 'confirmado')
     and privado.escala_alerta_fixa(a) is not null), '[]');
  -- stand-by perto do horário de decisão: utilizar ou liberar
  r := r || coalesce((select jsonb_agg(jsonb_build_object('id', 'sb:' || sd.diarista_id || ':' || sd.data, 'tipo', 'standby_decisao', 'categoria', 'escala', 'urgente', true,
      'titulo', 'Stand-by de ' || split_part(d.nome, ' ', 1) || ': decidir', 'sub', concat_ws(' · ', to_char(sd.data, 'DD/MM') || ' ' || to_char(sd.hora_inicio, 'HH24:MI'), sd.regiao, 'Utilize a reserva ou libere a profissional'),
      'ref', jsonb_build_object('diaristaId', d.id, 'data', sd.data), 'em', sd.decidir_ate) order by sd.decidir_ate)
    from public.standby_decisoes sd join public.diaristas d on d.id = sd.diarista_id
   where sd.hora_inicio is not null and sd.estado in ('reservada', 'confirmada') and sd.decidir_ate <= v_agora and sd.data >= v_hoje), '[]');
  -- verificação de pagamento (desligada por padrão): diária de amanhã ainda sem pagamento depois do horário configurado.
  -- Respeita parceria e condição comercial; só alerta, nunca cancela.
  if v_verif and v_agora >= v_verif_em then
    r := r || coalesce((select jsonb_agg(jsonb_build_object('id', 'vpag:' || a.id, 'tipo', 'pagamento_verificacao', 'categoria', 'financeiro', 'urgente', true,
        'titulo', 'Diária de amanhã sem pagamento: ' || split_part(c.nome, ' ', 1), 'sub', concat_ws(' · ', to_char(a.hora_inicio, 'HH24:MI'), 'decidir com a cliente'),
        'ref', jsonb_build_object('atendimentoId', a.id, 'pedidoId', p.id, 'data', a.data), 'em', a.data) order by a.hora_inicio)
      from public.atendimentos a join public.pedidos p on p.id = a.pedido_id join public.clientes c on c.id = p.cliente_id
     where a.data = v_hoje + 1 and a.status in ('agendado', 'confirmado') and p.status in ('aguardando_pagamento', 'confirmado')
       and not c.parceria and p.condicao_comercial_id is null and privado.p_pagamento_da_diaria(a) ->> 'estado' = 'pendente'), '[]');
  end if;
  return r;
end $$;
revoke all on function privado.painel_pendencias_lista() from public;

-- ---------------------------------------------------------------- rotina diária: preparar a escala de hoje a 7 dias (06:00 em Brasília)
select cron.schedule('prime-escala-preparar', '0 9 * * *', $$select privado.escala_preparar_interno(privado.hoje_sp(), privado.hoje_sp() + 7)$$);

-- ---------------------------------------------------------------- automações: condição nova, atraso novo, regras novas
create or replace function privado.condicoes_validas(c jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(c) = 'object' and not exists (
    select 1 from jsonb_each(c) x
     where x.key not in ('pedidoStatus', 'atendimentoStatus', 'pagamentoStatus', 'mesmaData', 'mesmaProfissional', 'mesmoPrazo', 'semAvaliacao', 'temCobranca', 'temProfissional', 'semFaturamento', 'escalaComunicada')
        or (x.key like '%Status' and jsonb_typeof(x.value) <> 'array')
        or (x.key not like '%Status' and x.value <> 'true'::jsonb))
$$;

/** Atraso editado: mesmo tipo do original e só os campos editáveis, dentro dos limites (catalogo.LIMITES). + antes_fim. */
create or replace function privado.atraso_valido(orig jsonb, novo jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare t text := orig ->> 'tipo'; x jsonb;
begin
  if novo ->> 'tipo' is distinct from t then return false; end if;
  if exists (select 1 from jsonb_object_keys(novo) k where k not in (select jsonb_object_keys(orig))) then return false; end if;
  if novo ? 'hora' and not privado.hora_ok(novo -> 'hora') then return false; end if;
  case t
    when 'apos' then return privado.inteiro_entre(novo -> 'minutos', 60, 4320);
    when 'apos_inicio_turno' then return privado.inteiro_entre(novo -> 'minutos', 10, 180);
    when 'antes_fim' then return privado.inteiro_entre(novo -> 'minutos', 30, 240);
    when 'antes_prazo' then
      if jsonb_typeof(novo -> 'minutos') <> 'array' or jsonb_array_length(novo -> 'minutos') not between 1 and 3 then return false; end if;
      for x in select jsonb_array_elements(novo -> 'minutos') loop if not privado.inteiro_entre(x, 30, 2880) then return false; end if; end loop;
      return true;
    when 'antes_vencimento_documento' then
      if jsonb_typeof(novo -> 'dias') <> 'array' or jsonb_array_length(novo -> 'dias') not between 1 and 3 then return false; end if;
      for x in select jsonb_array_elements(novo -> 'dias') loop if not privado.inteiro_entre(x, 1, 60) then return false; end if; end loop;
      return true;
    when 'inatividade' then return privado.inteiro_entre(novo -> 'dias', 30, 365) and privado.inteiro_entre(novo -> 'intervaloDias', 30, 365);
    when 'mensal' then return privado.inteiro_entre(novo -> 'dia', 1, 28);
    when 'semanal' then return privado.inteiro_entre(novo -> 'diaSemana', 1, 6);
    else return true; -- imediato, vespera, diario, aniversario, prazo_vencido: só a hora (já conferida)
  end case;
end $$;

-- A profissional só recebe endereço e lembretes depois do envio pela escala; D04 também no aceite; D08 avisa a anterior
-- quando a escala troca ou remove depois de comunicada. (O worker lê as regras do banco; o catálogo é a mesma coisa.)
update public.automacao_regras set condicoes = '{"escalaComunicada":true,"atendimentoStatus":["confirmado"],"mesmaProfissional":true}'::jsonb,
  gatilho = '{"tipo":"evento","eventos":["atendimento_atribuido","pagamento_confirmado","escala_aceita"]}'::jsonb, versao = versao + 1, atualizado_em = now() where codigo = 'D04';
update public.automacao_regras set condicoes = '{"escalaComunicada":true,"atendimentoStatus":["confirmado"],"mesmaData":true,"mesmaProfissional":true}'::jsonb, versao = versao + 1, atualizado_em = now()
 where codigo in ('D05', 'D06');
update public.automacao_regras set gatilho = '{"tipo":"evento","eventos":["atendimento_cancelado","atendimento_reagendado","pedido_cancelado","atendimento_atribuido","escala_alterada"]}'::jsonb,
  versao = versao + 1, atualizado_em = now() where codigo = 'D08';

-- mensagens novas (gerado por scripts/gera-seed-automacoes.mjs a partir do catálogo: diaria_enviada, solicitar_confirmacao, conferencia_atendimento, confirmacao_agendamento, cancelamento_diaria_cliente; regras C20, D10, D11).
-- Os templates novos precisam de aprovação na Meta. Os modelos do menu do balão da cliente não têm regra: a equipe usa o texto pronto.
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('diaria_enviada', 'whatsapp', 1, 'Oi, {{nome}}! A Prime escalou você para a diária de {{data}}, {{horario}} ({{carga}}). Use os botões desta mensagem para aceitar ou recusar. Se tiver dúvida, responda aqui.', null, array['nome', 'data', 'horario', 'carga']::text[], array['nome', 'data', 'horario', 'carga']::text[], 'UTILITY', true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('diaria_enviada', 'email', 1, 'Oi, {{nome}}! A Prime escalou você para a diária de {{data}}, {{horario}} ({{carga}}). Use os botões desta mensagem para aceitar ou recusar. Se tiver dúvida, responda aqui.', 'Nova diária na escala', array['nome', 'data', 'horario', 'carga']::text[], array['nome', 'data', 'horario', 'carga']::text[], null, true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('solicitar_confirmacao', 'whatsapp', 1, 'Oi, {{nome}}. A Prime ainda aguarda a sua confirmação para a diária de {{data}}, {{horario}}. Use os botões da mensagem anterior ou responda aqui.', null, array['nome', 'data', 'horario']::text[], array['nome', 'data', 'horario']::text[], 'UTILITY', true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('solicitar_confirmacao', 'email', 1, 'Oi, {{nome}}. A Prime ainda aguarda a sua confirmação para a diária de {{data}}, {{horario}}. Use os botões da mensagem anterior ou responda aqui.', 'Confirme a sua diária', array['nome', 'data', 'horario']::text[], array['nome', 'data', 'horario']::text[], null, true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('conferencia_atendimento', 'whatsapp', 1, 'Oi, {{nome}}. Como está o atendimento de hoje com {{profissional}}? Se quiser algum ajuste antes do fim, responda esta mensagem.', null, array['nome', 'profissional']::text[], array['nome', 'profissional']::text[], 'UTILITY', true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('conferencia_atendimento', 'email', 1, 'Oi, {{nome}}. Como está o atendimento de hoje com {{profissional}}? Se quiser algum ajuste antes do fim, responda esta mensagem.', 'Como está o atendimento?', array['nome', 'profissional']::text[], array['nome', 'profissional']::text[], null, true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('confirmacao_agendamento', 'whatsapp', 1, 'Oi, {{nome}}! Seu atendimento com a Prime está agendado para {{data}}, {{horario}}, com {{carga}}. Qualquer dúvida, responda esta mensagem.', null, array['nome', 'data', 'horario', 'carga']::text[], array['nome', 'data', 'horario', 'carga']::text[], 'UTILITY', true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('confirmacao_agendamento', 'email', 1, 'Oi, {{nome}}! Seu atendimento com a Prime está agendado para {{data}}, {{horario}}, com {{carga}}. Qualquer dúvida, responda esta mensagem.', 'Seu atendimento está agendado', array['nome', 'data', 'horario', 'carga']::text[], array['nome', 'data', 'horario', 'carga']::text[], null, true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('cancelamento_diaria_cliente', 'whatsapp', 1, 'Oi, {{nome}}. A diária de {{data}}, {{horario}}, foi cancelada. Se quiser remarcar, responda esta mensagem.', null, array['nome', 'data', 'horario']::text[], array['nome', 'data', 'horario']::text[], 'UTILITY', true);
insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values ('cancelamento_diaria_cliente', 'email', 1, 'Oi, {{nome}}. A diária de {{data}}, {{horario}}, foi cancelada. Se quiser remarcar, responda esta mensagem.', 'Diária cancelada', array['nome', 'data', 'horario']::text[], array['nome', 'data', 'horario']::text[], null, true);
insert into public.automacao_regras (codigo, template_codigo, descricao, categoria, destinatario, canais_ordem, gatilho, atraso, condicoes, cancelamento, entidade, marco, do_dia, validade_min, ligada) values ('C20', 'conferencia_atendimento', 'Conferência com a cliente 2 horas antes do fim da diária (Agenda e Escala, seção 12)', 'atendimento', 'cliente', array['whatsapp', 'email', 'painel']::text[], '{"tipo":"agenda"}'::jsonb, '{"tipo":"antes_fim","minutos":120}'::jsonb, '{"atendimentoStatus":["confirmado","diarista_a_caminho","em_andamento"],"mesmaData":true}'::jsonb, array['atendimento_cancelado', 'pedido_cancelado', 'atendimento_reagendado']::text[], 'atendimento', null, true, null, true);
insert into public.automacao_regras (codigo, template_codigo, descricao, categoria, destinatario, canais_ordem, gatilho, atraso, condicoes, cancelamento, entidade, marco, do_dia, validade_min, ligada) values ('D10', 'diaria_enviada', 'Diária enviada pela escala, pedindo o aceite (Agenda e Escala, seção 6)', 'atendimento', 'diarista', array['whatsapp', 'email', 'painel']::text[], '{"tipo":"evento","eventos":["diaria_enviada"]}'::jsonb, '{"tipo":"imediato"}'::jsonb, '{"mesmaProfissional":true,"temProfissional":true}'::jsonb, array['atendimento_cancelado', 'pedido_cancelado']::text[], 'atendimento', 'envio', false, null, true);
insert into public.automacao_regras (codigo, template_codigo, descricao, categoria, destinatario, canais_ordem, gatilho, atraso, condicoes, cancelamento, entidade, marco, do_dia, validade_min, ligada) values ('D11', 'solicitar_confirmacao', 'Pedido de confirmação de novo, feito pela equipe (aviãozinho da profissional)', 'atendimento', 'diarista', array['whatsapp', 'email', 'painel']::text[], '{"tipo":"evento","eventos":["confirmacao_solicitada"]}'::jsonb, '{"tipo":"imediato"}'::jsonb, '{"mesmaProfissional":true,"temProfissional":true}'::jsonb, array[]::text[], 'atendimento', null, false, null, true);

-- ---------------------------------------------------------------- permissões
do $$ declare f text; begin
  foreach f in array array[
    'agenda_escala(date, date)', 'agenda_contagens(date, date)', 'escala_preparar(date, date)', 'escala_candidatas(uuid)', 'escala_alterar(uuid, jsonb, text)',
    'escala_remover(uuid, text)', 'escala_revisar(uuid, int, text)', 'escala_enviar(uuid[], text)', 'escala_responder(uuid, jsonb, text)', 'escala_solicitar_confirmacao(uuid, text)',
    'standby_reservar(jsonb, text)', 'standby_utilizar(uuid, date, uuid, text)', 'standby_liberar(uuid, date, text, text)', 'standby_confirmar(uuid, date, text)',
    'vinculos_fixos_do_pedido(uuid)', 'salvar_vinculo_fixo(uuid, jsonb, text)', 'encerrar_vinculo_fixo(uuid, text, text)',
    'config_agenda()', 'salvar_config_agenda(jsonb)', 'definir_canal_ativo(text, text)', 'definir_parceria(uuid, boolean)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on function public.webhook_resposta_escala(text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.webhook_resposta_escala(text, text, text, timestamptz) to service_role;
do $$ declare f text; begin
  foreach f in array array[
    'privado.escala_par_valido(text, text)', 'privado.escala_criterios_sem_dado()', 'privado.num_br(numeric)', 'privado.escala_notas(uuid)',
    'privado.pontuar_candidata(public.atendimentos, public.diaristas, text, uuid)', 'privado.escala_candidatas_lista(public.atendimentos)', 'privado.vinculo_da_diaria(public.atendimentos)',
    'privado.escala_impedimento(uuid, public.atendimentos)', 'privado.escala_alerta_fixa(public.atendimentos)', 'privado.escala_item(public.atendimentos)',
    'privado.escala_hist(public.atendimentos, text, text, jsonb)', 'privado.escala_editavel(public.atendimentos)', 'privado.escala_comunicada(public.atendimentos)',
    'privado.escala_designar(uuid, uuid, text, jsonb, text)', 'privado.standby_hist(public.standby_decisoes, text, jsonb)'] loop
    execute format('revoke all on function %s from public', f);
  end loop;
end $$;
