// Máquina de estados do atendimento e derivação do status do pedido. Funções puras: sem storage, sem relógio, sem mensagem.
import { ErroNegocio } from './modelo.js';

export const ESTADOS_ATENDIMENTO = ['agendado', 'confirmado', 'diarista_a_caminho', 'em_andamento', 'finalizado', 'avaliado', 'cancelado'];
export const ATORES = ['cliente', 'prime', 'diarista', 'sistema'];

/**
 * Tabela de transições. `condicoes` são verificadas contra o contexto montado pelo src/app a partir dos registros.
 * - entradaConfirmada: pagamento da entrada do pedido está 'confirmado'.
 * - diaristaAprovadaAtribuida: contexto.diarista existe, está 'aprovada' e é a atribuída ao atendimento.
 * - dataNova: dados.data (AAAA-MM-DD) e dados.turno informados.
 * Dono do recurso: ator 'cliente' precisa ser o dono do pedido; ator 'diarista' precisa ser a atribuída.
 */
export const TRANSICOES = {
  confirmar: { de: ['agendado'], para: 'confirmado', atores: ['prime', 'sistema'], condicoes: ['entradaConfirmada'] },
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

/** Estados em que a parcela do dia pode ser paga (lista explícita, não comparação de ordem). */
export const ESTADOS_PARCELA_PAGAVEL = ['diarista_a_caminho', 'em_andamento', 'finalizado', 'avaliado'];
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
 * @param {{ator:string, atorId?:string, agora:string, entradaConfirmada?:boolean, diarista?:{id:string,status:string}, clienteIdDoPedido?:string, dados?:{data?:string, turno?:string}}} ctx
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
    if (c === 'entradaConfirmada' && ctx.entradaConfirmada !== true) {
      throw new ErroNegocio('CONDICAO_NAO_ATENDIDA', 'A entrada ainda não foi confirmada');
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
 * Status do pedido a partir dos atendimentos e da entrada. PURA.
 * Estados terminais (cancelado, concluido) nunca voltam.
 */
export function derivarStatusPedido(statusAtual, atendimentos, entradaConfirmada) {
  if (statusAtual === 'cancelado' || statusAtual === 'concluido' || statusAtual === 'rascunho') return statusAtual;
  const st = atendimentos.map((a) => a.status);
  if (st.length && st.every((s) => s === 'cancelado')) return 'cancelado';
  const temAtivo = st.some((s) => ESTADOS_ATIVOS.includes(s));
  const temRealizado = st.some((s) => ESTADOS_REALIZADOS.includes(s));
  if (!temAtivo && temRealizado) return 'concluido';
  if (statusAtual === 'aguardando_entrada' && entradaConfirmada) return 'ativo';
  return statusAtual;
}

/**
 * Elegibilidade de pagamento (é do Pagamento, não do atendimento). PURA.
 * @returns {{pagavel:boolean, motivo?:string}}
 */
export function elegibilidadePagamento(pagamento, { pedido, atendimento } = {}) {
  if (!pagamento) return { pagavel: false, motivo: 'Pagamento não encontrado' };
  if (pagamento.status === 'confirmado') return { pagavel: false, motivo: 'Pagamento já confirmado pela Prime' };
  if (pagamento.status === 'cancelado') return { pagavel: false, motivo: 'Cobrança cancelada' };
  if (pagamento.parcela === 'entrada') {
    if (!pedido || pedido.id !== pagamento.pedidoId) return { pagavel: false, motivo: 'Pedido não encontrado' };
    if (pedido.status === 'cancelado') return { pagavel: false, motivo: 'Pedido cancelado' };
    return { pagavel: true };
  }
  if (pagamento.parcela === 'dia') {
    if (!atendimento || atendimento.id !== pagamento.atendimentoId) return { pagavel: false, motivo: 'Atendimento não encontrado' };
    if (!ESTADOS_PARCELA_PAGAVEL.includes(atendimento.status)) {
      return { pagavel: false, motivo: 'A parcela do dia fica disponível quando a diarista estiver a caminho' };
    }
    return { pagavel: true };
  }
  return { pagavel: false, motivo: 'Parcela desconhecida' };
}

export const ROTULOS_ESTADO = {
  agendado: 'Agendado', confirmado: 'Confirmado', diarista_a_caminho: 'Diarista a caminho', em_andamento: 'Em andamento',
  finalizado: 'Finalizado', avaliado: 'Avaliado', cancelado: 'Cancelado',
};
export const ROTULOS_PEDIDO = {
  rascunho: 'Rascunho', aguardando_entrada: 'Aguardando entrada', ativo: 'Ativo', concluido: 'Concluído', cancelado: 'Cancelado',
};
export const ROTULOS_PAGAMENTO = {
  pendente: 'Pendente', informado_pelo_cliente: 'Pagamento informado, aguardando confirmação', confirmado: 'Confirmado', cancelado: 'Cancelado',
};
