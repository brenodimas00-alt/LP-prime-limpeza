// Monta dist/ (fora do git) com só o que o Cloudflare Pages publica (lista permitida), e gera o _headers.
// Uso: node scripts/monta-dist.mjs   (depois de gera-ambiente.mjs)
// A CSP leva o hash de cada <script> inline e de cada on*="" encontrado nos HTML publicados: se a home mudar,
// o hash acompanha no próximo deploy sem mexer na home.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lerPrimeEnv } from './gera-ambiente.mjs';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(RAIZ, 'dist');
// Lista PERMITIDA (não de exclusão): arquivo novo na raiz, como um backup, nunca vai pro ar por engano.
export const PERMITIDO = /^(index\.html|404\.html|(assets|src|acompanhamento|autoagendamento|avaliacao|diarista|entrar|minha-conta|pagamento|painel)\/.+)$/;
export const EXTENSOES = /\.(html|js|css|svg|png|jpe?g|webp|ico|mp4|woff2?|pdf)$/i;
// O mock (demonstração) lê o seed em runtime: é o único arquivo de scripts/ que vai pro site.
const EXTRA = ['scripts/fixtures/seed.js'];
// Páginas de sistema: noindex também em produção.
export const SISTEMA = ['/entrar/*', '/minha-conta/*', '/painel/*', '/diarista/entrar/*', '/diarista/agenda/*', '/pagamento/*', '/acompanhamento/*', '/avaliacao/*', '/404.html'];

const sha = (txt) => `'sha256-${createHash('sha256').update(txt, 'utf8').digest('base64')}'`;
const desentidade = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Hashes de scripts inline e de handlers on*="" de um HTML. */
export function hashesInline(html) {
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type="application\/ld\+json")[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).filter((c) => c.trim());
  const handlers = [...html.matchAll(/\son[a-z]+="([^"]*)"/gi)].map((m) => desentidade(m[1]));
  return { scripts: scripts.map(sha), handlers: handlers.map(sha) };
}

export function montarHeaders({ ref, scripts, handlers }) {
  const supa = ref ? ` https://${ref}.supabase.co wss://${ref}.supabase.co` : '';
  const scriptSrc = ["'self'", ...new Set(scripts), ...(handlers.length ? ["'unsafe-hashes'", ...new Set(handlers)] : [])].join(' ');
  const csp = [
    "default-src 'self'", `script-src ${scriptSrc}`, "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data: blob:", `connect-src 'self' https://viacep.com.br${supa}`,
    "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "object-src 'none'",
  ].join('; ');
  return [
    '/*',
    `  Content-Security-Policy: ${csp}`,
    '  X-Frame-Options: DENY',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  X-Content-Type-Options: nosniff',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=()',
    '',
    '# Preview (*.pages.dev) inteiro fora do Google, inclusive o alias da branch.',
    'https://:project.pages.dev/*', '  X-Robots-Tag: noindex', '',
    'https://:version.:project.pages.dev/*', '  X-Robots-Tag: noindex', '',
    '# Páginas de sistema: noindex em qualquer host.',
    ...SISTEMA.flatMap((p) => [p, '  X-Robots-Tag: noindex', '']),
  ].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arquivos = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: RAIZ, encoding: 'utf8' })
    .split('\n').filter(Boolean).filter((f) => PERMITIDO.test(f) && EXTENSOES.test(f) && !/(^|\/)\./.test(f)).filter((f) => existsSync(join(RAIZ, f)));
  const ambiente = 'src/config/ambiente.js';
  if (!existsSync(join(RAIZ, ambiente))) { console.error(`${ambiente} não existe: rode node scripts/gera-ambiente.mjs antes.`); process.exit(1); }
  rmSync(DIST, { recursive: true, force: true });
  const todos = [...new Set([...arquivos, ...EXTRA, ambiente])];
  const scripts = []; const handlers = [];
  for (const f of todos) {
    mkdirSync(dirname(join(DIST, f)), { recursive: true });
    cpSync(join(RAIZ, f), join(DIST, f));
    if (f.endsWith('.html')) { const h = hashesInline(readFileSync(join(RAIZ, f), 'utf8')); scripts.push(...h.scripts); handlers.push(...h.handlers); }
  }
  const { SUPABASE_PROJECT_REF: ref } = lerPrimeEnv();
  writeFileSync(join(DIST, '_headers'), montarHeaders({ ref, scripts, handlers }));
  console.log(`dist/: ${todos.length} arquivos; CSP com ${new Set(scripts).size} script(s) e ${new Set(handlers).size} handler(s) inline por hash.`);
}
