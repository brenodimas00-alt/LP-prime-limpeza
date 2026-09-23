// Helpers de formulário acessível: label ligado, erro com aria-describedby/aria-invalid, máscaras.
import { el } from './dom.js';

let seq = 0;

/**
 * Campo com label, ajuda e área de erro.
 * @returns {{raiz:HTMLElement, input:HTMLElement, erro:(msg:string)=>void}}
 */
export function campo({ id, rotulo, tipo = 'text', ajuda, opcoes, attrs = {}, valor, mascara }) {
  const cid = id || `c${++seq}`;
  const idErro = `${cid}-erro`;
  const idAjuda = ajuda ? `${cid}-ajuda` : null;
  let input;
  if (tipo === 'select') {
    input = el('select', { id: cid, name: cid, ...attrs }, opcoes.map(([v, t]) => el('option', { value: v, text: t })));
  } else if (tipo === 'textarea') {
    input = el('textarea', { id: cid, name: cid, ...attrs });
  } else {
    input = el('input', { id: cid, name: cid, type: tipo, ...attrs });
  }
  input.setAttribute('aria-describedby', [idAjuda, idErro].filter(Boolean).join(' '));
  if (valor !== undefined && valor !== null) input.value = valor;
  const areaErro = el('p', { id: idErro, class: 'erro-campo', 'aria-live': 'polite' });
  const raiz = el('div', { class: 'campo', dataset: { campo: cid } }, [
    el('label', { for: cid, text: rotulo }), ajuda ? el('span', { id: idAjuda, class: 'ajuda', text: ajuda }) : null, input, areaErro,
  ]);
  if (mascara) {
    input.addEventListener('input', () => {
      const antes = input.value;
      const depois = mascara(antes);
      if (antes !== depois) input.value = depois;
    });
  }
  const erro = (msg) => {
    areaErro.textContent = msg || '';
    raiz.classList.toggle('invalido', !!msg);
    if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
  };
  input.addEventListener('input', () => erro(''));
  return { raiz, input, erro };
}

/** Grupo de radios/checkbox em cartões. */
export function grupoOpcoes({ nome, legenda, tipo = 'radio', opcoes, valor, cartoes = false }) {
  const idErro = `${nome}-erro`;
  const areaErro = el('p', { id: idErro, class: 'erro-campo', 'aria-live': 'polite' });
  const valores = new Set([].concat(valor ?? []));
  const inputs = [];
  const fs = el('fieldset', { class: 'grupo', dataset: { campo: nome }, 'aria-describedby': idErro }, [
    el('legend', { text: legenda }),
    el('div', { class: `opcoes${cartoes ? ' cartoes' : ''}` }, opcoes.map(([v, t, sub]) => {
      const i = el('input', { type: tipo, name: nome, value: v, checked: valores.has(v) });
      inputs.push(i);
      return el('label', { class: 'opcao' }, [i, el('span', {}, [t, sub ? el('small', { text: sub }) : null])]);
    })),
    areaErro,
  ]);
  const erro = (msg) => { areaErro.textContent = msg || ''; fs.classList.toggle('invalido', !!msg); };
  fs.addEventListener('change', () => erro(''));
  return {
    raiz: fs, inputs, erro,
    valor: () => (tipo === 'radio' ? inputs.find((i) => i.checked)?.value ?? '' : inputs.filter((i) => i.checked).map((i) => i.value)),
  };
}

/** Mostra erros {campo: msg} nos campos e foca o primeiro. Retorna true se não houve erro. */
export function aplicarErros(erros, mapa) {
  let primeiro = null;
  for (const [k, c] of Object.entries(mapa)) {
    const msg = erros[k] || '';
    c.erro(msg);
    if (msg && !primeiro) primeiro = c.input || c.inputs?.[0];
  }
  primeiro?.focus();
  return !primeiro;
}
