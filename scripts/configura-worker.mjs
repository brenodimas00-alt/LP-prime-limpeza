// B5: configura o worker de notificações no projeto do ~/.prime-env. Idempotente.
// - WORKER_SEGREDO: gerado uma vez e guardado no ~/.prime-env (600); nunca impresso.
// - secrets da Edge Function (WORKER_SEGREDO, URL_SITE) por arquivo temporário em ~/.prime-dados (600), apagado no fim.
// - Vault do banco: URL da function e o segredo, lidos pelo pg_cron (privado.disparar_worker).
// Uso: bash scripts/cli.sh node22 scripts/configura-worker.mjs [url-do-site]
import { randomBytes } from 'node:crypto';
import { appendFileSync, writeFileSync, unlinkSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { ENV, sql, fecharSql } from './lib-supabase.mjs';

const URL_SITE = process.argv[2] || 'https://turno-2026-09-23.prime-limpeza.pages.dev/';
if (!/^https:\/\/[^/]+\/$/.test(URL_SITE)) throw new Error('url do site: https://host/ com barra no fim');

let segredo = ENV.WORKER_SEGREDO;
if (!segredo) {
  segredo = randomBytes(36).toString('base64url');
  appendFileSync(`${homedir()}/.prime-env`, `WORKER_SEGREDO='${segredo}'\n`);
  chmodSync(`${homedir()}/.prime-env`, 0o600);
  console.log('WORKER_SEGREDO gerado e guardado no ~/.prime-env');
}

const tmp = `${homedir()}/.prime-dados/worker-${process.pid}.env`;
writeFileSync(tmp, `WORKER_SEGREDO=${segredo}\nURL_SITE=${URL_SITE}\n`, { mode: 0o600 });
try {
  // sem as variáveis npm_* do npx que roda este script (o npx aninhado se perde com elas)
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^npm_/i.test(k)));
  const r = spawnSync('bash', ['scripts/cli.sh', 'supabase', 'secrets', 'set', '--env-file', tmp, '--project-ref', ENV.SUPABASE_PROJECT_REF], { encoding: 'utf8', env });
  if (r.status !== 0) throw new Error(`secrets set falhou: ${(r.stderr || '').split('\n').slice(-3).join(' ')}`);
  console.log('secrets da function: WORKER_SEGREDO, URL_SITE');
} finally { unlinkSync(tmp); }

const segredos = {
  prime_worker_url: `${ENV.SUPABASE_URL}/functions/v1/notificacoes`,
  prime_documentos_url: `${ENV.SUPABASE_URL}/functions/v1/documentos`, // retenção (B6)
  prime_worker_segredo: segredo,
};
for (const [nome, valor] of Object.entries(segredos)) {
  const [ja] = await sql('select id from vault.secrets where name = $1', [nome]);
  if (ja) await sql('select vault.update_secret($1::uuid, $2)', [ja.id, valor]);
  else await sql('select vault.create_secret($1, $2)', [valor, nome]);
}
console.log('vault: prime_worker_url, prime_documentos_url, prime_worker_segredo');
await fecharSql();
