// Toast padrão (aria-live). Um de cada vez.
import { anexar, el, trocar } from './dom.js';

let area;
export function toast(msg, tipo = 'info', ms = 4000) {
  if (!area) {
    area = el('div', { class: 'toast-area', role: 'status', 'aria-live': 'polite' });
    anexar(document.body, area);
  }
  trocar(area, el('div', { class: `toast toast-${tipo}`, text: msg }));
  clearTimeout(area._t);
  area._t = setTimeout(() => trocar(area), ms);
}
