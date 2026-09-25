// Máquina de estados do pedido (solicitação) e do atendimento. Funções puras: sem storage, sem relógio, sem mensagem.
// Fluxo da cliente (24/09/2026): o cliente SOLICITA, a Prime verifica a disponibilidade e só então vem a cobrança
// (pagamento antecipado e integral). Pedido: solicitado -> disponibilidade_confirmada -> aguardando_pagamento -> confirmado,
// com recusado (sem disponibilidade, com motivo) e cancelado de lado; concluido quando todas as diárias acabam.
import { ErroNegocio } from './modelo.js';

export const ESTADOS_PEDIDO = ['solicitado', 'disponibilidade_confirmada', 'aguardando_pagamento', 'confirmado', 'concluido', 'recusado', 'cancelado'];
/** Estados de pedido que não mudam mais. */
export const PEDIDO_TERMINAL = ['concluido', 'recusado', 'cancelado'];
/** Transições do pedido feitas pela Prime (as outras são derivadas dos atendimentos e pagamentos). */
export const TRANSICOES_PEDIDO = {
  confirmar_disponibilidade: { de: ['solicitado'], para: 'disponibilidade_confirmada', atores: ['prime'] },
  emitir_cobranca: { de: ['disponibilidade_confirmada'], para: 'aguardando_pagamento', atores: ['prime', 'sistema'] },
  recusar: { de: ['solicitado', 'disponibilidade_confirmada', 'aguardando_pagamento'], para: 'recusado', atores: ['prime'] },
};

/** Aplica uma transição do pedido. PURA. */
export function transicionarPedido(pedido, evento, { ator, agora, algumPagamentoConfirmado = false } = {}) {
  const t = TRANSICOES_PEDIDO[evento];
  if (!t) throw new ErroNegocio('EVENTO_INVALIDO', `Evento desconhecido: ${evento}`);
  if (!t.de.includes(pedido.status)) throw new ErroNegocio('TRANSICAO_PROIBIDA', `Não é possível "${evento}" com o pedido "${pedido.status}"`);
  if (!t.atores.includes(ator)) throw new ErroNegocio('ATOR_SEM_PERMISSAO', `"${ator}" não pode executar "${evento}"`);
  if (evento === 'recusar' && algumPagamentoConfirmado) throw new ErroNegocio('CONDICAO_NAO_ATENDIDA', 'Pedido com pagamento confirmado: cancele as diárias e registre o estorno');
  return { ...pedido, status: t.para, historico: [...(pedido.historico || []), { de: pedido.status, para: t.para, evento, em: agora, ator }] };
}

export const ESTADOS_ATENDIMENTO = ['agendado', 'confirmado', 'diarista_a_caminho', 'em_andamento', 'finalizado', 'avaliado', 'cancelado'];
export const ATORES = ['cliente', 'prime', 'diarista', 'sistema'];

/**
 * Tabela de transições. `condicoes` são verificadas contra o contexto montado pelo src/app a partir dos registros.
 * - pagamentoConfirmado: a cobrança da diária (ou a do pacote) está 'confirmada'.
 * - diaristaAprovadaAtribuida: contexto.diarista existe, está 'aprovada' e é a atribuída ao atendimento.
 * - dataNova: dados.data (AAAA-MM-DD) e dados.turno informados.
 * Dono do recurso: ator 'cliente' precisa ser o dono do pedido; ator 'diarista' precisa ser a atribuída.
 */
export const TRANSICOES = {
  confirmar: { de: ['agendado'], para: 'confirmado', atores: ['prime', 'sistema'], condicoes: ['pagamentoConfirmado'] },
  sair_a_caminho: { de: ['confirmado'], para: 'diarista_a_caminho', atores: ['diarista', 'prime'], condicoes: ['diaristaAprovadaAtribuida'] },
  iniciar: { de: ['diarista_a_caminho'], para: 'em_andamento', atores: ['diarista', 'prime'], condicoes: [] },
  finalizar: { de: ['em_andamento'], para: 'finalizado', atores: ['diarista', 'prime'], condicoes: [] },
  avaliar: { de: ['finalizado'], para: 'avaliado', atores: ['cliente', 'sistema'], condicoes: [] },
  cancelar: { de: ['agendado', 'confirmado', 'diarista_a_caminho'], para: 'cancelado', atores: ['cliente', 'prime', 'sistema'], condicoes: [] },
  reagendar: { de: ['agendado', 'confirmado'], para: null, atores: ['cliente', 'prime'], condicoes: ['dataNova'] },
};

/** Próximo evento "natural" do fluxo feliz (usado pelo botão de simulação em ?dev=1). */
export const PROXIMO_EVENTO = {
  agendado: 'confirmar', confirmado: 'sair_a_caminho', diarista_a_caminho: 'iniciar', em_andamento: 'finalizar', finalizado: 'avaliar',
};

/** Estados considerados "ainda por acontecer" (cancelar pedido cancela estes). */
export const ESTADOS_FUTUROS = ['agendado', 'confirmado', 'diarista_a_caminho'];
export const ESTADOS_ATIVOS = ['agendado', 'confirmado', 'diarista_a_caminho', 'em_andamento'];
export const ESTADOS_REALIZADOS = ['finalizado', 'avaliado'];

/** Lista os eventos que o ator pode tentar a partir do estado atual (sem checar condições). */
export function eventosPossiveis(status, ator) {
  return Object.entries(TRANSICOES).filter(([, t]) => t.de.includes(status) && (!ator || t.atores.includes(ator))).map(([e]) => e);
}

/**
 * Aplica um evento ao atendimento. PURA.
 * @param {import('./modelo.js').Atendimento} atendimento
 * @param {string} evento
 * @param {{ator:string, atorId?:string, agora:string, pagamentoConfirmado?:boolean, diarista?:{id:string,status:string}, clienteIdDoPedido?:string, dados?:{data?:string, turno?:string}}} ctx
 * @returns {import('./modelo.js').Atendimento} novo objeto
 */
export function transicionar(atendimento, evento, ctx = {}) {
  const t = TRANSICOES[evento];
  if (!t) throw new ErroNegocio('EVENTO_INVALIDO', `Evento desconhecido: ${evento}`);
  if (!ATORES.includes(ctx.ator)) throw new ErroNegocio('ATOR_SEM_PERMISSAO', `Ator inválido: ${ctx.ator}`);
  if (!ctx.agora) throw new ErroNegocio('DADOS_INVALIDOS', 'Contexto sem "agora"');
  if (!t.de.includes(atendimento.status)) {
    throw new ErroNegocio('TRANSICAO_PROIBIDA', `Não é possível "${evento}" a partir de "${atendimento.status}"`);
  }
  if (!t.atores.includes(ctx.ator)) {
    throw new ErroNegocio('ATOR_SEM_PERMISSAO', `"${ctx.ator}" não pode executar "${evento}"`);
  }
  // Dono do recurso.
  if (ctx.ator === 'cliente' && (!ctx.atorId || ctx.atorId !== ctx.clienteIdDoPedido)) {
    throw new ErroNegocio('ATOR_SEM_PERMISSAO', 'Cliente não é o dono deste pedido');
  }
  if (ctx.ator === 'diarista' && (!ctx.atorId || ctx.atorId !== atendimento.diaristaId)) {
    throw new ErroNegocio('ATOR_SEM_PERMISSAO', 'Diarista não é a atribuída a este atendimento');
  }
  for (const c of t.condicoes) {
    if (c === 'pagamentoConfirmado' && ctx.pagamentoConfirmado !== true) {
      throw new ErroNegocio('CONDICAO_NAO_ATENDIDA', 'O pagamento desta diária ainda não foi confirmado');
    }
    if (c === 'diaristaAprovadaAtribuida') {
      const d = ctx.diarista;
      if (!atendimento.diaristaId) throw new ErroNegocio('CONDICAO_NAO_ATENDIDA', 'Nenhuma diarista atribuída');
      if (!d || d.id !== atendimento.diaristaId) throw new ErroNegocio('CONDICAO_NAO_ATENDIDA', 'Diarista diferente da atribuída');
      if (d.status !== 'aprovada') throw new ErroNegocio('CONDICAO_NAO_ATENDIDA', 'Diarista não está aprovada');
    }
    if (c === 'dataNova' && (!/^\d{4}-\d{2}-\d{2}$/.test(ctx.dados?.data || '') || !ctx.dados?.turno)) {
      throw new ErroNegocio('CONDICAO_NAO_ATENDIDA', 'Reagendamento exige nova data e turno');
    }
  }
  const para = t.para || atendimento.status;
  const novo = {
    ...atendimento,
    status: para,
    versao: (atendimento.versao || 0) + 1,
    historico: [...(atendimento.historico || []), { de: atendimento.status, para, evento, em: ctx.agora, ator: ctx.ator }],
  };
  if (evento === 'reagendar') { novo.data = ctx.dados.data; novo.turno = ctx.dados.turno; novo.deslocada = false; }
  return novo;
}

/**
 * Status do pedido a partir dos atendimentos e dos pagamentos. PURA.
 * Terminais nunca voltam. Antes da cobrança o status é o da Prime (solicitado, disponibilidade_confirmada).
 */
export function derivarStatusPedido(statusAtual, atendimentos, algumPagamentoConfirmado) {
  if (PEDIDO_TERMINAL.includes(statusAtual) || statusAtual === 'rascunho') return statusAtual;
  const st = atendimentos.map((a) => a.status);
  if (st.length && st.every((s) => s === 'cancelado')) return 'cancelado';
  const temAtivo = st.some((s) => ESTADOS_ATIVOS.includes(s));
  const temRealizado = st.some((s) => ESTADOS_REALIZADOS.includes(s));
  if (!temAtivo && temRealizado) return 'concluido';
  if (statusAtual === 'aguardando_pagamento' && algumPagamentoConfirmado) return 'confirmado';
  return statusAtual;
}

/** Pedido em que a cobrança já existe e pode ser paga. */
export const PEDIDO_COM_COBRANCA = ['aguardando_pagamento', 'confirmado', 'concluido'];

/**
 * Elegibilidade de pagamento (é do Pagamento, não do atendimento). PURA.
 * Pagamento antecipado: a cobrança existe desde que a Prime confirmou a disponibilidade e vale enquanto a diária
 * (ou o pacote) não foi cancelada.
 * @returns {{pagavel:boolean, motivo?:string}}
 */
export function elegibilidadePagamento(pagamento, { pedido, atendimento } = {}) {
  if (!pagamento) return { pagavel: false, motivo: 'Pagamento não encontrado' };
  if (pagamento.status === 'confirmado') return { pagavel: false, motivo: 'Pagamento já confirmado pela Prime' };
  if (pagamento.status === 'estornado') return { pagavel: false, motivo: 'Pagamento estornado' };
  if (pagamento.status === 'cancelado') return { pagavel: false, motivo: 'Cobrança cancelada' };
  if (!pedido || pedido.id !== pagamento.pedidoId) return { pagavel: false, motivo: 'Pedido não encontrado' };
  if (!PEDIDO_COM_COBRANCA.includes(pedido.status)) return { pagavel: false, motivo: 'Este pedido não está aguardando pagamento' };
  if (pagamento.parcela === 'pacote') return { pagavel: true };
  if (pagamento.parcela === 'diaria') {
    if (!atendimento || atendimento.id !== pagamento.atendimentoId) return { pagavel: false, motivo: 'Diária não encontrada' };
    if (atendimento.status === 'cancelado') return { pagavel: false, motivo: 'Diária cancelada' };
    return { pagavel: true };
  }
  return { pagavel: false, motivo: 'Cobrança antiga. Fale com a Prime.' };
}

export const ROTULOS_ESTADO = {
  agendado: 'Aguardando confirmação', confirmado: 'Confirmado', diarista_a_caminho: 'Profissional a caminho', em_andamento: 'Em andamento',
  finalizado: 'Finalizado', avaliado: 'Avaliado', cancelado: 'Cancelado',
};
// aguardando_entrada e ativo: só em registros antigos (antes do pagamento integral).
export const ROTULOS_PEDIDO = {
  rascunho: 'Rascunho', solicitado: 'Solicitação enviada', disponibilidade_confirmada: 'Disponibilidade confirmada',
  aguardando_pagamento: 'Aguardando pagamento', confirmado: 'Confirmado', concluido: 'Concluído', recusado: 'Sem disponibilidade',
  cancelado: 'Cancelado', aguardando_entrada: 'Aguardando pagamento', ativo: 'Confirmado',
};
export const ROTULOS_PAGAMENTO = {
  pendente: 'Pendente', informado_pelo_cliente: 'Pagamento informado, aguardando confirmação', confirmado: 'Confirmado',
  cancelado: 'Cancelado', estornado: 'Estornado',
};
