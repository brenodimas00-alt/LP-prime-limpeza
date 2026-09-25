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

const entrarCliente = async (ident, senha) => {
  await p.goto(`${base}entrar/`); await p.waitForSelector('#identificador');
  await p.fill('#identificador', ident); await p.fill('#senha', senha); await p.locator('form button[type=submit]').click();
};

t.teste('cliente: campo único CPF, e-mail ou celular; mensagem genérica; entra pelas 3 vias; vê a solicitação sem cobrança', async () => {
  await p.goto(`${base}entrar/`); await p.waitForSelector('#identificador');
  assert.equal(await p.locator('label[for=identificador]').textContent(), 'CPF, e-mail ou celular');
  assert.match(await p.locator('#dica-senha').textContent(), /Pelo e-mail ou celular, a senha são os 6 primeiros números do seu CPF\. Pelo CPF, é a sua data de nascimento \(só números\)\./);
  assert.equal(await p.getByRole('button', { name: 'Esqueci minha senha' }).count(), 0, 'esqueci virou dica');
  const cli = C.clientes[0];
  const msgs = [];
  for (const [ident, senha] of [[cli.email, 'errada'], [cli.cpf, cli.senha], ['39053344705', '01011990'], ['(31) 90000-1111', '123456']]) {
    await entrarCliente(ident, senha);
    await p.waitForSelector('.alerta-erro:not([hidden])');
    msgs.push(await p.locator('.alerta-erro').textContent());
  }
  assert.equal(new Set(msgs).size, 1, 'mesma mensagem pra qualquer falha'); assert.match(msgs[0], /Não conseguimos entrar com esses dados/);
  for (const [ident, senha] of [[cli.cpf, cli.senhaCpf], [cli.telefone, cli.senha], [cli.email, cli.senha]]) {
    await sair();
    await entrarCliente(ident, senha);
    await p.waitForURL('**/minha-conta/');
    await p.waitForSelector('[data-pedido]'); // página assentada antes de sair e navegar de novo
  }
  await p.waitForSelector('[data-pedido]');
  assert.equal(await p.locator('[data-pedido]').count(), 1, 'a cliente do seed tem 1 pedido');
  assert.match(await p.locator('[data-pedido]').textContent(), /Solicitação enviada/);
  assert.equal(await p.getByRole('link', { name: /^Pagar/ }).count(), 0, 'sem cobrança antes da disponibilidade');
});

t.teste('B2 (mock): trocar senha em Minha conta confere a atual (erro embaixo do campo) e a nova passa a valer pelas 3 vias', async () => {
  await p.goto(`${base}minha-conta/`); await p.waitForSelector('#trocar-senha');
  await p.locator('#trocar-senha summary').click();
  await p.fill('#atual', 'nao-e-essa'); await p.fill('#nova', 'curta'); await p.fill('#nova2', 'curta');
  await p.getByRole('button', { name: 'Trocar senha' }).click();
  assert.match(await p.locator('#nova-erro').textContent(), /pelo menos 8/);
  await p.fill('#nova', 'NovaDemo-2026'); await p.fill('#nova2', 'NovaDemo-2026');
  await p.getByRole('button', { name: 'Trocar senha' }).click();
  await p.waitForFunction(() => /não confere/.test(document.querySelector('#atual-erro')?.textContent || ''));
  await p.fill('#atual', C.clientes[0].senha);
  await p.getByRole('button', { name: 'Trocar senha' }).click();
  await p.waitForSelector('text=Senha trocada');
  await sair();
  await entrarCliente(C.clientes[0].email, C.clientes[0].senha);
  await p.waitForSelector('.alerta-erro:not([hidden])');
  await entrarCliente(C.clientes[0].cpf, 'NovaDemo-2026');
  await p.waitForURL('**/minha-conta/');
  await p.waitForSelector('[data-pedido]'); // página assentada antes do próximo teste navegar
});

t.teste('Prime: entra, painel mostra KPIs, atribui diarista, confirma pagamento informado, aprova cadastro com documentos', async () => {
  await sair();
  await p.goto(`${base}painel/entrar/`); await p.waitForSelector('#email');
  await p.fill('#email', C.prime[0].email); await p.fill('#senha', 'errada'); await p.locator('form button[type=submit]').click();
  await p.waitForSelector('.alerta-erro:not([hidden])');
  await p.fill('#senha', C.prime[0].senha); await p.locator('form button[type=submit]').click();
  await p.waitForURL('**/painel/'); await p.waitForSelector('.kpi');
  assert.equal(await p.locator('.kpi').count(), 6);
  // solicitações do seed: a Prime confirma a disponibilidade (nasce a cobrança integral)
  await p.goto(`${base}painel/?aba=solicitacoes`); await p.waitForSelector('[data-solicitacao]');
  assert.equal(await p.locator('[data-solicitacao]').count(), 2);
  const recusa = p.locator('[data-solicitacao]').first();
  await recusa.getByRole('button', { name: 'Recusar' }).click();
  assert.match(await recusa.locator('.erro-campo').textContent(), /motivo/, 'recusar exige motivo');
  for (let i = 0; i < 2; i++) {
    await p.locator('[data-solicitacao]').first().getByRole('button', { name: 'Confirmar disponibilidade' }).click();
    await p.waitForFunction((k) => document.querySelector('.kpi') && document.querySelectorAll('[data-solicitacao]').length === k, 1 - i);
  }
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
      const primeira = ped.pagamentos.find((g) => g.status === 'pendente');
      await api.informarPagamento(primeira.id, { chave: crypto.randomUUID(), sessao: { ator: 'cliente', id: ped.cliente.id } });
    }
  }, base);
  await p.goto(`${base}painel/?aba=pagamentos`); await p.waitForSelector('[data-pagamento]');
  const n = await p.locator('[data-tabela=informados] button').count();
  assert.equal(n, 2, 'duas cobranças informadas');
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

t.teste('GPT#6: quem se cadastrou na demonstração consegue entrar (diarista nova com a senha de demonstração; cliente nova pela regra padrão)', async () => {
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
    await api.confirmarAutoagendamento({ cliente: c, pacote: { tipoServico: 'empresarial', duracaoHoras: 4, metragem: 60, quantidadeDiarias: 2, frequencia: 'semanal' }, primeiraData: data, turno: 'manha' }, { chave: crypto.randomUUID(), sessao: { ator: 'publico' } });
    localStorage.removeItem('prime.sessao');
    return c.telefone;
  }, base);
  // empresa nova: pelo e-mail, os 6 primeiros caracteres do CNPJ (sem senha criada no agendamento)
  await entrarCliente('nova.empresa@exemplo.com', '112223');
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
