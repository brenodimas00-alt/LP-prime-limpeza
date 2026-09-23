// E1 no navegador: acompanhamento (lista e linha do tempo), simulação em ?dev=1 e avaliação.
import { criarSuite, assert } from './lib-teste.mjs';
import { abrirNavegador, subirServidor } from './pw.mjs';

const t = criarSuite('E1 navegador (acompanhamento e avaliação)');
const { base, fechar } = await subirServidor();
const b = await abrirNavegador();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
const p = await ctx.newPage();
const erros = [];
p.on('console', (m) => m.type() === 'error' && erros.push(m.text()));
p.on('pageerror', (e) => erros.push(e.message));
let pedidoId;
let atId;

t.teste('seed disponível e acompanhamento lista as diárias do pedido', async () => {
  await p.goto(`${base}_dev/servicos.html?dev=1`);
  await p.waitForSelector('[data-pedido]');
  pedidoId = await p.locator('[data-pedido]').filter({ hasText: 'avulso' }).getAttribute('data-pedido');
  await p.goto(`${base}acompanhamento/?pedido=${pedidoId}&dev=1`);
  await p.waitForSelector('[data-atendimento]');
  assert.equal(await p.locator('[data-atendimento]').count(), 1);
  atId = await p.locator('[data-atendimento]').first().getAttribute('data-atendimento');
});

t.teste('linha do tempo + "Simular próximo passo" até finalizado', async () => {
  await p.goto(`${base}acompanhamento/?atendimento=${atId}&dev=1`);
  for (const esperado of ['confirmado', 'diarista_a_caminho', 'em_andamento', 'finalizado']) {
    await p.getByRole('button', { name: 'Simular próximo passo' }).click();
    await p.waitForSelector(`dd[data-status="${esperado}"]`);
  }
  assert.equal(await p.locator('.timeline li.feito').count(), 4);
  assert.equal(await p.locator('.timeline li.atual').getAttribute('data-estado'), 'finalizado');
  assert.ok(await p.getByRole('link', { name: 'Avaliar a diária' }).isVisible());
});

t.teste('avaliação: bloqueia sem nota, duplo clique grava uma vez, mostra ao recarregar', async () => {
  await p.getByRole('link', { name: 'Avaliar a diária' }).click();
  await p.waitForSelector('form');
  await p.getByRole('button', { name: 'Enviar avaliação' }).click();
  assert.match(await p.locator('.alerta-erro').textContent(), /Dê uma nota/);
  for (const [k, n] of [['pontualidade', 5], ['qualidade', 4], ['cuidado', 5], ['comunicacao', 4]]) {
    await p.locator(`input[name=${k}][value="${n}"]`).check({ force: true });
  }
  assert.match(await p.locator('#media').textContent(), /4,5 de 5/);
  await p.getByRole('button', { name: 'Enviar avaliação' }).dblclick();
  await p.waitForSelector('[data-avaliacao]');
  await p.reload();
  await p.waitForSelector('[data-avaliacao]');
  assert.match(await p.locator('.valor-grande').textContent(), /4,5 de 5/);
  await p.goto(`${base}_dev/servicos.html?dev=1`);
  await p.waitForSelector('#lista-notificacoes');
  assert.equal(await p.locator('#lista-notificacoes [data-template="obrigado_avaliacao"]').count(), 1, 'uma avaliação = uma mensagem');
});

t.teste('sem ?dev=1 e sem sessão: pedido alheio não abre (id não é autorização)', async () => {
  await p.goto(`${base}acompanhamento/?pedido=${pedidoId}`);
  await p.waitForSelector('h1');
  assert.match(await p.locator('h1').textContent(), /Não encontramos/);
  assert.equal(await p.getByRole('button', { name: 'Simular próximo passo' }).count(), 0);
});

t.teste('id inexistente mostra mensagem clara', async () => {
  await p.goto(`${base}acompanhamento/?atendimento=nao-existe&dev=1`);
  await p.waitForSelector('h1');
  assert.match(await p.locator('h1').textContent(), /Não encontramos/);
});

t.teste('avaliação de diária não finalizada mostra aviso', async () => {
  await p.goto(`${base}_dev/servicos.html?dev=1`);
  await p.waitForSelector('[data-pedido]');
  const outro = await p.locator('[data-pedido]').filter({ hasText: 'semanal' }).locator('[data-atendimento]').first().getAttribute('data-atendimento');
  await p.goto(`${base}avaliacao/?atendimento=${outro}&dev=1`);
  await p.waitForSelector('.alerta-info');
  assert.match(await p.locator('.alerta-info').textContent(), /abre quando a diária for finalizada/);
});

t.teste('sem overflow horizontal em 390px e sem erro no console', async () => {
  for (const u of [`acompanhamento/?pedido=${pedidoId}&dev=1`, `acompanhamento/?atendimento=${atId}&dev=1`, `avaliacao/?atendimento=${atId}&dev=1`]) {
    await p.goto(base + u); await p.waitForLoadState('networkidle');
    const ov = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(ov <= 0, `${u} overflow ${ov}px`);
  }
  assert.deepEqual(erros, []);
});

const falhas = await t.fim();
await b.close(); await fechar();
process.exit(falhas ? 1 : 0);
