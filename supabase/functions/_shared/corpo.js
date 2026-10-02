// Corpo de requisição com limite (auditoria 30/09): lê em partes e desiste ao passar do máximo, sem nunca carregar um
// corpo enorme na memória (req.text()/req.json() liam tudo antes de conferir o tamanho). JS puro: Deno e Node (testes).

/** Devolve o texto do corpo, ou null se passar de `max` bytes (declarado no Content-Length ou contado na leitura). */
export async function lerTextoAte(req, max) {
  if (Number(req.headers.get('content-length') || 0) > max) { await req.body?.cancel().catch(() => {}); return null; }
  if (!req.body) return '';
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
  return new TextDecoder().decode(cru);
}
