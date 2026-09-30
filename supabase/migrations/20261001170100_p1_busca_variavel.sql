-- P1, achado do teste (42702): a variável "tipo" da busca tinha o nome da coluna clientes.tipo. Mesma função, variável v_tipo.
/**
 * Busca por nome, CPF/CNPJ, telefone ou e-mail (clientes e profissionais). Resultado mascarado; cada busca fica na
 * auditoria (sem o termo, que pode ser dado pessoal: só o tipo e o tamanho). Mínimo 3 caracteres, até 20 resultados.
 */
create or replace function public.buscar(p_termo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); t text := trim(coalesce(p_termo, '')); d text := regexp_replace(coalesce(p_termo, ''), '\D', '', 'g');
        v_tipo text; r jsonb;
begin
  perform privado.exigir_prime(s);
  if char_length(t) < 3 then perform privado.erro('DADOS_INVALIDOS', 'Digite pelo menos 3 caracteres'); end if;
  if not privado.limite_acao('busca:' || auth.uid(), 120, interval '1 hour') then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Muitas buscas seguidas. Espere um pouco.'); end if;
  v_tipo := case when t like '%@%' then 'email' when char_length(d) >= 8 and char_length(d) = char_length(regexp_replace(t, '[\s.\-/()]', '', 'g')) then 'numero' else 'nome' end;
  select coalesce(jsonb_agg(x), '[]') into r from (
    (select jsonb_build_object('tipo', 'cliente', 'id', c.id, 'nome', c.nome, 'documento', privado.mascarar_documento(c.tipo_documento, c.documento),
        'telefone', privado.mascarar_telefone(c.telefone), 'email', privado.mascarar_email(c.email), 'cidade', c.endereco ->> 'cidade') x
       from public.clientes c
      where c.anonimizado_em is null and case v_tipo
        when 'email' then lower(c.email) = lower(t)
        when 'numero' then c.documento = d or c.telefone = d or (char_length(d) >= 8 and c.telefone like '%' || d)
        else lower(c.nome) like '%' || lower(t) || '%' end
      order by c.nome limit 20)
    union all
    (select jsonb_build_object('tipo', 'profissional', 'id', x.id, 'nome', x.nome, 'documento', privado.mascarar_documento('cpf', x.cpf),
        'telefone', privado.mascarar_telefone(x.telefone), 'email', privado.mascarar_email(x.email), 'situacao', x.status)
       from public.diaristas x
      where x.status <> 'rascunho' and case v_tipo
        when 'email' then lower(x.email) = lower(t)
        when 'numero' then x.cpf = d or x.telefone = d
        else lower(x.nome) like '%' || lower(t) || '%' end
      order by x.nome limit 20)) y;
  insert into public.auditoria (tabela, operacao, ator_user_id, ator_papel, ator_contexto, depois)
  values ('busca', 'INSERT', auth.uid(), privado.papel(), 'prime', jsonb_build_object('tipo', v_tipo, 'tamanho', char_length(t), 'resultados', jsonb_array_length(r)));
  return r;
end $$;

