// Componentes do autoagendamento v3 (item 56: clicar mais e digitar menos; celular primeiro). Cards de escolha (radio com
// check e contorno, não só cor), contador − N +, painel lateral/folha inferior, diálogo de confirmação, seletor compacto
// Hora | Minutos e a moldura de cada tela. Tudo por textContent (nada de innerHTML com dado).
import { anexar, el, svg, trocar } from '../../dom.js';
import { ICONE_CHECK, ICONE_MENOS, ICONE_MAIS, ICONE_FECHAR } from '../../icones.js';

/** Cards de escolha (radio). opcoes: [{valor, titulo, sub, icone, selo, desabilitado, extra}] (extra fica fora do label). */
export function cardsEscolha({ nome, legenda, opcoes, valor, aoMudar, colunas = 2, legendaVisivel = true, classe = '' }) {
  const idErro = `${nome}-erro`;
  const erroEl = el('p', { class: 'erro-campo', id: idErro, 'aria-live': 'polite' });
  const inputs = [];
  const fs = el('fieldset', { class: `cards-escolha col-${colunas} ${classe}`.trim(), dataset: { campo: nome }, 'aria-describedby': idErro }, [
    el('legend', { class: legendaVisivel ? 'pergunta' : 'sr-only', text: legenda }),
    el('div', { class: 'cards' }, opcoes.map((o) => {
      const i = el('input', { type: 'radio', name: nome, value: o.valor, checked: String(valor) === String(o.valor), disabled: !!o.desabilitado });
      i.addEventListener('change', () => { erroEl.textContent = ''; fs.classList.remove('invalido'); aoMudar(o.valor); });
      inputs.push(i);
      const card = el('label', { class: `card-escolha${o.desabilitado ? ' desabilitado' : ''}`, dataset: { valor: o.valor } }, [
        i,
        el('span', { class: 'card-corpo' }, [
          o.icone ? el('span', { class: 'card-icone' }, [svg(o.icone)]) : null,
          el('span', { class: 'card-textos' }, [el('strong', { text: o.titulo }), o.sub ? el('small', { text: o.sub }) : null, o.selo ? el('span', { class: 'selo-sugerida', text: o.selo }) : null]),
          el('span', { class: 'card-check' }, [svg(ICONE_CHECK)]),
        ]),
      ]);
      return o.extra ? el('div', { class: 'card-com-extra' }, [card, o.extra]) : card;
    })),
    erroEl,
  ]);
  return {
    raiz: fs, inputs,
    erro: (m) => { erroEl.textContent = m || ''; fs.classList.toggle('invalido', !!m); if (m) inputs.find((x) => !x.disabled)?.focus(); },
  };
}

/** Sim / Não em dois cards (item 56). valor: true | false | null. */
export function simNao({ nome, legenda, valor, aoMudar, subNao, subSim }) {
  return cardsEscolha({
    nome, legenda, colunas: 2, valor: valor === null || valor === undefined ? '' : valor ? 'sim' : 'nao',
    opcoes: [{ valor: 'nao', titulo: 'Não', sub: subNao }, { valor: 'sim', titulo: 'Sim', sub: subSim }],
    aoMudar: (v) => aoMudar(v === 'sim'),
  });
}

/** Contador − N + (botões de 44 px; leitor de tela: "Quartos, 2"). */
export function contador({ id, rotulo, valor, min = 0, max = 20, passo = 1, aoMudar }) {
  let v = valor;
  const saida = el('output', { id: `${id}-valor`, class: 'contador-valor', 'aria-live': 'polite', 'aria-label': `${rotulo}, ${v}`, text: String(v) });
  const menos = el('button', { type: 'button', class: 'contador-btn', 'aria-label': `Diminuir ${rotulo.toLowerCase()}` }, [svg(ICONE_MENOS)]);
  const mais = el('button', { type: 'button', class: 'contador-btn', 'aria-label': `Aumentar ${rotulo.toLowerCase()}` }, [svg(ICONE_MAIS)]);
  const atual = () => { saida.textContent = String(v); saida.setAttribute('aria-label', `${rotulo}, ${v}`); menos.disabled = v <= min; mais.disabled = v >= max; };
  menos.addEventListener('click', () => { v = Math.max(min, v - passo); atual(); aoMudar(v); });
  mais.addEventListener('click', () => { v = Math.min(max, v + passo); atual(); aoMudar(v); });
  atual();
  return el('div', { class: 'contador', dataset: { contador: id } }, [
    el('span', { class: 'contador-rotulo', id: `${id}-rotulo`, text: rotulo }),
    el('div', { class: 'contador-controles', role: 'group', 'aria-labelledby': `${id}-rotulo` }, [menos, saida, mais]),
  ]);
}

/** Painel lateral (computador) / folha inferior (celular) com <dialog>: foco preso e devolvido. */
export function abrirPainel(titulo, conteudo, { aoFechar } = {}) {
  const fechar = el('button', { type: 'button', class: 'painel-fechar', 'aria-label': 'Fechar' }, [svg(ICONE_FECHAR)]);
  const d = el('dialog', { class: 'painel-lateral', 'aria-labelledby': 'painel-titulo' }, [
    el('div', { class: 'painel-topo' }, [el('h2', { id: 'painel-titulo', text: titulo }), fechar]),
    el('div', { class: 'painel-conteudo' }, [].concat(conteudo)),
  ]);
  const quem = document.activeElement;
  fechar.addEventListener('click', () => d.close());
  d.addEventListener('click', (ev) => { if (ev.target === d) d.close(); });
  d.addEventListener('close', () => { d.remove(); quem?.focus?.(); aoFechar?.(); });
  document.body.append(d);
  d.showModal();
  return d;
}

/** Diálogo de confirmação (ex.: "Alterar frequência?"). Resolve true no botão de confirmar. */
export function confirmar({ titulo, texto, cancelar = 'Cancelar', confirmar: ok = 'Confirmar' }) {
  return new Promise((resolver) => {
    let res = false;
    const bCancelar = el('button', { type: 'button', class: 'btn btn-secundario', text: cancelar });
    const bOk = el('button', { type: 'button', class: 'btn btn-primary', text: ok });
    const d = el('dialog', { class: 'dialogo-confirmar', 'aria-labelledby': 'dialogo-titulo', 'aria-describedby': 'dialogo-texto', role: 'alertdialog' }, [
      el('h2', { id: 'dialogo-titulo', text: titulo }), el('p', { id: 'dialogo-texto', text: texto }),
      el('div', { class: 'dialogo-acoes' }, [bCancelar, bOk]),
    ]);
    const quem = document.activeElement;
    bCancelar.addEventListener('click', () => d.close());
    bOk.addEventListener('click', () => { res = true; d.close(); });
    d.addEventListener('close', () => { d.remove(); quem?.focus?.(); resolver(res); });
    document.body.append(d);
    d.showModal();
    bCancelar.focus();
  });
}

/**
 * Barra de progresso das 6 etapas. Com `irEtapa`, as etapas já feitas viram botões (voltar por elas sem perder nada);
 * com `recomecar`, aparece "Começar de novo" (a partir da etapa 2: o rascunho nunca prende a pessoa numa etapa).
 */
export function progresso(n, etapas, { irEtapa, recomecar } = {}) {
  const itens = etapas.map((nome, i) => {
    const k = i + 1;
    if (k < n && irEtapa) return el('li', {}, [el('button', { type: 'button', class: 'progresso-etapa feita', on: { click: () => irEtapa(k) } }, [el('span', { class: 'sr-only', text: `Voltar para a etapa ${k}: ` }), el('span', { class: 'progresso-nome', text: nome })])]);
    return el('li', {}, [el('span', { class: `progresso-etapa${k === n ? ' atual' : ''}`, 'aria-current': k === n ? 'step' : null }, [el('span', { class: 'progresso-nome', text: nome })])]);
  });
  return el('div', { class: 'progresso-fluxo' }, [
    el('div', { class: 'progresso-topo' }, [
      el('p', { class: 'progresso-rotulo', text: `Etapa ${n} de ${etapas.length} · ${etapas[n - 1]}` }),
      n > 1 && recomecar ? el('button', { type: 'button', class: 'btn btn-terciario btn-p progresso-recomecar', text: 'Começar de novo', on: { click: recomecar } }) : null,
    ]),
    el('div', {
      class: 'progresso-linha', role: 'progressbar', 'aria-label': 'Progresso da solicitação', 'aria-valuemin': 1, 'aria-valuemax': etapas.length,
      'aria-valuenow': n, 'aria-valuetext': `Etapa ${n} de ${etapas.length}: ${etapas[n - 1]}`,
    }, [el('span', { style: `width:${Math.round((n / etapas.length) * 100)}%` })]),
    irEtapa ? el('nav', { 'aria-label': 'Etapas da solicitação' }, [el('ol', { class: 'progresso-etapas' }, itens)]) : null,
  ]);
}

/**
 * Moldura de uma tela: título, corpo, erro geral e Voltar/Continuar. validar() devolve true (segue), false (o próprio
 * passo mostrou o erro) ou uma string (erro geral). Devolve {form, erroGeral, avancarBtn}.
 */
export function moldura({ passo, titulo, sub, corpo, validar, aoAvancar, aoVoltar, rotuloAvancar = 'Continuar', semAvancar = false }) {
  const form = el('form', { novalidate: true, class: 'passo-fluxo', 'aria-labelledby': 'titulo-passo', dataset: { passo } });
  const erroGeral = el('p', { class: 'alerta alerta-erro', role: 'alert', hidden: true, tabindex: -1 });
  const avancarBtn = semAvancar ? null : el('button', { class: 'btn btn-primary btn-seta', type: 'submit', text: rotuloAvancar });
  const voltarBtn = aoVoltar ? el('button', { class: 'btn btn-secundario', type: 'button', text: 'Voltar', on: { click: aoVoltar } }) : null;
  anexar(form, el('h2', { id: 'titulo-passo', class: 'titulo-passo', text: titulo, tabindex: -1 }), sub ? el('p', { class: 'sub-passo', text: sub }) : null,
    ...[].concat(corpo), erroGeral, el('div', { class: 'barra-acoes' }, [voltarBtn, el('span', { class: 'espaco' }), avancarBtn]));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erroGeral.hidden = true;
    if (avancarBtn?.getAttribute('aria-busy') === 'true') return;
    const res = await validar?.();
    if (res === true || res === undefined) { aoAvancar(); return; }
    if (typeof res === 'string') mostrarErro(erroGeral, res);
  });
  return { form, erroGeral, avancarBtn };
}

export function mostrarErro(alvo, msg) { alvo.hidden = false; alvo.textContent = msg; alvo.focus(); }

/** Bloco de alerta/aviso com ícone opcional. */
export function aviso(classe, filhos, attrs = {}) {
  return el('div', { class: `alerta ${classe}`, ...attrs }, [].concat(filhos));
}

export { el, trocar, anexar, svg };
