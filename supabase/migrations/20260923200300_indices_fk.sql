-- B1. Índices das FKs apontadas pelo lint do Supabase (advisors). idempotencia sem policy é intencional (só RPC/service).
create index pagamentos_atendimento_pedido on public.pagamentos (atendimento_id, pedido_id);
create index pagamentos_confirmado_por on public.pagamentos (confirmado_por);
create index precos_criado_por on public.precos (criado_por);
