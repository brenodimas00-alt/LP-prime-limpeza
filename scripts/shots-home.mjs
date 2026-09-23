// Screenshots da home em 375 e 1440. Uso: node scripts/shots-home.mjs antes|depois
import { abrirNavegador, subirServidor } from './pw.mjs';
const fase = process.argv[2] || 'antes';
const { base, fechar } = await subirServidor();
const b = await abrirNavegador();
for (const w of [375, 1440]) {
  const p = await b.newPage({ viewport: { width: w, height: 900 }, reducedMotion: 'reduce' });
  const erros = [];
  p.on('console', (m) => m.type() === 'error' && erros.push(m.text()));
  p.on('pageerror', (e) => erros.push(e.message));
  await p.goto(base, { waitUntil: 'networkidle' });
  await p.evaluate(() => { const v = document.querySelector('video'); if (v) { v.pause(); v.currentTime = 0; } });
  await p.waitForTimeout(500);
  await p.screenshot({ path: `docs/shots/home-${fase}-${w}.png`, fullPage: true });
  console.log(w, 'erros console:', erros.length ? erros : 'nenhum');
}
await b.close(); await fechar();
