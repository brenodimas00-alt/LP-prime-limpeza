// E1: automações. Fila de eventos -> gatilhos -> notificações, com relógio simulado. node scripts/testa-automacoes.mjs
import { criarSuite, assert } from './lib-teste.mjs';
import { montarAmbiente } from './ambiente.mjs';
import { AGORA_TESTE, criarAvulso, criarDiaristaAprovada, liberarCobranca, chave } from './cenarios.mjs';
import { CLIENTE_EMPRESA } from './fixtures/seed.js';
import { GATILHOS, calcularEnvio } from '../src/automacoes/gatilhos.js';
import { MENSAGENS, renderizar } from '../src/automacoes/mensagens.js';
import { CONFIG_PRECOS } from '../src/config/precos.js';

const t = criarSuite('automações (E1)');
const PRIME = { ator: 'prime' };
const REGRAS = CONFIG_PRECOS.regrasNotificacao;

/** Disponibilidade confirmada e todas as cobranças pagas (confirmadas pela Prime). */
async function pagarTudo(api, r, k) {
  const cobr = await liberarCobranca(api, r);
  for (const g of cobr) await api.confirmarPagamento(g.id, { sessao: PRIME, chave: k || chave() });
  return cobr;
}

async function notifs(amb, filtro = {}) {
  return (await amb.casosBase.listarNotificacoes(filtro, { sessao: PRIME })).itens;
}

t.teste('toda mensagem tem gatilho e todo gatilho tem mensagem', () => {
  const usados = new Set(Object.values(GATILHOS).flat().map((g) => g.template));
  for (const k of Object.keys(MENSAGENS)) assert.ok(usados.has(k), `template sem gatilho: ${k}`);
  for (const k of usados) assert.ok(MENSAGENS[k], `gatilho sem template: ${k}`);
});

t.teste('mensagens curtas, sem asterisco, renderizam com os exemplos', () => {
  for (const [k, m] of Object.entries(MENSAGENS)) {
    const vars = Object.fromEntries(m.variaveis.map((v, i) => [v, m.exemplo[i]]));
    const txt = renderizar(k, vars);
    assert.ok(!txt.includes('*'), `${k} tem asterisco`);
    assert.ok(txt.length <= 320, `${k} longa demais (${txt.length})`);
  }
});

t.teste('horários: véspera 18h em São Paulo; véspera já passada manda na hora; diária hoje não manda', () => {
  assert.equal(calcularEnvio('vespera_18h', { eventoEm: '2026-10-01T12:00:00Z', dataAtendimento: '2026-10-05', regras: REGRAS }), '2026-10-04T21:00:00.000Z');
  assert.equal(calcularEnvio('vespera_18h', { eventoEm: '2026-10-04T22:00:00.000Z', dataAtendimento: '2026-10-05', regras: REGRAS }), '2026-10-04T22:00:00.000Z');
  assert.equal(calcularEnvio('vespera_18h', { eventoEm: '2026-10-05T12:00:00.000Z', dataAtendimento: '2026-10-05', regras: REGRAS }), null);
  assert.equal(calcularEnvio('apos_finalizado', { eventoEm: '2026-10-05T15:00:00.000Z', regras: REGRAS }), '2026-10-05T17:00:00.000Z');
  // prazo do pagamento: 9h do dia do vencimento; depois das 9h e antes das 14h, na hora; depois do prazo, não manda
  const pg = { venceEm: '2026-10-02', venceAs: '14:00' };
  assert.equal(calcularEnvio('prazo_pagamento', { eventoEm: '2026-10-01T12:00:00Z', pagamento: pg, regras: REGRAS }), '2026-10-02T12:00:00.000Z');
  assert.equal(calcularEnvio('prazo_pagamento', { eventoEm: '2026-10-02T13:00:00.000Z', pagamento: pg, regras: REGRAS }), '2026-10-02T13:00:00.000Z');
  assert.equal(calcularEnvio('prazo_pagamento', { eventoEm: '2026-10-02T17:01:00.000Z', pagamento: pg, regras: REGRAS }), null);
});

t.teste('ACEITE: confirmado -> avaliado com relógio avançado gera exatamente as notificações esperadas, na ordem', async () => {
  const amb = montarAmbiente(AGORA_TESTE);
  const api = amb.casos;
  const r = await criarAvulso(api);
  const diaristaId = await criarDiaristaAprovada(api);
  const at = r.atendimentos[0].id;
  const sd = { ator: 'diarista', id: diaristaId };
  const cli = { ator: 'cliente', id: r.cliente.id };
  await api.atribuirDiarista(at, { diaristaId }, { sessao: PRIME, chave: chave() });
  await pagarTudo(api, r);

  // antes da véspera: lembretes pendentes; o do prazo do pagamento caiu porque já está pago
  amb.relogio.irPara('2026-10-04T20:59:00.000Z'); await amb.motor.tique();
  let ns = await notifs(amb);
  assert.deepEqual(ns.filter((n) => n.status === 'pendente').map((n) => n.template).sort(), ['lembrete_vespera', 'lembrete_vespera_diarista']);
  assert.equal(ns.find((n) => n.template === 'lembrete_prazo_pagamento').status, 'cancelada');
  amb.relogio.irPara('2026-10-04T21:00:00.000Z'); await amb.motor.tique();

  amb.relogio.irPara('2026-10-05T11:00:00.000Z');
  await api.transicionarAtendimento(at, { evento: 'sair_a_caminho' }, { sessao: sd, chave: chave() });
  amb.relogio.irPara('2026-10-05T11:40:00.000Z');
  await api.transicionarAtendimento(at, { evento: 'iniciar' }, { sessao: sd, chave: chave() });
  amb.relogio.irPara('2026-10-05T15:00:00.000Z');
  await api.transicionarAtendimento(at, { evento: 'finalizar' }, { sessao: sd, chave: chave() });
  amb.relogio.irPara('2026-10-05T16:00:00.000Z');
  await api.criarAvaliacao(at, { notas: { pontualidade: 5, qualidade: 5, cuidado: 5, comunicacao: 5 } }, { sessao: cli, chave: chave() });
  amb.relogio.irPara('2026-10-05T17:00:00.000Z'); await amb.motor.tique();

  ns = await notifs(amb);
  const cliente = ns.filter((n) => n.destinatario.tipo === 'cliente').map((n) => `${n.template}:${n.status}`);
  assert.deepEqual(cliente, [
    'solicitacao_recebida:simulada', 'disponibilidade_confirmada:simulada', 'pagamento_confirmado:simulada', 'lembrete_prazo_pagamento:cancelada',
    'lembrete_vespera:simulada', 'profissional_a_caminho:simulada', 'atendimento_iniciado:simulada', 'atendimento_finalizado:simulada', 'obrigado_avaliacao:simulada',
  ]);
  assert.ok(!ns.some((n) => /entrada|parcela|50%/i.test(n.previa || '')), 'nenhuma mensagem fala de entrada/parcela');
  assert.match(ns.find((n) => n.template === 'solicitacao_recebida').previa, /ainda não é a confirmação/);
  assert.match(ns.find((n) => n.template === 'disponibilidade_confirmada').previa, /pagamento antecipado de R\$ 175,00 por PIX, transferência ou depósito e envie o comprovante até 14h de sex, 02\/10/);
  assert.match(ns.find((n) => n.template === 'atendimento_finalizado').previa, /vai direto para a equipe da Prime/);
  const diarista = ns.filter((n) => n.destinatario.tipo === 'diarista').map((n) => `${n.template}:${n.status}`);
  assert.deepEqual(diarista, ['cadastro_recebido:simulada', 'cadastro_aprovado:simulada', 'atendimento_atribuido:simulada', 'lembrete_vespera_diarista:simulada']);
  const lembrete = ns.find((n) => n.template === 'lembrete_vespera');
  assert.equal(lembrete.agendadaPara, '2026-10-04T21:00:00.000Z');
  assert.match(lembrete.previa, /amanhã, 05\/10\/2026/);
  assert.match(ns.find((n) => n.template === 'atendimento_finalizado').previa, /avaliacao\/\?atendimento=/);
  assert.ok(!ns.some((n) => n.status === 'enviada'), 'mock nunca marca enviada');
});

t.teste('cancelar pedido cancela as agendadas e manda UMA mensagem de cancelamento', async () => {
  const amb = montarAmbiente(AGORA_TESTE);
  const api = amb.casos;
  const r = await api.confirmarAutoagendamento({ cliente: CLIENTE_EMPRESA, pacote: { tipoServico: 'empresarial', duracaoHoras: 4, metragem: 60, quantidadeDiarias: 4, frequencia: 'semanal' }, primeiraData: '2026-10-05', turno: 'manha' }, { sessao: { ator: 'publico' }, chave: chave() });
  await pagarTudo(api, r);
  let ns = await notifs(amb);
  assert.equal(ns.filter((n) => n.template === 'lembrete_vespera' && n.status === 'pendente').length, 4);
  await api.cancelarPedido(r.pedido.id, {}, { sessao: { ator: 'cliente', id: r.cliente.id }, chave: chave() });
  ns = await notifs(amb);
  assert.equal(ns.filter((n) => n.template === 'lembrete_vespera' && n.status === 'cancelada').length, 4);
  assert.equal(ns.filter((n) => n.status === 'pendente').length, 0);
  assert.equal(ns.filter((n) => n.template === 'cancelamento').length, 1);
  amb.relogio.irPara('2026-11-01T00:00:00.000Z'); await amb.motor.tique();
  assert.equal((await notifs(amb)).filter((n) => n.template === 'lembrete_vespera' && n.status === 'simulada').length, 0);
});

t.teste('reagendar cancela o lembrete antigo e agenda o novo', async () => {
  const amb = montarAmbiente(AGORA_TESTE);
  const api = amb.casos;
  const r = await criarAvulso(api);
  await pagarTudo(api, r);
  await api.transicionarAtendimento(r.atendimentos[0].id, { evento: 'reagendar', dados: { data: '2026-10-07', turno: 'tarde' } }, { sessao: { ator: 'cliente', id: r.cliente.id }, chave: chave() });
  const todas = await notifs(amb);
  const ns = todas.filter((n) => n.template === 'lembrete_vespera');
  assert.deepEqual(ns.map((n) => `${n.status}:${n.agendadaPara}`).sort(), ['cancelada:2026-10-04T21:00:00.000Z', 'pendente:2026-10-06T21:00:00.000Z']);
  assert.match(todas.find((n) => n.template === 'remarcacao').previa, /remarcado para qua, 07\/10, no período da tarde/);
});

t.teste('reatribuir diarista cancela o lembrete da anterior', async () => {
  const amb = montarAmbiente(AGORA_TESTE);
  const api = amb.casos;
  const r = await criarAvulso(api);
  const d1 = await criarDiaristaAprovada(api);
  const d2 = await criarDiaristaAprovada(api);
  await api.atribuirDiarista(r.atendimentos[0].id, { diaristaId: d1 }, { sessao: PRIME, chave: chave() });
  await api.atribuirDiarista(r.atendimentos[0].id, { diaristaId: d2 }, { sessao: PRIME, chave: chave() });
  const ns = (await notifs(amb)).filter((n) => n.template === 'lembrete_vespera_diarista');
  assert.equal(ns.find((n) => n.destinatario.id === d1).status, 'cancelada');
  assert.equal(ns.find((n) => n.destinatario.id === d2).status, 'pendente');
});

t.teste('duplo clique (mesma chave) não duplica evento nem notificação', async () => {
  const amb = montarAmbiente(AGORA_TESTE);
  const api = amb.casos;
  const r = await criarAvulso(api);
  const [g] = await liberarCobranca(api, r);
  const k = chave();
  await Promise.all([
    api.confirmarPagamento(g.id, { sessao: PRIME, chave: k }),
    api.confirmarPagamento(g.id, { sessao: PRIME, chave: k }),
  ]);
  const ns = await notifs(amb);
  assert.equal(ns.filter((n) => n.template === 'pagamento_confirmado').length, 1);
  const evs = (await amb.casosBase.listarEventos({}, { sessao: PRIME })).itens;
  assert.equal(evs.filter((e) => e.tipo === 'pagamento_confirmado').length, 1);
});

t.teste('evento repetido (reprocessado) não duplica notificação', async () => {
  const amb = montarAmbiente(AGORA_TESTE);
  const api = amb.casos;
  await criarAvulso(api);
  const antes = (await notifs(amb)).length;
  // força o reprocessamento: volta todos os eventos pra pendente
  await amb.repo.transacao(null, async (tx) => { for (const e of await tx.todos('eventos')) await tx.put('eventos', { ...e, status: 'pendente' }); });
  await amb.motor.tique();
  await amb.motor.tique();
  assert.equal((await notifs(amb)).length, antes);
});

t.teste('lembrete de atendimento cancelado individualmente não sai', async () => {
  const amb = montarAmbiente(AGORA_TESTE);
  const api = amb.casos;
  const r = await criarAvulso(api);
  await pagarTudo(api, r);
  await api.transicionarAtendimento(r.atendimentos[0].id, { evento: 'cancelar' }, { sessao: { ator: 'cliente', id: r.cliente.id }, chave: chave() });
  amb.relogio.irPara('2026-10-04T21:00:00.000Z'); await amb.motor.tique();
  const ns = await notifs(amb);
  assert.equal(ns.find((n) => n.template === 'lembrete_vespera').status, 'cancelada');
  assert.equal(ns.filter((n) => n.template === 'cancelamento').length, 1);
});

t.teste('GPT#2: lembrete atrasado pra depois da meia-noite é descartado (não diz "amanhã" no dia errado)', async () => {
  const amb = montarAmbiente(AGORA_TESTE);
  const api = amb.casos;
  const r = await criarAvulso(api);
  await pagarTudo(api, r);
  amb.relogio.irPara('2026-10-05T04:00:00.000Z'); // 01h de 05/10 em SP: o agendador ficou parado desde a véspera
  await amb.motor.tique();
  const l = (await notifs(amb)).find((n) => n.template === 'lembrete_vespera');
  assert.equal(l.status, 'cancelada');
  assert.match(l.motivo, /obsoleta/);
});

t.teste('GPT#2: atribuição no próprio dia manda o lembrete da diarista com endereço e "hoje"', async () => {
  const amb = montarAmbiente(AGORA_TESTE);
  const api = amb.casos;
  const r = await criarAvulso(api);
  const d = await criarDiaristaAprovada(api);
  await pagarTudo(api, r);
  amb.relogio.irPara('2026-10-05T10:00:00.000Z'); // 07h de 05/10 em SP
  await api.atribuirDiarista(r.atendimentos[0].id, { diaristaId: d }, { sessao: PRIME, chave: chave() });
  const l = (await notifs(amb)).find((n) => n.template === 'lembrete_vespera_diarista');
  assert.equal(l.status, 'simulada');
  assert.match(l.previa, /Lembrete: hoje, 05\/10\/2026, você tem diária/);
  assert.match(l.previa, /Rua Fictícia, 100/);
});

t.teste('GPT#2: reatribuição e cancelamento avisam a diarista que perdeu a diária', async () => {
  const amb = montarAmbiente(AGORA_TESTE);
  const api = amb.casos;
  const r = await api.confirmarAutoagendamento({ cliente: CLIENTE_EMPRESA, pacote: { tipoServico: 'empresarial', duracaoHoras: 4, metragem: 60, quantidadeDiarias: 2, frequencia: 'semanal' }, primeiraData: '2026-10-05', turno: 'manha' }, { sessao: { ator: 'publico' }, chave: chave() });
  const d1 = await criarDiaristaAprovada(api);
  const d2 = await criarDiaristaAprovada(api);
  const [a1, a2] = r.atendimentos.map((a) => a.id);
  await api.atribuirDiarista(a1, { diaristaId: d1 }, { sessao: PRIME, chave: chave() });
  await api.atribuirDiarista(a1, { diaristaId: d2 }, { sessao: PRIME, chave: chave() });
  await api.atribuirDiarista(a2, { diaristaId: d1 }, { sessao: PRIME, chave: chave() });
  let ns = (await notifs(amb)).filter((n) => n.template === 'atendimento_cancelado_diarista');
  assert.deepEqual(ns.map((n) => n.destinatario.id), [d1]);
  await api.cancelarPedido(r.pedido.id, {}, { sessao: PRIME, chave: chave() });
  ns = (await notifs(amb)).filter((n) => n.template === 'atendimento_cancelado_diarista');
  assert.equal(ns.length, 3, 'd1 (reatribuição) + d2 (a1) + d1 (a2)');
  assert.ok(ns.every((n) => n.status === 'simulada'));
});

t.teste('lembrete do prazo do pagamento: sai às 9h do dia do vencimento se ainda não pagou ("hoje, até 14h")', async () => {
  const amb = montarAmbiente(AGORA_TESTE);
  const api = amb.casos;
  const r = await criarAvulso(api);
  await liberarCobranca(api, r);
  amb.relogio.irPara('2026-10-02T11:59:00.000Z'); await amb.motor.tique();
  assert.equal((await notifs(amb)).find((n) => n.template === 'lembrete_prazo_pagamento').status, 'pendente');
  amb.relogio.irPara('2026-10-02T12:00:00.000Z'); await amb.motor.tique();
  const l = (await notifs(amb)).find((n) => n.template === 'lembrete_prazo_pagamento');
  assert.equal(l.status, 'simulada');
  assert.match(l.previa, /vence hoje, até 14h/);
});

t.teste('recusa e estorno avisam a cliente com o motivo e o valor', async () => {
  const amb = montarAmbiente(AGORA_TESTE);
  const api = amb.casos;
  const r = await criarAvulso(api);
  await api.recusarSolicitacao(r.pedido.id, { motivo: 'sem profissional livre no período' }, { sessao: PRIME, chave: chave() });
  assert.match((await notifs(amb)).find((n) => n.template === 'solicitacao_recusada').previa, /não temos disponibilidade\. Motivo: sem profissional livre no período\./);
  const r2 = await criarAvulso(api);
  const [g] = await pagarTudo(api, r2);
  await api.registrarEstorno(g.id, { motivo: 'imprevisto sem substituição' }, { sessao: PRIME, chave: chave() });
  assert.match((await notifs(amb)).find((n) => n.template === 'estorno_registrado').previa, /registrou o estorno de R\$ 175,00 \(diária de 05\/10\/2026\)/);
});

t.teste('GPT#2: lembrete da diarista com turno trocado é descartado no envio', async () => {
  const { aindaValida } = await import('../src/automacoes/gatilhos.js');
  const n = { template: 'lembrete_vespera_diarista', destinatario: { id: 'd1' }, refs: { data: '2026-10-05', turno: 'manha', diaEnvio: '2026-10-04' } };
  const base = { status: 'confirmado', data: '2026-10-05', turno: 'manha', diaristaId: 'd1' };
  assert.equal(aindaValida(n, { atendimento: base }, { agoraISO: '2026-10-04T21:00:00Z' }), true);
  assert.equal(aindaValida(n, { atendimento: { ...base, turno: 'tarde' } }, { agoraISO: '2026-10-04T21:00:00Z' }), false);
});

await t.fim();
