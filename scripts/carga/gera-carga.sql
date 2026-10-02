-- Teste de VOLUME (30/09): dados SINTÉTICOS no projeto prime-carga, no tamanho de ~2 anos de operação.
-- 5.000 clientes, 30.000 pedidos (~45 mil diárias e cobranças), 40 profissionais, avaliações, ocorrências, eventos,
-- execuções de automação com mensagens, notificações (B5) e acessos. Nada aqui é dado real. Rodado por scripts/carga/carga.mjs.
-- Semente fixa: rodar de novo num banco limpo dá o mesmo volume. Recusa se já houver dados de carga.
do $$ begin
  if exists (select 1 from public.clientes where importacao ->> 'carga' = 'sim') then raise exception 'já há dados de carga'; end if;
end $$;
select set_config('app.ator', 'carga', false);
select setseed(0.30);

-- profissionais: 35 aprovadas, 3 pendentes, 2 reprovadas
insert into public.diaristas (nome, cpf, telefone, email, data_nascimento, identidade, status, aceite_termos_em, experiencia_anos, disponibilidade, origem, criado_em)
select format('Profissional Carga %s', g), '7' || lpad(g::text, 10, '0'), '319' || lpad((50000000 + g)::text, 8, '0'), format('prof%s@carga.example', g),
       date '1975-01-01' + (g * 97 % 9000), case when g % 2 = 0 then 'rg' else 'cnh' end,
       case when g <= 35 then 'aprovada' when g <= 38 then 'pendente' else 'reprovada' end, now() - interval '700 days', g % 20,
       jsonb_build_object('dias', '[1,2,3,4,5,6]'::jsonb, 'turnos', '["integral"]'::jsonb, 'regioes', jsonb_build_array((array['BH - Centro-Sul','BH - Pampulha','BH - Oeste','Contagem','Betim'])[1 + g % 5])),
       'site', now() - interval '720 days' + (g || ' days')::interval
from generate_series(1, 40) g;

-- clientes: 60% base importada, 40% site; 10% empresa
insert into public.clientes (tipo, nome, telefone, email, tipo_documento, documento, razao_social, endereco, data_nascimento, origem, pendencias, importacao, criado_em)
select case when g % 10 = 0 then 'empresa' else 'residencial' end,
       format('%s %s %s', (array['Ana','Bruna','Carla','Daniela','Eduarda','Fernanda','Gabriela','Helena','Isabela','Juliana','Karina','Larissa','Mariana','Natália','Olívia','Paula','Renata','Sabrina','Tatiana','Vanessa'])[1 + g % 20],
              (array['Silva','Souza','Oliveira','Santos','Lima','Pereira','Costa','Almeida','Ferreira','Rodrigues','Gomes','Martins','Araújo','Barbosa','Ribeiro'])[1 + (g / 20) % 15], g),
       '319' || lpad((10000000 + g)::text, 8, '0'), format('cliente%s@carga.example', g),
       case when g % 10 = 0 then 'cnpj' else 'cpf' end,
       case when g % 10 = 0 then '8' || lpad(g::text, 13, '0') else '9' || lpad(g::text, 10, '0') end,
       case when g % 10 = 0 then format('Empresa Carga %s Ltda', g) end,
       jsonb_build_object('cep', '30130010', 'logradouro', format('Rua Sintética %s', g % 700), 'numero', (g % 900)::text, 'complemento', '',
         'bairro', (array['Savassi','Funcionários','Lourdes','Buritis','Pampulha','Centro','Sion','Anchieta','Eldorado','Cidade Nova'])[1 + g % 10],
         'cidade', (array['Belo Horizonte','Belo Horizonte','Belo Horizonte','Belo Horizonte','Contagem','Betim','Nova Lima','Sabará'])[1 + g % 8], 'uf', 'MG'),
       case when g % 10 <> 0 then date '1960-01-01' + (g * 37 % 15000) end,
       case when g % 5 < 3 then 'importado' else 'site' end,
       case when g % 37 = 0 then array['sem_email'] else '{}'::text[] end,
       '{"carga": "sim"}'::jsonb,
       now() - interval '730 days' + (g * 730 / 5000 || ' days')::interval
from generate_series(1, 5000) g;

-- pedidos: 30.000 criados ao longo de 24 meses (as diárias dos recentes caem nas próximas semanas); 70% avulso, 20% semanal (4), 10% quinzenal (2)
-- cliente sorteada com viés (as primeiras voltam mais: recorrentes)
create temp table _cli as select row_number() over (order by id) - 1 n, id from public.clientes where importacao ->> 'carga' = 'sim';
create temp table _ped as
select g, least(4999, floor(power(random(), 1.6) * 5000))::int idx, null::uuid cliente_id,
       now() - interval '730 days' + (g * 730.0 / 30000 || ' days')::interval criado,
       case when g % 10 < 7 then 'avulso' when g % 10 < 9 then 'semanal' else 'quinzenal' end freq,
       (array['residencial','residencial','residencial','residencial','empresarial','condominial','pre_pos_mudanca','passadoria'])[1 + g % 8] servico,
       (array[4,4,6,8,2,6,4,8])[1 + g % 8] horas,
       random() r
from generate_series(1, 30000) g;
update _ped p set cliente_id = c.id from _cli c where c.n = p.idx;

insert into public.pedidos (cliente_id, pacote, status, total_centavos, endereco, recusa, ficticio, criado_em, atualizado_em)
select p.cliente_id,
       jsonb_build_object('tipoServico', p.servico, 'duracaoHoras', p.horas, 'frequencia', p.freq, 'modoPagamento', 'por_diaria',
         'quantidadeDiarias', case p.freq when 'avulso' then 1 when 'semanal' then 4 else 2 end, 'metragem', 30 + p.g % 100, 'semLocalAlmoco', false,
         'valorDiaBaseCentavos', 17500, 'totalCentavos', 17500 * case p.freq when 'avulso' then 1 when 'semanal' then 4 else 2 end, 'carga', true),
       case when p.criado > now() - interval '3 days' then (array['solicitado','disponibilidade_confirmada','aguardando_pagamento'])[1 + p.g % 3]
            when p.criado > now() - interval '45 days' and p.r < 0.6 then 'confirmado'
            when p.r < 0.05 then 'recusado' when p.r < 0.12 then 'cancelado' else 'concluido' end,
       17500 * case p.freq when 'avulso' then 1 when 'semanal' then 4 else 2 end,
       (select c.endereco from public.clientes c where c.id = p.cliente_id),
       case when p.r < 0.05 and p.criado <= now() - interval '3 days' then jsonb_build_object('motivo', (array['sem_disponibilidade','regiao','outro'])[1 + p.g % 3]) end,
       false, p.criado, p.criado
from _ped p;

-- diárias: uma por data do pedido, a partir de ~7 dias depois de criado
insert into public.atendimentos (pedido_id, sequencia, data, hora_inicio, duracao_minutos, diarista_id, valor_dia_centavos, status, criado_em)
select pe.id, s, (pe.criado_em + interval '7 days' + ((s - 1) * case pe.pacote ->> 'frequencia' when 'semanal' then 7 else 14 end || ' days')::interval)::date,
       -- começa de 08:00 em diante, de 30 em 30 min, terminando até 18:30
       time '08:00' + (((s + extract(doy from pe.criado_em)::int) % ((630 - (pe.pacote ->> 'duracaoHoras')::int * 60) / 30 + 1)) * 30 || ' minutes')::interval,
       (pe.pacote ->> 'duracaoHoras')::int * 60,
       -- 10% das diárias futuras confirmadas ainda sem profissional (aba Atribuir)
       case when pe.status = 'confirmado' and random() < 0.10
                 and (pe.criado_em + interval '7 days' + ((s - 1) * case pe.pacote ->> 'frequencia' when 'semanal' then 7 else 14 end || ' days')::interval)::date >= current_date then null
            when pe.status in ('confirmado','concluido','cancelado') then (select d.id from public.diaristas d where d.status = 'aprovada' order by d.id offset (abs(hashtext(pe.id::text || s)) % 35) limit 1) end,
       17500,
       -- a data da diária decide: pedido confirmado com diária já passada = finalizada
       case when pe.status = 'concluido' or (pe.status = 'confirmado' and (pe.criado_em + interval '7 days' + ((s - 1) * case pe.pacote ->> 'frequencia' when 'semanal' then 7 else 14 end || ' days')::interval)::date < current_date)
              then (case when random() < 0.45 then 'avaliado' else 'finalizado' end)
            when pe.status in ('cancelado', 'recusado') then 'cancelado' when pe.status = 'confirmado' then 'confirmado' else 'agendado' end,
       pe.criado_em
from public.pedidos pe cross join lateral generate_series(1, (pe.pacote ->> 'quantidadeDiarias')::int) s
where pe.pacote ->> 'carga' = 'true';

-- cobranças: uma por diária (pagamento antecipado e integral)
insert into public.pagamentos (pedido_id, atendimento_id, parcela, valor_centavos, metodo, pix_txid, status, vence_em, vence_as, confirmado_em, criado_em)
select a.pedido_id, a.id, 'diaria', 17500, 'pix', left(replace(a.id::text, '-', ''), 25),
       case when a.status in ('finalizado','avaliado') then 'confirmado' when a.status = 'confirmado' then 'confirmado'
            when a.status = 'cancelado' then 'cancelado' else 'pendente' end,
       a.data - 1, '14:00',
       case when a.status in ('finalizado','avaliado','confirmado') then a.data - 2 + time '10:00' end,
       a.criado_em
from public.atendimentos a join public.pedidos p on p.id = a.pedido_id
where p.pacote ->> 'carga' = 'true' and p.status not in ('solicitado', 'recusado');

insert into public.avaliacoes (atendimento_id, notas, nota_final, criado_em)
select a.id, jsonb_build_object('pontualidade', 4 + n % 2, 'qualidade', 4 + n % 2, 'cuidado', 5, 'comunicacao', 4 + n % 2),
       privado.nota_final(jsonb_build_object('pontualidade', 4 + n % 2, 'qualidade', 4 + n % 2, 'cuidado', 5, 'comunicacao', 4 + n % 2)), a.data + 1
from (select a.*, row_number() over () n from public.atendimentos a join public.pedidos p on p.id = a.pedido_id where p.pacote ->> 'carga' = 'true' and a.status = 'avaliado') a;

insert into public.ocorrencias (atendimento_id, cliente_id, tipo, descricao, estado, criado_em)
select a.id, p.cliente_id, (array['dano','item_nao_feito','atraso','comportamento','outro'])[1 + n % 5], 'Relato sintético do teste de volume', (array['aberto','em_analise','resolvido','resolvido'])[1 + n % 4], a.data + 1
from (select a.*, row_number() over () n from public.atendimentos a where a.status = 'avaliado' order by a.id limit 350) a join public.pedidos p on p.id = a.pedido_id;

-- eventos de negócio (outbox) já processados: ~4 por pedido
insert into public.eventos (tipo, refs, dados, status, processado_em, criado_em)
select (array['pedido_criado','disponibilidade_confirmada','pagamento_confirmado','atendimento_finalizado'])[k],
       jsonb_build_object('pedidoId', p.id, 'clienteId', p.cliente_id), '{}'::jsonb, 'processado', p.criado_em + (k || ' hours')::interval, p.criado_em + (k || ' hours')::interval
from public.pedidos p cross join generate_series(1, 4) k where p.pacote ->> 'carga' = 'true';

-- execuções de automação (passado: enviadas/entregues/lidas; algumas canceladas/ignoradas) e mensagens
insert into public.automacao_execucoes (regra, template_codigo, regra_versao, entidade_tipo, entidade_id, marco, chave_idempotencia, destinatario, titular_tipo, titular_id,
  categoria, agendada_para, valida_ate, estado, motivo, tentativas, contexto, criado_em, atualizado_em)
select r.regra, r.template, 1, 'pedido', p.id::text, r.regra, format('%s:pedido:%s:carga', r.regra, p.id), jsonb_build_object('tipo', 'cliente', 'id', p.cliente_id),
       'cliente', p.cliente_id, r.categoria, p.criado_em + r.atraso, p.criado_em + r.atraso + interval '1 day',
       case when random() < 0.06 then 'cancelada' when random() < 0.03 then 'ignorada' when random() < 0.5 then 'lida' else 'entregue' end,
       null, 1, jsonb_build_object('pedidoId', p.id, 'clienteId', p.cliente_id), p.criado_em + r.atraso, p.criado_em + r.atraso
from public.pedidos p
cross join (values ('C01', 'solicitacao_recebida', 'atendimento', interval '1 minute'), ('C02', 'disponibilidade_confirmada', 'atendimento', interval '2 hours'),
                   ('C05', 'pagamento_confirmado', 'atendimento', interval '1 day'), ('I01', 'nova_solicitacao', 'interno', interval '1 minute')) r(regra, template, categoria, atraso)
where p.pacote ->> 'carga' = 'true' and p.criado_em < now() - interval '2 days';

insert into public.mensagens (execucao_id, canal, destino, conteudo, template_codigo, template_versao, provedor, estado, entregue_em, criado_em, atualizado_em)
select e.id, case when e.categoria = 'interno' then 'painel' else 'whatsapp' end, '3199****0000', 'Mensagem sintética do teste de volume.', e.template_codigo, 1, 'simulado',
       e.estado, e.agendada_para + interval '5 seconds', e.agendada_para, e.agendada_para
from public.automacao_execucoes e where e.chave_idempotencia like '%:carga' and e.estado in ('entregue', 'lida');

-- notificações do B5 (legado, ainda listadas no painel)
insert into public.notificacoes (gatilho, canal, destinatario, template, variaveis, agendada_para, status, provedor, refs, chave_idempotencia, previa, enviada_em, criado_em)
select 'lembrete_vespera', 'whatsapp', jsonb_build_object('tipo', 'cliente', 'id', p.cliente_id), 'lembrete_vespera', '{}'::jsonb, a.data - 1 + time '18:00', 'simulada', 'simulado',
       jsonb_build_object('pedidoId', p.id, 'atendimentoId', a.id), format('carga:vespera:%s', a.id), 'Lembrete sintético', a.data - 1 + time '18:00', a.data - 1 + time '18:00'
from public.atendimentos a join public.pedidos p on p.id = a.pedido_id where p.pacote ->> 'carga' = 'true' and a.status in ('finalizado','avaliado');

-- acessos (log de login): ~8 por cliente com e-mail
insert into public.acessos (email, identificador, tipo_identificador, resultado, motivo, ip, dispositivo, em, finalizado_em)
select c.email, c.email, 'email', case when k % 5 = 0 then 'falha' else 'sucesso' end, case when k % 5 = 0 then 'senha incorreta' end,
       ('198.51.100.' || (1 + (k * 7) % 250))::inet, 'Mozilla/5.0 (carga)', c.criado_em + (k * 60 || ' days')::interval, c.criado_em + (k * 60 || ' days')::interval
from public.clientes c cross join generate_series(1, 8) k where c.importacao ->> 'carga' = 'sim' and c.criado_em + (k * 60 || ' days')::interval < now();

analyze;
