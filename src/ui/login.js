// Formulário de entrada compartilhado (cliente, diarista, Prime). Modo demonstração: auth mock.
import { anexar, el, trocar } from './dom.js';
import { campo, aplicarErros } from './form.js';
import { executarAcao, mensagemErro } from './acoes.js';
import { url } from '../config/app.js';

/**
 * @param {{campos:object[], validar?:(valores:object)=>Object<string,string>, rotuloBotao:string, aoEnviar:(valores:object)=>Promise<any>, destino:string, rodape?:Node[], antes?:Node[]}} op
 * Todo campo é obrigatório: sem `validar`, campo vazio bloqueia com "Preencha este campo".
 */
export function formularioEntrada({ campos, validar, rotuloBotao, aoEnviar, destino, rodape = [], antes = [] }) {
  const form = el('form', { novalidate: true, class: 'cartao principal reveal' }, antes);
  const inputs = {};
  for (const c of campos) { inputs[c.id] = campo(c); anexar(form, inputs[c.id].raiz); }
  const erro = el('p', { class: 'alerta alerta-erro', role: 'alert', hidden: true });
  const botao = el('button', { class: 'btn btn-primary btn-seta', type: 'submit', text: rotuloBotao });
  anexar(form, erro, el('div', { class: 'acoes' }, [botao]), ...rodape);
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    erro.hidden = true;
    const valores = Object.fromEntries(Object.entries(inputs).map(([k, c]) => [k, c.input.value]));
    const erros = validar ? validar(valores) : {};
    for (const [k, v] of Object.entries(valores)) if (!String(v).trim() && !erros[k]) erros[k] = 'Preencha este campo';
    if (!aplicarErros(erros, inputs, erro)) return;
    executarAcao(botao, () => aoEnviar(valores, inputs), {
      aoSucesso: (r) => { if (r?.semRedirecionar) return; location.href = url(destino); },
      aoErro: (e) => {
        // erro de campo vindo do servidor (ex.: senha atual não confere) aparece embaixo do campo
        if (e?.detalhes && Object.keys(e.detalhes).some((k) => inputs[k])) { aplicarErros(e.detalhes, inputs, erro); return; }
        erro.hidden = false; erro.textContent = mensagemErro(e);
      },
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
