// Cálculo do pacote (tabela oficial da Prime: diária por DURAÇÃO) e geração dos atendimentos. Funções puras.
// calcularPacote: preço-base de uma diária (sem depender de data). gerarAtendimentos: datas, taxa de sábado/feriado,
// desconto mensal e totais (total, entrada, restante, parcelas).
import { ErroNegocio } from './modelo.js';
import { dividirEntrada, parcelarRestante } from './dinheiro.js';
import { gerarOcorrencias, validarOcorrencias, regiaoDoEndereco, diaDaSemana, diaUtilAnterior } from './calendario.js';

const FREQS = ['avulso', 'semanal', 'quinzenal', 'mensal'];
const temValor = (v) => v !== undefined && v !== null && v !== '';

/** Duração recomendada pela metragem (null acima do limite: "considere mais de uma profissional"). */
export function recomendarDuracao(metragem, cfg) {
  const f = cfg.PRECOS.recomendacaoPorMetragem.find((x) => metragem <= x.ate);
  return f ? f.horas : null;
}

/** Duração recomendada pra passadoria exclusiva, pelo volume de peças (acima da tabela: 8h ou mais). */
export function recomendarPassadoria(pecas, cfg) {
  const f = cfg.PRECOS.recomendacaoPassadoria.find((x) => pecas <= x.ate);
  return f ? f.horas : 8;
}

/** @returns {string[]} erros legíveis; vazio = ok */
export function validarEspecificacao(esp, cfg) {
  const P = cfg.PRECOS;
  const erros = [];
  if (!esp || typeof esp !== 'object') return ['Pacote não informado'];
  if (!['residencial', 'empresa'].includes(esp.tipoCliente)) erros.push('Tipo de cliente inválido');
  if (P.naoOferecidos[esp.tipoServico]) erros.push(P.naoOferecidos[esp.tipoServico]);
  else if (!P.tiposServico[esp.tipoServico]) erros.push('Tipo de serviço inválido');
  const tipo = P.tiposServico[esp.tipoServico];
  const dur = P.duracoes[esp.duracaoHoras];
  if (!dur) erros.push('Escolha a duração da diária (2, 4, 6 ou 8 horas)');
  const passadoriaExclusiva = !!tipo?.exclusivo;
  if (passadoriaExclusiva) {
    if (temValor(esp.pecas) && (!Number.isInteger(esp.pecas) || esp.pecas < 1 || esp.pecas > 500)) erros.push('Quantidade de peças inválida');
    if (esp.passadoriaCombinada) erros.push('Passadoria exclusiva não combina com adicional de passadoria');
  } else {
    if (!temValor(esp.metragem)) erros.push('Informe a metragem aproximada');
    else if (!Number.isInteger(esp.metragem) || esp.metragem < P.metragem.minimo || esp.metragem > P.metragem.maximo) {
      erros.push(`Metragem deve ser um inteiro entre ${P.metragem.minimo} e ${P.metragem.maximo} m²`);
    } else if (dur?.metragemMaxima && esp.metragem > dur.metragemMaxima) {
      erros.push(`A diária de ${esp.duracaoHoras} horas é só para locais até ${dur.metragemMaxima} m²`);
    }
  }
  const hx = esp.horasExtras ?? 0;
  if (!Number.isInteger(hx) || hx < 0 || hx > P.horasExtrasMaximo) erros.push(`Horas extras: de 0 a ${P.horasExtrasMaximo}`);
  if (esp.passadoriaCombinada !== undefined && typeof esp.passadoriaCombinada !== 'boolean') erros.push('passadoriaCombinada inválido');
  if (esp.semLocalAlmoco !== undefined && typeof esp.semLocalAlmoco !== 'boolean') erros.push('semLocalAlmoco inválido');
  if (!FREQS.includes(esp.frequencia)) erros.push('Frequência inválida');
  const q = esp.quantidadeDiarias;
  if (!Number.isInteger(q) || q < P.quantidadeDiarias.minimo || q > P.quantidadeDiarias.maximo) {
    erros.push(`Quantidade de diárias deve ser entre ${P.quantidadeDiarias.minimo} e ${P.quantidadeDiarias.maximo}`);
  }
  if (esp.frequencia === 'avulso' && q !== 1) erros.push('Avulso é sempre 1 diária');
  if (esp.frequencia !== 'avulso' && Number.isInteger(q) && q < 2) erros.push('Com frequência, escolha 2 ou mais diárias (ou mude pra avulso)');
  if (esp.tipoCliente === 'empresa' && esp.frequencia === 'avulso') erros.push('Para empresa a frequência é obrigatória');
  return erros;
}

/**
 * Preço-base de UMA diária (sem taxa de sábado/feriado e sem desconto mensal, que dependem das datas).
 * @param {{tipoCliente, tipoServico, duracaoHoras, horasExtras?, metragem?, pecas?, passadoriaCombinada?, semLocalAlmoco?, quantidadeDiarias, frequencia, endereco?}} esp
 */
export function calcularPacote(esp, cfg) {
  const erros = validarEspecificacao(esp, cfg);
  if (erros.length) throw new ErroNegocio('DADOS_INVALIDOS', erros.join('; '), erros);
  const P = cfg.PRECOS;
  const tipo = P.tiposServico[esp.tipoServico];
  const itensDia = [{ codigo: 'diaria', descricao: `Diária de ${esp.duracaoHoras} horas`, centavos: P.duracoes[esp.duracaoHoras].centavos }];
  const hx = esp.horasExtras || 0;
  if (hx) itensDia.push({ codigo: 'hora_extra', descricao: `${hx} hora(s) extra(s)`, centavos: hx * P.horaExtraCentavos });
  if (tipo.centavos) itensDia.push({ codigo: `servico:${esp.tipoServico}`, descricao: tipo.nome, centavos: tipo.centavos });
  if (esp.passadoriaCombinada) itensDia.push({ codigo: 'passadoria_combinada', descricao: 'Passadoria combinada (pouca demanda)', centavos: P.passadoriaCombinada.centavos });
  if (esp.semLocalAlmoco) itensDia.push({ codigo: 'sem_local_almoco', descricao: 'Sem local para esquentar o almoço', centavos: P.taxaSemLocalAlmocoCentavos });
  let taxaDeslocamentoCentavos = 0;
  if (esp.endereco) {
    const r = regiaoDoEndereco(esp.endereco, cfg.regioesAtendidas);
    if (!r) throw new ErroNegocio('REGIAO_NAO_ATENDIDA', `Ainda não atendemos ${esp.endereco.cidade || 'essa cidade'}`);
    if (r.sobConsulta) throw new ErroNegocio('REGIAO_SOB_CONSULTA', `${r.cidade}: atendimento sob consulta. Fale com a Prime pelo WhatsApp.`);
    taxaDeslocamentoCentavos = r.taxaCentavos || 0;
    if (taxaDeslocamentoCentavos) itensDia.push({ codigo: 'deslocamento', descricao: `Taxa de deslocamento (${r.cidade})`, centavos: taxaDeslocamentoCentavos });
  }
  const valorDiaBaseCentavos = itensDia.reduce((s, i) => s + i.centavos, 0);
  const recomendacao = tipo.exclusivo
    ? (temValor(esp.pecas) ? recomendarPassadoria(esp.pecas, cfg) : null)
    : recomendarDuracao(esp.metragem, cfg);
  return {
    tipoServico: esp.tipoServico,
    duracaoHoras: esp.duracaoHoras,
    horasExtras: hx,
    ...(tipo.exclusivo ? (temValor(esp.pecas) ? { pecas: esp.pecas } : {}) : { metragem: esp.metragem }),
    passadoriaCombinada: !!esp.passadoriaCombinada,
    semLocalAlmoco: !!esp.semLocalAlmoco,
    quantidadeDiarias: esp.quantidadeDiarias,
    frequencia: esp.frequencia,
    itensDia,
    valorDiaBaseCentavos,
    taxaDeslocamentoCentavos,
    recomendacaoHoras: recomendacao,
    cobrancaRestante: cfg.cobrancaRestante,
    prazoRestante: cfg.prazoRestante || 'no_dia',
    // preenchidos por gerarAtendimentos:
    totalCentavos: 0, entradaCentavos: 0, restanteCentavos: 0, descontoMensalCentavos: 0,
  };
}

/** Desconto mensal: conta as diárias por mês de calendário. @returns {{mes:string, diarias:number, centavos:number}[]} */
export function calcularDescontosMensais(datas, cfg) {
  const porMes = {};
  for (const d of datas) { const m = d.slice(0, 7); porMes[m] = (porMes[m] || 0) + 1; }
  const faixas = [...cfg.PRECOS.descontoMensal].sort((a, b) => b.minimoDiarias - a.minimoDiarias);
  return Object.entries(porMes).sort().map(([mes, diarias]) => {
    const f = faixas.find((x) => diarias >= x.minimoDiarias);
    return f ? { mes, diarias, centavos: f.centavos } : null;
  }).filter(Boolean);
}

export function ehSabadoOuFeriado(data, cfg) {
  return diaDaSemana(data) === 6 || (cfg.feriados || []).includes(data);
}

/**
 * Gera os atendimentos com valor do dia (base + taxa de sábado/feriado), desconto mensal e parcelas.
 * Valida TODAS as ocorrências. @returns {{itens, descontos, pacote}} com pacote já com os totais.
 */
export function gerarAtendimentos(pacote, { primeiraData, turno, hoje, endereco }, cfg) {
  if (!['manha', 'tarde', 'integral'].includes(turno)) throw new ErroNegocio('DADOS_INVALIDOS', 'Turno inválido');
  if (pacote.duracaoHoras >= 8 && turno !== 'integral') throw new ErroNegocio('DADOS_INVALIDOS', 'Diária de 8 horas é sempre integral');
  if (pacote.duracaoHoras < 8 && turno === 'integral') throw new ErroNegocio('DADOS_INVALIDOS', 'Escolha manhã ou tarde pra diárias de até 6 horas');
  const regras = { diasBloqueados: cfg.diasBloqueados, datasBloqueadas: cfg.datasBloqueadas, ...cfg.regrasCalendario };
  const ocorrencias = gerarOcorrencias({ frequencia: pacote.frequencia, quantidade: pacote.quantidadeDiarias, primeiraData }, regras);
  const regiao = endereco ? regiaoDoEndereco(endereco, cfg.regioesAtendidas) : null;
  const regiaoAtendida = endereco ? !!regiao && !regiao.sobConsulta : true;
  const problemas = validarOcorrencias(ocorrencias, { hoje, regiaoAtendida, ...regras });
  if (problemas.length) {
    const codigo = problemas.some((p) => p.motivo === 'região não atendida') ? (regiao?.sobConsulta ? 'REGIAO_SOB_CONSULTA' : 'REGIAO_NAO_ATENDIDA') : 'DATA_INVALIDA';
    throw new ErroNegocio(codigo, problemas.map((p) => `Diária ${p.sequencia} (${p.data}): ${p.motivo}`).join('; '), problemas);
  }
  const itens = ocorrencias.map((o) => {
    const taxaDiaCentavos = ehSabadoOuFeriado(o.data, cfg) ? cfg.PRECOS.taxaSabadoFeriadoCentavos : 0;
    return { ...o, turno, taxaDiaCentavos, valorDiaCentavos: pacote.valorDiaBaseCentavos + taxaDiaCentavos };
  });
  const descontos = calcularDescontosMensais(itens.map((i) => i.data), cfg);
  const descontoMensalCentavos = descontos.reduce((s, d) => s + d.centavos, 0);
  const totalCentavos = itens.reduce((s, i) => s + i.valorDiaCentavos, 0) - descontoMensalCentavos;
  const { entradaCentavos, restanteCentavos } = dividirEntrada(totalCentavos);
  const parcelas = parcelarRestante(restanteCentavos, itens.length, pacote.cobrancaRestante);
  itens.forEach((it, i) => {
    it.parcelaCentavos = parcelas[i];
    it.venceEm = pacote.prazoRestante === 'dia_util_anterior_14h' ? diaUtilAnterior(it.data, cfg.feriados || []) : it.data;
    if (pacote.prazoRestante === 'dia_util_anterior_14h') it.venceAs = '14:00';
  });
  return { itens, descontos, pacote: { ...pacote, totalCentavos, entradaCentavos, restanteCentavos, descontoMensalCentavos } };
}
