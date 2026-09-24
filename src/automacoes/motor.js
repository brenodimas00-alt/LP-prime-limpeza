// Motor de automações: consome a fila de eventos, cria notificações (gatilhos.js) e "envia" as vencidas.
// Roda no adapter mock e dentro do fake-api (que faz o papel do backend). No modo http o front NÃO roda o motor.
import { GATILHOS, cancelamentosDoEvento, calcularEnvio, aindaValida } from './gatilhos.js';
import { montarVariaveis, renderizar } from './mensagens.js';
import { dataNoFuso } from '../domain/calendario.js';

const TODOS = null;
const ordemEvento = (a, b) => a.criadoEm.localeCompare(b.criadoEm) || (a.seq || 0) - (b.seq || 0);

/**
 * @param {{repo, relogio, gerarId:()=>string, cfg:object, urlSite:string, canal:{simular:(n:object)=>object}}} deps
 */
export function criarMotor({ repo, relogio, gerarId, cfg, urlSite, canal }) {
  let ordem = 0;

  async function contexto(tx, ev) {
    const r = ev.refs || {};
    const atendimento = r.atendimentoId ? await tx.get('atendimentos', r.atendimentoId) : null;
    const pedidoId = r.pedidoId || atendimento?.pedidoId;
    const pedido = pedidoId ? await tx.get('pedidos', pedidoId) : null;
    const cliente = pedido ? await tx.get('clientes', pedido.clienteId) : null;
    const atendimentos = pedido ? (await tx.por('atendimentos', 'pedidoId', pedido.id)).sort((a, b) => a.sequencia - b.sequencia) : [];
    const diaristaId = r.diaristaId || atendimento?.diaristaId;
    const diarista = diaristaId ? await tx.get('diaristas', diaristaId) : null;
    let pagamento = r.pagamentoId ? await tx.get('pagamentos', r.pagamentoId) : null;
    if (!pagamento && atendimento) pagamento = (await tx.por('pagamentos', 'atendimentoId', atendimento.id)).find((p) => p.parcela === 'diaria' && p.status !== 'cancelado') || null;
    // cobranças citadas pelo evento (disponibilidade confirmada), na ordem de vencimento
    const pagamentos = [];
    for (const id of ev.dados?.pagamentos || []) { const g = await tx.get('pagamentos', id); if (g) pagamentos.push(g); }
    pagamentos.sort((a, b) => (a.venceEm || '').localeCompare(b.venceEm || ''));
    return { evento: ev, atendimento, pedido, cliente, atendimentos, diarista, pagamento, pagamentos, urlSite };
  }

  const dest = (tipo, p) => ({ tipo, id: p.id, telefone: p.telefone });

  /** Expande o destinatário do gatilho em [{destinatario, ctx}] (pode ser mais de um, ex.: diaristas dos cancelados). */
  async function alvos(tx, tipo, ctx) {
    if (tipo === 'cliente') return ctx.cliente ? [{ d: dest('cliente', ctx.cliente), ctx }] : [];
    if (tipo === 'diarista') return ctx.diarista ? [{ d: dest('diarista', ctx.diarista), ctx }] : [];
    if (tipo === 'diarista_anterior') {
      const ant = ctx.evento.dados?.anterior && (await tx.get('diaristas', ctx.evento.dados.anterior));
      return ant ? [{ d: dest('diarista', ant), ctx: { ...ctx, diarista: ant } }] : [];
    }
    if (tipo === 'diaristas_dos_cancelados') {
      const out = [];
      for (const id of ctx.evento.dados?.atendimentosCancelados || []) {
        const at = ctx.atendimentos.find((x) => x.id === id);
        const d = at?.diaristaId && (await tx.get('diaristas', at.diaristaId));
        if (d) out.push({ d: dest('diarista', d), ctx: { ...ctx, atendimento: at, diarista: d } });
      }
      return out;
    }
    return [];
  }

  /** Consome todos os eventos pendentes numa transação. */
  async function processarEventos() {
    return repo.transacao(TODOS, async (tx) => {
      const pendentes = (await tx.por('eventos', 'status', 'pendente')).sort(ordemEvento);
      let criadas = 0;
      let canceladas = 0;
      for (const ev of pendentes) {
        // 1) cancela agendadas afetadas
        const regras = cancelamentosDoEvento(ev);
        if (regras.length) {
          for (const n of await tx.por('notificacoes', 'status', 'pendente')) {
            const casa = regras.some((rg) => n.refs?.atendimentoId === rg.atendimentoId
              && (!rg.templates || rg.templates.includes(n.template))
              && (!rg.exceto || n.destinatario.id !== rg.exceto.diaristaId));
            if (casa) { await tx.put('notificacoes', { ...n, status: 'cancelada', motivo: `cancelada por ${ev.tipo}` }); canceladas++; }
          }
        }
        // 2) cria as novas
        const ctx = await contexto(tx, ev);
        for (const g of GATILHOS[ev.tipo] || []) {
          if (g.se && !g.se(ctx)) continue;
          for (const { d, ctx: c } of await alvos(tx, g.destinatario, ctx)) {
            const agendadaPara = calcularEnvio(g.quando, { eventoEm: ev.criadoEm, dataAtendimento: c.atendimento?.data, pagamento: c.pagamento, regras: cfg.regrasNotificacao, mesmoDia: !!g.mesmoDia });
            if (!agendadaPara) continue;
            const chaveIdempotencia = `${ev.id}:${g.template}:${d.tipo}:${d.id}:${c.atendimento?.id || '-'}`;
            if ((await tx.por('notificacoes', 'chaveIdempotencia', chaveIdempotencia)).length) continue;
            const diaEnvio = dataNoFuso(agendadaPara, cfg.regrasNotificacao.fuso);
            const variaveis = montarVariaveis(g.template, { ...c, diaEnvio });
            await tx.put('notificacoes', {
              id: gerarId(), gatilho: ev.tipo, canal: 'whatsapp', destinatario: d, template: g.template, variaveis,
              agendadaPara, status: 'pendente', chaveIdempotencia, criadoEm: ev.criadoEm, ordem: ++ordem,
              refs: {
                pedidoId: c.pedido?.id, atendimentoId: c.atendimento?.id, diaristaId: c.diarista?.id, pagamentoId: c.pagamento?.id,
                data: c.atendimento?.data, turno: c.atendimento?.turno, versao: c.atendimento?.versao, diaEnvio,
                ...(g.template === 'lembrete_prazo_pagamento' ? { venceEm: c.pagamento?.venceEm } : {}),
              },
            });
            criadas++;
          }
        }
        await tx.put('eventos', { ...ev, status: 'processado', processadoEm: relogio.agora().toISOString() });
      }
      return { eventos: pendentes.length, criadas, canceladas };
    });
  }

  /** Envia (simula) as notificações pendentes cujo horário chegou. Revalida cada uma antes. */
  async function executarVencidas() {
    const agora = relogio.agora().toISOString();
    return repo.transacao(TODOS, async (tx) => {
      const vencidas = (await tx.por('notificacoes', 'status', 'pendente'))
        .filter((n) => n.agendadaPara <= agora)
        .sort((a, b) => a.agendadaPara.localeCompare(b.agendadaPara) || (a.ordem || 0) - (b.ordem || 0));
      let enviadas = 0;
      for (const n of vencidas) {
        const atendimento = n.refs?.atendimentoId ? await tx.get('atendimentos', n.refs.atendimentoId) : null;
        const pagamento = n.refs?.pagamentoId ? await tx.get('pagamentos', n.refs.pagamentoId) : null;
        if (!aindaValida(n, { atendimento, pagamento }, { agoraISO: agora, fuso: cfg.regrasNotificacao.fuso })) {
          await tx.put('notificacoes', { ...n, status: 'cancelada', motivo: 'obsoleta no horário do envio' });
          continue;
        }
        const previa = renderizar(n.template, n.variaveis);
        await tx.put('notificacoes', canal.simular({ ...n, previa }, agora));
        enviadas++;
      }
      return { enviadas };
    });
  }

  return {
    processarEventos,
    executarVencidas,
    /** Um "tique": processa a fila e envia o que venceu. */
    async tique() {
      const a = await processarEventos();
      const b = await executarVencidas();
      return { ...a, ...b };
    },
  };
}
