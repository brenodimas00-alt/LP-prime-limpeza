-- Autoagendamento v3 (spec-agendamento-v3.txt + autoagendamento-v3-isa.txt, 56 itens da cliente, 06/10/2026). V1: modelo e
-- cálculo. Migration ADITIVA: nada apagado. Espelha src/domain/agendamento-v3.js (paridade em scripts/testa-paridade.mjs).
-- 1) Endereços do cliente (salvo, uso único, substituído/inativo), backfill do endereço do cadastro como principal.
-- 2) Cupons (+ uso, consumido só na contratação confirmada), condições comerciais e faturamento empresarial por cliente.
-- 3) Aceite único com evidências por solicitação (versões dos três documentos, hash, user agent, IP aproximado).
-- 4) Pedido: número da solicitação (sequência), modalidade, origem do cliente, cupom, condição aplicada, flag de pacote com
--    endereço novo. Atendimento: endereço (id + retrato), serviço, características, duração recomendada, justificativa,
--    taxas gravadas no cálculo. Pagamento: parcelas integral, metade_1, metade_2 e faturamento, com marco e envio.
-- 5) Configuração: tabela vigente ganha PRECOS.v3 e o expediente de sábado; Nova Lima R$ 20 (deixa de ser sob consulta);
--    faixas de CEP (Vila da Serra, vazia até a cliente informar); conteúdo do agendamento (tipos de imóvel, "Ver mais").

-- ---------------------------------------------------------------- endereços
create table public.enderecos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes (id),
  cep text not null check (cep ~ '^[0-9]{8}$'),
  logradouro text not null check (char_length(logradouro) between 1 and 120),
  numero text not null check (char_length(numero) between 1 and 10),
  complemento text not null default '' check (char_length(complemento) <= 60),
  bairro text not null check (char_length(bairro) between 1 and 80),
  cidade text not null check (char_length(cidade) between 1 and 80),
  uf char(2) not null check (uf = upper(uf)),
  ponto_referencia text not null default '' check (char_length(ponto_referencia) <= 120),
  tipo_imovel text check (tipo_imovel is null or char_length(tipo_imovel) between 1 and 40),
  tipo_imovel_outro text check (tipo_imovel_outro is null or char_length(tipo_imovel_outro) between 2 and 40),
  apelido text check (apelido is null or char_length(apelido) between 1 and 40),
  uso_unico boolean not null default false,
  ativo boolean not null default true,
  principal boolean not null default false,
  substituido_por uuid references public.enderecos (id),
  inativado_em timestamptz,
  inativado_motivo text check (inativado_motivo is null or inativado_motivo in ('substituido', 'remocao_solicitada', 'prime')),
  ficticio boolean not null default false,
  criado_em timestamptz not null default now(),
  check (not (uso_unico and ativo)),
  check (not (uso_unico and apelido is not null)),
  check (not (uso_unico and principal)),
  check (ativo = (inativado_em is null) or uso_unico)
);
create index enderecos_cliente on public.enderecos (cliente_id, ativo);
create unique index enderecos_um_principal on public.enderecos (cliente_id) where principal and ativo;
alter table public.enderecos enable row level security;
alter table public.enderecos force row level security;
revoke all on public.enderecos from anon, authenticated;

-- backfill: o endereço do cadastro vira o principal (sem tipo do imóvel, que o sistema antigo não tinha)
insert into public.enderecos (cliente_id, cep, logradouro, numero, complemento, bairro, cidade, uf, principal, ficticio, criado_em)
select c.id, c.endereco ->> 'cep', left(c.endereco ->> 'logradouro', 120), left(c.endereco ->> 'numero', 10), left(coalesce(c.endereco ->> 'complemento', ''), 60),
       left(c.endereco ->> 'bairro', 80), left(c.endereco ->> 'cidade', 80), upper(c.endereco ->> 'uf'), true, c.ficticio, c.criado_em
  from public.clientes c
 where c.anonimizado_em is null and coalesce(c.endereco ->> 'cep', '') ~ '^[0-9]{8}$'
   and coalesce(c.endereco ->> 'logradouro', '') <> '' and coalesce(c.endereco ->> 'numero', '') <> '' and coalesce(c.endereco ->> 'bairro', '') <> ''
   and coalesce(c.endereco ->> 'cidade', '') <> '' and coalesce(c.endereco ->> 'uf', '') ~ '^[A-Za-z]{2}$'
   and char_length(c.endereco ->> 'numero') <= 10;

-- ---------------------------------------------------------------- cupons
create table public.cupons (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique check (codigo ~ '^[A-Z0-9_-]{3,30}$'),
  tipo text not null check (tipo in ('valor', 'percentual')),
  valor bigint not null check (valor > 0),
  modalidades text[] not null default '{}' check (modalidades <@ array['avulsa', 'multi_profissional', 'pacote']),
  primeira_contratacao boolean not null default false,
  valido_ate date,
  limite_de_uso int check (limite_de_uso is null or limite_de_uso > 0),
  acumula boolean not null default false,
  ativo boolean not null default true,
  criado_por uuid,
  criado_em timestamptz not null default now(),
  check (tipo <> 'percentual' or valor between 1 and 100)
);
create table public.cupons_uso (
  id uuid primary key default gen_random_uuid(),
  cupom_id uuid not null references public.cupons (id),
  pedido_id uuid not null unique references public.pedidos (id),
  cliente_id uuid not null references public.clientes (id),
  desconto_centavos bigint not null check (desconto_centavos >= 0),
  em timestamptz not null default now()
);
create index cupons_uso_cupom on public.cupons_uso (cupom_id);
alter table public.cupons enable row level security;
alter table public.cupons force row level security;
alter table public.cupons_uso enable row level security;
alter table public.cupons_uso force row level security;
revoke all on public.cupons, public.cupons_uso from anon, authenticated;

-- ---------------------------------------------------------------- condições comerciais e faturamento (só pelo painel)
create table public.condicoes_comerciais (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes (id),
  tipo text not null check (tipo in ('valor', 'percentual')),
  valor bigint not null check (valor > 0),
  modalidades text[] not null default '{}' check (modalidades <@ array['avulsa', 'multi_profissional', 'pacote']),
  quantidade_minima int check (quantidade_minima is null or quantidade_minima between 1 and 100),
  validade text not null check (validade in ('uso_unico', 'recorrente', 'periodo')),
  valido_ate date,
  acumula boolean not null default false,
  observacao_interna text not null default '' check (char_length(observacao_interna) <= 500),
  ativa boolean not null default true,
  consumida_em timestamptz,
  consumida_pedido uuid references public.pedidos (id),
  criado_por uuid,
  criado_em timestamptz not null default now(),
  check (tipo <> 'percentual' or valor between 1 and 100),
  check (validade <> 'periodo' or valido_ate is not null)
);
-- uma condição ativa por cliente (a "seção" da ficha); as antigas ficam como histórico
create unique index condicoes_comerciais_uma_ativa on public.condicoes_comerciais (cliente_id) where ativa;
create table public.faturamento_empresarial (
  cliente_id uuid primary key references public.clientes (id),
  autorizado boolean not null default false,
  forma text not null default 'pix' check (forma in ('pix', 'transferencia')),
  prazo_dias int not null default 0 check (prazo_dias between 0 and 120),
  nf boolean not null default true,
  observacao text not null default '' check (char_length(observacao) <= 500),
  atualizado_por uuid,
  atualizado_em timestamptz not null default now()
);
alter table public.condicoes_comerciais enable row level security;
alter table public.condicoes_comerciais force row level security;
alter table public.faturamento_empresarial enable row level security;
alter table public.faturamento_empresarial force row level security;
revoke all on public.condicoes_comerciais, public.faturamento_empresarial from anon, authenticated;

-- ---------------------------------------------------------------- aceite único com evidências (itens 52 e 53)
alter table public.condicoes_atendimento add column texto_sha256 text check (texto_sha256 is null or texto_sha256 ~ '^[0-9a-f]{64}$');
alter table public.documentos_legais add column texto_sha256 text check (texto_sha256 is null or texto_sha256 ~ '^[0-9a-f]{64}$');
create table public.aceites_solicitacao (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null unique references public.pedidos (id),
  cliente_id uuid not null references public.clientes (id),
  nome text not null,
  documento text not null,
  whatsapp text not null,
  aceito_em timestamptz not null default now(),
  versao_condicoes text not null references public.condicoes_atendimento (versao),
  versao_termos_uso text not null references public.documentos_legais (versao),
  versao_privacidade text not null references public.documentos_legais (versao),
  hash_aceite text not null check (hash_aceite ~ '^[0-9a-f]{64}$'),
  user_agent text check (user_agent is null or char_length(user_agent) <= 400),
  ip_aproximado text check (ip_aproximado is null or char_length(ip_aproximado) <= 64)
);
alter table public.aceites_solicitacao enable row level security;
alter table public.aceites_solicitacao force row level security;
revoke all on public.aceites_solicitacao from anon, authenticated;

-- ---------------------------------------------------------------- pedidos, atendimentos, pagamentos, clientes
create sequence public.numero_solicitacao_seq;
alter table public.pedidos
  add column numero_solicitacao bigint unique,
  add column modalidade text check (modalidade is null or modalidade in ('avulsa', 'multi_profissional', 'pacote')),
  add column origem_cliente jsonb check (origem_cliente is null or (jsonb_typeof(origem_cliente) = 'object'
    and origem_cliente ->> 'origem' in ('indicacao', 'instagram', 'google', 'whatsapp', 'outro'))),
  add column cupom_id uuid references public.cupons (id),
  add column condicao_comercial_id uuid references public.condicoes_comerciais (id),
  add column pacote_endereco_novo boolean not null default false,
  add column faturamento boolean not null default false;
-- número para os pedidos que já existem, na ordem de criação; os novos pegam o próximo
with o as (select id, row_number() over (order by criado_em, id) n from public.pedidos)
update public.pedidos p set numero_solicitacao = o.n from o where o.id = p.id;
select setval('public.numero_solicitacao_seq', greatest((select max(numero_solicitacao) from public.pedidos), 0) + 1, false);
alter table public.pedidos alter column numero_solicitacao set default nextval('public.numero_solicitacao_seq');
alter table public.pedidos alter column numero_solicitacao set not null;

alter table public.atendimentos
  add column endereco_id uuid references public.enderecos (id),
  add column endereco jsonb check (endereco is null or jsonb_typeof(endereco) = 'object'),
  add column servico text,
  add column caracteristicas jsonb check (caracteristicas is null or jsonb_typeof(caracteristicas) = 'object'),
  add column local_refeicao boolean,
  add column duracao_recomendada_horas int check (duracao_recomendada_horas is null or duracao_recomendada_horas between 2 and 8),
  add column justificativa text check (justificativa is null or char_length(justificativa) <= 500),
  add column taxas jsonb check (taxas is null or jsonb_typeof(taxas) = 'object'),
  add column itens jsonb check (itens is null or jsonb_typeof(itens) = 'array');

alter table public.pagamentos drop constraint pagamentos_parcela_check;
alter table public.pagamentos add constraint pagamentos_parcela_check
  check (parcela in ('entrada', 'dia', 'diaria', 'pacote', 'hora_extra', 'integral', 'metade_1', 'metade_2', 'faturamento'));
alter table public.pagamentos
  add column marco text check (marco is null or marco in ('confirmacao', 'segunda_metade')),
  add column marco_data date,
  add column envio_em date,
  add column enviado_em timestamptz,
  add column forma_faturamento text check (forma_faturamento is null or forma_faturamento in ('pix', 'transferencia')),
  add column nf_emitir boolean;
-- uma parcela de cada tipo por pedido (a 2ª é gerada pela rotina: a chave estável é pedido + parcela, nunca a data)
create unique index pagamentos_parcela_v3_unica on public.pagamentos (pedido_id, parcela)
  where parcela in ('integral', 'metade_1', 'metade_2', 'faturamento') and status <> 'cancelado';

alter table public.clientes
  add column base_legal text check (base_legal is null or base_legal in ('execucao_contrato', 'consentimento')),
  add column status_prospeccao text not null default 'novo' check (status_prospeccao in ('novo', 'contatado', 'sem_interesse', 'convertido'));

-- ---------------------------------------------------------------- configuração
create table public.faixas_cep (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(nome) between 2 and 60),
  cep_inicio text not null check (cep_inicio ~ '^[0-9]{8}$'),
  cep_fim text not null check (cep_fim ~ '^[0-9]{8}$'),
  taxa_centavos bigint not null check (taxa_centavos >= 0),
  ativa boolean not null default true,
  check (cep_inicio <= cep_fim)
);
alter table public.faixas_cep enable row level security;
alter table public.faixas_cep force row level security;
revoke all on public.faixas_cep from anon, authenticated;

update public.regioes set taxa_centavos = 2000, sob_consulta = false where cidade = 'Nova Lima' and uf = 'MG';

alter table public.configuracao drop constraint configuracao_chave_check;
alter table public.configuracao add constraint configuracao_chave_check check (chave in ('pix', 'contato', 'auth', 'documentos', 'regioes_diarista', 'repasse', 'agendamento'));

insert into public.precos (vigente_desde, tabela)
select now(), jsonb_set(jsonb_set(p.tabela, '{PRECOS,v3}', '{
    "faixas": {
      "residencial": [{"horas": 2, "metragem": 30, "ambientes": 3}, {"horas": 4, "metragem": 50, "ambientes": 5}, {"horas": 6, "metragem": 70, "ambientes": 7}, {"horas": 8, "metragem": 110, "ambientes": 10}],
      "empresa": [{"horas": 2, "metragem": 40, "ambientes": 4}, {"horas": 4, "metragem": 60, "ambientes": 6}, {"horas": 6, "metragem": 90, "ambientes": 9}, {"horas": 8, "metragem": 130, "ambientes": 11}]
    },
    "pesosAmbientes": {"quartos": 1, "banheiros": 1.5, "salas": 1, "cozinhas": 1.5, "areaExterna": 1},
    "subidaMaximaPorAmbientes": 1,
    "avisoMetragemAcima": 120,
    "ambientes": {"tipos": ["quartos", "banheiros", "salas", "cozinhas", "areaExterna"], "maximoPorTipo": 20, "maximoTotalEventos": 50},
    "condicao": {"leve": 0, "moderada": 1, "moderado": 1, "intensa": 2, "intenso": 2},
    "passadoria": {
      "faixas": [{"ate": 15, "horas": 2}, {"ate": 25, "horas": 4}, {"ate": 40, "horas": 6}, {"ate": 60, "horas": 8}],
      "tipos": ["basicas", "roupas_cama", "sociais", "delicadas", "mistas"],
      "tiposQueSobem": ["sociais", "delicadas"],
      "maximoPecas": 300
    },
    "servicosComMetragem": ["residencial", "empresarial", "condominial", "pre_pos_mudanca", "pre_pos_evento"],
    "minutos": [0, 15, 30, 45],
    "descontoQuantidade": [{"minimo": 5, "centavos": 4000}, {"minimo": 3, "centavos": 2000}],
    "modalidadesComDescontoQuantidade": ["multi_profissional", "pacote"],
    "taxas": {"sabadoCentavos": 2000, "feriadoCentavos": 2000, "acumulaSabadoFeriado": false, "semRefeicaoCentavos": 2500},
    "limites": {"maximoDiarias": 30, "maximoProfissionais": 10},
    "pagamento": {"percentualPrimeiraParcela": 50, "horaPrazo": "14:00", "parcela2DiasAntesEnvio": 2, "horaRotina": "08:00", "cartaoCredito": false}
  }'::jsonb), '{horariosTrabalho,fimExpedienteSabado}', 'null'::jsonb)
  from public.precos p where p.vigente_desde <= now() order by p.vigente_desde desc, p.id desc limit 1;

-- ---------------------------------------------------------------- domínio v3 (agendamento-v3.js)
/** Configuração do v3: a vigente + regiões e faixas de CEP no formato do JS (regioesAtendidas, faixasCep). */
create or replace function privado.cfg_v3() returns jsonb
language sql stable security definer set search_path = '' as $$
  select privado.cfg()
    || jsonb_build_object('regioesAtendidas', coalesce((select jsonb_agg(jsonb_build_object('cidade', r.cidade, 'uf', r.uf, 'taxaCentavos', r.taxa_centavos,
          'sobConsulta', r.sob_consulta, 'ativa', r.ativa) order by r.uf, r.cidade) from public.regioes r), '[]'::jsonb))
    || jsonb_build_object('faixasCep', coalesce((select jsonb_agg(jsonb_build_object('nome', f.nome, 'cepInicio', f.cep_inicio, 'cepFim', f.cep_fim,
          'taxaCentavos', f.taxa_centavos, 'ativa', f.ativa) order by f.cep_inicio, f.id) from public.faixas_cep f), '[]'::jsonb))
$$;

/** Inteiro em JSON, nunca NULL (privado.eh_inteiro(NULL) dá NULL e `not` NULL não barra: armadilha já vista). */
create or replace function privado.v3_int(v jsonb) returns boolean
language sql immutable set search_path = '' as $$ select coalesce(privado.eh_inteiro(v), false) $$;

create or replace function privado.v3_obj(v jsonb) returns boolean
language sql immutable set search_path = '' as $$ select coalesce(jsonb_typeof(v) = 'object', false) $$;

/** ambientesPonderados / totalAmbientes */
create or replace function privado.v3_amb(a jsonb, cfg jsonb, ponderado boolean) returns numeric
language sql stable set search_path = '' as $$
  select coalesce(sum((a ->> k)::int * case when ponderado then coalesce((cfg #>> array['PRECOS', 'v3', 'pesosAmbientes', k])::numeric, 1) else 1 end), 0)
    from jsonb_array_elements_text(cfg #> '{PRECOS,v3,ambientes,tipos}') k
   where privado.v3_obj(a) and privado.v3_int(a -> k) and (a ->> k)::int > 0
$$;

/** recomendarDuracao: {horas, excedente, orientacao, avisoMetragem} */
create or replace function privado.v3_recomendar(p_servico text, car jsonb, p_segmento text, cfg jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare V jsonb := cfg #> '{PRECOS,v3}'; tab jsonb; n int; i int; i_a int; amb numeric; m int; aviso boolean;
        vazio jsonb := '{"horas": null, "excedente": false, "orientacao": null, "avisoMetragem": false}';
begin
  if not privado.v3_obj(car) then return vazio; end if;
  if p_servico = 'passadoria' then
    if not privado.v3_int(car -> 'pecas') or (car ->> 'pecas')::int < 1 then return vazio; end if;
    tab := V #> '{passadoria,faixas}'; n := jsonb_array_length(tab);
    select coalesce(min(o - 1), n) into i from jsonb_array_elements(tab) with ordinality x(f, o) where (car ->> 'pecas')::int <= (f ->> 'ate')::int;
    if (V #> '{passadoria,tiposQueSobem}') ? coalesce(car ->> 'tipoPecas', '') then i := i + 1; end if;
    if i >= n then return '{"horas": null, "excedente": true, "orientacao": "dividir_diarias", "avisoMetragem": false}'; end if;
    return jsonb_build_object('horas', (tab -> i ->> 'horas')::int, 'excedente', false, 'orientacao', null, 'avisoMetragem', false);
  end if;
  if not privado.v3_int(car -> 'metragem') or (car ->> 'metragem')::int < 1 then return vazio; end if;
  m := (car ->> 'metragem')::int;
  tab := V -> 'faixas' -> (case when p_segmento = 'empresa' then 'empresa' else 'residencial' end); n := jsonb_array_length(tab);
  amb := case when p_servico = 'pre_pos_evento' then (case when privado.v3_int(car -> 'ambientesTotal') then (car ->> 'ambientesTotal')::int else 0 end)
              else privado.v3_amb(car -> 'ambientes', cfg, true) end;
  select coalesce(min(o - 1), n - 1) into i from jsonb_array_elements(tab) with ordinality x(f, o) where m <= (f ->> 'metragem')::int;
  if amb > 0 then
    select coalesce(min(o - 1), n) into i_a from jsonb_array_elements(tab) with ordinality x(f, o) where amb <= (f ->> 'ambientes')::numeric;
    i := greatest(i, least(i_a, i + (V ->> 'subidaMaximaPorAmbientes')::int));
  end if;
  if p_servico = 'pre_pos_mudanca' or (p_servico = 'pre_pos_evento' and car ->> 'momento' = 'depois') then
    i := i + coalesce((V -> 'condicao' ->> coalesce(car ->> 'condicao', ''))::int, 0);
  end if;
  aviso := m > (V ->> 'avisoMetragemAcima')::int;
  if i >= n then return jsonb_build_object('horas', null, 'excedente', true, 'orientacao', 'mais_profissionais', 'avisoMetragem', aviso); end if;
  return jsonb_build_object('horas', (tab -> i ->> 'horas')::int, 'excedente', false, 'orientacao', null, 'avisoMetragem', aviso);
end $$;

/** validarCaracteristicas: mesmas mensagens e ordem do JS. */
create or replace function privado.v3_validar_car(p_servico text, car jsonb, cfg jsonb) returns text[]
language plpgsql stable set search_path = '' as $$
declare V jsonb := cfg #> '{PRECOS,v3}'; P jsonb := cfg -> 'PRECOS'; e text[] := '{}'; amb jsonb; amb_ok boolean; an jsonb; soma int; mx int;
begin
  if not privado.v3_obj(car) then return array['Conte um pouco sobre o local']; end if;
  if p_servico = 'passadoria' then
    mx := (V #>> '{passadoria,maximoPecas}')::int;
    if not privado.v3_int(car -> 'pecas') or (car ->> 'pecas')::int < 1 or (car ->> 'pecas')::int > mx then e := e || ('Quantidade de peças: de 1 a ' || mx); end if;
    if not coalesce((V #> '{passadoria,tipos}') ? (car ->> 'tipoPecas'), false) or jsonb_typeof(car -> 'tipoPecas') is distinct from 'string' then
      e := e || 'Escolha os tipos de peças que predominam'::text;
    end if;
  else
    if not privado.v3_int(car -> 'metragem') or (car ->> 'metragem')::int < (P #>> '{metragem,minimo}')::int or (car ->> 'metragem')::int > (P #>> '{metragem,maximo}')::int then
      e := e || ('Metragem deve ser um inteiro entre ' || (P #>> '{metragem,minimo}') || ' e ' || (P #>> '{metragem,maximo}') || ' m²');
    end if;
    if p_servico = 'pre_pos_evento' then
      mx := (V #>> '{ambientes,maximoTotalEventos}')::int;
      if coalesce(car ->> 'momento', '') not in ('antes', 'depois') or jsonb_typeof(car -> 'momento') is distinct from 'string' then e := e || 'Informe se o atendimento será antes ou após o evento'::text; end if;
      if not privado.v3_int(car -> 'ambientesTotal') or (car ->> 'ambientesTotal')::int < 1 or (car ->> 'ambientesTotal')::int > mx then e := e || ('Quantidade de ambientes: de 1 a ' || mx); end if;
      if car ->> 'momento' = 'depois' and jsonb_typeof(car -> 'momento') = 'string'
         and (coalesce(car ->> 'condicao', '') not in ('leve', 'moderado', 'intenso') or jsonb_typeof(car -> 'condicao') is distinct from 'string') then
        e := e || 'Informe como estará o espaço após o evento'::text;
      end if;
    else
      amb := car -> 'ambientes';
      amb_ok := privado.v3_obj(amb)
        and not exists (select 1 from jsonb_object_keys(amb) k where not (V #> '{ambientes,tipos}') ? k)
        and not exists (select 1 from jsonb_each(amb) x where not privado.v3_int(x.value) or (x.value #>> '{}')::int < 0 or (x.value #>> '{}')::int > (V #>> '{ambientes,maximoPorTipo}')::int);
      if not amb_ok then e := e || 'Quantidade de ambientes inválida'::text;
      elsif privado.v3_amb(amb, cfg, false) < 1 then e := e || 'Informe pelo menos um ambiente'::text; end if;
      if p_servico = 'pre_pos_mudanca' then
        if coalesce(car ->> 'mobiliado', '') not in ('vazio', 'parcial', 'mobiliado') or jsonb_typeof(car -> 'mobiliado') is distinct from 'string' then e := e || 'Informe se o imóvel está vazio ou mobiliado'::text; end if;
        if coalesce(car ->> 'condicao', '') not in ('leve', 'moderada', 'intensa') or jsonb_typeof(car -> 'condicao') is distinct from 'string' then e := e || 'Informe a condição atual do imóvel'::text; end if;
      end if;
    end if;
  end if;
  an := car -> 'animais';
  if not privado.v3_obj(an) or jsonb_typeof(an -> 'tem') is distinct from 'boolean' then e := e || 'Responda se há animais no local'::text;
  elsif (an -> 'tem') = 'true' then
    if exists (select 1 from unnest(array['caes', 'gatos', 'outros']) k where not privado.v3_int(an -> k) or (an ->> k)::int < 0 or (an ->> k)::int > 20) then
      e := e || 'Quantidade de animais inválida'::text;
    else
      soma := (an ->> 'caes')::int + (an ->> 'gatos')::int + (an ->> 'outros')::int;
      if soma < 1 then e := e || 'Informe quantos animais há no local'::text;
      elsif (an ->> 'outros')::int > 0 and not coalesce(jsonb_typeof(an -> 'outrosQual') = 'string' and char_length(trim(an ->> 'outrosQual')) >= 2 and char_length(an ->> 'outrosQual') <= 60, false) then
        e := e || 'Informe qual animal'::text;
      end if;
    end if;
  end if;
  return e;
end $$;

/** horariosPermitidos: 'HH:MM' de primeiroInicio até fim do expediente (sábado pode ter o próprio) − duração, minutos configurados. */
create or replace function privado.v3_horarios(p_horas int, d date, cfg jsonb) returns text[]
language sql stable set search_path = '' as $$
  select coalesce(array_agg(privado.hm(t) order by t), '{}')
    from generate_series(privado.min_hm(cfg #>> '{horariosTrabalho,primeiroInicio}'),
           privado.min_hm(case when d is not null and privado.dia_semana(d) = 6 and coalesce(cfg #>> '{horariosTrabalho,fimExpedienteSabado}', '') <> ''
                               then cfg #>> '{horariosTrabalho,fimExpedienteSabado}' else cfg #>> '{horariosTrabalho,fimExpediente}' end) - p_horas * 60) t
   where (cfg #> '{PRECOS,v3,minutos}') @> to_jsonb(t % 60)
$$;

/** regiaoV3: faixa de CEP (vence a cidade) ou cidade atendida. null = não atendida. */
create or replace function privado.v3_regiao(e jsonb, cfg jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare cep text; f jsonb; r jsonb;
begin
  if not privado.v3_obj(e) then return null; end if;
  cep := privado.so_digitos(e ->> 'cep');
  if char_length(cep) = 8 then
    select x into f from jsonb_array_elements(coalesce(cfg -> 'faixasCep', '[]')) with ordinality t(x, o)
     where coalesce((x ->> 'ativa')::boolean, true) and cep >= x ->> 'cepInicio' and cep <= x ->> 'cepFim' order by o limit 1;
    if f is not null then return jsonb_build_object('nome', f ->> 'nome', 'taxaCentavos', (f ->> 'taxaCentavos')::bigint); end if;
  end if;
  select x into r from jsonb_array_elements(coalesce(cfg -> 'regioesAtendidas', '[]')) with ordinality t(x, o)
   where coalesce((x ->> 'ativa')::boolean, true) and privado.sem_acento(x ->> 'cidade') = privado.sem_acento(e ->> 'cidade')
     and privado.sem_acento(x ->> 'uf') = privado.sem_acento(e ->> 'uf') order by o limit 1;
  if r is null then return null; end if;
  if coalesce((r ->> 'sobConsulta')::boolean, false) then return jsonb_build_object('nome', r ->> 'cidade', 'sobConsulta', true); end if;
  return jsonb_build_object('nome', r ->> 'cidade', 'taxaCentavos', coalesce((r ->> 'taxaCentavos')::bigint, 0));
end $$;

create or replace function privado.v3_desconto_qtd(p_modalidade text, n int, cfg jsonb) returns bigint
language sql stable set search_path = '' as $$
  select case when not coalesce((cfg #> '{PRECOS,v3,modalidadesComDescontoQuantidade}') ? p_modalidade, false) then 0
    else coalesce((select (f ->> 'centavos')::bigint from jsonb_array_elements(cfg #> '{PRECOS,v3,descontoQuantidade}') f
                    where n >= (f ->> 'minimo')::int order by (f ->> 'minimo')::int desc limit 1), 0) end
$$;

/** avaliarCupom: {ok} ou {ok:false, motivo} */
create or replace function privado.v3_avaliar_cupom(c jsonb, p_modalidade text, hoje date, primeira boolean) returns jsonb
language plpgsql stable set search_path = '' as $$
begin
  if not privado.v3_obj(c) or not coalesce((c ->> 'ativo')::boolean, false) then return '{"ok": false, "motivo": "inexistente"}'; end if;
  if coalesce((c ->> 'esgotado')::boolean, false) then return '{"ok": false, "motivo": "esgotado"}'; end if;
  if privado.tem_valor(c -> 'validoAte') and to_char(hoje, 'YYYY-MM-DD') > c ->> 'validoAte' then return '{"ok": false, "motivo": "vencido"}'; end if;
  if jsonb_typeof(c -> 'modalidades') = 'array' and jsonb_array_length(c -> 'modalidades') > 0 and not (c -> 'modalidades') ? p_modalidade then
    return '{"ok": false, "motivo": "modalidade"}';
  end if;
  if coalesce((c ->> 'primeiraContratacao')::boolean, false) and not coalesce(primeira, false) then return '{"ok": false, "motivo": "primeira_contratacao"}'; end if;
  return '{"ok": true}';
end $$;

create or replace function privado.v3_avaliar_condicao(c jsonb, p_modalidade text, n int, hoje date) returns boolean
language plpgsql stable set search_path = '' as $$
begin
  if not privado.v3_obj(c) or (c -> 'ativa') = 'false' then return false; end if;
  if jsonb_typeof(c -> 'modalidades') = 'array' and jsonb_array_length(c -> 'modalidades') > 0 and not (c -> 'modalidades') ? p_modalidade then return false; end if;
  if privado.v3_int(c -> 'quantidadeMinima') and n < (c ->> 'quantidadeMinima')::int then return false; end if;
  if c ->> 'validade' = 'uso_unico' and coalesce((c ->> 'consumida')::boolean, false) then return false; end if;
  if c ->> 'validade' = 'periodo' and (not privado.tem_valor(c -> 'validoAte') or to_char(hoje, 'YYYY-MM-DD') > c ->> 'validoAte') then return false; end if;
  return true;
end $$;

/** marcoSegundaMetade: datas distintas ordenadas, a de índice floor(n/2). */
create or replace function privado.v3_marco(datas text[]) returns text
language sql immutable set search_path = '' as $$
  select case when count(*) < 2 then null else (array_agg(d order by d))[floor(count(*) / 2.0)::int + 1] end
    from (select distinct unnest(datas) d) z
$$;

/** calcularParcelas */
create or replace function privado.v3_parcelas(p_modalidade text, datas text[], total bigint, fat jsonb, cfg jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare pg jsonb := cfg #> '{PRECOS,v3,pagamento}'; ds text[]; p1 bigint; mc text; v1 date; v2 date;
begin
  select array_agg(d order by d) into ds from (select distinct unnest(datas) d) z;
  if ds is null then return '[]'; end if;
  if privado.v3_obj(fat) then
    return jsonb_build_array(jsonb_build_object('parcela', 'faturamento', 'marco', 'confirmacao', 'valorCentavos', total,
      'venceEm', to_char(ds[cardinality(ds)]::date + coalesce((fat ->> 'prazoDias')::int, 0), 'YYYY-MM-DD'), 'venceAs', null));
  end if;
  v1 := privado.dia_util_anterior(ds[1]::date, cfg);
  if p_modalidade <> 'pacote' then
    return jsonb_build_array(jsonb_build_object('parcela', 'integral', 'marco', 'confirmacao', 'valorCentavos', total, 'venceEm', to_char(v1, 'YYYY-MM-DD'), 'venceAs', pg ->> 'horaPrazo'));
  end if;
  p1 := round(total * (pg ->> 'percentualPrimeiraParcela')::numeric / 100);
  mc := privado.v3_marco(ds);
  v2 := privado.dia_util_anterior(mc::date, cfg);
  return jsonb_build_array(
    jsonb_build_object('parcela', 'metade_1', 'marco', 'confirmacao', 'valorCentavos', p1, 'venceEm', to_char(v1, 'YYYY-MM-DD'), 'venceAs', pg ->> 'horaPrazo'),
    jsonb_build_object('parcela', 'metade_2', 'marco', 'segunda_metade', 'marcoData', mc, 'valorCentavos', total - p1, 'venceEm', to_char(v2, 'YYYY-MM-DD'),
      'venceAs', pg ->> 'horaPrazo', 'envioEm', to_char(v2 - (pg ->> 'parcela2DiasAntesEnvio')::int, 'YYYY-MM-DD')));
end $$;

/** validarPedidoV3: mesmas mensagens e ordem do JS. */
create or replace function privado.v3_validar_pedido(p jsonb, cfg jsonb) returns text[]
language plpgsql stable set search_path = '' as $$
declare P0 jsonb := cfg -> 'PRECOS'; V jsonb := cfg #> '{PRECOS,v3}'; e text[] := '{}'; at jsonb; a jsonb; i int; n text; servs jsonb; x text; lim2 int;
        modal text := p ->> 'modalidade';
begin
  if not privado.v3_obj(p) then return array['Solicitação não informada']; end if;
  if coalesce(p ->> 'segmento', '') not in ('residencial', 'empresa') or jsonb_typeof(p -> 'segmento') is distinct from 'string' then e := e || 'Escolha onde será realizado o atendimento'::text; end if;
  if coalesce(modal, '') not in ('avulsa', 'multi_profissional', 'pacote') or jsonb_typeof(p -> 'modalidade') is distinct from 'string' then e := e || 'Escolha a modalidade'::text; end if;
  if modal = 'pacote' and (coalesce(p ->> 'frequencia', '') not in ('semanal', 'quinzenal', 'mensal', 'datas') or jsonb_typeof(p -> 'frequencia') is distinct from 'string') then e := e || 'Escolha a frequência'::text; end if;
  at := p -> 'atendimentos';
  if jsonb_typeof(at) is distinct from 'array' or jsonb_array_length(at) < 1 then return e || 'Escolha a data do atendimento'::text; end if;
  if modal = 'avulsa' and jsonb_array_length(at) <> 1 then e := e || 'Diária avulsa é uma diária em uma única data'::text; end if;
  if modal = 'multi_profissional' then
    if jsonb_array_length(at) < 2 then e := e || 'Escolha 2 ou mais profissionais'::text;
    elsif jsonb_array_length(at) > (V #>> '{limites,maximoProfissionais}')::int then e := e || ('No máximo ' || (V #>> '{limites,maximoProfissionais}') || ' profissionais'); end if;
    if (select count(distinct coalesce(y -> 'data', 'null'::jsonb)) from jsonb_array_elements(at) y) > 1 then e := e || 'Todas as profissionais atendem no mesmo dia'::text; end if;
  end if;
  if modal = 'pacote' then
    if jsonb_array_length(at) < 2 then e := e || 'Escolha 2 ou mais datas'::text;
    elsif jsonb_array_length(at) > (V #>> '{limites,maximoDiarias}')::int then e := e || ('No máximo ' || (V #>> '{limites,maximoDiarias}') || ' diárias por solicitação'); end if;
    if (select count(distinct coalesce(y -> 'data', 'null'::jsonb)) from jsonb_array_elements(at) y) <> jsonb_array_length(at) then e := e || 'A mesma data foi escolhida duas vezes'::text; end if;
  end if;
  servs := coalesce(P0 -> 'servicosPorTipoCliente' -> (case when jsonb_typeof(p -> 'segmento') = 'string' then p ->> 'segmento' end), '[]');
  lim2 := (P0 #>> '{duracoes,2,metragemMaxima}')::int;
  i := 0;
  for a in select y from jsonb_array_elements(at) y loop
    i := i + 1; n := 'Diária ' || i || ': ';
    if not privado.v3_obj(a) then e := e || (n || 'dados inválidos'); continue; end if;
    if jsonb_typeof(a -> 'servico') is distinct from 'string' or not coalesce(servs ? (a ->> 'servico'), false) then e := e || (n || 'escolha o serviço'); end if;
    if not privado.v3_int(a -> 'duracaoHoras') or not (P0 -> 'duracoes') ? (a ->> 'duracaoHoras') then e := e || (n || 'escolha a duração (2, 4, 6 ou 8 horas)'); end if;
    if not privado.data_ok(a -> 'data') then e := e || (n || 'escolha a data'); end if;
    if jsonb_typeof(a -> 'horaInicio') is distinct from 'string' or (a ->> 'horaInicio') !~ '^([01][0-9]|2[0-3]):([0-5][0-9])$' then e := e || (n || 'escolha o horário'); end if;
    if not privado.v3_obj(a -> 'endereco') then e := e || (n || 'escolha o endereço'); end if;
    if jsonb_typeof(a -> 'localRefeicao') is distinct from 'boolean' then e := e || (n || 'responda sobre o local para a refeição'); end if;
    if (i = 1 or privado.tem_valor(a -> 'caracteristicas')) and jsonb_typeof(a -> 'servico') = 'string' and servs ? (a ->> 'servico') then
      foreach x in array privado.v3_validar_car(a ->> 'servico', a -> 'caracteristicas', cfg) loop e := e || (n || x); end loop;
    end if;
    if privado.v3_int(a -> 'duracaoHoras') and (a ->> 'duracaoHoras')::int = 2 and lim2 is not null and a ->> 'servico' is distinct from 'passadoria'
       and privado.v3_int(a #> '{caracteristicas,metragem}') and (a #>> '{caracteristicas,metragem}')::int > lim2 then
      e := e || (n || 'a diária de 2 horas é só para locais até ' || lim2 || ' m²');
    end if;
    if privado.tem_valor(a -> 'justificativa') and (jsonb_typeof(a -> 'justificativa') <> 'string' or char_length(a ->> 'justificativa') > 500) then
      e := e || (n || 'justificativa com no máximo 500 caracteres');
    end if;
  end loop;
  return e;
end $$;

/**
 * cotarV3. ctx: {hoje, cupom, condicao, primeiraContratacao, faturamento} (cupom e condição já resolvidos pelo chamador).
 * Mesma saída do JS: {versao, modalidade, segmento, frequencia, atendimentos, subtotalCentavos, descontos, descontoCentavos,
 * totalCentavos, cupom, condicaoAplicada, parcelas}.
 */
create or replace function privado.cotar_v3(p jsonb, ctx jsonb, cfg0 jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  cfg jsonb := privado.cfg_agenda(cfg0); P0 jsonb := cfg0 -> 'PRECOS'; V jsonb := cfg0 #> '{PRECOS,v3}';
  erros text[] := privado.v3_validar_pedido(p, cfg0); hoje date := (ctx ->> 'hoje')::date; modal text := p ->> 'modalidade';
  probs jsonb := '[]'; ats jsonb := '[]'; r record; seq int := 0; motivo text; reg jsonb; tipo jsonb; itens jsonb; base bigint;
  sab boolean; fer boolean; tx jsonb; rec jsonb; recomendada int; valor bigint; subtotal bigint := 0; qtd int; desc_qtd bigint;
  cupom jsonb := null; av jsonb; c jsonb := ctx -> 'cupom'; valor_cupom bigint := 0; base_cupom bigint; cond jsonb := null; valor_esp bigint := 0;
  cand jsonb := '[]'; sem_esp jsonb; restante bigint; descontos jsonb := '[]'; d jsonb; cc bigint; datas text[];
begin
  if cardinality(erros) > 0 then perform privado.erro('DADOS_INVALIDOS', array_to_string(erros, '; '), to_jsonb(erros)); end if;
  for r in select y a, o - 1 i from jsonb_array_elements(p -> 'atendimentos') with ordinality t(y, o)
            order by y ->> 'data', y ->> 'horaInicio', o loop
    seq := seq + 1;
    motivo := privado.motivo_data(r.a -> 'data', hoje, cfg);
    if motivo is not null then probs := probs || jsonb_build_object('sequencia', seq, 'data', r.a ->> 'data', 'motivo', motivo);
    elsif not (r.a ->> 'horaInicio') = any(privado.v3_horarios((r.a ->> 'duracaoHoras')::int, (r.a ->> 'data')::date, cfg0)) then
      probs := probs || jsonb_build_object('sequencia', seq, 'data', r.a ->> 'data', 'motivo',
        'horário ' || (r.a ->> 'horaInicio') || ' fora do horário de atendimento para ' || (r.a ->> 'duracaoHoras') || ' horas');
    end if;
    reg := privado.v3_regiao(r.a -> 'endereco', cfg0);
    if reg is null then perform privado.erro('REGIAO_NAO_ATENDIDA', 'No momento, não atendemos esta região (' || coalesce(nullif(r.a #>> '{endereco,cidade}', ''), 'CEP') || ')'); end if;
    if coalesce((reg ->> 'sobConsulta')::boolean, false) then perform privado.erro('REGIAO_SOB_CONSULTA', (reg ->> 'nome') || ': atendimento sob consulta. Fale com a Prime pelo WhatsApp.'); end if;
    tipo := P0 -> 'tiposServico' -> (r.a ->> 'servico');
    itens := jsonb_build_array(jsonb_build_object('codigo', 'diaria', 'descricao', 'Diária de ' || (r.a ->> 'duracaoHoras') || ' horas',
      'centavos', (P0 -> 'duracoes' -> (r.a ->> 'duracaoHoras') ->> 'centavos')::bigint));
    if coalesce((tipo ->> 'centavos')::bigint, 0) > 0 then
      itens := itens || jsonb_build_object('codigo', 'servico:' || (r.a ->> 'servico'), 'descricao', tipo ->> 'nome', 'centavos', (tipo ->> 'centavos')::bigint);
    end if;
    select sum((x ->> 'centavos')::bigint) into base from jsonb_array_elements(itens) x;
    sab := privado.dia_semana((r.a ->> 'data')::date) = 6;
    fer := coalesce((cfg0 -> 'feriados') @> to_jsonb(r.a ->> 'data'), false);
    tx := jsonb_build_object(
      'sabado', case when sab and (not fer or coalesce((V #>> '{taxas,acumulaSabadoFeriado}')::boolean, false)) then (V #>> '{taxas,sabadoCentavos}')::bigint else 0 end,
      'feriado', case when fer then (V #>> '{taxas,feriadoCentavos}')::bigint else 0 end,
      'refeicao', case when (r.a -> 'localRefeicao') = 'true' then 0 else (V #>> '{taxas,semRefeicaoCentavos}')::bigint end,
      'deslocamento', coalesce((reg ->> 'taxaCentavos')::bigint, 0));
    if (tx ->> 'sabado')::bigint > 0 then itens := itens || jsonb_build_object('codigo', 'sabado', 'descricao', 'Sábado', 'centavos', (tx ->> 'sabado')::bigint); end if;
    if (tx ->> 'feriado')::bigint > 0 then itens := itens || jsonb_build_object('codigo', 'feriado', 'descricao', 'Feriado', 'centavos', (tx ->> 'feriado')::bigint); end if;
    if (tx ->> 'refeicao')::bigint > 0 then itens := itens || jsonb_build_object('codigo', 'sem_refeicao', 'descricao', 'Sem local para aquecer refeição', 'centavos', (tx ->> 'refeicao')::bigint); end if;
    if (tx ->> 'deslocamento')::bigint > 0 then itens := itens || jsonb_build_object('codigo', 'deslocamento', 'descricao', 'Deslocamento (' || (reg ->> 'nome') || ')', 'centavos', (tx ->> 'deslocamento')::bigint); end if;
    rec := case when privado.tem_valor(r.a -> 'caracteristicas') then privado.v3_recomendar(r.a ->> 'servico', r.a -> 'caracteristicas', p ->> 'segmento', cfg0) end;
    recomendada := (rec ->> 'horas')::int;
    if recomendada is not null and (r.a ->> 'duracaoHoras')::int < recomendada and (r.a -> 'cienteDuracaoMenor') is distinct from 'true'::jsonb then
      probs := probs || jsonb_build_object('sequencia', seq, 'data', r.a ->> 'data', 'motivo', 'confirme que está ciente da duração menor que a sugerida');
    end if;
    select sum((x ->> 'centavos')::bigint) into valor from jsonb_array_elements(itens) x;
    ats := ats || jsonb_build_object('sequencia', seq, 'posicao', r.i, 'servico', r.a ->> 'servico', 'data', r.a ->> 'data', 'horaInicio', r.a ->> 'horaInicio',
      'duracaoMinutos', (r.a ->> 'duracaoHoras')::int * 60, 'regiao', reg ->> 'nome', 'itens', itens, 'baseCentavos', base, 'taxas', tx,
      'valorCentavos', valor, 'duracaoRecomendadaHoras', recomendada);
    subtotal := subtotal + valor;
  end loop;
  if jsonb_array_length(probs) > 0 then
    perform privado.erro('DATA_INVALIDA', (select string_agg('Diária ' || (pb ->> 'sequencia') || ' (' || (pb ->> 'data') || '): ' || (pb ->> 'motivo'), '; ') from jsonb_array_elements(probs) pb), probs);
  end if;
  qtd := jsonb_array_length(ats);
  desc_qtd := privado.v3_desconto_qtd(modal, qtd, cfg0);
  if privado.tem_valor(c) or privado.tem_valor(p -> 'cupom') then
    av := privado.v3_avaliar_cupom(c, modal, hoje, coalesce((ctx ->> 'primeiraContratacao')::boolean, false));
    cupom := jsonb_build_object('codigo', upper(coalesce(nullif(p ->> 'cupom', ''), c ->> 'codigo', '')), 'aplicado', (av ->> 'ok')::boolean)
          || case when (av ->> 'ok')::boolean then '{}'::jsonb else jsonb_build_object('motivo', av ->> 'motivo') end;
    if (av ->> 'ok')::boolean then
      base_cupom := case when coalesce((c ->> 'primeiraContratacao')::boolean, false) then (ats -> 0 ->> 'valorCentavos')::bigint else subtotal end;
      valor_cupom := case when c ->> 'tipo' = 'percentual' then round(base_cupom * (c ->> 'valor')::numeric / 100) else least((c ->> 'valor')::bigint, base_cupom) end;
    end if;
  end if;
  if privado.v3_obj(ctx -> 'condicao') and privado.v3_avaliar_condicao(ctx -> 'condicao', modal, qtd, hoje) then
    cond := ctx -> 'condicao';
    valor_esp := case when cond ->> 'tipo' = 'percentual' then round(subtotal * (cond ->> 'valor')::numeric / 100) else (cond ->> 'valor')::bigint end;
  end if;
  -- semEspecial()
  if coalesce((cupom ->> 'aplicado')::boolean, false) and not coalesce((c ->> 'acumula')::boolean, false) then
    sem_esp := jsonb_build_array(jsonb_build_object('codigo', 'cupom', 'descricao', 'Cupom ' || (cupom ->> 'codigo'), 'centavos', valor_cupom));
  else
    sem_esp := '[]';
    if desc_qtd > 0 then sem_esp := sem_esp || jsonb_build_object('codigo', 'quantidade', 'descricao', case when modal = 'pacote' then 'Desconto do pacote' else 'Desconto por profissionais' end, 'centavos', desc_qtd); end if;
    if coalesce((cupom ->> 'aplicado')::boolean, false) then sem_esp := sem_esp || jsonb_build_object('codigo', 'cupom', 'descricao', 'Cupom ' || (cupom ->> 'codigo'), 'centavos', valor_cupom); end if;
  end if;
  if cond is not null then
    cand := jsonb_build_array(jsonb_build_object('codigo', 'especial', 'descricao', 'Desconto especial', 'centavos', valor_esp));
    if coalesce((cond ->> 'acumula')::boolean, false) then cand := cand || sem_esp;
    elsif coalesce((cupom ->> 'aplicado')::boolean, false) then cupom := jsonb_build_object('codigo', cupom ->> 'codigo', 'aplicado', false, 'motivo', 'nao_acumula'); end if;
  else cand := sem_esp; end if;
  restante := subtotal;
  for d in select x from jsonb_array_elements(cand) x loop
    cc := least((d ->> 'centavos')::bigint, restante);
    if cc > 0 then descontos := descontos || (d || jsonb_build_object('centavos', cc)); restante := restante - cc; end if;
  end loop;
  select array_agg(x ->> 'data') into datas from jsonb_array_elements(ats) x;
  return jsonb_build_object('versao', 3, 'modalidade', modal, 'segmento', p ->> 'segmento', 'frequencia', case when modal = 'pacote' then p ->> 'frequencia' end,
    'atendimentos', ats, 'subtotalCentavos', subtotal, 'descontos', descontos, 'descontoCentavos', subtotal - restante, 'totalCentavos', restante,
    'cupom', cupom, 'condicaoAplicada', cond is not null,
    'parcelas', privado.v3_parcelas(modal, datas, restante, case when privado.v3_obj(ctx -> 'faturamento') then ctx -> 'faturamento' end, cfg0));
end $$;

/** Paridade (testes, papel de serviço): cotação com contexto e configuração dados (p_cfg sobrepõe a vigente). */
create or replace function public.paridade_v3(p_pedido jsonb, p_ctx jsonb, p_cfg jsonb default null) returns jsonb
language sql stable security definer set search_path = '' as $$ select privado.cotar_v3(p_pedido, p_ctx, coalesce(p_cfg, privado.cfg_v3())) $$;
create or replace function public.paridade_v3_recomendar(p_servico text, p_car jsonb, p_segmento text, p_cfg jsonb default null) returns jsonb
language sql stable security definer set search_path = '' as $$ select privado.v3_recomendar(p_servico, p_car, p_segmento, coalesce(p_cfg, privado.cfg_v3())) $$;
create or replace function public.paridade_v3_horarios(p_horas int, p_data date, p_cfg jsonb default null) returns text[]
language sql stable security definer set search_path = '' as $$ select privado.v3_horarios(p_horas, p_data, coalesce(p_cfg, privado.cfg_v3())) $$;
create or replace function public.config_v3_servico() returns jsonb
language sql stable security definer set search_path = '' as $$ select privado.cfg_v3() $$;
revoke execute on function public.paridade_v3(jsonb, jsonb, jsonb), public.paridade_v3_recomendar(text, jsonb, text, jsonb),
  public.paridade_v3_horarios(int, date, jsonb), public.config_v3_servico() from public, anon, authenticated;
grant execute on function public.paridade_v3(jsonb, jsonb, jsonb), public.paridade_v3_recomendar(text, jsonb, text, jsonb),
  public.paridade_v3_horarios(int, date, jsonb), public.config_v3_servico() to service_role;
