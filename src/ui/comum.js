// Utilidades das telas: estados de carregando/erro, sessão da cliente em demonstração, formatações.
import { anexar, el, trocar } from './dom.js';
import { definirAbertura } from './layout.js';
import { modoDev } from '../config/app.js';
import { mensagemErro } from './acoes.js';

export function telaCarregando(alvo, texto = 'Carregando…') {
  trocar(alvo, el('p', { class: 'carregando', role: 'status', text: texto }));
}

export function telaErro(alvo, e, { titulo = 'Não foi possível abrir' } = {}) {
  const naoAchou = e?.codigo === 'NAO_ENCONTRADO';
  definirAbertura({ rotulo: 'Prime', titulo: naoAchou ? 'Não encontramos |este registro|' : titulo });
  trocar(alvo, 
    el('p', { class: 'alerta alerta-erro', role: 'alert', text: naoAchou ? 'Confira o link recebido. Na demonstração, os dados ficam só no navegador em que foram criados: abra pelo mesmo aparelho.' : mensagemErro(e) }),
  );
}

/** Em ?dev=1 (só mock) as telas de cliente agem como a dona do pedido. Fora disso, usa a sessão guardada. */
export function sessaoCliente(clienteId) {
  return modoDev() && clienteId ? { sessao: { ator: 'cliente', id: clienteId } } : {};
}

export function selo(texto, tipo = '') {
  return el('span', { class: `selo ${tipo}`, text: texto });
}
