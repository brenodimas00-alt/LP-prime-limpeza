-- A0 (fase 2): admin da cliente com troca de senha obrigatória no primeiro acesso.
-- A marca fica no app_metadata do Auth (o próprio usuário não edita) e é lida AO VIVO em auth.users, não do JWT:
-- enquanto ela existir, privado.papel() devolve NULL e toda RPC e toda policy tratam a conta como sem papel.
-- A function "conta" confere a mesma marca nas ações da Prime (exigirPrime) e a apaga depois da troca.
create or replace function privado.troca_senha_pendente(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select (u.raw_app_meta_data ->> 'troca_senha_obrigatoria')::boolean from auth.users u where u.id = p_user), false)
$$;

create or replace function privado.papel() returns text
language sql stable security definer set search_path = '' as $$
  select p.papel from public.perfis p
   where p.user_id = auth.uid() and not p.bloqueado and not privado.troca_senha_pendente(auth.uid())
$$;
