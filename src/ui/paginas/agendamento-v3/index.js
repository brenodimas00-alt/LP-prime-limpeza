// autoagendamento/ v3 (spec-agendamento-v3.txt + autoagendamento-v3-isa.txt, 56 itens da cliente). Roteador das telas:
// 6 etapas na barra de progresso; cada etapa pode ter mais de uma tela, mas sem virar uma página por pergunta (item 56).
// - Rascunho salvo a cada mudança (sem CPF e nascimento); voltar do navegador navega entre telas (history.pushState);
//   deep link da home (?servico=) já cai na identificação.
// - Guarda de navegação: não dá pra pular uma tela com falta.
import { el, trocar, progresso } from './ui.js';
import { montarPagina, definirAbertura } from '../../layout.js';
import { api, agora } from '../../../services/api.js';
import { auth } from '../../../services/auth.js';
import { url } from '../../../config/app.js';
import { CONFIG_PRECOS as CFG } from '../../../config/precos.js';
import { T3, CONTEUDO_AGENDAMENTO_PADRAO } from '../../../config/agendamento-v3.js';
import { dataNoFuso } from '../../../domain/calendario.js';
import { registrarFunil } from '../../observabilidade.js';
import { estado, salvar, logada, novoRascunho, trocarRascunho } from './estado.js';
import { passoServico } from './passo-servico.js';
import { passoIdentificacao, passoCadastro } from './passo-identificacao.js';
import { passoEndereco } from './passo-endereco.js';
import { passoLocal, faltaLocal } from './passo-local.js';
import { regiaoV3 } from '../../../domain/agendamento-v3.js';
import * as V from '../../../domain/validacao.js';

const PASSOS = [
  ['servico', 1], ['identificacao', 2], ['cadastro', 2], ['endereco', 3], ['local', 4], ['modalidade', 5], ['datas', 5], ['configuracao', 5], ['revisao', 6],
];
export const ETAPA = Object.fromEntries(PASSOS);
// deep link da home: serviço -> segmento (mudança e evento existem nos dois; a pessoa troca na etapa 1 se quiser)
const SEGMENTO_DO_SERVICO = { residencial: 'residencial', passadoria: 'residencial', empresarial: 'empresa', condominial: 'empresa', pre_pos_mudanca: 'residencial', pre_pos_evento: 'residencial' };

const raiz = el('div', { class: 'fluxo-agendamento fluxo-v3' });
montarPagina(raiz, { ctaDiscreto: true });
document.body.classList.add('pagina-agendamento', 'agendamento-v3');
definirAbertura({ rotulo: 'Agendamento', titulo: T3.titulo, lead: T3.lead });

const ctx = {
  hoje: '', conteudo: CONTEUDO_AGENDAMENTO_PADRAO, enderecos: null, errosPendentes: null, cadastroConteudo: '', url,
  avancar, voltar: () => history.back(), render, irPara,
  // depois de entrar, identificação e cadastro saem da lista de telas: segue direto pro endereço
  entrou() { ctx.enderecos = null; const r = estado(); r.identificacao = 'cliente'; r.ticket = ''; salvar(); irPara('endereco'); },
  servicoMudou() { const r = estado(); Object.assign(r, { caracteristicas: {}, duracaoHoras: 0, duracaoManual: false, cienteMenor: false, justificativa: '' }); },
  segmentoMudou(v) {
    const r = estado();
    r.segmento = v;
    if (!CFG.PRECOS.servicosPorTipoCliente[v].includes(r.servico)) { r.servico = ''; ctx.servicoMudou(); }
    // o tipo do imóvel depende do segmento (item 8)
    r.endereco.novo.tipoImovel = ''; r.endereco.novo.tipoImovelOutro = '';
  },
};

// ---------- o que falta em cada tela (guarda de navegação) ----------
function falta(passo) {
  const r = estado();
  switch (passo) {
    case 'servico': return !r.segmento ? 'Escolha onde será realizado o atendimento' : !(CFG.PRECOS.servicosPorTipoCliente[r.segmento] || []).includes(r.servico) ? 'Escolha o serviço' : null;
    case 'identificacao': return logada() ? null : !r.identificacao ? 'Escolha uma opção' : r.identificacao === 'cliente' ? 'Entre com seus dados de acesso' : null;
    case 'cadastro': return logada() || r.ticket ? null : 'Conclua o cadastro';
    case 'endereco': {
      if (r.endereco.modo === 'salvo') return r.endereco.id ? null : 'Escolha o endereço';
      if (r.endereco.cepSituacao !== 'atendida') return 'Informe um CEP atendido';
      const tipos = ctx.conteudo.tiposImovel[r.segmento === 'empresa' ? 'empresa' : 'residencial'];
      const e = V.validarEnderecoV3(r.endereco.novo, tipos);
      if (Object.keys(e).length) return Object.values(e)[0];
      const reg = regiaoV3(r.endereco.novo, CFG);
      if (!reg || reg.sobConsulta) return T3.foraArea;
      return r.endereco.uso ? null : 'Escolha como deseja utilizar este endereço';
    }
    case 'local': return faltaLocal();
    default: return ctx.faltaExtra?.(passo) ?? null;
  }
}
const passosAtivos = () => PASSOS.map(([p]) => p).filter((p) => {
  const r = estado();
  if (p === 'identificacao' || p === 'cadastro') return !logada() && (p === 'identificacao' || r.identificacao === 'novo');
  if (p === 'configuracao') return ['multi_profissional', 'pacote'].includes(r.modalidade);
  return true;
});
const primeiroIncompleto = () => passosAtivos().find((p) => p !== 'revisao' && falta(p)) || 'revisao';
const indice = (p) => passosAtivos().indexOf(p);

function irPara(passo, { empilhar = true } = {}) {
  const r = estado();
  const alvo = indice(passo) > indice(primeiroIncompleto()) ? primeiroIncompleto() : passo;
  r.passo = alvo; salvar();
  if (empilhar) history.pushState({ passo: alvo }, '');
  render();
  document.getElementById('titulo-passo')?.focus?.();
  window.scrollTo?.({ top: 0 });
}
function avancar() {
  const r = estado();
  const ativos = passosAtivos();
  const i = ativos.indexOf(r.passo);
  if (r.retornarRevisao) {
    const pendente = ativos.slice(i + 1).find((p) => p !== 'revisao' && falta(p));
    irPara(pendente || 'revisao');
    if (!pendente) { r.retornarRevisao = false; salvar(); }
    return;
  }
  irPara(ativos[i + 1] || 'revisao');
}
window.addEventListener('popstate', (ev) => {
  const p = ev.state?.passo;
  if (!p || !ETAPA[p]) return;
  const r = estado();
  r.passo = indice(p) > indice(primeiroIncompleto()) ? primeiroIncompleto() : p;
  salvar(); render(); document.getElementById('titulo-passo')?.focus?.();
});

/** Telas dos próximos blocos (V3 a V5) entram aqui. */
const TELAS = { servico: passoServico, identificacao: passoIdentificacao, cadastro: passoCadastro, endereco: passoEndereco, local: passoLocal };
export function registrarTelas(t, faltaExtra) { Object.assign(TELAS, t); const ant = ctx.faltaExtra; ctx.faltaExtra = (p) => faltaExtra?.(p) ?? ant?.(p) ?? null; }

function render() {
  const r = estado();
  if (!ETAPA[r.passo] || indice(r.passo) < 0) r.passo = primeiroIncompleto();
  const tela = TELAS[r.passo];
  if (!tela) { trocar(raiz, progresso(ETAPA[r.passo], T3.etapas), el('section', { class: 'passo-fluxo', dataset: { passo: r.passo } }, [el('h2', { id: 'titulo-passo', class: 'titulo-passo', tabindex: -1, text: T3.etapas[ETAPA[r.passo] - 1] }), el('p', { class: 'mudo', text: 'Esta etapa entra na próxima entrega.' })])); return; }
  const m = tela(ctx);
  if (m?.form) trocar(raiz, progresso(ETAPA[r.passo], T3.etapas), m.form);
  else if (m) trocar(raiz, progresso(ETAPA[r.passo], T3.etapas), m);
}

export async function iniciar() {
  ctx.hoje = dataNoFuso((await agora()).toISOString(), CFG.regrasNotificacao.fuso);
  try { const c = await api.conteudoAgendamento(); if (c?.tiposImovel && c?.verMais) ctx.conteudo = c; } catch { /* fica o padrão do arquivo */ }
  const r = estado();
  const q = new URLSearchParams(location.search);
  const servico = q.get('servico');
  if (servico && SEGMENTO_DO_SERVICO[servico]) {
    Object.assign(r, { segmento: SEGMENTO_DO_SERVICO[servico], servico });
    ctx.servicoMudou();
    r.passo = logada() ? 'endereco' : 'identificacao';
  }
  registrarFunil(q.get('etapa') === 'calculadora' ? 'abriu_calculadora' : 'iniciou_solicitacao');
  const manter = new URLSearchParams(); if (q.get('v3')) manter.set('v3', q.get('v3')); if (q.get('dev')) manter.set('dev', q.get('dev'));
  if (servico || q.get('etapa') || q.get('frequencia')) history.replaceState(null, '', `${location.pathname}${manter.toString() ? `?${manter}` : ''}`);
  if (!ETAPA[r.passo]) r.passo = 'servico';
  const limite = primeiroIncompleto();
  if (indice(r.passo) > indice(limite) || indice(r.passo) < 0) r.passo = limite;
  salvar();
  history.replaceState({ passo: r.passo }, '');
  render();
}

export { ctx, falta, passosAtivos, novoRascunho, trocarRascunho, auth };
