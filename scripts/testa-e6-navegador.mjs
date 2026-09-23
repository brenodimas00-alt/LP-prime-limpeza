// E6 no navegador: login das 3 áreas (mock), minha conta, agenda da diarista, painel da Prime, 404, guardas de rota.
import { criarSuite, assert } from './lib-teste.mjs';
import { abrirNavegador, subirServidor } from './pw.mjs';
import { CREDENCIAIS_MOCK } from './fixtures/seed.js';

const t = criarSuite('E6 navegador (login e áreas)');
const { base, fechar } = await subirServidor();
const b = await abrirNavegador();
const ctx = await b.newContext({ viewport: { width: 390, height: 900 } });
await ctx.route('**/src/config/prime.js', (route) => route.fulfill({ path: 'src/config/prime.teste.js', contentType: 'text/javascript' }));
const p = await ctx.newPage();
const erros = [];
p.on('console', (m) => m.type() === 'error' && erros.push(m.text()));
p.on('pageerror', (e) => erros.push(e.message));
const C = CREDENCIAIS_MOCK;
const sair = async () => { await p.evaluate(() => localStorage.removeItem('prime.sessao')); };

t.teste('guardas: áreas sem sessão redirecionam pra entrada', async () => {
  for (const [u, dest] of [['minha-conta/', 'entrar/'], ['diarista/agenda/', 'diarista/entrar/'], ['painel/', 'painel/entrar/']]) {
    await p.goto(base + u); await p.waitForURL(`**/${dest}`);
  }
});

t.teste('cliente: e-mail ou senha errados dão mensagem; certos entram e mostram o pedido e a entrada pendente', async () => {
  await p.goto(`${base}entrar/`); await p.waitForSelector('#email');
  await p.fill('#email', C.clientes[0].email); await p.fill('#senha', 'errada123'); await p.locator('form button[type=submit]').click();
  await p.waitForSelector('.alerta-erro:not([hidden])');
  assert.match(await p.locator('.alerta-erro').textContent(), /E-mail ou senha incorretos/);
  await p.fill('#senha', C.clientes[0].senha); await p.locator('form button[type=submit]').click();
  await p.waitForURL('**/minha-conta/');
  await p.waitForSelector('[data-pedido]');
  assert.equal(await p.locator('[data-pedido]').count(), 1, 'a cliente do seed tem 1 pedido');
  assert.ok(await p.getByRole('link', { name: /Pagar no Pix/ }).isVisible(), 'entrada pendente aparece');
});

t.teste('Prime: entra, painel mostra KPIs, atribui diarista, confirma pagamento informado, aprova cadastro com documentos', async () => {
  await sair();
  await p.goto(`${base}painel/entrar/`); await p.waitForSelector('#email');
  await p.fill('#email', C.prime[0].email); await p.fill('#senha', 'errada'); await p.locator('form button[type=submit]').click();
  await p.waitForSelector('.alerta-erro:not([hidden])');
  await p.fill('#senha', C.prime[0].senha); await p.locator('form button[type=submit]').click();
  await p.waitForURL('**/painel/'); await p.waitForSelector('.kpi');
  assert.equal(await p.locator('.kpi').count(), 5);
  // atribuir
  await p.goto(`${base}painel/?aba=atribuir`); await p.waitForSelector('table.painel');
  const linha = p.locator('table.painel tbody tr').first();
  await linha.locator('select').selectOption({ index: 1 });
  await linha.getByRole('button', { name: 'Atribuir' }).click();
  await p.waitForFunction(() => document.querySelector('table.painel tbody tr td:nth-child(4)')?.textContent.trim() !== '—');
  // pagamentos: nenhum informado ainda -> informa como cliente pela API e confirma
  await p.evaluate(async (raiz) => {
    const { api } = await import(`${raiz}src/services/api.js`);
    const { itens } = await api.listarPedidos({}, { sessao: { ator: 'prime' } });
    for (const it of itens) {
      const ped = await api.obterPedido(it.id, { sessao: { ator: 'prime' } });
      const entrada = ped.pagamentos.find((g) => g.parcela === 'entrada');
      await api.informarPagamento(entrada.id, { chave: crypto.randomUUID(), sessao: { ator: 'cliente', id: ped.cliente.id } });
    }
  }, base);
  await p.goto(`${base}painel/?aba=pagamentos`); await p.waitForSelector('[data-pagamento]');
  const n = await p.locator('[data-tabela=informados] button').count();
  assert.equal(n, 2, 'duas entradas informadas');
  for (let i = 0; i < n; i++) {
    await p.locator('[data-tabela=informados] button').first().click();
    await p.waitForFunction((k) => { const t = document.querySelector('[data-tabela=informados]'); return document.querySelector('.kpi') && (!t || t.querySelectorAll('button').length === k); }, n - 1 - i);
  }
  // cadastros: a pendente do seed, ver documentos (nenhum no seed) e reprovar sem motivo bloqueia; aprovar
  await p.goto(`${base}painel/?aba=cadastros`); await p.waitForSelector('[data-diarista]');
  const pendente = p.locator('.cartao.principal[data-diarista]').first();
  await pendente.getByRole('button', { name: 'Reprovar' }).click();
  assert.match(await pendente.locator('.erro-campo').textContent(), /motivo/);
  await pendente.getByRole('button', { name: 'Aprovar cadastro' }).click();
  await p.waitForFunction(() => document.querySelectorAll('.cartao.principal[data-diarista]').length === 0);
  // avaliações e notificações abrem
  await p.goto(`${base}painel/?aba=notificacoes`); await p.waitForSelector('#lista-notificacoes');
  assert.ok(await p.locator('#lista-notificacoes [data-template=atendimento_atribuido]').count() >= 1);
  await p.goto(`${base}painel/?aba=avaliacoes`); await p.waitForSelector('table.painel');
});

t.teste('diarista aprovada: agenda mostra a diária atribuída e avança a caminho -> iniciei -> finalizei', async () => {
  await sair();
  await p.goto(`${base}diarista/entrar/`); await p.waitForSelector('#email');
  await p.fill('#email', C.diaristas[0].email); await p.fill('#senha', C.diaristas[0].senha); await p.locator('form button[type=submit]').click();
  await p.waitForURL('**/diarista/agenda/'); await p.waitForSelector('[data-atendimento]');
  for (const [nome, status] of [['Estou a caminho', 'diarista_a_caminho'], ['Iniciei a diária', 'em_andamento']]) {
    await p.getByRole('button', { name: nome }).first().click();
    await p.waitForSelector(`[data-atendimento][data-status=${status}]`);
  }
  await p.getByRole('button', { name: 'Finalizei' }).first().click();
  await p.waitForSelector('h2:has-text("Realizadas")');
});

t.teste('diarista pendente (segundo cadastro) vê o status, não a agenda', async () => {
  await sair();
  // deixa a segunda diarista pendente de novo? Ela foi aprovada acima; cadastra uma nova pendente pela API
  const id = await p.evaluate(async (raiz) => {
    const { api } = await import(`${raiz}src/services/api.js`);
    const { DIARISTA_PENDENTE } = await import(`${raiz}scripts/fixtures/seed.js`);
    const id = crypto.randomUUID();
    const png = await (await fetch(`${raiz}scripts/fixtures/foto-ficticia.png`)).blob();
    for (const tipo of ['cnh_frente', 'cnh_verso', 'comprovante_residencia', 'foto_perfil', 'antecedentes']) await api.salvarDocumento({ diaristaId: id, tipo, nomeArquivo: `${tipo}.png`, mime: 'image/png', tamanho: png.size, conteudo: png }, { chave: crypto.randomUUID(), sessao: { ator: 'publico' } });
    await api.cadastrarDiarista({ id, ...DIARISTA_PENDENTE, cpf: '39053344705', email: 'nova.pendente@exemplo.com', identidade: 'cnh', aceiteTermos: true }, { chave: crypto.randomUUID(), sessao: { ator: 'publico' } });
    localStorage.setItem('prime.sessao', JSON.stringify({ ator: 'diarista', id, nome: 'Nova' }));
    return id;
  }, base);
  await p.goto(`${base}diarista/agenda/`); await p.waitForSelector('[data-cadastro=pendente]');
  assert.match(await p.locator('[data-cadastro=pendente]').textContent(), /em análise/);
  assert.ok(id);
});

t.teste('GPT#6: quem se cadastrou na demonstração consegue entrar (diarista nova com a senha de demonstração; cliente nova com a senha criada no agendamento)', async () => {
  await sair();
  await p.goto(`${base}diarista/entrar/`); await p.waitForSelector('#email');
  await p.fill('#email', 'nova.pendente@exemplo.com'); await p.fill('#senha', 'diarista123'); await p.locator('form button[type=submit]').click();
  await p.waitForURL('**/diarista/agenda/'); await p.waitForSelector('[data-cadastro=pendente]');
  await sair();
  const tel = await p.evaluate(async (raiz) => {
    const { api } = await import(`${raiz}src/services/api.js`);
    const { CLIENTE_EMPRESA } = await import(`${raiz}scripts/fixtures/seed.js`);
    const { proximaDataPermitida } = await import(`${raiz}scripts/fixtures/seed.js`);
    const { CONFIG_PRECOS } = await import(`${raiz}src/config/precos.js`);
    const { dataNoFuso } = await import(`${raiz}src/domain/calendario.js`);
    const c = { ...CLIENTE_EMPRESA, telefone: '31933332222', cnpj: '11222333000181', email: 'nova.empresa@exemplo.com' };
    let data = proximaDataPermitida(dataNoFuso(new Date().toISOString()), 3, CONFIG_PRECOS);
    await api.confirmarAutoagendamento({ cliente: c, pacote: { tipoServico: 'empresarial', duracaoHoras: 4, metragem: 60, quantidadeDiarias: 2, frequencia: 'semanal' }, primeiraData: data, turno: 'manha', conta: { senhaHash: await (await import(`${raiz}src/services/auth.js`)).hashSenha('empresa1234') } }, { chave: crypto.randomUUID(), sessao: { ator: 'publico' } });
    localStorage.removeItem('prime.sessao');
    return c.telefone;
  }, base);
  await p.goto(`${base}entrar/`); await p.waitForSelector('#email');
  await p.fill('#email', 'nova.empresa@exemplo.com'); await p.fill('#senha', 'empresa1234'); await p.locator('form button[type=submit]').click();
  await p.waitForURL('**/minha-conta/', { timeout: 8000 }).catch(async () => { throw new Error(`não entrou: ${await p.locator('.alerta-erro, .erro-campo').allTextContents()} | ${tel}`); }); await p.waitForSelector('[data-pedido]');
});

t.teste('404 no padrão e com links internos', async () => {
  await p.goto(`${base}nao-existe/`); await p.waitForSelector('.abertura h1');
  assert.match(await p.locator('.abertura h1').textContent(), /não existe/);
  assert.ok((await p.locator('a[href*="autoagendamento/"]').count()) >= 1);
});

t.teste('sem overflow em 390px nas áreas e sem erro no console', async () => {
  await sair();
  await p.evaluate((c) => localStorage.setItem('prime.sessao', JSON.stringify({ ator: 'prime', id: c.id, nome: c.nome })), C.prime[0]);
  for (const u of ['painel/', 'painel/?aba=cadastros', 'entrar/', 'diarista/entrar/', 'painel/entrar/']) {
    await p.goto(base + u); await p.waitForLoadState('networkidle');
    const ov = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(ov <= 0, `${u} overflow ${ov}`);
  }
  assert.deepEqual(erros.filter((e) => !/404/.test(e)), [], JSON.stringify(erros));
});

const falhas = await t.fim();
await b.close(); await fechar();
process.exit(falhas ? 1 : 0);
