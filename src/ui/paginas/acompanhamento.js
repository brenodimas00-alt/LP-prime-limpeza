// acompanhamento/?pedido=ID lista as diárias do pedido; acompanhamento/?atendimento=ID mostra a linha do tempo.
// "Simular próximo passo" só aparece com ?dev=1 (mock). ?pedido/?atendimento não autorizam nada: a leitura
// passa pela sessão (no mock, a do navegador que criou o pedido).
import { anexar, el, param, trocar } from '../dom.js';
import { montarPagina, definirAbertura, ativarReveal } from '../layout.js';
import { api } from '../../services/api.js';
import { executarAcao } from '../acoes.js';
import { telaCarregando, telaErro, sessaoCliente, selo } from '../comum.js';
import { url, modoDev } from '../../config/app.js';
import { ROTULOS_ESTADO, ROTULOS_PEDIDO, ROTULOS_PAGAMENTO, PROXIMO_EVENTO, ESTADOS_FUTUROS } from '../../domain/estados.js';
import { TEXTOS_CLIENTE } from '../../config/conteudo.js';
import { formatarBRL } from '../../domain/dinheiro.js';
import { formatarData, formatarDataCurta, formatarInstante } from '../../domain/calendario.js';
import { TURNOS, FREQUENCIAS } from '../../domain/modelo.js';
import { botaoWhatsAppManual } from '../whatsapp-manual.js';

const raiz = el('div');
montarPagina(raiz);

const FLUXO = ['agendado', 'confirmado', 'diarista_a_caminho', 'em_andamento', 'finalizado', 'avaliado'];
const TIPO_SELO = { cancelado: 'erro', avaliado: 'ok', finalizado: 'ok', agendado: 'neutro' };

/** O que cada situação do pedido significa pra cliente (a solicitação não é confirmação). */
const EXPLICA_PEDIDO = {
  solicitado: 'Solicitação enviada. A Prime está verificando a disponibilidade e responde pelo WhatsApp. Ainda não há cobrança.',
  disponibilidade_confirmada: 'A Prime confirmou a disponibilidade. A cobrança sai em seguida.',
  aguardando_pagamento: `A Prime confirmou a disponibilidade. ${TEXTOS_CLIENTE.pagamentoAntecipado} ${TEXTOS_CLIENTE.prazoPagamento}`,
  confirmado: 'Pagamento recebido pela Prime. Atendimento confirmado.',
  recusado: 'A Prime não tem disponibilidade para esta solicitação.',
};

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
  const abertas = pagamentos.filter((g) => ['pendente', 'informado_pelo_cliente'].includes(g.status));

  const listaAt = el('ul', { class: 'lista', 'aria-label': 'Diárias' }, atendimentos.map((a) => el('li', { dataset: { atendimento: a.id, status: a.status } }, [
    el('div', { class: 'topo' }, [
      el('a', { href: url('acompanhamento/', { atendimento: a.id }), text: `Diária ${a.sequencia}: ${formatarDataCurta(a.data)}` }),
      selo(ROTULOS_ESTADO[a.status], TIPO_SELO[a.status] || ''),
    ]),
    el('p', { class: 'mudo', text: `${TURNOS[a.turno]}${a.deslocada ? ' · data deslocada (dia bloqueado)' : ''}` }),
  ])));

  const rotuloCobranca = (g) => (g.parcela === 'pacote' ? 'Pacote' : `Diária de ${formatarData(atendimentos.find((a) => a.id === g.atendimentoId)?.data || g.venceEm)}`);
  const listaPg = pagamentos.length ? el('ul', { class: 'lista', 'aria-label': 'Pagamentos' }, pagamentos.map((g) => el('li', { dataset: { pagamento: g.id, status: g.status } }, [
    el('div', { class: 'topo' }, [
      el('span', { text: `${rotuloCobranca(g)}: ${formatarBRL(g.valorCentavos)}${['pendente', 'informado_pelo_cliente'].includes(g.status) && g.venceEm ? `, até ${String(g.venceAs || '14:00').replace(':00', 'h')} de ${formatarDataCurta(g.venceEm)}` : ''}` }),
      selo(ROTULOS_PAGAMENTO[g.status], g.status === 'confirmado' ? 'ok' : ['cancelado', 'estornado'].includes(g.status) ? 'erro' : 'aviso'),
    ]),
    ['pendente', 'informado_pelo_cliente'].includes(g.status) ? el('a', { class: 'btn-link', href: url('pagamento/', { pagamento: g.id }), text: g.status === 'pendente' ? 'Pagar' : 'Ver cobrança' }) : null,
  ]))) : el('p', { class: 'mudo', id: 'sem-cobranca', text: 'Nenhuma cobrança ainda: ela só vem depois que a Prime confirmar a disponibilidade.' });

  const podeCancelar = !['cancelado', 'concluido', 'recusado'].includes(pedido.status) && atendimentos.some((a) => ESTADOS_FUTUROS.includes(a.status));
  const cancelar = podeCancelar ? blocoCancelar(pedido, cliente) : null;
  const explica = EXPLICA_PEDIDO[pedido.status];
  const enviado = param('enviado') === '1' && pedido.status === 'solicitado';

  definirAbertura({ rotulo: `Acompanhamento · ${ROTULOS_PEDIDO[pedido.status]}`, titulo: p.frequencia === 'avulso' ? 'Sua |diária|' : `Suas |${p.quantidadeDiarias} diárias|`, lead: `${FREQUENCIAS[p.frequencia]} · total de ${formatarBRL(p.totalCentavos)}.` });
  trocar(raiz,
    enviado ? el('p', { class: 'alerta alerta-ok', role: 'status', id: 'solicitacao-enviada', text: 'Recebemos sua solicitação. A Prime verifica a disponibilidade e responde pelo WhatsApp.' }) : null,
    explica ? el('p', { class: `alerta ${pedido.status === 'recusado' ? 'alerta-aviso' : 'alerta-info'}`, dataset: { situacao: pedido.status } }, [
      explica, pedido.status === 'recusado' && pedido.recusa?.motivo ? ` Motivo: ${pedido.recusa.motivo}.` : '',
    ]) : null,
    abertas.length && pedido.status !== 'recusado' ? el('div', { class: 'alerta alerta-aviso' }, [`${abertas.length === 1 ? 'Há 1 pagamento antecipado' : `Há ${abertas.length} pagamentos antecipados`} em aberto. `, el('a', { href: url('pagamento/', { pagamento: abertas[0].id }), text: 'Pagar' })]) : null,
    el('h2', { text: 'Diárias' }), listaAt,
    pedido.preferenciaProfissional ? el('p', { class: 'mudo', text: `Preferência informada: ${pedido.preferenciaProfissional}. A Prime considera sempre que houver disponibilidade.` }) : null,
    el('h2', { text: 'Pagamentos' }), listaPg,
    el('details', { class: 'cartao', style: 'margin-top:20px' }, [
      el('summary', { text: TEXTOS_CLIENTE.imprevistoTitulo, style: 'cursor:pointer;font-weight:600' }),
      ...TEXTOS_CLIENTE.imprevisto.map((x) => el('p', { style: 'margin-top:10px', text: x })),
    ]),
    el('div', { class: 'acoes' }, [botaoWhatsAppManual({ texto: `Oi! Tenho uma dúvida sobre minha solicitação na Prime (${pedido.id.slice(0, 8)}).`, pedidoId: pedido.id, contexto: 'acompanhamento', ...sessaoCliente(cliente.id) })]),
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
      el('p', { text: 'As diárias que ainda não começaram serão canceladas, junto com as cobranças em aberto delas. Diárias já realizadas continuam valendo. Se você já pagou alguma diária cancelada, fale com a Prime.' }),
      el('div', { class: 'acoes' }, [confirmar, voltar]),
    );
    confirmar.focus();
  });
  anexar(caixa, el('h2', { text: 'Precisa cancelar?' }), abrir);
  return caixa;
}

async function telaAtendimento(id) {
  const r = await api.obterAtendimento(id);
  const { atendimento: a, pedido, diarista, pagamento, avaliacao } = r;
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
  if (a.status === 'finalizado') extras.push(el('a', { class: 'btn btn-primary', href: url('avaliacao/', { atendimento: a.id }), text: 'Responder a pesquisa de satisfação' }));
  if (a.status === 'avaliado' && avaliacao) extras.push(el('p', { class: 'alerta alerta-ok', text: 'Você respondeu a pesquisa de satisfação. Obrigada!' }));
  if (pagamento && ['pendente', 'informado_pelo_cliente'].includes(pagamento.status) && a.status !== 'cancelado') {
    extras.push(el('a', { class: 'btn btn-secundario', href: url('pagamento/', { pagamento: pagamento.id }), text: `Pagamento antecipado: ${formatarBRL(pagamento.valorCentavos)}` }));
  }

  definirAbertura({ rotulo: `Acompanhamento · ${ROTULOS_ESTADO[a.status]}`, titulo: `Diária de |${formatarData(a.data)}|`, voltar: { href: url('acompanhamento/', { pedido: pedido.id }), texto: 'Voltar ao pedido' } });
  trocar(raiz, 
    el('dl', { class: 'dados cartao reveal' }, [
      el('dt', { text: 'Situação' }), el('dd', { dataset: { status: a.status } }, [selo(ROTULOS_ESTADO[a.status], TIPO_SELO[a.status] || '')]),
      el('dt', { text: 'Período' }), el('dd', { text: TURNOS[a.turno] }),
      el('dt', { text: 'Profissional' }), el('dd', { text: diarista ? `${diarista.nome.split(' ')[0]} (designada pela Prime)` : 'a Prime designa a profissional' }),
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
      // o que a Prime faria: confirmar a disponibilidade (nasce a cobrança) e depois o recebimento
      const prime = { sessao: { ator: 'prime' } };
      let { pedido: p2, pagamentos } = await api.obterPedido(pedido.id, prime);
      if (p2.status === 'solicitado') ({ pagamentos } = await api.confirmarDisponibilidade(pedido.id, {}, { chave: `${k}-disp`, ...prime }));
      const g = pagamentos.find((x) => x.parcela === 'pacote' || x.atendimentoId === a.id);
      if (g && g.status !== 'confirmado') return api.confirmarPagamento(g.id, { chave: k, ...prime });
      return api.transicionarAtendimento(a.id, { evento: ev }, { chave: k, ...prime });
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
