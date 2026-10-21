// autoagendamento/ v3 (spec-agendamento-v3.txt + autoagendamento-v3-isa.txt, 56 itens da cliente). Roteador das telas:
// 6 etapas na barra de progresso; cada etapa pode ter mais de uma tela, mas sem virar uma página por pergunta (item 56).
// - Rascunho salvo a cada mudança (sem CPF e nascimento); voltar do navegador navega entre telas (history.pushState);
//   deep link da home (?servico=) já cai na identificação.
// - Voltar NUNCA prende nem sai da página (bug de 20/10/2026): o botão calcula a etapa anterior e só usa o histórico quando
//   ele é desta página; ao abrir no meio (rascunho, link da home), o histórico é reconstruído até a etapa atual; uma entrada
//   do histórico que deixou de existir (identificação depois de entrar) cai na etapa anterior que existe, nunca pra frente.
//   O indicador leva às etapas já feitas e "Começar de novo" apaga o rascunho (com confirmação).
// - Guarda de navegação: não dá pra pular uma tela com falta.
import { el, trocar, progresso, confirmar } from './ui.js';
import { montarPagina, definirAbertura } from '../../layout.js';
import { api, agora } from '../../../services/api.js';
import { auth } from '../../../services/auth.js';
import { url } from '../../../config/app.js';
import { CONFIG_PRECOS as CFG } from '../../../config/precos.js';
import { T3, CONTEUDO_AGENDAMENTO_PADRAO } from '../../../config/agendamento-v3.js';
import { dataNoFuso } from '../../../domain/calendario.js';
import { registrarFunil } from '../../observabilidade.js';
import { toast } from '../../toast.js';
import { mensagemErro } from '../../acoes.js';
import { caracteristicasPadrao } from './passo-local.js';
import { estado, salvar, logada, novoRascunho, trocarRascunho } from './estado.js';
import { passoServico } from './passo-servico.js';
import { passoIdentificacao, passoCadastro } from './passo-identificacao.js';
import { passoEndereco } from './passo-endereco.js';
import { passoLocal, faltaLocal } from './passo-local.js';
import { passoModalidade } from './passo-modalidade.js';
import { passoDatas, faltaDatas } from './passo-datas.js';
import { passoConfiguracao, faltaConfiguracao } from './passo-configuracao.js';
import { passoRevisao } from './passo-revisao.js';
import { resumoLateral } from './resumo-lateral.js';
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
  avancar, voltar, render, irPara,
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
    case 'modalidade': return r.modalidade ? null : 'Escolha a modalidade';
    case 'datas': return faltaDatas(ctx);
    case 'configuracao': return faltaConfiguracao(ctx);
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

/** Etapa ativa imediatamente antes de `passo` na ordem do fluxo (vale também pra telas que deixaram de existir). */
function anteriorAtivo(passo) {
  const ordem = PASSOS.map(([p]) => p); const ativos = passosAtivos();
  for (let i = ordem.indexOf(passo) - 1; i >= 0; i--) if (ativos.includes(ordem[i])) return ordem[i];
  return ativos[0];
}
const profundidade = () => (Number.isInteger(history.state?.n) ? history.state.n : 0);
// geração do histórico: "Começar de novo" invalida as entradas antigas (elas não podem levar pra frente)
let geracao = 0;
const estadoHist = (passo, n, ant) => ({ passo, n, ant: ant || null, g: geracao });

function irPara(passo, { empilhar = true } = {}) {
  const r = estado();
  const alvo = indice(passo) > indice(primeiroIncompleto()) ? primeiroIncompleto() : passo;
  r.passo = alvo; salvar();
  if (empilhar) history.pushState(estadoHist(alvo, profundidade() + 1, history.state?.passo), '');
  else history.replaceState(estadoHist(alvo, profundidade(), history.state?.ant), '');
  render();
  document.getElementById('titulo-passo')?.focus?.();
  window.scrollTo?.({ top: 0 });
}
/** Voltar uma tela: pelo histórico quando a entrada anterior é desta página; senão, direto pra etapa anterior. */
function voltar() {
  const r = estado();
  if (indice(r.passo) <= 0) return;
  r.retornarRevisao = false; // voltar por conta própria desfaz o "Alterar" da revisão
  const anterior = anteriorAtivo(r.passo);
  // pelo histórico só quando a entrada anterior é exatamente a etapa anterior (senão o Voltar levaria pra frente)
  if (profundidade() > 0 && history.state?.passo === r.passo && history.state?.ant === anterior && history.state?.g === geracao) { history.back(); return; }
  irPara(anterior, { empilhar: false });
}
/** Indicador de passos: a primeira tela ativa da etapa k (só etapas já feitas viram botão). */
const telaDaEtapa = (k) => passosAtivos().find((x) => ETAPA[x] === k);
function irEtapa(k) {
  const p = telaDaEtapa(k);
  if (!p) return;
  estado().retornarRevisao = false;
  irPara(p);
}
async function recomecar() {
  const ok = await confirmar({ titulo: 'Começar de novo?', texto: 'As escolhas desta solicitação serão apagadas deste aparelho. Nada foi enviado à Prime ainda.', confirmar: 'Começar de novo', cancelar: 'Cancelar' });
  if (!ok) return;
  trocarRascunho(novoRascunho());
  ctx.enderecos = logada() ? ctx.enderecos : null;
  geracao += 1;
  history.replaceState(estadoHist('servico', 0), '');
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
  // entrada de antes do "Começar de novo": fica onde está (nunca leva pra frente)
  if ((ev.state.g ?? 0) !== geracao) { history.replaceState(estadoHist(r.passo, 0), ''); return; }
  // tela que deixou de existir (ex.: identificação depois de entrar): a anterior que existe, nunca pra frente
  const alvo = indice(p) < 0 ? anteriorAtivo(p) : p;
  r.passo = indice(alvo) > indice(primeiroIncompleto()) ? primeiroIncompleto() : alvo;
  if (r.passo !== p) history.replaceState(estadoHist(r.passo, profundidade(), ev.state.ant), '');
  salvar(); render(); document.getElementById('titulo-passo')?.focus?.();
});

/** Telas dos próximos blocos (V3 a V5) entram aqui. */
const TELAS = { servico: passoServico, identificacao: passoIdentificacao, cadastro: passoCadastro, endereco: passoEndereco, local: passoLocal, modalidade: passoModalidade, datas: passoDatas, configuracao: passoConfiguracao, revisao: passoRevisao };
export function registrarTelas(t, faltaExtra) { Object.assign(TELAS, t); const ant = ctx.faltaExtra; ctx.faltaExtra = (p) => faltaExtra?.(p) ?? ant?.(p) ?? null; }

function render() {
  const r = estado();
  if (!ETAPA[r.passo] || indice(r.passo) < 0) r.passo = primeiroIncompleto();
  const tela = TELAS[r.passo];
  const prog = () => progresso(ETAPA[r.passo], T3.etapas, { irEtapa, podeIr: (k) => !!telaDaEtapa(k), recomecar });
  if (!tela) { trocar(raiz, prog(), el('section', { class: 'passo-fluxo', dataset: { passo: r.passo } }, [el('h2', { id: 'titulo-passo', class: 'titulo-passo', tabindex: -1, text: T3.etapas[ETAPA[r.passo] - 1] }), el('p', { class: 'mudo', text: 'Esta etapa entra na próxima entrega.' })])); return; }
  const m = tela(ctx);
  const corpo = m?.form || m;
  if (!corpo) return;
  // no computador, da etapa 2 até antes da revisão, o resumo do que já foi escolhido fica ao lado
  const comResumo = !['servico', 'revisao'].includes(r.passo);
  trocar(raiz, prog(), comResumo ? el('div', { class: 'fluxo-corpo' }, [corpo, resumoLateral(ctx)]) : corpo);
}

/** P6: rascunho a partir do pedido anterior (dados_renovacao); o que o pedido antigo não tem (ambientes, animais) a cliente completa. */
function aplicarRenovacao(d) {
  const e = d.endereco || {};
  const salvo = (ctx.enderecos || []).find((x) => x.cep === String(e.cep || '').replace(/\D/g, '') && x.numero === e.numero);
  const r = { ...novoRascunho(), segmento: d.tipoCliente === 'empresa' ? 'empresa' : 'residencial', servico: d.tipoServico, identificacao: 'cliente' };
  r.endereco = salvo ? { ...r.endereco, modo: 'salvo', id: salvo.id }
    : { ...r.endereco, modo: 'novo', cepSituacao: 'atendida', uso: 'unico', novo: { ...r.endereco.novo, ...e, cep: String(e.cep || '').replace(/\D/g, ''), tipoImovel: '' } };
  r.caracteristicas = { ...caracteristicasPadrao(d.tipoServico), _servico: d.tipoServico, ...(d.metragem ? { metragem: String(d.metragem) } : {}) };
  r.localRefeicao = typeof d.semLocalAlmoco === 'boolean' ? !d.semLocalAlmoco : null;
  Object.assign(r, { duracaoHoras: d.duracaoHoras || 0, duracaoManual: true, datas: d.datas || [], horario: d.horario || '', manterHorario: true,
    modalidade: (d.datas || []).length > 1 ? 'pacote' : 'avulsa', frequencia: (d.datas || []).length > 1 ? 'datas' : '', passo: 'revisao' });
  trocarRascunho(r);
}

export async function iniciar() {
  ctx.hoje = dataNoFuso((await agora()).toISOString(), CFG.regrasNotificacao.fuso);
  try { const c = await api.conteudoAgendamento(); if (c?.tiposImovel && c?.verMais) ctx.conteudo = c; } catch { /* fica o padrão do arquivo */ }
  if (logada()) { try { ctx.enderecos = await api.meusEnderecos(); } catch { ctx.enderecos = null; } }
  let r = estado();
  const q = new URLSearchParams(location.search);
  const servico = q.get('servico');
  if (servico && SEGMENTO_DO_SERVICO[servico]) {
    Object.assign(r, { segmento: SEGMENTO_DO_SERVICO[servico], servico });
    ctx.servicoMudou();
    r.passo = logada() ? 'endereco' : 'identificacao';
  }
  // "CONHECER PACOTES" da home: pacote com a frequência já escolhida (as datas vêm depois da identificação, item 5)
  const freq = q.get('frequencia');
  if (['semanal', 'quinzenal', 'mensal'].includes(freq)) Object.assign(r, { modalidade: 'pacote', frequencia: freq });
  registrarFunil(q.get('etapa') === 'calculadora' ? 'abriu_calculadora' : 'iniciou_solicitacao');
  // P6: link da renovação (M01): a cliente dona recebe o mesmo atendimento com as datas do mês seguinte, pra conferir e enviar
  const repetir = q.get('repetir');
  let avisoRenovacao = null;
  if (repetir) {
    if (!logada()) { location.replace(url('entrar/', { destino: `autoagendamento/?repetir=${encodeURIComponent(repetir)}` })); return; }
    try { aplicarRenovacao(await api.dadosRenovacao(repetir)); avisoRenovacao = ['Trouxemos o mesmo pacote com as datas do mês seguinte. Confira tudo antes de enviar.', 'ok']; }
    catch (e) { avisoRenovacao = [`Não deu pra trazer o pacote: ${mensagemErro(e)}`, 'erro']; }
    r = estado();
  }
  const manter = new URLSearchParams(); if (q.get('v3')) manter.set('v3', q.get('v3')); if (q.get('dev')) manter.set('dev', q.get('dev'));
  if (servico || q.get('etapa') || freq || repetir) history.replaceState(null, '', `${location.pathname}${manter.toString() ? `?${manter}` : ''}`);
  if (!ETAPA[r.passo]) r.passo = 'servico';
  const limite = primeiroIncompleto();
  if (indice(r.passo) > indice(limite) || indice(r.passo) < 0) r.passo = limite;
  salvar();
  // histórico reconstruído até a etapa atual: o voltar do navegador anda uma etapa, mesmo abrindo no meio do fluxo
  const ativos = passosAtivos(); const ate = Math.max(0, ativos.indexOf(r.passo));
  history.replaceState(estadoHist(ativos[0], 0), '');
  for (let i = 1; i <= ate; i++) history.pushState(estadoHist(ativos[i], i, ativos[i - 1]), '');
  render();
  if (avisoRenovacao) toast(...avisoRenovacao, 8000);
}

export { ctx, falta, passosAtivos, novoRascunho, trocarRascunho, auth };
