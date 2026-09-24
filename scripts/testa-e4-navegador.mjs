// E4 no navegador: tela de pagamento ANTECIPADO e INTEGRAL (cobrança nasce quando a Prime confirma a disponibilidade),
// elegibilidade, "Já paguei" idempotente, config Pix incompleta.
import { criarSuite, assert } from './lib-teste.mjs';
import { abrirNavegador, subirServidor } from './pw.mjs';
import { proximaDataPermitida } from './fixtures/seed.js';
import { dataNoFuso } from '../src/domain/calendario.js';
import { CONFIG_PRECOS } from '../src/config/precos.js';

const t = criarSuite('E4 navegador (Pix)');
const { base, fechar } = await subirServidor();
const b = await abrirNavegador();
const HOJE = dataNoFuso(new Date().toISOString());
const DATA = proximaDataPermitida(HOJE, 3, CONFIG_PRECOS);

async function novaPagina(comPix = true) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 900 } });
  const p = await ctx.newPage();
  p.erros = [];
  p.on('console', (m) => m.type() === 'error' && p.erros.push(m.text()));
  p.on('pageerror', (e) => p.erros.push(e.message));
  if (comPix) await ctx.route('**/src/config/prime.js', (route) => route.fulfill({ path: 'src/config/prime.teste.js', contentType: 'text/javascript' }));
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  return p;
}

/** PIX, transferência e depósito; "Cartão de crédito" visível, desabilitado e "Em breve"; PIX marcado. */
async function confereFormaPagamento(p) {
  assert.equal(await p.locator('[data-campo=metodo]').count(), 1, 'grupo de forma de pagamento');
  assert.ok(await p.locator('input[name=metodo][value=pix]').isChecked(), 'PIX marcado');
  for (const f of ['transferencia', 'deposito']) assert.equal(await p.locator(`input[name=metodo][value=${f}]`).count(), 1, f);
  const cartao = p.locator('input[name=metodo][value=cartao]');
  assert.ok(await cartao.isDisabled(), 'cartão desabilitado');
  assert.match(await p.locator('label.opcao', { has: cartao }).textContent(), /Cartão de crédito.*Em breve/);
}

/** A cliente do seed (logada) solicita uma diária avulsa e a Prime confirma a disponibilidade: nasce a cobrança. */
async function criarPedido(p) {
  await p.goto(`${base}acompanhamento/`);
  await p.waitForSelector('h1');
  return p.evaluate(async ([raiz, data]) => {
    const { api } = await import(`${raiz}src/services/api.js`);
    const { definirSessao } = await import(`${raiz}src/services/sessao.js`);
    const { CLIENTE_RESIDENCIAL, CREDENCIAIS_MOCK } = await import(`${raiz}scripts/fixtures/seed.js`);
    const cli = CREDENCIAIS_MOCK.clientes[0];
    definirSessao({ ator: 'cliente', id: cli.id, nome: cli.nome });
    const r = await api.confirmarAutoagendamento({ cliente: CLIENTE_RESIDENCIAL, pacote: { tipoServico: 'residencial', duracaoHoras: 6, metragem: 70, quantidadeDiarias: 1, frequencia: 'avulso' }, primeiraData: data, turno: 'manha' }, { chave: crypto.randomUUID() });
    const d = await api.confirmarDisponibilidade(r.pedido.id, {}, { chave: crypto.randomUUID(), sessao: { ator: 'prime' } });
    return { cobranca: d.pagamentos[0].id, pedido: r.pedido.id, at: r.atendimentos[0].id, cliente: r.cliente.id, valor: d.pagamentos[0].valorCentavos, total: r.pedido.pacote.totalCentavos };
  }, [base, DATA]);
}

let p; let ids;
t.teste('cobrança integral: valor da diária inteira, prazo, chave, QR, copia e cola com CRC válido', async () => {
  p = await novaPagina();
  ids = await criarPedido(p);
  assert.equal(ids.valor, ids.total, 'diária cobrada inteira');
  await p.goto(`${base}pagamento/?pagamento=${ids.cobranca}`);
  await p.waitForSelector('[data-pix=ok]');
  assert.match(await p.locator('h1').textContent(), /Pagamento antecipado/);
  assert.match(await p.locator('.abertura .lead').textContent(), /antecipadamente e de forma integral\. Envie o comprovante até 14h de/);
  assert.equal(await p.locator('.valor-grande').getAttribute('data-valor'), String(ids.valor));
  assert.equal(await p.locator('#chave-pix').textContent(), '123e4567-e12b-12d1-a456-426655440000');
  assert.equal(await p.locator('.qr svg').count(), 1);
  const codigo = await p.locator('#copia-cola').textContent();
  const { crc16, lerTLV } = await import('../src/domain/brcode.js');
  assert.equal(crc16(codigo.slice(0, -4)), codigo.slice(-4));
  assert.equal(lerTLV(codigo)['54'], (ids.valor / 100).toFixed(2));
  await confereFormaPagamento(p);
  await p.setViewportSize({ width: 320, height: 900 });
  const ov = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await p.setViewportSize({ width: 390, height: 900 });
  assert.ok(ov <= 0, `overflow em 320px: ${ov}`);
});

t.teste('copiar código coloca o BR Code na área de transferência', async () => {
  await p.getByRole('button', { name: 'Copiar código Pix' }).click();
  const clip = await p.evaluate(() => navigator.clipboard.readText());
  assert.equal(clip, await p.locator('#copia-cola').textContent());
});

t.teste('"Já paguei" duas vezes (duplo clique + recarregar) informa uma vez só', async () => {
  await p.getByRole('button', { name: 'Já paguei' }).dblclick();
  await p.waitForSelector('button:has-text("Pagamento informado")');
  await p.reload();
  await p.waitForSelector('button:has-text("Pagamento informado")');
  assert.ok(await p.getByRole('button', { name: 'Pagamento informado' }).isDisabled());
  const n = await p.evaluate(async ([raiz, pid]) => {
    const { api } = await import(`${raiz}src/services/api.js`);
    const ev = await api.listarEventos({}, { sessao: { ator: 'prime' } });
    return ev.itens.filter((e) => e.tipo === 'pagamento_informado' && e.refs.pagamentoId === pid).length;
  }, [base, ids.cobranca]);
  assert.equal(n, 1);
});

t.teste('diária cancelada: a cobrança dela deixa de ser pagável (sem QR, com motivo)', async () => {
  const outro = await criarPedido(p);
  await p.evaluate(async ([raiz, o]) => {
    const { api } = await import(`${raiz}src/services/api.js`);
    await api.transicionarAtendimento(o.at, { evento: 'cancelar' }, { chave: crypto.randomUUID() });
  }, [base, outro]);
  await p.goto(`${base}pagamento/?pagamento=${outro.cobranca}`);
  await p.waitForSelector('.alerta-info');
  assert.match(await p.locator('.alerta-info').textContent(), /cancelada/i);
  assert.equal(await p.locator('[data-pix=ok]').count(), 0);
  assert.equal(await p.locator('[data-campo=metodo]').count(), 0, 'sem forma de pagamento quando não é pagável');
});

t.teste('confirmado pela Prime mostra sucesso e some o PIX', async () => {
  await p.evaluate(async ([raiz, ids]) => {
    const { api } = await import(`${raiz}src/services/api.js`);
    await api.confirmarPagamento(ids.cobranca, { chave: crypto.randomUUID(), sessao: { ator: 'prime' } });
  }, [base, ids]);
  await p.goto(`${base}pagamento/?pagamento=${ids.cobranca}`);
  await p.waitForSelector('.alerta-ok');
  assert.match(await p.locator('.alerta-ok').textContent(), /atendimento está confirmado/);
  assert.equal(await p.locator('[data-pix=ok]').count(), 0);
  assert.equal(await p.locator('[data-campo=metodo]').count(), 0, 'sem forma de pagamento depois de confirmado');
});

t.teste('id inexistente e pagamento de outra pessoa', async () => {
  await p.goto(`${base}pagamento/?pagamento=nao-existe`);
  await p.waitForSelector('h1'); assert.match(await p.locator('h1').textContent(), /Não encontramos/);
  const outra = await novaPagina();
  await outra.goto(`${base}pagamento/?pagamento=${ids.cobranca}`);
  await outra.waitForSelector('h1'); assert.match(await outra.locator('h1').textContent(), /Não encontramos/);
});

t.teste('config Pix incompleta (prime.js real): pedido existe, tela avisa, sem QR nem cobrança', async () => {
  const q = await novaPagina(false);
  const r = await criarPedido(q);
  await q.goto(`${base}pagamento/?pagamento=${r.cobranca}`);
  await q.waitForSelector('[data-pix=indisponivel]');
  assert.equal(await q.locator('.qr').count(), 0);
  assert.equal(await q.locator('#copia-cola').count(), 0);
  await confereFormaPagamento(q);
  assert.deepEqual(q.erros, []);
});

t.teste('sem overflow em 390px e sem erro no console', async () => {
  await p.goto(`${base}pagamento/?pagamento=${ids.cobranca}`); await p.waitForLoadState('networkidle');
  const ov = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(ov <= 0, `overflow ${ov}`);
  assert.deepEqual(p.erros, []);
});

const falhas = await t.fim();
await b.close(); await fechar();
process.exit(falhas ? 1 : 0);
