-- Agendamento v3, V6: a lista de motivos padronizados fica em privado (o trigger usa, inclusive no
-- cancelamento pela cliente) e a leitura pública passa a ser só da equipe Prime (achado da auditoria).
create or replace function privado.motivos_padrao() returns jsonb
language sql immutable set search_path = '' as $$
  select '{
    "recusa": [
      {"codigo": "sem_disponibilidade", "rotulo": "Sem disponibilidade na data ou no horário"},
      {"codigo": "fora_da_area", "rotulo": "Endereço fora da área atendida"},
      {"codigo": "servico_nao_realizado", "rotulo": "Serviço que a Prime não realiza"},
      {"codigo": "endereco_pacote", "rotulo": "Endereço novo no pacote não aprovado"},
      {"codigo": "dados_incompletos", "rotulo": "Dados incompletos ou sem retorno da cliente"},
      {"codigo": "outro", "rotulo": "Outro"}],
    "cancelamento": [
      {"codigo": "pedido_cliente", "rotulo": "Pedido da cliente"},
      {"codigo": "pagamento_nao_identificado", "rotulo": "Pagamento não identificado no prazo"},
      {"codigo": "sem_profissional", "rotulo": "Sem profissional disponível"},
      {"codigo": "imprevisto_local", "rotulo": "Imprevisto no local (sem água, sem energia)"},
      {"codigo": "outro", "rotulo": "Outro"}]
  }'::jsonb
$$;

create or replace function public.motivos_padrao() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform privado.exigir_prime(privado.ator());
  return privado.motivos_padrao();
end $$;
revoke all on function public.motivos_padrao() from public, anon;
grant execute on function public.motivos_padrao() to authenticated;

create or replace function privado.codigo_do_motivo() returns trigger
language plpgsql security definer set search_path = '' as $$
declare m jsonb;
begin
  if new.recusa is not null and old.recusa is null and not new.recusa ? 'codigo' then
    select x into m from jsonb_array_elements(privado.motivos_padrao() -> 'recusa') x where new.recusa ->> 'motivo' like (x ->> 'rotulo') || '%' order by length(x ->> 'rotulo') desc limit 1;
    if m is not null then new.recusa := new.recusa || jsonb_build_object('codigo', m ->> 'codigo'); end if;
  end if;
  if new.cancelamento is not null and old.cancelamento is null and not new.cancelamento ? 'codigo' then
    select x into m from jsonb_array_elements(privado.motivos_padrao() -> 'cancelamento') x where new.cancelamento ->> 'motivo' like (x ->> 'rotulo') || '%' order by length(x ->> 'rotulo') desc limit 1;
    if m is not null then new.cancelamento := new.cancelamento || jsonb_build_object('codigo', m ->> 'codigo'); end if;
  end if;
  return new;
end $$;
