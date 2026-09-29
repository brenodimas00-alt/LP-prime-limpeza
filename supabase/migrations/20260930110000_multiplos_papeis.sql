-- Mais de um papel na mesma conta (pedido da Gabrielle, 29/09): ex. a admin da cliente que também é cliente da Prime.
-- perfis.papeis guarda todos; perfis.papel continua existindo e passa a ser o PRINCIPAL (o de mais privilégio, mantido
-- pelo trigger), então toda checagem antiga pelo principal ("é prime_admin?", "tem papel além de cliente?") segue certa.
-- Papel ATIVO: cada requisição escolhe, pelo header x-papel, um dos papéis que a conta TEM (a área que a tela abriu);
-- sem header vale o principal; header com papel que a conta não tem devolve NULL (nega tudo). Assim nenhuma requisição
-- acumula acesso de dois papéis (a mesma regra do vínculo duplo cliente/diarista da revisão do B1).

alter table public.perfis add column papeis text[];
update public.perfis set papeis = array[papel];
alter table public.perfis alter column papeis set not null;
alter table public.perfis add constraint perfis_papeis_validos check (
  cardinality(papeis) between 1 and 4
  and papeis <@ array['cliente', 'diarista', 'prime_admin', 'prime_atendimento']::text[]
  and papel = any (papeis)
);

/** Principal = o de mais privilégio. */
create or replace function privado.papel_principal(p text[]) returns text
language sql immutable set search_path = '' as $$
  select x from unnest(p) x
   order by array_position(array['prime_admin', 'prime_atendimento', 'diarista', 'cliente']::text[], x) limit 1
$$;

/**
 * Mantém papel e papeis coerentes. Quem mexe em papeis define a lista (papel vira o principal dela). Código antigo que
 * só troca papel (ex. cliente que vira diarista ao enviar o cadastro): conta de um papel só troca de papel, como antes;
 * conta com vários ganha o novo papel sem perder os outros.
 */
create or replace function privado.perfis_papeis() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.papeis := coalesce(new.papeis, array[new.papel]);
  elsif new.papeis is distinct from old.papeis then
    null; -- lista nova manda
  elsif new.papel is distinct from old.papel then
    new.papeis := case when cardinality(old.papeis) = 1 then array[new.papel]
                       when new.papel = any (old.papeis) then old.papeis
                       else old.papeis || new.papel end;
  end if;
  new.papeis := array(select distinct x from unnest(new.papeis) x order by x);
  new.papel := privado.papel_principal(new.papeis);
  return new;
end $$;
create trigger perfis_papeis before insert or update on public.perfis for each row execute function privado.perfis_papeis();

/** Papel pedido pela tela (header x-papel), ou NULL sem header. */
create or replace function privado.papel_pedido() returns text
language sql stable set search_path = '' as $$
  select nullif(trim(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-papel'), '')
$$;

-- Papel ATIVO (mesma assinatura: todas as policies e RPCs já passam por aqui). Bloqueio e troca de senha pendente continuam negando tudo.
create or replace function privado.papel() returns text
language sql stable security definer set search_path = '' as $$
  select case when privado.papel_pedido() is null then p.papel
              when privado.papel_pedido() = any (p.papeis) then privado.papel_pedido() end
    from public.perfis p
   where p.user_id = auth.uid() and not p.bloqueado and not privado.troca_senha_pendente(auth.uid())
$$;

/** Todos os papéis da conta (para serviço e testes; o navegador recebe no token). */
create or replace function privado.tem_papel(p_user uuid, p_papel text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p_papel = any (p.papeis) from public.perfis p where p.user_id = p_user), false)
$$;

-- Auditoria grava o papel ATIVO de quem agiu (com vários papéis, o principal não diz em que área a pessoa estava).
create or replace function privado.auditar() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if tg_op = 'UPDATE' and to_jsonb(new) = to_jsonb(old) then return new; end if;
  v_id := coalesce((to_jsonb(new) ->> 'id'), (to_jsonb(old) ->> 'id'), (to_jsonb(new) ->> 'user_id'), (to_jsonb(old) ->> 'user_id'))::uuid;
  insert into public.auditoria (tabela, registro_id, operacao, ator_user_id, ator_papel, ator_contexto, antes, depois)
  values (tg_table_name, v_id, tg_op, auth.uid(),
          coalesce(privado.papel(), (select p.papel from public.perfis p where p.user_id = auth.uid())),
          coalesce(nullif(current_setting('app.ator', true), ''), case when auth.uid() is null then 'servico' end),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

-- Token: "papel" continua o principal (compatível) e "papeis" traz a lista, pra tela oferecer a escolha de área.
create or replace function public.hook_token(event jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (event ->> 'user_id')::uuid;
  v_metodo text := event ->> 'authentication_method';
  v_perfil public.perfis;
  v_ticket uuid;
  v_claims jsonb := event -> 'claims';
begin
  select * into v_perfil from public.perfis where user_id = v_user;
  if v_perfil.bloqueado then
    return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'Acesso bloqueado. Fale com a Prime.'));
  end if;
  if v_metodo = 'password' then
    delete from privado.tickets
     where id = (select t.id from privado.tickets t where t.tipo = 'login' and t.user_id = v_user and t.expira_em > now() order by t.criado_em limit 1)
    returning id into v_ticket;
    if v_ticket is null then
      return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'Entre pela página da Prime.'));
    end if;
  end if;
  v_claims := jsonb_set(v_claims, '{papel}', to_jsonb(coalesce(v_perfil.papel, 'cliente')));
  v_claims := jsonb_set(v_claims, '{papeis}', to_jsonb(coalesce(v_perfil.papeis, array['cliente'])));
  return jsonb_build_object('claims', v_claims);
end $$;
revoke execute on function public.hook_token(jsonb) from public, anon, authenticated;
grant execute on function public.hook_token(jsonb) to supabase_auth_admin;

/**
 * Unifica duas contas da mesma pessoa (só serviço: scripts/unifica-contas.mjs e testes). A conta DESTINO ganha os papéis
 * da ORIGEM e, se pedido, a senha dela (o hash do Auth: a senha é derivada com pepper, sem depender do e-mail). A origem
 * fica bloqueada, com todo o histórico (acessos, auditoria, edições) intacto e ligado a ela; nada é apagado.
 * Idempotente: rodar de novo depois de concluída não muda nada.
 */
create or replace function public.conta_unificar(p_origem uuid, p_destino uuid, p_levar_senha boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.perfis; d public.perfis; v_papeis text[];
begin
  if p_origem = p_destino then perform privado.erro('DADOS_INVALIDOS', 'Origem e destino são a mesma conta.'); end if;
  select * into o from public.perfis where user_id = p_origem for update;
  select * into d from public.perfis where user_id = p_destino for update;
  if o.user_id is null or d.user_id is null then perform privado.erro('NAO_ENCONTRADO', 'Conta não encontrada.'); end if;
  if d.bloqueado then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'A conta de destino está bloqueada.'); end if;
  if o.bloqueado and o.bloqueado_motivo = 'unificada em outra conta' then
    return jsonb_build_object('jaUnificada', true, 'papeis', to_jsonb(d.papeis));
  end if;
  if o.bloqueado then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'A conta de origem está bloqueada.'); end if;
  if exists (select 1 from public.clientes where usuario_id = p_origem) or exists (select 1 from public.diaristas where usuario_id = p_origem) then
    perform privado.erro('CONDICAO_NAO_ATENDIDA', 'A conta de origem tem cadastro de cliente ou profissional; unificar só leva papéis da equipe.');
  end if;
  if privado.troca_senha_pendente(p_origem) and p_levar_senha then
    perform privado.erro('CONDICAO_NAO_ATENDIDA', 'A origem ainda está com a senha temporária; não dá pra levar.');
  end if;
  v_papeis := array(select distinct x from unnest(d.papeis || o.papeis) x);
  perform set_config('app.ator', 'servico:unificar_contas', true);
  update public.perfis set papeis = v_papeis, senha_propria = senha_propria or p_levar_senha or o.papel <> 'cliente' where user_id = p_destino;
  if p_levar_senha then
    update auth.users set encrypted_password = (select u.encrypted_password from auth.users u where u.id = p_origem), updated_at = now() where id = p_destino;
  end if;
  -- a origem deixa de ser da equipe (desbloquear por engano não cria uma segunda admin); o papel antigo fica na auditoria
  update public.perfis set papeis = array['cliente'], bloqueado = true, bloqueado_em = now(), bloqueado_motivo = 'unificada em outra conta' where user_id = p_origem;
  delete from auth.sessions where user_id = p_origem; -- sessões abertas da origem caem (o hook já nega renovar bloqueada)
  insert into public.auditoria (tabela, registro_id, operacao, ator_user_id, ator_papel, ator_contexto, antes, depois)
  values ('auth.users', p_destino, 'UPDATE', null, null, 'servico:unificar_contas',
          jsonb_build_object('papeis', to_jsonb(d.papeis)),
          jsonb_build_object('papeis', to_jsonb(v_papeis), 'origem', p_origem, 'levouSenha', p_levar_senha));
  return jsonb_build_object('jaUnificada', false, 'papeis', to_jsonb(v_papeis));
end $$;
revoke execute on function public.conta_unificar(uuid, uuid, boolean) from public, anon, authenticated;
