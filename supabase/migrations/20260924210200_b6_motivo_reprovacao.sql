-- B6: reprovar cadastro de diarista exige motivo também no banco (antes só a tela do painel exigia).
create or replace function privado.decidir_diarista(p_id uuid, p_status text, p_dados jsonb, p_chave text) returns jsonb
language plpgsql set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; d public.diaristas; op text := case when p_status = 'aprovada' then 'aprovarDiarista' else 'reprovarDiarista' end;
        conteudo jsonb := jsonb_build_object('id', p_id, 'motivo', p_dados -> 'motivo');
begin
  perform privado.exigir_prime(s);
  if p_status = 'reprovada' and trim(coalesce(p_dados ->> 'motivo', '')) = '' then
    perform privado.erro('DADOS_INVALIDOS', 'Escreva o motivo pra reprovar', '{"motivo": "Escreva o motivo pra reprovar"}');
  end if;
  r := privado.idem_ler(op, s, p_chave, conteudo);
  if r is not null then return r; end if;
  perform set_config('app.ator', 'prime', true);
  select * into d from public.diaristas where id = p_id for update;
  if not found then perform privado.erro('NAO_ENCONTRADO', 'Diarista não encontrado'); end if;
  if d.status <> 'pendente' then perform privado.erro('TRANSICAO_PROIBIDA', 'Cadastro já está ' || d.status); end if;
  update public.diaristas set status = p_status, decisao = jsonb_build_object('em', privado.agora_iso(), 'motivo', regexp_replace(trim(coalesce(p_dados ->> 'motivo', '')), '\s+', ' ', 'g'), 'por', auth.uid())
   where id = d.id returning * into d;
  perform privado.evento(case when p_status = 'aprovada' then 'diarista_aprovada' else 'diarista_reprovada' end, jsonb_build_object('diaristaId', d.id));
  r := privado.j_diarista(d);
  perform privado.idem_gravar(op, s, p_chave, conteudo, r);
  return r;
end $$;
