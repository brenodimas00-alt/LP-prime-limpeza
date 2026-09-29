// AUT: tempo do motor v2. PURO. Instantes em ISO UTC; toda regra de calendário em America/Sao_Paulo (cfg.fuso),
// com feriados passados por parâmetro. Nada aqui lê relógio: "agora" sempre vem de quem chama (relógio injetável).
import { instanteLocal, dataNoFuso, somarDias, diaDaSemana } from '../../domain/calendario.js';

export const INICIO_TURNO = { manha: '08:00', tarde: '13:00', integral: '08:00' };
export const FIM_TURNO = { manha: '12:00', tarde: '17:00', integral: '17:00' };
const hm = (s) => String(s).split(':').map(Number);
const mais = (iso, minutos) => new Date(Date.parse(iso) + minutos * 60000).toISOString();
export const naHora = (data, hora, fuso) => { const [h, m] = hm(hora); return instanteLocal(data, h, m, fuso); };

/** Hora local 'HH:MM' de um instante. */
export function horaNoFuso(iso, fuso) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: fuso, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return f.format(new Date(iso));
}

/** Domingo ou feriado (em que só sai mensagem do atendimento do dia). */
export const diaRestrito = (data, feriados) => diaDaSemana(data) === 0 || feriados.includes(data);
/** Próximo dia (depois de `data`) que não é domingo nem feriado. */
export function proximoDiaLivre(data, feriados) {
  let d = somarDias(data, 1);
  for (let i = 0; i < 20 && diaRestrito(d, feriados); i++) d = somarDias(d, 1);
  return d;
}

/**
 * Ajusta o instante às regras globais (AUT.2). Devolve o primeiro instante permitido a partir de `iso`.
 * - interno (equipe Prime): sem restrição;
 * - doDia (atendimento em andamento do próprio dia): sai na hora, mesmo à noite, domingo ou feriado;
 * - resto: horário silencioso [silencioInicio, silencioFim) vai pra silencioFim; domingo/feriado vai pro próximo dia
 *   livre às horaDiaUtil. Repete até cair num instante permitido.
 */
export function ajustarJanela(iso, { categoria, doDia = false }, cfg, feriados = []) {
  if (categoria === 'interno' || doDia) return iso;
  let t = iso;
  for (let i = 0; i < 30; i++) {
    const data = dataNoFuso(t, cfg.fuso);
    const hora = horaNoFuso(t, cfg.fuso);
    if (diaRestrito(data, feriados)) { t = naHora(proximoDiaLivre(data, feriados), cfg.horaDiaUtil, cfg.fuso); continue; }
    if (hora >= cfg.silencioInicio) { t = naHora(somarDias(data, 1), cfg.silencioFim, cfg.fuso); continue; }
    if (hora < cfg.silencioFim) { t = naHora(data, cfg.silencioFim, cfg.fuso); continue; }
    return t;
  }
  throw new Error('janela de envio não encontrada em 30 dias');
}

/**
 * Instantes de uma regra de AGENDA pra um candidato. Cada item: { marco, em, validaAte }.
 * `c` traz o que o tipo precisa: atendimento {data, turno}, pagamento {venceEm, venceAs}, data (dia de referência) etc.
 */
export function instantesDaAgenda(atraso, c, cfg) {
  const f = cfg.fuso;
  switch (atraso.tipo) {
    case 'vespera': {
      const inicio = naHora(c.atendimento.data, INICIO_TURNO[c.atendimento.turno], f);
      return [{ marco: `${c.atendimento.data}:${c.atendimento.turno}`, em: naHora(somarDias(c.atendimento.data, -1), atraso.hora, f), validaAte: inicio }];
    }
    case 'antes_prazo': {
      const prazo = naHora(c.pagamento.venceEm, c.pagamento.venceAs || '14:00', f);
      return atraso.minutos.map((m) => ({ marco: `${c.pagamento.venceEm}T${c.pagamento.venceAs || '14:00'}:${m}`, em: mais(prazo, -m), validaAte: prazo }));
    }
    case 'prazo_vencido': {
      const prazo = naHora(c.pagamento.venceEm, c.pagamento.venceAs || '14:00', f);
      return [{ marco: `${c.pagamento.venceEm}T${c.pagamento.venceAs || '14:00'}`, em: prazo, validaAte: mais(prazo, 24 * 60) }];
    }
    case 'apos_inicio_turno': {
      const inicio = naHora(c.atendimento.data, INICIO_TURNO[c.atendimento.turno], f);
      return [{ marco: `${c.atendimento.data}:${c.atendimento.turno}`, em: mais(inicio, atraso.minutos), validaAte: naHora(c.atendimento.data, FIM_TURNO[c.atendimento.turno], f) }];
    }
    case 'diario':
      return [{ marco: c.data, em: naHora(c.data, atraso.hora, f), validaAte: naHora(c.data, '23:59', f) }];
    case 'semanal':
      return diaDaSemana(c.data) === atraso.diaSemana ? [{ marco: c.data, em: naHora(c.data, atraso.hora, f), validaAte: naHora(c.data, '23:59', f) }] : [];
    // relacionamento: domingo/feriado adia pro próximo dia livre (AUT.2), então a validade cobre até 3 dias depois
    case 'mensal':
      return Number(c.data.slice(8)) === atraso.dia ? [{ marco: c.data.slice(0, 7), em: naHora(c.data, atraso.hora, f), validaAte: naHora(somarDias(c.data, 3), '23:59', f) }] : [];
    case 'aniversario':
      return [{ marco: c.data.slice(0, 4), em: naHora(c.data, atraso.hora, f), validaAte: naHora(somarDias(c.data, 3), '23:59', f) }];
    case 'inatividade':
      return [{ marco: c.ultimaDiaria, em: naHora(c.data, atraso.hora, f), validaAte: naHora(somarDias(c.data, 3), '23:59', f) }];
    case 'antes_vencimento_documento':
      return atraso.dias.filter((d) => somarDias(c.documento.venceEm, -d) === c.data)
        .map((d) => ({ marco: `${c.documento.venceEm}:${d}`, em: naHora(c.data, atraso.hora, f), validaAte: naHora(c.documento.venceEm, '00:00', f) }));
    default:
      throw new Error(`atraso de agenda desconhecido: ${atraso.tipo}`);
  }
}

/** Instante de uma regra de EVENTO: { em, validaAte }. */
export function instanteDoEvento(regra, eventoEm) {
  const a = regra.atraso;
  if (a.tipo === 'imediato') return { em: eventoEm, validaAte: mais(eventoEm, regra.validadeMin || 24 * 60) };
  if (a.tipo === 'apos') return { em: mais(eventoEm, a.minutos), validaAte: mais(eventoEm, a.minutos + 7 * 24 * 60) };
  throw new Error(`atraso de evento desconhecido: ${a.tipo}`);
}

/** Agenda final: instante calculado ajustado à janela; null se o ajuste passar da validade (não manda). */
export function agendar({ em, validaAte }, regra, cfg, feriados, { doDia = false } = {}) {
  const t = ajustarJanela(em, { categoria: regra.categoria, doDia }, cfg, feriados);
  return Date.parse(t) <= Date.parse(validaAte) ? t : null;
}

export const BACKOFF_MINUTOS = Object.freeze([1, 5, 15, 60]); // 4 retentativas depois da 1ª tentativa
export const proximaTentativa = (agoraISO, tentativas) => mais(agoraISO, BACKOFF_MINUTOS[tentativas - 1]);
export { mais as somarMinutos };
