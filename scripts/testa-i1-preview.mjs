// I1: aceite da homologação pra cliente, no PREVIEW. Entra como cada papel de demonstração pela URL; a conta da Isa
// (prime_admin) vê a base importada no painel; o reset da demonstração não toca nenhum importado.
// Pré-requisito: scripts/demo-homolog.mjs (credenciais no ~/.prime-env). Nada é impresso além de contagens.
// Uso: LD_LIBRARY_PATH=... bash scripts/cli.sh node22 scripts/testa-i1-preview.mjs [url]
import { execFileSync, spawnSync } from 'node:child_process';
import { criarSuite, assert } from './lib-teste.mjs';
import { abrirNavegador } from './pw.mjs';
import { sql, fecharSql, limparFicticios, lerEnvDeNovo, ENV } from './lib-supabase.mjs';
import { montarApiDeTeste } from './lib-api-teste.mjs';
import { criarAvulso, liberarCobranca, chave } from './cenarios.mjs';

const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim().replace(/[/_.]/g, '-').toLowerCase();
const BASE = (process.argv[2] || `https://${branch}.prime-limpeza.pages.dev/`).replace(/\/?$/, '/');
const t = criarSuite(`I1 homologação pra cliente (${BASE})`);
for (const k of ['DEMO_SENHA_ADMIN', 'DEMO_SENHA_DIARISTA', 'DEMO_CPF_CLIENTE']) if (!ENV[k]) throw new Error(`${k} ausente: rode scripts/demo-homolog.mjs`);
const D = 'prime-homolog.example';
const b = await abrirNavegador();
async function pagina() {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  p.erros = [];
  p.on('pageerror', (e) => p.erros.push(e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && p.erros.push(m.text()));
  return p;
}
async function entrar(p, caminho, campo, ident, senha, destino) {
  await p.goto(`${BASE}${caminho}`);
  await p.fill(campo, ident); await p.fill('#senha', senha);
  await p.getByRole('button', { name: 'Entrar', exact: true }).click();
  await p.waitForURL(destino, { timeout: 30000 });
}

t.teste('URL estável da branch e noindex', async () => {
  const r = await fetch(BASE);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('x-robots-tag') || '', /noindex/);
});

t.teste('Isa (prime_admin) entra no painel e vê a base importada na aba Clientes', async () => {
  const p = await pagina();
  await entrar(p, 'painel/entrar/', '#email', `isa.admin@${D}`, ENV.DEMO_SENHA_ADMIN, /painel\/(\?|$)/);
  await p.goto(`${BASE}painel/?aba=clientes`);
  await p.waitForSelector('[data-tabela=clientes]');
  const [{ n }] = await sql(`select count(*)::int n from public.clientes where origem = 'importado' and not ficticio`);
  assert.ok(n > 3000, 'base importada no homolog');
  const total = Number((await p.locator('text=/\\d+ clientes · página/').textContent()).match(/(\d+) clientes/)[1]);
  assert.ok(total >= n, `painel mostra ${total}, importados ${n}`);
  await p.goto(`${BASE}painel/?aba=precos`);
  await p.waitForSelector('[data-precos]');
  assert.equal(await p.getByRole('button', { name: 'Salvar nova tabela' }).count(), 1, 'admin edita preços');
  assert.deepEqual(p.erros, []);
});

t.teste('diarista de demonstração (aprovada) entra e vê a agenda com diária designada', async () => {
  const p = await pagina();
  await entrar(p, 'diarista/entrar/', '#email', `diarista.demo@${D}`, ENV.DEMO_SENHA_DIARISTA, /diarista\/agenda\//);
  await p.waitForSelector('[data-atendimento]', { timeout: 30000 });
  assert.deepEqual(p.erros, []);
});

t.teste('cliente de demonstração entra pelo e-mail (6 dígitos) e pelo CPF (nascimento) e vê os pedidos', async () => {
  const p = await pagina();
  await entrar(p, 'entrar/', '#identificador', `cliente.demo@${D}`, ENV.DEMO_CPF_CLIENTE.slice(0, 6), /minha-conta\//);
  await p.waitForFunction(() => document.querySelectorAll('[data-pedido]').length >= 4, null, { timeout: 30000 });
  const q = await pagina();
  await entrar(q, 'entrar/', '#identificador', ENV.DEMO_CPF_CLIENTE, '15031987', /minha-conta\//);
  assert.deepEqual(p.erros, []);
});

const demo = (args = []) => spawnSync('bash', ['scripts/cli.sh', 'node22', 'scripts/demo-homolog.mjs', '--sem-senhas', ...args], { encoding: 'utf8', timeout: 600000 });

t.teste('reset NÃO mexe em pedido que não é da demonstração: com a diarista demo num pedido alheio, ele para', async () => {
  const { api } = await montarApiDeTeste('i1');
  try {
    const r = await criarAvulso(api, chave('i1'));
    await liberarCobranca(api, r);
    const [d] = await sql(`select d.id from public.diaristas d join auth.users u on u.id = d.usuario_id where u.email = $1`, [`diarista.demo@${D}`]);
    await api.atribuirDiarista(r.atendimentos[0].id, { diaristaId: d.id }, { sessao: { ator: 'prime' }, chave: chave('atr') });
    const x = demo(['--reset']);
    assert.notEqual(x.status, 0);
    assert.match(x.stderr + x.stdout, /reset abortado: a diarista de demonstração está em 1 diária/);
    const [a] = await sql('select diarista_id from public.atendimentos where id = $1', [r.atendimentos[0].id]);
    assert.equal(a.diarista_id, d.id, 'atribuição alheia intacta');
  } finally { await limparFicticios({ soEstaExecucao: true }); }
});

t.teste('telefone da cliente demo que passou a ser de outra cliente é trocado (login por celular dela não quebra)', async () => {
  const antigo = ENV.DEMO_TEL_CLIENTE;
  const [c] = await sql(`insert into public.clientes (tipo, nome, telefone, origem, ficticio) values ('residencial', 'I1 Colisão Telefone', $1, 'site', true) returning id`, [antigo]);
  try {
    assert.equal(demo().status, 0);
    const novo = lerEnvDeNovo().DEMO_TEL_CLIENTE;
    assert.notEqual(novo, antigo);
    const [x] = await sql(`select c.telefone from public.clientes c join auth.users u on u.id = c.usuario_id where u.email = $1`, [`cliente.demo@${D}`]);
    assert.equal(x.telefone, novo);
  } finally { await sql('delete from public.clientes where id = $1', [c.id]); }
});

t.teste('reset da demonstração recria tudo e não toca nenhum cliente importado', async () => {
  const antes = await sql(`select count(*)::int n, md5(string_agg(id::text || coalesce(email, '') || coalesce(usuario_id::text, ''), ',' order by id)) h from public.clientes where origem = 'importado'`);
  const r = demo(['--reset']);
  assert.equal(r.status, 0, (r.stderr || '').split('\n').slice(-3).join(' '));
  assert.match(r.stdout, /reset: 3 contas/);
  const depois = await sql(`select count(*)::int n, md5(string_agg(id::text || coalesce(email, '') || coalesce(usuario_id::text, ''), ',' order by id)) h from public.clientes where origem = 'importado'`);
  assert.deepEqual(depois, antes);
});

try {
  await t.fim();
} finally {
  await b.close();
  await fecharSql();
}
