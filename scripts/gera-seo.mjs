// S1: escreve o SEO técnico a partir de src/config/seo.js. Idempotente (rodar de novo não muda nada).
// - bloco <!-- seo:inicio --> ... <!-- seo:fim --> no <head> de cada página pública: title, description, canonical,
//   Open Graph, Twitter card e JSON-LD (home: LocalBusiness/HouseCleaningService, Service por serviço, FAQPage com o FAQ
//   que está na página; internas: BreadcrumbList);
// - sitemap.xml (só páginas públicas) e robots.txt (bloqueia sistema; aponta o sitemap).
// Campo da empresa 'PREENCHER' não é publicado: sai da marcação e aparece na lista de pendentes.
// Uso: node scripts/gera-seo.mjs [--verificar]   (--verificar: não grava, sai 1 se algo estiver desatualizado)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { DOMINIO, EMPRESA, SERVICOS, IMAGEM_OG, PAGINAS, BLOQUEADAS, VERSAO_SEO } from '../src/config/seo.js';
import { regioesAtendidas } from '../src/config/precos.js';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const verificar = process.argv.includes('--verificar');
const abs = (caminho) => `${DOMINIO}/${caminho}`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const texto = (html) => html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const preenchido = (v) => v && v !== 'PREENCHER';
export const pendentes = [];

function empresa() {
  const e = EMPRESA;
  const cidades = regioesAtendidas.map((r) => ({ '@type': 'City', name: r.cidade, containedInPlace: { '@type': 'State', name: 'Minas Gerais' } }));
  const end = { '@type': 'PostalAddress', addressLocality: e.endereco.cidade, addressRegion: e.endereco.uf, addressCountry: 'BR' };
  if (preenchido(e.endereco.rua)) end.streetAddress = e.endereco.rua; else pendentes.push('endereço (rua e número)');
  if (preenchido(e.endereco.cep)) end.postalCode = e.endereco.cep; else pendentes.push('CEP');
  const o = {
    '@type': ['LocalBusiness', 'HouseCleaningService'], '@id': `${DOMINIO}/#empresa`, name: e.nome, url: `${DOMINIO}/`,
    logo: abs('assets/logo.svg'), image: abs(IMAGEM_OG.caminho), telephone: e.telefone, address: end, areaServed: cidades,
    sameAs: [e.instagram], priceRange: '$$',
    openingHoursSpecification: e.horario.map((h) => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: h.dias, opens: h.abre, closes: h.fecha })),
  };
  if (preenchido(e.razaoSocial)) o.legalName = e.razaoSocial; else pendentes.push('razão social');
  if (preenchido(e.cnpj)) o.taxID = e.cnpj; else pendentes.push('CNPJ');
  if (preenchido(e.email)) o.email = e.email; else pendentes.push('e-mail');
  return o;
}

function faq(html) {
  const itens = [...html.matchAll(/<details class="faq-item[^"]*">\s*<summary>([\s\S]*?)<svg[\s\S]*?<\/summary>\s*<p class="faq-answer">([\s\S]*?)<\/p>/g)];
  return { '@type': 'FAQPage', '@id': `${DOMINIO}/#faq`, mainEntity: itens.map(([, q, r]) => ({ '@type': 'Question', name: texto(q), acceptedAnswer: { '@type': 'Answer', text: texto(r) } })) };
}

function trilha(p) {
  const itens = [{ nome: 'Início', caminho: '' }, ...(p.pai ? [p.pai] : []), { nome: p.trilha, caminho: p.caminho }];
  return { '@type': 'BreadcrumbList', itemListElement: itens.map((x, i) => ({ '@type': 'ListItem', position: i + 1, name: x.nome, item: abs(x.caminho) })) };
}

function jsonLd(p, html) {
  const grafo = p.home
    ? [
      { '@type': 'WebSite', '@id': `${DOMINIO}/#site`, url: `${DOMINIO}/`, name: EMPRESA.nome, inLanguage: 'pt-BR', publisher: { '@id': `${DOMINIO}/#empresa` } },
      empresa(),
      ...SERVICOS.map((s) => ({ '@type': 'Service', name: s, serviceType: s, provider: { '@id': `${DOMINIO}/#empresa` }, areaServed: regioesAtendidas.map((r) => r.cidade) })),
      faq(html),
    ]
    : [trilha(p)];
  return `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': grafo })}</script>`;
}

export function blocoSeo(p, html) {
  const url = abs(p.caminho);
  const img = abs(IMAGEM_OG.caminho);
  return [
    '<!-- seo:inicio (gerado por scripts/gera-seo.mjs a partir de src/config/seo.js; não editar à mão) -->',
    `<title>${esc(p.titulo)}</title>`,
    `<meta name="description" content="${esc(p.descricao)}">`,
    `<link rel="canonical" href="${url}">`,
    '<meta property="og:type" content="website">',
    '<meta property="og:locale" content="pt_BR">',
    `<meta property="og:site_name" content="${esc(EMPRESA.nome)}">`,
    `<meta property="og:title" content="${esc(p.titulo)}">`,
    `<meta property="og:description" content="${esc(p.descricao)}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:image" content="${img}">`,
    `<meta property="og:image:width" content="${IMAGEM_OG.largura}">`,
    `<meta property="og:image:height" content="${IMAGEM_OG.altura}">`,
    `<meta property="og:image:alt" content="${esc(IMAGEM_OG.alt)}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${esc(p.titulo)}">`,
    `<meta name="twitter:description" content="${esc(p.descricao)}">`,
    `<meta name="twitter:image" content="${img}">`,
    jsonLd(p, html),
    '<!-- seo:fim -->',
  ].join('\n');
}

export function aplicar(html, p) {
  let h = html.replace(/<!-- seo:inicio[\s\S]*?<!-- seo:fim -->\n?/, '');
  h = h.replace(/<title>[\s\S]*?<\/title>\n?/, '').replace(/<meta name="description"[^>]*>\n?/, '');
  return h.replace(/(<meta charset="UTF-8">\n)/i, `$1${blocoSeo(p, html)}\n`);
}

export function sitemap() {
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...PAGINAS.map((p) => `  <url><loc>${abs(p.caminho)}</loc><lastmod>${VERSAO_SEO}</lastmod></url>`), '</urlset>', ''].join('\n');
}

export function robots() {
  return ['User-agent: *', ...BLOQUEADAS.map((b) => `Disallow: ${b}`), '', `Sitemap: ${DOMINIO}/sitemap.xml`, ''].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const saidas = [];
  for (const p of PAGINAS) {
    const f = join(RAIZ, p.arquivo);
    if (!existsSync(f)) throw new Error(`página pública ausente: ${p.arquivo}`);
    const antes = readFileSync(f, 'utf8');
    if (!/<meta charset="UTF-8">\n/i.test(antes)) throw new Error(`${p.arquivo}: sem <meta charset="UTF-8"> em linha própria`);
    saidas.push([f, antes, aplicar(antes, p)]);
  }
  saidas.push([join(RAIZ, 'sitemap.xml'), existsSync(join(RAIZ, 'sitemap.xml')) ? readFileSync(join(RAIZ, 'sitemap.xml'), 'utf8') : '', sitemap()]);
  saidas.push([join(RAIZ, 'robots.txt'), existsSync(join(RAIZ, 'robots.txt')) ? readFileSync(join(RAIZ, 'robots.txt'), 'utf8') : '', robots()]);
  const mudou = saidas.filter(([, a, d]) => a !== d);
  if (verificar) {
    console.log(mudou.length ? `desatualizado: ${mudou.map(([f]) => f.replace(RAIZ, '')).join(', ')} (rode node scripts/gera-seo.mjs)` : 'SEO em dia');
    process.exit(mudou.length ? 1 : 0);
  }
  for (const [f, , d] of mudou) writeFileSync(f, d);
  console.log(`${mudou.length} arquivo(s) atualizados. Pendentes da empresa (não publicados): ${[...new Set(pendentes)].join(', ') || 'nenhum'}`);
}
