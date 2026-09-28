// S2: confere o _redirects contra o preview (ou a URL passada): toda URL antiga que era página vira 301 direto pro
// destino final (200, sem cadeia, sem loop), com e sem barra no fim, e a query string chega ao destino.
// Rotas que continuam existindo (/, /autoagendamento/) não redirecionam pra si mesmas.
// Uso: node scripts/testa-redirects.mjs [url]
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { criarSuite, assert } from './lib-teste.mjs';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim().replace(/[/_.]/g, '-').toLowerCase();
const BASE = (process.argv[2] || `https://${branch}.prime-limpeza.pages.dev/`).replace(/\/?$/, '');
const t = criarSuite(`S2 redirecionamentos (${BASE})`);

const regras = readFileSync(`${RAIZ}_redirects`, 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#'))
  .map((l) => { const [de, para, cod] = l.trim().split(/\s+/); return { de, para, cod }; });
const antigas = readFileSync(`${RAIZ}docs/urls-antigas.txt`, 'utf8').split('\n').filter((l) => l && !l.startsWith('#'))
  .map((l) => l.split('\t')).filter((c) => c[2] === 'pagina').map((c) => c[0]);

const ir = (caminho) => fetch(`${BASE}${caminho}`, { redirect: 'manual' });

t.teste('toda página do site antigo tem destino: regra no _redirects ou a mesma rota no site novo', async () => {
  for (const a of antigas) {
    if (regras.some((r) => r.de === a)) continue;
    const r = await ir(a);
    assert.equal(r.status, 200, `${a}: sem regra e ${r.status} no site novo`);
  }
});

t.teste('regras: sempre 301, destino final 200 e nunca outra regra (sem cadeia, sem loop)', async () => {
  for (const { de, para, cod } of regras) {
    assert.equal(cod, '301', `${de}: código ${cod}`);
    assert.ok(!regras.some((r) => r.de === para), `${de} -> ${para} cai noutra regra`);
    assert.notEqual(de, para, `${de}: redireciona pra si mesma`);
    const r = await ir(de);
    assert.equal(r.status, 301, `${de}: ${r.status}`);
    assert.equal(new URL(r.headers.get('location'), BASE).pathname, para, `${de}: foi pra ${r.headers.get('location')}`);
    const d = await ir(para);
    assert.equal(d.status, 200, `${para}: ${d.status} (cadeia ou quebrado)`);
  }
});

t.teste('query string preservada (ex.: link de campanha)', async () => {
  for (const { de, para } of regras) {
    const r = await ir(`${de}?utm_source=teste&x=1`);
    assert.equal(r.status, 301);
    const u = new URL(r.headers.get('location'), BASE);
    assert.equal(u.pathname, para);
    assert.equal(u.search, '?utm_source=teste&x=1', `${de}: query ${u.search}`);
  }
});

t.teste('variantes com e sem barra no fim das URLs antigas também chegam em 301 direto', async () => {
  for (const a of antigas.filter((x) => x !== '/')) {
    for (const v of [a.replace(/\/$/, ''), `${a.replace(/\/$/, '')}/`]) {
      const r = await ir(v);
      if (r.status === 200) continue; // a mesma rota existe no site novo
      assert.equal(r.status, 301, `${v}: ${r.status}`);
      assert.equal((await ir(new URL(r.headers.get('location'), BASE).pathname)).status, 200, `${v}: destino`);
    }
  }
});

t.teste('rotas que continuam existindo não redirecionam pra si mesmas', async () => {
  for (const c of ['/', '/autoagendamento/', '/diarista/cadastro/']) assert.equal((await ir(c)).status, 200, c);
});

await t.fim();
