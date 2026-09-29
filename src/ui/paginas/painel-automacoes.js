// AUT.4: aba Automações do painel (backend real). prime_admin liga/desliga, muda horário/atraso dentro dos limites,
// reordena canais, edita o texto dos templates (prévia com dados fictícios, variáveis permitidas, histórico e restaurar),
// dispara o modo teste e age sobre execuções (cancelar, enviar agora, reenviar). O banco confere tudo de novo.
// prime_atendimento só vê. Sub-telas por ?sub=: regras (padrão) | template (&codigo) | linha (&clienteId|pedidoId|diaristaId|regra).
import { anexar, el, param, trocar } from '../dom.js';
import { api } from '../../services/api.js';
import { executarAcao, mensagemErro } from '../acoes.js';
import { toast } from '../toast.js';
import { selo } from '../comum.js';
import { url } from '../../config/app.js';
import { formatarInstante } from '../../domain/calendario.js';
import { validarCorpo, EXEMPLOS, VARIAVEIS_PERMITIDAS } from '../../automacoes/catalogo.js';
import { renderizar } from '../../automacoes/v2/variaveis.js';

const ROTULO_CANAL = { whatsapp: 'WhatsApp', email: 'E-mail', painel: 'Painel' };
const ROTULO_CATEGORIA = { atendimento: 'Atendimento', lembrete: 'Lembrete', marketing: 'Novidades (só com consentimento)', interno: 'Equipe Prime' };
const TIPO_SELO = { enviada: 'ok', entregue: 'ok', lida: 'ok', agendada: 'aviso', enviando: 'aviso', falhou: 'erro', cancelada: '', ignorada: '' };
const link = (params) => url('painel/', { aba: 'notificacoes', ...params });

function tabela(cab, linhas, nome) {
  return el('div', { class: 'tabela-wrap', dataset: nome ? { tabela: nome } : {} }, [el('table', { class: 'painel' }, [
    el('thead', {}, [el('tr', {}, cab.map((h) => el('th', { text: h })))]), el('tbody', {}, linhas),
  ])]);
}
function botao(texto, fn, { classe = 'btn-secundario', depois } = {}) {
  const b = el('button', { class: `btn ${classe} btn-pequeno`, type: 'button', text: texto });
  b.addEventListener('click', () => executarAcao(b, fn, { aoSucesso: depois }));
  return b;
}

/** Descrição curta do "quando" + campos editáveis do atraso (só o que a regra permite). */
function editorAtraso(a) {
  const campos = {};
  const partes = [];
  const num = (k, v, min, max, rotulo) => { campos[k] = el('input', { type: 'number', min, max, value: v, 'aria-label': rotulo, class: 'curto' }); return campos[k]; };
  const hora = (v) => { campos.hora = el('input', { type: 'time', min: '06:00', max: '21:00', value: v, 'aria-label': 'Horário' }); return campos.hora; };
  switch (a.tipo) {
    case 'imediato': partes.push('na hora'); break;
    case 'apos': partes.push(num('minutos', a.minutos, 60, 4320, 'Minutos depois'), ' min depois'); break;
    case 'vespera': partes.push('véspera às ', hora(a.hora)); break;
    case 'antes_prazo': partes.push(`${a.minutos.map((m) => (m >= 60 ? `${m / 60}h` : `${m} min`)).join(' e ')} antes do prazo`); break;
    case 'prazo_vencido': partes.push('no prazo vencido'); break;
    case 'apos_inicio_turno': partes.push(num('minutos', a.minutos, 10, 180, 'Minutos depois do início'), ' min depois do início'); break;
    case 'diario': partes.push('todo dia às ', hora(a.hora)); break;
    case 'semanal': partes.push('segunda às ', hora(a.hora)); break;
    case 'mensal': partes.push('dia ', num('dia', a.dia, 1, 28, 'Dia do mês'), ' às ', hora(a.hora)); break;
    case 'aniversario': partes.push('no aniversário às ', hora(a.hora)); break;
    case 'inatividade': partes.push('sem diária há ', num('dias', a.dias, 30, 365, 'Dias sem diária'), ' dias, às ', hora(a.hora)); break;
    case 'antes_vencimento_documento': partes.push(`${a.dias.join(' e ')} dias antes do vencimento, às `, hora(a.hora)); break;
    default: partes.push(a.tipo);
  }
  const valor = () => Object.fromEntries(Object.entries(campos).map(([k, i]) => [k, i.type === 'number' ? Number(i.value) : i.value]));
  return { raiz: el('span', { class: 'atraso' }, partes), valor, editavel: Object.keys(campos).length > 0 };
}

async function telaRegras(admin) {
  const [lista, met, saude, eventosErro] = await Promise.all([api.listarRegrasAutomacao(), api.metricasAutomacoes({}), api.saudeAutomacoes(), api.listarEventos({ status: 'erro' })]);
  const kpis = el('div', { class: 'kpis' }, [
    [saude.motorLigado ? 'ligado' : 'DESLIGADO', 'Motor'], [saude.execucoesAtrasadas, 'Atrasadas'], [saude.falhas24h, 'Falhas em 24h'],
    [saude.eventosComErro, 'Eventos com erro'], [met.pesquisa?.taxa === null || met.pesquisa?.taxa === undefined ? '—' : `${String(met.pesquisa.taxa).replace('.', ',')}%`, 'Resposta da pesquisa'],
  ].map(([n, t]) => el('div', { class: 'kpi' }, [el('span', { class: 'n', text: String(n) }), el('span', { class: 't', text: t })])));
  const linhas = lista.regras.map((r) => {
    const m = met.porRegra?.[r.codigo] || {};
    const atraso = editorAtraso(r.atraso);
    let canais = [...r.canais];
    const listaCanais = el('span', { text: canais.map((c) => ROTULO_CANAL[c]).join(' → ') });
    const ligada = el('input', { type: 'checkbox', checked: r.ligada, disabled: !admin, 'aria-label': `Ligar ${r.codigo}`, dataset: { ligada: r.codigo } });
    const acoes = el('div', { class: 'acoes', style: 'margin:0;gap:6px' });
    if (admin) {
      if (canais.filter((c) => c !== 'painel').length > 1) {
        const girar = el('button', { class: 'btn-link', type: 'button', text: 'mudar ordem', 'aria-label': `Mudar a ordem dos canais de ${r.codigo}` });
        // gira os canais externos; o painel (aviso pra Prime agir à mão), quando existe, fica sempre por último
        girar.addEventListener('click', () => {
          const ext = canais.filter((c) => c !== 'painel');
          canais = [...ext.slice(1), ext[0], ...(canais.includes('painel') ? ['painel'] : [])];
          listaCanais.textContent = canais.map((c) => ROTULO_CANAL[c]).join(' → ');
        });
        anexar(acoes, girar);
      }
      anexar(acoes, botao('Salvar', () => api.atualizarRegraAutomacao(r.codigo, { ligada: ligada.checked, canais, ...(atraso.editavel ? { atraso: atraso.valor() } : {}) }), { classe: 'btn-primary', depois: () => toast(`${r.codigo} salva.`, 'ok') }),
        botao('Testar', () => api.testarRegraAutomacao(r.codigo), { depois: () => toast(`${r.codigo}: mensagem de teste pro contato fictício na fila (sai no próximo minuto).`, 'ok') }));
    }
    anexar(acoes, el('a', { class: 'btn-link', href: link({ sub: 'template', codigo: r.template }), text: 'Texto' }), el('a', { class: 'btn-link', href: link({ sub: 'linha', regra: r.codigo }), text: 'Envios' }));
    return el('tr', { dataset: { regra: r.codigo } }, [
      el('td', {}, [el('strong', { text: r.codigo }), el('br'), el('span', { text: r.descricao }), el('br'), el('span', { class: 'mudo', text: ROTULO_CATEGORIA[r.categoria] })]),
      el('td', {}, [atraso.raiz]),
      el('td', {}, [listaCanais]),
      el('td', {}, [el('label', { class: 'opcoes', style: 'gap:6px' }, [ligada, el('span', { text: r.ligada ? 'ligada' : 'desligada' })])]),
      el('td', { class: 'mudo', text: `${m.enviadas || 0} enviadas · ${m.entregues || 0} entregues · ${m.falhas || 0} falhas · ${m.canceladas || 0} canceladas · ${m.ignoradas || 0} ignoradas · ${m.agendadas || 0} na fila` }),
      el('td', {}, [acoes]),
    ]);
  });
  // evento que falhou 5 vezes no planejamento: a Prime vê o erro e manda processar de novo (idempotente)
  const comErro = eventosErro.itens.length ? el('div', { dataset: { lista: 'eventos-erro' } }, [
    el('h2', { text: `Eventos com erro (${eventosErro.itens.length})` }),
    el('ul', { class: 'lista' }, eventosErro.itens.map((e) => el('li', { dataset: { evento: e.id } }, [
      el('div', { class: 'topo' }, [el('strong', { text: e.tipo }), selo(`${e.tentativas} tentativas`, 'erro')]),
      el('p', { class: 'mudo', text: e.erro || '' }),
      admin ? botao('Processar de novo', (k) => api.reprocessarEvento(e.id, { chave: k }), { depois: () => location.reload() }) : null,
    ]))),
  ]) : null;
  return el('div', { class: 'reveal' }, [
    kpis, comErro,
    el('p', { class: 'mudo', text: admin ? 'Horários valem em Brasília. Entre 20h e 8h, domingo e feriado só sai mensagem do atendimento do dia; o resto espera. Novidades só vão pra quem autorizou.' : 'Só a administração da Prime altera as automações.' }),
    tabela(['Regra', 'Quando', 'Canais', 'Situação', 'Últimos 30 dias', ''], linhas, 'regras'),
  ]);
}

async function telaTemplate(admin) {
  const codigo = param('codigo');
  const versoes = await api.listarTemplates(codigo);
  if (!versoes.length) return el('p', { class: 'alerta alerta-erro', text: 'Template não encontrado.' });
  const canais = ['whatsapp', 'email', 'painel'].filter((c) => versoes.some((v) => v.canal === c)); // WhatsApp primeiro
  const canal = canais.includes(param('canal')) ? param('canal') : canais[0];
  const doCanal = versoes.filter((v) => v.canal === canal);
  const ativo = doCanal.find((v) => v.ativo);
  const permitidas = VARIAVEIS_PERMITIDAS[codigo] || ativo.permitidas;
  const texto = el('textarea', { id: 'corpo-template', rows: 6, maxlength: 1024, 'aria-describedby': 'erros-template', readonly: !admin }, []);
  texto.value = ativo.corpo;
  const erros = el('ul', { id: 'erros-template', class: 'erro-campo', 'aria-live': 'polite' });
  const previa = el('p', { class: 'previa-msg', id: 'previa-template' });
  const sugestoes = el('div', { class: 'opcoes', role: 'listbox', 'aria-label': 'Variáveis', hidden: true });
  const salvar = el('button', { class: 'btn btn-primary', type: 'button', text: 'Salvar nova versão', disabled: true });
  const chips = el('div', { class: 'opcoes', style: 'gap:6px' }, permitidas.map((v) => {
    const b = el('button', { class: 'btn btn-secundario btn-pequeno', type: 'button', text: `{{${v}}}`, disabled: !admin });
    b.addEventListener('click', () => { inserir(`{{${v}}}`); });
    return b;
  }));
  function inserir(t, apagarAntes = 0) {
    const i = texto.selectionStart - apagarAntes;
    texto.setRangeText(t, i, texto.selectionEnd, 'end'); texto.focus(); atualizar();
  }
  function atualizar() {
    const probs = validarCorpo(codigo, texto.value, canal);
    trocar(erros, ...probs.map((e) => el('li', { text: e })));
    try { previa.textContent = renderizar(texto.value, EXEMPLOS); } catch (e) { previa.textContent = `(prévia indisponível: ${e.message})`; }
    salvar.disabled = !admin || probs.length > 0 || texto.value === ativo.corpo;
    // autocompletar: depois de "{{" mostra as variáveis permitidas que batem com o que foi digitado
    const antes = texto.value.slice(0, texto.selectionStart);
    const m = antes.match(/\{\{(\w*)$/);
    trocar(sugestoes, ...(m ? permitidas.filter((v) => v.startsWith(m[1])).map((v) => {
      const b = el('button', { class: 'btn btn-secundario btn-pequeno', type: 'button', role: 'option', text: v });
      b.addEventListener('click', () => inserir(`${v}}}`, m[1].length));
      return b;
    }) : []));
    sugestoes.hidden = !m;
  }
  texto.addEventListener('input', atualizar);
  texto.addEventListener('keyup', atualizar);
  salvar.addEventListener('click', () => executarAcao(salvar, () => api.salvarTemplate({ codigo, canal, corpo: texto.value }), {
    aoSucesso: (r) => { toast(`Versão ${r.versao} salva.`, 'ok'); location.reload(); },
    aoErro: (e) => { trocar(erros, el('li', { text: mensagemErro(e) })); },
  }));
  atualizar();
  const historico = tabela(['Versão', 'Texto', 'Criada em', ''], doCanal.map((v) => el('tr', { dataset: { versao: v.versao } }, [
    el('td', {}, [el('strong', { text: `v${v.versao}` }), v.ativo ? selo('ativa', 'ok') : null]),
    el('td', { text: v.corpo }), el('td', { text: formatarInstante(v.criadoEm) }),
    el('td', {}, [admin && !v.ativo ? botao('Restaurar', () => api.restaurarTemplate({ codigo, canal, versao: v.versao }), { depois: () => location.reload() }) : null]),
  ])), 'versoes');
  return el('div', { class: 'reveal' }, [
    el('p', {}, [el('a', { href: link({}), text: '← Automações' })]),
    el('h2', { text: `Texto: ${codigo}`, style: 'margin-top:0' }),
    canais.length > 1 ? el('p', {}, canais.map((c) => (c === canal ? el('strong', { text: `${ROTULO_CANAL[c]} ` }) : el('a', { href: link({ sub: 'template', codigo, canal: c }), text: `${ROTULO_CANAL[c]} ` })))) : null,
    el('label', { for: 'corpo-template', text: 'Texto da mensagem' }), texto, sugestoes, erros,
    el('p', { class: 'mudo', text: 'Variáveis permitidas (clique pra inserir, ou digite {{ pra ver as opções):' }), chips,
    el('h3', { text: 'Prévia com dados fictícios' }), previa,
    canal === 'whatsapp' ? el('p', { class: 'ajuda', text: 'No WhatsApp oficial, cada versão nova precisa ser aprovada pela Meta antes de valer em produção.' }) : null,
    admin ? el('div', { class: 'acoes' }, [salvar]) : null,
    el('h3', { text: 'Histórico' }), historico,
  ]);
}

async function telaLinha(admin) {
  const filtro = Object.fromEntries(['clienteId', 'pedidoId', 'diaristaId', 'regra', 'estado'].map((k) => [k, param(k)]).filter(([, v]) => v));
  const r = await api.listarExecucoes({ ...filtro, limite: 100 });
  const itens = r.itens.map((e) => {
    const acoes = el('div', { class: 'acoes', style: 'margin:0;gap:6px' });
    if (admin) {
      if (e.estado === 'agendada') anexar(acoes, botao('Enviar agora', (k) => api.acaoExecucao(e.id, 'enviar_agora', { chave: k }), { depois: () => location.reload() }), botao('Cancelar', (k) => api.acaoExecucao(e.id, 'cancelar', { chave: k }), { classe: 'btn-perigo', depois: () => location.reload() }));
      if (['falhou', 'cancelada', 'ignorada'].includes(e.estado)) anexar(acoes, botao('Reenviar', (k) => api.acaoExecucao(e.id, 'reenviar', { chave: k }), { depois: () => location.reload() }));
    }
    return el('li', { dataset: { execucao: e.id, regra: e.regra, estado: e.estado } }, [
      el('div', { class: 'topo' }, [el('strong', { text: `${e.regra} · ${e.template || ''}` }), selo(e.estado, TIPO_SELO[e.estado] ?? '')]),
      el('p', { class: 'mudo', text: `${e.estado === 'agendada' ? 'agendada para' : 'em'} ${formatarInstante(e.agendadaPara)}${e.motivo ? ` · ${e.motivo}` : ''}${e.teste ? ' · teste' : ''}` }),
      ...e.mensagens.map((m) => el('p', { class: 'previa-msg', text: `${ROTULO_CANAL[m.canal]}${m.destino && m.canal !== 'painel' ? ` ${m.destino}` : ''} · ${m.estado}${m.provedor ? ` (${m.provedor})` : ''}: ${m.conteudo || ''}` })),
      acoes,
    ]);
  });
  const titulo = filtro.clienteId ? 'da cliente' : filtro.pedidoId ? 'do pedido' : filtro.diaristaId ? 'da profissional' : filtro.regra ? `da regra ${filtro.regra}` : '';
  return el('div', { class: 'reveal' }, [
    el('p', {}, [el('a', { href: link({}), text: '← Automações' })]),
    el('h2', { text: `Linha do tempo ${titulo}`.trim(), style: 'margin-top:0' }),
    itens.length ? el('ul', { class: 'lista', id: 'linha-do-tempo' }, itens) : el('p', { class: 'alerta alerta-info', text: 'Nenhuma mensagem agendada ou enviada.' }),
  ]);
}

/** Entrada da aba (backend real). */
export async function abaAutomacoes(sessao) {
  const admin = sessao?.papel === 'prime_admin';
  const sub = param('sub');
  if (sub === 'template') return telaTemplate(admin);
  if (sub === 'linha') return telaLinha(admin);
  return telaRegras(admin);
}
