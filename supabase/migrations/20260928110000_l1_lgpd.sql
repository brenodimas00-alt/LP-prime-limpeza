-- L1 (fase 2): LGPD. Versão dos documentos legais, aceite com data e versão, consentimentos opcionais e separados,
-- pedidos do titular (baixar e excluir os próprios dados) e flags de configuração (princípio 1.2 da fase 2).
-- Tudo novo com RLS negando por padrão; escrita só por RPC.

-- ---------- flags (lidas no servidor; só prime_admin alterna, auditado) ----------
create table public.config_flags (
  chave text primary key check (chave ~ '^[a-z0-9_]{3,60}$'),
  ligada boolean not null,
  padrao boolean not null,
  descricao text not null check (char_length(descricao) between 3 and 200),
  atualizado_por uuid references auth.users (id) on delete set null,
  atualizado_em timestamptz not null default now()
);
alter table public.config_flags enable row level security;
insert into public.config_flags (chave, ligada, padrao, descricao) values
  ('lgpd_portal_titular', true, true, 'Minha conta: "Baixar meus dados" e "Excluir meus dados"'),
  ('lgpd_reaceite_termos', true, true, 'Pedir novo aceite dos termos no login quando a versão mudar');

create or replace function privado.flag(p_chave text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select f.ligada from public.config_flags f where f.chave = p_chave), false)
$$;

create or replace function public.listar_flags() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not privado.eh_prime() then perform privado.erro('ATOR_SEM_PERMISSAO', 'Só a Prime vê as configurações.'); end if;
  return coalesce((select jsonb_agg(jsonb_build_object('chave', f.chave, 'ligada', f.ligada, 'padrao', f.padrao, 'descricao', f.descricao,
    'atualizadoEm', f.atualizado_em) order by f.chave) from public.config_flags f), '[]'::jsonb);
end $$;

create or replace function public.alternar_flag(p_chave text, p_ligada boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare f public.config_flags;
begin
  if not privado.eh_prime_admin() then perform privado.erro('ATOR_SEM_PERMISSAO', 'Só a administração da Prime altera configurações.'); end if;
  if p_ligada is null then perform privado.erro('DADOS_INVALIDOS', 'Informe ligada ou desligada.'); end if;
  select * into f from public.config_flags where chave = p_chave for update;
  if not found then perform privado.erro('NAO_ENCONTRADO', 'Configuração não encontrada.'); end if;
  if f.ligada = p_ligada then return jsonb_build_object('chave', f.chave, 'ligada', f.ligada); end if; -- idempotente
  update public.config_flags set ligada = p_ligada, atualizado_por = auth.uid(), atualizado_em = now() where chave = p_chave;
  insert into public.auditoria (tabela, registro_id, operacao, ator_user_id, ator_papel, ator_contexto, antes, depois)
  values ('config_flags', null, 'UPDATE', auth.uid(), privado.papel(), 'prime',
          jsonb_build_object('chave', p_chave, 'ligada', f.ligada), jsonb_build_object('chave', p_chave, 'ligada', p_ligada));
  return jsonb_build_object('chave', p_chave, 'ligada', p_ligada);
end $$;

-- ---------- documentos legais (versão vigente = a mais recente já em vigor) ----------
create table public.documentos_legais (
  versao text primary key check (versao ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  vigente_desde timestamptz not null,
  resumo text not null check (char_length(resumo) between 3 and 500)
);
alter table public.documentos_legais enable row level security;
insert into public.documentos_legais (versao, vigente_desde, resumo)
values ('2026-09-28', '2026-09-28 00:00:00-03', 'Primeira versão da Política de Privacidade e dos Termos de Uso.');

create or replace function privado.versao_legal() returns text
language sql stable security definer set search_path = '' as $$
  select d.versao from public.documentos_legais d where d.vigente_desde <= now() order by d.vigente_desde desc limit 1
$$;

create table public.aceites_termos (
  id bigserial primary key,
  user_id uuid references auth.users (id) on delete set null,
  titular_tipo text not null check (titular_tipo in ('cliente', 'diarista')),
  titular_id uuid not null,
  versao text not null references public.documentos_legais (versao),
  origem text not null check (origem in ('cadastro_cliente', 'cadastro_diarista', 'reaceite')),
  aceito_em timestamptz not null default now(),
  unique (titular_tipo, titular_id, versao)
);
alter table public.aceites_termos enable row level security;
create index aceites_termos_user on public.aceites_termos (user_id);

create table public.consentimentos (
  id bigserial primary key,
  user_id uuid references auth.users (id) on delete set null,
  titular_tipo text not null check (titular_tipo in ('cliente', 'diarista')),
  titular_id uuid not null,
  tipo text not null check (tipo in ('marketing_whatsapp', 'marketing_email', 'localizacao_profissional')),
  concedido boolean not null,
  canal text not null check (canal in ('site', 'whatsapp', 'painel')),
  origem text not null check (origem in ('minha_conta', 'cadastro_cliente', 'cadastro_diarista', 'agenda_diarista', 'opt_out', 'exclusao')),
  em timestamptz not null default now(),
  check ((tipo = 'localizacao_profissional') = (titular_tipo = 'diarista'))
);
alter table public.consentimentos enable row level security;
-- histórico só de inserção; o estado atual é a linha mais recente por titular e tipo
create index consentimentos_atual on public.consentimentos (titular_tipo, titular_id, tipo, em desc, id desc);

create table public.pedidos_titular (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  titular_tipo text not null check (titular_tipo in ('cliente', 'diarista')),
  titular_id uuid not null,
  tipo text not null check (tipo in ('acesso', 'exclusao')),
  estado text not null check (estado in ('aberto', 'anonimizado', 'executado', 'recusado')),
  motivo text check (char_length(motivo) <= 500),
  resposta text check (char_length(resposta) <= 500),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  executado_por uuid references auth.users (id) on delete set null,
  executado_em timestamptz
);
alter table public.pedidos_titular enable row level security;
-- um pedido de exclusão em andamento por titular (pedir de novo devolve o mesmo)
create unique index pedidos_titular_exclusao_aberta on public.pedidos_titular (titular_tipo, titular_id)
  where tipo = 'exclusao' and estado in ('aberto', 'anonimizado');
create index pedidos_titular_painel on public.pedidos_titular (estado, criado_em desc);

alter table public.clientes add column anonimizado_em timestamptz;

-- ---------- titular da sessão ----------
create or replace function privado.titular() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator();
begin
  if s ->> 'ator' = 'cliente' and s ->> 'id' is not null then return jsonb_build_object('tipo', 'cliente', 'id', s ->> 'id'); end if;
  if s ->> 'ator' = 'diarista' and s ->> 'id' is not null then return jsonb_build_object('tipo', 'diarista', 'id', s ->> 'id'); end if;
  perform privado.erro('ATOR_SEM_PERMISSAO', 'Entre na sua conta pra continuar.');
end $$;

create or replace function privado.consentimentos_atuais(p_tipo text, p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(x.tipo, x.concedido), '{}'::jsonb) from (
    select distinct on (c.tipo) c.tipo, c.concedido from public.consentimentos c
     where c.titular_tipo = p_tipo and c.titular_id = p_id order by c.tipo, c.em desc, c.id desc) x
$$;

/** Situação legal da conta logada: versão vigente, se já aceitou, consentimentos atuais, exclusão em andamento, flags. */
create or replace function public.situacao_legal() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t jsonb := privado.titular(); v text := privado.versao_legal();
begin
  return jsonb_build_object(
    'versaoVigente', v,
    'aceitouVigente', exists (select 1 from public.aceites_termos a where a.titular_tipo = t ->> 'tipo' and a.titular_id = (t ->> 'id')::uuid and a.versao = v),
    'pedirAceite', privado.flag('lgpd_reaceite_termos'),
    'portal', privado.flag('lgpd_portal_titular'),
    'consentimentos', privado.consentimentos_atuais(t ->> 'tipo', (t ->> 'id')::uuid),
    'exclusaoEmAndamento', exists (select 1 from public.pedidos_titular p where p.titular_tipo = t ->> 'tipo' and p.titular_id = (t ->> 'id')::uuid
                                   and p.tipo = 'exclusao' and p.estado in ('aberto', 'anonimizado')));
end $$;

/** Aceite da versão vigente (idempotente: aceitar de novo a mesma versão não cria outra linha). */
create or replace function public.registrar_aceite(p_versao text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t jsonb := privado.titular(); v text := privado.versao_legal();
begin
  if p_versao is distinct from v then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Os termos mudaram. Recarregue a página e leia a versão nova.'); end if;
  insert into public.aceites_termos (user_id, titular_tipo, titular_id, versao, origem)
  values (auth.uid(), t ->> 'tipo', (t ->> 'id')::uuid, v, 'reaceite') on conflict (titular_tipo, titular_id, versao) do nothing;
  return jsonb_build_object('versao', v, 'aceito', true);
end $$;

/** Cadastro de cliente pela function "conta" (papel de serviço): o aceite é conferido e gravado no servidor. */
create or replace function public.conta_registrar_aceite(p_user uuid, p_versao text) returns void
language plpgsql security definer set search_path = '' as $$
declare v text := privado.versao_legal(); c uuid;
begin
  if p_versao is distinct from v then perform privado.erro('DADOS_INVALIDOS', 'Aceite os Termos de Uso e a Política de Privacidade.', '{"aceite": "Aceite os termos para continuar"}'); end if;
  select id into c from public.clientes where usuario_id = p_user;
  if c is null then perform privado.erro('NAO_ENCONTRADO', 'Cadastro não encontrado.'); end if;
  insert into public.aceites_termos (user_id, titular_tipo, titular_id, versao, origem)
  values (p_user, 'cliente', c, v, 'cadastro_cliente') on conflict (titular_tipo, titular_id, versao) do nothing;
end $$;

/** Diarista: o envio do cadastro (aceite_termos_em) grava o aceite da versão vigente, sem depender do front. */
create or replace function privado.aceite_diarista() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.aceite_termos_em is not null and old.aceite_termos_em is distinct from new.aceite_termos_em then
    insert into public.aceites_termos (user_id, titular_tipo, titular_id, versao, origem, aceito_em)
    values (new.usuario_id, 'diarista', new.id, privado.versao_legal(), 'cadastro_diarista', new.aceite_termos_em)
    on conflict (titular_tipo, titular_id, versao) do nothing;
  end if;
  return new;
end $$;
create trigger aceite_termos after update of aceite_termos_em on public.diaristas for each row execute function privado.aceite_diarista();

/** Consentimento opcional (liga ou desliga na hora). Repetir o mesmo valor não cria linha nova. */
create or replace function public.definir_consentimento(p_tipo text, p_concedido boolean, p_origem text default 'minha_conta') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t jsonb := privado.titular(); atual jsonb;
begin
  if p_concedido is null or p_tipo is null then perform privado.erro('DADOS_INVALIDOS', 'Informe o consentimento.'); end if;
  if (p_tipo = 'localizacao_profissional') <> (t ->> 'tipo' = 'diarista') or p_tipo not in ('marketing_whatsapp', 'marketing_email', 'localizacao_profissional') then
    perform privado.erro('DADOS_INVALIDOS', 'Consentimento não se aplica a esta conta.');
  end if;
  if p_origem not in ('minha_conta', 'cadastro_cliente', 'cadastro_diarista', 'agenda_diarista') then perform privado.erro('DADOS_INVALIDOS', 'Origem inválida.'); end if;
  perform pg_advisory_xact_lock(hashtextextended('consentimento:' || (t ->> 'id') || ':' || p_tipo, 0));
  atual := privado.consentimentos_atuais(t ->> 'tipo', (t ->> 'id')::uuid);
  if (atual ->> p_tipo)::boolean is not distinct from p_concedido then return atual; end if;
  insert into public.consentimentos (user_id, titular_tipo, titular_id, tipo, concedido, canal, origem)
  values (auth.uid(), t ->> 'tipo', (t ->> 'id')::uuid, p_tipo, p_concedido, 'site', p_origem);
  return privado.consentimentos_atuais(t ->> 'tipo', (t ->> 'id')::uuid);
end $$;

/** "Baixar meus dados": tudo o que o sistema guarda da própria conta (sem segredo nem dado de terceiro). Registra o acesso. */
create or replace function public.meus_dados() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t jsonb := privado.titular(); v_id uuid := (t ->> 'id')::uuid; r jsonb;
begin
  if not privado.flag('lgpd_portal_titular') then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Fale com a Prime para receber seus dados.'); end if;
  if t ->> 'tipo' = 'cliente' then
    r := jsonb_build_object(
      'cadastro', (select to_jsonb(c) - 'importacao' - 'ficticio' - 'usuario_id' from public.clientes c where c.id = v_id),
      'pedidos', coalesce((select jsonb_agg(to_jsonb(p) - 'ficticio' - 'observacao_disponibilidade' order by p.criado_em) from public.pedidos p where p.cliente_id = v_id), '[]'),
      'diarias', coalesce((select jsonb_agg(jsonb_build_object('pedido', a.pedido_id, 'data', a.data, 'turno', a.turno, 'status', a.status, 'valorDiaCentavos', a.valor_dia_centavos) order by a.data)
                           from public.atendimentos a join public.pedidos p on p.id = a.pedido_id where p.cliente_id = v_id), '[]'),
      'pagamentos', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'pedido', g.pedido_id, 'valorCentavos', g.valor_centavos, 'metodo', g.metodo, 'status', g.status,
                              'venceEm', g.vence_em, 'informadoEm', g.informado_em, 'confirmadoEm', g.confirmado_em, 'estorno', g.estorno) order by g.criado_em)
                              from public.pagamentos g join public.pedidos p on p.id = g.pedido_id where p.cliente_id = v_id), '[]'),
      'pesquisas', coalesce((select jsonb_agg(jsonb_build_object('diaria', v.atendimento_id, 'notas', v.notas, 'comentario', v.comentario, 'em', v.criado_em))
                             from public.avaliacoes v join public.atendimentos a on a.id = v.atendimento_id join public.pedidos p on p.id = a.pedido_id where p.cliente_id = v_id), '[]'));
  else
    r := jsonb_build_object(
      'cadastro', (select to_jsonb(d) - 'ficticio' - 'usuario_id' - 'decisao' - 'historico' from public.diaristas d where d.id = v_id),
      'documentos', coalesce((select jsonb_agg(jsonb_build_object('tipo', x.tipo, 'enviadoEm', x.criado_em, 'arquivoApagado', x.excluido_em is not null)) from public.documentos x where x.diarista_id = v_id), '[]'),
      'diarias', coalesce((select jsonb_agg(jsonb_build_object('data', a.data, 'turno', a.turno, 'status', a.status) order by a.data) from public.atendimentos a where a.diarista_id = v_id), '[]'));
  end if;
  r := r || jsonb_build_object(
    'geradoEm', now(), 'titular', t ->> 'tipo',
    'acessos', coalesce((select jsonb_agg(jsonb_build_object('em', x.em, 'resultado', x.resultado, 'dispositivo', x.dispositivo) order by x.em desc)
                         from (select * from public.acessos a where a.user_id = auth.uid() order by a.em desc limit 200) x), '[]'),
    'aceites', coalesce((select jsonb_agg(jsonb_build_object('versao', a.versao, 'em', a.aceito_em, 'origem', a.origem) order by a.aceito_em)
                         from public.aceites_termos a where a.titular_tipo = t ->> 'tipo' and a.titular_id = v_id), '[]'),
    'consentimentos', coalesce((select jsonb_agg(jsonb_build_object('tipo', c.tipo, 'concedido', c.concedido, 'em', c.em, 'origem', c.origem) order by c.em)
                                from public.consentimentos c where c.titular_tipo = t ->> 'tipo' and c.titular_id = v_id), '[]'));
  insert into public.pedidos_titular (user_id, titular_tipo, titular_id, tipo, estado, executado_em) values (auth.uid(), t ->> 'tipo', v_id, 'acesso', 'executado', now());
  return r;
end $$;

/** "Excluir meus dados": registra o pedido (a Prime executa no painel). Pedir de novo devolve o mesmo pedido. */
create or replace function public.pedir_exclusao(p_motivo text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t jsonb := privado.titular(); p public.pedidos_titular;
begin
  if not privado.flag('lgpd_portal_titular') then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Fale com a Prime para pedir a exclusão.'); end if;
  if t ->> 'tipo' <> 'cliente' then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Fale com a Prime para pedir a exclusão do seu cadastro.'); end if;
  perform pg_advisory_xact_lock(hashtextextended('exclusao:' || (t ->> 'id'), 0));
  select * into p from public.pedidos_titular x where x.titular_tipo = 'cliente' and x.titular_id = (t ->> 'id')::uuid and x.tipo = 'exclusao' and x.estado in ('aberto', 'anonimizado');
  if not found then
    insert into public.pedidos_titular (user_id, titular_tipo, titular_id, tipo, estado, motivo)
    values (auth.uid(), 'cliente', (t ->> 'id')::uuid, 'exclusao', 'aberto', left(nullif(trim(p_motivo), ''), 500)) returning * into p;
  end if;
  return jsonb_build_object('id', p.id, 'estado', p.estado, 'criadoEm', p.criado_em);
end $$;

-- ---------- painel ----------
create or replace function privado.mascarar_doc(d text) returns text
language sql immutable set search_path = '' as $$
  select case when d is null then null when length(d) = 11 then '***.' || substr(d, 4, 3) || '.***-**' else left(d, 2) || '.***.***/****-' || right(d, 2) end
$$;

create or replace function public.listar_pedidos_titular(p_filtro jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare est text := nullif(p_filtro ->> 'estado', '');
begin
  if not privado.eh_prime() then perform privado.erro('ATOR_SEM_PERMISSAO', 'Só a Prime vê os pedidos.'); end if;
  return coalesce((select jsonb_agg(x order by x ->> 'criadoEm' desc) from (
    select jsonb_build_object('id', p.id, 'tipo', p.tipo, 'estado', p.estado, 'motivo', p.motivo, 'resposta', p.resposta, 'criadoEm', p.criado_em,
      'executadoEm', p.executado_em, 'titularTipo', p.titular_tipo,
      'nome', coalesce(c.nome, d.nome), 'documento', privado.mascarar_doc(coalesce(c.documento, d.cpf))) x
      from public.pedidos_titular p
      left join public.clientes c on p.titular_tipo = 'cliente' and c.id = p.titular_id
      left join public.diaristas d on p.titular_tipo = 'diarista' and d.id = p.titular_id
     where p.tipo = 'exclusao' and (est is null or p.estado = est)
     order by p.criado_em desc limit 200) s), '[]'::jsonb);
end $$;

/**
 * Exclusão (só prime_admin, pela function "conta", que depois apaga o usuário do Auth). Anonimiza o cadastro e o que
 * repete dado pessoal (acessos, avisos, eventos, cache de idempotência, auditoria); preserva pedidos, diárias e
 * pagamentos (obrigação legal e fiscal), com o documento, que liga o pagamento ao pagador. Retomável: chamar de novo
 * depois de 'anonimizado' só devolve o usuário a apagar.
 */
create or replace function public.conta_executar_exclusao(p_ator uuid, p_pedido uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.pedidos_titular; c public.clientes; peds uuid[]; pend int; ids text[];
begin
  if not exists (select 1 from public.perfis where user_id = p_ator and not bloqueado and papel = 'prime_admin') or privado.troca_senha_pendente(p_ator) then
    perform privado.erro('ATOR_SEM_PERMISSAO', 'Só a administração da Prime executa exclusões.');
  end if;
  select * into p from public.pedidos_titular where id = p_pedido and tipo = 'exclusao' for update;
  if not found then perform privado.erro('NAO_ENCONTRADO', 'Pedido não encontrado.'); end if;
  if p.estado = 'executado' then return jsonb_build_object('estado', 'executado', 'userId', null); end if;
  if p.estado = 'recusado' then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Pedido recusado.'); end if;
  if p.titular_tipo <> 'cliente' then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Exclusão de profissional é feita manualmente pela Prime.'); end if;
  select * into c from public.clientes where id = p.titular_id for update;
  if p.estado = 'anonimizado' then return jsonb_build_object('estado', 'anonimizado', 'userId', coalesce(p.user_id, c.usuario_id)); end if;

  peds := array(select id from public.pedidos where cliente_id = c.id);
  select count(*) into pend from public.atendimentos a where a.pedido_id = any(peds)
   and a.status not in ('finalizado', 'avaliado', 'cancelado');
  select pend + count(*) into pend from public.pagamentos g where g.pedido_id = any(peds) and g.status in ('pendente', 'informado');
  if pend > 0 then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Esta cliente tem diária ou pagamento em aberto. Conclua ou cancele antes de excluir.'); end if;
  if exists (select 1 from public.eventos e where (e.refs ->> 'clienteId' = c.id::text or e.refs ->> 'pedidoId' = any(peds::text[])) and e.status not in ('processado', 'erro')) then
    perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Ainda há avisos desta cliente na fila. Tente de novo em alguns minutos.');
  end if;

  perform set_config('app.ator', 'prime', true);
  update public.clientes set nome = 'Titular excluída', telefone = null, email = null, data_nascimento = null, responsavel = null,
    endereco = jsonb_strip_nulls(jsonb_build_object('cidade', endereco ->> 'cidade', 'uf', endereco ->> 'uf')), importacao = null,
    pendencias = '{}', anonimizado_em = now()
   where id = c.id;
  update public.pedidos set preferencia_profissional = null where id = any(peds);
  update public.avaliacoes v set comentario = null from public.atendimentos a where a.id = v.atendimento_id and a.pedido_id = any(peds);
  update public.acessos set email = null, identificador = null, ip = null, dispositivo = null where user_id = c.usuario_id;
  update public.notificacoes set destinatario = '{}'::jsonb, variaveis = '{}'::jsonb, previa = null
   where refs ->> 'clienteId' = c.id::text or refs ->> 'pedidoId' = any(peds::text[]);
  update public.eventos set dados = '{}'::jsonb where refs ->> 'clienteId' = c.id::text or refs ->> 'pedidoId' = any(peds::text[]);
  ids := array[c.id::text] || peds::text[] || coalesce(c.usuario_id::text, '');
  delete from public.idempotencia i where exists (select 1 from unnest(ids) x where x <> '' and (i.chave like '%' || x || '%' or i.resultado::text like '%' || x || '%'));
  update public.perfis set bloqueado = true, bloqueado_em = now(), bloqueado_motivo = 'exclusão de dados (LGPD)' where user_id = c.usuario_id;
  insert into public.consentimentos (user_id, titular_tipo, titular_id, tipo, concedido, canal, origem)
  select c.usuario_id, 'cliente', c.id, k.tipo, false, 'painel', 'exclusao'
    from (select key as tipo from jsonb_each(privado.consentimentos_atuais('cliente', c.id)) where value = 'true'::jsonb) k;
  update public.pedidos_titular set estado = 'anonimizado', executado_por = p_ator, atualizado_em = now() where id = p.id;
  -- por último: a auditoria das linhas acima (e a antiga) não pode guardar o dado que acabou de sair
  update public.auditoria set
    antes = case when antes is null then null else antes - array['nome', 'telefone', 'email', 'data_nascimento', 'responsavel', 'endereco', 'importacao', 'preferencia_profissional', 'comentario'] end,
    depois = case when depois is null then null else depois - array['nome', 'telefone', 'email', 'data_nascimento', 'responsavel', 'endereco', 'importacao', 'preferencia_profissional', 'comentario'] end
   where (tabela = 'clientes' and registro_id = c.id) or (tabela = 'pedidos' and registro_id = any(peds))
      or (tabela in ('perfis', 'auth.users') and registro_id = c.usuario_id);
  insert into public.auditoria (tabela, registro_id, operacao, ator_user_id, ator_papel, ator_contexto, depois)
  values ('pedidos_titular', p.id, 'UPDATE', p_ator, 'prime_admin', 'conta:executar_exclusao', jsonb_build_object('estado', 'anonimizado', 'cliente', c.id));
  return jsonb_build_object('estado', 'anonimizado', 'userId', c.usuario_id);
end $$;

create or replace function public.conta_concluir_exclusao(p_ator uuid, p_pedido uuid) returns void
language sql security definer set search_path = '' as $$
  update public.pedidos_titular set estado = 'executado', executado_por = p_ator, executado_em = now(), atualizado_em = now()
   where id = p_pedido and estado = 'anonimizado'
$$;

create or replace function public.recusar_pedido_titular(p_id uuid, p_resposta text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not privado.eh_prime_admin() then perform privado.erro('ATOR_SEM_PERMISSAO', 'Só a administração da Prime responde pedidos.'); end if;
  if char_length(trim(coalesce(p_resposta, ''))) < 5 then perform privado.erro('DADOS_INVALIDOS', 'Explique o motivo.', '{"resposta": "Explique o motivo"}'); end if;
  update public.pedidos_titular set estado = 'recusado', resposta = left(trim(p_resposta), 500), executado_por = auth.uid(), executado_em = now(), atualizado_em = now()
   where id = p_id and tipo = 'exclusao' and estado = 'aberto';
  if not found then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Pedido não está aberto.'); end if;
  insert into public.auditoria (tabela, registro_id, operacao, ator_user_id, ator_papel, ator_contexto, depois)
  values ('pedidos_titular', p_id, 'UPDATE', auth.uid(), 'prime_admin', 'prime', jsonb_build_object('estado', 'recusado'));
  return jsonb_build_object('id', p_id, 'estado', 'recusado');
end $$;

-- ---------- permissões (negar por padrão; só o que o front chama) ----------
revoke all on public.config_flags, public.documentos_legais, public.aceites_termos, public.consentimentos, public.pedidos_titular from anon, authenticated;
revoke execute on function public.listar_flags(), public.alternar_flag(text, boolean), public.situacao_legal(), public.registrar_aceite(text),
  public.conta_registrar_aceite(uuid, text), public.definir_consentimento(text, boolean, text), public.meus_dados(), public.pedir_exclusao(text),
  public.listar_pedidos_titular(jsonb), public.conta_executar_exclusao(uuid, uuid), public.conta_concluir_exclusao(uuid, uuid),
  public.recusar_pedido_titular(uuid, text) from public, anon, authenticated;
grant execute on function public.listar_flags(), public.alternar_flag(text, boolean), public.situacao_legal(), public.registrar_aceite(text),
  public.definir_consentimento(text, boolean, text), public.meus_dados(), public.pedir_exclusao(text), public.listar_pedidos_titular(jsonb),
  public.recusar_pedido_titular(uuid, text) to authenticated;
grant execute on function public.conta_registrar_aceite(uuid, text), public.conta_executar_exclusao(uuid, uuid), public.conta_concluir_exclusao(uuid, uuid) to service_role;
-- versão vigente é pública (a página de cadastro mostra qual versão a pessoa está aceitando)
create or replace function public.versao_legal() returns text language sql stable security definer set search_path = '' as $$ select privado.versao_legal() $$;
revoke execute on function public.versao_legal() from public;
grant execute on function public.versao_legal() to anon, authenticated, service_role;
