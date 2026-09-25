// Repositório IndexedDB (navegador). Uma transação readwrite por caso de uso: mudança de negócio + idempotência +
// evento pendente entram juntos. Regra: dentro de fn só se aguarda operações do próprio tx (nada de fetch/timer),
// senão o IndexedDB fecha a transação no meio.
import { STORES, NOMES_STORES } from './stores.js';

const NOME_DB = 'prime-mock';
const VERSAO = 2; // 2: store credenciais

function req(r) {
  return new Promise((ok, erro) => { r.onsuccess = () => ok(r.result); r.onerror = () => erro(r.error); });
}

export function abrirBanco(nome = NOME_DB) {
  return new Promise((ok, erro) => {
    const r = indexedDB.open(nome, VERSAO);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const n of NOMES_STORES) {
        if (db.objectStoreNames.contains(n)) continue;
        const st = db.createObjectStore(n, { keyPath: STORES[n].chave });
        for (const i of STORES[n].indices) st.createIndex(i, i, { unique: false });
      }
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => erro(r.error);
    r.onblocked = () => erro(new Error('Banco local bloqueado por outra aba'));
  });
}

export async function criarRepoIndexedDB(nome = NOME_DB) {
  const db = await abrirBanco(nome);

  function executar(stores, modo, fn) {
    return new Promise((ok, erro) => {
      let t;
      try { t = db.transaction(stores || NOMES_STORES, modo); } catch (e) { erro(e); return; }
      let resultado;
      let falha;
      t.oncomplete = () => (falha ? erro(falha) : ok(resultado));
      t.onabort = () => erro(falha || t.error || new Error('Transação abortada'));
      t.onerror = () => {}; // tratado no onabort
      const tx = {
        get: (s, id) => req(t.objectStore(s).get(id)),
        put: (s, obj) => req(t.objectStore(s).put(obj)).then(() => obj),
        del: (s, id) => req(t.objectStore(s).delete(id)),
        todos: (s) => req(t.objectStore(s).getAll()),
        por: (s, indice, valor) => req(t.objectStore(s).index(indice).getAll(valor)),
      };
      Promise.resolve()
        .then(() => fn(tx))
        .then((r) => { resultado = r; })
        .catch((e) => { falha = e; try { t.abort(); } catch { /* já finalizada */ } });
    });
  }

  return {
    tipo: 'indexeddb',
    transacao: (stores, fn) => executar(stores, 'readwrite', fn),
    leitura: (stores, fn) => executar(stores, 'readonly', fn),
    fechar: () => db.close(),
  };
}
