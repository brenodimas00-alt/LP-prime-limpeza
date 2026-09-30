-- P7 (fase 2, bloco 3): proteção do site.
-- Turnstile (Cloudflare) no login, na solicitação sem login e no cadastro de profissional, conferido na function "conta"
-- (flag p7_turnstile). Limite por IP na solicitação sem login (na function, com privado.limite_acao) e por conta na
-- solicitação logada (trigger no pedido). Honeypot nos formulários públicos (na function).

insert into public.config_flags (chave, ligada, padrao, descricao) values
  ('p7_turnstile', true, true, 'Verificação anti-robô (Cloudflare Turnstile) no login, na solicitação e no cadastro de profissional')
on conflict (chave) do nothing;

/** Limite pela function "conta" (serviço): chave já com o IP ou a conta. */
create or replace function public.conta_limite(p_chave text, p_max int, p_janela_segundos int) returns boolean
language sql security definer set search_path = '' as $$
  select privado.limite_acao(left(p_chave, 200), greatest(p_max, 1), make_interval(secs => greatest(p_janela_segundos, 1)))
$$;
revoke execute on function public.conta_limite(text, int, int) from public, anon, authenticated;
grant execute on function public.conta_limite(text, int, int) to service_role;

/** Solicitação logada: no máximo 30 pedidos por conta em 24 h (a Prime cria pelo painel sem limite). */
create or replace function privado.limite_pedidos_cliente() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and coalesce(current_setting('app.ator', true), '') = 'cliente'
     and not privado.limite_acao('pedido:' || auth.uid(), 30, interval '1 day') then
    perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Muitas solicitações seguidas. Fale com a Prime pelo WhatsApp.');
  end if;
  return new;
end $$;
create trigger limite_pedidos_cliente before insert on public.pedidos for each row execute function privado.limite_pedidos_cliente();
