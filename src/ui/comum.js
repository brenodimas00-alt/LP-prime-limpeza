// Utilidades das telas: estados de carregando/erro, sessão da cliente em demonstração, formatações.
import { anexar, el, trocar } from './dom.js';
import { definirAbertura } from './layout.js';
import { modoDev } from '../config/app.js';
import { mensagemErro, sessaoExpirada } from './acoes.js';

export function telaCarregando(alvo, texto = 'Carregando…') {
  trocar(alvo, el('p', { class: 'carregando', role: 'status', text: texto }));
}

export function telaErro(alvo, e, { titulo = 'Não foi possível abrir' } = {}) {
  if (e?.codigo === 'SESSAO_EXPIRADA') sessaoExpirada();
  const naoAchou = e?.codigo === 'NAO_ENCONTRADO';
  definirAbertura({ rotulo: 'Prime', titulo: naoAchou ? 'Não encontramos |este registro|' : titulo });
  // erro de rede ou do servidor: dá pra tentar de novo sem perder a página
  const tentar = naoAchou ? null : el('button', { class: 'btn btn-secundario btn-pequeno', type: 'button', text: 'Tentar de novo', dataset: { acao: 'tentar-de-novo' } });
  tentar?.addEventListener('click', () => location.reload());
  trocar(alvo,
    el('p', { class: 'alerta alerta-erro', role: 'alert', text: naoAchou ? 'Confira o link recebido. Na demonstração, os dados ficam só no navegador em que foram criados: abra pelo mesmo aparelho.' : mensagemErro(e) }),
    tentar ? el('div', { class: 'acoes' }, [tentar]) : null,
  );
}

/** Em ?dev=1 (só mock) as telas de cliente agem como a dona do pedido. Fora disso, usa a sessão guardada. */
export function sessaoCliente(clienteId) {
  return modoDev() && clienteId ? { sessao: { ator: 'cliente', id: clienteId } } : {};
}

export function selo(texto, tipo = '') {
  return el('span', { class: `selo ${tipo}`, text: texto });
}
