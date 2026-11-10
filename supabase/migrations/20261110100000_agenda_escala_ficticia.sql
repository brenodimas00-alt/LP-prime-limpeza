-- Agenda e Escala: profissional fictícia (testes, demonstração) nunca é candidata em pedido real. No homolog a
-- pré-designação automática (abrir a agenda, rotina das 06:00) chegou a pôr uma profissional de teste como Sugerida;
-- em produção não existe linha fictícia, então nada muda lá. Mesma definição de 20261109100000, mais o filtro.
create or replace function privado.escala_candidatas_lista(a public.atendimentos) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by (x ->> 'impedida')::boolean, (x ->> 'pontos')::int desc, x ->> 'nome', x ->> 'id'), '[]')
    from (select jsonb_build_object('id', d.id, 'nome', d.nome, 'nota', privado.escala_notas(d.id) -> 'nota', 'habilidades', to_jsonb(d.habilidades),
                 'regioes', coalesce(d.disponibilidade -> 'regioes', '[]'), 'atribuida', d.id = a.diarista_id) || privado.pontuar_candidata(a, d, privado.p_endereco(a, p, c) ->> 'cidade', p.cliente_id) x
            from public.diaristas d, public.pedidos p join public.clientes c on c.id = p.cliente_id
           where d.status = 'aprovada' and p.id = a.pedido_id and (p.ficticio or not d.ficticio)) t
$$;
