// AUT: porta do motor v2 sobre o Postgres (Edge Function "notificacoes" em Deno/postgres.js e testes em Node/pg).
// Recebe `transacao(fn)`, em que fn recebe q(sql, params) -> linhas. Parâmetro jsonb vai como texto ($n::text::jsonb):
// o postgres.js serializa de novo o que é tipado jsonb e o pg não. Cada envio trava a linha com FOR UPDATE SKIP LOCKED:
// dois workers nunca pegam a mesma execução. Eventos: um por transação, sob advisory lock (a ordem da fila vale).
import { formatarBRL } from '../../../src/domain/dinheiro.js';
import { somarDias as somar } from '../../../src/domain/calendario.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOuNulo = (x) => (x && UUID.test(String(x)) ? String(x) : null);
const TRAVA_EVENTOS = 'prime-worker-eventos';
export const BACKOFF_EVENTO_MINUTOS = Object.freeze([1, 5, 15, 60]);
export const MAX_TENTATIVAS_EVENTO = BACKOFF_EVENTO_MINUTOS.length + 1;

const iso = (d) => (d ? new Date(d).toISOString() : null);
function linhaExec(r) {
  return {
    id: r.id, regra: r.regra, template: r.template_codigo, regraVersao: r.regra_versao, entidadeTipo: r.entidade_tipo, entidadeId: r.entidade_id,
    marco: r.marco, chave: r.chave_idempotencia, destinatario: r.destinatario, titular: r.titular_tipo ? { tipo: r.titular_tipo, id: r.titular_id } : null,
    categoria: r.categoria, agendadaPara: iso(r.agendada_para), validaAte: iso(r.valida_ate), estado: r.estado, motivo: r.motivo,
    tentativas: r.tentativas, canalIdx: r.canal_idx, contexto: r.contexto || {}, teste: r.teste, criadoEm: iso(r.criado_em), atualizadoEm: iso(r.atualizado_em),
  };
}
function linhaRegra(r) {
  return {
    codigo: r.codigo, template: r.template_codigo, descricao: r.descricao, categoria: r.categoria, destinatario: r.destinatario, canais: r.canais_ordem,
    gatilho: r.gatilho, atraso: r.atraso, condicoes: r.condicoes || {}, cancelamento: r.cancelamento || [], entidade: r.entidade, marco: r.marco || undefined,
    doDia: r.do_dia, validadeMin: r.validade_min || undefined, ligada: r.ligada, versao: r.versao,
  };
}
const COLUNAS = { estado: 'estado', motivo: 'motivo', agendadaPara: 'agendada_para', validaAte: 'valida_ate', tentativas: 'tentativas', canalIdx: 'canal_idx', contexto: 'contexto', atualizadoEm: 'atualizado_em' };

/**
 * @param {{transacao:(fn:(q:Function)=>Promise<any>)=>Promise<any>, urlSite:string, fuso?:string}} op
 */
export function criarPortaPg({ transacao, urlSite, fuso = 'America/Sao_Paulo' }) {
  function portaDaTx(q) {
    let cacheRegras = null;
    const p = {
      async config() {
        const [r] = await q('select valor from public.automacao_config');
        return { ...r.valor, fuso, urlSite };
      },
      async regras() {
        cacheRegras ||= (await q('select * from public.automacao_regras order by codigo')).map(linhaRegra);
        return cacheRegras;
      },
      async feriados() { return (await q(`select to_char(data, 'YYYY-MM-DD') d from public.feriados`)).map((r) => r.d); },
      async motorLigado() { return (await q(`select privado.flag('automacoes_motor') ok`))[0].ok; },
      async template(codigo, canal) {
        const [t] = await q('select corpo, assunto, versao from public.templates where codigo = $1 and canal = $2 and ativo', [codigo, canal]);
        return t || null;
      },
      async diarista(id) {
        if (!uuidOuNulo(id)) return null;
        const [r] = await q('select privado.j_diarista(t) j from public.diaristas t where t.id = $1::uuid', [id]);
        return r?.j || null;
      },
      async destinatario(d) {
        if (d.tipo === 'equipe') return { tipo: 'equipe', id: 'equipe', nome: 'Equipe Prime' };
        if (!uuidOuNulo(d.id)) return null;
        const tab = d.tipo === 'cliente' ? 'clientes' : 'diaristas';
        const [r] = await q(`select id, nome, telefone, email from public.${tab} where id = $1::uuid`, [d.id]);
        return r ? { tipo: d.tipo, id: r.id, nome: r.nome, telefone: r.telefone || null, email: r.email || null } : null;
      },
      async contexto(refs) {
        const um = async (sqlTexto, id) => (uuidOuNulo(id) ? (await q(sqlTexto, [id]))[0]?.j || null : null);
        const atendimento = await um('select privado.j_atendimento(t) j from public.atendimentos t where t.id = $1::uuid', refs.atendimentoId);
        let pagamento = await um('select privado.j_pagamento(t) j from public.pagamentos t where t.id = $1::uuid', refs.pagamentoId);
        const pedidoId = refs.pedidoId || atendimento?.pedidoId || pagamento?.pedidoId;
        const pedido = await um(`select privado.j_pedido(t) || jsonb_strip_nulls(jsonb_build_object('recusa', t.recusa, 'preferenciaProfissional', t.preferencia_profissional)) j from public.pedidos t where t.id = $1::uuid`, pedidoId);
        const clienteId = pedido?.clienteId || refs.clienteId;
        const cliente = await um(`select privado.j_cliente(t) || jsonb_strip_nulls(jsonb_build_object('anonimizadoEm', t.anonimizado_em, 'dataNascimento', t.data_nascimento)) j from public.clientes t where t.id = $1::uuid`, clienteId);
        const atendimentos = pedido ? (await q('select privado.j_atendimento(t) j from public.atendimentos t where t.pedido_id = $1::uuid order by t.sequencia', [pedido.id])).map((r) => r.j) : [];
        const at = atendimento || (pagamento?.atendimentoId ? atendimentos.find((a) => a.id === pagamento.atendimentoId) || null : null);
        const diarista = await p.diarista(at?.diaristaId || refs.diaristaId);
        const pagamentos = pedido ? (await q(`select privado.j_pagamento(t) j from public.pagamentos t where t.pedido_id = $1::uuid and t.status <> 'cancelado' order by t.vence_em`, [pedido.id])).map((r) => r.j) : [];
        if (!pagamento && at) pagamento = pagamentos.find((g) => g.atendimentoId === at.id && g.parcela === 'diaria') || null;
        const avaliacao = at ? (await q('select id from public.avaliacoes where atendimento_id = $1::uuid', [at.id]))[0] || null : null;
        // P5: certidão (D07); substituída por uma mais nova ou excluída não conta mais
        const documento = uuidOuNulo(refs.documentoId) ? (await q(`select jsonb_build_object('id', d.id, 'nome', 'certidão de antecedentes', 'venceEm', to_char(d.valido_ate, 'YYYY-MM-DD'), 'diaristaId', d.diarista_id) j
            from public.documentos d where d.id = $1::uuid and d.excluido_em is null
             and not exists (select 1 from public.documentos n where n.diarista_id = d.diarista_id and n.tipo = d.tipo and n.excluido_em is null and n.criado_em > d.criado_em)`, [refs.documentoId]))[0]?.j || null : null;
        const dia = diarista || (documento ? await p.diarista(documento.diaristaId) : null);
        return { pedido, cliente, atendimentos, atendimento: at, diarista: dia, pagamento, pagamentos, avaliacao, documento };
      },
      async resumo(tipo, dia) {
        if (tipo === 'diario') {
          const [r] = await q(`select (select count(*) from public.atendimentos where data = $1::date and status <> 'cancelado')::text diarias,
              (select count(*) from public.atendimentos where data = $1::date and status = 'confirmado')::text checkins,
              (select count(*) from public.pagamentos where status = 'pendente')::text pendencias,
              (select count(*) from public.ocorrencias where estado <> 'resolvido')::text ocorrencias`, [dia]);
          return r;
        }
        const [r] = await q(`select to_char($1::date - 7, 'DD/MM') || ' a ' || to_char($1::date - 1, 'DD/MM') semana,
            (select count(*) from public.pedidos where (criado_em at time zone 'America/Sao_Paulo')::date between $1::date - 7 and $1::date - 1)::text solicitacoes,
            (select count(*) from public.pedidos where status = 'recusado' and (atualizado_em at time zone 'America/Sao_Paulo')::date between $1::date - 7 and $1::date - 1)::text recusas,
            (select count(*) from public.atendimentos where data between $1::date - 7 and $1::date - 1 and status in ('finalizado', 'avaliado'))::text diarias,
            coalesce((select sum(valor_centavos) from public.pagamentos where status = 'confirmado'
               and (confirmado_em at time zone 'America/Sao_Paulo')::date between $1::date - 7 and $1::date - 1), 0)::bigint recebido_centavos`, [dia]);
        const { recebido_centavos: centavos, ...resto } = r;
        return { ...resto, recebido: formatarBRL(Number(centavos)) };
      },
      async agendadasDasRegras(codigos, refs) {
        const ids = ['pedidoId', 'atendimentoId', 'pagamentoId', 'diaristaId', 'clienteId'].map((k) => (refs[k] ? String(refs[k]) : null));
        return (await q(`select * from public.automacao_execucoes where estado = 'agendada' and regra = any($1::text[])
          and (contexto ->> 'pedidoId' = $2 or contexto ->> 'atendimentoId' = $3 or contexto ->> 'pagamentoId' = $4 or contexto ->> 'diaristaId' = $5 or contexto ->> 'clienteId' = $6)
          for update`, [codigos, ...ids])).map(linhaExec);
      },
      async criarExecucao(e) {
        const r = await q(`insert into public.automacao_execucoes (regra, template_codigo, regra_versao, entidade_tipo, entidade_id, marco, chave_idempotencia, destinatario,
            titular_tipo, titular_id, categoria, agendada_para, valida_ate, estado, motivo, tentativas, canal_idx, contexto, teste, criado_em, atualizado_em)
          values ($1, $2, $3, $4, $5, $6, $7, $8::text::jsonb, $9, $10::uuid, $11, $12::timestamptz, $13::timestamptz, $14, $15, 0, 0, $16::text::jsonb, false, $17::timestamptz, $17::timestamptz)
          on conflict (chave_idempotencia) do nothing returning id`,
        [e.regra, e.template, e.regraVersao, e.entidadeTipo, e.entidadeId, e.marco, e.chave, JSON.stringify(e.destinatario), e.titular?.tipo || null, uuidOuNulo(e.titular?.id),
          e.categoria, e.agendadaPara, e.validaAte, e.estado, e.motivo, JSON.stringify(e.contexto || {}), e.criadoEm]);
        return r.length ? 'criada' : 'existente';
      },
      async atualizarExecucao(id, patch) {
        const sets = []; const vals = [id];
        for (const [k, col] of Object.entries(COLUNAS)) {
          if (!(k in patch)) continue;
          vals.push(k === 'contexto' ? JSON.stringify(patch[k]) : patch[k]);
          const tipo = k === 'contexto' ? '::text::jsonb' : ['agendadaPara', 'validaAte', 'atualizadoEm'].includes(k) ? '::timestamptz' : '';
          sets.push(`${col} = $${vals.length}${tipo}`);
        }
        if ('tentativas' in patch && 'agendadaPara' in patch) sets.push('proxima_tentativa = agendada_para');
        if (sets.length) await q(`update public.automacao_execucoes set ${sets.join(', ')} where id = $1::uuid`, vals);
      },
      async pegarVencida(agoraISO, escopo) {
        // tolerância de 5 s: o horário "na hora" vem do now() do banco e o worker pode estar um pouco atrás dele
        const [r] = await q(`select * from public.automacao_execucoes where estado = 'agendada' and agendada_para <= $1::timestamptz + interval '5 seconds'
            and ($2::text::jsonb is null or contexto ->> 'pedidoId' in (select jsonb_array_elements_text($2::text::jsonb))
                 or contexto ->> 'diaristaId' in (select jsonb_array_elements_text($2::text::jsonb)) or contexto ->> 'clienteId' in (select jsonb_array_elements_text($2::text::jsonb))
                 or id::text in (select jsonb_array_elements_text($2::text::jsonb)))
          order by agendada_para, criado_em limit 1 for update skip locked`, [agoraISO, escopo ? JSON.stringify(escopo) : null]);
        return r ? linhaExec(r) : null;
      },
      async consentimento(titular, tipo) {
        if (!titular || !uuidOuNulo(titular.id)) return false;
        // mesma trava do definir_consentimento e do SAIR: revogação e decisão de envio não se cruzam
        await q(`select pg_advisory_xact_lock(hashtextextended('consentimento:' || $1 || ':' || $2, 0))`, [titular.id, tipo]);
        const [r] = await q('select coalesce((privado.consentimentos_atuais($1, $2::uuid) ->> $3)::boolean, false) ok', [titular.tipo, titular.id, tipo]);
        return r.ok;
      },
      async reservarLimite(titular, categoria, dia, max) {
        const r = await q(`insert into public.automacao_limites (titular_tipo, titular_id, categoria, dia, usados) values ($1, $2::uuid, $3, $4::date, 1)
          on conflict (titular_tipo, titular_id, categoria, dia) do update set usados = public.automacao_limites.usados + 1 where public.automacao_limites.usados < $5
          returning usados`, [titular.tipo, titular.id, categoria, dia, max]);
        return r.length > 0 && Number(r[0].usados) <= max;
      },
      async criarMensagem(m) {
        const [r] = await q(`insert into public.mensagens (execucao_id, canal, destino, conteudo, assunto, template_codigo, template_versao, estado, criado_em, atualizado_em)
          values ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $9::timestamptz) returning id`,
        [m.execucaoId, m.canal, m.destino, m.conteudo, m.assunto, m.templateCodigo, m.templateVersao, m.estado, m.criadoEm]);
        return { id: r.id, ...m };
      },
      async atualizarMensagem(id, patch) {
        await q(`update public.mensagens set estado = coalesce($2, estado), provedor = coalesce($3, provedor), id_externo = coalesce($4, id_externo),
            erro = coalesce($5::text::jsonb, erro), atualizado_em = coalesce($6::timestamptz, now()) where id = $1::uuid`,
        [id, patch.estado ?? null, patch.provedor ?? null, patch.idExterno ?? null, patch.erro ? JSON.stringify(patch.erro) : null, patch.atualizadoEm ?? null]);
      },
      async marcarMensagensIncertas(execId) {
        await q(`update public.mensagens set estado = 'falhou', erro = '{"codigo":"INCERTO","mensagem":"resultado incerto"}'::jsonb, atualizado_em = now()
          where execucao_id = $1::uuid and estado = 'enviando'`, [execId]);
      },
      async emitirEvento(tipo, refs, dados) {
        await q('select privado.evento($1, $2::text::jsonb, $3::text::jsonb)', [tipo, JSON.stringify(refs || {}), JSON.stringify(dados || {})]);
      },
      async enviandoAntesDe(limiteISO) {
        return (await q(`select * from public.automacao_execucoes where estado = 'enviando' and atualizado_em < $1::timestamptz for update skip locked`, [limiteISO])).map(linhaExec);
      },
      async candidatos(regra, { hoje, diasAFrente }) {
        const t = regra.atraso.tipo;
        const comContexto = async (linhas, refsDe) => {
          const out = [];
          for (const l of linhas) { const refs = refsDe(l); out.push({ ...(await p.contexto(refs)), refs }); }
          return out;
        };
        if (t === 'vespera' || t === 'apos_inicio_turno') {
          const ate = t === 'vespera' ? diasAFrente : 0;
          const ls = await q(`select id, pedido_id, diarista_id from public.atendimentos where status = 'confirmado' and data between $1::date and $1::date + $2::int`, [hoje, ate]);
          return comContexto(ls, (l) => ({ atendimentoId: l.id, pedidoId: l.pedido_id, diaristaId: l.diarista_id }));
        }
        if (t === 'antes_prazo' || t === 'prazo_vencido') {
          const ls = await q(`select id, pedido_id, atendimento_id from public.pagamentos where status = 'pendente' and vence_em between $1::date - 1 and $1::date + $2::int + 1`, [hoje, diasAFrente]);
          return comContexto(ls, (l) => ({ pagamentoId: l.id, pedidoId: l.pedido_id, atendimentoId: l.atendimento_id }));
        }
        if (t === 'diario' || t === 'semanal') return [{ data: hoje }];
        if (t === 'aniversario') {
          const ls = await q(`select id from public.clientes where anonimizado_em is null and to_char(data_nascimento, 'MM-DD') = to_char($1::date, 'MM-DD')`, [hoje]);
          return (await comContexto(ls, (l) => ({ clienteId: l.id }))).map((c) => ({ ...c, data: hoje }));
        }
        if (t === 'mensal') {
          if (Number(hoje.slice(8)) !== regra.atraso.dia) return [];
          const ls = await q(`select distinct on (p.cliente_id) p.id, p.cliente_id from public.pedidos p join public.atendimentos a on a.pedido_id = p.id
            where p.pacote ->> 'frequencia' <> 'avulso' and p.status not in ('cancelado', 'recusado', 'solicitado')
              and date_trunc('month', a.data) = date_trunc('month', $1::date) and a.status <> 'cancelado' order by p.cliente_id, p.criado_em desc`, [hoje]);
          return (await comContexto(ls, (l) => ({ pedidoId: l.id, clienteId: l.cliente_id }))).map((c) => ({ ...c, data: hoje }));
        }
        if (t === 'inatividade') {
          const ls = await q(`select p.cliente_id, max(a.data)::text ultima from public.atendimentos a join public.pedidos p on p.id = a.pedido_id
              join public.clientes c on c.id = p.cliente_id and c.anonimizado_em is null
            where a.status in ('finalizado', 'avaliado') group by p.cliente_id
            having max(a.data) <= $1::date - $2::int
              and not exists (select 1 from public.atendimentos a2 join public.pedidos p2 on p2.id = a2.pedido_id where p2.cliente_id = p.cliente_id and a2.data >= $1::date and a2.status <> 'cancelado')
              and not exists (select 1 from public.automacao_execucoes e where e.regra = $3 and e.titular_id = p.cliente_id and e.estado in ('enviada', 'entregue', 'lida')
                              and e.agendada_para > ($1::date - $4::int)::timestamptz)`, [hoje, regra.atraso.dias, regra.codigo, regra.atraso.intervaloDias]);
          return (await comContexto(ls, (l) => ({ clienteId: l.cliente_id }))).map((c, i) => ({ ...c, data: hoje, ultimaDiaria: ls[i].ultima }));
        }
        if (t === 'antes_vencimento_documento') {
          // certidão atual de cada profissional aprovada, vencendo dentro da maior antecedência da regra
          const ls = await q(`select distinct on (d.diarista_id) d.id, d.diarista_id from public.documentos d join public.diaristas x on x.id = d.diarista_id and x.status = 'aprovada'
              where d.tipo = 'antecedentes' and d.excluido_em is null order by d.diarista_id, d.criado_em desc`);
          const max = Math.max(...regra.atraso.dias);
          const cands = (await comContexto(ls, (l) => ({ documentoId: l.id, diaristaId: l.diarista_id }))).filter((c) => c.documento?.venceEm && c.documento.venceEm >= hoje);
          return cands.filter((c) => c.documento.venceEm <= somar(hoje, max)).map((c) => ({ ...c, data: hoje }));
        }
        return [];
      },
    };
    return p;
  }

  async function falhouEvento(id, erro, agoraISO) {
    await transacao(async (q) => {
      // mesma trava da fila: entre o rollback deste worker e esta gravação, outro pode ter processado o evento; aí não reabre
      await q('select pg_advisory_xact_lock(hashtext($1))', [TRAVA_EVENTOS]);
      const [e] = await q('select tentativas, status from public.eventos where id = $1::uuid for update', [id]);
      if (!e || e.status !== 'pendente') return;
      const t = e.tentativas + 1;
      const desiste = t >= MAX_TENTATIVAS_EVENTO;
      const apos = desiste ? null : new Date(Date.parse(agoraISO) + BACKOFF_EVENTO_MINUTOS[t - 1] * 60000).toISOString();
      await q('update public.eventos set tentativas = $2, status = $3, erro = $4, tentar_apos = $5::timestamptz where id = $1::uuid',
        [id, t, desiste ? 'erro' : 'pendente', String(erro?.message || erro).slice(0, 300), apos]);
    });
  }

  return {
    transacao: (fn) => transacao((q) => fn(portaDaTx(q))),
    /** Um evento por transação, sob a trava da fila; falha = backoff (1, 5, 15, 60 min) e na 5ª vai pra 'erro'. */
    async processarProximoEvento(fn, { agoraISO } = {}) {
      const agora = agoraISO || new Date().toISOString();
      let evId = null;
      try {
        return await transacao(async (q) => {
          await q('select pg_advisory_xact_lock(hashtext($1))', [TRAVA_EVENTOS]);
          const [r] = await q(`select privado.j_evento(t) j from public.eventos t where t.status = 'pendente' and (t.tentar_apos is null or t.tentar_apos <= now())
            order by t.seq limit 1 for update skip locked`);
          if (!r) return null;
          evId = r.j.id;
          const res = await fn(portaDaTx(q), r.j);
          await q(`update public.eventos set status = 'processado', processado_em = now(), erro = null, tentar_apos = null where id = $1::uuid`, [evId]);
          return res;
        });
      } catch (e) {
        if (!evId) throw e;
        await falhouEvento(evId, e, agora);
        return { erro: e };
      }
    },
  };
}
