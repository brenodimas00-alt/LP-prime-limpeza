// E0 no navegador (mock + IndexedDB): seed, transições pelos botões do /_dev/servicos.html, persistência e rollback.
import { criarSuite, assert } from './lib-teste.mjs';
import { abrirNavegador, subirServidor } from './pw.mjs';

const t = criarSuite('E0 navegador (mock/IndexedDB)');
const { base, fechar } = await subirServidor();
const b = await abrirNavegador();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const p = await ctx.newPage();
const erros = [];
p.on('console', (m) => m.type() === 'error' && erros.push(m.text()));
p.on('pageerror', (e) => erros.push(e.message));
const dev = `${base}_dev/servicos.html?dev=1`;

async function clicar(sel, nome) {
  await p.locator(sel).getByRole('button', { name: nome }).first().click();
  await p.waitForLoadState('networkidle');
  await p.waitForTimeout(150);
}

t.teste('seed: lista 2 pedidos (avulso e 4 semanais) e 1 diarista aprovada', async () => {
  await p.goto(dev);
  await p.waitForSelector('[data-pedido]');
  assert.equal(await p.locator('[data-pedido]').count(), 2);
  assert.equal(await p.locator('[data-atendimento]').count(), 5);
  assert.equal(await p.locator('[data-diarista]').count(), 1);
});

t.teste('seed não duplica ao recarregar', async () => {
  await p.reload(); await p.waitForSelector('[data-pedido]');
  assert.equal(await p.locator('[data-pedido]').count(), 2);
});

t.teste('transiciona pelos botões: entrada -> confirmado -> a caminho -> em andamento -> finalizado', async () => {
  const ped = p.locator('[data-pedido]').filter({ hasText: 'avulso' });
  const atSel = () => ped.locator('[data-atendimento]').first();
  await ped.locator('[data-atendimento]').first().getByRole('button', { name: 'Atribuir' }).click();
  await p.waitForTimeout(300);
  await p.locator('[data-pedido]').filter({ hasText: 'avulso' }).locator('[data-pagamento]').first().getByRole('button', { name: 'Simular confirmação da Prime' }).click();
  await p.waitForTimeout(300);
  assert.equal(await atSel().getAttribute('data-status'), 'confirmado');
  for (const [botao, status] of [['Diarista a caminho', 'diarista_a_caminho'], ['Iniciar', 'em_andamento'], ['Finalizar', 'finalizado']]) {
    await atSel().getByRole('button', { name: botao }).click();
    await p.waitForFunction((s) => document.querySelector('[data-pedido] [data-atendimento]') && [...document.querySelectorAll('[data-atendimento]')].some((e) => e.dataset.status === s), status);
    assert.equal(await p.locator('[data-pedido]').filter({ hasText: 'avulso' }).locator('[data-atendimento]').first().getAttribute('data-status'), status);
  }
});

t.teste('transição proibida não aparece como botão (finalizado não tem "Iniciar")', async () => {
  const at = p.locator('[data-pedido]').filter({ hasText: 'avulso' }).locator('[data-atendimento]').first();
  assert.equal(await at.getByRole('button', { name: 'Iniciar' }).count(), 0);
});

t.teste('estado persiste após recarregar (IndexedDB)', async () => {
  await p.reload(); await p.waitForSelector('[data-pedido]');
  assert.equal(await p.locator('[data-pedido]').filter({ hasText: 'avulso' }).locator('[data-atendimento]').first().getAttribute('data-status'), 'finalizado');
});

t.teste('notificações simuladas geradas (nunca "enviada")', async () => {
  const tpl = await p.locator('#lista-notificacoes [data-template]').evaluateAll((l) => l.map((e) => `${e.dataset.template}:${e.dataset.status}`));
  assert.ok(tpl.includes('pedido_recebido:simulada'));
  assert.ok(tpl.includes('entrada_confirmada:simulada'));
  assert.ok(tpl.includes('atendimento_finalizado:simulada'));
  assert.ok(!tpl.some((x) => x.endsWith(':enviada')));
});

t.teste('IndexedDB: transação com erro no meio não grava nada (rollback real)', async () => {
  const r = await p.evaluate(async (raiz) => {
    const { criarRepoIndexedDB } = await import(`${raiz}src/app/repo-indexeddb.js`);
    const repo = await criarRepoIndexedDB('prime-teste-rollback');
    await repo.transacao(null, async (tx) => { await tx.put('clientes', { id: 'ok1' }); });
    let erro = null;
    try { await repo.transacao(null, async (tx) => { await tx.put('clientes', { id: 'parcial' }); await tx.get('clientes', 'ok1'); throw new Error('falha simulada'); }); } catch (e) { erro = e.message; }
    const todos = await repo.leitura(null, (tx) => tx.todos('clientes'));
    repo.fechar();
    return { erro, ids: todos.map((c) => c.id) };
  }, base);
  assert.equal(r.erro, 'falha simulada');
  assert.deepEqual(r.ids, ['ok1']);
});

t.teste('IndexedDB: idempotência (mesma chave = mesmo pedido; conteúdo diferente = CONFLITO)', async () => {
  const r = await p.evaluate(async (raiz) => {
    const { api } = await import(`${raiz}src/services/api.js`);
    const { CLIENTE_RESIDENCIAL } = await import(`${raiz}scripts/fixtures/seed.js`);
    const { proximaDataPermitida } = await import(`${raiz}scripts/fixtures/seed.js`);
    const { CONFIG_PRECOS } = await import(`${raiz}src/config/precos.js`);
    const { dataNoFuso } = await import(`${raiz}src/domain/calendario.js`);
    const data = proximaDataPermitida(dataNoFuso(new Date().toISOString()), 3, CONFIG_PRECOS);
    const dados = { cliente: CLIENTE_RESIDENCIAL, pacote: { tipoServico: 'residencial', duracaoHoras: 4, metragem: 40, quantidadeDiarias: 1, frequencia: 'avulso' }, primeiraData: data, turno: 'tarde' };
    const k = 'chave-navegador-idem-1';
    const a = await api.confirmarAutoagendamento(dados, { chave: k });
    const b = await api.confirmarAutoagendamento(dados, { chave: k });
    let conflito = null;
    try { await api.confirmarAutoagendamento({ ...dados, turno: 'manha' }, { chave: k }); } catch (e) { conflito = e.codigo; }
    const todos = await api.listarPedidos({});
    return { mesmo: a.pedido.id === b.pedido.id, conflito, qtd: todos.itens.filter((x) => x.id === a.pedido.id).length };
  }, base);
  assert.deepEqual(r, { mesmo: true, conflito: 'CONFLITO_IDEMPOTENCIA', qtd: 1 });
});

t.teste('sem erro no console', async () => { assert.deepEqual(erros, []); });

const falhas = await t.fim();
await b.close(); await fechar();
process.exit(falhas ? 1 : 0);
