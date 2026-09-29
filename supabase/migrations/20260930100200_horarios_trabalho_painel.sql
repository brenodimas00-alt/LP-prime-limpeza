-- Agendamento v2: horários de trabalho editáveis no painel (só prime_admin). Grava uma versão nova da tabela vigente
-- (mesma história da tabela de preços: vale pras solicitações feitas depois de salvar). Validação: dias de 0 (domingo) a
-- 6 (sábado), sem repetir e pelo menos um; primeiro início e fim do expediente em HH:MM com pelo menos 2h entre eles
-- (a menor diária); intervalo entre opções de 15, 30 ou 60 minutos.
create or replace function public.editar_horarios_trabalho(p_dados jsonb, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; t jsonb; ht jsonb; conteudo jsonb := jsonb_build_object('horarios', p_dados);
        ini text := p_dados ->> 'primeiroInicio'; fim text := p_dados ->> 'fimExpediente';
begin
  perform privado.exigir_prime(s);
  if not privado.eh_prime_admin() then perform privado.erro('ATOR_SEM_PERMISSAO', 'Só a administração da Prime muda os horários'); end if;
  r := privado.idem_ler('editarHorariosTrabalho', s, p_chave, conteudo);
  if r is not null then return r; end if;
  if jsonb_typeof(p_dados -> 'dias') is distinct from 'array' or jsonb_array_length(p_dados -> 'dias') = 0
     or exists (select 1 from jsonb_array_elements(p_dados -> 'dias') d where not privado.eh_inteiro(d) or (d #>> '{}')::int not between 0 and 6)
     or (select count(distinct d) from jsonb_array_elements(p_dados -> 'dias') d) <> jsonb_array_length(p_dados -> 'dias') then
    perform privado.erro('DADOS_INVALIDOS', 'Marque pelo menos um dia da semana', '{"dias": "Marque pelo menos um dia"}');
  end if;
  if coalesce(ini, '') !~ '^([01]\d|2[0-3]):[0-5]\d$' or coalesce(fim, '') !~ '^([01]\d|2[0-3]):[0-5]\d$' or privado.min_hm(fim) - privado.min_hm(ini) < 120 then
    perform privado.erro('DADOS_INVALIDOS', 'O fim do expediente precisa ser pelo menos 2 horas depois do primeiro início', '{"fimExpediente": "Pelo menos 2 horas depois do primeiro início"}');
  end if;
  if not privado.eh_inteiro(p_dados -> 'intervaloMinutos') or (p_dados ->> 'intervaloMinutos')::int not in (15, 30, 60) then
    perform privado.erro('DADOS_INVALIDOS', 'Intervalo entre opções: 15, 30 ou 60 minutos', '{"intervaloMinutos": "15, 30 ou 60 minutos"}');
  end if;
  perform pg_advisory_xact_lock(hashtext('editar_precos'));
  select tabela into t from public.precos where vigente_desde <= now() order by vigente_desde desc, id desc limit 1;
  ht := jsonb_build_object('dias', (select jsonb_agg((d #>> '{}')::int order by (d #>> '{}')::int) from jsonb_array_elements(p_dados -> 'dias') d),
    'primeiroInicio', ini, 'fimExpediente', fim, 'intervaloMinutos', (p_dados ->> 'intervaloMinutos')::int);
  insert into public.precos (vigente_desde, tabela, criado_por) values (now(), t || jsonb_build_object('horariosTrabalho', ht), auth.uid());
  r := jsonb_build_object('horariosTrabalho', ht);
  perform privado.idem_gravar('editarHorariosTrabalho', s, p_chave, conteudo, r);
  return r;
end $$;
revoke execute on function public.editar_horarios_trabalho(jsonb, text) from public, anon;
grant execute on function public.editar_horarios_trabalho(jsonb, text) to authenticated, service_role;
