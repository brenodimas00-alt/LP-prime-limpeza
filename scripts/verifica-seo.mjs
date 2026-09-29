// S1: aceite do SEO técnico. Estrutura dos JSON-LD, title/description/canonical/OG em toda página pública,
// coerência sitemap x robots x noindex, alt nas imagens, versão dos documentos legais. Uso: node scripts/verifica-seo.mjs
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { DOMINIO, PAGINAS, SERVICOS, IMAGEM_OG, BLOQUEADAS } from '../src/config/seo.js';
import { VERSAO_LEGAL } from '../src/config/legal.js';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const ler = (f) => readFileSync(join(RAIZ, f), 'utf8');
const erros = [];
const erro = (m) => erros.push(m);
const meta = (h, attr, nome) => [...h.matchAll(new RegExp(`<meta ${attr}="${nome}" content="([^"]*)"`, 'g'))].map((m) => m[1]);
const des = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Largura e altura de um JPEG (marcador SOF). */
function tamanhoJpeg(buf) {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xc3) return { altura: buf.readUInt16BE(i + 5), largura: buf.readUInt16BE(i + 7) };
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

// ---------- páginas públicas ----------
const titulos = new Map(); const descricoes = new Map();
for (const p of PAGINAS) {
  if (!existsSync(join(RAIZ, p.arquivo))) { erro(`${p.arquivo}: não existe`); continue; }
  const h = ler(p.arquivo);
  const n = p.arquivo;
  if (!/<html lang="pt-BR">/.test(h)) erro(`${n}: sem lang="pt-BR"`);
  const t = [...h.matchAll(/<title>([^<]*)<\/title>/g)].map((m) => des(m[1]));
  if (t.length !== 1) erro(`${n}: ${t.length} <title>`);
  else if (t[0].length > 60) erro(`${n}: title com ${t[0].length} caracteres (máx. 60)`);
  const d = meta(h, 'name', 'description').map(des);
  if (d.length !== 1) erro(`${n}: ${d.length} meta description`);
  else if (d[0].length > 155 || d[0].length < 70) erro(`${n}: description com ${d[0].length} caracteres (70 a 155)`);
  if (titulos.has(t[0])) erro(`${n}: title repetido de ${titulos.get(t[0])}`); titulos.set(t[0], n);
  if (descricoes.has(d[0])) erro(`${n}: description repetida de ${descricoes.get(d[0])}`); descricoes.set(d[0], n);
  const can = [...h.matchAll(/<link rel="canonical" href="([^"]*)">/g)].map((m) => m[1]);
  if (can.length !== 1 || can[0] !== `${DOMINIO}/${p.caminho}`) erro(`${n}: canonical ${can.join(',') || 'ausente'} (esperado ${DOMINIO}/${p.caminho})`);
  if (/<meta name="robots" content="[^"]*noindex/.test(h)) erro(`${n}: pública com noindex`);
  for (const [attr, k] of [['property', 'og:title'], ['property', 'og:description'], ['property', 'og:url'], ['property', 'og:image'], ['property', 'og:locale'], ['name', 'twitter:card'], ['name', 'twitter:image']]) {
    if (meta(h, attr, k).length !== 1) erro(`${n}: ${k} ausente ou repetido`);
  }
  if (meta(h, 'property', 'og:url')[0] !== `${DOMINIO}/${p.caminho}`) erro(`${n}: og:url diferente do canonical`);
  if (meta(h, 'property', 'og:image')[0] !== `${DOMINIO}/${IMAGEM_OG.caminho}`) erro(`${n}: og:image fora do padrão`);
  if (meta(h, 'name', 'twitter:card')[0] !== 'summary_large_image') erro(`${n}: twitter:card`);
  // JSON-LD
  const blocos = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  if (!blocos.length) erro(`${n}: sem JSON-LD`);
  let grafo = [];
  for (const b of blocos) {
    if (/PREENCHER/.test(b)) erro(`${n}: JSON-LD publica PREENCHER`);
    try { const j = JSON.parse(b); if (j['@context'] !== 'https://schema.org') erro(`${n}: @context`); grafo.push(...(j['@graph'] || [j])); }
    catch (e) { erro(`${n}: JSON-LD inválido (${e.message})`); }
  }
  const tipos = (o) => [].concat(o['@type']);
  if (p.home) {
    const emp = grafo.find((o) => tipos(o).includes('LocalBusiness'));
    if (!emp) erro(`${n}: sem LocalBusiness`);
    else {
      if (!tipos(emp).includes('HouseCleaningService')) erro(`${n}: LocalBusiness sem HouseCleaningService`);
      for (const k of ['name', 'url', 'telephone', 'address', 'areaServed', 'image']) if (!emp[k]) erro(`${n}: LocalBusiness sem ${k}`);
      if (!emp.areaServed?.some((c) => c.name === 'Belo Horizonte')) erro(`${n}: areaServed sem Belo Horizonte`);
    }
    const serv = grafo.filter((o) => tipos(o).includes('Service'));
    if (serv.length !== SERVICOS.length || serv.some((s) => !s.name || !s.provider?.['@id'])) erro(`${n}: Service (${serv.length} de ${SERVICOS.length})`);
    const faq = grafo.find((o) => tipos(o).includes('FAQPage'));
    const naPagina = (h.match(/<details class="faq-item/g) || []).length;
    if (!faq || faq.mainEntity.length !== naPagina || faq.mainEntity.some((q) => !q.name || !q.acceptedAnswer?.text)) erro(`${n}: FAQPage não bate com o FAQ da página (${faq?.mainEntity.length} x ${naPagina})`);
  } else {
    const bc = grafo.find((o) => tipos(o).includes('BreadcrumbList'));
    const itens = bc?.itemListElement || [];
    if (itens.length < 2 || itens.at(-1).item !== `${DOMINIO}/${p.caminho}` || itens[0].item !== `${DOMINIO}/` || itens.some((x, i) => x.position !== i + 1)) erro(`${n}: BreadcrumbList`);
  }
  // alt: toda <img> tem alt; foto (fora de ícone/logo) tem alt descritivo
  for (const m of h.matchAll(/<img\b[^>]*>/g)) {
    const alt = m[0].match(/\balt="([^"]*)"/);
    const src = m[0].match(/\bsrc="([^"]*)"/)?.[1] || '';
    if (!alt) erro(`${n}: <img> sem alt (${src})`);
    else if (!alt[1].trim() && !/icons\/|\.svg$/.test(src)) erro(`${n}: foto sem alt descritivo (${src})`);
  }
}

// ---------- imagem OG ----------
const og = join(RAIZ, IMAGEM_OG.caminho);
if (!existsSync(og)) erro(`${IMAGEM_OG.caminho} não existe`);
else { const t = tamanhoJpeg(readFileSync(og)); if (t?.largura !== 1200 || t?.altura !== 630) erro(`${IMAGEM_OG.caminho}: ${t?.largura}x${t?.altura}`); }

// ---------- sitemap x robots x noindex ----------
const sm = [...ler('sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const esperado = PAGINAS.map((p) => `${DOMINIO}/${p.caminho}`);
if (JSON.stringify(sm) !== JSON.stringify(esperado)) erro(`sitemap.xml não bate com as páginas públicas`);
const rb = ler('robots.txt');
const disallow = [...rb.matchAll(/^Disallow: (\S+)/gm)].map((m) => m[1]);
if (JSON.stringify(disallow) !== JSON.stringify(BLOQUEADAS)) erro('robots.txt não bate com BLOQUEADAS');
if (!rb.includes(`Sitemap: ${DOMINIO}/sitemap.xml`)) erro('robots.txt sem Sitemap');
for (const u of sm) { const cam = u.slice(DOMINIO.length); if (disallow.some((d) => cam.startsWith(d))) erro(`sitemap tem página bloqueada no robots: ${cam}`); }
// toda página HTML que não é pública: noindex e bloqueada no robots
const publicas = new Set(PAGINAS.map((p) => p.arquivo));
const htmls = [];
const andar = (d) => { for (const f of readdirSync(join(RAIZ, d))) { const c = d ? `${d}/${f}` : f; if (/^(node_modules|dist|docs|scripts|vendor|\.git|\.wrangler|supabase)$/.test(c)) continue; if (statSync(join(RAIZ, c)).isDirectory()) andar(c); else if (c.endsWith('.html')) htmls.push(c); } };
andar('');
for (const f of htmls.filter((x) => !publicas.has(x))) {
  const h = ler(f);
  if (!/<meta name="robots" content="noindex">/.test(h)) erro(`${f}: página de sistema sem noindex`);
  if (f !== '404.html' && !disallow.some((d) => `/${f}`.startsWith(d))) erro(`${f}: página de sistema fora do robots.txt`);
  if (sm.some((u) => `/${f}`.startsWith(u.slice(DOMINIO.length)) && u.slice(DOMINIO.length) !== '/')) erro(`${f}: página de sistema no sitemap`);
}

// ---------- gerado em dia e versão legal ----------
try { execFileSync('node', [join(RAIZ, 'scripts/gera-seo.mjs'), '--verificar'], { stdio: 'pipe' }); } catch { erro('gera-seo desatualizado: rode node scripts/gera-seo.mjs'); }
for (const f of ['privacidade/index.html', 'termos/index.html']) {
  const v = ler(f).match(/data-versao>([^<]+)</)?.[1];
  if (v !== VERSAO_LEGAL) erro(`${f}: versão ${v} diferente de src/config/legal.js (${VERSAO_LEGAL})`);
}
const migr = readdirSync(join(RAIZ, 'supabase/migrations')).map((f) => ler(`supabase/migrations/${f}`)).join('\n');
if (!migr.includes(`('${VERSAO_LEGAL}',`)) erro(`versão legal ${VERSAO_LEGAL} sem linha em documentos_legais (migration)`);

console.log(erros.length ? erros.map((e) => `  FALHOU ${e}`).join('\n') : '');
console.log(`# verifica-seo: ${PAGINAS.length} páginas públicas, ${htmls.length - PAGINAS.length} de sistema; ${erros.length ? `${erros.length} problema(s)` : 'tudo certo'}`);
process.exit(erros.length ? 1 : 0);
