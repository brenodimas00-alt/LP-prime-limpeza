// Calendário mensal acessível (agendamento v2): grade ARIA com foco itinerante, setas (dia/semana), Home/End (semana),
// PageUp/PageDown (mês), Enter/Espaço escolhe. Dia indisponível fica desabilitado e diz o motivo pro leitor de tela.
// Não guarda estado de negócio: quem chama diz o que está escolhido e o que pode ser escolhido.
import { el, svg, trocar } from './dom.js';
import { ICONE_ANTERIOR, ICONE_PROXIMO } from './icones.js';
import { somarDias, diaDaSemana, ultimoDiaDoMes, NOMES_DIA } from '../domain/calendario.js';

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const mesDe = (d) => d.slice(0, 7);
const extenso = (d) => `${NOMES_DIA[diaDaSemana(d)]}, ${Number(d.slice(8))} de ${MESES[Number(d.slice(5, 7)) - 1]} de ${d.slice(0, 4)}`;

/**
 * @param {{min:string, max:string, inicial?:string, escolhidas:()=>string[], motivo:(d:string)=>string|null, aoEscolher:(d:string)=>void, rotulo:string}} op
 * @returns {{raiz:HTMLElement, atualizar:()=>void, focar:()=>void}}
 */
export function criarCalendario({ min, max, inicial, escolhidas, motivo, aoEscolher, rotulo }) {
  let foco = inicial && inicial >= min && inicial <= max ? inicial : min;
  const titulo = el('p', { class: 'cal-mes', 'aria-live': 'polite', id: `cal-mes-${Math.random().toString(36).slice(2, 7)}` });
  const ant = el('button', { type: 'button', class: 'cal-nav', 'aria-label': 'Mês anterior' }, [svg(ICONE_ANTERIOR)]);
  const prox = el('button', { type: 'button', class: 'cal-nav', 'aria-label': 'Próximo mês' }, [svg(ICONE_PROXIMO)]);
  const grade = el('table', { class: 'cal-grade', role: 'grid', 'aria-labelledby': titulo.id });
  const raiz = el('div', { class: 'calendario', role: 'group', 'aria-label': rotulo }, [el('div', { class: 'cal-topo' }, [ant, titulo, prox]), grade]);

  function irMes(delta, focar = true) {
    const [y, m] = foco.split('-').map(Number);
    const total = (m - 1) + delta;
    const ano = y + Math.floor(total / 12); const mes = ((total % 12) + 12) % 12 + 1;
    const dia = Math.min(Number(foco.slice(8)), ultimoDiaDoMes(ano, mes));
    mover(`${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`, focar);
  }
  function mover(d, focar = true) {
    foco = d < min ? min : d > max ? max : d;
    desenhar();
    if (focar) grade.querySelector(`[data-dia="${foco}"]`)?.focus();
  }
  function desenhar() {
    const mes = mesDe(foco);
    const [y, m] = mes.split('-').map(Number);
    titulo.textContent = `${MESES[m - 1][0].toUpperCase()}${MESES[m - 1].slice(1)} de ${y}`;
    ant.disabled = mes <= mesDe(min); prox.disabled = mes >= mesDe(max);
    const sel = new Set(escolhidas());
    const primeiro = `${mes}-01`;
    const linhas = []; let linha = [];
    for (let i = 0; i < diaDaSemana(primeiro); i++) linha.push(el('td', { role: 'gridcell' }));
    for (let n = 1; n <= ultimoDiaDoMes(y, m); n++) {
      const d = `${mes}-${String(n).padStart(2, '0')}`;
      const fora = d < min || d > max;
      const mot = fora ? 'fora do período de agendamento' : motivo(d);
      const escolhido = sel.has(d);
      const b = el('button', {
        type: 'button', class: `cal-dia${escolhido ? ' escolhido' : ''}`, text: String(n), tabindex: d === foco ? '0' : '-1',
        'aria-pressed': escolhido ? 'true' : 'false', 'aria-disabled': mot ? 'true' : null, dataset: { dia: d },
        'aria-label': `${extenso(d)}${escolhido ? ', escolhida' : ''}${mot ? `, indisponível: ${mot}` : ''}`,
      });
      b.addEventListener('click', () => { foco = d; if (!mot) { aoEscolher(d); } desenhar(); grade.querySelector(`[data-dia="${d}"]`)?.focus(); });
      linha.push(el('td', { role: 'gridcell' }, [b]));
      if (linha.length === 7) { linhas.push(el('tr', {}, linha)); linha = []; }
    }
    if (linha.length) { while (linha.length < 7) linha.push(el('td', { role: 'gridcell' })); linhas.push(el('tr', {}, linha)); }
    trocar(grade,
      el('thead', {}, [el('tr', {}, SEMANA.map((s, i) => el('th', { scope: 'col', abbr: NOMES_DIA[i], text: s })))]),
      el('tbody', {}, linhas));
  }
  grade.addEventListener('keydown', (ev) => {
    const passos = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (passos[ev.key] !== undefined) { ev.preventDefault(); mover(somarDias(foco, passos[ev.key])); return; }
    if (ev.key === 'Home') { ev.preventDefault(); mover(somarDias(foco, -diaDaSemana(foco))); return; }
    if (ev.key === 'End') { ev.preventDefault(); mover(somarDias(foco, 6 - diaDaSemana(foco))); return; }
    if (ev.key === 'PageUp') { ev.preventDefault(); irMes(-1); return; }
    if (ev.key === 'PageDown') { ev.preventDefault(); irMes(1); }
  });
  ant.addEventListener('click', () => irMes(-1, false));
  prox.addEventListener('click', () => irMes(1, false));
  desenhar();
  return { raiz, atualizar: () => desenhar(), focar: () => grade.querySelector(`[data-dia="${foco}"]`)?.focus() };
}
