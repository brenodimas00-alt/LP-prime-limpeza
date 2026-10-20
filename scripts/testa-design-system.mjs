// Design system (D3): a página viva /_dev/design-system/ no navegador. axe (WCAG 2.1 AA) em cada componente
// ([data-componente]) e nos fundamentos, sem erro de console, sem rolagem lateral em 320 e 390, fontes locais carregadas
// e números tabulares de verdade (mesma largura pra 1 e 8).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { criarSuite, assert } from './lib-teste.mjs';
import { abrirNavegador, subirServidor } from './pw.mjs';

const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const t = criarSuite('design system: página viva e componentes (navegador, axe)');
const { base, fechar } = await subirServidor();
const b = await abrirNavegador();
async function pagina(largura = 1440) {
  const p = await (await b.newContext({ viewport: { width: largura, height: 900 }, reducedMotion: 'reduce' })).newPage();
  p.erros = [];
  p.on('pageerror', (e) => p.erros.push(e.message));
  p.on('console', (m) => m.type() === 'error' && p.erros.push(m.text()));
  await p.goto(`${base}_dev/design-system/`);
  await p.waitForSelector('[data-componente=etapas]');
  await p.evaluate(() => document.fonts.ready);
  return p;
}

t.teste('axe sem violação em cada componente e nos fundamentos (WCAG 2.1 AA)', async () => {
  const p = await pagina();
  await p.addScriptTag({ content: AXE });
  const secoes = await p.$$eval('.ds-secao', (s) => s.map((x) => x.id));
  assert.ok(secoes.length >= 20, `seções: ${secoes.length}`);
  const problemas = [];
  for (const id of secoes) {
    const r = await p.evaluate((sel) => window.axe.run({ include: [[sel]] }, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }), `#${id}`);
    for (const v of r.violations) problemas.push(`${id}: ${v.id} (${v.nodes.length}) ${v.nodes[0]?.target}`);
  }
  assert.deepEqual(problemas, []);
  assert.deepEqual(p.erros, []);
});

t.teste('fontes locais carregadas (Source Serif 4 e Source Sans 3) e números tabulares', async () => {
  const p = await pagina();
  const r = await p.evaluate(() => {
    const carregadas = [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.weight} ${f.family.replace(/"/g, '')}`);
    const medir = (txt) => { const s = document.createElement('span'); s.className = 'num'; s.style.cssText = 'font-family:var(--fonte-texto);font-size:var(--fs-16);position:absolute;visibility:hidden'; s.textContent = txt; document.body.append(s); const w = s.getBoundingClientRect().width; s.remove(); return w; };
    return { carregadas, um: medir('1111'), oito: medir('8888') };
  });
  for (const f of ['600 Source Serif 4', '400 Source Sans 3', '600 Source Sans 3']) assert.ok(r.carregadas.includes(f), `${f} não carregou: ${r.carregadas}`);
  assert.ok(Math.abs(r.um - r.oito) < 0.5, `tabular: ${r.um} x ${r.oito}`);
});

t.teste('sem rolagem lateral em 320 e 390', async () => {
  for (const w of [320, 390]) {
    const p = await pagina(w);
    const [sw, iw] = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert.ok(sw <= iw, `${w}: ${sw} > ${iw}`);
  }
});

const falhas = await t.fim();
await b.close(); await fechar();
process.exit(falhas ? 1 : 0);
