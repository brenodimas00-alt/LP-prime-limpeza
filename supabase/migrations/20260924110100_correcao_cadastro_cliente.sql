-- Correção achada pelo testa-auth: conta_cadastrar_cliente revalidava DEPOIS de a function criar a conta no Auth e achava
-- o e-mail "em uso" pela própria conta recém-criada. A validação passa a ignorar o usuário que está sendo vinculado.
drop function if exists public.conta_cadastrar_cliente(uuid, jsonb);
drop function if exists public.conta_validar_cliente_novo(jsonb);

create or replace function public.conta_validar_cliente_novo(p_dados jsonb, p_proprio uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c jsonb := privado.normalizar_cliente(p_dados); nasc date; doc text; tipo_doc text;
begin
  if c ->> 'tipo' = 'residencial' then
    if coalesce(c ->> 'cpf', '') = '' then perform privado.erro('DADOS_INVALIDOS', 'Informe o CPF (os 6 primeiros números são a sua senha)', '{"cpf": "Informe o CPF"}'); end if;
    begin nasc := (p_dados ->> 'dataNascimento')::date; exception when others then nasc := null; end;
    if nasc is null or nasc < '1900-01-01' or nasc > privado.hoje_sp() or coalesce(p_dados ->> 'dataNascimento', '') !~ '^\d{4}-\d{2}-\d{2}$' then
      perform privado.erro('DADOS_INVALIDOS', 'Informe a data de nascimento', '{"dataNascimento": "Informe a data de nascimento"}'); end if;
    c := c || jsonb_build_object('dataNascimento', to_char(nasc, 'YYYY-MM-DD'));
  end if;
  tipo_doc := case when c ? 'cnpj' then 'cnpj' else 'cpf' end;
  doc := coalesce(c ->> 'cnpj', c ->> 'cpf');
  if exists (select 1 from public.clientes where tipo_documento = tipo_doc and documento = doc) then
    perform privado.erro('DOCUMENTO_EM_USO', 'Já existe cadastro com este ' || upper(tipo_doc) || '. Entre com CPF, e-mail ou celular.', jsonb_build_object(tipo_doc, 'Já cadastrado: entre na sua conta'));
  end if;
  if exists (select 1 from auth.users u where lower(u.email) = c ->> 'email' and u.id is distinct from p_proprio) then
    perform privado.erro('EMAIL_EM_USO', 'Já existe conta com este e-mail. Entre na sua conta.', '{"email": "Já existe conta com este e-mail"}');
  end if;
  return jsonb_build_object('cliente', c, 'tipoDocumento', tipo_doc, 'documento', doc);
end $$;

create or replace function public.conta_cadastrar_cliente(p_user uuid, p_dados jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v jsonb := public.conta_validar_cliente_novo(p_dados, p_user); c jsonb := v -> 'cliente'; v_id uuid;
begin
  perform set_config('app.ator', 'cliente', true);
  insert into public.clientes (usuario_id, tipo, nome, telefone, email, tipo_documento, documento, razao_social, responsavel, endereco, data_nascimento, origem, ficticio)
  values (p_user, c ->> 'tipo', c ->> 'nome', c ->> 'telefone', c ->> 'email', v ->> 'tipoDocumento', v ->> 'documento', c ->> 'razaoSocial', c ->> 'responsavel',
          c -> 'endereco', (c ->> 'dataNascimento')::date, 'site',
          coalesce((select (u.raw_user_meta_data ->> 'ficticio')::boolean from auth.users u where u.id = p_user), false))
  returning id into v_id;
  return v_id;
end $$;

revoke execute on function public.conta_validar_cliente_novo(jsonb, uuid), public.conta_cadastrar_cliente(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.conta_validar_cliente_novo(jsonb, uuid), public.conta_cadastrar_cliente(uuid, jsonb) to service_role;
