// Mapa evento -> notificações. PURO: não lê storage nem relógio; recebe tudo por parâmetro.
// Horários em America/Sao_Paulo. Cancelamento e reagendamento cancelam e recalculam as agendadas.
import { instanteLocal, somarDias, dataNoFuso, diferencaDias } from '../domain/calendario.js';

/**
 * quando: 'imediato' | 'vespera_18h' | 'apos_finalizado' | 'prazo_pagamento'
 * se(ctx): condição opcional avaliada com o contexto carregado.
 */
export const GATILHOS = {
  pedido_criado: [{ template: 'solicitacao_recebida', destinatario: 'cliente', quando: 'imediato' }],
  disponibilidade_confirmada: [{ template: 'disponibilidade_confirmada', destinatario: 'cliente', quando: 'imediato', se: (c) => (c.pagamentos || []).length > 0 }],
  cobranca_emitida: [{ template: 'lembrete_prazo_pagamento', destinatario: 'cliente', quando: 'prazo_pagamento', se: (c) => c.pagamento?.status === 'pendente' }],
  solicitacao_recusada: [{ template: 'solicitacao_recusada', destinatario: 'cliente', quando: 'imediato' }],
  pagamento_confirmado: [{ template: 'pagamento_confirmado', destinatario: 'cliente', quando: 'imediato' }],
  atendimento_confirmado: [{ template: 'lembrete_vespera', destinatario: 'cliente', quando: 'vespera_18h' }],
  atendimento_atribuido: [
    { template: 'atendimento_atribuido', destinatario: 'diarista', quando: 'imediato' },
    { template: 'lembrete_vespera_diarista', destinatario: 'diarista', quando: 'vespera_18h', mesmoDia: true },
    { template: 'atendimento_cancelado_diarista', destinatario: 'diarista_anterior', quando: 'imediato', se: (c) => !!c.evento.dados?.anterior },
  ],
  atendimento_diarista_a_caminho: [{ template: 'profissional_a_caminho', destinatario: 'cliente', quando: 'imediato' }],
  atendimento_em_andamento: [{ template: 'atendimento_iniciado', destinatario: 'cliente', quando: 'imediato' }],
  atendimento_finalizado: [{ template: 'atendimento_finalizado', destinatario: 'cliente', quando: 'imediato' }],
  atendimento_avaliado: [{ template: 'obrigado_avaliacao', destinatario: 'cliente', quando: 'imediato' }],
  atendimento_cancelado: [
    { template: 'cancelamento', destinatario: 'cliente', quando: 'imediato' },
    { template: 'atendimento_cancelado_diarista', destinatario: 'diarista', quando: 'imediato' },
  ],
  atendimento_reagendado: [
    { template: 'remarcacao', destinatario: 'cliente', quando: 'imediato' },
    { template: 'lembrete_prazo_pagamento', destinatario: 'cliente', quando: 'prazo_pagamento', se: (c) => c.pagamento?.status === 'pendente' && c.pagamento?.parcela === 'diaria' },
    { template: 'lembrete_vespera', destinatario: 'cliente', quando: 'vespera_18h', se: (c) => c.atendimento.status === 'confirmado' },
    { template: 'lembrete_vespera_diarista', destinatario: 'diarista', quando: 'vespera_18h', mesmoDia: true, se: (c) => !!c.atendimento.diaristaId },
  ],
  pedido_cancelado: [
    { template: 'cancelamento', destinatario: 'cliente', quando: 'imediato', se: (c) => (c.evento.dados?.atendimentosCancelados || []).length > 0 },
    { template: 'atendimento_cancelado_diarista', destinatario: 'diaristas_dos_cancelados', quando: 'imediato' },
  ],
  estorno_registrado: [{ template: 'estorno_registrado', destinatario: 'cliente', quando: 'imediato' }],
  diarista_cadastrada: [{ template: 'cadastro_recebido', destinatario: 'diarista', quando: 'imediato' }],
  diarista_aprovada: [{ template: 'cadastro_aprovado', destinatario: 'diarista', quando: 'imediato' }],
  diarista_reprovada: [{ template: 'cadastro_reprovado', destinatario: 'diarista', quando: 'imediato' }],
  pagamento_informado: [], // aviso interno: aparece no painel da Prime, sem WhatsApp (ver PENDENCIAS)
};

/**
 * Quais notificações agendadas (pendentes) o evento cancela.
 * @returns {{atendimentoId?:string, pedidoId?:string, templates?:string[], exceto?:{diaristaId:string}}[]}
 */
export function cancelamentosDoEvento(evento) {
  const r = evento.refs || {};
  switch (evento.tipo) {
    case 'atendimento_cancelado':
      return [{ atendimentoId: r.atendimentoId }];
    case 'atendimento_reagendado':
      return [{ atendimentoId: r.atendimentoId, templates: ['lembrete_vespera', 'lembrete_vespera_diarista', 'lembrete_prazo_pagamento'] }];
    case 'pedido_cancelado':
      return (evento.dados?.atendimentosCancelados || []).map((id) => ({ atendimentoId: id }));
    case 'atendimento_atribuido':
      // reatribuição: lembretes da diarista anterior deixam de valer
      return [{ atendimentoId: r.atendimentoId, templates: ['lembrete_vespera_diarista'], exceto: { diaristaId: r.diaristaId } }];
    default:
      return [];
  }
}

/**
 * Calcula o instante de envio. null = não enviar (ex.: véspera já passou e a diária é hoje ou já foi).
 * @param {'imediato'|'vespera_18h'|'apos_finalizado'|'prazo_pagamento'} quando
 * @param {{eventoEm:string, dataAtendimento?:string, pagamento?:{venceEm:string, venceAs:string}, regras:{fuso:string, horaLembreteVespera:number, horaLembretePagamento:number, minutosAposFinalizado:number}}} p
 */
export function calcularEnvio(quando, { eventoEm, dataAtendimento, pagamento, regras, mesmoDia = false }) {
  if (quando === 'imediato') return eventoEm;
  if (quando === 'prazo_pagamento') {
    // No dia do vencimento, na hora do lembrete. Se já passou dessa hora, manda agora, mas só antes do prazo (14h).
    if (!pagamento?.venceEm) return null;
    const alvo = instanteLocal(pagamento.venceEm, regras.horaLembretePagamento, 0, regras.fuso);
    const [h, m] = String(pagamento.venceAs || '14:00').split(':').map(Number);
    const limite = instanteLocal(pagamento.venceEm, h, m, regras.fuso);
    if (Date.parse(alvo) >= Date.parse(eventoEm)) return alvo;
    return Date.parse(eventoEm) < Date.parse(limite) ? eventoEm : null;
  }
  if (quando === 'apos_finalizado') return new Date(Date.parse(eventoEm) + regras.minutosAposFinalizado * 60000).toISOString();
  if (quando === 'vespera_18h') {
    const alvo = instanteLocal(somarDias(dataAtendimento, -1), regras.horaLembreteVespera, 0, regras.fuso);
    if (Date.parse(alvo) >= Date.parse(eventoEm)) return alvo;
    // A véspera 18h já passou: se a diária ainda é amanhã ou depois (no fuso), manda agora. Se é hoje, só manda
    // quando `mesmoDia` (lembrete da diarista, que leva o endereço); o texto diz "hoje" nesse caso.
    const hoje = dataNoFuso(eventoEm, regras.fuso);
    const dif = diferencaDias(hoje, dataAtendimento);
    if (dif >= 1) return eventoEm;
    return dif === 0 && mesmoDia ? eventoEm : null;
  }
  throw new Error(`quando desconhecido: ${quando}`);
}

/**
 * A notificação ainda vale no momento do envio? Protege contra evento antigo, reagendamento e reatribuição.
 * @param {object} n notificação
 * @param {{atendimento?:object, pagamento?:object, pedido?:object}} atual registros atuais
 */
export function aindaValida(n, atual, { agoraISO, fuso = 'America/Sao_Paulo' } = {}) {
  const a = atual.atendimento;
  // Lembrete só sai no dia (no fuso) pra que o texto foi escrito ("amanhã"/"hoje"); atrasou além disso, é obsoleto.
  const noDiaCerto = !agoraISO || !n.refs?.diaEnvio || dataNoFuso(agoraISO, fuso) === n.refs.diaEnvio;
  switch (n.template) {
    case 'lembrete_vespera':
      return !!a && a.status === 'confirmado' && a.data === n.refs.data && a.turno === n.refs.turno && noDiaCerto;
    case 'lembrete_vespera_diarista':
      return !!a && ['agendado', 'confirmado'].includes(a.status) && a.data === n.refs.data && a.turno === n.refs.turno
        && a.diaristaId === n.destinatario.id && noDiaCerto;
    case 'lembrete_prazo_pagamento':
      return !!atual.pagamento && atual.pagamento.status === 'pendente' && atual.pagamento.venceEm === n.refs.venceEm && noDiaCerto;
    case 'atendimento_atribuido':
      return !!a && a.diaristaId === n.destinatario.id && a.status !== 'cancelado';
    default:
      return true;
  }
}
