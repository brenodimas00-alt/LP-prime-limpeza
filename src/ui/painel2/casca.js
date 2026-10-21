// Casca do painel v2 (B2): menu lateral (computador) e inferior com "Mais" (celular), topo com busca única, sino,
// ajuda, usuária com o papel e a data. Sem o cabeçalho e o rodapé do site: o painel é ferramenta de trabalho.
import { el, trocar } from '../dom.js';
import { url } from '../../config/app.js';
import { api } from '../../services/api.js';
import { auth } from '../../services/auth.js';
import { linkTrocarArea } from '../escolha-area.js';
import { formatarData, NOMES_DIA, diaDaSemana } from '../../domain/calendario.js';
import { icone } from './icones.js';
import { contador, guardado, prenderFoco, botao } from './componentes.js';

/** Telas e seções. `abas` = abas antigas que viram seções (o roteador aceita ?aba= antigo e acha a tela). */
export const TELAS = {
  inicio: { rotulo: 'Início', ic: 'inicio' },
  solicitacoes: { rotulo: 'Solicitações', ic: 'solicitacoes' },
  agenda: { rotulo: 'Agenda e escala', curto: 'Agenda', ic: 'agenda' },
  clientes: { rotulo: 'Clientes', ic: 'clientes' },
  profissionais: { rotulo: 'Profissionais', ic: 'profissionais' },
  financeiro: { rotulo: 'Financeiro', ic: 'financeiro' },
  gestao: { rotulo: 'Gestão', ic: 'gestao' },
};
export const GESTAO = [['indicadores', 'Indicadores', 'gestao'], ['automacoes', 'Automações', 'robo'], ['configuracoes', 'Configurações', 'config'], ['ajuda', 'Ajuda', 'ajuda']];
const PAPEL = { prime_admin: 'Administradora', prime_atendimento: 'Atendimento' };

const hrefTela = (tela, extra = {}) => url('painel/', { tela, ...extra });

export function montarCasca({ tela, sec, sessao, hoje }) {
  document.body.className = 'p-app';
  document.body.dataset.densidade = 'painel';
  const conteudo = el('main', { class: 'p-conteudo', id: 'conteudo', tabindex: '-1' });
  const contSol = el('span', { class: 'p-cont' });
  const contSolBaixo = el('span');

  // ---------- menu lateral
  const subId = 'p-sub-gestao';
  const gestaoAberta = tela === 'gestao' || guardado.ler('menu.gestao') === '1';
  const btnGestao = el('button', { type: 'button', class: 'p-menu-item', 'aria-expanded': String(gestaoAberta), 'aria-controls': subId, 'aria-current': tela === 'gestao' && !sec ? 'page' : null },
    [icone('gestao'), 'Gestão', el('span', { class: 'p-cont' }, [icone(gestaoAberta ? 'acima' : 'abaixo', { pequeno: true })])]);
  const sub = el('ul', { class: 'p-submenu', id: subId, hidden: !gestaoAberta }, GESTAO.map(([k, r]) => el('li', {}, [el('a', { class: 'p-menu-item', href: hrefTela('gestao', { sec: k }), 'aria-current': tela === 'gestao' && sec === k ? 'page' : null, text: r })])));
  btnGestao.addEventListener('click', () => {
    const abrir = sub.hidden; sub.hidden = !abrir; btnGestao.setAttribute('aria-expanded', String(abrir));
    trocar(btnGestao.lastChild, icone(abrir ? 'acima' : 'abaixo', { pequeno: true }));
    guardado.gravar('menu.gestao', abrir ? '1' : null);
  });
  const itens = Object.entries(TELAS).filter(([k]) => k !== 'gestao').map(([k, t]) => el('li', {}, [el('a', { class: 'p-menu-item', href: hrefTela(k), 'aria-current': tela === k ? 'page' : null }, [icone(t.ic), t.rotulo, k === 'solicitacoes' ? contSol : null])]));
  const sair = el('button', { type: 'button', class: 'p-menu-item' }, [icone('sair'), 'Sair']);
  sair.addEventListener('click', async () => { await auth.sair(); location.href = url(''); });
  const trocarArea = linkTrocarArea(sessao);
  const menu = el('nav', { class: 'p-menu', 'aria-label': 'Menu do painel' }, [
    el('a', { class: 'p-marca', href: hrefTela('inicio') }, [el('img', { src: url('assets/logo.svg'), alt: '', width: '34', height: '30' }), el('span', {}, ['PRIME', el('small', { text: 'Painel da equipe' })])]),
    el('ul', { class: 'p-menu-lista' }, [...itens, el('li', {}, [btnGestao, sub])]),
    el('div', { class: 'p-menu-rodape' }, [trocarArea, sair]),
  ]);

  // ---------- topo
  const busca = montarBusca();
  const sinoCont = el('span', { class: 'contagem contagem-urgente', hidden: true });
  const sino = el('a', { class: 'p-icone-btn', href: hrefTela('inicio', { foco: 'pendencias' }), 'aria-label': 'Pendências' }, [icone('sino'), sinoCont]);
  const ajuda = el('a', { class: 'p-icone-btn p-ajuda-topo', href: hrefTela('gestao', { sec: 'ajuda' }), 'aria-label': 'Ajuda', title: 'Ajuda' }, [icone('ajuda')]);
  const nome = sessao?.nome || 'Equipe Prime';
  const usuario = el('button', { type: 'button', class: 'p-usuario', 'aria-haspopup': 'menu', 'aria-expanded': 'false', title: `${nome} · ${PAPEL[sessao?.papel] || 'Equipe Prime'}` }, [
    el('span', { class: 'p-avatar-circulo', 'aria-hidden': 'true', text: nome.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase() }),
    el('div', {}, [el('strong', { text: nome.split(' ')[0] }), el('small', { text: PAPEL[sessao?.papel] || 'Equipe Prime' })]),
    el('span', { class: 'p-sr', text: 'Conta' }),
  ]);
  const menuConta = el('div', { class: 'p-sistema-lista p-menu-conta', role: 'menu', hidden: true });
  const sair2 = el('button', { type: 'button', class: 'p-menu-item', role: 'menuitem' }, [icone('sair'), 'Sair']);
  sair2.addEventListener('click', async () => { await auth.sair(); location.href = url(''); });
  trocar(menuConta, el('p', { class: 'p-sec u-mb-2', text: `${nome} · ${PAPEL[sessao?.papel] || 'Equipe Prime'}` }), linkTrocarArea(sessao), sair2);
  usuario.addEventListener('click', () => { const abrir = menuConta.hidden; menuConta.hidden = !abrir; usuario.setAttribute('aria-expanded', String(abrir)); if (abrir) menuConta.querySelector('button')?.focus(); });
  menuConta.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { menuConta.hidden = true; usuario.setAttribute('aria-expanded', 'false'); usuario.focus(); } });
  document.addEventListener('click', (ev) => { if (!usuario.contains(ev.target) && !menuConta.contains(ev.target)) { menuConta.hidden = true; usuario.setAttribute('aria-expanded', 'false'); } });
  const conta = el('div', { class: 'p-sistema' }, [usuario, menuConta]);
  const data = el('span', { class: 'p-data', text: hoje ? `${NOMES_DIA[diaDaSemana(hoje)].replace(/^./, (c) => c.toUpperCase())}, ${formatarData(hoje)}` : '' });
  const topo = el('header', { class: 'p-topo' }, [busca.raiz, el('div', { class: 'p-topo-acoes' }, [sino, ajuda, conta, data])]);

  // ---------- menu inferior (celular): 4 telas + "Mais"
  const maisBtn = el('button', { type: 'button', 'aria-haspopup': 'dialog', 'aria-current': ['profissionais', 'financeiro', 'gestao'].includes(tela) ? 'page' : null }, [icone('mais'), 'Mais']);
  maisBtn.addEventListener('click', () => abrirFolha(tela, sec, sessao));
  const barra = el('nav', { class: 'p-barra-inferior', 'aria-label': 'Menu do painel' }, [
    ...['inicio', 'solicitacoes', 'agenda', 'clientes'].map((k) => el('a', { href: hrefTela(k), 'aria-current': tela === k ? 'page' : null }, [icone(TELAS[k].ic), TELAS[k].curto || TELAS[k].rotulo, k === 'solicitacoes' ? contSolBaixo : null])),
    maisBtn,
  ]);

  trocar(document.body, el('a', { class: 'p-pular', href: '#conteudo', text: 'Pular para o conteúdo' }),
    el('div', { class: 'p-casca' }, [el('div', { class: 'p-menu-col' }, [menu]), el('div', { class: 'p-principal' }, [topo, conteudo])]), barra);

  /** Contadores do menu e do sino (anunciados pro leitor de tela pelo rótulo). */
  async function atualizarContadores() {
    try {
      const r = await api.painelResumo();
      const n = r.solicitacoesNovas;
      trocar(contSol, n ? contador(n, { rotulo: `${n} ${n === 1 ? 'solicitação nova' : 'solicitações novas'}` }) : null);
      trocar(contSolBaixo, n ? contador(n, { rotulo: `${n} novas` }) : null);
      const alerta = r.urgentes + n;
      sinoCont.hidden = !alerta; sinoCont.textContent = String(alerta);
      sino.setAttribute('aria-label', alerta ? `${alerta} pendências: ${r.urgentes} ${r.urgentes === 1 ? 'urgente' : 'urgentes'} e ${n} ${n === 1 ? 'solicitação nova' : 'solicitações novas'}` : 'Pendências: nada urgente');
    } catch { /* contador é acessório: a tela continua */ }
  }
  atualizarContadores();
  return { conteudo, atualizarContadores };
}

function abrirFolha(tela, sec, sessao) {
  const fundo = el('div', { class: 'p-folha-fundo' });
  const antes = document.activeElement;
  const fechar = () => { fundo.remove(); folha.remove(); document.removeEventListener('keydown', esc); for (const x of document.querySelectorAll('[inert]')) x.removeAttribute('inert'); antes?.focus(); };
  const esc = (ev) => { if (ev.key === 'Escape') fechar(); else prenderFoco(folha, ev); };
  const item = (href, ic, rot, atual) => el('li', {}, [el('a', { class: 'p-menu-item', href, 'aria-current': atual ? 'page' : null }, [icone(ic), rot])]);
  const sair = el('button', { type: 'button', class: 'p-menu-item' }, [icone('sair'), 'Sair']);
  sair.addEventListener('click', async () => { await auth.sair(); location.href = url(''); });
  const folha = el('div', { class: 'p-folha', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Mais opções' }, [
    el('div', { class: 'u-fim' }, [botao('Fechar', { ic: 'fechar', tom: 'discreto', aoClicar: () => fechar() })]),
    el('ul', { class: 'p-menu-lista' }, [
      item(hrefTela('profissionais'), 'profissionais', 'Profissionais', tela === 'profissionais'),
      item(hrefTela('financeiro'), 'financeiro', 'Financeiro', tela === 'financeiro'),
      ...GESTAO.map(([k, r, ic]) => item(hrefTela('gestao', { sec: k }), ic, r, tela === 'gestao' && sec === k)),
      el('li', {}, [linkTrocarArea(sessao)]), el('li', {}, [sair]),
    ]),
  ]);
  fundo.addEventListener('click', fechar);
  document.addEventListener('keydown', esc);
  document.body.append(fundo, folha);
  document.querySelector('.p-casca')?.setAttribute('inert', '');
  document.querySelector('.p-barra-inferior')?.setAttribute('inert', '');
  folha.querySelector('a')?.focus();
}

/** Busca única no topo (combobox): 3+ letras, espera 300 ms; Enter abre o primeiro; setas navegam; Esc fecha. */
function montarBusca() {
  const lista = el('div', { class: 'p-busca-res', id: 'p-busca-res', role: 'listbox', hidden: true });
  const input = el('input', { type: 'search', id: 'p-busca', autocomplete: 'off', placeholder: 'Buscar cliente, profissional, solicitação, endereço, telefone…', role: 'combobox', 'aria-expanded': 'false', 'aria-controls': 'p-busca-res', 'aria-autocomplete': 'list' });
  const rotulo = el('label', { for: 'p-busca', class: 'p-sr', text: 'Buscar cliente, profissional, solicitação, endereço ou telefone' });
  const raiz = el('div', { class: 'p-busca', role: 'search' }, [rotulo, el('div', { class: 'p-busca-campo' }, [icone('busca'), input]), lista]);
  let timer; let seqBusca = 0; let links = [];
  const fechar = () => { lista.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); };
  const destino = (x) => (x.tipo === 'solicitacao' ? hrefTela('solicitacoes', { pedido: x.id })
    : x.tipo === 'profissional' ? hrefTela('profissionais', { profissional: x.id }) : hrefTela('clientes', { cliente: x.id }));
  const GRUPO = { cliente: 'Clientes', endereco: 'Endereços', profissional: 'Profissionais', solicitacao: 'Solicitações' };
  async function buscar() {
    const t = input.value.trim();
    if (t.length < 3) { ++seqBusca; links = []; fechar(); return; } // busca curta: descarta resultado antigo e resposta pendente
    const meu = ++seqBusca;
    let r;
    try { r = await api.buscarGlobal(t); } catch (e) { r = { itens: [], erro: e }; }
    if (meu !== seqBusca) return; // resposta atrasada de uma busca anterior
    links = r.itens.map((x, i) => el('a', { href: destino(x), role: 'option', id: `p-busca-op-${i}`, 'aria-selected': 'false' }, [icone(x.tipo === 'solicitacao' ? 'solicitacoes' : x.tipo === 'profissional' ? 'profissionais' : x.tipo === 'endereco' ? 'local' : 'clientes', { pequeno: true }), el('span', {}, [el('b', { text: x.titulo }), el('br'), el('span', { class: 'p-sec', text: x.sub || '' })])]));
    const grupos = []; let ultimo = null;
    r.itens.forEach((x, i) => { if (x.tipo !== ultimo) { grupos.push(el('div', { class: 'p-grupo', role: 'presentation', text: GRUPO[x.tipo] })); ultimo = x.tipo; } grupos.push(links[i]); });
    trocar(lista, ...(r.itens.length ? grupos : [el('p', { class: 'p-vazio', role: 'status', text: r.erro ? (r.erro.message || 'Não foi possível buscar agora.') : 'Nada encontrado. Tente pelo nome, telefone, e-mail, endereço ou número da solicitação.' })]));
    lista.hidden = false; input.setAttribute('aria-expanded', 'true');
  }
  let ativo = -1;
  const marcar = (i) => { links.forEach((a, j) => a.setAttribute('aria-selected', String(j === i))); ativo = i; if (links[i]) { input.setAttribute('aria-activedescendant', links[i].id); links[i].scrollIntoView({ block: 'nearest' }); } };
  input.addEventListener('input', () => { clearTimeout(timer); ativo = -1; timer = setTimeout(buscar, 300); });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { fechar(); return; }
    if (ev.key === 'ArrowDown' && links.length) { ev.preventDefault(); marcar(Math.min(ativo + 1, links.length - 1)); }
    if (ev.key === 'ArrowUp' && links.length) { ev.preventDefault(); marcar(Math.max(ativo - 1, 0)); }
    if (ev.key === 'Enter') { ev.preventDefault(); const a = links[ativo >= 0 ? ativo : 0]; if (a) location.href = a.href; else { clearTimeout(timer); buscar(); } }
  });
  document.addEventListener('click', (ev) => { if (!raiz.contains(ev.target)) fechar(); });
  return { raiz };
}
