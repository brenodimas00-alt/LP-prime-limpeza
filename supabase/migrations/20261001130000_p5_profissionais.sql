-- P5 (fase 2, bloco 3): profissionais.
-- 1) Validade da certidão de antecedentes (padrão 90 dias, configuracao.documentos.validadeAntecedentesDias; PENDENCIAS):
--    valido_ate no documento, alerta no painel (vencendo e vencido) e D07 pra profissional (15 e 3 dias antes).
-- 2) Repasse mensal por profissional pela regra configurável (percentual ou valor por carga horária), atrás da flag
--    p5_repasse DESLIGADA até a cliente definir. Fechar o mês grava os valores e trava (não recalcula depois).
-- 3) Importação de profissionais por planilha (scripts/importa-profissionais.mjs): origem "importada", entra aprovada e
--    sem acesso; o aceite dos termos é pedido no primeiro login (L1).

insert into public.config_flags (chave, ligada, padrao, descricao) values
  ('p5_repasse', false, false, 'Cálculo e fechamento do repasse mensal das profissionais (regra ainda a definir pela Prime)')
on conflict (chave) do nothing;

-- ---------------------------------------------------------------- validade da certidão
update public.configuracao set valor = valor || '{"validadeAntecedentesDias": 90}' where chave = 'documentos' and not valor ? 'validadeAntecedentesDias';
alter table public.documentos add column valido_ate date;

create or replace function privado.validade_documento() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.tipo = 'antecedentes' and new.valido_ate is null then
    new.valido_ate := (new.criado_em at time zone 'America/Sao_Paulo')::date
      + coalesce((select (c.valor ->> 'validadeAntecedentesDias')::int from public.configuracao c where c.chave = 'documentos'), 90);
  end if;
  return new;
end $$;
create trigger validade_documento before insert on public.documentos for each row execute function privado.validade_documento();
update public.documentos set valido_ate = (criado_em at time zone 'America/Sao_Paulo')::date + 90 where tipo = 'antecedentes' and valido_ate is null;
create index documentos_validade on public.documentos (valido_ate) where tipo = 'antecedentes' and excluido_em is null;

/** Certidão atual (a mais recente não excluída) de cada profissional aprovada, com a situação. Só Prime. */
create or replace function public.documentos_vencimento(p_dias int default 30) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator(); hoje date := privado.hoje_sp();
begin
  perform privado.exigir_prime(s);
  return (select coalesce(jsonb_agg(jsonb_build_object('diaristaId', d.id, 'nome', d.nome, 'documentoId', x.id, 'validoAte', x.valido_ate,
      'dias', x.valido_ate - hoje, 'situacao', case when x.id is null then 'sem_certidao' when x.valido_ate < hoje then 'vencido' else 'vencendo' end)
      order by x.valido_ate nulls first, d.nome), '[]')
    from public.diaristas d
    left join lateral (select doc.id, doc.valido_ate from public.documentos doc where doc.diarista_id = d.id and doc.tipo = 'antecedentes' and doc.excluido_em is null
                        order by doc.criado_em desc limit 1) x on true
    where d.status = 'aprovada' and (x.id is null or x.valido_ate <= hoje + least(greatest(coalesce(p_dias, 30), 0), 365)));
end $$;

-- ---------------------------------------------------------------- importação
alter table public.diaristas add column origem text not null default 'site' check (origem in ('site', 'importada'));
alter table public.diaristas add column importacao jsonb;
-- importada não passou pelo cadastro do site: sem identidade e sem aceite até o primeiro login
alter table public.diaristas drop constraint diaristas_check;
alter table public.diaristas add constraint diaristas_check check (status = 'rascunho' or (nome is not null and cpf is not null and telefone is not null
  and (email is not null or origem = 'importada') and (data_nascimento is not null or origem = 'importada')
  and ((identidade is not null and aceite_termos_em is not null) or origem = 'importada')));

-- ---------------------------------------------------------------- repasse
alter table public.configuracao drop constraint configuracao_chave_check;
alter table public.configuracao add constraint configuracao_chave_check check (chave in ('pix', 'contato', 'auth', 'documentos', 'regioes_diarista', 'repasse'));
insert into public.configuracao (chave, valor) values ('repasse', '{"tipo": null}') on conflict (chave) do nothing;
-- a regra do repasse é dado interno da Prime: fora da leitura pública da tabela de configuração
drop policy if exists leitura_publica on public.configuracao;
create policy leitura_publica on public.configuracao for select to anon, authenticated using (chave <> 'repasse');

create table public.repasses_fechamentos (
  mes date primary key check (extract(day from mes) = 1),
  regra jsonb not null,
  fechado_em timestamptz not null default now(),
  fechado_por uuid references auth.users (id) on delete set null
);
create table public.repasses (
  mes date not null references public.repasses_fechamentos (mes),
  diarista_id uuid not null references public.diaristas (id),
  diarias int not null check (diarias >= 0),
  horas numeric(7, 1) not null check (horas >= 0),
  horas_extras int not null check (horas_extras >= 0),
  valor_centavos bigint not null check (valor_centavos >= 0),
  primary key (mes, diarista_id)
);
alter table public.repasses_fechamentos enable row level security;
alter table public.repasses_fechamentos force row level security;
alter table public.repasses enable row level security;
alter table public.repasses force row level security;
-- leitura só pelas RPCs (só prime_admin): valores de repasse não aparecem pra atendimento nem pra profissional
create trigger auditoria after insert or update or delete on public.repasses_fechamentos for each row execute function privado.auditar();
-- fechado não muda: nem update nem delete (só o que a limpeza de teste faz como serviço, dentro da função de limpeza)
create or replace function privado.repasse_travado() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('app.ator', true), '') <> 'limpeza_teste' then raise exception 'REPASSE_FECHADO'; end if;
  return coalesce(old, new);
end $$;
create trigger travado before update or delete on public.repasses for each row execute function privado.repasse_travado();
create trigger travado before update or delete on public.repasses_fechamentos for each row execute function privado.repasse_travado();

create or replace function privado.regra_repasse_valida(r jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select case r ->> 'tipo'
    when 'percentual' then coalesce((r ->> 'percentual') ~ '^\d{1,3}(\.\d{1,2})?$' and (r ->> 'percentual')::numeric between 1 and 100, false)
    when 'por_carga' then coalesce((select bool_and(r #>> array['valores', k] ~ '^\d{1,7}$') from unnest(array['2', '4', '6', '8']) k), false)
                          and coalesce((r ->> 'horaExtraCentavos') ~ '^\d{1,6}$', false)
    else false end
$$;

/** Cálculo do mês pela regra (diárias finalizadas ou avaliadas no mês e horas extras aprovadas delas). Puro sobre os dados. */
create or replace function privado.calcular_repasse(p_mes date, r jsonb) returns jsonb
language sql stable set search_path = '' as $$
  with base as (
    select a.diarista_id, count(*)::int diarias, sum(a.duracao_minutos) / 60.0 horas,
           sum(a.valor_dia_centavos) valor_dias,
           sum(case r ->> 'tipo' when 'por_carga' then coalesce((r #>> array['valores', (a.duracao_minutos / 60)::text])::bigint, 0) else 0 end) valor_carga
      from public.atendimentos a
     where a.diarista_id is not null and a.status in ('finalizado', 'avaliado') and a.data >= p_mes and a.data < (p_mes + interval '1 month')::date
     group by a.diarista_id),
  extras as (
    select a.diarista_id, sum(h.horas)::int horas from public.horas_extras h join public.atendimentos a on a.id = h.atendimento_id
     where h.status = 'aprovada' and a.data >= p_mes and a.data < (p_mes + interval '1 month')::date group by a.diarista_id)
  select coalesce(jsonb_agg(jsonb_build_object('diaristaId', d.id, 'nome', d.nome, 'diarias', b.diarias, 'horas', round(b.horas, 1),
      'horasExtras', coalesce(e.horas, 0),
      'valorCentavos', case r ->> 'tipo'
        when 'percentual' then round((b.valor_dias + coalesce(e.horas, 0) * (select (privado.cfg() #>> '{PRECOS,horaExtraCentavos}')::bigint)) * (r ->> 'percentual')::numeric / 100)::bigint
        else b.valor_carga + coalesce(e.horas, 0) * (r ->> 'horaExtraCentavos')::bigint end) order by d.nome), '[]')
    from base b join public.diaristas d on d.id = b.diarista_id left join extras e on e.diarista_id = b.diarista_id
$$;

create or replace function privado.exigir_admin_repasse(s jsonb) returns void
language plpgsql stable set search_path = '' as $$
begin
  perform privado.exigir_prime(s);
  if s ->> 'papel' <> 'prime_admin' then perform privado.erro('ATOR_SEM_PERMISSAO', 'Só a administração da Prime vê o repasse'); end if;
  if not privado.flag('p5_repasse') then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Repasse desligado até a Prime definir a regra (Configurações)'); end if;
end $$;

create or replace function public.salvar_regra_repasse(p_regra jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator();
begin
  perform privado.exigir_admin_repasse(s);
  if not privado.regra_repasse_valida(p_regra) then perform privado.erro('DADOS_INVALIDOS', 'Regra inválida: percentual de 1 a 100, ou valor por carga (2, 4, 6 e 8 horas) e da hora extra'); end if;
  perform set_config('app.ator', 'prime', true);
  update public.configuracao set valor = p_regra, atualizado_em = now() where chave = 'repasse';
  insert into public.auditoria (tabela, operacao, ator_user_id, ator_papel, ator_contexto, depois) values ('configuracao', 'UPDATE', auth.uid(), privado.papel(), 'prime', jsonb_build_object('repasse', p_regra));
  return p_regra;
end $$;

/** Mês fechado: os valores gravados. Aberto: a prévia pela regra atual. */
create or replace function public.repasse_mes(p_mes date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator(); m date := date_trunc('month', p_mes)::date; f public.repasses_fechamentos; regra jsonb;
begin
  perform privado.exigir_admin_repasse(s);
  select * into f from public.repasses_fechamentos where mes = m;
  if found then
    return jsonb_build_object('mes', m, 'fechado', true, 'fechadoEm', f.fechado_em, 'regra', f.regra, 'linhas', (select coalesce(jsonb_agg(jsonb_build_object(
      'diaristaId', r.diarista_id, 'nome', d.nome, 'diarias', r.diarias, 'horas', r.horas, 'horasExtras', r.horas_extras, 'valorCentavos', r.valor_centavos) order by d.nome), '[]')
      from public.repasses r join public.diaristas d on d.id = r.diarista_id where r.mes = m));
  end if;
  regra := (select c.valor from public.configuracao c where c.chave = 'repasse');
  return jsonb_build_object('mes', m, 'fechado', false, 'regra', regra, 'linhas', case when privado.regra_repasse_valida(regra) then privado.calcular_repasse(m, regra) else '[]'::jsonb end);
end $$;

/** Fecha um mês que já acabou: grava e trava. Idempotente pela chave; fechar de novo recusa. */
create or replace function public.fechar_repasse(p_mes date, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; m date := date_trunc('month', p_mes)::date; regra jsonb; l jsonb; conteudo jsonb := jsonb_build_object('mes', m);
begin
  perform privado.exigir_admin_repasse(s);
  r := privado.idem_ler('fecharRepasse', s, p_chave, conteudo);
  if r is not null then return r; end if;
  perform pg_advisory_xact_lock(hashtext('repasse:' || m));
  if m >= date_trunc('month', privado.hoje_sp())::date then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Só dá pra fechar um mês que já terminou'); end if;
  if exists (select 1 from public.repasses_fechamentos where mes = m) then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Este mês já foi fechado'); end if;
  regra := (select c.valor from public.configuracao c where c.chave = 'repasse');
  if not privado.regra_repasse_valida(regra) then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Defina a regra do repasse antes de fechar'); end if;
  perform set_config('app.ator', 'prime', true);
  insert into public.repasses_fechamentos (mes, regra, fechado_por) values (m, regra, auth.uid());
  for l in select * from jsonb_array_elements(privado.calcular_repasse(m, regra)) loop
    insert into public.repasses (mes, diarista_id, diarias, horas, horas_extras, valor_centavos)
    values (m, (l ->> 'diaristaId')::uuid, (l ->> 'diarias')::int, (l ->> 'horas')::numeric, (l ->> 'horasExtras')::int, (l ->> 'valorCentavos')::bigint);
  end loop;
  r := public.repasse_mes(m);
  perform privado.idem_gravar('fecharRepasse', s, p_chave, conteudo, r);
  return r;
end $$;

revoke execute on function public.documentos_vencimento(int), public.salvar_regra_repasse(jsonb), public.repasse_mes(date), public.fechar_repasse(date, text) from public, anon;
grant execute on function public.documentos_vencimento(int), public.salvar_regra_repasse(jsonb), public.repasse_mes(date), public.fechar_repasse(date, text) to authenticated;
