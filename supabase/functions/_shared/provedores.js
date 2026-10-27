// AUT: provedores por canal do motor v2 (whatsapp, email, painel). JS puro: roda na Edge Function (Deno) e nos testes
// (Node); fetch e transporte SMTP são injetados. Contrato: enviar(preparo) -> { ok:true, status, idExterno, provedor }
// | { ok:false, retentavel, erro:{codigo,mensagem}, provedor }. Nunca lança.
import { montarPayloadMeta } from '../../../src/automacoes/payloadMeta.js';
import { layoutEmail } from '../../../src/automacoes/email-html.js';

/**
 * Quem pode enviar mensagem de verdade (pré-lançamento, 27/10/2026: liga por segredo, sem mexer em código).
 * - Produção = o segredo PRODUCAO_REF do projeto é igual ao ref do próprio projeto (o segredo só é posto no projeto de
 *   produção; copiar os segredos pra outro projeto não liga nada, porque o ref não bate). PRODUCAO_REFS continua valendo.
 * - HOMOLOG_REFS nunca envia, nem com o segredo: a homologação tem clientes reais.
 * - Qualquer dúvida (URL inválida, segredo ausente ou diferente) é homologação, ou seja, simulado.
 */
export const PRODUCAO_REFS = Object.freeze([]);
export const HOMOLOG_REFS = Object.freeze(['dkafhwekgvwjttbsfxvu']);

export const refDoProjeto = (supabaseUrl) => new URL(supabaseUrl).hostname.split('.')[0];
export function ambienteDoProjeto(supabaseUrl, producaoRef = '') {
  let ref;
  try { ref = refDoProjeto(supabaseUrl); } catch { return 'homologacao'; }
  if (!ref || HOMOLOG_REFS.includes(ref)) return 'homologacao';
  if (PRODUCAO_REFS.includes(ref)) return 'producao';
  return producaoRef && String(producaoRef).trim() === ref ? 'producao' : 'homologacao';
}

const falha = (provedor, codigo, mensagem, retentavel) => ({ ok: false, retentavel, erro: { codigo: String(codigo), mensagem: String(mensagem).slice(0, 300) }, provedor });
const simulado = (canal) => ({ nome: 'simulado', canal, async enviar() { return { ok: true, status: 'simulada', idExterno: null, provedor: 'simulado' }; } });
export const provedorPainel = { nome: 'painel', async enviar() { return { ok: true, status: 'enviada', idExterno: null, provedor: 'painel' }; } };

/** Meta WhatsApp Cloud API: template aprovado com os parâmetros na ordem de aparição. */
export function provedorMetaCloud({ fetch, urlBase = 'https://graph.facebook.com/v21.0', phoneNumberId, token, timeoutMs = 15000 }) {
  return {
    nome: 'meta_cloud',
    async enviar(p) {
      if (!phoneNumberId || !token) return falha('meta_cloud', 'config', 'meta_cloud sem phone_number_id ou token', false);
      let corpo;
      try { corpo = montarPayloadMeta({ telefone: p.destino, template: p.template, versao: p.templateVersao, corpo: p.corpo, variaveis: p.variaveis }); } catch (e) { return falha('meta_cloud', 'payload', e.message, false); }
      let resp;
      try {
        resp = await fetch(`${urlBase}/${phoneNumberId}/messages`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo), signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (e) { return falha('meta_cloud', 'rede', e.message, true); }
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) return falha('meta_cloud', json?.error?.code ?? resp.status, json?.error?.message || `HTTP ${resp.status}`, resp.status === 429 || resp.status >= 500);
      const wamid = json?.messages?.[0]?.id;
      // sem id a Meta pode ter aceitado: não retenta às cegas (o status chega pelo webhook)
      if (!wamid) return falha('meta_cloud', 'sem_id', 'resposta da Meta sem id da mensagem', false);
      return { ok: true, status: 'enviada', idExterno: wamid, provedor: 'meta_cloud' };
    },
  };
}

/** E-mail por HTTP (formato do Resend: POST /emails). */
export function provedorEmailApi({ fetch, urlBase = 'https://api.resend.com', chave, remetente, urlSite, timeoutMs = 15000 }) {
  return {
    nome: 'email_api',
    async enviar(p) {
      if (!chave || !remetente) return falha('email_api', 'config', 'e-mail sem chave ou remetente verificado', false);
      const m = layoutEmail({ assunto: p.assunto || 'Prime Limpeza Especializada', texto: p.conteudo, urlSite });
      let resp;
      try {
        resp = await fetch(`${urlBase}/emails`, {
          method: 'POST', headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: remetente, to: [p.destino], subject: m.assunto, text: m.texto, html: m.html }), signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (e) { return falha('email_api', 'rede', e.message, true); }
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) return falha('email_api', json?.name ?? resp.status, json?.message || `HTTP ${resp.status}`, resp.status === 429 || resp.status >= 500);
      return { ok: true, status: 'enviada', idExterno: json?.id || null, provedor: 'email_api' };
    },
  };
}

/**
 * SMTP genérico (AUT.5): `transporte` com a interface do nodemailer (sendMail({from,to,subject,text,html}) -> {messageId}).
 * Erro 4xx de SMTP é temporário (retenta); 5xx é definitivo.
 */
export function provedorSmtp({ transporte, remetente, urlSite }) {
  return {
    nome: 'smtp',
    async enviar(p) {
      if (!transporte || !remetente) return falha('smtp', 'config', 'SMTP sem transporte ou remetente', false);
      const m = layoutEmail({ assunto: p.assunto || 'Prime Limpeza Especializada', texto: p.conteudo, urlSite });
      try {
        const r = await transporte.sendMail({ from: remetente, to: p.destino, subject: m.assunto, text: m.texto, html: m.html });
        return { ok: true, status: 'enviada', idExterno: r?.messageId || null, provedor: 'smtp' };
      } catch (e) {
        const codigo = e?.responseCode || e?.code || 'smtp';
        const temporario = (Number(codigo) >= 400 && Number(codigo) < 500) || ['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'ECONNRESET'].includes(e?.code);
        return falha('smtp', codigo, e?.message || 'falha SMTP', temporario);
      }
    },
  };
}

/**
 * Provedores efetivos do ambiente. Em homologação WhatsApp e e-mail são simulados, sem olhar config.
 * Em produção cada canal liga pelo seu segredo (whatsappLigado: PROVEDOR_WHATSAPP=meta_cloud; emailLigado:
 * EMAIL_PROVEDOR=api). Ligado sem credencial, o provedor devolve erro de config (não retenta) e a falha vai pro painel.
 * @param {{ambiente:'producao'|'homologacao', fetch, meta?:object, email?:{tipo:'api'|'smtp'}&object, whatsappLigado?:boolean, emailLigado?:boolean}} op
 */
export function criarProvedores({ ambiente, fetch, meta = {}, email = {}, whatsappLigado = false, emailLigado = false }) {
  if (ambiente !== 'producao') return { whatsapp: simulado('whatsapp'), email: simulado('email'), painel: provedorPainel, ambiente: { emailHabilitado: false, simulado: true } };
  return {
    whatsapp: whatsappLigado ? provedorMetaCloud({ fetch, ...meta }) : simulado('whatsapp'),
    email: !emailLigado ? simulado('email') : email.tipo === 'smtp' ? provedorSmtp(email) : provedorEmailApi({ fetch, ...email }),
    painel: provedorPainel,
    ambiente: { emailHabilitado: !!emailLigado, simulado: false },
  };
}
