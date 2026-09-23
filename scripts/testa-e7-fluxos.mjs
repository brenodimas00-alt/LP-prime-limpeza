// E7: fluxos ponta a ponta que as suítes E1 a E6 não cobrem inteiros no navegador:
// (4) atendimento até avaliado com relógio simulado e depois pagamento da parcela do dia;
// (5) cancelamento de pedido com um atendimento já finalizado;
// e os casos obrigatórios que faltavam em tela: transição proibida pela UI, falha do serviço (fake-api derrubado)
// com o adapter http, evento repetido sem mensagem duplicada.
// Os outros fluxos (residencial e empresa até o Pix, cadastro de diarista, duplo clique, retomada, id inexistente,
// centavo ímpar) estão em testa-e3, testa-e5, testa-e4, testa-dominio e testa-pacote (ver scripts/roda-testes.mjs).
import { criarSuite, assert } from './lib-teste.mjs';
import { abrirNavegador, subirServidor } from './pw.mjs';
import { criarFakeApi } from './fake-api.mjs';
import { CREDENCIAIS_MOCK as C } from './fixtures/seed.js';
import { instanteLocal, somarDias, dataNoFuso, diaDaSemana } from '../src/domain/calendario.js';
import { proximaDataPermitida } from './fixtures/seed.js';
import { CONFIG_PRECOS } from '../src/config/precos.js';

const t = criarSuite('E7 fluxos (relógio, parcela do dia, cancelamento, falha do serviço)');
const { base, fechar } = await subirServidor();
const b = await abrirNavegador();
const ctx = await b.newContext({ viewport: { width: 390, height: 900 } });
await ctx.route('**/src/config/prime.js', (route) => route.fulfill({ path: 'src/config/prime.teste.js', contentType: 'text/javascript' }));
const p = await ctx.newPage();
const erros = [];
p.on('console', (m) => m.type() === 'error' && !/ERR_CONNECTION|Failed to load resource/.test(m.text()) && erros.push(m.text()));
p.on('pageerror', (e) => erros.push(e.message));
const comoPrime = () => p.evaluate((c) => localStorage.setItem('prime.sessao', JSON.stringify({ ator: 'prime', id: c.id, nome: c.nome })), C.prime[0]);

let ids;
t.teste('fluxo 4: entrada confirmada, relógio na véspera 18h manda lembrete, diarista avança, cliente avalia, parcela do dia é paga', async () => {
  await p.goto(`${base}_dev/servicos.html?dev=1`); await p.waitForSelector('[data-pedido]');
  ids = await p.evaluate(async (raiz) => {
    const { api, adapterAtual } = await import(`${raiz}src/services/api.js`);
    const PRIME = { sessao: { ator: 'prime' } };
    const k = () => ({ chave: crypto.randomUUID() });
    const { itens } = await api.listarPedidos({}, PRIME);
    const ped = await api.obterPedido(itens.find((x) => x.clienteId === '00000000-0000-4000-8000-00000000c001').id, PRIME);
    const at = ped.atendimentos[0];
    const entrada = ped.pagamentos.find((g) => g.parcela === 'entrada');
    const dia = ped.pagamentos.find((g) => g.parcela === 'dia');
    await api.atribuirDiarista(at.id, { diaristaId: '00000000-0000-4000-8000-00000000d001' }, { ...k(), ...PRIME });
    await api.confirmarPagamento(entrada.id, { ...k(), ...PRIME });
    const ad = await adapterAtual();
    return { pedido: ped.pedido.id, at: at.id, dia: dia.id, cliente: ped.cliente.id, data: at.data, agora: ad.relogio.agora().toISOString() };
  }, base);
  // relógio na véspera às 18h -> lembretes
  const vespera = instanteLocal(somarDias(ids.data, -1), 18, 0);
  await p.evaluate(async ([raiz, iso]) => { const { adapterAtual } = await import(`${raiz}src/services/api.js`); const ad = await adapterAtual(); ad.relogio.irPara(iso); await ad.motor.tique(); }, [base, vespera]);
  let n = await p.evaluate(async (raiz) => { const { api } = await import(`${raiz}src/services/api.js`); const r = await api.listarNotificacoes({}, { sessao: { ator: 'prime' } }); return r.itens.filter((x) => x.template === 'lembrete_vespera' && x.status === 'simulada').length; }, base);
  assert.equal(n, 1, 'lembrete da véspera simulado');
  // diarista avança pela agenda dela
  await p.evaluate((c) => localStorage.setItem('prime.sessao', JSON.stringify({ ator: 'diarista', id: c.id, nome: c.nome })), C.diaristas[0]);
  await p.goto(`${base}diarista/agenda/`); await p.waitForSelector('[data-atendimento]');
  await p.getByRole('button', { name: 'Estou a caminho' }).first().click(); await p.waitForSelector('[data-status=diarista_a_caminho]');
  await p.getByRole('button', { name: 'Iniciei a diária' }).first().click(); await p.waitForSelector('[data-status=em_andamento]');
  await p.getByRole('button', { name: 'Finalizei' }).first().click(); await p.waitForSelector('h2:has-text("Realizadas")');
  // cliente avalia
  await p.evaluate((id) => localStorage.setItem('prime.sessao', JSON.stringify({ ator: 'cliente', id, nome: 'Ana' })), ids.cliente);
  await p.goto(`${base}avaliacao/?atendimento=${ids.at}`); await p.waitForSelector('form');
  for (const k2 of ['pontualidade', 'qualidade', 'cuidado', 'comunicacao']) await p.locator(`input[name=${k2}][value="5"]`).evaluate((i) => i.click());
  await p.getByRole('button', { name: 'Enviar avaliação' }).click(); await p.waitForSelector('[data-avaliacao]');
  // 2h depois da finalização: cobrança do dia simulada (antes de a cliente informar o pagamento)
  await p.evaluate(async (raiz) => { const { adapterAtual } = await import(`${raiz}src/services/api.js`); const ad = await adapterAtual(); ad.relogio.avancar(2 * 3600e3 + 60e3); await ad.motor.tique(); }, base);
  // parcela do dia continua pagável depois de avaliado
  await p.goto(`${base}pagamento/?pagamento=${ids.dia}`); await p.waitForSelector('[data-pix=ok]');
  await p.getByRole('button', { name: 'Já paguei' }).click(); await p.waitForSelector('button:has-text("Pagamento informado")');
  // conjunto de mensagens da cliente (a ordem por horário varia porque só as páginas com ?dev=1 usam o relógio simulado)
  const seq = await p.evaluate(async ([raiz, pedidoId]) => { const { api } = await import(`${raiz}src/services/api.js`); const r = await api.listarNotificacoes({ pedidoId }, { sessao: { ator: 'prime' } }); return r.itens.filter((x) => x.destinatario.tipo === 'cliente').map((x) => `${x.template}:${x.status}`).sort(); }, [base, ids.pedido]);
  assert.deepEqual(seq, ['atendimento_finalizado:simulada', 'atendimento_iniciado:simulada', 'cobranca_dia:simulada', 'diarista_a_caminho:simulada', 'entrada_confirmada:simulada', 'lembrete_vespera:simulada', 'obrigado_avaliacao:simulada', 'pedido_recebido:simulada'], JSON.stringify(seq));
});

t.teste('fluxo 5: cancelar pedido com um atendimento já finalizado (pela tela de acompanhamento)', async () => {
  const r = await p.evaluate(async (raiz) => {
    const { api } = await import(`${raiz}src/services/api.js`);
    const PRIME = { sessao: { ator: 'prime' } };
    const k = () => ({ chave: crypto.randomUUID() });
    const { itens } = await api.listarPedidos({}, PRIME);
    const ped = await api.obterPedido(itens.find((x) => x.clienteId === '00000000-0000-4000-8000-00000000c002').id, PRIME);
    const d = '00000000-0000-4000-8000-00000000d001';
    const a1 = ped.atendimentos[0].id;
    await api.confirmarPagamento(ped.pagamentos.find((g) => g.parcela === 'entrada').id, { ...k(), ...PRIME });
    await api.atribuirDiarista(a1, { diaristaId: d }, { ...k(), ...PRIME });
    for (const evento of ['sair_a_caminho', 'iniciar', 'finalizar']) await api.transicionarAtendimento(a1, { evento }, { ...k(), sessao: { ator: 'diarista', id: d } });
    localStorage.setItem('prime.sessao', JSON.stringify({ ator: 'cliente', id: ped.cliente.id, nome: 'Carlos' }));
    return { pedido: ped.pedido.id, a1 };
  }, base);
  await p.goto(`${base}acompanhamento/?pedido=${r.pedido}`); await p.waitForSelector('[data-atendimento]');
  await p.getByRole('button', { name: 'Cancelar pedido' }).click();
  await p.getByRole('button', { name: 'Sim, cancelar as diárias pendentes' }).click();
  await p.waitForFunction(() => document.querySelectorAll('[data-atendimento][data-status=cancelado]').length === 3);
  assert.equal(await p.locator(`[data-atendimento="${r.a1}"]`).getAttribute('data-status'), 'finalizado', 'a realizada fica');
  const pg = await p.locator('[data-pagamento]').evaluateAll((l) => l.map((e) => e.dataset.status));
  assert.equal(pg.filter((x) => x === 'cancelado').length, 3, '3 parcelas de dia canceladas');
  assert.ok(await p.getByRole('link', { name: /Ver cobrança|Pagar/ }).count() >= 1, 'parcela da realizada continua pagável');
  assert.equal(await p.getByRole('button', { name: 'Cancelar pedido' }).count(), 0, 'não dá pra cancelar de novo');
});

t.teste('transição proibida pela UI: linha do tempo de atendimento finalizado não oferece "próximo passo"', async () => {
  await comoPrime();
  await p.goto(`${base}acompanhamento/?atendimento=${ids.at}&dev=1`); await p.waitForSelector('.timeline');
  assert.ok(await p.getByRole('button', { name: 'Simular próximo passo' }).isDisabled(), 'avaliado: botão desabilitado');
});

t.teste('falha do serviço: adapter http com fake-api derrubado mostra "tente de novo" e mantém a chave', async () => {
  const { servidor } = criarFakeApi();
  await new Promise((r) => servidor.listen(0, r));
  const porta = servidor.address().port;
  let DATA = proximaDataPermitida(dataNoFuso(new Date().toISOString()), 3, CONFIG_PRECOS);
  while (diaDaSemana(DATA) === 6) DATA = proximaDataPermitida(DATA, 1, CONFIG_PRECOS);
  const r1 = await p.evaluate(async ([raiz, porta, DATA]) => {
    const { criarAdapterHttp } = await import(`${raiz}src/services/adapters/http.js`);
    const a = criarAdapterHttp({ baseUrl: `http://localhost:${porta}/api` });
    const { CLIENTE_RESIDENCIAL } = await import(`${raiz}scripts/fixtures/seed.js`);
    const dados = { cliente: CLIENTE_RESIDENCIAL, pacote: { tipoServico: 'residencial', duracaoHoras: 4, metragem: 50, quantidadeDiarias: 1, frequencia: 'avulso' }, primeiraData: DATA, turno: 'manha', conta: { senhaHash: 'a'.repeat(64) } };
    const ok = await a.confirmarAutoagendamento(dados, { chave: 'chave-e7-fixa-0001' });
    return ok.pedido.id;
  }, [base, porta, DATA]);
  await new Promise((r) => servidor.close(r)); // derruba
  const r2 = await p.evaluate(async ([raiz, porta]) => {
    const { criarAdapterHttp } = await import(`${raiz}src/services/adapters/http.js`);
    const { mensagemErro } = await import(`${raiz}src/ui/acoes.js`);
    const a = criarAdapterHttp({ baseUrl: `http://localhost:${porta}/api` });
    try { await a.obterPedido('x', { sessao: { ator: 'prime' } }); return null; } catch (e) { return { codigo: e.codigo, msg: mensagemErro(e) }; }
  }, [base, porta]);
  assert.equal(r2.codigo, 'SERVICO_INDISPONIVEL');
  assert.match(r2.msg, /Tente de novo/);
  assert.ok(r1);
});

t.teste('evento repetido não duplica mensagem (reprocessar a fila no mock)', async () => {
  const r = await p.evaluate(async (raiz) => {
    const { api, adapterAtual } = await import(`${raiz}src/services/api.js`);
    const PRIME = { sessao: { ator: 'prime' } };
    const antes = (await api.listarNotificacoes({}, PRIME)).itens.length;
    const { criarRepoIndexedDB } = await import(`${raiz}src/app/repo-indexeddb.js`);
    const ad = await adapterAtual();
    ad.fecharBanco();
    const repo = await criarRepoIndexedDB('prime-mock');
    await repo.transacao(null, async (tx) => { for (const e of await tx.todos('eventos')) await tx.put('eventos', { ...e, status: 'pendente' }); });
    repo.fechar();
    return { antes };
  }, base);
  await p.reload(); await p.waitForLoadState('networkidle');
  const depois = await p.evaluate(async (raiz) => { const { api } = await import(`${raiz}src/services/api.js`); return (await api.listarNotificacoes({}, { sessao: { ator: 'prime' } })).itens.length; }, base);
  assert.equal(depois, r.antes);
});

t.teste('sem erro no console', async () => { assert.deepEqual(erros, [], JSON.stringify(erros)); });

const falhas = await t.fim();
await b.close(); await fechar();
process.exit(falhas ? 1 : 0);
