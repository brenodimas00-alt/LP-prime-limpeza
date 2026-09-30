-- Corrida antiga do B7, pega pela testa-importacao (intermitente) em 29/09: duas chamadas simultâneas de "completar
-- e-mail" com e-mails diferentes; a segunda via a conta recém-criada da primeira (ainda sem vínculo) como órfã e a
-- apagava, e as duas respondiam sucesso. Agora: órfã com o MESMO e-mail continua reaproveitada (repetição segura);
-- órfã de outro e-mail criada há menos de 2 minutos = outra chamada em andamento, recusa; só a mais antiga é apagada.
create or replace function public.conta_completar_email_iniciar(p_ator uuid, p_cliente uuid, p_email text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(trim(p_email)); v_c public.clientes; v_marca text; v_mesmo uuid; v_orfas uuid[];
begin
  if not exists (select 1 from public.perfis where user_id = p_ator and not bloqueado and papel in ('prime_admin', 'prime_atendimento')) then
    raise exception 'ATOR_SEM_PERMISSAO' using errcode = 'P0001'; end if;
  select * into v_c from public.clientes where id = p_cliente;
  if not found then raise exception 'NAO_ENCONTRADO' using errcode = 'P0001'; end if;
  if v_c.origem <> 'importado' or v_c.usuario_id is not null or v_c.documento is null then raise exception 'CONDICAO_NAO_ATENDIDA' using errcode = 'P0001'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'DADOS_INVALIDOS' using errcode = 'P0001'; end if;
  v_marca := privado.marca_importacao(v_c.documento);
  select array_agg(u.id) into v_orfas from auth.users u where u.raw_app_meta_data ->> 'marca_importacao' = v_marca and not exists (select 1 from public.clientes c where c.usuario_id = u.id);
  select u.id into v_mesmo from auth.users u where lower(u.email) = v_email;
  if v_mesmo is not null and not (v_mesmo = any(coalesce(v_orfas, '{}'))) then raise exception 'EMAIL_EM_USO' using errcode = 'P0001'; end if;
  if exists (select 1 from public.clientes c where c.email = v_email and c.id <> p_cliente and c.usuario_id is not null) then raise exception 'EMAIL_EM_USO' using errcode = 'P0001'; end if;
  if exists (select 1 from auth.users u where u.id = any(coalesce(v_orfas, '{}')) and u.id is distinct from v_mesmo and u.created_at > now() - interval '2 minutes') then
    raise exception 'CONDICAO_NAO_ATENDIDA' using errcode = 'P0001', detail = 'Outra pessoa da Prime está criando o acesso deste cadastro agora. Confira em instantes.';
  end if;
  return jsonb_build_object('documento', v_c.documento, 'email', v_email, 'marca', v_marca, 'reaproveitar', v_mesmo,
    'apagar', (select coalesce(jsonb_agg(x), '[]') from unnest(coalesce(v_orfas, '{}')) x where x is distinct from v_mesmo));
end $$;
revoke execute on function public.conta_completar_email_iniciar(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.conta_completar_email_iniciar(uuid, uuid, text) to service_role;
