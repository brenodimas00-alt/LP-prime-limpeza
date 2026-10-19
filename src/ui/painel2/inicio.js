// Painel v2, B3: tela Início (spec-painel-v2, seção 2), seguindo as regras da cliente (dashboard-regras-isa).
// Cada bloco carrega sozinho (esqueleto, erro com "Tentar de novo"), é recolhível e some quando não tem o que mostrar
// (stand-by, alertas, novos cadastros); "Precisa de você" vira "Tudo resolvido". Depois de cada ação, os blocos afetados
// e os contadores do menu recarregam. Ações com consequência dizem o que acontece; recusar sempre pede motivo.
import { el, trocar } from '../dom.js';
import { url, ADAPTER } from '../../config/app.js';
import { api } from '../../services/api.js';
import { executarAcao } from '../acoes.js';
import { toast } from '../toast.js';
import { formatarBRL } from '../../domain/dinheiro.js';
import { formatarData, somarDias, diaDaSemana, NOMES_DIA } from '../../domain/calendario.js';
import { horariosPermitidos } from '../../domain/agendamento-v3.js';
import { CONFIG_PRECOS as CFG } from '../../config/precos.js';
import { detalhesSolicitacaoV3 } from '../paginas/painel-v3.js';
import { icone, ICONE_SERVICO } from './icones.js';
import { convidarTour, iniciarTour } from './tour.js';
import {
  bloco, botao, selo, avatar, zap, tabelaExpansivel, detalhe, filtrosVerticais, tudoResolvido, vazio, pedirMotivo, modal, confirmar,
  painelLateral, anel, rosca, barras, esqueleto,
} from './componentes.js';

const REAL = ADAPTER === 'supabase';
const P = CFG.PRECOS;
const ddmm = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '');
const primeiro = (n) => String(n || '').split(' ')[0];
const NOMES_SERVICO = { residencial: 'Residencial', empresarial: 'Empresarial', condominial: 'Condominial', passadoria: 'Passadoria', pre_pos_mudanca: 'Mudança', pre_pos_evento: 'Eventos', pos_obra: 'Pós-obra' };
const nomeServico = (s) => NOMES_SERVICO[s] || P.tiposServico?.[s]?.nome || s || '';
const ORIGEM = { instagram: 'Instagram', google: 'Google', indicacao: 'Indicação', whatsapp: 'WhatsApp', outro: 'Outro' };
const MODALIDADE = { avulsa: 'Diária avulsa', multi_profissional: 'Mais de uma profissional', pacote: 'Pacote de diárias' };
const ESTADO_DIARIA = {
  agendado: ['A confirmar', 'aguardando'], confirmado: ['Confirmada', 'ok'], diarista_a_caminho: ['A caminho', 'info'], em_andamento: ['Em andamento', 'info'],
  finalizado: ['Concluída', 'ok'], avaliado: ['Concluída', 'ok'],
};
const SITUACAO_PEDIDO = { aguardando_pagamento: ['Aguardando pagamento', 'aguardando'], disponibilidade_confirmada: ['Aguardando pagamento', 'aguardando'], confirmado: ['Confirmada', 'ok'], concluido: ['Concluída', 'ok'], recusado: ['Recusada', 'urgente'], cancelado: ['Cancelada', 'neutro'] };
const ESCALA = { em_preparacao: ['Em preparação', 'neutro'], revisada: ['Revisada', 'info'], publicada: ['Publicada', 'marca'] };
const hhmm = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

/** Cache curto (30 s) por bloco, invalidado depois de cada ação. */
const cache = new Map();
async function dado(chave, fn) {
  const c = cache.get(chave);
  if (c && Date.now() - c.em < 30000) return c.valor;
  const valor = await fn();
  cache.set(chave, { valor, em: Date.now() });
  return valor;
}

export async function telaInicio({ sessao, hoje, casca }) {
  const amanha = somarDias(hoje, 1);
  const blocos = {};
  /** Depois de uma ação: limpa o cache, recarrega os blocos afetados e os contadores do menu. */
  const recarregar = (...nomes) => { cache.clear(); for (const n of nomes) blocos[n]?.recarregar(); casca.atualizarContadores(); };
  const motivos = () => dado('motivos', () => api.motivosPadrao().catch(() => ({ recusa: [], cancelamento: [] })));

  // ---------------------------------------------------------------- saudação + sistema trabalhando por você
  const h = Number(new Date().toLocaleString('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: 'America/Sao_Paulo' }));
  const saudacao = `${h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'}, ${primeiro(sessao?.nome) || 'equipe'}!`;
  const sistema = blocoSistema();

  // ---------------------------------------------------------------- solicitações novas
  blocos.solicitacoes = bloco({
    id: 'inicio-solicitacoes', titulo: 'Solicitações novas', ic: 'solicitacoes', rotuloContagem: (n) => `${n} ${n === 1 ? 'solicitação nova' : 'solicitações novas'}`,
    carregar: async () => {
      const r = await dado('solicitacoes', () => api.painelSolicitacoesNovas(20));
      const ms = (await motivos()).recusa || [];
      const linhas = r.itens.slice(0, 4).map((s) => linhaSolicitacao(s, ms, () => recarregar('solicitacoes', 'diariasHoje', 'diariasAmanha', 'pendencias')));
      return {
        contagem: r.total, sub: 'Analise, aprove, recuse ou negocie a data das novas solicitações.',
        extra: [el('a', { class: 'p-btn', href: url('painel/', { tela: 'solicitacoes' }) }, [r.total > 4 ? `Ver todas (${r.total})` : 'Ver todas', icone('seta', { pequeno: true })])],
        conteudo: r.itens.length ? tabelaExpansivel({
          rotulo: 'Solicitações novas',
          colunas: [{ rotulo: 'Data/Hora' }, { rotulo: 'Cliente', classe: 'p-principal-cel' }, { rotulo: 'Local' }, { rotulo: 'Serviço' }, { rotulo: 'Imóvel' }, { rotulo: 'Horas', classe: 'p-dinheiro' },
            { rotulo: 'Valor', classe: 'p-dinheiro' }, { rotulo: 'Origem', classe: 'p-oculta-medio' }, { rotulo: 'Ações', classe: 'p-acoes-cel', sr: true }],
          linhas,
        }) : tudoResolvido('Nenhuma solicitação nova esperando.'),
      };
    },
  });

  // ---------------------------------------------------------------- diárias de hoje e de amanhã
  blocos.diariasHoje = blocoDiarias({ id: 'inicio-hoje', titulo: 'Diárias de hoje', data: hoje, recarregar });
  blocos.diariasAmanha = blocoDiarias({ id: 'inicio-amanha', titulo: 'Diárias de amanhã', data: amanha, recarregar, comEscala: true });

  // ---------------------------------------------------------------- precisa de você
  let filtro = 'todas';
  blocos.pendencias = bloco({
    id: 'inicio-pendencias', titulo: 'Precisa de você', ic: 'alerta', rotuloContagem: (n) => `${n} ${n === 1 ? 'pendência' : 'pendências'}`,
    carregar: async () => {
      const r = await dado('pendencias', () => api.painelPendencias());
      if (!r.itens.length) return { contagem: 0, conteudo: tudoResolvido('Tudo resolvido. Nada esperando por você agora.') };
      const CATS = [['todas', 'Todas'], ['escala', 'Escala'], ['financeiro', 'Financeiro'], ['contratos', 'Contratos'], ['ocorrencias', 'Ocorrências'], ['automacoes', 'Automações']];
      const lista = el('ul', { class: 'p-lista', 'aria-live': 'polite' });
      const desenhar = () => trocar(lista, ...r.itens.filter((x) => filtro === 'todas' || x.categoria === filtro).slice(0, 8).map((x) => itemPendencia(x, { hoje, recarregar, motivos })));
      desenhar();
      const ops = CATS.map(([k, rot]) => [k, rot, k === 'todas' ? r.itens.length : r.itens.filter((x) => x.categoria === k).length]).filter(([k, , n]) => k === 'todas' || n);
      return {
        contagem: r.itens.length, urgentes: r.urgentes,
        conteudo: el('div', { class: 'p-pend' }, [filtrosVerticais(ops, filtro, (v) => { filtro = v; desenhar(); }), lista]),
        rodape: r.itens.length > 8 ? [el('a', { class: 'p-link', href: url('painel/', { tela: 'inicio', foco: 'pendencias', todas: 1 }) }, ['Ver todas as pendências', icone('seta', { pequeno: true })])] : [],
      };
    },
  });

  // ---------------------------------------------------------------- stand-by de hoje (só se houver)
  blocos.standby = bloco({
    id: 'inicio-standby', titulo: 'Stand-by de hoje', ic: 'profissionais', someSeVazio: true,
    carregar: async () => {
      const r = await dado('standby', () => api.painelStandby(hoje));
      if (!r.itens.length) return { vazio: true };
      return { contagem: r.itens.length, conteudo: el('ul', { class: 'p-lista' }, r.itens.slice(0, 3).map((x) => itemStandby(x, { hoje, recarregar }))),
        rodape: [el('a', { class: 'p-link', href: url('painel/', { tela: 'profissionais' }) }, ['Ver todas', icone('seta', { pequeno: true })])] };
    },
  });

  // ---------------------------------------------------------------- alertas importantes (só se houver)
  blocos.alertas = bloco({
    id: 'inicio-alertas', titulo: 'Alertas importantes', ic: 'sino', someSeVazio: true,
    carregar: async () => {
      const r = await dado('alertas', () => api.painelAlertas());
      if (!r.itens.length) return { vazio: true };
      const ICON = { pacote_vence: 'agenda', pacotes_semana: 'agenda', documento_vence: 'documento', avaliacao_baixa: 'estrela' };
      const destino = (x) => (x.tipo === 'documento_vence' ? url('painel/', { tela: 'profissionais', profissional: x.ref.diaristaId })
        : x.tipo === 'pacotes_semana' ? url('painel/', { tela: 'clientes', aba: 'relacionamento' }) : url('painel/', { tela: 'clientes', cliente: x.ref.clienteId }));
      return { contagem: r.itens.length, conteudo: el('ul', { class: 'p-lista' }, r.itens.slice(0, 6).map((x) => el('li', {}, [
        el('span', { class: `p-ic-item ${x.tipo === 'avaliacao_baixa' ? 'urgente' : 'aguardando'}`, 'aria-hidden': 'true' }, [icone(ICON[x.tipo] || 'alerta', { pequeno: true })]),
        el('a', { class: 'p-texto-item', href: destino(x), style: 'text-decoration:none' }, [el('b', { text: x.titulo }), el('span', { text: x.sub || '' })]),
        icone('direita', { pequeno: true }),
      ]))) };
    },
  });

  // ---------------------------------------------------------------- novos cadastros (cadastros sem solicitação)
  blocos.cadastros = bloco({
    id: 'inicio-cadastros', titulo: 'Novos cadastros', ic: 'usuario_mais', someSeVazio: true,
    carregar: async () => {
      const r = await dado('cadastros', () => api.listarCadastrosSemSolicitacao({ status: 'novo' }));
      if (!r.itens.length) return { vazio: true };
      const quando = (iso) => { const d = iso.slice(0, 10); return d === hoje ? 'Hoje' : d === somarDias(hoje, -1) ? 'Ontem' : ddmm(d); };
      return { contagem: r.total, sub: 'Concluíram o cadastro e não enviaram solicitação.', conteudo: el('ul', { class: 'p-lista' }, r.itens.slice(0, 5).map((c) => el('li', {}, [
        el('span', { class: 'p-ic-item', 'aria-hidden': 'true' }, [icone('clientes', { pequeno: true })]),
        el('a', { class: 'p-texto-item', href: url('painel/', { tela: 'clientes', cliente: c.id }), style: 'text-decoration:none' }, [el('b', { text: c.nome }), el('span', { text: c.telefone || '' })]),
        zap(c.telefone, c.nome), el('span', { class: 'p-sec', text: quando(c.criadoEm) }),
      ]))), rodape: [el('a', { class: 'p-link', href: url('painel/', { tela: 'clientes', aba: 'prospeccao' }) }, ['Ver todos', icone('seta', { pequeno: true })])] };
    },
  });

  // ---------------------------------------------------------------- indicadores (só os três da Home)
  const ind = () => dado('indicadores', () => api.painelIndicadoresHome(null));
  blocos.meta = bloco({ id: 'inicio-meta', titulo: 'Meta de diárias', ic: 'meta', carregar: async () => blocoMeta(await ind()) });
  blocos.motivos = bloco({ id: 'inicio-motivos', titulo: 'Motivos de cancelamento', ic: 'rosca', carregar: async () => blocoMotivos(await ind()) });
  blocos.regioes = bloco({ id: 'inicio-regioes', titulo: 'Regiões mais atendidas', ic: 'mapa', carregar: async () => blocoRegioes(await ind()) });

  trocar(casca.conteudo,
    el('div', { class: 'p-cabecalho' }, [el('div', {}, [el('h1', { text: saudacao }), el('p', { text: `${NOMES_DIA[diaDaSemana(hoje)].replace(/^./, (c) => c.toUpperCase())}, ${formatarData(hoje)}` })]), sistema.raiz]),
    convidarTour(),
    blocos.solicitacoes.raiz,
    el('div', { class: 'p-grade p-grade-2' }, [blocos.diariasHoje.raiz, blocos.diariasAmanha.raiz]),
    el('div', { class: 'p-grade p-grade-4 p-linha-pend' }, [blocos.pendencias.raiz, blocos.standby.raiz, blocos.alertas.raiz, blocos.cadastros.raiz]),
    el('div', { class: 'p-grade p-grade-3' }, [blocos.meta.raiz, blocos.motivos.raiz, blocos.regioes.raiz]));
  // cada bloco carrega e desenha sozinho (sem travar os outros)
  for (const b of Object.values(blocos)) b.recarregar();
  sistema.carregar();
  if (new URLSearchParams(location.search).get('foco') === 'pendencias') blocos.pendencias.raiz.scrollIntoView({ block: 'start' });
  if (new URLSearchParams(location.search).get('tour')) setTimeout(iniciarTour, 1200); // "Ver o tour de novo" (Ajuda)
}

// ---------------------------------------------------------------- "Sistema trabalhando por você" (pequeno e recolhível)
function blocoSistema() {
  const lista = el('div', { class: 'p-sistema-lista', id: 'p-sistema-lista', hidden: true });
  const resumo = el('small', { text: 'Carregando…' });
  const btn = el('button', { type: 'button', class: 'p-sistema-btn', 'aria-expanded': 'false', 'aria-controls': 'p-sistema-lista' }, [
    el('span', { class: 'p-ponto', 'aria-hidden': 'true' }), el('span', {}, [el('strong', { text: 'Sistema trabalhando por você' }), resumo]), icone('abaixo', { pequeno: true }),
  ]);
  btn.addEventListener('click', () => { const abrir = lista.hidden; lista.hidden = !abrir; btn.setAttribute('aria-expanded', String(abrir)); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !lista.hidden) { lista.hidden = true; btn.setAttribute('aria-expanded', 'false'); btn.focus(); } });
  return {
    raiz: el('div', { class: 'p-sistema' }, [btn, lista]),
    async carregar() {
      try {
        const r = await api.painelSistemaHoje();
        resumo.textContent = `${r.total} ${r.total === 1 ? 'ação automática' : 'ações automáticas'} hoje`;
        trocar(lista, el('p', { class: 'p-sec', style: 'margin:0 0 8px', text: 'Mensagens que o sistema enviou sozinho hoje. As que falharam aparecem em "Precisa de você".' }),
          r.itens.length ? el('ul', { class: 'p-lista' }, r.itens.map((x) => el('li', {}, [el('span', { class: 'p-ic-item ok', 'aria-hidden': 'true' }, [icone('check', { pequeno: true })]),
            el('span', { class: 'p-texto-item' }, [el('b', { text: x.descricao }), el('span', { text: hhmm(x.em) })])]))) : vazio('Nenhuma ainda hoje.'));
      } catch { resumo.textContent = 'Não deu pra carregar agora'; }
    },
  };
}

// ---------------------------------------------------------------- linha da solicitação nova
export function linhaSolicitacao(s, motivosRecusa, depois) {
  const quando = el('span', { class: 'p-num' }, [ddmm(s.primeiraData), el('span', { class: 'p-linha2', text: s.horaInicio || '' })]);
  const cliente = el('span', { style: 'display:inline-flex;align-items:center;gap:6px' }, [el('span', { class: 'p-forte', text: s.cliente.nome }), zap(s.cliente.telefone, s.cliente.nome)]);
  const im = s.imovel || {};
  const imovel = el('span', {}, [
    el('span', { style: 'white-space:nowrap', text: im.pecas ? `${im.pecas} peças` : [im.metragem ? `${im.metragem} m²` : null, im.ambientes ? `${im.ambientes} amb.` : null].filter(Boolean).join(' · ') || '' }),
    el('span', { class: 'p-linha2', text: [im.animais ? 'Com animal' : 'Sem animal', im.refeicao === false ? 'sem refeição' : null].filter(Boolean).join(' · ') }),
  ]);
  const origem = s.origem?.origem ? el('span', {}, [ORIGEM[s.origem.origem] || s.origem.origem, s.origem.quemIndicou ? el('span', { class: 'p-linha2', text: s.origem.quemIndicou }) : null]) : el('span', { class: 'p-sec', text: '-' });
  const servico = el('span', { style: 'display:inline-flex;align-items:center;gap:6px' }, [icone(ICONE_SERVICO[s.servico] || 'casa', { pequeno: true }), nomeServico(s.servico),
    s.quantidade > 1 ? el('span', { class: 'p-linha2', text: `${s.quantidade} ${s.modalidade === 'multi_profissional' ? 'profissionais' : 'diárias'}` }) : null]);
  const aprovar = botao('Aprovar', { tom: 'ok', ic: 'check', rotulo: `Aprovar a solicitação de ${s.cliente.nome}`, acao: (k) => api.confirmarDisponibilidade(s.pedidoId, {}, { chave: k }),
    sucesso: 'Disponibilidade confirmada. A cliente recebe a cobrança no WhatsApp.', aoSucesso: depois });
  const recusar = botao('Recusar', { tom: 'perigo', ic: 'fechar', rotulo: `Recusar a solicitação de ${s.cliente.nome}`, aoClicar: async () => {
    const m = await pedirMotivo({ titulo: `Recusar a solicitação de ${primeiro(s.cliente.nome)}`, motivos: motivosRecusa, rotuloConfirmar: 'Recusar e avisar a cliente',
      consequencia: 'A cliente recebe a recusa com o motivo pelo WhatsApp. Fica registrado no histórico.' });
    if (m) await executarAcao(recusar, (k) => api.recusarSolicitacao(s.pedidoId, { motivo: m.texto }, { chave: k }), { sucesso: 'Solicitação recusada.', aoSucesso: depois });
  } });
  const negociar = botao('Negociar data', { tom: 'aviso', ic: 'agenda', rotulo: `Negociar a data com ${s.cliente.nome}`, aoClicar: () => negociarData(s, depois) });
  const mais = botao('Ver a solicitação completa', { ic: 'mais', soIcone: true, aoClicar: () => verSolicitacao(s) });
  const avisos = [s.enderecoNovoPacote ? selo('Endereço novo no pacote', 'aguardando') : null, s.proposta ? selo(`Data proposta: ${ddmm(s.proposta.data)} ${s.proposta.horaInicio}`, 'info') : null].filter(Boolean);
  return {
    rotulo: s.cliente.nome, dataset: { solicitacao: s.pedidoId },
    celulas: [quando, el('span', {}, [cliente, ...avisos.map((a) => el('span', { style: 'display:block;margin-top:2px' }, [a]))]),
      el('span', { style: 'display:inline-flex;gap:4px;align-items:center' }, [icone('local', { pequeno: true }), [s.local?.bairro, s.local?.cidade === 'Belo Horizonte' ? 'BH' : s.local?.cidade].filter(Boolean).join(' - ')]),
      servico, imovel, el('span', { class: 'p-num', text: `${String(s.horas).replace('.', ',')}h` }), el('span', { class: 'p-num p-forte', text: formatarBRL(s.valorCentavos) }), origem,
      s.status && s.status !== 'solicitado'
        ? el('span', { style: 'display:inline-flex;gap:4px;align-items:center;justify-content:flex-end' }, [selo(...(SITUACAO_PEDIDO[s.status] || [s.status, 'neutro'])), mais])
        : el('span', { class: 'p-acoes-sol', style: 'display:inline-flex;gap:4px;flex-wrap:wrap;justify-content:flex-end' }, [aprovar, recusar, negociar, mais])],
    detalhe: () => detalheSolicitacao(s),
  };
}

function detalheSolicitacao(s) {
  const caixa = el('div', {}, [esqueleto(2)]);
  api.obterPedido(s.pedidoId).then((c) => {
    const ats = c.atendimentos.filter((a) => a.status !== 'cancelado');
    const a0 = ats[0] || {};
    const end = a0.endereco || c.pedido.endereco || c.cliente?.endereco || {};
    const car = a0.caracteristicas || {};
    trocar(caixa, detalhe([
      ['Nº da solicitação', c.pedido.numeroSolicitacao ? String(c.pedido.numeroSolicitacao).padStart(6, '0') : ''],
      ['Modalidade', `${MODALIDADE[c.pedido.modalidade] || 'Solicitação'}${ats.length > 1 ? ` · ${ats.length} ${c.pedido.modalidade === 'multi_profissional' ? 'profissionais' : 'diárias'}` : ''}`],
      ['Datas', ats.map((a) => `${ddmm(a.data)}${a.horaInicio ? ` ${a.horaInicio}` : ''}`).join(', ')],
      ['Endereço', [[end.logradouro, end.numero].filter(Boolean).join(', '), end.complemento, end.bairro, end.cidade].filter(Boolean).join(' · '), true],
      ['Características', [car.metragem ? `${car.metragem} m²` : '', car.mobiliado ? `mobiliado: ${car.mobiliado}` : '', car.condicao ? `condição: ${car.condicao}` : '', car.momento ? `momento: ${car.momento}` : '',
        car.animais?.tem ? 'com animais' : car.animais ? 'sem animais' : ''].filter(Boolean).join(' · ')],
      ['Duração', a0.duracaoMinutos ? `${a0.duracaoMinutos / 60}h${a0.duracaoRecomendadaHoras && a0.duracaoRecomendadaHoras * 60 > a0.duracaoMinutos ? ` (sugerida ${a0.duracaoRecomendadaHoras}h)` : ''}` : ''],
      ['Justificativa da duração', a0.justificativa || ''],
      ['Como conheceu', s.origem?.origem ? [ORIGEM[s.origem.origem] || s.origem.origem, s.origem.quemIndicou, s.origem.outroQual].filter(Boolean).join(': ') : ''],
      ['Cupom', c.pedido.cupomCodigo || ''],
      ['Valor', formatarBRL(c.pedido.pacote?.totalCentavos || 0)],
    ]));
  }).catch(() => trocar(caixa, vazio('Não deu pra carregar o detalhe agora.')));
  return caixa;
}

export async function verSolicitacao(s) {
  const corpo = el('div', {}, [esqueleto(4)]);
  painelLateral({ titulo: `Solicitação de ${primeiro(s.cliente.nome)}`, corpo });
  try {
    const c = await api.obterPedido(s.pedidoId);
    trocar(corpo, c.pedido.pacote?.versao === 3 ? detalhesSolicitacaoV3(c) : detalheSolicitacao(s),
      el('p', {}, [el('a', { class: 'p-link', href: url('painel/', { tela: 'solicitacoes' }) }, ['Ajustar horários e outras opções em Solicitações', icone('seta', { pequeno: true })])]));
  } catch { trocar(corpo, vazio('Não deu pra carregar a solicitação agora.')); }
}

/** Negociar data: calendário + horário permitido pela duração; a cliente recebe a proposta pelo WhatsApp (C18). */
function negociarData(s, depois) {
  const minimo = somarDias(new Date().toISOString().slice(0, 10), 1);
  const data = el('input', { type: 'date', id: 'neg-data', min: minimo, value: '' });
  const hora = el('select', { id: 'neg-hora' });
  const msg = el('textarea', { id: 'neg-msg', rows: '2', maxlength: '280', placeholder: 'Opcional: algo pra cliente saber' });
  const erro = el('p', { class: 'p-erro-campo', 'aria-live': 'polite' });
  const horasDia = Math.max(2, Math.round(s.horas || 4));
  const atualizarHoras = () => {
    const opcoes = data.value ? horariosPermitidos(horasDia, data.value, CFG) : [];
    trocar(hora, ...(opcoes.length ? opcoes : ['08:00']).map((x) => el('option', { value: x, text: x, selected: x === (s.horaInicio || '08:00') })));
  };
  data.addEventListener('change', atualizarHoras); atualizarHoras();
  const corpo = el('div', { style: 'display:flex;flex-direction:column;gap:12px' }, [
    el('p', { class: 'p-sec', text: `Pedido pra ${ddmm(s.primeiraData)}${s.horaInicio ? ` às ${s.horaInicio}` : ''}. Proponha outra data e horário.` }),
    el('div', { class: 'p-campo' }, [el('label', { for: 'neg-data', text: 'Nova data' }), data]),
    el('div', { class: 'p-campo' }, [el('label', { for: 'neg-hora', text: 'Horário de início' }), hora]),
    el('div', { class: 'p-campo' }, [el('label', { for: 'neg-msg', text: 'Mensagem (opcional)' }), msg]),
    erro, el('p', { class: 'p-consequencia', text: 'A cliente recebe a proposta pelo WhatsApp e responde por lá. A solicitação continua aqui até você aprovar ou recusar.' }),
  ]);
  modal({ titulo: `Negociar a data com ${primeiro(s.cliente.nome)}`, corpo, botoes: (fechar) => {
    const enviar = botao('Enviar proposta à cliente', { tom: 'primario', aoClicar: () => {
      if (!data.value) { erro.textContent = 'Escolha a nova data'; data.focus(); return; }
      executarAcao(enviar, (k) => api.proporNovaData(s.pedidoId, { data: data.value, horaInicio: hora.value, mensagem: msg.value }, { chave: k }), {
        sucesso: 'Proposta enviada à cliente.', aoSucesso: () => { fechar(); depois(); }, aoErro: (e) => { erro.textContent = e.message || 'Não deu certo. Tente de novo.'; },
      });
    } });
    return [botao('Voltar', { aoClicar: () => fechar() }), enviar];
  } });
}

// ---------------------------------------------------------------- diárias do dia
function blocoDiarias({ id, titulo, data, recarregar, comEscala = false }) {
  return bloco({
    id, titulo: `${titulo}`, ic: 'agenda', rotuloContagem: (n) => `${n} ${n === 1 ? 'diária' : 'diárias'}`,
    carregar: async () => {
      const r = await dado(`diarias:${data}`, () => api.painelDiarias(data));
      const extra = [el('span', { class: 'p-pontos' }, [el('span', { text: `${r.confirmadas} ${r.confirmadas === 1 ? 'confirmada' : 'confirmadas'}` }),
        r.pendentes ? el('span', { class: 'aguardando', text: `${r.pendentes} ${r.pendentes === 1 ? 'pendente' : 'pendentes'}` }) : null])];
      if (comEscala) extra.push(seloEscala(r.escala, data, () => recarregar(id === 'inicio-amanha' ? 'diariasAmanha' : 'diariasHoje')));
      return {
        contagem: r.itens.length, extra, rodape: [el('a', { class: 'p-link', href: url('painel/', { tela: 'agenda', aba: comEscala ? 'escala' : 'agenda', data }) }, ['Ver agenda completa', icone('seta', { pequeno: true })])],
        conteudo: r.itens.length ? tabelaExpansivel({
          rotulo: titulo,
          colunas: COLUNAS_DIARIA,
          linhas: r.itens.map((d) => linhaDiaria(d)),
        }) : vazio(comEscala ? 'Nenhuma diária amanhã.' : 'Nenhuma diária hoje.'),
      };
    },
  });
}

export function seloEscala(esc, data, depois) {
  const [rot, tom] = ESCALA[esc.estado] || ESCALA.em_preparacao;
  const texto = esc.estado === 'publicada' ? `Publicada às ${hhmm(esc.publicadaEm)}${esc.alteradaDepois ? ' (mudou depois)' : ''}` : rot;
  const b = el('button', { type: 'button', class: `p-selo ${esc.alteradaDepois ? 'aguardando' : tom}`, style: 'border:0;cursor:pointer', 'aria-label': `Escala de amanhã: ${texto}. Abrir opções da escala`, text: texto });
  b.addEventListener('click', () => {
    const quem = esc.publicadaPor ? ` por ${esc.publicadaPor}` : '';
    const corpo = el('div', { style: 'display:flex;flex-direction:column;gap:8px' }, [
      el('p', { class: 'p-sec', text: esc.estado === 'publicada' ? `Publicada às ${hhmm(esc.publicadaEm)}${quem}.${esc.alteradaDepois ? ' Alguma diária mudou depois: publique de novo pra avisar as profissionais.' : ''}` : `A escala de ${ddmm(data)} está ${rot.toLowerCase()}.` }),
      el('p', { class: 'p-consequencia', text: 'Publicar avisa cada profissional escalada pelo WhatsApp. Só publica sem diária sem profissional.' }),
    ]);
    modal({ titulo: `Escala de ${ddmm(data)}`, corpo, botoes: (fechar) => {
      const acao = (a, texto2, tom2, sucesso) => { const x = botao(texto2, { tom: tom2, aoClicar: () => executarAcao(x, (k) => api.marcarEscala(data, a, null, { chave: k }), { sucesso, aoSucesso: () => { fechar(); depois(); } }) }); return x; };
      const reabrir = botao('Reabrir', { aoClicar: async () => {
        fechar();
        const m = await pedirMotivo({ titulo: 'Reabrir a escala', explicacao: 'A escala volta pra "Em preparação". Diga o motivo (fica no histórico).', rotuloConfirmar: 'Reabrir a escala', tom: 'primario' });
        if (m) executarAcao(null, (k) => api.marcarEscala(data, 'reabrir', m.texto, { chave: k }), { sucesso: 'Escala reaberta.', aoSucesso: depois });
      } });
      return [botao('Fechar', { aoClicar: () => fechar() }),
        esc.estado === 'em_preparacao' ? acao('revisar', 'Marcar como revisada', '', 'Escala marcada como revisada.') : reabrir,
        esc.estado !== 'publicada' || esc.alteradaDepois ? acao('publicar', esc.estado === 'publicada' ? 'Publicar de novo e avisar' : 'Publicar e avisar as profissionais', 'primario', 'Escala publicada. As profissionais foram avisadas.') : null].filter(Boolean);
    } });
  });
  return b;
}

export const COLUNAS_DIARIA = [{ rotulo: 'Horário' }, { rotulo: 'Cliente / Local', classe: 'p-principal-cel' }, { rotulo: 'Serviço' }, { rotulo: 'Profissional' },
  { rotulo: 'Pagamento e status' }];
export function linhaDiaria(d) {
  const [rot, tom] = ESTADO_DIARIA[d.status] || [d.status, 'neutro'];
  const pg = d.pagamento?.estado === 'pago' ? selo(`Pago ${d.pagamento.forma === 'cartao' ? 'cartão' : 'PIX'}`, 'ok') : d.pagamento?.estado === 'a_faturar' ? selo('A faturar', 'neutro') : selo('Pendente PIX', 'aguardando');
  const status = el('span', {}, [selo(rot, tom), d.nota ? el('span', { class: 'p-linha2', style: 'display:inline-flex;align-items:center;gap:2px' }, [icone('estrela', { pequeno: true }), String(d.nota).replace('.', ',')]) : null]);
  const prof = d.profissional ? el('span', { style: 'display:inline-flex;align-items:center;gap:4px' }, [avatar(d.profissional.nome.split(' ')[0], { habilidades: d.profissional.habilidades }), zap(d.profissional.telefone, d.profissional.nome)])
    : selo('Sem profissional', 'urgente');
  const car = d.caracteristicas || {};
  return {
    rotulo: d.cliente.nome, dataset: { diaria: d.id },
    celulas: [el('span', { class: 'p-num p-forte', text: d.horaInicio || '' }),
      el('span', { style: 'display:inline-flex;align-items:center;gap:2px' }, [el('span', {}, [el('span', { class: 'p-forte', text: d.cliente.nome }), el('span', { class: 'p-linha2', text: d.local?.bairro || '' })]), zap(d.cliente.telefone, d.cliente.nome)]),
      el('span', { style: 'display:inline-flex;align-items:center;gap:6px;white-space:nowrap', title: nomeServico(d.servico) }, [icone(ICONE_SERVICO[d.servico] || 'casa', { titulo: nomeServico(d.servico) }), el('span', { class: 'p-num', text: `${(d.duracaoMinutos || 0) / 60}h` })]),
      prof, el('span', { class: 'p-pilha' }, [pg, status])],
    detalhe: () => detalhe([
      ['Endereço', [[d.local?.logradouro, d.local?.numero].filter(Boolean).join(', '), d.local?.complemento, d.local?.bairro, d.local?.cidade].filter(Boolean).join(' · '), true],
      ['Ponto de referência', d.local?.pontoReferencia || ''],
      ['Metragem', car.metragem ? `${car.metragem} m²` : ''],
      ['Ambientes', car.ambientes ? Object.entries(car.ambientes).filter(([, v]) => v).map(([k, v]) => `${v} ${k}`).join(', ') : car.ambientesTotal ? String(car.ambientesTotal) : ''],
      ['Animais', car.animais ? (car.animais.tem ? [car.animais.caes && `${car.animais.caes} cão(es)`, car.animais.gatos && `${car.animais.gatos} gato(s)`, car.animais.outros && `${car.animais.outros} ${car.animais.outrosQual || 'outro(s)'}`].filter(Boolean).join(', ') || 'Sim' : 'Não') : ''],
      ['Alimentação', d.localRefeicao === false ? 'Sem local pra aquecer refeição' : d.localRefeicao ? 'Tem local pra refeição' : ''],
      ['Observações', [d.justificativa, d.observacao].filter(Boolean).join(' · ')],
      ['Nº da solicitação', d.numero ? String(d.numero).padStart(6, '0') : ''],
    ]),
  };
}

// ---------------------------------------------------------------- itens de "Precisa de você"
const ICONE_PEND = { sem_profissional: 'alerta', substituicao: 'troca', pagamento_informado: 'financeiro', pagamento_vencido: 'relogio', adiantamento: 'dinheiro_mao', reembolso_transporte: 'carro',
  hora_extra: 'relogio', pacote_endereco_novo: 'local', cadastro_profissional: 'usuario_mais', documento_vencido: 'documento', ocorrencia: 'info', falha_automacao: 'robo' };

function itemPendencia(x, { hoje, recarregar, motivos }) {
  const r = ['pendencias', 'diariasHoje', 'diariasAmanha', 'standby'];
  const ok = (rotulo, fn, sucesso) => botao('Aprovar', { tom: 'ok', ic: 'check', soIcone: true, rotulo: `${rotulo}: aprovar`, acao: fn, sucesso, aoSucesso: () => recarregar(...r) });
  const nao = (rotulo, fn, { titulo, consequencia, comMotivos } = {}) => {
    const b = botao('Recusar', { tom: 'perigo', ic: 'fechar', soIcone: true, rotulo: `${rotulo}: recusar`, aoClicar: async () => {
      const m = await pedirMotivo({ titulo: titulo || `Recusar: ${x.titulo}`, motivos: comMotivos ? await comMotivos() : [], rotuloConfirmar: 'Recusar', consequencia: consequencia || 'O motivo fica registrado no histórico.' });
      if (m) executarAcao(b, (k) => fn(m, k), { sucesso: 'Registrado.', aoSucesso: () => recarregar(...r) });
    } });
    return b;
  };
  const ir = (texto, href) => el('a', { class: 'p-btn', href, text: texto });
  let acoes = [];
  switch (x.tipo) {
    case 'sem_profissional': case 'substituicao':
      acoes = [botao('Resolver', { tom: 'perigo', aoClicar: () => resolverSemProfissional(x, { hoje, recarregar }) })]; break;
    case 'pagamento_informado':
      acoes = [ok(x.titulo, (k) => api.confirmarPagamento(x.ref.pagamentoId, { chave: k }), 'Pagamento confirmado.'),
        nao(x.titulo, (m, k) => api.recusarInformePagamento(x.ref.pagamentoId, m.texto, { chave: k }), { titulo: 'Pagamento não encontrado no extrato', consequencia: 'A cobrança volta pra pendente e a cliente é avisada pelo WhatsApp, com o PIX de novo.' })]; break;
    case 'pagamento_vencido':
      acoes = REAL ? [botao('Dar prazo', { tom: 'aviso', aoClicar: () => darPrazo(x, hoje, () => recarregar(...r)) }), botao('Liberar vaga', { tom: 'perigo', aoClicar: async () => {
        if (await confirmar({ titulo: 'Liberar a vaga?', texto: 'A diária sai da agenda e a cliente é avisada pelo WhatsApp.', rotuloConfirmar: 'Liberar a vaga e avisar a cliente', tom: 'perigo' })) {
          executarAcao(null, (k) => api.liberarVaga(x.ref.pagamentoId, { chave: k }), { sucesso: 'Vaga liberada.', aoSucesso: () => recarregar(...r) });
        }
      } })] : [ir('Ver', url('painel/', { tela: 'financeiro' }))]; break;
    case 'adiantamento': case 'reembolso_transporte':
      acoes = [ok(x.titulo, (k) => api.decidirSolicitacaoProfissional(x.ref.solicitacaoId, 'aprovada', null, { chave: k }), 'Aprovado.'),
        nao(x.titulo, (m, k) => api.decidirSolicitacaoProfissional(x.ref.solicitacaoId, 'recusada', m.texto, { chave: k }))]; break;
    case 'hora_extra':
      acoes = [ok(x.titulo, (k) => api.decidirHoraExtra(x.ref.horaExtraId, { aprovar: true }, { chave: k }), 'Hora extra aprovada.'),
        nao(x.titulo, (m, k) => api.decidirHoraExtra(x.ref.horaExtraId, { aprovar: false, motivo: m.texto }, { chave: k }))]; break;
    case 'pacote_endereco_novo':
      acoes = [ok(x.titulo, () => api.aprovarEnderecoPacote(x.ref.pedidoId), 'Endereço aprovado.'),
        nao(x.titulo, (m, k) => api.recusarSolicitacao(x.ref.pedidoId, { motivo: m.texto }, { chave: k }), { titulo: 'Recusar o pacote com endereço novo', comMotivos: async () => (await motivos()).recusa, consequencia: 'A solicitação é recusada e a cliente recebe o motivo pelo WhatsApp.' })]; break;
    case 'cadastro_profissional': case 'documento_vencido':
      acoes = [ir('Ver', url('painel/', { tela: 'profissionais', profissional: x.ref.diaristaId }))]; break;
    case 'ocorrencia':
      acoes = [ir('Ver', url('painel/', { tela: 'clientes', aba: 'ocorrencias' }))]; break;
    case 'falha_automacao':
      acoes = [botao('Reprocessar', { acao: (k) => api.acaoExecucao(x.ref.execucaoId, 'reenviar', { chave: k }), sucesso: 'Mensagem enviada de novo pra fila.', aoSucesso: () => recarregar('pendencias') })]; break;
    default: acoes = [];
  }
  return el('li', { class: x.urgente ? 'urgente' : null, dataset: { pendencia: x.id, tipo: x.tipo } }, [
    el('span', { class: `p-ic-item ${x.urgente ? 'urgente' : 'aguardando'}`, 'aria-hidden': 'true' }, [icone(ICONE_PEND[x.tipo] || 'alerta', { pequeno: true })]),
    el('span', { class: 'p-texto-item' }, [el('b', {}, [x.urgente ? el('span', { class: 'p-sr', text: 'Urgente: ' }) : null, x.titulo]), el('span', { text: x.sub || '' })]),
    el('span', { class: 'p-acoes-item' }, acoes),
  ]);
}

/** "Resolver" diária sem profissional (ou substituição): profissionais compatíveis, quem está em stand-by primeiro. */
async function resolverSemProfissional(x, { hoje, recarregar }) {
  const corpo = el('div', {}, [esqueleto(4)]);
  const fechar = painelLateral({ titulo: x.titulo, corpo });
  try {
    const standby = new Set((await api.painelStandby(x.ref.data || hoje)).itens.filter((s) => s.estado !== 'liberada').map((s) => s.diaristaId));
    const lista = REAL ? (await api.sugerirProfissionais(x.ref.atendimentoId)).map((p) => ({ id: p.id, nome: p.nome, livre: p.livre, avisos: (p.conflitos || []).map((c) => c.mensagem) }))
      : (await api.listarDiaristas({})).itens.filter((d) => d.status === 'aprovada').map((d) => ({ id: d.id, nome: d.nome, livre: true, avisos: [] }));
    const ordenada = lista.filter((p) => p.id !== x.ref.diaristaId).sort((a, b) => Number(standby.has(b.id)) - Number(standby.has(a.id)) || Number(b.livre) - Number(a.livre));
    trocar(corpo, el('p', { class: 'p-sec', text: `${x.sub}. Quem está em stand-by aparece primeiro.` }),
      ordenada.length ? el('ul', { class: 'p-lista' }, ordenada.map((p) => {
        const b = botao('Designar', { tom: p.livre ? 'primario' : '', acao: (k) => api.atribuirDiarista(x.ref.atendimentoId, { diaristaId: p.id }, { chave: k }),
          sucesso: `${primeiro(p.nome)} designada.`, aoSucesso: () => { fechar(); recarregar('pendencias', 'diariasHoje', 'diariasAmanha', 'standby'); } });
        return el('li', {}, [avatar(p.nome), el('span', { class: 'p-texto-item' }, [standby.has(p.id) ? selo('Em stand-by', 'ok') : null, el('span', { text: p.livre ? 'Livre nesse horário' : p.avisos.join('; ') })]), b]);
      })) : vazio('Nenhuma profissional aprovada disponível.'));
  } catch { trocar(corpo, vazio('Não deu pra carregar as profissionais agora.')); }
}

function darPrazo(x, hoje, depois) {
  const data = el('input', { type: 'date', id: 'prazo-data', min: hoje, value: somarDias(hoje, 1) });
  const hora = el('input', { type: 'time', id: 'prazo-hora', value: '12:00' });
  modal({ titulo: 'Dar mais prazo', corpo: el('div', { style: 'display:flex;flex-direction:column;gap:12px' }, [
    el('div', { class: 'p-campo' }, [el('label', { for: 'prazo-data', text: 'Novo prazo (data)' }), data]),
    el('div', { class: 'p-campo' }, [el('label', { for: 'prazo-hora', text: 'Hora' }), hora]),
    el('p', { class: 'p-consequencia', text: 'A cliente recebe o novo prazo pelo WhatsApp. Sugestão: amanhã às 12h.' })]),
  botoes: (fechar) => { const b = botao('Salvar prazo e avisar', { tom: 'primario', aoClicar: () => executarAcao(b, (k) => api.prorrogarPrazo(x.ref.pagamentoId, { venceEm: data.value, venceAs: hora.value }, { chave: k }), { sucesso: 'Prazo atualizado.', aoSucesso: () => { fechar(); depois(); } }) }); return [botao('Voltar', { aoClicar: () => fechar() }), b]; } });
}

// ---------------------------------------------------------------- stand-by
function itemStandby(s, { hoje, recarregar }) {
  const turnos = (s.turnos || []).map((t) => ({ manha: '08h-12h', tarde: '13h-18h', integral: '08h-18h' }[t] || t)).join(', ');
  const confirmar2 = botao('Confirmar', { tom: 'ok', ic: 'check', rotulo: `Confirmar ${s.nome}`, aoClicar: async () => {
    const pend = (await api.painelPendencias()).itens.filter((p) => p.tipo === 'sem_profissional' && p.ref.data === hoje);
    const corpo = el('div', { style: 'display:flex;flex-direction:column;gap:8px' }, [
      el('p', { class: 'p-sec', text: pend.length ? `Designar ${primeiro(s.nome)} numa diária de hoje sem profissional:` : `Nenhuma diária de hoje sem profissional. Confirmar deixa ${primeiro(s.nome)} de prontidão.` }),
    ]);
    modal({ titulo: `Confirmar ${primeiro(s.nome)}`, corpo, botoes: (fechar) => [
      botao('Voltar', { aoClicar: () => fechar() }),
      ...pend.slice(0, 4).map((p) => botao(`Designar: ${p.sub}`, { tom: 'primario', acao: (k) => api.atribuirDiarista(p.ref.atendimentoId, { diaristaId: s.diaristaId }, { chave: k }),
        sucesso: `${primeiro(s.nome)} designada.`, aoSucesso: () => { fechar(); recarregar('standby', 'pendencias', 'diariasHoje'); } })),
      pend.length ? null : botao('Confirmar prontidão', { tom: 'primario', acao: () => api.decidirStandby(s.diaristaId, hoje, 'confirmada', null), sucesso: 'Stand-by confirmado.', aoSucesso: () => { fechar(); recarregar('standby'); } }),
    ].filter(Boolean) });
  } });
  const liberar = botao('Liberar', { tom: 'perigo', ic: 'fechar', rotulo: `Liberar ${s.nome}`, acao: () => api.decidirStandby(s.diaristaId, hoje, 'liberada', null), sucesso: `${primeiro(s.nome)} liberada hoje.`, aoSucesso: () => recarregar('standby') });
  return el('li', { class: 'p-standby', dataset: { standby: s.diaristaId } }, [
    el('span', { style: 'display:flex;align-items:center;gap:6px;min-width:0;flex:1 1 180px' }, [avatar(s.nome, { habilidades: s.habilidades, linha2: [turnos, (s.regioes || [])[0]].filter(Boolean).join(' · ') }), zap(s.telefone, s.nome)]),
    s.estado === 'confirmada' ? selo('Confirmada', 'ok') : null, el('span', { class: 'p-acoes-item' }, [confirmar2, liberar])]);
}

// ---------------------------------------------------------------- indicadores
function blocoMeta(r) {
  const m = r.meta;
  const feito = m.realizadas + m.agendadas;
  const pct = m.meta ? (feito / m.meta) * 100 : 0;
  const mes = new Date(`${r.mes}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', timeZone: 'UTC' });
  return {
    sub: `Meta: +${String(m.percentual).replace('.', ',')}% sobre o mês anterior (${mes})`,
    conteudo: el('div', { class: 'p-meta' }, [anel(Math.min(pct, 999)), el('div', { style: 'display:flex;flex-direction:column;gap:10px;min-width:0' }, [
      el('dl', { class: 'p-numeros' }, [['Mês anterior', m.mesAnterior], ['Meta', m.meta], ['Realizadas', m.realizadas], ['Agendadas', m.agendadas]].map(([k, v]) => el('div', {}, [el('dt', { text: k }), el('dd', { text: String(v) })]))),
      el('div', { class: 'p-barra', role: 'img', 'aria-label': `${Math.round(pct)}% da meta` }, [el('i', { style: `width:${Math.min(100, Math.round(pct))}%` })]),
      el('p', { class: 'p-sec', style: 'margin:0', text: m.meta === 0 ? 'Sem diárias no mês anterior: a meta começa no próximo mês.' : m.faltam ? `${m.faltam === 1 ? 'Falta 1 diária' : `Faltam ${m.faltam} diárias`} pra atingir a meta.` : 'Meta atingida com as realizadas e agendadas.' }),
    ])]),
  };
}

function blocoMotivos(r) {
  const total = r.cancelamentos.reduce((s, x) => s + x.total, 0);
  return { sub: 'Este mês', conteudo: total ? rosca(r.cancelamentos.map((x) => ({ rotulo: x.rotulo, valor: x.total })), { centroRotulo: total === 1 ? 'diária' : 'diárias', titulo: 'Motivos de cancelamento' })
    : vazio('Nenhuma diária cancelada este mês.') };
}

function blocoRegioes(r) {
  let modo = 'cidades'; let cidade = null;
  const caixa = el('div');
  const alt = el('div', { class: 'p-alternancia', role: 'group', 'aria-label': 'Ver por' });
  const btC = el('button', { type: 'button', 'aria-pressed': 'true', text: 'Cidades' });
  const btB = el('button', { type: 'button', 'aria-pressed': 'false', text: 'Bairros' });
  alt.append(btC, btB);
  const desenhar = () => {
    btC.setAttribute('aria-pressed', String(modo === 'cidades')); btB.setAttribute('aria-pressed', String(modo === 'bairros'));
    if (!r.regioes.length) { trocar(caixa, vazio('Sem diárias neste mês ainda.')); return; }
    if (modo === 'cidades') { trocar(caixa, barras(r.regioes.slice(0, 6).map((x) => ({ rotulo: x.cidade, valor: x.total })), { aoClicar: (c) => { cidade = c; modo = 'bairros'; desenhar(); }, rotuloColuna: 'Cidades' })); return; }
    const c = r.regioes.find((x) => x.cidade === cidade) || r.regioes[0];
    trocar(caixa, el('p', { class: 'p-sec', style: 'margin:0 0 8px', text: `Bairros de ${c.cidade}` }), barras(c.bairros.slice(0, 6).map((x) => ({ rotulo: x.bairro, valor: x.total })), { rotuloColuna: `Bairros de ${c.cidade}` }));
  };
  btC.addEventListener('click', () => { modo = 'cidades'; desenhar(); });
  btB.addEventListener('click', () => { modo = 'bairros'; desenhar(); });
  desenhar();
  return { extra: [alt], conteudo: caixa };
}

