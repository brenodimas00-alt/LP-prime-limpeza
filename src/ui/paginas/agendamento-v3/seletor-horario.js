// Item 27: "HORÁRIO DE INÍCIO" com seletor compacto Hora | Minutos, sem digitação e sem segundos. Só as horas permitidas
// pra duração (e o dia: sábado pode ter expediente próprio) e, em cada hora, só os minutos permitidos (8h: às 10 só
// 00, 15 e 30). Dois <select> nativos: no celular abrem o seletor do sistema, compacto, sem lista extensa de horários.
import { el } from './ui.js';
import { opcoesHoraMinuto } from '../../../domain/agendamento-v3.js';
import { CONFIG_PRECOS as CFG } from '../../../config/precos.js';
import { T3 } from '../../../config/agendamento-v3.js';

let seq = 0;

/**
 * @param {{id?:string, rotulo?:string, duracaoHoras:number, data?:string, valor:string, aoMudar:(hhmm:string)=>void}} op
 * valor fora do permitido (duração mudou) vira vazio.
 */
export function seletorHorario({ id, rotulo, duracaoHoras, data, valor, aoMudar }) {
  const sid = id || `horario-${++seq}`;
  const opc = opcoesHoraMinuto(duracaoHoras || 2, data, CFG);
  let [h, m] = /^\d\d:\d\d$/.test(valor || '') ? valor.split(':') : ['', ''];
  if (!opc.minutos[h]?.includes(m)) { h = opc.horas.includes(h) ? h : ''; m = ''; }
  const selHora = el('select', { id: `${sid}-hora`, class: 'sel-hora', 'aria-label': `${rotulo || T3.horarioInicio}: ${T3.hora}` },
    [el('option', { value: '', text: '--' }), ...opc.horas.map((x) => el('option', { value: x, text: x, selected: x === h }))]);
  const selMin = el('select', { id: `${sid}-min`, class: 'sel-min', 'aria-label': `${rotulo || T3.horarioInicio}: ${T3.minutos}` });
  const desenharMin = () => {
    const lista = opc.minutos[selHora.value] || [];
    if (!lista.includes(m)) m = lista.length === 1 ? lista[0] : (lista.includes(m) ? m : '');
    selMin.replaceChildren(el('option', { value: '', text: '--' }), ...lista.map((x) => el('option', { value: x, text: x, selected: x === m })));
    selMin.disabled = !lista.length;
  };
  const emitir = () => aoMudar(selHora.value && selMin.value ? `${selHora.value}:${selMin.value}` : '');
  selHora.addEventListener('change', () => { h = selHora.value; if (!m) m = (opc.minutos[h] || [])[0] || ''; desenharMin(); emitir(); });
  selMin.addEventListener('change', () => { m = selMin.value; emitir(); });
  desenharMin();
  const raiz = el('div', { class: 'seletor-horario', dataset: { seletor: sid }, role: 'group', 'aria-label': rotulo || T3.horarioInicio }, [
    el('label', { class: 'sel-rotulo', for: selHora.id, text: T3.hora }), selHora,
    el('span', { class: 'sel-sep', 'aria-hidden': 'true', text: ':' }),
    el('label', { class: 'sel-rotulo', for: selMin.id, text: T3.minutos }), selMin,
  ]);
  // valor que deixou de valer (duração maior agora) avisa quem chamou
  if ((valor || '') !== (h && m ? `${h}:${m}` : '')) queueMicrotask(emitir);
  return { raiz, valor: () => (selHora.value && selMin.value ? `${selHora.value}:${selMin.value}` : '') };
}
