// Foto de uma página (dev): node scripts/painel-v2/foto.mjs <url> <nome> [larguras=1440,375] [--clicar=seletor]
// Grava em ~/.claude/build/build-20261017-painel-v2-b/shots/<nome>-<largura>.png (fora do repo). Lista erros do console.
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { abrirNavegador } from '../pw.mjs';

const [url, nome, larg = '1440,375'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const clicar = process.argv.find((a) => a.startsWith('--clicar='))?.slice(9);
const prime = process.argv.includes('--prime'); // mock: sessão da Prime do seed
const PASTA = `${homedir()}/.claude/build/build-20261017-painel-v2-b/shots`;
mkdirSync(PASTA, { recursive: true });
const b = await abrirNavegador();
for (const w of larg.split(',').map(Number)) {
  const p = await (await b.newContext({ viewport: { width: w, height: 900 }, reducedMotion: 'reduce' })).newPage();
  const erros = [];
  p.on('console', (m) => m.type() === 'error' && erros.push(m.text()));
  p.on('pageerror', (e) => erros.push(e.message));
  if (prime) {
    const { CREDENCIAIS_MOCK: C } = await import('../fixtures/seed.js');
    await p.goto(new URL('.', url.replace(/painel\/.*/, '')).href); // origem do site
    await p.evaluate((c) => localStorage.setItem('prime.sessao', JSON.stringify({ ator: 'prime', id: c.id, nome: c.nome, papel: 'prime_admin' })), C.prime[0]);
  }
  await p.goto(url, { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  if (clicar) { await p.click(clicar); await p.waitForTimeout(300); }
  const [sw, iw] = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  await p.screenshot({ path: `${PASTA}/${nome}-${w}.png`, fullPage: true });
  console.log(`${nome}-${w}: overflow=${sw > iw ? `${sw}>${iw}` : 'não'} erros=${erros.length ? erros.join(' | ') : 'nenhum'}`);
  await p.context().close();
}
await b.close();
