-- P3 (fase 2, bloco 3): pagamento sem trabalho manual.
-- 1) Prazo vencido: ações de um clique (liberar a vaga, dar mais prazo); liberação automática atrás da flag
--    p3_liberacao_automatica (DESLIGADA; PENDENCIAS).
-- 2) Hora extra: a profissional registra no check-out, a Prime aprova e nasce a cobrança adicional
--    (horas x PRECOS.horaExtraCentavos, R$ 30/hora da tabela oficial) com o C14 pra cliente. Flag p3_hora_extra.
-- 3) Recibo por pagamento confirmado, numeração sequencial SEM BURACO (contador travado na mesma transação da
--    confirmação: rollback devolve o número). Não é nota fiscal. Flag p3_recibos.

insert into public.config_flags (chave, ligada, padrao, descricao) values
  ('p3_liberacao_automatica', false, false, 'Prazo de pagamento vencido libera a vaga sozinho (cancela a diária não paga)'),
  ('p3_hora_extra', true, true, 'Profissional registra hora extra no check-out e a Prime aprova a cobrança'),
  ('p3_recibos', true, true, 'Recibo em PDF por pagamento confirmado, com número sequencial')
on conflict (chave) do nothing;

-- ---------------------------------------------------------------- cobrança de hora extra
alter table public.pagamentos drop constraint pagamentos_parcela_check;
alter table public.pagamentos add constraint pagamentos_parcela_check check (parcela in ('entrada', 'dia', 'diaria', 'pacote', 'hora_extra'));
alter table public.pagamentos drop constraint pagamentos_atendimento_da_parcela;
alter table public.pagamentos add constraint pagamentos_atendimento_da_parcela check ((parcela in ('dia', 'diaria', 'hora_extra')) = (atendimento_id is not null));

-- redefinida a partir de 20260924100000: hora extra é pagável enquanto a diária não foi cancelada
create or replace function privado.elegibilidade(g public.pagamentos) returns jsonb
language plpgsql stable set search_path = '' as $$
declare p public.pedidos; a public.atendimentos;
begin
  if g.status = 'confirmado' then return '{"pagavel": false, "motivo": "Pagamento já confirmado pela Prime"}'; end if;
  if g.status = 'estornado' then return '{"pagavel": false, "motivo": "Pagamento estornado"}'; end if;
  if g.status = 'cancelado' then return '{"pagavel": false, "motivo": "Cobrança cancelada"}'; end if;
  select * into p from public.pedidos where id = g.pedido_id;
  if p.status not in ('aguardando_pagamento', 'confirmado', 'concluido') then return '{"pagavel": false, "motivo": "Este pedido não está aguardando pagamento"}'; end if;
  if g.parcela = 'pacote' then return '{"pagavel": true}'; end if;
  if g.parcela in ('diaria', 'hora_extra') then
    select * into a from public.atendimentos where id = g.atendimento_id;
    if a.id is null then return '{"pagavel": false, "motivo": "Diária não encontrada"}'; end if;
    if a.status = 'cancelado' then return '{"pagavel": false, "motivo": "Diária cancelada"}'; end if;
    return '{"pagavel": true}';
  end if;
  return '{"pagavel": false, "motivo": "Cobrança antiga. Fale com a Prime."}';
end $$;

create table public.horas_extras (
  id uuid primary key default gen_random_uuid(),
  atendimento_id uuid not null references public.atendimentos (id) on delete cascade,
  horas int not null check (horas between 1 and 4),
  observacao text check (char_length(observacao) <= 300),
  status text not null default 'registrada' check (status in ('registrada', 'aprovada', 'recusada')),
  registrada_em timestamptz not null default now(),
  decidida_em timestamptz,
  decidida_por uuid references auth.users (id) on delete set null,
  motivo_recusa text check (char_length(motivo_recusa) <= 300),
  pagamento_id uuid references public.pagamentos (id),
  check ((status = 'aprovada') = (pagamento_id is not null))
);
-- uma hora extra ativa por diária (recusada libera registrar de novo)
create unique index horas_extras_uma_por_diaria on public.horas_extras (atendimento_id) where status <> 'recusada';
create index horas_extras_pendentes on public.horas_extras (registrada_em) where status = 'registrada';
alter table public.horas_extras enable row level security;
alter table public.horas_extras force row level security;
grant select on public.horas_extras to authenticated;
create policy prime_ou_profissional on public.horas_extras for select to authenticated
  using ((select privado.eh_prime()) or exists (select 1 from public.atendimentos a where a.id = atendimento_id and a.diarista_id = (select privado.minha_diarista_id())));
create trigger auditoria after insert or update or delete on public.horas_extras for each row execute function privado.auditar();

create or replace function privado.j_hora_extra(h public.horas_extras) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object('id', h.id, 'atendimentoId', h.atendimento_id, 'horas', h.horas, 'observacao', h.observacao, 'status', h.status,
    'registradaEm', h.registrada_em, 'decididaEm', h.decidida_em, 'motivoRecusa', h.motivo_recusa, 'pagamentoId', h.pagamento_id))
$$;

/** Profissional atribuída registra a hora extra no check-out (diária em andamento ou finalizada, até 2 dias depois). */
create or replace function public.registrar_hora_extra(p_atendimento uuid, p_dados jsonb, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; a public.atendimentos; h public.horas_extras; n int; obs text;
        conteudo jsonb;
begin
  if not privado.flag('p3_hora_extra') then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Registro de hora extra desligado. Avise a Prime.'); end if;
  if s ->> 'ator' <> 'diarista' then perform privado.erro('ATOR_SEM_PERMISSAO', 'Só a profissional da diária registra hora extra'); end if;
  begin n := (p_dados ->> 'horas')::int; exception when others then n := null; end;
  if n is null or n < 1 or n > 4 then perform privado.erro('DADOS_INVALIDOS', 'Informe de 1 a 4 horas', '{"horas": "De 1 a 4 horas"}'); end if;
  obs := nullif(left(regexp_replace(trim(coalesce(p_dados ->> 'observacao', '')), '\s+', ' ', 'g'), 300), '');
  conteudo := jsonb_build_object('atendimento', p_atendimento, 'horas', n, 'obs', obs);
  r := privado.idem_ler('registrarHoraExtra', s, p_chave, conteudo);
  if r is not null then return r; end if;
  select * into a from public.atendimentos where id = p_atendimento for update;
  if not found or a.diarista_id is distinct from (s ->> 'id')::uuid then perform privado.erro('NAO_ENCONTRADO', 'Diária não encontrada'); end if;
  if a.status not in ('em_andamento', 'finalizado') then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Hora extra se registra no check-out'); end if;
  if a.data < privado.hoje_sp() - 2 then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Prazo pra registrar passou (2 dias). Fale com a Prime.'); end if;
  if exists (select 1 from public.horas_extras x where x.atendimento_id = a.id and x.status <> 'recusada') then
    perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Esta diária já tem hora extra registrada'); end if;
  perform set_config('app.ator', 'diarista', true);
  insert into public.horas_extras (atendimento_id, horas, observacao) values (a.id, n, obs) returning * into h;
  perform privado.evento('hora_extra_registrada', jsonb_build_object('pedidoId', a.pedido_id, 'atendimentoId', a.id, 'diaristaId', a.diarista_id), jsonb_build_object('horas', n));
  r := jsonb_build_object('horaExtra', privado.j_hora_extra(h));
  perform privado.idem_gravar('registrarHoraExtra', s, p_chave, conteudo, r);
  return r;
end $$;

/** Prime aprova (nasce a cobrança e o C14) ou recusa com motivo. Vence em 2 dias, 14h (PENDENCIAS). */
create or replace function public.decidir_hora_extra(p_id uuid, p_dados jsonb, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; h public.horas_extras; a public.atendimentos; p public.pedidos; g public.pagamentos; aprovar boolean; m text; valor bigint;
        conteudo jsonb;
begin
  perform privado.exigir_prime(s);
  aprovar := coalesce((p_dados ->> 'aprovar')::boolean, false);
  m := nullif(left(regexp_replace(trim(coalesce(p_dados ->> 'motivo', '')), '\s+', ' ', 'g'), 300), '');
  if not aprovar and coalesce(char_length(m), 0) < 3 then perform privado.erro('DADOS_INVALIDOS', 'Escreva o motivo pra recusar', '{"motivo": "Escreva o motivo"}'); end if;
  conteudo := jsonb_build_object('id', p_id, 'aprovar', aprovar, 'm', m);
  r := privado.idem_ler('decidirHoraExtra', s, p_chave, conteudo);
  if r is not null then return r; end if;
  perform set_config('app.ator', 'prime', true);
  select * into h from public.horas_extras where id = p_id;
  if not found then perform privado.erro('NAO_ENCONTRADO', 'Hora extra não encontrada'); end if;
  select * into a from public.atendimentos where id = h.atendimento_id;
  select * into p from public.pedidos where id = a.pedido_id for update;
  select * into h from public.horas_extras where id = p_id for update;
  if h.status <> 'registrada' then perform privado.erro('TRANSICAO_PROIBIDA', 'Hora extra já ' || h.status); end if;
  if aprovar then
    valor := h.horas * (privado.cfg() #>> '{PRECOS,horaExtraCentavos}')::bigint;
    g := privado.nova_cobranca(p.id, a.id, jsonb_build_object('parcela', 'hora_extra', 'valorCentavos', valor, 'descontoCentavos', 0,
           'venceEm', to_char(privado.hoje_sp() + 2, 'YYYY-MM-DD'), 'venceAs', '14:00'), p_chave || ':hora_extra');
    update public.horas_extras set status = 'aprovada', decidida_em = now(), decidida_por = auth.uid(), pagamento_id = g.id where id = h.id returning * into h;
    perform privado.evento('hora_extra_aprovada', jsonb_build_object('pedidoId', p.id, 'atendimentoId', a.id, 'pagamentoId', g.id, 'clienteId', p.cliente_id),
      jsonb_build_object('horas', h.horas, 'pagamentoId', g.id, 'valorCentavos', valor));
  else
    update public.horas_extras set status = 'recusada', decidida_em = now(), decidida_por = auth.uid(), motivo_recusa = m where id = h.id returning * into h;
  end if;
  r := jsonb_build_object('horaExtra', privado.j_hora_extra(h), 'pagamento', case when g.id is not null then privado.j_pagamento(g) end);
  perform privado.idem_gravar('decidirHoraExtra', s, p_chave, conteudo, r);
  return r;
end $$;

create or replace function public.listar_horas_extras(p_filtro jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator();
begin
  if s ->> 'ator' = 'diarista' then
    return (select coalesce(jsonb_agg(privado.j_hora_extra(h) order by h.registrada_em desc), '[]') from public.horas_extras h join public.atendimentos a on a.id = h.atendimento_id
             where a.diarista_id = (s ->> 'id')::uuid and (p_filtro ->> 'atendimentoId' is null or h.atendimento_id::text = p_filtro ->> 'atendimentoId'));
  end if;
  perform privado.exigir_prime(s);
  return (select coalesce(jsonb_agg(privado.j_hora_extra(h) || jsonb_build_object('data', a.data, 'horaInicio', to_char(a.hora_inicio, 'HH24:MI'),
            'cliente', c.nome, 'profissional', d.nome, 'valorCentavos', h.horas * (privado.cfg() #>> '{PRECOS,horaExtraCentavos}')::bigint) order by h.registrada_em desc), '[]')
    from public.horas_extras h join public.atendimentos a on a.id = h.atendimento_id join public.pedidos p on p.id = a.pedido_id
    join public.clientes c on c.id = p.cliente_id left join public.diaristas d on d.id = a.diarista_id
    where (p_filtro ->> 'status' is null or h.status = p_filtro ->> 'status'));
end $$;

-- ---------------------------------------------------------------- prazo vencido
create or replace function privado.prazo_vencido(g public.pagamentos) returns boolean
language sql stable set search_path = '' as $$
  select g.vence_em is not null and ((g.vence_em + coalesce(g.vence_as, time '14:00')) at time zone 'America/Sao_Paulo') <= now()
$$;

/** Dar mais prazo: pendente, nova data e hora no futuro. Os lembretes (C04) seguem o prazo novo. */
create or replace function public.prorrogar_prazo(p_pagamento uuid, p_dados jsonb, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; g public.pagamentos; nova date; hora time; conteudo jsonb := jsonb_build_object('id', p_pagamento, 'd', p_dados -> 'venceEm', 'h', p_dados -> 'venceAs');
begin
  perform privado.exigir_prime(s);
  r := privado.idem_ler('prorrogarPrazo', s, p_chave, conteudo);
  if r is not null then return r; end if;
  begin nova := (p_dados ->> 'venceEm')::date; hora := coalesce(nullif(p_dados ->> 'venceAs', '')::time, time '14:00'); exception when others then perform privado.erro('DADOS_INVALIDOS', 'Data ou hora inválida'); end;
  if nova is null or ((nova + hora) at time zone 'America/Sao_Paulo') <= now() then perform privado.erro('DADOS_INVALIDOS', 'O prazo novo precisa ser no futuro'); end if;
  perform set_config('app.ator', 'prime', true);
  select * into g from public.pagamentos where id = p_pagamento;
  if not found then perform privado.erro('NAO_ENCONTRADO', 'Pagamento não encontrado'); end if;
  perform 1 from public.pedidos where id = g.pedido_id for update;
  select * into g from public.pagamentos where id = p_pagamento for update;
  if g.status <> 'pendente' then perform privado.erro('PAGAMENTO_NAO_ELEGIVEL', 'Só cobrança pendente ganha prazo novo'); end if;
  if g.parcela = 'diaria' and exists (select 1 from public.atendimentos a where a.id = g.atendimento_id and (a.data + a.hora_inicio) <= (nova + hora)) then
    perform privado.erro('DADOS_INVALIDOS', 'O prazo novo precisa ser antes do início da diária'); end if;
  update public.pagamentos set vence_em = nova, vence_as = hora where id = g.id returning * into g;
  perform privado.evento('prazo_prorrogado', jsonb_strip_nulls(jsonb_build_object('pedidoId', g.pedido_id, 'pagamentoId', g.id, 'atendimentoId', g.atendimento_id)), jsonb_build_object('venceEm', nova, 'venceAs', to_char(hora, 'HH24:MI')));
  r := jsonb_build_object('pagamento', privado.j_pagamento(g));
  perform privado.idem_gravar('prorrogarPrazo', s, p_chave, conteudo, r);
  return r;
end $$;

/** Libera a vaga: cancela a diária cuja cobrança venceu sem pagamento (a cobrança é cancelada junto). */
create or replace function privado.liberar_vaga(g public.pagamentos, s jsonb) returns jsonb
language plpgsql set search_path = '' as $$
begin
  if g.status <> 'pendente' then perform privado.erro('PAGAMENTO_NAO_ELEGIVEL', 'Cobrança não está pendente'); end if;
  if g.parcela <> 'diaria' then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Só cobrança de diária libera vaga'); end if;
  if not privado.prazo_vencido(g) then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'O prazo ainda não venceu'); end if;
  return privado.aplicar_transicao(g.atendimento_id, 'cancelar', s, jsonb_build_object('motivo', 'prazo de pagamento vencido'));
end $$;

create or replace function public.liberar_vaga(p_pagamento uuid, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; g public.pagamentos; conteudo jsonb := jsonb_build_object('id', p_pagamento);
begin
  perform privado.exigir_prime(s);
  r := privado.idem_ler('liberarVaga', s, p_chave, conteudo);
  if r is not null then return r; end if;
  perform set_config('app.ator', 'prime', true);
  select * into g from public.pagamentos where id = p_pagamento;
  if not found then perform privado.erro('NAO_ENCONTRADO', 'Pagamento não encontrado'); end if;
  perform 1 from public.pedidos where id = g.pedido_id for update;
  select * into g from public.pagamentos where id = p_pagamento for update;
  r := privado.liberar_vaga(g, s);
  perform privado.idem_gravar('liberarVaga', s, p_chave, conteudo, r);
  return r;
end $$;

/** Rotina (pg_cron a cada 15 min): com a flag ligada, libera as vagas de cobranças vencidas. Registra o ciclo. */
create or replace function privado.liberar_vencidos() returns int
language plpgsql security definer set search_path = '' as $$
declare g public.pagamentos; n int := 0;
begin
  if not privado.flag('p3_liberacao_automatica') then return 0; end if;
  perform set_config('app.ator', 'sistema', true);
  for g in select * from public.pagamentos x where x.status = 'pendente' and x.parcela = 'diaria' and privado.prazo_vencido(x) order by x.vence_em limit 200 loop
    begin
      perform 1 from public.pedidos where id = g.pedido_id for update;
      select * into g from public.pagamentos where id = g.id for update;
      if g.status = 'pendente' then perform privado.liberar_vaga(g, '{"ator": "sistema"}'); n := n + 1; end if;
    exception when others then null; -- diária que não dá mais pra cancelar (já começou): fica pra Prime decidir (I04)
    end;
  end loop;
  return n;
end $$;
select cron.schedule('prime-liberar-vencidos', '*/15 * * * *', $$select privado.liberar_vencidos()$$);

-- ---------------------------------------------------------------- recibos
create table public.recibos (
  numero int primary key check (numero > 0),
  pagamento_id uuid not null unique references public.pagamentos (id),
  emitido_em timestamptz not null default now(),
  dados jsonb not null
);
create table privado.recibos_contador (id boolean primary key default true check (id), ultimo int not null default 0);
insert into privado.recibos_contador values (true, 0);
alter table public.recibos enable row level security;
alter table public.recibos force row level security;
-- leitura só pela RPC (o recibo leva o documento de quem pagou)

/** Snapshot do recibo no momento da confirmação (texto não muda se o cadastro mudar depois). */
create or replace function privado.dados_recibo(g public.pagamentos) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'pagador', c.nome, 'tipoDocumento', c.tipo_documento, 'documento', c.documento, 'razaoSocial', c.razao_social,
    'valorCentavos', g.valor_centavos, 'metodo', g.metodo, 'confirmadoEm', g.confirmado_em, 'pedidoId', p.id,
    'referente', case g.parcela
      when 'pacote' then 'Pacote de diárias de limpeza'
      when 'hora_extra' then 'Hora extra da diária de limpeza de ' || to_char(a.data, 'DD/MM/YYYY')
      else 'Diária de limpeza de ' || to_char(a.data, 'DD/MM/YYYY') || coalesce(', das ' || to_char(a.hora_inicio, 'HH24:MI') || ' às ' || to_char(a.hora_inicio + make_interval(mins => a.duracao_minutos), 'HH24:MI'), '') end)
  from public.pedidos p join public.clientes c on c.id = p.cliente_id left join public.atendimentos a on a.id = g.atendimento_id
  where p.id = g.pedido_id
$$;

/** Número na MESMA transação da confirmação: o contador travado não deixa buraco nem repete. */
create or replace function privado.emitir_recibo() returns trigger
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if new.status = 'confirmado' and old.status is distinct from 'confirmado' and privado.flag('p3_recibos')
     and not exists (select 1 from public.recibos where pagamento_id = new.id) then
    update privado.recibos_contador set ultimo = ultimo + 1 where id returning ultimo into n;
    insert into public.recibos (numero, pagamento_id, dados) values (n, new.id, privado.dados_recibo(new));
  end if;
  return new;
end $$;
create trigger emitir_recibo after update of status on public.pagamentos for each row execute function privado.emitir_recibo();

-- pagamentos já confirmados antes do P3 (hoje só fictícios): recibo na ordem da confirmação
do $$ declare g public.pagamentos; n int; begin
  for g in select * from public.pagamentos where status in ('confirmado', 'estornado') and confirmado_em is not null order by confirmado_em, id loop
    update privado.recibos_contador set ultimo = ultimo + 1 where id returning ultimo into n;
    insert into public.recibos (numero, pagamento_id, emitido_em, dados) values (n, g.id, g.confirmado_em, privado.dados_recibo(g));
  end loop;
end $$;

/** Recibo pra cliente dona ou a Prime; devolve também a situação atual (estornado aparece no PDF). */
create or replace function public.obter_recibo(p_pagamento uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator(); rc public.recibos; g public.pagamentos; p public.pedidos;
begin
  select * into g from public.pagamentos where id = p_pagamento;
  if found then select * into p from public.pedidos where id = g.pedido_id; end if;
  if not found or not privado.pode_ver_pedido(s, p) then perform privado.erro('NAO_ENCONTRADO', 'Recibo não encontrado'); end if;
  select * into rc from public.recibos where pagamento_id = g.id;
  if not found then perform privado.erro('NAO_ENCONTRADO', 'Este pagamento ainda não tem recibo'); end if;
  return rc.dados || jsonb_build_object('numero', rc.numero, 'emitidoEm', rc.emitido_em, 'situacao', g.status, 'estorno', g.estorno);
end $$;

revoke execute on function public.registrar_hora_extra(uuid, jsonb, text), public.decidir_hora_extra(uuid, jsonb, text), public.listar_horas_extras(jsonb),
  public.prorrogar_prazo(uuid, jsonb, text), public.liberar_vaga(uuid, text), public.obter_recibo(uuid) from public, anon;
grant execute on function public.registrar_hora_extra(uuid, jsonb, text), public.decidir_hora_extra(uuid, jsonb, text), public.listar_horas_extras(jsonb),
  public.prorrogar_prazo(uuid, jsonb, text), public.liberar_vaga(uuid, text), public.obter_recibo(uuid) to authenticated;
