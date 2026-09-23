// acompanhamento/?pedido=ID lista as diárias do pedido; acompanhamento/?atendimento=ID mostra a linha do tempo.
// "Simular próximo passo" só aparece com ?dev=1 (mock). ?pedido/?atendimento não autorizam nada: a leitura
// passa pela sessão (no mock, a do navegador que criou o pedido).
import { anexar, el, param, trocar } from '../dom.js';
import { montarPagina, definirAbertura, ativarReveal } from '../layout.js';
import { api } from '../../services/api.js';
import { executarAcao } from '../acoes.js';
import { telaCarregando, telaErro, sessaoCliente, selo } from '../comum.js';
import { url, modoDev } from '../../config/app.js';
import { ROTULOS_ESTADO, ROTULOS_PEDIDO, ROTULOS_PAGAMENTO, PROXIMO_EVENTO, ESTADOS_FUTUROS, ESTADOS_PARCELA_PAGAVEL } from '../../domain/estados.js';
import { formatarBRL } from '../../domain/dinheiro.js';
import { formatarData, formatarDataCurta, formatarInstante } from '../../domain/calendario.js';
import { TURNOS, FREQUENCIAS } from '../../domain/modelo.js';
import { botaoWhatsAppManual } from '../whatsapp-manual.js';

const raiz = el('div');
montarPagina(raiz);

const FLUXO = ['agendado', 'confirmado', 'diarista_a_caminho', 'em_andamento', 'finalizado', 'avaliado'];
const TIPO_SELO = { cancelado: 'erro', avaliado: 'ok', finalizado: 'ok', agendado: 'neutro' };

async function iniciar() {
  const pedidoId = param('pedido');
  const atendimentoId = param('atendimento');
  telaCarregando(raiz);
  try {
    if (atendimentoId) await telaAtendimento(atendimentoId);
    else if (pedidoId) await telaPedido(pedidoId);
    else telaErro(raiz, { codigo: 'NAO_ENCONTRADO' });
  } catch (e) { telaErro(raiz, e); }
}

async function carregarPedido(id) {
  // Em dev, lê como Prime pra descobrir a dona e depois age como ela.
  return api.obterPedido(id);
}

async function telaPedido(id) {
  const { pedido, cliente, atendimentos, pagamentos } = await carregarPedido(id);
  const p = pedido.pacote;
  const titulo = p.frequencia === 'avulso' ? 'Sua diária' : `Suas ${p.quantidadeDiarias} diárias (${FREQUENCIAS[p.frequencia].toLowerCase()})`;
  const entrada = pagamentos.find((g) => g.parcela === 'entrada');

  const listaAt = el('ul', { class: 'lista', 'aria-label': 'Diárias' }, atendimentos.map((a) => el('li', { dataset: { atendimento: a.id, status: a.status } }, [
    el('div', { class: 'topo' }, [
      el('a', { href: url('acompanhamento/', { atendimento: a.id }), text: `Diária ${a.sequencia}: ${formatarDataCurta(a.data)}` }),
      selo(ROTULOS_ESTADO[a.status], TIPO_SELO[a.status] || ''),
    ]),
    el('p', { class: 'mudo', text: `${TURNOS[a.turno]}${a.deslocada ? ' · data deslocada (dia bloqueado)' : ''}` }),
  ])));

  const listaPg = el('ul', { class: 'lista', 'aria-label': 'Pagamentos' }, pagamentos.map((g) => el('li', { dataset: { pagamento: g.id, status: g.status } }, [
    el('div', { class: 'topo' }, [
      el('span', { text: `${g.parcela === 'entrada' ? 'Entrada (50%)' : `Parcela da diária de ${formatarData(g.venceEm)}`}: ${formatarBRL(g.valorCentavos)}` }),
      selo(ROTULOS_PAGAMENTO[g.status], g.status === 'confirmado' ? 'ok' : g.status === 'cancelado' ? 'erro' : 'aviso'),
    ]),
    ['pendente', 'informado_pelo_cliente'].includes(g.status) ? el('a', { class: 'btn-link', href: url('pagamento/', { pagamento: g.id }), text: g.parcela === 'entrada' ? 'Pagar a entrada' : 'Ver cobrança' }) : null,
  ])));

  const podeCancelar = !['cancelado', 'concluido'].includes(pedido.status) && atendimentos.some((a) => ESTADOS_FUTUROS.includes(a.status));
  const cancelar = podeCancelar ? blocoCancelar(pedido, cliente) : null;

  definirAbertura({ rotulo: `Acompanhamento · Pedido ${ROTULOS_PEDIDO[pedido.status].toLowerCase()}`, titulo: p.frequencia === 'avulso' ? 'Sua |diária|' : `Suas |${p.quantidadeDiarias} diárias|`, lead: `${FREQUENCIAS[p.frequencia]} · total de ${formatarBRL(p.totalCentavos)}, entrada de ${formatarBRL(p.entradaCentavos)}.` });
  trocar(raiz, 
    entrada && entrada.status === 'pendente' && pedido.status === 'aguardando_entrada'
      ? el('div', { class: 'alerta alerta-aviso' }, ['Falta o Pix da entrada pra garantir a data. ', el('a', { href: url('pagamento/', { pagamento: entrada.id }), text: 'Pagar a entrada' })]) : null,
    el('h2', { text: 'Diárias' }), listaAt,
    el('h2', { text: 'Pagamentos' }), listaPg,
    el('div', { class: 'acoes' }, [botaoWhatsAppManual({ texto: `Oi! Tenho uma dúvida sobre meu pedido na Prime (${pedido.id.slice(0, 8)}).`, pedidoId: pedido.id, contexto: 'acompanhamento', ...sessaoCliente(cliente.id) })]),
    cancelar,
  );
  ativarReveal(raiz);
}

function blocoCancelar(pedido, cliente) {
  const caixa = el('div', { class: 'cartao', style: 'margin-top:28px' });
  const abrir = el('button', { class: 'btn btn-perigo', type: 'button', text: 'Cancelar pedido' });
  abrir.addEventListener('click', () => {
    const confirmar = el('button', { class: 'btn btn-perigo', type: 'button', text: 'Sim, cancelar as diárias pendentes' });
    const voltar = el('button', { class: 'btn btn-secundario', type: 'button', text: 'Voltar' });
    voltar.addEventListener('click', () => trocar(caixa, el('h2', { text: 'Precisa cancelar?' }), abrir));
    confirmar.addEventListener('click', () => executarAcao(confirmar, (k) => api.cancelarPedido(pedido.id, {}, { chave: k, ...sessaoCliente(cliente.id) }), {
      id: `cancelar:${pedido.id}`, sucesso: 'Pedido cancelado.', aoSucesso: () => iniciar(),
    }));
    trocar(caixa, 
      el('h2', { text: 'Confirmar cancelamento' }),
      el('p', { text: 'As diárias que ainda não começaram serão canceladas, junto com as cobranças delas. Diárias já realizadas continuam valendo.' }),
      el('div', { class: 'acoes' }, [confirmar, voltar]),
    );
    confirmar.focus();
  });
  anexar(caixa, el('h2', { text: 'Precisa cancelar?' }), abrir);
  return caixa;
}

async function telaAtendimento(id) {
  const r = await api.obterAtendimento(id);
  const { atendimento: a, pedido, diarista, pagamentoDia, avaliacao } = r;
  const quando = {};
  for (const h of a.historico || []) quando[h.para] = h.em;
  quando.agendado = quando.agendado || a.criadoEm;
  const idxAtual = FLUXO.indexOf(a.status);
  const tl = el('ol', { class: 'timeline', 'aria-label': 'Linha do tempo' }, FLUXO.map((s, i) => {
    let classe = '';
    if (a.status === 'cancelado') classe = quando[s] ? 'feito' : '';
    else if (i < idxAtual) classe = 'feito';
    else if (i === idxAtual) classe = 'atual';
    return el('li', { class: classe, dataset: { estado: s }, 'aria-current': i === idxAtual ? 'step' : null }, [
      el('strong', { text: ROTULOS_ESTADO[s] }),
      el('span', { class: 'quando', text: quando[s] ? formatarInstante(quando[s]) : 'ainda não' }),
    ]);
  }));
  if (a.status === 'cancelado') anexar(tl, el('li', { class: 'cancelado', dataset: { estado: 'cancelado' } }, [el('strong', { text: 'Cancelado' }), el('span', { class: 'quando', text: formatarInstante(quando.cancelado) })]));

  const extras = [];
  if (a.status === 'finalizado') extras.push(el('a', { class: 'btn btn-primary', href: url('avaliacao/', { atendimento: a.id }), text: 'Avaliar a diária' }));
  if (a.status === 'avaliado' && avaliacao) extras.push(el('p', { class: 'alerta alerta-ok', text: `Você avaliou com nota ${String(avaliacao.notaFinal).replace('.', ',')}. Obrigada!` }));
  if (pagamentoDia && ['pendente', 'informado_pelo_cliente'].includes(pagamentoDia.status) && ESTADOS_PARCELA_PAGAVEL.includes(a.status)) {
    extras.push(el('a', { class: 'btn btn-secundario', href: url('pagamento/', { pagamento: pagamentoDia.id }), text: `Parcela da diária: ${formatarBRL(pagamentoDia.valorCentavos)}` }));
  }

  definirAbertura({ rotulo: `Acompanhamento · ${ROTULOS_ESTADO[a.status]}`, titulo: `Diária de |${formatarData(a.data)}|`, voltar: { href: url('acompanhamento/', { pedido: pedido.id }), texto: 'Voltar ao pedido' } });
  trocar(raiz, 
    el('dl', { class: 'dados cartao reveal' }, [
      el('dt', { text: 'Situação' }), el('dd', { dataset: { status: a.status } }, [selo(ROTULOS_ESTADO[a.status], TIPO_SELO[a.status] || '')]),
      el('dt', { text: 'Período' }), el('dd', { text: TURNOS[a.turno] }),
      el('dt', { text: 'Diarista' }), el('dd', { text: diarista ? diarista.nome.split(' ')[0] : 'a Prime vai indicar' }),
      el('dt', { text: 'Local' }), el('dd', { text: `${r.cliente.endereco.bairro}, ${r.cliente.endereco.cidade}` }),
    ]),
    el('h2', { text: 'Linha do tempo' }), tl,
    extras.length ? el('div', { class: 'acoes' }, extras) : null,
    modoDev() ? barraSimulacao(r) : null,
  );
}

/** Só ?dev=1: avança o atendimento pro próximo estado, fazendo o que a Prime/diarista fariam. */
function barraSimulacao({ atendimento: a, pedido }) {
  const ev = PROXIMO_EVENTO[a.status];
  const b = el('button', { class: 'btn btn-secundario btn-pequeno', type: 'button', text: 'Simular próximo passo' });
  if (!ev || ev === 'avaliar') b.disabled = true;
  b.addEventListener('click', () => executarAcao(b, async (k) => {
    if (ev === 'confirmar') {
      const { pagamentos } = await api.obterPedido(pedido.id);
      const entrada = pagamentos.find((g) => g.parcela === 'entrada');
      if (entrada.status !== 'confirmado') return api.confirmarPagamento(entrada.id, { chave: k });
      return api.transicionarAtendimento(a.id, { evento: ev }, { chave: k });
    }
    let diaristaId = a.diaristaId;
    if (!diaristaId) {
      const { itens } = await api.listarDiaristas({ status: 'aprovada' });
      if (!itens.length) throw new Error('Nenhuma diarista aprovada no mock');
      diaristaId = itens[0].id;
      await api.atribuirDiarista(a.id, { diaristaId }, { chave: `${k}-atr` });
    }
    return api.transicionarAtendimento(a.id, { evento: ev }, { chave: k, sessao: { ator: 'diarista', id: diaristaId } });
  }, { aoSucesso: () => iniciar() }));
  return el('div', { class: 'dev-bar' }, [el('span', { text: 'Modo dev:' }), b, ev === 'avaliar' ? el('span', { text: 'próximo passo é a avaliação da cliente' }) : null]);
}

iniciar();
