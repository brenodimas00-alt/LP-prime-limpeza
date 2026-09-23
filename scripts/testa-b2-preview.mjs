// B2: aceite no PREVIEW (Cloudflare Pages + Supabase de homologação), com usuários fictícios.
// Entrada, erro claro, bloqueio por tentativas, sair, trocar senha, recuperação (link gerado sem enviar e-mail),
// guarda de rota por papel e acesso bloqueado pela Prime. Uso: LD_LIBRARY_PATH=... bash scripts/cli.sh node22 scripts/testa-b2-preview.mjs [url]
import { execFileSync } from 'node:child_process';
import { criarSuite, assert } from './lib-teste.mjs';
import { abrirNavegador } from './pw.mjs';
import { admin, criarUsuario, sql, fecharSql, limparFicticios, cpfFicticio } from './lib-supabase.mjs';

const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim().replace(/[/_.]/g, '-').toLowerCase();
const BASE = (process.argv[2] || `https://${branch}.prime-limpeza.pages.dev/`).replace(/\/?$/, '/');
const t = criarSuite(`B2 preview (${BASE})`);
await limparFicticios();
const b = await abrirNavegador();

async function novaPagina() {
  const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  p.erros = [];
  p.on('pageerror', (e) => p.erros.push(e.message));
  p.on('console', (m) => m.type() === 'error' && !/status of (400|401|403|429)/.test(m.text()) && p.erros.push(m.text()));
  return p;
}
async function cliente(rotulo) {
  const u = await criarUsuario(rotulo);
  await sql(`insert into public.clientes (usuario_id, tipo, nome, email, tipo_documento, documento, origem, ficticio)
    values ($1, 'residencial', 'Clara Teste Preview', $2, 'cpf', $3, 'site', true)`, [u.id, u.email, cpfFicticio()]);
  return u;
}
async function entrarPelaTela(p, caminho, { email, senha }) {
  await p.goto(`${BASE}${caminho}`);
  await p.fill('#email', email); await p.fill('#senha', senha);
  await p.getByRole('button', { name: 'Entrar', exact: true }).click();
}
const alerta = (p) => p.locator('.alerta-erro:visible').first();

t.teste('entrar/: ajuda pros clientes da base e erro claro com senha errada', async () => {
  const u = await cliente('tela-erro');
  const p = await novaPagina();
  await entrarPelaTela(p, 'entrar/', { email: u.email, senha: 'errada-123' });
  await alerta(p).waitFor();
  assert.match(await alerta(p).textContent(), /E-mail ou senha incorretos/);
  assert.match(await p.locator('#ajuda-importado').textContent(), /6 primeiros números do seu CPF/);
  assert.deepEqual(p.erros, []);
});

t.teste('5 senhas erradas: a 6ª tentativa (mesmo certa) mostra o bloqueio com o tempo de espera', async () => {
  const u = await cliente('tela-bloq');
  const p = await novaPagina();
  for (let i = 0; i < 5; i++) {
    await entrarPelaTela(p, 'entrar/', { email: u.email, senha: `errada-${i}` });
    await alerta(p).waitFor();
  }
  await entrarPelaTela(p, 'entrar/', u);
  await p.waitForFunction(() => /Muitas tentativas/.test(document.querySelector('.alerta-erro')?.textContent || ''));
  assert.match(await alerta(p).textContent(), /espere 5 minutos/);
});

t.teste('cliente entra, vê Minha conta, troca a senha (erro embaixo do campo), sai e só entra com a nova', async () => {
  const u = await cliente('tela-ok');
  const p = await novaPagina();
  await entrarPelaTela(p, 'entrar/', u);
  await p.waitForURL(/minha-conta\//);
  await p.waitForSelector('h1');
  assert.match(await p.locator('h1').textContent(), /Clara/);
  await p.locator('#trocar-senha summary').click();
  await p.fill('#atual', 'nao-e-essa'); await p.fill('#nova', 'Trocada-2026'); await p.fill('#nova2', 'Trocada-2026');
  await p.getByRole('button', { name: 'Trocar senha' }).click();
  await p.waitForFunction(() => /não confere/.test(document.querySelector('#atual-erro')?.textContent || ''));
  assert.equal(await p.locator('#atual').getAttribute('aria-invalid'), 'true');
  assert.equal(await p.evaluate(() => document.activeElement?.id), 'atual', 'foco no campo com erro');
  await p.fill('#atual', u.senha);
  await p.getByRole('button', { name: 'Trocar senha' }).click();
  await p.waitForSelector('text=Senha trocada');
  await p.getByRole('button', { name: 'Sair' }).click();
  await p.waitForURL((x) => !/minha-conta/.test(x.pathname));
  await entrarPelaTela(p, 'entrar/', u);
  await alerta(p).waitFor();
  await entrarPelaTela(p, 'entrar/', { email: u.email, senha: 'Trocada-2026' });
  await p.waitForURL(/minha-conta\//);
});

t.teste('guarda de rota por papel: cliente não abre o painel; Prime entra no painel; conta da Prime não entra pela área da cliente', async () => {
  const u = await cliente('tela-guarda');
  const p = await novaPagina();
  await entrarPelaTela(p, 'entrar/', u);
  await p.waitForURL(/minha-conta\//);
  await p.goto(`${BASE}painel/`);
  await p.waitForURL(/painel\/entrar\//);
  const prime = await criarUsuario('tela-prime', 'prime_atendimento');
  const q = await novaPagina();
  await entrarPelaTela(q, 'entrar/', prime);
  await alerta(q).waitFor();
  assert.match(await alerta(q).textContent(), /não é desta área/);
  await entrarPelaTela(q, 'painel/entrar/', prime);
  await q.waitForURL(/\/painel\/(\?|$)/);
  await q.goto(`${BASE}minha-conta/`);
  await q.waitForURL(/\/entrar\//);
});

t.teste('recuperação: o link (gerado sem enviar e-mail) abre "Crie uma senha nova" e a senha nova passa a valer', async () => {
  const u = await cliente('tela-recupera');
  const { data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email: u.email, options: { redirectTo: `${BASE}entrar/?modo=nova-senha` } });
  assert.ok(!error, error?.message);
  const p = await novaPagina();
  await p.goto(data.properties.action_link);
  await p.waitForSelector('#nova');
  assert.match(await p.locator('h1').textContent(), /senha nova/);
  await p.fill('#nova', 'Recuperada-2026'); await p.fill('#nova2', 'Recuperada-2026');
  await p.getByRole('button', { name: 'Salvar senha' }).click();
  await p.waitForSelector('text=Senha salva');
  await entrarPelaTela(p, 'entrar/', { email: u.email, senha: 'Recuperada-2026' });
  await p.waitForURL(/minha-conta\//);
});

t.teste('acesso bloqueado pela Prime: quem já estava dentro é mandado pra entrada e não entra de novo', async () => {
  const u = await cliente('tela-bloqueada');
  const p = await novaPagina();
  await entrarPelaTela(p, 'entrar/', u);
  await p.waitForURL(/minha-conta\//);
  await sql('update public.perfis set bloqueado = true where user_id = $1', [u.id]);
  await p.reload();
  await p.waitForURL(/\/entrar\//);
  await entrarPelaTela(p, 'entrar/', u);
  await alerta(p).waitFor();
  assert.match(await alerta(p).textContent(), /bloqueado/);
});

const falhas = await t.fim();
console.log(`# limpeza: ${await limparFicticios({ soEstaExecucao: true })} usuários fictícios removidos`);
await b.close(); await fecharSql();
process.exit(falhas ? 1 : 0);
