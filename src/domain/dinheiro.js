// Regras de dinheiro. Tudo em centavos inteiros. Funções puras.

/** Garante inteiro não negativo. */
export function centavosValidos(v) {
  return Number.isSafeInteger(v) && v >= 0;
}

function exigirCentavos(v, nome = 'valor') {
  if (!centavosValidos(v)) throw new TypeError(`${nome} precisa ser inteiro em centavos (recebido ${v})`);
}

/** Entrada = 50% arredondando pra baixo; restante leva o centavo ímpar. */
export function dividirEntrada(totalCentavos) {
  exigirCentavos(totalCentavos, 'total');
  const entradaCentavos = Math.floor(totalCentavos / 2);
  return { entradaCentavos, restanteCentavos: totalCentavos - entradaCentavos };
}

/**
 * Divide o restante em parcelas. 'por_atendimento': partes iguais, sobra na última.
 * 'no_primeiro': uma parcela só, no primeiro atendimento. Retorna array de centavos por atendimento (0 = sem parcela).
 */
export function parcelarRestante(restanteCentavos, quantidadeAtendimentos, modo = 'por_atendimento') {
  exigirCentavos(restanteCentavos, 'restante');
  if (!Number.isInteger(quantidadeAtendimentos) || quantidadeAtendimentos < 1) throw new RangeError('quantidade de atendimentos inválida');
  if (modo === 'no_primeiro') return [restanteCentavos, ...Array(quantidadeAtendimentos - 1).fill(0)];
  if (modo !== 'por_atendimento') throw new RangeError(`cobrancaRestante desconhecida: ${modo}`);
  const base = Math.floor(restanteCentavos / quantidadeAtendimentos);
  const partes = Array(quantidadeAtendimentos).fill(base);
  partes[quantidadeAtendimentos - 1] += restanteCentavos - base * quantidadeAtendimentos;
  return partes;
}

/** Aplica percentual inteiro com arredondamento pro centavo mais próximo (meio pra cima). */
export function aplicarPercentual(centavos, percentual) {
  exigirCentavos(centavos);
  return Math.round((centavos * percentual) / 100);
}

/** 10001 -> "R$ 100,01" (sem depender de Intl pra ser estável em qualquer ambiente). */
export function formatarBRL(centavos) {
  if (!Number.isSafeInteger(centavos)) return '';
  const neg = centavos < 0;
  const abs = Math.abs(centavos);
  const reais = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const cent = String(abs % 100).padStart(2, '0');
  return `${neg ? '-' : ''}R$ ${reais},${cent}`;
}

/** Valor em "1234.56" pro BR Code. */
export function centavosParaDecimal(centavos) {
  exigirCentavos(centavos);
  return `${Math.floor(centavos / 100)}.${String(centavos % 100).padStart(2, '0')}`;
}
