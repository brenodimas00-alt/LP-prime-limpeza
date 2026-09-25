// Configuração do app. Trocar de mock pra http é UMA linha: ADAPTER.
import { PRIME as PRIME_REAL } from './prime.js';
import { PRIME as PRIME_TESTE } from './prime.teste.js';

// Ambiente publicado (preview/produção): src/config/ambiente.js é GERADO no deploy dentro do dist/ (scripts/monta-dist.mjs),
// com a URL do Supabase, a chave PÚBLICA e os adapters. Fora do deploy ele não existe e tudo roda em mock.
const AMBIENTE = (await import('./ambiente.js').catch(() => ({}))).AMBIENTE || {};

export const ADAPTER = AMBIENTE.dados || 'mock'; // 'mock' | 'http' | 'supabase'
export const AUTH_ADAPTER = AMBIENTE.auth || 'mock'; // 'mock' | 'supabase'
export const SUPABASE = AMBIENTE.supabaseUrl ? { url: AMBIENTE.supabaseUrl, chave: AMBIENTE.supabaseChavePublica } : null;
// Senha de quem cria conta pelo site (o banco confere a mesma regra em configuracao.auth). PENDENCIA: confirmar com a
// cliente se os novos também usam os 6 primeiros números do CPF/CNPJ, como os importados.
export const SENHA_MINIMA_SITE = 8;
// Login da cliente por código no WhatsApp: desligado (F0c). O principal é e-mail e senha.
export const LOGIN_WHATSAPP = false;
// Cartão de crédito na tela de pagamento: aparece desabilitado ("Em breve") até o B4 (Asaas).
export const PAGAMENTO_CARTAO = false;
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
