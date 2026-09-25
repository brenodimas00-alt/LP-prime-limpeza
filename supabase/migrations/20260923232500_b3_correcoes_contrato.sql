-- B3, correções achadas pela bateria de contrato: variável com o mesmo nome da coluna (42702) em cadastrar_diarista;
-- pode_ver_pedido/dia_pode_ver devolviam NULL (não FALSE) pra usuário logado sem cadastro, e "if not null" não barra.

create or replace function privado.pode_ver_pedido(s jsonb, p public.pedidos) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(p.id is not null and (s ->> 'ator' in ('prime', 'sistema') or (s ->> 'ator' = 'cliente' and (s ->> 'id')::uuid = p.cliente_id)), false)
$$;

create or replace function privado.dia_pode_ver(s jsonb, p_diarista uuid) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(s ->> 'ator' in ('prime', 'sistema') or (s ->> 'ator' = 'diarista' and (s ->> 'id')::uuid = p_diarista), false)
$$;

create or replace function public.cadastrar_diarista(p_dados jsonb, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; d public.diaristas; erros jsonb := '{}'; m text; end_e jsonb; cfg jsonb := privado.cfg(); hoje date := privado.hoje_sp();
        disp jsonb; dias jsonb; turnos jsonb; regioes jsonb; faltando text[]; exigidos text[]; presentes text[]; conteudo jsonb; did uuid; nasc date; anos numeric;
        v_nome text; v_cpf text; v_tel text; v_email text; e jsonb;
begin
  begin did := (p_dados ->> 'id')::uuid; exception when others then perform privado.erro('DADOS_INVALIDOS', 'Id do cadastro inválido'); end;
  v_nome := regexp_replace(trim(coalesce(p_dados ->> 'nome', '')), '\s+', ' ', 'g'); v_cpf := privado.so_digitos(p_dados ->> 'cpf'); v_tel := privado.so_digitos(p_dados ->> 'telefone');
  v_email := lower(trim(coalesce(p_dados ->> 'email', '')));
  e := coalesce(p_dados -> 'endereco', '{}');
  end_e := jsonb_build_object('cep', privado.so_digitos(e ->> 'cep'), 'logradouro', regexp_replace(trim(coalesce(e ->> 'logradouro', '')), '\s+', ' ', 'g'), 'numero', regexp_replace(trim(coalesce(e ->> 'numero', '')), '\s+', ' ', 'g'),
    'complemento', regexp_replace(trim(coalesce(e ->> 'complemento', '')), '\s+', ' ', 'g'), 'bairro', regexp_replace(trim(coalesce(e ->> 'bairro', '')), '\s+', ' ', 'g'), 'cidade', regexp_replace(trim(coalesce(e ->> 'cidade', '')), '\s+', ' ', 'g'), 'uf', upper(coalesce(e ->> 'uf', '')));
  disp := coalesce(p_dados -> 'disponibilidade', '{}');
  select coalesce(jsonb_agg(distinct x order by x), '[]') into dias from jsonb_array_elements(case when jsonb_typeof(disp -> 'dias') = 'array' then disp -> 'dias' else '[]' end) x;
  select coalesce(jsonb_agg(distinct x), '[]') into turnos from jsonb_array_elements(case when jsonb_typeof(disp -> 'turnos') = 'array' then disp -> 'turnos' else '[]' end) x;
  select coalesce(jsonb_agg(distinct x), '[]') into regioes from jsonb_array_elements(case when jsonb_typeof(disp -> 'regioes') = 'array' then disp -> 'regioes' else '[]' end) x;
  m := privado.v_nome(v_nome); if m <> '' then erros := erros || jsonb_build_object('nome', m); end if;
  m := privado.v_cpf(v_cpf); if m <> '' then erros := erros || jsonb_build_object('cpf', m); end if;
  m := privado.v_telefone(v_tel); if m <> '' then erros := erros || jsonb_build_object('telefone', m); end if;
  m := privado.v_email(v_email); if m <> '' then erros := erros || jsonb_build_object('email', m); end if;
  begin nasc := (p_dados ->> 'dataNascimento')::date; exception when others then nasc := null; end;
  if coalesce(p_dados ->> 'dataNascimento', '') = '' then erros := erros || '{"dataNascimento": "Informe a data"}';
  elsif nasc is null or to_char(nasc, 'YYYY-MM-DD') <> (p_dados ->> 'dataNascimento') then erros := erros || '{"dataNascimento": "Data inválida"}';
  else
    anos := floor((hoje - nasc) / 365.25);
    if anos < 18 then erros := erros || '{"dataNascimento": "É preciso ter 18 anos ou mais"}'; elsif anos > 90 then erros := erros || '{"dataNascimento": "Confira o ano de nascimento"}'; end if;
  end if;
  select erros || coalesce(jsonb_object_agg('endereco.' || k, v), '{}') into erros from jsonb_each(privado.v_endereco(end_e)) as x(k, v);
  if not privado.eh_inteiro(p_dados -> 'experienciaAnos') or (p_dados ->> 'experienciaAnos')::int not between 0 and 60 then erros := erros || '{"experienciaAnos": "Informe os anos de experiência (0 a 60)"}'; end if;
  if jsonb_array_length(dias) = 0 or exists (select 1 from jsonb_array_elements(dias) x where not privado.eh_inteiro(x) or (x #>> '{}')::int not between 0 and 6) then erros := erros || '{"disponibilidade.dias": "Marque pelo menos um dia"}'; end if;
  if jsonb_array_length(turnos) = 0 or exists (select 1 from jsonb_array_elements_text(turnos) x where x not in ('manha', 'tarde', 'integral')) then erros := erros || '{"disponibilidade.turnos": "Marque pelo menos um turno"}'; end if;
  if jsonb_array_length(regioes) = 0 then erros := erros || '{"disponibilidade.regioes": "Marque pelo menos uma região"}';
  elsif exists (select 1 from jsonb_array_elements_text(regioes) x where not (cfg -> 'regioesDiarista') ? x) then erros := erros || '{"disponibilidade.regioes": "Região inválida"}'; end if;
  if coalesce(p_dados ->> 'identidade', '') not in ('rg', 'cnh') then erros := erros || '{"identidade": "Escolha RG ou CNH"}'; end if;
  if (p_dados -> 'aceiteTermos') is distinct from 'true'::jsonb then erros := erros || '{"aceiteTermos": "É preciso aceitar os termos"}'; end if;
  if erros <> '{}' then perform privado.erro('DADOS_INVALIDOS', (select v #>> '{}' from jsonb_each(erros) y(k, v) limit 1), erros); end if;
  conteudo := jsonb_build_object('id', did, 'nome', v_nome, 'cpf', v_cpf, 'telefone', v_tel, 'email', v_email, 'dataNascimento', p_dados ->> 'dataNascimento', 'endereco', end_e, 'experienciaAnos', (p_dados ->> 'experienciaAnos')::int,
    'disponibilidade', jsonb_build_object('dias', dias, 'turnos', turnos, 'regioes', regioes), 'identidade', p_dados ->> 'identidade');
  r := privado.idem_ler('cadastrarDiarista', s, p_chave, conteudo);
  if r is not null then return r; end if;
  perform set_config('app.ator', s ->> 'ator', true);
  d := privado.rascunho_da_sessao(s, did);
  if d.status <> 'rascunho' then perform privado.erro('DADOS_INVALIDOS', 'Este cadastro já foi enviado'); end if;
  exigidos := case when p_dados ->> 'identidade' = 'cnh' then array['cnh_frente', 'cnh_verso'] else array['rg_frente', 'rg_verso', 'cpf'] end || array['comprovante_residencia', 'foto_perfil', 'antecedentes'];
  select coalesce(array_agg(x.tipo), '{}') into presentes from public.documentos x where x.diarista_id = d.id and x.excluido_em is null;
  select coalesce(array_agg(t), '{}') into faltando from unnest(exigidos) t where not (t = any(presentes));
  if array_length(faltando, 1) > 0 then perform privado.erro('DADOS_INVALIDOS', 'Faltam documentos obrigatórios', jsonb_build_object('documentos', to_jsonb(faltando))); end if;
  begin
    update public.diaristas set nome = v_nome, cpf = v_cpf, telefone = v_tel, email = v_email, data_nascimento = nasc, endereco = end_e, experiencia_anos = (p_dados ->> 'experienciaAnos')::int,
      disponibilidade = jsonb_build_object('dias', dias, 'turnos', turnos, 'regioes', regioes), identidade = p_dados ->> 'identidade', status = 'pendente', aceite_termos_em = now()
     where id = d.id returning * into d;
  exception when unique_violation then
    perform privado.erro('DADOS_INVALIDOS', 'Já existe cadastro com este CPF ou e-mail', '{"cpf": "Já cadastrado"}');
  end;
  update public.perfis set papel = 'diarista' where user_id = d.usuario_id and papel = 'cliente';
  perform privado.evento('diarista_cadastrada', jsonb_build_object('diaristaId', d.id));
  r := privado.j_diarista(d);
  perform privado.idem_gravar('cadastrarDiarista', s, p_chave, conteudo, r);
  return r;
end $$;

