// Agenda e Escala no mock (docs/AGENDA-ESCALA.md). O Supabase faz o mesmo em RPC (migration 20261109100000); as regras
// puras ficam em src/domain/escala.js. Mesmas formas de resposta dos dois lados. O que o mock não tem (bloqueios de
// férias, ocorrências) vem dos campos de demonstração do seed ou fica vazio.
import { ErroNegocio } from '../domain/modelo.js';
import {
  transicionarEscala, avancaEscala, alteracaoRelevante, elegivelEnvio, chaveEnvio, pontuarCandidata, escolherSugerida, CRITERIOS_SEM_DADO, CONFIG_AGENDA_PADRAO,
} from '../domain/escala.js';
import { instanteLocal, somarDias, diferencaDias } from '../domain/calendario.js';

const TODOS = null;
const exigirPrime = (s) => { if (s?.ator !== 'prime') throw new ErroNegocio('ATOR_SEM_PERMISSAO', 'Só a Prime'); };
const exigirAdmin = (s) => { exigirPrime(s); if (s?.papel && s.papel !== 'prime_admin') throw new ErroNegocio('ATOR_SEM_PERMISSAO', 'Só a administração'); };
const COMUNICADA = ['aguardando_envio', 'enviada', 'aguardando_aceite', 'confirmada'];
const ATIVAS = ['agendado', 'confirmado', 'diarista_a_caminho', 'em_andamento'];
const ambientes = (car) => (car?.ambientesTotal ?? (car?.ambientes && typeof car.ambientes === 'object' ? Object.values(car.ambientes).reduce((t, v) => t + (Number(v) || 0), 0) : null));
const dow = (d) => new Date(`${d}T12:00:00Z`).getUTCDay();
const media = (l) => (l.length ? Math.round((l.reduce((t, x) => t + x, 0) / l.length) * 10) / 10 : null);

/**
 * Repositório com o gatilho da escala (espelho do trigger do banco): alteração relevante numa diária grava
 * escala_estado = para_revisar e versão + 1, a menos que quem gravou já tenha ajustado (_escala).
 */
export function comGatilhoEscala(repo) {
  const embrulhar = (tx) => new Proxy(tx, {
    get(alvo, k) {
      if (k !== 'put') return typeof alvo[k] === 'function' ? alvo[k].bind(alvo) : alvo[k];
      return async (store, x) => {
        if (store === 'atendimentos' && x && !x._escala) {
          const antes = await alvo.get('atendimentos', x.id);
          if (antes && alteracaoRelevante(antes, x)) {
            const diaristaMudou = (antes.diaristaId || null) !== (x.diaristaId || null);
            x = { ...x, escalaEstado: 'para_revisar', escalaVersao: (antes.escalaVersao || 0) + 1, ...(diaristaMudou ? { designacaoOrigem: x.diaristaId ? 'manual' : null } : {}) };
          }
        }
        if (x && x._escala) { x = { ...x }; delete x._escala; }
        return alvo.put(store, x);
      };
    },
  });
  return { ...repo, transacao: (stores, fn) => repo.transacao(stores, (tx) => fn(embrulhar(tx))), leitura: repo.leitura.bind(repo) };
}

export function criarCasosEscala({ repo, idem, agoraISO, hojeSP, gerarId, registrarEvento, pagamentoDaDiariaConfirmado }) {
  const endereco = (a, p, c) => a?.endereco || p?.endereco || c?.endereco || {};
  const lerConfig = async (tx) => ({ ...CONFIG_AGENDA_PADRAO, standbyAlertaMin: 60, historicoCanal: [], ...((await tx.get('configPainel', 'agenda_escala'))?.valor || {}) });

  async function carregar(tx) {
    const [peds, ats, cls, dias, pgs, avs, cond, sbs, vins] = await Promise.all(['pedidos', 'atendimentos', 'clientes', 'diaristas', 'pagamentos', 'avaliacoes', 'condicoesComerciais', 'standbyDecisoes', 'vinculosFixos'].map((n) => tx.todos(n)));
    const P = Object.fromEntries(peds.map((x) => [x.id, x])); const C = Object.fromEntries(cls.map((x) => [x.id, x])); const D = Object.fromEntries(dias.map((x) => [x.id, x]));
    const notas = {}; const pont = {};
    for (const v of avs) {
      const a = ats.find((x) => x.id === v.atendimentoId); if (!a?.diaristaId) continue;
      (notas[a.diaristaId] ||= []).push(Number(v.notaFinal)); if (v.notas?.pontualidade) (pont[a.diaristaId] ||= []).push(Number(v.notas.pontualidade));
    }
    const nota = (id) => media(notas[id] || []);
    return { peds, ats, cls, dias, pgs, avs, cond, sbs, vins, P, C, D, nota, pont: (id) => media(pont[id] || []) };
  }
  const visivel = (a, b) => !['solicitado', 'recusado'].includes(b.P[a.pedidoId]?.status);

  /** Vínculo fixo vigente do pedido no dia da semana da diária. */
  const vinculoDa = (a, b) => b.vins.find((v) => v.pedidoId === a.pedidoId && v.diaSemana === dow(a.data) && !v.encerradoEm) || null;
  /** Conflito da fixa: outra diária dela que cruza o horário, ou ela fora do dia de trabalho. Só alerta. */
  function alertaFixa(a, b) {
    const v = vinculoDa(a, b); if (!v || a.diaristaId !== v.diaristaId) return null;
    const ctx = contexto(a, b.D[v.diaristaId], b);
    const r = pontuarCandidata(diariaParaPontuar(a, b), b.D[v.diaristaId] || {}, ctx);
    return r.impedida ? `Fixa com impedimento: ${r.motivos.join(', ')}` : null;
  }
  const diariaParaPontuar = (a, b) => { const p = b.P[a.pedidoId]; const c = b.C[p?.clienteId]; return { data: a.data, horaInicio: a.horaInicio, duracaoMinutos: a.duracaoMinutos, servico: a.servico || p?.pacote?.tipoServico, cidade: endereco(a, p, c).cidade }; };
  function contexto(a, d, b) {
    if (!d) return {};
    const p = b.P[a.pedidoId];
    const outras = b.ats.filter((x) => x.id !== a.id && x.diaristaId === d.id && x.data === a.data && x.status !== 'cancelado');
    const historicoCliente = b.ats.filter((x) => x.diaristaId === d.id && ['finalizado', 'avaliado'].includes(x.status) && b.P[x.pedidoId]?.clienteId === p?.clienteId).length;
    const ocorrencias90 = b.ats.filter((x) => x.diaristaId === d.id && x.ocorrencia && diferencaDias(x.data, a.data) <= 90 && x.data <= a.data).length;
    const bloqueada = (d.bloqueios || []).some((k) => a.data >= k.de && a.data <= k.ate);
    return { outras, historicoCliente, ocorrencias90, bloqueada, mediaNota: b.nota(d.id), mediaPontualidade: b.pont(d.id) };
  }

  function item(a, b, agora) {
    const p = b.P[a.pedidoId]; const c = b.C[p.clienteId] || {}; const e = endereco(a, p, c); const d = b.D[a.diaristaId]; const car = a.caracteristicas || {};
    const doPedido = b.pgs.filter((g) => g.pedidoId === p.id);
    const pago = pagamentoDaDiariaConfirmado(doPedido, a, b.ats.filter((x) => x.pedidoId === p.id), p);
    const pagamento = doPedido.some((g) => g.parcela === 'faturamento' && g.status !== 'cancelado') ? { estado: 'a_faturar' }
      : pago ? { estado: 'pago', forma: doPedido.some((g) => g.status === 'confirmado' && /cart/i.test(g.metodo || '')) ? 'cartao' : 'pix' } : { estado: 'pendente', forma: 'pix' };
    const v = vinculoDa(a, b);
    return {
      id: a.id, pedidoId: p.id, numero: p.numeroSolicitacao ?? null, data: a.data, horaInicio: a.horaInicio || null, duracaoMinutos: a.duracaoMinutos || (p.pacote?.duracaoHoras || 0) * 60,
      status: a.status, escalaEstado: a.escalaEstado || 'para_revisar', escalaVersao: a.escalaVersao || 0, escalaEnvio: a.escalaEnvio || null, escalaRecusa: a.escalaRecusa || null,
      escalaSugestao: a.escalaSugestao || null, designacaoOrigem: a.diaristaId ? (a.designacaoOrigem || 'manual') : null,
      servico: a.servico || p.pacote?.tipoServico, modalidade: p.modalidade || null, pacote: p.modalidade === 'pacote',
      cliente: { id: c.id, nome: c.nome, telefone: c.telefone, parceria: !!c.parceria },
      local: { logradouro: e.logradouro, numero: e.numero, complemento: e.complemento, bairro: e.bairro, cidade: e.cidade, uf: e.uf, cep: e.cep },
      imovel: { metragem: car.metragem ?? p.pacote?.metragem ?? null, comodos: ambientes(car), caes: (car.animais?.caes || 0) > 0, gatos: (car.animais?.gatos || 0) > 0 },
      profissional: d ? { id: d.id, nome: d.nome, telefone: d.telefone, nota: b.nota(d.id), habilidades: d.habilidades || [] } : null,
      pagamento, ocorrenciaAberta: ['aberto', 'em_analise'].includes(a.ocorrencia?.estado), alertaFixa: alertaFixa(a, b),
      vinculoFixo: v ? { id: v.id, diaristaId: v.diaristaId, nome: b.D[v.diaristaId]?.nome || null } : null,
      observacao: [a.justificativa, p.observacaoDisponibilidade].filter(Boolean).join(' · ') || null, prioridades: car.prioridades || [],
      historico: a.historico || [], agora,
    };
  }

  async function aplicarEscala(tx, a, mudanca, historicoItem) {
    const novo = { ...a, ...mudanca, atualizadoEm: agoraISO(), _escala: true, historico: [...(a.historico || []), ...(historicoItem ? [{ ...historicoItem, em: agoraISO() }] : [])] };
    await tx.put('atendimentos', novo);
    return novo;
  }
  async function exigirDiaria(tx, id) {
    const a = await tx.get('atendimentos', id);
    if (!a) throw new ErroNegocio('NAO_ENCONTRADO', 'Diária não encontrada');
    const p = await tx.get('pedidos', a.pedidoId);
    if (!p || ['solicitado', 'recusado'].includes(p.status)) throw new ErroNegocio('NAO_ENCONTRADO', 'Diária não encontrada');
    return { a, p };
  }
  const editavel = (a) => {
    if (!ATIVAS.slice(0, 2).includes(a.status)) throw new ErroNegocio('TRANSICAO_PROIBIDA', 'Diária em andamento, finalizada ou cancelada');
    if (a.data < hojeSP()) throw new ErroNegocio('DATA_INVALIDA', 'Diária de um dia que já passou');
  };

  async function avisarAnteriorSeComunicada(tx, a, extra = {}) {
    if (a.diaristaId && COMUNICADA.includes(a.escalaEstado)) {
      await registrarEvento(tx, 'escala_alterada', { atendimentoId: a.id, pedidoId: a.pedidoId }, { anterior: a.diaristaId, ...extra });
    }
  }

  /** Preenche fixa e sugerida (sem avisar ninguém: só o envio comunica). Idempotente. */
  async function preparar(tx, de, ate) {
    const b = await carregar(tx); const hoje = hojeSP(); const r = { fixas: 0, sugeridas: 0, semCandidata: 0 };
    const alvo = b.ats.filter((a) => a.data >= de && a.data <= ate && a.data >= hoje && !a.diaristaId && !a.escalaSemAuto && ['agendado', 'confirmado'].includes(a.status)
      && ['aguardando_pagamento', 'confirmado'].includes(b.P[a.pedidoId]?.status)).sort((x, y) => `${x.data}${x.horaInicio}`.localeCompare(`${y.data}${y.horaInicio}`));
    for (const a of alvo) {
      const v = vinculoDa(a, b);
      if (v && b.D[v.diaristaId]?.status === 'aprovada') {
        const n = await aplicarEscala(tx, a, { diaristaId: v.diaristaId, designacaoOrigem: 'fixa', escalaEstado: 'para_revisar', escalaVersao: (a.escalaVersao || 0) + 1, escalaSugestao: null },
          { evento: 'escala_fixa', ator: 'sistema', diaristaId: v.diaristaId });
        Object.assign(a, n); r.fixas++; continue;
      }
      const cands = b.dias.filter((d) => d.status === 'aprovada').map((d) => ({ id: d.id, nome: d.nome, ...pontuarCandidata(diariaParaPontuar(a, b), d, contexto(a, d, b)) }));
      const s = escolherSugerida(cands);
      if (!s) { r.semCandidata++; continue; }
      const n = await aplicarEscala(tx, a, { diaristaId: s.id, designacaoOrigem: 'sugerida', escalaEstado: 'para_revisar', escalaVersao: (a.escalaVersao || 0) + 1,
        escalaSugestao: { pontos: s.pontos, motivos: s.motivos, criteriosSemDado: CRITERIOS_SEM_DADO } }, { evento: 'escala_sugerida', ator: 'sistema', diaristaId: s.id });
      Object.assign(a, n); r.sugeridas++;
    }
    return r;
  }

  const casos = {
    /** Demonstração (SEED_DEMO=agenda): grava o seed uma vez só. */
    async semearDemoAgenda(registros) {
      return repo.transacao(TODOS, async (tx) => {
        if ((await tx.todos('pedidos')).some((p) => p.id.startsWith('00000000-0000-4000-9100-'))) return { semeado: false };
        for (const [store, lista] of Object.entries(registros)) for (const x of lista) await tx.put(store, { ...x, _escala: true });
        return { semeado: true };
      });
    },
    async agendaEscala({ de, ate } = {}, { sessao } = {}) {
      exigirPrime(sessao);
      if (!de || !ate || ate < de || diferencaDias(de, ate) > 31) throw new ErroNegocio('DADOS_INVALIDOS', 'Período de até 31 dias');
      return repo.leitura(TODOS, async (tx) => {
        const b = await carregar(tx); const agora = agoraISO(); const config = await lerConfig(tx);
        const itens = b.ats.filter((a) => a.data >= de && a.data <= ate && visivel(a, b)).map((a) => item(a, b, agora))
          .sort((x, y) => `${x.data}${x.horaInicio}`.localeCompare(`${y.data}${y.horaInicio}`));
        const standby = b.sbs.filter((s) => s.data >= de && s.data <= ate && ['reservada', 'confirmada'].includes(s.estado) && s.horaInicio).map((s) => ({
          diaristaId: s.diaristaId, nome: b.D[s.diaristaId]?.nome || '', nota: b.nota(s.diaristaId), data: s.data, horaInicio: s.horaInicio, duracaoMinutos: s.duracaoMinutos,
          regiao: s.regiao || '', estado: s.estado, decidirAte: s.decidirAte || null, atendimentoId: s.atendimentoId || null,
        })).sort((x, y) => `${x.data}${x.horaInicio}`.localeCompare(`${y.data}${y.horaInicio}`));
        return { de, ate, agora, config: { prazoSemRespostaMin: config.prazoSemRespostaMin, verificacaoPagamento: config.verificacaoPagamento, standbyAlertaMin: config.standbyAlertaMin, canalAtivo: config.canalAtivo }, itens, standby };
      });
    },
    async agendaContagens({ de, ate } = {}, { sessao } = {}) {
      exigirPrime(sessao);
      if (!de || !ate || ate < de || diferencaDias(de, ate) > 62) throw new ErroNegocio('DADOS_INVALIDOS', 'Período inválido');
      return repo.leitura(TODOS, async (tx) => {
        const b = await carregar(tx); const dias = [];
        for (let d = de; d <= ate; d = somarDias(d, 1)) dias.push({ data: d, total: b.ats.filter((a) => a.data === d && visivel(a, b)).length });
        return { dias };
      });
    },
    async escalaPreparar({ de, ate } = {}, { sessao } = {}) {
      exigirPrime(sessao);
      if (!de || !ate || ate < de || diferencaDias(de, ate) > 31) throw new ErroNegocio('DADOS_INVALIDOS', 'Período de até 31 dias');
      return repo.transacao(TODOS, (tx) => preparar(tx, de, ate));
    },
    async escalaCandidatas(atendimentoId, { sessao } = {}) {
      exigirPrime(sessao);
      return repo.leitura(TODOS, async (tx) => {
        const { a } = await exigirDiaria(tx, atendimentoId); const b = await carregar(tx);
        const itens = b.dias.filter((d) => d.status === 'aprovada').map((d) => ({
          id: d.id, nome: d.nome, nota: b.nota(d.id), habilidades: d.habilidades || [], regioes: d.disponibilidade?.regioes || [], atribuida: d.id === a.diaristaId,
          ...pontuarCandidata(diariaParaPontuar(a, b), d, contexto(a, d, b)),
        })).sort((x, y) => Number(y.atribuida) - Number(x.atribuida) || Number(x.impedida) - Number(y.impedida) || y.pontos - x.pontos || x.nome.localeCompare(y.nome));
        return { atualId: a.diaristaId || null, origem: a.diaristaId ? (a.designacaoOrigem || 'manual') : null, sugestao: a.escalaSugestao || null, criteriosSemDado: CRITERIOS_SEM_DADO, itens };
      });
    },
    async escalaAlterar(atendimentoId, { diaristaId, escopo = 'so_esta' } = {}, { sessao, chave } = {}) {
      exigirPrime(sessao);
      if (!['so_esta', 'vinculo_futuro'].includes(escopo)) throw new ErroNegocio('DADOS_INVALIDOS', 'Escolha se vale só pra esta diária ou pras próximas');
      if (escopo === 'vinculo_futuro') exigirAdmin(sessao);
      return repo.transacao(TODOS, (tx) => idem(tx, 'escalaAlterar', sessao, chave, { atendimentoId, diaristaId, escopo }, async () => {
        const { a, p } = await exigirDiaria(tx, atendimentoId); editavel(a);
        const d = await tx.get('diaristas', diaristaId);
        if (d?.status !== 'aprovada') throw new ErroNegocio('NAO_ENCONTRADO', 'Profissional não encontrada');
        const b = await carregar(tx);
        const r = pontuarCandidata(diariaParaPontuar(a, b), d, contexto(a, d, b));
        if (r.motivos.includes('outra diária no mesmo horário') || r.motivos.includes('férias ou folga')) throw new ErroNegocio('CONFLITO', `${d.nome.split(' ')[0]}: ${r.motivos.join(', ')}`);
        if (escopo === 'vinculo_futuro' && p.modalidade !== 'pacote') throw new ErroNegocio('CONDICAO_NAO_ATENDIDA', 'Vínculo fixo só existe em pacote');
        if (a.diaristaId === diaristaId && escopo === 'so_esta') return { id: a.id, diaristaId, escalaEstado: a.escalaEstado, escalaVersao: a.escalaVersao || 0 };
        await avisarAnteriorSeComunicada(tx, a);
        let origem = 'manual';
        if (escopo === 'vinculo_futuro') { await trocarVinculo(tx, p, dow(a.data), diaristaId, sessao, a.id); origem = 'fixa'; }
        const n = await aplicarEscala(tx, a, { diaristaId, designacaoOrigem: origem, escalaEstado: 'para_revisar', escalaVersao: (a.escalaVersao || 0) + 1, escalaRecusa: null, escalaSemAuto: false, escalaEnvio: null, escalaSugestao: null },
          { evento: 'escala_alterar', ator: 'prime', atorId: sessao.id, por: sessao.nome || null, diaristaId, anterior: a.diaristaId || null, escopo });
        return { id: n.id, diaristaId, escalaEstado: n.escalaEstado, escalaVersao: n.escalaVersao };
      }));
    },
    async escalaRemover(atendimentoId, { sessao, chave } = {}) {
      exigirPrime(sessao);
      return repo.transacao(TODOS, (tx) => idem(tx, 'escalaRemover', sessao, chave, { atendimentoId }, async () => {
        const { a } = await exigirDiaria(tx, atendimentoId); editavel(a);
        if (!a.diaristaId) throw new ErroNegocio('CONDICAO_NAO_ATENDIDA', 'A diária já está sem profissional');
        await avisarAnteriorSeComunicada(tx, a, { removida: true });
        const n = await aplicarEscala(tx, a, { diaristaId: null, designacaoOrigem: null, escalaEstado: 'para_revisar', escalaVersao: (a.escalaVersao || 0) + 1, escalaSemAuto: true, escalaEnvio: null, escalaSugestao: null },
          { evento: 'escala_remover', ator: 'prime', atorId: sessao.id, por: sessao.nome || null, anterior: a.diaristaId });
        return { id: n.id, escalaEstado: n.escalaEstado, escalaVersao: n.escalaVersao };
      }));
    },
    async escalaRevisar(atendimentoId, versao, { sessao, chave } = {}) {
      exigirPrime(sessao);
      return repo.transacao(TODOS, (tx) => idem(tx, 'escalaRevisar', sessao, chave, { atendimentoId, versao }, async () => {
        const { a } = await exigirDiaria(tx, atendimentoId); editavel(a);
        if (Number(versao) !== (a.escalaVersao || 0)) throw new ErroNegocio('DESATUALIZADA', 'A diária mudou desde que a tela abriu. Confira de novo.');
        const para = transicionarEscala(a, 'revisar', { ator: 'prime' });
        const n = await aplicarEscala(tx, a, { escalaEstado: para }, { evento: 'escala_revisar', ator: 'prime', atorId: sessao.id, por: sessao.nome || null });
        return { id: n.id, escalaEstado: n.escalaEstado, escalaVersao: n.escalaVersao || 0 };
      }));
    },
    async escalaEnviar(ids, { sessao, chave } = {}) {
      exigirPrime(sessao);
      const lista = [...new Set((Array.isArray(ids) ? ids : []).map(String))].sort();
      if (!lista.length || lista.length > 200) throw new ErroNegocio('DADOS_INVALIDOS', 'Escolha de 1 a 200 diárias');
      return repo.transacao(TODOS, (tx) => idem(tx, 'escalaEnviar', sessao, chave, { ids: lista }, async () => {
        const config = await lerConfig(tx); const enviadas = []; const ignoradas = [];
        for (const id of lista) {
          const a = await tx.get('atendimentos', id);
          if (!a) { ignoradas.push({ id, motivo: 'não encontrada' }); continue; }
          const falhou = a.escalaEstado === 'aguardando_envio' && a.escalaEnvio?.falhou;
          if (!elegivelEnvio(a) && !falhou) { ignoradas.push({ id, motivo: a.escalaEstado === 'para_revisar' ? 'ainda não revisada' : COMUNICADA.includes(a.escalaEstado) ? 'já enviada' : 'não elegível' }); continue; }
          if (!['agendado', 'confirmado'].includes(a.status) || a.data < hojeSP()) { ignoradas.push({ id, motivo: 'não elegível' }); continue; }
          const para = transicionarEscala(a, 'enviar', { ator: 'prime', envioFalhou: falhou });
          const envio = { enviadaEm: agoraISO(), canal: config.canalAtivo, chave: chaveEnvio(a), versao: a.escalaVersao || 0, falhou: false };
          await aplicarEscala(tx, a, { escalaEstado: para, escalaEnvio: envio }, { evento: 'escala_enviar', ator: 'prime', atorId: sessao.id, por: sessao.nome || null, canal: config.canalAtivo });
          await registrarEvento(tx, 'diaria_enviada', { atendimentoId: a.id, pedidoId: a.pedidoId, diaristaId: a.diaristaId }, { versao: a.escalaVersao || 0 });
          enviadas.push(id);
        }
        return { enviadas, ignoradas };
      }));
    },
    async escalaResponder(atendimentoId, { resposta, versao, motivo } = {}, { sessao, chave } = {}) {
      exigirPrime(sessao);
      if (!['aceite', 'recusa'].includes(resposta)) throw new ErroNegocio('DADOS_INVALIDOS', 'Resposta inválida');
      return repo.transacao(TODOS, (tx) => idem(tx, 'escalaResponder', sessao, chave, { atendimentoId, resposta, versao, motivo: motivo || null }, async () => {
        const { a } = await exigirDiaria(tx, atendimentoId);
        if (Number(versao) !== (a.escalaVersao || 0)) throw new ErroNegocio('DESATUALIZADA', 'A diária mudou desde que a resposta chegou');
        return responder(tx, a, resposta, { canal: 'telefone', motivo, ator: 'prime', atorId: sessao.id });
      }));
    },
    async escalaSolicitarConfirmacao(atendimentoId, { sessao, chave } = {}) {
      exigirPrime(sessao);
      return repo.transacao(TODOS, (tx) => idem(tx, 'escalaSolicitarConfirmacao', sessao, chave, { atendimentoId }, async () => {
        const { a } = await exigirDiaria(tx, atendimentoId);
        if (!['enviada', 'aguardando_aceite', 'aguardando_envio'].includes(a.escalaEstado) || !a.diaristaId) throw new ErroNegocio('CONDICAO_NAO_ATENDIDA', 'Só depois de enviada e antes do aceite');
        await registrarEvento(tx, 'confirmacao_solicitada', { atendimentoId: a.id, pedidoId: a.pedidoId, diaristaId: a.diaristaId }, { versao: a.escalaVersao || 0 });
        await aplicarEscala(tx, a, {}, { evento: 'escala_solicitar_confirmacao', ator: 'prime', atorId: sessao.id, por: sessao.nome || null });
        return { solicitada: true };
      }));
    },
    /** Retorno do motor (execuções D10) pra escala: enviada, entregue, falha. Nunca regride; versão antiga é ignorada. */
    async sincronizarEscala() {
      return repo.transacao(TODOS, async (tx) => {
        let n = 0;
        for (const e of (await tx.todos('execucoes')).filter((x) => x.regra === 'D10' && !x.teste)) {
          const a = e.contexto?.atendimentoId && await tx.get('atendimentos', e.contexto.atendimentoId);
          if (!a || Number(e.contexto?.dados?.versao) !== (a.escalaVersao || 0)) continue;
          const para = e.estado === 'enviada' ? 'enviada' : ['entregue', 'lida'].includes(e.estado) ? 'aguardando_aceite' : null;
          if (para && avancaEscala(a.escalaEstado, para) && ['aguardando_envio', 'enviada'].includes(a.escalaEstado)) {
            await aplicarEscala(tx, a, { escalaEstado: para, escalaEnvio: { ...a.escalaEnvio, ...(para === 'aguardando_aceite' ? { entregueEm: e.atualizadoEm } : {}) } }); n++;
          } else if (e.estado === 'falhou' && a.escalaEstado === 'aguardando_envio' && !a.escalaEnvio?.falhou) {
            await aplicarEscala(tx, a, { escalaEnvio: { ...a.escalaEnvio, falhou: true } }, { evento: 'escala_envio_falhou', ator: 'sistema' }); n++;
          }
        }
        return { atualizadas: n };
      });
    },
    async standbyReservar({ diaristaId, data, horaInicio, duracaoMinutos, regiao } = {}, { sessao, chave } = {}) {
      exigirPrime(sessao);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data || '') || !/^\d{2}:\d{2}$/.test(horaInicio || '') || !(Number(duracaoMinutos) >= 60 && Number(duracaoMinutos) <= 600)) throw new ErroNegocio('DADOS_INVALIDOS', 'Informe data, horário e duração (1 a 10 horas)');
      return repo.transacao(TODOS, (tx) => idem(tx, 'standbyReservar', sessao, chave, { diaristaId, data, horaInicio, duracaoMinutos, regiao: regiao || '' }, async () => {
        if (data < hojeSP()) throw new ErroNegocio('DATA_INVALIDA', 'Data que já passou');
        const d = await tx.get('diaristas', diaristaId);
        if (d?.status !== 'aprovada') throw new ErroNegocio('NAO_ENCONTRADO', 'Profissional não encontrada');
        const k = `${diaristaId}:${data}`; const ant = await tx.get('standbyDecisoes', k);
        if (ant && ['reservada', 'confirmada', 'utilizada'].includes(ant.estado)) throw new ErroNegocio('CONFLITO', 'Ela já está em stand-by nesse dia');
        const cfg = await lerConfig(tx);
        const decidirAte = new Date(Date.parse(instanteLocal(data, ...horaInicio.split(':').map(Number))) - cfg.standbyAlertaMin * 60000).toISOString();
        const x = { chave: k, diaristaId, data, estado: 'reservada', horaInicio, duracaoMinutos: Number(duracaoMinutos), regiao: String(regiao || '').slice(0, 80), decidirAte, atendimentoId: null,
          motivo: null, decididoPor: sessao.id, em: agoraISO(), historico: [...(ant?.historico || []), { estado: 'reservada', em: agoraISO(), por: sessao.nome || sessao.id }] };
        await tx.put('standbyDecisoes', x);
        return { diaristaId, data, estado: x.estado };
      }));
    },
    async standbyConfirmar(diaristaId, data, { sessao, chave } = {}) {
      exigirPrime(sessao);
      return repo.transacao(TODOS, (tx) => idem(tx, 'standbyConfirmar', sessao, chave, { diaristaId, data }, async () => mudarStandby(tx, diaristaId, data, 'confirmada', ['reservada'], sessao)));
    },
    async standbyLiberar(diaristaId, data, motivo, { sessao, chave } = {}) {
      exigirPrime(sessao);
      return repo.transacao(TODOS, (tx) => idem(tx, 'standbyLiberar', sessao, chave, { diaristaId, data, motivo: motivo || null }, async () => mudarStandby(tx, diaristaId, data, 'liberada', ['reservada', 'confirmada'], sessao, { motivo: String(motivo || '').trim().slice(0, 280) || null })));
    },
    async standbyUtilizar(diaristaId, data, atendimentoId, { sessao, chave } = {}) {
      exigirPrime(sessao);
      return repo.transacao(TODOS, (tx) => idem(tx, 'standbyUtilizar', sessao, chave, { diaristaId, data, atendimentoId }, async () => {
        const { a } = await exigirDiaria(tx, atendimentoId); editavel(a);
        if (a.data !== data) throw new ErroNegocio('DADOS_INVALIDOS', 'A diária é de outro dia');
        if (a.diaristaId === diaristaId) throw new ErroNegocio('CONDICAO_NAO_ATENDIDA', 'Ela já está nesta diária');
        await avisarAnteriorSeComunicada(tx, a);
        const r = await mudarStandby(tx, diaristaId, data, 'utilizada', ['reservada', 'confirmada'], sessao, { atendimentoId });
        await aplicarEscala(tx, a, { diaristaId, designacaoOrigem: 'manual', escalaEstado: 'para_revisar', escalaVersao: (a.escalaVersao || 0) + 1, escalaRecusa: null, escalaEnvio: null, escalaSugestao: null },
          { evento: 'standby_utilizado', ator: 'prime', atorId: sessao.id, por: sessao.nome || null, diaristaId, anterior: a.diaristaId || null });
        return r;
      }));
    },
    async vinculosFixos(pedidoId, { sessao } = {}) {
      exigirPrime(sessao);
      return repo.leitura(TODOS, async (tx) => {
        const D = Object.fromEntries((await tx.todos('diaristas')).map((x) => [x.id, x]));
        const itens = (await tx.por('vinculosFixos', 'pedidoId', pedidoId)).map((v) => ({ ...v, nome: D[v.diaristaId]?.nome || '' }))
          .sort((x, y) => x.diaSemana - y.diaSemana || String(y.vigenteDesde).localeCompare(String(x.vigenteDesde)));
        return { itens };
      });
    },
    async salvarVinculoFixo(pedidoId, { diaSemana, diaristaId } = {}, { sessao, chave } = {}) {
      exigirAdmin(sessao);
      return repo.transacao(TODOS, (tx) => idem(tx, 'salvarVinculoFixo', sessao, chave, { pedidoId, diaSemana, diaristaId }, async () => {
        const p = await tx.get('pedidos', pedidoId);
        if (!p || p.modalidade !== 'pacote') throw new ErroNegocio('CONDICAO_NAO_ATENDIDA', 'Vínculo fixo só existe em pacote');
        if (!(Number.isInteger(diaSemana) && diaSemana >= 0 && diaSemana <= 6)) throw new ErroNegocio('DADOS_INVALIDOS', 'Dia da semana inválido');
        if ((await tx.get('diaristas', diaristaId))?.status !== 'aprovada') throw new ErroNegocio('NAO_ENCONTRADO', 'Profissional não encontrada');
        return trocarVinculo(tx, p, diaSemana, diaristaId, sessao, null);
      }));
    },
    async encerrarVinculoFixo(vinculoId, motivo, { sessao, chave } = {}) {
      exigirAdmin(sessao);
      return repo.transacao(TODOS, (tx) => idem(tx, 'encerrarVinculoFixo', sessao, chave, { vinculoId, motivo: motivo || null }, async () => {
        const v = await tx.get('vinculosFixos', vinculoId);
        if (!v || v.encerradoEm) throw new ErroNegocio('NAO_ENCONTRADO', 'Vínculo não encontrado ou já encerrado');
        await tx.put('vinculosFixos', { ...v, encerradoEm: agoraISO(), encerradoPor: sessao.id, motivo: String(motivo || '').trim().slice(0, 280) || null });
        return { id: v.id, encerrado: true };
      }));
    },
    async configAgenda({ sessao } = {}) {
      exigirPrime(sessao);
      return repo.leitura(TODOS, (tx) => lerConfig(tx));
    },
    async salvarConfigAgenda(valor = {}, { sessao } = {}) {
      exigirAdmin(sessao);
      const prazo = valor.prazoSemRespostaMin === null || valor.prazoSemRespostaMin === '' || valor.prazoSemRespostaMin === undefined ? null : Number(valor.prazoSemRespostaMin);
      if (prazo !== null && !(Number.isInteger(prazo) && prazo >= 15 && prazo <= 1440)) throw new ErroNegocio('DADOS_INVALIDOS', 'Prazo entre 15 minutos e 24 horas (ou desligado)');
      const vp = valor.verificacaoPagamento || {};
      if (vp.ligada && !/^([01]\d|2[0-3]):[0-5]\d$/.test(vp.hora || '')) throw new ErroNegocio('DADOS_INVALIDOS', 'Informe o horário da verificação');
      const alerta = Number(valor.standbyAlertaMin ?? 60);
      if (!(Number.isInteger(alerta) && alerta >= 0 && alerta <= 600)) throw new ErroNegocio('DADOS_INVALIDOS', 'Alerta do stand-by entre 0 e 600 minutos');
      return repo.transacao(TODOS, async (tx) => {
        const atual = await lerConfig(tx);
        const novo = { ...atual, prazoSemRespostaMin: prazo, verificacaoPagamento: { ligada: !!vp.ligada, hora: vp.ligada ? vp.hora : null }, standbyAlertaMin: alerta };
        await tx.put('configPainel', { chave: 'agenda_escala', valor: novo });
        return novo;
      });
    },
    async definirCanalAtivo(canal, motivo, { sessao } = {}) {
      exigirAdmin(sessao);
      if (!['whatsapp', 'portal'].includes(canal)) throw new ErroNegocio('DADOS_INVALIDOS', 'Canal inválido');
      const mot = String(motivo || '').trim().slice(0, 280);
      if (mot.length < 3) throw new ErroNegocio('DADOS_INVALIDOS', 'Escreva o motivo da troca de canal');
      return repo.transacao(TODOS, async (tx) => {
        const atual = await lerConfig(tx);
        if (atual.canalAtivo === canal) return { canalAtivo: canal };
        const novo = { ...atual, canalAtivo: canal, historicoCanal: [...(atual.historicoCanal || []), { de: atual.canalAtivo, para: canal, motivo: mot, em: agoraISO(), por: sessao.nome || sessao.id }] };
        await tx.put('configPainel', { chave: 'agenda_escala', valor: novo });
        return { canalAtivo: canal };
      });
    },
    async definirParceria(clienteId, parceria, { sessao } = {}) {
      exigirAdmin(sessao);
      return repo.transacao(TODOS, async (tx) => {
        const c = await tx.get('clientes', clienteId);
        if (!c) throw new ErroNegocio('NAO_ENCONTRADO', 'Cliente não encontrada');
        await tx.put('clientes', { ...c, parceria: !!parceria });
        return { id: c.id, parceria: !!parceria };
      });
    },
  };

  async function responder(tx, a, resposta, { canal, motivo, ator, atorId }) {
    if (resposta === 'aceite') {
      const para = transicionarEscala(a, 'aceitar', { ator: ator === 'prime' ? 'prime' : 'sistema' });
      const n = await aplicarEscala(tx, a, { escalaEstado: para, escalaEnvio: { ...(a.escalaEnvio || {}), respondidaEm: agoraISO(), resposta: 'aceite', canalResposta: canal } },
        { evento: 'escala_aceite', ator, atorId, canal, diaristaId: a.diaristaId });
      await registrarEvento(tx, 'escala_aceita', { atendimentoId: a.id, pedidoId: a.pedidoId, diaristaId: a.diaristaId }, { versao: a.escalaVersao || 0 }); // D04: endereço completo, se já pago
      return { id: n.id, escalaEstado: n.escalaEstado };
    }
    transicionarEscala(a, 'recusar', { ator: ator === 'prime' ? 'prime' : 'sistema' });
    const d = await tx.get('diaristas', a.diaristaId);
    const n = await aplicarEscala(tx, a, { diaristaId: null, designacaoOrigem: null, escalaEstado: 'para_revisar', escalaVersao: (a.escalaVersao || 0) + 1, escalaSemAuto: true, escalaSugestao: null,
      escalaEnvio: { ...(a.escalaEnvio || {}), respondidaEm: agoraISO(), resposta: 'recusa', canalResposta: canal },
      escalaRecusa: { diaristaId: a.diaristaId, nome: d?.nome || null, em: agoraISO(), canal, motivo: String(motivo || '').trim().slice(0, 280) || null } },
    { evento: 'escala_recusa', ator, atorId, canal, diaristaId: a.diaristaId });
    return { id: n.id, escalaEstado: n.escalaEstado };
  }

  async function mudarStandby(tx, diaristaId, data, estado, de, sessao, extra = {}) {
    const k = `${diaristaId}:${data}`; const s = await tx.get('standbyDecisoes', k);
    if (!s || !de.includes(s.estado)) throw new ErroNegocio('TRANSICAO_PROIBIDA', 'Stand-by não está reservado');
    await tx.put('standbyDecisoes', { ...s, ...extra, estado, decididoPor: sessao.id, em: agoraISO(), historico: [...(s.historico || []), { estado, em: agoraISO(), por: sessao.nome || sessao.id, ...extra }] });
    return { diaristaId, data, estado };
  }

  /** Encerra o vínculo vigente do dia da semana, cria o novo e aplica nas diárias futuras ainda não comunicadas. */
  async function trocarVinculo(tx, p, diaSemana, diaristaId, sessao, excetoId) {
    const agora = agoraISO(); const hoje = hojeSP();
    for (const v of (await tx.por('vinculosFixos', 'pedidoId', p.id)).filter((x) => x.diaSemana === diaSemana && !x.encerradoEm)) {
      await tx.put('vinculosFixos', { ...v, encerradoEm: agora, encerradoPor: sessao.id, motivo: 'troca de profissional fixa' });
    }
    const novo = { id: gerarId(), pedidoId: p.id, diaSemana, diaristaId, vigenteDesde: agora, encerradoEm: null, criadoPor: sessao.id };
    await tx.put('vinculosFixos', novo);
    let aplicadas = 0; let comunicadas = 0;
    for (const a of (await tx.por('atendimentos', 'pedidoId', p.id)).filter((x) => x.id !== excetoId && x.data >= hoje && dow(x.data) === diaSemana && ['agendado', 'confirmado'].includes(x.status))) {
      if (COMUNICADA.includes(a.escalaEstado)) { comunicadas++; continue; } // já comunicada: a equipe decide (alerta da fixa)
      if (a.diaristaId === diaristaId) continue;
      await aplicarEscala(tx, a, { diaristaId, designacaoOrigem: 'fixa', escalaEstado: 'para_revisar', escalaVersao: (a.escalaVersao || 0) + 1, escalaSugestao: null, escalaSemAuto: false },
        { evento: 'escala_fixa', ator: 'prime', atorId: sessao.id, diaristaId, anterior: a.diaristaId || null });
      aplicadas++;
    }
    return { id: novo.id, aplicadas, comunicadas };
  }

  return casos;
}
