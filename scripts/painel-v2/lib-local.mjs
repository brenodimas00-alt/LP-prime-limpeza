// Painel v2 (etapa A): Supabase LOCAL (`supabase start`, migrations do repo) só com dado fictício. Nunca a homologação:
// recusa qualquer URL que não seja 127.0.0.1/localhost. Mesmo desenho do lib-api-teste (um usuário fictício por papel).
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { criarAdapterSupabase } from '../../src/services/adapters/supabase.js';

// SUPABASE_LOCAL_STATUS = arquivo gerado por `bash scripts/cli.sh supabase status -o json > <arquivo>` (fora do repo)
if (!process.env.SUPABASE_LOCAL_STATUS) throw new Error('Defina SUPABASE_LOCAL_STATUS com o JSON de `supabase status -o json`');
export const LOCAL = JSON.parse(readFileSync(process.env.SUPABASE_LOCAL_STATUS, 'utf8'));
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(LOCAL.API_URL || '')) throw new Error('Supabase local não está de pé (bash scripts/cli.sh supabase start)');
export const URL_API = LOCAL.API_URL;
export const CHAVE_PUBLICA = LOCAL.PUBLISHABLE_KEY || LOCAL.ANON_KEY;
const CHAVE_SECRETA = LOCAL.SECRET_KEY || LOCAL.SERVICE_ROLE_KEY;

const OPCOES = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
export const admin = createClient(URL_API, CHAVE_SECRETA, OPCOES);
export const anonimo = () => createClient(URL_API, CHAVE_PUBLICA, OPCOES);

let pool;
export async function sql(texto, params = []) {
  if (!pool) pool = new pg.Pool({ connectionString: LOCAL.DB_URL, max: 4 });
  return (await pool.query(texto, params)).rows;
}
export async function fecharSql() { if (pool) await pool.end(); pool = undefined; }

export function cpfFicticio() {
  const d = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  for (const n of [9, 10]) { const soma = d.reduce((s, x, i) => s + x * (n + 1 - i), 0); d.push(((soma * 10) % 11) % 10); }
  return d.join('');
}

/** Usuário fictício confirmado com papel; senha simples (o local não tem o pepper da function). */
export async function criarUsuario(email, papel = 'cliente', senha = `Senha-${randomUUID().slice(0, 8)}`) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: senha, email_confirm: true, user_metadata: { ficticio: true } });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  if (papel !== 'cliente') await sql('update public.perfis set papel = $1, papeis = array[$1] where user_id = $2', [papel, data.user.id]);
  return { id: data.user.id, email, senha };
}

/** Login por senha: o hook_token exige o ticket que a function emite; aqui o ticket é inserido direto (só local). */
export async function sessaoDe(u) {
  if (!u.id) u.id = (await sql('select id from auth.users where email = $1', [u.email]))[0]?.id;
  await sql(`insert into privado.tickets (tipo, user_id, expira_em) values ('login', $1, now() + interval '2 minutes')`, [u.id]);
  const c = anonimo();
  const { data, error } = await c.auth.signInWithPassword({ email: u.email, password: u.senha });
  if (error) throw new Error(`login ${u.email}: ${error.message}`);
  return { cliente: c, sessao: data.session, user: data.user };
}
export async function entrar(u) {
  const { cliente: c, sessao } = await sessaoDe(u);
  c.token = sessao.access_token;
  return c;
}

/** senha da admin fictícia do LOCAL (não existe em lugar nenhum fora deste banco descartável) */
export const SENHA_PRIME_LOCAL = 'Prime-2026-exemplo';
export const chave = (p = 'k') => `${p}-${randomUUID().slice(0, 12)}`;
export const PRIME = { ator: 'prime' };

/** Adapter supabase com um usuário fictício por papel (cliente nova vira conta no agendamento). */
export async function montarApi(primeUsuario) {
  const prime = await entrar(primeUsuario);
  const porEmail = new Map(); const porClienteId = new Map(); const porDiaristaId = new Map();
  async function usuarioCliente(email) {
    if (!porEmail.has(email)) porEmail.set(email, entrar(await criarUsuario(email)));
    return porEmail.get(email);
  }
  async function clientePara(s) {
    if (!s || s.ator === 'publico') return anonimo();
    if (s.ator === 'prime') return prime;
    if (s.ator === 'cliente') return porClienteId.get(s.id) || s.usuario || anonimo();
    if (s.ator === 'diarista') return porDiaristaId.get(s.id) || anonimo();
    return anonimo();
  }
  const base = criarAdapterSupabase({ clientePara, provaHumana: async () => ({ turnstile: 'XXXX.DUMMY.TOKEN.XXXX' }) });
  const api = {
    ...base,
    async confirmarAutoagendamento(d, o = {}) {
      const u = await usuarioCliente(d.cliente.email);
      const r = await base.confirmarAutoagendamento(d, { ...o, sessao: { ator: 'cliente', usuario: u } });
      porClienteId.set(r.cliente.id, u);
      return r;
    },
    atribuirDiarista: (id, d, o) => base.atribuirDiarista(id, { ...d, atribuirMesmoAssim: true }, o),
  };
  return { api, prime, porClienteId, porDiaristaId, porEmail };
}
