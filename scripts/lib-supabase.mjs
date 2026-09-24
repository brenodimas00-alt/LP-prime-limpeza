// Helpers dos testes contra o Supabase de HOMOLOGAÇÃO. Só dados fictícios: e-mails teste-<execução>-*@example.com,
// linhas com ficticio = true. A limpeza só apaga o que tem essas duas marcas. Nunca imprime segredo nem dado real.
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { lerPrimeEnv } from './gera-ambiente.mjs';

export const ENV = lerPrimeEnv();
export const EXECUCAO = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
export const DOMINIO_TESTE = 'example.com';
const OPCOES = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

/** Senha que o Auth guarda: HMAC-SHA256(pepper, senha digitada). Ver DECISOES (B2). */
export function senhaDerivada(senha) {
  return createHmac('sha256', ENV.AUTH_PEPPER).update(String(senha), 'utf8').digest('hex');
}

export const admin = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SECRET_KEY, OPCOES);
export const anonimo = () => createClient(ENV.SUPABASE_URL, ENV.SUPABASE_PUBLISHABLE_KEY, OPCOES);

let pool;
/** SQL direto (service/postgres). Só pra montar e limpar fixture e checar privilégios. */
export async function sql(texto, params = []) {
  if (!pool) {
    const url = new URL('postgresql://aws-0-sa-east-1.pooler.supabase.com:5432/postgres');
    url.username = `postgres.${ENV.SUPABASE_PROJECT_REF}`;
    url.password = encodeURIComponent(ENV.SUPABASE_DB_PASSWORD);
    // TLS validado com a CA raiz pública do Supabase (scripts/certs), nunca rejectUnauthorized: false.
    const ca = readFileSync(new URL('./certs/supabase-root-2021.crt', import.meta.url), 'utf8');
    pool = new pg.Pool({ connectionString: url.toString(), ssl: { ca, rejectUnauthorized: true, servername: url.hostname }, max: 4 });
  }
  return (await pool.query(texto, params)).rows;
}
/** Uma conexão, uma transação; `ator` vira app.ator LOCAL (não vaza pra outras consultas do pool). */
export async function transacao(fn, { ator } = {}) {
  await sql('select 1');
  const c = await pool.connect();
  try {
    await c.query('begin');
    if (ator) await c.query(`select set_config('app.ator', $1, true)`, [ator]);
    const r = await fn((texto, params = []) => c.query(texto, params).then((x) => x.rows));
    await c.query('commit');
    return r;
  } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
}
export async function fecharSql() { if (pool) await pool.end(); pool = undefined; }

export const emailTeste = (rotulo) => `teste-${EXECUCAO}-${rotulo}-${randomUUID().slice(0, 6)}@${DOMINIO_TESTE}`;

/** Gera CPF válido aleatório (fictício). Chance de colidir com a base real é desprezível, e o teste confere antes. */
export function cpfFicticio() {
  const d = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  for (const n of [9, 10]) {
    const soma = d.reduce((s, x, i) => s + x * (n + 1 - i), 0);
    d.push(((soma * 10) % 11) % 10);
  }
  return d.join('');
}

/**
 * Usuário fictício confirmado, com papel. Devolve { id, email, senha }.
 * Senha já no formato do Auth (derivada), como faz a Edge Function de conta.
 */
export async function criarUsuario(rotulo, papel = 'cliente', senha = `Senha-${randomUUID().slice(0, 8)}`) {
  const email = emailTeste(rotulo);
  const { data, error } = await admin.auth.admin.createUser({
    email, password: senhaDerivada(senha), email_confirm: true, user_metadata: { ficticio: true, execucao: EXECUCAO },
  });
  if (error) throw new Error(`createUser ${rotulo}: ${error.message}`);
  if (papel !== 'cliente') await sql('update public.perfis set papel = $1 where user_id = $2', [papel, data.user.id]);
  return { id: data.user.id, email, senha };
}

/** Chama a Edge Function "conta". Devolve { status, corpo }. */
export async function conta(acao, dados = {}, token) {
  const r = await fetch(`${ENV.SUPABASE_URL}/functions/v1/conta`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ENV.SUPABASE_PUBLISHABLE_KEY, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ acao, ...dados }),
  });
  return { status: r.status, corpo: await r.json().catch(() => null) };
}

/** Cliente supabase-js logado PELA FUNCTION (o hook recusa login direto por senha). */
export let entrar = async ({ email, senha }) => {
  const r = await conta('entrar', { email, senha });
  if (r.status !== 200) throw new Error(`login ${email.split('@')[0]}: ${r.status} ${r.corpo?.erro?.codigo}`);
  const c = anonimo();
  const { error } = await c.auth.setSession(r.corpo.sessao);
  if (error) throw new Error(`setSession: ${error.message}`);
  c.papel = r.corpo.papel; c.token = r.corpo.sessao.access_token;
  return c;
};
export function definirEntrar(fn) { entrar = fn; }

/**
 * Apaga SÓ o que é fictício E desta execução (ou de qualquer execução de teste, sem `soEstaExecucao`):
 * usuários teste-*@example.com com metadado ficticio e as linhas ficticio = true ligadas a eles. Numa transação.
 */
export async function limparFicticios({ soEstaExecucao = false } = {}) {
  const filtroEmail = soEstaExecucao ? `teste-${EXECUCAO}-%@${DOMINIO_TESTE}` : `teste-%@${DOMINIO_TESTE}`;
  const us = (await sql(`select id from auth.users where email like $1 and raw_user_meta_data ->> 'ficticio' = 'true'`, [filtroEmail])).map((x) => x.id);
  await transacao(async (q) => {
    const cli = (await q('select id from public.clientes where ficticio and usuario_id = any($1::uuid[])', [us])).map((x) => x.id);
    const dia = (await q('select id from public.diaristas where ficticio and usuario_id = any($1::uuid[])', [us])).map((x) => x.id);
    const ped = (await q('select id from public.pedidos where ficticio and cliente_id = any($1::uuid[])', [cli])).map((x) => x.id);
    const ate = (await q('select id from public.atendimentos where pedido_id = any($1::uuid[]) or diarista_id = any($2::uuid[])', [ped, dia])).map((x) => x.id);
    await q(`delete from public.eventos where refs ->> 'pedidoId' = any($1::text[]) or refs ->> 'diaristaId' = any($2::text[]) or refs ->> 'clienteId' = any($3::text[])`, [ped, dia, cli]);
    await q(`delete from public.notificacoes where refs ->> 'pedidoId' = any($1::text[]) or refs ->> 'diaristaId' = any($2::text[])`, [ped, dia]);
    await q('delete from public.avaliacoes where atendimento_id = any($1::uuid[])', [ate]);
    await q('delete from public.pagamentos where pedido_id = any($1::uuid[])', [ped]);
    await q('update public.atendimentos set diarista_id = null where diarista_id = any($1::uuid[]) and not (pedido_id = any($2::uuid[]))', [dia, ped]);
    await q('delete from public.atendimentos where pedido_id = any($1::uuid[])', [ped]);
    await q('delete from public.pedidos where id = any($1::uuid[])', [ped]);
    // arquivos do bucket privado dos cadastros fictícios (o registro sai junto, abaixo)
    const docs = await q('select storage_path from public.documentos where diarista_id = any($1::uuid[])', [dia]);
    if (docs.length) { const { error } = await admin.storage.from('documentos-diaristas').remove(docs.map((x) => x.storage_path)); if (error) throw new Error(`storage.remove: ${error.message}`); }
    await q('delete from public.documentos where diarista_id = any($1::uuid[])', [dia]);
    await q('delete from public.diaristas where id = any($1::uuid[])', [dia]);
    await q('delete from public.clientes where id = any($1::uuid[])', [cli]);
    await q('delete from public.acessos where user_id = any($1::uuid[]) or email like $2', [us, filtroEmail]);
    // idempotência das chamadas fictícias: chave com o escopo do ator (cliente:<id>/diarista:<id>) ou resultado citando pedido/cliente/diarista fictício
    const ids = [...cli, ...dia, ...ped, ...us].map(String);
    if (ids.length) await q(`delete from public.idempotencia where exists (select 1 from unnest($1::text[]) i where chave like '%' || i || '%' or resultado::text like '%' || i || '%')`, [ids]);
  }, { ator: 'limpeza_teste' });
  for (const id of us) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) throw new Error(`deleteUser: ${error.message}`);
  }
  return us.length;
}
