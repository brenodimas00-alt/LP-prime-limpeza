// Painel v2, B4: seções novas das telas reorganizadas (spec-painel-v2, seção 3). As seções antigas que continuam valendo
// (agenda por profissional, designar, pagamentos, cadastros e documentos, automações, preços, LGPD...) ficam ao lado, com
// o mesmo conteúdo e as mesmas ações; nada some.
import { el, trocar, param } from '../dom.js';
import { url } from '../../config/app.js';
import { api } from '../../services/api.js';
import { executarAcao } from '../acoes.js';
import { formatarBRL } from '../../domain/dinheiro.js';
import { formatarData, somarDias } from '../../domain/calendario.js';
import { abrirFichaCliente } from '../paginas/painel-v3.js';
import { icone } from './icones.js';
import {
  bloco, botao, selo, avatar, zap, tabelaExpansivel, detalhe, chips, vazio, pedirMotivo, painelLateral, esqueleto, erroBloco, tudoResolvido, ROTULO_HABILIDADE,
} from './componentes.js';
import { linhaSolicitacao, verSolicitacao, seloEscala, linhaDiaria, COLUNAS_DIARIA } from './inicio.js';

const ddmm = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '');
const quando = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) : '');
const irPara = (params) => { location.href = url('painel/', params); };

// ---------------------------------------------------------------- Solicitações: lista completa com filtros
export async function secaoSolicitacoes(alvo, { casca }) {
  const f = { estado: param('estado') || 'novas', modalidade: param('modalidade') || '', origem: param('origem') || '', de: param('de') || '', ate: param('ate') || '' };
  const motivos = await api.motivosPadrao().catch(() => ({ recusa: [] }));
  const lista = el('div', {}, [esqueleto(4)]);
  const filtros = el('div', { class: 'u-col' }, [
    chips([['novas', 'Novas'], ['aguardando', 'Aguardando pagamento'], ['confirmadas', 'Confirmadas'], ['concluidas', 'Concluídas'], ['recusadas', 'Recusadas'], ['canceladas', 'Canceladas'], ['', 'Todas']],
      f.estado === 'todas' ? '' : f.estado, (v) => irPara({ tela: 'solicitacoes', ...f, estado: v || 'todas' }), { rotulo: 'Situação' }),
    el('div', { class: 'u-grade-filtros' }, [
      selectFiltro('Modalidade', 'modalidade', f.modalidade, [['', 'Todas'], ['avulsa', 'Diária avulsa'], ['multi_profissional', 'Mais de uma profissional'], ['pacote', 'Pacote']], f),
      selectFiltro('Origem', 'origem', f.origem, [['', 'Todas'], ['instagram', 'Instagram'], ['google', 'Google'], ['indicacao', 'Indicação'], ['whatsapp', 'WhatsApp'], ['outro', 'Outro']], f),
      campoData('Primeira diária de', 'de', f), campoData('até', 'ate', f)]),
  ]);

  const carregar = async () => {
    try {
      const r = await api.painelSolicitacoes({ estado: f.estado === 'todas' ? '' : f.estado, modalidade: f.modalidade, origem: f.origem, de: f.de, ate: f.ate, limite: 100 });
      const depois = () => { carregar(); casca.atualizarContadores(); };
      trocar(lista, el('p', { class: 'p-sec', role: 'status', text: `${r.total} ${r.total === 1 ? 'solicitação' : 'solicitações'}` }),
        r.itens.length ? tabelaExpansivel({
          rotulo: 'Solicitações',
          colunas: [{ rotulo: 'Data/Hora' }, { rotulo: 'Cliente', classe: 'p-principal-cel' }, { rotulo: 'Local' }, { rotulo: 'Serviço' }, { rotulo: 'Imóvel', classe: 'p-oculta-celular' }, { rotulo: 'Horas', classe: 'p-dinheiro' },
            { rotulo: 'Valor', classe: 'p-dinheiro' }, { rotulo: 'Origem', classe: 'p-oculta-medio' }, { rotulo: 'Ações', classe: 'p-acoes-cel', sr: true }],
          linhas: r.itens.map((s) => linhaSolicitacao(s, motivos.recusa || [], depois)),
        }) : vazio('Nenhuma solicitação com esses filtros.'));
      const aberto = param('pedido') && r.itens.find((x) => x.pedidoId === param('pedido'));
      if (aberto) verSolicitacao(aberto);
      else if (param('pedido')) verSolicitacao({ pedidoId: param('pedido'), cliente: { nome: 'cliente' } });
    } catch (e) { trocar(lista, erroBloco(e, carregar)); }
  };
  trocar(alvo, filtros, lista);
  carregar();
}
function selectFiltro(rot, nome, valor, ops, f) {
  const id = `f-${nome}`;
  const s = el('select', { id }, ops.map(([v, r]) => el('option', { value: v, text: r, selected: v === valor })));
  s.addEventListener('change', () => irPara({ tela: 'solicitacoes', ...f, [nome]: s.value }));
  return el('div', { class: 'p-campo' }, [el('label', { for: id, text: rot }), s]);
}
function campoData(rot, nome, f) {
  const id = `f-${nome}`;
  const i = el('input', { type: 'date', id, value: f[nome] || '' });
  i.addEventListener('change', () => irPara({ tela: 'solicitacoes', ...f, [nome]: i.value }));
  return el('div', { class: 'p-campo' }, [el('label', { for: id, text: rot }), i]);
}

// ---------------------------------------------------------------- Agenda e escala: escala do dia
export async function secaoEscala(alvo, { hoje }) {
  const data = param('data') && /^\d{4}-\d{2}-\d{2}$/.test(param('data')) ? param('data') : somarDias(hoje, 1);
  const seletor = el('input', { type: 'date', id: 'esc-data', min: hoje, value: data });
  seletor.addEventListener('change', () => irPara({ tela: 'agenda', aba: 'escala', data: seletor.value }));
  const b = bloco({
    id: 'agenda-escala', titulo: `Escala de ${formatarData(data)}`, ic: 'agenda', recolhivel: false,
    carregar: async () => {
      const r = await api.painelDiarias(data);
      return {
        contagem: r.itens.length, sub: 'Revise as diárias do dia e publique: cada profissional recebe a escala pelo WhatsApp.',
        extra: [seloEscala(r.escala, data, () => b.recarregar())],
        conteudo: r.itens.length ? tabelaExpansivel({
          rotulo: `Escala de ${formatarData(data)}`,
          colunas: COLUNAS_DIARIA,
          linhas: r.itens.map((d) => linhaDiaria(d)),
        }) : vazio('Nenhuma diária nesse dia.'),
      };
    },
  });
  trocar(alvo, el('div', { class: 'p-campo u-larg-curta' }, [el('label', { for: 'esc-data', text: 'Dia da escala' }), seletor]), b.raiz);
  b.recarregar();
}

// ---------------------------------------------------------------- Clientes: ficha com linha do tempo única
const ICONE_TL = { pedido: 'solicitacoes', pagamento: 'financeiro', mensagem: 'enviar', ocorrencia: 'alerta', acesso: 'clientes' };
export async function fichaCliente(alvo, clienteId, { sessao }) {
  trocar(alvo, esqueleto(6));
  let f;
  try { f = await api.painelFichaCliente(clienteId); } catch (e) { trocar(alvo, erroBloco(e, () => fichaCliente(alvo, clienteId, { sessao }))); return; }
  const c = f.cliente;
  const fatos = [['Solicitações', f.resumo.pedidos], ['Diárias feitas', f.resumo.diariasFeitas], ['Última diária', f.resumo.ultimaDiaria ? formatarData(f.resumo.ultimaDiaria) : '-'],
    ['Próxima diária', f.resumo.proximaDiaria ? formatarData(f.resumo.proximaDiaria) : '-'], ['Total pago', formatarBRL(f.resumo.totalPagoCentavos || 0)]];
  const cab = el('section', { class: 'p-bloco p-bloco-solto' }, [
    el('div', { class: 'u-entre' }, [
      el('div', {}, [el('h2', { text: c.nome }), el('p', { class: 'p-sec u-mt-1', text: [c.tipo === 'empresa' ? `Empresa${c.razaoSocial ? ` · ${c.razaoSocial}` : ''}` : 'Residencial', c.origem === 'importado' ? 'veio do sistema antigo' : c.origem === 'site' ? 'cadastro pelo site' : null, c.temAcesso ? 'tem acesso à conta' : 'sem acesso à conta'].filter(Boolean).join(' · ') })]),
      el('div', { class: 'u-fila' }, [
        c.telefone ? el('span', { class: 'u-lin' }, [zap(c.telefone, c.nome), el('span', { class: 'p-num', text: c.telefone })]) : null,
        c.email ? el('span', { class: 'p-sec', text: c.email }) : null,
        botao('Endereços, condições e faturamento', { ic: 'local', aoClicar: () => abrirFichaCliente(c.id, { admin: sessao?.papel === 'prime_admin' }) }),
      ]),
    ]),
    el('dl', { class: 'p-numeros p-numeros-auto' }, fatos.map(([k, v]) => el('div', {}, [el('dt', { text: k }), el('dd', { text: String(v) })]))),
    (c.pendencias || []).length ? el('p', { class: 'p-sec', text: `Pendências do cadastro: ${c.pendencias.join(', ')}` }) : null,
  ]);
  const linha = el('section', { class: 'p-bloco p-bloco-solto', 'aria-labelledby': 'tl-titulo' }, [
    el('h2', { id: 'tl-titulo', text: 'Linha do tempo' }), el('p', { class: 'p-sec', text: 'Solicitações, pagamentos, mensagens, ocorrências e acessos, do mais recente pro mais antigo.' }),
    f.linhaDoTempo.length ? el('ul', { class: 'p-lista' }, f.linhaDoTempo.map((x) => el('li', { dataset: { tipo: x.tipo } }, [
      el('span', { class: `p-ic-item ${x.tipo === 'pagamento' ? 'ok' : x.tipo === 'ocorrencia' ? 'urgente' : ''}`, 'aria-hidden': 'true' }, [icone(ICONE_TL[x.tipo] || 'ponto', { pequeno: true })]),
      el('span', { class: 'p-texto-item' }, [el('b', { text: x.titulo }), el('span', { text: [quando(x.em), x.detalhe].filter(Boolean).join(' · ') })]),
      x.ref?.pedidoId ? el('a', { class: 'p-btn p-discreto', href: url('painel/', { tela: 'solicitacoes', estado: 'todas', pedido: x.ref.pedidoId }), text: 'Ver' }) : null,
    ]))) : vazio('Nada registrado ainda.'),
  ]);
  const lgpd = el('section', { class: 'p-bloco p-bloco-solto' }, [
    el('h2', { text: 'Privacidade' }),
    el('p', { class: 'p-sec', text: f.consentimentos.length ? f.consentimentos.map((k) => `${k.tipo}: ${k.concedido ? 'aceitou' : 'recusou'} em ${quando(k.em)}`).join(' · ') : 'Sem consentimentos registrados.' }),
    el('p', { class: 'p-sec', text: f.pedidosDados.length ? `Pedidos de dados: ${f.pedidosDados.map((p) => `${p.tipo} (${p.estado})`).join(', ')}` : 'Nenhum pedido de dados (LGPD).' }),
  ]);
  trocar(alvo, el('p', {}, [el('a', { class: 'p-link', href: url('painel/', { tela: 'clientes' }) }, [icone('voltar', { pequeno: true }), 'Voltar pra Clientes'])]), cab, linha, lgpd);
}

// ---------------------------------------------------------------- Profissionais: equipe com habilidades
export async function secaoEquipe(alvo) {
  const lista = el('div', {}, [esqueleto(4)]);
  const busca = el('input', { type: 'search', id: 'eq-busca', placeholder: 'Nome da profissional', value: param('busca') || '' });
  busca.addEventListener('change', () => irPara({ tela: 'profissionais', busca: busca.value }));
  const carregar = async () => {
    try {
      const r = await api.painelProfissionais({ busca: param('busca') || '' });
      trocar(lista, tabelaExpansivel({
        rotulo: 'Profissionais',
        colunas: [{ rotulo: 'Profissional', classe: 'p-principal-cel' }, { rotulo: 'Situação' }, { rotulo: 'Hoje' }, { rotulo: 'Semana', classe: 'p-dinheiro' }, { rotulo: 'Avaliação', classe: 'p-dinheiro' }, { rotulo: 'Ações', classe: 'p-acoes-cel', sr: true }],
        linhas: r.itens.map((d) => ({
          rotulo: d.nome, dataset: { profissional: d.id },
          celulas: [avatar(d.nome, { habilidades: d.habilidades }),
            d.status === 'aprovada' ? (d.documentosVencidos ? selo('Documento vencido', 'urgente') : selo('Ativa', 'ok')) : d.status === 'pendente' ? selo('Cadastro pra analisar', 'aguardando') : selo('Reprovada', 'neutro'),
            d.bloqueadaHoje ? selo('Folga ou férias', 'neutro') : d.hojeStandby ? selo('Em stand-by', 'info') : el('span', { class: 'p-sec', text: '-' }),
            el('span', { class: 'p-num', text: `${d.diariasSemana} ${d.diariasSemana === 1 ? 'diária' : 'diárias'}` }),
            el('span', { class: 'p-num', text: d.mediaAvaliacoes ? `${String(d.mediaAvaliacoes).replace('.', ',')} (${d.avaliacoes})` : '-' }),
            el('span', { class: 'u-lin' }, [zap(d.telefone, d.nome), botao('Habilidades', { ic: 'config', aoClicar: () => editarHabilidades(d, carregar) })])],
          detalhe: () => detalhe([['Dias', (d.disponibilidade?.dias || []).map((x) => ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][x]).join(', ')],
            ['Turnos', (d.disponibilidade?.turnos || []).map((t) => ({ manha: 'manhã', tarde: 'tarde', integral: 'integral' }[t] || t)).join(', ')],
            ['Regiões', (d.disponibilidade?.regioes || []).join(', ')], ['Habilidades', d.habilidades.map((h) => ROTULO_HABILIDADE[h]).join(', ') || 'nenhuma marcada']]),
        })),
        vazioTexto: 'Nenhuma profissional com esse nome.',
      }));
      const aberta = param('profissional') && r.itens.find((x) => x.id === param('profissional'));
      if (aberta) editarHabilidades(aberta, carregar);
    } catch (e) { trocar(lista, erroBloco(e, carregar)); }
  };
  trocar(alvo, el('div', { class: 'p-campo u-larg-campo' }, [el('label', { for: 'eq-busca', text: 'Buscar' }), busca]), lista);
  carregar();
}
function editarHabilidades(d, depois) {
  const caixas = Object.entries(ROTULO_HABILIDADE).map(([k, r]) => {
    const id = `hab-${k}`;
    return { k, input: el('input', { type: 'checkbox', id, checked: d.habilidades.includes(k) }), label: r, id };
  });
  const corpo = el('div', { class: 'u-col' }, [
    avatar(d.nome, { habilidades: d.habilidades }),
    el('fieldset', { class: 'u-grupo' }, [el('legend', { class: 'p-sec', text: 'Serviços que ela faz bem (aparecem como ícones na agenda e no Início)' }),
      ...caixas.map((c) => el('label', { for: c.id, class: 'u-fila' }, [c.input, c.label]))]),
  ]);
  const fechar = painelLateral({ titulo: `Habilidades de ${d.nome.split(' ')[0]}`, corpo });
  const salvar = botao('Salvar habilidades', { tom: 'primario', acao: () => api.salvarHabilidades(d.id, caixas.filter((c) => c.input.checked).map((c) => c.k)), sucesso: 'Habilidades salvas.', aoSucesso: () => { fechar(); depois(); } });
  corpo.append(el('div', {}, [salvar]), el('p', {}, [el('a', { class: 'p-link', href: url('painel/', { tela: 'profissionais', aba: 'cadastros' }), text: 'Documentos, disponibilidade, bloqueios e repasse' })]));
}

// ---------------------------------------------------------------- Financeiro: adiantamentos e reembolsos
export async function secaoAdiantamentos(alvo) {
  const lista = el('div', {}, [esqueleto(3)]);
  const carregar = async () => {
    try {
      const r = await api.listarSolicitacoesProfissional({});
      trocar(lista, r.itens.length ? tabelaExpansivel({
        rotulo: 'Adiantamentos e reembolsos',
        colunas: [{ rotulo: 'Profissional', classe: 'p-principal-cel' }, { rotulo: 'Tipo' }, { rotulo: 'Valor', classe: 'p-dinheiro' }, { rotulo: 'Pedido em' }, { rotulo: 'Situação' }, { rotulo: 'Ações', classe: 'p-acoes-cel', sr: true }],
        linhas: r.itens.map((x) => ({
          rotulo: x.profissional?.nome, dataset: { solicitacao: x.id },
          celulas: [el('span', { class: 'p-forte', text: x.profissional?.nome || '' }), x.tipo === 'adiantamento' ? 'Adiantamento' : 'Uber / transporte', el('span', { class: 'p-num', text: formatarBRL(x.valorCentavos) }), quando(x.criadoEm),
            x.estado === 'pendente' ? selo('Pendente', 'aguardando') : x.estado === 'aprovada' ? selo('Aprovado', 'ok') : selo('Recusado', 'urgente'),
            x.estado === 'pendente' ? el('span', { class: 'u-lin' }, [
              botao('Aprovar', { tom: 'ok', ic: 'check', acao: (k) => api.decidirSolicitacaoProfissional(x.id, 'aprovada', null, { chave: k }), sucesso: 'Aprovado.', aoSucesso: carregar }),
              botaoRecusar(x, carregar)]) : el('span', { class: 'p-sec', text: x.motivo || '' })],
          detalhe: x.descricao || x.motivo ? () => detalhe([['Descrição', x.descricao || ''], ['Motivo da recusa', x.motivo || '']]) : null,
        })),
      }) : tudoResolvido('Nenhum pedido de adiantamento ou reembolso.'));
    } catch (e) { trocar(lista, erroBloco(e, carregar)); }
  };
  trocar(alvo, el('div', { class: 'u-fim' }, [botao('Registrar pedido da profissional', { ic: 'dinheiro_mao', aoClicar: () => registrarPedido(carregar) })]), lista);
  carregar();
}
function botaoRecusar(x, depois) {
  const b = botao('Recusar', { tom: 'perigo', ic: 'fechar', aoClicar: async () => {
    const m = await pedirMotivo({ titulo: 'Recusar o pedido', rotuloConfirmar: 'Recusar', consequencia: 'O motivo fica registrado no histórico.' });
    if (m) executarAcao(b, (k) => api.decidirSolicitacaoProfissional(x.id, 'recusada', m.texto, { chave: k }), { sucesso: 'Recusado.', aoSucesso: depois });
  } });
  return b;
}
async function registrarPedido(depois) {
  const pros = (await api.listarDiaristas({})).itens.filter((d) => d.status === 'aprovada');
  const sel = el('select', { id: 'rp-prof' }, pros.map((d) => el('option', { value: d.id, text: d.nome })));
  const tipo = el('select', { id: 'rp-tipo' }, [el('option', { value: 'adiantamento', text: 'Adiantamento' }), el('option', { value: 'reembolso_transporte', text: 'Uber / transporte' })]);
  const valor = el('input', { id: 'rp-valor', inputmode: 'decimal', placeholder: '0,00' });
  const desc = el('input', { id: 'rp-desc', maxlength: '280' });
  const erro = el('p', { class: 'p-erro-campo', 'aria-live': 'polite' });
  const corpo = el('div', { class: 'u-col' }, [
    ...[['rp-prof', 'Profissional', sel], ['rp-tipo', 'Tipo', tipo], ['rp-valor', 'Valor (R$)', valor], ['rp-desc', 'Descrição (opcional)', desc]].map(([id, r, i]) => el('div', { class: 'p-campo' }, [el('label', { for: id, text: r }), i])), erro,
  ]);
  const fechar = painelLateral({ titulo: 'Registrar pedido da profissional', corpo });
  const salvar = botao('Registrar', { tom: 'primario', aoClicar: () => {
    const centavos = Math.round(Number(String(valor.value).replace(/\./g, '').replace(',', '.')) * 100);
    if (!sel.value || !Number.isFinite(centavos) || centavos <= 0) { erro.textContent = 'Escolha a profissional e um valor maior que zero'; return; }
    executarAcao(salvar, (k) => api.registrarSolicitacaoProfissional({ diaristaId: sel.value, tipo: tipo.value, valorCentavos: centavos, descricao: desc.value }, { chave: k }), { sucesso: 'Pedido registrado. Ele aparece em "Precisa de você".', aoSucesso: () => { fechar(); depois(); } });
  } });
  corpo.append(salvar);
}

// ---------------------------------------------------------------- Gestão > Configurações: motivos e meta
export async function secaoMotivosMeta(alvo, { sessao }) {
  const admin = sessao?.papel === 'prime_admin';
  const meta = bloco({ id: 'gestao-meta', titulo: 'Meta de diárias do mês', ic: 'meta', recolhivel: false, carregar: async () => {
    const r = await api.painelIndicadoresHome(null);
    const pct = el('input', { id: 'meta-pct', type: 'number', min: '0', max: '100', step: '1', value: String(r.meta.percentual), disabled: !admin });
    const salvar = admin ? botao('Salvar meta', { tom: 'primario', acao: () => api.salvarMeta(Number(pct.value)), sucesso: 'Meta salva.', aoSucesso: () => meta.recarregar() }) : null;
    return { sub: 'Quantos por cento a mais que as diárias realizadas no mês anterior.', conteudo: el('div', { class: 'u-fim-base' }, [
      el('div', { class: 'p-campo' }, [el('label', { for: 'meta-pct', text: 'Meta (%)' }), pct]), salvar,
      admin ? null : el('p', { class: 'p-sec', text: 'Só a administração muda a meta.' })]) };
  } });
  const mot = bloco({ id: 'gestao-motivos', titulo: 'Motivos de recusa e de cancelamento', ic: 'rosca', recolhivel: false, carregar: async () => {
    const r = await api.listarMotivos();
    const grupo = (tipo, titulo) => el('div', { class: 'u-col-2' }, [el('h3', { text: titulo }),
      el('ul', { class: 'p-lista' }, r.itens.filter((m) => m.tipo === tipo).map((m) => el('li', { dataset: { motivo: `${m.tipo}:${m.codigo}` } }, [
        el('span', { class: 'p-texto-item' }, [el('b', { text: m.rotulo }), el('span', { text: m.ativo ? 'na lista' : 'fora da lista' })]),
        admin && m.codigo !== 'outro' ? botao(m.ativo ? 'Tirar da lista' : 'Voltar pra lista', { acao: () => api.salvarMotivo({ tipo: m.tipo, codigo: m.codigo, rotulo: m.rotulo, ativo: !m.ativo }), aoSucesso: () => mot.recarregar() }) : null,
      ]))),
      admin ? novoMotivo(tipo, () => mot.recarregar()) : null]);
    return { sub: 'A lista que aparece ao recusar ou cancelar. Alimenta o gráfico de motivos do Início. "Outro" fica sempre.',
      conteudo: el('div', { class: 'p-grade p-grade-2' }, [grupo('recusa', 'Recusa'), grupo('cancelamento', 'Cancelamento')]) };
  } });
  trocar(alvo, meta.raiz, mot.raiz);
  meta.recarregar(); mot.recarregar();
}
function novoMotivo(tipo, depois) {
  const id = `novo-${tipo}`;
  const i = el('input', { id, maxlength: '80', placeholder: 'Novo motivo' });
  const b = botao('Adicionar', { aoClicar: () => { if (i.value.trim().length < 3) { i.focus(); return; } executarAcao(b, () => api.salvarMotivo({ tipo, rotulo: i.value }), { sucesso: 'Motivo adicionado.', aoSucesso: depois }); } });
  return el('div', { class: 'u-fim-base' }, [el('div', { class: 'p-campo u-cresce' }, [el('label', { for: id, text: `Novo motivo de ${tipo === 'recusa' ? 'recusa' : 'cancelamento'}` }), i]), b]);
}

