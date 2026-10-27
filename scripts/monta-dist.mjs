// Monta dist/ (fora do git) com só o que o Cloudflare Pages publica (lista permitida), e gera o _headers.
// Uso: node scripts/monta-dist.mjs   (lê ~/.prime-env; AUTH=... DADOS=... escolhem os adapters do preview)
// A CSP leva o hash de cada <script> inline e de cada on*="" encontrado nos HTML publicados: se a home mudar,
// o hash acompanha no próximo deploy sem mexer na home.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, posix, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { conteudoAmbiente, lerPrimeEnv } from './gera-ambiente.mjs';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(RAIZ, 'dist');
// Lista PERMITIDA (não de exclusão): arquivo novo na raiz, como um backup, nunca vai pro ar por engano.
export const PERMITIDO = /^(index\.html|404\.html|sitemap\.xml|robots\.txt|_redirects|_dev\/design-system\/.+|(assets|src|vendor|acompanhamento|autoagendamento|avaliacao|diarista|entrar|minha-conta|pagamento|painel|painel-proposta|privacidade|termos|condicoes)\/.+)$/;
export const EXTENSOES = /(\.(html|js|css|svg|png|jpe?g|webp|avif|ico|mp4|woff2?|pdf|webmanifest)|^(_redirects|sitemap\.xml|robots\.txt))$/i; // xml/txt só esses da raiz
// O mock (demonstração) lê o seed em runtime: é o único arquivo de scripts/ que vai pro site.
const EXTRA = ['scripts/fixtures/seed.js', 'scripts/fixtures/seed-painel.js'];
// Páginas de sistema: noindex também em produção.
export const SISTEMA = ['/entrar/*', '/minha-conta/*', '/painel/*', '/painel-proposta/*', '/_dev/*', '/diarista/entrar/*', '/diarista/agenda/*', '/pagamento/*', '/acompanhamento/*', '/avaliacao/*', '/404.html'];

const sha = (txt) => `'sha256-${createHash('sha256').update(txt, 'utf8').digest('base64')}'`;
const desentidade = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Hashes de scripts inline e de handlers on*="" de um HTML. */
export function hashesInline(html) {
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type="application\/ld\+json")[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).filter((c) => c.trim());
  const handlers = [...html.matchAll(/\son[a-z]+="([^"]*)"/gi)].map((m) => desentidade(m[1]));
  return { scripts: scripts.map(sha), handlers: handlers.map(sha) };
}

export function montarHeaders({ ref, scripts, handlers, analytics = false }) {
  const supa = ref ? ` https://${ref}.supabase.co wss://${ref}.supabase.co` : '';
  // P7: script do Turnstile por último (a ordem dos hashes é a que o teste do B0 confere)
  const scriptSrc = ["'self'", ...new Set(scripts), ...(handlers.length ? ["'unsafe-hashes'", ...new Set(handlers)] : []), 'https://challenges.cloudflare.com',
    ...(analytics ? ['https://static.cloudflareinsights.com'] : [])].join(' '); // O1: Web Analytics só com o token
  const csp = [
    "default-src 'self'", `script-src ${scriptSrc}`, "style-src 'self' 'unsafe-inline'",
    "font-src 'self'", "img-src 'self' data: blob:", `connect-src 'self' https://viacep.com.br${supa} https://challenges.cloudflare.com${analytics ? ' https://cloudflareinsights.com' : ''}`,
    'frame-src https://challenges.cloudflare.com', // P7: caixinha do Turnstile
    "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "object-src 'none'",
  ].join('; ');
  return [
    '/*',
    `  Content-Security-Policy: ${csp}`,
    '  X-Frame-Options: DENY',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  X-Content-Type-Options: nosniff',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=(self)', // P4: localização aproximada no check-in (com consentimento)
    // auditoria 30/09: HTTPS obrigatório no navegador (login e dado pessoal); sem includeSubDomains até conferir os
    // subdomínios do domínio da Prime no go-live (PENDENCIAS). COOP isola a janela de páginas abertas por outro site.
    '  Strict-Transport-Security: max-age=31536000',
    '  Cross-Origin-Opener-Policy: same-origin',
    '',
    '# Preview (*.pages.dev) inteiro fora do Google, inclusive o alias da branch.',
    'https://:project.pages.dev/*', '  X-Robots-Tag: noindex', '',
    'https://:version.:project.pages.dev/*', '  X-Robots-Tag: noindex', '',
    '# Páginas de sistema: noindex em qualquer host.',
    ...SISTEMA.flatMap((p) => [p, '  X-Robots-Tag: noindex', '']),
  ].join('\n');
}

/**
 * Desempenho (acabamento, 21/10/2026): o site é ES modules sem bundler. No dist (só no que vai pro Cloudflare, o código-fonte
 * não muda): (1) as folhas de CSS de cada página viram um arquivo só, com os url() reescritos pra raiz; (2) o modulepreload
 * do grafo de imports existe mas fica desligado (MODULEPRELOAD=1 liga): medido, piorou. Mede: scripts/painel-v2/lighthouse-painel.mjs.
 */
export function otimizarPaginas(dist) {
  const htmls = []; const andar = (d) => { for (const n of readdirSync(d)) { const c = join(d, n); if (statSync(c).isDirectory()) andar(c); else if (n.endsWith('.html')) htmls.push(c); } };
  andar(dist);
  const rel = (de, para) => posix.normalize(posix.join(posix.dirname(de), para));
  const naRaiz = (abs) => `/${posix.relative(dist.split(sep).join('/'), abs)}`;
  const grafo = new Map();
  function deps(mod) { // mod: caminho absoluto (posix) dentro do dist
    if (grafo.has(mod)) return grafo.get(mod);
    const fora = new Set(); grafo.set(mod, fora);
    let txt = ''; try { txt = readFileSync(mod, 'utf8'); } catch { return fora; }
    const estaticos = [...txt.matchAll(/(?:^|[;\s])(?:import|export)\s+(?:[^'"]*?\sfrom\s*)?['"](\.{1,2}\/[^'"]+)['"]/g)].map((m) => m[1]);
    // import() com caminho fixo entra também, menos a escolha do adapter (api.js) e o seed do mock: esses dependem do ambiente
    const dinamicos = /services\/(api|adapters\/mock)\.js$/.test(mod) ? [] : [...txt.matchAll(/import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)].map((m) => m[1]);
    for (const m of [...estaticos, ...dinamicos].map((x) => [null, x])) {
      const alvo = rel(mod, m[1]); if (!existsSync(alvo)) continue;
      fora.add(alvo); for (const x of deps(alvo)) fora.add(x);
    }
    return fora;
  }
  let paginas = 0; let preloads = 0;
  for (const arq of htmls) {
    const a = arq.split(sep).join('/');
    let html = readFileSync(arq, 'utf8'); const antes = html;
    // (1) CSS: as <link rel="stylesheet"> locais seguidas viram uma só
    const links = [...html.matchAll(/<link rel="stylesheet" href="([^"'+ ]+\.css)">\n?/g)].filter((m) => !/^https?:/.test(m[1]) && existsSync(rel(a, m[1])));
    if (links.length > 1) {
      const partes = links.map((m) => {
        const css = rel(a, m[1]);
        return readFileSync(css, 'utf8').replace(/url\((['"]?)(?!data:|https?:|\/)([^'")]+)\1\)/g, (_, q, u) => `url(${q}${naRaiz(rel(css, u))}${q})`);
      }).join('\n');
      const nome = `src/ui/pacote-${createHash('sha256').update(partes).digest('hex').slice(0, 10)}.css`;
      writeFileSync(join(dist, nome), partes);
      html = html.replace(links[0][0], `<link rel="stylesheet" href="/${nome}">\n`);
      for (const m of links.slice(1)) html = html.replace(m[0], '');
    }
    // (2) modulepreload do grafo de imports estáticos do módulo da página
    const mods = [...html.matchAll(/<script type="module" src="([^"]+)"><\/script>/g)].map((m) => rel(a, m[1]));
    if (mods.length) { // o adapter de dados deste build (mock ou supabase), que o api.js carrega por import()
      const dados = /"dados":\s*"mock"/.test(readFileSync(join(dist, 'src/config/ambiente.js'), 'utf8')) ? 'mock' : 'supabase';
      for (const x of (dados === 'mock' ? ['src/services/adapters/mock.js'] : ['src/services/adapters/supabase.js', 'src/services/supabase.js'])) mods.push(join(dist, x).split(sep).join('/'));
    }
    const todosMods = new Set(); for (const m of mods) for (const x of deps(m)) todosMods.add(x);
    // só nas páginas montadas pelo JS (corpo vazio no HTML); a home e as legais já chegam prontas e não precisam disputar banda
    const corpo = (html.split('<body')[1] || '').replace(/<script[\s\S]*?<\/script>|<noscript[\s\S]*?<\/noscript>|<[^>]+>/g, '').trim();
    // (3) páginas montadas pelo JS: o título (Source Serif 600) costuma ser o LCP; a fonte dele vem junto, sem esperar o CSS
    const SERIF = '/assets/fonts/source-serif-4-latin-600.woff2';
    if (corpo.length < 200 && !html.includes('source-serif-4-latin-600.woff2')) html = html.replace('</head>', `<link rel="preload" href="${SERIF}" as="font" type="font/woff2" crossorigin>\n</head>`);
    if (process.env.MODULEPRELOAD === '1' && todosMods.size && corpo.length < 200) { // medido em 21/10: com tudo pré-carregado o Início caiu de 85 pra 75 (banda gasta antes do primeiro desenho); fica desligado
      const tags = [...todosMods].map((x) => `<link rel="modulepreload" href="${naRaiz(x)}">`).join('\n');
      html = html.replace('</head>', `${tags}\n</head>`); preloads += todosMods.size;
    }
    if (html !== antes) { writeFileSync(arq, html); paginas += 1; }
  }
  return { paginas, preloads };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arquivos = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: RAIZ, encoding: 'utf8' })
    .split('\n').filter(Boolean).filter((f) => PERMITIDO.test(f) && EXTENSOES.test(f) && !/(^|\/)\./.test(f)).filter((f) => existsSync(join(RAIZ, f)));
  const env = lerPrimeEnv();
  // ambiente.js nasce aqui, dentro do dist/ (nunca no repo). Adapters por variável: AUTH=supabase|mock, DADOS=mock|supabase.
  const ambiente = conteudoAmbiente(env, { auth: process.env.AUTH || 'supabase', dados: process.env.DADOS || 'supabase', seedDemo: process.env.SEED_DEMO || null });
  rmSync(DIST, { recursive: true, force: true });
  const todos = [...new Set([...arquivos, ...EXTRA])];
  const scripts = []; const handlers = [];
  for (const f of todos) {
    mkdirSync(dirname(join(DIST, f)), { recursive: true });
    cpSync(join(RAIZ, f), join(DIST, f));
    if (f.endsWith('.html')) { const h = hashesInline(readFileSync(join(RAIZ, f), 'utf8')); scripts.push(...h.scripts); handlers.push(...h.handlers); }
  }
  writeFileSync(join(DIST, 'src/config/ambiente.js'), ambiente);
  const otim = otimizarPaginas(DIST);
  console.log(`dist/: ${otim.paginas} páginas com CSS num arquivo só e ${otim.preloads} modulepreload no total`);
  writeFileSync(join(DIST, '_headers'), montarHeaders({ ref: env.SUPABASE_PROJECT_REF, scripts, handlers, analytics: !!env.WEB_ANALYTICS_TOKEN }));
  console.log(`dist/: ${todos.length} arquivos; CSP com ${new Set(scripts).size} script(s) e ${new Set(handlers).size} handler(s) inline por hash.`);
}
