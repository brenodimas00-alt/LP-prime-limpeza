-- B3. Casos de uso como RPC (security definer, transacional): mesmas regras de src/app/casos-de-uso.js e src/domain/estados.js.
-- Cada escrita: valida -> idempotência (chave|operação|ator) -> mudança -> evento pendente na MESMA transação.
-- Ator vem do JWT (perfis.papel), nunca do corpo. Erro de negócio: message = CÓDIGO, detail = mensagem, hint = detalhes JSON.
-- Assinatura uniforme: rpc(p_dados jsonb, p_chave text) devolvendo jsonb no formato de docs/API.md (camelCase).

-- ---------- ator e dono ----------
create or replace function privado.ator() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_papel text; v_cli uuid; v_dia uuid;
begin
  if v_uid is null then return jsonb_build_object('ator', 'publico'); end if;
  v_papel := privado.papel();
  if v_papel is null then return jsonb_build_object('ator', 'publico', 'bloqueado', true); end if;
  if v_papel in ('prime_admin', 'prime_atendimento') then return jsonb_build_object('ator', 'prime', 'id', v_uid, 'papel', v_papel); end if;
  if v_papel = 'diarista' then select id into v_dia from public.diaristas where usuario_id = v_uid; return jsonb_build_object('ator', 'diarista', 'id', v_dia, 'usuarioId', v_uid); end if;
  select id into v_cli from public.clientes where usuario_id = v_uid;
  return jsonb_build_object('ator', 'cliente', 'id', v_cli, 'usuarioId', v_uid);
end $$;

create or replace function privado.exigir_prime(s jsonb) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if s ->> 'ator' not in ('prime', 'sistema') then perform privado.erro('ATOR_SEM_PERMISSAO', 'Só a Prime pode fazer isso'); end if;
end $$;

create or replace function privado.pode_ver_pedido(s jsonb, p public.pedidos) returns boolean
language sql immutable set search_path = '' as $$
  select p.id is not null and (s ->> 'ator' in ('prime', 'sistema') or (s ->> 'ator' = 'cliente' and (s ->> 'id')::uuid = p.cliente_id))
$$;

-- ---------- idempotência ----------
create or replace function privado.escopo(s jsonb) returns text
language sql immutable set search_path = '' as $$
  select case when s ->> 'ator' in ('cliente', 'diarista') then (s ->> 'ator') || ':' || coalesce(s ->> 'id', '') else coalesce(s ->> 'ator', 'publico') end
$$;

/** Registra (ou devolve) o resultado de uma chave. Devolve null quando é a primeira vez: o chamador executa e grava. */
create or replace function privado.idem_ler(p_operacao text, s jsonb, p_chave text, p_conteudo jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_id text; v_hash text; v_reg public.idempotencia;
begin
  if p_chave is null or length(p_chave) < 8 or length(p_chave) > 100 then perform privado.erro('DADOS_INVALIDOS', 'chaveIdempotencia obrigatória (8 a 100 caracteres)'); end if;
  v_id := p_operacao || '|' || privado.escopo(s) || '|' || p_chave;
  v_hash := encode(extensions.digest(convert_to(coalesce(p_conteudo::text, 'null'), 'UTF8'), 'sha256'), 'hex');
  -- serializa chamadas simultâneas com a mesma chave (corrida): a segunda espera a primeira e lê o resultado
  perform pg_advisory_xact_lock(hashtextextended('idem:' || v_id, 0));
  select * into v_reg from public.idempotencia where chave = v_id;
  if found then
    if v_reg.hash <> v_hash then perform privado.erro('CONFLITO_IDEMPOTENCIA', 'Esta chave já foi usada com outro conteúdo'); end if;
    return v_reg.resultado || '{"_repetido": true}'::jsonb;
  end if;
  return null;
end $$;

create or replace function privado.idem_gravar(p_operacao text, s jsonb, p_chave text, p_conteudo jsonb, p_resultado jsonb) returns void
language sql set search_path = '' as $$
  insert into public.idempotencia (chave, operacao, hash, resultado)
  values (p_operacao || '|' || privado.escopo(s) || '|' || p_chave, p_operacao,
          encode(extensions.digest(convert_to(coalesce(p_conteudo::text, 'null'), 'UTF8'), 'sha256'), 'hex'), p_resultado)
$$;

create or replace function privado.evento(p_tipo text, p_refs jsonb, p_dados jsonb default '{}') returns void
language sql set search_path = '' as $$
  insert into public.eventos (tipo, refs, dados) values (p_tipo, coalesce(p_refs, '{}'), coalesce(p_dados, '{}'))
$$;

create or replace function privado.agora_iso() returns text
language sql stable set search_path = '' as $$ select to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $$;

-- ---------- serialização (linhas -> JSON de docs/API.md) ----------
create or replace function privado.j_cliente(c public.clientes) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object('id', c.id, 'tipo', c.tipo, 'nome', c.nome, 'telefone', c.telefone, 'email', c.email,
    'cpf', case when c.tipo_documento = 'cpf' then c.documento end, 'cnpj', case when c.tipo_documento = 'cnpj' then c.documento end,
    'razaoSocial', c.razao_social, 'responsavel', c.responsavel, 'endereco', c.endereco, 'origem', c.origem, 'pendencias', to_jsonb(c.pendencias),
    'criadoEm', to_char(c.criado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
$$;

create or replace function privado.j_pedido(p public.pedidos) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object('id', p.id, 'clienteId', p.cliente_id, 'pacote', p.pacote, 'status', p.status, 'historico', p.historico,
    'cancelamento', p.cancelamento, 'atendimentoIds', (select coalesce(jsonb_agg(a.id order by a.sequencia), '[]') from public.atendimentos a where a.pedido_id = p.id),
    'criadoEm', to_char(p.criado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
$$;

create or replace function privado.j_atendimento(a public.atendimentos) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object('id', a.id, 'pedidoId', a.pedido_id, 'sequencia', a.sequencia, 'data', to_char(a.data, 'YYYY-MM-DD'), 'turno', a.turno,
    'diaristaId', a.diarista_id, 'status', a.status, 'historico', a.historico, 'valorDiaCentavos', a.valor_dia_centavos, 'taxaDiaCentavos', a.taxa_dia_centavos,
    'deslocada', a.deslocada, 'dataOriginal', case when a.data_original is not null then to_char(a.data_original, 'YYYY-MM-DD') end, 'versao', a.versao,
    'criadoEm', to_char(a.criado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
$$;

create or replace function privado.j_pagamento(g public.pagamentos) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object('id', g.id, 'pedidoId', g.pedido_id, 'atendimentoId', g.atendimento_id, 'parcela', g.parcela, 'valorCentavos', g.valor_centavos,
    'metodo', g.metodo, 'pixTxid', g.pix_txid, 'status', g.status, 'venceEm', case when g.vence_em is not null then to_char(g.vence_em, 'YYYY-MM-DD') end,
    'venceAs', case when g.vence_as is not null then to_char(g.vence_as, 'HH24:MI') end,
    'informadoEm', case when g.informado_em is not null then to_char(g.informado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
    'confirmadoEm', case when g.confirmado_em is not null then to_char(g.confirmado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
    'chaveIdempotencia', g.chave_idempotencia, 'criadoEm', to_char(g.criado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
    || case when g.brcode is null then '{"brcode": null}'::jsonb else jsonb_build_object('brcode', g.brcode) end
$$;

create or replace function privado.j_diarista(d public.diaristas) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object('id', d.id, 'nome', d.nome, 'cpf', d.cpf, 'telefone', d.telefone, 'email', d.email,
    'dataNascimento', case when d.data_nascimento is not null then to_char(d.data_nascimento, 'YYYY-MM-DD') end, 'endereco', d.endereco,
    'experienciaAnos', d.experiencia_anos, 'disponibilidade', d.disponibilidade, 'identidade', d.identidade, 'status', d.status, 'decisao', d.decisao,
    'historico', d.historico, 'documentos', (select coalesce(jsonb_agg(x.id), '[]') from public.documentos x where x.diarista_id = d.id and x.excluido_em is null),
    'aceiteTermosEm', case when d.aceite_termos_em is not null then to_char(d.aceite_termos_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
    'criadoEm', to_char(d.criado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
$$;

create or replace function privado.j_documento(x public.documentos) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('id', x.id, 'diaristaId', x.diarista_id, 'tipo', x.tipo, 'nomeArquivo', x.nome_arquivo, 'mime', x.mime, 'tamanho', x.tamanho,
    'blobRef', x.storage_path, 'criadoEm', to_char(x.criado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
$$;

create or replace function privado.j_avaliacao(v public.avaliacoes) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('id', v.id, 'atendimentoId', v.atendimento_id, 'notas', v.notas, 'notaFinal', v.nota_final, 'comentario', v.comentario,
    'criadoEm', to_char(v.criado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
$$;

create or replace function privado.pedido_completo(p_id uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('pedido', privado.j_pedido(p), 'cliente', privado.j_cliente(c),
    'atendimentos', (select coalesce(jsonb_agg(privado.j_atendimento(a) order by a.sequencia), '[]') from public.atendimentos a where a.pedido_id = p.id),
    'pagamentos', (select coalesce(jsonb_agg(privado.j_pagamento(g) order by (g.parcela <> 'entrada'), g.vence_em, g.criado_em), '[]') from public.pagamentos g where g.pedido_id = p.id))
    from public.pedidos p join public.clientes c on c.id = p.cliente_id where p.id = p_id
$$;

-- ---------- máquina de estados (estados.js) ----------
create or replace function privado.transicoes() returns jsonb
language sql immutable set search_path = '' as $$ select '{
  "confirmar": {"de": ["agendado"], "para": "confirmado", "atores": ["prime", "sistema"], "condicoes": ["entradaConfirmada"]},
  "sair_a_caminho": {"de": ["confirmado"], "para": "diarista_a_caminho", "atores": ["diarista", "prime"], "condicoes": ["diaristaAprovadaAtribuida"]},
  "iniciar": {"de": ["diarista_a_caminho"], "para": "em_andamento", "atores": ["diarista", "prime"], "condicoes": []},
  "finalizar": {"de": ["em_andamento"], "para": "finalizado", "atores": ["diarista", "prime"], "condicoes": []},
  "avaliar": {"de": ["finalizado"], "para": "avaliado", "atores": ["cliente", "sistema"], "condicoes": []},
  "cancelar": {"de": ["agendado", "confirmado", "diarista_a_caminho"], "para": "cancelado", "atores": ["cliente", "prime", "sistema"], "condicoes": []},
  "reagendar": {"de": ["agendado", "confirmado"], "para": null, "atores": ["cliente", "prime"], "condicoes": ["dataNova"]}
}'::jsonb $$;

create or replace function privado.entrada_confirmada(p_pedido uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from public.pagamentos g where g.pedido_id = p_pedido and g.parcela = 'entrada' and g.status = 'confirmado')
$$;

/** Aplica o evento ao atendimento (já travado pelo chamador): mesma ordem de checagens de transicionar() no JS. */
create or replace function privado.transicionar(a public.atendimentos, p_evento text, s jsonb, p_dados jsonb) returns public.atendimentos
language plpgsql set search_path = '' as $$
declare t jsonb := privado.transicoes() -> p_evento; p public.pedidos; d public.diaristas; para text; c text; novo public.atendimentos;
begin
  if t is null then perform privado.erro('EVENTO_INVALIDO', 'Evento desconhecido: ' || coalesce(p_evento, '')); end if;
  if s ->> 'ator' not in ('cliente', 'prime', 'diarista', 'sistema') then perform privado.erro('ATOR_SEM_PERMISSAO', 'Ator inválido: ' || coalesce(s ->> 'ator', '')); end if;
  if not (t -> 'de') ? a.status then perform privado.erro('TRANSICAO_PROIBIDA', 'Não é possível "' || p_evento || '" a partir de "' || a.status || '"'); end if;
  if not (t -> 'atores') ? (s ->> 'ator') then perform privado.erro('ATOR_SEM_PERMISSAO', '"' || (s ->> 'ator') || '" não pode executar "' || p_evento || '"'); end if;
  select * into p from public.pedidos where id = a.pedido_id;
  if s ->> 'ator' = 'cliente' and (s ->> 'id' is null or (s ->> 'id')::uuid <> p.cliente_id) then perform privado.erro('ATOR_SEM_PERMISSAO', 'Cliente não é o dono deste pedido'); end if;
  if s ->> 'ator' = 'diarista' and (s ->> 'id' is null or (s ->> 'id')::uuid is distinct from a.diarista_id) then perform privado.erro('ATOR_SEM_PERMISSAO', 'Diarista não é a atribuída a este atendimento'); end if;
  for c in select * from jsonb_array_elements_text(t -> 'condicoes') loop
    if c = 'entradaConfirmada' and not privado.entrada_confirmada(a.pedido_id) then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'A entrada ainda não foi confirmada'); end if;
    if c = 'diaristaAprovadaAtribuida' then
      if a.diarista_id is null then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Nenhuma diarista atribuída'); end if;
      select * into d from public.diaristas where id = a.diarista_id;
      if d.status <> 'aprovada' then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Diarista não está aprovada'); end if;
    end if;
    if c = 'dataNova' and (coalesce(p_dados ->> 'data', '') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(p_dados ->> 'turno', '') = '') then
      perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Reagendamento exige nova data e turno'); end if;
  end loop;
  para := coalesce(t ->> 'para', a.status);
  novo := a;
  novo.status := para; novo.versao := a.versao + 1;
  novo.historico := a.historico || jsonb_build_object('de', a.status, 'para', para, 'evento', p_evento, 'em', privado.agora_iso(), 'ator', s ->> 'ator');
  if p_evento = 'reagendar' then novo.data := (p_dados ->> 'data')::date; novo.turno := p_dados ->> 'turno'; novo.deslocada := false; end if;
  return novo;
end $$;

create or replace function privado.derivar_status_pedido(p_status text, p_pedido uuid) returns text
language plpgsql stable set search_path = '' as $$
declare st text[]; tem_ativo boolean; tem_realizado boolean;
begin
  if p_status in ('cancelado', 'concluido', 'rascunho') then return p_status; end if;
  select array_agg(a.status) into st from public.atendimentos a where a.pedido_id = p_pedido;
  if st is not null and array_length(st, 1) > 0 and not exists (select 1 from unnest(st) x where x <> 'cancelado') then return 'cancelado'; end if;
  tem_ativo := exists (select 1 from unnest(st) x where x in ('agendado', 'confirmado', 'diarista_a_caminho', 'em_andamento'));
  tem_realizado := exists (select 1 from unnest(st) x where x in ('finalizado', 'avaliado'));
  if not tem_ativo and tem_realizado then return 'concluido'; end if;
  if p_status = 'aguardando_entrada' and privado.entrada_confirmada(p_pedido) then return 'ativo'; end if;
  return p_status;
end $$;

create or replace function privado.atualizar_status_pedido(p_id uuid, p_ator text, p_evento text) returns public.pedidos
language plpgsql set search_path = '' as $$
declare p public.pedidos; novo text;
begin
  select * into p from public.pedidos where id = p_id for update;
  novo := privado.derivar_status_pedido(p.status, p.id);
  if novo <> p.status then
    update public.pedidos set status = novo, historico = historico || jsonb_build_object('de', p.status, 'para', novo, 'evento', p_evento, 'em', privado.agora_iso(), 'ator', p_ator)
     where id = p.id returning * into p;
  end if;
  return p;
end $$;

create or replace function privado.elegibilidade(g public.pagamentos) returns jsonb
language plpgsql stable set search_path = '' as $$
declare p public.pedidos; a public.atendimentos;
begin
  if g.status = 'confirmado' then return '{"pagavel": false, "motivo": "Pagamento já confirmado pela Prime"}'; end if;
  if g.status = 'cancelado' then return '{"pagavel": false, "motivo": "Cobrança cancelada"}'; end if;
  if g.parcela = 'entrada' then
    select * into p from public.pedidos where id = g.pedido_id;
    if p.status = 'cancelado' then return '{"pagavel": false, "motivo": "Pedido cancelado"}'; end if;
    return '{"pagavel": true}';
  end if;
  select * into a from public.atendimentos where id = g.atendimento_id;
  if a.status not in ('diarista_a_caminho', 'em_andamento', 'finalizado', 'avaliado') then
    return '{"pagavel": false, "motivo": "A parcela do dia fica disponível quando a diarista estiver a caminho"}'; end if;
  return '{"pagavel": true}';
end $$;

/** Transição completa: trava o atendimento, aplica, ajusta parcelas, recalcula o pedido e grava o evento. */
create or replace function privado.aplicar_transicao(p_id uuid, p_evento text, s jsonb, p_dados jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare a public.atendimentos; novo public.atendimentos; p public.pedidos; probs jsonb; cfg jsonb; tipo text;
begin
  select * into a from public.atendimentos where id = p_id for update;
  if not found then perform privado.erro('NAO_ENCONTRADO', 'Atendimento não encontrado'); end if;
  perform 1 from public.pedidos where id = a.pedido_id for update;
  if p_evento = 'reagendar' then
    cfg := privado.cfg();
    if coalesce(p_dados ->> 'data', '') !~ '^\d{4}-\d{2}-\d{2}$' then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Reagendamento exige nova data e turno'); end if;
    probs := privado.validar_ocorrencias(jsonb_build_array(jsonb_build_object('sequencia', a.sequencia, 'data', p_dados ->> 'data')), privado.hoje_sp(), true, cfg);
    if jsonb_array_length(probs) > 0 then perform privado.erro('DATA_INVALIDA', (select string_agg(x ->> 'motivo', '; ') from jsonb_array_elements(probs) x), probs); end if;
    if exists (select 1 from public.atendimentos i where i.pedido_id = a.pedido_id and i.id <> a.id and i.status <> 'cancelado' and i.data = (p_dados ->> 'data')::date) then
      perform privado.erro('DATA_INVALIDA', 'Já existe diária deste pedido nessa data'); end if;
  end if;
  novo := privado.transicionar(a, p_evento, s, p_dados);
  update public.atendimentos set status = novo.status, versao = novo.versao, historico = novo.historico, data = novo.data, turno = novo.turno, deslocada = novo.deslocada where id = a.id;
  if p_evento = 'cancelar' then
    update public.pagamentos set status = 'cancelado' where atendimento_id = a.id and status not in ('confirmado', 'cancelado');
  elsif p_evento = 'reagendar' then
    update public.pagamentos set vence_em = novo.data where atendimento_id = a.id and status = 'pendente';
  end if;
  p := privado.atualizar_status_pedido(a.pedido_id, s ->> 'ator', 'atendimento_' || p_evento);
  tipo := case when p_evento = 'reagendar' then 'atendimento_reagendado' else 'atendimento_' || novo.status end;
  perform privado.evento(tipo, jsonb_strip_nulls(jsonb_build_object('pedidoId', p.id, 'atendimentoId', a.id, 'diaristaId', a.diarista_id, 'clienteId', p.cliente_id)), jsonb_build_object('versao', novo.versao));
  select * into novo from public.atendimentos where id = a.id;
  return jsonb_build_object('atendimento', privado.j_atendimento(novo), 'pedido', privado.j_pedido(p));
end $$;

-- ---------- montar e gravar pedido ----------
create or replace function privado.novo_pagamento(p_pedido uuid, p_atendimento uuid, p_parcela text, p_valor bigint, p_vence date, p_vence_as time, p_chave text) returns public.pagamentos
language plpgsql set search_path = '' as $$
declare txid text := privado.novo_txid(); g public.pagamentos;
begin
  insert into public.pagamentos (pedido_id, atendimento_id, parcela, valor_centavos, metodo, pix_txid, brcode, status, vence_em, vence_as, chave_idempotencia)
  values (p_pedido, p_atendimento, p_parcela, p_valor, 'pix', txid, privado.brcode(p_valor, txid), 'pendente', p_vence, p_vence_as, p_chave) returning * into g;
  return g;
end $$;

/** Cria pedido + atendimentos + entrada + parcelas (montarPedido + gravarPedido). Preço SEMPRE recalculado aqui. */
create or replace function privado.gravar_pedido(c public.clientes, p_pacote jsonb, p_primeira text, p_turno text, p_chave text, p_ficticio boolean) returns jsonb
language plpgsql set search_path = '' as $$
declare cfg jsonb := privado.cfg(); esp jsonb; base jsonb; g jsonb; pacote jsonb; p public.pedidos; it jsonb; a public.atendimentos; ids uuid[] := '{}'; i int := 0; primeira date;
begin
  if coalesce(p_primeira, '') !~ '^\d{4}-\d{2}-\d{2}$' then perform privado.erro('DATA_INVALIDA', 'Data inválida: ' || coalesce(p_primeira, '')); end if;
  begin primeira := p_primeira::date; exception when others then perform privado.erro('DATA_INVALIDA', 'Data inválida: ' || p_primeira); end;
  esp := coalesce(p_pacote, '{}') || jsonb_build_object('tipoCliente', c.tipo, 'endereco', c.endereco);
  base := privado.calcular_pacote(esp, cfg);
  g := privado.gerar_atendimentos(base, primeira, p_turno, privado.hoje_sp(), c.endereco, cfg);
  pacote := g -> 'pacote';
  insert into public.pedidos (cliente_id, pacote, status, historico, total_centavos, entrada_centavos, restante_centavos, ficticio)
  values (c.id, pacote, 'aguardando_entrada', jsonb_build_array(jsonb_build_object('de', 'rascunho', 'para', 'aguardando_entrada', 'evento', 'criar', 'em', privado.agora_iso(), 'ator', 'cliente')),
          (pacote ->> 'totalCentavos')::bigint, (pacote ->> 'entradaCentavos')::bigint, (pacote ->> 'restanteCentavos')::bigint, p_ficticio) returning * into p;
  perform privado.novo_pagamento(p.id, null, 'entrada', (pacote ->> 'entradaCentavos')::bigint, null, null, p_chave || ':entrada');
  for it in select * from jsonb_array_elements(g -> 'itens') loop
    i := i + 1;
    insert into public.atendimentos (pedido_id, sequencia, data, turno, status, valor_dia_centavos, taxa_dia_centavos, deslocada, data_original)
    values (p.id, (it ->> 'sequencia')::int, (it ->> 'data')::date, it ->> 'turno', 'agendado', (it ->> 'valorDiaCentavos')::bigint, (it ->> 'taxaDiaCentavos')::bigint,
            (it ->> 'deslocada')::boolean, case when (it ->> 'deslocada')::boolean then (it ->> 'original')::date end) returning * into a;
    if (it ->> 'parcelaCentavos')::bigint > 0 then
      perform privado.novo_pagamento(p.id, a.id, 'dia', (it ->> 'parcelaCentavos')::bigint, (it ->> 'venceEm')::date, (it ->> 'venceAs')::time, p_chave || ':dia:' || i);
    end if;
  end loop;
  perform privado.evento('pedido_criado', jsonb_build_object('pedidoId', p.id, 'clienteId', c.id));
  return privado.pedido_completo(p.id);
end $$;

-- ================= RPCs públicas (authenticated) =================

/**
 * Autoagendamento: o cliente LOGADO agenda. Cliente importado ou já cadastrado usa o cadastro existente (dados atualizados
 * pelo formulário, sem duplicar). A conta em si nasce pela function "conta" (B2) antes deste passo.
 * p_dados: {cliente, pacote, primeiraData, turno}. Devolve {cliente, pedido, atendimentos, pagamentos, pagamentoEntradaId}.
 */
create or replace function public.confirmar_autoagendamento(p_dados jsonb, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; c jsonb; cli public.clientes; conteudo jsonb; res jsonb; doc text; tipo_doc text;
begin
  if s ->> 'ator' <> 'cliente' or s ->> 'usuarioId' is null then perform privado.erro('ATOR_SEM_PERMISSAO', 'Entre na sua conta pra agendar'); end if;
  c := privado.normalizar_cliente(p_dados -> 'cliente');
  conteudo := jsonb_build_object('cliente', c, 'pacote', p_dados -> 'pacote', 'primeiraData', p_dados -> 'primeiraData', 'turno', p_dados -> 'turno');
  r := privado.idem_ler('confirmarAutoagendamento', s, p_chave, conteudo);
  if r is not null then return r; end if;
  perform set_config('app.ator', 'cliente', true);
  select * into cli from public.clientes where usuario_id = (s ->> 'usuarioId')::uuid for update;
  tipo_doc := case when c ? 'cnpj' then 'cnpj' when c ? 'cpf' then 'cpf' end;
  doc := coalesce(c ->> 'cnpj', c ->> 'cpf');
  if found then
    -- cadastro existente (importado ou do site): atualiza os dados informados, mantém o documento se já havia
    if cli.documento is not null and doc is not null and (cli.tipo_documento, cli.documento) <> (tipo_doc, doc) then
      perform privado.erro('DADOS_INVALIDOS', 'O CPF/CNPJ informado não confere com o do seu cadastro. Fale com a Prime.', jsonb_build_object(coalesce(tipo_doc, 'cpf'), 'Não confere com o cadastro'));
    end if;
    update public.clientes set tipo = c ->> 'tipo', nome = c ->> 'nome', telefone = c ->> 'telefone', email = coalesce(email, c ->> 'email'),
      tipo_documento = coalesce(tipo_documento, tipo_doc), documento = coalesce(documento, doc),
      razao_social = c ->> 'razaoSocial', responsavel = c ->> 'responsavel', endereco = c -> 'endereco'
     where id = cli.id returning * into cli;
  else
    insert into public.clientes (usuario_id, tipo, nome, telefone, email, tipo_documento, documento, razao_social, responsavel, endereco, origem, ficticio)
    values ((s ->> 'usuarioId')::uuid, c ->> 'tipo', c ->> 'nome', c ->> 'telefone', c ->> 'email', tipo_doc, doc, c ->> 'razaoSocial', c ->> 'responsavel', c -> 'endereco', 'site',
            coalesce((select (u.raw_user_meta_data ->> 'ficticio')::boolean from auth.users u where u.id = (s ->> 'usuarioId')::uuid), false))
    returning * into cli;
  end if;
  res := privado.gravar_pedido(cli, p_dados -> 'pacote', p_dados ->> 'primeiraData', p_dados ->> 'turno', p_chave, cli.ficticio);
  res := res || jsonb_build_object('pagamentoEntradaId', (select g ->> 'id' from jsonb_array_elements(res -> 'pagamentos') g where g ->> 'parcela' = 'entrada'));
  perform privado.idem_gravar('confirmarAutoagendamento', s, p_chave, conteudo, res);
  return res;
exception when unique_violation then
  perform privado.erro('DADOS_INVALIDOS', 'Já existe cadastro com este CPF/CNPJ. Entre com a conta dele ou fale com a Prime.', jsonb_build_object(coalesce(tipo_doc, 'cpf'), 'Já cadastrado'));
end $$;

create or replace function public.obter_pedido(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator(); p public.pedidos;
begin
  select * into p from public.pedidos where id = p_id;
  if not privado.pode_ver_pedido(s, p) then perform privado.erro('NAO_ENCONTRADO', 'Pedido não encontrado'); end if;
  return privado.pedido_completo(p.id);
end $$;

create or replace function public.listar_pedidos(p_filtro jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator(); itens jsonb;
begin
  if s ->> 'ator' = 'cliente' then
    select coalesce(jsonb_agg(privado.j_pedido(p) order by p.criado_em desc), '[]') into itens from public.pedidos p where p.cliente_id = (s ->> 'id')::uuid;
  elsif s ->> 'ator' = 'prime' then
    select coalesce(jsonb_agg(privado.j_pedido(p) order by p.criado_em desc), '[]') into itens from public.pedidos p
     where p_filtro ->> 'clienteId' is null or p.cliente_id = (p_filtro ->> 'clienteId')::uuid;
  else perform privado.erro('ATOR_SEM_PERMISSAO', 'Sem permissão'); end if;
  return jsonb_build_object('itens', itens);
end $$;

create or replace function public.obter_atendimento(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator(); a public.atendimentos; p public.pedidos; c public.clientes; d public.diaristas; g public.pagamentos; v public.avaliacoes;
begin
  select * into a from public.atendimentos where id = p_id;
  if found then select * into p from public.pedidos where id = a.pedido_id; end if;
  if not found or not (privado.pode_ver_pedido(s, p) or (s ->> 'ator' = 'diarista' and (s ->> 'id')::uuid is not distinct from a.diarista_id and a.diarista_id is not null)) then
    perform privado.erro('NAO_ENCONTRADO', 'Atendimento não encontrado'); end if;
  select * into c from public.clientes where id = p.cliente_id;
  if a.diarista_id is not null then select * into d from public.diaristas where id = a.diarista_id; end if;
  select * into g from public.pagamentos where atendimento_id = a.id and parcela = 'dia' and status <> 'cancelado' limit 1;
  select * into v from public.avaliacoes where atendimento_id = a.id;
  return jsonb_build_object('atendimento', privado.j_atendimento(a), 'pedido', privado.j_pedido(p),
    'cliente', jsonb_build_object('id', c.id, 'nome', c.nome, 'endereco', jsonb_build_object('bairro', c.endereco ->> 'bairro', 'cidade', c.endereco ->> 'cidade')),
    'diarista', case when d.id is not null then jsonb_build_object('id', d.id, 'nome', d.nome, 'status', d.status) end,
    'pagamentoDia', case when g.id is not null then privado.j_pagamento(g) end, 'avaliacao', case when v.id is not null then privado.j_avaliacao(v) end);
end $$;

create or replace function public.transicionar_atendimento(p_id uuid, p_dados jsonb, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; a public.atendimentos; p public.pedidos; conteudo jsonb := jsonb_build_object('id', p_id, 'ev', p_dados -> 'evento', 'dados', p_dados -> 'dados');
begin
  r := privado.idem_ler('transicionarAtendimento', s, p_chave, conteudo);
  if r is not null then return r; end if;
  perform set_config('app.ator', s ->> 'ator', true);
  select * into a from public.atendimentos where id = p_id;
  if found then select * into p from public.pedidos where id = a.pedido_id; end if;
  if not found or not (privado.pode_ver_pedido(s, p) or (s ->> 'ator' = 'diarista' and a.diarista_id is not null and (s ->> 'id')::uuid is not distinct from a.diarista_id)) then
    perform privado.erro('NAO_ENCONTRADO', 'Atendimento não encontrado'); end if;
  if p_dados ->> 'evento' = 'avaliar' and s ->> 'ator' = 'cliente' then perform privado.erro('ATOR_SEM_PERMISSAO', 'Use a avaliação para avaliar'); end if;
  r := privado.aplicar_transicao(p_id, p_dados ->> 'evento', s, p_dados -> 'dados');
  perform privado.idem_gravar('transicionarAtendimento', s, p_chave, conteudo, r);
  return r;
end $$;

create or replace function public.atribuir_diarista(p_id uuid, p_dados jsonb, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; a public.atendimentos; d public.diaristas; ocupada public.atendimentos; conteudo jsonb := jsonb_build_object('id', p_id, 'diaristaId', p_dados -> 'diaristaId'); did uuid;
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
  select * into ocupada from public.atendimentos x where x.diarista_id = did and x.id <> a.id and x.data = a.data and x.status <> 'cancelado'
    and (x.turno = a.turno or x.turno = 'integral' or a.turno = 'integral') limit 1;
  if found then perform privado.erro('CONDICAO_NAO_ATENDIDA', split_part(d.nome, ' ', 1) || ' já tem diária em ' || to_char(a.data, 'YYYY-MM-DD') || ' nesse período'); end if;
  update public.atendimentos set diarista_id = did, versao = versao + 1 where id = a.id returning * into a;
  perform privado.evento('atendimento_atribuido', jsonb_build_object('pedidoId', a.pedido_id, 'atendimentoId', a.id, 'diaristaId', did), jsonb_build_object('anterior', null, 'versao', a.versao));
  r := jsonb_build_object('atendimento', privado.j_atendimento(a));
  perform privado.idem_gravar('atribuirDiarista', s, p_chave, conteudo, r);
  return r;
end $$;

create or replace function public.obter_pagamento(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator(); g public.pagamentos; p public.pedidos; a public.atendimentos;
begin
  select * into g from public.pagamentos where id = p_id;
  if found then select * into p from public.pedidos where id = g.pedido_id; end if;
  if not found or not privado.pode_ver_pedido(s, p) then perform privado.erro('NAO_ENCONTRADO', 'Pagamento não encontrado'); end if;
  if g.atendimento_id is not null then select * into a from public.atendimentos where id = g.atendimento_id; end if;
  return jsonb_build_object('pagamento', privado.j_pagamento(g), 'pedido', privado.j_pedido(p),
    'atendimento', case when a.id is not null then privado.j_atendimento(a) end, 'elegibilidade', privado.elegibilidade(g));
end $$;

create or replace function public.informar_pagamento(p_id uuid, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; g public.pagamentos; p public.pedidos; el jsonb; conteudo jsonb := jsonb_build_object('id', p_id);
begin
  r := privado.idem_ler('informarPagamento', s, p_chave, conteudo);
  if r is not null then return r; end if;
  perform set_config('app.ator', s ->> 'ator', true);
  select * into g from public.pagamentos where id = p_id for update;
  if found then select * into p from public.pedidos where id = g.pedido_id; end if;
  if not found or not privado.pode_ver_pedido(s, p) then perform privado.erro('NAO_ENCONTRADO', 'Pagamento não encontrado'); end if;
  if s ->> 'ator' not in ('cliente', 'prime') then perform privado.erro('ATOR_SEM_PERMISSAO', 'Só a cliente informa o pagamento'); end if;
  if g.status = 'informado_pelo_cliente' then r := privado.j_pagamento(g); perform privado.idem_gravar('informarPagamento', s, p_chave, conteudo, r); return r; end if;
  el := privado.elegibilidade(g);
  if not (el ->> 'pagavel')::boolean then perform privado.erro('PAGAMENTO_NAO_ELEGIVEL', el ->> 'motivo'); end if;
  update public.pagamentos set status = 'informado_pelo_cliente', informado_em = now() where id = g.id returning * into g;
  perform privado.evento('pagamento_informado', jsonb_strip_nulls(jsonb_build_object('pedidoId', g.pedido_id, 'pagamentoId', g.id, 'atendimentoId', g.atendimento_id, 'clienteId', p.cliente_id)));
  r := privado.j_pagamento(g);
  perform privado.idem_gravar('informarPagamento', s, p_chave, conteudo, r);
  return r;
end $$;

/** Confirmação manual pela Prime agora; o webhook do Asaas (B4) chama a mesma função como ator sistema. */
create or replace function public.confirmar_pagamento(p_id uuid, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; g public.pagamentos; p public.pedidos; el jsonb; a public.atendimentos; conteudo jsonb := jsonb_build_object('id', p_id); ats jsonb;
begin
  perform privado.exigir_prime(s);
  r := privado.idem_ler('confirmarPagamento', s, p_chave, conteudo);
  if r is not null then return r; end if;
  perform set_config('app.ator', s ->> 'ator', true);
  select * into g from public.pagamentos where id = p_id for update;
  if not found then perform privado.erro('NAO_ENCONTRADO', 'Pagamento não encontrado'); end if;
  select * into p from public.pedidos where id = g.pedido_id for update;
  el := privado.elegibilidade(g);
  if not (el ->> 'pagavel')::boolean then perform privado.erro('PAGAMENTO_NAO_ELEGIVEL', el ->> 'motivo'); end if;
  update public.pagamentos set status = 'confirmado', confirmado_em = now(), confirmado_por = auth.uid(), metodo = case when s ->> 'ator' = 'prime' then 'manual' else metodo end
   where id = g.id returning * into g;
  perform privado.evento('pagamento_confirmado', jsonb_strip_nulls(jsonb_build_object('pedidoId', g.pedido_id, 'pagamentoId', g.id, 'atendimentoId', g.atendimento_id, 'clienteId', p.cliente_id)), jsonb_build_object('parcela', g.parcela));
  if g.parcela = 'entrada' and p.status = 'aguardando_entrada' then
    for a in select * from public.atendimentos where pedido_id = p.id and status = 'agendado' order by sequencia loop
      perform privado.aplicar_transicao(a.id, 'confirmar', '{"ator": "sistema"}', null);
    end loop;
    p := privado.atualizar_status_pedido(p.id, 'sistema', 'entrada_confirmada');
  end if;
  select coalesce(jsonb_agg(privado.j_atendimento(x) order by x.sequencia), '[]') into ats from public.atendimentos x where x.pedido_id = p.id;
  r := jsonb_build_object('pagamento', privado.j_pagamento(g), 'pedido', privado.j_pedido(p), 'atendimentos', ats);
  perform privado.idem_gravar('confirmarPagamento', s, p_chave, conteudo, r);
  return r;
end $$;

create or replace function public.cancelar_pedido(p_id uuid, p_dados jsonb, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; p public.pedidos; a public.atendimentos; novo public.atendimentos; cancelados uuid[] := '{}'; algum_realizado boolean; novo_status text; motivo text;
        conteudo jsonb := jsonb_build_object('id', p_id, 'motivo', p_dados -> 'motivo');
begin
  r := privado.idem_ler('cancelarPedido', s, p_chave, conteudo);
  if r is not null then return r; end if;
  perform set_config('app.ator', s ->> 'ator', true);
  select * into p from public.pedidos where id = p_id for update;
  if not found or not privado.pode_ver_pedido(s, p) then perform privado.erro('NAO_ENCONTRADO', 'Pedido não encontrado'); end if;
  if s ->> 'ator' not in ('cliente', 'prime') then perform privado.erro('ATOR_SEM_PERMISSAO', 'Sem permissão'); end if;
  if p.status in ('cancelado', 'concluido') then perform privado.erro('TRANSICAO_PROIBIDA', 'Pedido já está ' || p.status); end if;
  for a in select * from public.atendimentos where pedido_id = p.id order by sequencia for update loop
    if a.status in ('agendado', 'confirmado', 'diarista_a_caminho') then
      novo := privado.transicionar(a, 'cancelar', s, null);
      update public.atendimentos set status = novo.status, versao = novo.versao, historico = novo.historico where id = a.id;
      cancelados := cancelados || a.id;
    end if;
  end loop;
  algum_realizado := exists (select 1 from public.atendimentos x where x.pedido_id = p.id and x.status in ('finalizado', 'avaliado', 'em_andamento'));
  update public.pagamentos set status = 'cancelado' where pedido_id = p.id and status in ('pendente', 'informado_pelo_cliente')
     and ((parcela = 'dia' and atendimento_id = any(cancelados)) or (parcela = 'entrada' and not algum_realizado));
  novo_status := privado.derivar_status_pedido(p.status, p.id);
  motivo := regexp_replace(trim(coalesce(p_dados ->> 'motivo', '')), '\s+', ' ', 'g');
  update public.pedidos set status = novo_status,
    historico = case when novo_status <> p.status then historico || jsonb_build_object('de', p.status, 'para', novo_status, 'evento', 'cancelar_pedido', 'em', privado.agora_iso(), 'ator', s ->> 'ator') else historico end,
    cancelamento = jsonb_build_object('em', privado.agora_iso(), 'ator', s ->> 'ator', 'motivo', motivo, 'atendimentosCancelados', to_jsonb(cancelados))
   where id = p.id;
  perform privado.evento('pedido_cancelado', jsonb_build_object('pedidoId', p.id, 'clienteId', p.cliente_id), jsonb_build_object('atendimentosCancelados', to_jsonb(cancelados)));
  r := privado.pedido_completo(p.id) - 'cliente';
  perform privado.idem_gravar('cancelarPedido', s, p_chave, conteudo, r);
  return r;
end $$;

create or replace function public.criar_avaliacao(p_atendimento uuid, p_dados jsonb, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; a public.atendimentos; p public.pedidos; n jsonb; texto text; v public.avaliacoes; tr jsonb;
        crit text[] := array['pontualidade', 'qualidade', 'cuidado', 'comunicacao']; k text; conteudo jsonb;
begin
  n := '{}';
  foreach k in array crit loop
    if not privado.eh_inteiro(p_dados -> 'notas' -> k) or (p_dados -> 'notas' ->> k)::int not between 1 and 5 then perform privado.erro('DADOS_INVALIDOS', 'Dê uma nota de 1 a 5 em cada critério'); end if;
    n := n || jsonb_build_object(k, (p_dados -> 'notas' ->> k)::int);
  end loop;
  texto := trim(coalesce(p_dados ->> 'comentario', ''));
  if length(texto) > 500 then perform privado.erro('DADOS_INVALIDOS', 'Comentário com no máximo 500 caracteres'); end if;
  conteudo := jsonb_build_object('atendimentoId', p_atendimento, 'n', n, 'texto', texto);
  r := privado.idem_ler('criarAvaliacao', s, p_chave, conteudo);
  if r is not null then return r; end if;
  perform set_config('app.ator', s ->> 'ator', true);
  select * into a from public.atendimentos where id = p_atendimento for update;
  if found then select * into p from public.pedidos where id = a.pedido_id; end if;
  if not found or not privado.pode_ver_pedido(s, p) then perform privado.erro('NAO_ENCONTRADO', 'Atendimento não encontrado'); end if;
  if s ->> 'ator' <> 'cliente' then perform privado.erro('ATOR_SEM_PERMISSAO', 'Só a cliente avalia'); end if;
  if a.status = 'avaliado' or exists (select 1 from public.avaliacoes where atendimento_id = a.id) then perform privado.erro('JA_AVALIADO', 'Esta diária já foi avaliada'); end if;
  if a.status <> 'finalizado' then perform privado.erro('TRANSICAO_PROIBIDA', 'A avaliação abre quando a diária é finalizada'); end if;
  insert into public.avaliacoes (atendimento_id, notas, nota_final, comentario) values (a.id, n, privado.nota_final(n), texto) returning * into v;
  tr := privado.aplicar_transicao(a.id, 'avaliar', s, null);
  r := jsonb_build_object('avaliacao', privado.j_avaliacao(v), 'atendimento', tr -> 'atendimento');
  perform privado.idem_gravar('criarAvaliacao', s, p_chave, conteudo, r);
  return r;
end $$;

create or replace function public.obter_avaliacao_do_atendimento(p_atendimento uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator(); a public.atendimentos; p public.pedidos; v public.avaliacoes;
begin
  select * into a from public.atendimentos where id = p_atendimento;
  if found then select * into p from public.pedidos where id = a.pedido_id; end if;
  if not found or not privado.pode_ver_pedido(s, p) then perform privado.erro('NAO_ENCONTRADO', 'Atendimento não encontrado'); end if;
  select * into v from public.avaliacoes where atendimento_id = a.id;
  if not found then perform privado.erro('NAO_ENCONTRADO', 'Avaliação não encontrado'); end if;
  return privado.j_avaliacao(v);
end $$;

-- ---------- diaristas ----------
create or replace function privado.dia_pode_ver(s jsonb, p_diarista uuid) returns boolean
language sql immutable set search_path = '' as $$
  select s ->> 'ator' in ('prime', 'sistema') or (s ->> 'ator' = 'diarista' and (s ->> 'id')::uuid = p_diarista)
$$;

/** Rascunho do cadastro: a diarista LOGADA (conta criada pela function "conta") tem um rascunho vinculado a ela. */
create or replace function privado.rascunho_da_sessao(s jsonb, p_id uuid) returns public.diaristas
language plpgsql set search_path = '' as $$
declare d public.diaristas; uid uuid := (s ->> 'usuarioId')::uuid;
begin
  if uid is null then perform privado.erro('ATOR_SEM_PERMISSAO', 'Entre na sua conta pra continuar o cadastro'); end if;
  select * into d from public.diaristas where id = p_id for update;
  if found then
    if d.usuario_id is distinct from uid and s ->> 'ator' <> 'prime' then perform privado.erro('NAO_ENCONTRADO', 'Cadastro não encontrado'); end if;
    return d;
  end if;
  if exists (select 1 from public.diaristas where usuario_id = uid) then perform privado.erro('DADOS_INVALIDOS', 'Você já tem um cadastro. Use o mesmo.'); end if;
  insert into public.diaristas (id, usuario_id, status, ficticio)
  values (p_id, uid, 'rascunho', coalesce((select (u.raw_user_meta_data ->> 'ficticio')::boolean from auth.users u where u.id = uid), false)) returning * into d;
  update public.perfis set papel = 'diarista' where user_id = uid and papel = 'cliente';
  return d;
end $$;

/** Registra o documento já gravado no bucket (o upload é feito pelo front direto no Storage, com policy por dono; B6 endurece). */
create or replace function public.registrar_documento(p_dados jsonb, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; d public.diaristas; x public.documentos; conteudo jsonb; did uuid; caminho text;
begin
  conteudo := jsonb_build_object('diaristaId', p_dados -> 'diaristaId', 'tipo', p_dados -> 'tipo', 'nomeArquivo', p_dados -> 'nomeArquivo', 'mime', p_dados -> 'mime', 'tamanho', p_dados -> 'tamanho', 'storagePath', p_dados -> 'storagePath');
  if coalesce(p_dados ->> 'tipo', '') not in ('rg_frente', 'rg_verso', 'cnh_frente', 'cnh_verso', 'cpf', 'comprovante_residencia', 'foto_perfil', 'antecedentes') then perform privado.erro('DADOS_INVALIDOS', 'Tipo de documento inválido'); end if;
  begin did := (p_dados ->> 'diaristaId')::uuid; exception when others then perform privado.erro('DADOS_INVALIDOS', 'Id do cadastro inválido'); end;
  r := privado.idem_ler('salvarDocumento', s, p_chave, conteudo);
  if r is not null then return r; end if;
  perform set_config('app.ator', s ->> 'ator', true);
  d := privado.rascunho_da_sessao(s, did);
  if d.status <> 'rascunho' and s ->> 'ator' <> 'prime' then perform privado.erro('ATOR_SEM_PERMISSAO', 'Cadastro já enviado; fale com a Prime pra trocar documentos'); end if;
  caminho := p_dados ->> 'storagePath';
  if caminho !~ ('^diaristas/' || d.id || '/[a-z_]+-[0-9a-f-]{36}\.(jpg|png|pdf)$') then perform privado.erro('DADOS_INVALIDOS', 'Caminho do arquivo inválido'); end if;
  if coalesce(p_dados ->> 'mime', '') not in ('image/jpeg', 'image/png', 'application/pdf') then perform privado.erro('DADOS_INVALIDOS', 'Formato não aceito: use JPG, PNG ou PDF'); end if;
  update public.documentos set excluido_em = now() where diarista_id = d.id and tipo = p_dados ->> 'tipo' and excluido_em is null;
  insert into public.documentos (diarista_id, tipo, nome_arquivo, mime, tamanho, storage_path)
  values (d.id, p_dados ->> 'tipo', left(p_dados ->> 'nomeArquivo', 120), p_dados ->> 'mime', (p_dados ->> 'tamanho')::int, caminho) returning * into x;
  r := privado.j_documento(x);
  perform privado.idem_gravar('salvarDocumento', s, p_chave, conteudo, r);
  return r;
end $$;

create or replace function public.listar_documentos(p_diarista uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator(); d public.diaristas;
begin
  select * into d from public.diaristas where id = p_diarista;
  if found and not (privado.dia_pode_ver(s, d.id) or (d.status = 'rascunho' and d.usuario_id = (s ->> 'usuarioId')::uuid)) then perform privado.erro('NAO_ENCONTRADO', 'Cadastro não encontrado'); end if;
  return jsonb_build_object('itens', (select coalesce(jsonb_agg(privado.j_documento(x) order by x.criado_em), '[]') from public.documentos x where x.diarista_id = p_diarista and x.excluido_em is null));
end $$;

create or replace function public.cadastrar_diarista(p_dados jsonb, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; d public.diaristas; erros jsonb := '{}'; m text; end_e jsonb; cfg jsonb := privado.cfg(); hoje date := privado.hoje_sp();
        disp jsonb; dias jsonb; turnos jsonb; regioes jsonb; faltando text[]; exigidos text[]; presentes text[]; conteudo jsonb; did uuid; nasc date; anos numeric;
        nome text; cpf text; tel text; email text; e jsonb;
begin
  begin did := (p_dados ->> 'id')::uuid; exception when others then perform privado.erro('DADOS_INVALIDOS', 'Id do cadastro inválido'); end;
  nome := regexp_replace(trim(coalesce(p_dados ->> 'nome', '')), '\s+', ' ', 'g'); cpf := privado.so_digitos(p_dados ->> 'cpf'); tel := privado.so_digitos(p_dados ->> 'telefone');
  email := lower(trim(coalesce(p_dados ->> 'email', '')));
  e := coalesce(p_dados -> 'endereco', '{}');
  end_e := jsonb_build_object('cep', privado.so_digitos(e ->> 'cep'), 'logradouro', regexp_replace(trim(coalesce(e ->> 'logradouro', '')), '\s+', ' ', 'g'), 'numero', regexp_replace(trim(coalesce(e ->> 'numero', '')), '\s+', ' ', 'g'),
    'complemento', regexp_replace(trim(coalesce(e ->> 'complemento', '')), '\s+', ' ', 'g'), 'bairro', regexp_replace(trim(coalesce(e ->> 'bairro', '')), '\s+', ' ', 'g'), 'cidade', regexp_replace(trim(coalesce(e ->> 'cidade', '')), '\s+', ' ', 'g'), 'uf', upper(coalesce(e ->> 'uf', '')));
  disp := coalesce(p_dados -> 'disponibilidade', '{}');
  select coalesce(jsonb_agg(distinct x order by x), '[]') into dias from jsonb_array_elements(case when jsonb_typeof(disp -> 'dias') = 'array' then disp -> 'dias' else '[]' end) x;
  select coalesce(jsonb_agg(distinct x), '[]') into turnos from jsonb_array_elements(case when jsonb_typeof(disp -> 'turnos') = 'array' then disp -> 'turnos' else '[]' end) x;
  select coalesce(jsonb_agg(distinct x), '[]') into regioes from jsonb_array_elements(case when jsonb_typeof(disp -> 'regioes') = 'array' then disp -> 'regioes' else '[]' end) x;
  m := privado.v_nome(nome); if m <> '' then erros := erros || jsonb_build_object('nome', m); end if;
  m := privado.v_cpf(cpf); if m <> '' then erros := erros || jsonb_build_object('cpf', m); end if;
  m := privado.v_telefone(tel); if m <> '' then erros := erros || jsonb_build_object('telefone', m); end if;
  m := privado.v_email(email); if m <> '' then erros := erros || jsonb_build_object('email', m); end if;
  begin nasc := (p_dados ->> 'dataNascimento')::date; exception when others then nasc := null; end;
  if coalesce(p_dados ->> 'dataNascimento', '') = '' then erros := erros || '{"dataNascimento": "Informe a data"}';
  elsif nasc is null or to_char(nasc, 'YYYY-MM-DD') <> (p_dados ->> 'dataNascimento') then erros := erros || '{"dataNascimento": "Data inválida"}';
  else
    anos := floor((hoje - nasc) / 365.25);
    if anos < 18 then erros := erros || '{"dataNascimento": "É preciso ter 18 anos ou mais"}'; elsif anos > 90 then erros := erros || '{"dataNascimento": "Confira o ano de nascimento"}'; end if;
  end if;
  select erros || coalesce(jsonb_object_agg('endereco.' || k, v), '{}') into erros from jsonb_each(privado.v_endereco(end_e)) as x(k, v);
  if not privado.eh_inteiro(p_dados -> 'experienciaAnos') or (p_dados ->> 'experienciaAnos')::int not between 0 and 60 then erros := erros || '{"experienciaAnos": "Informe os anos de experiência (0 a 60)"}'; end if;
  if jsonb_array_length(dias) = 0 or exists (select 1 from jsonb_array_elements(dias) x where not privado.eh_inteiro(x) or (x #>> '{}')::int not between 0 and 6) then erros := erros || '{"disponibilidade.dias": "Marque pelo menos um dia"}'; end if;
  if jsonb_array_length(turnos) = 0 or exists (select 1 from jsonb_array_elements_text(turnos) x where x not in ('manha', 'tarde', 'integral')) then erros := erros || '{"disponibilidade.turnos": "Marque pelo menos um turno"}'; end if;
  if jsonb_array_length(regioes) = 0 then erros := erros || '{"disponibilidade.regioes": "Marque pelo menos uma região"}';
  elsif exists (select 1 from jsonb_array_elements_text(regioes) x where not (cfg -> 'regioesDiarista') ? x) then erros := erros || '{"disponibilidade.regioes": "Região inválida"}'; end if;
  if coalesce(p_dados ->> 'identidade', '') not in ('rg', 'cnh') then erros := erros || '{"identidade": "Escolha RG ou CNH"}'; end if;
  if (p_dados -> 'aceiteTermos') is distinct from 'true'::jsonb then erros := erros || '{"aceiteTermos": "É preciso aceitar os termos"}'; end if;
  if erros <> '{}' then perform privado.erro('DADOS_INVALIDOS', (select v #>> '{}' from jsonb_each(erros) y(k, v) limit 1), erros); end if;
  conteudo := jsonb_build_object('id', did, 'nome', nome, 'cpf', cpf, 'telefone', tel, 'email', email, 'dataNascimento', p_dados ->> 'dataNascimento', 'endereco', end_e, 'experienciaAnos', (p_dados ->> 'experienciaAnos')::int,
    'disponibilidade', jsonb_build_object('dias', dias, 'turnos', turnos, 'regioes', regioes), 'identidade', p_dados ->> 'identidade');
  r := privado.idem_ler('cadastrarDiarista', s, p_chave, conteudo);
  if r is not null then return r; end if;
  perform set_config('app.ator', s ->> 'ator', true);
  d := privado.rascunho_da_sessao(s, did);
  if d.status <> 'rascunho' then perform privado.erro('DADOS_INVALIDOS', 'Este cadastro já foi enviado'); end if;
  exigidos := case when p_dados ->> 'identidade' = 'cnh' then array['cnh_frente', 'cnh_verso'] else array['rg_frente', 'rg_verso', 'cpf'] end || array['comprovante_residencia', 'foto_perfil', 'antecedentes'];
  select coalesce(array_agg(x.tipo), '{}') into presentes from public.documentos x where x.diarista_id = d.id and x.excluido_em is null;
  select coalesce(array_agg(t), '{}') into faltando from unnest(exigidos) t where not (t = any(presentes));
  if array_length(faltando, 1) > 0 then perform privado.erro('DADOS_INVALIDOS', 'Faltam documentos obrigatórios', jsonb_build_object('documentos', to_jsonb(faltando))); end if;
  begin
    update public.diaristas set nome = nome_novo.n, cpf = cpf, telefone = tel, email = email, data_nascimento = nasc, endereco = end_e, experiencia_anos = (p_dados ->> 'experienciaAnos')::int,
      disponibilidade = jsonb_build_object('dias', dias, 'turnos', turnos, 'regioes', regioes), identidade = p_dados ->> 'identidade', status = 'pendente', aceite_termos_em = now()
     from (select nome as n) nome_novo where id = d.id returning * into d;
  exception when unique_violation then
    perform privado.erro('DADOS_INVALIDOS', 'Já existe cadastro com este CPF ou e-mail', '{"cpf": "Já cadastrado"}');
  end;
  update public.perfis set papel = 'diarista' where user_id = d.usuario_id and papel = 'cliente';
  perform privado.evento('diarista_cadastrada', jsonb_build_object('diaristaId', d.id));
  r := privado.j_diarista(d);
  perform privado.idem_gravar('cadastrarDiarista', s, p_chave, conteudo, r);
  return r;
end $$;

create or replace function public.obter_diarista(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator(); d public.diaristas;
begin
  select * into d from public.diaristas where id = p_id;
  if not found or not privado.dia_pode_ver(s, d.id) then perform privado.erro('NAO_ENCONTRADO', 'Cadastro não encontrado'); end if;
  return jsonb_build_object('diarista', privado.j_diarista(d), 'documentos', (select coalesce(jsonb_agg(privado.j_documento(x) order by x.criado_em), '[]') from public.documentos x where x.diarista_id = d.id and x.excluido_em is null));
end $$;

create or replace function public.listar_diaristas(p_filtro jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator();
begin
  perform privado.exigir_prime(s);
  return jsonb_build_object('itens', (select coalesce(jsonb_agg(privado.j_diarista(d) order by d.criado_em), '[]') from public.diaristas d
    where d.status <> 'rascunho' and (p_filtro ->> 'status' is null or d.status = p_filtro ->> 'status')));
end $$;

create or replace function privado.decidir_diarista(p_id uuid, p_status text, p_dados jsonb, p_chave text) returns jsonb
language plpgsql set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; d public.diaristas; op text := case when p_status = 'aprovada' then 'aprovarDiarista' else 'reprovarDiarista' end;
        conteudo jsonb := jsonb_build_object('id', p_id, 'motivo', p_dados -> 'motivo');
begin
  perform privado.exigir_prime(s);
  r := privado.idem_ler(op, s, p_chave, conteudo);
  if r is not null then return r; end if;
  perform set_config('app.ator', 'prime', true);
  select * into d from public.diaristas where id = p_id for update;
  if not found then perform privado.erro('NAO_ENCONTRADO', 'Diarista não encontrado'); end if;
  if d.status <> 'pendente' then perform privado.erro('TRANSICAO_PROIBIDA', 'Cadastro já está ' || d.status); end if;
  update public.diaristas set status = p_status, decisao = jsonb_build_object('em', privado.agora_iso(), 'motivo', regexp_replace(trim(coalesce(p_dados ->> 'motivo', '')), '\s+', ' ', 'g'), 'por', auth.uid())
   where id = d.id returning * into d;
  perform privado.evento(case when p_status = 'aprovada' then 'diarista_aprovada' else 'diarista_reprovada' end, jsonb_build_object('diaristaId', d.id));
  r := privado.j_diarista(d);
  perform privado.idem_gravar(op, s, p_chave, conteudo, r);
  return r;
end $$;
create or replace function public.aprovar_diarista(p_id uuid, p_dados jsonb, p_chave text) returns jsonb
language sql security definer set search_path = '' as $$ select privado.decidir_diarista(p_id, 'aprovada', coalesce(p_dados, '{}'), p_chave) $$;
create or replace function public.reprovar_diarista(p_id uuid, p_dados jsonb, p_chave text) returns jsonb
language sql security definer set search_path = '' as $$ select privado.decidir_diarista(p_id, 'reprovada', coalesce(p_dados, '{}'), p_chave) $$;

-- ---------- consultas do painel e da diarista ----------
create or replace function public.listar_atendimentos(p_filtro jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator();
begin
  perform privado.exigir_prime(s);
  return jsonb_build_object('itens', (select coalesce(jsonb_agg(jsonb_build_object(
      'atendimento', privado.j_atendimento(a),
      'pedido', jsonb_build_object('id', p.id, 'status', p.status, 'pacote', p.pacote),
      'cliente', jsonb_build_object('id', c.id, 'nome', c.nome, 'telefone', c.telefone, 'endereco', c.endereco),
      'diarista', case when d.id is not null then jsonb_build_object('id', d.id, 'nome', d.nome, 'status', d.status) end) order by a.data, a.sequencia), '[]')
    from public.atendimentos a join public.pedidos p on p.id = a.pedido_id join public.clientes c on c.id = p.cliente_id left join public.diaristas d on d.id = a.diarista_id
    where (p_filtro ->> 'de' is null or a.data >= (p_filtro ->> 'de')::date) and (p_filtro ->> 'ate' is null or a.data <= (p_filtro ->> 'ate')::date)
      and (p_filtro ->> 'status' is null or a.status = p_filtro ->> 'status')));
end $$;

create or replace function public.listar_atendimentos_da_diarista(p_diarista uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator(); d public.diaristas; hoje date := privado.hoje_sp();
begin
  if not privado.dia_pode_ver(s, p_diarista) then perform privado.erro('NAO_ENCONTRADO', 'Cadastro não encontrado'); end if;
  select * into d from public.diaristas where id = p_diarista;
  if not found then perform privado.erro('NAO_ENCONTRADO', 'Cadastro não encontrado'); end if;
  return jsonb_build_object('diarista', jsonb_build_object('id', d.id, 'nome', d.nome, 'status', d.status, 'decisao', d.decisao),
    'itens', (select coalesce(jsonb_agg(jsonb_build_object(
      'atendimento', privado.j_atendimento(a),
      'pacote', jsonb_build_object('tipoServico', p.pacote -> 'tipoServico', 'duracaoHoras', p.pacote -> 'duracaoHoras', 'passadoriaCombinada', p.pacote -> 'passadoriaCombinada'),
      'cliente', jsonb_build_object('nome', split_part(c.nome, ' ', 1), 'bairro', c.endereco ->> 'bairro', 'cidade', c.endereco ->> 'cidade')
        || case when a.data <= hoje + 1 then jsonb_build_object('endereco', c.endereco, 'telefone', c.telefone) else '{}'::jsonb end) order by a.data), '[]')
      from public.atendimentos a join public.pedidos p on p.id = a.pedido_id join public.clientes c on c.id = p.cliente_id where a.diarista_id = d.id));
end $$;

create or replace function public.listar_avaliacoes(p_filtro jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator();
begin
  perform privado.exigir_prime(s);
  return jsonb_build_object('itens', (select coalesce(jsonb_agg(jsonb_build_object('avaliacao', privado.j_avaliacao(v),
      'atendimento', jsonb_build_object('id', a.id, 'data', to_char(a.data, 'YYYY-MM-DD')), 'diarista', case when d.id is not null then jsonb_build_object('id', d.id, 'nome', d.nome) end) order by v.criado_em desc), '[]')
    from public.avaliacoes v join public.atendimentos a on a.id = v.atendimento_id left join public.diaristas d on d.id = a.diarista_id
    where p_filtro ->> 'diaristaId' is null or a.diarista_id = (p_filtro ->> 'diaristaId')::uuid));
end $$;

create or replace function public.listar_notificacoes(p_filtro jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator();
begin
  perform privado.exigir_prime(s);
  return jsonb_build_object('itens', (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'gatilho', n.gatilho, 'canal', n.canal, 'destinatario', n.destinatario, 'template', n.template,
      'variaveis', n.variaveis, 'agendadaPara', n.agendada_para, 'status', n.status, 'previa', n.previa, 'refs', n.refs, 'chaveIdempotencia', n.chave_idempotencia, 'criadoEm', n.criado_em, 'erro', n.erro, 'tentativas', n.tentativas)
      order by coalesce(n.agendada_para, n.criado_em), n.criado_em), '[]')
    from public.notificacoes n where (p_filtro ->> 'pedidoId' is null or n.refs ->> 'pedidoId' = p_filtro ->> 'pedidoId')
      and (p_filtro ->> 'diaristaId' is null or n.refs ->> 'diaristaId' = p_filtro ->> 'diaristaId' or n.destinatario ->> 'id' = p_filtro ->> 'diaristaId')
      and (p_filtro ->> 'status' is null or n.status = p_filtro ->> 'status')));
end $$;

create or replace function public.listar_eventos(p_filtro jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator();
begin
  perform privado.exigir_prime(s);
  return jsonb_build_object('itens', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'tipo', e.tipo, 'refs', e.refs, 'dados', e.dados, 'status', e.status, 'seq', e.seq,
      'criadoEm', to_char(e.criado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) order by e.seq), '[]')
    from public.eventos e where p_filtro ->> 'status' is null or e.status = p_filtro ->> 'status'));
end $$;

create or replace function public.registrar_contato_manual(p_dados jsonb, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; p public.pedidos; d public.diaristas; item jsonb; ctx text := left(coalesce(p_dados ->> 'contexto', ''), 60);
        conteudo jsonb := jsonb_build_object('pedidoId', p_dados -> 'pedidoId', 'diaristaId', p_dados -> 'diaristaId', 'ctxTexto', ctx);
begin
  r := privado.idem_ler('registrarContatoManual', s, p_chave, conteudo);
  if r is not null then return r; end if;
  perform set_config('app.ator', s ->> 'ator', true);
  item := jsonb_build_object('evento', 'contato_manual', 'canal', 'whatsapp', 'contexto', ctx, 'em', privado.agora_iso(), 'ator', coalesce(s ->> 'ator', 'publico'));
  if p_dados ->> 'pedidoId' is not null then
    select * into p from public.pedidos where id = (p_dados ->> 'pedidoId')::uuid for update;
    if not found or not privado.pode_ver_pedido(s, p) then perform privado.erro('NAO_ENCONTRADO', 'Pedido não encontrado'); end if;
    update public.pedidos set historico = historico || (jsonb_build_object('de', p.status, 'para', p.status) || item) where id = p.id;
  else
    select * into d from public.diaristas where id = (p_dados ->> 'diaristaId')::uuid for update;
    if not found or not privado.dia_pode_ver(s, d.id) then perform privado.erro('NAO_ENCONTRADO', 'Cadastro não encontrado'); end if;
    update public.diaristas set historico = historico || item where id = d.id;
  end if;
  r := '{"registrado": true}';
  perform privado.idem_gravar('registrarContatoManual', s, p_chave, conteudo, r);
  return r;
end $$;

-- ---------- privilégios: só usuários logados chamam; anon nada ----------
do $$ declare f text; begin
  foreach f in array array['confirmar_autoagendamento(jsonb, text)', 'obter_pedido(uuid)', 'listar_pedidos(jsonb)', 'obter_atendimento(uuid)',
    'transicionar_atendimento(uuid, jsonb, text)', 'atribuir_diarista(uuid, jsonb, text)', 'obter_pagamento(uuid)', 'informar_pagamento(uuid, text)',
    'confirmar_pagamento(uuid, text)', 'cancelar_pedido(uuid, jsonb, text)', 'criar_avaliacao(uuid, jsonb, text)', 'obter_avaliacao_do_atendimento(uuid)',
    'registrar_documento(jsonb, text)', 'listar_documentos(uuid)', 'cadastrar_diarista(jsonb, text)', 'obter_diarista(uuid)', 'listar_diaristas(jsonb)',
    'aprovar_diarista(uuid, jsonb, text)', 'reprovar_diarista(uuid, jsonb, text)', 'listar_atendimentos(jsonb)', 'listar_atendimentos_da_diarista(uuid)',
    'listar_avaliacoes(jsonb)', 'listar_notificacoes(jsonb)', 'listar_eventos(jsonb)', 'registrar_contato_manual(jsonb, text)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;
