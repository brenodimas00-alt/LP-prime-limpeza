// AUT: porta do motor v2 sobre o repositório do mock (IndexedDB) ou de memória (testes Node e fake-api).
// Regras e templates vêm do catálogo (no mock não se editam); o banco real (portaPg) lê das tabelas.
import { REGRAS, TEMPLATES } from '../catalogo.js';
import { somarDias, diferencaDias } from '../../domain/calendario.js';

const PADRAO_CFG = { silencioInicio: '20:00', silencioFim: '08:00', horaDiaUtil: '09:00', limites: { lembrete: 3, marketing: 1 } };
const ATIVOS = ['agendado', 'confirmado', 'diarista_a_caminho', 'em_andamento', 'finalizado', 'avaliado'];

/**
 * @param {{repo, cfg:object, urlSite:string, gerarId:()=>string, feriados?:string[], regras?:object[], consentimentos?:(titular,tipo)=>boolean, motorLigado?:boolean}} op
 */
export function criarPortaRepo({ repo, cfg, urlSite, gerarId, feriados, regras = REGRAS, consentimentos = () => false, motorLigado = true, agora = () => new Date() }) {
  const config = { ...PADRAO_CFG, fuso: cfg.regrasNotificacao?.fuso || 'America/Sao_Paulo', urlSite, ...(cfg.automacoes || {}) };
  const listaFeriados = feriados || cfg.feriados || [];
  const regrasAtivas = regras.map((r) => ({ versao: 1, ...structuredClone(r) }));

  function portaDaTx(tx) {
    const p = {
      config: async () => config,
      regras: async () => regrasAtivas,
      feriados: async () => listaFeriados,
      motorLigado: async () => motorLigado,
      template: async (codigo, canal) => {
        const t = TEMPLATES[codigo];
        if (!t) return null;
        const interno = t.categoriaMeta === null;
        if (interno !== (canal === 'painel')) return null;
        return { corpo: t.corpo, assunto: t.assunto || null, versao: 1 };
      },
      diarista: (id) => tx.get('diaristas', id),
      async destinatario(d) {
        if (d.tipo === 'equipe') return { tipo: 'equipe', id: 'equipe', nome: 'Equipe Prime' };
        const x = await tx.get(d.tipo === 'cliente' ? 'clientes' : 'diaristas', d.id);
        return x ? { tipo: d.tipo, id: x.id, nome: x.nome, telefone: x.telefone || null, email: x.email || null } : null;
      },
      async contexto(refs) {
        const atendimento = refs.atendimentoId ? await tx.get('atendimentos', refs.atendimentoId) : null;
        let pagamento = refs.pagamentoId ? await tx.get('pagamentos', refs.pagamentoId) : null;
        const pedidoId = refs.pedidoId || atendimento?.pedidoId || pagamento?.pedidoId;
        const pedido = pedidoId ? await tx.get('pedidos', pedidoId) : null;
        const cliente = pedido ? await tx.get('clientes', pedido.clienteId) : refs.clienteId ? await tx.get('clientes', refs.clienteId) : null;
        const atendimentos = pedido ? (await tx.por('atendimentos', 'pedidoId', pedido.id)).sort((a, b) => a.sequencia - b.sequencia) : [];
        const at = atendimento || (pagamento?.atendimentoId ? await tx.get('atendimentos', pagamento.atendimentoId) : null);
        const diaristaId = at?.diaristaId || refs.diaristaId;
        const diarista = diaristaId ? await tx.get('diaristas', diaristaId) : null;
        const pagamentos = pedido ? await tx.por('pagamentos', 'pedidoId', pedido.id) : [];
        if (!pagamento && at) pagamento = pagamentos.find((g) => g.atendimentoId === at.id && g.parcela === 'diaria' && g.status !== 'cancelado') || null;
        const avaliacao = at ? (await tx.por('avaliacoes', 'atendimentoId', at.id))[0] || null : null;
        return { pedido, cliente, atendimentos, atendimento: at, diarista, pagamento, pagamentos: pagamentos.filter((g) => g.status !== 'cancelado'), avaliacao };
      },
      resumo: (tipo, dia) => resumoDoDia(tx, dia, tipo),
      async agendadasDasRegras(codigos) {
        return (await tx.por('execucoes', 'estado', 'agendada')).filter((e) => codigos.includes(e.regra));
      },
      async criarExecucao(exec) {
        if ((await tx.por('execucoes', 'chave', exec.chave)).length) return 'existente';
        await tx.put('execucoes', { id: gerarId(), ...exec });
        return 'criada';
      },
      async atualizarExecucao(id, patch) { const e = await tx.get('execucoes', id); if (e) await tx.put('execucoes', { ...e, ...patch }); },
      async pegarVencida(agoraISO, escopo) {
        const v = (await tx.por('execucoes', 'estado', 'agendada'))
          .filter((e) => e.agendadaPara <= agoraISO && (!escopo || escopo.includes(e.contexto?.pedidoId) || escopo.includes(e.contexto?.diaristaId)))
          .sort((a, b) => a.agendadaPara.localeCompare(b.agendadaPara) || a.criadoEm.localeCompare(b.criadoEm));
        return v[0] || null;
      },
      consentimento: async (titular, tipo) => !!consentimentos(titular, tipo),
      async reservarLimite(titular, categoria, dia, max) {
        const chave = `${titular.tipo}:${titular.id}:${categoria}:${dia}`;
        const l = (await tx.get('limites', chave)) || { chave, usados: 0 };
        if (l.usados >= max) return false;
        await tx.put('limites', { ...l, usados: l.usados + 1 });
        return true;
      },
      async criarMensagem(m) { const x = { id: gerarId(), ...m }; await tx.put('mensagens', x); return x; },
      async atualizarMensagem(id, patch) { const m = await tx.get('mensagens', id); if (m) await tx.put('mensagens', { ...m, ...patch }); },
      async marcarMensagensIncertas(execId, agoraISO) {
        for (const m of await tx.por('mensagens', 'execucaoId', execId)) if (m.estado === 'enviando') await tx.put('mensagens', { ...m, estado: 'falhou', erro: { codigo: 'INCERTO', mensagem: 'resultado incerto' }, atualizadoEm: agoraISO });
      },
      async emitirEvento(tipo, refs, dados) {
        await tx.put('eventos', { id: gerarId(), tipo, refs, dados, status: 'pendente', criadoEm: agora().toISOString(), seq: Date.now() });
      },
      async enviandoAntesDe(limiteISO) { return (await tx.por('execucoes', 'estado', 'enviando')).filter((e) => e.atualizadoEm < limiteISO); },
      async candidatos(regra, { hoje, diasAFrente }) {
        const t = regra.atraso.tipo;
        if (['vespera', 'apos_inicio_turno'].includes(t)) {
          const ate = t === 'vespera' ? somarDias(hoje, diasAFrente) : hoje;
          const ats = (await tx.todos('atendimentos')).filter((a) => a.data >= hoje && a.data <= ate && a.status === 'confirmado');
          const out = [];
          for (const a of ats) out.push({ ...(await p.contexto({ atendimentoId: a.id })), refs: { atendimentoId: a.id, pedidoId: a.pedidoId, diaristaId: a.diaristaId } });
          return out;
        }
        if (['antes_prazo', 'prazo_vencido'].includes(t)) {
          const gs = (await tx.todos('pagamentos')).filter((g) => g.status === 'pendente' && g.venceEm && g.venceEm >= somarDias(hoje, -1) && g.venceEm <= somarDias(hoje, diasAFrente + 1));
          const out = [];
          for (const g of gs) out.push({ ...(await p.contexto({ pagamentoId: g.id })), refs: { pagamentoId: g.id, pedidoId: g.pedidoId, atendimentoId: g.atendimentoId } });
          return out;
        }
        if (['diario', 'semanal'].includes(t)) return [{ data: hoje }];
        if (t === 'aniversario') {
          return (await tx.todos('clientes')).filter((c) => c.dataNascimento && c.dataNascimento.slice(5) === hoje.slice(5) && !c.anonimizadoEm)
            .map((c) => ({ cliente: c, data: hoje, refs: { clienteId: c.id } }));
        }
        if (t === 'mensal') {
          if (Number(hoje.slice(8)) !== regra.atraso.dia) return [];
          const out = [];
          for (const pd of await tx.todos('pedidos')) {
            if (pd.pacote?.frequencia === 'avulso' || ['cancelado', 'recusado', 'solicitado'].includes(pd.status)) continue;
            const ats = await tx.por('atendimentos', 'pedidoId', pd.id);
            if (!ats.some((a) => a.data.slice(0, 7) === hoje.slice(0, 7) && ATIVOS.includes(a.status))) continue;
            out.push({ pedido: pd, cliente: await tx.get('clientes', pd.clienteId), data: hoje, refs: { clienteId: pd.clienteId, pedidoId: pd.id } });
          }
          return out;
        }
        if (t === 'inatividade') {
          const ultima = new Map();
          const futura = new Set();
          for (const a of await tx.todos('atendimentos')) {
            const pd = await tx.get('pedidos', a.pedidoId);
            if (!pd) continue;
            if (['finalizado', 'avaliado'].includes(a.status) && (!ultima.get(pd.clienteId) || a.data > ultima.get(pd.clienteId))) ultima.set(pd.clienteId, a.data);
            if (a.data >= hoje && a.status !== 'cancelado') futura.add(pd.clienteId);
          }
          const out = [];
          for (const [clienteId, d] of ultima) {
            if (futura.has(clienteId) || diferencaDias(d, hoje) < regra.atraso.dias) continue;
            const recentes = (await tx.todos('execucoes')).filter((e) => e.regra === regra.codigo && e.titular?.id === clienteId && e.estado === 'enviada' && diferencaDias(e.agendadaPara.slice(0, 10), hoje) < regra.atraso.intervaloDias);
            if (recentes.length) continue;
            out.push({ cliente: await tx.get('clientes', clienteId), data: hoje, ultimaDiaria: d, refs: { clienteId } });
          }
          return out;
        }
        return []; // antes_vencimento_documento: validade de documento chega no bloco 3 (P5)
      },
      async processarProximoEvento(fn) {
        const ev = (await tx.por('eventos', 'status', 'pendente')).sort((a, b) => a.criadoEm.localeCompare(b.criadoEm) || (a.seq || 0) - (b.seq || 0))[0];
        if (!ev) return null;
        const r = await fn(p, ev);
        await tx.put('eventos', { ...ev, status: 'processado', processadoEm: agora().toISOString() });
        return r;
      },
    };
    return p;
  }

  return {
    async transacao(fn) { return repo.transacao(null, (tx) => fn(portaDaTx(tx))); },
    async motorLigado() { return motorLigado; },
    /** Um evento por transação (o mock é um processo só; a ordem da fila vale). */
    async processarProximoEvento(fn) {
      try { return await repo.transacao(null, (tx) => portaDaTx(tx).processarProximoEvento(fn)); } catch (e) { return { erro: e }; }
    },
  };
}

async function resumoDoDia(tx, hoje, tipo) {
  const ats = await tx.todos('atendimentos');
  const gs = await tx.todos('pagamentos');
  if (tipo === 'diario') {
    const doDia = ats.filter((a) => a.data === hoje && a.status !== 'cancelado');
    return { diarias: String(doDia.length), checkins: String(doDia.filter((a) => a.status === 'confirmado').length), pendencias: String(gs.filter((g) => g.status === 'pendente').length), ocorrencias: '0' };
  }
  const ini = somarDias(hoje, -7);
  const peds = await tx.todos('pedidos');
  return {
    semana: `${ini.slice(8)}/${ini.slice(5, 7)} a ${somarDias(hoje, -1).slice(8)}/${somarDias(hoje, -1).slice(5, 7)}`,
    solicitacoes: String(peds.filter((x) => (x.criadoEm || '').slice(0, 10) >= ini && (x.criadoEm || '').slice(0, 10) < hoje).length),
    recusas: String(peds.filter((x) => x.status === 'recusado' && (x.recusa?.em || '').slice(0, 10) >= ini).length),
    diarias: String(ats.filter((a) => a.data >= ini && a.data < hoje && ['finalizado', 'avaliado'].includes(a.status)).length),
    recebido: `R$ ${(gs.filter((g) => g.status === 'confirmado' && (g.confirmadoEm || '').slice(0, 10) >= ini).reduce((s, g) => s + g.valorCentavos, 0) / 100).toFixed(2).replace('.', ',')}`,
  };
}
