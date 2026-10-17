-- Autoagendamento v3, V5: revisão, aceite único e envio (itens 35 a 55).
-- 1) "Termos e Condições do atendimento" versão 2026-10-17 (relação completa do item 52), com o hash do texto publicado
--    (scripts/hash-documentos.mjs); Termos de Uso e Política de Privacidade vigentes ganham o hash dos dois textos.
-- 2) cotar_v3 (pública): cotação da revisão com o contexto de quem chama: cliente logada (cupom, primeira contratação,
--    condição comercial, faturamento autorizado) ou ticket do cadastro (cupom e primeira contratação; condição comercial e
--    faturamento NUNCA pelo ticket: o ticket de CPF já cadastrado não prova a identidade).
-- 3) solicitar_v3: envia a solicitação (nunca cobra, item 37): grava os endereços novos (salvo ou uso único; pelo ticket de
--    CPF já cadastrado, sempre uso único), o pedido com número sequencial (item 55), modalidade, origem (item 36), cupom e
--    condição aplicados (consumidos só na confirmação, item 43), flag de pacote com endereço novo (item 46), cada atendimento
--    com o retrato do endereço, características, taxas e itens, e a evidência do aceite único (item 53). Idempotente; o
--    ticket é de uso único.

-- ---------------------------------------------------------------- documentos
insert into public.condicoes_atendimento (versao, vigente_desde, resumo, texto_sha256)
values ('2026-10-17', '2026-10-17 00:00:00-03',
  'Termos e Condições do atendimento (autoagendamento v3): relação completa do que a Prime não realiza (item 52), pagamento por modalidade e taxas. Pendente de revisão jurídica.',
  '9184c9d24443d295d0a35933fac0bcc2660faf84f378d4bc74216b0dd3371b74');
update public.condicoes_atendimento set texto_sha256 = null where versao = '2026-09-29' and texto_sha256 is not null;
-- Termos de Uso + Política de Privacidade (uma versão pros dois): hash de "termos:<sha>|privacidade:<sha>"
update public.documentos_legais set texto_sha256 = encode(extensions.digest(
  'termos:4a666463271933cc4b557f1a0996a1da93e8192f6179e8ec5688f2f6faca0199|privacidade:24914da6a5170bc0593fb248b72b80308cd60e57d0e35c9547f932c7f62a8a7f', 'sha256'), 'hex')
 where versao = '2026-09-28' and texto_sha256 is null;

-- ---------------------------------------------------------------- quem chama
/** Cliente da chamada: logada ({modo: 'logada'}) ou pelo ticket do cadastro ({modo: 'novo'|'vinculado'}). null = nenhum. */
create or replace function privado.v3_quem(p_ticket text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator(); t public.tickets_fluxo;
begin
  if s ->> 'ator' = 'cliente' and s ->> 'id' is not null then return jsonb_build_object('modo', 'logada', 'clienteId', s ->> 'id'); end if;
  if s ->> 'ator' <> 'publico' then return null; end if;
  t := privado.ticket_valido(p_ticket);
  if t.hash is null then return null; end if;
  return jsonb_build_object('modo', case when t.novo then 'novo' else 'vinculado' end, 'clienteId', t.cliente_id, 'ticketHash', t.hash, 'dadosInformados', t.dados_informados);
end $$;

/** Contexto da cotação (cupom, primeira contratação, condição comercial e faturamento) no formato do JS. */
create or replace function privado.v3_contexto(q jsonb, p_cupom text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_cli uuid := (q ->> 'clienteId')::uuid; v_cup public.cupons; v_cond public.condicoes_comerciais; v_fat public.faturamento_empresarial;
        v_ctx jsonb := jsonb_build_object('hoje', to_char(privado.hoje_sp(), 'YYYY-MM-DD')); v_primeira boolean := false; v_usos int;
begin
  if v_cli is not null then
    v_primeira := not exists (select 1 from public.pedidos p where p.cliente_id = v_cli and p.status in ('disponibilidade_confirmada', 'aguardando_pagamento', 'confirmado', 'concluido'))
              and coalesce((select origem from public.clientes where id = v_cli), '') <> 'importado';
  end if;
  v_ctx := v_ctx || jsonb_build_object('primeiraContratacao', v_primeira);
  if coalesce(trim(p_cupom), '') <> '' then
    select * into v_cup from public.cupons where codigo = upper(trim(p_cupom));
    if found then
      select count(*) into v_usos from public.cupons_uso u where u.cupom_id = v_cup.id;
      v_ctx := v_ctx || jsonb_build_object('cupom', jsonb_build_object('codigo', v_cup.codigo, 'tipo', v_cup.tipo, 'valor', v_cup.valor,
        'modalidades', to_jsonb(v_cup.modalidades), 'primeiraContratacao', v_cup.primeira_contratacao, 'validoAte', to_char(v_cup.valido_ate, 'YYYY-MM-DD'),
        'ativo', v_cup.ativo, 'esgotado', v_cup.limite_de_uso is not null and v_usos >= v_cup.limite_de_uso, 'acumula', v_cup.acumula, '_id', v_cup.id));
    end if;
  end if;
  if q ->> 'modo' = 'logada' then
    select * into v_cond from public.condicoes_comerciais c where c.cliente_id = v_cli and c.ativa;
    if found then
      v_ctx := v_ctx || jsonb_build_object('condicao', jsonb_build_object('tipo', v_cond.tipo, 'valor', v_cond.valor, 'modalidades', to_jsonb(v_cond.modalidades),
        'quantidadeMinima', v_cond.quantidade_minima, 'validade', v_cond.validade, 'validoAte', to_char(v_cond.valido_ate, 'YYYY-MM-DD'), 'acumula', v_cond.acumula,
        'consumida', v_cond.consumida_em is not null, 'ativa', v_cond.ativa, '_id', v_cond.id));
    end if;
    select * into v_fat from public.faturamento_empresarial f where f.cliente_id = v_cli and f.autorizado;
    if found and (select tipo from public.clientes where id = v_cli) = 'empresa' then
      v_ctx := v_ctx || jsonb_build_object('faturamento', jsonb_build_object('prazoDias', v_fat.prazo_dias, 'forma', v_fat.forma, 'nf', v_fat.nf));
    end if;
  end if;
  return v_ctx;
end $$;

/**
 * Troca a referência de endereço de cada atendimento ('salvo:<id>' da cliente logada ou 'novo:<k>' de p_dados.enderecosNovos)
 * pelo endereço de verdade, validado. Devolve {pedido, refs:[...], novos:{k: endereço normalizado + uso + apelido}}.
 */
create or replace function privado.v3_montar(p_dados jsonb, q jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_ped jsonb := p_dados -> 'pedido'; v_ats jsonb := '[]'; v_refs jsonb := '[]'; v_novos jsonb := '{}'; a jsonb; i int := 0; v_ref text;
        v_e public.enderecos; v_n jsonb; v_end jsonb; v_uso text;
begin
  if jsonb_typeof(v_ped) is distinct from 'object' or jsonb_typeof(v_ped -> 'atendimentos') is distinct from 'array' then
    perform privado.erro('DADOS_INVALIDOS', 'Solicitação não informada');
  end if;
  for a in select x from jsonb_array_elements(v_ped -> 'atendimentos') x loop
    i := i + 1;
    v_ref := case when jsonb_typeof(a -> 'endereco') = 'object' then a #>> '{endereco,ref}' end;
    if v_ref ~ '^salvo:[0-9a-f-]{36}$' then
      if q ->> 'modo' is distinct from 'logada' then perform privado.erro('DADOS_INVALIDOS', 'Diária ' || i || ': escolha o endereço'); end if;
      select * into v_e from public.enderecos e where e.id = substr(v_ref, 7)::uuid and e.cliente_id = (q ->> 'clienteId')::uuid and e.ativo;
      if not found then perform privado.erro('DADOS_INVALIDOS', 'Diária ' || i || ': endereço não encontrado. Escolha outro.', jsonb_build_object('endereco', 'Endereço não encontrado')); end if;
      v_end := privado.j_endereco(v_e);
    elsif v_ref ~ '^novo:[0-9]{1,2}$' then
      if not v_novos ? v_ref then
        v_n := p_dados -> 'enderecosNovos' -> v_ref;
        v_end := privado.v3_endereco(v_n, v_ped ->> 'segmento');
        v_uso := coalesce(v_n ->> 'uso', '');
        if v_uso not in ('salvar', 'unico') then perform privado.erro('DADOS_INVALIDOS', 'Escolha como deseja utilizar este endereço', '{"endereco.uso": "Escolha como deseja utilizar este endereço"}'); end if;
        v_novos := v_novos || jsonb_build_object(v_ref, v_end || jsonb_build_object('uso', v_uso,
          'apelido', case when v_uso = 'salvar' then nullif(left(regexp_replace(trim(coalesce(v_n ->> 'apelido', '')), '\s+', ' ', 'g'), 40), '') end));
      end if;
      v_end := v_novos -> v_ref;
    else
      perform privado.erro('DADOS_INVALIDOS', 'Diária ' || i || ': escolha o endereço');
    end if;
    v_ats := v_ats || jsonb_set(a, '{endereco}', jsonb_build_object('cep', coalesce(v_end ->> 'cep', ''), 'cidade', v_end ->> 'cidade', 'uf', v_end ->> 'uf'));
    v_refs := v_refs || jsonb_build_object('ref', v_ref, 'endereco', v_end);
  end loop;
  return jsonb_build_object('pedido', jsonb_set(v_ped, '{atendimentos}', v_ats), 'refs', v_refs, 'novos', v_novos);
end $$;

/** Contexto sem os ids internos (o cálculo é o mesmo do JS, que não conhece os ids). */
create or replace function privado.v3_ctx_publico(c jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object('cupom', (c -> 'cupom') - '_id', 'condicao', (c -> 'condicao') - '_id'))
         || (c - 'cupom' - 'condicao')
$$;

/** Pacote com endereço que ainda não é do cadastro (item 46): igual a pacoteComEnderecoNovo do front. */
create or replace function privado.v3_pacote_endereco_novo(p_ped jsonb, m jsonb, q jsonb) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_ped ->> 'modalidade' = 'pacote' and exists (
    select 1 from jsonb_array_elements(m -> 'refs') r
     where r ->> 'ref' like 'novo:%' and (r ->> 'ref' <> 'novo:0' or r #>> '{endereco,uso}' = 'unico' or q ->> 'modo' = 'vinculado'
           or (q ->> 'modo' = 'logada' and exists (select 1 from public.enderecos e where e.cliente_id = (q ->> 'clienteId')::uuid and e.ativo))))
$$;

/** Cotação da revisão. p_dados: {pedido, enderecosNovos, ticket?}. Devolve a cotação + {pacoteEnderecoNovo, faturamento}. */
create or replace function public.cotar_v3(p_dados jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare q jsonb := privado.v3_quem(p_dados ->> 'ticket'); m jsonb; v_ctx jsonb; v_cot jsonb;
begin
  q := coalesce(q, '{"modo": "anonimo"}');
  m := privado.v3_montar(p_dados, q);
  v_ctx := privado.v3_contexto(q, m #>> '{pedido,cupom}');
  v_cot := privado.cotar_v3(m -> 'pedido', privado.v3_ctx_publico(v_ctx), privado.cfg_v3());
  return v_cot || jsonb_build_object('pacoteEnderecoNovo', privado.v3_pacote_endereco_novo(m -> 'pedido', m, q), 'faturamento', v_ctx -> 'faturamento');
end $$;

-- ---------------------------------------------------------------- envio
/**
 * Envia a solicitação v3. p_dados: {pedido, enderecosNovos, ticket?, origem?: {origem, quemIndicou?, outroQual?},
 * aceite: {condicoes, legal, leuTermos: true}, valorEsperadoCentavos}. Devolve {pedido: {id, numero}}.
 */
create or replace function public.solicitar_v3(p_dados jsonb, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare q jsonb := privado.v3_quem(p_dados ->> 'ticket'); s jsonb; r jsonb; v_conteudo jsonb; m jsonb; v_ctx jsonb; v_cot jsonb; v_cli public.clientes;
        v_ped jsonb; v_esperado jsonb := p_dados -> 'valorEsperadoCentavos'; v_origem jsonb; v_o text; v_ref text; v_novo jsonb; v_ids jsonb := '{}';
        v_e public.enderecos; v_p public.pedidos; v_at jsonb; v_orig jsonb; v_rf jsonb; v_end_id uuid; v_vinc boolean; v_tem_principal boolean;
        v_hdr jsonb; v_info jsonb; v_hash text; v_cond_v text; v_legal_v text; v_ag jsonb; v_cupom_id uuid; v_cond_id uuid;
begin
  if q is null then
    -- repetição de um envio que já usou o ticket (resposta perdida): a mesma chave devolve o mesmo pedido
    select jsonb_build_object('clienteId', t.cliente_id) into q from public.tickets_fluxo t
     where coalesce(p_dados ->> 'ticket', '') ~ '^[0-9a-f]{64}$' and t.hash = encode(extensions.digest(p_dados ->> 'ticket', 'sha256'), 'hex') and t.usado_em is not null;
    if q is not null then
      r := privado.idem_ler('solicitarV3', '{"ator": "publico"}', p_chave, p_dados - 'ticket' || jsonb_build_object('cliente', q ->> 'clienteId'));
      if r is not null then return r; end if;
    end if;
    perform privado.erro('ATOR_SEM_PERMISSAO', 'Entre na sua conta ou conclua o cadastro para enviar.');
  end if;
  s := case when q ->> 'modo' = 'logada' then privado.ator() else jsonb_build_object('ator', 'publico') end;
  v_conteudo := p_dados - 'ticket' || jsonb_build_object('cliente', q ->> 'clienteId');
  r := privado.idem_ler('solicitarV3', s, p_chave, v_conteudo);
  if r is not null then return r; end if;
  perform set_config('app.ator', 'cliente', true);
  if q ? 'ticketHash' then
    perform 1 from public.tickets_fluxo t where t.hash = q ->> 'ticketHash' and t.usado_em is null for update;
    if not found then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Esta solicitação já foi enviada.'); end if;
  end if;
  -- aceite único (itens 52 e 53): a versão vigente dos três documentos e a abertura dos Termos e Condições
  v_ag := p_dados -> 'aceite';
  v_cond_v := privado.versao_condicoes(); v_legal_v := privado.versao_legal();
  if jsonb_typeof(v_ag) is distinct from 'object' or (v_ag -> 'leuTermos') is distinct from 'true'::jsonb then
    perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Leia e aceite os Termos e Condições do atendimento para enviar.', '{"aceite": "Leia e aceite os Termos e Condições do atendimento"}');
  end if;
  if v_ag ->> 'condicoes' is distinct from v_cond_v or v_ag ->> 'legal' is distinct from v_legal_v then
    perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Os Termos e Condições do atendimento mudaram. Leia a versão nova e aceite de novo.', '{"aceite": "Versão nova dos termos"}');
  end if;
  -- origem (item 36), opcional
  v_origem := p_dados -> 'origem';
  if jsonb_typeof(v_origem) = 'object' and coalesce(v_origem ->> 'origem', '') <> '' then
    v_o := v_origem ->> 'origem';
    if v_o not in ('indicacao', 'instagram', 'google', 'whatsapp', 'outro') then perform privado.erro('DADOS_INVALIDOS', 'Origem inválida'); end if;
    v_origem := jsonb_build_object('origem', v_o) || case when v_o = 'indicacao' and coalesce(trim(v_origem ->> 'quemIndicou'), '') <> '' then jsonb_build_object('quemIndicou', left(trim(v_origem ->> 'quemIndicou'), 80)) else '{}' end
             || case when v_o = 'outro' and coalesce(trim(v_origem ->> 'outroQual'), '') <> '' then jsonb_build_object('outroQual', left(trim(v_origem ->> 'outroQual'), 80)) else '{}' end;
  else v_origem := null; end if;
  select * into v_cli from public.clientes where id = (q ->> 'clienteId')::uuid for update;
  if v_cli.anonimizado_em is not null then perform privado.erro('ATOR_SEM_PERMISSAO', 'Cadastro indisponível. Fale com a Prime.'); end if;
  m := privado.v3_montar(p_dados, q);
  v_ped := m -> 'pedido';
  if v_cli.tipo is distinct from v_ped ->> 'segmento' then
    perform privado.erro('DADOS_INVALIDOS', 'Seu cadastro é de ' || case when v_cli.tipo = 'empresa' then 'empresa' else 'pessoa física' end || '. Escolha o tipo de atendimento do seu cadastro ou fale com a Prime.');
  end if;
  v_ctx := privado.v3_contexto(q, v_ped ->> 'cupom');
  v_cot := privado.cotar_v3(v_ped, privado.v3_ctx_publico(v_ctx), privado.cfg_v3());
  -- o valor que a pessoa viu na revisão é obrigatório (v2: revisão do GPT)
  if jsonb_typeof(v_esperado) is distinct from 'number' then perform privado.erro('DADOS_INVALIDOS', 'Confira o valor na revisão antes de enviar.', '{"valor": "Confira o valor na revisão"}'); end if;
  if (v_esperado #>> '{}')::numeric is distinct from (v_cot ->> 'totalCentavos')::numeric then
    perform privado.erro('CONDICAO_NAO_ATENDIDA', 'O valor foi atualizado. Confira a revisão antes de enviar.', jsonb_build_object('valor', (v_cot ->> 'totalCentavos')::bigint, 'precoMudou', true));
  end if;
  -- endereços novos (item 9): salvo vira ativo (principal se ainda não tem), uso único fica só no histórico; pelo ticket de
  -- CPF já cadastrado, sempre uso único (a conta não é alterada sem login)
  v_vinc := q ->> 'modo' = 'vinculado';
  for v_ref, v_novo in select k, v from jsonb_each(m -> 'novos') x(k, v) loop
    v_tem_principal := exists (select 1 from public.enderecos e where e.cliente_id = v_cli.id and e.principal and e.ativo);
    insert into public.enderecos (cliente_id, cep, logradouro, numero, complemento, bairro, cidade, uf, ponto_referencia, tipo_imovel, tipo_imovel_outro,
                                  apelido, uso_unico, ativo, principal, origem, ficticio)
    values (v_cli.id, v_novo ->> 'cep', v_novo ->> 'logradouro', v_novo ->> 'numero', v_novo ->> 'complemento', v_novo ->> 'bairro', v_novo ->> 'cidade', v_novo ->> 'uf',
            v_novo ->> 'pontoReferencia', v_novo ->> 'tipoImovel', nullif(v_novo ->> 'tipoImovelOutro', ''),
            case when not v_vinc and v_novo ->> 'uso' = 'salvar' then v_novo ->> 'apelido' end,
            v_vinc or v_novo ->> 'uso' = 'unico', not v_vinc and v_novo ->> 'uso' = 'salvar',
            not v_vinc and v_novo ->> 'uso' = 'salvar' and not v_tem_principal, 'site', v_cli.ficticio)
    returning * into v_e;
    v_ids := v_ids || jsonb_build_object(v_ref, v_e.id);
  end loop;
  v_cupom_id := case when coalesce((v_cot #>> '{cupom,aplicado}')::boolean, false) then (v_ctx #>> '{cupom,_id}')::uuid end;
  v_cond_id := case when (v_cot ->> 'condicaoAplicada')::boolean then (v_ctx #>> '{condicao,_id}')::uuid end;
  insert into public.pedidos (cliente_id, pacote, status, historico, total_centavos, entrada_centavos, restante_centavos, ficticio, endereco, dados_informados,
                              aceite_condicoes, modalidade, origem_cliente, cupom_id, condicao_comercial_id, pacote_endereco_novo, faturamento)
  values (v_cli.id,
          v_cot || jsonb_build_object('tipoCliente', v_cot ->> 'segmento', 'tipoServico', v_cot #>> '{atendimentos,0,servico}', 'duracaoHoras', (v_cot #>> '{atendimentos,0,duracaoMinutos}')::int / 60,
                                      'quantidadeDiarias', jsonb_array_length(v_cot -> 'atendimentos'), 'modoPagamento', 'v3', 'horasExtras', 0),
          'solicitado', jsonb_build_array(jsonb_build_object('de', 'rascunho', 'para', 'solicitado', 'evento', 'solicitar', 'em', privado.agora_iso(), 'ator', 'cliente')),
          (v_cot ->> 'totalCentavos')::bigint, null, null, v_cli.ficticio,
          (select r2 -> 'endereco' from jsonb_array_elements(m -> 'refs') with ordinality z(r2, o) order by o limit 1) - 'uso' - 'id',
          case when v_vinc then q -> 'dadosInformados' end,
          jsonb_build_object('versao', v_cond_v, 'em', privado.agora_iso()),
          v_cot ->> 'modalidade', v_origem, v_cupom_id, v_cond_id, privado.v3_pacote_endereco_novo(v_ped, m, q), v_ctx ? 'faturamento')
  returning * into v_p;
  for v_at in select x from jsonb_array_elements(v_cot -> 'atendimentos') x loop
    v_orig := v_ped -> 'atendimentos' -> ((v_at ->> 'posicao')::int);
    v_rf := m -> 'refs' -> ((v_at ->> 'posicao')::int);
    v_end_id := case when v_rf ->> 'ref' like 'salvo:%' then substr(v_rf ->> 'ref', 7)::uuid else (v_ids ->> (v_rf ->> 'ref'))::uuid end;
    insert into public.atendimentos (pedido_id, sequencia, data, turno, hora_inicio, duracao_minutos, status, valor_dia_centavos, taxa_dia_centavos, deslocada,
                                     endereco_id, endereco, servico, caracteristicas, local_refeicao, duracao_recomendada_horas, justificativa, taxas, itens)
    values (v_p.id, (v_at ->> 'sequencia')::int, (v_at ->> 'data')::date, null, (v_at ->> 'horaInicio')::time, (v_at ->> 'duracaoMinutos')::int, 'agendado',
            (v_at ->> 'valorCentavos')::bigint, (v_at #>> '{taxas,sabado}')::bigint + (v_at #>> '{taxas,feriado}')::bigint, false,
            v_end_id, (v_rf -> 'endereco') - 'uso' - 'id', v_at ->> 'servico', case when jsonb_typeof(v_orig -> 'caracteristicas') = 'object' then v_orig -> 'caracteristicas' end,
            (v_orig -> 'localRefeicao') = 'true'::jsonb, (v_at ->> 'duracaoRecomendadaHoras')::int,
            nullif(left(trim(coalesce(v_orig ->> 'justificativa', '')), 500), ''), v_at -> 'taxas', v_at -> 'itens');
  end loop;
  -- evidência do aceite (item 53): quem, o quê (versões + hash dos textos), quando e de onde
  v_hdr := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}');
  v_info := case when v_vinc then q -> 'dadosInformados' else jsonb_build_object('nome', v_cli.nome, 'documento', v_cli.documento, 'telefone', v_cli.telefone) end;
  v_hash := encode(extensions.digest(jsonb_build_object(
    'pedido', v_p.numero_solicitacao, 'cliente', v_cli.id, 'nome', v_info ->> 'nome', 'documento', coalesce(v_info ->> 'documento', v_info ->> 'cpf', v_info ->> 'cnpj'),
    'condicoes', jsonb_build_object('versao', v_cond_v, 'sha256', (select texto_sha256 from public.condicoes_atendimento where versao = v_cond_v)),
    'legal', jsonb_build_object('versao', v_legal_v, 'sha256', (select texto_sha256 from public.documentos_legais where versao = v_legal_v)),
    'em', privado.agora_iso())::text, 'sha256'), 'hex');
  insert into public.aceites_solicitacao (pedido_id, cliente_id, nome, documento, whatsapp, versao_condicoes, versao_termos_uso, versao_privacidade, hash_aceite, user_agent, ip_aproximado)
  values (v_p.id, v_cli.id, coalesce(v_info ->> 'nome', v_cli.nome), coalesce(v_info ->> 'documento', v_info ->> 'cpf', v_info ->> 'cnpj', v_cli.documento),
          coalesce(v_info ->> 'telefone', v_cli.telefone), v_cond_v, v_legal_v, v_legal_v, v_hash,
          left(v_hdr ->> 'user-agent', 400), left(coalesce(v_hdr ->> 'cf-connecting-ip', split_part(v_hdr ->> 'x-forwarded-for', ',', 1)), 64));
  if v_cli.usuario_id is not null and not v_vinc then
    insert into public.aceites_termos (user_id, titular_tipo, titular_id, versao, origem) values (v_cli.usuario_id, 'cliente', v_cli.id, v_legal_v, 'cadastro_cliente')
    on conflict (titular_tipo, titular_id, versao) do nothing;
  end if;
  if q ? 'ticketHash' then update public.tickets_fluxo set usado_em = now(), usado_pedido = v_p.id where hash = q ->> 'ticketHash'; end if;
  update public.clientes set status_prospeccao = 'convertido' where id = v_cli.id and status_prospeccao <> 'convertido';
  perform privado.evento('pedido_criado', jsonb_build_object('pedidoId', v_p.id, 'clienteId', v_cli.id));
  r := jsonb_build_object('pedido', jsonb_build_object('id', v_p.id, 'numero', v_p.numero_solicitacao));
  perform privado.idem_gravar('solicitarV3', s, p_chave, v_conteudo, r);
  return r;
end $$;

revoke execute on function public.cotar_v3(jsonb), public.solicitar_v3(jsonb, text) from public;
grant execute on function public.cotar_v3(jsonb), public.solicitar_v3(jsonb, text) to anon, authenticated;
