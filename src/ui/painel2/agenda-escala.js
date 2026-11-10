// Agenda e Escala (spec-agenda-escala-isa, 09/11/2026; imagens em Prime_Limpeza/agenda-escala). Uma tela só pra
// consultar a agenda, distribuir as profissionais, revisar, enviar e acompanhar. Regras em src/domain/escala.js; dados
// por api.agendaEscala (mock e Supabase com a mesma forma, docs/AGENDA-ESCALA.md).
// - Dia: faixa da semana, resumo, busca, Filtros, envio, Stand-by e a tabela agrupada por cidade (RMBH, depois BH).
// - Semana e Período: dias que abrem e fecham, sem subtítulo de cidade; as ações seguem o estado de cada diária.
// - Detalhes num painel à direita (fechado por padrão); popovers (filtros, seletor, menus) um de cada vez.
import { el, trocar, param, hrefSeguro } from '../dom.js';
import { url } from '../../config/app.js';
import { api } from '../../services/api.js';
import { executarAcao, mensagemErro } from '../acoes.js';
import { toast } from '../toast.js';
import { somarDias, diaDaSemana, diferencaDias } from '../../domain/calendario.js';
import {
  statusDaDiaria, acaoDaLinha, semRespostaNoPrazo, agruparPorCidade, elegivelEnvio, ROTULO_STATUS, FILTRO_STATUS, CRITERIOS,
} from '../../domain/escala.js';
import { renderizar } from '../../automacoes/v2/variaveis.js';
import { TEMPLATES } from '../../automacoes/catalogo.js';
import { icone, ICONE_SERVICO } from './icones.js';
import { botao, selo, confirmar, pedirMotivo, modal, esqueleto, erroBloco, vazio, ROTULO_HABILIDADE } from './componentes.js';

const DIAS = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
const CURTO = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const SERVICO = { residencial: 'Residencial', empresarial: 'Comercial', condominial: 'Condominial', passadoria: 'Passadoria', pre_pos_mudanca: 'Pré/pós-mudança', pre_pos_evento: 'Pré/pós-evento', pos_obra: 'Pós-obra' };
const TOM_STATUS = {
  para_revisar: ['selo-atencao', 'relogio'], revisada: ['selo-sucesso', 'check'], aguardando_envio: ['selo-info', 'enviar'], enviada: ['selo-info', 'enviar'],
  aguardando_aceite: ['selo-info', 'ampulheta'], confirmada: ['selo-sucesso', 'ok'], em_andamento: ['selo-info', 'ok'], finalizada: ['selo-sucesso', 'ok'],
  cancelada: ['selo-erro', 'erro'], com_ocorrencia: ['selo-atencao', 'aviso'],
};
const ORIGEM = { fixa: ['Fixa', 'verificado', 'ae-origem-fixa'], sugerida: ['Sugerida', 'lampada', 'ae-origem-sugerida'], manual: ['Manual', 'pessoa', 'ae-origem-manual'] };
const COMUNICADA = ['aguardando_envio', 'enviada', 'aguardando_aceite', 'confirmada'];

const dataLonga = (d) => `${DIAS[diaDaSemana(d)]}, ${Number(d.slice(8))} de ${MESES[Number(d.slice(5, 7)) - 1]} de ${d.slice(0, 4)}`;
const dataMedia = (d) => `${Number(d.slice(8))} de ${MESES[Number(d.slice(5, 7)) - 1]} de ${d.slice(0, 4)}`;
const ddmm = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const horas = (min) => { const h = (min || 0) / 60; return `${String(h).replace('.', ',')} ${h === 1 ? 'hora' : 'horas'}`; };
const fim = (d) => { const [h, m] = (d.horaInicio || '08:00').split(':').map(Number); const t = h * 60 + m + (d.duracaoMinutos || 0); return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
const nota = (n) => (n ? String(n.toFixed ? n.toFixed(1) : n).replace('.', ',') : null);
const primeiro = (n) => String(n || '').split(' ')[0];
const iniciais = (nome = '') => nome.trim().split(/\s+/).filter(Boolean).map((p, i, l) => (i === 0 || i === l.length - 1 ? p[0] : '')).join('').slice(0, 2).toUpperCase() || '?';
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const quando = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) : '');
const segundaDe = (d) => somarDias(d, -((diaDaSemana(d) + 6) % 7));
const rua = (l) => [[l.logradouro, l.numero].filter(Boolean).join(', '), l.complemento].filter(Boolean).join(' - ');
const cidadeUf = (l) => `${l.cidade || ''}${l.uf ? `/${l.uf}` : ''}`;
const imovel = (i) => [i.metragem ? `${i.metragem} m²` : null, i.comodos ? `${i.comodos} ${i.comodos === 1 ? 'cômodo' : 'cômodos'}` : null].filter(Boolean).join(' · ');
const ehAdmin = (s) => !s?.papel || s.papel === 'prime_admin';
const editavelLinha = (d, hoje) => ['agendado', 'confirmado'].includes(d.status) && d.data >= hoje;
const irPara = (params) => { history.replaceState(null, '', url('painel/', { tela: 'agenda', ...params })); };

/** Avatar de iniciais (nunca foto real). */
const avatar = (nome, tam = '') => el('span', { class: `ae-avatar ${tam}`.trim(), 'aria-hidden': 'true', text: iniciais(nome) });
const estrela = (n) => (n ? el('span', { class: 'ae-nota', 'aria-label': `avaliação ${nota(n)} de 5` }, [nota(n), icone('estrela', { pequeno: true })]) : null);
function seloStatus(st, { semResposta = false } = {}) {
  const [cls, ic] = TOM_STATUS[st.codigo] || ['', 'ponto'];
  return el('span', { class: 'ae-status-cel' }, [
    el('span', { class: `selo ae-status ${cls}`, dataset: { status: st.codigo } }, [icone(ic, { pequeno: true }), st.rotulo]),
    semResposta ? el('span', { class: 'ae-alerta-resp', role: 'img', 'aria-label': 'Sem resposta depois do prazo', title: 'Sem resposta depois do prazo configurado' }, [icone('alerta', { pequeno: true })]) : null,
    st.porHorario ? el('span', { class: 'ae-linha2', text: 'pelo horário' }) : null,
  ]);
}
function seloOrigem(o) {
  const x = ORIGEM[o]; if (!x) return null;
  return el('span', { class: `ae-origem ${x[2]}`, title: o === 'fixa' ? 'Profissional fixa do pacote' : o === 'sugerida' ? 'Pré-designada pelo sistema' : 'Escolhida pela equipe' }, [icone(x[1], { pequeno: true }), o === 'fixa' ? 'Fixa (pacote)' : x[0]]);
}
function pagamentoCel(p) {
  const pago = p?.estado === 'pago'; const fat = p?.estado === 'a_faturar';
  return el('span', { class: 'ae-pag' }, [
    el('span', { class: `ae-pag-selo ${pago ? 'ae-pago' : fat ? 'ae-faturar' : 'ae-pendente'}` }, [icone(pago ? 'ok' : fat ? 'recibo' : 'erro', { pequeno: true }), pago ? 'Pago' : fat ? 'A faturar' : 'Pendente']),
    el('span', { class: 'ae-linha2', text: fat ? 'Faturamento' : p?.forma === 'cartao' ? 'Cartão' : 'PIX' }),
  ]);
}

// ---------------------------------------------------------------- popover único (filtros, seletor, menus)
let popAtual = null;
function fecharPopover({ devolverFoco = true } = {}) {
  if (!popAtual) return;
  const { caixa, ancora, limpar } = popAtual; popAtual = null;
  caixa.remove(); limpar();
  ancora?.setAttribute('aria-expanded', 'false');
  if (devolverFoco && ancora?.isConnected) ancora.focus();
}
/** Abre um popover ancorado (no celular vira folha de baixo). Só um aberto por vez. */
function abrirPopover(ancora, { titulo, ic, conteudo, largura = 'medio', papel = 'dialog' }) {
  const mesmo = popAtual?.ancora === ancora;
  fecharPopover({ devolverFoco: false });
  if (mesmo) return null;
  const id = `ae-pop-${Math.random().toString(36).slice(2, 8)}`;
  const fecharBtn = el('button', { type: 'button', class: 'ae-icone-btn', 'aria-label': 'Fechar' }, [icone('fechar')]);
  const caixa = el('div', { class: `ae-pop ae-pop-${largura}`, id, role: papel, 'aria-label': titulo, tabindex: '-1' }, [
    el('div', { class: 'ae-pop-cab' }, [ic ? icone(ic) : null, el('h2', { text: titulo }), fecharBtn]), conteudo,
  ]);
  fecharBtn.addEventListener('click', () => fecharPopover());
  document.body.append(caixa);
  const celular = matchMedia('(max-width: 759px)').matches;
  if (!celular) {
    const r = ancora.getBoundingClientRect(); const w = caixa.offsetWidth;
    const esq = Math.min(Math.max(8, r.right - w), document.documentElement.clientWidth - w - 8);
    caixa.style.left = `${esq + scrollX}px`; caixa.style.top = `${r.bottom + 6 + scrollY}px`; // eslint-disable-line -- posição calculada, não é valor visual
  } else caixa.classList.add('ae-pop-folha');
  // só age se este ainda for o popover aberto (o setTimeout pode cair depois de outro abrir ou deste fechar)
  const atual = () => popAtual?.caixa === caixa;
  const fora = (ev) => { if (atual() && ev.target.isConnected && !caixa.contains(ev.target) && !ancora.contains(ev.target)) fecharPopover({ devolverFoco: false }); };
  const tecla = (ev) => { if (atual() && ev.key === 'Escape') { ev.preventDefault(); fecharPopover(); } };
  setTimeout(() => { if (atual()) document.addEventListener('click', fora); }, 0);
  document.addEventListener('keydown', tecla);
  ancora.setAttribute('aria-expanded', 'true'); ancora.setAttribute('aria-controls', id);
  popAtual = { caixa, ancora, limpar: () => { document.removeEventListener('click', fora); document.removeEventListener('keydown', tecla); } };
  (caixa.querySelector('[autofocus], input, button:not(.ae-icone-btn)') || caixa).focus();
  return caixa;
}
/** Item de menu (botão ou link) com ícone, título e descrição opcional. */
function itemMenu({ ic, titulo, desc, aoClicar, href, perigo = false, desativado = null, externo = false }) {
  const corpo = [el('span', { class: 'ae-menu-ic', 'aria-hidden': 'true' }, [icone(ic)]), el('span', { class: 'ae-menu-txt' }, [el('b', { text: titulo }), desc ? el('span', { text: desc }) : null])];
  const cls = `ae-menu-item${perigo ? ' ae-perigo' : ''}`;
  if (href && !desativado) return el('a', { class: cls, href, role: 'menuitem', ...(externo ? { target: '_blank', rel: 'noopener' } : {}) }, corpo);
  const b = el('button', { type: 'button', class: cls, role: 'menuitem', disabled: !!desativado, title: desativado || null }, corpo);
  if (aoClicar && !desativado) b.addEventListener('click', () => { fecharPopover({ devolverFoco: false }); aoClicar(); });
  return b;
}
const listaMenu = (itens) => el('div', { class: 'ae-menu', role: 'menu' }, itens.filter(Boolean));

// ---------------------------------------------------------------- mensagens prontas (wa.me + registro do contato)
function variaveis(d, extra = {}) {
  return {
    nome: primeiro(d.cliente.nome), data: `${ddmm(d.data)}/${d.data.slice(0, 4)}`, horario: `das ${d.horaInicio} às ${fim(d)}`, carga: horas(d.duracaoMinutos),
    profissional: primeiro(d.profissional?.nome) || 'a profissional', endereco: [rua(d.local), d.local.bairro, d.local.cidade].filter(Boolean).join(', '),
    quando: `${dataMedia(d.data)},`, valor: 'o valor combinado', oque: `diária de ${ddmm(d.data)}`, prazo: '14h do dia anterior', link: url('acompanhamento/'), ...extra,
  };
}
function textoModelo(codigo, vars) {
  try { return renderizar(TEMPLATES[codigo].corpo, vars) || ''; } catch { return ''; }
}
function abrirWhatsApp(telefone, texto, { pedidoId, diaristaId, contexto }) {
  const d = String(telefone || '').replace(/\D/g, '');
  const href = d.length >= 10 ? hrefSeguro(`https://wa.me/55${d.replace(/^55/, '')}${texto ? `?text=${encodeURIComponent(texto)}` : ''}`) : null;
  if (!href) { toast('Sem telefone válido no cadastro.', 'erro'); return; }
  window.open(href, '_blank', 'noopener');
  api.registrarContatoManual({ pedidoId, diaristaId, contexto }, { chave: crypto.randomUUID() }).catch(() => {});
}

// ================================================================ tela
export async function telaAgendaEscala({ sessao, hoje, casca }) {
  const vistaUrl = ['dia', 'semana', 'periodo'].includes(param('vista')) ? param('vista') : 'dia';
  const est = {
    vista: vistaUrl, data: /^\d{4}-\d{2}-\d{2}$/.test(param('data') || '') ? param('data') : hoje,
    de: param('de') || null, ate: param('ate') || null, busca: '', filtros: { status: [], pagamento: '', contratacao: '', profissional: '', servico: '', cidade: '', bairro: '' },
    ordem: 'horario', selecionadas: new Set(), aberta: param('diaria') || null, recolhidos: new Set(), dados: null, contagens: [], carregando: false, seq: 0,
  };
  const raiz = el('div', { class: 'ae' });
  const cab = el('header', { class: 'ae-cab' });
  const corpo = el('div', { class: 'ae-corpo' });
  const lateral = el('aside', { class: 'ae-detalhe', 'aria-label': 'Detalhes da diária', hidden: true });
  trocar(raiz, cab, el('div', { class: 'ae-area' }, [el('div', { class: 'ae-principal' }, [corpo]), lateral]));
  trocar(casca.conteudo, raiz);
  casca.conteudo.classList.add('ae-conteudo');

  const intervalo = () => {
    if (est.vista === 'dia') return [est.data, est.data];
    if (est.vista === 'semana') { const s = segundaDe(est.data); return [s, somarDias(s, 6)]; }
    const de = est.de && /^\d{4}-\d{2}-\d{2}$/.test(est.de) ? est.de : segundaDe(est.data);
    let ate = est.ate && /^\d{4}-\d{2}-\d{2}$/.test(est.ate) && est.ate >= de ? est.ate : somarDias(de, 6);
    if (diferencaDias(de, ate) > 30) ate = somarDias(de, 30);
    return [de, ate];
  };
  const salvarUrl = () => {
    const [de, ate] = intervalo();
    irPara({ vista: est.vista === 'dia' ? null : est.vista, data: est.data, ...(est.vista === 'periodo' ? { de, ate } : {}), diaria: est.aberta || null });
  };

  async function carregar({ preparar = false } = {}) {
    const meu = ++est.seq; const [de, ate] = intervalo();
    if (!est.dados) trocar(corpo, esqueleto(8));
    try {
      if (preparar && ate >= hoje) await api.escalaPreparar({ de: de < hoje ? hoje : de, ate }).catch(() => null); // fixa e sugerida (idempotente, não avisa ninguém)
      const sem = segundaDe(est.data);
      const [dados, cont] = await Promise.all([api.agendaEscala({ de, ate }), est.vista === 'dia' ? api.agendaContagens({ de: sem, ate: somarDias(sem, 6) }) : Promise.resolve({ dias: [] })]);
      if (meu !== est.seq) return; // resposta atrasada de outro dia
      est.dados = dados; est.contagens = cont.dias;
      const ids = new Set(dados.itens.map((x) => x.id));
      for (const s of [...est.selecionadas]) if (!ids.has(s)) est.selecionadas.delete(s);
      render();
      if (est.aberta && ids.has(est.aberta)) abrirDetalhe(est.aberta, { foco: false }); else if (est.aberta) fecharDetalhe();
    } catch (e) { if (meu === est.seq) trocar(corpo, erroBloco(e, () => carregar())); }
  }
  const recarregar = () => { casca.atualizarContadores(); return carregar(); };

  // ---------------------------------------------------------------- filtros e busca (no conjunto consultado)
  const agoraMs = () => Date.parse(est.dados?.agora || new Date().toISOString());
  const stDe = (d) => statusDaDiaria(d, { agoraMs: agoraMs(), ocorrenciaAberta: d.ocorrenciaAberta });
  const semResp = (d) => semRespostaNoPrazo(d, est.dados?.config?.prazoSemRespostaMin, agoraMs());
  function filtrar(itens) {
    const f = est.filtros; const b = semAcento(est.busca.trim());
    return itens.filter((d) => {
      if (b && ![d.cliente.nome, d.profissional?.nome, d.local.logradouro, d.local.bairro, d.local.cidade, d.local.numero].some((x) => semAcento(x).includes(b))) return false;
      if (f.status.length && !f.status.includes(stDe(d).codigo)) return false;
      if (f.pagamento && d.pagamento.estado !== f.pagamento) return false;
      if (f.contratacao === 'pacote' && !d.pacote) return false;
      if (f.contratacao === 'avulsa' && (d.pacote || d.cliente.parceria)) return false;
      if (f.contratacao === 'parceria' && !d.cliente.parceria) return false;
      if (f.profissional && (d.profissional?.id || '') !== f.profissional) return false;
      if (f.servico && d.servico !== f.servico) return false;
      if (f.cidade && d.local.cidade !== f.cidade) return false;
      if (f.bairro && d.local.bairro !== f.bairro) return false;
      return true;
    });
  }
  const nFiltros = () => Object.entries(est.filtros).filter(([, v]) => (Array.isArray(v) ? v.length : v)).length;
  const ordenar = (l) => {
    if (est.ordem === 'cliente') return [...l].sort((a, b) => a.cliente.nome.localeCompare(b.cliente.nome));
    if (est.ordem === 'status') return [...l].sort((a, b) => FILTRO_STATUS.indexOf(stDe(a).codigo) - FILTRO_STATUS.indexOf(stDe(b).codigo) || String(a.horaInicio).localeCompare(String(b.horaInicio)));
    return [...l].sort((a, b) => `${a.data}${a.horaInicio}`.localeCompare(`${b.data}${b.horaInicio}`));
  };

  // ---------------------------------------------------------------- cabeçalho
  function renderCab() {
    const [de, ate] = intervalo();
    const vistas = el('div', { class: 'ae-vistas', role: 'group', 'aria-label': 'Visualização' }, [['dia', 'Dia'], ['semana', 'Semana'], ['periodo', 'Período']].map(([v, r]) => {
      const b = el('button', { type: 'button', class: 'ae-vista', 'aria-pressed': String(est.vista === v), text: r });
      b.addEventListener('click', () => { if (est.vista === v) return; est.vista = v; est.dados = null; fecharDetalhe(); salvarUrl(); renderCab(); carregar({ preparar: true }); });
      return b;
    }));
    const passo = est.vista === 'dia' ? 1 : est.vista === 'semana' ? 7 : diferencaDias(de, ate) + 1;
    const mover = (n) => {
      if (est.vista === 'periodo') { est.de = somarDias(de, n * passo); est.ate = somarDias(ate, n * passo); est.data = est.de; } else est.data = somarDias(est.data, n * passo);
      est.dados = null; fecharDetalhe(); salvarUrl(); renderCab(); carregar({ preparar: true });
    };
    const ant = el('button', { type: 'button', class: 'ae-nav-btn', 'aria-label': est.vista === 'dia' ? 'Dia anterior' : 'Período anterior' }, [icone('esquerda')]);
    const prox = el('button', { type: 'button', class: 'ae-nav-btn', 'aria-label': est.vista === 'dia' ? 'Próximo dia' : 'Próximo período' }, [icone('direita')]);
    ant.addEventListener('click', () => mover(-1)); prox.addEventListener('click', () => mover(1));
    const rotulo = est.vista === 'dia' ? dataLonga(est.data) : `${dataMedia(de)} - ${dataMedia(ate)}`;
    const cal = el('button', { type: 'button', class: 'ae-nav-btn ae-cal-btn', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-label': est.vista === 'periodo' ? 'Escolher o período' : 'Escolher a data' }, [icone('agenda')]);
    cal.addEventListener('click', () => abrirCalendario(cal));
    // como nas imagens: no Dia só a seta de voltar (a faixa da semana avança); em Semana e Período, as duas
    const datas = el('div', { class: `ae-datas${est.vista === 'dia' ? '' : ' ae-datas-intervalo'}` }, [ant, est.vista === 'dia' ? null : prox, el('span', { class: 'ae-data-rot', 'aria-live': 'polite', text: rotulo }), cal]);
    const hojeBtn = el('button', { type: 'button', class: 'ae-hoje', text: 'Hoje' });
    hojeBtn.addEventListener('click', () => { est.data = hoje; est.de = null; est.ate = null; est.dados = null; fecharDetalhe(); salvarUrl(); renderCab(); carregar({ preparar: true }); });
    const canal = est.dados?.config?.canalAtivo || 'whatsapp';
    const indicador = el('span', { class: `ae-canal ${canal === 'portal' ? 'ae-canal-portal' : ''}`.trim(), dataset: { canal }, title: 'A troca de canal é feita pela administração em Gestão > Configurações' }, [
      icone(canal === 'portal' ? 'local' : 'zap'), el('span', {}, [el('b', { text: canal === 'portal' ? 'Portal ativo' : 'WhatsApp ativo' }), el('small', { text: canal === 'portal' ? 'Contingência' : 'Canal principal' })]),
    ]);
    trocar(cab,
      el('div', { class: 'ae-titulo' }, [el('span', { class: 'ae-titulo-ic', 'aria-hidden': 'true' }, [icone('agenda')]), el('div', {}, [el('h1', { text: 'Agenda e Escala' }), el('p', { text: 'Organize, revise e envie as diárias para as profissionais.' })])]),
      el('div', { class: 'ae-cab-controles' }, [vistas, datas, hojeBtn]),
      el('div', { class: 'ae-cab-conta' }, [casca.topoAcoes, indicador]));
  }

  function abrirCalendario(ancora) {
    const [de, ate] = intervalo();
    const erro = el('p', { class: 'p-erro-campo', 'aria-live': 'polite' });
    if (est.vista === 'periodo') {
      const iDe = el('input', { type: 'date', id: 'ae-de', value: de }); const iAte = el('input', { type: 'date', id: 'ae-ate', value: ate });
      const ok = botao('Aplicar período', { tom: 'primario', aoClicar: () => {
        if (!iDe.value || !iAte.value || iAte.value < iDe.value) { erro.textContent = 'O fim precisa ser depois do início'; return; }
        if (diferencaDias(iDe.value, iAte.value) > 30) { erro.textContent = 'Até 31 dias por consulta'; return; }
        est.de = iDe.value; est.ate = iAte.value; est.data = iDe.value; est.dados = null; fecharPopover(); salvarUrl(); renderCab(); carregar({ preparar: true });
      } });
      abrirPopover(ancora, { titulo: 'Período', ic: 'agenda', largura: 'curto', conteudo: el('div', { class: 'ae-pop-corpo' }, [
        el('div', { class: 'campo' }, [el('label', { for: 'ae-de', text: 'De' }), iDe]), el('div', { class: 'campo' }, [el('label', { for: 'ae-ate', text: 'Até' }), iAte]), erro, ok]) });
      return;
    }
    const i = el('input', { type: 'date', id: 'ae-data', value: est.data });
    const ok = botao(est.vista === 'dia' ? 'Ver o dia' : 'Ver a semana', { tom: 'primario', aoClicar: () => {
      if (!i.value) { erro.textContent = 'Escolha a data'; return; }
      est.data = i.value; est.dados = null; fecharPopover(); fecharDetalhe(); salvarUrl(); renderCab(); carregar({ preparar: true });
    } });
    abrirPopover(ancora, { titulo: est.vista === 'dia' ? 'Escolher o dia' : 'Escolher a semana', ic: 'agenda', largura: 'curto', conteudo: el('div', { class: 'ae-pop-corpo' }, [el('div', { class: 'campo' }, [el('label', { for: 'ae-data', text: 'Data' }), i]), erro, ok]) });
  }

  // ---------------------------------------------------------------- corpo
  function render() {
    renderCab();
    const itens = est.dados.itens;
    if (est.vista === 'dia') trocar(corpo, ...renderDia(itens));
    else trocar(corpo, ...renderPeriodo(itens));
  }

  function barraBusca({ comEnvio }) {
    const busca = el('input', { type: 'search', id: 'ae-busca', placeholder: 'Buscar cliente, endereço ou profissional...', value: est.busca, autocomplete: 'off' });
    busca.addEventListener('input', () => { est.busca = busca.value; const pos = busca.selectionStart; render(); const n = document.getElementById('ae-busca'); n?.focus(); n?.setSelectionRange(pos, pos); });
    const nf = nFiltros();
    const filtros = el('button', { type: 'button', class: 'ae-filtros-btn', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' }, [icone('funil'), 'Filtros', nf ? el('span', { class: 'ae-cont', 'aria-label': `${nf} ${nf === 1 ? 'filtro ativo' : 'filtros ativos'}`, text: String(nf) }) : null]);
    filtros.addEventListener('click', () => abrirFiltros(filtros));
    const partes = [el('label', { class: 'ae-busca' }, [icone('busca'), el('span', { class: 'p-sr', text: 'Buscar cliente, endereço ou profissional' }), busca]), filtros];
    if (comEnvio) {
      const revisadas = filtrar(est.dados.itens).filter((d) => elegivelEnvio({ ...d, diaristaId: d.profissional?.id }) && d.data >= hoje);
      const todas = el('button', { type: 'button', class: 'btn btn-p btn-primario ae-enviar-todas', disabled: !revisadas.length, dataset: { acao: 'enviar-todas' } }, [icone('enviar', { pequeno: true }), `Enviar todas as revisadas (${revisadas.length})`]);
      todas.addEventListener('click', async () => {
        if (!(await confirmar({ titulo: 'Enviar as diárias revisadas?', texto: `${revisadas.length} ${revisadas.length === 1 ? 'diária vai' : 'diárias vão'} para as profissionais pelo ${est.dados.config.canalAtivo === 'portal' ? 'Portal' : 'WhatsApp'}, pedindo o aceite. Diária já enviada não é enviada de novo.`, rotuloConfirmar: `Enviar ${revisadas.length} ${revisadas.length === 1 ? 'diária' : 'diárias'}` }))) return;
        enviar(todas, revisadas.map((d) => d.id));
      });
      const n = est.selecionadas.size;
      const sel = el('button', { type: 'button', class: 'btn btn-p btn-secundario ae-enviar-sel', disabled: !n, dataset: { acao: 'enviar-selecionadas' } }, [icone('enviar', { pequeno: true }), `Enviar selecionadas (${n})`]);
      sel.addEventListener('click', async () => {
        if (!(await confirmar({ titulo: 'Enviar as diárias selecionadas?', texto: 'Só as revisadas e ainda não enviadas saem. As outras ficam como estão.', rotuloConfirmar: `Enviar selecionadas (${n})` }))) return;
        enviar(sel, [...est.selecionadas]);
      });
      partes.push(el('span', { class: 'ae-sep', 'aria-hidden': 'true' }), todas, sel);
    }
    return el('div', { class: `ae-barra${comEnvio ? '' : ' ae-barra-periodo'}` }, partes);
  }
  function enviar(b, ids) {
    executarAcao(b, (k) => api.escalaEnviar(ids, { chave: k }), { aoSucesso: (r) => {
      const ign = r.ignoradas || [];
      toast(`${r.enviadas.length} ${r.enviadas.length === 1 ? 'diária enviada' : 'diárias enviadas'}${ign.length ? `. ${ign.length} ${ign.length === 1 ? 'ficou' : 'ficaram'} de fora (${[...new Set(ign.map((x) => x.motivo))].join(', ')})` : ''}.`, r.enviadas.length ? 'ok' : 'info', 6000);
      est.selecionadas.clear(); recarregar();
    } });
  }

  // ---------- Dia
  function renderDia(itensTodos) {
    const sem = segundaDe(est.data);
    const faixa = el('nav', { class: 'ae-semana', 'aria-label': 'Dias da semana' }, [
      navBtn('Semana anterior', 'esquerda', () => { est.data = somarDias(est.data, -7); est.dados = null; salvarUrl(); carregar({ preparar: true }); }),
      el('ol', {}, Array.from({ length: 7 }, (_, i) => {
        const d = somarDias(sem, i); const n = est.contagens.find((x) => x.data === d)?.total ?? 0;
        const b = el('button', { type: 'button', class: 'ae-dia', 'aria-current': d === est.data ? 'date' : null, title: `${DIAS[diaDaSemana(d)]}, ${ddmm(d)}` }, [
          el('span', { text: CURTO[diaDaSemana(d)] }), el('b', { text: d.slice(8) }), el('span', { class: 'p-sr', text: `/${d.slice(5, 7)}` }), el('small', { text: `${n} ${n === 1 ? 'diária' : 'diárias'}` })]);
        b.addEventListener('click', () => { if (d === est.data) return; est.data = d; est.dados = null; fecharDetalhe(); salvarUrl(); carregar({ preparar: true }); });
        return el('li', {}, [b]);
      })),
      navBtn('Próxima semana', 'direita', () => { est.data = somarDias(est.data, 7); est.dados = null; salvarUrl(); carregar({ preparar: true }); }),
    ]);
    const conta = (cod) => itensTodos.filter((d) => stDe(d).codigo === cod).length;
    const resumoItem = (cod, rot, cls) => {
      const n = cod === 'standby' ? est.dados.standby.length : conta(cod);
      const ativo = est.filtros.status.length === 1 && est.filtros.status[0] === cod;
      const ic = { para_revisar: 'relogio', revisada: 'ok', aguardando_aceite: 'ampulheta', com_ocorrencia: 'aviso', standby: 'pessoa' }[cod];
      const b = el('button', { type: 'button', class: `ae-res ${cls}`, 'aria-pressed': String(ativo), disabled: cod === 'standby' || null, title: cod === 'standby' ? null : `Mostrar só ${rot.toLowerCase()}` }, [el('b', {}, [icone(ic, { pequeno: true }), String(n)]), el('span', { text: rot })]);
      if (cod !== 'standby') b.addEventListener('click', () => { est.filtros.status = ativo ? [] : [cod]; render(); });
      return b;
    };
    const resumo = el('section', { class: 'ae-resumo', 'aria-label': 'Resumo do dia' }, [
      el('div', { class: 'ae-res-total' }, [icone('agenda'), el('b', { text: String(itensTodos.length) }), el('span', { text: itensTodos.length === 1 ? 'diária no dia' : 'diárias no dia' })]),
      resumoItem('para_revisar', 'Para revisar', 'ae-res-atencao'), resumoItem('revisada', 'Revisadas', 'ae-res-ok'), resumoItem('aguardando_aceite', 'Aguardando aceite', 'ae-res-info'),
      resumoItem('com_ocorrencia', 'Ocorrência', 'ae-res-erro'), resumoItem('standby', 'Stand-by', 'ae-res-standby'),
    ]);
    const itens = ordenar(filtrar(itensTodos));
    const grupos = agruparPorCidade(itens).map((g) => ({ ...g, itens: est.ordem === 'horario' ? g.itens : ordenar(g.itens) }));
    return [
      el('div', { class: 'ae-topo-dia' }, [faixa, resumo]), barraBusca({ comEnvio: true }), faixaStandby(),
      itens.length ? tabela(grupos, { comCidades: true }) : vazio(itensTodos.length ? 'Nenhuma diária com essa busca ou esses filtros.' : 'Nenhuma diária neste dia.'),
    ];
  }
  const navBtn = (rot, ic, fn) => { const b = el('button', { type: 'button', class: 'ae-nav-btn ae-nav-sem', 'aria-label': rot }, [icone(ic)]); b.addEventListener('click', fn); return b; };

  // ---------- Stand-by
  function faixaStandby() {
    const lista = est.dados.standby.filter((s) => s.data === est.data);
    const agora = agoraMs();
    const decisao = lista.some((s) => s.decidirAte && Date.parse(s.decidirAte) <= agora);
    const reservar = el('button', { type: 'button', class: 'ae-link', text: 'Reservar stand-by' });
    reservar.addEventListener('click', () => reservarStandby());
    return el('section', { class: 'ae-standby', 'aria-labelledby': 'ae-sb-tit', dataset: { standby: String(lista.length) } }, [
      el('div', { class: 'ae-sb-cab' }, [icone('relogio'), el('h2', { id: 'ae-sb-tit', text: 'Stand-by' }), el('span', { class: 'ae-cont ae-cont-neutro', text: String(lista.length) }),
        decisao ? el('span', { class: 'ae-decisao', text: 'Decisão necessária' }) : null, el('span', { class: 'ae-sb-fim' }, [reservar])]),
      ...(lista.length ? lista.map((s) => linhaStandby(s, agora)) : [el('p', { class: 'ae-sb-vazio', text: 'Nenhuma profissional em stand-by neste dia.' })]),
    ]);
  }
  function linhaStandby(s, agora) {
    const vence = s.decidirAte && Date.parse(s.decidirAte) <= agora;
    const utilizar = el('button', { type: 'button', class: 'btn btn-p btn-primario', text: 'Utilizar', dataset: { acao: 'utilizar' } });
    utilizar.addEventListener('click', () => utilizarStandby(s, utilizar));
    const liberar = el('button', { type: 'button', class: 'btn btn-p btn-secundario', text: 'Liberar', dataset: { acao: 'liberar' } });
    liberar.addEventListener('click', async () => {
      const m = await pedirMotivo({ titulo: `Liberar ${primeiro(s.nome)} do stand-by`, explicacao: 'A reserva é encerrada e fica no histórico.', rotuloConfirmar: 'Liberar a profissional', tom: 'primario' });
      if (m) executarAcao(liberar, (k) => api.standbyLiberar(s.diaristaId, s.data, m.texto, { chave: k }), { sucesso: `${primeiro(s.nome)} liberada.`, aoSucesso: recarregar });
    });
    const mais = el('button', { type: 'button', class: 'ae-icone-btn ae-mais', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': `Mais opções do stand-by de ${s.nome}` }, [icone('mais')]);
    mais.addEventListener('click', () => abrirPopover(mais, { titulo: 'Stand-by', ic: 'relogio', largura: 'curto', papel: 'menu', conteudo: listaMenu([
      s.estado === 'reservada' ? itemMenu({ ic: 'check', titulo: 'Confirmar disponibilidade', desc: 'A profissional confirmou que fica de prontidão.', aoClicar: () => executarAcao(null, (k) => api.standbyConfirmar(s.diaristaId, s.data, { chave: k }), { sucesso: 'Disponibilidade confirmada.', aoSucesso: recarregar }) }) : null,
      itemMenu({ ic: 'zap', titulo: 'Falar com a profissional', aoClicar: () => abrirWhatsApp(null, '', {}) }),
      itemMenu({ ic: 'pessoa', titulo: 'Ver perfil', href: url('painel/', { tela: 'profissionais', profissional: s.diaristaId }) }),
    ]) }));
    return el('div', { class: 'ae-sb-linha', dataset: { diarista: s.diaristaId } }, [
      el('b', { class: 'ae-hora', text: s.horaInicio }),
      el('span', { class: 'ae-pessoa' }, [avatar(s.nome), el('span', {}, [el('span', { class: 'ae-nome-linha' }, [el('b', { class: 'ae-nome', text: s.nome }), estrela(s.nota)]),
        el('span', { class: `ae-origem ${s.estado === 'confirmada' ? 'ae-origem-fixa' : 'ae-origem-manual'}`, text: s.estado === 'confirmada' ? 'Disponível' : 'Aguardando confirmação' })])]),
      el('span', { class: 'ae-sb-info' }, [el('small', { text: 'Região de atuação' }), el('span', { text: s.regiao || '-' })]),
      el('span', { class: 'ae-sb-info' }, [el('small', { text: 'Disponibilidade' }), el('span', { text: horas(s.duracaoMinutos) })]),
      el('span', { class: `ae-sb-alerta${vence ? ' ae-sb-alerta-vence' : ''}` }, [icone(vence ? 'aviso' : 'relogio', { pequeno: true }),
        el('span', { text: vence ? 'Horário previsto para decisão. Utilize a reserva ou libere a profissional.' : `Decidir até ${quando(s.decidirAte).slice(-5)}: utilize a reserva ou libere a profissional.` })]),
      el('span', { class: 'ae-sb-acoes' }, [utilizar, liberar, mais]),
    ]);
  }
  function utilizarStandby(s, b) {
    const alvo = est.dados.itens.filter((d) => d.data === s.data && editavelLinha(d, hoje) && d.profissional?.id !== s.diaristaId)
      .sort((x, y) => Number(!!x.profissional) - Number(!!y.profissional) || String(x.horaInicio).localeCompare(String(y.horaInicio)));
    const corpo = el('div', { class: 'u-col-2' }, [
      el('p', { class: 'p-sec', text: `Escolha a diária de ${ddmm(s.data)} que ${primeiro(s.nome)} vai assumir. A diária volta pra "Para revisar".` }),
      alvo.length ? el('ul', { class: 'ae-escolha' }, alvo.map((d) => {
        const x = botao(`${d.horaInicio} · ${d.cliente.nome}`, { tom: d.profissional ? '' : 'primario', aoClicar: () => executarAcao(x, (k) => api.standbyUtilizar(s.diaristaId, s.data, d.id, { chave: k }), { sucesso: `${primeiro(s.nome)} designada.`, aoSucesso: () => { fechar(); recarregar(); } }) });
        return el('li', {}, [x, el('span', { class: 'p-sec', text: d.profissional ? `hoje com ${primeiro(d.profissional.nome)}` : 'sem profissional' })]);
      })) : vazio('Nenhuma diária deste dia pode receber a reserva.'),
    ]);
    const fechar = modal({ titulo: `Utilizar o stand-by de ${primeiro(s.nome)}`, corpo });
    void b;
  }
  async function reservarStandby() {
    const pros = (await api.escalaCandidatas(est.dados.itens[0]?.id).catch(() => null))?.itens || [];
    const lista = pros.length ? pros : [];
    const sel = el('select', { id: 'sb-prof' }, [el('option', { value: '', text: lista.length ? 'Escolha' : 'Abra um dia com diárias pra listar as profissionais' }), ...lista.map((p) => el('option', { value: p.id, text: p.nome }))]);
    const hora = el('input', { id: 'sb-hora', type: 'time', value: '08:00' });
    const dur = el('select', { id: 'sb-dur' }, [4, 6, 8].map((h) => el('option', { value: String(h * 60), text: `${h} horas` })));
    const reg = el('input', { id: 'sb-reg', maxlength: '80', placeholder: 'Ex.: Contagem/BH' });
    const erro = el('p', { class: 'p-erro-campo', 'aria-live': 'polite' });
    modal({ titulo: `Reservar stand-by em ${ddmm(est.data)}`, corpo: el('div', { class: 'u-col' }, [
      ...[['sb-prof', 'Profissional', sel], ['sb-hora', 'Horário previsto', hora], ['sb-dur', 'Possível duração', dur], ['sb-reg', 'Região de referência', reg]].map(([id, r, i]) => el('div', { class: 'campo' }, [el('label', { for: id, text: r }), i])),
      erro, el('p', { class: 'p-consequencia', text: 'A reserva não cria cliente nem endereço. A equipe é avisada antes do horário de decisão.' })]),
    botoes: (fechar) => { const b = botao('Reservar', { tom: 'primario', aoClicar: () => {
      if (!sel.value) { erro.textContent = 'Escolha a profissional'; return; }
      executarAcao(b, (k) => api.standbyReservar({ diaristaId: sel.value, data: est.data, horaInicio: hora.value, duracaoMinutos: Number(dur.value), regiao: reg.value }, { chave: k }), { sucesso: 'Stand-by reservado.', aoSucesso: () => { fechar(); recarregar(); }, aoErro: (e) => { erro.textContent = mensagemErro(e); } });
    } }); return [botao('Voltar', { aoClicar: () => fechar() }), b]; } });
  }

  // ---------- tabela (Dia agrupada por cidade; Período sem subtítulo)
  function tabela(grupos, { comCidades, dia }) {
    const todosIds = grupos.flatMap((g) => g.itens).filter((d) => editavelLinha(d, hoje)).map((d) => d.id);
    const marcarTodos = el('input', { type: 'checkbox', class: 'ae-check', 'aria-label': 'Selecionar todas as diárias da lista', checked: todosIds.length > 0 && todosIds.every((id) => est.selecionadas.has(id)), disabled: !todosIds.length });
    marcarTodos.addEventListener('change', () => { for (const id of todosIds) { if (marcarTodos.checked) est.selecionadas.add(id); else est.selecionadas.delete(id); } render(); });
    const ordemBtn = (chave, rot) => {
      const b = el('button', { type: 'button', class: 'ae-ordem', 'aria-pressed': String(est.ordem === chave), title: est.ordem === chave ? 'Voltar pra ordem por horário' : `Ordenar por ${rot.toLowerCase()}` }, [rot, icone(chave === 'cliente' ? 'troca' : 'abaixo', { pequeno: true })]);
      b.addEventListener('click', () => { est.ordem = est.ordem === chave ? 'horario' : chave; render(); });
      return b;
    };
    const thead = el('thead', {}, [el('tr', {}, [
      el('th', { class: 'ae-c-check', scope: 'col' }, [marcarTodos]), el('th', { scope: 'col', text: 'Horário' }), el('th', { scope: 'col', 'aria-sort': est.ordem === 'cliente' ? 'ascending' : null }, [ordemBtn('cliente', 'Cliente')]),
      el('th', { scope: 'col', text: 'Endereço / Imóvel' }), el('th', { scope: 'col' }, ['Serviço', el('br'), 'Carga horária']), el('th', { scope: 'col', text: 'Profissional' }),
      el('th', { scope: 'col', text: 'Pagamento' }), el('th', { scope: 'col', 'aria-sort': est.ordem === 'status' ? 'ascending' : null }, [ordemBtn('status', 'Status')]), el('th', { scope: 'col', class: 'ae-c-acao', text: 'Ação' }),
    ])]);
    const corpos = grupos.map((g) => el('tbody', { dataset: comCidades ? { cidade: g.cidade } : { dia: dia || '' } }, [
      comCidades ? el('tr', { class: 'ae-grupo' }, [el('th', { colspan: '9', scope: 'colgroup' }, [icone('local', { pequeno: true }), el('b', { text: g.cidade }), el('span', { text: `(${g.itens.length} ${g.itens.length === 1 ? 'diária' : 'diárias'})` })])]) : null,
      ...g.itens.map((d) => linha(d, { periodo: !comCidades })),
    ]));
    return el('div', { class: 'ae-tabela-wrap' }, [el('table', { class: 'ae-tabela', 'aria-label': comCidades ? `Diárias de ${dataLonga(est.data)}` : `Diárias de ${dia ? dataLonga(dia) : ''}` }, [thead, ...corpos])]);
  }

  function linha(d, { periodo }) {
    const st = stDe(d); const pode = editavelLinha(d, hoje); const sr = semResp(d);
    const cb = el('input', { type: 'checkbox', class: 'ae-check', 'aria-label': `Selecionar a diária de ${d.cliente.nome} às ${d.horaInicio}`, checked: est.selecionadas.has(d.id), disabled: !pode });
    cb.addEventListener('change', () => { if (cb.checked) est.selecionadas.add(d.id); else est.selecionadas.delete(d.id); render(); });
    // cliente: nome, coroa (parceria), cartões + P (diária do pacote) e o balão logo abaixo
    const balao = el('button', { type: 'button', class: 'ae-balao', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': `Mensagens e contato de ${d.cliente.nome}` }, [icone('conversa', { pequeno: true }), el('span', { text: 'Mensagens e contato' })]);
    balao.addEventListener('click', (ev) => { ev.stopPropagation(); menuCliente(balao, d); });
    const cliente = el('span', { class: 'ae-cliente' }, [
      el('span', { class: 'ae-nome-linha' }, [el('b', { class: 'ae-nome', text: d.cliente.nome }),
        d.cliente.parceria ? el('span', { class: 'ae-coroa', role: 'img', 'aria-label': 'Cliente parceira', title: 'Cliente parceira' }, [icone('coroa', { pequeno: true })]) : null,
        d.pacote ? el('span', { class: 'ae-pacote', role: 'img', 'aria-label': 'Diária de pacote', title: 'Diária de pacote contratado' }, [icone('pacote', { pequeno: true }), el('b', { 'aria-hidden': 'true', text: 'P' })]) : null]),
      balao,
    ]);
    const animais = [d.imovel.caes ? el('span', { role: 'img', 'aria-label': 'Tem cachorro', title: 'Tem cachorro' }, [icone('cachorro', { pequeno: true })]) : null,
      d.imovel.gatos ? el('span', { role: 'img', 'aria-label': 'Tem gato', title: 'Tem gato' }, [icone('gato', { pequeno: true })]) : null].filter(Boolean);
    const end = periodo
      ? el('span', { class: 'ae-end' }, [el('span', { text: [[d.local.logradouro, d.local.numero].filter(Boolean).join(', '), d.local.bairro].filter(Boolean).join(' - ') }), el('span', { class: 'ae-linha2', text: [cidadeUf(d.local), imovel(d.imovel)].filter(Boolean).join(' · ') }), animais.length ? el('span', { class: 'ae-animais' }, animais) : null])
      : el('span', { class: 'ae-end' }, [el('span', { text: rua(d.local) }), el('span', { class: 'ae-linha2', text: `${d.local.bairro} - ${cidadeUf(d.local)}` }), el('span', { class: 'ae-linha2', text: imovel(d.imovel) }), animais.length ? el('span', { class: 'ae-animais' }, animais) : null]);
    const servico = el('span', { class: 'ae-servico' }, [el('span', { class: `ae-serv-ic ${d.servico === 'empresarial' || d.servico === 'condominial' ? 'ae-serv-predio' : 'ae-serv-casa'}` }, [icone(ICONE_SERVICO[d.servico] || 'casa', { titulo: SERVICO[d.servico] || d.servico })]),
      el('span', {}, [el('span', { class: 'ae-serv-nome', text: SERVICO[d.servico] || d.servico }), el('span', { class: 'ae-linha2', text: horas(d.duracaoMinutos) })])]);
    const acao = acaoDaLinha({ ...d, diaristaId: d.profissional?.id }) && d.data >= hoje ? acaoDaLinha({ ...d, diaristaId: d.profissional?.id }) : null;
    const btnAcao = acao === 'revisar' ? botaoRevisar(d) : acao === 'enviar' ? botaoEnviar(d) : null;
    const mais = el('button', { type: 'button', class: 'ae-icone-btn ae-mais', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': `Mais opções da diária de ${d.cliente.nome}` }, [icone('mais')]);
    mais.addEventListener('click', (ev) => { ev.stopPropagation(); menuMais(mais, d); });
    const tr = el('tr', { class: `ae-lin${est.aberta === d.id ? ' ae-lin-aberta' : ''}`, dataset: { diaria: d.id, status: st.codigo } }, [
      el('td', { class: 'ae-c-check' }, [cb]),
      el('td', { class: 'ae-c-hora', 'data-rotulo': 'Horário' }, [el('b', { class: 'ae-hora', text: d.horaInicio })]),
      el('td', { 'data-rotulo': 'Cliente' }, [cliente]),
      el('td', { 'data-rotulo': 'Endereço' }, [end]),
      el('td', { 'data-rotulo': 'Serviço' }, [servico]),
      el('td', { 'data-rotulo': 'Profissional' }, [celProfissional(d, { pode, periodo })]),
      el('td', { 'data-rotulo': 'Pagamento' }, [pagamentoCel(d.pagamento)]),
      el('td', { 'data-rotulo': 'Status' }, [seloStatus(st, { semResposta: sr })]),
      el('td', { class: 'ae-c-acao' }, [el('span', { class: 'ae-acoes' }, [btnAcao, mais])]),
    ]);
    // a linha abre os detalhes (as ações da própria linha não)
    tr.addEventListener('click', (ev) => { if (ev.target.closest('button, a, input, label')) return; abrirDetalhe(d.id); });
    return tr;
  }

  function celProfissional(d, { pode, periodo }) {
    if (!d.profissional) {
      const sel = el('button', { type: 'button', class: 'btn btn-p btn-secundario ae-selecionar', disabled: !pode, 'aria-haspopup': 'dialog', 'aria-expanded': 'false', text: 'Selecionar profissional' });
      sel.addEventListener('click', (ev) => { ev.stopPropagation(); abrirSeletor(sel, d); });
      return el('span', { class: 'ae-prof ae-sem-prof' }, [el('span', { class: 'ae-avatar ae-avatar-vazio', 'aria-hidden': 'true' }, [icone('pessoa')]),
        el('span', {}, [el('b', { text: 'Sem profissional' }), el('span', { class: 'ae-obrig', text: d.escalaRecusa ? `${primeiro(d.escalaRecusa.nome)} recusou` : 'Obrigatório' })]), pode ? sel : null]);
    }
    const p = d.profissional;
    const aviao = el('button', { type: 'button', class: 'ae-icone-btn ae-aviao', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': `Comunicação com ${p.nome}` }, [icone('enviar')]);
    aviao.addEventListener('click', (ev) => { ev.stopPropagation(); menuProfissional(aviao, d); });
    const alterar = pode ? el('button', { type: 'button', class: 'btn btn-p btn-secundario ae-alterar', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-label': `Alterar a profissional (${p.nome})`, text: 'Alterar' }) : null;
    alterar?.addEventListener('click', (ev) => { ev.stopPropagation(); abrirSeletor(alterar, d); });
    const remover = pode ? el('button', { type: 'button', class: 'ae-icone-btn ae-remover', 'aria-label': `Remover ${p.nome} desta diária` }, [icone('fechar', { pequeno: true })]) : null;
    remover?.addEventListener('click', (ev) => { ev.stopPropagation(); removerProfissional(remover, d); });
    return el('span', { class: 'ae-prof' }, [avatar(p.nome), el('span', { class: 'ae-prof-txt' }, [
      el('span', { class: 'ae-nome-linha' }, [el('b', { class: 'ae-nome', text: periodo && !pode ? p.nome : p.nome.split(' ').slice(0, 2).join(' ') }), estrela(p.nota)]),
      !periodo || pode ? seloOrigem(d.designacaoOrigem) : null,
      d.alertaFixa ? el('span', { class: 'ae-alerta-fixa', title: d.alertaFixa }, [icone('alerta', { pequeno: true }), 'Conflito da fixa']) : null,
    ]), el('span', { class: 'ae-prof-acoes' }, [aviao, alterar, remover])]);
  }

  function botaoRevisar(d) {
    const b = el('button', { type: 'button', class: 'btn btn-p btn-primario ae-btn-acao', dataset: { acao: 'revisar' }, 'aria-label': `Revisar a diária de ${d.cliente.nome}` }, [icone('alternar', { pequeno: true }), 'Revisar']);
    b.addEventListener('click', (ev) => { ev.stopPropagation(); executarAcao(b, (k) => api.escalaRevisar(d.id, d.escalaVersao, { chave: k }), { sucesso: 'Diária revisada.', aoSucesso: recarregar }); });
    return b;
  }
  function botaoEnviar(d) {
    const b = el('button', { type: 'button', class: 'btn btn-p btn-secundario ae-btn-acao', dataset: { acao: 'enviar' }, 'aria-label': `Enviar a diária de ${d.cliente.nome} para ${d.profissional?.nome}`, text: 'Enviar' });
    b.addEventListener('click', (ev) => { ev.stopPropagation(); enviar(b, [d.id]); });
    return b;
  }
  async function removerProfissional(b, d) {
    const comunicada = COMUNICADA.includes(d.escalaEstado);
    if (!(await confirmar({ titulo: `Remover ${primeiro(d.profissional.nome)} desta diária?`, texto: comunicada ? `A diária já foi enviada. ${primeiro(d.profissional.nome)} recebe o aviso de que a diária saiu da agenda dela, e a diária fica Sem profissional.` : 'A diária fica Sem profissional e precisa de nova designação. O sistema não preenche de novo sozinho.', rotuloConfirmar: comunicada ? 'Remover e avisar a profissional' : 'Remover', tom: 'perigo' }))) return;
    executarAcao(b, (k) => api.escalaRemover(d.id, { chave: k }), { sucesso: 'Profissional removida.', aoSucesso: recarregar });
  }

  // ---------- Semana e Período: dias abertos por padrão, sem subtítulo de cidade
  function renderPeriodo(itensTodos) {
    const [de, ate] = intervalo();
    const itens = ordenar(filtrar(itensTodos));
    const dias = []; for (let d = de; d <= ate; d = somarDias(d, 1)) dias.push(d);
    const todos = el('button', { type: 'button', class: 'ae-link ae-recolher', text: est.recolhidos.size >= dias.length ? 'Abrir todos' : 'Recolher todos' });
    todos.addEventListener('click', () => { if (est.recolhidos.size >= dias.length) est.recolhidos.clear(); else dias.forEach((x) => est.recolhidos.add(x)); render(); });
    return [barraBusca({ comEnvio: false }), el('div', { class: 'ae-periodo-topo' }, [todos]), ...dias.map((dia) => {
      const doDia = itens.filter((x) => x.data === dia); const total = itensTodos.filter((x) => x.data === dia).length;
      const aberto = !est.recolhidos.has(dia);
      const id = `ae-dia-${dia}`;
      const b = el('button', { type: 'button', class: 'ae-dia-cab', 'aria-expanded': String(aberto), 'aria-controls': id }, [icone(aberto ? 'abaixo' : 'direita'),
        el('b', { text: `${DIAS[diaDaSemana(dia)]},` }), el('span', { text: dataMedia(dia) }), el('small', { text: `(${total} ${total === 1 ? 'diária' : 'diárias'})` })]);
      b.addEventListener('click', () => { if (aberto) est.recolhidos.add(dia); else est.recolhidos.delete(dia); render(); });
      return el('section', { class: 'ae-dia-sec', dataset: { dia } }, [el('h2', { class: 'ae-dia-tit' }, [b]),
        aberto ? el('div', { id }, [doDia.length ? tabela([{ cidade: '', itens: doDia }], { comCidades: false, dia }) : el('p', { class: 'ae-sb-vazio', text: total ? 'Nenhuma diária com essa busca ou esses filtros.' : 'Nenhuma diária neste dia.' })]) : null]);
    })];
  }

  // ---------------------------------------------------------------- popovers
  function abrirFiltros(ancora) {
    const f = { ...est.filtros, status: [...est.filtros.status] };
    const itens = est.dados.itens;
    const opcoes = (k, fn) => [...new Map(itens.map((d) => fn(d)).filter((x) => x && x[0]).map((x) => [x[0], x[1]])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
    const chipsMulti = el('div', { class: 'ae-chips ae-chips-3', role: 'group', 'aria-label': 'Status do atendimento' });
    const desenharStatus = () => trocar(chipsMulti, [['', 'Todos'], ...FILTRO_STATUS.map((s) => [s, ROTULO_STATUS[s]])].map(([v, r]) => {
      const b = el('button', { type: 'button', class: 'ae-chip', 'aria-pressed': String(v ? f.status.includes(v) : !f.status.length), text: r });
      b.addEventListener('click', () => { if (!v) f.status = []; else f.status = f.status.includes(v) ? f.status.filter((x) => x !== v) : [...f.status, v]; desenharStatus(); });
      return b;
    }));
    desenharStatus();
    const umDe = (rot, chave, ops) => {
      const g = el('div', { class: 'ae-chips', role: 'group', 'aria-label': rot });
      const desenhar = () => trocar(g, ops.map(([v, r]) => { const b = el('button', { type: 'button', class: 'ae-chip', 'aria-pressed': String(f[chave] === v), text: r }); b.addEventListener('click', () => { f[chave] = v; desenhar(); }); return b; }));
      desenhar(); return g;
    };
    const select = (id, rot, chave, ops) => { const s = el('select', { id }, [el('option', { value: '', text: 'Todos' }), ...ops.map(([v, r]) => el('option', { value: v, text: r, selected: f[chave] === v }))]); s.addEventListener('change', () => { f[chave] = s.value; }); return el('div', { class: 'campo' }, [el('label', { for: id, text: rot }), s]); };
    const limpar = el('button', { type: 'button', class: 'btn btn-p btn-secundario' }, [icone('recarregar', { pequeno: true }), 'Limpar filtros']);
    limpar.addEventListener('click', () => { est.filtros = { status: [], pagamento: '', contratacao: '', profissional: '', servico: '', cidade: '', bairro: '' }; fecharPopover(); render(); });
    const aplicar = el('button', { type: 'button', class: 'btn btn-p btn-primario', text: 'Aplicar filtros' });
    aplicar.addEventListener('click', () => { est.filtros = f; fecharPopover({ devolverFoco: false }); render(); document.querySelector('.ae-filtros-btn')?.focus(); });
    abrirPopover(ancora, { titulo: 'Filtros da agenda', ic: 'funil', largura: 'medio', conteudo: el('div', { class: 'ae-pop-corpo ae-filtros' }, [
      el('h3', { text: 'Status do atendimento' }), chipsMulti,
      el('h3', { text: 'Pagamento' }), umDe('Pagamento', 'pagamento', [['', 'Todos'], ['pago', 'Pago'], ['pendente', 'Pendente'], ['a_faturar', 'A faturar']]),
      el('div', { class: 'ae-filtros-2' }, [
        el('div', {}, [el('h3', { text: 'Tipo de contratação' }), umDe('Tipo de contratação', 'contratacao', [['', 'Todos'], ['avulsa', 'Avulsa'], ['pacote', 'Pacote'], ['parceria', 'Parceria']])]),
        select('f-prof', 'Profissional', 'profissional', opcoes('profissional', (d) => d.profissional && [d.profissional.id, d.profissional.nome])),
        select('f-serv', 'Serviço', 'servico', opcoes('servico', (d) => [d.servico, SERVICO[d.servico] || d.servico])),
        select('f-cid', 'Cidade', 'cidade', opcoes('cidade', (d) => [d.local.cidade, d.local.cidade])),
        select('f-bai', 'Bairro ou região', 'bairro', opcoes('bairro', (d) => [d.local.bairro, d.local.bairro])),
      ]),
      el('div', { class: 'ae-pop-rodape' }, [limpar, aplicar]),
    ]) });
  }

  async function abrirSeletor(ancora, d) {
    const lista = el('div', { class: 'ae-sel-lista', 'aria-live': 'polite' }, [esqueleto(4)]);
    const busca = el('input', { type: 'search', id: 'sel-busca', placeholder: 'Buscar profissional por nome...', autocomplete: 'off', autofocus: true });
    let chip = '';
    const chipsEl = el('div', { class: 'ae-chips', role: 'group', 'aria-label': 'Mostrar' });
    const atual = d.profissional;
    const porque = el('div', { class: 'ae-porque' });
    const caixa = abrirPopover(ancora, { titulo: atual ? 'Alterar ou selecionar profissional' : 'Selecionar profissional', ic: 'equipe', largura: 'largo', conteudo: el('div', { class: 'ae-pop-corpo' }, [
      atual ? el('div', { class: 'ae-sel-atual' }, [avatar(atual.nome, 'ae-avatar-g'), el('span', {}, [el('span', { class: 'ae-nome-linha' }, [el('b', { class: 'ae-nome', text: atual.nome }), estrela(atual.nota), seloOrigem(d.designacaoOrigem)]),
        el('span', { class: 'ae-linha2', text: 'Você pode alterar a profissional desta diária.' })])]) : el('p', { class: 'p-sec', text: `${d.cliente.nome} · ${ddmm(d.data)} às ${d.horaInicio} · ${SERVICO[d.servico] || d.servico}` }),
      porque,
      el('label', { class: 'ae-busca' }, [icone('busca'), el('span', { class: 'p-sr', text: 'Buscar profissional por nome' }), busca]), chipsEl, lista,
    ]) });
    if (!caixa) return;
    let dados;
    try { dados = await api.escalaCandidatas(d.id); } catch (e) { trocar(lista, erroBloco(e, () => abrirSeletor(ancora, d))); return; }
    if (d.designacaoOrigem === 'sugerida' && dados.sugestao) {
      trocar(porque, el('details', {}, [el('summary', { text: 'Por que esta foi a sugerida' }), el('p', { text: dados.sugestao.motivos.join(' · ') }),
        el('p', { class: 'ae-linha2', text: `Fora da conta por falta de dado no sistema: ${(dados.criteriosSemDado || []).map((c) => CRITERIOS.find((x) => x[0] === c)?.[1] || c).join('; ')}.` })]));
    }
    const CHIPS = [['', 'Todos'], ['disponiveis', 'Disponíveis'], ['residencial', 'Residencial'], ['empresarial', 'Comercial'], ['passadoria', 'Passadoria']];
    const desenhar = () => {
      trocar(chipsEl, CHIPS.map(([v, r]) => { const b = el('button', { type: 'button', class: 'ae-chip', 'aria-pressed': String(chip === v), text: r }); b.addEventListener('click', () => { chip = v; desenhar(); }); return b; }));
      const t = semAcento(busca.value.trim());
      const vis = dados.itens.filter((p) => (!t || semAcento(p.nome).includes(t)) && (!chip || (chip === 'disponiveis' ? !p.impedida : p.habilidades.includes(chip))));
      trocar(lista, vis.length ? el('ul', {}, vis.map((p) => {
        const sel = p.atribuida ? el('span', { class: 'ae-ja', text: 'Já atribuída' }) : botao('Selecionar', { aoClicar: () => escolher(p) });
        if (!p.atribuida) sel.setAttribute('aria-label', `Selecionar ${p.nome}`);
        return el('li', { dataset: { candidata: p.id } }, [avatar(p.nome), el('span', { class: 'ae-sel-info' }, [
          el('span', { class: 'ae-nome-linha' }, [el('b', { class: 'ae-nome', text: p.nome }), estrela(p.nota), p.impedida ? el('span', { class: 'ae-indisp', text: p.motivos.join(', ') }) : el('span', { class: 'ae-disp' }, [icone('ok', { pequeno: true }), 'Disponível'])]),
          el('span', { class: 'ae-hab' }, [icone('casa', { pequeno: true }), p.habilidades.map((h) => ROTULO_HABILIDADE[h] || h).join(' e ') || 'Sem habilidade marcada']),
        ]), el('span', { class: 'ae-atende', text: p.regioes.length ? `Atende: ${p.regioes.join(', ')}` : '' }), sel]);
      })) : vazio('Nenhuma profissional com esse filtro.'));
    };
    busca.addEventListener('input', desenhar);
    desenhar();
    async function escolher(p) {
      if (p.impedida && !(await confirmar({ titulo: `${primeiro(p.nome)} tem impedimento`, texto: `${p.motivos.join(', ')}. O sistema recusa sobreposição de horário e férias; nos outros casos você decide.`, rotuloConfirmar: 'Tentar mesmo assim' }))) return;
      let escopo = 'so_esta';
      if (d.designacaoOrigem === 'fixa' && d.pacote && ehAdmin(sessao)) {
        escopo = await new Promise((ok) => {
          let feito = false;
          modal({ titulo: 'Vale só pra esta diária?', corpo: el('p', { class: 'p-sec', text: `${primeiro(d.profissional?.nome)} é a fixa das ${DIAS[diaDaSemana(d.data)].toLowerCase()}s neste pacote. Trocar só esta diária ou mudar a profissional fixa das próximas?` }),
            aoFechar: () => { if (!feito) ok(null); },
            botoes: (fechar) => [botao('Só esta diária', { aoClicar: () => { feito = true; fechar(); ok('so_esta'); } }), botao(`Fixa das próximas ${DIAS[diaDaSemana(d.data)].toLowerCase()}s`, { tom: 'primario', aoClicar: () => { feito = true; fechar(); ok('vinculo_futuro'); } })] });
        });
        if (!escopo) return;
      }
      executarAcao(null, (k) => api.escalaAlterar(d.id, { diaristaId: p.id, escopo }, { chave: k }), { sucesso: `${primeiro(p.nome)} na diária. Revise antes de enviar.`, aoSucesso: () => { fecharPopover({ devolverFoco: false }); recarregar(); } });
    }
  }

  function menuMais(ancora, d) {
    const pode = editavelLinha(d, hoje);
    abrirPopover(ancora, { titulo: 'Mais opções da diária', ic: 'mais', largura: 'medio', papel: 'menu', conteudo: listaMenu([
      itemMenu({ ic: 'olho', titulo: 'Ver detalhes da diária', desc: 'Acessar informações completas.', aoClicar: () => abrirDetalhe(d.id) }),
      itemMenu({ ic: 'historico', titulo: 'Histórico da diária', desc: 'Ver alterações, mensagens e status.', aoClicar: () => abrirDetalhe(d.id, { secao: 'historico' }) }),
      itemMenu({ ic: 'pessoa', titulo: 'Ver dados do cliente', desc: 'Acessar cadastro e histórico.', href: url('painel/', { tela: 'clientes', cliente: d.cliente.id }) }),
      d.profissional ? itemMenu({ ic: 'equipe', titulo: 'Ver cadastro da profissional', desc: 'Perfil, habilidades e disponibilidade.', href: url('painel/', { tela: 'profissionais', profissional: d.profissional.id }) }) : null,
      itemMenu({ ic: 'copiar', titulo: 'Duplicar diária', desc: 'Criar uma nova diária com as mesmas informações.', desativado: 'Duplicar depende de definição da cliente (preço e cobrança da cópia). Ver pendências.' }),
      itemMenu({ ic: 'calendario', titulo: 'Reagendar', desc: 'Alterar para outra data ou horário.', aoClicar: () => reagendar(d), desativado: pode ? null : 'Só diária futura, antes de começar' }),
      itemMenu({ ic: 'erro', titulo: 'Cancelar diária', desc: 'Cancelar o atendimento.', perigo: true, aoClicar: () => cancelar(d), desativado: pode ? null : 'Diária já em andamento, finalizada ou cancelada' }),
    ]) });
  }
  function menuCliente(ancora, d) {
    const v = variaveis(d); const op = { pedidoId: d.pedidoId };
    const zap = (contexto, modelo, extra) => () => abrirWhatsApp(d.cliente.telefone, modelo ? textoModelo(modelo, variaveis(d, extra)) : '', { ...op, contexto });
    abrirPopover(ancora, { titulo: 'Mensagens e contato', ic: 'conversa', largura: 'medio', papel: 'menu', conteudo: listaMenu([
      itemMenu({ ic: 'zap', titulo: 'Abrir conversa', desc: 'Contato e histórico de mensagens.', aoClicar: zap('agenda: abrir conversa') }),
      itemMenu({ ic: 'calendario_ok', titulo: 'Confirmar agendamento', aoClicar: zap('agenda: confirmar agendamento', 'confirmacao_agendamento') }),
      itemMenu({ ic: 'relogio', titulo: 'Lembrete de diária', desc: 'Data, horário e informações necessárias.', aoClicar: zap('agenda: lembrete', 'lembrete_vespera') }),
      d.pagamento.estado === 'pendente' ? itemMenu({ ic: 'dinheiro_mao', titulo: 'Pagamento pendente', desc: 'Cobrança ou orientação.', aoClicar: zap('agenda: pagamento pendente', 'lembrete_prazo_pagamento') }) : null,
      itemMenu({ ic: 'calendario', titulo: 'Reagendamento', desc: 'Proposta ou confirmação de nova data.', aoClicar: zap('agenda: reagendamento', 'remarcacao_confirmada') }),
      itemMenu({ ic: 'calendario_x', titulo: 'Cancelamento', aoClicar: zap('agenda: cancelamento', 'cancelamento_diaria_cliente') }),
      itemMenu({ ic: 'prancheta', titulo: 'Acompanhamento', desc: 'Conferência durante o atendimento.', aoClicar: zap('agenda: acompanhamento', 'conferencia_atendimento') }),
      itemMenu({ ic: 'documento', titulo: 'Outras mensagens', desc: 'Modelos autorizados em Gestão, Automações.', href: url('painel/', { tela: 'gestao', sec: 'automacoes' }) }),
      itemMenu({ ic: 'pessoa', titulo: 'Ver cadastro do cliente', desc: 'Dados e histórico.', href: url('painel/', { tela: 'clientes', cliente: d.cliente.id }) }),
    ]) });
    void v;
  }
  function menuProfissional(ancora, d) {
    const p = d.profissional; const op = { diaristaId: p.id };
    const zap = (contexto, texto) => () => abrirWhatsApp(p.telefone, texto, { ...op, contexto });
    const vp = { ...variaveis(d), nome: primeiro(p.nome) };
    const aguardando = ['aguardando_envio', 'enviada', 'aguardando_aceite'].includes(d.escalaEstado);
    abrirPopover(ancora, { titulo: `Comunicação com ${primeiro(p.nome)}`, ic: 'enviar', largura: 'medio', papel: 'menu', conteudo: listaMenu([
      itemMenu({ ic: 'zap', titulo: 'Abrir conversa', aoClicar: zap('agenda: abrir conversa') }),
      itemMenu({ ic: 'local', titulo: 'Enviar informações da diária', desc: 'Endereço, horário, serviço e orientações.', aoClicar: zap('agenda: informações da diária', textoModelo('diaria_designada', vp)) }),
      aguardando ? itemMenu({ ic: 'recarregar', titulo: 'Solicitar confirmação', desc: d.escalaEnvio?.enviadaEm ? `Enviada em ${quando(d.escalaEnvio.enviadaEm)}.` : null, aoClicar: () => executarAcao(null, (k) => api.escalaSolicitarConfirmacao(d.id, { chave: k }), { sucesso: 'Pedido de confirmação enviado.', aoSucesso: recarregar }) }) : null,
      aguardando ? itemMenu({ ic: 'check', titulo: 'Registrar aceite', desc: 'Ela confirmou por telefone ou pessoalmente.', aoClicar: () => executarAcao(null, (k) => api.escalaResponder(d.id, { resposta: 'aceite', versao: d.escalaVersao }, { chave: k }), { sucesso: 'Aceite registrado.', aoSucesso: recarregar }) }) : null,
      aguardando || d.escalaEstado === 'confirmada' ? itemMenu({ ic: 'calendario_x', titulo: 'Registrar recusa', desc: 'A diária volta pra nova designação.', aoClicar: async () => {
        const m = await pedirMotivo({ titulo: `${primeiro(p.nome)} recusou a diária`, explicacao: 'A diária fica Sem profissional e entra em "Precisa de você".', rotuloConfirmar: 'Registrar recusa' });
        if (m) executarAcao(null, (k) => api.escalaResponder(d.id, { resposta: 'recusa', versao: d.escalaVersao, motivo: m.texto }, { chave: k }), { sucesso: 'Recusa registrada.', aoSucesso: recarregar });
      } }) : null,
      itemMenu({ ic: 'info', titulo: 'Enviar orientações', aoClicar: zap('agenda: orientações', `Oi, ${primeiro(p.nome)}. Orientações da Prime para a diária de ${ddmm(d.data)}, ${vp.horario}: `) }),
      itemMenu({ ic: 'editar', titulo: 'Comunicar alteração', aoClicar: zap('agenda: alteração', textoModelo('diaria_cancelada_ou_remarcada', { ...vp, oque: 'mudou' })) }),
      itemMenu({ ic: 'calendario_x', titulo: 'Comunicar cancelamento', aoClicar: zap('agenda: cancelamento', textoModelo('diaria_cancelada_ou_remarcada', { ...vp, oque: 'foi cancelada' })) }),
      itemMenu({ ic: 'agenda', titulo: 'Consultar disponibilidade', desc: 'Outras diárias e impedimentos no dia.', aoClicar: () => consultarDisponibilidade(d) }),
      itemMenu({ ic: 'estrela', titulo: 'Ver avaliações', href: url('painel/', { tela: 'profissionais', aba: 'avaliacoes' }) }),
      itemMenu({ ic: 'pessoa', titulo: 'Ver perfil', href: url('painel/', { tela: 'profissionais', profissional: p.id }) }),
      itemMenu({ ic: 'historico', titulo: 'Histórico de comunicação', aoClicar: () => abrirDetalhe(d.id, { secao: 'historico' }) }),
    ]) });
  }
  async function consultarDisponibilidade(d) {
    const r = await api.escalaCandidatas(d.id).catch(() => null);
    const p = r?.itens.find((x) => x.id === d.profissional.id);
    const outras = est.dados.itens.filter((x) => x.id !== d.id && x.data === d.data && x.profissional?.id === d.profissional.id && x.status !== 'cancelado');
    modal({ titulo: `Disponibilidade de ${primeiro(d.profissional.nome)} em ${ddmm(d.data)}`, corpo: el('div', { class: 'u-col-2' }, [
      el('p', { text: p ? (p.impedida ? `Impedimento: ${p.motivos.join(', ')}.` : 'Disponível e sem conflito nesse horário.') : 'Não deu pra consultar agora.' }),
      el('p', { class: 'p-sec', text: outras.length ? `Outras diárias no dia: ${outras.map((x) => `${x.horaInicio} (${x.cliente.nome})`).join(', ')}.` : 'Nenhuma outra diária no dia.' }),
      p?.regioes?.length ? el('p', { class: 'p-sec', text: `Atende: ${p.regioes.join(', ')}.` }) : null,
    ]) });
  }
  function reagendar(d) {
    const data = el('input', { type: 'date', id: 'rg-data', min: hoje, value: d.data });
    const hora = el('input', { type: 'time', id: 'rg-hora', value: d.horaInicio, step: '1800' });
    const erro = el('p', { class: 'p-erro-campo', 'aria-live': 'polite' });
    modal({ titulo: `Reagendar a diária de ${primeiro(d.cliente.nome)}`, corpo: el('div', { class: 'u-col' }, [
      el('div', { class: 'campo' }, [el('label', { for: 'rg-data', text: 'Nova data' }), data]), el('div', { class: 'campo' }, [el('label', { for: 'rg-hora', text: 'Horário de início' }), hora]), erro,
      el('p', { class: 'p-consequencia', text: 'A cliente recebe a confirmação da nova data. A diária volta pra "Para revisar"; se já tinha sido enviada, a profissional é avisada.' })]),
    botoes: (fechar) => { const b = botao('Reagendar', { tom: 'primario', aoClicar: () => {
      if (!data.value || !hora.value) { erro.textContent = 'Informe a data e o horário'; return; }
      executarAcao(b, (k) => api.transicionarAtendimento(d.id, { evento: 'reagendar', dados: { data: data.value, horaInicio: hora.value } }, { chave: k }), { sucesso: 'Diária reagendada.', aoSucesso: () => { fechar(); recarregar(); }, aoErro: (e) => { erro.textContent = mensagemErro(e); } });
    } }); return [botao('Voltar', { aoClicar: () => fechar() }), b]; } });
  }
  async function cancelar(d) {
    const motivos = (await api.motivosPadrao().catch(() => ({ cancelamento: [] }))).cancelamento || [];
    const m = await pedirMotivo({ titulo: `Cancelar a diária de ${primeiro(d.cliente.nome)}?`, motivos, rotuloConfirmar: 'Cancelar a diária', consequencia: `${COMUNICADA.includes(d.escalaEstado) ? 'A profissional recebe o aviso do cancelamento. ' : ''}O histórico fica guardado. Estorno, se houver, é feito no Financeiro.` });
    if (!m) return;
    executarAcao(null, (k) => api.transicionarAtendimento(d.id, { evento: 'cancelar', dados: { motivo: m.texto, codigo: m.codigo } }, { chave: k }), { sucesso: 'Diária cancelada.', aoSucesso: recarregar });
  }

  // ---------------------------------------------------------------- painel lateral de detalhes
  function fecharDetalhe() {
    if (lateral.hidden) { est.aberta = null; return; }
    lateral.hidden = true; trocar(lateral); raiz.classList.remove('ae-com-detalhe');
    const antes = est.aberta; est.aberta = null; salvarUrl();
    document.querySelector(`tr[data-diaria="${antes}"]`)?.classList.remove('ae-lin-aberta');
    document.querySelector(`tr[data-diaria="${antes}"] .ae-mais`)?.focus();
  }
  function abrirDetalhe(id, { secao, foco = true } = {}) {
    const lista = est.vista === 'dia' ? agruparPorCidade(ordenar(filtrar(est.dados.itens))).flatMap((g) => g.itens) : ordenar(filtrar(est.dados.itens));
    const d = est.dados.itens.find((x) => x.id === id);
    if (!d) return;
    const i = lista.findIndex((x) => x.id === id);
    est.aberta = id; salvarUrl(); raiz.classList.add('ae-com-detalhe'); lateral.hidden = false;
    for (const tr of document.querySelectorAll('tr.ae-lin-aberta')) tr.classList.remove('ae-lin-aberta');
    document.querySelector(`tr[data-diaria="${id}"]`)?.classList.add('ae-lin-aberta');
    const nav = (n, rot, ic) => { const b = el('button', { type: 'button', class: 'ae-icone-btn', 'aria-label': rot, disabled: !lista[i + n] }, [icone(ic)]); b.addEventListener('click', () => abrirDetalhe(lista[i + n].id)); return b; };
    const fechar = el('button', { type: 'button', class: 'ae-icone-btn', 'aria-label': 'Fechar os detalhes' }, [icone('fechar')]);
    fechar.addEventListener('click', () => fecharDetalhe());
    const st = stDe(d); const pode = editavelLinha(d, hoje); const sr = semResp(d);
    const historico = (d.historico || []).slice().reverse();
    const sec = (ic, titulo, conteudo, extra, idSec) => el('section', { class: 'ae-det-sec', id: idSec || null }, [el('div', { class: 'ae-det-sec-cab' }, [icone(ic), el('h3', { text: titulo }), extra || null]), ...[].concat(conteudo)]);
    const mapa = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([rua(d.local), d.local.bairro, cidadeUf(d.local)].join(', '))}`;
    const copiar = el('button', { type: 'button', class: 'ae-icone-btn', 'aria-label': 'Copiar o endereço' }, [icone('copiar')]);
    copiar.addEventListener('click', () => { navigator.clipboard?.writeText([rua(d.local), `${d.local.bairro} - ${cidadeUf(d.local)}`, d.local.cep ? `CEP: ${d.local.cep}` : ''].filter(Boolean).join('\n')).then(() => toast('Endereço copiado.', 'ok'), () => toast('Não deu pra copiar.', 'erro')); });
    // edições do painel (administração): parceria e profissional fixa. "Salvar alterações" grava o que mudou.
    const parceria = el('input', { type: 'checkbox', id: 'det-parceria', checked: d.cliente.parceria, disabled: !ehAdmin(sessao) });
    const balao = el('button', { type: 'button', class: 'ae-balao', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, [icone('conversa', { pequeno: true }), el('span', { text: 'Mensagens e contato' })]);
    balao.addEventListener('click', () => menuCliente(balao, d));
    const aviao = d.profissional ? el('button', { type: 'button', class: 'ae-icone-btn ae-aviao', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': `Comunicação com ${d.profissional.nome}` }, [icone('enviar')]) : null;
    aviao?.addEventListener('click', () => menuProfissional(aviao, d));
    const alterar = pode ? el('button', { type: 'button', class: 'btn btn-p btn-secundario', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', text: d.profissional ? 'Alterar profissional' : 'Selecionar profissional' }) : null;
    alterar?.addEventListener('click', () => abrirSeletor(alterar, d));
    const fixaLinha = d.pacote ? el('p', { class: 'ae-linha2', text: d.vinculoFixo ? `Fixa das ${DIAS[diaDaSemana(d.data)].toLowerCase()}s neste pacote: ${d.vinculoFixo.nome}.` : `Sem profissional fixa nas ${DIAS[diaDaSemana(d.data)].toLowerCase()}s deste pacote.` }) : null;
    const envio = d.escalaEnvio || {};
    const situacao = [
      ['Revisão', ['para_revisar'].includes(d.escalaEstado) ? 'Para revisar' : 'Revisada'],
      ['Envio', envio.enviadaEm ? `${quando(envio.enviadaEm)} pelo ${envio.canal === 'portal' ? 'Portal' : 'WhatsApp'}${envio.falhou ? ' (falhou)' : ''}` : 'Não enviada'],
      ['Entrega', envio.entregueEm ? quando(envio.entregueEm) : envio.enviadaEm ? 'Sem confirmação de entrega' : '-'],
      ['Aceite', envio.resposta === 'aceite' ? `Aceita em ${quando(envio.respondidaEm)}` : d.escalaRecusa ? `${primeiro(d.escalaRecusa.nome)} recusou em ${quando(d.escalaRecusa.em)}` : envio.enviadaEm ? `Aguardando${sr ? ' (passou do prazo)' : ''}` : '-'],
      ['Execução', st.codigo === 'em_andamento' ? (st.porHorario ? 'Em andamento pelo horário (chegada não confirmada)' : 'Em andamento') : st.codigo === 'finalizada' ? (st.porHorario ? 'Encerrada pelo horário (conclusão não confirmada)' : 'Concluída') : st.codigo === 'cancelada' ? 'Cancelada' : 'Ainda não começou'],
    ];
    const salvar = el('button', { type: 'button', class: 'btn btn-p btn-primario', text: 'Salvar alterações', disabled: true });
    parceria.addEventListener('change', () => { salvar.disabled = parceria.checked === d.cliente.parceria; });
    salvar.addEventListener('click', () => executarAcao(salvar, () => api.definirParceria(d.cliente.id, parceria.checked), { sucesso: 'Alterações salvas.', aoSucesso: recarregar }));
    const reag = el('button', { type: 'button', class: 'btn btn-p btn-secundario', disabled: !pode }, [icone('calendario', { pequeno: true }), 'Reagendar']);
    reag.addEventListener('click', () => reagendar(d));
    const canc = el('button', { type: 'button', class: 'btn btn-p btn-perigo', disabled: !pode }, [icone('fechar', { pequeno: true }), 'Cancelar diária']);
    canc.addEventListener('click', () => cancelar(d));
    const mais = el('button', { type: 'button', class: 'ae-icone-btn ae-mais', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': 'Mais opções da diária' }, [icone('mais')]);
    mais.addEventListener('click', () => menuMais(mais, d));
    const h2 = el('h2', { id: 'ae-det-tit', tabindex: '-1', text: 'Detalhes da diária' });
    trocar(lateral,
      el('div', { class: 'ae-det-cab' }, [h2, el('span', { class: 'ae-det-nav' }, [nav(-1, 'Diária anterior', 'esquerda'), nav(1, 'Próxima diária', 'direita'), fechar])]),
      el('div', { class: 'ae-det-meta' }, [seloStatus(st, { semResposta: sr }), acaoDaLinha({ ...d, diaristaId: d.profissional?.id }) === 'enviar' ? el('span', { class: 'selo selo-atencao' }, [icone('aviso', { pequeno: true }), 'Para enviar']) : null,
        el('span', { class: 'ae-det-num' }, [el('b', { text: d.numero ? `#${d.numero}` : '' }), el('small', { text: d.designacaoOrigem ? `Profissional ${ORIGEM[d.designacaoOrigem]?.[0].toLowerCase() || ''}` : 'Sem profissional' })])]),
      el('div', { class: 'ae-det-rolagem' }, [
        sec('pessoa', 'Cliente', [el('div', { class: 'ae-det-linha' }, [el('span', {}, [el('span', { class: 'ae-nome-linha' }, [el('b', { class: 'ae-nome ae-nome-g', text: d.cliente.nome }), d.cliente.parceria ? el('span', { class: 'ae-coroa', role: 'img', 'aria-label': 'Cliente parceira' }, [icone('coroa', { pequeno: true })]) : null, d.pacote ? el('span', { class: 'ae-pacote', role: 'img', 'aria-label': 'Diária de pacote' }, [icone('pacote', { pequeno: true }), el('b', { 'aria-hidden': 'true', text: 'P' })]) : null]), balao,
          d.cliente.telefone ? el('span', { class: 'ae-tel' }, [icone('telefone', { pequeno: true }), d.cliente.telefone]) : null]),
          el('a', { class: 'btn btn-p btn-secundario', href: url('painel/', { tela: 'clientes', cliente: d.cliente.id }) }, ['Ver cadastro do cliente', icone('abrir', { pequeno: true })])]),
          el('label', { class: 'ae-det-check', for: 'det-parceria' }, [parceria, 'Cliente parceira (coroa)', ehAdmin(sessao) ? null : el('small', { text: ' só a administração muda' })])]),
        sec('agenda', 'Data e horário', [el('p', { text: dataLonga(d.data) }), el('p', { text: `${d.horaInicio} às ${fim(d)} (${horas(d.duracaoMinutos)})` })]),
        sec('local', 'Endereço e imóvel', [el('div', { class: 'ae-det-linha' }, [el('span', {}, [el('p', { text: rua(d.local) }), el('p', { text: `${d.local.bairro} - ${cidadeUf(d.local)}` }), d.local.cep ? el('p', { text: `CEP: ${d.local.cep}` }) : null]), copiar]),
          el('p', { class: 'ae-det-imovel' }, [imovel(d.imovel), d.imovel.caes ? el('span', {}, [icone('cachorro', { pequeno: true }), 'Possui cachorro']) : null, d.imovel.gatos ? el('span', {}, [icone('gato', { pequeno: true }), 'Possui gato']) : null])],
        el('a', { class: 'btn btn-p btn-secundario', href: mapa, target: '_blank', rel: 'noopener' }, [icone('local', { pequeno: true }), 'Ver no mapa'])),
        sec('documento', 'Serviço e observações', [el('p', {}, ['Serviço: ', el('b', { text: SERVICO[d.servico] || d.servico })]), el('p', { text: `Carga horária: ${horas(d.duracaoMinutos)}` }),
          d.prioridades?.length ? el('div', {}, [el('p', { text: 'Prioridades informadas pelo cliente:' }), el('ul', {}, d.prioridades.map((x) => el('li', { text: x })))]) : null,
          el('p', { class: 'ae-linha2', text: d.observacao || 'Sem observações.' })]),
        sec('pessoa', 'Profissional designada', [d.profissional ? el('div', { class: 'ae-det-linha' }, [el('span', { class: 'ae-prof' }, [avatar(d.profissional.nome, 'ae-avatar-g'), el('span', {}, [el('span', { class: 'ae-nome-linha' }, [el('b', { class: 'ae-nome ae-nome-g', text: d.profissional.nome }), estrela(d.profissional.nota)]), seloOrigem(d.designacaoOrigem)])]), aviao, alterar])
          : el('div', { class: 'ae-det-linha' }, [el('span', {}, [el('b', { text: 'Sem profissional' }), el('p', { class: 'ae-obrig', text: d.escalaRecusa ? `${d.escalaRecusa.nome} recusou${d.escalaRecusa.motivo ? `: ${d.escalaRecusa.motivo}` : ''}` : 'Obrigatório' })]), alterar]),
        d.profissional && pode ? (() => { const x = el('button', { type: 'button', class: 'ae-link', text: `Remover ${primeiro(d.profissional.nome)} desta diária` }); x.addEventListener('click', () => removerProfissional(x, d)); return x; })() : null,
        d.alertaFixa ? el('p', { class: 'ae-alerta-fixa', text: `${d.alertaFixa}. O sistema não troca a fixa sozinho.` }) : null, fixaLinha]),
        sec('cartao', 'Pagamento', [el('div', { class: 'ae-det-linha' }, [el('p', { text: `Forma de pagamento: ${d.pagamento.estado === 'a_faturar' ? 'Faturamento' : d.pagamento.forma === 'cartao' ? 'Cartão' : 'PIX'}` }), pagamentoCel(d.pagamento)]),
          d.pagamento.estado === 'pendente' ? el('p', { class: 'ae-linha2', text: 'Pagamento pendente não impede revisar nem enviar a diária.' }) : null]),
        sec('prancheta', 'Situação', [el('dl', { class: 'ae-det-dl' }, situacao.map(([k, v]) => el('div', {}, [el('dt', { text: k }), el('dd', { text: v })])))]),
        sec('historico', 'Histórico', historico.length ? el('ul', { class: 'ae-hist' }, historico.slice(0, 30).map((h) => el('li', {}, [el('b', { text: rotuloHistorico(h) }), el('span', { text: [quando(h.em), h.por || (h.ator === 'sistema' ? 'automático' : h.ator === 'prime' ? 'equipe' : h.ator), h.canal].filter(Boolean).join(' · ') })])))
          : el('p', { class: 'ae-linha2', text: 'Nada registrado ainda.' }), null, 'ae-det-historico'),
        sec('robo', 'Registros das automações', el('p', { class: 'ae-linha2' }, ['Mensagens automáticas desta diária ficam em ', el('a', { href: url('painel/', { tela: 'gestao', sec: 'automacoes' }), text: 'Gestão, Automações' }), '.'])),
      ]),
      el('div', { class: 'ae-det-rodape' }, [reag, canc, mais, salvar]),
    );
    if (secao === 'historico') document.getElementById('ae-det-historico')?.scrollIntoView({ block: 'start' });
    if (foco) h2.focus();
  }
  lateral.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !popAtual) { ev.preventDefault(); fecharDetalhe(); } });

  renderCab();
  await carregar({ preparar: true });
}

const EVENTOS = {
  escala_fixa: 'Profissional fixa aplicada', escala_sugerida: 'Profissional sugerida pelo sistema', escala_alterar: 'Profissional alterada', escala_remover: 'Profissional removida',
  escala_revisar: 'Revisada', escala_enviar: 'Enviada à profissional', escala_aceite: 'Aceita pela profissional', escala_recusa: 'Recusada pela profissional', escala_envio_falhou: 'Envio falhou',
  escala_solicitar_confirmacao: 'Confirmação pedida de novo', standby_utilizado: 'Stand-by utilizado', reagendar: 'Reagendada', cancelar: 'Cancelada', confirmar: 'Pagamento confirmado',
  contato_manual: 'Contato pelo WhatsApp', iniciar: 'Atendimento iniciado', finalizar: 'Atendimento finalizado', sair_a_caminho: 'Profissional a caminho', avaliar: 'Avaliada pela cliente',
};
const rotuloHistorico = (h) => EVENTOS[h.evento] || (h.para && h.de !== h.para ? `${h.de || ''} → ${h.para}` : h.evento || 'Registro');

// ================================================================ Gestão > Configurações > Agenda e Escala (T8)
// Os pontos que a cliente ainda não decidiu (seção 18) nascem desligados: prazo do "sem resposta" e verificação de
// pagamento pendente. Nada cancela sozinho. Os modelos de mensagem (WhatsApp, Portal e E-mail) com variáveis, prévia e
// histórico de versões ficam no editor de Automações, que é o mesmo motor dos envios.
export async function secaoConfigAgenda(alvo, { sessao }) {
  const admin = ehAdmin(sessao);
  trocar(alvo, esqueleto(4));
  let c;
  try { c = await api.configAgenda(); } catch (e) { trocar(alvo, erroBloco(e, () => secaoConfigAgenda(alvo, { sessao }))); return; }
  const campo = (id, rot, input, ajuda) => el('div', { class: 'campo' }, [el('label', { for: id, text: rot }), input, ajuda ? el('p', { class: 'p-sec', text: ajuda }) : null]);
  const prazo = el('select', { id: 'cfg-prazo', disabled: !admin }, [['', 'Desligado (sem alerta)'], ['30', '30 minutos'], ['60', '1 hora'], ['120', '2 horas'], ['180', '3 horas'], ['240', '4 horas'], ['480', '8 horas']]
    .map(([v, r]) => el('option', { value: v, text: r, selected: String(c.prazoSemRespostaMin ?? '') === v })));
  const liga = el('input', { type: 'checkbox', id: 'cfg-pag', checked: !!c.verificacaoPagamento?.ligada, disabled: !admin });
  const hora = el('input', { type: 'time', id: 'cfg-pag-hora', value: c.verificacaoPagamento?.hora || '', disabled: !admin });
  const alerta = el('input', { type: 'number', id: 'cfg-sb', min: '0', max: '600', step: '15', value: String(c.standbyAlertaMin ?? 60), disabled: !admin });
  const erro = el('p', { class: 'p-erro-campo', 'aria-live': 'polite' });
  const salvar = admin ? botao('Salvar', { tom: 'primario', aoClicar: () => {
    if (liga.checked && !hora.value) { erro.textContent = 'Informe o horário da verificação'; hora.focus(); return; }
    executarAcao(salvar, () => api.salvarConfigAgenda({ prazoSemRespostaMin: prazo.value ? Number(prazo.value) : null, verificacaoPagamento: { ligada: liga.checked, hora: hora.value || null }, standbyAlertaMin: Number(alerta.value) }),
      { sucesso: 'Configuração salva.', aoErro: (e) => { erro.textContent = mensagemErro(e); } });
  } }) : null;
  const canalAtual = c.canalAtivo || 'whatsapp';
  const trocarCanal = admin ? botao(canalAtual === 'whatsapp' ? 'Ativar o Portal (contingência)' : 'Voltar pro WhatsApp', { aoClicar: async () => {
    const para = canalAtual === 'whatsapp' ? 'portal' : 'whatsapp';
    const m = await pedirMotivo({ titulo: para === 'portal' ? 'Ativar o Portal como canal' : 'Voltar pro WhatsApp', explicacao: 'A troca aparece no cabeçalho da Agenda e Escala e fica no histórico.', rotuloConfirmar: 'Trocar o canal', tom: 'primario' });
    if (m) executarAcao(null, () => api.definirCanalAtivo(para, m.texto), { sucesso: 'Canal trocado.', aoSucesso: () => secaoConfigAgenda(alvo, { sessao }) });
  } }) : null;
  trocar(alvo, el('section', { class: 'p-bloco p-bloco-solto u-col', dataset: { config: 'agenda-escala' } }, [
    el('h2', { text: 'Agenda e Escala' }),
    admin ? null : el('p', { class: 'p-sec', text: 'Só a administração muda estas regras.' }),
    campo('cfg-prazo', 'Alertar profissional sem resposta depois de', prazo, 'O triângulo aparece na diária e a pendência vai pro Início. Sem resposta nunca vira recusa.'),
    el('fieldset', { class: 'u-grupo' }, [el('legend', { class: 'p-sec', text: 'Verificação de pagamento pendente no dia anterior (padrão: desligada)' }),
      el('label', { for: 'cfg-pag', class: 'u-fila' }, [liga, 'Ligar a verificação']), campo('cfg-pag-hora', 'Horário da verificação', hora, 'Só gera alerta pra equipe decidir com a cliente. Nada é cancelado sozinho.')]),
    campo('cfg-sb', 'Alertar o stand-by quantos minutos antes do horário', alerta, null),
    erro, salvar,
    el('h3', { text: 'Canal de comunicação' }),
    el('p', { text: canalAtual === 'portal' ? 'Portal ativo: contingência.' : 'WhatsApp ativo: canal principal.' }), trocarCanal,
    (c.historicoCanal || []).length ? el('ul', { class: 'p-lista' }, c.historicoCanal.slice().reverse().map((h) => el('li', {}, [el('span', { class: 'p-texto-item' }, [el('b', { text: `${h.de} → ${h.para}` }), el('span', { text: [quando(h.em), h.por, h.motivo].filter(Boolean).join(' · ') })])]))) : null,
    el('h3', { text: 'Modelos de mensagem' }),
    el('p', { class: 'p-sec' }, ['WhatsApp, Portal e E-mail, com variáveis (nome, data, horário, serviço, endereço, profissional), prévia e histórico de versões: ',
      el('a', { href: url('painel/', { tela: 'gestao', sec: 'automacoes' }), text: 'Gestão, Automações' }), '.']),
  ]));
}
