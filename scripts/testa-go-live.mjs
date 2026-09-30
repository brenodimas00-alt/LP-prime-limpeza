// D1: nenhum passo do go-live roda sem GO_LIVE=sim e PROD_REF, nem com o ref de homologação. node scripts/testa-go-live.mjs
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { criarSuite, assert } from './lib-teste.mjs';

const t = criarSuite('D1 passos do go-live travados');
const passos = readdirSync(new URL('./go-live/', import.meta.url)).filter((f) => /^\d{2}-.*\.sh$/.test(f));
const rodar = (f, env) => spawnSync('bash', [`scripts/go-live/${f}`], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env }, timeout: 20000 });

t.teste(`${passos.length} passos, numerados em sequência`, () => {
  assert.ok(passos.length >= 12);
  passos.forEach((f, i) => assert.equal(f.slice(0, 2), String(i + 1).padStart(2, '0'), f));
});
t.teste('sem GO_LIVE=sim, sem PROD_REF ou com o ref de homologação: todos param sem fazer nada', () => {
  for (const f of passos) {
    for (const env of [{}, { GO_LIVE: 'sim' }, { GO_LIVE: 'sim', PROD_REF: 'dkafhwekgvwjttbsfxvu' }, { GO_LIVE: 'nao', PROD_REF: 'xyz' }]) {
      const r = rodar(f, env);
      assert.equal(r.status, 2, `${f} ${JSON.stringify(env)}: ${r.stdout}${r.stderr}`);
    }
  }
});
await t.fim();
