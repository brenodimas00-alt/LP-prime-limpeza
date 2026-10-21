-- Painel v2, B7 (revisão do Codex): aprovar o endereço novo do pacote fica idempotente. Repetir depois de uma resposta
-- perdida devolve o mesmo resultado em vez de "transição proibida".
create or replace function public.aprovar_endereco_pacote(p_pedido uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); p public.pedidos;
begin
  perform privado.exigir_prime(s);
  select * into p from public.pedidos where id = p_pedido for update;
  if not found then perform privado.erro('NAO_ENCONTRADO', 'Solicitação não encontrada'); end if;
  if p.status = 'solicitado' and not p.pacote_endereco_novo and p.historico @> '[{"evento": "endereco_novo_aprovado"}]' then
    return jsonb_build_object('pedidoId', p.id, 'enderecoNovoPacote', false, '_repetido', true);
  end if;
  if p.status <> 'solicitado' or not p.pacote_endereco_novo then perform privado.erro('TRANSICAO_PROIBIDA', 'Não há endereço novo pra aprovar nesta solicitação'); end if;
  update public.pedidos set pacote_endereco_novo = false,
    historico = historico || jsonb_build_object('de', status, 'para', status, 'evento', 'endereco_novo_aprovado', 'em', privado.agora_iso(), 'ator', 'prime')
   where id = p_pedido returning * into p;
  return jsonb_build_object('pedidoId', p.id, 'enderecoNovoPacote', p.pacote_endereco_novo);
end $$;
