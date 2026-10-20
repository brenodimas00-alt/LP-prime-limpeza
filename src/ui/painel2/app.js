// Painel v2 (spec-painel-v2, etapa B): entrada do painel/. Roteia por ?tela= (início, solicitações, agenda, clientes,
// profissionais, financeiro, gestão) e aceita os links antigos ?aba=: a aba vira a seção dentro da tela nova, com o mesmo
// conteúdo e as mesmas ações (nada some). As telas redesenhadas substituem as seções antigas entrega a entrega.
import { el, trocar, param } from '../dom.js';
import { url, ADAPTER } from '../../config/app.js';
import { adapterAtual } from '../../services/api.js';
import { exigirPapel } from '../../services/auth.js';
import { dataNoFuso } from '../../domain/calendario.js';
import { CONFIG_PRECOS as CFG } from '../../config/precos.js';
import { renderLegado, abasDisponiveis } from '../paginas/painel-legado.js';
import { montarCasca, TELAS, GESTAO } from './casca.js';
import { telaInicio } from './inicio.js';
import * as T from './telas.js';

const REAL = ADAPTER === 'supabase';

/** Aba antiga -> [tela, seção da gestão]. */
export const MAPA_ABAS = {
  solicitacoes: ['solicitacoes'], agenda: ['agenda'], atribuir: ['agenda'], pagamentos: ['financeiro'],
  clientes: ['clientes'], prospeccao: ['clientes'], ocorrencias: ['clientes'], relacionamento: ['clientes'], privacidade: ['clientes'],
  cadastros: ['profissionais'], avaliacoes: ['profissionais'],
  visao: ['gestao', 'indicadores'], notificacoes: ['gestao', 'automacoes'], config: ['gestao', 'configuracoes'], precos: ['gestao', 'configuracoes'], ajuda: ['gestao', 'ajuda'],
};

/** Seções de cada tela, na ordem em que aparecem: [chave, rótulo, seção nova?]. Sem função = aba antiga reaproveitada. */
const SECOES = {
  solicitacoes: [['lista', 'Solicitações', T.secaoSolicitacoes], ['solicitacoes', 'Ajustar horários antes de aprovar']],
  agenda: [['agenda', 'Agenda'], ['escala', 'Escala do dia', T.secaoEscala], ['atribuir', 'Designar profissional']],
  clientes: [['clientes', 'Clientes'], ['prospeccao', 'Cadastros sem solicitação'], ['ocorrencias', 'Ocorrências'], ['relacionamento', 'Relacionamento'], ['privacidade', 'Pedidos de dados (LGPD)']],
  profissionais: [['equipe', 'Equipe', T.secaoEquipe], ['cadastros', 'Cadastros e documentos'], ['avaliacoes', 'Avaliações']],
  financeiro: [['pagamentos', 'Pagamentos'], ['adiantamentos', 'Adiantamentos e reembolsos', T.secaoAdiantamentos]],
  'gestao:indicadores': [['visao', 'Indicadores']],
  'gestao:automacoes': [['notificacoes', 'Automações']],
  'gestao:configuracoes': [['config', 'Configurações'], ['motivos', 'Motivos e meta', T.secaoMotivosMeta], ['precos', 'Preços e horários']],
  'gestao:ajuda': [['ajuda', 'Ajuda']],
};
const PROPOSITO = {
  solicitacoes: 'Confira e responda as solicitações que chegaram pelo site.',
  agenda: 'Diárias por profissional, remarcações e quem ainda está sem profissional.',
  clientes: 'Busque a cliente, veja a ficha e quem se cadastrou sem pedir.',
  profissionais: 'Cadastros pra analisar, documentos, disponibilidade e avaliações.',
  financeiro: 'Pagamentos pra conferir, vencidos, horas extras e recibos.',
  'gestao:indicadores': 'Números do período, busca e saúde do sistema.',
  'gestao:automacoes': 'Mensagens automáticas: o que sai, quando e pra quem.',
  'gestao:configuracoes': 'Preços, horários, cupons, feriados, faixas de CEP e regras do sistema.',
  'gestao:ajuda': 'Passo a passo das tarefas do dia.',
};

const sessao = exigirPapel('prime', url('painel/entrar/'));
if (sessao?.trocaSenha) location.replace(url('painel/entrar/')); // A0: senha temporária ainda não trocada

function rota() {
  let tela = param('tela'); let sec = param('sec'); const aba = param('aba');
  if (!TELAS[tela] && aba && MAPA_ABAS[aba]) { [tela, sec] = MAPA_ABAS[aba]; }
  if (!TELAS[tela]) tela = 'inicio';
  if (tela === 'gestao' && !GESTAO.some(([k]) => k === sec)) sec = 'indicadores';
  if (tela !== 'gestao') sec = null;
  return { tela, sec, aba };
}

async function iniciar() {
  if (!sessao || sessao.trocaSenha) return;
  const { tela, sec, aba } = rota();
  const ad = await adapterAtual().catch(() => null);
  const hoje = dataNoFuso((ad?.relogio ? ad.relogio.agora() : new Date()).toISOString(), CFG.regrasNotificacao.fuso);
  const casca = montarCasca({ tela, sec, sessao, hoje });
  document.title = `${tela === 'gestao' ? (GESTAO.find(([k]) => k === sec)?.[1] || 'Gestão') : TELAS[tela].rotulo} | Painel da Prime`;
  const ctx = { sessao, hoje, casca, real: REAL };
  if (tela === 'inicio') { await telaInicio(ctx); return; }
  await telaComSecoes(tela === 'gestao' ? `gestao:${sec}` : tela, aba, ctx);
}

/** Tela com seções: as novas (função) e as antigas reaproveitadas (renderLegado), com as mesmas ações de antes. */
async function telaComSecoes(chave, aba, ctx) {
  const { sessao: s, casca } = ctx;
  const disp = new Set(abasDisponiveis());
  const secoes = (SECOES[chave] || []).filter(([k, , novo]) => novo || disp.has(k));
  const titulo = chave.startsWith('gestao:') ? GESTAO.find(([k]) => `gestao:${k}` === chave)[1] : TELAS[chave].rotulo;
  const atual = secoes.some(([k]) => k === aba) ? aba : secoes[0]?.[0];
  const alvo = el('div', { class: 'p-secao-legada' });
  const [tela, sec] = chave.split(':');
  const abas = secoes.length > 1 ? el('nav', { class: 'abas', 'aria-label': 'Seções' }, secoes.map(([k, r]) => el('a', {
    href: url('painel/', { tela, ...(sec ? { sec } : {}), aba: k }), 'aria-current': k === atual ? 'page' : null, text: r,
  }))) : null;
  const semReal = !secoes.length ? el('p', { class: 'p-vazio', text: 'Esta parte do painel só existe com o backend real (homologação ou produção).' }) : null;
  trocar(casca.conteudo,
    el('div', { class: 'p-cabecalho' }, [el('div', {}, [el('h1', { text: titulo }), PROPOSITO[chave] ? el('p', { text: PROPOSITO[chave] }) : null])]),
    abas, semReal, alvo);
  // ficha da cliente (busca do topo, Novos cadastros, alertas): ?cliente=id
  if (tela === 'clientes' && param('cliente')) { await T.fichaCliente(alvo, param('cliente'), ctx); return; }
  const novo = secoes.find(([k]) => k === atual)?.[2];
  if (novo) await novo(alvo, ctx);
  else if (atual) await renderLegado(atual, alvo, { sessao: s });
}

iniciar();
