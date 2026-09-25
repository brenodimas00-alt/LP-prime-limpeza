// Extrai o <style> do index.html pra src/ui/{tokens,base,home}.css e troca por <link>. Usado quando a home
// aprovada chega com CSS inline (ex.: upload pelo GitHub). Depois rode scripts/compara-home.mjs.
import { readFileSync, writeFileSync } from 'node:fs';

const L = readFileSync('index.html', 'utf8').split('\n');
const ini = L.indexOf('<style>');
const fim = L.indexOf('</style>');
if (ini < 0 || fim < 0) { console.log('index.html já está sem <style> inline'); process.exit(0); }
const achar = (s) => { const i = L.findIndex((l, k) => k > ini && k < fim && l.trim() === s); if (i < 0) throw new Error(`marcador não achado: ${s}`); return i; };
let fimRoot = ini + 1; while (L[fimRoot].trim() !== '}') fimRoot++;
const hero = achar('/* ---------- hero ---------- */');
const footer = achar('/* footer */');
const reveal = achar('/* ---------- scroll reveal animations ---------- */');
const resp = achar('/* ---------- responsive ---------- */');
const tokens = L.slice(ini + 1, fimRoot + 1);
const base = L.slice(fimRoot + 1, hero);
const home1 = L.slice(hero, footer);
const foot = L.slice(footer, reveal);
const home2 = L.slice(reveal, resp);
const respl = L.slice(resp + 1, fim);
const BASE_SEL = /^\s*(nav\.links|\.nav-cta|\.menu-btn|#mobileNav|footer|\.footer)/;
const ordem = []; const bm = {}; const hm = {}; let cur = null;
for (const l of respl) {
  const m = /^\s*@media \((.*)\)\{/.exec(l);
  if (m) { cur = m[1]; ordem.push(cur); bm[cur] = []; hm[cur] = []; continue; }
  if (l.trim() === '}' && cur) { cur = null; continue; }
  if (cur === null) continue;
  if (l.trim().startsWith('/*')) { hm[cur].push(l); continue; }
  (BASE_SEL.test(l) ? bm : hm)[cur].push(l);
}
const media = (d) => ordem.flatMap((k) => (d[k].some((x) => x.trim() && !x.trim().startsWith('/*')) ? [`  @media (${k}){`, ...d[k], '  }'] : []));
const des = (ls) => ls.map((l) => (l.startsWith('  ') ? l.slice(2) : l));
const cab = '/* Extraído do index.html aprovado. Não mudar valores sem aprovar o visual. */';
writeFileSync('src/ui/tokens.css', [cab, ...des(tokens)].join('\n') + '\n');
writeFileSync('src/ui/base.css', [cab, '/* Base, botões, header e footer: compartilhados por todas as páginas. */', ...des([...base, ...foot, '  /* ---------- responsive (header/footer) ---------- */', ...media(bm)])].join('\n') + '\n');
writeFileSync('src/ui/home.css', [cab, '/* Seções da home. */', ...des([...home1, ...home2, '  /* ---------- responsive ---------- */', ...media(hm)])].join('\n') + '\n');
writeFileSync('index.html', [...L.slice(0, ini), '<link rel="stylesheet" href="src/ui/tokens.css">', '<link rel="stylesheet" href="src/ui/base.css">', '<link rel="stylesheet" href="src/ui/home.css">', ...L.slice(fim + 1)].join('\n'));
console.log('CSS extraído');
