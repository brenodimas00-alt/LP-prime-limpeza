// Variáveis PÚBLICAS do front (src/config/ambiente.js, escrito só dentro do dist/) a partir de ~/.prime-env.
// Recusa chave secreta: só aceita sb_publishable_* ou JWT com role anon. Uso: node scripts/gera-ambiente.mjs
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

export function lerPrimeEnv(caminho = `${homedir()}/.prime-env`) {
  const env = {};
  for (const linha of readFileSync(caminho, 'utf8').split('\n')) {
    const m = linha.match(/^([A-Z0-9_]+)='?(.*?)'?$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

/** true só para chave que pode ir pro navegador. */
export function chavePublica(chave) {
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(chave)) return true;
  const partes = chave.split('.');
  if (partes.length !== 3) return false;
  try { return JSON.parse(Buffer.from(partes[1], 'base64url').toString()).role === 'anon'; } catch { return false; }
}

/** Conteúdo de src/config/ambiente.js. Recusa URL inválida e chave que não seja pública. */
export function conteudoAmbiente(env, { auth = 'supabase', dados = 'mock' } = {}) {
  const url = env.SUPABASE_URL; const chave = env.SUPABASE_PUBLISHABLE_KEY;
  if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(url || '')) throw new Error('SUPABASE_URL ausente ou inválida em ~/.prime-env. Rode scripts/cria-homolog.sh.');
  if (!chave || !chavePublica(chave)) throw new Error('SUPABASE_PUBLISHABLE_KEY ausente ou NÃO pública em ~/.prime-env. Nada gerado.');
  if (!['mock', 'supabase'].includes(auth) || !['mock', 'http', 'supabase'].includes(dados)) throw new Error('adapter inválido');
  return `// GERADO por scripts/monta-dist.mjs a partir de ~/.prime-env. Só valores públicos. Nunca no git.
export const AMBIENTE = ${JSON.stringify({ supabaseUrl: url, supabaseChavePublica: chave, auth, dados }, null, 2)};
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Só confere o ~/.prime-env (o arquivo em si é escrito dentro do dist/ pelo monta-dist).
  try { conteudoAmbiente(lerPrimeEnv()); console.log('~/.prime-env ok pra gerar o ambiente.'); } catch (e) { console.error(e.message); process.exit(1); }
}
