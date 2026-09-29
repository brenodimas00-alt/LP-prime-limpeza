// Horário exato de cada diária (agendamento v2): hora de início + duração. Funções puras.
// Diárias antigas só têm turno (manha/tarde/integral): o backfill do banco (e estes helpers, pro que ainda não passou por
// ele) leem manhã 08:00, tarde 13:00, integral 08:00, com a duração da carga contratada. Código novo não usa turno.

const INICIO_DO_TURNO = { manha: '08:00', tarde: '13:00', integral: '08:00' };
const RE_HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const horaValida = (h) => RE_HORA.test(h || '');

/** 'HH:MM' -> minutos desde 00:00 */
export function paraMinutos(h) {
  const m = RE_HORA.exec(h || '');
  if (!m) throw new RangeError(`hora inválida: ${h}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** minutos desde 00:00 -> 'HH:MM' */
export function deMinutos(n) {
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}

/** Hora de início de uma diária (a gravada; na falta, a do turno antigo). */
export function horaInicioDe(a) {
  return a?.horaInicio || INICIO_DO_TURNO[a?.turno] || null;
}

/** Duração em minutos (a gravada; na falta, a carga do pacote; diária antiga integral sem pacote: 8h). */
export function duracaoDe(a, pacote) {
  if (a?.duracaoMinutos) return a.duracaoMinutos;
  if (pacote?.duracaoHoras) return (Number(pacote.duracaoHoras) + (Number(pacote.horasExtras) || 0)) * 60; // antiga: horas extras somavam
  return a?.turno === 'integral' ? 480 : 240;
}

/** [início, fim) em minutos do dia. */
export function intervaloDe(a, pacote) {
  const ini = paraMinutos(horaInicioDe(a));
  return [ini, ini + duracaoDe(a, pacote)];
}

/** Duas diárias no mesmo dia se sobrepõem se os intervalos [início, fim) se cruzam. */
export function sobrepoe(a, pa, b, pb) {
  if (a.data !== b.data) return false;
  const [i1, f1] = intervaloDe(a, pa);
  const [i2, f2] = intervaloDe(b, pb);
  return i1 < f2 && i2 < f1;
}

/** "08:30 às 12:30" */
export function rotuloHorario(a, pacote) {
  const ini = horaInicioDe(a);
  if (!ini) return '';
  return `${ini} às ${deMinutos(paraMinutos(ini) + duracaoDe(a, pacote))}`;
}

/**
 * Horários de início oferecidos pra uma duração: de primeiroInicio até (fimExpediente − duração), de intervaloMinutos
 * em intervaloMinutos. horariosDeInicio(2, {primeiroInicio:'08:00', fimExpediente:'18:30', intervaloMinutos:30})
 * -> ['08:00', '08:30', ..., '16:30'].
 */
export function horariosDeInicio(duracaoHoras, ht) {
  const ini = paraMinutos(ht.primeiroInicio);
  const ultimo = paraMinutos(ht.fimExpediente) - Number(duracaoHoras) * 60;
  const passo = Number(ht.intervaloMinutos);
  if (!(passo > 0)) throw new RangeError('intervaloMinutos inválido');
  const out = [];
  for (let m = ini; m <= ultimo; m += passo) out.push(deMinutos(m));
  return out;
}
