// Screenshots de página inteira da home. Uso: node scripts/shots-home.mjs <pasta em docs/shots> [larguras separadas por vírgula]
// ex.: node scripts/shots-home.mjs home-v1 375,1440  |  node scripts/shots-home.mjs home-v2 375,768,1440
import { mkdirSync } from 'node:fs';
import { abrirNavegador, subirServidor } from './pw.mjs';
const pasta = process.argv[2] || 'home-v2';
const larguras = (process.argv[3] || '375,1440').split(',').map(Number);
mkdirSync(`docs/shots/${pasta}`, { recursive: true });
const { base, fechar } = await subirServidor();
const b = await abrirNavegador();
for (const w of larguras) {
  const p = await b.newPage({ viewport: { width: w, height: 900 }, reducedMotion: 'reduce' });
  const erros = [];
  p.on('console', (m) => m.type() === 'error' && erros.push(m.text()));
  p.on('pageerror', (e) => erros.push(e.message));
  await p.goto(base, { waitUntil: 'networkidle' });
  await p.evaluate(() => { const v = document.querySelector('video'); if (v) { v.pause(); v.currentTime = 0; } });
  // rola até o fim pra carregar as imagens com loading="lazy" e volta pro topo
  await p.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } scrollTo(0, 0); });
  await p.waitForLoadState('networkidle');
  await p.waitForTimeout(500);
  await p.screenshot({ path: `docs/shots/${pasta}/home-${w}.png`, fullPage: true });
  console.log(w, 'erros console:', erros.length ? erros : 'nenhum');
}
await b.close(); await fechar();
