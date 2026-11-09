// Prints da Agenda e Escala no mock com o seed de demonstração (SEED_DEMO=agenda), nos tamanhos das referências.
// Uso: node scripts/agenda-escala-prints.mjs <pasta-de-saida> [--so dia,periodo,...] [--data AAAA-MM-DD]
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { abrirNavegador, subirServidor } from './pw.mjs';
import { CREDENCIAIS_MOCK as C } from './fixtures/seed.js';

const saida = process.argv[2] || '/tmp/agenda-prints';
const so = (() => { const i = process.argv.indexOf('--so'); return i > 0 ? process.argv[i + 1].split(',') : null; })();
mkdirSync(saida, { recursive: true });
const { base, fechar } = await subirServidor();
const b = await abrirNavegador();
const erros = [];

async function pagina(largura, caminho, altura = 900) {
  const ctx = await b.newContext({ viewport: { width: largura, height: altura }, reducedMotion: 'reduce', deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => erros.push(`${caminho}: ${e.message}`));
  p.on('console', (m) => m.type() === 'error' && erros.push(`${caminho}: ${m.text()}`));
  await p.goto(base);
  await p.evaluate((c) => { localStorage.setItem('prime.seedDemo', 'agenda'); localStorage.setItem('prime.sessao', JSON.stringify({ ator: 'prime', id: c.id, nome: 'Isa', papel: 'prime_admin' })); }, C.prime[0]);
  await p.goto(`${base}${caminho}`);
  await p.waitForSelector('.ae-tabela, .ae-dia-sec, .p-vazio', { timeout: 20000 });
  await p.waitForTimeout(300);
  return p;
}
const quer = (n) => !so || so.includes(n);
const larguras = [1440, 390];
for (const w of larguras) {
  if (quer('dia')) { const p = await pagina(w, 'painel/?tela=agenda'); await p.screenshot({ path: join(saida, `dia-${w}.png`), fullPage: w < 800 }); if (w < 800) { await p.screenshot({ path: join(saida, `dia-${w}-tela1.png`) }); await p.evaluate(() => scrollTo(0, 900)); await p.screenshot({ path: join(saida, `dia-${w}-tela2.png`) }); } await p.context().close(); }
  if (quer('detalhes')) {
    const p = await pagina(w, 'painel/?tela=agenda');
    await p.locator('tr.ae-lin').first().locator('td').nth(3).click();
    await p.waitForSelector('.ae-detalhe:not([hidden])');
    await p.screenshot({ path: join(saida, `detalhes-${w}.png`) }); await p.context().close();
  }
  if (quer('periodo')) { const p = await pagina(w, 'painel/?tela=agenda&vista=periodo'); await p.screenshot({ path: join(saida, `periodo-${w}.png`), fullPage: w < 800 }); await p.context().close(); }
  if (quer('filtros')) { const p = await pagina(w, 'painel/?tela=agenda&vista=periodo'); await p.click('.ae-filtros-btn'); await p.waitForSelector('.ae-pop'); await p.screenshot({ path: join(saida, `filtros-${w}.png`) }); await p.context().close(); }
  if (quer('alterar')) { const p = await pagina(w, 'painel/?tela=agenda'); await p.locator('.ae-alterar').nth(1).click(); await p.waitForSelector('.ae-sel-lista li'); await p.screenshot({ path: join(saida, `alterar-${w}.png`) }); await p.context().close(); }
  if (quer('mais')) { const p = await pagina(w, 'painel/?tela=agenda'); await p.locator('tr.ae-lin .ae-mais').nth(2).click(); await p.waitForSelector('.ae-pop .ae-menu'); await p.screenshot({ path: join(saida, `mais-${w}.png`) }); await p.context().close(); }
}
console.log(erros.length ? `ERROS DE CONSOLE:\n${erros.join('\n')}` : 'sem erro de console');
await b.close(); await fechar();
