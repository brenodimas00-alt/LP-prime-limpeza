// painel/: área da Prime. Abas por ?aba=: agenda (dia e semana), atribuir, pagamentos, cadastros, notificacoes, avaliacoes.
import { el, param } from '../dom.js';
import { montarPagina, definirAbertura, ativarReveal } from '../layout.js';
import { api, adapterAtual } from '../../services/api.js';
import { auth, exigirPapel } from '../../services/auth.js';
import { executarAcao } from '../acoes.js';
import { campo } from '../form.js';
import { telaCarregando, telaErro, selo } from '../comum.js';
import { url, modoDev } from '../../config/app.js';
import { ROTULOS_ESTADO, ROTULOS_PAGAMENTO, eventosPossiveis, elegibilidadePagamento } from '../../domain/estados.js';
import { formatarBRL } from '../../domain/dinheiro.js';
import { formatarData, formatarDataCurta, formatarInstante, dataNoFuso, somarDias, diaDaSemana, NOMES_DIA } from '../../domain/calendario.js';
import { TURNOS } from '../../domain/modelo.js';
import { ROTULOS_DOCUMENTO } from '../../domain/validacao.js';
import { CONFIG_PRECOS as CFG } from '../../config/precos.js';

const raiz = el('div');
montarPagina(raiz, { larga: true });
const sessao = exigirPapel('prime', url('painel/entrar/'));
const ABAS = [['agenda', 'Agenda'], ['atribuir', 'Atribuir diarista'], ['pagamentos', 'Pagamentos'], ['cadastros', 'Cadastros'], ['notificacoes', 'Notificações'], ['avaliacoes', 'Avaliações']];
const P = CFG.PRECOS;
const aba = ABAS.some(([k]) => k === param('aba')) ? param('aba') : 'agenda';

async function iniciar() {
  if (!sessao) return;
  telaCarregando(raiz);
  try {
    const ad = await adapterAtual();
    const hoje = dataNoFuso((ad.relogio ? ad.relogio.agora() : new Date()).toISOString(), CFG.regrasNotificacao.fuso);
    const fim = somarDias(hoje, 6);
    const [semana, diaristas, notifs, avaliacoes] = await Promise.all([
      api.listarAtendimentos({ de: hoje, ate: fim }), api.listarDiaristas({}), api.listarNotificacoes({}), api.listarAvaliacoes({}),
    ]);
    const pendentesCad = diaristas.itens.filter((d) => d.status === 'pendente');
    const todosAt = (await api.listarAtendimentos({})).itens;
    const pedidosIds = [...new Set(todosAt.map((i) => i.pedido?.id).filter(Boolean))];
    const pedidos = await Promise.all(pedidosIds.map((id) => api.obterPedido(id)));
    const pagInformados = pedidos.flatMap((c) => c.pagamentos.filter((g) => g.status === 'informado_pelo_cliente').map((g) => ({ g, c })));
    const pagPendentes = pedidos.flatMap((c) => c.pagamentos.filter((g) => g.status === 'pendente').map((g) => ({ g, c })));
    const semAtribuir = todosAt.filter((i) => ['agendado', 'confirmado'].includes(i.atendimento.status) && !i.atendimento.diaristaId);
    const hojeItens = semana.itens.filter((i) => i.atendimento.data === hoje);

    definirAbertura({ rotulo: `Painel da Prime · ${formatarDataCurta(hoje)}`, titulo: 'Operação do |dia|', lead: `${hojeItens.length} ${hojeItens.length === 1 ? 'diária hoje' : 'diárias hoje'} · ${semAtribuir.length} sem diarista · ${pagInformados.length} ${pagInformados.length === 1 ? 'pagamento pra confirmar' : 'pagamentos pra confirmar'} · ${pendentesCad.length} ${pendentesCad.length === 1 ? 'cadastro pra analisar' : 'cadastros pra analisar'}.`, larga: true });

    const abas = el('ul', { class: 'abas' }, ABAS.map(([k, t]) => el('li', {}, [el('a', { href: url('painel/', { aba: k }), text: t, 'aria-current': k === aba ? 'page' : null })])));
    const kpis = el('div', { class: 'kpis' }, [
      ['Hoje', hojeItens.length], ['Semana', semana.itens.length], ['Sem diarista', semAtribuir.length], ['Pix a confirmar', pagInformados.length], ['Cadastros', pendentesCad.length],
    ].map(([t, n]) => el('div', { class: 'kpi' }, [el('span', { class: 'n', text: String(n) }), el('span', { class: 't', text: t })])));
    const sair = el('button', { class: 'btn btn-secundario btn-pequeno', type: 'button', text: 'Sair' });
    sair.addEventListener('click', async () => { await auth.sair(); location.href = url(''); });
    const conteudo = {
      agenda: () => abaAgenda(semana.itens, hoje, diaristas.itens),
      atribuir: () => abaAtribuir(semAtribuir.concat(todosAt.filter((i) => ['agendado', 'confirmado'].includes(i.atendimento.status) && i.atendimento.diaristaId)), diaristas.itens),
      pagamentos: () => abaPagamentos(pagInformados, pagPendentes),
      cadastros: () => abaCadastros(diaristas.itens),
      notificacoes: () => abaNotificacoes(notifs.itens, ad),
      avaliacoes: () => abaAvaliacoes(avaliacoes.itens),
    }[aba]();
    raiz.replaceChildren(kpis, abas, await conteudo, el('div', { class: 'acoes' }, [sair, modoDev() ? el('a', { class: 'btn-link', href: url('_dev/servicos.html'), text: 'Ferramentas de dev' }) : null]));
    ativarReveal(raiz);
  } catch (e) { telaErro(raiz, e); }
}

function botaoAcao(texto, fn, classe = 'btn-secundario') {
  const b = el('button', { class: `btn ${classe} btn-pequeno`, type: 'button', text: texto });
  b.addEventListener('click', () => executarAcao(b, fn, { aoSucesso: () => iniciar() }));
  return b;
}

function linhaAtendimento(i, extra) {
  const a = i.atendimento;
  return el('tr', { dataset: { atendimento: a.id, status: a.status } }, [
    el('td', { text: `${formatarDataCurta(a.data)} · ${TURNOS[a.turno].split(' (')[0]}` }),
    el('td', {}, [el('a', { href: url('acompanhamento/', { atendimento: a.id }), text: i.cliente?.nome || '' }), el('br'), el('span', { class: 'mudo', text: `${i.cliente?.endereco?.bairro || ''}, ${i.cliente?.endereco?.cidade || ''}` })]),
    el('td', { text: `${P.tiposServico[i.pedido?.pacote?.tipoServico]?.nome || ''}, ${i.pedido?.pacote?.duracaoHoras || ''}h` }),
    el('td', { text: i.diarista ? i.diarista.nome.split(' ')[0] : '—' }),
    el('td', {}, [selo(ROTULOS_ESTADO[a.status], a.status === 'cancelado' ? 'erro' : ['finalizado', 'avaliado'].includes(a.status) ? 'ok' : '')]),
    extra ? el('td', {}, [extra]) : null,
  ]);
}

function tabela(cabecalhos, linhas, nome) {
  return el('div', { class: 'tabela-wrap', dataset: nome ? { tabela: nome } : {} }, [el('table', { class: 'painel' }, [
    el('thead', {}, [el('tr', {}, cabecalhos.map((h) => el('th', { text: h })))]),
    el('tbody', {}, linhas),
  ])]);
}

function abaAgenda(itens, hoje, diaristas) {
  const porDia = {};
  for (const i of itens) (porDia[i.atendimento.data] ||= []).push(i);
  const dias = Object.keys(porDia).sort();
  if (!dias.length) return el('p', { class: 'alerta alerta-info', text: 'Nenhuma diária nos próximos 7 dias.' });
  return el('div', { class: 'reveal' }, dias.map((d) => el('section', { style: 'margin-bottom:22px' }, [
    el('h2', { text: `${d === hoje ? 'Hoje, ' : ''}${NOMES_DIA[diaDaSemana(d)]}, ${formatarData(d)}`, style: 'margin-top:0' }),
    tabela(['Quando', 'Cliente', 'Serviço', 'Diarista', 'Situação', 'Ação'], porDia[d].map((i) => {
      const a = i.atendimento;
      const evs = eventosPossiveis(a.status, 'prime').filter((e) => !['reagendar', 'avaliar', 'cancelar'].includes(e));
      const acoes = el('div', { class: 'acoes', style: 'margin:0;gap:6px' }, evs.map((ev) => botaoAcao({ confirmar: 'Confirmar', sair_a_caminho: 'A caminho', iniciar: 'Iniciar', finalizar: 'Finalizar' }[ev] || ev, (k) => api.transicionarAtendimento(a.id, { evento: ev }, { chave: k }))));
      return linhaAtendimento(i, acoes);
    })),
  ])));
}

function abaAtribuir(itens, diaristas) {
  const aprovadas = diaristas.filter((d) => d.status === 'aprovada');
  if (!itens.length) return el('p', { class: 'alerta alerta-info', text: 'Todas as diárias futuras já têm diarista.' });
  return el('div', { class: 'reveal' }, [
    el('p', { class: 'mudo', text: 'Diárias em agendado ou confirmado. A diarista recebe a atribuição no WhatsApp; a anterior, se houver, recebe o cancelamento.' }),
    tabela(['Quando', 'Cliente', 'Serviço', 'Diarista', 'Situação', 'Atribuir'], itens.map((i) => {
      const a = i.atendimento;
      const sel = el('select', { 'aria-label': `Diarista pra ${formatarData(a.data)}` }, [el('option', { value: '', text: 'Escolha' }), ...aprovadas.map((d) => el('option', { value: d.id, text: d.nome, selected: d.id === a.diaristaId }))]);
      const b = botaoAcao(a.diaristaId ? 'Trocar' : 'Atribuir', (k) => { if (!sel.value) throw Object.assign(new Error('Escolha uma diarista'), { codigo: 'DADOS_INVALIDOS' }); return api.atribuirDiarista(a.id, { diaristaId: sel.value }, { chave: k }); });
      return linhaAtendimento(i, el('div', { class: 'opcoes', style: 'flex-wrap:nowrap' }, [sel, b]));
    })),
  ]);
}

function abaPagamentos(informados, pendentes) {
  const linha = ({ g, c }, acao) => el('tr', { dataset: { pagamento: g.id } }, [
    el('td', { text: g.parcela === 'entrada' ? 'Entrada' : `Diária de ${formatarData(g.venceEm)}` }),
    el('td', {}, [el('a', { href: url('acompanhamento/', { pedido: c.pedido.id }), text: c.cliente.nome })]),
    el('td', { text: formatarBRL(g.valorCentavos) }),
    el('td', { text: g.informadoEm ? formatarInstante(g.informadoEm) : '—' }),
    el('td', {}, [selo(ROTULOS_PAGAMENTO[g.status], g.status === 'confirmado' ? 'ok' : 'aviso')]),
    el('td', {}, [acao]),
  ]);
  return el('div', { class: 'reveal' }, [
    el('h2', { text: `Informados pela cliente (${informados.length})`, style: 'margin-top:0' }),
    el('p', { class: 'mudo', text: 'Confira o extrato do Pix pelo identificador antes de confirmar. Confirmar a entrada confirma as diárias e avisa a cliente.' }),
    informados.length ? tabela(['Parcela', 'Cliente', 'Valor', 'Informado em', 'Situação', 'Ação'], informados.map((x) => linha(x, el('div', { class: 'opcoes' }, [el('span', { class: 'mudo', text: `txid ${x.g.pixTxid}` }), botaoAcao('Confirmar recebimento', (k) => api.confirmarPagamento(x.g.id, { chave: k }), 'btn-primary')]))), 'informados') : el('p', { class: 'alerta alerta-info', text: 'Nenhum pagamento informado aguardando conferência.' }),
    el('h2', { text: `Ainda não pagos (${pendentes.length})` }),
    el('p', { class: 'mudo', text: 'A parcela da diária só pode ser confirmada depois que a diarista sai a caminho.' }),
    pendentes.length ? tabela(['Parcela', 'Cliente', 'Valor', 'Informado em', 'Situação', 'Ação'], pendentes.map((x) => {
      const at = x.g.atendimentoId ? x.c.atendimentos.find((a) => a.id === x.g.atendimentoId) : null;
      const el2 = elegibilidadePagamento(x.g, { pedido: x.c.pedido, atendimento: at });
      return linha(x, el2.pagavel ? botaoAcao('Confirmar recebimento', (k) => api.confirmarPagamento(x.g.id, { chave: k })) : el('span', { class: 'mudo', text: 'Ainda não' }));
    }), 'pendentes') : el('p', { class: 'mudo', text: 'Nada pendente.' }),
  ]);
}

async function abaCadastros(diaristas) {
  const pendentes = diaristas.filter((d) => d.status === 'pendente');
  const outras = diaristas.filter((d) => d.status !== 'pendente');
  const blocos = [];
  for (const d of pendentes) {
    const { documentos } = await api.obterDiarista(d.id);
    const docs = el('ul', { class: 'lista' }, documentos.map((doc) => {
      const ver = el('button', { class: 'btn-link', type: 'button', text: 'Ver' });
      const previa = el('div', { hidden: true, style: 'margin-top:8px' });
      ver.addEventListener('click', async () => {
        if (!previa.hidden) { previa.hidden = true; ver.textContent = 'Ver'; return; }
        const { conteudo } = await api.obterArquivo(doc.id);
        const blob = conteudo instanceof Blob ? conteudo : new Blob([conteudo], { type: doc.mime });
        const u = URL.createObjectURL(blob);
        previa.replaceChildren(doc.mime === 'application/pdf' ? el('iframe', { src: u, title: doc.nomeArquivo, style: 'width:100%;height:360px;border:1px solid var(--linha);border-radius:8px' }) : el('img', { src: u, alt: doc.nomeArquivo, style: 'max-width:100%;max-height:360px;border-radius:8px' }));
        previa.hidden = false; ver.textContent = 'Fechar';
      });
      return el('li', {}, [el('div', { class: 'topo' }, [el('span', { text: `${ROTULOS_DOCUMENTO[doc.tipo]} · ${doc.nomeArquivo}` }), ver]), previa]);
    }));
    const motivo = campo({ id: `motivo-${d.id}`, rotulo: 'Motivo (obrigatório pra reprovar; vai só pro registro interno)', attrs: { maxlength: 200 } });
    blocos.push(el('div', { class: 'cartao principal reveal', dataset: { diarista: d.id } }, [
      el('h2', { text: d.nome, style: 'margin-top:0' }),
      el('dl', { class: 'dados' }, [
        el('dt', { text: 'Contato' }), el('dd', { text: `${d.telefone} · ${d.email}` }),
        el('dt', { text: 'Endereço' }), el('dd', { text: `${d.endereco.bairro}, ${d.endereco.cidade}/${d.endereco.uf}` }),
        el('dt', { text: 'Experiência' }), el('dd', { text: `${d.experienciaAnos} anos` }),
        el('dt', { text: 'Disponível' }), el('dd', { text: `${d.disponibilidade.dias.map((x) => NOMES_DIA[x]).join(', ')} · ${d.disponibilidade.turnos.map((t) => TURNOS[t].split(' (')[0]).join(', ')} · ${d.disponibilidade.regioes.join(', ')}` }),
        el('dt', { text: 'Identidade' }), el('dd', { text: d.identidade === 'cnh' ? 'CNH' : 'RG + CPF' }),
      ]),
      el('h3', { text: `Documentos (${documentos.length})`, style: 'margin-top:16px' }), docs, motivo.raiz,
      el('div', { class: 'acoes' }, [
        botaoAcao('Aprovar cadastro', (k) => api.aprovarDiarista(d.id, {}, { chave: k }), 'btn-primary'),
        botaoAcao('Reprovar', (k) => { if (!motivo.input.value.trim()) { motivo.erro('Escreva o motivo pra reprovar'); motivo.input.focus(); throw Object.assign(new Error('Escreva o motivo pra reprovar'), { codigo: 'DADOS_INVALIDOS' }); } return api.reprovarDiarista(d.id, { motivo: motivo.input.value }, { chave: k }); }, 'btn-perigo'),
      ]),
    ]));
  }
  return el('div', {}, [
    ...(blocos.length ? blocos : [el('p', { class: 'alerta alerta-info', text: 'Nenhum cadastro aguardando análise.' })]),
    el('h2', { text: `Diaristas (${outras.length})` }),
    tabela(['Nome', 'Contato', 'Regiões', 'Situação'], outras.map((d) => el('tr', { dataset: { diarista: d.id } }, [el('td', { text: d.nome }), el('td', { text: d.telefone }), el('td', { text: d.disponibilidade.regioes.join(', ') }), el('td', {}, [selo(d.status, d.status === 'aprovada' ? 'ok' : 'erro')])]))),
  ]);
}

function abaNotificacoes(itens, ad) {
  const barra = ad.relogio ? el('div', { class: 'dev-bar' }, [
    el('span', { text: `Relógio da demonstração: ${formatarInstante(ad.relogio.agora().toISOString())}` }),
    ...[['+1 hora', 3600e3], ['+1 dia', 86400e3]].map(([t, ms]) => { const b = el('button', { class: 'btn btn-secundario btn-pequeno', type: 'button', text: t }); b.addEventListener('click', async () => { ad.relogio.avancar(ms); await ad.motor.tique(); iniciar(); }); return b; }),
    (() => { const b = el('button', { class: 'btn btn-secundario btn-pequeno', type: 'button', text: 'Relógio real' }); b.addEventListener('click', async () => { ad.relogio.zerar(); await ad.motor.tique(); iniciar(); }); return b; })(),
  ]) : null;
  return el('div', { class: 'reveal' }, [
    el('p', { class: 'mudo', text: 'Fila de WhatsApp. Nesta fase nada é enviado: "simulada" é a prévia do que o backend vai mandar pelo provedor oficial.' }),
    barra,
    itens.length ? el('ul', { class: 'lista', id: 'lista-notificacoes' }, itens.slice().reverse().map((n) => el('li', { dataset: { template: n.template, status: n.status } }, [
      el('div', { class: 'topo' }, [el('strong', { text: n.template }), selo(n.status, n.status === 'simulada' ? 'ok' : n.status === 'cancelada' ? 'erro' : 'aviso')]),
      el('p', { class: 'mudo', text: `${n.destinatario.tipo} · ${n.destinatario.telefone} · ${n.status === 'pendente' ? 'agendada para' : 'em'} ${formatarInstante(n.simuladaEm || n.agendadaPara)}${n.motivo ? ` · ${n.motivo}` : ''}` }),
      n.previa ? el('p', { class: 'previa-msg', text: n.previa }) : null,
    ]))) : el('p', { class: 'alerta alerta-info', text: 'Nenhuma notificação ainda.' }),
  ]);
}

function abaAvaliacoes(itens) {
  const porDiarista = {};
  for (const i of itens) { const k = i.diarista?.id || '—'; (porDiarista[k] ||= { nome: i.diarista?.nome || 'Sem diarista', notas: [] }).notas.push(i.avaliacao.notaFinal); }
  const medias = Object.entries(porDiarista).map(([id, v]) => ({ id, nome: v.nome, n: v.notas.length, media: Math.round((v.notas.reduce((s, x) => s + x, 0) / v.notas.length) * 10) / 10 })).sort((a, b) => b.media - a.media);
  const v = (n) => String(n).replace('.', ',');
  return el('div', { class: 'reveal' }, [
    el('h2', { text: 'Média por diarista', style: 'margin-top:0' }),
    medias.length ? tabela(['Diarista', 'Avaliações', 'Média'], medias.map((m) => el('tr', { dataset: { diarista: m.id } }, [el('td', { text: m.nome }), el('td', { text: String(m.n) }), el('td', { text: `${v(m.media)} de 5` })]))) : el('p', { class: 'alerta alerta-info', text: 'Nenhuma avaliação ainda.' }),
    el('h2', { text: `Últimas avaliações (${itens.length})` }),
    tabela(['Diária', 'Diarista', 'Pontualidade', 'Qualidade', 'Cuidado', 'Comunicação', 'Média', 'Comentário'], itens.map((i) => el('tr', {}, [
      el('td', {}, [el('a', { href: url('acompanhamento/', { atendimento: i.atendimento?.id }), text: i.atendimento ? formatarData(i.atendimento.data) : '' })]),
      el('td', { text: i.diarista?.nome || '—' }),
      ...['pontualidade', 'qualidade', 'cuidado', 'comunicacao'].map((k) => el('td', { text: String(i.avaliacao.notas[k]) })),
      el('td', {}, [el('strong', { text: v(i.avaliacao.notaFinal) })]),
      el('td', { text: i.avaliacao.comentario || '' }),
    ]))),
  ]);
}

iniciar();
