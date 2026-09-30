-- P3: o recibo nunca some, nem se o pagamento for apagado (limpeza de dado fictício de teste, correção manual):
-- a numeração continua sem buraco. O texto do recibo é o que foi congelado na confirmação.
alter table public.recibos alter column pagamento_id drop not null;
alter table public.recibos drop constraint recibos_pagamento_id_fkey;
alter table public.recibos add constraint recibos_pagamento_id_fkey foreign key (pagamento_id) references public.pagamentos (id) on delete set null;
