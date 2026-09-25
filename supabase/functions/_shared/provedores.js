// B5: provedores de envio das notificações e a regra de envio (validade, prévia, retentativa com backoff).
// JS puro, sem dependência de runtime: roda na Edge Function (Deno) e nos testes (Node). O fetch é injetado.
import { aindaValida } from '../../../src/automacoes/gatilhos.js';
import { renderizar } from '../../../src/automacoes/mensagens.js';
import { montarPayloadMeta } from '../../../src/automacoes/payloadMeta.js';

/**
 * Projetos que PODEM enviar mensagem de verdade. Fora desta lista, o provedor é SEMPRE 'simulado', seja qual for a
 * configuração: a homologação tem clientes reais (spec, seção 2). Travado no código de propósito; o go-live acrescenta
 * aqui o ref do projeto de produção (docs/GO-LIVE.md).
 */
export const PRODUCAO_REFS = Object.freeze([]);
/** E-mail pronto e desligado até existir remetente verificado (PENDENCIAS). */
export const EMAIL_HABILITADO = false;
/** Minutos de espera depois da 1ª, 2ª e 3ª falha; na 4ª a notificação vai pra 'erro' (visível no painel). */
export const BACKOFF_MINUTOS = Object.freeze([1, 5, 15]);
export const MAX_TENTATIVAS = BACKOFF_MINUTOS.length + 1;

export function refDoProjeto(supabaseUrl) {
  return new URL(supabaseUrl).hostname.split('.')[0];
}

export function ambienteDoProjeto(supabaseUrl) {
  return PRODUCAO_REFS.includes(refDoProjeto(supabaseUrl)) ? 'producao' : 'homologacao';
}

/** Nome do provedor efetivo. `configurado` vem de variável de ambiente, mas só vale em produção. */
export function nomeDoProvedor({ ambiente, configurado }) {
  if (ambiente !== 'producao') return 'simulado';
  if (configurado === 'meta_cloud') return 'meta_cloud';
  if (configurado === 'email' && EMAIL_HABILITADO) return 'email';
  return 'simulado';
}

export class ErroProvedor extends Error {
  constructor(codigo, mensagem, retentavel) {
    super(mensagem);
    this.codigo = codigo;
    this.retentavel = retentavel;
  }
}

const simulado = { nome: 'simulado', async enviar() { return { status: 'simulada', idExterno: null }; } };

/** Meta WhatsApp Cloud API: POST /{phone_number_id}/messages com o corpo de payloadMeta.js. */
export function provedorMetaCloud({ fetch, urlBase = 'https://graph.facebook.com/v21.0', phoneNumberId, token, timeoutMs = 15000 }) {
  return {
    nome: 'meta_cloud',
    async enviar(n) {
      if (!phoneNumberId || !token) throw new ErroProvedor('config', 'meta_cloud sem phone_number_id ou token', false);
      let corpo;
      try { corpo = montarPayloadMeta(n); } catch (e) { throw new ErroProvedor('payload', e.message, false); }
      let resp;
      try {
        resp = await fetch(`${urlBase}/${phoneNumberId}/messages`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(corpo), signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (e) { throw new ErroProvedor('rede', e.message, true); }
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new ErroProvedor(String(json?.error?.code ?? resp.status), json?.error?.message || `HTTP ${resp.status}`, resp.status === 429 || resp.status >= 500);
      const wamid = json?.messages?.[0]?.id;
      if (!wamid) throw new ErroProvedor('sem_id', 'resposta da Meta sem id da mensagem', true);
      return { status: 'enviada', idExterno: wamid };
    },
  };
}

/** E-mail transacional (API no formato do Resend: POST /emails). Exige remetente verificado e e-mail no destinatário. */
export function provedorEmail({ fetch, urlBase = 'https://api.resend.com', chave, remetente, timeoutMs = 15000 }) {
  return {
    nome: 'email',
    async enviar(n) {
      if (!chave || !remetente) throw new ErroProvedor('config', 'email sem chave ou remetente verificado', false);
      const para = n.destinatario?.email;
      if (!para) throw new ErroProvedor('sem_email', 'destinatário sem e-mail', false);
      let resp;
      try {
        resp = await fetch(`${urlBase}/emails`, {
          method: 'POST', headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: remetente, to: [para], subject: 'Prime Limpeza Especializada', text: n.previa }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (e) { throw new ErroProvedor('rede', e.message, true); }
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new ErroProvedor(String(json?.name ?? resp.status), json?.message || `HTTP ${resp.status}`, resp.status === 429 || resp.status >= 500);
      if (!json?.id) throw new ErroProvedor('sem_id', 'resposta sem id do e-mail', true);
      return { status: 'enviada', idExterno: json.id };
    },
  };
}

/** Monta o provedor efetivo do ambiente. Em homologação nem chega a olhar a config dos reais. */
export function criarProvedor({ ambiente, configurado, fetch, meta = {}, email = {} }) {
  const nome = nomeDoProvedor({ ambiente, configurado });
  if (nome === 'meta_cloud') return provedorMetaCloud({ fetch, ...meta });
  if (nome === 'email') return provedorEmail({ fetch, ...email });
  return simulado;
}

/**
 * Tenta enviar UMA notificação pendente e devolve o que gravar nela.
 * Obsoleta no horário (reagendou, pagou, reatribuiu, passou do dia) = cancelada. Falha retentável volta a 'pendente'
 * com novo horário (backoff); na última tentativa ou falha definitiva, 'erro' com a mensagem.
 * @param {object} n notificação (formato j_notificacao)
 * @param {{atual:{atendimento?:object, pagamento?:object}, agoraISO:string, fuso:string, provedor:{nome:string, enviar:Function}}} p
 */
export async function enviarNotificacao(n, { atual, agoraISO, fuso, provedor }) {
  if (!aindaValida(n, atual, { agoraISO, fuso })) return { status: 'cancelada', motivo: 'obsoleta no horário do envio' };
  const tentativas = (n.tentativas || 0) + 1;
  let previa = n.previa ?? null;
  try {
    previa = renderizar(n.template, n.variaveis);
    const r = await provedor.enviar({ ...n, previa });
    return { status: r.status, previa, provedor: provedor.nome, idExterno: r.idExterno ?? null, enviadaEm: agoraISO, erro: null, tentativas };
  } catch (e) {
    const retentavel = e instanceof ErroProvedor ? e.retentavel : false; // erro de template/dado não melhora tentando de novo
    const volta = retentavel && tentativas < MAX_TENTATIVAS;
    return {
      status: volta ? 'pendente' : 'erro', previa, provedor: provedor.nome, tentativas,
      erro: { codigo: e.codigo ?? 'interno', mensagem: String(e.message || e).slice(0, 300), em: agoraISO, tentativa: tentativas },
      agendadaPara: volta ? new Date(Date.parse(agoraISO) + BACKOFF_MINUTOS[tentativas - 1] * 60000).toISOString() : n.agendadaPara,
    };
  }
}
