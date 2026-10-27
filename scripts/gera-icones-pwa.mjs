// Ícones a partir do kit do logo da cliente (assets/marca/simbolo-branco.svg: os telhados do logo, vetor): telhado branco
// sobre o marinho do logo. Legível em 16 px. Gera:
// - assets/icons/app-192.png, app-512.png e app-maskable-512.png (PWA da agenda da profissional; o maskable com margem);
// - assets/icons/apple-touch-icon.png (180) e favicon-32.png;
// - assets/marca/favicon.svg (o favicon de todas as páginas).
// Uso: node scripts/gera-icones-pwa.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { abrirNavegador } from './pw.mjs';

const MARINHO = '#25225d'; // o --marinho-700 dos tokens, o azul do logo
const simbolo = readFileSync(new URL('../assets/marca/simbolo-branco.svg', import.meta.url), 'utf8').replace(/<\?xml[^>]*>\s*/, '');
const vb = simbolo.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
const corpo = simbolo.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');

// favicon vetorial: quadrado marinho de canto suave e o símbolo centralizado com 7% de margem (o telhado é largo: ocupa a largura toda)
const lado = 100; const marg = 7; const w = lado - 2 * marg; const h = (vb[3] / vb[2]) * w;
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lado} ${lado}"><rect width="${lado}" height="${lado}" rx="18" fill="${MARINHO}"/>`
  + `<svg x="${marg}" y="${((lado - h) / 2).toFixed(2)}" width="${w}" height="${h.toFixed(2)}" viewBox="${vb.join(' ')}">${corpo}</svg></svg>\n`;
writeFileSync(new URL('../assets/marca/favicon.svg', import.meta.url), favicon);
console.log('gerado assets/marca/favicon.svg');

const b = await abrirNavegador();
for (const [arq, px, margem, cantos] of [['icons/app-192.png', 192, 0.16, 0], ['icons/app-512.png', 512, 0.16, 0], ['icons/app-maskable-512.png', 512, 0.26, 0],
  ['icons/apple-touch-icon.png', 180, 0.16, 0], ['icons/favicon-32.png', 32, 0.06, 6]]) {
  const p = await b.newPage({ viewport: { width: px, height: px } });
  await p.setContent(`<html><body style="margin:0;width:${px}px;height:${px}px;background:transparent;display:flex">
    <div style="width:${px}px;height:${px}px;background:${MARINHO};border-radius:${cantos}px;display:flex;align-items:center;justify-content:center">
      <div style="width:${Math.round(px * (1 - 2 * margem))}px">${simbolo.replace('<svg', '<svg style="width:100%;height:auto;display:block"')}</div></div></body></html>`);
  await p.screenshot({ path: new URL(`../assets/${arq}`, import.meta.url).pathname, omitBackground: true });
  await p.close();
  console.log(`gerado assets/${arq}`);
}
await b.close();
