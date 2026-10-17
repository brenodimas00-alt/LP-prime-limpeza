// Monta, a partir do rascunho, o pedido que o servidor cota e grava (mesmo formato de cotarV3) e os endereços novos.
// Cada atendimento leva o próprio serviço, endereço, duração e horário (itens 21 e 28). O 1º leva as características do
// local (o servidor recalcula a sugestão); os demais as levam quando o serviço é o mesmo do principal.
// Endereço: 'principal' (o da etapa 3: salvo ou novo), 'salvo:<id>' ou 'extra:<n>' (endereço novo de um card).
import { estado } from './estado.js';
import { caracteristicasParaEnvio } from './passo-local.js';

/** Quantas diárias/profissionais e em quais datas, conforme a modalidade. */
export function datasDoPedido() {
  const r = estado();
  if (r.modalidade === 'pacote') return [...r.datas].sort();
  return r.datas.length ? [r.datas[0]] : [];
}

/** Lista de "linhas" (diária do pacote, profissional do multi, ou a avulsa) com a configuração efetiva. */
export function linhas() {
  const r = estado();
  const base = { servico: r.servico, endereco: 'principal', duracaoHoras: r.duracaoHoras };
  const hora = (d) => (r.manterHorario === false && r.horarios[d]) || r.horario;
  if (r.modalidade === 'pacote') {
    return datasDoPedido().map((d, i) => {
      const x = r.itens[d] || {};
      return { chave: d, rotulo: `Diária ${i + 1}`, data: d, servico: x.servico || base.servico, endereco: x.endereco || base.endereco,
        duracaoHoras: x.duracaoHoras || base.duracaoHoras, horaInicio: x.horaInicio || hora(d) };
    });
  }
  if (r.modalidade === 'multi_profissional') {
    const d = r.datas[0] || '';
    const n = Math.max(2, Number(r.qtdProfissionais) || 2);
    return Array.from({ length: n }, (_, i) => {
      const x = r.itens[`p${i}`] || {};
      const individual = r.manterHorario === false && i > 0;
      return { chave: `p${i}`, rotulo: `Profissional ${i + 1}`, data: d, servico: x.servico || base.servico, endereco: x.endereco || base.endereco,
        duracaoHoras: x.duracaoHoras || base.duracaoHoras, horaInicio: (individual ? x.horaInicio : null) || x.horaFixa || r.horario };
    });
  }
  return [{ chave: 'unica', rotulo: 'Diária', data: r.datas[0] || '', ...base, horaInicio: r.horario }];
}

/** Endereço do atendimento a partir da referência. Devolve {ref, endereco (campos), novo?: {..., uso, apelido}}. */
export function resolverEndereco(ref, ctx) {
  const r = estado();
  if (ref === 'principal') {
    if (r.endereco.modo === 'salvo') { const e = (ctx.enderecos || []).find((x) => x.id === r.endereco.id); return e ? { ref: `salvo:${e.id}`, endereco: e } : null; }
    return { ref: 'novo:0', endereco: r.endereco.novo, novo: { ...r.endereco.novo, uso: r.endereco.uso, apelido: r.endereco.uso === 'salvar' ? r.endereco.apelido : '' } };
  }
  if (ref.startsWith('salvo:')) { const e = (ctx.enderecos || []).find((x) => `salvo:${x.id}` === ref); return e ? { ref, endereco: e } : null; }
  if (ref.startsWith('extra:')) {
    const k = Number(ref.slice(6)); const e = r.enderecosExtras[k];
    return e ? { ref: `novo:${k + 1}`, endereco: e, novo: { ...e } } : null;
  }
  return null;
}

/**
 * Pedido completo pro servidor: {pedido:{segmento, modalidade, frequencia, atendimentos, cupom}, enderecosNovos:{'novo:0':{...}}}.
 * atendimento.endereco vai com a referência (o servidor troca pelo endereço de verdade) e os campos pra cotação.
 */
export function montarPedido(ctx) {
  const r = estado();
  const novos = {};
  const car = caracteristicasParaEnvio(r.servico, r.caracteristicas);
  const atendimentos = linhas().map((l, i) => {
    const e = resolverEndereco(l.endereco, ctx);
    if (e?.novo) novos[e.ref] = e.novo;
    const a = {
      servico: l.servico, duracaoHoras: Number(l.duracaoHoras), data: l.data, horaInicio: l.horaInicio,
      endereco: e ? { ref: e.ref, cep: e.endereco.cep || '', cidade: e.endereco.cidade, uf: e.endereco.uf } : null,
      localRefeicao: r.localRefeicao,
    };
    if (i === 0 || l.servico === r.servico) a.caracteristicas = car;
    if (i === 0 || l.servico === r.servico) {
      if (r.cienteMenor) a.cienteDuracaoMenor = true;
      if (r.justificativa.trim()) a.justificativa = r.justificativa.trim();
    }
    return a;
  });
  const pedido = { segmento: r.segmento, modalidade: r.modalidade, atendimentos };
  if (r.modalidade === 'pacote') pedido.frequencia = r.frequencia || 'datas';
  if (r.cupomAplicado) pedido.cupom = r.cupomAplicado;
  return { pedido, enderecosNovos: novos };
}
