// Varredura de segredo antes de commit e de deploy. Nunca imprime o valor achado, só arquivo:linha e o tipo.
// Uso: node scripts/varre-segredos.mjs          (arquivos do git: rastreados, staged e novos não ignorados)
//      node scripts/varre-segredos.mjs dist     (também tudo dentro de dist/, antes do deploy)
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chavePublica, lerPrimeEnv } from './gera-ambiente.mjs';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const BINARIO = /\.(png|jpe?g|webp|gif|ico|pdf|mp4|woff2?|ttf|zip)$/i;
const IGNORA = [/^package-lock\.json$/, /(^|\/)node_modules\//];
// Arquivos que CITAM o nome do papel pra detectá-lo. Só a menção é liberada neles; os outros padrões valem.
const CITAM = new Set(['scripts/varre-segredos.mjs', 'scripts/gera-ambiente.mjs']);

const PADROES = [
  ['chave secreta do Supabase', /sb_secret_[A-Za-z0-9_-]{8,}/],
  ['menção a service_role', /service_role/],
  ['token GitHub', /\b(ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{20,}/],
  ['chave OpenAI/Anthropic', /\bsk-(ant-)?[A-Za-z0-9_-]{20,}/],
  ['chave AWS', /\bAKIA[0-9A-Z]{16}\b/],
  ['token Slack', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['token Cloudflare', /\b(CLOUDFLARE_API_TOKEN|CF_API_TOKEN)\s*[=:]\s*\S{20,}/],
  ['chave privada', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['senha em URL de banco', /postgres(ql)?:\/\/[^:\s]+:[^@\s]{6,}@/],
];

function sensiveisDoEnv() {
  const f = `${homedir()}/.prime-env`;
  if (!existsSync(f)) return [];
  const env = lerPrimeEnv(f);
  // tudo do env que não é público nem identificador
  return Object.entries(env).filter(([k, v]) => v && v.length >= 8 && !['SUPABASE_URL', 'SUPABASE_PROJECT_REF', 'SUPABASE_PUBLISHABLE_KEY'].includes(k)).map(([k, v]) => [k, v]);
}

/** Achados de um texto: [{linha, tipo}]. Exportado pro teste. */
export function varrerTexto(texto, { arquivo = '', sensiveis = [] } = {}) {
  const achados = [];
  texto.split('\n').forEach((l, i) => {
    const linha = i + 1;
    for (const [tipo, re] of PADROES) {
      // SQL e config do Supabase citam o PAPEL service_role (GRANT, comentários); a CHAVE é pega por sb_secret/JWT.
      if (tipo === 'menção a service_role' && (CITAM.has(arquivo) || arquivo.startsWith('supabase/'))) continue;
      if (re.test(l)) achados.push({ linha, tipo });
    }
    for (const [k, v] of sensiveis) if (l.includes(v)) achados.push({ linha, tipo: `valor de ${k} do ~/.prime-env` });
    for (const m of l.matchAll(/eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g)) if (!chavePublica(m[0])) achados.push({ linha, tipo: 'JWT não-anon' });
    // base64 longo que não é data: URI, hash hex, integrity nem hash da CSP
    for (const m of l.matchAll(/(?<![A-Za-z0-9+/_-])[A-Za-z0-9+/]{64,}={0,2}/g)) {
      const antes = l.slice(Math.max(0, m.index - 12), m.index);
      if (/base64,$|sha\d{3}-$/.test(antes) || /^[0-9a-f]+$/i.test(m[0]) || /^[A-Za-z]+$/.test(m[0])) continue;
      if (/[0-9]/.test(m[0]) && /[A-Z]/.test(m[0]) && /[a-z]/.test(m[0])) achados.push({ linha, tipo: 'base64 longo' });
    }
  });
  return achados;
}

function listar(dir) {
  return readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? listar(p) : [p]; });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const git = (...a) => execFileSync('git', a, { cwd: RAIZ, encoding: 'utf8', maxBuffer: 64 << 20 });
  const sensiveis = sensiveisDoEnv();
  const pular = (rel) => BINARIO.test(rel) || IGNORA.some((r) => r.test(rel));
  let total = 0; let n = 0;
  const varrer = (rel, texto, onde) => { n++; for (const a of varrerTexto(texto, { arquivo: rel, sensiveis })) { console.log(`SEGREDO? ${onde}${rel}:${a.linha} (${a.tipo})`); total++; } };
  // 1. working tree: rastreados e novos não ignorados
  for (const rel of git('ls-files', '--cached', '--others', '--exclude-standard').split('\n').filter(Boolean)) {
    const abs = join(RAIZ, rel);
    if (!pular(rel) && existsSync(abs) && !statSync(abs).isDirectory()) varrer(rel, readFileSync(abs, 'utf8'), '');
  }
  // 2. o que está STAGED (é isso que o commit leva, mesmo que o arquivo local já tenha sido limpo)
  for (const rel of git('diff', '--cached', '--name-only', '--diff-filter=ACMR').split('\n').filter(Boolean)) {
    if (!pular(rel)) varrer(rel, git('show', `:${rel}`), '[staged] ');
  }
  // 3. dist/, antes do deploy
  if (process.argv.includes('dist')) for (const abs of listar(join(RAIZ, 'dist'))) { const rel = relative(RAIZ, abs); if (!pular(rel)) varrer(rel, readFileSync(abs, 'utf8'), ''); }
  console.log(total ? `varre-segredos: ${total} achado(s). NÃO commitar/publicar.` : `varre-segredos: 0 achados em ${n} arquivos.`);
  process.exit(total ? 1 : 0);
}
