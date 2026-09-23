// Gera src/config/ambiente.js (fora do git) com as variáveis PÚBLICAS do front, a partir de ~/.prime-env.
// Recusa chave secreta: só aceita sb_publishable_* ou JWT com role anon. Uso: node scripts/gera-ambiente.mjs
import { readFileSync, writeFileSync } from 'node:fs';
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const env = lerPrimeEnv();
  const url = env.SUPABASE_URL; const chave = env.SUPABASE_PUBLISHABLE_KEY;
  if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(url || '')) { console.error('SUPABASE_URL ausente ou inválida em ~/.prime-env. Rode scripts/cria-homolog.sh.'); process.exit(1); }
  if (!chave || !chavePublica(chave)) { console.error('SUPABASE_PUBLISHABLE_KEY ausente ou NÃO pública em ~/.prime-env. Nada gerado.'); process.exit(1); }
  const destino = fileURLToPath(new URL('../src/config/ambiente.js', import.meta.url));
  writeFileSync(destino, `// GERADO por scripts/gera-ambiente.mjs a partir de ~/.prime-env. Fora do git. Só valores públicos.
export const AMBIENTE = ${JSON.stringify({ supabaseUrl: url, supabaseChavePublica: chave }, null, 2)};
`);
  console.log(`src/config/ambiente.js gerado (${url}).`);
}
