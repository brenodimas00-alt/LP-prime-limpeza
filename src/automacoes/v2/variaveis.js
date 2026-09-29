// AUT: variáveis de cada template a partir do contexto carregado pelo motor. PURO.
// Devolve só as variáveis permitidas do template (catalogo.VARIAVEIS_PERMITIDAS); valor ausente fica undefined e a
// renderização falha com motivo (nunca sai mensagem com placeholder vazio).
import { formatarBRL } from '../../domain/dinheiro.js';
import { formatarData, formatarDataCurta, dataNoFuso, diaDaSemana } from '../../domain/calendario.js';
import { FREQUENCIAS } from '../../domain/modelo.js';
import { VARIAVEIS_PERMITIDAS } from '../catalogo.js';

export const PERIODOS = { manha: 'manhã, com início às 8h', tarde: 'tarde, com início às 13h', integral: 'manhã e tarde, das 8h às 17h' };
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const primeiroNome = (s) => String(s || '').trim().split(/\s+/)[0] || undefined;

/** Telefone só com o fim visível: (31) 9****-7777. */
export function mascararTelefone(t) {
  const d = String(t || '').replace(/\D/g, '');
  if (d.length < 10) return d ? '***' : undefined;
  return `(${d.slice(0, 2)}) ${d.length === 11 ? d[2] : ''}****-${d.slice(-4)}`;
}
export function mascararEmail(e) {
  const [u, dominio] = String(e || '').split('@');
  return dominio ? `${u.slice(0, 1)}***@${dominio}` : undefined;
}

function resumoPedido(pedido, atendimentos) {
  if (!pedido?.pacote) return undefined;
  const p = pedido.pacote;
  const ativos = (atendimentos || []).filter((a) => a.status !== 'cancelado');
  const primeira = (ativos[0] || atendimentos?.[0])?.data;
  if (p.frequencia === 'avulso') return primeira ? `1 diária em ${formatarData(primeira)}` : undefined;
  return primeira ? `${ativos.length || p.quantidadeDiarias} diárias (${FREQUENCIAS[p.frequencia].toLowerCase()}) a partir de ${formatarData(primeira)}` : undefined;
}
const quandoRelativo = (data, diaEnvio) => `${diaEnvio === data ? 'hoje' : 'amanhã'}, ${formatarData(data)},`;
const endereco = (e) => (e?.logradouro ? `${e.logradouro}, ${e.numero}${e.complemento ? ` ${e.complemento}` : ''}, ${e.bairro}, ${e.cidade}` : undefined);

/**
 * @param {string} template
 * @param {object} ctx { cliente, pedido, atendimentos, atendimento, diarista, pagamento, pagamentos, evento, dados, resumo, documento }
 * @param {{urlSite:string, diaEnvio:string, destinatario:object, fuso:string}} extra
 */
export function variaveisDe(template, ctx, { urlSite, diaEnvio, destinatario }) {
  const c = ctx.cliente; const a = ctx.atendimento; const d = ctx.diarista; const pg = ctx.pagamento; const dados = ctx.dados || {};
  const link = (caminho, params = {}) => { const u = new URL(caminho, urlSite); for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v); return u.toString(); };
  const prazo = (g) => (g?.venceEm ? (g.venceEm === diaEnvio ? `hoje, até ${String(g.venceAs || '14:00').replace(':00', 'h')}` : `${String(g.venceAs || '14:00').replace(':00', 'h')} de ${formatarDataCurta(g.venceEm)}`) : undefined);
  const nomeDest = destinatario?.tipo === 'diarista' ? primeiroNome(d?.nome) : primeiroNome(c?.nome);
  const todas = {
    nome: nomeDest,
    resumo: resumoPedido(ctx.pedido, ctx.atendimentos),
    link: undefined,
    total: ctx.pedido?.pacote?.totalCentavos !== undefined ? formatarBRL(ctx.pedido.pacote.totalCentavos) : undefined,
    valor: pg ? formatarBRL(pg.valorCentavos) : (dados.valorCentavos !== undefined ? formatarBRL(dados.valorCentavos) : undefined),
    prazo: prazo(pg),
    motivo: dados.motivo || ctx.pedido?.recusa?.motivo,
    oque: undefined,
    quando: a ? quandoRelativo(a.data, diaEnvio) : undefined,
    periodo: a ? PERIODOS[a.turno] : undefined,
    carga: ctx.pedido?.pacote?.duracaoHoras ? `${ctx.pedido.pacote.duracaoHoras} horas` : undefined,
    profissional: primeiroNome(d?.nome),
    data: a ? formatarData(a.data) : (pg?.venceEm ? formatarData(pg.venceEm) : undefined),
    horas: dados.horas ? `${dados.horas} hora${dados.horas > 1 ? 's' : ''}` : undefined,
    estado: dados.estado,
    endereco: endereco(c?.endereco),
    documento: ctx.documento?.nome,
    dias: dados.dias !== undefined ? String(dados.dias) : undefined,
    cliente: String(c?.nome || '').trim() || dados.cliente,
    telefone: mascararTelefone(c?.telefone || dados.telefone) || dados.telefoneMascarado,
    mes: undefined,
    regra: dados.regra, erro: dados.erro, texto: dados.texto,
    ...(ctx.resumo || {}),
  };
  switch (template) {
    case 'solicitacao_recebida': todas.link = ctx.pedido && link('acompanhamento/', { pedido: ctx.pedido.id }); break;
    case 'disponibilidade_confirmada': {
      const primeira = [...(ctx.pagamentos || [])].sort((x, y) => (x.venceEm || '').localeCompare(y.venceEm || ''))[0];
      todas.valor = primeira && `${formatarBRL(primeira.valorCentavos)}${(ctx.pagamentos?.length || 0) > 1 ? ' da primeira diária (as outras vencem até o dia útil anterior a cada uma)' : ''}`;
      todas.prazo = prazo(primeira);
      todas.link = primeira && link('pagamento/', { pagamento: primeira.id });
      break;
    }
    case 'lembrete_prazo_pagamento': todas.link = pg && link('pagamento/', { pagamento: pg.id }); break;
    case 'pagamento_confirmado':
      todas.oque = pg && `${formatarBRL(pg.valorCentavos)} ${a ? `da diária de ${formatarData(a.data)}` : 'do pacote'}`;
      todas.link = ctx.pedido && link('acompanhamento/', { pedido: ctx.pedido.id });
      break;
    case 'atendimento_finalizado': case 'lembrete_pesquisa': todas.link = a && link('avaliacao/', { atendimento: a.id }); break;
    case 'remarcacao_confirmada': todas.quando = a && formatarDataCurta(a.data); break;
    case 'estorno_registrado': todas.oque = pg && (pg.parcela === 'pacote' ? 'pacote de diárias' : a ? `diária de ${formatarData(a.data)}` : 'diária'); break;
    case 'hora_extra_registrada': todas.link = dados.pagamentoId && link('pagamento/', { pagamento: dados.pagamentoId }); break;
    case 'ocorrencia_atualizada': todas.link = a && link('acompanhamento/', { atendimento: a.id }); break;
    case 'renovacao_pacote': {
      const mes = Number(diaEnvio.slice(5, 7)) % 12; // próximo mês
      todas.mes = MESES[mes];
      todas.link = ctx.pedido && link('autoagendamento/', { repetir: ctx.pedido.id });
      break;
    }
    case 'reativacao': todas.link = link('autoagendamento/'); break;
    case 'cadastro_recebido': todas.dias = '5'; break;
    case 'lembrete_vespera_profissional': break;
    case 'diaria_cancelada_ou_remarcada': todas.oque = dados.oque; break;
    case 'pagamento_informado': todas.oque = pg && (a ? `diária de ${formatarData(a.data)}` : 'pacote'); break;
    case 'pagamento_vencido': todas.data = a ? formatarData(a.data) : todas.data; break;
    default: break;
  }
  const permitidas = VARIAVEIS_PERMITIDAS[template] || [];
  return Object.fromEntries(permitidas.map((k) => [k, todas[k]]));
}

/** Preenche {{variavel}}; lança com o nome da primeira variável vazia (a execução vai pra falhou com esse motivo). */
export function renderizar(corpo, variaveis) {
  return String(corpo).replace(/\{\{(\w+)\}\}/g, (_, nome) => {
    const v = variaveis?.[nome];
    if (v === undefined || v === null || String(v).trim() === '') throw Object.assign(new Error(`variável obrigatória vazia: ${nome}`), { variavel: nome });
    return String(v);
  });
}

/** Dia da semana curto (resumos). */
export const nomeSemana = (data) => ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][diaDaSemana(data)];
export { dataNoFuso };
