// F0: correções urgentes do front. node scripts/testa-f0-navegador.mjs [--shots]
// a) nenhum passo avança vazio ou inválido (agendamento, cadastro de diarista, as três entradas), erro embaixo do campo, foco no 1º erro;
// b) stepper: atual azul com barra, concluídas clicáveis com check, futuras cinza;
// c) login da cliente por CPF, e-mail ou celular, dica da senha, "Entrar com Google", sem código pelo WhatsApp;
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

// a) o agendamento (v2) é validado passo a passo em scripts/testa-e3-navegador.mjs
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
t.teste('entradas (cliente, diarista, Prime): vazio não envia; e-mail inválido (diarista e Prime) não envia; erro embaixo de cada campo', async () => {
  const p = await contexto();
  await p.goto(`${base}entrar/`); await p.waitForSelector('#identificador');
  await p.locator('form button[type=submit]').click();
  assert.deepEqual((await errosVisiveis(p)).sort(), ['identificador', 'senha']);
  assert.equal(await focoId(p), 'identificador');
  for (const u of ['diarista/entrar/', 'painel/entrar/']) {
    await p.goto(base + u); await p.waitForSelector('#email');
    await p.locator('form button[type=submit]').click();
    assert.deepEqual((await errosVisiveis(p)).sort(), ['email', 'senha'], u);
    assert.equal(await focoId(p), 'email');
    await p.fill('#email', 'semarroba'); await p.fill('#senha', 'x'); await p.locator('form button[type=submit]').click();
    assert.deepEqual(await errosVisiveis(p), ['email'], u);
    assert.ok(await p.locator('.alerta-erro').isHidden(), `${u}: não chegou a tentar entrar`);
  }
});

t.teste('login da cliente: "Entre na sua conta", CPF/e-mail/celular, dica da senha no lugar de "Esqueci", Google; sem código pelo WhatsApp', async () => {
  const p = await contexto(1440);
  await p.goto(`${base}entrar/`); await p.waitForSelector('#identificador');
  assert.match(await p.locator('.abertura h1').textContent(), /Entre na sua conta/);
  assert.equal(await p.getByRole('button', { name: /código pelo WhatsApp/ }).count(), 0, 'sem entrada por código');
  assert.equal(await p.getByRole('button', { name: 'Esqueci minha senha' }).count(), 0);
  assert.ok(await p.locator('#dica-senha').isVisible());
  assert.ok(await p.getByRole('button', { name: 'Entrar com Google' }).isVisible());
  if (SHOTS) await p.screenshot({ path: 'docs/shots/f0/login-1440.png' });
  await p.fill('#identificador', C.clientes[0].email); await p.fill('#senha', 'errada123'); await p.locator('form button[type=submit]').click();
  await p.waitForSelector('.alerta-erro:not([hidden])');
  await p.fill('#identificador', C.clientes[0].cpf); await p.fill('#senha', C.clientes[0].senhaCpf); await p.locator('form button[type=submit]').click();
  await p.waitForURL('**/minha-conta/');
  // logado: header vira "Minha conta"
  assert.equal((await p.locator('[data-conta=header]').textContent()).trim(), 'Minha conta');
  await p.goto(base); await p.waitForLoadState('networkidle');
  assert.equal((await p.locator('[data-conta=header] span').textContent()).trim(), 'Minha conta', 'home também troca');
  assert.match(await p.locator('[data-conta=header]').getAttribute('href'), /minha-conta\//);
  await p.evaluate(() => localStorage.removeItem('prime.sessao'));
  const q = await contexto(375);
  await q.goto(`${base}entrar/`); await q.waitForSelector('#identificador');
  if (SHOTS) await q.screenshot({ path: 'docs/shots/f0/login-375.png', fullPage: true });
});

t.teste('guarda da barra final não mexe em arquivo (.html) e o ?servico= chega ao agendamento', async () => {
  const p = await contexto();
  await p.goto(`${base}entrar/index.html`); await p.waitForSelector('#identificador');
  assert.ok(p.url().endsWith('entrar/index.html'), p.url());
  await p.goto(`${base}autoagendamento?servico=passadoria`); await p.waitForSelector('#titulo-passo');
  // a guarda põe a barra final sem perder o ?servico= (o fluxo aplica o serviço e limpa a URL, pra recarregar não refazer)
  assert.ok(/autoagendamento\/$/.test(p.url()), p.url());
  const r = await p.evaluate(() => JSON.parse(localStorage.getItem('prime.rascunho.agendamento.v2') || '{}'));
  assert.deepEqual([r.tipoServico, r.passo], ['passadoria', 'cep']);
});

t.teste('menu da home: aria-expanded acompanha abrir e fechar', async () => {
  const p = await contexto(375);
  await p.goto(base); await p.waitForLoadState('networkidle');
  assert.equal(await p.locator('.menu-btn').getAttribute('aria-expanded'), 'false');
  await p.locator('.menu-btn').click();
  assert.equal(await p.locator('.menu-btn').getAttribute('aria-expanded'), 'true');
  assert.equal(await p.locator('.menu-btn').getAttribute('aria-controls'), 'mobileNav');
});

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
      // a home nova (24/09) também não estoura em 320px (o overflow antigo foi corrigido)
      assert.ok(r.ov <= 0, `${w}px ${u || 'home'}: overflow ${r.ov}`);
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
  for (const u of [...PAGINAS, 'painel/?aba=solicitacoes', 'painel/?aba=agenda', 'painel/?aba=pagamentos', 'painel/?aba=cadastros', 'painel/?aba=notificacoes', 'painel/?aba=avaliacoes', '_dev/servicos.html?dev=1']) {
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
  const andar = (d) => { for (const f of readdirSync(d)) { const c = `${d}/${f}`; if (/node_modules|\.git|docs|C:/.test(c)) continue; let st; try { st = statSync(c); } catch { continue; } if (st.isDirectory()) andar(c); else if (/\.(html|js)$/.test(c) && /primelimpezaespecializada\.com\.br\/(autoagendamento|diarista\/autocadastro)/.test(readFileSync(c, 'utf8').replace(/<!-- seo:inicio[\s\S]*?<!-- seo:fim -->/, '')) /* canonical/OG do domínio novo (S1) não é link pro antigo */) antigos.push(c); } };
  andar('.');
  assert.deepEqual(antigos, []);
  const p = await contexto(1440);
  await p.goto(base); await p.waitForLoadState('networkidle');
  const cards = await p.locator('.service-slide:not([aria-hidden]) .btn').evaluateAll((l) => l.map((a) => a.getAttribute('href')));
  assert.deepEqual(cards, ['autoagendamento/?servico=residencial', 'autoagendamento/?servico=empresarial', 'autoagendamento/?servico=condominial', 'autoagendamento/?servico=pre_pos_mudanca', 'autoagendamento/?servico=pre_pos_evento', 'autoagendamento/?servico=passadoria']);
});

const falhas = await t.fim();
await b.close(); gh.srv.close(); cf.srv.close();
process.exit(falhas ? 1 : 0);
