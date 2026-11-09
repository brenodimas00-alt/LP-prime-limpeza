// Agenda e Escala (spec-agenda-escala-isa, 09/11/2026): a escala de cada diária. PURO: sem storage, sem relógio, sem
// mensagem. O banco (migration 20261109100000_agenda_escala.sql) repete estas regras em SQL; testa-escala confere as duas.
//
// A escala é uma dimensão da diária SEPARADA do atendimento.status (que continua sendo o do pagamento e da execução:
// "confirmado" lá exige pagamento; aqui "confirmada" é o aceite da profissional). Pagamento pendente não bloqueia nada
// da escala (seção 7). A coluna única Status da tela junta as duas em statusDaDiaria().
import { ErroNegocio } from './modelo.js';
import { paraMinutos, horaInicioDe } from './horario.js';
import { instanteLocal } from './calendario.js';

export const ESTADOS_ESCALA = ['para_revisar', 'revisada', 'aguardando_envio', 'enviada', 'aguardando_aceite', 'confirmada'];
/** Ordem de avanço: retorno do provedor (enviada, entregue) nunca faz a diária voltar. */
const ORDEM = { para_revisar: 0, revisada: 1, aguardando_envio: 2, enviada: 3, aguardando_aceite: 4, confirmada: 5 };

/**
 * Transições da escala. `ator`: prime (equipe), sistema (motor, webhook, rotina). A recusa e a alteração relevante
 * voltam pra "para_revisar" (a equipe confere de novo); nada aqui troca a profissional sozinho.
 */
export const TRANSICOES_ESCALA = {
  revisar: { de: ['para_revisar'], para: 'revisada', atores: ['prime'] },
  enviar: { de: ['revisada', 'aguardando_envio'], para: 'aguardando_envio', atores: ['prime'] }, // de aguardando_envio só depois de falha
  saiu: { de: ['aguardando_envio'], para: 'enviada', atores: ['sistema'] },
  entregue: { de: ['aguardando_envio', 'enviada'], para: 'aguardando_aceite', atores: ['sistema'] },
  aceitar: { de: ['aguardando_envio', 'enviada', 'aguardando_aceite'], para: 'confirmada', atores: ['sistema', 'prime'] },
  recusar: { de: ['aguardando_envio', 'enviada', 'aguardando_aceite', 'confirmada'], para: 'para_revisar', atores: ['sistema', 'prime'] },
  alterar: { de: ESTADOS_ESCALA, para: 'para_revisar', atores: ['prime', 'sistema'] },
};

/** Avanço vindo do provedor: true se deve aplicar (nunca regride, nunca repete). */
export const avancaEscala = (atual, para) => (ORDEM[para] ?? -1) > (ORDEM[atual] ?? -1);

/**
 * Aplica um evento da escala. PURA.
 * @param {{escalaEstado:string, diaristaId?:string, escalaEnvio?:object}} d diária
 * @param {string} evento
 * @param {{ator:string, envioFalhou?:boolean}} ctx
 * @returns {string} estado novo
 */
export function transicionarEscala(d, evento, { ator, envioFalhou = false } = {}) {
  const t = TRANSICOES_ESCALA[evento];
  if (!t) throw new ErroNegocio('EVENTO_INVALIDO', `Evento desconhecido: ${evento}`);
  const de = d.escalaEstado || 'para_revisar';
  if (!t.atores.includes(ator)) throw new ErroNegocio('ATOR_SEM_PERMISSAO', `"${ator}" não pode "${evento}"`);
  if (['saiu', 'entregue'].includes(evento) && !avancaEscala(de, t.para)) return de; // retorno atrasado ou repetido do provedor
  if (!t.de.includes(de)) throw new ErroNegocio('TRANSICAO_PROIBIDA', `Não é possível "${evento}" com a diária "${ROTULO_STATUS[de]}"`);
  if (evento === 'revisar' && !d.diaristaId) throw new ErroNegocio('CONDICAO_NAO_ATENDIDA', 'Selecione a profissional antes de revisar');
  if (evento === 'enviar' && !d.diaristaId) throw new ErroNegocio('CONDICAO_NAO_ATENDIDA', 'Diária sem profissional');
  if (evento === 'enviar' && de === 'aguardando_envio' && !envioFalhou) throw new ErroNegocio('TRANSICAO_PROIBIDA', 'Esta diária já foi enviada');
  return t.para;
}

/** Elegível pro "Enviar todas as revisadas" e "Enviar selecionadas": revisada, com profissional, diária não cancelada. */
export const elegivelEnvio = (d) => d.escalaEstado === 'revisada' && !!d.diaristaId && d.status !== 'cancelado';

/** Chave de idempotência do envio: uma mensagem por diária, versão da designação e profissional. */
export const chaveEnvio = (d) => `${d.id}:${d.escalaVersao || 0}:${d.diaristaId}`;

/** Campos cuja mudança invalida a revisão (seção 5: "modificação relevante"). */
export const CAMPOS_RELEVANTES = ['diaristaId', 'data', 'horaInicio', 'duracaoMinutos', 'endereco', 'servico'];
export function alteracaoRelevante(antes, depois) {
  return CAMPOS_RELEVANTES.some((k) => JSON.stringify(antes?.[k] ?? null) !== JSON.stringify(depois?.[k] ?? null));
}

// ---------------------------------------------------------------- coluna única Status
export const ROTULO_STATUS = {
  para_revisar: 'Para revisar', revisada: 'Revisada', aguardando_envio: 'Aguardando envio', enviada: 'Enviada', aguardando_aceite: 'Aguardando aceite',
  confirmada: 'Confirmada', em_andamento: 'Em andamento', finalizada: 'Finalizada', cancelada: 'Cancelada', com_ocorrencia: 'Com ocorrência',
};
/** Ordem do filtro "Situação do atendimento" (seção 14). */
export const FILTRO_STATUS = ['para_revisar', 'revisada', 'aguardando_envio', 'aguardando_aceite', 'confirmada', 'em_andamento', 'finalizada', 'cancelada', 'com_ocorrencia'];

const instante = (data, hora) => instanteLocal(data, ...hora.split(':').map(Number));
/** [início, fim] da diária em ms. */
export function janelaDaDiaria(d) {
  const hi = horaInicioDe(d) || '08:00';
  const ini = Date.parse(instante(d.data, hi));
  return [ini, ini + (d.duracaoMinutos || 240) * 60000];
}

/**
 * Status único da diária. PURA.
 * - Cancelada > Com ocorrência > Finalizada > Em andamento > estado da escala.
 * - Em andamento "programado": aceita e dentro do horário; não afirma que a profissional chegou (seção 12).
 * - Finalizada por horário: aceita e depois do fim, sem conclusão confirmada; fica marcada como tal.
 * @returns {{codigo:string, rotulo:string, porHorario?:boolean}}
 */
export function statusDaDiaria(d, { agoraMs, ocorrenciaAberta = false } = {}) {
  const r = (codigo, extra = {}) => ({ codigo, rotulo: ROTULO_STATUS[codigo], ...extra });
  if (d.status === 'cancelado') return r('cancelada');
  if (ocorrenciaAberta) return r('com_ocorrencia');
  if (['finalizado', 'avaliado'].includes(d.status)) return r('finalizada', { porHorario: false });
  if (['em_andamento', 'diarista_a_caminho'].includes(d.status)) return r('em_andamento', { porHorario: false });
  const esc = d.escalaEstado || 'para_revisar';
  if (esc === 'confirmada' && Number.isFinite(agoraMs) && d.data) {
    const [ini, fim] = janelaDaDiaria(d);
    if (agoraMs >= fim) return r('finalizada', { porHorario: true });
    if (agoraMs >= ini) return r('em_andamento', { porHorario: true });
  }
  return r(esc);
}

/** Botão de ação da linha conforme o estado (seção 15: só ações compatíveis). */
export function acaoDaLinha(d) {
  if (d.status === 'cancelado' || ['finalizado', 'avaliado', 'em_andamento', 'diarista_a_caminho'].includes(d.status)) return null;
  if (!d.diaristaId) return null;
  if ((d.escalaEstado || 'para_revisar') === 'para_revisar') return 'revisar';
  if (d.escalaEstado === 'revisada') return 'enviar';
  if (d.escalaEstado === 'aguardando_envio' && d.escalaEnvio?.falhou) return 'enviar';
  return null;
}

/** Sem resposta depois do prazo configurado (null = alerta desligado). Não é recusa: só sinaliza (seção 6.3). */
export function semRespostaNoPrazo(d, prazoMin, agoraMs) {
  if (!prazoMin || !['enviada', 'aguardando_aceite'].includes(d.escalaEstado) || !d.escalaEnvio?.enviadaEm) return false;
  return Date.parse(d.escalaEnvio.enviadaEm) + prazoMin * 60000 <= agoraMs;
}

// ---------------------------------------------------------------- pré-designação (seção 4.2)
/**
 * Critérios da seção 4.2 e se há dado no sistema pra usar. Os sem dado ficam fora da conta e aparecem no "por quê".
 * (Ver docs/DECISOES.md: Agenda e Escala.)
 */
export const CRITERIOS = [
  ['disponibilidade', 'Disponibilidade (dia da semana, turno, férias e folgas)', true],
  ['conflito', 'Conflito de horário com outra diária', true],
  ['regiao', 'Cidade e região de atendimento', true],
  ['habilidade', 'Tipo de serviço e habilidades', true],
  ['avaliacao', 'Avaliação média das clientes', true],
  ['pontualidade', 'Pontualidade (nota das avaliações)', true],
  ['ocorrencias', 'Ocorrências nos últimos 90 dias', true],
  ['historico', 'Atendimentos anteriores na mesma cliente', true],
  ['carga', 'Outras diárias no mesmo dia', true],
  ['deslocamento', 'Deslocamento entre endereços', false],
  ['imovel', 'Metragem, cômodos e animais x profissional', false],
  ['perfil', 'Perfil de trabalho (ágil, equilibrada, minuciosa)', false],
  ['preferencia', 'Preferência informada pela cliente', false],
];
export const CRITERIOS_SEM_DADO = CRITERIOS.filter((c) => !c[2]).map((c) => c[0]);

const cabeNoTurno = (turnos, iniMin, minutos) => {
  const t = new Set(turnos || []);
  return t.has('integral') || (t.has('manha') && t.has('tarde')) || (t.has('manha') && iniMin + minutos <= 13 * 60) || (t.has('tarde') && iniMin >= 12 * 60);
};
const cobreRegiao = (regioes, cidade) => (regioes || []).some((r) => r.toLowerCase() === String(cidade || '').toLowerCase()
  || (String(cidade || '').toLowerCase() === 'belo horizonte' && r.startsWith('BH - ')));
const dow = (data) => new Date(`${data}T12:00:00Z`).getUTCDay();

/**
 * Pontua uma candidata pra uma diária. PURA (o SQL privado.pontuar_candidata faz a mesma conta).
 * ctx: { outras: [{data,horaInicio,duracaoMinutos}] da profissional no dia (sem a própria), bloqueada: bool,
 *        mediaNota, mediaPontualidade, ocorrencias90, historicoCliente }
 * @returns {{impedida:boolean, pontos:number, motivos:string[]}}
 */
export function pontuarCandidata(diaria, prof, ctx = {}) {
  const motivos = []; let pontos = 0; let impedida = false;
  const ini = paraMinutos(horaInicioDe(diaria) || '08:00'); const dur = diaria.duracaoMinutos || 240;
  if (prof.status !== 'aprovada') return { impedida: true, pontos: 0, motivos: ['cadastro não aprovado'] };
  if (!(prof.disponibilidade?.dias || []).includes(dow(diaria.data))) { impedida = true; motivos.push('não trabalha nesse dia'); }
  if (!cabeNoTurno(prof.disponibilidade?.turnos, ini, dur)) { impedida = true; motivos.push('horário fora do turno dela'); }
  if (ctx.bloqueada) { impedida = true; motivos.push('férias ou folga'); }
  const cruza = (ctx.outras || []).some((o) => { const oi = paraMinutos(horaInicioDe(o) || '08:00'); return oi < ini + dur && ini < oi + (o.duracaoMinutos || 240); });
  if (cruza) { impedida = true; motivos.push('outra diária no mesmo horário'); }
  if (impedida) return { impedida, pontos: 0, motivos };
  motivos.push('disponível e sem conflito');
  if (cobreRegiao(prof.disponibilidade?.regioes, diaria.cidade)) { pontos += 30; motivos.push(`atende ${diaria.cidade}`); }
  if ((prof.habilidades || []).includes(diaria.servico)) { pontos += 25; motivos.push('tem a habilidade do serviço'); }
  if (ctx.mediaNota) { pontos += Math.round((ctx.mediaNota - 3) * 10); motivos.push(`avaliação ${String(ctx.mediaNota).replace('.', ',')}`); }
  if (ctx.mediaPontualidade) pontos += Math.round((ctx.mediaPontualidade - 3) * 5);
  if (ctx.historicoCliente) { pontos += Math.min(ctx.historicoCliente, 3) * 5; motivos.push(`já atendeu esta cliente ${ctx.historicoCliente}x`); }
  if (ctx.ocorrencias90) { pontos -= ctx.ocorrencias90 * 10; motivos.push(`${ctx.ocorrencias90} ocorrência(s) em 90 dias`); }
  if ((ctx.outras || []).length) { pontos -= ctx.outras.length * 5; motivos.push(`${ctx.outras.length} outra(s) diária(s) no dia`); }
  return { impedida: false, pontos, motivos };
}

/** Melhor candidata (maior pontuação; empate pelo nome). null se nenhuma livre. */
export function escolherSugerida(lista) {
  const livres = lista.filter((x) => !x.impedida);
  livres.sort((a, b) => b.pontos - a.pontos || String(a.nome).localeCompare(String(b.nome)) || String(a.id).localeCompare(String(b.id)));
  return livres[0] || null;
}

// ---------------------------------------------------------------- agrupamento por cidade (seção 2.1)
/** Região Metropolitana primeiro (Contagem, Betim e demais), Belo Horizonte depois; dentro: horário. */
export const CIDADES_RMBH_PRIMEIRO = ['Contagem', 'Betim'];
export function ordemCidade(cidade) {
  const c = String(cidade || '');
  const i = CIDADES_RMBH_PRIMEIRO.findIndex((x) => x.toLowerCase() === c.toLowerCase());
  if (i >= 0) return [0, i, c];
  if (c.toLowerCase() === 'belo horizonte') return [2, 0, c];
  return [1, 0, c];
}
export function agruparPorCidade(itens) {
  const g = new Map();
  for (const d of itens) { const c = d.local?.cidade || 'Sem cidade'; if (!g.has(c)) g.set(c, []); g.get(c).push(d); }
  const cmp = (a, b) => { const x = ordemCidade(a); const y = ordemCidade(b); return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2]); };
  return [...g.keys()].sort(cmp).map((cidade) => ({ cidade, itens: g.get(cidade).sort((a, b) => String(a.horaInicio).localeCompare(String(b.horaInicio))) }));
}

/** Configuração da Agenda e Escala: tudo que a cliente ainda não decidiu nasce desligado (seção 18, pontos em aberto). */
export const CONFIG_AGENDA_PADRAO = Object.freeze({
  prazoSemRespostaMin: null, // null = sem triângulo de alerta até a Prime definir o prazo
  verificacaoPagamento: { ligada: false, hora: null }, // só alerta; nunca cancela sozinho
  canalAtivo: 'whatsapp', // whatsapp | portal (troca manual, só administração)
});
