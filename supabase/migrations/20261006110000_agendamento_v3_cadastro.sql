-- Autoagendamento v3, V2: identificação, cadastro antecipado e endereços (itens 5 a 9, 29 a 34; spec 0.10, 0.11, 3.4, 3.5).
-- 1) Cadastro ANTES do endereço, salvo ao concluir a etapa (item 34), pela function "conta" (anti-robô + limite por IP).
--    Resposta SEMPRE igual ({ok, ticket}): não revela se o CPF/CNPJ já existe (a ação "cadastrar" saiu na auditoria de
--    30/09 por isso). O ticket (opaco, 24 h, uso único na solicitação) guarda o cliente no servidor:
--    - cadastro novo: cliente criado (base legal: diligências pré-contratuais), acesso pela regra padrão, endereços salvos;
--    - documento já cadastrado: NÃO dá leitura nem altera a conta; a solicitação vai vinculada com os dados digitados
--      (como no v2) e endereço "salvo" vira de uso único, com aviso pra Prime.
-- 2) Endereços da cliente logada: listar ativos e "Substituir endereço" (o anterior fica inativo, nunca apagado).
-- 3) Endereço importado sem CEP (a planilha antiga não tinha): entra como principal, com CEP vazio; todo endereço NOVO exige CEP.
-- 4) Conteúdo editável do agendamento (configuracao 'agendamento'): tipos de imóvel por segmento (item 8) e o "Ver mais"
--    de cada serviço (item 4). Padrão igual a src/config/agendamento.js.

-- ---------------------------------------------------------------- endereços importados
alter table public.enderecos add column origem text not null default 'site' check (origem in ('site', 'importado', 'painel'));
alter table public.enderecos alter column cep drop not null;
alter table public.enderecos add constraint enderecos_cep_so_importado check (cep is not null or origem = 'importado');
insert into public.enderecos (cliente_id, cep, logradouro, numero, complemento, bairro, cidade, uf, principal, origem, ficticio, criado_em)
select c.id, case when coalesce(c.endereco ->> 'cep', '') ~ '^[0-9]{8}$' then c.endereco ->> 'cep' end,
       left(c.endereco ->> 'logradouro', 120), left(c.endereco ->> 'numero', 10), left(coalesce(c.endereco ->> 'complemento', ''), 60),
       left(c.endereco ->> 'bairro', 80), left(c.endereco ->> 'cidade', 80), upper(c.endereco ->> 'uf'), true, 'importado', c.ficticio, c.criado_em
  from public.clientes c
 where c.anonimizado_em is null and not exists (select 1 from public.enderecos e where e.cliente_id = c.id)
   and coalesce(c.endereco ->> 'logradouro', '') <> '' and coalesce(c.endereco ->> 'numero', '') <> '' and coalesce(c.endereco ->> 'bairro', '') <> ''
   and coalesce(c.endereco ->> 'cidade', '') <> '' and coalesce(c.endereco ->> 'uf', '') ~ '^[A-Za-z]{2}$'
   and char_length(c.endereco ->> 'numero') <= 10;

-- exclusão (L1): endereços da cliente anonimizada saem junto (o dado pessoal não pode sobrar fora do cadastro)
create or replace function privado.enderecos_na_exclusao() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.anonimizado_em is not null and old.anonimizado_em is null then
    update public.atendimentos a set endereco = null where a.endereco_id in (select id from public.enderecos where cliente_id = new.id);
    update public.atendimentos a set endereco_id = null where a.endereco_id in (select id from public.enderecos where cliente_id = new.id);
    update public.enderecos set substituido_por = null where cliente_id = new.id;
    delete from public.enderecos where cliente_id = new.id;
    delete from public.tickets_fluxo where cliente_id = new.id;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------- ticket do fluxo
create table public.tickets_fluxo (
  hash text primary key check (hash ~ '^[0-9a-f]{64}$'),
  cliente_id uuid not null references public.clientes (id),
  novo boolean not null,
  dados_informados jsonb check (dados_informados is null or jsonb_typeof(dados_informados) = 'object'),
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null,
  usado_em timestamptz,
  usado_pedido uuid references public.pedidos (id)
);
create index tickets_fluxo_expira on public.tickets_fluxo (expira_em);
alter table public.tickets_fluxo enable row level security;
alter table public.tickets_fluxo force row level security;
revoke all on public.tickets_fluxo from anon, authenticated;
create trigger enderecos_na_exclusao after update of anonimizado_em on public.clientes for each row execute function privado.enderecos_na_exclusao();

-- ---------------------------------------------------------------- validação do cadastro (validacao.js: validarCadastroV3)
/** Nome completo: pelo menos duas palavras com 2 letras ou mais (item 30). Mesma classe de letras do JS (Latin-1). */
create or replace function privado.v3_nome_completo(v text) returns boolean
language sql immutable set search_path = '' as $$
  select (select count(*) from regexp_split_to_table(trim(coalesce(v, '')), '\s+') w where w ~ '[A-Za-zÀ-ÖØ-öø-ÿ]{2,}') >= 2
$$;

/**
 * Cadastro do v3 (sem endereço: ele vem depois, item 5). Mesmas mensagens de src/domain/validacao.js (validarCadastroV3).
 * @returns cliente normalizado {tipo, nome, telefone, email, cpf+dataNascimento | cnpj+razaoSocial+responsavel}
 */
create or replace function privado.v3_cadastro(d jsonb, hoje date) returns jsonb
language plpgsql stable set search_path = '' as $$
declare limpa text := '\s+'; c jsonb; erros jsonb := '{}'; m text; nasc date; txt text;
begin
  c := jsonb_build_object('tipo', d ->> 'tipo',
    'nome', regexp_replace(trim(coalesce(d ->> 'nome', '')), limpa, ' ', 'g'),
    'telefone', privado.so_digitos(d ->> 'telefone'),
    'email', lower(regexp_replace(trim(coalesce(d ->> 'email', '')), limpa, ' ', 'g')));
  if coalesce(d ->> 'tipo', '') not in ('residencial', 'empresa') then erros := erros || '{"tipo": "Escolha residencial ou empresa"}'; end if;
  if d ->> 'tipo' = 'empresa' then
    c := c || jsonb_build_object('cnpj', privado.normalizar_cnpj(d ->> 'cnpj'),
      'razaoSocial', regexp_replace(trim(coalesce(d ->> 'razaoSocial', '')), limpa, ' ', 'g'),
      'responsavel', regexp_replace(trim(coalesce(d ->> 'responsavel', '')), limpa, ' ', 'g'));
    c := c || jsonb_build_object('nome', c ->> 'responsavel');
    m := privado.v_nome(c ->> 'responsavel', 'o responsável');
    if m = '' and not privado.v3_nome_completo(c ->> 'responsavel') then m := 'Informe o nome completo do responsável.'; end if;
    if m <> '' then erros := erros || jsonb_build_object('responsavel', m); end if;
    m := privado.v_cnpj(c ->> 'cnpj'); if m <> '' then erros := erros || jsonb_build_object('cnpj', m); end if;
    m := privado.v_texto(c ->> 'razaoSocial', 'a razão social'); if m <> '' then erros := erros || jsonb_build_object('razaoSocial', m); end if;
  else
    m := privado.v_nome(c ->> 'nome');
    if m = '' and not privado.v3_nome_completo(c ->> 'nome') then m := 'Informe seu nome completo.'; end if;
    if m <> '' then erros := erros || jsonb_build_object('nome', m); end if;
    c := c || jsonb_build_object('cpf', privado.so_digitos(d ->> 'cpf'));
    if privado.v_cpf(c ->> 'cpf') <> '' then
      erros := erros || jsonb_build_object('cpf', case when c ->> 'cpf' = '' then 'Informe o CPF' else 'CPF inválido. Confira o número informado.' end);
    end if;
    txt := coalesce(d ->> 'dataNascimento', '');
    begin nasc := case when txt ~ '^\d{4}-\d{2}-\d{2}$' then txt::date end; exception when others then nasc := null; end;
    if nasc is null or to_char(nasc, 'YYYY-MM-DD') <> txt or nasc < date '1900-01-01' or nasc > hoje then
      erros := erros || '{"dataNascimento": "Informe a data de nascimento"}';
    elsif (nasc + interval '18 years')::date > hoje then
      erros := erros || '{"dataNascimento": "É necessário ter 18 anos ou mais para realizar uma solicitação."}';
    else c := c || jsonb_build_object('dataNascimento', txt); end if;
  end if;
  if privado.v_telefone(c ->> 'telefone') <> '' then
    erros := erros || jsonb_build_object('telefone', case when c ->> 'telefone' = '' then 'Informe o WhatsApp com DDD' else 'Confira o número informado e tente novamente.' end);
  end if;
  m := privado.v_email(c ->> 'email'); if m <> '' then erros := erros || jsonb_build_object('email', m); end if;
  if erros <> '{}' then perform privado.erro('DADOS_INVALIDOS', (select v #>> '{}' from jsonb_each(erros) as y(k, v) limit 1), erros); end if;
  return c;
end $$;

/** Paridade da validação do cadastro (testes): {ok: cliente} ou {erro, campos: {campo: mensagem}}. */
create or replace function public.paridade_cadastro_v3(p_dados jsonb, p_hoje date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare h text;
begin
  return jsonb_build_object('ok', privado.v3_cadastro(p_dados, p_hoje));
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return jsonb_build_object('erro', sqlerrm, 'campos', case when coalesce(h, '') <> '' then h::jsonb end);
end $$;
create or replace function public.paridade_endereco_v3(p_end jsonb, p_segmento text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare h text;
begin
  return jsonb_build_object('ok', privado.v3_endereco(p_end, p_segmento));
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return jsonb_build_object('erro', sqlerrm, 'campos', case when coalesce(h, '') <> '' then h::jsonb end);
end $$;
revoke execute on function public.paridade_cadastro_v3(jsonb, date), public.paridade_endereco_v3(jsonb, text) from public, anon, authenticated;
grant execute on function public.paridade_cadastro_v3(jsonb, date), public.paridade_endereco_v3(jsonb, text) to service_role;

-- ---------------------------------------------------------------- cadastro pela function "conta"
/**
 * Cadastro do v3 (só a function "conta", papel de serviço). Idempotente pela chave do navegador (repetir depois de uma
 * resposta perdida devolve o MESMO ticket). Devolve {ticket, clienteId, novo, criarAcesso}; a function responde ao navegador
 * só {ok, ticket}, com o mesmo tempo nos dois casos.
 */
create or replace function public.conta_cadastrar_v3(p_dados jsonb, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := '{"ator": "publico"}'; r jsonb; c jsonb; tipo_doc text; doc text; cli public.clientes; email_em_uso boolean; novo boolean;
        bruto text; ficticio boolean;
begin
  c := privado.v3_cadastro(p_dados, privado.hoje_sp());
  r := privado.idem_ler('cadastrarV3', s, p_chave, c);
  if r is not null then return r; end if;
  perform set_config('app.ator', 'cliente', true);
  tipo_doc := case when c ? 'cnpj' then 'cnpj' else 'cpf' end;
  doc := coalesce(c ->> 'cnpj', c ->> 'cpf');
  perform pg_advisory_xact_lock(hashtextextended('cliente-doc:' || tipo_doc || ':' || doc, 0));
  select * into cli from public.clientes where tipo_documento = tipo_doc and documento = doc and anonimizado_em is null for update;
  novo := not found;
  if novo then
    email_em_uso := exists (select 1 from auth.users u where lower(u.email) = c ->> 'email') or exists (select 1 from public.clientes x where x.email = c ->> 'email');
    ficticio := (c ->> 'email') ~ '^teste-[a-z0-9-]+@example\.com$';
    insert into public.clientes (usuario_id, tipo, nome, telefone, email, tipo_documento, documento, razao_social, responsavel, endereco, data_nascimento,
                                 origem, ficticio, pendencias, base_legal)
    values (null, c ->> 'tipo', c ->> 'nome', c ->> 'telefone', c ->> 'email', tipo_doc, doc, c ->> 'razaoSocial', c ->> 'responsavel', '{}',
            (c ->> 'dataNascimento')::date, 'site', ficticio, case when email_em_uso then array['email_em_uso'] else '{}'::text[] end, 'execucao_contrato')
    returning * into cli;
  end if;
  bruto := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.tickets_fluxo (hash, cliente_id, novo, dados_informados, expira_em)
  values (encode(extensions.digest(bruto, 'sha256'), 'hex'), cli.id, novo, case when novo then null else c end, now() + interval '24 hours');
  delete from public.tickets_fluxo where expira_em < now() - interval '7 days';
  r := jsonb_build_object('ticket', bruto, 'clienteId', cli.id, 'novo', novo, 'criarAcesso', novo and not email_em_uso);
  perform privado.idem_gravar('cadastrarV3', s, p_chave, c, r);
  return r;
end $$;

/** Liga o acesso recém-criado ao cadastro novo do v3 (o aceite dos termos vem na solicitação, item 52). */
create or replace function public.conta_vincular_acesso_v3(p_cliente uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.clientes set usuario_id = p_user where id = p_cliente and usuario_id is null;
end $$;
/**
 * Repetição do cadastro depois de o Auth criar o usuário (resposta perdida): o usuário órfão (mesmas regras do v2: origem site,
 * nasceu depois deste cadastro, há menos de 1 dia, sem vínculo nem papel) é ligado a este cadastro. null = e-mail de outra conta.
 */
create or replace function public.conta_vincular_orfao_v3(p_cliente uuid, p_email text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare u uuid;
begin
  select au.id into u from auth.users au
   where lower(au.email) = lower(p_email) and au.raw_user_meta_data ->> 'origem' = 'site' and au.created_at > now() - interval '1 day'
     and au.created_at >= (select c.criado_em from public.clientes c where c.id = p_cliente)
     and not exists (select 1 from public.clientes c where c.usuario_id = au.id)
     and not exists (select 1 from public.diaristas d where d.usuario_id = au.id)
     and not exists (select 1 from public.perfis pf where pf.user_id = au.id and pf.papel in ('prime_admin', 'prime_atendimento', 'diarista'))
   limit 1;
  if u is null then return null; end if;
  perform public.conta_vincular_acesso_v3(p_cliente, u);
  return case when exists (select 1 from public.clientes where id = p_cliente and usuario_id = u) then u end;
end $$;
revoke execute on function public.conta_cadastrar_v3(jsonb, text), public.conta_vincular_acesso_v3(uuid, uuid), public.conta_vincular_orfao_v3(uuid, text) from public, anon, authenticated;
grant execute on function public.conta_cadastrar_v3(jsonb, text), public.conta_vincular_acesso_v3(uuid, uuid), public.conta_vincular_orfao_v3(uuid, text) to service_role;

/** Ticket válido (não vencido, não usado) -> linha; senão null. */
create or replace function privado.ticket_valido(p_ticket text) returns public.tickets_fluxo
language sql stable security definer set search_path = '' as $$
  select t.* from public.tickets_fluxo t
   where p_ticket ~ '^[0-9a-f]{64}$' and t.hash = encode(extensions.digest(p_ticket, 'sha256'), 'hex') and t.expira_em > now() and t.usado_em is null
$$;

-- ---------------------------------------------------------------- endereços (itens 6 a 9)
/** Tipos de imóvel do segmento (configuração 'agendamento'). */
create or replace function privado.tipos_imovel(p_segmento text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce((select valor -> 'tiposImovel' -> (case when p_segmento = 'empresa' then 'empresa' else 'residencial' end) from public.configuracao where chave = 'agendamento'), '[]')
$$;

/**
 * Endereço novo do fluxo (validarEnderecoV3 no JS): CEP obrigatório, campos do item 7, tipo do imóvel do segmento (item 8,
 * "Outro" pede o texto), ponto de referência e complemento opcionais. Erros com a chave "endereco.<campo>".
 */
create or replace function privado.v3_endereco(e0 jsonb, p_segmento text) returns jsonb
language plpgsql stable set search_path = '' as $$
declare e jsonb := coalesce(e0, '{}'); limpa text := '\s+'; c jsonb; erros jsonb; m text;
begin
  if jsonb_typeof(e) <> 'object' then e := '{}'; end if;
  c := jsonb_build_object('cep', privado.so_digitos(e ->> 'cep'),
    'logradouro', regexp_replace(trim(coalesce(e ->> 'logradouro', '')), limpa, ' ', 'g'), 'numero', regexp_replace(trim(coalesce(e ->> 'numero', '')), limpa, ' ', 'g'),
    'complemento', regexp_replace(trim(coalesce(e ->> 'complemento', '')), limpa, ' ', 'g'), 'bairro', regexp_replace(trim(coalesce(e ->> 'bairro', '')), limpa, ' ', 'g'),
    'cidade', regexp_replace(trim(coalesce(e ->> 'cidade', '')), limpa, ' ', 'g'), 'uf', upper(coalesce(e ->> 'uf', '')),
    'pontoReferencia', regexp_replace(trim(coalesce(e ->> 'pontoReferencia', '')), limpa, ' ', 'g'),
    'tipoImovel', trim(coalesce(e ->> 'tipoImovel', '')), 'tipoImovelOutro', regexp_replace(trim(coalesce(e ->> 'tipoImovelOutro', '')), limpa, ' ', 'g'));
  select coalesce(jsonb_object_agg(k, v), '{}') into erros from jsonb_each(privado.v_endereco(c)) as x(k, v);
  if char_length(c ->> 'pontoReferencia') > 120 then erros := erros || '{"pontoReferencia": "Máximo de 120 caracteres"}'; end if;
  if c ->> 'tipoImovel' = '' then erros := erros || '{"tipoImovel": "Escolha o tipo do imóvel"}';
  elsif c ->> 'tipoImovel' <> 'Outro' and not privado.tipos_imovel(p_segmento) ? (c ->> 'tipoImovel') then erros := erros || '{"tipoImovel": "Escolha o tipo do imóvel"}';
  elsif c ->> 'tipoImovel' = 'Outro' and char_length(c ->> 'tipoImovelOutro') not between 2 and 40 then erros := erros || '{"tipoImovelOutro": "Informe o tipo do imóvel"}'; end if;
  if c ->> 'tipoImovel' <> 'Outro' then c := c || '{"tipoImovelOutro": ""}'; end if;
  if erros <> '{}' then
    perform privado.erro('DADOS_INVALIDOS', (select v #>> '{}' from jsonb_each(erros) as y(k, v) limit 1),
      (select jsonb_object_agg('endereco.' || k, v) from jsonb_each(erros) as z(k, v)));
  end if;
  return c;
end $$;

create or replace function privado.j_endereco(e public.enderecos) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('id', e.id, 'cep', coalesce(e.cep, ''), 'logradouro', e.logradouro, 'numero', e.numero, 'complemento', e.complemento,
    'bairro', e.bairro, 'cidade', e.cidade, 'uf', e.uf, 'pontoReferencia', e.ponto_referencia, 'tipoImovel', e.tipo_imovel,
    'tipoImovelOutro', e.tipo_imovel_outro, 'apelido', e.apelido, 'principal', e.principal, 'usoUnico', e.uso_unico, 'ativo', e.ativo,
    'origem', e.origem, 'criadoEm', to_char(e.criado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
$$;

/** Endereços ATIVOS da cliente logada (os de uso único e os substituídos não aparecem, item 9). */
create or replace function public.meus_enderecos() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator();
begin
  if s ->> 'ator' <> 'cliente' or s ->> 'id' is null then perform privado.erro('ATOR_SEM_PERMISSAO', 'Entre na sua conta'); end if;
  return coalesce((select jsonb_agg(privado.j_endereco(e) order by e.principal desc, e.criado_em) from public.enderecos e
                    where e.cliente_id = (s ->> 'id')::uuid and e.ativo), '[]');
end $$;

/**
 * "Substituir endereço" (item 9): o endereço novo (validado, CEP atendido) entra ativo no lugar; o anterior fica inativo
 * com o vínculo, preservando os atendimentos dele. Só a dona. p_dados: {endereco, apelido?}.
 */
create or replace function public.substituir_endereco(p_id uuid, p_dados jsonb, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; ant public.enderecos; cli public.clientes; e jsonb; novo public.enderecos; apelido text; reg jsonb;
begin
  if s ->> 'ator' <> 'cliente' or s ->> 'id' is null then perform privado.erro('ATOR_SEM_PERMISSAO', 'Entre na sua conta'); end if;
  r := privado.idem_ler('substituirEndereco', s, p_chave, jsonb_build_object('id', p_id, 'dados', p_dados));
  if r is not null then return r; end if;
  select * into ant from public.enderecos where id = p_id and cliente_id = (s ->> 'id')::uuid for update;
  if not found or not ant.ativo then perform privado.erro('NAO_ENCONTRADO', 'Endereço não encontrado'); end if;
  select * into cli from public.clientes where id = ant.cliente_id;
  e := privado.v3_endereco(p_dados -> 'endereco', cli.tipo);
  reg := privado.v3_regiao(e, privado.cfg_v3());
  if reg is null or coalesce((reg ->> 'sobConsulta')::boolean, false) then
    perform privado.erro('REGIAO_NAO_ATENDIDA', 'No momento, não atendemos esta região.', '{"endereco.cep": "No momento, não atendemos esta região."}');
  end if;
  apelido := nullif(left(regexp_replace(trim(coalesce(p_dados ->> 'apelido', '')), '\s+', ' ', 'g'), 40), '');
  update public.enderecos set ativo = false, principal = false, inativado_em = now(), inativado_motivo = 'substituido' where id = ant.id;
  insert into public.enderecos (cliente_id, cep, logradouro, numero, complemento, bairro, cidade, uf, ponto_referencia, tipo_imovel, tipo_imovel_outro,
                                apelido, principal, origem, ficticio)
  values (ant.cliente_id, e ->> 'cep', e ->> 'logradouro', e ->> 'numero', e ->> 'complemento', e ->> 'bairro', e ->> 'cidade', e ->> 'uf', e ->> 'pontoReferencia',
          e ->> 'tipoImovel', nullif(e ->> 'tipoImovelOutro', ''), apelido, ant.principal, 'site', ant.ficticio)
  returning * into novo;
  update public.enderecos set substituido_por = novo.id where id = ant.id;
  r := privado.j_endereco(novo);
  perform privado.idem_gravar('substituirEndereco', s, p_chave, jsonb_build_object('id', p_id, 'dados', p_dados), r);
  return r;
end $$;

/** Conteúdo público do agendamento (tipos de imóvel e "Ver mais"), editável no painel. */
create or replace function public.conteudo_agendamento() returns jsonb
language sql stable security definer set search_path = '' as $$ select coalesce((select valor from public.configuracao where chave = 'agendamento'), '{}') $$;

revoke execute on function public.meus_enderecos(), public.substituir_endereco(uuid, jsonb, text) from public, anon;
grant execute on function public.meus_enderecos(), public.substituir_endereco(uuid, jsonb, text) to authenticated;
revoke execute on function public.conteudo_agendamento() from public;
grant execute on function public.conteudo_agendamento() to anon, authenticated;

-- conteúdo padrão (igual a CONTEUDO_AGENDAMENTO_PADRAO de src/config/agendamento-v3.js; conferido no testa-paridade-v3)
insert into public.configuracao (chave, valor) values ('agendamento', '{"tiposImovel":{"residencial":["Apartamento","Casa","Cobertura","Flat","Kitnet","Loft","Condomínio residencial","Outro"],"empresa":["Escritório","Sala comercial","Loja","Consultório","Clínica","Academia","Escola","Restaurante","Salão de beleza","Condomínio comercial","Prédio comercial","Galpão","Indústria","Instituição financeira","Hotel","Pousada","Espaço de eventos","Quiosque","Coworking","Outro"]},"verMais":{"residencial":{"naoInclui":["lavagem de roupas, tapetes e sapatos","limpeza de piscina","jardinagem","limpeza de estofados","ventiladores de teto","cortinas/persianas","cristaleiras","adegas","lustres","grelha de churrasqueira","remoção de fezes de animais","tratamento/remoção de mofo","organização de guarda-roupas/closets","cozinhar e preparo de alimentos","remoção de cera"],"observacoes":["Por segurança, as profissionais não realizam atividades em alturas superiores a 2 metros.","A lavagem de áreas externas somente poderá ser realizada quando houver mangueira disponível no local.","Os produtos, materiais, equipamentos e EPIs necessários ao atendimento deverão ser fornecidos pelo cliente."]},"empresarial":{"naoInclui":["limpeza de cozinha industrial","limpeza de estofados","cortinas/persianas","lustres","portões","remoção de cera","transporte de objetos pesados","serviços que demandem equipamentos especiais","tratamento/remoção de mofo"],"observacoes":["Por segurança, as profissionais não realizam atividades em alturas superiores a 2 metros.","A lavagem de áreas externas somente poderá ser realizada quando houver mangueira disponível no local.","Os produtos, materiais, equipamentos e EPIs necessários ao atendimento deverão ser fornecidos pelo cliente."]},"condominial":{"naoInclui":["limpeza de piscina","jardinagem","portões","lustres","remoção de cera","transporte de objetos pesados","serviços que demandem equipamentos especiais"],"observacoes":["Por segurança, as profissionais não realizam atividades em alturas superiores a 2 metros.","A lavagem de áreas externas somente poderá ser realizada quando houver mangueira disponível no local.","Os produtos, materiais, equipamentos e EPIs necessários ao atendimento deverão ser fornecidos pelo cliente."]},"pre_pos_mudanca":{"naoInclui":["limpeza pós-obra","transporte de objetos pesados","remoção de cera","tratamento/remoção de mofo","limpeza de estofados","lustres","cortinas/persianas"],"observacoes":["Por segurança, as profissionais não realizam atividades em alturas superiores a 2 metros.","A lavagem de áreas externas somente poderá ser realizada quando houver mangueira disponível no local.","Os produtos, materiais, equipamentos e EPIs necessários ao atendimento deverão ser fornecidos pelo cliente."]},"pre_pos_evento":{"naoInclui":["grelha de churrasqueira","limpeza de cozinha industrial","remoção de cera","transporte de objetos pesados","limpeza de estofados","serviços que demandem equipamentos especiais"],"observacoes":["Por segurança, as profissionais não realizam atividades em alturas superiores a 2 metros.","A lavagem de áreas externas somente poderá ser realizada quando houver mangueira disponível no local.","Os produtos, materiais, equipamentos e EPIs necessários ao atendimento deverão ser fornecidos pelo cliente."]},"passadoria":{"naoInclui":["lavagem de roupas"],"observacoes":["O ferro de passar, a tábua e demais equipamentos são fornecidos pelo cliente.","A duração é uma estimativa e pode variar conforme a quantidade, o tipo e o estado das peças, além do equipamento disponível para a realização da passadoria."]}}}'::jsonb) on conflict (chave) do nothing;
