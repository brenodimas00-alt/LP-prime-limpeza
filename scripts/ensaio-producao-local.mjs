// Pré-lançamento (27/10/2026): ensaio do banco de PRODUÇÃO do zero, no Supabase LOCAL (docker, descartável), sem pagar
// nada e sem tocar em projeto remoto. Faz o mesmo que o passo 3 do go-live faz na nuvem (todas as migrations, em ordem,
// num banco vazio) e confere o resultado:
//   1. todas as migrations do repo aplicadas;
//   2. RLS ligado em TODA tabela do schema public;
//   3. nenhum dado pessoal (clientes, profissionais, pedidos, contas: zero linhas);
//   4. configuração inicial presente (preços, regiões, feriados, motivos, flags, automações, templates, textos legais);
//   5. o visitante anônimo não lê tabela com dado pessoal nem RPC do painel, e lê o que é público (conteúdo do agendamento);
//   6. a flag do Turnstile nasce LIGADA (o go-live precisa das chaves antes da virada; ver docs/GO-LIVE.md).
// Depois grava um arquivo de ambiente LOCAL no scratchpad pra rodar os testes de banco contra ele (PRIME_ENV=...).
// Trava: só roda se o `supabase status` disser que o banco é 127.0.0.1; usa `db reset --local`, nunca --linked.
// Uso: cd ~/projetos/LP-prime-limpeza && node scripts/ensaio-producao-local.mjs [arquivo-env-de-saída]
import { execFileSync } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';
import pg from 'pg';

const sb = (...a) => execFileSync('bash', ['scripts/cli.sh', 'supabase', ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 600000 });
const st = JSON.parse(sb('status', '-o', 'json').replace(/^[^{]*/, '').replace(/}[^}]*$/, '}'));
const DB = new URL(st.DB_URL);
if (!['127.0.0.1', 'localhost'].includes(DB.hostname)) { console.error(`ABORTADO: o banco do supabase status não é local (${DB.hostname})`); process.exit(2); }

const falhas = [];
const conferir = (ok, msg) => { console.log(`  ${ok ? 'ok  ' : 'FALHOU'} ${msg}`); if (!ok) falhas.push(msg); };

console.log('# reset do banco LOCAL com todas as migrations, sem seed de dados');
sb('db', 'reset', '--local', '--no-seed');
const c = new pg.Client(st.DB_URL); await c.connect();
const q = async (t, p = []) => (await c.query(t, p)).rows;

const arquivos = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).length;
const [{ n: aplicadas }] = await q('select count(*)::int n from supabase_migrations.schema_migrations');
conferir(aplicadas === arquivos, `migrations aplicadas: ${aplicadas} de ${arquivos}`);

const semRls = await q("select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity order by 1");
conferir(semRls.length === 0, `RLS ligado em todas as tabelas do public${semRls.length ? ` (sem RLS: ${semRls.map((x) => x.relname).join(', ')})` : ''}`);

const PESSOAIS = ['clientes', 'diaristas', 'pedidos', 'atendimentos', 'pagamentos', 'enderecos', 'documentos', 'consentimentos', 'aceites_termos', 'avaliacoes', 'acessos'];
const contagem = {}; for (const t of PESSOAIS) contagem[t] = (await q(`select count(*)::int n from public.${t}`))[0].n; // uma consulta por vez (um cliente só)
const [{ n: contas }] = await q('select count(*)::int n from auth.users');
conferir(Object.values(contagem).every((n) => n === 0) && contas === 0, `nenhum dado pessoal (${PESSOAIS.length} tabelas e auth.users com zero linhas)`);

const CONFIG = ['precos', 'regioes', 'feriados', 'motivos', 'config_flags', 'configuracao', 'automacao_regras', 'templates', 'documentos_legais', 'condicoes_atendimento'];
const cfg = {}; for (const t of CONFIG) cfg[t] = (await q(`select count(*)::int n from public.${t}`))[0].n;
const vazias = CONFIG.filter((t) => !cfg[t]);
conferir(vazias.length === 0, `configuração inicial presente (${CONFIG.map((t) => `${t} ${cfg[t]}`).join(', ')})`);

const [turn] = await q("select ligada from public.config_flags where chave = 'p7_turnstile'");
conferir(turn?.ligada === true, 'flag p7_turnstile nasce ligada (o go-live põe as chaves do Turnstile antes da virada)');

// como o visitante do site: PostgREST com a chave pública local (sem supabase-js, que exige WebSocket no Node 20)
const CHAVE = st.PUBLISHABLE_KEY || st.ANON_KEY;
const rest = async (caminho, corpo) => {
  const r = await fetch(`${st.API_URL}/rest/v1/${caminho}`, { method: corpo ? 'POST' : 'GET', headers: { apikey: CHAVE, 'Content-Type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined });
  return { ok: r.ok, status: r.status, dados: await r.json().catch(() => null) };
};
const leClientes = await rest('clientes?select=id&limit=1');
conferir(!leClientes.ok || (leClientes.dados || []).length === 0, `anônimo não lê clientes (HTTP ${leClientes.status})`);
const painel = await rest('rpc/painel_operacao', { p_dias: 7 });
conferir(!painel.ok, `anônimo não chama RPC do painel (painel_operacao: HTTP ${painel.status})`);
const publico = await rest('rpc/conteudo_agendamento', {});
conferir(publico.ok, `anônimo lê o conteúdo público do agendamento (HTTP ${publico.status})`);
await c.end();

// arquivo de ambiente LOCAL pra os testes de banco (PRIME_ENV=<arquivo>); chaves locais padrão do supabase start
const saida = process.argv[2];
if (saida) {
  writeFileSync(saida, [`SUPABASE_URL='${st.API_URL}'`, `SUPABASE_PUBLISHABLE_KEY='${st.PUBLISHABLE_KEY || st.ANON_KEY}'`, `SUPABASE_SECRET_KEY='${st.SECRET_KEY || st.SERVICE_ROLE_KEY}'`,
    `SUPABASE_DB_URL_LOCAL='${st.DB_URL}'`, "SUPABASE_PROJECT_REF='local'", "AUTH_PEPPER='pepper-local-de-ensaio'", ''].join('\n'), { mode: 0o600 });
  console.log(`\nambiente local gravado em ${saida} (só chaves locais do supabase start)`);
}
console.log(`\n# ensaio do banco de produção (local): ${falhas.length ? `${falhas.length} falha(s)` : 'tudo certo'}`);
process.exit(falhas.length ? 1 : 0);
