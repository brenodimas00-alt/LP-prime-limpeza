// Calendário de ocorrências e helpers de data/fuso. Funções puras.
// Datas de calendário são strings 'AAAA-MM-DD' e toda a aritmética é feita em UTC (sem horário de verão no meio).
import { ErroNegocio } from './modelo.js';

const RE_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;
export const NOMES_DIA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export function dataValida(s) {
  const m = RE_DATA.exec(s || '');
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

function partes(s) {
  if (!dataValida(s)) throw new ErroNegocio('DATA_INVALIDA', `Data inválida: ${s}`);
  const m = RE_DATA.exec(s);
  return [+m[1], +m[2], +m[3]];
}

function formatar(y, m, d) {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function somarDias(s, n) {
  const [y, m, d] = partes(s);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return formatar(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function diaDaSemana(s) {
  const [y, m, d] = partes(s);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function ultimoDiaDoMes(ano, mes) {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

/** Diferença em dias (b - a). */
export function diferencaDias(a, b) {
  const [y1, m1, d1] = partes(a);
  const [y2, m2, d2] = partes(b);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

/** Mesmo dia do mês, `k` meses depois; se o dia não existe, usa o último dia do mês. */
export function somarMesesComClamp(s, k, diaAlvo) {
  const [y, m, d] = partes(s);
  const alvo = diaAlvo || d;
  const total = (m - 1) + k;
  const ano = y + Math.floor(total / 12);
  const mes = (total % 12) + 1;
  return formatar(ano, mes, Math.min(alvo, ultimoDiaDoMes(ano, mes)));
}

export function dataBloqueada(s, { diasBloqueados = [0], datasBloqueadas = [] } = {}) {
  return diasBloqueados.includes(diaDaSemana(s)) || datasBloqueadas.includes(s);
}

/** Próximo dia permitido a partir de `s` (inclusive). Erro se não achar dentro da busca. */
export function proximoPermitido(s, regras = {}) {
  const max = regras.buscaDeslocamentoMaxDias ?? 7;
  for (let i = 0; i <= max; i++) {
    const c = somarDias(s, i);
    if (!dataBloqueada(c, regras)) return c;
  }
  throw new ErroNegocio('DATA_INVALIDA', `Sem dia disponível em até ${max} dias após ${s}`);
}

/**
 * Gera as datas das ocorrências. A primeira data é a escolhida pela cliente (validada, não deslocada).
 * As demais seguem a frequência; se caírem em dia bloqueado, vão pro próximo permitido e ficam "deslocada".
 * @returns {{sequencia:number, data:string, original:string, deslocada:boolean}[]}
 */
export function gerarOcorrencias({ frequencia, quantidade, primeiraData }, regras = {}) {
  partes(primeiraData);
  if (!Number.isInteger(quantidade) || quantidade < 1) throw new ErroNegocio('DADOS_INVALIDOS', 'Quantidade de diárias inválida');
  if (frequencia === 'avulso' && quantidade !== 1) throw new ErroNegocio('DADOS_INVALIDOS', 'Avulso é sempre 1 diária');
  if (frequencia !== 'avulso' && !['semanal', 'quinzenal', 'mensal'].includes(frequencia)) {
    throw new ErroNegocio('DADOS_INVALIDOS', `Frequência inválida: ${frequencia}`);
  }
  const diaAlvo = partes(primeiraData)[2];
  const lista = [];
  for (let k = 0; k < quantidade; k++) {
    let original;
    if (k === 0) original = primeiraData;
    else if (frequencia === 'semanal') original = somarDias(primeiraData, 7 * k);
    else if (frequencia === 'quinzenal') original = somarDias(primeiraData, 14 * k);
    else original = somarMesesComClamp(primeiraData, k, diaAlvo);
    const data = k === 0 ? original : proximoPermitido(original, regras);
    const anterior = lista[k - 1];
    if (anterior && diferencaDias(anterior.data, data) <= 0) {
      throw new ErroNegocio('DATA_INVALIDA', `Ocorrência ${k + 1} colide com a anterior (${data})`);
    }
    lista.push({ sequencia: k + 1, data, original, deslocada: data !== original });
  }
  return lista;
}

/**
 * Valida TODAS as ocorrências: passado/antecedência, horizonte (só a primeira), bloqueio e região.
 * @returns {{sequencia:number, data:string, motivo:string}[]} lista vazia = tudo ok
 */
export function validarOcorrencias(ocorrencias, { hoje, regiaoAtendida = true, ...regras } = {}) {
  const problemas = [];
  const antecedencia = regras.antecedenciaMinimaDias ?? 1;
  const horizonte = regras.horizonteMaximoDias ?? 120;
  for (const o of ocorrencias) {
    if (!dataValida(o.data)) { problemas.push({ sequencia: o.sequencia, data: o.data, motivo: 'data inválida' }); continue; }
    const dif = diferencaDias(hoje, o.data);
    if (dif < 0) problemas.push({ sequencia: o.sequencia, data: o.data, motivo: 'data no passado' });
    else if (dif < antecedencia) problemas.push({ sequencia: o.sequencia, data: o.data, motivo: `antecedência mínima de ${antecedencia} dia(s)` });
    if (o.sequencia === 1 && dif > horizonte) problemas.push({ sequencia: 1, data: o.data, motivo: `no máximo ${horizonte} dias à frente` });
    if (dataBloqueada(o.data, regras)) problemas.push({ sequencia: o.sequencia, data: o.data, motivo: `não atendemos ${NOMES_DIA[diaDaSemana(o.data)]}` });
    if (!regiaoAtendida) problemas.push({ sequencia: o.sequencia, data: o.data, motivo: 'região não atendida' });
  }
  return problemas;
}

function semAcento(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

/** Encontra a região atendida pela cidade/UF (comparação sem acento e sem caixa). */
export function regiaoDoEndereco(endereco, regioes) {
  if (!endereco) return null;
  return regioes.find((r) => semAcento(r.cidade) === semAcento(endereco.cidade) && semAcento(r.uf) === semAcento(endereco.uf)) || null;
}

// ---------- fuso horário (Intl, determinístico pra um instante dado) ----------

function offsetMinutos(instanteMs, fuso) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: fuso, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(f.formatToParts(new Date(instanteMs)).map((x) => [x.type, x.value]));
  const comoUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((comoUTC - Math.floor(instanteMs / 1000) * 1000) / 60000);
}

/** Instante ISO (UTC) de "data às hora:min" no fuso. instanteLocal('2026-10-05', 18, 0, 'America/Sao_Paulo') -> '2026-10-05T21:00:00.000Z' */
export function instanteLocal(data, hora, minuto = 0, fuso = 'America/Sao_Paulo') {
  const [y, m, d] = partes(data);
  const ingenuo = Date.UTC(y, m - 1, d, hora, minuto);
  let t = ingenuo - offsetMinutos(ingenuo, fuso) * 60000;
  t = ingenuo - offsetMinutos(t, fuso) * 60000;
  return new Date(t).toISOString();
}

/** Data de calendário 'AAAA-MM-DD' de um instante no fuso. */
export function dataNoFuso(instanteISO, fuso = 'America/Sao_Paulo') {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' });
  return f.format(new Date(instanteISO));
}

/** "seg, 05/10" */
export function formatarDataCurta(s) {
  const [, m, d] = partes(s);
  return `${NOMES_DIA[diaDaSemana(s)].slice(0, 3)}, ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
}

/** "05/10/2026" */
export function formatarData(s) {
  const [y, m, d] = partes(s);
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

/** "05/10/2026 18:00" no fuso */
export function formatarInstante(iso, fuso = 'America/Sao_Paulo') {
  if (!iso) return '';
  const f = new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return f.format(new Date(iso)).replace(',', '');
}
