// S2: levanta as URLs do site antigo (primelimpezaespecializada.com.br) sem assumir nenhuma: sitemap.xml real (e
// filhos), rastreamento dos links internos a partir da home até profundidade 3, e as rotas conhecidas.
// Grava docs/urls-antigas.txt (URL, status, se é página de verdade ou "não encontrada" com 200, título).
// Arquivos estáticos do site antigo (framework/, source/, storage/, css, js, imagens) não viram redirecionamento.
// Uso: node scripts/levanta-urls-antigas.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HOST = 'primelimpezaespecializada.com.br';
const INICIO = `https://${HOST}/`;
const CONHECIDAS = ['/autoagendamento', '/diarista/autocadastro', '/cliente/autocadastro'];
const ESTATICO = /\.(css|js|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot|map|pdf|mp4)(\?|$)|^\/(framework|source|storage)\//i;
const PROFUNDIDADE = 3;

const ua = { 'User-Agent': 'Mozilla/5.0 (levantamento de URLs para redirecionamento 301; Prime Limpeza)' };
async function baixar(url) {
  const r = await fetch(url, { headers: ua, redirect: 'manual' });
  const corpo = r.status < 300 ? await r.text() : '';
  return { status: r.status, destino: r.headers.get('location'), corpo };
}
const naoEncontrada = (html) => /não encontrada no controle de rotas/i.test(html);
const titulo = (html) => (html.match(/<title>([^<]*)<\/title>/i)?.[1] || '').trim().replace(/\s+/g, ' ');

function normalizar(href, base) {
  if (/['"`+]|\$\{|%7B/i.test(href)) return null; // pedaço de template de JavaScript, não é link
  try {
    const u = new URL(href, base);
    if (u.hostname.replace(/^www\./, '') !== HOST || !/^https?:$/.test(u.protocol)) return null;
    u.hash = '';
    return u.pathname + u.search;
  } catch { return null; }
}

const vistos = new Map(); // caminho -> { status, pagina, titulo, destino, origem }
async function visitar(caminho, origem) {
  if (vistos.has(caminho)) return null;
  const r = await baixar(`https://${HOST}${caminho}`);
  const pagina = r.status === 200 && !naoEncontrada(r.corpo);
  vistos.set(caminho, { status: r.status, pagina, titulo: titulo(r.corpo), destino: r.destino, origem });
  return pagina ? r.corpo : null;
}

// 1) sitemap real (e sitemaps filhos)
async function sitemap(caminho) {
  const r = await baixar(`https://${HOST}${caminho}`);
  if (r.status !== 200 || !/<(urlset|sitemapindex)/.test(r.corpo)) { console.log(`${caminho}: sem sitemap válido (status ${r.status}${naoEncontrada(r.corpo) ? ', página de "não encontrada" com 200' : ''})`); return []; }
  const locs = [...r.corpo.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  if (/<sitemapindex/.test(r.corpo)) return (await Promise.all(locs.map((l) => sitemap(normalizar(l, INICIO))))).flat();
  return locs.map((l) => normalizar(l, INICIO)).filter(Boolean);
}
const doSitemap = [...await sitemap('/sitemap.xml'), ...await sitemap('/sitemap_index.xml')];
const robots = await baixar(`https://${HOST}/robots.txt`);
const doRobots = robots.status === 200 && !naoEncontrada(robots.corpo) ? [...robots.corpo.matchAll(/^Sitemap:\s*(\S+)/gim)].map((m) => normalizar(m[1], INICIO)) : [];
for (const s of doRobots) doSitemap.push(...await sitemap(s));

// 2) rastreamento a partir da home, até profundidade 3 (+ sitemap + rotas conhecidas como sementes)
let fronteira = [['/', 'home'], ...doSitemap.map((c) => [c, 'sitemap']), ...CONHECIDAS.map((c) => [c, 'rota conhecida'])];
for (let prof = 0; prof <= PROFUNDIDADE && fronteira.length; prof++) {
  const proxima = [];
  for (const [caminho, origem] of fronteira) {
    if (ESTATICO.test(caminho)) continue;
    const html = await visitar(caminho, origem);
    if (!html) continue;
    for (const m of html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/gi)) {
      const c = normalizar(m[1], `https://${HOST}${caminho}`);
      if (c && !ESTATICO.test(c) && !vistos.has(c)) proxima.push([c, `link em ${caminho} (profundidade ${prof + 1})`]);
    }
  }
  fronteira = [...new Map(proxima.map((x) => [x[0], x])).values()];
}

const linhas = [...vistos.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([c, v]) =>
  `${c}\t${v.status}${v.destino ? ` -> ${v.destino}` : ''}\t${v.pagina ? 'pagina' : 'nao-existe'}\t${v.titulo}\t${v.origem}`);
const saida = [
  `# URLs do site antigo (${HOST}), levantadas em ${new Date().toISOString().slice(0, 10)} por scripts/levanta-urls-antigas.mjs`,
  `# sitemap.xml real: ${doSitemap.length ? `${doSitemap.length} URLs` : 'não existe (responde 200 com página de "não encontrada")'}; robots.txt: ${doRobots.length ? 'com Sitemap' : 'não existe'}`,
  '# caminho\tstatus\tpagina|nao-existe\ttítulo\tonde foi achada',
  ...linhas, '',
].join('\n');
writeFileSync(fileURLToPath(new URL('../docs/urls-antigas.txt', import.meta.url)), saida);
console.log(saida);
