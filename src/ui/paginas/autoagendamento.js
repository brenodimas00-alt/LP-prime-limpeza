// autoagendamento/ (v2, spec-agendamento-v2.txt + autoagendamento-isa.txt): 6 ETAPAS na barra de progresso, 10 telas
// (os passos 10 a 12 da cliente ficam na revisão). "O cliente escolhe; o sistema calcula e preenche."
// - Rascunho salvo a cada passo (localStorage), SEM CPF e nascimento (só em memória: recarregar pede de novo).
// - Voltar do navegador navega entre passos (history.pushState); deep link da home (?servico=) cai no passo certo.
// - Nenhum valor antes da revisão; o valor da revisão vem do servidor (cotação) e é conferido de novo no envio.
// - A chave de idempotência acompanha o conteúdo: repetir o envio (duplo clique, recarregar) nunca duplica; mudar a
//   solicitação gera chave nova.
import { anexar, el, svg, trocar } from '../dom.js';
import { ICONE_CHECK, ICONE_CASA, ICONE_PREDIO, ICONE_LAMPADA, ICONE_MENOS, ICONE_MAIS, ICONE_FECHAR } from '../icones.js';
import { montarPagina, definirAbertura } from '../layout.js';
import { campo, aplicarErros } from '../form.js';
import { api, agora, novaChave } from '../../services/api.js';
import { sessaoAtual } from '../../services/sessao.js';
import { auth } from '../../services/auth.js';
import { buscarCEP } from '../../services/cep.js';
import { executarAcao, mensagemErro } from '../acoes.js';
import { url } from '../../config/app.js';
import { CONFIG_PRECOS as CFG } from '../../config/precos.js';
import { ONDE, SERVICOS_AGENDAMENTO as SERVICOS, TEXTOS_AGENDAMENTO as T } from '../../config/agendamento.js';
import { CONTEUDO, TEXTOS_CLIENTE } from '../../config/conteudo.js';
import { VERSAO_CONDICOES } from '../../config/legal.js';
import { botaoWhatsAppManual } from '../whatsapp-manual.js';
import { dataNoFuso, somarDias, formatarData, formatarDataCurta, regiaoDoEndereco } from '../../domain/calendario.js';
import { formatarBRL } from '../../domain/dinheiro.js';
import { estimarDuracao, motivoDataIndisponivel, datasDaAgenda, totalComodos, validarSolicitacao } from '../../domain/agenda.js';
import { horariosDeInicio } from '../../domain/horario.js';
import { recomendarPassadoria } from '../../domain/pacote.js';
import { FREQUENCIAS } from '../../domain/modelo.js';
import * as V from '../../domain/validacao.js';
import { caixaAceite, caixasMarketing, exigirAceite } from '../legal-ui.js';
import { criarCalendario } from '../calendario.js';
import { toast } from '../toast.js';

const LS = 'prime.rascunho.agendamento.v2';
const P = CFG.PRECOS;
const PASSOS = [
  ['servico', 1], ['cep', 2], ['endereco', 2], ['local', 3], ['quantidade', 4], ['datas', 4], ['horario', 4], ['repetir', 4], ['dados', 5], ['revisao', 6],
];
const ETAPA = Object.fromEntries(PASSOS);
const ROTULO_COMODO = { quartos: 'Quartos', banheiros: 'Banheiros', salas: 'Salas', cozinhas: 'Cozinhas', areaExterna: 'Área externa' };
// deep link da home: serviço -> onde (mudança e evento existem nos dois; a pessoa troca na etapa 1 se quiser)
const ONDE_DO_SERVICO = { residencial: 'residencial', passadoria: 'residencial', empresarial: 'empresa', condominial: 'empresa', pre_pos_mudanca: 'residencial', pre_pos_evento: 'residencial' };

const raiz = el('div', { class: 'fluxo-agendamento' });
montarPagina(raiz, { ctaDiscreto: true });
document.body.classList.add('pagina-agendamento');
definirAbertura({ rotulo: 'Agendamento', titulo: 'Solicite seu |atendimento|', lead: 'Leva uns 3 minutos.' });

let hoje = '';
const mem = { cpf: '', dataNascimento: '' }; // nunca vai pro localStorage
let r = carregar();
let cadastro = null; // cliente logada: dados do cadastro (travados)
let errosPendentes = null; // erros do servidor mostrados embaixo dos campos ao voltar pro passo

function novoRascunho() {
  return {
    versao: 2, passo: 'servico', chave: novaChave(), chaveConteudo: '',
    tipoCliente: '', tipoServico: '',
    cep: '', cepSituacao: '', endereco: { cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', uf: 'MG' },
    modoMedida: 'metragem', metragem: '', comodos: {}, pecas: 0, duracaoHoras: 0, duracaoManual: false, semLocalAlmoco: null,
    quantidade: '', modo: '', datas: [], primeiraData: '', frequencia: '', qtdRecorrente: 4,
    horario: '', manterHorario: null, horarios: {},
    contato: { nome: '', telefone: '', email: '', cnpj: '', razaoSocial: '', responsavel: '' },
    retornarRevisao: false,
  };
}
/** P6: preenche o rascunho com o pacote do pedido anterior (dados_renovacao), como se a cliente tivesse escolhido. */
function aplicarRenovacao(d) {
  const e = d.endereco || {};
  const reg = regiaoDoEndereco(e, CFG.regioesAtendidas);
  r = {
    ...novoRascunho(), tipoCliente: d.tipoCliente === 'empresa' ? 'empresa' : 'residencial', tipoServico: d.tipoServico,
    cep: V.soDigitos(e.cep || ''), cepSituacao: !reg ? 'nao_atendida' : reg.sobConsulta ? 'sob_consulta' : 'atendida',
    endereco: { cep: e.cep || '', logradouro: e.logradouro || '', numero: e.numero || '', complemento: e.complemento || '', bairro: e.bairro || '', cidade: e.cidade || '', uf: e.uf || 'MG' },
    modoMedida: 'metragem', metragem: d.metragem ? String(d.metragem) : '', duracaoHoras: d.duracaoHoras || 0, duracaoManual: true,
    semLocalAlmoco: typeof d.semLocalAlmoco === 'boolean' ? d.semLocalAlmoco : null,
    quantidade: d.datas.length > 1 ? 'varias' : 'uma', modo: d.datas.length > 1 ? 'datas_escolhidas' : 'unica', datas: d.datas,
    horario: d.horario || '', manterHorario: true, passo: 'revisao',
  };
}
function carregar() {
  try { const j = JSON.parse(localStorage.getItem(LS) || 'null'); if (j && j.versao === 2 && j.chave) return { ...novoRascunho(), ...j }; } catch { /* rascunho corrompido */ }
  return novoRascunho();
}
function salvar() { try { localStorage.setItem(LS, JSON.stringify(r)); } catch { /* sem storage: segue sem retomar */ } }
const logada = () => sessaoAtual()?.ator === 'cliente';
const pf = () => r.tipoCliente !== 'empresa';
const passadoria = () => r.tipoServico === 'passadoria';

// ---------- montagem da solicitação ----------

function datasEscolhidas() {
  if (r.modo === 'recorrente') {
    if (!r.primeiraData || !r.frequencia) return [];
    try { return datasDaAgenda({ modo: 'recorrente', primeiraData: r.primeiraData, frequencia: r.frequencia, quantidade: r.qtdRecorrente }, CFG).map((o) => o.data); } catch { return []; }
  }
  return [...r.datas].sort();
}
function solicitacao() {
  const datas = datasEscolhidas();
  const agenda = r.modo === 'recorrente'
    ? { modo: 'recorrente', primeiraData: r.primeiraData, frequencia: r.frequencia, quantidade: r.qtdRecorrente }
    : { modo: r.modo || 'unica', datas: [...r.datas].sort() };
  if (datas.length > 1 && r.manterHorario === false) agenda.horarios = Object.fromEntries(datas.map((d) => [d, r.horarios[d] || r.horario]));
  else agenda.horario = r.horario;
  const s = { tipoCliente: r.tipoCliente, tipoServico: r.tipoServico, duracaoHoras: Number(r.duracaoHoras), agenda };
  if (passadoria()) { if (r.pecas > 0) s.pecas = r.pecas; } else if (r.modoMedida === 'metragem' && r.metragem !== '') s.metragem = Number(r.metragem);
  else if (totalComodos(r.comodos, CFG) > 0) s.comodos = { ...r.comodos };
  if (r.semLocalAlmoco !== null) s.semLocalAlmoco = r.semLocalAlmoco;
  return s;
}
function dadosCliente() {
  const c = { tipo: r.tipoCliente, nome: pf() ? r.contato.nome : r.contato.responsavel, telefone: r.contato.telefone, email: r.contato.email };
  if (pf()) Object.assign(c, { cpf: mem.cpf, dataNascimento: mem.dataNascimento });
  else Object.assign(c, { cnpj: r.contato.cnpj, razaoSocial: r.contato.razaoSocial, responsavel: r.contato.responsavel });
  return c;
}
function estimativa() {
  if (passadoria()) return r.pecas > 0 ? { horas: recomendarPassadoria(r.pecas, CFG), motivo: 'ok' } : { horas: null, motivo: 'sem_dados' };
  const m = r.modoMedida === 'metragem' && r.metragem !== '' ? Number(r.metragem) : undefined;
  const comodos = r.modoMedida === 'comodos' ? r.comodos : undefined;
  if (m !== undefined && (!Number.isInteger(m) || m < P.metragem.minimo || m > P.metragem.maximo)) return { horas: null, motivo: 'sem_dados' };
  return estimarDuracao({ tipoCliente: r.tipoCliente, metragem: m, comodos }, CFG);
}

// ---------- o que falta em cada passo (guarda de navegação: não deixa pular) ----------

function falta(passo) {
  switch (passo) {
    case 'servico': return !r.tipoCliente ? 'Escolha onde será realizada a limpeza' : !(P.servicosPorTipoCliente[r.tipoCliente] || []).includes(r.tipoServico) ? 'Escolha o serviço' : null;
    case 'cep': return r.cepSituacao === 'atendida' ? null : 'Informe um CEP atendido';
    case 'endereco': { const e = V.validarEndereco(r.endereco); return Object.values(e)[0] || null; }
    case 'local': {
      if (!passadoria()) {
        if (r.modoMedida === 'metragem') { const m = Number(r.metragem); if (r.metragem === '' || !Number.isInteger(m) || m < P.metragem.minimo || m > P.metragem.maximo) return `Informe a metragem: um número inteiro entre ${P.metragem.minimo} e ${P.metragem.maximo}`; }
        else if (totalComodos(r.comodos, CFG) === 0) return 'Informe pelo menos um cômodo';
      }
      if (!r.duracaoHoras) return 'Escolha a duração da diária';
      const e = validarSolicitacao({ ...solicitacao(), agenda: { modo: 'unica', datas: [somarDias(hoje, 2)], horario: '08:00' } }, CFG);
      if (e.length) return e[0];
      if (r.semLocalAlmoco === null) return 'Responda sobre o local para a refeição';
      return null;
    }
    case 'quantidade': return r.quantidade ? null : 'Escolha a quantidade de diárias';
    case 'datas': {
      const ds = datasEscolhidas();
      if (r.modo === 'unica' && ds.length !== 1) return 'Escolha a data da diária';
      if (r.modo === 'datas_escolhidas' && ds.length < 2) return 'Escolha pelo menos 2 datas';
      if (r.modo === 'recorrente' && (!r.frequencia || !r.primeiraData)) return 'Escolha a frequência e a data da primeira diária';
      if (!['unica', 'datas_escolhidas', 'recorrente'].includes(r.modo)) return 'Escolha como deseja agendar';
      const ruim = ds.map((d) => [d, motivoDataIndisponivel(d, hoje, CFG)]).find(([, m]) => m);
      return ruim ? `${formatarDataCurta(ruim[0])}: ${ruim[1]}` : null;
    }
    case 'horario': return horariosDeInicio(r.duracaoHoras || 2, CFG.horariosTrabalho).includes(r.horario) ? null : 'Escolha o horário';
    case 'repetir': {
      if (datasEscolhidas().length < 2) return null;
      if (r.manterHorario === null) return 'Escolha se mantém o horário';
      if (r.manterHorario === false) {
        const opc = horariosDeInicio(r.duracaoHoras || 2, CFG.horariosTrabalho);
        const d = datasEscolhidas().find((x) => !opc.includes(r.horarios[x] || r.horario));
        return d ? `Escolha o horário de ${formatarDataCurta(d)}` : null;
      }
      return null;
    }
    case 'dados': {
      if (logada()) return null;
      const k = r.contato;
      const e = { telefone: V.validarTelefone(k.telefone), email: V.validarEmail(k.email) };
      if (pf()) Object.assign(e, { nome: V.validarNome(k.nome), cpf: V.validarCPF(mem.cpf), dataNascimento: V.validarNascimentoCliente(mem.dataNascimento, hoje) });
      else Object.assign(e, { responsavel: V.validarNome(k.responsavel, 'o responsável'), cnpj: V.validarCNPJ(k.cnpj), razaoSocial: V.validarTextoObrigatorio(k.razaoSocial, 'a razão social') });
      return Object.values(e).find(Boolean) || null;
    }
    default: return null;
  }
}
const passosAtivos = () => PASSOS.map(([p]) => p).filter((p) => p !== 'repetir' || datasEscolhidas().length > 1);
function primeiroIncompleto() { return passosAtivos().find((p) => p !== 'revisao' && falta(p)) || 'revisao'; }
const indice = (p) => passosAtivos().indexOf(p);

function irPara(passo, { empilhar = true } = {}) {
  const alvo = indice(passo) > indice(primeiroIncompleto()) ? primeiroIncompleto() : passo;
  r.passo = alvo; salvar();
  if (empilhar) history.pushState({ passo: alvo }, '');
  render();
  document.getElementById('titulo-passo')?.focus?.();
  window.scrollTo?.({ top: 0 });
}
function avancar() {
  const ativos = passosAtivos();
  const i = ativos.indexOf(r.passo);
  if (r.retornarRevisao) {
    const pendente = ativos.slice(i + 1).find((p) => p !== 'revisao' && falta(p));
    irPara(pendente || 'revisao');
    if (!pendente) r.retornarRevisao = false;
    return;
  }
  irPara(ativos[i + 1] || 'revisao');
}
function voltar() { history.back(); }
window.addEventListener('popstate', (ev) => {
  const p = ev.state?.passo;
  if (p && ETAPA[p]) { r.passo = indice(p) > indice(primeiroIncompleto()) ? primeiroIncompleto() : p; salvar(); render(); document.getElementById('titulo-passo')?.focus?.(); }
});

// ---------- blocos de interface ----------

function progresso() {
  const n = ETAPA[r.passo];
  return el('div', { class: 'progresso-fluxo' }, [
    el('p', { class: 'progresso-rotulo', text: `Etapa ${n} de 6 · ${T.etapas[n - 1]}` }),
    el('div', { class: 'progresso-linha', role: 'progressbar', 'aria-label': 'Progresso da solicitação', 'aria-valuemin': 1, 'aria-valuemax': 6, 'aria-valuenow': n, 'aria-valuetext': `Etapa ${n} de 6: ${T.etapas[n - 1]}` },
      [el('span', { style: `width:${Math.round((n / 6) * 100)}%` })]),
  ]);
}

/** Cards de escolha (radio): ícone opcional, título, texto curto; selecionado com check e contorno (não só cor). */
function cardsEscolha({ nome, legenda, opcoes, valor, aoMudar, colunas = 2, legendaVisivel = true }) {
  const idErro = `${nome}-erro`;
  const erroEl = el('p', { class: 'erro-campo', id: idErro, 'aria-live': 'polite' });
  const inputs = [];
  const fs = el('fieldset', { class: `cards-escolha col-${colunas}`, dataset: { campo: nome }, 'aria-describedby': idErro }, [
    el('legend', { class: legendaVisivel ? 'pergunta' : 'sr-only', text: legenda }),
    el('div', { class: 'cards' }, opcoes.map((o) => {
      const i = el('input', { type: 'radio', name: nome, value: o.valor, checked: String(valor) === String(o.valor), disabled: !!o.desabilitado });
      i.addEventListener('change', () => { erroEl.textContent = ''; fs.classList.remove('invalido'); aoMudar(o.valor); });
      inputs.push(i);
      return el('label', { class: `card-escolha${o.desabilitado ? ' desabilitado' : ''}`, dataset: { valor: o.valor } }, [
        i,
        el('span', { class: 'card-corpo' }, [
          o.icone ? el('span', { class: 'card-icone' }, [svg(o.icone)]) : null,
          el('span', { class: 'card-textos' }, [el('strong', { text: o.titulo }), o.sub ? el('small', { text: o.sub }) : null, o.selo ? el('span', { class: 'selo-sugerida', text: o.selo }) : null]),
          el('span', { class: 'card-check' }, [svg(ICONE_CHECK)]),
        ]),
      ]);
    })),
    erroEl,
  ]);
  return { raiz: fs, inputs, erro: (m) => { erroEl.textContent = m || ''; fs.classList.toggle('invalido', !!m); if (m) inputs.find((x) => !x.disabled)?.focus(); } };
}

/** Contador − N + (botões de 44 px, teclado e leitor de tela: "Quartos, 2"). */
function contador({ id, rotulo, valor, min = 0, max = 20, passo = 1, aoMudar }) {
  let v = valor;
  const saida = el('output', { id: `${id}-valor`, class: 'contador-valor', 'aria-live': 'polite', 'aria-label': `${rotulo}, ${v}`, text: String(v) });
  const menos = el('button', { type: 'button', class: 'contador-btn', 'aria-label': `Diminuir ${rotulo.toLowerCase()}` }, [svg(ICONE_MENOS)]);
  const mais = el('button', { type: 'button', class: 'contador-btn', 'aria-label': `Aumentar ${rotulo.toLowerCase()}` }, [svg(ICONE_MAIS)]);
  const atual = () => { saida.textContent = String(v); saida.setAttribute('aria-label', `${rotulo}, ${v}`); menos.disabled = v <= min; mais.disabled = v >= max; };
  menos.addEventListener('click', () => { v = Math.max(min, v - passo); atual(); aoMudar(v); });
  mais.addEventListener('click', () => { v = Math.min(max, v + passo); atual(); aoMudar(v); });
  atual();
  return el('div', { class: 'contador', dataset: { contador: id } }, [el('span', { class: 'contador-rotulo', id: `${id}-rotulo`, text: rotulo }), el('div', { class: 'contador-controles', role: 'group', 'aria-labelledby': `${id}-rotulo` }, [menos, saida, mais])]);
}

/** Painel lateral (desktop) / folha inferior (mobile) com <dialog>: foco preso e devolvido pelo navegador. */
function abrirPainel(titulo, conteudo) {
  const fechar = el('button', { type: 'button', class: 'painel-fechar', 'aria-label': 'Fechar' }, [svg(ICONE_FECHAR)]);
  const d = el('dialog', { class: 'painel-lateral', 'aria-labelledby': 'painel-titulo' }, [
    el('div', { class: 'painel-topo' }, [el('h2', { id: 'painel-titulo', text: titulo }), fechar]),
    el('div', { class: 'painel-conteudo' }, [].concat(conteudo)),
  ]);
  const quem = document.activeElement;
  fechar.addEventListener('click', () => d.close());
  d.addEventListener('click', (ev) => { if (ev.target === d) d.close(); }); // clique fora
  d.addEventListener('close', () => { d.remove(); quem?.focus?.(); });
  document.body.append(d);
  d.showModal();
  return d;
}

function tela(titulo, corpo, { validar, rotuloAvancar = 'Continuar', semVoltar = false } = {}) {
  const form = el('form', { novalidate: true, class: 'passo-fluxo', 'aria-labelledby': 'titulo-passo', dataset: { passo: r.passo } });
  const erroGeral = el('p', { class: 'alerta alerta-erro', role: 'alert', hidden: true, tabindex: -1 });
  const avancarBtn = el('button', { class: 'btn btn-primary btn-seta', type: 'submit', text: rotuloAvancar });
  const voltarBtn = !semVoltar && indice(r.passo) > 0 ? el('button', { class: 'btn btn-secundario', type: 'button', text: 'Voltar', on: { click: voltar } }) : null;
  anexar(form, el('h2', { id: 'titulo-passo', class: 'titulo-passo', text: titulo, tabindex: -1 }), ...[].concat(corpo), erroGeral,
    el('div', { class: 'barra-acoes' }, [voltarBtn, el('span', { class: 'espaco' }), avancarBtn]));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erroGeral.hidden = true;
    const res = await validar?.();
    if (res === true || res === undefined) {
      const f = falta(r.passo);
      if (f) { erroGeral.hidden = false; erroGeral.textContent = f; erroGeral.focus(); return; }
      salvar(); avancar(); return;
    }
    if (typeof res === 'string') { erroGeral.hidden = false; erroGeral.textContent = res; erroGeral.focus(); }
  });
  const n = ETAPA[r.passo];
  definirAbertura({ rotulo: `Agendamento · Etapa ${n} de 6`, titulo: 'Solicite seu |atendimento|', lead: 'Leva uns 3 minutos.' });
  trocar(raiz, progresso(), form);
  return { form, erroGeral, avancarBtn };
}

// ---------- passos ----------

function passoServico() {
  const servicos = el('div', { class: 'bloco-servicos' });
  const detalhes = el('div', { class: 'acoes-detalhes' });
  const desenharServicos = () => {
    if (!r.tipoCliente) { trocar(servicos); trocar(detalhes); return; }
    const lista = P.servicosPorTipoCliente[r.tipoCliente];
    const g = cardsEscolha({
      nome: 'tipoServico', legenda: 'Qual serviço?', valor: r.tipoServico, colunas: 2,
      opcoes: lista.map((k) => ({ valor: k, titulo: SERVICOS[k].nome, sub: SERVICOS[k].descricao })),
      aoMudar: (v) => { if (r.tipoServico !== v) { r.tipoServico = v; r.duracaoManual = false; r.duracaoHoras = 0; } salvar(); desenharDetalhes(); },
    });
    trocar(servicos, g.raiz, detalhes, el('p', { class: 'nota-discreta', text: T.posObra }));
    desenharDetalhes();
  };
  const desenharDetalhes = () => {
    const s = SERVICOS[r.tipoServico];
    if (!s || !(P.servicosPorTipoCliente[r.tipoCliente] || []).includes(r.tipoServico)) { trocar(detalhes); return; }
    const b = el('button', { type: 'button', class: 'btn-link', dataset: { acao: 'ver-detalhes' }, text: T.verDetalhes });
    b.addEventListener('click', () => abrirPainel(s.nome, [el('p', { class: 'mudo', text: s.descricao }), el('h3', { text: 'O que está incluído' }), el('ul', { class: 'lista-incluido' }, s.incluido.map((i) => el('li', { text: i })))]));
    trocar(detalhes, b);
  };
  const onde = cardsEscolha({
    nome: 'tipoCliente', legenda: T.perguntaOnde, valor: r.tipoCliente, colunas: 2,
    opcoes: [
      { valor: 'residencial', titulo: ONDE.residencial.titulo, sub: ONDE.residencial.sub, icone: ICONE_CASA },
      { valor: 'empresa', titulo: ONDE.empresa.titulo, sub: ONDE.empresa.sub, icone: ICONE_PREDIO },
    ],
    aoMudar: (v) => {
      r.tipoCliente = v;
      if (!P.servicosPorTipoCliente[v].includes(r.tipoServico)) { r.tipoServico = ''; r.duracaoHoras = 0; r.duracaoManual = false; }
      salvar(); desenharServicos();
    },
  });
  desenharServicos();
  tela(T.tituloServico, [onde.raiz, servicos], {
    validar: () => {
      if (!r.tipoCliente) { onde.erro('Escolha onde será realizada a limpeza'); return false; }
      if (!r.tipoServico) { servicos.querySelector('fieldset') && cardsErro(servicos, 'Escolha o serviço'); return false; }
      return true;
    },
  });
}
function cardsErro(bloco, msg) {
  const fs = bloco.querySelector('fieldset'); const p = fs?.querySelector('.erro-campo');
  if (p) p.textContent = msg; fs?.classList.add('invalido'); fs?.querySelector('input')?.focus();
}

function passoCep() {
  const cep = campo({ id: 'cep', rotulo: 'CEP', valor: V.mascaraCEP(r.cep), mascara: V.mascaraCEP, attrs: { inputmode: 'numeric', autocomplete: 'postal-code', maxlength: 9 } });
  const status = el('div', { class: 'status-cep', 'aria-live': 'polite', id: 'status-cep' });
  const cidades = CFG.regioesAtendidas;
  let ultimo = '';
  const mostrar = () => {
    const e = r.endereco;
    if (r.cepSituacao === 'atendida') trocar(status, el('p', { class: 'alerta alerta-ok', dataset: { regiao: 'atendida' }, text: `Atendemos ${e.cidade}. Pode continuar.` }));
    else if (r.cepSituacao === 'sob_consulta') {
      trocar(status, el('div', { class: 'alerta alerta-info', dataset: { regiao: 'sob-consulta' } }, [
        el('p', { text: `${e.cidade} é atendida sob consulta: a Prime confirma com você pelo WhatsApp.` }),
        el('div', { class: 'acoes', style: 'margin-top:10px' }, [botaoWhatsAppManual({ texto: `Oi! Quero solicitar uma limpeza em ${e.cidade} (CEP ${V.mascaraCEP(r.cep)}). Vocês atendem?`, rotulo: 'Falar com a Prime', contexto: 'sob-consulta' })]),
      ]));
    } else if (r.cepSituacao === 'nao_atendida') {
      trocar(status, el('p', { class: 'alerta alerta-erro', dataset: { regiao: 'nao-atendida' }, text: `Ainda não atendemos ${e.cidade || 'esse CEP'}. Atendemos: ${cidades.filter((x) => !x.sobConsulta).map((x) => x.cidade).join(', ')}.` }));
    } else if (r.cepSituacao === 'manual') {
      const sel = campo({ id: 'cidade-manual', rotulo: 'Cidade', tipo: 'select', valor: e.cidade, opcoes: [['', 'Escolha a cidade'], ...cidades.map((x) => [x.cidade, x.cidade]), ['__outra', 'Outra cidade']] });
      sel.input.addEventListener('change', () => {
        const v = sel.input.value;
        if (!v) return;
        if (v === '__outra') { r.endereco.cidade = ''; r.cepSituacao = 'nao_atendida'; salvar(); mostrar(); return; }
        r.endereco = { ...r.endereco, cidade: v, uf: 'MG' };
        const reg = regiaoDoEndereco(r.endereco, cidades);
        r.cepSituacao = reg.sobConsulta ? 'sob_consulta' : 'atendida'; salvar(); mostrar();
      });
      trocar(status, el('p', { class: 'ajuda', text: 'Não conseguimos consultar o CEP agora. Escolha a cidade para continuar.' }), sel.raiz);
    } else trocar(status);
  };
  const consultar = async () => {
    const d = V.soDigitos(cep.input.value);
    if (d.length !== 8) { if (d !== V.soDigitos(r.cep)) { r.cep = d; r.cepSituacao = ''; salvar(); mostrar(); } return; }
    if (d === ultimo) return;
    ultimo = d;
    r.cep = d; r.cepSituacao = ''; salvar();
    trocar(status, el('p', { class: 'ajuda', text: 'Verificando…' }));
    const res = await buscarCEP(d);
    if (V.soDigitos(cep.input.value) !== d) return; // CEP mudou enquanto buscava: resposta velha não vale
    if (!res) { r.endereco = { ...r.endereco, cep: d, logradouro: '', bairro: '', cidade: '', uf: 'MG' }; r.cepSituacao = 'manual'; salvar(); mostrar(); return; }
    if (res.naoExiste) { r.cepSituacao = ''; salvar(); trocar(status); cep.erro('CEP não encontrado. Confira os números.'); return; }
    r.endereco = { ...r.endereco, cep: d, logradouro: res.logradouro || '', bairro: res.bairro || '', cidade: res.cidade || '', uf: res.uf || 'MG' };
    const reg = regiaoDoEndereco(r.endereco, cidades);
    r.cepSituacao = !reg ? 'nao_atendida' : reg.sobConsulta ? 'sob_consulta' : 'atendida';
    salvar(); mostrar();
  };
  cep.input.addEventListener('input', consultar);
  mostrar();
  tela(T.tituloCep, [cep.raiz, status], {
    validar: () => {
      if (V.soDigitos(cep.input.value).length !== 8) { cep.erro('Informe o CEP com 8 números'); return false; }
      if (r.cepSituacao === 'atendida') return true;
      if (r.cepSituacao === 'manual') return 'Escolha a cidade';
      if (!r.cepSituacao) { consultar(); return 'Aguarde a verificação do CEP'; }
      status.querySelector('.alerta')?.setAttribute('tabindex', '-1'); status.querySelector('.alerta')?.focus();
      return false;
    },
  });
}

function passoEndereco() {
  const e = r.endereco;
  const c = {
    cep: campo({ id: 'cep-endereco', rotulo: 'CEP', valor: V.mascaraCEP(e.cep || r.cep), attrs: { readonly: true } }),
    logradouro: campo({ id: 'logradouro', rotulo: 'Rua/Avenida', valor: e.logradouro, attrs: { autocomplete: 'address-line1', maxlength: 120 } }),
    numero: campo({ id: 'numero', rotulo: 'Número', valor: e.numero, attrs: { maxlength: 10, inputmode: 'text' } }),
    complemento: campo({ id: 'complemento', rotulo: 'Complemento', valor: e.complemento, attrs: { autocomplete: 'address-line2', maxlength: 60 } }),
    bairro: campo({ id: 'bairro', rotulo: 'Bairro', valor: e.bairro, attrs: { maxlength: 80 } }),
    cidade: campo({ id: 'cidade', rotulo: 'Cidade', valor: e.cidade, attrs: { readonly: true } }),
    uf: campo({ id: 'uf', rotulo: 'UF', valor: e.uf, attrs: { readonly: true, maxlength: 2 } }),
  };
  for (const k of ['logradouro', 'numero', 'complemento', 'bairro']) c[k].input.addEventListener('input', () => { r.endereco[k] = c[k].input.value; salvar(); });
  const trocarCep = el('button', { type: 'button', class: 'btn-link', text: 'Trocar o CEP', on: { click: () => irPara('cep') } });
  if (errosPendentes) { const ep = errosPendentes; errosPendentes = null; queueMicrotask(() => aplicarErros(Object.fromEntries(Object.entries(ep).map(([k, v]) => [k.replace('endereco.', ''), v])), c)); }
  tela(T.tituloEndereco, [
    el('div', { class: 'grade-endereco' }, [el('div', { class: 'campo-cep' }, [c.cep.raiz, trocarCep]), c.logradouro.raiz, c.numero.raiz, c.complemento.raiz, c.bairro.raiz, c.cidade.raiz, c.uf.raiz]),
  ], {
    validar: () => {
      r.endereco.cep = r.cep;
      const erros = V.validarEndereco(r.endereco);
      return aplicarErros(erros, c);
    },
  });
}

function passoLocal() {
  const sugestao = el('div', { class: 'sugestao-duracao', 'aria-live': 'polite', id: 'sugestao' });
  const duracao = el('div', { id: 'duracoes' });
  const medida = el('div', { class: 'bloco-medida' });
  const lim2 = P.limitesDuracao[r.tipoCliente === 'empresa' ? 'empresa' : 'residencial'][0];
  const desenharDuracao = () => {
    const est = estimativa();
    if (est.horas && !r.duracaoManual) r.duracaoHoras = est.horas;
    // 2h só dentro do limite dela (sem citar valor: nenhum R$ antes da revisão)
    const total = totalComodos(r.comodos, CFG);
    const doisBloqueado = !passadoria() && ((r.modoMedida === 'metragem' && Number(r.metragem) > lim2.metragem) || (r.modoMedida === 'comodos' && total > lim2.comodos));
    if (doisBloqueado && Number(r.duracaoHoras) === 2) { r.duracaoHoras = est.horas || 0; r.duracaoManual = false; }
    salvar();
    if (est.horas) {
      trocar(sugestao, el('div', { class: 'cartao-sugestao', dataset: { sugestao: est.horas } }, [
        el('h3', { text: T.tituloSugestao }), el('p', { class: 'sugestao-texto', text: T.sugestao(est.horas) }), el('p', { class: 'sugestao-aviso', text: T.sugestaoAviso }),
      ]));
    } else if (est.motivo === 'acima') {
      trocar(sugestao, el('div', { class: 'alerta alerta-info', dataset: { sugestao: 'acima' } }, [
        el('p', { text: CONTEUDO.acimaDe120 }),
        el('div', { class: 'acoes', style: 'margin-top:10px' }, [botaoWhatsAppManual({ texto: 'Oi! Meu local é grande. Como a Prime monta o atendimento nesse caso?', rotulo: 'Falar com a Prime', contexto: 'acima-limite' })]),
      ]));
    } else trocar(sugestao);
    const g = cardsEscolha({
      nome: 'duracaoHoras', legenda: 'Duração da diária', valor: String(r.duracaoHoras || ''), colunas: 4,
      opcoes: Object.keys(P.duracoes).map((h) => ({
        valor: h, titulo: `${h} horas`, selo: est.horas === Number(h) ? 'sugerida' : null,
        sub: Number(h) === 2 && !passadoria() ? `até ${lim2.metragem} m² e ${lim2.comodos} cômodos` : null,
        desabilitado: Number(h) === 2 && doisBloqueado,
      })),
      aoMudar: (v) => { r.duracaoHoras = Number(v); r.duracaoManual = true; salvar(); },
    });
    trocar(duracao, g.raiz);
  };
  const desenharMedida = () => {
    if (passadoria()) {
      trocar(medida, el('p', { class: 'pergunta', text: 'Quantas peças, mais ou menos?' }),
        contador({ id: 'pecas', rotulo: 'Peças', valor: r.pecas, min: 0, max: P.pecas.maximo, passo: 5, aoMudar: (v) => { r.pecas = v; salvar(); desenharDuracao(); } }),
        el('p', { class: 'ajuda', text: P.avisoPassadoria }));
      return;
    }
    if (r.modoMedida === 'metragem') {
      const m = campo({ id: 'metragem', rotulo: 'Metragem aproximada (m²)', tipo: 'number', valor: r.metragem, attrs: { min: P.metragem.minimo, max: P.metragem.maximo, step: 1, inputmode: 'numeric' } });
      m.input.addEventListener('input', () => { r.metragem = m.input.value; salvar(); desenharDuracao(); });
      const nao = el('button', { type: 'button', class: 'btn-link', dataset: { acao: 'nao-sei-metragem' }, text: T.naoSeiMetragem, on: { click: () => { r.modoMedida = 'comodos'; r.duracaoManual = false; salvar(); desenharMedida(); desenharDuracao(); medida.querySelector('.contador-btn:not([disabled])')?.focus(); } } });
      trocar(medida, el('p', { class: 'pergunta', text: T.perguntaMetragem }), m.raiz, nao);
      return;
    }
    const sei = el('button', { type: 'button', class: 'btn-link', text: 'Sei a metragem', on: { click: () => { r.modoMedida = 'metragem'; r.duracaoManual = false; salvar(); desenharMedida(); desenharDuracao(); document.getElementById('metragem')?.focus(); } } });
    trocar(medida, el('p', { class: 'pergunta', text: 'Quantos cômodos o local tem?' }),
      el('div', { class: 'contadores' }, P.comodos.tipos.map((k) => contador({ id: `comodo-${k}`, rotulo: ROTULO_COMODO[k], valor: r.comodos[k] || 0, max: P.comodos.maximoPorTipo, aoMudar: (v) => { r.comodos = { ...r.comodos, [k]: v }; salvar(); desenharDuracao(); } }))),
      sei);
  };
  const almoco = cardsEscolha({
    nome: 'semLocalAlmoco', legenda: 'Há local para a profissional guardar e esquentar a refeição?', valor: r.semLocalAlmoco === null ? '' : r.semLocalAlmoco ? 'nao' : 'sim', colunas: 2,
    opcoes: [{ valor: 'sim', titulo: 'Sim' }, { valor: 'nao', titulo: 'Não' }],
    aoMudar: (v) => { r.semLocalAlmoco = v === 'nao'; salvar(); },
  });
  const aviso = el('aside', { class: 'aviso-discreto', 'aria-label': T.detalhadaTitulo }, [el('span', { class: 'aviso-icone' }, [svg(ICONE_LAMPADA)]), el('div', {}, [el('strong', { text: T.detalhadaTitulo }), el('p', { text: T.detalhada })])]);
  desenharMedida(); desenharDuracao();
  tela(T.tituloLocal, [medida, sugestao, duracao, almoco.raiz, aviso], {
    validar: () => {
      const f = falta('local');
      if (f === 'Responda sobre o local para a refeição') { almoco.erro(f); return false; }
      if (f && /metragem/.test(f)) { const i = document.getElementById('metragem'); i?.focus(); return f; }
      return f || true;
    },
  });
}

function passoQuantidade() {
  const g = cardsEscolha({
    nome: 'quantidade', legenda: T.tituloQuantidade, legendaVisivel: false, valor: r.quantidade, colunas: 2,
    opcoes: [{ valor: 'uma', titulo: '1 diária' }, { valor: 'varias', titulo: 'Mais de uma diária' }],
    aoMudar: (v) => {
      r.quantidade = v;
      if (v === 'uma') { r.modo = 'unica'; r.datas = r.datas.slice(0, 1); } else if (r.modo === 'unica' || !r.modo) r.modo = 'datas_escolhidas';
      salvar();
    },
  });
  tela(T.tituloQuantidade, [g.raiz], { validar: () => (r.quantidade ? true : (g.erro('Escolha uma opção'), false)) });
}

function passoDatas() {
  const r2 = { antecedencia: CFG.regrasCalendario.antecedenciaMinimaDias ?? 1, horizonte: CFG.regrasCalendario.horizonteMaximoDias ?? 120 };
  const min = somarDias(hoje, r2.antecedencia); const max = somarDias(hoje, r2.horizonte);
  const lista = el('div', { class: 'suas-datas', 'aria-live': 'polite' });
  const extra = el('div', { class: 'bloco-recorrente' });
  const cal = criarCalendario({
    min, max, inicial: datasEscolhidas()[0], rotulo: T.tituloDatas,
    escolhidas: () => (r.modo === 'recorrente' ? (r.primeiraData ? [r.primeiraData] : []) : r.datas),
    motivo: (d) => motivoDataIndisponivel(d, hoje, CFG),
    aoEscolher: (d) => {
      if (r.modo === 'recorrente') r.primeiraData = d;
      else if (r.modo === 'unica') r.datas = [d];
      else if (r.datas.includes(d)) r.datas = r.datas.filter((x) => x !== d);
      else if (r.datas.length < P.quantidadeDiarias.maximo) r.datas = [...r.datas, d];
      salvar(); desenharLista();
    },
  });
  const desenharLista = () => {
    const ds = datasEscolhidas();
    const item = (d) => el('li', { dataset: { data: d } }, [
      el('span', { text: formatarDataCurta(d) }),
      r.modo === 'datas_escolhidas' ? el('button', { type: 'button', class: 'btn-link', 'aria-label': `Remover ${formatarData(d)}`, text: 'Remover', on: { click: () => { r.datas = r.datas.filter((x) => x !== d); salvar(); cal.atualizar(); desenharLista(); } } }) : null,
    ]);
    const erroRec = r.modo === 'recorrente' && r.primeiraData ? ds.map((d) => [d, motivoDataIndisponivel(d, hoje, CFG)]).find(([, m]) => m) : null;
    trocar(lista, ds.length ? el('h3', { text: T.suasDatas }) : null, ds.length ? el('ul', { class: 'lista-datas' }, ds.map(item)) : null,
      erroRec ? el('p', { class: 'alerta alerta-erro', text: `${formatarDataCurta(erroRec[0])}: ${erroRec[1]}. Escolha outra primeira data ou menos diárias.` }) : null,
      r.modo === 'datas_escolhidas' && ds.length ? el('button', { type: 'button', class: 'btn btn-secundario btn-pequeno', text: T.adicionarDiaria, on: { click: () => cal.focar() } }) : null);
  };
  const desenharRecorrente = () => {
    if (r.modo !== 'recorrente') { trocar(extra); return; }
    const f = cardsEscolha({
      nome: 'frequencia', legenda: 'Frequência', valor: r.frequencia, colunas: 3,
      opcoes: ['semanal', 'quinzenal', 'mensal'].map((k) => ({ valor: k, titulo: FREQUENCIAS[k] })),
      aoMudar: (v) => { r.frequencia = v; salvar(); desenharLista(); },
    });
    trocar(extra, f.raiz, contador({ id: 'qtd-recorrente', rotulo: 'Quantidade de diárias', valor: r.qtdRecorrente, min: 2, max: P.quantidadeDiarias.maximo, aoMudar: (v) => { r.qtdRecorrente = v; salvar(); desenharLista(); } }));
  };
  const blocos = [];
  if (r.quantidade === 'varias') {
    blocos.push(cardsEscolha({
      nome: 'modo', legenda: T.tituloComoAgendar, valor: r.modo, colunas: 2,
      opcoes: [{ valor: 'datas_escolhidas', titulo: 'Escolher várias datas' }, { valor: 'recorrente', titulo: 'Atendimento recorrente' }],
      aoMudar: (v) => { r.modo = v; salvar(); desenharRecorrente(); cal.atualizar(); desenharLista(); },
    }).raiz);
  }
  desenharRecorrente(); desenharLista();
  tela(T.tituloDatas, [...blocos, extra, cal.raiz, lista], { validar: () => falta('datas') || true });
}

function botoesHorario({ nome, legenda, valor, aoMudar, compacto = false }) {
  const opcoes = horariosDeInicio(r.duracaoHoras || 2, CFG.horariosTrabalho);
  return cardsEscolha({ nome, legenda, valor, colunas: compacto ? 6 : 4, legendaVisivel: !!legenda, opcoes: opcoes.map((h) => ({ valor: h, titulo: h })), aoMudar });
}

function passoHorario() {
  if (r.horario && !horariosDeInicio(r.duracaoHoras || 2, CFG.horariosTrabalho).includes(r.horario)) { r.horario = ''; salvar(); }
  const multiplas = datasEscolhidas().length > 1;
  const g = botoesHorario({ nome: 'horario', legenda: multiplas ? `Horário de início (${formatarDataCurta(datasEscolhidas()[0])})` : 'Horário de início', valor: r.horario, aoMudar: (v) => { r.horario = v; salvar(); } });
  g.raiz.classList.add('grade-horarios');
  tela(T.tituloHorario, [g.raiz], { validar: () => (r.horario ? true : (g.erro('Escolha o horário'), false)) });
}

function passoRepetir() {
  const lista = el('div', { class: 'horarios-individuais' });
  const desenhar = () => {
    if (r.manterHorario !== false) { trocar(lista); return; }
    trocar(lista, ...datasEscolhidas().map((d) => {
      const g = botoesHorario({ nome: `horario-${d}`, legenda: formatarDataCurta(d), valor: r.horarios[d] || r.horario, compacto: true, aoMudar: (v) => { r.horarios = { ...r.horarios, [d]: v }; salvar(); } });
      g.raiz.classList.add('grade-horarios');
      return g.raiz;
    }));
  };
  const g = cardsEscolha({
    nome: 'manterHorario', legenda: T.tituloRepetir, legendaVisivel: false, valor: r.manterHorario === null ? '' : r.manterHorario ? 'sim' : 'nao', colunas: 2,
    opcoes: [{ valor: 'sim', titulo: T.repetirSim, sub: `${r.horario} em todas as datas` }, { valor: 'nao', titulo: T.repetirNao }],
    aoMudar: (v) => { r.manterHorario = v === 'sim'; if (!r.manterHorario) r.horarios = Object.fromEntries(datasEscolhidas().map((d) => [d, r.horarios[d] || r.horario])); salvar(); desenhar(); },
  });
  desenhar();
  tela(T.tituloRepetir, [g.raiz, lista], { validar: () => (r.manterHorario === null ? (g.erro('Escolha uma opção'), false) : (falta('repetir') || true)) });
}

async function passoDados() {
  if (logada()) {
    if (!cadastro) {
      trocar(raiz, progresso(), el('p', { class: 'mudo', text: 'Carregando seus dados…' }));
      try { cadastro = await api.obterMeuCadastro(); } catch { cadastro = null; }
    }
    const c = cadastro || {};
    const difTipo = cadastro && cadastro.tipo !== r.tipoCliente;
    tela(T.tituloDados, [
      el('p', { class: 'mudo', text: `Você entrou como ${sessaoAtual().nome}. Estes são os dados do seu cadastro.` }),
      el('dl', { class: 'dados dados-travados', dataset: { travados: '1' } }, [
        el('dt', { text: c.cnpj ? 'Responsável' : 'Nome completo' }), el('dd', { text: c.cnpj ? (c.responsavel || c.nome) : c.nome || '' }),
        c.cnpj ? el('dt', { text: 'Razão social' }) : null, c.cnpj ? el('dd', { text: c.razaoSocial || '' }) : null,
        el('dt', { text: 'WhatsApp' }), el('dd', { text: V.mascaraTelefone(c.telefone || '') }),
        el('dt', { text: 'E-mail' }), el('dd', { text: c.email || '' }),
        c.cpf ? el('dt', { text: 'CPF' }) : null, c.cpf ? el('dd', { text: `***.${c.cpf.slice(3, 6)}.${c.cpf.slice(6, 9)}-**` }) : null,
      ]),
      el('p', {}, [el('a', { href: url('minha-conta/'), text: 'Alterar os dados em Minha conta' })]),
      difTipo ? el('p', { class: 'alerta alerta-erro', text: `Sua conta é de ${cadastro.tipo === 'empresa' ? 'empresa' : 'pessoa física'}. Volte à etapa 1 e escolha ${cadastro.tipo === 'empresa' ? 'Empresarial' : 'Residencial'}, ou fale com a Prime.` }) : null,
    ], { validar: () => (difTipo ? 'Tipo de local diferente do seu cadastro' : true) });
    return;
  }
  const k = r.contato;
  const c = {};
  if (pf()) c.nome = campo({ id: 'nome', rotulo: 'Nome completo', valor: k.nome, attrs: { autocomplete: 'name', maxlength: 120 } });
  else {
    c.responsavel = campo({ id: 'responsavel', rotulo: 'Nome do responsável', valor: k.responsavel, attrs: { autocomplete: 'name', maxlength: 120 } });
  }
  c.telefone = campo({ id: 'telefone', rotulo: 'WhatsApp', tipo: 'tel', valor: V.mascaraTelefone(k.telefone), mascara: V.mascaraTelefone, attrs: { autocomplete: 'tel-national', inputmode: 'tel', maxlength: 15 } });
  c.email = campo({ id: 'email', rotulo: 'E-mail', tipo: 'email', valor: k.email, attrs: { autocomplete: 'email', maxlength: 254 } });
  if (pf()) {
    c.cpf = campo({ id: 'cpf', rotulo: 'CPF', valor: V.mascaraCPF(mem.cpf), mascara: V.mascaraCPF, attrs: { inputmode: 'numeric', maxlength: 14, autocomplete: 'off' } });
    c.dataNascimento = campo({ id: 'dataNascimento', rotulo: 'Data de nascimento', tipo: 'date', valor: mem.dataNascimento, attrs: { max: hoje, min: '1900-01-01' } });
  } else {
    c.cnpj = campo({ id: 'cnpj', rotulo: 'CNPJ', valor: k.cnpj, mascara: V.mascaraCNPJ, attrs: { autocomplete: 'off', inputmode: 'text', maxlength: 18 } });
    c.razaoSocial = campo({ id: 'razaoSocial', rotulo: 'Razão social', valor: k.razaoSocial, attrs: { autocomplete: 'organization', maxlength: 120 } });
  }
  for (const [kk, cc] of Object.entries(c)) {
    cc.input.addEventListener('input', () => { if (kk === 'cpf' || kk === 'dataNascimento') mem[kk] = cc.input.value; else { r.contato[kk] = cc.input.value; salvar(); } });
  }
  const aviso = pf() && (!mem.cpf || !mem.dataNascimento) && (k.nome || k.email)
    ? el('p', { class: 'ajuda', text: 'Por segurança, o CPF e a data de nascimento não ficam salvos no aparelho. Informe de novo, se precisar.' }) : null;
  if (errosPendentes) { const ep = errosPendentes; errosPendentes = null; queueMicrotask(() => aplicarErros(ep, c)); }
  // "Já é cliente? Entrar": entra sem sair do fluxo e sem perder o rascunho
  const caixaEntrar = el('div', { class: 'entrar-inline', hidden: true, id: 'entrar-inline' });
  const abrirEntrar = el('button', { type: 'button', class: 'btn-link', 'aria-expanded': 'false', 'aria-controls': 'entrar-inline', text: T.jaCliente });
  abrirEntrar.addEventListener('click', () => {
    const abrir = caixaEntrar.hidden;
    caixaEntrar.hidden = !abrir; abrirEntrar.setAttribute('aria-expanded', String(abrir));
    if (abrir && !caixaEntrar.firstChild) montarEntrar(caixaEntrar);
    if (abrir) caixaEntrar.querySelector('input')?.focus();
  });
  tela(T.tituloDados, [...Object.values(c).map((x) => x.raiz), aviso, el('div', { class: 'ja-cliente' }, [abrirEntrar, caixaEntrar])], {
    validar: () => {
      const e = { telefone: V.validarTelefone(k.telefone), email: V.validarEmail(k.email) };
      if (pf()) Object.assign(e, { nome: V.validarNome(k.nome), cpf: V.validarCPF(mem.cpf), dataNascimento: V.validarNascimentoCliente(mem.dataNascimento, hoje) });
      else Object.assign(e, { responsavel: V.validarNome(k.responsavel, 'o responsável'), cnpj: V.validarCNPJ(k.cnpj), razaoSocial: V.validarTextoObrigatorio(k.razaoSocial, 'a razão social') });
      return aplicarErros(e, c);
    },
  });
}

function montarEntrar(caixa) {
  const id = campo({ id: 'entrar-identificador', rotulo: 'E-mail, celular ou CPF', attrs: { autocomplete: 'username', maxlength: 254 } });
  const senha = campo({ id: 'entrar-senha', rotulo: 'Senha', tipo: 'password', attrs: { autocomplete: 'current-password', maxlength: 72 } });
  const erro = el('p', { class: 'alerta alerta-erro', role: 'alert', hidden: true });
  const b = el('button', { type: 'button', class: 'btn btn-primary btn-pequeno', text: 'Entrar' });
  b.addEventListener('click', () => executarAcao(b, () => auth.entrarCliente({ identificador: id.input.value, senha: senha.input.value }), {
    aoSucesso: (s) => {
      if (s?.ator !== 'cliente') { erro.hidden = false; erro.textContent = 'Esta conta não é de cliente. Use o e-mail ou CPF da sua conta de cliente.'; return; }
      cadastro = null; render(); document.getElementById('titulo-passo')?.focus?.();
    },
    aoErro: (e) => { erro.hidden = false; erro.textContent = mensagemErro(e); },
  }));
  trocar(caixa, id.raiz, senha.raiz, erro, b);
}

async function passoRevisao() {
  const sol = solicitacao();
  const ende = { ...r.endereco, cep: r.cep };
  const valor = el('div', { class: 'bloco-valor', 'aria-live': 'polite' }, [el('p', { class: 'mudo', text: 'Calculando o valor…' })]);
  const ds = datasEscolhidas();
  const horariosTexto = ds.length > 1 && r.manterHorario === false ? ds.map((d) => `${formatarDataCurta(d)} às ${r.horarios[d] || r.horario}`) : [`${r.horario}${ds.length > 1 ? ' em todas as datas' : ''}`];
  const bloco = (rotulo, conteudo, passo, id) => el('div', { class: 'revisao-bloco', dataset: { bloco: id } }, [
    el('div', { class: 'revisao-topo' }, [el('h3', { text: rotulo }), passo ? el('button', { type: 'button', class: 'btn-link', 'aria-label': `Alterar ${rotulo.toLowerCase()}`, text: 'Alterar', on: { click: () => { r.retornarRevisao = true; irPara(passo); } } }) : null]),
    ...[].concat(conteudo).map((t) => (typeof t === 'string' ? el('p', { text: t }) : t)),
  ]);
  const e = r.endereco;
  const medidaTexto = passadoria() ? (r.pecas ? `cerca de ${r.pecas} peças` : '') : r.modoMedida === 'metragem' ? `${r.metragem} m²` : `${totalComodos(r.comodos, CFG)} cômodos`;
  const blocos = [
    bloco('Serviço', [SERVICOS[r.tipoServico].nome, `${ONDE[r.tipoCliente].titulo}${medidaTexto ? ` · ${medidaTexto}` : ''}`], 'servico', 'servico'),
    bloco('Local', [`${e.logradouro}, ${e.numero}${e.complemento ? `, ${e.complemento}` : ''}`, `${e.bairro}, ${e.cidade}/${e.uf} · CEP ${V.mascaraCEP(r.cep)}`], 'endereco', 'local'),
    bloco('Datas', [el('ul', { class: 'lista-datas' }, ds.map((d) => el('li', { text: formatarData(d) })))], 'datas', 'datas'),
    bloco('Horários', horariosTexto, ds.length > 1 ? 'repetir' : 'horario', 'horarios'),
    bloco('Duração', [`${r.duracaoHoras} horas por diária`], 'local', 'duracao'),
    r.modo === 'recorrente' ? bloco('Frequência', [`${FREQUENCIAS[r.frequencia]}, ${r.qtdRecorrente} diárias`], 'datas', 'frequencia') : null,
    bloco('Valor', [valor], null, 'valor'),
  ];
  let cotacao = null;
  const semValor = () => !cotacao?.pacote;
  const aceiteCond = el('input', { type: 'checkbox', id: 'aceite-condicoes', name: 'aceite-condicoes' });
  const linkCond = el('button', { type: 'button', class: 'btn-link', dataset: { acao: 'ver-condicoes' }, text: 'Condições do atendimento' });
  linkCond.addEventListener('click', abrirCondicoes);
  const erroAceite = el('p', { class: 'erro-campo', id: 'aceite-condicoes-erro', 'aria-live': 'polite' });
  aceiteCond.setAttribute('aria-describedby', 'aceite-condicoes-erro');
  const termos = logada() ? null : caixaAceite();
  const marketing = logada() ? null : caixasMarketing();
  const enviar = el('button', { type: 'button', class: 'btn btn-primary btn-enviar', text: T.botaoFinal, disabled: true });
  const erroGeral = el('p', { class: 'alerta alerta-erro', role: 'alert', hidden: true, tabindex: -1 });
  const atualizarBotao = () => { enviar.disabled = semValor() || !(aceiteCond.checked && (!termos || termos.aceito())); };
  aceiteCond.addEventListener('change', () => { erroAceite.textContent = ''; atualizarBotao(); });
  termos?.input.addEventListener('change', atualizarBotao);
  const voltarBtn = el('button', { class: 'btn btn-secundario', type: 'button', text: 'Voltar', on: { click: voltar } });
  definirAbertura({ rotulo: 'Agendamento · Etapa 6 de 6', titulo: 'Solicite seu |atendimento|', lead: 'Leva uns 3 minutos.' });
  trocar(raiz, progresso(), el('section', { class: 'passo-fluxo', 'aria-labelledby': 'titulo-passo', dataset: { passo: 'revisao' } }, [
    el('h2', { id: 'titulo-passo', class: 'titulo-passo', text: T.tituloRevisao, tabindex: -1 }),
    el('div', { class: 'revisao' }, blocos),
    el('div', { class: 'revisao-bloco', dataset: { bloco: 'pagamento' } }, [el('h3', { text: 'Pagamento' }), el('p', { text: T.pagamento })]),
    el('div', { class: 'bloco-condicoes' }, [
      el('p', {}, ['Antes de enviar, leia as ', linkCond, '.']),
      el('div', { class: 'grupo', dataset: { campo: 'aceiteCondicoes' } }, [el('label', { class: 'opcao', for: 'aceite-condicoes' }, [aceiteCond, el('span', { text: T.aceite })]), erroAceite]),
      termos?.raiz, marketing?.raiz,
    ]),
    el('p', { class: 'alerta alerta-info aviso-final', id: 'aviso-disponibilidade', text: T.avisoFinal }),
    erroGeral,
    el('div', { class: 'barra-acoes' }, [voltarBtn, el('span', { class: 'espaco' }), enviar]),
  ]));
  try {
    cotacao = await api.cotarSolicitacao({ solicitacao: sol, endereco: ende });
    mostrarValor(valor, cotacao);
  } catch (e2) {
    // sem valor na tela não envia: a pessoa precisa saber por quanto está solicitando (revisão do GPT)
    trocar(valor, el('p', { class: 'alerta alerta-erro', text: e2.codigo === 'DATA_INVALIDA' ? `${e2.message}. Altere as datas ou o horário.` : `${mensagemErro(e2)} Recarregue a página para ver o valor.` }));
  }
  atualizarBotao();
  enviar.addEventListener('click', async () => {
    if (semValor()) return;
    if (!aceiteCond.checked) { erroAceite.textContent = 'Aceite as condições do atendimento para enviar.'; aceiteCond.focus(); return; }
    if (termos && !termos.aceito()) { termos.erro('Aceite os termos para enviar.'); return; }
    const dados = {
      solicitacao: sol, endereco: ende, aceiteCondicoes: VERSAO_CONDICOES, valorEsperadoCentavos: cotacao?.pacote?.totalCentavos,
      ...(logada() ? {} : { cliente: dadosCliente(), aceite: termos.versao, marketing: marketing.marcados() }),
    };
    // chave nova quando o conteúdo muda (Alterar depois de uma tentativa); a mesma em repetição. No rascunho vai só o
    // hash do conteúdo: CPF e nascimento nunca chegam ao localStorage (revisão do GPT)
    const conteudo = await resumo(JSON.stringify({ ...dados, marketing: undefined }));
    if (r.chaveConteudo !== conteudo) { r.chave = novaChave(); r.chaveConteudo = conteudo; salvar(); }
    enviar.dataset.chave = r.chave;
    executarAcao(enviar, (chave) => api.solicitarAtendimento(dados, { chave }), {
      aoSucesso: (res) => { try { localStorage.removeItem(LS); } catch { /* ignora */ } telaEnviada(res); },
      aoErro: (e2) => {
        if (e2.codigo === 'CONFLITO_IDEMPOTENCIA') { r.chave = novaChave(); r.chaveConteudo = ''; salvar(); }
        if (e2.detalhes?.precoMudou) { cotacao = { pacote: { totalCentavos: e2.detalhes.valor } }; erroGeral.hidden = false; erroGeral.textContent = 'O valor foi atualizado. Confira a revisão antes de enviar.'; api.cotarSolicitacao({ solicitacao: sol, endereco: ende }).then((c) => { cotacao = c; mostrarValor(valor, c); }).catch(() => {}); erroGeral.focus(); return; }
        const campos = Object.keys(e2.detalhes || {});
        if (campos.some((k) => k.startsWith('endereco.'))) { errosPendentes = e2.detalhes; irPara('endereco'); return; }
        if (campos.some((k) => ['nome', 'telefone', 'email', 'cpf', 'dataNascimento', 'cnpj', 'razaoSocial', 'responsavel'].includes(k))) { errosPendentes = e2.detalhes; irPara('dados'); return; }
        if (e2.detalhes?.aceiteCondicoes) { erroAceite.textContent = 'Aceite as condições do atendimento (versão atual).'; aceiteCond.focus(); return; }
        erroGeral.hidden = false;
        erroGeral.textContent = e2.codigo === 'SERVICO_INDISPONIVEL' ? 'Não conseguimos falar com o servidor. Seus dados estão salvos; tente de novo.' : (e2.message || 'Não foi possível enviar. Tente de novo.');
        erroGeral.focus();
      },
    });
  });
}

/** SHA-256 em hex (só pra comparar conteúdo; o texto em si não é guardado). */
async function resumo(texto) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function mostrarValor(alvo, c) {
  const itens = c.itens || [];
  const valores = [...new Set(itens.map((i) => i.valorDiaCentavos))].sort((a, b) => a - b);
  const porDiaria = itens.length > 1 ? (valores.length === 1 ? `${formatarBRL(valores[0])} por diária` : `de ${formatarBRL(valores[0])} a ${formatarBRL(valores.at(-1))} por diária`) : null;
  trocar(alvo, el('p', { class: 'valor-total', dataset: { valor: 'total' }, text: formatarBRL(c.pacote.totalCentavos) }), porDiaria ? el('p', { class: 'valor-diaria', dataset: { valor: 'diaria' }, text: porDiaria }) : null);
}

async function abrirCondicoes() {
  const corpo = el('div', { class: 'texto-legal texto-modal' }, [el('p', { class: 'mudo', text: 'Carregando…' })]);
  abrirPainel('Condições do atendimento', [corpo, el('p', {}, [el('a', { href: url('condicoes/'), target: '_blank', rel: 'noopener', text: 'Abrir em outra aba' })])]);
  try {
    const html = await (await fetch(url('condicoes/'))).text();
    const art = new DOMParser().parseFromString(html, 'text/html').getElementById('texto-legal');
    art?.querySelector('h1')?.remove();
    // o escopo por serviço é preenchido pela página; aqui vai da mesma fonte
    const escopo = art?.querySelector('#escopo-servicos');
    if (escopo) trocar(escopo, ...Object.values(SERVICOS).flatMap((s) => [el('h3', { text: s.nome }), el('ul', {}, s.incluido.map((i) => el('li', { text: i })))]));
    if (art) trocar(corpo, ...[...art.childNodes].map((n) => document.importNode(n, true)));
  } catch {
    trocar(corpo, el('p', {}, ['Não conseguimos carregar agora. ', el('a', { href: url('condicoes/'), target: '_blank', rel: 'noopener', text: 'Abra as condições em outra aba' }), '.']));
  }
}

function telaEnviada(res) {
  const acompanhar = logada() && res?.pedido?.id ? url('acompanhamento/', { pedido: res.pedido.id }) : url('entrar/');
  definirAbertura({ rotulo: 'Agendamento', titulo: 'Solicitação |enviada|', lead: '' });
  trocar(raiz, el('section', { class: 'passo-fluxo enviado', 'aria-labelledby': 'titulo-passo', dataset: { passo: 'enviado' } }, [
    el('h2', { id: 'titulo-passo', class: 'titulo-passo', text: T.enviadaTitulo, tabindex: -1 }),
    el('p', { text: T.enviada }),
    el('p', { text: T.enviadaWhatsApp }),
    logada() ? null : el('p', { class: 'mudo', text: pf() ? T.enviadaAcesso : TEXTOS_CLIENTE.dicaLoginEmpresa }),
    el('div', { class: 'acoes' }, [el('a', { class: 'btn btn-primary', href: acompanhar, text: 'Acompanhar a solicitação' })]),
  ]));
  r = novoRascunho();
  document.getElementById('titulo-passo')?.focus?.();
  window.scrollTo?.({ top: 0 });
}

function render() {
  const f = { servico: passoServico, cep: passoCep, endereco: passoEndereco, local: passoLocal, quantidade: passoQuantidade, datas: passoDatas, horario: passoHorario, repetir: passoRepetir, dados: passoDados, revisao: passoRevisao }[r.passo] || passoServico;
  f();
}

(async () => {
  hoje = dataNoFuso((await agora()).toISOString(), CFG.regrasNotificacao.fuso);
  const q = new URLSearchParams(location.search);
  // deep link da home: serviço pré-selecionado -> já cai no CEP (dá pra voltar e trocar)
  const servico = q.get('servico');
  if (servico && ONDE_DO_SERVICO[servico]) {
    r.tipoCliente = ONDE_DO_SERVICO[servico]; r.tipoServico = servico; r.duracaoHoras = 0; r.duracaoManual = false;
    r.passo = 'cep';
  }
  const freq = q.get('frequencia');
  if (['semanal', 'quinzenal', 'mensal'].includes(freq)) { r.quantidade = 'varias'; r.modo = 'recorrente'; r.frequencia = freq; }
  if (q.get('etapa') === 'calculadora' && !servico) r.passo = r.tipoServico ? 'local' : 'servico';
  if (servico || freq || q.get('etapa')) history.replaceState(null, '', location.pathname);
  // P6: link da renovação (M01): a cliente dona recebe o mesmo pacote com as datas do mês seguinte, pra conferir e enviar
  const repetir = q.get('repetir');
  let avisoRenovacao = null;
  if (repetir) {
    if (!logada()) { location.replace(url('entrar/', { destino: `autoagendamento/?repetir=${encodeURIComponent(repetir)}` })); return; }
    try { aplicarRenovacao(await api.dadosRenovacao(repetir)); avisoRenovacao = ['Trouxemos o mesmo pacote com as datas do mês seguinte. Confira tudo antes de enviar.', 'ok']; }
    catch (e) { avisoRenovacao = [`Não deu pra trazer o pacote: ${mensagemErro(e)}`, 'erro']; }
    history.replaceState(null, '', location.pathname);
  }
  // CPF e nascimento não ficam salvos: recarregar depois dos dados volta pra "Seus dados"
  if (!ETAPA[r.passo]) r.passo = 'servico';
  const limite = primeiroIncompleto();
  if (indice(r.passo) > indice(limite) || indice(r.passo) < 0) r.passo = limite;
  salvar();
  history.replaceState({ passo: r.passo }, '');
  render();
  if (avisoRenovacao) toast(...avisoRenovacao, 8000);
  if (logada()) exigirAceite(); // L1: quem já tem conta aceita a versão nova dos termos antes de solicitar
})();
