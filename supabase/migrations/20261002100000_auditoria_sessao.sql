-- Auditoria de segurança (30/09): token de acesso de sessão encerrada continuava valendo até expirar (até 1 h).
-- Caso real: a cliente troca a senha porque alguém entrou na conta dela; a troca encerra as outras sessões (a renovação
-- morre), mas o access token que o invasor já tem seguia lendo e agindo pelas RPCs e pela RLS até o fim da hora.
-- Agora o papel só vale se a sessão do token ainda existe no Auth (encerrada por troca de senha, "sair", exclusão ou
-- bloqueio = sem papel na hora). Token sem session_id (chamadas internas que montam o ator com set_config) segue igual.

create or replace function privado.sessao_valida() returns boolean
language sql stable security definer set search_path = '' as $$
  select case when auth.jwt() ? 'session_id' then exists (
           select 1 from auth.sessions s
            where s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid
              and s.user_id = auth.uid()
              and (s.not_after is null or s.not_after > now()))
         else true end
$$;
revoke all on function privado.sessao_valida() from public, anon;
grant execute on function privado.sessao_valida() to authenticated; -- a policy de perfis roda com o papel de quem lê

-- Papel ATIVO: mesma regra da migration 20260930110000 + sessão viva.
create or replace function privado.papel() returns text
language sql stable security definer set search_path = '' as $$
  select case when privado.papel_pedido() is null then p.papel
              when privado.papel_pedido() = any (p.papeis) then privado.papel_pedido() end
    from public.perfis p
   where p.user_id = auth.uid() and not p.bloqueado and not privado.troca_senha_pendente(auth.uid())
     and privado.sessao_valida()
$$;

-- perfis era a única policy que olhava auth.uid() sem passar por privado.papel()
drop policy if exists dono_ou_prime on public.perfis;
create policy dono_ou_prime on public.perfis for select to authenticated
  using (((user_id = (select auth.uid())) and (not bloqueado) and (select privado.sessao_valida())) or (select privado.eh_prime()));
