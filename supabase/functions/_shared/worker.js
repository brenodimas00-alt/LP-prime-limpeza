// B5: worker da fila de notificações. Roda o MESMO motor do mock (src/automacoes/motor.js) sobre o Postgres:
// 1) consome os eventos pendentes, um por transação (falha num evento não trava a fila; backoff e depois 'erro');
// 2) envia as notificações vencidas, uma por transação, pelo provedor do ambiente (provedores.js).
// JS puro: recebe `transacao(fn)`, em que fn recebe q(sql, params) -> linhas. Node (pg) nos testes, Deno (postgres.js) na function.
// Parâmetro jsonb vai como texto (`$n::text::jsonb`): o postgres.js serializa de novo o que é tipado jsonb e o pg não.
import { criarMotor } from '../../../src/automacoes/motor.js';
import { enviarNotificacao } from './provedores.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEITURA = {
  atendimentos: 'privado.j_atendimento(t)', pedidos: 'privado.j_pedido(t)', clientes: 'privado.j_cliente(t)', diaristas: 'privado.j_diarista(t)',
  pagamentos: 'privado.j_pagamento(t)', notificacoes: 'privado.j_notificacao(t)',
};
const COLUNAS = { pedidoId: 'pedido_id', atendimentoId: 'atendimento_id', status: 'status', chaveIdempotencia: 'chave_idempotencia' };
/** Espera depois da 1ª..4ª falha de um evento; na 5ª ele vai pra 'erro' (painel reprocessa). */
export const BACKOFF_EVENTO_MINUTOS = Object.freeze([1, 5, 15, 60]);
export const MAX_TENTATIVAS_EVENTO = BACKOFF_EVENTO_MINUTOS.length + 1;
const TRAVA_EVENTOS = 'prime-worker-eventos';

async function ler(q, tabela, id) {
  if (!LEITURA[tabela]) throw new Error(`tabela fora do worker: ${tabela}`);
  // id que não é UUID num evento é dado corrompido: falha o evento (vai pro backoff) em vez de sumir calado
  if (!UUID.test(String(id))) throw new Error(`id inválido em ${tabela}: ${String(id).slice(0, 40)}`);
  const [r] = await q(`select ${LEITURA[tabela]} as j from public.${tabela} t where t.id = $1::uuid`, [id]);
  return r?.j ?? null;
}

/** Repositório no formato que o motor espera (get/por/put), preso a uma transação. */
function txDoMotor(q, estado, agoraISO) {
  return {
    get: (tabela, id) => ler(q, tabela, id),
    async por(tabela, campo, valor) {
      if (tabela === 'eventos') {
        if (campo !== 'status' || valor !== 'pendente') throw new Error('worker só lê eventos pendentes');
        // UM evento por transação, o mais antigo liberado pelo backoff
        const rs = await q(`select privado.j_evento(t) as j from public.eventos t where t.status = 'pendente'
          and (t.tentar_apos is null or t.tentar_apos <= $1::timestamptz) order by t.seq limit 1 for update skip locked`, [agoraISO]);
        estado.evento = rs[0]?.j?.id ?? null;
        return rs.map((r) => r.j);
      }
      if (!LEITURA[tabela] || !COLUNAS[campo]) throw new Error(`consulta fora do worker: ${tabela}.${campo}`);
      return (await q(`select ${LEITURA[tabela]} as j from public.${tabela} t where t.${COLUNAS[campo]}::text = $1`, [String(valor)])).map((r) => r.j);
    },
    async put(tabela, o) {
      if (tabela === 'eventos') {
        await q(`update public.eventos set status = $2, processado_em = now(), erro = null, tentar_apos = null where id = $1::uuid`, [o.id, o.status]);
        return;
      }
      if (tabela !== 'notificacoes') throw new Error(`escrita fora do worker: ${tabela}`);
      // Nova, ou cancelamento de uma agendada. Nunca sobrescreve a que já saiu (o envio pode ter fechado antes).
      await q(`insert into public.notificacoes (id, gatilho, canal, destinatario, template, variaveis, agendada_para, status, refs, chave_idempotencia, motivo, criado_em)
        values ($1::uuid, $2, $3, $4::text::jsonb, $5, $6::text::jsonb, $7::timestamptz, $8, $9::text::jsonb, $10, $11, $12::timestamptz)
        on conflict (id) do update set status = excluded.status, motivo = excluded.motivo where public.notificacoes.status = 'pendente'`,
      [o.id, o.gatilho, o.canal, JSON.stringify(o.destinatario), o.template, JSON.stringify(o.variaveis || {}), o.agendadaPara, o.status,
        JSON.stringify(o.refs || {}), o.chaveIdempotencia, o.motivo ?? null, o.criadoEm]);
    },
  };
}

/**
 * @param {{transacao:(fn:(q:Function)=>Promise<any>)=>Promise<any>, urlSite:string, provedor:{nome:string, enviar:Function}, agora?:()=>Date}} deps
 */
export function criarWorker({ transacao, urlSite, provedor, agora = () => new Date() }) {
  async function configuracao(q) {
    const [r] = await q(`select tabela from public.precos where vigente_desde <= now() order by vigente_desde desc limit 1`);
    if (!r?.tabela?.regrasNotificacao) throw new Error('precos vigente sem regrasNotificacao');
    return r.tabela;
  }

  async function falhouEvento(id, erro, agoraISO) {
    await transacao(async (q) => {
      const [e] = await q('select tentativas from public.eventos where id = $1::uuid for update', [id]);
      if (!e) return;
      const t = e.tentativas + 1;
      const desiste = t >= MAX_TENTATIVAS_EVENTO;
      const apos = desiste ? null : new Date(Date.parse(agoraISO) + BACKOFF_EVENTO_MINUTOS[t - 1] * 60000).toISOString();
      await q(`update public.eventos set tentativas = $2, status = $3, erro = $4, tentar_apos = $5::timestamptz where id = $1::uuid`,
        [id, t, desiste ? 'erro' : 'pendente', String(erro?.message || erro).slice(0, 300), apos]);
    });
  }

  /** Consome eventos pendentes, um por transação, em ordem (trava única: dois workers não intercalam eventos). */
  async function processarEventos({ agoraISO, limite = 200, prazo = Infinity }) {
    const r = { eventos: 0, criadas: 0, canceladas: 0, falhas: 0 };
    for (let i = 0; i < limite && Date.now() < prazo; i++) {
      const estado = { evento: null };
      let feito;
      try {
        feito = await transacao(async (q) => {
          await q('select pg_advisory_xact_lock(hashtext($1))', [TRAVA_EVENTOS]);
          const cfg = await configuracao(q);
          const repo = { transacao: (_escopo, fn) => fn(txDoMotor(q, estado, agoraISO)) };
          const motor = criarMotor({ repo, relogio: { agora }, gerarId: () => crypto.randomUUID(), cfg, urlSite, canal: null });
          return motor.processarEventos();
        });
      } catch (e) {
        if (!estado.evento) throw e; // falha antes de pegar evento: problema do worker, não do dado
        await falhouEvento(estado.evento, e, agoraISO);
        r.falhas++;
        continue;
      }
      if (!feito.eventos) break;
      r.eventos += feito.eventos; r.criadas += feito.criadas; r.canceladas += feito.canceladas;
    }
    return r;
  }

  /**
   * Envia as notificações pendentes cujo horário chegou, uma por transação (trava a linha; outro worker pula).
   * `escopo` (lista de ids de pedido/diarista) restringe o envio: usado só pelo teste com relógio adiantado.
   */
  async function enviarVencidas({ agoraISO, escopo = null, limite = 200, prazo = Infinity }) {
    const r = { simuladas: 0, enviadas: 0, canceladas: 0, retentativas: 0, erros: 0 };
    const chave = { simulada: 'simuladas', enviada: 'enviadas', cancelada: 'canceladas', pendente: 'retentativas', erro: 'erros' };
    for (let i = 0; i < limite && Date.now() < prazo; i++) {
      const status = await transacao(async (q) => {
        const [linha] = await q(`select privado.j_notificacao(t) as j from public.notificacoes t
          where t.status = 'pendente' and t.agendada_para <= $1::timestamptz
            and ($2::text::jsonb is null or t.refs ->> 'pedidoId' in (select jsonb_array_elements_text($2::text::jsonb))
              or t.refs ->> 'diaristaId' in (select jsonb_array_elements_text($2::text::jsonb)))
          order by t.agendada_para, t.criado_em limit 1 for update skip locked`, [agoraISO, escopo ? JSON.stringify(escopo) : null]);
        if (!linha) return null;
        const n = linha.j;
        const cfg = await configuracao(q);
        const atual = {
          atendimento: n.refs?.atendimentoId ? await ler(q, 'atendimentos', n.refs.atendimentoId) : null,
          pagamento: n.refs?.pagamentoId ? await ler(q, 'pagamentos', n.refs.pagamentoId) : null,
        };
        const p = await enviarNotificacao(n, { atual, agoraISO, fuso: cfg.regrasNotificacao.fuso, provedor });
        await q(`update public.notificacoes set status = $2, previa = coalesce($3, previa), provedor = coalesce($4, provedor),
            wamid = coalesce($5, wamid), enviada_em = coalesce($6::timestamptz, enviada_em), erro = $7::text::jsonb,
            tentativas = coalesce($8, tentativas), agendada_para = coalesce($9::timestamptz, agendada_para), motivo = coalesce($10, motivo)
          where id = $1::uuid`,
        [n.id, p.status, p.previa ?? null, p.provedor ?? null, p.idExterno ?? null, p.enviadaEm ?? null, p.erro ? JSON.stringify(p.erro) : null,
          p.tentativas ?? null, p.agendadaPara ?? null, p.motivo ?? null]);
        return p.status;
      });
      if (!status) break;
      r[chave[status]]++;
    }
    return r;
  }

  return {
    processarEventos,
    enviarVencidas,
    /** Um tique: fila de eventos e depois envio. `agoraISO` só é diferente do relógio real no teste. */
    async tique({ agoraISO = agora().toISOString(), escopo = null, prazoMs = 45000 } = {}) {
      const prazo = Date.now() + prazoMs;
      const eventos = await processarEventos({ agoraISO, prazo });
      const envio = await enviarVencidas({ agoraISO, escopo, prazo });
      return { provedor: provedor.nome, agora: agoraISO, eventos, envio };
    },
  };
}
