// O1: erros do site e funil, sem cookie e sem dado pessoal. Erros de JavaScript vão pra tabela de erros (o banco limpa
// e agrupa; no máximo 5 por página); o funil conta só o evento do dia. Web Analytics da Cloudflare (sem cookie) entra
// quando houver o token do painel da Cloudflare (WEB_ANALYTICS_TOKEN no ambiente; GO-LIVE). Sem Supabase, nada sai.
import { SUPABASE, WEB_ANALYTICS_TOKEN } from '../config/app.js';

let enviados = 0;
const vistos = new Set();
function rpc(nome, corpo) {
  if (!SUPABASE) return Promise.resolve();
  return fetch(`${SUPABASE.url}/rest/v1/rpc/${nome}`, {
    method: 'POST', keepalive: true,
    headers: { apikey: SUPABASE.chave, Authorization: `Bearer ${SUPABASE.chave}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  }).catch(() => {});
}

export function registrarErro(mensagem, origem = 'site') {
  const m = String(mensagem || '').slice(0, 500);
  if (!m || vistos.has(m) || enviados >= 5) return;
  vistos.add(m); enviados++;
  rpc('registrar_erro', { p_origem: origem, p_mensagem: m, p_pagina: location.pathname });
}

/** Funil: 'abriu_calculadora' | 'iniciou_solicitacao' (uma vez por aba). */
export function registrarFunil(evento) {
  try { if (sessionStorage.getItem(`prime.funil.${evento}`)) return; sessionStorage.setItem(`prime.funil.${evento}`, '1'); } catch { /* sem storage: conta mesmo assim */ }
  rpc('registrar_funil', { p_evento: evento });
}

let iniciado = false;
export function iniciarObservabilidade({ publica = false } = {}) {
  if (iniciado) return;
  iniciado = true;
  window.addEventListener('error', (e) => { if (e.message) registrarErro(`${e.message} (${String(e.filename || '').split('/').pop()}:${e.lineno || 0})`); });
  window.addEventListener('unhandledrejection', (e) => registrarErro(`promessa rejeitada: ${e.reason?.message || e.reason || ''}`));
  if (publica && WEB_ANALYTICS_TOKEN) {
    const s = document.createElement('script');
    s.defer = true; s.src = 'https://static.cloudflareinsights.com/beacon.min.js';
    s.dataset.cfBeacon = JSON.stringify({ token: WEB_ANALYTICS_TOKEN });
    document.head.appendChild(s);
  }
}
