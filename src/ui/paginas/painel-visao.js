// P1 e O1 no painel (backend real): visão geral com indicadores do período (só prime_admin), busca global (mascarada e
// registrada) e saúde do sistema (worker, fila, falhas, erros agrupados, último backup, funil). Tudo vem calculado do banco.
import { el, param, trocar } from '../dom.js';
import { api } from '../../services/api.js';
import { executarAcao, mensagemErro } from '../acoes.js';
import { selo } from '../comum.js';
import { url } from '../../config/app.js';
import { formatarBRL } from '../../domain/dinheiro.js';
import { formatarInstante } from '../../domain/calendario.js';
import { ROTULOS_PEDIDO } from '../../domain/estados.js';
import { CONFIG_PRECOS } from '../../config/precos.js';

const SERVICO = (k) => CONFIG_PRECOS.PRECOS.tiposServico[k]?.nome || k;
const OCORRENCIA = { dano: 'Algo danificado', item_nao_feito: 'Item não feito', atraso: 'Atraso', comportamento: 'Comportamento', outro: 'Outro' };
const FUNIL = [['abriu_calculadora', 'Abriu a calculadora'], ['iniciou_solicitacao', 'Iniciou a solicitação'], ['concluiu_solicitacao', 'Concluiu a solicitação'], ['pagou', 'Pagou']];

const cartao = (titulo, valor, detalhe) => el('div', { class: 'cartao indicador' }, [el('span', { class: 'mudo', text: titulo }), el('strong', { text: valor }), detalhe ? el('span', { class: 'mudo', text: detalhe }) : null]);
const lista = (obj, rotulo = (k) => k) => (Object.keys(obj || {}).length ? el('ul', { class: 'lista-simples' }, Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, v]) => el('li', { text: `${rotulo(k)}: ${v}` }))) : el('p', { class: 'mudo', text: 'Nada no período.' }));

export async function abaVisaoGeral(admin) {
  const hoje = new Date().toISOString().slice(0, 10);
  const de = /^\d{4}-\d{2}-\d{2}$/.test(param('de') || '') ? param('de') : `${hoje.slice(0, 7)}-01`;
  const ate = /^\d{4}-\d{2}-\d{2}$/.test(param('ate') || '') ? param('ate') : hoje;
  const [ind, saude] = await Promise.all([admin ? api.indicadores(de, ate).catch((e) => ({ erro: mensagemErro(e) })) : null, api.saudeSistema().catch((e) => ({ erro: mensagemErro(e) }))]);
  return el('div', { class: 'reveal visao-geral' }, [blocoBusca(), admin ? blocoIndicadores(ind, de, ate) : el('p', { class: 'mudo', text: 'Os indicadores são só da administração da Prime.' }), blocoSaude(saude)]);
}

function blocoIndicadores(r, de, ate) {
  const f = el('form', { class: 'opcoes', method: 'get', action: url('painel/') }, [
    el('input', { type: 'hidden', name: 'aba', value: 'visao' }),
    el('label', { class: 'opcao-check' }, ['De ', el('input', { type: 'date', name: 'de', value: de })]),
    el('label', { class: 'opcao-check' }, ['Até ', el('input', { type: 'date', name: 'ate', value: ate })]),
    el('button', { class: 'btn btn-secundario btn-pequeno', type: 'submit', text: 'Ver período' }),
  ]);
  if (r?.erro) return el('section', {}, [el('h2', { text: 'Indicadores' }), f, el('p', { class: 'alerta alerta-info', text: r.erro })]);
  const cl = r.clientes;
  return el('section', { dataset: { indicadores: '' } }, [
    el('h2', { text: 'Indicadores', style: 'margin-top:0' }), f,
    el('div', { class: 'grade-indicadores' }, [
      cartao('Solicitações', String(r.solicitacoes.total), Object.entries(r.solicitacoes.porEstado).map(([k, v]) => `${ROTULOS_PEDIDO[k] || k}: ${v}`).join(' · ')),
      cartao('Recusa', `${String(r.recusa.taxa).replace('.', ',')}%`, `${r.recusa.total} recusada(s)`),
      cartao('Tempo até confirmar', r.horasAteConfirmar === null ? '—' : `${String(r.horasAteConfirmar).replace('.', ',')} h`, 'da solicitação à disponibilidade'),
      cartao('Faturamento previsto', formatarBRL(r.faturamento.previstoCentavos), 'cobranças com vencimento no período'),
      cartao('Recebido', formatarBRL(r.faturamento.recebidoCentavos), 'confirmado no período'),
      cartao('Pagamentos vencidos', String(r.pagamentosVencidos.n), formatarBRL(r.pagamentosVencidos.centavos)),
      cartao('Clientes', `${cl.novos} novas · ${cl.recorrentes} recorrentes`, 'com solicitação no período'),
      cartao('Ticket médio', formatarBRL(r.ticketMedioCentavos), 'por solicitação'),
      cartao('Diárias', String(r.diarias.total), 'no período, sem as canceladas'),
    ]),
    el('div', { class: 'grade-indicadores' }, [
      el('div', { class: 'cartao' }, [el('h3', { text: 'Diárias por serviço' }), lista(r.diarias.porServico, SERVICO)]),
      el('div', { class: 'cartao' }, [el('h3', { text: 'Por carga horária' }), lista(r.diarias.porCarga)]),
      el('div', { class: 'cartao' }, [el('h3', { text: 'Por cidade' }), lista(r.diarias.porRegiao)]),
      el('div', { class: 'cartao' }, [el('h3', { text: 'Motivos de recusa' }), lista(Object.fromEntries(r.recusa.motivos.map((m) => [m.motivo, m.n])))]),
      el('div', { class: 'cartao' }, [el('h3', { text: `Pesquisa (${r.pesquisa.respostas})` }), lista(r.pesquisa.porCriterio),
        r.pesquisa.porProfissional.length ? el('p', { class: 'mudo', text: `Por profissional (interno): ${r.pesquisa.porProfissional.map((p) => `${p.nome.split(' ')[0]} ${String(p.media).replace('.', ',')} (${p.n})`).join(' · ')}` }) : null]),
      el('div', { class: 'cartao' }, [el('h3', { text: 'Ocorrências' }), lista(r.ocorrencias, (k) => OCORRENCIA[k] || k)]),
    ]),
  ]);
}

function blocoBusca() {
  const termo = el('input', { type: 'search', id: 'busca-global', minlength: 3, maxlength: 120, placeholder: 'Nome, CPF, telefone ou e-mail', 'aria-label': 'Buscar cliente ou profissional' });
  const res = el('div', { role: 'status', 'aria-live': 'polite' });
  const b = el('button', { class: 'btn btn-primary btn-pequeno', type: 'submit', text: 'Buscar' });
  const f = el('form', { class: 'opcoes busca-global', role: 'search' }, [termo, b]);
  f.addEventListener('submit', (ev) => {
    ev.preventDefault();
    executarAcao(b, () => api.buscar(termo.value), {
      aoSucesso: (itens) => trocar(res, itens.length ? el('ul', { class: 'lista' }, itens.map((x) => el('li', { dataset: { resultado: x.id } }, [
        el('div', { class: 'topo' }, [el('strong', { text: x.nome }), selo(x.tipo === 'cliente' ? 'cliente' : 'profissional', '')]),
        el('p', { class: 'mudo', style: 'margin:4px 0 0', text: [x.documento, x.telefone, x.email, x.cidade].filter(Boolean).join(' · ') }),
        x.tipo === 'cliente' ? el('a', { class: 'btn-link', href: url('painel/', { aba: 'notificacoes', sub: 'linha', clienteId: x.id }), text: 'Mensagens desta cliente' }) : null,
      ]))) : el('p', { class: 'mudo', text: 'Nada encontrado.' })),
      aoErro: (e) => trocar(res, el('p', { class: 'alerta alerta-info', text: mensagemErro(e) })),
    });
  });
  return el('section', { style: 'margin-bottom:24px' }, [el('h2', { text: 'Buscar', style: 'margin-top:0' }), el('p', { class: 'mudo', text: 'O resultado vem com CPF e contato mascarados, e cada busca fica registrada.' }), f, res]);
}

function blocoSaude(s) {
  if (s?.erro) return el('section', {}, [el('h2', { text: 'Saúde do sistema' }), el('p', { class: 'alerta alerta-info', text: s.erro })]);
  const w = s.worker;
  return el('section', { style: 'margin-top:28px', dataset: { saude: '' } }, [
    el('h2', { text: 'Saúde do sistema' }),
    el('div', { class: 'grade-indicadores' }, [
      el('div', { class: 'cartao indicador' }, [el('span', { class: 'mudo', text: 'Automações' }), selo(!w.motorLigado ? 'motor desligado' : w.parado ? 'worker parado' : 'funcionando', !w.motorLigado || w.parado ? 'erro' : 'ok'),
        el('span', { class: 'mudo', text: w.ultimoCiclo ? `último ciclo ${formatarInstante(w.ultimoCiclo)}` : 'sem ciclo registrado' })]),
      cartao('Fila atrasada', String(Number(s.filaAtrasada.eventos) + Number(s.filaAtrasada.execucoes)), 'eventos e mensagens com mais de 10 min'),
      cartao('Falhas de envio (24 h)', String(s.falhas24h)),
      cartao('Erros (24 h)', String(s.erros24h)),
      cartao('Último backup', s.ultimoBackup ? formatarInstante(s.ultimoBackup) : 'nenhum registrado'),
    ]),
    el('h3', { text: 'Funil dos últimos 30 dias' }),
    el('p', { class: 'mudo', text: FUNIL.map(([k, t]) => `${t}: ${s.funil[k] || 0}`).join(' · ') }),
    el('h3', { text: 'Erros agrupados' }),
    s.erros.length ? el('div', { class: 'tabela-wrap' }, [el('table', { class: 'painel' }, [
      el('thead', {}, [el('tr', {}, ['Onde', 'Erro', 'Vezes', 'Último'].map((h) => el('th', { text: h })))]),
      el('tbody', {}, s.erros.map((e) => el('tr', { dataset: { erro: e.assinatura } }, [el('td', { text: `${e.origem}${e.pagina ? ` ${e.pagina}` : ''}` }), el('td', { text: e.mensagem }), el('td', { text: String(e.contagem) }), el('td', { text: formatarInstante(e.ultimoEm) })]))),
    ])]) : el('p', { class: 'mudo', text: 'Nenhum erro registrado.' }),
  ]);
}
