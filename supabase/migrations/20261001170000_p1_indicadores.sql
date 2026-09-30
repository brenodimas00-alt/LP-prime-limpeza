-- P1 (fase 2, bloco 3): visão geral com indicadores (só prime_admin) e busca global (Prime, mascarada, auditada).
-- Tudo calculado no banco, por período (datas em America/Sao_Paulo). O navegador recebe só os números.

create index if not exists pedidos_criado_em on public.pedidos (criado_em);
create index if not exists pagamentos_confirmado_em on public.pagamentos (confirmado_em) where status = 'confirmado';
create index if not exists pagamentos_vence_em on public.pagamentos (vence_em) where status in ('pendente', 'informado_pelo_cliente', 'confirmado');
create index if not exists atendimentos_data on public.atendimentos (data) where status <> 'cancelado';
create index if not exists avaliacoes_criado_em on public.avaliacoes (criado_em);
create index if not exists clientes_nome_lower on public.clientes (lower(nome));
create index if not exists clientes_email_lower on public.clientes (lower(email));
create index if not exists clientes_telefone on public.clientes (telefone);

create or replace function public.indicadores(p_de date, p_ate date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator(); ini timestamptz; fim timestamptz; r jsonb;
begin
  perform privado.exigir_prime(s);
  if s ->> 'papel' <> 'prime_admin' then perform privado.erro('ATOR_SEM_PERMISSAO', 'Só a administração da Prime vê os indicadores'); end if;
  if p_de is null or p_ate is null or p_ate < p_de or p_ate - p_de > 366 then perform privado.erro('DADOS_INVALIDOS', 'Período de até 1 ano'); end if;
  ini := p_de::timestamp at time zone 'America/Sao_Paulo';
  fim := (p_ate + 1)::timestamp at time zone 'America/Sao_Paulo';
  with ped as (select * from public.pedidos where criado_em >= ini and criado_em < fim),
       atd as (select a.*, p.pacote, coalesce(p.endereco, c.endereco) ende from public.atendimentos a join public.pedidos p on p.id = a.pedido_id join public.clientes c on c.id = p.cliente_id
                where a.data between p_de and p_ate and a.status <> 'cancelado'),
       conf as (select p.id, min((h ->> 'em')::timestamptz) em from ped p, jsonb_array_elements(p.historico) h where h ->> 'evento' = 'confirmar_disponibilidade' group by p.id),
       primeiro as (select cliente_id, min(criado_em) em from public.pedidos group by cliente_id)
  select jsonb_build_object(
    'periodo', jsonb_build_object('de', p_de, 'ate', p_ate),
    'solicitacoes', jsonb_build_object('total', (select count(*) from ped),
      'porEstado', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from ped group by status) x)),
    'recusa', jsonb_build_object('total', (select count(*) from ped where status = 'recusado'),
      'taxa', (select case when count(*) = 0 then 0 else round(count(*) filter (where status = 'recusado') * 100.0 / count(*), 1) end from ped),
      'motivos', (select coalesce(jsonb_agg(jsonb_build_object('motivo', m, 'n', n) order by n desc, m), '[]') from (select coalesce(recusa ->> 'motivo', 'sem motivo') m, count(*) n from ped where status = 'recusado' group by 1 order by 2 desc limit 10) x)),
    'horasAteConfirmar', (select round(avg(extract(epoch from (c.em - p.criado_em)) / 3600)::numeric, 1) from conf c join ped p on p.id = c.id),
    'faturamento', jsonb_build_object(
      'previstoCentavos', (select coalesce(sum(g.valor_centavos), 0) from public.pagamentos g join public.pedidos p on p.id = g.pedido_id
                            where g.vence_em between p_de and p_ate and g.status in ('pendente', 'informado_pelo_cliente', 'confirmado') and p.status in ('aguardando_pagamento', 'confirmado', 'concluido')),
      'recebidoCentavos', (select coalesce(sum(valor_centavos), 0) from public.pagamentos where status = 'confirmado' and confirmado_em >= ini and confirmado_em < fim)),
    'pagamentosVencidos', (select jsonb_build_object('n', count(*), 'centavos', coalesce(sum(valor_centavos), 0)) from public.pagamentos x where x.status = 'pendente' and privado.prazo_vencido(x)),
    'diarias', jsonb_build_object('total', (select count(*) from atd),
      'porServico', (select coalesce(jsonb_object_agg(k, n), '{}') from (select pacote ->> 'tipoServico' k, count(*) n from atd group by 1) x),
      'porCarga', (select coalesce(jsonb_object_agg(k, n), '{}') from (select (duracao_minutos / 60)::text || 'h' k, count(*) n from atd group by 1) x),
      'porRegiao', (select coalesce(jsonb_object_agg(k, n), '{}') from (select coalesce(ende ->> 'cidade', 'sem cidade') k, count(*) n from atd group by 1) x)),
    'clientes', jsonb_build_object(
      'novos', (select count(distinct p.cliente_id) from ped p join primeiro f on f.cliente_id = p.cliente_id where f.em >= ini),
      'recorrentes', (select count(distinct p.cliente_id) from ped p join primeiro f on f.cliente_id = p.cliente_id where f.em < ini)),
    'ticketMedioCentavos', (select coalesce(round(avg(total_centavos)), 0) from ped where status not in ('recusado', 'cancelado')),
    'pesquisa', jsonb_build_object(
      'respostas', (select count(*) from public.avaliacoes where criado_em >= ini and criado_em < fim),
      'porCriterio', (select coalesce(jsonb_object_agg(k, m), '{}') from (select k, round(avg((v #>> '{}')::numeric), 2) m from public.avaliacoes v2, jsonb_each(v2.notas) e(k, v)
                        where v2.criado_em >= ini and v2.criado_em < fim group by k) x),
      'porProfissional', (select coalesce(jsonb_agg(jsonb_build_object('nome', nome, 'media', m, 'n', n) order by m desc, nome), '[]') from (
          select d.nome, round(avg(v.nota_final), 2) m, count(*) n from public.avaliacoes v join public.atendimentos a on a.id = v.atendimento_id join public.diaristas d on d.id = a.diarista_id
           where v.criado_em >= ini and v.criado_em < fim group by d.nome) x)),
    'ocorrencias', (select coalesce(jsonb_object_agg(tipo, n), '{}') from (select tipo, count(*) n from public.ocorrencias where criado_em >= ini and criado_em < fim group by tipo) x))
  into r;
  return r;
end $$;

/**
 * Busca por nome, CPF/CNPJ, telefone ou e-mail (clientes e profissionais). Resultado mascarado; cada busca fica na
 * auditoria (sem o termo, que pode ser dado pessoal: só o tipo e o tamanho). Mínimo 3 caracteres, até 20 resultados.
 */
create or replace function public.buscar(p_termo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); t text := trim(coalesce(p_termo, '')); d text := regexp_replace(coalesce(p_termo, ''), '\D', '', 'g');
        tipo text; r jsonb;
begin
  perform privado.exigir_prime(s);
  if char_length(t) < 3 then perform privado.erro('DADOS_INVALIDOS', 'Digite pelo menos 3 caracteres'); end if;
  if not privado.limite_acao('busca:' || auth.uid(), 120, interval '1 hour') then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Muitas buscas seguidas. Espere um pouco.'); end if;
  tipo := case when t like '%@%' then 'email' when char_length(d) >= 8 and char_length(d) = char_length(regexp_replace(t, '[\s.\-/()]', '', 'g')) then 'numero' else 'nome' end;
  select coalesce(jsonb_agg(x), '[]') into r from (
    (select jsonb_build_object('tipo', 'cliente', 'id', c.id, 'nome', c.nome, 'documento', privado.mascarar_documento(c.tipo_documento, c.documento),
        'telefone', privado.mascarar_telefone(c.telefone), 'email', privado.mascarar_email(c.email), 'cidade', c.endereco ->> 'cidade') x
       from public.clientes c
      where c.anonimizado_em is null and case tipo
        when 'email' then lower(c.email) = lower(t)
        when 'numero' then c.documento = d or c.telefone = d or (char_length(d) >= 8 and c.telefone like '%' || d)
        else lower(c.nome) like '%' || lower(t) || '%' end
      order by c.nome limit 20)
    union all
    (select jsonb_build_object('tipo', 'profissional', 'id', x.id, 'nome', x.nome, 'documento', privado.mascarar_documento('cpf', x.cpf),
        'telefone', privado.mascarar_telefone(x.telefone), 'email', privado.mascarar_email(x.email), 'situacao', x.status)
       from public.diaristas x
      where x.status <> 'rascunho' and case tipo
        when 'email' then lower(x.email) = lower(t)
        when 'numero' then x.cpf = d or x.telefone = d
        else lower(x.nome) like '%' || lower(t) || '%' end
      order by x.nome limit 20)) y;
  insert into public.auditoria (tabela, operacao, ator_user_id, ator_papel, ator_contexto, depois)
  values ('busca', 'INSERT', auth.uid(), privado.papel(), 'prime', jsonb_build_object('tipo', tipo, 'tamanho', char_length(t), 'resultados', jsonb_array_length(r)));
  return r;
end $$;

revoke execute on function public.indicadores(date, date), public.buscar(text) from public, anon;
grant execute on function public.indicadores(date, date), public.buscar(text) to authenticated;
