// Botão "falar com a Prime no WhatsApp": contato MANUAL via wa.me. Registra 'contato_manual' no histórico
// (não é notificação). Sem WhatsApp configurado em prime.js, mostra aviso e não gera link.
import { el, hrefSeguro } from './dom.js';
import { configPrime } from '../config/app.js';
import { linkContatoManual } from '../services/whatsapp.js';
import { api, novaChave } from '../services/api.js';

/**
 * @param {{texto:string, rotulo?:string, pedidoId?:string, diaristaId?:string, contexto:string, sessao?:object}} op
 */
export function botaoWhatsAppManual({ texto, rotulo = 'Falar com a Prime no WhatsApp', pedidoId, diaristaId, contexto, sessao }) {
  const href = hrefSeguro(linkContatoManual(configPrime(), texto) || '');
  if (!href) {
    return el('p', { class: 'alerta alerta-info', role: 'note', dataset: { whatsapp: 'indisponivel' }, text: 'O WhatsApp da Prime ainda não foi configurado neste site. Use os contatos do rodapé.' });
  }
  const a = el('a', { class: 'btn btn-secundario', href, target: '_blank', rel: 'noopener', dataset: { whatsapp: 'manual' } }, [
    el('img', { src: new URL('../../assets/icons/whatsapp.svg', import.meta.url).href, alt: '', width: 18, height: 18 }), rotulo,
  ]);
  a.addEventListener('click', () => {
    if (!pedidoId && !diaristaId) return;
    api.registrarContatoManual({ pedidoId, diaristaId, contexto }, { chave: novaChave(), ...(sessao ? { sessao } : {}) }).catch(() => { /* registro é melhor esforço */ });
  });
  return a;
}
