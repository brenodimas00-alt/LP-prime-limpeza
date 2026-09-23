// Utilidades das telas: estados de carregando/erro, sessão da cliente em demonstração, formatações.
import { el } from './dom.js';
import { modoDev } from '../config/app.js';
import { mensagemErro } from './acoes.js';

export function telaCarregando(alvo, texto = 'Carregando…') {
  alvo.replaceChildren(el('p', { class: 'carregando', role: 'status', text: texto }));
}

export function telaErro(alvo, e, { titulo = 'Não foi possível abrir' } = {}) {
  const naoAchou = e?.codigo === 'NAO_ENCONTRADO';
  alvo.replaceChildren(
    el('h1', { text: naoAchou ? 'Não encontramos este registro' : titulo }),
    el('p', { class: 'alerta alerta-erro', role: 'alert', text: naoAchou ? 'O link pode estar incompleto, ou este registro foi criado em outro aparelho (na demonstração os dados ficam só no navegador onde foram criados).' : mensagemErro(e) }),
  );
}

/** Em ?dev=1 (só mock) as telas de cliente agem como a dona do pedido. Fora disso, usa a sessão guardada. */
export function sessaoCliente(clienteId) {
  return modoDev() && clienteId ? { sessao: { ator: 'cliente', id: clienteId } } : {};
}

export function selo(texto, tipo = '') {
  return el('span', { class: `selo ${tipo}`, text: texto });
}
