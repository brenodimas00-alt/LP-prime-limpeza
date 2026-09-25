// Valida a config da Prime POR FUNCIONALIDADE. Função pura.
// Pix exige chave, nome e cidade; WhatsApp exige número; e-mail ausente não bloqueia nada.

const vazio = (v) => v === undefined || v === null || String(v).trim() === '' || String(v).trim().toUpperCase() === 'PREENCHER';

/**
 * @param {object} prime conteúdo de src/config/prime.js
 * @returns {{pix:{ok:boolean,faltando:string[]}, whatsapp:{ok:boolean,faltando:string[]}, email:{ok:boolean,faltando:string[]}}}
 */
export function validarConfiguracao(prime = {}) {
  const pix = [];
  if (vazio(prime.pix?.chave)) pix.push('pix.chave');
  if (vazio(prime.pix?.nomeRecebedor)) pix.push('pix.nomeRecebedor');
  if (vazio(prime.pix?.cidadeRecebedor)) pix.push('pix.cidadeRecebedor');
  const wa = [];
  if (vazio(prime.whatsapp)) wa.push('whatsapp');
  else if (!/^55\d{10,11}$/.test(String(prime.whatsapp))) wa.push('whatsapp (formato 55 + DDD + número)');
  const em = [];
  if (vazio(prime.email)) em.push('email');
  return {
    pix: { ok: pix.length === 0, faltando: pix },
    whatsapp: { ok: wa.length === 0, faltando: wa },
    email: { ok: em.length === 0, faltando: em },
  };
}

/** Link wa.me com texto, ou null se o WhatsApp não estiver configurado. */
export function linkWhatsApp(prime, texto) {
  if (!validarConfiguracao(prime).whatsapp.ok) return null;
  return `https://wa.me/${prime.whatsapp}?text=${encodeURIComponent(texto)}`;
}
