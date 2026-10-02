// Painel v2 (etapa A4): fotografa o protótipo estático (painel-proposta/) em 1440 e 390 px, servido local.
// Uso: LD_LIBRARY_PATH=... bash scripts/cli.sh node22 scripts/painel-v2/captura-proposta.mjs
// (verificação de overflow/console a 320 px com interações: scripts/painel-v2/verifica-proposta.mjs)
import { mkdirSync, writeFileSync } from 'node:fs';
import { abrirNavegador, subirServidor } from '../pw.mjs';

const PASTA = new URL('../../docs/painel-v2/proposta/', import.meta.url);
mkdirSync(PASTA, { recursive: true });
const TELAS = ['index', 'solicitacoes', 'agenda', 'cliente', 'financeiro', 'profissionais'];
const { base, fechar } = await subirServidor();
const b = await abrirNavegador();
const erros = []; const manifesto = [];
for (const largura of [1440, 390, 320]) {
  const ctx = await b.newContext({ viewport: { width: largura, height: largura < 600 ? 844 : 900 }, reducedMotion: 'reduce', deviceScaleFactor: 1, isMobile: largura < 600, hasTouch: largura < 600 });
  await ctx.addInitScript(() => { try { localStorage.setItem('prime-proposta-tour-visto', '1'); } catch { /* ignora */ } }); // sem o tour na foto
  const p = await ctx.newPage();
  p.on('console', (m) => m.type() === 'error' && erros.push(`${largura} ${m.text().slice(0, 160)}`));
  p.on('pageerror', (e) => erros.push(`${largura} ${e.message.slice(0, 160)}`));
  for (const t of TELAS) {
    await p.goto(`${base}painel-proposta/${t === 'index' ? '' : `${t}.html`}`);
    await p.waitForLoadState('load'); await p.waitForTimeout(500);
    // o tour de primeiro acesso não entra na foto
    await p.evaluate(() => { for (const d of document.querySelectorAll('dialog[open]')) d.close(); document.querySelector('.tour, [data-tour]')?.remove(); });
    await p.waitForTimeout(200);
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 0) erros.push(`${largura} ${t}: overflow horizontal de ${overflow}px`);
    if (largura === 320) continue;
    const arquivo = `${largura}-${t}.png`;
    await p.screenshot({ path: new URL(arquivo, PASTA).pathname, fullPage: true });
    manifesto.push({ arquivo, largura, nome: t, altura: await p.evaluate(() => document.documentElement.scrollHeight) });
    console.log(arquivo);
    // celular: também a primeira tela (com a barra inferior fixa, que a foto inteira não mostra)
    if (largura === 390) await p.screenshot({ path: new URL(`${largura}-${t}-tela.png`, PASTA).pathname, fullPage: false });
  }
  await ctx.close();
}
writeFileSync(new URL('manifesto.json', PASTA), JSON.stringify({ telas: manifesto, erros }, null, 2));
if (erros.length) console.log(`\nproblemas (${erros.length}):\n${[...new Set(erros)].join('\n')}`);
await b.close(); await fechar();
