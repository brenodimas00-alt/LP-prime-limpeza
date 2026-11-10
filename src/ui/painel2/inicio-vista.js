// Início do painel a partir da referência da cliente (dashboard-isa.png; medidas em docs/painel-referencia.md).
// Vista PURA: recebe um modelo pronto (vm) e devolve o DOM. A maquete (_dev/inicio-maquete) usa um modelo fixo igual
// à imagem; a tela real monta o mesmo modelo a partir dos dados (inicio.js). Assim as duas não divergem.
// Dado externo só por textContent/atributos (el). Gráficos em SVG desenhados aqui, com tabela pra leitor de tela.
import { el } from '../dom.js';
import { icone } from './icones.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}, filhos = []) => { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) e.setAttribute(k, String(v)); for (const f of filhos) e.append(f); return e; };
const ic = (nome, cls = '') => el('span', { class: `pn-ic ${cls}`.trim(), 'aria-hidden': 'true' }, [icone(nome, { pequeno: true })]);
const ICONE_SERVICO = { residencial: ['casa', 'pn-casa'], empresarial: ['predio', 'pn-predio'], passadoria: ['ferro', 'pn-ferro'], pre_pos_evento: ['festa', 'pn-festa'], pre_pos_mudanca: ['caixa', 'pn-casa'], pos_obra: ['vassoura', 'pn-casa'] };
const NOME_SERVICO = { residencial: 'Residencial', empresarial: 'Empresarial', passadoria: 'Passadoria', pre_pos_evento: 'Pré e pós-evento', pre_pos_mudanca: 'Pré e pós-mudança', pos_obra: 'Pós-obra' };
const ORIGEM = { instagram: ['instagram', 'pn-insta'], google: ['google', 'pn-google'], indicacao: ['equipe', 'pn-indica'], whatsapp: ['whatsapp', 'pn-zap'], outro: ['ponto', ''] };

const avatar = (src, nome, cls = '') => el('img', { class: `pn-avatar ${cls}`.trim(), src, alt: '', width: '36', height: '36', loading: 'lazy', title: nome || null });
const zap = (nome) => el('span', { class: 'pn-zap', role: 'img', 'aria-label': `WhatsApp de ${nome}` }, [icone('whatsapp', { pequeno: true })]);
const habilidades = (lista = []) => el('span', { class: 'pn-hab', 'aria-label': `Habilidades: ${lista.map((h) => NOME_SERVICO[h] || h).join(', ')}` }, lista.slice(0, 2).map((h, i) => el('span', { class: i ? 'pn-hab-2' : 'pn-hab-1' }, [icone(h === 'passadoria' ? 'ferro' : 'vassoura', { pequeno: true })])));
const btnIcone = (nome, rotulo, cls = '') => el('button', { type: 'button', class: `pn-btn-ic ${cls}`.trim(), 'aria-label': rotulo }, [icone(nome, { pequeno: true })]);
const recolher = (rot) => el('button', { type: 'button', class: 'pn-recolher', 'aria-expanded': 'true', 'aria-label': `Recolher ${rot}` }, [icone('acima', { pequeno: true })]);

/** Cabeçalho de bloco: ícone em círculo tingido, título em serifa, extras à direita. */
function cabecalho({ ico, tom = 'erro', titulo, contagem, sub, extra = [], direita = [], id }) {
  return el('header', { class: 'pn-bloco-cab' }, [
    el('span', { class: `pn-bloco-ic pn-tom-${tom}`, 'aria-hidden': 'true' }, [icone(ico)]),
    el('div', { class: 'pn-bloco-tit' }, [
      el('h2', { id }, [titulo, contagem !== undefined && contagem !== null ? el('span', { class: 'pn-bloco-n', text: ` (${contagem})` }) : null]),
      ...extra,
      sub ? el('p', { class: 'pn-bloco-sub', text: sub }) : null,
    ]),
    el('div', { class: 'pn-bloco-dir' }, direita),
  ]);
}
const bloco = (nome, conteudo, cls = '') => el('section', { class: `pn-bloco ${cls}`.trim(), dataset: { bloco: nome }, 'aria-labelledby': `pn-t-${nome}` }, conteudo);
const verTodas = (texto, href = '#') => el('a', { class: 'pn-ver', href }, [texto, icone('seta', { pequeno: true })]);

// ================================================================ casca: menu e topo
export function menuVista({ atual = 'inicio', contadores = {}, logo }) {
  const itens = [['inicio', 'Início', 'casa'], ['solicitacoes', 'Solicitações', 'calendario_d'], ['agenda', 'Agenda & Escala', 'agenda'], ['clientes', 'Clientes', 'usuario'], ['profissionais', 'Profissionais', 'equipe'], ['financeiro', 'Financeiro', 'dolar'], ['gestao', 'Gestão', 'grafico']];
  return el('nav', { class: 'pn-menu', 'aria-label': 'Menu do painel', dataset: { bloco: 'menu' } }, [
    el('a', { class: 'pn-marca', href: '#', 'aria-label': 'Prime Limpeza Especializada, Início' }, [el('img', { src: logo, alt: '', width: '128', height: '90' })]),
    el('ul', { class: 'pn-menu-lista' }, itens.map(([k, rot, ico]) => el('li', {}, [el('a', { class: 'pn-menu-item', href: '#', 'aria-current': k === atual ? 'page' : null }, [
      icone(ico), el('span', { class: 'pn-menu-rot', text: rot }),
      contadores[k] ? el('span', { class: 'pn-cont', 'aria-label': `${contadores[k]} novas`, text: String(contadores[k]) }) : null,
      k === 'gestao' ? el('span', { class: 'pn-menu-seta', 'aria-hidden': 'true' }, [icone('abaixo', { pequeno: true })]) : null,
    ])]))),
    el('div', { class: 'pn-folhagem', 'aria-hidden': 'true' }),
    el('p', { class: 'pn-frase' }, ['Mais que diárias,', el('br'), 'tranquilidade.', el('span', { class: 'pn-frase-coroa' }, [icone('coroa_c')])]),
  ]);
}

export function topoVista({ usuaria, sino = 0 }) {
  return el('header', { class: 'pn-topo', dataset: { bloco: 'topo' } }, [
    el('label', { class: 'pn-busca' }, [icone('busca'), el('span', { class: 'p-sr', text: 'Buscar' }), el('input', { type: 'search', placeholder: 'Buscar cliente, profissional, solicitação, endereço, telefone...' })]),
    el('div', { class: 'pn-topo-acoes' }, [
      el('a', { class: 'pn-topo-ic', href: '#', 'aria-label': `Pendências: ${sino}` }, [icone('sino'), sino ? el('span', { class: 'pn-sino-n', text: String(sino) }) : null]),
      el('a', { class: 'pn-topo-ic', href: '#', 'aria-label': 'Ajuda' }, [icone('ajuda')]),
      el('button', { type: 'button', class: 'pn-usuaria', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, [
        avatar(usuaria.avatar, usuaria.nome, 'pn-avatar-g'), el('span', {}, [el('b', { text: usuaria.nome }), el('small', { text: usuaria.papel })]), icone('abaixo', { pequeno: true })]),
    ]),
  ]);
}

// ================================================================ Início
export function inicioVista(vm) {
  return el('div', { class: 'pn-inicio' }, [
    el('div', { class: 'pn-faixa' }, [
      el('div', { class: 'pn-saudacao', dataset: { bloco: 'saudacao' } }, [
        el('h1', {}, [el('span', { class: 'pn-sau-txt', text: vm.saudacao }), el('span', { class: 'pn-coroa' }, [icone('coroa_c')])]),
        el('p', {}, [vm.frase, el('span', { class: 'pn-brilho' }, [icone('brilho', { pequeno: true })])]),
      ]),
      el('button', { type: 'button', class: 'pn-sistema', 'aria-expanded': 'false', dataset: { bloco: 'sistema' } }, [
        el('span', { class: 'pn-sistema-ic', 'aria-hidden': 'true' }, [icone('estrela')]),
        el('span', { class: 'pn-sistema-txt' }, [el('b', { text: 'Sistema trabalhando por você' }), el('small', {}, [el('span', { class: 'pn-ponto pn-ponto-ok' }), `${vm.sistema.total} ações automáticas hoje`])]),
        el('span', { class: 'pn-chev' }, [icone('abaixo', { pequeno: true })]),
      ]),
      el('button', { type: 'button', class: 'pn-data', dataset: { bloco: 'data' } }, [
        el('span', { class: 'pn-data-ic', 'aria-hidden': 'true' }, [icone('calendario_d')]),
        el('span', {}, [vm.data.dia, el('br'), vm.data.extenso]),
        el('span', { class: 'pn-chev' }, [icone('abaixo', { pequeno: true })]),
      ]),
    ]),
    blocoSolicitacoes(vm.solicitacoes),
    el('div', { class: 'pn-linha pn-linha-2' }, [blocoDiarias('hoje', vm.hoje), blocoDiarias('amanha', vm.amanha)]),
    el('div', { class: 'pn-linha pn-linha-3' }, [blocoPrecisa(vm.precisa), blocoStandby(vm.standby), blocoAlertas(vm.alertas), blocoCadastros(vm.cadastros)].filter(Boolean)),
    el('div', { class: 'pn-linha pn-linha-4' }, [blocoMeta(vm.meta), blocoMotivos(vm.motivos), blocoRegioes(vm.regioes)]),
  ]);
}

// ---------------------------------------------------------------- Solicitações novas
function blocoSolicitacoes(d) {
  const linhas = d.itens.map((x) => el('tr', {}, [
    el('td', { class: 'pn-c-exp' }, [btnIcone('direita', `Ver detalhes da solicitação de ${x.cliente}`, 'pn-exp')]),
    el('td', { class: 'pn-c-data' }, [x.data, el('br'), x.hora]),
    el('td', { class: 'pn-c-cli' }, [el('span', { class: 'pn-pessoa' }, [avatar(x.avatar, x.cliente), el('span', { class: 'pn-nome', text: x.cliente }), zap(x.cliente)])]),
    el('td', { class: 'pn-c-local' }, [ic('local', 'pn-local'), x.local]),
    el('td', { class: 'pn-c-serv' }, [ic(ICONE_SERVICO[x.servico][0], ICONE_SERVICO[x.servico][1]), el('span', { class: 'pn-nome', text: NOME_SERVICO[x.servico] })]),
    el('td', { class: 'pn-c-imovel' }, [ic('celular', 'pn-imovel'), el('span', { class: 'pn-2l' }, [el('span', { text: x.imovel[0] }), el('small', { text: x.imovel[1] })])]),
    el('td', { class: 'pn-c-horas', text: x.horas }),
    el('td', { class: 'pn-c-valor', text: x.valor }),
    el('td', { class: 'pn-c-origem' }, [ic(ORIGEM[x.origem.tipo][0], ORIGEM[x.origem.tipo][1]), el('span', { class: 'pn-2l' }, [el('span', { text: x.origem.l1 }), x.origem.l2 ? el('span', { text: x.origem.l2 }) : null])]),
    el('td', { class: 'pn-c-acoes' }, [el('span', { class: 'pn-acoes' }, [
      el('button', { type: 'button', class: 'pn-acao pn-aprovar' }, [icone('check', { pequeno: true }), 'Aprovar']),
      el('button', { type: 'button', class: 'pn-acao pn-recusar' }, [icone('fechar', { pequeno: true }), 'Recusar']),
      el('button', { type: 'button', class: 'pn-acao pn-negociar' }, [icone('calendario_d', { pequeno: true }), 'Negociar data']),
      btnIcone('mais', `Mais opções da solicitação de ${x.cliente}`, 'pn-mais'),
    ])]),
  ]));
  return bloco('solicitacoes', [
    cabecalho({ ico: 'documento', titulo: 'Solicitações novas', id: 'pn-t-solicitacoes', extra: [el('span', { class: 'pn-cont pn-cont-tit', text: String(d.total) })], sub: 'Analise, aprove, recuse ou negocie a data das novas solicitações de atendimento.',
      direita: [el('a', { class: 'pn-ver-todas', href: '#' }, ['Ver todas', icone('direita', { pequeno: true })]), recolher('Solicitações novas')] }),
    el('table', { class: 'pn-tabela pn-tab-sol', 'aria-labelledby': 'pn-t-solicitacoes' }, [
      el('thead', {}, [el('tr', {}, [['', 'pn-c-exp'], ['Data / Hora', 'pn-c-data'], ['Cliente', 'pn-c-cli'], ['Local', 'pn-c-local'], ['Serviço', 'pn-c-serv'], ['Imóvel', 'pn-c-imovel'], ['Horas', 'pn-c-horas'], ['Valor', 'pn-c-valor'], ['Origem', 'pn-c-origem'], ['Ações', 'pn-c-acoes']]
        .map(([t, c]) => el('th', { scope: 'col', class: c }, [t ? t : el('span', { class: 'p-sr', text: 'Detalhes' })])))]),
      el('tbody', {}, linhas),
    ]),
  ], 'pn-bloco-sol');
}

// ---------------------------------------------------------------- Diárias de hoje / amanhã
const STATUS = { andamento: 'pn-info', confirmada: 'pn-ok', concluida: 'pn-concluida', pendente: 'pn-pend' };
function blocoDiarias(qual, d) {
  const id = `pn-t-${qual}`;
  const linhas = d.itens.map((x) => el('tr', {}, [
    el('td', { class: 'pn-c-exp' }, qual === 'hoje' ? [btnIcone('direita', `Ver detalhes da diária de ${x.cliente}`, 'pn-exp')] : []),
    el('td', { class: 'pn-c-hora', text: x.hora }),
    el('td', { class: 'pn-c-cli' }, [el('span', { class: 'pn-2l' }, [el('span', { class: 'pn-nome', text: x.cliente }), el('small', {}, [ic('local', 'pn-local'), x.bairro])])]),
    el('td', { class: 'pn-c-serv' }, [ic(ICONE_SERVICO[x.servico][0], ICONE_SERVICO[x.servico][1])]),
    el('td', { class: 'pn-c-horas', text: x.horas }),
    el('td', { class: 'pn-c-prof' }, [el('span', { class: 'pn-pessoa' }, [avatar(x.prof.avatar, x.prof.nome, 'pn-avatar-p'), el('span', { class: 'pn-2l' }, [el('span', { class: 'pn-nome', text: x.prof.nome }), habilidades(x.prof.hab)]), zap(x.prof.nome)])]),
    el('td', { class: 'pn-c-pag' }, [el('span', { class: `pn-selo pn-selo-2l ${x.pago ? 'pn-ok' : 'pn-pend'}` }, [el('span', { text: x.pago ? 'Pago' : 'Pendente' }), el('span', { text: x.forma })])]),
    el('td', { class: 'pn-c-status' }, [x.status === 'concluida'
      ? el('span', { class: 'pn-concluida' }, [el('span', { text: 'Concluída' }), el('span', { class: 'pn-nota' }, [icone('estrela', { pequeno: true }), x.nota])])
      : el('span', { class: `pn-selo ${STATUS[x.status]}`, text: x.rotulo })]),
    el('td', { class: 'pn-c-acoes' }, [el('span', { class: 'pn-acoes' }, [btnIcone('enviar', `Comunicação com ${x.prof.nome}`, 'pn-aviao'), btnIcone('mais', `Mais opções da diária de ${x.cliente}`, 'pn-mais')])]),
  ]));
  return bloco(qual, [
    cabecalho({ ico: 'agenda', tom: 'ouro', titulo: d.titulo, contagem: d.total, id,
      extra: [el('span', { class: 'pn-pontos' }, [el('span', {}, [el('span', { class: 'pn-ponto pn-ponto-ok' }), `${d.confirmadas} confirmadas`]), el('span', { class: 'pn-sep' }), el('span', {}, [el('span', { class: 'pn-ponto pn-ponto-pend' }), `${d.pendentes} ${d.pendentes === 1 ? 'pendente' : 'pendentes'}`])])],
      direita: [el('a', { class: 'pn-ver-todas pn-ver-agenda', href: '#' }, ['Ver agenda completa', icone('seta', { pequeno: true })]), recolher(d.titulo)] }),
    el('table', { class: 'pn-tabela pn-tab-dia', 'aria-labelledby': id }, [
      el('thead', {}, [el('tr', {}, [['', 'pn-c-exp'], ['Horário', 'pn-c-hora'], ['Cliente / Local', 'pn-c-cli'], ['Serviço', 'pn-c-serv'], ['Horas', 'pn-c-horas'], ['Profissional', 'pn-c-prof'], ['Pagamento', 'pn-c-pag'], ['Status', 'pn-c-status'], ['Ações', 'pn-c-acoes']]
        .map(([t, c]) => el('th', { scope: 'col', class: c }, [t || el('span', { class: 'p-sr', text: 'Detalhes' })])))]),
      el('tbody', {}, linhas),
    ]),
  ], `pn-bloco-dia pn-bloco-${qual}`);
}

// ---------------------------------------------------------------- Precisa de você
const TOM_PEND = { erro: 'pn-tom-erro', ouro: 'pn-tom-ouro', aviso: 'pn-tom-aviso' };
function blocoPrecisa(d) {
  return bloco('precisa', [
    cabecalho({ ico: 'calendario_ok', titulo: 'Precisa de você', contagem: d.total, id: 'pn-t-precisa', extra: d.urgentes ? [el('span', { class: 'pn-urgentes', text: `${d.urgentes} urgentes` })] : [], direita: [recolher('Precisa de você')] }),
    el('div', { class: 'pn-precisa' }, [
      el('div', { class: 'pn-abas', role: 'tablist', 'aria-label': 'Filtrar pendências' }, d.abas.map(([rot, n], i) => el('button', { type: 'button', role: 'tab', class: 'pn-aba', 'aria-selected': String(i === 0) }, [el('span', { text: rot }), el('span', { class: 'pn-aba-n', text: String(n) })]))),
      el('ul', { class: 'pn-pend-lista' }, d.itens.map((x) => el('li', { class: x.urgente ? 'pn-urgente' : null }, [
        el('span', { class: `pn-pend-ic ${TOM_PEND[x.tom] || ''}`, 'aria-hidden': 'true' }, [icone(x.ic, { pequeno: true })]),
        el('span', { class: 'pn-2l' }, [el('span', { class: 'pn-nome', text: x.titulo }), el('small', { text: x.sub })]),
        el('span', { class: 'pn-pend-acoes' }, x.acao === 'resolver'
          ? [el('button', { type: 'button', class: 'pn-resolver', text: 'Resolver' })]
          : [btnIcone('check', `${x.titulo}: aprovar`, 'pn-sim'), btnIcone('fechar', `${x.titulo}: recusar`, 'pn-nao')]),
      ]))),
    ]),
    verTodas('Ver todas as pendências'),
  ], 'pn-bloco-precisa');
}

// ---------------------------------------------------------------- Stand-by
function blocoStandby(d) {
  if (!d || !d.itens.length) return null; // só aparece com profissional em stand-by
  return bloco('standby', [
    cabecalho({ ico: 'usuario', tom: 'info', titulo: 'Stand-by de hoje', contagem: d.total, id: 'pn-t-standby', direita: [recolher('Stand-by de hoje')] }),
    el('ul', { class: 'pn-standby' }, d.itens.map((x) => el('li', {}, [
      avatar(x.avatar, x.nome),
      el('span', { class: 'pn-sb-txt' }, [el('span', { class: 'pn-nome', text: x.nome }), el('small', { text: x.horario }), el('span', { class: 'pn-sb-ic' }, [habilidades(x.hab), zap(x.nome)])]),
      el('span', { class: 'pn-sb-acoes' }, [el('button', { type: 'button', class: 'pn-acao pn-aprovar' }, [icone('check', { pequeno: true }), 'Confirmar']), el('button', { type: 'button', class: 'pn-acao pn-recusar' }, [icone('fechar', { pequeno: true }), 'Liberar'])]),
    ]))),
    verTodas('Ver todas'),
  ], 'pn-bloco-standby');
}

// ---------------------------------------------------------------- Alertas importantes
function blocoAlertas(d) {
  if (!d || !d.itens.length) return null;
  return bloco('alertas', [
    cabecalho({ ico: 'sino', titulo: 'Alertas importantes', contagem: d.total, id: 'pn-t-alertas', direita: [recolher('Alertas importantes')] }),
    el('ul', { class: 'pn-alertas' }, d.itens.map((x) => el('li', {}, [el('a', { href: '#' }, [
      el('span', { class: `pn-alerta-ic ${x.tom === 'erro' ? 'pn-tom-erro' : 'pn-tom-ouro'}`, 'aria-hidden': 'true' }, [icone(x.ic, { pequeno: true })]),
      el('span', { class: 'pn-2l' }, [el('span', { class: 'pn-nome' }, [x.titulo, x.nota ? el('span', { class: 'pn-nota-baixa' }, [icone('estrela', { pequeno: true }), x.nota]) : null]), x.sub ? el('small', { text: x.sub }) : null]),
      el('span', { class: 'pn-alerta-seta' }, [icone('direita', { pequeno: true })]),
    ])]))),
    verTodas('Ver todas'),
  ], 'pn-bloco-alertas');
}

// ---------------------------------------------------------------- Novos cadastros
function blocoCadastros(d) {
  if (!d || !d.itens.length) return null;
  return bloco('cadastros', [
    cabecalho({ ico: 'usuario', tom: 'info', titulo: 'Novos cadastros', contagem: d.total, id: 'pn-t-cadastros', direita: [recolher('Novos cadastros')] }),
    el('ul', { class: 'pn-cadastros' }, d.itens.map((x) => el('li', {}, [
      ic('usuario', 'pn-cad-ic'), el('span', { class: 'pn-2l' }, [el('span', { class: 'pn-nome', text: x.nome }), el('small', { text: x.local })]), zap(x.nome), el('span', { class: 'pn-quando', text: x.quando }),
    ]))),
    verTodas('Ver todos'),
  ], 'pn-bloco-cadastros');
}

// ---------------------------------------------------------------- Meta de diárias (anel)
function anel(pct, { raio = 45, esp = 12, tam = 104 } = {}) {
  const c = 2 * Math.PI * raio; const v = Math.max(0, Math.min(100, pct)); // o anel para em 100%
  const id = `pn-g-${Math.random().toString(36).slice(2, 7)}`;
  return s('svg', { class: 'pn-anel', viewBox: `0 0 ${tam} ${tam}`, width: tam, height: tam, 'aria-hidden': 'true' }, [
    s('defs', {}, [s('linearGradient', { id, x1: '0', y1: '0', x2: '1', y2: '1' }, [s('stop', { offset: '0', 'stop-color': 'var(--pn-meta-2)' }), s('stop', { offset: '1', 'stop-color': 'var(--pn-meta-1)' })])]),
    s('circle', { cx: tam / 2, cy: tam / 2, r: raio, fill: 'none', stroke: 'var(--pn-trilho)', 'stroke-width': esp }),
    s('circle', { cx: tam / 2, cy: tam / 2, r: raio, fill: 'none', stroke: `url(#${id})`, 'stroke-width': esp, 'stroke-linecap': 'round', 'stroke-dasharray': `${(v / 100) * c} ${c}`, transform: `rotate(-90 ${tam / 2} ${tam / 2})` }),
  ]);
}
function blocoMeta(d) {
  // como na referência: 86% = (96 realizadas + 58 agendadas) / 179 da meta; faltam 179 - 96 - 58 = 25
  const pct = d.meta ? Math.round(((d.realizadas + d.agendadas) / d.meta) * 100) : 0;
  return bloco('meta', [
    cabecalho({ ico: 'meta', tom: 'ouro', titulo: `Meta de diárias · ${d.mes}`, id: 'pn-t-meta', direita: [recolher('Meta de diárias')] }),
    el('div', { class: 'pn-meta' }, [
      el('div', { class: 'pn-anel-caixa', role: 'img', 'aria-label': `${pct}% da meta` }, [anel(pct), el('span', { class: 'pn-anel-n' }, [el('b', { text: `${pct}%` }), el('small', { text: 'da meta' })])]),
      el('div', { class: 'pn-meta-dir' }, [
        el('p', { class: 'pn-meta-regra' }, ['Meta: ', el('b', { text: `+${d.percentual}%` }), ` sobre ${d.anterior}`]),
        el('dl', { class: 'pn-meta-n' }, [[d.rotAnterior, d.base], [`Meta ${d.mes.toLowerCase()}`, d.meta], ['Realizadas', d.realizadas], ['Agendadas', d.agendadas]].map(([k, v]) => el('div', {}, [el('dt', { text: k }), el('dd', { text: String(v) })]))),
        el('div', { class: 'pn-meta-barra', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.min(pct, 100)), 'aria-label': 'Progresso da meta' }, [el('span', { style: `width:${Math.min(pct, 100)}%` })]),
        el('p', { class: 'pn-meta-falta' }, [el('span', { class: 'pn-coroa-p' }, [icone('coroa_c', { pequeno: true })]), `Faltam ${d.faltam} diárias para atingir a meta.`]),
      ]),
    ]),
  ], 'pn-bloco-meta');
}

// ---------------------------------------------------------------- Motivos de cancelamento (rosca)
const COR_G = ['var(--pn-g1)', 'var(--pn-g2)', 'var(--pn-g3)', 'var(--pn-g4)', 'var(--pn-g5)'];
function rosca(itens, { raio = 39, esp = 16, tam = 108, folga = 1.2 } = {}) {
  const c = 2 * Math.PI * raio; const total = itens.reduce((t, x) => t + x[1], 0) || 1; let acc = 0;
  return s('svg', { class: 'pn-rosca', viewBox: `0 0 ${tam} ${tam}`, width: tam, height: tam, 'aria-hidden': 'true' }, itens.map(([rot, n], i) => {
    const frac = n / total; const ini = acc; acc += frac;
    const t = s('title', {}, []); t.textContent = `${rot}: ${n}`;
    return s('circle', { cx: tam / 2, cy: tam / 2, r: raio, fill: 'none', stroke: COR_G[i % COR_G.length], 'stroke-width': esp,
      'stroke-dasharray': `${Math.max(frac * c - folga, 0.1)} ${c}`, 'stroke-dashoffset': String(-ini * c), transform: `rotate(-90 ${tam / 2} ${tam / 2})` }, [t]);
  }));
}
function blocoMotivos(d) {
  const total = d.itens.reduce((t, x) => t + x[1], 0);
  return bloco('motivos', [
    cabecalho({ ico: 'calendario_x', titulo: 'Motivos de cancelamento', id: 'pn-t-motivos', direita: [el('button', { type: 'button', class: 'pn-periodo', 'aria-haspopup': 'listbox' }, [d.periodo, icone('abaixo', { pequeno: true })])] }),
    el('div', { class: 'pn-graf' }, [
      el('div', { class: 'pn-rosca-caixa' }, [rosca(d.itens), el('span', { class: 'pn-anel-n' }, [el('b', { text: String(total) }), el('small', { text: total === 1 ? 'diária' : 'diárias' })])]),
      el('table', { class: 'pn-legenda' }, [el('caption', { class: 'p-sr', text: 'Motivos de cancelamento no período' }), el('tbody', {}, d.itens.map(([rot, n], i) => el('tr', {}, [
        el('th', { scope: 'row' }, [el('span', { class: 'pn-leg-ponto', style: `background:${COR_G[i % COR_G.length]}` }), rot]),
        el('td', { text: `${n} (${Math.round((n / (total || 1)) * 100)}%)` }),
      ])))]),
    ]),
  ], 'pn-bloco-motivos');
}

// ---------------------------------------------------------------- Regiões mais atendidas (barras)
function blocoRegioes(d) {
  return bloco('regioes', [
    cabecalho({ ico: 'local', tom: 'ouro', titulo: 'Regiões mais atendidas', id: 'pn-t-regioes', direita: [el('div', { class: 'pn-toggle', role: 'tablist', 'aria-label': 'Ver por' }, [
      el('button', { type: 'button', role: 'tab', 'aria-selected': String(d.aba === 'cidades'), text: 'Cidades' }), el('button', { type: 'button', role: 'tab', 'aria-selected': String(d.aba === 'bairros'), text: 'Bairros' })])] }),
    el('table', { class: 'pn-barras' }, [el('caption', { class: 'p-sr', text: 'Regiões mais atendidas no mês, em porcentagem' }), el('tbody', {}, d.itens.map(([rot, pct]) => el('tr', {}, [
      el('th', { scope: 'row', text: rot }),
      el('td', { class: 'pn-barra-cel', 'aria-hidden': 'true' }, [el('span', { class: 'pn-barra' }, [el('span', { style: `width:${pct}%` })])]),
      el('td', { class: 'pn-barra-pct', text: `${pct}%` }),
    ])))]),
  ], 'pn-bloco-regioes');
}
