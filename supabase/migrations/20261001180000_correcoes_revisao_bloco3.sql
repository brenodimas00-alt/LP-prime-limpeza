-- Bloco 3, revisão do GPT (29/09):
-- 1) conta_unificar sem levar a senha: a conta de cliente com a senha padrão (6 dígitos) ganharia papel da equipe. Recusa.
-- 2) registrar_erro: a página também passa pela limpeza (caminho com e-mail ou número não fica guardado).
-- 3) e 4): abaixo.
create or replace function public.conta_unificar(p_origem uuid, p_destino uuid, p_levar_senha boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.perfis; d public.perfis; v_papeis text[];
begin
  if p_origem = p_destino then perform privado.erro('DADOS_INVALIDOS', 'Origem e destino são a mesma conta.'); end if;
  select * into o from public.perfis where user_id = p_origem for update;
  select * into d from public.perfis where user_id = p_destino for update;
  if o.user_id is null or d.user_id is null then perform privado.erro('NAO_ENCONTRADO', 'Conta não encontrada.'); end if;
  if d.bloqueado then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'A conta de destino está bloqueada.'); end if;
  if o.bloqueado and o.bloqueado_motivo = 'unificada em outra conta' then
    return jsonb_build_object('jaUnificada', true, 'papeis', to_jsonb(d.papeis));
  end if;
  if o.bloqueado then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'A conta de origem está bloqueada.'); end if;
  if exists (select 1 from public.clientes where usuario_id = p_origem) or exists (select 1 from public.diaristas where usuario_id = p_origem) then
    perform privado.erro('CONDICAO_NAO_ATENDIDA', 'A conta de origem tem cadastro de cliente ou profissional; unificar só leva papéis da equipe.');
  end if;
  -- revisão do GPT: a conta de cliente com a senha padrão (6 dígitos do documento) não pode virar conta da equipe
  if not p_levar_senha and not d.senha_propria then
    perform privado.erro('CONDICAO_NAO_ATENDIDA', 'A conta de destino ainda usa a senha padrão; leve a senha da equipe ou peça pra ela criar a própria antes.');
  end if;
  if privado.troca_senha_pendente(p_origem) and p_levar_senha then
    perform privado.erro('CONDICAO_NAO_ATENDIDA', 'A origem ainda está com a senha temporária; não dá pra levar.');
  end if;
  v_papeis := array(select distinct x from unnest(d.papeis || o.papeis) x);
  perform set_config('app.ator', 'servico:unificar_contas', true);
  update public.perfis set papeis = v_papeis, senha_propria = senha_propria or p_levar_senha or o.papel <> 'cliente' where user_id = p_destino;
  if p_levar_senha then
    update auth.users set encrypted_password = (select u.encrypted_password from auth.users u where u.id = p_origem), updated_at = now() where id = p_destino;
  end if;
  -- a origem deixa de ser da equipe (desbloquear por engano não cria uma segunda admin); o papel antigo fica na auditoria
  update public.perfis set papeis = array['cliente'], bloqueado = true, bloqueado_em = now(), bloqueado_motivo = 'unificada em outra conta' where user_id = p_origem;
  delete from auth.sessions where user_id = p_origem; -- sessões abertas da origem caem (o hook já nega renovar bloqueada)
  insert into public.auditoria (tabela, registro_id, operacao, ator_user_id, ator_papel, ator_contexto, antes, depois)
  values ('auth.users', p_destino, 'UPDATE', null, null, 'servico:unificar_contas',
          jsonb_build_object('papeis', to_jsonb(d.papeis)),
          jsonb_build_object('papeis', to_jsonb(v_papeis), 'origem', p_origem, 'levouSenha', p_levar_senha));
  return jsonb_build_object('jaUnificada', false, 'papeis', to_jsonb(v_papeis));
end $$;
revoke execute on function public.conta_unificar(uuid, uuid, boolean) from public, anon, authenticated;

create or replace function privado.registrar_erro(p_origem text, p_mensagem text, p_pagina text) returns void
language plpgsql security definer set search_path = '' as $$
declare o text := left(regexp_replace(coalesce(p_origem, 'desconhecida'), '[^a-z0-9:_ -]', '', 'gi'), 60);
        m text := privado.limpar_erro(p_mensagem); pg text := left(privado.limpar_erro(regexp_replace(coalesce(p_pagina, ''), '[?#].*$', '')), 120);
        a text; e public.erros;
begin
  if m = '' then return; end if;
  a := md5(o || '|' || m || '|' || pg);
  insert into public.erros as x (assinatura, origem, mensagem, pagina) values (a, o, m, nullif(pg, ''))
  on conflict (assinatura) do update set contagem = x.contagem + 1, ultimo_em = now()
  returning * into e;
  -- erro novo, ou que voltou depois de 24 h sem aviso: I10 pra equipe (uma vez por janela)
  if e.avisado_em is null or e.avisado_em < now() - interval '24 hours' then
    update public.erros set avisado_em = now() where assinatura = a;
    perform privado.evento('erro_sistema', jsonb_build_object('erroId', a), jsonb_build_object('origem', o, 'erro', m));
  end if;
end $$;


-- 3) Repasse: hora extra de diária não finalizada não entra; fechar espera a janela de registro e as pendentes;
--    aprovar hora extra de mês já fechado é recusado (o valor não entraria em mês nenhum).
create or replace function privado.calcular_repasse(p_mes date, r jsonb) returns jsonb
language sql stable set search_path = '' as $$
  with base as (
    select a.diarista_id, count(*)::int diarias, sum(a.duracao_minutos) / 60.0 horas,
           sum(a.valor_dia_centavos) valor_dias,
           sum(case r ->> 'tipo' when 'por_carga' then coalesce((r #>> array['valores', (a.duracao_minutos / 60)::text])::bigint, 0) else 0 end) valor_carga
      from public.atendimentos a
     where a.diarista_id is not null and a.status in ('finalizado', 'avaliado') and a.data >= p_mes and a.data < (p_mes + interval '1 month')::date
     group by a.diarista_id),
  extras as (
    select a.diarista_id, sum(h.horas)::int horas from public.horas_extras h join public.atendimentos a on a.id = h.atendimento_id
     where h.status = 'aprovada' and a.status in ('finalizado', 'avaliado') and a.data >= p_mes and a.data < (p_mes + interval '1 month')::date group by a.diarista_id)
  select coalesce(jsonb_agg(jsonb_build_object('diaristaId', d.id, 'nome', d.nome, 'diarias', b.diarias, 'horas', round(b.horas, 1),
      'horasExtras', coalesce(e.horas, 0),
      'valorCentavos', case r ->> 'tipo'
        when 'percentual' then round((b.valor_dias + coalesce(e.horas, 0) * (select (privado.cfg() #>> '{PRECOS,horaExtraCentavos}')::bigint)) * (r ->> 'percentual')::numeric / 100)::bigint
        else b.valor_carga + coalesce(e.horas, 0) * (r ->> 'horaExtraCentavos')::bigint end) order by d.nome), '[]')
    from base b join public.diaristas d on d.id = b.diarista_id left join extras e on e.diarista_id = b.diarista_id
$$;

/** Fecha um mês que já acabou: grava e trava. Idempotente pela chave; fechar de novo recusa. */
create or replace function public.fechar_repasse(p_mes date, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; m date := date_trunc('month', p_mes)::date; regra jsonb; l jsonb; conteudo jsonb := jsonb_build_object('mes', m);
begin
  perform privado.exigir_admin_repasse(s);
  r := privado.idem_ler('fecharRepasse', s, p_chave, conteudo);
  if r is not null then return r; end if;
  perform pg_advisory_xact_lock(hashtext('repasse:' || m));
  if m >= date_trunc('month', privado.hoje_sp())::date then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Só dá pra fechar um mês que já terminou'); end if;
  if exists (select 1 from public.repasses_fechamentos where mes = m) then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Este mês já foi fechado'); end if;
  -- revisão do GPT: hora extra se registra até 2 dias depois da diária; fechar antes disso (ou com alguma esperando a Prime) perderia o valor
  if privado.hoje_sp() <= (m + interval '1 month')::date + 2 then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Espere até o dia 3: a profissional ainda pode registrar hora extra do fim do mês'); end if;
  if exists (select 1 from public.horas_extras h join public.atendimentos a on a.id = h.atendimento_id where h.status = 'registrada' and a.data >= m and a.data < (m + interval '1 month')::date) then
    perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Há hora extra do mês esperando aprovação (Pagamentos)'); end if;
  regra := (select c.valor from public.configuracao c where c.chave = 'repasse');
  if not privado.regra_repasse_valida(regra) then perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Defina a regra do repasse antes de fechar'); end if;
  perform set_config('app.ator', 'prime', true);
  insert into public.repasses_fechamentos (mes, regra, fechado_por) values (m, regra, auth.uid());
  for l in select * from jsonb_array_elements(privado.calcular_repasse(m, regra)) loop
    insert into public.repasses (mes, diarista_id, diarias, horas, horas_extras, valor_centavos)
    values (m, (l ->> 'diaristaId')::uuid, (l ->> 'diarias')::int, (l ->> 'horas')::numeric, (l ->> 'horasExtras')::int, (l ->> 'valorCentavos')::bigint);
  end loop;
  r := public.repasse_mes(m);
  perform privado.idem_gravar('fecharRepasse', s, p_chave, conteudo, r);
  return r;
end $$;

create or replace function privado.hora_extra_mes_fechado() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'aprovada' and old.status is distinct from 'aprovada' and exists (select 1 from public.atendimentos a join public.repasses_fechamentos f
       on f.mes = date_trunc('month', a.data)::date where a.id = new.atendimento_id) then
    perform privado.erro('CONDICAO_NAO_ATENDIDA', 'O repasse deste mês já foi fechado: a hora extra não pode mais ser aprovada. Fale com a administração.');
  end if;
  return new;
end $$;
create trigger hora_extra_mes_fechado before update on public.horas_extras for each row execute function privado.hora_extra_mes_fechado();

-- 4) Localização x revogação do consentimento: a mesma trava por profissional nos dois lados (quem revoga espera a
--    gravação em curso terminar e apaga depois; quem grava depois da revogação já lê o consentimento retirado).
create or replace function privado.localizacao_revogada() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.tipo = 'localizacao_profissional' and not new.concedido then
    perform pg_advisory_xact_lock(hashtext('localizacao:' || new.titular_id));
    delete from public.localizacoes_atendimento where diarista_id = new.titular_id;
  end if;
  return new;
end $$;
/** Profissional da diária, com consentimento ATUAL: grava arredondado (3 casas, ~100 m). Repetir não duplica. */
create or replace function public.registrar_localizacao(p_atendimento uuid, p_dados jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); a public.atendimentos; lat numeric; lon numeric; prec int; ev text := p_dados ->> 'evento';
begin
  if s ->> 'ator' <> 'diarista' then perform privado.erro('ATOR_SEM_PERMISSAO', 'Só a profissional da diária'); end if;
  if not privado.flag('p4_localizacao') then return jsonb_build_object('gravada', false, 'motivo', 'desligada'); end if;
  perform pg_advisory_xact_lock(hashtext('localizacao:' || (s ->> 'id')));
  if coalesce((privado.consentimentos_atuais('diarista', (s ->> 'id')::uuid) ->> 'localizacao_profissional')::boolean, false) is not true then
    return jsonb_build_object('gravada', false, 'motivo', 'sem_consentimento');
  end if;
  if ev not in ('sair_a_caminho', 'iniciar', 'finalizar') then perform privado.erro('DADOS_INVALIDOS', 'Evento inválido'); end if;
  begin lat := round((p_dados ->> 'lat')::numeric, 3); lon := round((p_dados ->> 'lon')::numeric, 3); prec := least(greatest(round((p_dados ->> 'precisao')::numeric), 0), 100000)::int;
  exception when others then perform privado.erro('DADOS_INVALIDOS', 'Localização inválida'); end;
  if lat is null or lon is null or lat not between -90 and 90 or lon not between -180 and 180 then perform privado.erro('DADOS_INVALIDOS', 'Localização inválida'); end if;
  select * into a from public.atendimentos where id = p_atendimento;
  if not found or a.diarista_id is distinct from (s ->> 'id')::uuid then perform privado.erro('NAO_ENCONTRADO', 'Diária não encontrada'); end if;
  -- só junto do próprio check-in: o evento já aconteceu na diária, há menos de 2 horas
  if not exists (select 1 from jsonb_array_elements(a.historico) h where h ->> 'evento' = ev and (h ->> 'em')::timestamptz > now() - interval '2 hours') then
    perform privado.erro('CONDICAO_NAO_ATENDIDA', 'Localização só junto do check-in');
  end if;
  insert into public.localizacoes_atendimento (atendimento_id, diarista_id, evento, lat, lon, precisao_m)
  values (a.id, a.diarista_id, ev, lat, lon, prec) on conflict (atendimento_id, evento) do nothing;
  return jsonb_build_object('gravada', true);
end $$;

