// AUT: motor de automações v2. O MESMO código roda no worker (Postgres) e no mock/fake-api (repositório em memória ou
// IndexedDB): o IO fica numa "porta" (portaPg em supabase/functions/_shared/porta-pg.js, portaRepo em ./porta-repo.js).
//
// Pipeline (AUT.1): evento (outbox) -> planejarEvento -> execução agendada -> prepararEnvio (transação 1: trava, revalida,
// janela, consentimento, limite, renderiza, grava mensagem 'enviando') -> provedor (fora da transação) -> concluirEnvio
// (transação 2: resultado, retentativa ou próximo canal). Lembretes com data (véspera, prazo, check-in, documento,
// relacionamento) vêm da varredura da AGENDA sobre o estado atual (remarcação = marco novo; ciclo perdido é recuperado
// sem repetir, porque a chave é única).
//
// Chave de idempotência: regra:entidade_tipo:entidade_id:marco. Execução já enviada/falha/ignorada nunca reabre.
import { dataNoFuso } from '../../domain/calendario.js';
import { ajustarJanela, agendar, instanteDoEvento, instantesDaAgenda, proximaTentativa, BACKOFF_MINUTOS, somarMinutos } from './tempo.js';
import { variaveisDe, renderizar, mascararTelefone } from './variaveis.js';

export const ESTADOS_FINAIS = ['enviada', 'entregue', 'lida', 'falhou', 'cancelada', 'ignorada'];
const ESPECIFICIDADE = ['pagamentoId', 'atendimentoId', 'pedidoId', 'diaristaId', 'clienteId'];
const MINUTOS_INCERTO = 10;

// ---------------------------------------------------------------- condições (planejamento E envio)
/** Motivo pelo qual a condição NÃO vale (null = vale). `exec.contexto` guarda o que foi agendado. */
export function condicaoFalha(regra, ctx, exec) {
  const k = regra.condicoes || {};
  const x = exec?.contexto || {};
  if (ctx.cliente?.anonimizadoEm) return 'titular excluiu os dados';
  if (k.pedidoStatus && !k.pedidoStatus.includes(ctx.pedido?.status)) return `pedido ${ctx.pedido?.status || 'ausente'}`;
  if (k.atendimentoStatus && !k.atendimentoStatus.includes(ctx.atendimento?.status)) return `diária ${ctx.atendimento?.status || 'ausente'}`;
  if (k.pagamentoStatus && !k.pagamentoStatus.includes(ctx.pagamento?.status)) return `cobrança ${ctx.pagamento?.status || 'ausente'}`;
  if (k.mesmaData && (ctx.atendimento?.data !== x.data || ctx.atendimento?.turno !== x.turno)) return 'diária mudou de data';
  if (k.mesmoPrazo && (ctx.pagamento?.venceEm !== x.venceEm || (ctx.pagamento?.venceAs || '14:00') !== (x.venceAs || '14:00'))) return 'prazo mudou';
  if (k.mesmaProfissional && (ctx.atendimento?.diaristaId || null) !== (x.diaristaId || null)) return 'profissional mudou';
  if (k.semAvaliacao && ctx.avaliacao) return 'pesquisa já respondida';
  if (k.temCobranca && !(ctx.pagamentos || []).length) return 'sem cobrança';
  if (k.temProfissional && !ctx.atendimento?.diaristaId) return 'sem profissional';
  return null;
}

// ---------------------------------------------------------------- destinatários
const OQUE_D08 = { atendimento_cancelado: 'foi cancelada', pedido_cancelado: 'foi cancelada', atendimento_reagendado: 'foi remarcada', atendimento_atribuido: 'passou para outra profissional' };
const pessoa = (tipo, p) => ({ tipo, id: p.id, nome: p.nome, telefone: p.telefone || null, email: p.email || null });

/** [{ destinatario, ctx, sufixo }] pra uma regra e um contexto. */
export async function destinatarios(porta, regra, ctx) {
  const ev = ctx.evento;
  switch (regra.destinatario) {
    case 'cliente': return ctx.cliente ? [{ destinatario: pessoa('cliente', ctx.cliente), ctx }] : [];
    case 'diarista': return ctx.diarista ? [{ destinatario: pessoa('diarista', ctx.diarista), ctx }] : [];
    case 'equipe_prime': return [{ destinatario: { tipo: 'equipe', id: 'equipe', nome: 'Equipe Prime' }, ctx }];
    case 'diaristas_afetadas': {
      const oque = OQUE_D08[ev?.tipo];
      if (!oque) return [];
      if (ev.tipo === 'atendimento_atribuido') {
        const ant = ev.dados?.anterior && await porta.diarista(ev.dados.anterior);
        return ant ? [{ destinatario: pessoa('diarista', ant), ctx: { ...ctx, diarista: ant, dados: { ...ctx.dados, oque } }, sufixo: ant.id }] : [];
      }
      if (ev.tipo === 'pedido_cancelado') {
        const out = [];
        for (const id of ev.dados?.atendimentosCancelados || []) {
          const at = (ctx.atendimentos || []).find((x) => x.id === id);
          const d = at?.diaristaId && await porta.diarista(at.diaristaId);
          if (d) out.push({ destinatario: pessoa('diarista', d), ctx: { ...ctx, atendimento: at, diarista: d, dados: { ...ctx.dados, oque } }, sufixo: `${at.id}:${d.id}` });
        }
        return out;
      }
      return ctx.diarista ? [{ destinatario: pessoa('diarista', ctx.diarista), ctx: { ...ctx, dados: { ...ctx.dados, oque } }, sufixo: ctx.diarista.id }] : [];
    }
    default: return [];
  }
}

const titularDe = (d) => (d.tipo === 'cliente' || d.tipo === 'diarista' ? { tipo: d.tipo, id: d.id } : null);
function entidadeId(regra, ctx, refs) {
  switch (regra.entidade) {
    case 'pedido': return ctx.pedido?.id || refs.pedidoId;
    case 'atendimento': return ctx.atendimento?.id || refs.atendimentoId;
    case 'pagamento': return ctx.pagamento?.id || refs.pagamentoId;
    case 'diarista': return ctx.diarista?.id || refs.diaristaId;
    case 'cliente': return ctx.cliente?.id || refs.clienteId;
    case 'documento': return ctx.documento?.id;
    case 'execucao': return refs.execucaoId;
    case 'conversa': return refs.conversaId;
    case 'dia': return ctx.data;
    default: return null;
  }
}
/** Tudo que o envio precisa pra revalidar e recarregar (nada de dado pessoal: só ids e o que foi agendado). */
function contextoDaExecucao(ctx, refs, extra = {}) {
  const a = ctx.atendimento; const g = ctx.pagamento;
  return {
    pedidoId: ctx.pedido?.id || refs.pedidoId || null, atendimentoId: a?.id || refs.atendimentoId || null,
    pagamentoId: g?.id || refs.pagamentoId || null, diaristaId: a?.diaristaId ?? ctx.diarista?.id ?? refs.diaristaId ?? null,
    clienteId: ctx.cliente?.id || refs.clienteId || null, documentoId: ctx.documento?.id || null,
    data: a?.data || null, turno: a?.turno || null, venceEm: g?.venceEm || null, venceAs: g?.venceAs || null,
    eventoId: ctx.evento?.id || null, eventoTipo: ctx.evento?.tipo || null, dados: ctx.dados || {}, dia: ctx.data || null, ...extra,
  };
}

function novaExecucao({ regra, ctx, refs, destinatario, sufixo, marco, em, validaAte, agoraISO, extra }) {
  const ent = entidadeId(regra, ctx, refs);
  if (!ent) return null;
  const m = sufixo ? `${marco}:${sufixo}` : marco;
  return {
    regra: regra.codigo, template: regra.template, regraVersao: regra.versao || 1, entidadeTipo: regra.entidade, entidadeId: String(ent), marco: m,
    chave: `${regra.codigo}:${regra.entidade}:${ent}:${m}`, destinatario: { tipo: destinatario.tipo, id: destinatario.id },
    titular: titularDe(destinatario), categoria: regra.categoria, agendadaPara: em, validaAte, estado: 'agendada', motivo: null,
    tentativas: 0, canalIdx: 0, contexto: contextoDaExecucao(ctx, refs, extra), teste: false, criadoEm: agoraISO, atualizadoEm: agoraISO,
  };
}

// ---------------------------------------------------------------- planejamento
/** O evento cancela execuções agendadas: só as da mesma entidade, pela referência mais específica em comum. */
export function execucaoCasaComEvento(exec, refs) {
  for (const k of ESPECIFICIDADE) {
    if (refs[k] && exec.contexto?.[k]) return String(refs[k]) === String(exec.contexto[k]);
  }
  return false;
}

/**
 * Planeja um evento (dentro de UMA transação de quem chama). Devolve contagens.
 * @param {object} porta
 * @param {{id,tipo,refs,dados,criadoEm}} evento
 */
export async function planejarEvento(porta, evento, { agoraISO }) {
  const cfg = await porta.config();
  const regras = await porta.regras();
  const feriados = await porta.feriados();
  const r = { criadas: 0, canceladas: 0 };
  // 1) cancelamentos
  const quemCancela = regras.filter((g) => (g.cancelamento || []).includes(evento.tipo)).map((g) => g.codigo);
  if (quemCancela.length) {
    for (const ex of await porta.agendadasDasRegras(quemCancela, evento.refs || {})) {
      if (!execucaoCasaComEvento(ex, evento.refs || {})) continue;
      await porta.atualizarExecucao(ex.id, { estado: 'cancelada', motivo: `cancelada por ${evento.tipo}`, atualizadoEm: agoraISO });
      r.canceladas++;
    }
  }
  // 2) execuções novas das regras ligadas que escutam o evento
  const escutam = regras.filter((g) => g.ligada && g.gatilho?.tipo === 'evento' && g.gatilho.eventos.includes(evento.tipo));
  if (!escutam.length) return r;
  const ctx = { ...(await porta.contexto(evento.refs || {})), evento, dados: evento.dados || {} };
  for (const regra of escutam) {
    if (condicaoFalha(regra, ctx, { contexto: contextoDaExecucao(ctx, evento.refs || {}) })) continue;
    const { em, validaAte } = instanteDoEvento(regra, evento.criadoEm);
    const doDia = regra.doDia && ctx.atendimento?.data === dataNoFuso(em, cfg.fuso);
    const quando = agendar({ em, validaAte }, regra, cfg, feriados, { doDia });
    if (!quando) continue;
    const marco = regra.marco === 'unico' ? 'unico' : regra.marco === 'designacao' ? `designacao:${ctx.atendimento?.diaristaId}` : evento.id;
    for (const { destinatario, ctx: c, sufixo } of await destinatarios(porta, regra, ctx)) {
      const extra = evento.dados?.canal ? { somenteCanal: evento.dados.canal } : {};
      const exec = novaExecucao({ regra, ctx: c, refs: evento.refs || {}, destinatario, sufixo, marco, em: quando, validaAte, agoraISO, extra });
      if (exec && (await porta.criarExecucao(exec)) === 'criada') r.criadas++;
    }
  }
  return r;
}

/**
 * Varredura da agenda (dentro de uma transação). Cria o que vence de hoje até `diasAFrente` e recupera o que passou e
 * ainda vale (worker parado). Idempotente pela chave.
 */
export async function varrerAgenda(porta, { agoraISO, diasAFrente = 2 }) {
  const cfg = await porta.config();
  const regras = (await porta.regras()).filter((g) => g.ligada && g.gatilho?.tipo === 'agenda');
  const feriados = await porta.feriados();
  const hoje = dataNoFuso(agoraISO, cfg.fuso);
  const r = { criadas: 0, avaliadas: 0 };
  for (const regra of regras) {
    for (const cand of await porta.candidatos(regra, { hoje, diasAFrente, agoraISO })) {
      const ctx = { ...cand, dados: cand.dados || {} };
      for (const inst of instantesDaAgenda(regra.atraso, { ...cand, data: cand.data || hoje }, cfg)) {
        r.avaliadas++;
        if (Date.parse(inst.validaAte) < Date.parse(agoraISO)) continue; // já passou da validade: não recupera
        const doDia = regra.doDia && ctx.atendimento?.data === dataNoFuso(inst.em, cfg.fuso);
        const quando = agendar(inst, regra, cfg, feriados, { doDia });
        if (!quando) continue;
        const exContexto = { contexto: contextoDaExecucao(ctx, cand.refs || {}) };
        if (condicaoFalha(regra, ctx, exContexto)) continue;
        for (const { destinatario, ctx: c, sufixo } of await destinatarios(porta, regra, ctx)) {
          const exec = novaExecucao({ regra, ctx: c, refs: cand.refs || {}, destinatario, sufixo, marco: inst.marco, em: quando, validaAte: inst.validaAte, agoraISO });
          if (exec && (await porta.criarExecucao(exec)) === 'criada') r.criadas++;
        }
      }
    }
  }
  return r;
}

// ---------------------------------------------------------------- envio (duas fases)
function canalDisponivel(canal, dest, amb) {
  if (canal === 'painel') return true;
  if (canal === 'whatsapp') return !!dest.telefone;
  if (canal === 'email') return !!dest.email && amb.emailHabilitado;
  return false;
}

/**
 * Transação 1: com a execução TRAVADA (porta.pegarVencida faz FOR UPDATE SKIP LOCKED). Decide e grava.
 * Devolve { acao: 'enviar', mensagem, canal, destino, conteudo, assunto } ou { acao: 'nada', estado, motivo }.
 */
export async function prepararEnvio(porta, exec, { agoraISO, ambiente }) {
  const cfg = await porta.config();
  const feriados = await porta.feriados();
  const regra = (await porta.regras()).find((g) => g.codigo === exec.regra);
  const fim = async (estado, motivo, extra = {}) => {
    await porta.atualizarExecucao(exec.id, { estado, motivo, atualizadoEm: agoraISO, ...extra });
    if (estado === 'falhou') await emitirFalha(porta, exec, regra, motivo);
    return { acao: 'nada', estado, motivo };
  };
  if (!regra) return fim('cancelada', 'regra não existe mais');
  if (!regra.ligada && !exec.teste) return fim('cancelada', 'regra desligada');
  if (Date.parse(agoraISO) > Date.parse(exec.validaAte)) return fim('cancelada', 'obsoleta: passou da validade');

  const ctx = { ...(await porta.contexto(exec.contexto || {})), dados: exec.contexto?.dados || {} };
  // resumos da equipe: números calculados na hora do envio (não no agendamento), pra sair atualizado
  if (regra.entidade === 'dia') ctx.resumo = await porta.resumo(regra.atraso.tipo, exec.contexto?.dia);
  if (!exec.teste) {
    const falha = condicaoFalha(regra, ctx, exec);
    if (falha) return fim('cancelada', `condição não vale mais: ${falha}`);
  }
  // janela (silêncio, domingo, feriado) de novo no envio: reenvio e "enviar agora" também passam por aqui
  const doDia = regra.doDia && ctx.atendimento?.data === dataNoFuso(agoraISO, cfg.fuso);
  const permitido = ajustarJanela(agoraISO, { categoria: regra.categoria, doDia }, cfg, feriados);
  if (!exec.teste && Date.parse(permitido) > Date.parse(agoraISO)) { // modo teste (contato fictício do painel) sai na hora
    if (Date.parse(permitido) > Date.parse(exec.validaAte)) return fim('cancelada', 'obsoleta: a próxima janela de envio passa da validade');
    await porta.atualizarExecucao(exec.id, { agendadaPara: permitido, motivo: 'fora do horário permitido: reagendada', atualizadoEm: agoraISO });
    return { acao: 'nada', estado: 'agendada', motivo: 'reagendada pela janela', agendadaPara: permitido };
  }

  const dest = exec.teste ? exec.contexto.destinoTeste : await porta.destinatario(exec.destinatario);
  if (!dest) return fim('cancelada', 'destinatário não existe mais');
  const amb = { emailHabilitado: !!ambiente?.emailHabilitado };
  const canais = exec.contexto?.somenteCanal ? regra.canais.filter((c) => c === exec.contexto.somenteCanal) : regra.canais;
  let idx = exec.canalIdx || 0;
  let canal = null;
  const pulados = [];
  for (; idx < canais.length; idx++) {
    const c = canais[idx];
    if (!canalDisponivel(c, dest, amb)) { pulados.push(`${c}: indisponível`); continue; }
    if (regra.categoria === 'marketing') {
      if (c === 'painel') continue;
      // consentimento relido a cada tentativa e canal, sob a mesma trava do definir_consentimento
      if (!(await porta.consentimento(exec.titular, `marketing_${c}`))) { pulados.push(`${c}: sem consentimento`); continue; }
    }
    canal = c; break;
  }
  if (!canal) {
    if (regra.categoria === 'marketing') return fim('ignorada', `sem consentimento ou canal (${pulados.join('; ') || 'nenhum canal'})`);
    return fim('falhou', `nenhum canal disponível (${pulados.join('; ')})`);
  }
  // limite diário (reserva atômica; uma vez por execução)
  const max = cfg.limites?.[regra.categoria];
  if (max !== undefined && exec.destinatario.tipo === 'cliente' && !exec.contexto?.limiteReservado && !exec.teste) {
    const dia = dataNoFuso(agoraISO, cfg.fuso);
    if (!(await porta.reservarLimite(exec.titular, regra.categoria, dia, max))) return fim('ignorada', `limite diário de ${regra.categoria} (${max}) atingido`);
    exec.contexto = { ...exec.contexto, limiteReservado: dia };
  }
  // renderização (variável obrigatória vazia = falhou, nunca manda placeholder)
  const tpl = await porta.template(regra.template, canal === 'painel' && regra.destinatario !== 'equipe_prime' ? 'whatsapp' : canal);
  if (!tpl) return fim('falhou', `template ${regra.template}/${canal} inexistente ou inativo`);
  let conteudo; let vars;
  try {
    vars = exec.teste ? exec.contexto.variaveisTeste : variaveisDe(regra.template, ctx, { urlSite: cfg.urlSite, diaEnvio: dataNoFuso(agoraISO, cfg.fuso), destinatario: dest });
    conteudo = renderizar(tpl.corpo, vars);
  } catch (e) { return fim('falhou', e.message); }
  if (canal === 'painel' && regra.destinatario !== 'equipe_prime') {
    conteudo = `Enviar manualmente para ${dest.nome || 'a pessoa'} (${mascararTelefone(dest.telefone) || 'sem telefone'}): ${conteudo}`;
  }
  const destino = canal === 'whatsapp' ? dest.telefone : canal === 'email' ? dest.email : 'painel';
  const mensagem = await porta.criarMensagem({
    execucaoId: exec.id, canal, destino, conteudo, assunto: tpl.assunto || null, templateCodigo: regra.template, templateVersao: tpl.versao,
    estado: 'enviando', criadoEm: agoraISO, atualizadoEm: agoraISO,
  });
  await porta.atualizarExecucao(exec.id, { estado: 'enviando', canalIdx: idx, contexto: exec.contexto, atualizadoEm: agoraISO, motivo: pulados.length ? pulados.join('; ') : null });
  // corpo e variáveis vão junto: o WhatsApp oficial manda o template aprovado com os parâmetros, não o texto pronto
  return { acao: 'enviar', mensagem, canal, destino, conteudo, assunto: tpl.assunto || null, template: regra.template, templateVersao: tpl.versao, corpo: tpl.corpo, variaveis: vars };
}

/**
 * Transação 2: resultado do provedor. resultado: { ok:true, status:'enviada'|'simulada', idExterno, provedor }
 * | { ok:false, retentavel:boolean, erro:{codigo,mensagem}, provedor }.
 */
export async function concluirEnvio(porta, exec, preparo, resultado, { agoraISO }) {
  const regra = (await porta.regras()).find((g) => g.codigo === exec.regra);
  if (resultado.ok) {
    await porta.atualizarMensagem(preparo.mensagem.id, { estado: resultado.status, provedor: resultado.provedor, idExterno: resultado.idExterno || null, atualizadoEm: agoraISO });
    await porta.atualizarExecucao(exec.id, { estado: 'enviada', atualizadoEm: agoraISO });
    return 'enviada';
  }
  await porta.atualizarMensagem(preparo.mensagem.id, { estado: 'falhou', provedor: resultado.provedor, erro: resultado.erro, atualizadoEm: agoraISO });
  const tentativas = (exec.tentativas || 0) + 1;
  if (resultado.retentavel && tentativas <= BACKOFF_MINUTOS.length) {
    await porta.atualizarExecucao(exec.id, { estado: 'agendada', tentativas, agendadaPara: proximaTentativa(agoraISO, tentativas), motivo: `falha transitória (${resultado.erro?.mensagem || 'erro'}); tentativa ${tentativas + 1}`, atualizadoEm: agoraISO });
    return 'retentativa';
  }
  const canais = exec.contexto?.somenteCanal ? [exec.contexto.somenteCanal] : (regra?.canais || []);
  if ((exec.canalIdx || 0) + 1 < canais.length) {
    await porta.atualizarExecucao(exec.id, { estado: 'agendada', tentativas: 0, canalIdx: (exec.canalIdx || 0) + 1, agendadaPara: agoraISO, motivo: `${preparo.canal} falhou (${resultado.erro?.mensagem || 'erro'}): próximo canal`, atualizadoEm: agoraISO });
    return 'proximo_canal';
  }
  const motivo = `falhou em todos os canais (${resultado.erro?.mensagem || 'erro'})`;
  await porta.atualizarExecucao(exec.id, { estado: 'falhou', motivo, atualizadoEm: agoraISO });
  await emitirFalha(porta, exec, regra, motivo);
  return 'falhou';
}

async function emitirFalha(porta, exec, regra, motivo) {
  if (!regra || regra.codigo === 'I08' || exec.teste) return; // aviso de falha que falhou não gera outro (sem laço)
  const dest = exec.destinatario?.tipo === 'equipe' ? null : await porta.destinatario(exec.destinatario).catch(() => null);
  await porta.emitirEvento('envio_falhou', { execucaoId: exec.id, clienteId: exec.contexto?.clienteId || null },
    { regra: `${regra.codigo} ${regra.descricao}`, cliente: String(dest?.nome || '').trim() || 'pessoa sem nome no cadastro', telefoneMascarado: mascararTelefone(dest?.telefone) || 'sem telefone', erro: String(motivo).slice(0, 200) });
}

/** "enviando" parado há mais de 10 min: o provedor pode ter aceitado. NÃO reenvia: falhou com motivo e avisa a equipe. */
export async function reconciliar(porta, { agoraISO }) {
  const limite = somarMinutos(agoraISO, -MINUTOS_INCERTO);
  let n = 0;
  for (const exec of await porta.enviandoAntesDe(limite)) {
    const regra = (await porta.regras()).find((g) => g.codigo === exec.regra);
    const motivo = 'resultado incerto (o envio parou no meio): não reenviado automaticamente; confira com a pessoa';
    await porta.atualizarExecucao(exec.id, { estado: 'falhou', motivo, atualizadoEm: agoraISO });
    await porta.marcarMensagensIncertas(exec.id, agoraISO);
    await emitirFalha(porta, exec, regra, motivo);
    n++;
  }
  return n;
}

// ---------------------------------------------------------------- tique
/**
 * Um ciclo completo. `porta.transacao(fn)` abre uma transação e entrega uma porta presa a ela.
 * provedores: { whatsapp, email, painel } com enviar(mensagem) -> resultado (ver concluirEnvio).
 */
export async function tique({ porta, provedores, agoraISO, ambiente, escopo = null, limite = 200, prazo = Infinity, agenda = true, reconciliar: fazReconciliar = true }) {
  const r = { eventos: 0, criadas: 0, canceladas: 0, agenda: 0, enviadas: 0, retentativas: 0, falhas: 0, outras: 0, incertas: 0, falhasEvento: 0 };
  if (!(await porta.transacao((p) => p.motorLigado()))) return { ...r, desligado: true };
  // 1) eventos, um por transação, em ordem
  for (let i = 0; i < limite && Date.now() < prazo; i++) {
    const feito = await porta.processarProximoEvento((p, ev) => planejarEvento(p, ev, { agoraISO: ev.criadoEm > agoraISO ? ev.criadoEm : agoraISO }), { agoraISO });
    if (!feito) break;
    if (feito.erro) { r.falhasEvento++; continue; }
    r.eventos++; r.criadas += feito.criadas; r.canceladas += feito.canceladas;
  }
  // 2) agenda
  if (agenda) r.agenda = (await porta.transacao((p) => varrerAgenda(p, { agoraISO }))).criadas;
  // 3) envio
  for (let i = 0; i < limite && Date.now() < prazo; i++) {
    const preparo = await porta.transacao(async (p) => {
      const exec = await p.pegarVencida(agoraISO, escopo);
      if (!exec) return null;
      return { exec, ...(await prepararEnvio(p, exec, { agoraISO, ambiente })) };
    });
    if (!preparo) break;
    if (preparo.acao !== 'enviar') { r.outras++; continue; }
    let resultado;
    try { resultado = await provedores[preparo.canal].enviar(preparo); } catch (e) { resultado = { ok: false, retentavel: true, erro: { codigo: 'EXCECAO', mensagem: String(e?.message || e).slice(0, 200) }, provedor: provedores[preparo.canal]?.nome }; }
    const fim = await porta.transacao((p) => concluirEnvio(p, preparo.exec, preparo, resultado, { agoraISO }));
    if (fim === 'enviada') r.enviadas++; else if (fim === 'retentativa' || fim === 'proximo_canal') r.retentativas++; else r.falhas++;
  }
  // 4) reconciliação
  if (fazReconciliar) r.incertas = await porta.transacao((p) => reconciliar(p, { agoraISO }));
  return r;
}
