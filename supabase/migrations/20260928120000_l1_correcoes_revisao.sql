-- Correções da revisão do GPT no L1 (fase 2, 28/09/2026). Só aditiva: funções novas, triggers novos e create or replace.
-- 1) Cadastro de cliente nova e aceite dos termos numa transação só (antes: duas RPCs; falhar entre elas deixava cadastro órfão).
create or replace function public.conta_cadastrar_cliente_com_aceite(p_user uuid, p_dados jsonb, p_versao text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_versao is distinct from privado.versao_legal() then
    perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Os termos mudaram. Recarregue a página e leia a versão nova.');
  end if;
  v_id := public.conta_cadastrar_cliente(p_user, p_dados);
  insert into public.aceites_termos (user_id, titular_tipo, titular_id, versao, origem)
  values (p_user, 'cliente', v_id, p_versao, 'cadastro_cliente') on conflict (titular_tipo, titular_id, versao) do nothing;
  return v_id;
end $$;
revoke execute on function public.conta_cadastrar_cliente_com_aceite(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.conta_cadastrar_cliente_com_aceite(uuid, jsonb, text) to service_role;

-- 2) Cadastro anonimizado não volta a ter dado pessoal nem ganha pedido novo, por qualquer caminho (uma chamada que já
--    passou da autorização e esperava a trava da exclusão regravaria nome/contato/endereço).
create or replace function privado.protege_anonimizado() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.anonimizado_em is not null and (
       new.anonimizado_em is null or new.nome is distinct from old.nome or new.email is not null or new.telefone is not null
    or new.data_nascimento is not null or new.responsavel is not null or new.endereco is distinct from old.endereco
    or (new.usuario_id is not null and new.usuario_id is distinct from old.usuario_id)) then
    perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Cadastro excluído a pedido da titular.');
  end if;
  return new;
end $$;
create trigger protege_anonimizado before update on public.clientes for each row execute function privado.protege_anonimizado();

create or replace function privado.pedido_de_anonimizado() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.clientes c where c.id = new.cliente_id and c.anonimizado_em is not null) then
    perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Cadastro excluído a pedido da titular.');
  end if;
  return new;
end $$;
create trigger pedido_de_anonimizado before insert on public.pedidos for each row execute function privado.pedido_de_anonimizado();

-- 3) Exclusão limpa também textos livres dos pedidos, o motivo do próprio pedido e tentativas de login sem conta resolvida.
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
  -- textos livres dos pedidos podem citar a cliente (revisão do GPT): saem; datas e estados ficam
  update public.pedidos set preferencia_profissional = null, observacao_disponibilidade = null,
    recusa = case when recusa is null then null else recusa - 'motivo' end,
    cancelamento = case when cancelamento is null then null else cancelamento - 'motivo' end
   where id = any(peds);
  update public.avaliacoes v set comentario = null from public.atendimentos a where a.id = v.atendimento_id and a.pedido_id = any(peds);
  -- tentativas de login dela também sem conta resolvida (identificador digitado = e-mail, CPF/CNPJ ou celular dela)
  update public.acessos set email = null, identificador = null, ip = null, dispositivo = null
   where user_id = c.usuario_id
      or (user_id is null and (lower(email) = lower(c.email) or identificador in (lower(c.email), c.documento, c.telefone)));
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
  update public.pedidos_titular set motivo = null where titular_tipo = 'cliente' and titular_id = c.id and motivo is not null;
  -- por último: a auditoria das linhas acima (e a antiga) não pode guardar o dado que acabou de sair
  update public.auditoria set
    antes = case when antes is null then null else antes - array['nome', 'telefone', 'email', 'data_nascimento', 'responsavel', 'endereco', 'importacao', 'preferencia_profissional', 'comentario', 'observacao_disponibilidade', 'recusa', 'cancelamento'] end,
    depois = case when depois is null then null else depois - array['nome', 'telefone', 'email', 'data_nascimento', 'responsavel', 'endereco', 'importacao', 'preferencia_profissional', 'comentario', 'observacao_disponibilidade', 'recusa', 'cancelamento'] end
   where (tabela = 'clientes' and registro_id = c.id) or (tabela = 'pedidos' and registro_id = any(peds))
      or (tabela in ('perfis', 'auth.users') and registro_id = c.usuario_id);
  insert into public.auditoria (tabela, registro_id, operacao, ator_user_id, ator_papel, ator_contexto, depois)
  values ('pedidos_titular', p.id, 'UPDATE', p_ator, 'prime_admin', 'conta:executar_exclusao', jsonb_build_object('estado', 'anonimizado', 'cliente', c.id));
  return jsonb_build_object('estado', 'anonimizado', 'userId', c.usuario_id);
end $$;


-- 4) RLS FORÇADA nas tabelas novas, como em todas as outras (pego pelo testa-rls: só estava ligada).
alter table public.config_flags force row level security;
alter table public.documentos_legais force row level security;
alter table public.aceites_termos force row level security;
alter table public.consentimentos force row level security;
alter table public.pedidos_titular force row level security;
