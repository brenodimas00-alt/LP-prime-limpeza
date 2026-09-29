// AUT: provedores por canal do motor v2 (whatsapp, email, painel). JS puro: roda na Edge Function (Deno) e nos testes
// (Node); fetch e transporte SMTP são injetados. Contrato: enviar(preparo) -> { ok:true, status, idExterno, provedor }
// | { ok:false, retentavel, erro:{codigo,mensagem}, provedor }. Nunca lança.
import { montarPayloadMeta } from '../../../src/automacoes/payloadMeta.js';
import { layoutEmail } from '../../../src/automacoes/email-html.js';

/**
 * Projetos que PODEM enviar mensagem de verdade. Fora desta lista, WhatsApp e e-mail são SEMPRE 'simulado', seja qual
 * for a configuração: a homologação tem clientes reais. Travado no código de propósito; o go-live acrescenta aqui o ref
 * do projeto de produção (docs/GO-LIVE.md).
 */
export const PRODUCAO_REFS = Object.freeze([]);
/** E-mail pronto e desligado até existir remetente verificado (PENDENCIAS). */
export const EMAIL_HABILITADO = false;

export const refDoProjeto = (supabaseUrl) => new URL(supabaseUrl).hostname.split('.')[0];
export const ambienteDoProjeto = (supabaseUrl) => (PRODUCAO_REFS.includes(refDoProjeto(supabaseUrl)) ? 'producao' : 'homologacao');

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
 * @param {{ambiente:'producao'|'homologacao', fetch, meta?:object, email?:{tipo:'api'|'smtp'}&object, whatsappLigado?:boolean}} op
 */
export function criarProvedores({ ambiente, fetch, meta = {}, email = {}, whatsappLigado = false }) {
  if (ambiente !== 'producao') return { whatsapp: simulado('whatsapp'), email: simulado('email'), painel: provedorPainel, ambiente: { emailHabilitado: false, simulado: true } };
  return {
    whatsapp: whatsappLigado ? provedorMetaCloud({ fetch, ...meta }) : simulado('whatsapp'),
    email: !EMAIL_HABILITADO ? simulado('email') : email.tipo === 'smtp' ? provedorSmtp(email) : provedorEmailApi({ fetch, ...email }),
    painel: provedorPainel,
    ambiente: { emailHabilitado: EMAIL_HABILITADO, simulado: false },
  };
}
