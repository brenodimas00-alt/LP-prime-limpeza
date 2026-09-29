// diarista/agenda/: atendimentos atribuídos, com "A caminho", "Iniciei" e "Finalizei" (ator diarista).
// Diarista pendente ou reprovada vê o status do cadastro.
import { rotuloHorario } from '../../domain/horario.js';
import { anexar, el, trocar } from '../dom.js';
import { montarPagina, definirAbertura, ativarReveal } from '../layout.js';
import { api } from '../../services/api.js';
import { auth, exigirPapel } from '../../services/auth.js';
import { executarAcao } from '../acoes.js';
import { toast } from '../toast.js';
import { telaCarregando, telaErro, selo } from '../comum.js';
import { url } from '../../config/app.js';
import { ROTULOS_ESTADO } from '../../domain/estados.js';
import { formatarData, formatarDataCurta, dataNoFuso } from '../../domain/calendario.js';
import { CONFIG_PRECOS as CFG } from '../../config/precos.js';
import { exigirAceite, blocoLocalizacao } from '../legal-ui.js';
import { ADAPTER } from '../../config/app.js';

const REAL = ADAPTER === 'supabase';
const ROTULO_HE = { registrada: 'aguardando a Prime', aprovada: 'aprovada', recusada: 'recusada' };

const raiz = el('div');
montarPagina(raiz);
definirAbertura({ rotulo: 'Área da diarista', titulo: 'Sua |agenda|', lead: 'Carregando…' }); // provisória: sem salto de layout até os dados chegarem (Q1)
const sessao = exigirPapel('diarista', url('diarista/entrar/'));
const P = CFG.PRECOS;
const PROXIMO = { confirmado: ['sair_a_caminho', 'Estou a caminho'], diarista_a_caminho: ['iniciar', 'Iniciei a diária'], em_andamento: ['finalizar', 'Finalizei'] };

async function iniciar() {
  if (!sessao) return;
  telaCarregando(raiz);
  try {
    // P4: sem conexão, a agenda abre pelo que ficou salvo no aparelho (só o dia de hoje e amanhã) e os check-ins esperam na fila
    let legal = null; let dados; let semRede = false;
    try {
      legal = await exigirAceite({ destinoSair: 'diarista/entrar/' }); // L1: versão nova dos termos
      dados = await api.listarAtendimentosDaDiarista(sessao.id);
      if (REAL) await guardarCache(dados, legal);
    } catch (e) {
      const c = lerCache();
      if (e?.codigo !== 'SERVICO_INDISPONIVEL' || !c) throw e;
      dados = c.dados; legal = c.legal; semRede = true;
    }
    const { diarista, itens } = dados;
    if (REAL && !semRede) enviarFila();
    const nome = diarista.nome.split(' ')[0];
    const sair = el('button', { class: 'btn btn-secundario btn-pequeno', type: 'button', text: 'Sair' });
    sair.addEventListener('click', async () => { limparCache(); await auth.sair(); location.href = url(''); });
    if (diarista.status !== 'aprovada') {
      definirAbertura({ rotulo: 'Área da diarista', titulo: `Oi, |${nome}|`, lead: diarista.status === 'pendente' ? 'Seu cadastro está em análise.' : 'Seu cadastro não foi aprovado desta vez.' });
      trocar(raiz, 
        el('div', { class: 'cartao principal reveal', dataset: { cadastro: diarista.status } }, [
          el('h2', { text: diarista.status === 'pendente' ? 'Cadastro em análise' : 'Cadastro não aprovado', style: 'margin-top:0' }),
          el('p', { text: diarista.status === 'pendente' ? 'A Prime confere os documentos em até 5 dias úteis e responde pelo WhatsApp. Quando aprovado, sua agenda aparece aqui.' : (diarista.decisao?.motivo ? `Motivo informado: ${diarista.decisao.motivo}.` : 'Se quiser entender o motivo, fale com a Prime pelos contatos do rodapé.') }),
        ]),
        el('div', { class: 'acoes' }, [sair]),
      );
      ativarReveal(raiz);
      return;
    }
    const hoje = dataNoFuso(new Date().toISOString(), CFG.regrasNotificacao.fuso);
    const horasExtras = REAL ? await api.listarHorasExtras({}).catch(() => []) : [];
    const ativos = itens.filter((i) => !['cancelado', 'avaliado', 'finalizado'].includes(i.atendimento.status));
    const passados = itens.filter((i) => ['avaliado', 'finalizado'].includes(i.atendimento.status));
    definirAbertura({ rotulo: 'Área da diarista', titulo: `Sua agenda, |${nome}|`, lead: ativos.length ? `${ativos.length} ${ativos.length === 1 ? 'diária marcada' : 'diárias marcadas'}. Avise cada etapa pelos botões: a cliente recebe no WhatsApp.` : 'Nenhuma diária marcada por enquanto. As próximas chegam pelo WhatsApp.' });

    const item = (i) => {
      const a = i.atendimento;
      const c = i.cliente || {};
      const prox = PROXIMO[a.status];
      const botao = prox ? el('button', { class: 'btn btn-primary btn-pequeno', type: 'button', text: prox[1], dataset: { evento: prox[0] } }) : null;
      if (botao) botao.addEventListener('click', () => executarAcao(botao, (k) => etapa(a, prox[0], k, legal), { aoSucesso: () => iniciar() }));
      const naFila = lerFila().filter((f) => f.id === a.id);
      const ehHoje = a.data === hoje;
      return el('li', { dataset: { atendimento: a.id, status: a.status } }, [
        el('div', { class: 'topo' }, [
          el('strong', { text: `${ehHoje ? 'Hoje, ' : ''}${formatarDataCurta(a.data)} · ${rotuloHorario(a, i.pedido?.pacote)}` }),
          selo(ROTULOS_ESTADO[a.status], a.status === 'cancelado' ? 'erro' : ['finalizado', 'avaliado'].includes(a.status) ? 'ok' : ''),
        ]),
        el('p', { class: 'mudo', text: `${P.tiposServico[i.pacote?.tipoServico]?.nome || 'Diária'}, ${i.pacote?.duracaoHoras || ''} horas${i.pacote?.passadoriaCombinada ? ', com passadoria' : ''} · ${c.nome || ''}, ${c.bairro || ''}, ${c.cidade || ''}` }),
        c.endereco ? el('p', { text: `Endereço: ${c.endereco.logradouro}, ${c.endereco.numero}${c.endereco.complemento ? ` ${c.endereco.complemento}` : ''}, ${c.endereco.bairro}. WhatsApp da cliente: ${c.telefone}` }) : el('p', { class: 'mudo', text: 'O endereço completo aparece na véspera.' }),
        a.status === 'agendado' ? el('p', { class: 'mudo', text: 'Aguardando a confirmação da entrada pela cliente.' }) : null,
        naFila.length ? el('p', { class: 'alerta alerta-info', style: 'margin:10px 0 0', text: 'Sem conexão: este aviso sai assim que o sinal voltar.' }) : null,
        botao && !naFila.length ? el('div', { class: 'acoes', style: 'margin-top:10px' }, [botao]) : null,
      ]);
    };
    trocar(raiz, 
      semRede ? el('p', { class: 'alerta alerta-info', role: 'status', text: `Sem conexão. Esta é a agenda salva às ${new Date(lerCache().em).toTimeString().slice(0, 5)}.` }) : null,
      el('h2', { text: 'Próximas diárias' }),
      ativos.length ? el('ul', { class: 'lista reveal' }, ativos.map(item)) : el('p', { class: 'alerta alerta-info', text: 'Nada marcado. Quando a Prime atribuir uma diária a você, ela aparece aqui e no WhatsApp.' }),
      passados.length ? el('h2', { text: 'Realizadas' }) : null,
      passados.length ? el('ul', { class: 'lista reveal' }, passados.map((i) => el('li', { dataset: { atendimento: i.atendimento.id } }, [
        el('div', { class: 'topo' }, [el('span', { text: `${formatarData(i.atendimento.data)} · ${i.cliente?.bairro || ''}` }), selo(ROTULOS_ESTADO[i.atendimento.status], 'ok')]),
        REAL ? blocoHoraExtra(i.atendimento, horasExtras, hoje) : null,
      ]))) : null,
      el('div', { class: 'acoes' }, [sair]),
      blocoLocalizacao(legal),
    );
    ativarReveal(raiz);
  } catch (e) { telaErro(raiz, e); }
}

/** P3: hora extra no fim da diária (até 2 dias depois); a Prime aprova e a cobrança vai pra cliente. */
function blocoHoraExtra(a, horasExtras, hoje) {
  const atual = horasExtras.find((h) => h.atendimentoId === a.id && h.status !== 'recusada') || horasExtras.find((h) => h.atendimentoId === a.id);
  if (atual && atual.status !== 'recusada') return el('p', { class: 'mudo', style: 'margin:8px 0 0', text: `Hora extra: ${atual.horas}h, ${ROTULO_HE[atual.status]}.` });
  const limite = new Date(`${a.data}T12:00:00Z`); limite.setUTCDate(limite.getUTCDate() + 2);
  if (a.status !== 'finalizado' || hoje > limite.toISOString().slice(0, 10)) return atual ? el('p', { class: 'mudo', style: 'margin:8px 0 0', text: 'Hora extra recusada pela Prime.' }) : null;
  const caixa = el('details', { style: 'margin-top:8px' }, [el('summary', { text: atual ? 'Hora extra recusada: registrar de novo' : 'Teve hora extra? Registrar', style: 'cursor:pointer' })]);
  const horas = el('select', { 'aria-label': 'Horas extras', id: `he-${a.id}` }, [1, 2, 3, 4].map((n) => el('option', { value: String(n), text: `${n} hora${n > 1 ? 's' : ''}` })));
  const obs = el('input', { type: 'text', maxlength: 300, 'aria-label': 'Observação (opcional)', placeholder: 'Observação (opcional)' });
  const b = el('button', { class: 'btn btn-secundario btn-pequeno', type: 'button', text: 'Registrar' });
  b.addEventListener('click', () => executarAcao(b, (k) => api.registrarHoraExtra(a.id, { horas: Number(horas.value), observacao: obs.value }, { chave: k }), { sucesso: 'Hora extra registrada. A Prime confere e avisa a cliente.', aoSucesso: () => iniciar() }));
  anexar(caixa, el('div', { class: 'opcoes', style: 'margin-top:8px' }, [horas, obs, b]));
  return caixa;
}

// ---------------------------------------------------------------- P4: check-in, checklist, localização e fila offline
const CHAVE_CACHE = 'prime.agenda.cache';
const CHAVE_FILA = 'prime.agenda.fila';
const semConexao = (e) => e?.codigo === 'SERVICO_INDISPONIVEL' || (typeof navigator !== 'undefined' && navigator.onLine === false);
const ler = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const gravar = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem storage */ } };
function lerCache() { const c = ler(CHAVE_CACHE); return c && c.usuario === sessao?.usuarioId ? c : null; }
function lerFila() { return (ler(CHAVE_FILA) || []).filter((f) => f.usuario === sessao?.usuarioId); }
function limparCache() { gravar(CHAVE_CACHE, null); gravar(CHAVE_FILA, null); }

/** Guarda só o necessário pro dia: diárias de hoje e amanhã (com endereço, que ela precisa) e o checklist delas. */
async function guardarCache(dados, legal) {
  const hoje = dataNoFuso(new Date().toISOString(), CFG.regrasNotificacao.fuso);
  const ate = new Date(`${hoje}T12:00:00Z`); ate.setUTCDate(ate.getUTCDate() + 1);
  const itens = dados.itens.filter((i) => i.atendimento.data >= hoje && i.atendimento.data <= ate.toISOString().slice(0, 10) && i.atendimento.status !== 'cancelado');
  const checklists = {};
  for (const i of itens.filter((x) => ['confirmado', 'diarista_a_caminho', 'em_andamento'].includes(x.atendimento.status))) {
    checklists[i.atendimento.id] = await api.checklistAtendimento(i.atendimento.id).catch(() => null);
  }
  gravar(CHAVE_CACHE, { usuario: sessao.usuarioId, em: new Date().toISOString(), dados: { diarista: dados.diarista, itens }, legal, checklists });
}

/** Cada etapa: no check-out, o checklist antes; sem sinal, entra na fila com a mesma chave (o banco não duplica). */
async function etapa(a, evento, k, legal) {
  if (REAL && evento === 'finalizar') {
    const lista = (await api.checklistAtendimento(a.id).catch((e) => (semConexao(e) ? lerCache()?.checklists?.[a.id] : Promise.reject(e))));
    if (lista?.itens?.length && !lista.resposta) {
      const itens = await pedirChecklist(lista.itens);
      if (!itens) return undefined; // fechou sem salvar
      await tentarOuEnfileirar({ tipo: 'checklist', id: a.id, itens, chave: `${k}:checklist` });
    }
  }
  await tentarOuEnfileirar({ tipo: 'etapa', id: a.id, evento, chave: k });
  if (REAL && legal?.consentimentos?.localizacao_profissional) enviarLocalizacao(a.id, evento);
  return true;
}

async function executar(f) {
  if (f.tipo === 'checklist') return api.registrarChecklist(f.id, f.itens, { chave: f.chave });
  return api.transicionarAtendimento(f.id, { evento: f.evento }, { chave: f.chave });
}
async function tentarOuEnfileirar(f) {
  if (REAL && lerFila().length) { enfileirar(f); return; } // mantém a ordem: nada passa na frente do que já espera
  try { await executar(f); } catch (e) {
    if (!REAL || !semConexao(e)) throw e;
    enfileirar(f);
  }
}
function enfileirar(f) {
  gravar(CHAVE_FILA, [...(ler(CHAVE_FILA) || []), { ...f, usuario: sessao.usuarioId, em: new Date().toISOString() }]);
  toast('Sem conexão. O aviso sai assim que o sinal voltar.', 'erro', 6000);
}
let enviando = false;
/** Manda a fila em ordem, com as mesmas chaves. Erro de negócio (ex.: a Prime cancelou) descarta o item e avisa. */
async function enviarFila() {
  if (enviando) return;
  enviando = true;
  let mudou = false;
  try {
    for (const f of lerFila()) {
      try { await executar(f); } catch (e) {
        if (semConexao(e)) return;
        toast(`Um aviso guardado sem conexão não foi aceito: ${e.message}`, 'erro', 8000);
      }
      gravar(CHAVE_FILA, (ler(CHAVE_FILA) || []).filter((x) => x.chave !== f.chave));
      mudou = true;
    }
  } finally { enviando = false; if (mudou) iniciar(); }
}
if (typeof window !== 'undefined') window.addEventListener('online', () => { if (REAL) enviarFila(); });

/** Localização aproximada, só com a autorização dela; nunca atrasa nem impede o check-in. */
function enviarLocalizacao(id, evento) {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => api.registrarLocalizacao(id, { evento, lat: pos.coords.latitude, lon: pos.coords.longitude, precisao: pos.coords.accuracy }).catch(() => {}),
    () => {}, { enableHighAccuracy: false, timeout: 8000, maximumAge: 120000 });
}

/** Checklist do check-out: feito ou não feito (com motivo) em cada item. Devolve os itens ou null se fechar. */
function pedirChecklist(lista) {
  return new Promise((resolver) => {
    const dlg = el('dialog', { class: 'modal-legal dialogo checklist', 'aria-labelledby': 'titulo-checklist' });
    const aviso = el('p', { class: 'alerta alerta-erro', role: 'alert', hidden: true });
    const linhas = lista.map((texto, i) => {
      const motivo = el('input', { type: 'text', maxlength: 200, id: `ck-motivo-${i}`, 'aria-label': `Por que não foi feito: ${texto}`, placeholder: 'Por que não foi feito?', hidden: true });
      const sim = el('input', { type: 'radio', name: `ck-${i}`, value: 'sim', id: `ck-${i}-sim` });
      const nao = el('input', { type: 'radio', name: `ck-${i}`, value: 'nao', id: `ck-${i}-nao` });
      for (const r of [sim, nao]) r.addEventListener('change', () => { motivo.hidden = !nao.checked; if (nao.checked) motivo.focus(); });
      return { texto, sim, nao, motivo, raiz: el('fieldset', { class: 'item-checklist', dataset: { item: String(i) } }, [
        el('legend', { text: texto }),
        el('label', { for: `ck-${i}-sim`, class: 'opcao-check' }, [sim, ' Feito']), el('label', { for: `ck-${i}-nao`, class: 'opcao-check' }, [nao, ' Não feito']), motivo,
      ]) };
    });
    const salvar = el('button', { class: 'btn btn-primary btn-pequeno', type: 'button', text: 'Salvar e finalizar' });
    salvar.addEventListener('click', () => {
      const falta = linhas.find((l) => !l.sim.checked && !l.nao.checked) || linhas.find((l) => l.nao.checked && l.motivo.value.trim().length < 3);
      if (falta) { aviso.hidden = false; aviso.textContent = falta.nao.checked ? `Diga por que não foi feito: ${falta.texto}` : `Marque: ${falta.texto}`; (falta.nao.checked ? falta.motivo : falta.sim).focus(); return; }
      const itens = linhas.map((l) => ({ texto: l.texto, feito: l.sim.checked, ...(l.nao.checked ? { motivo: l.motivo.value.trim() } : {}) }));
      dlg.close(); resolver(itens);
    });
    const cancelar = el('button', { class: 'btn btn-secundario btn-pequeno', type: 'button', text: 'Voltar', on: { click: () => { dlg.close(); resolver(null); } } });
    anexar(dlg, el('h2', { id: 'titulo-checklist', text: 'Checklist do atendimento' }), el('p', { class: 'mudo', text: 'Marque o que foi feito. Se algo não deu, conte o motivo: a Prime vê e explica pra cliente.' }),
      ...linhas.map((l) => l.raiz), aviso, el('div', { class: 'acoes' }, [salvar, cancelar]));
    dlg.addEventListener('cancel', () => resolver(null));
    dlg.addEventListener('close', () => dlg.remove());
    document.body.appendChild(dlg);
    dlg.showModal();
  });
}

if (REAL && 'serviceWorker' in navigator) navigator.serviceWorker.register(url('diarista/sw.js'), { scope: url('diarista/') }).catch(() => {});

iniciar();
