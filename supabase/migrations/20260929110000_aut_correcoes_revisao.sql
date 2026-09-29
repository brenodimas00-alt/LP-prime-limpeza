-- Bloco 2 (AUT), correções da revisão do GPT (29/09):
-- 1) Status do WhatsApp que chega ANTES de o worker gravar o id_externo ficava guardado em mensagem_status e nunca era
--    aplicado (as reentregas da Meta davam "repetido"). Agora, quando a mensagem ganha o id_externo, os status guardados
--    são aplicados no commit do worker (trigger adiada), e uma trava por id_externo fecha a corrida com o webhook.
-- 2) Um "failed" atrasado de uma mensagem ANTIGA (antes de um reenvio) marcava a execução atual como falhou. Agora o
--    status de uma mensagem só mexe na execução se ela for a mensagem vigente (a mais recente) daquela execução.

/** Aplica um status do provedor a uma mensagem já identificada. Idempotente (o estado só avança; failed à parte). */
create or replace function privado.aplicar_status(p_id_externo text, p_status text, p_em timestamptz, p_erro jsonb default null) returns text
language plpgsql security definer set search_path = '' as $$
declare m public.mensagens; ordem int; atual int; vigente boolean;
begin
  select * into m from public.mensagens where id_externo = p_id_externo for update;
  if not found then return 'desconhecido'; end if;
  vigente := not exists (select 1 from public.mensagens m2 where m2.execucao_id = m.execucao_id and m2.id <> m.id
                           and (m2.criado_em, m2.id) > (m.criado_em, m.id));
  ordem := case p_status when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 else 0 end;
  atual := case m.estado when 'enviada' then 1 when 'entregue' then 2 when 'lida' then 3 else 0 end;
  if p_status = 'failed' then
    if m.estado in ('entregue', 'lida') then return 'ignorado'; end if;
    update public.mensagens set estado = 'falhou', erro = coalesce(p_erro, '{}'), atualizado_em = now() where id = m.id;
    if not vigente then return 'falhou (mensagem anterior a um reenvio)'; end if;
    update public.automacao_execucoes set estado = 'falhou', motivo = 'o WhatsApp informou falha na entrega', atualizado_em = now()
     where id = m.execucao_id and estado in ('enviada', 'entregue');
    perform privado.evento('envio_falhou', jsonb_build_object('execucaoId', m.execucao_id), jsonb_build_object('regra', (select regra from public.automacao_execucoes where id = m.execucao_id),
      'cliente', 'destinatário', 'telefoneMascarado', privado.mascarar_destino('whatsapp', m.destino), 'erro', coalesce(p_erro ->> 'title', 'falha informada pelo WhatsApp')));
    return 'falhou';
  end if;
  if ordem <= atual then return 'sem mudança'; end if;
  update public.mensagens set estado = case ordem when 1 then 'enviada' when 2 then 'entregue' else 'lida' end,
    entregue_em = case when ordem >= 2 then coalesce(entregue_em, p_em) else entregue_em end, lida_em = case when ordem = 3 then p_em else lida_em end, atualizado_em = now()
   where id = m.id;
  if vigente then
    update public.automacao_execucoes set estado = case ordem when 2 then 'entregue' when 3 then 'lida' else estado end, atualizado_em = now()
     where id = m.execucao_id and estado in ('enviada', 'entregue') and ordem >= 2;
  end if;
  return 'atualizado';
end $$;
revoke execute on function privado.aplicar_status(text, text, timestamptz, jsonb) from public, anon, authenticated;

/** Status de uma mensagem (webhook). Guarda sempre; aplica se a mensagem já tem o id_externo. */
create or replace function public.webhook_status(p_id_externo text, p_status text, p_em timestamptz, p_erro jsonb default null) returns text
language plpgsql security definer set search_path = '' as $$
begin
  -- mesma trava do vínculo do id_externo: ou o worker já gravou (e aqui aplica), ou ele vai ler este status ao gravar
  perform pg_advisory_xact_lock(hashtext('prime-msg-status:' || p_id_externo));
  insert into public.mensagem_status (id_externo, status, em, erro) values (p_id_externo, p_status, p_em, p_erro) on conflict do nothing;
  if not found then return 'repetido'; end if;
  return privado.aplicar_status(p_id_externo, p_status, p_em, p_erro);
end $$;

/** No commit do worker (depois de a execução virar 'enviada'), aplica os status que chegaram antes do id_externo. */
create or replace function privado.aplicar_status_guardados() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s record;
begin
  perform pg_advisory_xact_lock(hashtext('prime-msg-status:' || new.id_externo));
  for s in select status, em, erro from public.mensagem_status where id_externo = new.id_externo order by em, status loop
    perform privado.aplicar_status(new.id_externo, s.status, s.em, s.erro);
  end loop;
  return null;
end $$;

drop trigger if exists mensagens_status_guardados on public.mensagens;
create constraint trigger mensagens_status_guardados after update of id_externo on public.mensagens
  deferrable initially deferred for each row
  when (old.id_externo is null and new.id_externo is not null)
  execute function privado.aplicar_status_guardados();
