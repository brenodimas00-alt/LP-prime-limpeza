# Agenda e Escala

Fonte: `spec-agenda-escala-isa.md` (texto literal da cliente, 09/11/2026) e as 4 imagens na pasta `Prime_Limpeza/agenda-escala` do OneDrive. A tela substitui a Agenda do painel (P2), a "Escala do dia" e o "Designar profissional". Regras puras em `src/domain/escala.js`; o banco repete as mesmas em `supabase/migrations/20261109100000_agenda_escala.sql`; o mock em `src/app/casos-escala.js`.

## Dois eixos da diária
- `atendimento.status` continua igual: pagamento e execução (`agendado` → `confirmado` exige pagamento; `em_andamento`, `finalizado`...).
- `escala_estado` (novo): `para_revisar` → `revisada` → `aguardando_envio` → `enviada` → `aguardando_aceite` → `confirmada` (aceite da profissional). Não depende do pagamento (seção 7).
- A coluna Status da tela é `statusDaDiaria()`: Cancelada > Com ocorrência > Finalizada > Em andamento > estado da escala. "Em andamento" e "Finalizada" por horário (aceita e dentro/depois do horário) aparecem marcados como "pelo horário": não afirmam chegada nem conclusão.

## Transições (banco: trigger `privado.escala_transicao_valida`)
| evento | de | para | quem |
|---|---|---|---|
| revisar | para_revisar (com profissional) | revisada | equipe |
| enviar | revisada; aguardando_envio só com falha de envio | aguardando_envio | equipe |
| saiu (execução D10 `enviada`) | aguardando_envio | enviada | sistema |
| entregue (execução D10 `entregue`/`lida`) | aguardando_envio, enviada | aguardando_aceite | sistema |
| aceitar | aguardando_envio, enviada, aguardando_aceite | confirmada | sistema (webhook) ou equipe (registro manual) |
| recusar | aguardando_envio..confirmada | para_revisar, sem profissional, `escala_recusa` preenchida | sistema ou equipe |
| alterar (profissional, data, hora, duração, endereço, serviço) | qualquer | para_revisar, `escala_versao + 1` | equipe ou sistema |

Retorno do provedor nunca regride (`avancaEscala`). Resposta com versão diferente da atual é ignorada (callback atrasado não confirma a profissional substituída).

## Colunas novas
- `atendimentos`: `escala_estado text not null default 'para_revisar'`, `escala_versao int not null default 0`, `designacao_origem text` (`fixa|sugerida|manual`, null sem profissional), `escala_envio jsonb` (`{enviadaEm, canal, chave, versao, entregueEm, lidaEm, respondidaEm, resposta, falhou}`), `escala_recusa jsonb` (`{diaristaId, nome, em, canal, motivo}`), `escala_sugestao jsonb` (`{pontos, motivos[], criteriosSemDado[]}`), `escala_sem_auto boolean not null default false` (remoção manual ou recusa: a rotina não repõe ninguém).
- `clientes.parceria boolean not null default false` (coroa; só administração muda).
- `standby_decisoes` estendida: estados `reservada|confirmada|utilizada|liberada`, `hora_inicio`, `duracao_minutos`, `regiao`, `atendimento_id`, `decidir_ate timestamptz`, `historico jsonb`.
- `vinculos_fixos` (nova): `id, pedido_id, dia_semana 0-6, diarista_id, vigente_desde, encerrado_em, criado_por, encerrado_por, motivo`; um vigente por pedido e dia da semana; auditoria.
- `configuracao` chave `agenda_escala`: `{prazoSemRespostaMin: null, verificacaoPagamento: {ligada: false, hora: null}, standbyAlertaMin: 60, canalAtivo: 'whatsapp', historicoCanal: []}`.

## API (mesma forma no mock e no Supabase)
Todas exigem equipe Prime; as marcadas (admin) exigem `prime_admin`. Escritas com chave de idempotência.

- `agendaEscala({ de, ate })` → `agenda_escala(p_de, p_ate)`, máximo 31 dias: `{ de, ate, agora, config, itens, standby }`.
  - item: `{ id, pedidoId, numero, data, horaInicio, duracaoMinutos, status, escalaEstado, escalaVersao, escalaEnvio, escalaRecusa, escalaSugestao, designacaoOrigem, servico, modalidade, pacote, cliente: {id, nome, telefone, parceria}, local: {logradouro, numero, complemento, bairro, cidade, uf, cep}, imovel: {metragem, comodos, caes, gatos}, profissional: {id, nome, telefone, nota, habilidades} | null, pagamento: {estado: pago|pendente|a_faturar, forma}, ocorrenciaAberta, alertaFixa, vinculoFixo: {id, diaristaId, nome} | null, observacao, prioridades, historico }`. Inclui canceladas; não inclui solicitação nova nem recusada.
  - standby: `{ diaristaId, nome, nota, data, horaInicio, duracaoMinutos, regiao, estado, decidirAte, atendimentoId }` (reservada ou confirmada).
- `agendaContagens({ de, ate })` → `agenda_contagens(p_de, p_ate)`: `{ dias: [{ data, total }] }`.
- `escalaPreparar({ de, ate })` → `escala_preparar(p_de, p_ate)`: fixa nas diárias do pacote sem profissional; Sugerida pela pontuação nas outras (só `data >= hoje`, pedido aguardando pagamento ou confirmado, não cancelada, `escala_sem_auto = false`). Sem candidata: fica sem profissional (pendência). Não emite `atendimento_atribuido` (ninguém é avisado antes do envio). Idempotente. `{ fixas, sugeridas, semCandidata }`. pg_cron diário 06:00 (hoje a hoje + 7).
- `escalaCandidatas(atendimentoId)` → `escala_candidatas(p_atendimento)`: `{ atualId, origem, sugestao, criteriosSemDado, itens: [{ id, nome, nota, habilidades, regioes, impedida, pontos, motivos, atribuida }] }`.
- `escalaAlterar(atendimentoId, { diaristaId, escopo: 'so_esta'|'vinculo_futuro' }, { chave })` → `escala_alterar(p_id, p_dados, p_chave)`. `vinculo_futuro` (admin, só diária de pacote) troca o vínculo do dia da semana. Sobreposição ou bloqueio impedem. Já comunicada: evento `escala_alterada {anterior}` (D08 avisa a anterior).
- `escalaRemover(atendimentoId, { chave })` → `escala_remover(p_id, p_chave)`: sem profissional, `escala_sem_auto = true`; já comunicada: `escala_alterada {anterior, removida: true}`.
- `escalaRevisar(atendimentoId, versao, { chave })` → `escala_revisar(p_id, p_versao, p_chave)`: versão diferente = `DESATUALIZADA`.
- `escalaEnviar(ids, { chave })` → `escala_enviar(p_ids, p_chave)`: `{ enviadas: [id], ignoradas: [{ id, motivo }] }`. Só revisadas (ou com falha de envio). Nunca reenvia. Não olha pagamento. Evento `diaria_enviada {versao}` → regra D10.
- `escalaResponder(atendimentoId, { resposta: 'aceite'|'recusa', versao, motivo }, { chave })` → `escala_responder(p_id, p_dados, p_chave)` (registro manual da equipe, canal `telefone`).
- `escalaSolicitarConfirmacao(atendimentoId, { chave })` → evento `confirmacao_solicitada` → D11.
- Webhook: botão com payload `escala:<aceite|recusa>:<atendimentoId>:<versao>` → `webhook_resposta_escala(p_id_externo, p_telefone, p_payload, p_em)` (só service role): confere o telefone da profissional designada e a versão; deduplica pelo id externo.
- `standbyReservar({ diaristaId, data, horaInicio, duracaoMinutos, regiao }, { chave })`, `standbyUtilizar(diaristaId, data, atendimentoId, { chave })`, `standbyLiberar(diaristaId, data, motivo, { chave })`, `standbyConfirmar(diaristaId, data, { chave })`.
- `vinculosFixos(pedidoId)`, `salvarVinculoFixo(pedidoId, { diaSemana, diaristaId }, { chave })` (admin), `encerrarVinculoFixo(vinculoId, motivo, { chave })` (admin).
- `configAgenda()`, `salvarConfigAgenda(valor)` (admin), `definirCanalAtivo(canal, motivo)` (admin), `definirParceria(clienteId, parceria)` (admin).

## Pendências no Início (mesmo registro, `painel_pendencias_lista`)
`sem_profissional` (já existia), `recusa_profissional`, `sem_resposta` (só com prazo configurado), `falha_envio_escala`, `conflito_fixa`, `standby_decisao`, `pagamento_verificacao` (só com a verificação ligada; nunca cancela). Todas com `ref: { atendimentoId, data }`; o Início leva direto pra `?tela=agenda&data=<data>&diaria=<id>`.

## Fica pra fase 2
Portal de contingência com chat (10.4, 10.5): ver `docs/PENDENCIAS.md`.
