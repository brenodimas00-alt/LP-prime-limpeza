// Sessão de DEMONSTRAÇÃO do mock (localStorage). Não é autenticação: no backend real a sessão vem do login
// (link mágico/código pra cliente, login pra diarista, papéis pra Prime). Ver docs/BACKEND.md.
import { modoDev } from '../config/app.js';

const CHAVE = 'prime.sessao';

function ler() {
  try { return JSON.parse(localStorage.getItem(CHAVE) || 'null'); } catch { return null; }
}

/** Sessão atual. Em ?dev=1 (só mock) a demonstração age como a Prime. */
export function sessaoAtual() {
  if (modoDev()) return { ator: 'prime' };
  return ler() || { ator: 'publico' };
}

export function sessaoGuardada() { return ler(); }

export function definirSessao(s) {
  try { localStorage.setItem(CHAVE, JSON.stringify(s)); } catch { /* storage bloqueado: segue sem sessão */ }
}
