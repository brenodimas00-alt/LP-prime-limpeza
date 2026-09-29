// Autoagendamento v2 (spec-agendamento-v2.txt + decisões de 28/09/2026). Funções puras, espelhadas no banco
// (privado.estimar_duracao / privado.cotar_solicitacao, paridade em scripts/testa-paridade.mjs).
// - estimarDuracao: sugestão pela metragem e/ou pelos cômodos (menor carga que comporta os dois), por tipo de cliente.
// - cotarSolicitacao: datas (única, várias escolhidas ou recorrente), hora de início por diária, valor por diária
//   (duração + tipo + deslocamento + sem local de almoço + sábado/feriado), desconto por mês e cobranças previstas.
// A solicitação continua sendo solicitação: nada aqui confirma disponibilidade.
import { ErroNegocio } from './modelo.js';
import { gerarOcorrencias, dataValida, diferencaDias, diaDaSemana, NOMES_DIA, regiaoDoEndereco } from './calendario.js';
import { calcularDescontosMensais, calcularCobrancas, ehSabadoOuFeriado, recomendarPassadoria } from './pacote.js';
import { horariosDeInicio } from './horario.js';

export const MODOS_AGENDA = ['unica', 'datas_escolhidas', 'recorrente'];
const FREQS_RECORRENTE = ['semanal', 'quinzenal', 'mensal'];
const inteiro = (v) => Number.isInteger(v);
const temValor = (v) => v !== undefined && v !== null && v !== '';

export function totalComodos(comodos, cfg) {
  if (!comodos || typeof comodos !== 'object') return 0;
  return cfg.PRECOS.comodos.tipos.reduce((s, k) => s + (inteiro(comodos[k]) ? comodos[k] : 0), 0);
}

/**
 * Sugestão de duração. entrada: {tipoCliente, metragem?, comodos?}. A menor carga cujo limite comporta a metragem
 * (se informada) E o total de cômodos (se houver algum).
 * @returns {{horas:number|null, motivo:'ok'|'sem_dados'|'acima', totalComodos:number}}
 */
export function estimarDuracao({ tipoCliente, metragem, comodos } = {}, cfg) {
  const tabela = cfg.PRECOS.limitesDuracao[tipoCliente === 'empresa' ? 'empresa' : 'residencial'];
  const total = totalComodos(comodos, cfg);
  const m = temValor(metragem) ? Number(metragem) : null;
  if (m === null && total === 0) return { horas: null, motivo: 'sem_dados', totalComodos: 0 };
  const f = tabela.find((x) => (m === null || m <= x.metragem) && (total === 0 || total <= x.comodos));
  return f ? { horas: f.horas, motivo: 'ok', totalComodos: total } : { horas: null, motivo: 'acima', totalComodos: total };
}

/** Regras de calendário do v2: dias atendidos (horariosTrabalho.dias) somam aos bloqueados. */
export function regrasAgenda(cfg) {
  const dias = cfg.horariosTrabalho?.dias || [1, 2, 3, 4, 5, 6];
  const fora = [0, 1, 2, 3, 4, 5, 6].filter((d) => !dias.includes(d));
  return {
    diasBloqueados: [...new Set([...(cfg.diasBloqueados || []), ...fora])],
    datasBloqueadas: cfg.datasBloqueadas || [],
    antecedenciaMinimaDias: cfg.regrasCalendario?.antecedenciaMinimaDias ?? 1,
    horizonteMaximoDias: cfg.regrasCalendario?.horizonteMaximoDias ?? 120,
    buscaDeslocamentoMaxDias: cfg.regrasCalendario?.buscaDeslocamentoMaxDias ?? 7,
  };
}

/** Motivo pelo qual a data não pode ser escolhida (ou null). Mesmo critério do calendário do front e do servidor. */
export function motivoDataIndisponivel(data, hoje, cfg) {
  if (!dataValida(data)) return 'data inválida';
  const r = regrasAgenda(cfg);
  const dif = diferencaDias(hoje, data);
  if (dif < 0) return 'data no passado';
  if (dif < r.antecedenciaMinimaDias) return `antecedência mínima de ${r.antecedenciaMinimaDias} dia(s)`;
  if (dif > r.horizonteMaximoDias) return `no máximo ${r.horizonteMaximoDias} dias à frente`;
  if (r.diasBloqueados.includes(diaDaSemana(data))) return `não atendemos ${NOMES_DIA[diaDaSemana(data)]}`;
  if (r.datasBloqueadas.includes(data)) return 'a Prime não atende nesta data';
  return null;
}

/** @returns {string[]} erros legíveis; vazio = ok */
export function validarSolicitacao(sol, cfg) {
  const P = cfg.PRECOS;
  const erros = [];
  if (!sol || typeof sol !== 'object') return ['Solicitação não informada'];
  if (!['residencial', 'empresa'].includes(sol.tipoCliente)) erros.push('Escolha onde será realizada a limpeza');
  if (P.naoOferecidos[sol.tipoServico]) erros.push(P.naoOferecidos[sol.tipoServico]);
  else if (!P.tiposServico[sol.tipoServico] || !(P.servicosPorTipoCliente[sol.tipoCliente] || []).includes(sol.tipoServico)) erros.push('Escolha o serviço');
  if (!inteiro(sol.duracaoHoras) || !P.duracoes[sol.duracaoHoras]) erros.push('Escolha a duração da diária (2, 4, 6 ou 8 horas)');
  const passadoria = !!P.tiposServico[sol.tipoServico]?.exclusivo;
  if (passadoria) {
    if (temValor(sol.pecas) && (!inteiro(sol.pecas) || sol.pecas < 1 || sol.pecas > P.pecas.maximo)) erros.push(`Quantidade de peças: de 1 a ${P.pecas.maximo}`);
  } else {
    if (temValor(sol.metragem) && (!inteiro(sol.metragem) || sol.metragem < P.metragem.minimo || sol.metragem > P.metragem.maximo)) {
      erros.push(`Metragem deve ser um inteiro entre ${P.metragem.minimo} e ${P.metragem.maximo} m²`);
    }
    if (temValor(sol.comodos)) {
      if (typeof sol.comodos !== 'object' || Array.isArray(sol.comodos) || Object.keys(sol.comodos).some((k) => !P.comodos.tipos.includes(k))
          || Object.values(sol.comodos).some((v) => !inteiro(v) || v < 0 || v > P.comodos.maximoPorTipo)) erros.push('Quantidade de cômodos inválida');
    }
    const lim2 = P.limitesDuracao[sol.tipoCliente === 'empresa' ? 'empresa' : 'residencial'][0];
    if (Number(sol.duracaoHoras) === lim2.horas && erros.length === 0
        && ((temValor(sol.metragem) && sol.metragem > lim2.metragem) || totalComodos(sol.comodos, cfg) > lim2.comodos)) {
      erros.push(`A diária de ${lim2.horas} horas é só para locais até ${lim2.metragem} m² e ${lim2.comodos} cômodos`);
    }
  }
  if (sol.semLocalAlmoco !== undefined && typeof sol.semLocalAlmoco !== 'boolean') erros.push('Resposta sobre o almoço inválida');
  const a = sol.agenda;
  const max = P.quantidadeDiarias.maximo;
  if (!a || typeof a !== 'object' || !MODOS_AGENDA.includes(a.modo)) { erros.push('Escolha como deseja agendar'); return erros; }
  if (a.modo === 'unica' && (!Array.isArray(a.datas) || a.datas.length !== 1)) erros.push('Escolha a data da diária');
  if (a.modo === 'datas_escolhidas') {
    if (!Array.isArray(a.datas) || a.datas.length < 2) erros.push('Escolha pelo menos 2 datas');
    else if (a.datas.length > max) erros.push(`No máximo ${max} diárias por solicitação`);
    else if (new Set(a.datas).size !== a.datas.length) erros.push('A mesma data foi escolhida duas vezes');
  }
  if (a.modo === 'recorrente') {
    if (!FREQS_RECORRENTE.includes(a.frequencia)) erros.push('Escolha a frequência (semanal, quinzenal ou mensal)');
    if (!inteiro(a.quantidade) || a.quantidade < 2 || a.quantidade > max) erros.push(`Quantidade de diárias: de 2 a ${max}`);
    if (!dataValida(a.primeiraData)) erros.push('Escolha a data da primeira diária');
  }
  if (a.modo !== 'recorrente' && Array.isArray(a.datas) && a.datas.some((d) => !dataValida(d))) erros.push('Data inválida');
  return erros;
}

/** Datas das diárias (sem validar calendário). @returns {{sequencia, data, original, deslocada}[]} */
export function datasDaAgenda(agenda, cfg) {
  if (agenda.modo === 'recorrente') {
    return gerarOcorrencias({ frequencia: agenda.frequencia, quantidade: agenda.quantidade, primeiraData: agenda.primeiraData }, regrasAgenda(cfg));
  }
  return [...agenda.datas].sort().map((data, i) => ({ sequencia: i + 1, data, original: data, deslocada: false }));
}

/** Hora de cada data: a individual (agenda.horarios[data]) ou a mesma pra todas (agenda.horario). */
export function horaDaData(agenda, data) {
  return (agenda.horarios && agenda.horarios[data]) || agenda.horario || null;
}

/**
 * Cotação completa (o mesmo cálculo que o servidor refaz no envio).
 * @param sol {tipoCliente, tipoServico, duracaoHoras, metragem?, comodos?, pecas?, semLocalAlmoco?, agenda:{modo, datas?, primeiraData?, frequencia?, quantidade?, horario?, horarios?}}
 * @param ctx {hoje, endereco?} endereço do atendimento: sem ele não há taxa de deslocamento (e a região não é conferida)
 * @returns {{itens, descontos, cobrancas, pacote}}
 */
export function cotarSolicitacao(sol, { hoje, endereco } = {}, cfg) {
  const erros = validarSolicitacao(sol, cfg);
  if (erros.length) throw new ErroNegocio('DADOS_INVALIDOS', erros.join('; '), erros);
  const P = cfg.PRECOS;
  const tipo = P.tiposServico[sol.tipoServico];
  const itensDia = [{ codigo: 'diaria', descricao: `Diária de ${sol.duracaoHoras} horas`, centavos: P.duracoes[sol.duracaoHoras].centavos }];
  if (tipo.centavos) itensDia.push({ codigo: `servico:${sol.tipoServico}`, descricao: tipo.nome, centavos: tipo.centavos });
  if (sol.semLocalAlmoco) itensDia.push({ codigo: 'sem_local_almoco', descricao: 'Sem local para guardar e esquentar a refeição', centavos: P.taxaSemLocalAlmocoCentavos });
  let taxaDeslocamentoCentavos = 0;
  if (endereco) {
    const r = regiaoDoEndereco(endereco, cfg.regioesAtendidas);
    if (!r) throw new ErroNegocio('REGIAO_NAO_ATENDIDA', `Ainda não atendemos ${endereco.cidade || 'essa cidade'}`);
    if (r.sobConsulta) throw new ErroNegocio('REGIAO_SOB_CONSULTA', `${r.cidade}: atendimento sob consulta. Fale com a Prime pelo WhatsApp.`);
    taxaDeslocamentoCentavos = r.taxaCentavos || 0;
    if (taxaDeslocamentoCentavos) itensDia.push({ codigo: 'deslocamento', descricao: `Taxa de deslocamento (${r.cidade})`, centavos: taxaDeslocamentoCentavos });
  }
  const valorDiaBaseCentavos = itensDia.reduce((s, i) => s + i.centavos, 0);
  const datas = datasDaAgenda(sol.agenda, cfg);
  const opcoes = horariosDeInicio(sol.duracaoHoras, cfg.horariosTrabalho);
  const problemas = [];
  for (const o of datas) {
    const motivo = motivoDataIndisponivel(o.data, hoje, cfg);
    if (motivo) problemas.push({ sequencia: o.sequencia, data: o.data, motivo });
    const h = horaDaData(sol.agenda, o.data);
    if (!h) problemas.push({ sequencia: o.sequencia, data: o.data, motivo: 'escolha o horário' });
    else if (!opcoes.includes(h)) problemas.push({ sequencia: o.sequencia, data: o.data, motivo: `horário ${h} fora do horário de trabalho para ${sol.duracaoHoras} horas` });
  }
  if (problemas.length) {
    throw new ErroNegocio('DATA_INVALIDA', problemas.map((p) => `Diária ${p.sequencia} (${p.data}): ${p.motivo}`).join('; '), problemas);
  }
  const itens = datas.map((o) => {
    const taxaDiaCentavos = ehSabadoOuFeriado(o.data, cfg) ? P.taxaSabadoFeriadoCentavos : 0;
    return { ...o, horaInicio: horaDaData(sol.agenda, o.data), duracaoMinutos: sol.duracaoHoras * 60, taxaDiaCentavos, valorDiaCentavos: valorDiaBaseCentavos + taxaDiaCentavos };
  });
  const descontos = calcularDescontosMensais(itens.map((i) => i.data), cfg);
  const descontoMensalCentavos = descontos.reduce((s, d) => s + d.centavos, 0);
  const totalCentavos = itens.reduce((s, i) => s + i.valorDiaCentavos, 0) - descontoMensalCentavos;
  const modoPagamento = cfg.pagamento?.pacoteDeUmaVez ? 'pacote' : 'por_diaria';
  const passadoria = !!tipo.exclusivo;
  const est = passadoria ? null : estimarDuracao(sol, cfg);
  const pacote = {
    versao: 2, tipoCliente: sol.tipoCliente, tipoServico: sol.tipoServico, duracaoHoras: sol.duracaoHoras, horasExtras: 0,
    ...(passadoria ? (temValor(sol.pecas) ? { pecas: sol.pecas } : {}) : {
      ...(temValor(sol.metragem) ? { metragem: sol.metragem } : {}),
      ...(totalComodos(sol.comodos, cfg) > 0 ? { comodos: Object.fromEntries(P.comodos.tipos.filter((k) => sol.comodos[k] > 0).map((k) => [k, sol.comodos[k]])) } : {}),
    }),
    passadoriaCombinada: false, semLocalAlmoco: !!sol.semLocalAlmoco,
    modoAgenda: sol.agenda.modo, frequencia: sol.agenda.modo === 'recorrente' ? sol.agenda.frequencia : 'avulso', quantidadeDiarias: itens.length,
    itensDia, valorDiaBaseCentavos, taxaDeslocamentoCentavos,
    recomendacaoHoras: passadoria ? (temValor(sol.pecas) ? recomendarPassadoria(sol.pecas, cfg) : null) : est.horas,
    modoPagamento, totalCentavos, descontoMensalCentavos,
  };
  return { itens, descontos, cobrancas: calcularCobrancas(itens, modoPagamento, cfg), pacote };
}
