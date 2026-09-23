// Mini harness de teste (sem dependência). Uso: const t = criarSuite('nome'); t.teste('x', () => {...}); await t.fim();
import assert from 'node:assert/strict';
export { assert };

export function criarSuite(nome) {
  const casos = [];
  return {
    teste: (descricao, fn) => casos.push({ descricao, fn }),
    async fim() {
      let falhas = 0;
      console.log(`\n# ${nome}`);
      for (const c of casos) {
        try { await c.fn(); console.log(`  ok   ${c.descricao}`); }
        catch (e) { falhas++; console.log(`  FALHOU ${c.descricao}\n       ${e.stack?.split('\n').slice(0, 3).join('\n       ')}`); }
      }
      console.log(`# ${nome}: ${casos.length - falhas}/${casos.length} passaram`);
      if (falhas) process.exitCode = 1;
      return falhas;
    },
  };
}

/** Espera que fn lance ErroNegocio com o código. */
export async function lancaCodigo(fn, codigo) {
  try { await fn(); } catch (e) {
    assert.equal(e.codigo, codigo, `esperava ${codigo}, veio ${e.codigo}: ${e.message}`);
    return e;
  }
  assert.fail(`esperava erro ${codigo}, não lançou`);
}
