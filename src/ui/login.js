// Formulário de entrada compartilhado (cliente, diarista, Prime). Modo demonstração: auth mock.
import { el } from './dom.js';
import { campo } from './form.js';
import { executarAcao, mensagemErro } from './acoes.js';
import { url } from '../config/app.js';

/**
 * @param {{campos:object[], rotuloBotao:string, aoEnviar:(valores:object)=>Promise<any>, destino:string, rodape?:Node[]}} op
 */
export function formularioEntrada({ campos, rotuloBotao, aoEnviar, destino, rodape = [] }) {
  const form = el('form', { novalidate: true, class: 'cartao principal reveal' });
  const inputs = {};
  for (const c of campos) { inputs[c.id] = campo(c); form.append(inputs[c.id].raiz); }
  const erro = el('p', { class: 'alerta alerta-erro', role: 'alert', hidden: true });
  const botao = el('button', { class: 'btn btn-primary btn-seta', type: 'submit', text: rotuloBotao });
  form.append(erro, el('div', { class: 'acoes' }, [botao]), ...rodape);
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    erro.hidden = true;
    const valores = Object.fromEntries(Object.entries(inputs).map(([k, c]) => [k, c.input.value]));
    executarAcao(botao, () => aoEnviar(valores, inputs), {
      aoSucesso: (r) => { if (r?.semRedirecionar) return; location.href = url(destino); },
      aoErro: (e) => { erro.hidden = false; erro.textContent = mensagemErro(e); },
    });
  });
  return { form, inputs, erro };
}

export function linksOutrasEntradas(atual) {
  const todos = [['cliente', 'Sou cliente', 'entrar/'], ['diarista', 'Sou diarista', 'diarista/entrar/'], ['prime', 'Equipe Prime', 'painel/entrar/']];
  return el('p', { class: 'mudo', style: 'margin-top:18px' }, [
    'Outras entradas: ',
    ...todos.filter(([k]) => k !== atual).flatMap(([, t, h], i, arr) => [el('a', { href: url(h), text: t }), i < arr.length - 1 ? ' · ' : '']),
  ]);
}
