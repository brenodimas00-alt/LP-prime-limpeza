// Ação com idempotência na UI: a chave é criada UMA vez por tentativa e reaproveitada em clique repetido,
// recarregar (se persistida) e nova tentativa após falha. Só é descartada no sucesso ou em CONFLITO_IDEMPOTENCIA.
import { novaChave } from '../services/api.js';
import { definirSessao } from '../services/sessao.js';
import { url } from '../config/app.js';
import { toast } from './toast.js';

const LS = 'prime.acoes.';

function lerChave(id) { try { return localStorage.getItem(LS + id); } catch { return null; } }
function gravarChave(id, k) { try { if (k) localStorage.setItem(LS + id, k); else localStorage.removeItem(LS + id); } catch { /* sem storage */ } }

/**
 * Liga um botão a uma ação idempotente.
 * @param {HTMLButtonElement} botao
 * @param {(chave:string)=>Promise<any>} fn
 * @param {{id?:string, sucesso?:string, aoSucesso?:(r:any)=>void, aoErro?:(e:any)=>void}} op  id = persiste a chave (sobrevive a recarregar)
 */
export function ligarAcao(botao, fn, op = {}) {
  botao.addEventListener('click', () => executarAcao(botao, fn, op));
}

export async function executarAcao(botao, fn, op = {}) {
  if (botao?.getAttribute('aria-busy') === 'true') return undefined; // duplo clique
  let chave = (op.id && lerChave(op.id)) || botao?.dataset.chave;
  if (!chave) { chave = novaChave(); if (op.id) gravarChave(op.id, chave); }
  if (botao) { botao.dataset.chave = chave; botao.setAttribute('aria-busy', 'true'); botao.disabled = true; }
  try {
    const r = await fn(chave);
    if (op.id) gravarChave(op.id, null);
    if (botao) delete botao.dataset.chave;
    if (op.sucesso) toast(op.sucesso, 'ok');
    op.aoSucesso?.(r);
    return r;
  } catch (e) {
    if (e?.codigo === 'SESSAO_EXPIRADA') { sessaoExpirada(); return undefined; }
    if (e?.codigo === 'CONFLITO_IDEMPOTENCIA') { if (op.id) gravarChave(op.id, null); if (botao) delete botao.dataset.chave; }
    if (op.aoErro) op.aoErro(e); else toast(mensagemErro(e), 'erro', 6000);
    return undefined;
  } finally {
    if (botao) { botao.removeAttribute('aria-busy'); botao.disabled = false; }
  }
}

export function mensagemErro(e) {
  if (!e) return 'Não foi possível concluir. Tente de novo.';
  if (e.codigo === 'SERVICO_INDISPONIVEL') return 'Não conseguimos falar com o servidor. Tente de novo.';
  if (e.codigo === 'CONFLITO_IDEMPOTENCIA') return 'Esses dados mudaram desde a última tentativa. Revise e confirme de novo.';
  if (e.codigo) return e.message;
  console.error(e);
  return 'Não foi possível concluir. Tente de novo em instantes.';
}

/** Sessão vencida (token renovado sem sucesso ou acesso bloqueado): avisa e leva pra entrada da área. */
export function sessaoExpirada() {
  const p = location.pathname;
  const destino = /\/painel\//.test(p) ? 'painel/entrar/' : /\/diarista\//.test(p) ? 'diarista/entrar/' : 'entrar/';
  definirSessao(null);
  toast('Sua sessão terminou. Entre de novo pra continuar.', 'erro', 6000);
  setTimeout(() => location.assign(url(destino)), 1500);
}
