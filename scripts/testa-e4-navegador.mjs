// E4 no navegador: tela de Pix (entrada e parcela do dia), elegibilidade, "Já paguei" idempotente, config incompleta.
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

/** Cria um pedido avulso pela API do mock, como cliente, e devolve ids. */
async function criarPedido(p) {
  await p.goto(`${base}acompanhamento/`);
  await p.waitForSelector('h1');
  return p.evaluate(async ([raiz, data]) => {
    const { api } = await import(`${raiz}src/services/api.js`);
    const { definirSessao } = await import(`${raiz}src/services/sessao.js`);
    const { CLIENTE_RESIDENCIAL } = await import(`${raiz}scripts/fixtures/seed.js`);
    const r = await api.confirmarAutoagendamento({ cliente: CLIENTE_RESIDENCIAL, pacote: { tipoServico: 'residencial', duracaoHoras: 6, metragem: 70, quantidadeDiarias: 1, frequencia: 'avulso' }, primeiraData: data, turno: 'manha' , conta: { senhaHash: (await import(`${raiz}scripts/fixtures/seed.js`)).SENHA_CLIENTE_DEMO_HASH } }, { chave: crypto.randomUUID() });
    definirSessao({ ator: 'cliente', id: r.cliente.id });
    return { entrada: r.pagamentoEntradaId, dia: r.pagamentos.find((x) => x.parcela === 'dia').id, pedido: r.pedido.id, at: r.atendimentos[0].id, cliente: r.cliente.id, valorEntrada: r.pedido.pacote.entradaCentavos };
  }, [base, DATA]);
}

let p; let ids;
t.teste('entrada: valor, chave, QR, copia e cola com CRC válido e valor certo', async () => {
  p = await novaPagina();
  ids = await criarPedido(p);
  await p.goto(`${base}pagamento/?pagamento=${ids.entrada}`);
  await p.waitForSelector('[data-pix=ok]');
  assert.equal(await p.locator('.valor-grande').getAttribute('data-valor'), String(ids.valorEntrada));
  assert.equal(await p.locator('#chave-pix').textContent(), '123e4567-e12b-12d1-a456-426655440000');
  assert.equal(await p.locator('.qr svg').count(), 1);
  const codigo = await p.locator('#copia-cola').textContent();
  const { crc16, lerTLV } = await import('../src/domain/brcode.js');
  assert.equal(crc16(codigo.slice(0, -4)), codigo.slice(-4));
  assert.equal(lerTLV(codigo)['54'], (ids.valorEntrada / 100).toFixed(2));
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
  }, [base, ids.entrada]);
  assert.equal(n, 1);
});

t.teste('parcela do dia de atendimento agendado não é pagável (sem QR, com motivo)', async () => {
  await p.goto(`${base}pagamento/?pagamento=${ids.dia}`);
  await p.waitForSelector('.alerta-info');
  assert.match(await p.locator('.alerta-info').textContent(), /diarista estiver a caminho/);
  assert.equal(await p.locator('[data-pix=ok]').count(), 0);
});

t.teste('parcela de atendimento AVALIADO continua pagável', async () => {
  await p.evaluate(async ([raiz, ids]) => {
    const { api } = await import(`${raiz}src/services/api.js`);
    const PRIME = { sessao: { ator: 'prime' } };
    const k = () => ({ chave: crypto.randomUUID() });
    const { itens } = await api.listarDiaristas({ status: 'aprovada' }, PRIME);
    const d = itens[0].id;
    await api.confirmarPagamento(ids.entrada, { ...k(), ...PRIME });
    await api.atribuirDiarista(ids.at, { diaristaId: d }, { ...k(), ...PRIME });
    const sd = { sessao: { ator: 'diarista', id: d } };
    for (const evento of ['sair_a_caminho', 'iniciar', 'finalizar']) await api.transicionarAtendimento(ids.at, { evento }, { ...k(), ...sd });
    await api.criarAvaliacao(ids.at, { notas: { pontualidade: 5, qualidade: 5, cuidado: 5, comunicacao: 5 } }, { ...k(), sessao: { ator: 'cliente', id: ids.cliente } });
  }, [base, ids]);
  await p.goto(`${base}pagamento/?pagamento=${ids.dia}`);
  await p.waitForSelector('[data-pix=ok]');
  assert.match(await p.locator('h1').textContent(), /Parcela da diária/);
  await p.getByRole('button', { name: 'Já paguei' }).click();
  await p.waitForSelector('button:has-text("Pagamento informado")');
});

t.teste('entrada confirmada mostra sucesso e some o Pix', async () => {
  await p.goto(`${base}pagamento/?pagamento=${ids.entrada}`);
  await p.waitForSelector('.alerta-ok');
  assert.equal(await p.locator('[data-pix=ok]').count(), 0);
});

t.teste('id inexistente e pagamento de outra pessoa', async () => {
  await p.goto(`${base}pagamento/?pagamento=nao-existe`);
  await p.waitForSelector('h1'); assert.match(await p.locator('h1').textContent(), /Não encontramos/);
  const outra = await novaPagina();
  await outra.goto(`${base}pagamento/?pagamento=${ids.entrada}`);
  await outra.waitForSelector('h1'); assert.match(await outra.locator('h1').textContent(), /Não encontramos/);
});

t.teste('config Pix incompleta (prime.js real): pedido existe, tela avisa, sem QR nem cobrança', async () => {
  const q = await novaPagina(false);
  const r = await criarPedido(q);
  await q.goto(`${base}pagamento/?pagamento=${r.entrada}`);
  await q.waitForSelector('[data-pix=indisponivel]');
  assert.equal(await q.locator('.qr').count(), 0);
  assert.equal(await q.locator('#copia-cola').count(), 0);
  assert.deepEqual(q.erros, []);
});

t.teste('sem overflow em 390px e sem erro no console', async () => {
  await p.goto(`${base}pagamento/?pagamento=${ids.dia}`); await p.waitForLoadState('networkidle');
  const ov = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(ov <= 0, `overflow ${ov}`);
  assert.deepEqual(p.erros, []);
});

const falhas = await t.fim();
await b.close(); await fechar();
process.exit(falhas ? 1 : 0);
