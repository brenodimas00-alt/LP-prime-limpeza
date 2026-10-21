-- Painel v2, B2 (spec-painel-v2, seção 1): navegação nova.
-- 1) buscar_global: uma busca só no topo (cliente, profissional, solicitação pelo número, endereço, telefone). Mesmo cuidado
--    da busca do P1: só equipe Prime, limite por hora, auditoria sem o termo, telefone e documento mascarados; o resultado
--    leva à ficha/solicitação, que já são da equipe.
-- 2) painel_sistema_hoje: "Sistema trabalhando por você": mensagens automáticas concluídas hoje (as falhas NÃO entram aqui:
--    vão pra "Precisa de você", B3).
-- 3) painel_resumo: contadores do menu e do sino (solicitações novas, pendências e urgentes). O B3 completa as pendências.

create or replace function public.buscar_global(p_termo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); t text := trim(coalesce(p_termo, '')); d text := regexp_replace(coalesce(p_termo, ''), '\D', '', 'g');
        v_tipo text; r jsonb;
begin
  perform privado.exigir_prime(s);
  if char_length(t) < 3 then perform privado.erro('DADOS_INVALIDOS', 'Digite pelo menos 3 caracteres'); end if;
  if not privado.limite_acao('busca_global:' || auth.uid(), 600, interval '1 hour') then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Muitas buscas seguidas. Espere um pouco.'); end if;
  v_tipo := case when t like '%@%' then 'email'
                 when char_length(d) between 1 and 7 and char_length(d) = char_length(regexp_replace(t, '[\s#nº.]', '', 'gi')) then 'numero_solicitacao'
                 when char_length(d) >= 8 and char_length(d) = char_length(regexp_replace(t, '[\s.\-/()]', '', 'g')) then 'numero'
                 else 'texto' end;
  select coalesce(jsonb_agg(x), '[]') into r from (
    (select jsonb_build_object('tipo', 'cliente', 'id', c.id, 'titulo', c.nome,
        'sub', concat_ws(' · ', privado.mascarar_telefone(c.telefone), nullif(c.endereco ->> 'bairro', ''), nullif(c.endereco ->> 'cidade', ''))) x
       from public.clientes c
      where c.anonimizado_em is null and case v_tipo
        when 'email' then lower(c.email) = lower(t)
        when 'numero' then c.documento = d or c.telefone = d or c.telefone like '%' || d
        when 'texto' then lower(c.nome) like '%' || lower(t) || '%'
        else false end
      order by c.nome limit 8)
    union all
    (select jsonb_build_object('tipo', 'endereco', 'id', c.id, 'titulo', c.nome,
        'sub', concat_ws(' · ', concat_ws(', ', e.logradouro, e.numero), e.bairro, e.cidade)) x
       from public.enderecos e join public.clientes c on c.id = e.cliente_id
      where v_tipo = 'texto' and c.anonimizado_em is null and e.ativo
        and (lower(e.logradouro) like '%' || lower(t) || '%' or lower(e.bairro) like '%' || lower(t) || '%')
        and not lower(c.nome) like '%' || lower(t) || '%'
      order by c.nome limit 6)
    union all
    (select jsonb_build_object('tipo', 'profissional', 'id', x.id, 'titulo', x.nome,
        'sub', concat_ws(' · ', privado.mascarar_telefone(x.telefone), case x.status when 'aprovada' then 'Ativa' when 'pendente' then 'Cadastro pra analisar' else x.status end)) x
       from public.diaristas x
      where x.status <> 'rascunho' and case v_tipo
        when 'email' then lower(x.email) = lower(t)
        when 'numero' then x.cpf = d or x.telefone = d or x.telefone like '%' || d
        when 'texto' then lower(x.nome) like '%' || lower(t) || '%'
        else false end
      order by x.nome limit 6)
    union all
    (select jsonb_build_object('tipo', 'solicitacao', 'id', p.id, 'titulo', 'Solicitação nº ' || lpad(p.numero_solicitacao::text, 6, '0'),
        'sub', concat_ws(' · ', c.nome, case p.status when 'solicitado' then 'Nova' when 'aguardando_pagamento' then 'Aguardando pagamento' when 'confirmado' then 'Confirmada'
                                          when 'concluido' then 'Concluída' when 'cancelado' then 'Cancelada' when 'recusado' then 'Recusada' else p.status end)) x
       from public.pedidos p join public.clientes c on c.id = p.cliente_id
      where v_tipo = 'numero_solicitacao' and p.numero_solicitacao = d::bigint
      limit 3)) y;
  insert into public.auditoria (tabela, operacao, ator_user_id, ator_papel, ator_contexto, depois)
  values ('busca', 'INSERT', auth.uid(), privado.papel(), 'prime', jsonb_build_object('tipo', v_tipo, 'tamanho', char_length(t), 'resultados', jsonb_array_length(r), 'origem', 'busca_global'));
  return jsonb_build_object('itens', r);
end $$;

/** Mensagens automáticas concluídas hoje (fuso de SP), da mais recente pra mais antiga. Sem destino nem conteúdo. */
create or replace function public.painel_sistema_hoje() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator(); v_ini timestamptz := (privado.hoje_sp()::timestamp at time zone 'America/Sao_Paulo');
begin
  perform privado.exigir_prime(s);
  return (select jsonb_build_object('total', count(*), 'itens', coalesce((jsonb_agg(jsonb_build_object('em', x.atualizado_em, 'regra', x.regra, 'descricao', x.descricao) order by x.atualizado_em desc)
                                        filter (where x.n <= 30)), '[]'))
            from (select e.atualizado_em, e.regra, coalesce(r.descricao, e.regra) descricao, row_number() over (order by e.atualizado_em desc) n
                    from public.automacao_execucoes e left join public.automacao_regras r on r.codigo = e.regra
                   where e.estado in ('enviada', 'entregue', 'lida') and not e.teste and e.atualizado_em >= v_ini) x);
end $$;

/** Contadores do menu e do sino. As pendências completas (com prioridade) vêm do B3 (painel_pendencias). */
create or replace function public.painel_resumo() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator(); v_hoje date := privado.hoje_sp(); v_sol int; v_sem int; v_pag int; v_cad int;
begin
  perform privado.exigir_prime(s);
  select count(*) into v_sol from public.pedidos where status = 'solicitado';
  select count(*) into v_sem from public.atendimentos a join public.pedidos p on p.id = a.pedido_id
   where a.diarista_id is null and a.status in ('agendado', 'confirmado') and p.status not in ('solicitado', 'recusado', 'cancelado') and a.data between v_hoje and v_hoje + 1;
  select count(*) into v_pag from public.pagamentos where status = 'informado_pelo_cliente';
  select count(*) into v_cad from public.diaristas where status = 'pendente';
  return jsonb_build_object('solicitacoesNovas', v_sol, 'pendencias', v_sem + v_pag + v_cad, 'urgentes', v_sem);
end $$;

revoke all on function public.buscar_global(text), public.painel_sistema_hoje(), public.painel_resumo() from public, anon;
grant execute on function public.buscar_global(text), public.painel_sistema_hoje(), public.painel_resumo() to authenticated;
