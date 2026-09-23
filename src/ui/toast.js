// Toast padrão (aria-live). Um de cada vez.
import { el } from './dom.js';

let area;
export function toast(msg, tipo = 'info', ms = 4000) {
  if (!area) {
    area = el('div', { class: 'toast-area', role: 'status', 'aria-live': 'polite' });
    document.body.append(area);
  }
  area.replaceChildren(el('div', { class: `toast toast-${tipo}`, text: msg }));
  clearTimeout(area._t);
  area._t = setTimeout(() => area.replaceChildren(), ms);
}
