// AUT.5: webhook do WhatsApp oficial (Meta Cloud API). JS puro (Deno na function, Node nos testes); o banco e as
// chaves são injetados. GET = verificação (hub.challenge); POST = assinatura X-Hub-Signature-256 (HMAC-SHA256 do corpo
// CRU com o App Secret, comparação em tempo constante), depois status (sent/delivered/read/failed) e mensagens
// recebidas. Tudo idempotente no banco (webhook_status / webhook_mensagem): a Meta reenvia o mesmo evento.

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function assinatura(appSecret, corpoCru) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return `sha256=${hex(await crypto.subtle.sign('HMAC', k, typeof corpoCru === 'string' ? new TextEncoder().encode(corpoCru) : corpoCru))}`;
}

function iguais(a, b) {
  const x = new TextEncoder().encode(String(a)); const y = new TextEncoder().encode(String(b));
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}

/**
 * @param {{verifyToken:string, appSecret:string, status:(id,status,emISO,erro)=>Promise<string>, mensagem:(id,telefone,texto,tipo,emISO)=>Promise<string>}} dep
 * @returns {(req:Request)=>Promise<Response>}
 */
const LIMITE_CORPO = 512 * 1024;

export function criarWebhook({ verifyToken, appSecret, status, mensagem }) {
  // lê o corpo em partes e desiste ao passar do limite (sem assinatura ainda: não pode carregar um corpo enorme na memória)
  async function lerAte(req, max) {
    if (Number(req.headers.get('content-length') || 0) > max) return null;
    if (!req.body) return new Uint8Array();
    const leitor = req.body.getReader(); const partes = []; let total = 0;
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) break;
      total += value.length;
      if (total > max) { await leitor.cancel().catch(() => {}); return null; }
      partes.push(value);
    }
    const cru = new Uint8Array(total); let i = 0;
    for (const p of partes) { cru.set(p, i); i += p.length; }
    return cru;
  }
  const r = (codigo, corpo = '', tipo = 'text/plain') => new Response(corpo, { status: codigo, headers: { 'Content-Type': tipo } });
  return async function tratar(req) {
    if (!verifyToken || !appSecret) return r(503, 'webhook não configurado');
    const url = new URL(req.url);
    if (req.method === 'GET') {
      const ok = url.searchParams.get('hub.mode') === 'subscribe' && iguais(url.searchParams.get('hub.verify_token') || '', verifyToken);
      return ok ? r(200, url.searchParams.get('hub.challenge') || '') : r(403, 'token inválido');
    }
    if (req.method !== 'POST') return r(405);
    const cru = await lerAte(req, LIMITE_CORPO);
    if (!cru) return r(413);
    const recebida = req.headers.get('x-hub-signature-256') || '';
    if (!iguais(recebida, await assinatura(appSecret, cru))) return r(401, 'assinatura inválida');
    let corpo;
    try { corpo = JSON.parse(new TextDecoder().decode(cru)); } catch { return r(400, 'json inválido'); }
    const resultado = { status: [], mensagens: [] };
    for (const entrada of corpo?.entry || []) {
      for (const mudanca of entrada?.changes || []) {
        const v = mudanca?.value || {};
        for (const s of v.statuses || []) {
          if (!s?.id || !['sent', 'delivered', 'read', 'failed'].includes(s.status)) continue;
          const em = new Date(Number(s.timestamp) * 1000 || Date.now()).toISOString();
          const erro = s.errors?.[0] ? { codigo: String(s.errors[0].code ?? ''), title: String(s.errors[0].title ?? '').slice(0, 200) } : null;
          resultado.status.push(await status(String(s.id), s.status, em, erro));
        }
        for (const m of v.messages || []) {
          if (!m?.id || !m.from) continue;
          const em = new Date(Number(m.timestamp) * 1000 || Date.now()).toISOString();
          const texto = m.type === 'text' ? m.text?.body : m.type === 'button' ? m.button?.text : m.type === 'interactive' ? (m.interactive?.button_reply?.title || m.interactive?.list_reply?.title) : null;
          resultado.mensagens.push(await mensagem(String(m.id), String(m.from), texto ?? null, String(m.type || 'desconhecido'), em));
        }
      }
    }
    return r(200, JSON.stringify(resultado), 'application/json');
  };
}

/** Janela de 24h: mensagem livre (fora de template) só se a pessoa escreveu nas últimas 24h. Todo envio automático é template. */
export function dentroDaJanela(ultimaEntradaISO, agoraISO) {
  return !!ultimaEntradaISO && Date.parse(agoraISO) - Date.parse(ultimaEntradaISO) < 24 * 3600 * 1000;
}
