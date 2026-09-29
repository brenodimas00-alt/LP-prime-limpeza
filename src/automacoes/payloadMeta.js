// Corpo da Meta WhatsApp Cloud API (POST /{phone_number_id}/messages) pra um template aprovado. PURO.
// AUT: o texto dos templates tem variáveis por nome ({{nome}}); a Meta usa {{1}}, {{2}}... na ordem em que aparecem
// (catalogo.paraMeta). Versão 1 do template = nome do código; versões editadas no painel = <codigo>_v<n> (cada versão
// precisa de aprovação própria na Meta antes de entrar em produção: docs/WHATSAPP.md).
import { paraMeta } from './catalogo.js';

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

export const nomeTemplateMeta = (codigo, versao = 1) => (versao > 1 ? `${codigo}_v${versao}` : codigo);

/**
 * @param {{telefone:string, template:string, versao?:number, corpo:string, variaveis:Object<string,string>}} p
 * @returns {object} corpo JSON do POST
 */
export function montarPayloadMeta({ telefone, template, versao = 1, corpo, variaveis }) {
  const { ordem } = paraMeta(corpo);
  const valores = ordem.map((k) => limparParametro(variaveis?.[k]));
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: paraE164(telefone),
    type: 'template',
    template: {
      name: nomeTemplateMeta(template, versao),
      language: { code: IDIOMA_TEMPLATES },
      components: valores.length ? [{ type: 'body', parameters: valores.map((text) => ({ type: 'text', text })) }] : [],
    },
  };
}
