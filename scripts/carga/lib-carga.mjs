// Teste de VOLUME: conexão com o projeto SEPARADO prime-carga (CARGA_* no ~/.prime-env). Nunca a homologação: recusa
// se o ref for o do homolog ou se faltar a configuração. Só dados sintéticos (nenhum dado real vai pra lá).
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { lerPrimeEnv } from '../gera-ambiente.mjs';

export const ENV = lerPrimeEnv();
export const REF = ENV.CARGA_PROJECT_REF;
if (!/^[a-z0-9]{20}$/.test(REF || '') || !ENV.CARGA_DB_PASSWORD || !ENV.CARGA_URL) throw new Error('CARGA_* ausente no ~/.prime-env');
if (REF === ENV.SUPABASE_PROJECT_REF) throw new Error('CARGA_PROJECT_REF é o da homologação: abortado');
if (!ENV.CARGA_URL.includes(REF)) throw new Error('CARGA_URL não bate com CARGA_PROJECT_REF');

let pool;
export async function sql(texto, params = []) {
  if (!pool) {
    const url = new URL('postgresql://aws-0-sa-east-1.pooler.supabase.com:5432/postgres');
    url.username = `postgres.${REF}`;
    url.password = encodeURIComponent(ENV.CARGA_DB_PASSWORD);
    const ca = readFileSync(new URL('../certs/supabase-root-2021.crt', import.meta.url), 'utf8');
    pool = new pg.Pool({ connectionString: url.toString(), ssl: { ca, rejectUnauthorized: true, servername: url.hostname }, max: 4, statement_timeout: 600000 });
  }
  return (await pool.query(texto, params)).rows;
}
export async function fechar() { if (pool) await pool.end(); pool = undefined; }

const OPCOES = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
export const admin = () => createClient(ENV.CARGA_URL, ENV.CARGA_SECRET_KEY, OPCOES);
export const publico = () => createClient(ENV.CARGA_URL, ENV.CARGA_PUBLISHABLE_KEY, OPCOES);
