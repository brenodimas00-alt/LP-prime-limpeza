// B5: automações reais contra a HOMOLOGAÇÃO. Um pedido fictício vai de solicitado a avaliado (confirmação manual
// da Prime) e cada notificação nasce na hora certa; o worker (Edge Function "notificacoes", a mesma que o pg_cron chama)
// é disparado à mão, com relógio adiantado e escopo nos ids fictícios. Prova que nenhum provedor real é chamado.
// Uso: bash scripts/cli.sh node22 scripts/testa-b5.mjs
import { criarSuite, assert, lancaCodigo } from './lib-teste.mjs';
import { criarAvulso, criarDiaristaAprovada, liberarCobranca, chave, PRIMEIRA } from './cenarios.mjs';
import { montarApiDeTeste } from './lib-api-teste.mjs';
import { sql, fecharSql, limparFicticios, ENV, EXECUCAO } from './lib-supabase.mjs';

const t = criarSuite('B5 automações reais (homologação)');
const URL_WORKER = `${ENV.SUPABASE_URL}/functions/v1/notificacoes`;
if (!ENV.WORKER_SEGREDO) throw new Error('WORKER_SEGREDO ausente no ~/.prime-env: rode scripts/configura-worker.mjs');
await limparFicticios();

const { api } = await montarApiDeTeste('b5');
const PRIME = { sessao: { ator: 'prime' } };
/** Rotula a falha com o passo (a pilha do adapter não diz qual chamada foi). */
async function passo(nome, p) { try { return await p; } catch (e) { e.message = `${nome}: ${e.message}`; throw e; } }

// ---------- worker ----------
const respostas = [];
async function worker(corpo, segredo = ENV.WORKER_SEGREDO) {
  const r = await fetch(URL_WORKER, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(segredo ? { 'x-worker-segredo': segredo } : {}) }, body: JSON.stringify(corpo) });
  const json = await r.json();
  if (r.ok) respostas.push(json);
  return { status: r.status, json };
}
/** Um tique com o relógio em `agora` (padrão: agora real + 10 s, folga de relógio), enviando só o que é do escopo. */
async function tique(escopo, agora = new Date(Date.now() + 10000).toISOString()) {
  const { status, json } = await worker({ motivo: 'teste-b5', agora, escopo });
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json.provedor, 'simulado');
  assert.equal(json.ambiente, 'homologacao');
  return json;
}
async function notificacoes(ids) {
  return (await sql(`select privado.j_notificacao(n) j from public.notificacoes n where n.refs ->> 'pedidoId' = any($1) or n.refs ->> 'diaristaId' = any($1)
    order by n.agendada_para, n.criado_em`, [ids])).map((x) => x.j);
}
const achar = (ns, template, atendimentoId) => ns.filter((n) => n.template === template && (!atendimentoId || n.refs.atendimentoId === atendimentoId));
function uma(ns, template, atendimentoId) {
  const xs = achar(ns, template, atendimentoId);
  assert.equal(xs.length, 1, `${template}: esperava 1, veio ${xs.length} (${ns.map((n) => `${n.template}/${n.status}`).join(', ')})`);
  return xs[0];
}
// Horários da regra (America/Sao_Paulo = UTC-3): diária em 05/10 (segunda)
const VESPERA_18H = '2026-10-04T21:00:00.000Z';
const PRAZO_9H = '2026-10-02T12:00:00.000Z'; // vence 14h de sexta 02/10 (dia útil anterior); lembrete às 9h
assert.equal(PRIMEIRA, '2026-10-05');

t.teste('worker exige o segredo; relógio adiantado só com escopo', async () => {
  assert.equal((await worker({}, null)).status, 401);
  assert.equal((await worker({}, 'x'.repeat(48))).status, 401);
  assert.equal((await worker({ agora: new Date().toISOString() })).status, 400);
  assert.equal((await worker({ agora: new Date().toISOString(), escopo: ['nao-uuid'] })).status, 400);
});

let fluxo;
t.teste('pedido fictício de solicitado a avaliado: cada notificação na hora certa, pelo simulado', async () => {
  const r = await criarAvulso(api, chave('b5'));
  const at = r.atendimentos[0].id;
  const escopo = [r.pedido.id];
  await tique(escopo);
  let ns = await notificacoes(escopo);
  const recebida = uma(ns, 'solicitacao_recebida');
  assert.equal(recebida.status, 'simulada');
  assert.equal(recebida.provedor, 'simulado');
  assert.equal(recebida.destinatario.tipo, 'cliente');
  assert.match(recebida.previa, /Recebemos sua solicitação/);

  const [g] = await liberarCobranca(api, r);
  await tique(escopo);
  ns = await notificacoes(escopo);
  assert.equal(uma(ns, 'disponibilidade_confirmada').status, 'simulada');
  const prazo = uma(ns, 'lembrete_prazo_pagamento');
  assert.equal(prazo.status, 'pendente');
  assert.equal(prazo.agendadaPara, PRAZO_9H);

  await api.confirmarPagamento(g.id, { ...PRIME, chave: chave('conf') }); // confirmação MANUAL da Prime
  await tique(escopo);
  ns = await notificacoes(escopo);
  assert.equal(uma(ns, 'pagamento_confirmado').status, 'simulada');
  const vespera = uma(ns, 'lembrete_vespera');
  assert.equal(vespera.status, 'pendente');
  assert.equal(vespera.agendadaPara, VESPERA_18H);

  const diaristaId = await criarDiaristaAprovada(api);
  escopo.push(diaristaId);
  await passo('atribuir', api.atribuirDiarista(at, { diaristaId }, { ...PRIME, chave: chave('atr') }));
  await tique(escopo);
  ns = await notificacoes(escopo);
  assert.equal(uma(ns, 'cadastro_recebido').status, 'simulada');
  assert.equal(uma(ns, 'cadastro_aprovado').status, 'simulada');
  const atribuido = uma(ns, 'atendimento_atribuido');
  assert.equal(atribuido.status, 'simulada');
  assert.equal(atribuido.destinatario.id, diaristaId);
  assert.equal(uma(ns, 'lembrete_vespera_diarista').agendadaPara, VESPERA_18H);

  // 9h do vencimento: já está pago, o lembrete de prazo é cancelado no envio
  await tique(escopo, '2026-10-02T12:00:30.000Z');
  ns = await notificacoes(escopo);
  const prazoDepois = uma(ns, 'lembrete_prazo_pagamento');
  assert.equal(prazoDepois.status, 'cancelada');
  assert.equal(prazoDepois.motivo, 'obsoleta no horário do envio');
  assert.equal(uma(ns, 'lembrete_vespera').status, 'pendente', 'véspera ainda não chegou');

  // 18h da véspera: os dois lembretes saem, com "amanhã"
  await tique(escopo, '2026-10-04T21:00:30.000Z');
  ns = await notificacoes(escopo);
  for (const tpl of ['lembrete_vespera', 'lembrete_vespera_diarista']) {
    const n = uma(ns, tpl);
    assert.equal(n.status, 'simulada', tpl);
    assert.match(n.previa, /amanhã/, tpl);
  }

  const sd = { sessao: { ator: 'diarista', id: diaristaId } };
  for (const evento of ['sair_a_caminho', 'iniciar', 'finalizar']) await passo(evento, api.transicionarAtendimento(at, { evento }, { ...sd, chave: chave(evento) }));
  await tique(escopo);
  ns = await notificacoes(escopo);
  for (const tpl of ['profissional_a_caminho', 'atendimento_iniciado', 'atendimento_finalizado']) assert.equal(uma(ns, tpl).status, 'simulada', tpl);
  assert.match(uma(ns, 'atendimento_finalizado').previa, /avaliacao\/\?atendimento=/);

  const av = await passo('avaliar', api.criarAvaliacao(at, { notas: { pontualidade: 5, qualidade: 5, cuidado: 5, comunicacao: 4 } }, { sessao: { ator: 'cliente', id: r.cliente.id }, chave: chave('av') }));
  assert.equal(av.atendimento.status, 'avaliado');
  await tique(escopo);
  ns = await notificacoes(escopo);
  assert.equal(uma(ns, 'obrigado_avaliacao').status, 'simulada');
  assert.ok(!ns.some((n) => n.status === 'pendente'), 'nada preso na fila');
  fluxo = { r, escopo, ns };
});

t.teste('o painel (listar_notificacoes da Prime) mostra cada notificação com status, provedor e prévia', async () => {
  const { r, ns } = fluxo;
  const doPedido = ns.filter((n) => n.refs.pedidoId === r.pedido.id);
  const painel = (await api.listarNotificacoes({ pedidoId: r.pedido.id }, PRIME)).itens;
  assert.equal(painel.length, doPedido.length);
  for (const n of painel) {
    assert.ok(['simulada', 'cancelada'].includes(n.status), `${n.template}: ${n.status}`);
    if (n.status === 'simulada') { assert.equal(n.provedor, 'simulado'); assert.ok(n.previa); }
  }
  await lancaCodigo(() => api.listarNotificacoes({ pedidoId: r.pedido.id }, { sessao: { ator: 'cliente', id: r.cliente.id } }), 'ATOR_SEM_PERMISSAO');
});

t.teste('reagendar cancela os lembretes da data antiga e agenda os da nova; cancelar o pedido cancela os agendados', async () => {
  const r = await criarAvulso(api, chave('b5r'));
  const at = r.atendimentos[0].id;
  const escopo = [r.pedido.id];
  const [g] = await liberarCobranca(api, r);
  await api.confirmarPagamento(g.id, { ...PRIME, chave: chave('conf') });
  await tique(escopo);
  let ns = await notificacoes(escopo);
  assert.equal(uma(ns, 'lembrete_vespera').agendadaPara, VESPERA_18H);

  await api.transicionarAtendimento(at, { evento: 'reagendar', dados: { data: '2026-10-08', turno: 'tarde' } }, { ...PRIME, chave: chave('rem') });
  await tique(escopo);
  ns = await notificacoes(escopo);
  const vesperas = achar(ns, 'lembrete_vespera');
  assert.equal(vesperas.length, 2);
  const antiga = vesperas.find((n) => n.agendadaPara === VESPERA_18H);
  const nova = vesperas.find((n) => n.agendadaPara === '2026-10-07T21:00:00.000Z');
  assert.equal(antiga.status, 'cancelada');
  assert.equal(antiga.motivo, 'cancelada por atendimento_reagendado');
  assert.equal(nova.status, 'pendente');
  assert.equal(uma(ns, 'remarcacao').status, 'simulada');

  await api.cancelarPedido(r.pedido.id, { motivo: 'teste b5' }, { ...PRIME, chave: chave('cp') });
  await tique(escopo);
  ns = await notificacoes(escopo);
  const novaDepois = ns.find((n) => n.id === nova.id);
  assert.equal(novaDepois.status, 'cancelada');
  assert.equal(novaDepois.motivo, 'cancelada por pedido_cancelado');
  assert.equal(uma(ns, 'cancelamento').status, 'simulada');
  // a data que era da véspera chega e nada sai
  await tique(escopo, '2026-10-07T21:00:30.000Z');
  assert.equal((await notificacoes(escopo)).filter((n) => n.status === 'simulada').length, ns.filter((n) => n.status === 'simulada').length);
});

t.teste('notificação que falha de vez vai pra erro, aparece no painel e a Prime manda de novo', async () => {
  const { r, escopo } = fluxo;
  const [n] = await sql(`insert into public.notificacoes (gatilho, destinatario, template, variaveis, agendada_para, refs, chave_idempotencia)
    values ('teste', $1::jsonb, 'template_inexistente', '{}', now(), $2::jsonb, $3) returning id`,
  [JSON.stringify({ tipo: 'cliente', id: r.cliente.id, telefone: '31900000000' }), JSON.stringify({ pedidoId: r.pedido.id }), `teste-${EXECUCAO}-quebrada`]);
  const resp = await tique(escopo);
  assert.ok(resp.envio.erros >= 1);
  const comErro = (await api.listarNotificacoes({ status: 'erro', pedidoId: r.pedido.id }, PRIME)).itens;
  assert.equal(comErro.length, 1);
  assert.equal(comErro[0].id, n.id);
  assert.match(comErro[0].erro.mensagem, /template_inexistente/);
  assert.equal(comErro[0].tentativas, 1);
  const saude = await api.saudeNotificacoes(PRIME);
  assert.ok(saude.notificacoesComErro >= 1);
  await lancaCodigo(() => api.reenviarNotificacao(n.id, { sessao: { ator: 'cliente', id: r.cliente.id }, chave: chave('re') }), 'ATOR_SEM_PERMISSAO');
  const k = chave('re');
  const re = await api.reenviarNotificacao(n.id, { ...PRIME, chave: k });
  assert.equal(re.notificacao.status, 'pendente');
  assert.equal((await api.reenviarNotificacao(n.id, { ...PRIME, chave: k })).notificacao.id, n.id, 'mesma chave, mesmo resultado');
  await lancaCodigo(() => api.reenviarNotificacao(n.id, { ...PRIME, chave: chave('re2') }), 'TRANSICAO_PROIBIDA');
  await sql('delete from public.notificacoes where id = $1', [n.id]);
});

t.teste('evento com dado corrompido: backoff, depois erro visível; a Prime reprocessa; a fila não trava', async () => {
  const { escopo } = fluxo;
  const [e] = await sql(`insert into public.eventos (tipo, refs) values ('pedido_criado', $1::jsonb) returning id`, [JSON.stringify({ pedidoId: `invalido-${EXECUCAO}` })]);
  try {
    let ev;
    for (let i = 0; i < 8; i++) {
      // relógio adiantado NÃO anda a fila de eventos (só o envio do escopo): o backoff precisa ser vencido à mão
      await tique(escopo, new Date(Date.now() + 3 * 3600000).toISOString());
      [ev] = (await sql('select privado.j_evento(e) j from public.eventos e where id = $1', [e.id])).map((x) => x.j);
      if (ev.status === 'erro') break;
      assert.ok(Date.parse(ev.tentarApos) > Date.now(), 'backoff no relógio real, não no do teste');
      await sql('update public.eventos set tentar_apos = now() - interval \'1 second\' where id = $1', [e.id]);
    }
    assert.equal(ev.status, 'erro');
    assert.equal(ev.tentativas, 5);
    assert.match(ev.erro, /id inválido/);
    const lista = (await api.listarEventos({ status: 'erro' }, PRIME)).itens;
    assert.ok(lista.some((x) => x.id === e.id && x.erro));
    // eventos novos continuam andando com esse preso no meio
    const r = await criarAvulso(api, chave('b5f'));
    await tique([r.pedido.id]);
    assert.equal(uma(await notificacoes([r.pedido.id]), 'solicitacao_recebida').status, 'simulada');
    const rp = await api.reprocessarEvento(e.id, { ...PRIME, chave: chave('rp') });
    assert.equal(rp.evento.status, 'pendente');
    assert.equal(rp.evento.tentativas, 0);
  } finally {
    await sql('delete from public.eventos where id = $1', [e.id]);
  }
});

t.teste('em homologação nenhum provedor real foi chamado: tudo simulado, nada enviado', async () => {
  assert.ok(respostas.length > 5);
  assert.ok(respostas.every((x) => x.provedor === 'simulado' && x.ambiente === 'homologacao'));
  const [x] = await sql(`select count(*) filter (where provedor is not null and provedor <> 'simulado')::int reais,
    count(*) filter (where status = 'enviada' or wamid is not null)::int enviadas, count(*) filter (where status = 'simulada')::int simuladas from public.notificacoes`);
  assert.equal(x.reais, 0);
  assert.equal(x.enviadas, 0);
  assert.ok(x.simuladas > 0);
});

t.teste('pg_cron: jobs agendados nos horários da regra e o de minuto chegando ao worker', async () => {
  const jobs = Object.fromEntries((await sql('select jobname, schedule, active from cron.job')).map((j) => [j.jobname, j]));
  assert.equal(jobs['prime-notificacoes']?.schedule, '* * * * *');
  assert.equal(jobs['prime-lembrete-vespera']?.schedule, '0 21 * * *'); // 18h em São Paulo
  assert.equal(jobs['prime-lembrete-pagamento']?.schedule, '0 12 * * *'); // 9h em São Paulo
  assert.equal(jobs['prime-varredura-fila']?.schedule, '*/10 * * * *');
  assert.ok(Object.values(jobs).every((j) => j.active));
  const [ok] = await sql(`select count(*)::int n from net._http_response where status_code = 200 and created > now() - interval '10 minutes'`);
  assert.ok(ok.n > 0, 'o pg_net não recebeu 200 do worker nos últimos 10 minutos');
});

try {
  await t.fim();
} finally {
  await limparFicticios({ soEstaExecucao: true });
  await fecharSql();
}
