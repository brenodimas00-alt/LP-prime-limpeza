-- Correção achada pelo testa-rls: o CHECK de entrada/restante dava NULL (e passava) com só um dos dois preenchido,
-- porque 1 + NULL = NULL. Os dois nulos (pagamento integral) ou os dois preenchidos e somando o total (histórico do 50/50).
alter table public.pedidos drop constraint pedidos_entrada_restante_check;
alter table public.pedidos add constraint pedidos_entrada_restante_check check (
  (entrada_centavos is null and restante_centavos is null)
  or (entrada_centavos is not null and restante_centavos is not null and entrada_centavos + restante_centavos = total_centavos));
