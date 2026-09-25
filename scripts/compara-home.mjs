// Compara pixel a pixel a referência aprovada docs/shots/home-v2/home-*.png (home nova de 24/09/2026, gerada por
// scripts/shots-home.mjs e inspecionada antes) com um screenshot atual da home (375 e 1440).
// Não grava arquivo novo (limite de screenshots): gera em memória e compara no próprio Chromium.
import { readFileSync } from 'node:fs';
import { abrirNavegador, subirServidor } from './pw.mjs';

const { base, fechar } = await subirServidor();
const b = await abrirNavegador();
let falhou = false;
for (const w of [375, 1440]) {
  const p = await b.newPage({ viewport: { width: w, height: 900 }, reducedMotion: 'reduce' });
  const erros = [];
  p.on('console', (m) => m.type() === 'error' && erros.push(m.text()));
  p.on('pageerror', (e) => erros.push(e.message));
  await p.goto(base, { waitUntil: 'networkidle' });
  await p.evaluate(() => { const v = document.querySelector('video'); if (v) { v.pause(); v.currentTime = 0; } });
  // mesmo roteiro do shots-home: rola até o fim (imagens lazy) e volta
  await p.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } scrollTo(0, 0); });
  await p.waitForLoadState('networkidle');
  await p.waitForTimeout(500);
  const atual = (await p.screenshot({ fullPage: true })).toString('base64');
  const antes = readFileSync(`docs/shots/home-v2/home-${w}.png`).toString('base64');
  const r = await p.evaluate(async ([a, c]) => {
    const carregar = (s) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = `data:image/png;base64,${s}`; });
    const [ia, ic] = await Promise.all([carregar(a), carregar(c)]);
    if (ia.width !== ic.width || ia.height !== ic.height) return { mesmoTamanho: false, a: [ia.width, ia.height], c: [ic.width, ic.height] };
    const px = (img) => { const cv = new OffscreenCanvas(img.width, img.height); const g = cv.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, img.width, img.height).data; };
    const da = px(ia); const dc = px(ic);
    let dif = 0;
    for (let i = 0; i < da.length; i += 4) if (da[i] !== dc[i] || da[i + 1] !== dc[i + 1] || da[i + 2] !== dc[i + 2]) dif++;
    return { mesmoTamanho: true, pixelsDiferentes: dif, total: da.length / 4 };
  }, [antes, atual]);
  const ok = r.mesmoTamanho && r.pixelsDiferentes === 0 && !erros.length;
  if (!ok) falhou = true;
  console.log(`${w}px: ${ok ? 'IDÊNTICA' : 'DIFERENTE'}`, JSON.stringify(r), 'erros console:', erros.length ? erros : 'nenhum');
  await p.close();
}
await b.close(); await fechar();
process.exit(falhou ? 1 : 0);
