// Cliente Supabase do navegador (supabase-js vendorizado em /vendor, versão pinada). Só a chave PÚBLICA.
// O build UMD declara `supabase` no escopo global, então entra por <script> clássico (CSP 'self'), não por import().
import { RAIZ, SUPABASE } from '../config/app.js';

const VERSAO = '2.117.1';
let pronto;

function carregarScript(src) {
  return new Promise((ok, falha) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = () => ok(); s.onerror = () => falha(Object.assign(new Error('Não conseguimos carregar o acesso. Recarregue a página.'), { codigo: 'SERVICO_INDISPONIVEL' }));
    document.head.appendChild(s);
  });
}

/** Cliente único da página. Sessão persistida pelo supabase-js; link de recuperação lido da URL (fluxo implícito). */
export function supabase() {
  if (!SUPABASE) throw Object.assign(new Error('Ambiente sem Supabase configurado.'), { codigo: 'CONFIG_INCOMPLETA' });
  if (!pronto) {
    pronto = (async () => {
      if (!globalThis.supabase?.createClient) await carregarScript(new URL(`vendor/supabase-js@${VERSAO}/supabase.js`, RAIZ).href);
      return globalThis.supabase.createClient(SUPABASE.url, SUPABASE.chave, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
      });
    })();
    pronto.catch(() => { pronto = undefined; });
  }
  return pronto;
}

/** Chama a Edge Function "conta" e devolve o corpo; erro vira { codigo, message } como no resto do app. */
export async function chamarConta(acao, dados = {}, token) {
  let resp;
  try {
    resp = await fetch(`${SUPABASE.url}/functions/v1/conta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE.chave, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ acao, ...dados }),
    });
  } catch {
    throw Object.assign(new Error('Não conseguimos falar com o servidor. Tente de novo.'), { codigo: 'SERVICO_INDISPONIVEL' });
  }
  const corpo = await resp.json().catch(() => null);
  if (!resp.ok) {
    const e = corpo?.erro || {};
    throw Object.assign(new Error(e.mensagem || 'Não foi possível concluir. Tente de novo.'), { codigo: e.codigo || 'ERRO_INTERNO', detalhes: e.detalhes });
  }
  return corpo;
}
