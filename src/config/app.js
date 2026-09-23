// Configuração do app. Trocar de mock pra http é UMA linha: ADAPTER.
import { PRIME as PRIME_REAL } from './prime.js';
import { PRIME as PRIME_TESTE } from './prime.teste.js';

export const ADAPTER = 'mock'; // 'mock' | 'http'
export const API_BASE_URL = 'http://localhost:8787/api'; // usado só com ADAPTER = 'http'

// Base path publicado no GitHub Pages. A raiz real é derivada deste arquivo (src/config/app.js),
// então funciona em /LP-prime-limpeza/, na raiz "/" ou em qualquer subpasta.
export const BASE_PATH_PAGES = '/LP-prime-limpeza/';
export const RAIZ = new URL('../../', import.meta.url);

/** Monta URL interna a partir da raiz do site. url('pagamento/', { pagamento: 'abc' }) */
export function url(caminho = '', params = {}) {
  const u = new URL(caminho.replace(/^\/+/, ''), RAIZ);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v);
  if (modoDev() && !u.searchParams.has('dev')) u.searchParams.set('dev', '1');
  return u.pathname + u.search + u.hash;
}

/** ?dev=1 liga ferramentas de demonstração. NÃO é autorização: só existe no modo mock. */
export function modoDev() {
  try { return ADAPTER === 'mock' && new URLSearchParams(globalThis.location?.search || '').get('dev') === '1'; } catch { return false; }
}

/** Config da Prime em uso: a fictícia de teste em ?dev=1, senão a real (prime.js). */
export function configPrime() {
  return modoDev() ? PRIME_TESTE : PRIME_REAL;
}
