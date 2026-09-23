// Consulta de CEP no ViaCEP (https://viacep.com.br). Falha ou timeout devolve null: a tela cai no preenchimento manual.
const TIMEOUT_MS = 5000;

export async function buscarCEP(cep, { fetch: f = globalThis.fetch } = {}) {
  const d = String(cep || '').replace(/\D/g, '');
  if (d.length !== 8) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await f(`https://viacep.com.br/ws/${d}/json/`, { signal: ctrl.signal });
    if (!r.ok) return null;
    const j = await r.json();
    if (!j || j.erro) return { naoExiste: true };
    const txt = (v) => (typeof v === 'string' ? v.slice(0, 120) : '');
    return { logradouro: txt(j.logradouro), bairro: txt(j.bairro), cidade: txt(j.localidade), uf: txt(j.uf).toUpperCase().slice(0, 2) };
  } catch {
    return null;
  } finally { clearTimeout(timer); }
}
