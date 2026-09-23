// F0: correções urgentes do front. node scripts/testa-f0-navegador.mjs [--shots]
// a) nenhum passo avança vazio ou inválido (agendamento, cadastro de diarista, as três entradas), erro embaixo do campo, foco no 1º erro;
// b) stepper: atual azul com barra, concluídas clicáveis com check, futuras cinza;
// c) login da cliente por e-mail e senha, "Esqueci minha senha", "Entrar com Google", sem WhatsApp;
// d) header: Entrar secundário com ícone e divisor, "Minha conta" logado, ícone no celular;
// e) logo carregado (naturalWidth > 0) em todas as páginas, com base do GitHub Pages, na raiz e sem barra final;
// f) nenhum link pro site antigo; cards abrem o agendamento com o serviço.
import { readFileSync, mkdirSync } from 'node:fs';
import { criarSuite, assert } from './lib-teste.mjs';
import { abrirNavegador } from './pw.mjs';
import { CREDENCIAIS_MOCK as C, proximaDataPermitida } from './fixtures/seed.js';
import { dataNoFuso, diaDaSemana } from '../src/domain/calendario.js';
import { CONFIG_PRECOS } from '../src/config/precos.js';

const SHOTS = process.argv.includes('--shots');
const t = criarSuite('F0 navegador (validação, stepper, login, header, logo, links)');

async function subir(raiz) {
  const antes = process.env.RAIZ;
  process.env.RAIZ = raiz ? '1' : '';
  const { criarServidor: cs } = await import(`./serve.mjs?raiz=${raiz ? 1 : 0}`);
  const srv = cs();
  await new Promise((r) => srv.listen(0, r));
  process.env.RAIZ = antes;
  return { srv, base: `http://localhost:${srv.address().port}${raiz ? '/' : '/LP-prime-limpeza/'}` };
}
const gh = await subir(false);
const cf = await subir(true);
const base = gh.base;
const b = await abrirNavegador();
let DATA = proximaDataPermitida(dataNoFuso(new Date().toISOString()), 3, CONFIG_PRECOS);
while (diaDaSemana(DATA) === 6 || CONFIG_PRECOS.feriados.includes(DATA)) DATA = proximaDataPermitida(DATA, 1, CONFIG_PRECOS);

async function contexto(largura = 390) {
  const ctx = await b.newContext({ viewport: { width: largura, height: 900 }, reducedMotion: 'reduce' });
  await ctx.route('https://viacep.com.br/**', (route) => {
    const cep = route.request().url().match(/ws\/(\d{8})/)[1];
    if (cep === '99999999') return route.abort();
    return route.fulfill({ json: cep === '00000001' ? { erro: true } : { logradouro: 'Rua Fictícia', bairro: 'Savassi', localidade: 'Belo Horizonte', uf: 'MG' } });
  });
  await ctx.route('**/src/config/prime.js', (route) => route.fulfill({ path: 'src/config/prime.teste.js', contentType: 'text/javascript' }));
  const p = await ctx.newPage();
  p.erros = [];
  p.on('console', (m) => m.type() === 'error' && !/viacep/.test(m.location()?.url || '') && p.erros.push(m.text()));
  p.on('pageerror', (e) => p.erros.push(e.message));
  return p;
}
const marcar = (p, sel) => p.locator(sel).evaluate((i) => { if (!i.checked) i.click(); });
const continuar = (p) => p.getByRole('button', { name: 'Continuar' }).click();
const titulo = (p) => p.locator('#titulo-passo').textContent();
const focoId = (p) => p.evaluate(() => document.activeElement?.id || document.activeElement?.name || '');
async function errosVisiveis(p) {
  return p.evaluate(() => [...document.querySelectorAll('.erro-campo')].filter((e) => e.textContent.trim()).map((e) => e.closest('[data-campo]')?.dataset.campo));
}

// ---------------- a) agendamento: cada passo vazio e inválido ----------------
let pa;
t.teste('agendamento passo 1 vazio: não avança, erro no campo, foco nele; empresa sem CNPJ/razão/responsável também não', async () => {
  pa = await contexto();
  await pa.goto(`${base}autoagendamento/`); await pa.waitForSelector('#titulo-passo');
  await continuar(pa);
  assert.match(await titulo(pa), /Quem contrata/);
  assert.deepEqual(await errosVisiveis(pa), ['tipo']);
  assert.equal(await focoId(pa), 'tipo');
  await marcar(pa, 'input[name=tipo][value=empresa]');
  await continuar(pa);
  assert.deepEqual((await errosVisiveis(pa)).sort(), ['cnpj', 'razaoSocial', 'responsavel']);
  assert.equal(await focoId(pa), 'cnpj');
  await pa.fill('#cnpj', '11.222.333/0001-80'); await continuar(pa);
  assert.match(await pa.locator('[data-campo=cnpj] .erro-campo').textContent(), /CNPJ inválido/);
  await marcar(pa, 'input[name=tipo][value=residencial]'); await continuar(pa);
  assert.match(await titulo(pa), /Endereço/);
});

t.teste('agendamento passo 2 vazio: todos os campos menos Complemento acusam; CEP incompleto e CEP inexistente; ViaCEP fora libera manual', async () => {
  await continuar(pa);
  assert.match(await titulo(pa), /Endereço/);
  assert.deepEqual((await errosVisiveis(pa)).sort(), ['bairro', 'cep', 'cidade', 'logradouro', 'numero']);
  assert.equal(await focoId(pa), 'cep');
  await pa.fill('#cep', '3013'); await continuar(pa);
  assert.match(await pa.locator('[data-campo=cep] .erro-campo').textContent(), /8 dígitos/);
  await pa.fill('#cep', '00000-001');
  await pa.waitForFunction(() => /não encontrado/.test(document.querySelector('[data-campo=cep] .erro-campo').textContent));
  await pa.fill('#cep', '99999-999');
  await pa.waitForFunction(() => /à mão/.test(document.querySelector('[role=status].ajuda')?.textContent || ''));
  assert.ok(await pa.locator('#logradouro').isEditable(), 'preenchimento manual liberado');
  await pa.fill('#cep', '30130-010');
  await pa.waitForFunction(() => document.querySelector('#cidade').value === 'Belo Horizonte');
  await continuar(pa);
  assert.deepEqual(await errosVisiveis(pa), ['numero'], 'só o número falta; complemento é opcional');
  await pa.fill('#numero', '100'); await continuar(pa);
  assert.match(await titulo(pa), /Monte sua/);
});

t.teste('ViaCEP: resposta atrasada de um CEP antigo não sobrescreve o endereço do CEP novo', async () => {
  const p = await contexto();
  let liberar;
  await p.route('https://viacep.com.br/ws/30130010/json/', async (route) => { await new Promise((r) => { liberar = r; }); route.fulfill({ json: { logradouro: 'Rua Velha', bairro: 'Velho', localidade: 'Belo Horizonte', uf: 'MG' } }); });
  await p.route('https://viacep.com.br/ws/30140071/json/', (route) => route.fulfill({ json: { logradouro: 'Rua Nova', bairro: 'Funcionários', localidade: 'Belo Horizonte', uf: 'MG' } }));
  await p.goto(`${base}autoagendamento/`); await p.waitForSelector('#titulo-passo');
  await marcar(p, 'input[name=tipo][value=residencial]'); await continuar(p);
  await p.fill('#cep', '30130-010');
  await p.fill('#cep', '30140-071');
  await p.waitForFunction(() => document.querySelector('#logradouro').value === 'Rua Nova');
  liberar(); await p.waitForTimeout(300);
  assert.equal(await p.inputValue('#logradouro'), 'Rua Nova');
});

t.teste('agendamento passo 3 vazio: metragem e duração obrigatórias; metragem inválida', async () => {
  await pa.evaluate(() => document.querySelectorAll('input[name=duracaoHoras]').forEach((i) => { i.checked = false; }));
  await pa.fill('#metragem', '');
  await pa.evaluate(() => document.querySelectorAll('input[name=duracaoHoras]').forEach((i) => { i.checked = false; }));
  await continuar(pa);
  assert.match(await titulo(pa), /Monte sua/);
  assert.ok((await errosVisiveis(pa)).includes('metragem'));
  assert.equal(await focoId(pa), 'metragem');
  await pa.fill('#metragem', '5'); await continuar(pa);
  assert.match(await pa.locator('[data-campo=metragem] .erro-campo').textContent(), /entre 10/);
  await pa.fill('#metragem', '70');
  await marcar(pa, 'input[name=duracaoHoras][value="4"]');
  await continuar(pa);
  assert.match(await titulo(pa), /Escolha o dia/);
});

t.teste('agendamento passo 4 vazio: data e período obrigatórios; domingo recusado', async () => {
  await continuar(pa);
  assert.deepEqual((await errosVisiveis(pa)).sort(), ['primeiraData', 'turno']);
  assert.equal(await focoId(pa), 'primeiraData');
  let dom = DATA; while (diaDaSemana(dom) !== 0) dom = new Date(Date.parse(`${dom}T12:00:00Z`) + 86400e3).toISOString().slice(0, 10);
  await pa.fill('#primeiraData', dom); await marcar(pa, 'input[name=turno][value=manha]'); await continuar(pa);
  assert.match(await pa.locator('[data-campo=primeiraData] .erro-campo').textContent(), /domingo/);
  await pa.fill('#primeiraData', DATA); await continuar(pa);
  assert.match(await titulo(pa), /Seus contatos/);
});

t.teste('agendamento passo 5 vazio: nome, WhatsApp, e-mail, senha e confirmação obrigatórios (CPF é opcional); senha curta e diferente', async () => {
  await continuar(pa);
  { const e = (await errosVisiveis(pa)).sort(); assert.deepEqual(e, ['email', 'nome', 'senha', 'senha2', 'telefone'], JSON.stringify(e)); }
  assert.equal(await focoId(pa), 'nome');
  await pa.fill('#nome', 'Ana Teste Fictícia'); await pa.fill('#telefone', '31988887777'); await pa.fill('#email', 'nova.cliente@exemplo.com');
  await pa.fill('#senha', '1234567'); await pa.fill('#senha2', '1234567'); await continuar(pa);
  assert.match(await pa.locator('[data-campo=senha] .erro-campo').textContent(), /8 caracteres/);
  await pa.fill('#senha', 'senhaboa123'); await pa.fill('#senha2', 'senhaboa124'); await continuar(pa);
  assert.match(await pa.locator('[data-campo=senha2] .erro-campo').textContent(), /não são iguais/);
  await pa.fill('#senha2', 'senhaboa123'); await continuar(pa);
  assert.match(await titulo(pa), /Confira/);
});

t.teste('stepper: atual com barra azul, concluídas com check e clicáveis, futuras sem botão', async () => {
  const info = await pa.evaluate(() => {
    const li = [...document.querySelectorAll('.etapas li')];
    const atual = document.querySelector('.etapas li.atual');
    return {
      estados: li.map((x) => x.className), botoes: li.map((x) => !!x.querySelector('button.etapa')), checks: li.map((x) => !!x.querySelector('.num svg')),
      barra: getComputedStyle(atual, '::after').height, corBarra: getComputedStyle(atual, '::after').backgroundColor, corAtual: getComputedStyle(atual.querySelector('.num')).color,
    };
  });
  assert.deepEqual(info.estados, ['feita', 'feita', 'feita', 'feita', 'feita', 'atual'], JSON.stringify(info));
  assert.deepEqual(info.botoes, [true, true, true, true, true, false]);
  assert.deepEqual(info.checks, [true, true, true, true, true, false]);
  assert.equal(info.barra, '3px'); assert.equal(info.corBarra, 'rgb(42, 36, 86)'); assert.equal(info.corAtual, 'rgb(42, 36, 86)');
  await pa.locator('.etapas li[data-etapa="3"] button').click();
  assert.match(await titulo(pa), /Monte sua/);
  assert.equal(await pa.locator('.etapas li.futura').count(), 3);
  if (SHOTS) {
    mkdirSync('docs/shots/f0', { recursive: true });
    await pa.setViewportSize({ width: 375, height: 900 }); await pa.waitForTimeout(200);
    await pa.locator('.etapas').screenshot({ path: 'docs/shots/f0/stepper-375.png' });
    await pa.setViewportSize({ width: 1440, height: 900 }); await pa.waitForTimeout(200);
    await pa.locator('.etapas').screenshot({ path: 'docs/shots/f0/stepper-1440.png' });
    await pa.setViewportSize({ width: 390, height: 900 });
  }
});

// ---------------- a) cadastro de diarista ----------------
t.teste('cadastro de diarista: passos 1, 2 e 3 vazios não avançam e acusam cada campo', async () => {
  const p = await contexto();
  await p.goto(`${base}diarista/cadastro/`); await p.waitForSelector('#titulo-passo');
  await continuar(p);
  assert.deepEqual((await errosVisiveis(p)).sort(), ['cpf', 'dataNascimento', 'email', 'nome', 'telefone']);
  assert.equal(await focoId(p), 'nome');
  await p.fill('#nome', 'Maria Teste'); await p.fill('#cpf', '111.444.777-35'); await p.fill('#dataNascimento', '1985-04-12'); await p.fill('#telefone', '31966665555'); await p.fill('#email', 'x@');
  await continuar(p);
  assert.deepEqual(await errosVisiveis(p), ['email']);
  await p.fill('#email', 'maria.f0@exemplo.com'); await continuar(p);
  await p.waitForFunction(() => /Onde você mora/.test(document.querySelector('#titulo-passo').textContent));
  await continuar(p);
  assert.deepEqual((await errosVisiveis(p)).sort(), ['bairro', 'cep', 'cidade', 'logradouro', 'numero']);
  await p.fill('#cep', '30130-010'); await p.waitForFunction(() => document.querySelector('#cidade').value === 'Belo Horizonte');
  await p.fill('#numero', '45'); await continuar(p);
  await p.waitForFunction(() => /Experiência/.test(document.querySelector('#titulo-passo').textContent));
  await continuar(p);
  assert.deepEqual((await errosVisiveis(p)).sort(), ['dias', 'experienciaAnos', 'regioes', 'turnos']);
  assert.deepEqual(p.erros, []);
});

// ---------------- a/c) entradas ----------------
t.teste('entradas (cliente, diarista, Prime): vazio e e-mail inválido não enviam; erro embaixo de cada campo', async () => {
  const p = await contexto();
  for (const u of ['entrar/', 'diarista/entrar/', 'painel/entrar/']) {
    await p.goto(base + u); await p.waitForSelector('#email');
    await p.locator('form button[type=submit]').click();
    assert.deepEqual((await errosVisiveis(p)).sort(), ['email', 'senha'], u);
    assert.equal(await focoId(p), 'email');
    await p.fill('#email', 'semarroba'); await p.fill('#senha', 'x'); await p.locator('form button[type=submit]').click();
    assert.deepEqual(await errosVisiveis(p), ['email'], u);
    assert.ok(await p.locator('.alerta-erro').isHidden(), `${u}: não chegou a tentar entrar`);
  }
});

t.teste('login da cliente: "Entre na sua conta", e-mail e senha, esqueci a senha, Google; sem WhatsApp na tela', async () => {
  const p = await contexto(1440);
  await p.goto(`${base}entrar/`); await p.waitForSelector('#email');
  assert.match(await p.locator('.abertura h1').textContent(), /Entre na sua conta/);
  assert.ok(!/WhatsApp/i.test(await p.locator('main').textContent()), 'nada de WhatsApp no login');
  assert.ok(await p.getByRole('button', { name: 'Esqueci minha senha' }).isVisible());
  assert.ok(await p.getByRole('button', { name: 'Entrar com Google' }).isVisible());
  if (SHOTS) await p.screenshot({ path: 'docs/shots/f0/login-1440.png' });
  await p.fill('#email', C.clientes[0].email); await p.fill('#senha', 'errada123'); await p.locator('form button[type=submit]').click();
  await p.waitForSelector('.alerta-erro:not([hidden])');
  await p.fill('#senha', C.clientes[0].senha); await p.locator('form button[type=submit]').click();
  await p.waitForURL('**/minha-conta/');
  // logado: header vira "Minha conta"
  assert.equal((await p.locator('[data-conta=header]').textContent()).trim(), 'Minha conta');
  await p.goto(base); await p.waitForLoadState('networkidle');
  assert.equal((await p.locator('[data-conta=header] span').textContent()).trim(), 'Minha conta', 'home também troca');
  assert.match(await p.locator('[data-conta=header]').getAttribute('href'), /minha-conta\//);
  await p.evaluate(() => localStorage.removeItem('prime.sessao'));
  await p.goto(`${base}entrar/?modo=recuperar`); await p.waitForSelector('#email');
  await p.fill('#email', 'qualquer@exemplo.com'); await p.getByRole('button', { name: 'Enviar link' }).click();
  await p.waitForSelector('.alerta-info:not([hidden])');
  const q = await contexto(375);
  await q.goto(`${base}entrar/`); await q.waitForSelector('#email');
  if (SHOTS) await q.screenshot({ path: 'docs/shots/f0/login-375.png', fullPage: true });
});

t.teste('e-mail que já tem conta (outra senha): volta pro passo 5 com o erro embaixo do e-mail', async () => {
  const p = await contexto();
  await p.goto(`${base}autoagendamento/`); await p.waitForSelector('#titulo-passo');
  await marcar(p, 'input[name=tipo][value=residencial]'); await continuar(p);
  await p.fill('#cep', '30130-010'); await p.waitForFunction(() => document.querySelector('#cidade').value === 'Belo Horizonte');
  await p.fill('#numero', '1'); await continuar(p);
  await p.fill('#metragem', '40'); await continuar(p);
  await p.fill('#primeiraData', DATA); await marcar(p, 'input[name=turno][value=manha]'); await continuar(p);
  await p.fill('#nome', 'Ana Teste'); await p.fill('#telefone', '31988887777'); await p.fill('#email', C.clientes[0].email);
  await p.fill('#senha', 'outrasenha1'); await p.fill('#senha2', 'outrasenha1'); await continuar(p);
  await p.getByRole('button', { name: 'Confirmar e ir pro Pix' }).click();
  await p.waitForFunction(() => /Já existe conta/.test(document.querySelector('[data-campo=email] .erro-campo')?.textContent || ''));
  assert.equal(await focoId(p), 'email');
});

t.teste('guarda da barra final não mexe em arquivo (.html) e preserva ?servico=', async () => {
  const p = await contexto();
  await p.goto(`${base}entrar/index.html`); await p.waitForSelector('#email');
  assert.ok(p.url().endsWith('entrar/index.html'), p.url());
  await p.goto(`${base}autoagendamento?servico=passadoria`); await p.waitForSelector('#titulo-passo');
  assert.ok(/autoagendamento\/\?servico=passadoria$/.test(p.url()), p.url());
});

t.teste('menu da home: aria-expanded acompanha abrir e fechar', async () => {
  const p = await contexto(375);
  await p.goto(base); await p.waitForLoadState('networkidle');
  assert.equal(await p.locator('.menu-btn').getAttribute('aria-expanded'), 'false');
  await p.locator('.menu-btn').click();
  assert.equal(await p.locator('.menu-btn').getAttribute('aria-expanded'), 'true');
  assert.equal(await p.locator('.menu-btn').getAttribute('aria-controls'), 'mobileNav');
});

t.teste('conta criada no agendamento entra pelo login', async () => {
  // estava no passo 3 (voltou pelo stepper): avança de novo; os dados continuam lá
  for (const t2 of [/Escolha o dia/, /Seus contatos/, /Confira/]) { await continuar(pa); await pa.waitForFunction((re) => new RegExp(re).test(document.querySelector('#titulo-passo').textContent), t2.source); }
  await pa.getByRole('button', { name: 'Confirmar e ir pro Pix' }).click();
  await pa.waitForURL(/pagamento\/\?pagamento=/);
  await pa.evaluate(() => localStorage.removeItem('prime.sessao'));
  await pa.goto(`${base}entrar/`); await pa.waitForSelector('#email');
  await pa.fill('#email', 'nova.cliente@exemplo.com'); await pa.fill('#senha', 'senhaboa123'); await pa.locator('form button[type=submit]').click();
  await pa.waitForURL('**/minha-conta/'); await pa.waitForSelector('[data-pedido]');
  assert.deepEqual(pa.erros, []);
});

// ---------------- d) header ----------------
t.teste('header: "Entrar" secundário com ícone, mesma altura e fonte do dourado, divisor; celular com ícone e Entrar no menu', async () => {
  for (const [u, nome] of [['', 'home'], ['autoagendamento/', 'interna']]) {
    const p = await contexto(1440);
    await p.goto(base + u); await p.waitForLoadState('networkidle');
    const m = await p.evaluate(() => {
      const e = document.querySelector('[data-conta=header]'); const g = document.querySelector('header .nav-cta .btn-primary, header .nav-cta .btn-secundario');
      const ce = getComputedStyle(e); const cg = getComputedStyle(g);
      return { hE: Math.round(e.getBoundingClientRect().height), hG: Math.round(g.getBoundingClientRect().height), fE: ce.fontSize + ce.fontFamily.split(',')[0] + ce.fontWeight, fG: cg.fontSize + cg.fontFamily.split(',')[0] + cg.fontWeight, borda: ce.borderTopColor, icone: !!e.querySelector('svg'), divisor: !!document.querySelector('header .nav-divisor') && getComputedStyle(document.querySelector('header .nav-divisor')).display !== 'none', ordem: [...document.querySelectorAll('nav.links a')].map((a) => a.textContent.trim()) };
    });
    assert.ok(Math.abs(m.hE - m.hG) <= 1, `${nome}: altura ${m.hE} x ${m.hG}`);
    assert.equal(m.fE, m.fG, `${nome}: fonte`);
    assert.equal(m.borda, 'rgb(42, 36, 86)'); assert.ok(m.icone && m.divisor);
    assert.deepEqual(m.ordem.slice(0, 2), ['Serviços', 'Como funciona']);
    if (SHOTS) await p.locator('header').screenshot({ path: `docs/shots/f0/header-${nome}-1440.png` });
    const c = await contexto(375);
    await c.goto(base + u); await c.waitForLoadState('networkidle');
    assert.ok(await c.locator('[data-conta=icone]').isVisible(), `${nome}: ícone de conta no celular`);
    assert.ok(await c.locator('[data-conta=header]').isHidden(), `${nome}: botão grande some no celular`);
    await c.locator('.menu-btn').click();
    assert.ok(await c.locator('[data-conta=menu]').isVisible(), `${nome}: Entrar dentro do menu`);
    if (SHOTS) await c.locator('header').screenshot({ path: `docs/shots/f0/header-${nome}-375.png` });
  }
});

// ---------------- e) logo ----------------
t.teste('sem overflow horizontal em 320 e 375px (header com logo, Entrar e menu)', async () => {
  for (const w of [320, 375]) {
    const p = await contexto(w);
    for (const u of ['', 'autoagendamento/', 'entrar/', 'diarista/cadastro/']) {
      await p.goto(base + u); await p.waitForLoadState('networkidle');
      const r = await p.evaluate(() => {
        const ov = document.documentElement.scrollWidth - document.documentElement.clientWidth;
        const caixas = ['header .logo', '[data-conta=icone]', '.menu-btn'].map((s) => document.querySelector(s)?.getBoundingClientRect()).filter(Boolean);
        let sobrepoe = false;
        for (let i = 0; i < caixas.length; i++) for (let j = i + 1; j < caixas.length; j++) { const a = caixas[i]; const b = caixas[j]; if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) sobrepoe = true; }
        return { ov, sobrepoe };
      });
      // home em 320px: overflow pré-existente no layout do Breno (medido antes do F0; PENDENCIAS). Aqui só o header conta.
      if (!(w === 320 && !u)) assert.ok(r.ov <= 0, `${w}px ${u || 'home'}: overflow ${r.ov}`);
      else assert.ok(await p.evaluate(() => document.querySelector('header').scrollWidth <= document.documentElement.clientWidth), '320px home: header estoura');
      assert.ok(!r.sobrepoe, `${w}px ${u || 'home'}: logo, conta e menu se sobrepõem`);
    }
  }
});

const PAGINAS = ['', 'autoagendamento/', 'pagamento/?pagamento=x', 'acompanhamento/?pedido=x', 'avaliacao/?atendimento=x', 'entrar/', 'minha-conta/', 'diarista/cadastro/', 'diarista/antecedentes/', 'diarista/entrar/', 'diarista/agenda/', 'painel/entrar/', 'painel/', 'pagina-inexistente/'];
t.teste('logo carrega (naturalWidth > 0) em todas as páginas: base do GitHub Pages, raiz (Cloudflare) e sem barra final', async () => {
  const p = await contexto(1440);
  const falhas = [];
  for (const [rotulo, raiz] of [['github', gh.base], ['raiz', cf.base]]) {
    for (const u of PAGINAS) {
      for (const semBarra of [false, true]) {
        if (semBarra && (!u || u.includes('?') || u.startsWith('pagina-'))) continue;
        const alvo = raiz + (semBarra ? u.replace(/\/$/, '') : u);
        await p.goto(alvo); await p.waitForLoadState('networkidle');
        await p.waitForFunction(() => document.querySelector('header .logo-img')?.complete, null, { timeout: 5000 }).catch(() => {});
        const w = await p.evaluate(() => document.querySelector('header .logo-img')?.naturalWidth || 0);
        if (!(w > 0)) falhas.push(`${rotulo}:${semBarra ? 'sem-barra:' : ''}${u || 'home'}`);
      }
    }
  }
  assert.deepEqual(falhas, []);
});

t.teste('nenhuma página mostra "null" ou "undefined" como texto (bug de append/replaceChildren com vazio)', async () => {
  const p = await contexto(1440);
  const sujas = [];
  const sessoes = { 'minha-conta/': { ator: 'cliente', id: C.clientes[0].id, nome: 'Ana' }, 'diarista/agenda/': { ator: 'diarista', id: C.diaristas[0].id, nome: 'Maria' }, 'painel/': { ator: 'prime', id: C.prime[0].id, nome: 'Prime' } };
  await p.goto(base); await p.waitForLoadState('networkidle');
  for (const u of [...PAGINAS, 'entrar/?modo=recuperar', 'painel/?aba=pagamentos', 'painel/?aba=cadastros', 'painel/?aba=notificacoes', 'painel/?aba=avaliacoes', '_dev/servicos.html?dev=1']) {
    const chave = Object.keys(sessoes).find((k) => u.startsWith(k));
    await p.evaluate((s) => { if (s) localStorage.setItem('prime.sessao', JSON.stringify(s)); else localStorage.removeItem('prime.sessao'); }, chave ? sessoes[chave] : null);
    await p.goto(base + u); await p.waitForLoadState('networkidle'); await p.waitForTimeout(300);
    const txt = await p.evaluate(() => document.body.innerText);
    if (/\bnull\b|\bundefined\b|\bNaN\b|\[object Object\]/.test(txt)) sujas.push(u || 'home');
  }
  assert.deepEqual(sujas, []);
});

// ---------------- f) links ----------------
t.teste('nenhum link pro site antigo; cada card de serviço abre o agendamento com o serviço', async () => {
  const antigos = [];
  const { readdirSync, statSync } = await import('node:fs');
  const andar = (d) => { for (const f of readdirSync(d)) { const c = `${d}/${f}`; if (/node_modules|\.git|docs|C:/.test(c)) continue; let st; try { st = statSync(c); } catch { continue; } if (st.isDirectory()) andar(c); else if (/\.(html|js)$/.test(c) && /primelimpezaespecializada\.com\.br\/(autoagendamento|diarista\/autocadastro)/.test(readFileSync(c, 'utf8'))) antigos.push(c); } };
  andar('.');
  assert.deepEqual(antigos, []);
  const p = await contexto(1440);
  await p.goto(base); await p.waitForLoadState('networkidle');
  const cards = await p.locator('.service-slide:not([aria-hidden]) .btn').evaluateAll((l) => l.map((a) => a.getAttribute('href')));
  assert.deepEqual(cards, ['autoagendamento/?servico=residencial', 'autoagendamento/?servico=empresarial', 'autoagendamento/?servico=passadoria', 'autoagendamento/?servico=pre_pos_mudanca', 'autoagendamento/?servico=pre_pos_evento']);
});

const falhas = await t.fim();
await b.close(); gh.srv.close(); cf.srv.close();
process.exit(falhas ? 1 : 0);
