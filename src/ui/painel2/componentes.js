// Componentes do painel v2 (B1). Puros de DOM: recebem dados prontos e devolvem elementos. Dado externo só por
// textContent/atributos (el). Teclado: Esc fecha modal e painel lateral, foco preso enquanto aberto e devolvido ao fechar;
// expansões com aria-expanded/aria-controls; contadores com rótulo pro leitor de tela.
import { el, trocar, hrefSeguro } from '../dom.js';
import { executarAcao, mensagemErro } from '../acoes.js';
import { icone } from './icones.js';

let seq = 0;
const novoId = (p) => `${p}-${++seq}`;
const guardado = {
  ler(k) { try { return localStorage.getItem(`prime.painel.${k}`); } catch { return null; } },
  gravar(k, v) { try { if (v === null) localStorage.removeItem(`prime.painel.${k}`); else localStorage.setItem(`prime.painel.${k}`, v); } catch { /* sem storage */ } },
};
export { guardado };

/** Botão. `acao(chave)` roda com idempotência (executarAcao); `aoClicar` é clique simples. */
export function botao(texto, { tom = '', ic, acao, aoClicar, sucesso, aoSucesso, rotulo, soIcone = false, tipo = 'button' } = {}) {
  const b = el('button', { type: tipo, class: `p-btn${tom ? ` p-${tom}` : ''}${soIcone ? ' p-so-icone' : ''}`, 'aria-label': rotulo || (soIcone ? texto : null), title: soIcone ? texto : null },
    [ic ? icone(ic, { pequeno: true }) : null, soIcone ? null : texto]);
  if (acao) b.addEventListener('click', () => executarAcao(b, acao, { sucesso, aoSucesso }));
  else if (aoClicar) b.addEventListener('click', aoClicar);
  return b;
}

export const selo = (texto, tom = 'neutro') => el('span', { class: `p-selo ${tom}`, text: texto });

/** Contador (badge). `rotulo` vai pro leitor de tela: "6 solicitações novas". */
export function contador(n, { tom = '', rotulo } = {}) {
  return el('span', { class: `p-badge${tom ? ` ${tom}` : ''}`, 'aria-label': rotulo || null }, [String(n)]);
}

const iniciais = (nome = '') => nome.trim().split(/\s+/).filter(Boolean).map((p, i, l) => (i === 0 || i === l.length - 1 ? p[0] : '')).join('').slice(0, 2).toUpperCase() || '?';
const HABILIDADES = {
  residencial: ['casa', 'Residencial'], empresarial: ['predio', 'Empresarial'], passadoria: ['ferro', 'Passadoria'],
  pre_pos_mudanca: ['caixa', 'Pré e pós-mudança'], pre_pos_evento: ['festa', 'Eventos'], pos_obra: ['vassoura', 'Pós-obra'],
};
export const ROTULO_HABILIDADE = Object.fromEntries(Object.entries(HABILIDADES).map(([k, [, r]]) => [k, r]));

/** Avatar de iniciais + nome + ícones de habilidade (cada ícone com rótulo; title pra quem usa mouse). */
export function avatar(nome, { habilidades = [], linha2 } = {}) {
  const hab = habilidades.filter((h) => HABILIDADES[h]);
  return el('span', { class: 'p-avatar' }, [
    el('span', { class: 'p-avatar-circulo', 'aria-hidden': 'true', text: iniciais(nome) }),
    el('span', { class: 'p-avatar-nome' }, [
      el('b', { text: nome || 'Sem profissional' }),
      linha2 ? el('span', { class: 'p-sec', text: linha2 }) : null,
      hab.length ? el('span', { class: 'p-habilidades', role: 'list', 'aria-label': 'Habilidades' }, hab.map((h) => {
        const s = el('span', { role: 'listitem', title: HABILIDADES[h][1] }, [icone(HABILIDADES[h][0], { pequeno: true, titulo: HABILIDADES[h][1] })]);
        return s;
      })) : null,
    ]),
  ]);
}

/** Atalho de WhatsApp (só se houver telefone válido). */
export function zap(telefone, nome) {
  const d = String(telefone || '').replace(/\D/g, '');
  if (d.length < 10) return null;
  const href = hrefSeguro(`https://wa.me/55${d.replace(/^55/, '')}`);
  return href ? el('a', { class: 'p-zap', href, target: '_blank', rel: 'noopener', 'aria-label': `WhatsApp de ${nome || 'contato'}`, title: 'Abrir WhatsApp' }, [icone('zap')]) : null;
}

export function esqueleto(linhas = 3) {
  return el('div', { class: 'p-esqueleto', 'aria-hidden': 'true' }, Array.from({ length: linhas }, () => el('span')));
}

export function erroBloco(e, tentar) {
  return el('div', { class: 'p-erro', role: 'alert' }, [icone('alerta', { pequeno: true }), el('span', { text: mensagemErro(e) }), tentar ? botao('Tentar de novo', { aoClicar: tentar }) : null]);
}

export const tudoResolvido = (texto = 'Tudo resolvido por aqui.') => el('p', { class: 'p-resolvido', role: 'status' }, [icone('check'), texto]);
export const vazio = (texto) => el('p', { class: 'p-vazio', text: texto });

/**
 * Bloco recolhível que carrega sozinho (esqueleto, erro com "Tentar de novo"). `carregar()` devolve
 * { conteudo, contagem?, urgentes?, sub?, extra?, rodape?, vazio? }. Com `vazio: true` e `someSeVazio`, o bloco some.
 * A urgência continua visível no cabeçalho com o bloco recolhido.
 */
export function bloco({ id, titulo, ic, carregar, someSeVazio = false, recolhivel = true, classe = '', rotuloContagem = (n) => `${n}` }) {
  const corpoId = novoId('bloco');
  const tituloId = novoId('titulo');
  const raiz = el('section', { class: `p-bloco ${classe}`.trim(), 'aria-labelledby': tituloId, dataset: { bloco: id } });
  const icBloco = el('span', { class: 'p-ic-bloco', 'aria-hidden': 'true' }, [icone(ic)]);
  const h2 = el('h2', { id: tituloId, text: titulo });
  const contagemEl = el('span', { class: 'p-cont-bloco' });
  const subEl = el('span', { class: 'p-sub' });
  const extraEl = el('div', { class: 'p-extra' });
  const corpo = el('div', { class: 'p-bloco-corpo', id: corpoId }, [esqueleto()]);
  const rodapeEl = el('div', { class: 'p-bloco-rodape' });
  const aberto = guardado.ler(`recolhido.${id}`) !== '1';
  const seta = recolhivel ? el('button', { type: 'button', class: 'p-recolher', 'aria-expanded': String(aberto), 'aria-controls': corpoId, 'aria-label': `${aberto ? 'Recolher' : 'Expandir'} ${titulo}` }, [icone('acima', { pequeno: true })]) : null;
  corpo.hidden = !aberto; rodapeEl.hidden = !aberto;
  seta?.addEventListener('click', () => {
    const abrir = seta.getAttribute('aria-expanded') !== 'true';
    seta.setAttribute('aria-expanded', String(abrir)); seta.setAttribute('aria-label', `${abrir ? 'Recolher' : 'Expandir'} ${titulo}`);
    corpo.hidden = !abrir; rodapeEl.hidden = !abrir || !rodapeEl.childNodes.length;
    guardado.gravar(`recolhido.${id}`, abrir ? null : '1');
  });
  trocar(raiz, el('div', { class: 'p-bloco-cab' }, [el('div', { class: 'p-titulo' }, [icBloco, el('div', {}, [el('div', { style: 'display:flex;align-items:center;gap:8px;flex-wrap:wrap' }, [h2, contagemEl]), subEl])]), extraEl, seta]), corpo, rodapeEl);
  async function recarregar() {
    if (!corpo.querySelector('.p-esqueleto')) corpo.setAttribute('aria-busy', 'true');
    try {
      const r = await carregar();
      corpo.removeAttribute('aria-busy');
      if (r?.vazio && someSeVazio) { raiz.hidden = true; return r; }
      raiz.hidden = false;
      const urg = r?.urgentes || 0;
      raiz.classList.toggle('p-urgente-borda', urg > 0);
      icBloco.classList.toggle('urgente', urg > 0);
      trocar(contagemEl, r?.contagem !== undefined ? el('span', { class: 'p-num p-sec', 'aria-label': rotuloContagem(r.contagem), text: `(${r.contagem})` }) : null,
        urg ? selo(`${urg} ${urg === 1 ? 'urgente' : 'urgentes'}`, 'urgente') : null);
      trocar(subEl, r?.sub || '');
      trocar(extraEl, ...(r?.extra || []));
      trocar(corpo, r?.conteudo || null);
      trocar(rodapeEl, ...(r?.rodape || []));
      rodapeEl.hidden = corpo.hidden || !rodapeEl.childNodes.length;
      return r;
    } catch (e) {
      corpo.removeAttribute('aria-busy');
      raiz.hidden = false;
      trocar(corpo, erroBloco(e, () => { trocar(corpo, esqueleto()); recarregar(); }));
      return null;
    }
  }
  return { raiz, recarregar };
}

/**
 * Tabela densa no computador; no celular cada linha vira cartão (CSS) com a primeira camada e a expansão.
 * colunas: [{ rotulo, classe?, sr? }]; linhas: [{ id, celulas: [no|texto], detalhe?: () => no, dataset? }]
 * A 1ª coluna com classe 'p-principal-cel' vira o título do cartão.
 */
export function tabelaExpansivel({ colunas, linhas, rotulo, vazioTexto = 'Nada por aqui.' }) {
  if (!linhas.length) return vazio(vazioTexto);
  const temDetalhe = linhas.some((l) => l.detalhe);
  const cab = el('tr', {}, [temDetalhe ? el('th', {}, [el('span', { class: 'p-sr', text: 'Detalhes' })]) : null, ...colunas.map((c) => el('th', { class: c.classe || null, scope: 'col' }, [c.sr ? el('span', { class: 'p-sr', text: c.rotulo }) : c.rotulo]))]);
  const corpo = el('tbody');
  for (const l of linhas) {
    const detId = novoId('det');
    let det = null;
    const exp = l.detalhe ? el('button', { type: 'button', class: 'p-expandir', 'aria-expanded': 'false', 'aria-controls': detId, 'aria-label': `Ver detalhes${l.rotulo ? ` de ${l.rotulo}` : ''}` }, [icone('direita', { pequeno: true })]) : null;
    const tr = el('tr', { class: 'p-lin', dataset: l.dataset || {} }, [
      temDetalhe ? el('td', { class: 'p-cel-expandir' }, [exp]) : null,
      ...l.celulas.map((c, i) => el('td', { class: colunas[i].classe || null, 'data-rotulo': colunas[i].rotulo }, [c])),
    ]);
    corpo.append(tr);
    if (exp) {
      exp.addEventListener('click', () => {
        const abrir = exp.getAttribute('aria-expanded') !== 'true';
        exp.setAttribute('aria-expanded', String(abrir));
        if (abrir) {
          det = el('tr', { class: 'p-det', id: detId }, [el('td', { colspan: String(colunas.length + 1) }, [l.detalhe()])]);
          tr.after(det);
        } else { det?.remove(); det = null; }
      });
    }
  }
  return el('div', { class: 'p-tabela-wrap' }, [el('table', { class: 'p-tabela', 'aria-label': rotulo || null }, [el('thead', {}, [cab]), corpo])]);
}

/** Lista de definição da expansão: [[rótulo, valor, largo?], ...] (valor vazio some). */
export function detalhe(pares) {
  return el('dl', { class: 'p-detalhe' }, pares.filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v, largo]) => el('div', { class: largo ? 'p-largo' : null }, [el('dt', { text: k }), el('dd', {}, [v])])));
}

/** Chips de filtro (um ativo). opcoes: [[valor, rótulo, contagem?]] */
export function chips(opcoes, valor, aoMudar, { rotulo = 'Filtro' } = {}) {
  const raiz = el('div', { class: 'p-chips', role: 'group', 'aria-label': rotulo });
  for (const [v, r, n] of opcoes) {
    const b = el('button', { type: 'button', class: 'p-chip', 'aria-pressed': String(v === valor) }, [r, n !== undefined ? ` (${n})` : '']);
    b.addEventListener('click', () => { for (const x of raiz.children) x.setAttribute('aria-pressed', String(x === b)); aoMudar(v); });
    raiz.append(b);
  }
  return raiz;
}

/** Filtros verticais com contador (Precisa de você). */
export function filtrosVerticais(opcoes, valor, aoMudar, { rotulo = 'Filtrar por tipo' } = {}) {
  const raiz = el('div', { class: 'p-filtros-v', role: 'group', 'aria-label': rotulo });
  for (const [v, r, n] of opcoes) {
    const b = el('button', { type: 'button', 'aria-pressed': String(v === valor) }, [el('span', { text: r }), el('span', { class: 'p-badge neutro', text: String(n) })]);
    b.addEventListener('click', () => { for (const x of raiz.children) x.setAttribute('aria-pressed', String(x === b)); aoMudar(v); });
    raiz.append(b);
  }
  return raiz;
}

// ---------------------------------------------------------------- sobreposições (modal e painel lateral)

const FOCAVEIS = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
function sobrepor(caixa, fundo, { aoFechar } = {}) {
  const antes = document.activeElement;
  const fechar = () => {
    document.removeEventListener('keydown', tecla, true);
    caixa.remove(); fundo.remove();
    document.body.style.overflow = '';
    if (antes?.isConnected) antes.focus();
    aoFechar?.();
  };
  function tecla(ev) {
    if (ev.key === 'Escape') { ev.preventDefault(); fechar(); return; }
    if (ev.key !== 'Tab') return;
    const f = [...caixa.querySelectorAll(FOCAVEIS)].filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    if (ev.shiftKey && document.activeElement === f[0]) { ev.preventDefault(); f.at(-1).focus(); } else if (!ev.shiftKey && document.activeElement === f.at(-1)) { ev.preventDefault(); f[0].focus(); }
  }
  fundo.addEventListener('click', fechar);
  document.addEventListener('keydown', tecla, true);
  document.body.append(fundo, caixa);
  document.body.style.overflow = 'hidden';
  (caixa.querySelector('[autofocus]') || caixa.querySelector('h2') || caixa).focus();
  return fechar;
}

/** Modal genérico. corpo: nó; botoes: (fechar) => [nós]. Devolve fechar(). */
export function modal({ titulo, corpo, botoes, aoFechar }) {
  const tId = novoId('modal');
  const caixa = el('div', { class: 'p-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': tId });
  const fundo = el('div', { class: 'p-modal-fundo' });
  const h2 = el('h2', { id: tId, text: titulo, tabindex: '-1' });
  let fechar = () => {};
  const rodape = el('div', { class: 'p-rodape' });
  trocar(caixa, h2, corpo, rodape);
  fechar = sobrepor(caixa, fundo, { aoFechar });
  trocar(rodape, ...(botoes ? botoes(fechar) : [botao('Fechar', { aoClicar: () => fechar() })]));
  return fechar;
}

/** Confirmação só pra irreversível ou dinheiro: o botão diz a consequência. Promise<boolean>. */
export function confirmar({ titulo, texto, rotuloConfirmar, tom = 'primario' }) {
  return new Promise((ok) => {
    let decidiu = false;
    modal({
      titulo, corpo: el('p', { class: 'p-sec', text: texto }),
      aoFechar: () => { if (!decidiu) ok(false); },
      botoes: (fechar) => [botao('Voltar', { aoClicar: () => fechar() }), botao(rotuloConfirmar, { tom, aoClicar: () => { decidiu = true; fechar(); ok(true); } })],
    });
  });
}

/**
 * Modal de motivo (recusar, cancelar, reabrir): motivo padronizado obrigatório + detalhe (obrigatório em "Outro").
 * Promise<{ codigo, rotulo, detalhe, texto } | null>. `texto` = "Rótulo: detalhe" (o banco extrai o código).
 */
export function pedirMotivo({ titulo, explicacao, motivos = [], rotuloConfirmar = 'Confirmar', consequencia, tom = 'perigo', detalheObrigatorio = false }) {
  return new Promise((ok) => {
    let decidiu = false;
    const sel = el('select', { id: novoId('motivo'), required: true }, [el('option', { value: '', text: 'Escolha o motivo' }), ...motivos.map((m) => el('option', { value: m.codigo, text: m.rotulo }))]);
    const det = el('textarea', { id: novoId('det'), rows: '3', maxlength: '280' });
    const erroSel = el('p', { class: 'p-erro-campo', 'aria-live': 'polite' });
    const erroDet = el('p', { class: 'p-erro-campo', 'aria-live': 'polite' });
    const sem = !motivos.length;
    const corpo = el('div', { style: 'display:flex;flex-direction:column;gap:12px' }, [
      explicacao ? el('p', { class: 'p-sec', text: explicacao }) : null,
      sem ? null : el('div', { class: 'p-campo' }, [el('label', { for: sel.id, text: 'Motivo' }), sel, erroSel]),
      el('div', { class: 'p-campo' }, [el('label', { for: det.id, text: sem ? 'Motivo' : 'Detalhe (vai junto da mensagem, se houver)' }), det, erroDet]),
      consequencia ? el('p', { class: 'p-consequencia', text: consequencia }) : null,
    ]);
    modal({
      titulo, corpo, aoFechar: () => { if (!decidiu) ok(null); },
      botoes: (fechar) => [botao('Voltar', { aoClicar: () => fechar() }), botao(rotuloConfirmar, { tom, aoClicar: () => {
        const m = motivos.find((x) => x.codigo === sel.value);
        const d = det.value.trim().replace(/\s+/g, ' ');
        erroSel.textContent = !sem && !m ? 'Escolha o motivo' : '';
        const precisaDet = sem || detalheObrigatorio || m?.codigo === 'outro';
        erroDet.textContent = precisaDet && d.length < 3 ? 'Escreva o motivo' : '';
        if ((!sem && !m) || (precisaDet && d.length < 3)) { (!sem && !m ? sel : det).focus(); return; }
        decidiu = true; fechar();
        ok({ codigo: m?.codigo || null, rotulo: m?.rotulo || '', detalhe: d, texto: m ? (d ? `${m.rotulo}: ${d}` : m.rotulo) : d });
      } })],
    });
  });
}

/** Painel lateral de detalhe (tela cheia no celular). Devolve fechar(). */
export function painelLateral({ titulo, corpo, aoFechar }) {
  const tId = novoId('lateral');
  const caixa = el('aside', { class: 'p-lateral', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': tId });
  const fundo = el('div', { class: 'p-lateral-fundo' });
  let fechar = () => {};
  const x = botao('Fechar', { ic: 'fechar', soIcone: true, tom: 'discreto', aoClicar: () => fechar() });
  trocar(caixa, el('div', { class: 'p-lateral-cab' }, [el('h2', { id: tId, text: titulo, tabindex: '-1' }), x]), el('div', { class: 'p-lateral-corpo' }, [corpo]));
  fechar = sobrepor(caixa, fundo, { aoFechar });
  return fechar;
}

// ---------------------------------------------------------------- gráficos leves (SVG + tabela alternativa)

const CORES = ['#2A2456', '#AD8A55', '#6F69A8', '#E2A07A', '#B9B4DA', '#D9D4CE'];

/** Anel de progresso (meta). */
export function anel(pct, { rotulo = 'da meta' } = {}) {
  const r = 52; const c = 2 * Math.PI * r; const p = Math.max(0, Math.min(1, pct / 100));
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 120 120'); s.setAttribute('aria-hidden', 'true');
  for (const [cor, dash] of [['#F0EDE9', c], ['#AD8A55', c * p]]) {
    const ci = document.createElementNS(s.namespaceURI, 'circle');
    Object.entries({ cx: 60, cy: 60, r, fill: 'none', stroke: cor, 'stroke-width': 12, 'stroke-linecap': 'round', 'stroke-dasharray': `${dash} ${c}` }).forEach(([k, v]) => ci.setAttribute(k, v));
    if (dash === 0) continue;
    s.append(ci);
  }
  return el('div', { class: 'p-anel', role: 'img', 'aria-label': `${Math.round(pct)}% ${rotulo}` }, [s, el('div', { class: 'p-anel-txt', 'aria-hidden': 'true' }, [el('strong', { text: `${Math.round(pct)}%` }), el('span', { text: rotulo })])]);
}

/** Rosca com legenda; a tabela alternativa fica num <details> pra leitor de tela e conferência. dados: [{rotulo, valor}] */
export function rosca(dados, { centro, centroRotulo, titulo }) {
  const total = dados.reduce((s, d) => s + d.valor, 0);
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 132 132'); s.setAttribute('aria-hidden', 'true');
  const r = 50; const c = 2 * Math.PI * r; let ac = 0;
  const base = document.createElementNS(s.namespaceURI, 'circle');
  Object.entries({ cx: 66, cy: 66, r, fill: 'none', stroke: '#F0EDE9', 'stroke-width': 18 }).forEach(([k, v]) => base.setAttribute(k, v));
  s.append(base);
  dados.forEach((d, i) => {
    if (!total || !d.valor) return;
    const ci = document.createElementNS(s.namespaceURI, 'circle');
    const len = (d.valor / total) * c;
    Object.entries({ cx: 66, cy: 66, r, fill: 'none', stroke: CORES[i % CORES.length], 'stroke-width': 18, 'stroke-dasharray': `${len} ${c - len}`, 'stroke-dashoffset': String(-ac), transform: 'rotate(-90 66 66)' }).forEach(([k, v]) => ci.setAttribute(k, v));
    s.append(ci); ac += len;
  });
  const t1 = document.createElementNS(s.namespaceURI, 'text');
  Object.entries({ x: 66, y: 66, 'text-anchor': 'middle', 'font-size': 26, 'font-weight': 600, fill: '#2A2456' }).forEach(([k, v]) => t1.setAttribute(k, v));
  t1.textContent = String(centro ?? total);
  const t2 = document.createElementNS(s.namespaceURI, 'text');
  Object.entries({ x: 66, y: 86, 'text-anchor': 'middle', 'font-size': 12, fill: '#5C5853' }).forEach(([k, v]) => t2.setAttribute(k, v));
  t2.textContent = centroRotulo || '';
  s.append(t1, t2);
  const pct = (v) => (total ? Math.round((v / total) * 100) : 0);
  return el('div', {}, [
    el('div', { class: 'p-rosca' }, [s, el('ul', { class: 'p-legenda' }, dados.map((d, i) => el('li', {}, [el('i', { style: `background:${CORES[i % CORES.length]}` }), el('span', { text: d.rotulo }), el('span', { class: 'p-num p-sec', text: `${d.valor} (${pct(d.valor)}%)` })])))]),
    el('details', { class: 'p-tabela-alt' }, [el('summary', { text: 'Ver em tabela' }), el('table', { class: 'p-tabela', 'aria-label': titulo }, [
      el('thead', {}, [el('tr', {}, [el('th', { text: 'Motivo' }), el('th', { class: 'p-dinheiro', text: 'Quantidade' }), el('th', { class: 'p-dinheiro', text: '%' })])]),
      el('tbody', {}, dados.map((d) => el('tr', {}, [el('td', { text: d.rotulo }), el('td', { class: 'p-dinheiro', text: String(d.valor) }), el('td', { class: 'p-dinheiro', text: `${pct(d.valor)}%` })]))),
    ])]),
  ]);
}

/** Barras horizontais com percentual; aoClicar(rotulo) torna o nome um botão (cidade abre bairros). dados: [{rotulo, valor}] */
export function barras(dados, { aoClicar, rotuloColuna = 'Local' } = {}) {
  const total = dados.reduce((s, d) => s + d.valor, 0) || 1;
  const max = Math.max(...dados.map((d) => d.valor), 1);
  return el('ul', { class: 'p-barras', 'aria-label': rotuloColuna }, dados.map((d) => el('li', {}, [
    aoClicar ? el('button', { type: 'button', text: d.rotulo, title: `Ver bairros de ${d.rotulo}`, on: { click: () => aoClicar(d.rotulo) } }) : el('span', { text: d.rotulo }),
    el('span', { class: 'p-barra', 'aria-hidden': 'true' }, [el('i', { style: `width:${Math.round((d.valor / max) * 100)}%` })]),
    el('span', { class: 'p-num p-sec', style: 'text-align:right', text: `${Math.round((d.valor / total) * 100)}%`, 'aria-label': `${d.valor} diárias, ${Math.round((d.valor / total) * 100)}%` }),
  ])));
}
