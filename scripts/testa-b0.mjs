// B0 sem rede: chave pública x secreta, hashes da CSP e varredura de segredo.
import { createHash } from 'node:crypto';
import { criarSuite, assert } from './lib-teste.mjs';
import { chavePublica } from './gera-ambiente.mjs';
import { hashesInline, montarHeaders, PERMITIDO, EXTENSOES } from './monta-dist.mjs';
import { varrerTexto, acharDadosReais } from './varre-segredos.mjs';

const t = criarSuite('B0 (ambiente, dist, varredura)');
// Montados por concatenação pra a própria varredura do repo não acusar este arquivo.
const SR = ['service', 'role'].join('_'); const SECRETA = ['sb', 'secret', 'abcdefghij'].join('_');
const jwt = (role) => ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify({ role, iss: 'supabase' })).toString('base64url'), 'assinaturaFicticia123'].join('.');
const sha = (s) => `'sha256-${createHash('sha256').update(s).digest('base64')}'`;

t.teste('só chave pública vai pro front', () => {
  assert.equal(chavePublica('sb_publishable_AbC123_x'), true);
  assert.equal(chavePublica(jwt('anon')), true);
  assert.equal(chavePublica(`${SECRETA}AbC`), false);
  assert.equal(chavePublica(jwt(SR)), false);
  assert.equal(chavePublica('qualquer-coisa'), false);
});

t.teste('CSP: hash do script inline e do onclick (com entidade HTML), sem JSON-LD; único script externo é o Turnstile (P7)', () => {
  const html = '<script src="a.js"></script><script>var a=1;</script><script type="application/ld+json">{}</script><button onclick="x(&quot;y&quot;)">b</button>';
  const h = hashesInline(html);
  assert.deepEqual(h.scripts, [sha('var a=1;')]);
  assert.deepEqual(h.handlers, [sha('x("y")')]);
  const cab = montarHeaders({ ref: 'abcdefghijklmnopqrst', ...h });
  assert.match(cab, new RegExp(`script-src 'self' ${h.scripts[0].replace(/[+/]/g, '\\$&')} 'unsafe-hashes'`));
  assert.doesNotMatch(cab, /script-src[^\n;]*'unsafe-inline'/);
  assert.match(cab, /connect-src 'self' https:\/\/viacep\.com\.br https:\/\/abcdefghijklmnopqrst\.supabase\.co wss:/);
  assert.match(cab, /script-src [^;]* https:\/\/challenges\.cloudflare\.com;/);
  assert.match(cab, /frame-src https:\/\/challenges\.cloudflare\.com;/);
  assert.equal((cab.match(/https:\/\/[a-z.]+/g) || []).filter((u) => !/viacep|supabase|challenges\.cloudflare|pages\.dev/.test(u)).length, 0, 'nenhuma outra origem');
  assert.match(cab, /https:\/\/:version\.:project\.pages\.dev\/\*\n {2}X-Robots-Tag: noindex/);
  assert.match(cab, /\/painel\/\*\n {2}X-Robots-Tag: noindex/);
  // auditoria 30/09
  assert.match(cab, /\n {2}Strict-Transport-Security: max-age=31536000\n/);
  assert.match(cab, /\n {2}Cross-Origin-Opener-Policy: same-origin\n/);
});

t.teste('varredura acha segredo e não acusa o que é público', () => {
  const achou = (txt, arquivo = 'src/x.js', sensiveis = []) => varrerTexto(txt, { arquivo, sensiveis }).map((a) => a.tipo);
  assert.deepEqual(achou(`k="${SECRETA}"`), ['chave secreta do Supabase']);
  assert.deepEqual(achou(`k="${jwt(SR)}"`), ['JWT não-anon']);
  assert.deepEqual(achou(`k="${jwt('anon')}"`), []);
  assert.deepEqual(achou(`papel ${SR}`), [`menção a ${SR}`]);
  assert.deepEqual(achou(`grant usage to ${SR};`, 'supabase/migrations/1_x.sql'), []);
  assert.deepEqual(achou('senha: Xy12abcdEF', 'docs/a.md', [['SUPABASE_DB_PASSWORD', 'Xy12abcdEF']]), ['valor de SUPABASE_DB_PASSWORD do ~/.prime-env']);
  assert.deepEqual(achou("'sha256-9fdrugRXyWY2SFedfF2/0S5ojBPfb0LA+pd7pcE3T2Q='"), []);
  assert.deepEqual(achou('a'.repeat(10) + 'Q9x' + 'Zk3PqLm8'.repeat(9)), ['base64 longo']);
});

t.teste('dist por lista permitida: só páginas, assets e src', () => {
  const vai = (f) => PERMITIDO.test(f) && EXTENSOES.test(f);
  for (const f of ['index.html', '404.html', 'painel/index.html', 'src/ui/dom.js', 'assets/video/hero-bg.mp4', 'diarista/cadastro/index.html']) assert.ok(vai(f), f);
  for (const f of ['backup.sql', 'credenciais.txt', 'docs/DECISOES.md', 'scripts/testa-app.mjs', 'supabase/config.toml', '_dev/servicos.html', 'package.json', 'src/config/segredo.env', 'painel/notas.txt']) assert.ok(!vai(f), f);
});

t.teste('dado pessoal da base real: acha CPF com ou sem máscara, telefone e e-mail; ignora o que não é da base', () => {
  const reais = new Set(['01234567890', 'fulana@exemplo.com.br', '31999998888']);
  assert.equal(acharDadosReais('cpf: 012.345.678-90', reais).length, 1);
  assert.equal(acharDadosReais('x = "01234567890"', reais).length, 1);
  assert.equal(acharDadosReais('contato Fulana@Exemplo.com.br', reais).length, 1);
  assert.equal(acharDadosReais('tel (31) 99999-8888', reais).length, 1);
  assert.equal(acharDadosReais('cpf 529.982.247-25 e ana@exemplo.com', reais).length, 0);
  assert.deepEqual(acharDadosReais('qualquer', null), []);
});

t.teste('dependências com versão exata (auditoria 30/09): package.json, Edge Functions e CLIs sem faixa', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const faixas = Object.entries({ ...pkg.dependencies, ...pkg.devDependencies }).filter(([, v]) => !/^\d+\.\d+\.\d+$/.test(v));
  assert.deepEqual(faixas, []);
  const dir = new URL('../supabase/functions/', import.meta.url);
  for (const f of readdirSync(dir, { recursive: true }).filter((x) => /\.(ts|js)$/.test(x))) {
    for (const m of readFileSync(new URL(f, dir), 'utf8').matchAll(/['"]npm:([^'"]+)['"]/g)) assert.match(m[1], /@\d+\.\d+\.\d+$/, `${f}: ${m[1]}`);
  }
  assert.match(readFileSync(new URL('./cli.sh', import.meta.url), 'utf8'), /SUPABASE_VERSAO=\d+\.\d+\.\d+\nWRANGLER_VERSAO=\d+\.\d+\.\d+/);
});

const falhas = await t.fim();
process.exit(falhas ? 1 : 0);
