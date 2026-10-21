// Kit do logo (20/10/2026): recorta as versões do logo do material da cliente (Material_Completo_-_PDF.pdf, 12 páginas)
// e grava PNG transparente em assets/marca/, em 1x e 2x da largura de uso. O PDF não é vetorizável aqui (sem ferramenta
// de vetor no ambiente): as páginas são renderizadas em alta resolução com o pdf.js e recortadas no conteúdo.
// Uso: 1) renderizar as páginas em PNG transparente (escala 2 = 2160 px), ex. com o pdf.js no Chromium do Playwright;
//      2) node scripts/design/gera-marca.mjs <pasta-com-p01.png...p12.png>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const [dir] = process.argv.slice(2);
if (!dir) { console.error('uso: node scripts/design/gera-marca.mjs <pasta com p01.png..p12.png>'); process.exit(2); }
const SAIDA = new URL('../../assets/marca/', import.meta.url);
mkdirSync(SAIDA, { recursive: true });

// página do PDF -> arquivo, largura de uso em px (o 2x sai junto) e se o fundo branco da página deve sumir
const VERSOES = [
  ['p01', 'logo-colorido', 240, true], // fundo claro: cabeçalho, documentos
  ['p07', 'logo-branco', 200, false], // fundo escuro: rodapé, imagem de compartilhamento
  ['p05', 'logo-preto', 240, true], // impressão em uma cor
  ['p09', 'logo-colorido-grande', 480, true], // versão de alta resolução pra impressos
  ['p02', 'selo-colorido', 160, true],
  ['p08', 'selo-branco', 160, false],
  ['p06', 'selo-preto', 160, true],
];

const b = await chromium.launch();
const p = await b.newPage();
for (const [pg, nome, largura, tirarBranco] of VERSOES) {
  const src = `data:image/png;base64,${readFileSync(`${dir}/${pg}.png`).toString('base64')}`;
  for (const escala of [1, 2]) {
    const w = largura * escala;
    const png = await p.evaluate(async ([s, w, tirar]) => {
      const img = new Image(); img.src = s; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height); const px = d.data;
      let x0 = c.width; let y0 = c.height; let x1 = 0; let y1 = 0;
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        if (tirar && px[i] > 245 && px[i + 1] > 245 && px[i + 2] > 245) px[i + 3] = 0; // branco da página vira transparente
        if (px[i + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
      g.putImageData(d, 0, 0);
      const bw = x1 - x0 + 1; const bh = y1 - y0 + 1; const h = Math.round((bh / bw) * w);
      const o = document.createElement('canvas'); o.width = w; o.height = h;
      const og = o.getContext('2d'); og.imageSmoothingQuality = 'high'; og.drawImage(c, x0, y0, bw, bh, 0, 0, w, h);
      return o.toDataURL('image/png');
    }, [src, w, tirarBranco]);
    const arq = `${nome}${escala === 2 ? '@2x' : ''}.png`;
    writeFileSync(new URL(arq, SAIDA), Buffer.from(png.split(',')[1], 'base64'));
    console.log(arq);
  }
}
await b.close();
