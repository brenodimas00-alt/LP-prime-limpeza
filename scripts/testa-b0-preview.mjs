// B0: aceite do preview do Cloudflare Pages. Roda contra a URL publicada (não o servidor local).
// Uso: node scripts/testa-b0-preview.mjs [url]   (padrão: alias da branch atual em prime-limpeza.pages.dev)
// Violação de CSP aparece como erro no console, então "console limpo" também prova a CSP.
import { execFileSync } from 'node:child_process';
import { criarSuite, assert } from './lib-teste.mjs';
import { abrirNavegador } from './pw.mjs';

const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim().replace(/[/_.]/g, '-').toLowerCase();
const BASE = (process.argv[2] || `https://${branch}.prime-limpeza.pages.dev/`).replace(/\/?$/, '/');
const t = criarSuite(`B0 preview (${BASE})`);
const b = await abrirNavegador();
const PAGINAS = ['', 'autoagendamento/', 'pagamento/?pagamento=x', 'acompanhamento/?pedido=x', 'avaliacao/?atendimento=x', 'entrar/', 'minha-conta/',
  'diarista/cadastro/', 'diarista/antecedentes/', 'diarista/entrar/', 'diarista/agenda/', 'painel/entrar/', 'painel/', 'pagina-inexistente/'];

async function novaPagina(largura = 390) {
  const ctx = await b.newContext({ viewport: { width: largura, height: 900 }, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  p.erros = []; p.falhas = [];
  p.on('console', (m) => m.type() === 'error' && p.erros.push(m.text()));
  p.on('pageerror', (e) => p.erros.push(e.message));
  // módulo/asset do próprio site que não carrega (404 de import, CSS, imagem)
  p.on('response', (r) => { if (r.url().startsWith(BASE) && r.status() >= 400 && r.request().resourceType() !== 'document') p.falhas.push(`${r.status()} ${r.url()}`); });
  // <video> aborta a 1ª requisição e refaz por faixa (ERR_ABORTED): isso não é falha. Status >= 400 continua sendo.
  p.on('requestfailed', (r) => { if (!(r.resourceType() === 'media' && /ERR_ABORTED/.test(r.failure()?.errorText || ''))) p.falhas.push(`falhou ${r.url()} ${r.failure()?.errorText}`); });
  return p;
}

t.teste('headers: CSP restrita, DENY, Referrer-Policy, nosniff e noindex no preview', async () => {
  const r = await fetch(BASE);
  assert.equal(r.status, 200);
  const csp = r.headers.get('content-security-policy') || '';
  assert.match(csp, /default-src 'self'/); assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /connect-src 'self' https:\/\/viacep\.com\.br https:\/\/[a-z0-9]{20}\.supabase\.co/);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/, 'script-src sem unsafe-inline');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(r.headers.get('x-robots-tag') || '', /noindex/);
  const painel = await fetch(`${BASE}painel/`);
  assert.match(painel.headers.get('x-robots-tag') || '', /noindex/);
});

t.teste('só o site é publicado: docs, scripts de teste, supabase, _dev e package.json dão 404', async () => {
  for (const c of ['docs/DECISOES.md', 'scripts/testa-app.mjs', 'scripts/roda-testes.mjs', 'supabase/config.toml', '_dev/servicos.html', 'package.json', 'README.md', 'node_modules/playwright/package.json']) {
    assert.equal((await fetch(`${BASE}${c}`)).status, 404, `${c} não deveria estar publicado`);
  }
  // o seed do mock é o único arquivo de scripts/ publicado (a demonstração precisa dele)
  assert.equal((await fetch(`${BASE}scripts/fixtures/seed.js`)).status, 200);
});

t.teste('todas as páginas abrem com logo, título e console limpo (CSP não bloqueia nada)', async () => {
  const p = await novaPagina(1440);
  for (const u of PAGINAS) {
    p.erros.length = 0; p.falhas.length = 0;
    const resp = await p.goto(`${BASE}${u}`, { waitUntil: 'networkidle' });
    await p.waitForSelector('h1');
    if (u === 'pagina-inexistente/') {
      // o próprio documento responde 404 (404.html do Pages): o Chrome registra isso no console, e é o esperado
      assert.equal(resp.status(), 404);
      const i = p.erros.findIndex((e) => /status of 404/.test(e)); if (i >= 0) p.erros.splice(i, 1);
    } else assert.equal(resp.status(), 200, u);
    const w = await p.evaluate(() => document.querySelector('header img')?.naturalWidth || 0);
    assert.ok(w > 0, `logo em ${u}`);
    assert.deepEqual(p.erros, [], `console em ${u}: ${JSON.stringify(p.erros)}`);
    assert.deepEqual(p.falhas, [], `recursos em ${u}: ${JSON.stringify(p.falhas)}`);
  }
});

t.teste('home em 375: menu mobile abre e fecha (onclick liberado por hash) e sem overflow', async () => {
  const p = await novaPagina(375);
  await p.goto(BASE, { waitUntil: 'networkidle' });
  const menu = p.locator('.menu-btn');
  await menu.click();
  assert.equal(await p.locator('#mobileNav').isVisible(), true);
  assert.equal(await menu.getAttribute('aria-expanded'), 'true');
  await menu.click();
  assert.equal(await p.locator('#mobileNav').isVisible(), false);
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'overflow em 375');
  assert.deepEqual(p.erros, []);
});

t.teste('autoagendamento funciona no preview (mock): tipo, calculadora e o ViaCEP real passa pela CSP', async () => {
  const p = await novaPagina(390);
  await p.goto(`${BASE}autoagendamento/`, { waitUntil: 'networkidle' });
  await p.locator('input[name=tipo][value=residencial]').check({ force: true });
  await p.getByRole('button', { name: 'Continuar' }).click();
  await p.waitForSelector('#calculadora');
  await p.fill('#metragem', '70');
  await p.getByRole('button', { name: 'Continuar' }).click();
  await p.waitForSelector('#cep');
  await p.fill('#cep', '30130-010');
  await p.waitForFunction(() => document.querySelector('#cidade').value === 'Belo Horizonte', null, { timeout: 15000 });
  assert.deepEqual(p.erros, []);
});

const falhas = await t.fim();
await b.close();
process.exit(falhas ? 1 : 0);
