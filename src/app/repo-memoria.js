// Repositório em memória com transação tudo-ou-nada. Usado nos testes Node e dentro do scripts/fake-api.mjs.
import { STORES, NOMES_STORES } from './stores.js';

const clonar = (v) => (v === undefined ? undefined : structuredClone(v));

export function criarRepoMemoria() {
  const dados = Object.fromEntries(NOMES_STORES.map((n) => [n, new Map()]));
  let fila = Promise.resolve(); // serializa transações (como o IndexedDB faz com readwrite no mesmo escopo)

  function tx(copia) {
    const loja = (s) => { if (!copia[s]) throw new Error(`store desconhecido: ${s}`); return copia[s]; };
    return {
      get: async (s, id) => clonar(loja(s).get(id)),
      put: async (s, obj) => { const k = obj[STORES[s].chave]; if (!k) throw new Error(`sem chave em ${s}`); loja(s).set(k, clonar(obj)); return obj; },
      del: async (s, id) => { loja(s).delete(id); },
      todos: async (s) => [...loja(s).values()].map(clonar),
      por: async (s, indice, valor) => [...loja(s).values()].filter((o) => o[indice] === valor).map(clonar),
    };
  }

  return {
    tipo: 'memoria',
    /** Executa fn(tx). Se fn lançar, nada é gravado. */
    transacao(_stores, fn) {
      const exec = fila.then(async () => {
        const copia = Object.fromEntries(NOMES_STORES.map((n) => [n, new Map(dados[n])]));
        const r = await fn(tx(copia));
        for (const n of NOMES_STORES) dados[n] = copia[n];
        return clonar(r);
      });
      fila = exec.catch(() => {});
      return exec;
    },
    leitura(stores, fn) { return this.transacao(stores, fn); },
    /** Só pra teste: quantidade de registros por store. */
    contar: (s) => dados[s].size,
    limpar: () => { for (const n of NOMES_STORES) dados[n].clear(); },
  };
}
