// WhatsApp no MOCK: só simula. Grava a notificação como 'simulada' com a prévia renderizada. NUNCA marca 'enviada':
// envio real é do backend, via provedor oficial (ver docs/WHATSAPP.md). O front nunca fala com provedor.
import { linkWhatsApp } from '../domain/configuracao.js';

export const canalSimulado = {
  simular(notificacao, agoraISO) {
    return { ...notificacao, status: 'simulada', simuladaEm: agoraISO };
  },
};

/**
 * Contato MANUAL: abre wa.me com a mensagem pronta. Não é notificação; quem chama registra 'contato_manual' no histórico.
 * @returns {string|null} URL ou null se o WhatsApp da Prime não estiver configurado
 */
export function linkContatoManual(prime, texto) {
  return linkWhatsApp(prime, texto);
}
