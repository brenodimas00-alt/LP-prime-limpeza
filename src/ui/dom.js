// Helpers de DOM. Regra: dado externo entra SÓ via textContent/atributos validados. Nunca innerHTML com dado.

/**
 * Cria elemento. el('a', { href, class: 'btn', text: 'Oi', on: { click } }, [filhos])
 * `text` usa textContent; `attrs` passam por setAttribute (href/src validados por quem chama).
 */
export function el(tag, props = {}, filhos = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'text') e.textContent = String(v);
    else if (k === 'class') e.className = v;
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn);
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else if (k === 'style') e.setAttribute('style', v);
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, String(v));
  }
  for (const f of [].concat(filhos)) if (f !== null && f !== undefined && f !== false) e.append(f instanceof Node ? f : document.createTextNode(String(f)));
  return e;
}

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function limpar(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }

/** replaceChildren/append que ignoram null/undefined/false (o DOM nativo escreve "null" na tela). */
const validos = (xs) => xs.flat().filter((x) => x !== null && x !== undefined && x !== false);
export function trocar(no, ...filhos) { no.replaceChildren(...validos(filhos)); return no; }
export function anexar(no, ...filhos) { no.append(...validos(filhos)); return no; }

/** SVG fixo (markup constante do código, nunca dado externo). */
export function svg(markup) {
  const t = document.createElement('template');
  t.innerHTML = markup.trim(); // eslint-disable-line no-unsanitized/property -- só constantes do código
  return t.content.firstChild;
}

/** Parâmetro da URL (texto puro). Nunca usar como autorização. */
export function param(nome) {
  return new URLSearchParams(location.search).get(nome);
}

/** Só permite abrir links https de hosts conhecidos. */
export function hrefSeguro(u, hosts = ['wa.me', 'api.whatsapp.com']) {
  try { const x = new URL(u); return x.protocol === 'https:' && hosts.includes(x.hostname) ? x.href : null; } catch { return null; }
}
