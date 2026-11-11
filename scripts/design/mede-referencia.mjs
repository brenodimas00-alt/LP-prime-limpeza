// Mede a imagem de referência do painel (dashboard-isa.png, 1536 x 1024) com o Chromium: amostra de pixel, recorte
// com zoom pra inspecionar e varredura de bordas. Uso:
//   node scripts/design/mede-referencia.mjs <png> cor x,y [x,y...]           -> hex de cada ponto (média 3x3)
//   node scripts/design/mede-referencia.mjs <png> recorte x y w h zoom <saida.png>
//   node scripts/design/mede-referencia.mjs <png> linha y x0 x1               -> trechos de cor ao longo de uma linha
//   node scripts/design/mede-referencia.mjs <png> coluna x y0 y1              -> trechos de cor ao longo de uma coluna
import { readFileSync } from 'node:fs';
import { abrirNavegador } from '../pw.mjs';

const [arq, modo, ...args] = process.argv.slice(2);
const b = await abrirNavegador();
const p = await (await b.newContext({ viewport: { width: 1600, height: 1100 } })).newPage();
await p.setContent('<canvas id="c"></canvas>');
await p.evaluate(async (src) => {
  const img = new Image(); img.src = src; await img.decode();
  const c = document.getElementById('c'); c.width = img.width; c.height = img.height;
  c.getContext('2d').drawImage(img, 0, 0);
  window.px = (x, y, r = 1) => {
    const d = c.getContext('2d').getImageData(x - r, y - r, 2 * r + 1, 2 * r + 1).data; let s = [0, 0, 0]; const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) { s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; }
    return '#' + s.map((v) => Math.round(v / n).toString(16).padStart(2, '0')).join('');
  };
  window.img = img;
}, `data:image/png;base64,${readFileSync(arq).toString('base64')}`);
if (modo === 'cor') {
  for (const a of args) { const [x, y] = a.split(',').map(Number); console.log(`${x},${y} ${await p.evaluate(([x2, y2]) => window.px(x2, y2), [x, y])}`); }
} else if (modo === 'recorte') {
  const [x, y, w, h, z, saida] = args;
  await p.setViewportSize({ width: Math.round(w * z), height: Math.round(h * z) });
  await p.evaluate(([x2, y2, w2, h2, z2, grade]) => {
    const c = document.createElement('canvas'); c.width = w2 * z2; c.height = h2 * z2; const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
    g.drawImage(window.img, x2, y2, w2, h2, 0, 0, w2 * z2, h2 * z2); document.body.replaceChildren(c); document.body.style.margin = '0';
    if (grade) { // grade de coordenadas da imagem original a cada 10 px (rótulo a cada 50)
      g.font = '10px monospace';
      for (let gx = Math.ceil(x2 / 10) * 10; gx < x2 + w2; gx += 10) { g.strokeStyle = gx % 50 ? 'rgba(0,160,255,.25)' : 'rgba(255,0,140,.6)'; g.beginPath(); g.moveTo((gx - x2) * z2 + .5, 0); g.lineTo((gx - x2) * z2 + .5, h2 * z2); g.stroke(); if (!(gx % 50)) { g.fillStyle = '#f0f'; g.fillText(String(gx), (gx - x2) * z2 + 2, 10); } }
      for (let gy = Math.ceil(y2 / 10) * 10; gy < y2 + h2; gy += 10) { g.strokeStyle = gy % 50 ? 'rgba(0,160,255,.25)' : 'rgba(255,0,140,.6)'; g.beginPath(); g.moveTo(0, (gy - y2) * z2 + .5); g.lineTo(w2 * z2, (gy - y2) * z2 + .5); g.stroke(); if (!(gy % 50)) { g.fillStyle = '#f0f'; g.fillText(String(gy), 2, (gy - y2) * z2 - 2); } }
    }
  }, [Number(x), Number(y), Number(w), Number(h), Number(z), process.argv.includes('--grade')]);
  await p.screenshot({ path: saida });
  console.log(saida);
} else if (modo === 'linha' || modo === 'coluna') {
  const [fixo, a0, a1] = args.map(Number);
  const r = await p.evaluate(([m, f, i0, i1]) => {
    const out = []; let ant = null; let ini = i0;
    const dist = (a, b2) => { const h = (s) => [1, 3, 5].map((k) => parseInt(s.slice(k, k + 2), 16)); const [x, y] = [h(a), h(b2)]; return Math.max(...x.map((v, i) => Math.abs(v - y[i]))); };
    for (let i = i0; i <= i1; i++) {
      const c = m === 'linha' ? window.px(i, f, 0) : window.px(f, i, 0);
      if (ant && dist(c, ant) > 10) { out.push([ini, i - 1, ant]); ini = i; }
      ant = c;
    }
    out.push([ini, i1, ant]); return out;
  }, [modo, fixo, a0, a1]);
  for (const [i, f, c] of r) if (f - i >= 0) console.log(`${i}-${f} (${f - i + 1}px) ${c}`);
}
await b.close();
