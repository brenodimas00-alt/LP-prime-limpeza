-- B1. RLS negando por padrão, grants mínimos, perfil automático e auditoria.
-- Leitura: cliente só o que é dele; diarista só atendimentos atribuídos e o próprio cadastro; Prime tudo.
-- Escrita: nenhuma policy de INSERT/UPDATE/DELETE. Só as RPCs (security definer, B3) e o service role escrevem.
-- Usuário bloqueado: os helpers devolvem nulo/falso, então ele não lê nada, mesmo com token ainda válido.

-- ---------- privilégios: fecha tudo e abre só o necessário ----------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema privado revoke execute on functions from public, anon, authenticated;

-- ---------- helpers (schema privado, não exposto na API) ----------
create or replace function privado.papel() returns text
language sql stable security definer set search_path = '' as $$
  select p.papel from public.perfis p where p.user_id = auth.uid() and not p.bloqueado
$$;

create or replace function privado.eh_prime() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(privado.papel() in ('prime_admin', 'prime_atendimento'), false)
$$;

create or replace function privado.eh_prime_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(privado.papel() = 'prime_admin', false)
$$;

create or replace function privado.meu_cliente_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select c.id from public.clientes c where c.usuario_id = auth.uid() and privado.papel() is not null
$$;

create or replace function privado.minha_diarista_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select d.id from public.diaristas d where d.usuario_id = auth.uid() and privado.papel() is not null
$$;

grant usage on schema privado to authenticated;
grant execute on function privado.papel(), privado.eh_prime(), privado.eh_prime_admin(), privado.meu_cliente_id(), privado.minha_diarista_id() to authenticated;

-- ---------- RLS em TODAS as tabelas ----------
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

-- leitura pública só da tabela oficial e do calendário
grant select on public.precos, public.regioes, public.feriados, public.configuracao to anon, authenticated;
create policy leitura_publica on public.precos for select to anon, authenticated using (true);
create policy leitura_publica on public.regioes for select to anon, authenticated using (true);
create policy leitura_publica on public.feriados for select to anon, authenticated using (true);
create policy leitura_publica on public.configuracao for select to anon, authenticated using (true);

grant select on public.perfis, public.clientes, public.pedidos, public.atendimentos, public.pagamentos, public.diaristas,
  public.documentos, public.avaliacoes, public.notificacoes, public.eventos, public.eventos_externos, public.auditoria,
  public.acessos to authenticated;

create policy dono_ou_prime on public.perfis for select to authenticated
  using ((user_id = (select auth.uid()) and not bloqueado) or (select privado.eh_prime()));

create policy dono_ou_prime on public.clientes for select to authenticated
  using (id = (select privado.meu_cliente_id()) or (select privado.eh_prime()));

create policy dono_ou_prime on public.pedidos for select to authenticated
  using (cliente_id = (select privado.meu_cliente_id()) or (select privado.eh_prime()));

create policy dono_diarista_ou_prime on public.atendimentos for select to authenticated
  using ((select privado.eh_prime())
         or diarista_id = (select privado.minha_diarista_id())
         or pedido_id in (select p.id from public.pedidos p where p.cliente_id = (select privado.meu_cliente_id())));

create policy dono_ou_prime on public.pagamentos for select to authenticated
  using ((select privado.eh_prime()) or pedido_id in (select p.id from public.pedidos p where p.cliente_id = (select privado.meu_cliente_id())));

create policy propria_ou_prime on public.diaristas for select to authenticated
  using (id = (select privado.minha_diarista_id()) or (select privado.eh_prime()));

create policy propria_ou_prime on public.documentos for select to authenticated
  using (diarista_id = (select privado.minha_diarista_id()) or (select privado.eh_prime()));

create policy dono_ou_prime on public.avaliacoes for select to authenticated
  using ((select privado.eh_prime()) or atendimento_id in (
    select a.id from public.atendimentos a join public.pedidos p on p.id = a.pedido_id where p.cliente_id = (select privado.meu_cliente_id())));

create policy so_prime on public.notificacoes for select to authenticated using ((select privado.eh_prime()));
create policy so_prime on public.eventos for select to authenticated using ((select privado.eh_prime()));
create policy so_prime on public.eventos_externos for select to authenticated using ((select privado.eh_prime()));
create policy so_admin on public.auditoria for select to authenticated using ((select privado.eh_prime_admin()));
create policy proprio_ou_prime on public.acessos for select to authenticated
  using ((select privado.eh_prime()) or (user_id = (select auth.uid()) and (select privado.papel()) is not null));
-- idempotencia: nenhuma policy (só RPC/service role).

-- ---------- perfil automático: todo usuário novo nasce cliente ----------
-- O papel NUNCA vem de metadados do cadastro (editáveis por quem se cadastra).
create or replace function privado.criar_perfil() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.perfis (user_id, papel) values (new.id, 'cliente') on conflict (user_id) do nothing;
  return new;
end $$;
create trigger criar_perfil after insert on auth.users for each row execute function privado.criar_perfil();

-- ---------- auditoria ----------
create or replace function privado.auditar() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if tg_op = 'UPDATE' and to_jsonb(new) = to_jsonb(old) then return new; end if;
  v_id := coalesce((to_jsonb(new) ->> 'id'), (to_jsonb(old) ->> 'id'), (to_jsonb(new) ->> 'user_id'), (to_jsonb(old) ->> 'user_id'))::uuid;
  insert into public.auditoria (tabela, registro_id, operacao, ator_user_id, ator_papel, ator_contexto, antes, depois)
  values (tg_table_name, v_id, tg_op, auth.uid(),
          (select p.papel from public.perfis p where p.user_id = auth.uid()),
          coalesce(nullif(current_setting('app.ator', true), ''), case when auth.uid() is null then 'servico' end),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

do $$ declare t text; begin
  foreach t in array array['clientes', 'pedidos', 'atendimentos', 'pagamentos', 'diaristas', 'perfis'] loop
    execute format('create trigger auditoria after insert or update or delete on public.%I for each row execute function privado.auditar()', t);
  end loop;
end $$;
