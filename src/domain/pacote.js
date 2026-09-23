// Cálculo do pacote e geração dos atendimentos. Funções puras: recebem a tabela de preços como parâmetro.
import { ErroNegocio } from './modelo.js';
import { dividirEntrada, parcelarRestante, aplicarPercentual } from './dinheiro.js';
import { gerarOcorrencias, validarOcorrencias, regiaoDoEndereco } from './calendario.js';

const FREQS = ['avulso', 'semanal', 'quinzenal', 'mensal'];

/**
 * Normaliza e valida a especificação do pacote vinda da UI (ou do corpo HTTP).
 * @returns {string[]} erros legíveis; vazio = ok
 */
export function validarEspecificacao(esp, cfg) {
  const P = cfg.PRECOS;
  const erros = [];
  if (!esp || typeof esp !== 'object') return ['Pacote não informado'];
  if (!['residencial', 'empresa'].includes(esp.tipoCliente)) erros.push('Tipo de cliente inválido');
  if (!P.tiposLimpeza[esp.tipoLimpeza]) erros.push('Tipo de limpeza inválido');
  const temMetragem = esp.metragem !== undefined && esp.metragem !== null && esp.metragem !== '';
  const temComodos = esp.comodos !== undefined && esp.comodos !== null && esp.comodos !== '';
  if (temMetragem === temComodos) erros.push('Informe a metragem OU a quantidade de cômodos');
  if (temMetragem && (!Number.isInteger(esp.metragem) || esp.metragem < P.metragem.minimo || esp.metragem > P.metragem.maximo)) {
    erros.push(`Metragem deve ser um inteiro entre ${P.metragem.minimo} e ${P.metragem.maximo} m²`);
  }
  if (temComodos && (!Number.isInteger(esp.comodos) || esp.comodos < P.comodos.minimo || esp.comodos > P.comodos.maximo)) {
    erros.push(`Cômodos deve ser um inteiro entre ${P.comodos.minimo} e ${P.comodos.maximo}`);
  }
  if (!FREQS.includes(esp.frequencia)) erros.push('Frequência inválida');
  const q = esp.quantidadeDiarias;
  if (!Number.isInteger(q) || q < P.quantidadeDiarias.minimo || q > P.quantidadeDiarias.maximo) {
    erros.push(`Quantidade de diárias deve ser entre ${P.quantidadeDiarias.minimo} e ${P.quantidadeDiarias.maximo}`);
  }
  if (esp.frequencia === 'avulso' && q !== 1) erros.push('Avulso é sempre 1 diária');
  if (esp.frequencia !== 'avulso' && Number.isInteger(q) && q < 2) erros.push('Com frequência, escolha 2 ou mais diárias (ou mude pra avulso)');
  if (esp.tipoCliente === 'empresa' && esp.frequencia === 'avulso') erros.push('Para empresa a frequência é obrigatória');
  const ad = esp.adicionais || [];
  if (!Array.isArray(ad) || ad.some((a) => !P.adicionais[a])) erros.push('Adicional inválido');
  if (Array.isArray(ad) && new Set(ad).size !== ad.length) erros.push('Adicional repetido');
  return erros;
}

/**
 * Calcula o pacote com preço discriminado.
 * @param {{tipoCliente, tipoLimpeza, metragem?, comodos?, quantidadeDiarias, frequencia, adicionais?, endereco?}} esp
 * @param {object} cfg CONFIG_PRECOS
 * @returns {import('./modelo.js').Pacote & {itens:object[], valorDiaCentavos:number, taxaDeslocamentoCentavos:number}}
 */
export function calcularPacote(esp, cfg) {
  const erros = validarEspecificacao(esp, cfg);
  if (erros.length) throw new ErroNegocio('DADOS_INVALIDOS', erros.join('; '), erros);
  const P = cfg.PRECOS;
  const itens = [];
  let base;
  if (esp.metragem) {
    const faixa = P.faixasMetragem.find((f) => esp.metragem <= f.ate);
    base = faixa.centavos;
    itens.push({ codigo: 'base', descricao: `Diária até ${faixa.ate} m²`, centavos: base });
  } else {
    base = P.comodos.baseCentavos + P.comodos.porComodoCentavos * esp.comodos;
    itens.push({ codigo: 'base', descricao: `Diária com ${esp.comodos} cômodo(s)`, centavos: base });
  }
  const tipo = P.tiposLimpeza[esp.tipoLimpeza];
  const ajusteTipo = aplicarPercentual(base, tipo.percentual) - base;
  if (ajusteTipo) itens.push({ codigo: 'tipo', descricao: tipo.nome, centavos: ajusteTipo });
  const baseComTipo = base + ajusteTipo;
  if (esp.tipoCliente === 'empresa') {
    itens.push({ codigo: 'empresa', descricao: `Acréscimo empresa (${P.acrescimoEmpresaPercentual}%)`, centavos: aplicarPercentual(baseComTipo, P.acrescimoEmpresaPercentual) });
  }
  for (const a of esp.adicionais || []) itens.push({ codigo: `adicional:${a}`, descricao: P.adicionais[a].nome, centavos: P.adicionais[a].centavos });
  const subtotal = itens.reduce((s, i) => s + i.centavos, 0);
  const desc = P.descontoFrequenciaPercentual[esp.frequencia] || 0;
  if (desc) itens.push({ codigo: 'desconto', descricao: `Desconto ${esp.frequencia} (${desc}%)`, centavos: -aplicarPercentual(subtotal, desc) });
  let taxaDeslocamentoCentavos = 0;
  if (esp.endereco) {
    const r = regiaoDoEndereco(esp.endereco, cfg.regioesAtendidas);
    if (!r) throw new ErroNegocio('REGIAO_NAO_ATENDIDA', `Ainda não atendemos ${esp.endereco.cidade || 'essa cidade'}`);
    taxaDeslocamentoCentavos = r.taxaCentavos;
    if (r.taxaCentavos) itens.push({ codigo: 'deslocamento', descricao: `Taxa de deslocamento (${r.cidade})`, centavos: r.taxaCentavos });
  }
  const valorDiaCentavos = itens.reduce((s, i) => s + i.centavos, 0);
  const totalCentavos = valorDiaCentavos * esp.quantidadeDiarias;
  const { entradaCentavos, restanteCentavos } = dividirEntrada(totalCentavos);
  return {
    tipoLimpeza: esp.tipoLimpeza,
    ...(esp.metragem ? { metragem: esp.metragem } : { comodos: esp.comodos }),
    quantidadeDiarias: esp.quantidadeDiarias,
    frequencia: esp.frequencia,
    adicionais: [...(esp.adicionais || [])],
    itens,
    valorDiaCentavos,
    taxaDeslocamentoCentavos,
    totalCentavos,
    entradaCentavos,
    restanteCentavos,
    cobrancaRestante: cfg.cobrancaRestante,
  };
}

/**
 * Gera os atendimentos (sem id) e as parcelas do restante com vencimento na data do atendimento.
 * Valida TODAS as ocorrências.
 * @returns {{sequencia, data, original, deslocada, turno, valorDiaCentavos, parcelaCentavos}[]}
 */
export function gerarAtendimentos(pacote, { primeiraData, turno, hoje, endereco }, cfg) {
  if (!['manha', 'tarde', 'integral'].includes(turno)) throw new ErroNegocio('DADOS_INVALIDOS', 'Turno inválido');
  const regras = { diasBloqueados: cfg.diasBloqueados, datasBloqueadas: cfg.datasBloqueadas, ...cfg.regrasCalendario };
  const ocorrencias = gerarOcorrencias({ frequencia: pacote.frequencia, quantidade: pacote.quantidadeDiarias, primeiraData }, regras);
  const regiaoAtendida = endereco ? !!regiaoDoEndereco(endereco, cfg.regioesAtendidas) : true;
  const problemas = validarOcorrencias(ocorrencias, { hoje, regiaoAtendida, ...regras });
  if (problemas.length) {
    const codigo = problemas.some((p) => p.motivo === 'região não atendida') ? 'REGIAO_NAO_ATENDIDA' : 'DATA_INVALIDA';
    throw new ErroNegocio(codigo, problemas.map((p) => `Diária ${p.sequencia} (${p.data}): ${p.motivo}`).join('; '), problemas);
  }
  const parcelas = parcelarRestante(pacote.restanteCentavos, ocorrencias.length, pacote.cobrancaRestante);
  return ocorrencias.map((o, i) => ({ ...o, turno, valorDiaCentavos: pacote.valorDiaCentavos, parcelaCentavos: parcelas[i] }));
}
