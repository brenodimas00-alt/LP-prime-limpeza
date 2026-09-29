// P2: agenda por profissional (backend real). Semana ou dia, uma linha por profissional aprovada e uma de "Sem
// profissional". Arrastar uma diária pra outro dia ou outra profissional abre a confirmação (com os conflitos que o banco
// aponta); sem mouse, o botão da diária abre o mesmo "Mover". O banco decide de novo: sobreposição e férias impedem,
// fora da disponibilidade é aviso que a Prime confirma. Remarcar e trocar geram os eventos que recalculam as automações.
// Clicar no nome da profissional abre disponibilidade (dias, turnos, regiões) e bloqueios (férias, folga).
import { anexar, el, param, trocar } from '../dom.js';
import { api } from '../../services/api.js';
import { executarAcao, mensagemErro } from '../acoes.js';
import { toast } from '../toast.js';
import { url } from '../../config/app.js';
import { formatarData, formatarDataCurta, somarDias, diaDaSemana, NOMES_DIA } from '../../domain/calendario.js';
import { horariosDeInicio } from '../../domain/horario.js';
import { CONFIG_PRECOS } from '../../config/precos.js';

const DIAS_CURTOS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const TURNOS = [['manha', 'Manhã'], ['tarde', 'Tarde'], ['integral', 'Integral']];
const MOTIVOS = { ferias: 'Férias', folga: 'Folga', outro: 'Indisponível' };
const fimDe = (d) => { const [h, m] = d.horaInicio.split(':').map(Number); const t = h * 60 + m + d.duracaoMinutos; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
const segundaDe = (data) => somarDias(data, -((diaDaSemana(data) + 6) % 7));
const erro = (m) => Object.assign(new Error(m), { codigo: 'DADOS_INVALIDOS' });

/** Aba Agenda (REAL). hoje = AAAA-MM-DD em Brasília. */
export async function abaAgendaProfissionais(hoje) {
  const vista = param('vista') === 'dia' ? 'dia' : 'semana';
  const ref = /^\d{4}-\d{2}-\d{2}$/.test(param('data') || '') ? param('data') : hoje;
  const de = vista === 'dia' ? ref : segundaDe(ref);
  const ate = vista === 'dia' ? ref : somarDias(de, 6);
  const dados = await api.agendaProfissionais({ de, ate });
  const dias = Array.from({ length: vista === 'dia' ? 1 : 7 }, (_, i) => somarDias(de, i));
  const passo = vista === 'dia' ? 1 : 7;
  const ir = (params) => url('painel/', { aba: 'agenda', vista, data: ref, ...params });
  const raiz = el('div', { class: 'reveal agenda-prof' });
  const recarregar = () => location.assign(ir({}));

  const barra = el('div', { class: 'acoes agenda-barra', style: 'margin-top:0;align-items:center' }, [
    el('a', { class: 'btn btn-secundario btn-pequeno', href: ir({ data: somarDias(ref, -passo) }), text: vista === 'dia' ? 'Dia anterior' : 'Semana anterior' }),
    el('a', { class: 'btn btn-secundario btn-pequeno', href: ir({ data: hoje }), text: 'Hoje' }),
    el('a', { class: 'btn btn-secundario btn-pequeno', href: ir({ data: somarDias(ref, passo) }), text: vista === 'dia' ? 'Próximo dia' : 'Próxima semana' }),
    el('a', { class: 'btn-link', href: url('painel/', { aba: 'agenda', vista: vista === 'dia' ? 'semana' : 'dia', data: ref }), text: vista === 'dia' ? 'Ver a semana' : 'Ver só o dia' }),
  ]);
  const titulo = el('h2', { style: 'margin:12px 0 4px', text: vista === 'dia' ? `${NOMES_DIA[diaDaSemana(ref)]}, ${formatarData(ref)}` : `Semana de ${formatarDataCurta(de)} a ${formatarDataCurta(ate)}` });
  const ajuda = el('p', { class: 'mudo', text: 'Arraste uma diária pra outro dia ou outra profissional, ou use o botão da diária. Antes de salvar aparece o que muda e qualquer conflito. Clique no nome pra ver disponibilidade e férias.' });

  const linhas = [...dados.profissionais.map((p) => ({ id: p.id, nome: p.nome, p })), { id: '', nome: 'Sem profissional', p: null }];
  const bloqueioNo = (p, d) => p?.bloqueios.find((b) => d >= b.de && d <= b.ate);
  const cab = el('tr', {}, [el('th', { text: 'Profissional' }), ...dias.map((d) => el('th', { class: d === hoje ? 'hoje' : '', text: formatarDataCurta(d) }))]);
  const corpo = linhas.map((l) => el('tr', { dataset: { linha: l.id || 'sem' } }, [
    el('th', { scope: 'row' }, [l.p ? el('button', { class: 'btn-link', type: 'button', text: l.nome, on: { click: () => painelProfissional(l.p, raiz, recarregar) } }) : el('span', { class: 'mudo', text: l.nome })]),
    ...dias.map((d) => {
      const b = bloqueioNo(l.p, d);
      const itens = dados.diarias.filter((x) => (x.diaristaId || '') === l.id && x.data === d);
      const celula = el('td', { class: `celula-agenda${b ? ' bloqueada' : ''}${d === hoje ? ' hoje' : ''}`, dataset: { dia: d, profissional: l.id || 'sem' } }, [
        b ? el('span', { class: 'selo-bloqueio', text: MOTIVOS[b.motivo] }) : null,
        ...itens.map((x) => chip(x, dados, raiz, recarregar)),
      ]);
      celula.addEventListener('dragover', (ev) => { ev.preventDefault(); celula.classList.add('alvo'); });
      celula.addEventListener('dragleave', () => celula.classList.remove('alvo'));
      celula.addEventListener('drop', (ev) => {
        ev.preventDefault(); celula.classList.remove('alvo');
        const x = dados.diarias.find((y) => y.id === ev.dataTransfer.getData('text/plain'));
        if (!x || (x.data === d && (x.diaristaId || '') === l.id)) return;
        abrirMover(x, dados, raiz, recarregar, { data: d, diaristaId: l.id || null });
      });
      return celula;
    }),
  ]));
  const grade = el('div', { class: 'tabela-wrap' }, [el('table', { class: 'painel agenda-grade', dataset: { vista } }, [el('thead', {}, [cab]), el('tbody', {}, corpo)])]);
  trocar(raiz, barra, titulo, ajuda, dados.diarias.length || dados.profissionais.length ? grade : el('p', { class: 'alerta alerta-info', text: 'Nenhuma diária nem profissional aprovada neste período.' }));
  return raiz;
}

function chip(x, dados, raiz, recarregar) {
  const b = el('button', {
    class: `chip-diaria status-${x.status}`, type: 'button', draggable: 'true', dataset: { diaria: x.id },
    'aria-label': `${x.horaInicio} às ${fimDe(x)}, ${x.cliente}, ${x.bairro || x.cidade || ''}. Mover ou trocar profissional`,
  }, [el('strong', { text: `${x.horaInicio}–${fimDe(x)}` }), el('span', { text: ` ${x.cliente}` }), x.bairro ? el('span', { class: 'mudo', text: ` · ${x.bairro}` }) : null]);
  b.addEventListener('dragstart', (ev) => { ev.dataTransfer.setData('text/plain', x.id); ev.dataTransfer.effectAllowed = 'move'; });
  b.addEventListener('click', () => abrirMover(x, dados, raiz, recarregar, {}));
  return b;
}

/** Diálogo de mover/trocar: mostra o que muda e os conflitos (o banco decide), e só salva com confirmação. */
function abrirMover(x, dados, raiz, recarregar, alvo) {
  const dlg = el('dialog', { class: 'modal-legal dialogo', 'aria-labelledby': 'mover-titulo' });
  const editavel = ['agendado', 'confirmado'].includes(x.status);
  const data = el('input', { type: 'date', id: 'mover-data', value: alvo.data || x.data, disabled: !editavel });
  const horas = horariosDeInicio(x.duracaoMinutos / 60, CONFIG_PRECOS.horariosTrabalho);
  if (!horas.includes(x.horaInicio)) horas.unshift(x.horaInicio);
  const hora = el('select', { id: 'mover-hora', disabled: !editavel }, horas.map((h) => el('option', { value: h, text: h, selected: h === x.horaInicio })));
  const destino = alvo.diaristaId !== undefined ? alvo.diaristaId : x.diaristaId;
  const prof = el('select', { id: 'mover-prof', disabled: !editavel }, [
    el('option', { value: '', text: 'Sem profissional', disabled: !!x.diaristaId, selected: !destino }),
    ...dados.profissionais.map((p) => el('option', { value: p.id, text: p.nome, selected: p.id === destino })),
  ]);
  const conflitos = el('div', { class: 'conflitos', role: 'status', 'aria-live': 'polite' });
  const aviso = el('p', { class: 'alerta alerta-erro', role: 'alert', hidden: true });
  let avisosAtuais = [];
  const conferir = async () => {
    avisosAtuais = [];
    if (!prof.value) { trocar(conflitos); return; }
    try {
      const lista = await api.conflitosAtendimento(x.id, { diaristaId: prof.value, data: data.value, horaInicio: hora.value });
      avisosAtuais = lista;
      trocar(conflitos, ...(lista.length ? [el('ul', { class: 'lista' }, lista.map((c) => el('li', { class: c.impede ? 'erro' : 'aviso', text: `${c.impede ? 'Impede: ' : 'Aviso: '}${c.mensagem}` })))] : [el('p', { class: 'mudo', text: 'Sem conflito com a agenda e a disponibilidade.' })]));
    } catch (e) { trocar(conflitos, el('p', { class: 'mudo', text: mensagemErro(e) })); }
  };
  for (const c of [data, hora, prof]) c.addEventListener('change', conferir);
  const salvar = el('button', { class: 'btn btn-primary btn-pequeno', type: 'button', text: 'Confirmar mudança' });
  salvar.addEventListener('click', () => executarAcao(salvar, async (k) => {
    aviso.hidden = true;
    const mudouData = data.value !== x.data || hora.value !== x.horaInicio;
    const mudouProf = (prof.value || null) !== (x.diaristaId || null);
    if (!mudouData && !mudouProf) throw erro('Nada mudou.');
    if (!prof.value && mudouProf) throw erro('Pra tirar a profissional, atribua outra.');
    if (avisosAtuais.some((c) => c.impede)) throw erro('Resolva o que impede antes de salvar.');
    // remarca antes de trocar: o banco confere a sobreposição da profissional atual na data nova
    if (mudouData) await api.transicionarAtendimento(x.id, { evento: 'reagendar', dados: { data: data.value, horaInicio: hora.value } }, { chave: `${k}:r` });
    if (mudouProf) await api.atribuirDiarista(x.id, { diaristaId: prof.value, atribuirMesmoAssim: avisosAtuais.length > 0 }, { chave: `${k}:a` });
    return true;
  }, { aoSucesso: () => { dlg.close(); toast('Diária atualizada. A cliente e a profissional são avisadas.', 'ok'); recarregar(); }, aoErro: (e) => { aviso.hidden = false; aviso.textContent = mensagemErro(e); } }));
  const fechar = el('button', { class: 'btn btn-secundario btn-pequeno', type: 'button', text: 'Cancelar', on: { click: () => dlg.close() } });
  anexar(dlg,
    el('h2', { id: 'mover-titulo', text: `Diária de ${x.cliente} · ${formatarDataCurta(x.data)} ${x.horaInicio}–${fimDe(x)}` }),
    editavel ? null : el('p', { class: 'alerta alerta-info', text: 'Esta diária já começou ou terminou: não dá pra mover.' }),
    el('div', { class: 'grade-form' }, [
      el('label', { for: 'mover-data', text: 'Data' }), data,
      el('label', { for: 'mover-hora', text: 'Início' }), hora,
      el('label', { for: 'mover-prof', text: 'Profissional' }), prof,
    ]),
    conflitos, aviso,
    el('div', { class: 'acoes' }, [editavel ? salvar : null, fechar]),
    el('p', { class: 'mudo', style: 'margin-bottom:0' }, [el('a', { href: url('acompanhamento/', { atendimento: x.id }), text: 'Abrir a diária' })]));
  dlg.addEventListener('close', () => dlg.remove());
  anexar(raiz, dlg);
  dlg.showModal();
  conferir();
}

/** Disponibilidade e bloqueios de uma profissional. */
function painelProfissional(p, raiz, recarregar) {
  const disp = p.disponibilidade || {};
  const dlg = el('dialog', { class: 'modal-legal dialogo', 'aria-labelledby': 'prof-titulo' });
  const caixa = (nome, valor, texto, marcado) => el('label', { class: 'opcao-check' }, [el('input', { type: 'checkbox', name: nome, value: valor, checked: !!marcado }), ` ${texto}`]);
  const dias = el('fieldset', {}, [el('legend', { text: 'Dias' }), ...DIAS_CURTOS.map((t, i) => caixa('dias', String(i), t, disp.dias?.includes(i)))]);
  const turnos = el('fieldset', {}, [el('legend', { text: 'Turnos' }), ...TURNOS.map(([v, t]) => caixa('turnos', v, t, disp.turnos?.includes(v)))]);
  const regioes = el('fieldset', {}, [el('legend', { text: 'Regiões' }), ...CONFIG_PRECOS.regioesDiarista.map((r) => caixa('regioes', r, r, disp.regioes?.includes(r)))]);
  const marcados = (nome) => [...dlg.querySelectorAll(`input[name=${nome}]:checked`)].map((i) => i.value);
  const salvarDisp = el('button', { class: 'btn btn-primary btn-pequeno', type: 'button', text: 'Salvar disponibilidade' });
  salvarDisp.addEventListener('click', () => executarAcao(salvarDisp, () => api.definirDisponibilidade(p.id, { dias: marcados('dias').map(Number), turnos: marcados('turnos'), regioes: marcados('regioes') }), { sucesso: 'Disponibilidade salva.' }));

  const de = el('input', { type: 'date', id: 'bloq-de' });
  const ate = el('input', { type: 'date', id: 'bloq-ate' });
  const motivo = el('select', { id: 'bloq-motivo' }, Object.entries(MOTIVOS).map(([v, t]) => el('option', { value: v, text: t })));
  const obs = el('input', { type: 'text', id: 'bloq-obs', maxlength: 200 });
  const criar = el('button', { class: 'btn btn-secundario btn-pequeno', type: 'button', text: 'Adicionar período' });
  criar.addEventListener('click', () => executarAcao(criar, async () => {
    if (!de.value || !ate.value) throw erro('Escolha o início e o fim.');
    const r = await api.criarBloqueio(p.id, { de: de.value, ate: ate.value, motivo: motivo.value, observacao: obs.value });
    toast(r.diariasNoPeriodo ? `Período salvo. ${r.diariasNoPeriodo} diária(s) dela caem nele: troque a profissional.` : 'Período salvo.', r.diariasNoPeriodo ? 'erro' : 'ok', 6000);
    return r;
  }, { aoSucesso: () => { dlg.close(); recarregar(); } }));
  const lista = p.bloqueios.length ? el('ul', { class: 'lista' }, p.bloqueios.map((b) => {
    const rem = el('button', { class: 'btn-link', type: 'button', text: 'Remover' });
    rem.addEventListener('click', () => executarAcao(rem, () => api.removerBloqueio(b.id), { aoSucesso: () => { dlg.close(); recarregar(); } }));
    return el('li', {}, [`${MOTIVOS[b.motivo]}: ${formatarDataCurta(b.de)} a ${formatarDataCurta(b.ate)}${b.observacao ? ` (${b.observacao})` : ''} `, rem]);
  })) : el('p', { class: 'mudo', text: 'Nenhum período neste intervalo.' });
  anexar(dlg,
    el('h2', { id: 'prof-titulo', text: p.nome }),
    el('h3', { text: 'Disponibilidade' }), dias, turnos, regioes, el('div', { class: 'acoes' }, [salvarDisp]),
    el('h3', { text: 'Férias e folgas' }), lista,
    el('div', { class: 'grade-form' }, [el('label', { for: 'bloq-de', text: 'De' }), de, el('label', { for: 'bloq-ate', text: 'Até' }), ate, el('label', { for: 'bloq-motivo', text: 'Motivo' }), motivo, el('label', { for: 'bloq-obs', text: 'Observação (opcional)' }), obs]),
    el('div', { class: 'acoes' }, [criar, el('button', { class: 'btn btn-secundario btn-pequeno', type: 'button', text: 'Fechar', on: { click: () => dlg.close() } })]));
  dlg.addEventListener('close', () => dlg.remove());
  anexar(raiz, dlg);
  dlg.showModal();
}

/** Sugestão de profissionais pra uma diária (Solicitações e Atribuir): a Prime escolhe e designa. */
export function botaoSugestoes(atendimentoId, aoDesignar) {
  const caixa = el('details', { class: 'sugestoes', dataset: { sugestoes: atendimentoId } }, [el('summary', { text: 'Sugestões de profissional', style: 'cursor:pointer' })]);
  let carregado = false;
  caixa.addEventListener('toggle', async () => {
    if (!caixa.open || carregado) return;
    carregado = true;
    const corpo = el('div', { class: 'mudo', text: 'Carregando...' });
    anexar(caixa, corpo);
    try {
      const lista = await api.sugerirProfissionais(atendimentoId);
      if (!lista.length) { trocar(corpo, 'Nenhuma profissional aprovada.'); return; }
      trocar(corpo, el('ol', { class: 'lista' }, lista.slice(0, 6).map((s) => {
        const marcas = [s.livre ? 'livre no horário' : 'ocupada', s.regiao ? 'atende a região' : 'fora da região', s.disponivel ? 'no dia e turno' : 'fora do dia ou turno', `${s.cargaSemana} na semana`];
        const b = el('button', { class: 'btn btn-secundario btn-pequeno', type: 'button', text: s.atual ? 'Designada' : 'Designar', disabled: s.atual || !s.livre });
        b.addEventListener('click', () => executarAcao(b, (k) => api.atribuirDiarista(atendimentoId, { diaristaId: s.id, atribuirMesmoAssim: !(s.regiao && s.disponivel) }, { chave: k }), { aoSucesso: aoDesignar }));
        return el('li', { dataset: { sugestao: s.id } }, [el('strong', { text: s.nome }), ` · ${marcas.join(' · ')} `, b]);
      })));
    } catch (e) { trocar(corpo, mensagemErro(e)); }
  });
  return caixa;
}
