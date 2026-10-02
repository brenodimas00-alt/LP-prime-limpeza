// Painel v2 (etapa A): monta um PDF a partir de screenshots + legendas (uma página por tela, no tamanho da tela), com capa
// e, opcionalmente, páginas "antes e depois". Antes de gravar, varre todo o texto do PDF atrás de dado da base real.
// Uso: LD_LIBRARY_PATH=... bash scripts/cli.sh node22 scripts/painel-v2/gera-pdf.mjs atual|proposta [destino.pdf]
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { dadosReais, acharDadosReais } from '../varre-segredos.mjs';

const qual = process.argv[2];
const ONEDRIVE = '/mnt/c/Users/gabri/OneDrive/Área de Trabalho/Prime_Limpeza/';
const destino = process.argv[3] || `${ONEDRIVE}painel-${qual}.pdf`;
const { capa, paginas } = (await import(`./legendas-${qual}.mjs`)).default;
const RAIZ = new URL('../../', import.meta.url);
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const img = (caminho) => `data:image/png;base64,${readFileSync(new URL(caminho, RAIZ)).toString('base64')}`;
const dims = (caminho) => { const b = readFileSync(new URL(caminho, RAIZ)); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };

// Texto que vai pro PDF (capa + legendas): nada da base real.
const textos = [capa.titulo, capa.subtitulo, ...capa.linhas, ...paginas.flatMap((p) => [p.titulo, p.legenda, ...(p.notas || [])])].join('\n');
const reais = await dadosReais();
const achados = acharDadosReais(textos, reais);
if (achados.length) { console.error(`ABORTADO: ${achados.length} dado(s) da base real no texto do PDF`); process.exit(1); }

const LARGURA = 1440; const CAB = 150; const RODAPE = 40;
let css = `@page{margin:0}body{margin:0;font-family:Inter,system-ui,sans-serif;color:#201e1d}
.capa{page:capa;width:${LARGURA}px;height:900px;box-sizing:border-box;padding:120px 110px;background:#fbf7f5}
.capa h1{font-size:46px;margin:0 0 10px;color:#2a2456}.capa h2{font-size:22px;font-weight:400;margin:0 0 40px;color:#5c5853}.capa p{font-size:18px;line-height:1.6;margin:0 0 8px;max-width:900px}
.capa .lista{margin-top:36px;columns:2;column-gap:40px;font-size:15px;line-height:1.7}
.pg{box-sizing:border-box;width:${LARGURA}px;padding:28px 40px 0;background:#fff;overflow:hidden}
.pg h3{font-size:26px;margin:0 0 6px;color:#2a2456}.pg .leg{font-size:16px;line-height:1.5;color:#3b3835;margin:0 0 14px;max-width:1200px}.pg .nota{font-size:13px;color:#8e2a1c;margin:0 0 6px}
.pg .moldura{border:1px solid #e5e0da;border-radius:6px;overflow:hidden;background:#fff}
.pg img{display:block}
.pg.lado{display:grid;grid-template-columns:1fr 1fr;gap:24px}.pg.lado .col{min-width:0}.pg.lado h4{margin:0 0 6px;font-size:15px;letter-spacing:.06em;text-transform:uppercase;color:#5c5853}.pg.lado .moldura img{width:100%}
.pg.lado .leg{grid-column:1/-1}.pg.lado h3{grid-column:1/-1}
.rodape{font-size:12px;color:#8a857f;padding:10px 0 0;text-align:right}`;
const partes = [];
const capaHtml = `<section class="capa"><h1>${esc(capa.titulo)}</h1><h2>${esc(capa.subtitulo)}</h2>${capa.linhas.map((l) => `<p>${esc(l)}</p>`).join('')}<div class="lista">${paginas.map((p, i) => `<div>${i + 1}. ${esc(p.titulo)}</div>`).join('')}</div></section>`;
css += `@page capa{size:${LARGURA}px 900px}`;
partes.push(capaHtml);

paginas.forEach((p, i) => {
  const nome = `p${i}`;
  if (p.depois) {
    // antes e depois lado a lado, cada um a 50% (altura da página = a maior das duas, escalada)
    const a = dims(p.arquivo); const d = dims(p.depois);
    const colW = (LARGURA - 80 - 24) / 2;
    const altA = a.h * (colW / a.w); const altD = d.h * (colW / d.w);
    const alt = Math.ceil(CAB + Math.max(altA, altD) + RODAPE + 30);
    css += `@page ${nome}{size:${LARGURA}px ${alt}px}`;
    partes.push(`<section class="pg lado" style="page:${nome};height:${alt}px"><h3>${esc(p.titulo)}</h3><p class="leg">${esc(p.legenda)}</p>
      <div class="col"><h4>Antes (painel atual)</h4><div class="moldura"><img src="${img(p.arquivo)}" alt=""></div></div>
      <div class="col"><h4>Depois (proposta)</h4><div class="moldura"><img src="${img(p.depois)}" alt=""></div></div></section>`);
    return;
  }
  const { w, h } = dims(p.arquivo);
  const escala = w > LARGURA - 80 ? (LARGURA - 80) / w : 1;
  const altImg = Math.ceil(h * escala);
  const notas = (p.notas || []).map((n) => `<p class="nota">${esc(n)}</p>`).join('');
  const alt = CAB + altImg + RODAPE + (p.notas ? 24 * p.notas.length : 0);
  css += `@page ${nome}{size:${LARGURA}px ${alt}px}`;
  partes.push(`<section class="pg" style="page:${nome};height:${alt}px"><h3>${esc(p.titulo)}</h3><p class="leg">${esc(p.legenda)}</p>${notas}
    <div class="moldura" style="width:${Math.ceil(w * escala)}px"><img src="${img(p.arquivo)}" alt="" style="width:${Math.ceil(w * escala)}px"></div>
    <p class="rodape">${esc(capa.titulo)} · ${i + 1} de ${paginas.length} · ${w} px · dados fictícios</p></section>`);
});

const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>${css}</style></head><body>${partes.join('')}</body></html>`;
const b = await chromium.launch();
const pg = await b.newPage();
await pg.setContent(html, { waitUntil: 'load' });
await pg.pdf({ path: destino, preferCSSPageSize: true, printBackground: true });
await b.close();
// cópia no repo (docs/painel-v2) pra ir junto no PR
const copia = new URL(`../../docs/painel-v2/painel-${qual}.pdf`, import.meta.url);
if (!existsSync(new URL('../../docs/painel-v2/', import.meta.url))) mkdirSync(new URL('../../docs/painel-v2/', import.meta.url), { recursive: true });
writeFileSync(copia, readFileSync(destino));
console.log(`${destino} (${paginas.length + 1} páginas, ${(readFileSync(destino).length / 1e6).toFixed(1)} MB); cópia em docs/painel-v2/painel-${qual}.pdf`);
