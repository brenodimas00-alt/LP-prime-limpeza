-- B1. Schema da Prime. Dinheiro em centavos (bigint). Datas de calendário em date (America/Sao_Paulo); instantes em timestamptz.
-- Escrita só por funções RPC (security definer); leitura por RLS (migration seguinte). Nada aqui é exposto sem policy.

create extension if not exists pgcrypto with schema extensions;

-- Schema privado: helpers de RLS e funções internas. NÃO está na lista de schemas da API.
create schema if not exists privado;
revoke all on schema privado from public, anon, authenticated;

create or replace function privado.tocar_atualizado_em() returns trigger language plpgsql set search_path = '' as $$
begin new.atualizado_em := now(); return new; end $$;

-- ---------- identidade ----------
create table public.perfis (
  user_id uuid primary key references auth.users (id) on delete cascade,
  papel text not null default 'cliente' check (papel in ('cliente', 'diarista', 'prime_admin', 'prime_atendimento')),
  bloqueado boolean not null default false,
  bloqueado_em timestamptz,
  bloqueado_motivo text check (char_length(bloqueado_motivo) <= 200),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table public.clientes (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid unique references auth.users (id) on delete set null,
  tipo text not null check (tipo in ('residencial', 'empresa')),
  nome text not null check (char_length(nome) between 2 and 120),
  telefone text check (telefone ~ '^[0-9]{10,11}$'),
  email text check (email = lower(email) and char_length(email) <= 254),
  tipo_documento text check (tipo_documento in ('cpf', 'cnpj')),
  documento text,
  razao_social text check (char_length(razao_social) <= 150),
  responsavel text check (char_length(responsavel) <= 120),
  endereco jsonb not null default '{}'::jsonb check (jsonb_typeof(endereco) = 'object'),
  data_nascimento date,
  origem text not null default 'site' check (origem in ('importado', 'site')),
  pendencias text[] not null default '{}',
  importacao jsonb, -- metadados da planilha (cadastrado_em original, linha revisada etc.), nunca a senha
  ficticio boolean not null default false,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check ((tipo_documento is null) = (documento is null)),
  check (tipo_documento is distinct from 'cpf' or documento ~ '^[0-9]{11}$'),
  check (tipo_documento is distinct from 'cnpj' or documento ~ '^[0-9A-Z]{12}[0-9]{2}$'),
  check (tipo <> 'empresa' or origem = 'importado' or razao_social is not null)
);
-- Documento único por cliente (linhas repetidas da planilha ficam fora do índice só se marcadas pra revisão: ver B7).
create unique index clientes_documento_unico on public.clientes (tipo_documento, documento) where documento is not null;
create index clientes_email on public.clientes (email);
create index clientes_pendencias on public.clientes using gin (pendencias);
create index clientes_criado on public.clientes (criado_em desc);

create table public.diaristas (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid unique references auth.users (id) on delete set null,
  nome text check (char_length(nome) <= 120),
  cpf text unique check (cpf ~ '^[0-9]{11}$'),
  telefone text check (telefone ~ '^[0-9]{10,11}$'),
  email text unique check (email = lower(email)),
  data_nascimento date,
  endereco jsonb not null default '{}'::jsonb,
  experiencia_anos int check (experiencia_anos between 0 and 60),
  disponibilidade jsonb not null default '{}'::jsonb,
  identidade text check (identidade in ('rg', 'cnh')),
  status text not null default 'rascunho' check (status in ('rascunho', 'pendente', 'aprovada', 'reprovada')),
  decisao jsonb,
  aceite_termos_em timestamptz,
  historico jsonb not null default '[]'::jsonb,
  ficticio boolean not null default false,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  -- enviado (não rascunho) exige os dados completos
  check (status = 'rascunho' or (nome is not null and cpf is not null and telefone is not null and email is not null
         and data_nascimento is not null and identidade is not null and aceite_termos_em is not null))
);
create index diaristas_status on public.diaristas (status);

-- ---------- pedidos ----------
create table public.pedidos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes (id),
  pacote jsonb not null check (jsonb_typeof(pacote) = 'object'),
  status text not null check (status in ('rascunho', 'aguardando_entrada', 'ativo', 'concluido', 'cancelado')),
  historico jsonb not null default '[]'::jsonb,
  cancelamento jsonb,
  total_centavos bigint not null check (total_centavos >= 0),
  entrada_centavos bigint not null check (entrada_centavos >= 0),
  restante_centavos bigint not null check (restante_centavos >= 0),
  ficticio boolean not null default false,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check (entrada_centavos + restante_centavos = total_centavos)
);
create index pedidos_cliente on public.pedidos (cliente_id, criado_em desc);
create index pedidos_status on public.pedidos (status, criado_em desc);

create table public.atendimentos (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos (id),
  sequencia int not null check (sequencia between 1 and 60),
  data date not null,
  turno text not null check (turno in ('manha', 'tarde', 'integral')),
  diarista_id uuid references public.diaristas (id),
  status text not null default 'agendado'
    check (status in ('agendado', 'confirmado', 'diarista_a_caminho', 'em_andamento', 'finalizado', 'avaliado', 'cancelado')),
  historico jsonb not null default '[]'::jsonb,
  valor_dia_centavos bigint not null check (valor_dia_centavos >= 0),
  taxa_dia_centavos bigint not null default 0 check (taxa_dia_centavos >= 0),
  deslocada boolean not null default false,
  data_original date,
  versao int not null default 0 check (versao >= 0),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (pedido_id, sequencia),
  unique (id, pedido_id) -- alvo da FK composta de pagamentos
);
create index atendimentos_data on public.atendimentos (data, turno);
create index atendimentos_diarista on public.atendimentos (diarista_id, data);
create index atendimentos_status on public.atendimentos (status, data);
create index atendimentos_pedido on public.atendimentos (pedido_id);

create table public.pagamentos (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos (id),
  atendimento_id uuid,
  parcela text not null check (parcela in ('entrada', 'dia')),
  valor_centavos bigint not null check (valor_centavos > 0),
  metodo text not null default 'pix' check (metodo in ('pix', 'cartao', 'manual')),
  pix_txid varchar(25) unique check (pix_txid ~ '^[A-Za-z0-9]{1,25}$'),
  brcode text,
  status text not null default 'pendente' check (status in ('pendente', 'informado_pelo_cliente', 'confirmado', 'cancelado')),
  vence_em date,
  vence_as time,
  informado_em timestamptz,
  confirmado_em timestamptz,
  confirmado_por uuid references auth.users (id) on delete set null,
  chave_idempotencia text,
  asaas_id text unique,          -- B4 (adiado): id da cobrança no Asaas
  asaas_invoice_url text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check ((parcela = 'dia') = (atendimento_id is not null)),
  -- a parcela do dia pertence a um atendimento DO MESMO pedido
  foreign key (atendimento_id, pedido_id) references public.atendimentos (id, pedido_id),
  check (status <> 'confirmado' or confirmado_em is not null)
);
create index pagamentos_pedido on public.pagamentos (pedido_id);
create index pagamentos_atendimento on public.pagamentos (atendimento_id);
create index pagamentos_status on public.pagamentos (status, vence_em);
-- no máximo uma entrada ativa por pedido e uma parcela ativa por atendimento
create unique index pagamentos_entrada_ativa on public.pagamentos (pedido_id) where parcela = 'entrada' and status <> 'cancelado';
create unique index pagamentos_dia_ativa on public.pagamentos (atendimento_id) where parcela = 'dia' and status <> 'cancelado';

create table public.documentos (
  id uuid primary key default gen_random_uuid(),
  diarista_id uuid not null references public.diaristas (id),
  tipo text not null check (tipo in ('rg_frente', 'rg_verso', 'cnh_frente', 'cnh_verso', 'cpf', 'comprovante_residencia', 'foto_perfil', 'antecedentes')),
  nome_arquivo text not null check (char_length(nome_arquivo) <= 120),
  mime text not null check (mime in ('image/jpeg', 'image/png', 'application/pdf')),
  tamanho int not null check (tamanho between 1 and 5242880),
  storage_path text not null unique,
  hash_sha256 text check (hash_sha256 ~ '^[0-9a-f]{64}$'),
  excluido_em timestamptz,
  criado_em timestamptz not null default now()
);
create unique index documentos_tipo_ativo on public.documentos (diarista_id, tipo) where excluido_em is null;

create table public.avaliacoes (
  id uuid primary key default gen_random_uuid(),
  atendimento_id uuid not null unique references public.atendimentos (id),
  notas jsonb not null check (
    (notas ->> 'pontualidade')::int between 1 and 5 and (notas ->> 'qualidade')::int between 1 and 5
    and (notas ->> 'cuidado')::int between 1 and 5 and (notas ->> 'comunicacao')::int between 1 and 5),
  nota_final numeric(2, 1) not null check (nota_final between 1 and 5),
  comentario text not null default '' check (char_length(comentario) <= 500),
  criado_em timestamptz not null default now()
);

-- ---------- automações ----------
create table public.eventos (
  id uuid primary key default gen_random_uuid(),
  seq bigserial unique,
  tipo text not null,
  refs jsonb not null default '{}'::jsonb,
  dados jsonb not null default '{}'::jsonb,
  status text not null default 'pendente' check (status in ('pendente', 'processado', 'erro')),
  tentativas int not null default 0,
  processado_em timestamptz,
  criado_em timestamptz not null default now()
);
create index eventos_fila on public.eventos (status, seq);

create table public.notificacoes (
  id uuid primary key default gen_random_uuid(),
  gatilho text not null,
  canal text not null default 'whatsapp' check (canal in ('whatsapp', 'email')),
  destinatario jsonb not null,
  template text not null,
  variaveis jsonb not null default '{}'::jsonb,
  agendada_para timestamptz,
  status text not null default 'pendente' check (status in ('pendente', 'simulada', 'enviada', 'erro', 'cancelada')),
  provedor text check (provedor in ('simulado', 'meta_cloud', 'email')),
  refs jsonb not null default '{}'::jsonb,
  chave_idempotencia text not null unique,
  previa text,
  wamid text,
  enviada_em timestamptz, entregue_em timestamptz, lida_em timestamptz,
  erro jsonb,
  tentativas int not null default 0,
  criado_em timestamptz not null default now()
);
create index notificacoes_fila on public.notificacoes (status, agendada_para);
create index notificacoes_wamid on public.notificacoes (wamid);

create table public.eventos_externos (
  id uuid primary key default gen_random_uuid(),
  provedor text not null check (provedor in ('asaas', 'meta_cloud')),
  id_externo text not null,
  tipo text,
  payload jsonb not null,
  recebido_em timestamptz not null default now(),
  processado_em timestamptz,
  unique (provedor, id_externo)
);

create table public.idempotencia (
  chave text primary key,  -- operacao|ator|chave
  operacao text not null,
  hash text not null,
  resultado jsonb not null,
  criado_em timestamptz not null default now()
);
create index idempotencia_criado on public.idempotencia (criado_em);

-- ---------- tabela oficial como dado ----------
create table public.precos (
  id bigserial primary key,
  vigente_desde timestamptz not null default now(),
  tabela jsonb not null check (jsonb_typeof(tabela) = 'object'),
  criado_por uuid references auth.users (id) on delete set null,
  criado_em timestamptz not null default now()
);
create index precos_vigencia on public.precos (vigente_desde desc);

create table public.regioes (
  cidade text not null,
  uf char(2) not null check (uf = upper(uf)),
  taxa_centavos bigint check (taxa_centavos >= 0),
  sob_consulta boolean not null default false,
  ativa boolean not null default true,
  primary key (uf, cidade),
  check (sob_consulta or taxa_centavos is not null)
);

create table public.feriados (
  data date primary key,
  descricao text not null default '',
  bloqueia boolean not null default false -- true = a Prime não atende (datasBloqueadas); false = cobra taxa
);

create table public.configuracao (
  chave text primary key check (chave in ('pix', 'contato')),
  valor jsonb not null,
  atualizado_em timestamptz not null default now()
);

-- ---------- rastreio ----------
create table public.auditoria (
  id bigserial primary key,
  tabela text not null,
  registro_id uuid,
  operacao text not null check (operacao in ('INSERT', 'UPDATE', 'DELETE')),
  ator_user_id uuid,
  ator_papel text,
  ator_contexto text, -- papel de negócio declarado pela RPC (cliente/prime/diarista/sistema) ou 'servico'
  antes jsonb,
  depois jsonb,
  em timestamptz not null default now()
);
create index auditoria_registro on public.auditoria (tabela, registro_id, em desc);
create index auditoria_ator on public.auditoria (ator_user_id, em desc);

create table public.acessos (
  id bigserial primary key,
  user_id uuid references auth.users (id) on delete set null,
  email text not null,
  resultado text not null check (resultado in ('pendente', 'sucesso', 'falha', 'bloqueado')),
  motivo text,
  ip inet,
  dispositivo text check (char_length(dispositivo) <= 300),
  em timestamptz not null default now(),
  finalizado_em timestamptz
);
create index acessos_email on public.acessos (email, em desc);
create index acessos_ip on public.acessos (ip, em desc);
create index acessos_usuario on public.acessos (user_id, em desc);

-- atualizado_em automático
do $$ declare t text; begin
  foreach t in array array['perfis', 'clientes', 'diaristas', 'pedidos', 'atendimentos', 'pagamentos'] loop
    execute format('create trigger %I before update on public.%I for each row execute function privado.tocar_atualizado_em()', t || '_atualizado', t);
  end loop;
end $$;
