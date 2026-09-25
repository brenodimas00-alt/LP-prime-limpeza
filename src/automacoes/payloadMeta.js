// REFERÊNCIA pro backend: monta o corpo da Meta WhatsApp Cloud API (POST /{phone_number_id}/messages) pra um
// template aprovado. Função pura. O FRONT NÃO CHAMA ISTO em modo http: quem envia é o backend, via provedor.
import { MENSAGENS, valoresOrdenados } from './mensagens.js';

export const IDIOMA_TEMPLATES = 'pt_BR';

/** Telefone BR só dígitos -> E.164 sem "+", como a Cloud API espera no campo `to`. */
export function paraE164(telefone) {
  const d = String(telefone || '').replace(/\D/g, '');
  const com55 = d.startsWith('55') && (d.length === 12 || d.length === 13) ? d : `55${d}`;
  if (!/^55\d{10,11}$/.test(com55)) throw new Error(`telefone inválido pra WhatsApp: ${telefone}`);
  return com55;
}

/** A Meta rejeita parâmetro vazio, com quebra de linha, tab ou mais de 4 espaços seguidos. */
export function limparParametro(v) {
  const s = String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {4,}/g, '   ').trim();
  if (!s) throw new Error('parâmetro vazio');
  return s.slice(0, 1024);
}

/**
 * @param {{template:string, variaveis:Object<string,string>, destinatario:{telefone:string}}} n
 * @returns {object} corpo JSON do POST
 */
export function montarPayloadMeta({ template, variaveis, destinatario }) {
  if (!MENSAGENS[template]) throw new Error(`template desconhecido: ${template}`);
  const valores = valoresOrdenados(template, variaveis).map(limparParametro);
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: paraE164(destinatario.telefone),
    type: 'template',
    template: {
      name: template,
      language: { code: IDIOMA_TEMPLATES },
      components: valores.length ? [{ type: 'body', parameters: valores.map((text) => ({ type: 'text', text })) }] : [],
    },
  };
}
