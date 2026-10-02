// Verificação do protótipo: abre cada tela em 3 larguras, confere erros de console, overflow horizontal em 320 px
// e tira screenshots (1440 e 390) em docs/painel-v2/proposta/_verifica/. Antes, suba o servidor: node scripts/serve.mjs 8099
// Uso: LD_LIBRARY_PATH=$HOME/.cache/pw-libs/root/usr/lib/x86_64-linux-gnu bash scripts/cli.sh node22 scripts/painel-v2/verifica-proposta.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE || 'http://localhost:8099/LP-prime-limpeza/painel-proposta/';
const PAGINAS = ['index.html', 'solicitacoes.html', 'agenda.html', 'cliente.html', 'financeiro.html', 'profissionais.html', 'componentes.html'];
const LARGURAS = [[1440, 900], [390, 844], [320, 700]];
const SHOTS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'painel-v2', 'proposta', '_verifica');
mkdirSync(SHOTS, { recursive: true });

const navegador = await chromium.launch();
let falhas = 0;
for (const [w, h] of LARGURAS) {
  const ctx = await navegador.newContext({ viewport: { width: w, height: h }, locale: 'pt-BR' });
  // Tour já visto: a tela fica limpa nos screenshots. O tour é fotografado à parte.
  await ctx.addInitScript(() => { try { localStorage.setItem('prime-proposta-tour-visto', '1'); } catch (e) { /* ignora */ } });
  for (const pagina of PAGINAS) {
    const page = await ctx.newPage();
    const erros = [];
    page.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });
    page.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
    page.on('requestfailed', (r) => erros.push('request falhou: ' + r.url()));
    const resp = await page.goto(BASE + pagina, { waitUntil: 'networkidle' });
    const status = resp ? resp.status() : 0;
    const medida = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth, titulo: document.title }));
    const overflow = medida.scrollWidth > medida.innerWidth;
    const semJsInline = await page.evaluate(() => !document.querySelector('script:not([src])') && !document.querySelector('[onclick],[style]'));
    const problemas = [];
    if (status !== 200) problemas.push('http ' + status);
    if (erros.length) problemas.push('console: ' + erros.join(' | '));
    if (overflow) problemas.push(`overflow ${medida.scrollWidth} > ${medida.innerWidth}`);
    if (!semJsInline) problemas.push('tem script/onclick/style inline');
    if (medida.titulo !== 'Proposta do painel · Prime') problemas.push('título: ' + medida.titulo);
    if (w !== 320) await page.screenshot({ path: join(SHOTS, `${pagina.replace('.html', '')}-${w}.png`), fullPage: true });
    if (problemas.length) falhas++;
    console.log(`${problemas.length ? 'FALHA' : 'ok   '} ${String(w).padStart(4)}px ${pagina.padEnd(20)} ${problemas.join('; ')}`);
    await page.close();
  }
  await ctx.close();
}

// Interações: tour, drawer com voltar, abas, folha "Mais", filtros, busca.
const ctx = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errosInt = [];
page.on('pageerror', (e) => errosInt.push(e.message));
await page.goto(BASE + 'index.html', { waitUntil: 'networkidle' });
await page.waitForSelector('.tour', { state: 'visible', timeout: 3000 }).catch(() => {});
const tourVisivel = await page.locator('.tour').isVisible();
await page.screenshot({ path: join(SHOTS, 'index-tour-1440.png') });
await page.click('.tour .proximo'); await page.click('.tour .proximo');
const passo3 = await page.locator('.tour .passo').textContent();
await page.click('.tour .pular');
const tourFechado = !(await page.locator('.tour').isVisible());
await page.click('a[data-drawer="ocorrencia-juliana"]');
const drawerAberto = await page.locator('.drawer.aberta #ocorrencia-juliana').isVisible();
await page.goBack();
const drawerFechado = !(await page.locator('.drawer.aberta').isVisible());
await page.fill('.busca input', '99111-0001');
const achou = await page.locator('.busca-resultados a').first().textContent();
await page.goto(BASE + 'financeiro.html#vencidos', { waitUntil: 'networkidle' });
await page.click('#aba-extras');
const abaExtras = await page.locator('#horas-extras').isVisible() && !(await page.locator('#pagamentos').isVisible());
await page.click('#aba-pagamentos');
await page.click('.etiqueta[data-valor="vencido"]');
const linhasVisiveis = await page.locator('#tabela-pagamentos tbody tr:visible').count();
await page.goto(BASE + 'agenda.html', { waitUntil: 'networkidle' });
await page.click('a[data-drawer="diaria-juliana"]');
const conflito = await page.locator('[data-aviso-conflito]').isVisible();
await page.selectOption('#r-prof', 'claudia');
const semConflito = !(await page.locator('[data-aviso-conflito]').isVisible());
await page.screenshot({ path: join(SHOTS, 'agenda-drawer-1440.png'), fullPage: true });
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(BASE + 'index.html', { waitUntil: 'networkidle' });
await page.click('[data-abre-folha]');
const folhaAberta = await page.locator('#folha-mais').isVisible();
await page.screenshot({ path: join(SHOTS, 'index-folha-390.png') });
await page.goto(BASE + 'solicitacoes.html', { waitUntil: 'networkidle' });
await page.screenshot({ path: join(SHOTS, 'solicitacoes-drawer-390.png'), fullPage: true });

const checks = { tourVisivel, passo3: passo3 === '3 de 5', tourFechado, drawerAberto, drawerFechado, buscaAchouBeatriz: /Beatriz/.test(achou || ''), abaExtras, filtroVencido: linhasVisiveis === 1, conflito, semConflito, folhaAberta, semErroJs: errosInt.length === 0 };
for (const [k, v] of Object.entries(checks)) { if (!v) falhas++; console.log(`${v ? 'ok   ' : 'FALHA'} interação: ${k}`); }
if (errosInt.length) console.log(errosInt);
await navegador.close();
console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
process.exit(falhas ? 1 : 0);
