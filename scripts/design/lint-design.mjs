// Lint de design (spec-design-system, D8): falha se CSS, JS de interface ou HTML usa valor visual fora dos tokens
// (src/ui/tokens.css é o único arquivo com valores), degradê, emoji, ícone fora do conjunto (src/ui/ds/icones.js),
// animação de entrada ou hover que levanta. Também é o inventário do diagnóstico (D1).
// Uso: node scripts/design/lint-design.mjs [--inventario] [--json]
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = process.env.RAIZ_LINT || fileURLToPath(new URL('../../', import.meta.url));
const INVENTARIO = process.argv.includes('--inventario');
const JSON_SAIDA = process.argv.includes('--json');

// fora do lint: dependências e saídas, o protótipo histórico da etapa A (painel-proposta), documentação e scripts
const IGNORA_DIR = new Set(['node_modules', 'dist', 'vendor', '.git', 'supabase', 'docs', 'painel-proposta', 'scripts', '.wrangler']);
// o arquivo de tokens (único com valores) e o módulo gerado de ícones
const IGNORA_ARQ = new Set(['src/ui/tokens.css', 'src/ui/ds/icones.js']);
// arquivos que desenham SVG que não é ícone (gráficos do painel)
const SVG_LIVRE = new Set(['src/ui/painel2/componentes.js']);
// arquivos ainda não migrados (vão saindo da lista no D5 e no D6; vazia no fim do D8)
const PENDENTES = new Set([]);
const SO_UI = (r) => r.endsWith('.html') || r.endsWith('.css') || r.startsWith('src/ui/');

function listar(dir, acc = []) {
  for (const n of readdirSync(dir)) {
    if (IGNORA_DIR.has(n)) continue;
    const p = join(dir, n); const st = statSync(p);
    if (st.isDirectory()) listar(p, acc);
    else if (/\.(css|js|html)$/.test(n)) acc.push(relative(RAIZ, p).split('\\').join('/'));
  }
  return acc;
}

// ---------- regras de declaração (CSS, style="" no HTML e style: '' em JS) ----------
const VAR = /^var\(--[a-z0-9-]+\)$/;
const SO_VARS = (v) => v.split(/\s+/).every((t) => VAR.test(t) || t === '0' || t === 'auto');
const ESPACO = /^(margin|padding|gap|row-gap|column-gap)(-|$)/;
// calc só com variáveis e números puros vale (ex.: calc(-1 * var(--e-2)), calc(100% + var(--e-1)))
const semCalc = (v) => v.replace(/calc\(([^()]|\([^()]*\))*\)/g, (c) => (/\d(px|rem|em)\b/.test(c.replace(/var\([^)]*\)/g, '')) ? '1px' : '0'));
const REGRAS = [
  ['gradiente', (p, v) => /gradient\(/.test(v)],
  ['cor', (p, v) => /#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?)\(/.test(v)],
  ['sombra', (p, v) => /^(box-shadow|text-shadow)$/.test(p) && !(v === 'none' || v.split(/\s*,\s*/).every((x) => VAR.test(x)))],
  ['raio', (p, v) => /radius/.test(p) && !SO_VARS(v)],
  ['fonte', (p, v) => (p === 'font-size' && !(VAR.test(v) || v === 'inherit' || v === '100%'))
    || (p === 'font-family' && !(VAR.test(v) || v === 'inherit')) || (p === 'font-weight' && !(VAR.test(v) || v === 'inherit')) || (p === 'font' && v !== 'inherit')],
  // 0 e 1 px (ajuste de borda) valem
  ['espaco', (p, v) => ESPACO.test(p) && semCalc(v).split(/\s+/).some((t) => /^-?\d*\.?\d+(px|rem|em)$/.test(t) && !/^-?(0(px|rem|em)?|1px)$/.test(t))],
  ['movimento', (p, v) => /^(transition|transition-duration|animation|animation-duration)$/.test(p) && /\d(ms|s)\b/.test(v.replace(/var\([^)]*\)/g, '')) && !/^ds-(pulso|gira)\b/.test(v)],
  ['efeito', (p, v) => /^(backdrop-filter|filter)$/.test(p) && /blur|drop-shadow/.test(v)],
];
function declaracoes(css) {
  const out = []; const sem = css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  const re = /([a-z-]+)\s*:\s*([^;{}]+?)\s*(?:!important)?\s*(?=;|}|$)/gm; let m;
  while ((m = re.exec(sem))) {
    if (/^(https?|data|url)$/.test(m[1]) || m[1].startsWith('--')) continue;
    out.push({ p: m[1].trim(), v: m[2].trim(), linha: sem.slice(0, m.index).split('\n').length });
  }
  return out;
}
function blocos(css) { // :hover com translate (cartão que levanta) e @keyframes fora dos dois do sistema
  const achados = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (/:hover/.test(m[1]) && /transform\s*:\s*translate/.test(m[2])) achados.push(['hover-levanta', m[1].trim()]);
  for (const k of css.matchAll(/@keyframes\s+([\w-]+)/g)) if (!/^ds-(pulso|gira)$/.test(k[1])) achados.push(['animacao', `@keyframes ${k[1]}`]);
  return achados;
}

// ---------- texto e ícones ----------
const EMOJI = /(?![\u00A9\u00AE\u2122\u2190-\u21FF])\p{Extended_Pictographic}/u;
function svgsForaDoConjunto(txt, rel) {
  if (rel.endsWith('.html')) return [...txt.matchAll(/<svg\b[^>]*>/g)].filter((m) => !/data-icone="[a-z0-9_]+"/.test(m[0])).length;
  return (txt.match(/<svg\b/g) || []).length;
}

const linhaDe = (txt, i) => txt.slice(0, i).split('\n').length;
const arquivos = listar(RAIZ).filter((r) => !IGNORA_ARQ.has(r) && SO_UI(r));
const falhas = []; const inv = { cores: {}, fontes: {}, tamanhos: {}, raios: {}, sombras: {}, porTipo: {}, porArquivo: {}, regras: {} };
const conta = (o, k) => { o[k] = (o[k] || 0) + 1; };

for (const rel of arquivos) {
  if (!INVENTARIO && PENDENTES.has(rel)) continue;
  const txt = readFileSync(join(RAIZ, rel), 'utf8');
  const decls = [];
  if (rel.endsWith('.css')) decls.push(...declaracoes(txt));
  else {
    const estilos = rel.endsWith('.html')
      ? [...txt.matchAll(/style="([^"]*)"/g), ...txt.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
      : [...txt.matchAll(/style:\s*'([^']*)'|style:\s*`([^`]*)`|\.style\.cssText\s*=\s*'([^']*)'/g)];
    for (const m of estilos) { const s = m[1] ?? m[2] ?? m[3] ?? ''; const linha = linhaDe(txt, m.index); for (const d of declaracoes(s)) decls.push({ ...d, linha }); }
    for (const m of txt.matchAll(/\.style\.([a-zA-Z]+)\s*=\s*'([^']*)'/g)) decls.push({ p: m[1].replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`), v: m[2], linha: linhaDe(txt, m.index) });
    if (rel.endsWith('.js')) for (const m of txt.matchAll(/['`](#[0-9a-fA-F]{3,8})['`]/g)) decls.push({ p: 'color', v: m[1], linha: linhaDe(txt, m.index) });
  }
  for (const d of decls) {
    if (INVENTARIO) {
      for (const c of d.v.match(/#[0-9a-fA-F]{3,8}\b|(rgba?|hsla?)\([^)]*\)/g) || []) conta(inv.cores, c.toLowerCase());
      if (d.p === 'font-family') conta(inv.fontes, d.v);
      if (d.p === 'font-size') conta(inv.tamanhos, d.v);
      if (/radius/.test(d.p)) conta(inv.raios, d.v);
      if (d.p === 'box-shadow') conta(inv.sombras, d.v);
      for (const [tipo, f] of REGRAS) if (f(d.p, d.v)) conta(inv.regras, tipo);
    }
    const r = REGRAS.find(([, f]) => f(d.p, d.v));
    if (r) falhas.push({ rel, linha: d.linha, tipo: r[0], msg: `${d.p}: ${d.v}` });
  }
  if (rel.endsWith('.css')) for (const [tipo, sel] of blocos(txt)) falhas.push({ rel, linha: 0, tipo, msg: sel });
  else {
    txt.split('\n').forEach((l, i) => { if (EMOJI.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l)) falhas.push({ rel, linha: i + 1, tipo: 'emoji', msg: l.trim().slice(0, 80) }); });
    if (!SVG_LIVRE.has(rel)) { const n = svgsForaDoConjunto(txt, rel); if (n) falhas.push({ rel, linha: 0, tipo: 'icone', msg: `${n} SVG fora do conjunto (use icone() de src/ui/ds/icones.js ou data-icone no HTML)` }); }
    for (const m of txt.matchAll(/assets\/icons\/(?!app-)[a-z-]+\.svg/g)) falhas.push({ rel, linha: linhaDe(txt, m.index), tipo: 'icone', msg: m[0] });
    if (/\breveal\b/.test(txt) && !rel.endsWith('.css')) falhas.push({ rel, linha: 0, tipo: 'animacao', msg: 'classe reveal (entrada animada)' });
  }
}
for (const f of falhas) { conta(inv.porTipo, f.tipo); conta(inv.porArquivo, f.rel); }

if (JSON_SAIDA) console.log(JSON.stringify({ falhas, inv }, null, 1));
else if (INVENTARIO) {
  const top = (o, n = 40) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${v}× ${k}`).join('\n  ');
  console.log(`arquivos: ${arquivos.length}\nocorrências por regra:\n  ${top(inv.regras)}\nproblemas por tipo (primeira regra de cada declaração):\n  ${top(inv.porTipo)}\npor arquivo:\n  ${top(inv.porArquivo)}\ncores (${Object.keys(inv.cores).length} distintas):\n  ${top(inv.cores, 30)}\nfontes:\n  ${top(inv.fontes)}\ntamanhos (${Object.keys(inv.tamanhos).length} distintos)\nraios (${Object.keys(inv.raios).length} distintos):\n  ${top(inv.raios, 20)}\nsombras (${Object.keys(inv.sombras).length} distintas)`);
} else {
  for (const f of falhas.slice(0, 150)) console.log(`${f.rel}:${f.linha} [${f.tipo}] ${f.msg}`);
  console.log(falhas.length ? `lint de design: ${falhas.length} problema(s)` : `lint de design: ok (${arquivos.length - PENDENTES.size} arquivos)`);
  process.exit(falhas.length ? 1 : 0);
}
