// Casos de uso do painel v2 (spec-painel-v2, etapa B) no mock. O Supabase faz o mesmo em RPC (migrations 20261018*).
// Mesmas formas de resposta dos dois lados; o que só existe no banco real (horas extras, ocorrências, falhas do worker)
// aqui volta vazio.
import { ErroNegocio } from '../domain/modelo.js';
import { REGRAS } from '../automacoes/catalogo.js';

const REGRA = Object.fromEntries(REGRAS.map((r) => [r.codigo, r]));

const TODOS = null;
const exigirPrime = (sessao) => { if (sessao?.ator !== 'prime') throw new ErroNegocio('ATOR_SEM_PERMISSAO', 'Só a Prime'); };
const mascTel = (t) => { const d = String(t || '').replace(/\D/g, ''); return d.length >= 8 ? `(${d.slice(0, 2)}) •••••-${d.slice(-4)}` : ''; };
const ROT_PEDIDO = { solicitado: 'Nova', aguardando_pagamento: 'Aguardando pagamento', confirmado: 'Confirmada', concluido: 'Concluída', cancelado: 'Cancelada', recusado: 'Recusada' };

const somar = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const dow = (d) => new Date(`${d}T12:00:00Z`).getUTCDay();
const brl = (c) => `R$ ${(c / 100).toFixed(2).replace('.', ',')}`;
const ddmm = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const primeiro = (n) => String(n || '').split(' ')[0];
const num6 = (n) => String(n ?? '').padStart(6, '0');
const HABILIDADES = ['residencial', 'empresarial', 'passadoria', 'pre_pos_mudanca', 'pre_pos_evento', 'pos_obra'];
const ambientes = (car) => (car?.ambientesTotal ?? (car?.ambientes && typeof car.ambientes === 'object' ? Object.values(car.ambientes).reduce((t, v) => t + (Number(v) || 0), 0) : null));
const fimMin = (a) => { const [h, m] = String(a.horaInicio || '08:00').split(':').map(Number); return h * 60 + m + (a.duracaoMinutos || 240); };
const iniMin = (a) => { const [h, m] = String(a.horaInicio || '08:00').split(':').map(Number); return h * 60 + m; };

export function criarCasosPainel({ repo, idem, agoraISO, hojeSP, gerarId, registrarEvento, pagamentoDaDiariaConfirmado, motivosBase }) {
  const endereco = (a, p, c) => a?.endereco || p?.endereco || c?.endereco || {};
  async function motivosAtuais(tx) {
    const salvos = await tx.todos('motivos');
    const base = motivosBase();
    const lista = [];
    for (const tipo of ['recusa', 'cancelamento']) {
      base[tipo].forEach((m, i) => lista.push({ tipo, codigo: m.codigo, rotulo: m.rotulo, ativo: true, ordem: i + 1 }));
    }
    for (const m of salvos) { const i = lista.findIndex((x) => x.tipo === m.tipo && x.codigo === m.codigo); if (i >= 0) lista[i] = m; else lista.push(m); }
    return lista.sort((a, b) => a.tipo.localeCompare(b.tipo) || Number(a.codigo === 'outro') - Number(b.codigo === 'outro') || a.ordem - b.ordem || a.rotulo.localeCompare(b.rotulo));
  }
  async function pendenciasLista(tx) {
    const hoje = hojeSP(); const agora = agoraISO();
    const [peds, ats, pgs, cls, dias, sols] = await Promise.all(['pedidos', 'atendimentos', 'pagamentos', 'clientes', 'diaristas', 'solicitacoesProfissional'].map((n) => tx.todos(n)));
    const P = Object.fromEntries(peds.map((x) => [x.id, x])); const C = Object.fromEntries(cls.map((x) => [x.id, x])); const D = Object.fromEntries(dias.map((x) => [x.id, x]));
    const r = [];
    for (const a of ats.filter((x) => !x.diaristaId && ['agendado', 'confirmado'].includes(x.status) && ['aguardando_pagamento', 'confirmado'].includes(P[x.pedidoId]?.status) && x.data >= hoje && x.data <= somar(hoje, 7)).sort((x, y) => x.data.localeCompare(y.data))) {
      const p = P[a.pedidoId];
      r.push({ id: `sem:${a.id}`, tipo: 'sem_profissional', categoria: 'escala', urgente: a.data <= somar(hoje, 1), titulo: `Diária ${a.data === hoje ? 'de hoje' : a.data === somar(hoje, 1) ? 'de amanhã' : `de ${ddmm(a.data)}`} sem profissional`,
        sub: [`${ddmm(a.data)}${a.horaInicio ? ` · ${a.horaInicio}` : ''}`, endereco(a, p, C[p.clienteId]).bairro].filter(Boolean).join(' · '), ref: { atendimentoId: a.id, pedidoId: p.id, data: a.data }, em: a.data });
    }
    for (const a of ats.filter((x) => x.diaristaId && ['agendado', 'confirmado'].includes(x.status) && x.data >= hoje && x.data <= somar(hoje, 7))) {
      const outra = ats.find((y) => y.id !== a.id && y.diaristaId === a.diaristaId && y.status !== 'cancelado' && y.data === a.data && iniMin(y) < fimMin(a) && iniMin(a) < fimMin(y));
      if (outra) r.push({ id: `sub:${a.id}`, tipo: 'substituicao', categoria: 'escala', urgente: a.data <= somar(hoje, 1), titulo: `Substituir ${primeiro(D[a.diaristaId]?.nome)} em ${ddmm(a.data)}`, sub: `Já tem diária das ${outra.horaInicio}`, ref: { atendimentoId: a.id, pedidoId: a.pedidoId, diaristaId: a.diaristaId, data: a.data }, em: a.data });
    }
    for (const g of pgs.filter((x) => x.status === 'informado_pelo_cliente')) {
      const p = P[g.pedidoId]; const c = C[p?.clienteId];
      r.push({ id: `pag:${g.id}`, tipo: 'pagamento_informado', categoria: 'financeiro', urgente: !!g.informadoEm && Date.parse(agora) - Date.parse(g.informadoEm) > 2 * 3600000, titulo: `Conferir pagamento de ${primeiro(c?.nome)}`, sub: brl(g.valorCentavos), ref: { pagamentoId: g.id, pedidoId: g.pedidoId, valorCentavos: g.valorCentavos }, em: g.informadoEm || g.criadoEm });
    }
    for (const g of pgs.filter((x) => x.status === 'pendente' && x.venceEm && !['cancelado', 'recusado'].includes(P[x.pedidoId]?.status) && Date.parse(`${x.venceEm}T${x.venceAs || '14:00'}:00-03:00`) <= Date.parse(agora))) {
      const c = C[P[g.pedidoId]?.clienteId];
      r.push({ id: `venc:${g.id}`, tipo: 'pagamento_vencido', categoria: 'financeiro', urgente: true, titulo: `Pagamento vencido de ${primeiro(c?.nome)}`, sub: `${brl(g.valorCentavos)} · venceu ${ddmm(g.venceEm)}`, ref: { pagamentoId: g.id, pedidoId: g.pedidoId }, em: g.venceEm });
    }
    for (const x of sols.filter((y) => y.estado === 'pendente')) r.push({ id: `sol:${x.id}`, tipo: x.tipo, categoria: 'financeiro', urgente: false, titulo: x.tipo === 'adiantamento' ? 'Aprovar adiantamento' : 'Uber / transporte', sub: [D[x.diaristaId]?.nome, brl(x.valorCentavos), x.descricao].filter(Boolean).join(' · '), ref: { solicitacaoId: x.id, diaristaId: x.diaristaId, atendimentoId: x.atendimentoId }, em: x.criadoEm });
    for (const p of peds.filter((y) => y.status === 'solicitado' && y.pacoteEnderecoNovo)) r.push({ id: `end:${p.id}`, tipo: 'pacote_endereco_novo', categoria: 'contratos', urgente: false, titulo: 'Pacote com endereço novo', sub: [C[p.clienteId]?.nome, `nº ${num6(p.numeroSolicitacao)}`].join(' · '), ref: { pedidoId: p.id }, em: p.criadoEm });
    for (const d of dias.filter((y) => y.status === 'pendente')) r.push({ id: `cad:${d.id}`, tipo: 'cadastro_profissional', categoria: 'contratos', urgente: false, titulo: 'Cadastro de profissional pra analisar', sub: d.nome, ref: { diaristaId: d.id }, em: d.atualizadoEm || d.criadoEm || '' });
    return r;
  }
  const ordenar = (l) => [...l].sort((a, b) => Number(b.urgente) - Number(a.urgente) || String(a.em).localeCompare(String(b.em)));

  const casos = {
    async buscarGlobal(termo, { sessao } = {}) {
      exigirPrime(sessao);
      const t = String(termo || '').trim(); const d = t.replace(/\D/g, '');
      if (t.length < 3) throw new ErroNegocio('DADOS_INVALIDOS', 'Digite pelo menos 3 caracteres');
      const tipo = t.includes('@') ? 'email' : d.length >= 1 && d.length <= 7 && d.length === t.replace(/[\s#nº.]/gi, '').length ? 'numero_solicitacao'
        : d.length >= 8 && d.length === t.replace(/[\s.\-/()]/g, '').length ? 'numero' : 'texto';
      const low = t.toLowerCase();
      return repo.leitura(TODOS, async (tx) => {
        const clientes = (await tx.todos('clientes')).filter((c) => !c.anonimizadoEm);
        const itens = [];
        const bate = (c) => (tipo === 'email' ? (c.email || '').toLowerCase() === low : tipo === 'numero' ? c.cpf === d || c.cnpj === d || String(c.telefone || '').endsWith(d) : tipo === 'texto' ? (c.nome || '').toLowerCase().includes(low) : false);
        for (const c of clientes.filter(bate).sort((a, b) => a.nome.localeCompare(b.nome)).slice(0, 8)) itens.push({ tipo: 'cliente', id: c.id, titulo: c.nome, sub: [mascTel(c.telefone), c.endereco?.bairro, c.endereco?.cidade].filter(Boolean).join(' · ') });
        if (tipo === 'texto') {
          const ends = (await tx.todos('enderecos')).filter((e) => e.ativo && (`${e.logradouro || ''}`.toLowerCase().includes(low) || `${e.bairro || ''}`.toLowerCase().includes(low)));
          for (const e of ends.slice(0, 6)) { const c = clientes.find((x) => x.id === e.clienteId); if (c && !bate(c)) itens.push({ tipo: 'endereco', id: c.id, titulo: c.nome, sub: [[e.logradouro, e.numero].filter(Boolean).join(', '), e.bairro, e.cidade].filter(Boolean).join(' · ') }); }
        }
        const dias = (await tx.todos('diaristas')).filter((x) => x.status !== 'rascunho' && (tipo === 'email' ? (x.email || '').toLowerCase() === low : tipo === 'numero' ? x.cpf === d || String(x.telefone || '').endsWith(d) : tipo === 'texto' ? x.nome.toLowerCase().includes(low) : false));
        for (const x of dias.slice(0, 6)) itens.push({ tipo: 'profissional', id: x.id, titulo: x.nome, sub: [mascTel(x.telefone), x.status === 'aprovada' ? 'Ativa' : x.status === 'pendente' ? 'Cadastro pra analisar' : x.status].filter(Boolean).join(' · ') });
        if (tipo === 'numero_solicitacao') {
          for (const p of (await tx.todos('pedidos')).filter((x) => Number(x.numeroSolicitacao) === Number(d)).slice(0, 3)) {
            const c = clientes.find((x) => x.id === p.clienteId);
            itens.push({ tipo: 'solicitacao', id: p.id, titulo: `Solicitação nº ${String(p.numeroSolicitacao).padStart(6, '0')}`, sub: [c?.nome, ROT_PEDIDO[p.status] || p.status].filter(Boolean).join(' · ') });
          }
        }
        return { itens };
      });
    },
    async painelSistemaHoje({ sessao } = {}) {
      exigirPrime(sessao);
      const hoje = hojeSP();
      return repo.leitura(TODOS, async (tx) => {
        const ok = (await tx.todos('execucoes')).filter((e) => ['enviada', 'entregue', 'lida', 'simulada'].includes(e.estado) && !e.teste && (e.atualizadoEm || '').slice(0, 10) >= hoje)
          .sort((a, b) => b.atualizadoEm.localeCompare(a.atualizadoEm));
        return { total: ok.length, itens: ok.slice(0, 30).map((e) => ({ em: e.atualizadoEm, regra: e.regra, descricao: REGRA[e.regra]?.descricao || e.regra })) };
      });
    },
    async painelResumo({ sessao } = {}) {
      exigirPrime(sessao);
      return repo.leitura(TODOS, async (tx) => {
        const l = await pendenciasLista(tx);
        return { solicitacoesNovas: (await tx.todos('pedidos')).filter((p) => p.status === 'solicitado').length, pendencias: l.length, urgentes: l.filter((x) => x.urgente).length };
      });
    },
    async painelPendencias({ sessao } = {}) {
      exigirPrime(sessao);
      return repo.leitura(TODOS, async (tx) => { const l = ordenar(await pendenciasLista(tx)); return { itens: l, urgentes: l.filter((x) => x.urgente).length }; });
    },
    async painelSolicitacoesNovas(limite = 20, { sessao } = {}) {
      exigirPrime(sessao);
      return repo.leitura(TODOS, async (tx) => {
        const peds = (await tx.todos('pedidos')).filter((p) => p.status === 'solicitado').sort((a, b) => a.criadoEm.localeCompare(b.criadoEm));
        const ats = await tx.todos('atendimentos'); const C = Object.fromEntries((await tx.todos('clientes')).map((c) => [c.id, c]));
        const itens = peds.slice(0, Math.min(Math.max(Number(limite) || 20, 1), 100)).map((p) => {
          const lista = ats.filter((a) => a.pedidoId === p.id && a.status !== 'cancelado').sort((a, b) => a.data.localeCompare(b.data) || String(a.horaInicio).localeCompare(String(b.horaInicio)));
          const a = lista[0] || {}; const c = C[p.clienteId] || {}; const e = endereco(a, p, c);
          return { pedidoId: p.id, numero: p.numeroSolicitacao ?? null, criadoEm: p.criadoEm, modalidade: p.modalidade || null,
            cliente: { id: c.id, nome: c.nome, telefone: c.telefone, tipo: c.tipo }, local: { bairro: e.bairro, cidade: e.cidade },
            servico: a.servico || p.pacote?.tipoServico, quantidade: lista.length, primeiraData: a.data, horaInicio: a.horaInicio || null,
            horas: Math.round(((a.duracaoMinutos || (p.pacote?.duracaoHoras || 0) * 60) / 60) * 10) / 10,
            imovel: { metragem: a.caracteristicas?.metragem ?? p.pacote?.metragem ?? null, ambientes: ambientes(a.caracteristicas), pecas: a.caracteristicas?.pecas ?? null, animais: !!a.caracteristicas?.animais?.tem, refeicao: a.localRefeicao ?? null },
            valorCentavos: p.pacote?.totalCentavos ?? 0, origem: p.origemCliente || null, enderecoNovoPacote: !!p.pacoteEnderecoNovo, proposta: p.propostaData || null };
        }).sort((x, y) => String(x.primeiraData).localeCompare(String(y.primeiraData)) || String(x.horaInicio).localeCompare(String(y.horaInicio)));
        return { total: peds.length, itens };
      });
    },
    async painelDiarias(data, { sessao } = {}) {
      exigirPrime(sessao);
      if (!data) throw new ErroNegocio('DADOS_INVALIDOS', 'Informe a data');
      return repo.leitura(TODOS, async (tx) => {
        const P = Object.fromEntries((await tx.todos('pedidos')).map((x) => [x.id, x])); const C = Object.fromEntries((await tx.todos('clientes')).map((x) => [x.id, x]));
        const D = Object.fromEntries((await tx.todos('diaristas')).map((x) => [x.id, x])); const todosAt = await tx.todos('atendimentos');
        const pgs = await tx.todos('pagamentos'); const avs = await tx.todos('avaliacoes'); const esc = await tx.get('escalas', data);
        const itens = todosAt.filter((a) => a.data === data && a.status !== 'cancelado' && !['solicitado', 'recusado', 'cancelado'].includes(P[a.pedidoId]?.status))
          .sort((a, b) => String(a.horaInicio).localeCompare(String(b.horaInicio))).map((a) => {
            const p = P[a.pedidoId]; const c = C[p.clienteId] || {}; const e = endereco(a, p, c); const d = D[a.diaristaId];
            const doPedido = pgs.filter((g) => g.pedidoId === p.id);
            const pago = pagamentoDaDiariaConfirmado(doPedido, a, todosAt.filter((x) => x.pedidoId === p.id), p);
            const pagamento = doPedido.some((g) => g.parcela === 'faturamento' && g.status !== 'cancelado') ? { estado: 'a_faturar' } : pago ? { estado: 'pago', forma: doPedido.some((g) => g.status === 'confirmado' && /cart/i.test(g.metodo || '')) ? 'cartao' : 'pix' } : { estado: 'pendente', forma: 'pix' };
            return { id: a.id, pedidoId: p.id, numero: p.numeroSolicitacao ?? null, horaInicio: a.horaInicio || null, duracaoMinutos: a.duracaoMinutos || (p.pacote?.duracaoHoras || 0) * 60, status: a.status,
              servico: a.servico || p.pacote?.tipoServico, modalidade: p.modalidade || null, cliente: { id: c.id, nome: c.nome, telefone: c.telefone },
              local: { logradouro: e.logradouro, numero: e.numero, complemento: e.complemento, bairro: e.bairro, cidade: e.cidade, pontoReferencia: e.pontoReferencia, tipoImovel: e.tipoImovel },
              profissional: d ? { id: d.id, nome: d.nome, telefone: d.telefone, habilidades: d.habilidades || [] } : null, pagamento,
              nota: avs.find((v) => v.atendimentoId === a.id)?.notaFinal ?? null, caracteristicas: a.caracteristicas || null, localRefeicao: a.localRefeicao ?? null,
              justificativa: a.justificativa || null, observacao: p.observacaoDisponibilidade || null, historico: a.historico || [] };
          });
        const alteradaDepois = esc?.estado === 'publicada' && todosAt.some((a) => a.data === data && (a.atualizadoEm || '') > esc.publicadaEm);
        return { data, itens, confirmadas: itens.filter((i) => i.status !== 'agendado' && i.profissional).length, pendentes: itens.filter((i) => i.status === 'agendado' || !i.profissional).length,
          escala: { estado: esc?.estado || 'em_preparacao', versao: esc?.versao || 0, publicadaEm: esc?.publicadaEm || null, publicadaPor: esc?.publicadaPor || null, revisadaEm: esc?.revisadaEm || null, alteradaDepois } };
      });
    },
    async painelStandby(data, { sessao } = {}) {
      exigirPrime(sessao);
      const d0 = data || hojeSP();
      return repo.leitura(TODOS, async (tx) => {
        const ats = await tx.todos('atendimentos'); const dec = Object.fromEntries((await tx.todos('standbyDecisoes')).filter((x) => x.data === d0).map((x) => [x.diaristaId, x.estado]));
        const itens = (await tx.todos('diaristas')).filter((d) => d.status === 'aprovada' && (d.disponibilidade?.dias || []).includes(dow(d0)) && !ats.some((a) => a.diaristaId === d.id && a.data === d0 && a.status !== 'cancelado') && dec[d.id] !== 'liberada')
          .map((d) => ({ diaristaId: d.id, nome: d.nome, telefone: d.telefone, habilidades: d.habilidades || [], turnos: d.disponibilidade?.turnos || [], regioes: d.disponibilidade?.regioes || [], estado: dec[d.id] || 'standby' }))
          .sort((a, b) => Number(a.estado !== 'standby') - Number(b.estado !== 'standby') || a.nome.localeCompare(b.nome));
        return { data: d0, itens };
      });
    },
    async painelAlertas({ sessao } = {}) {
      exigirPrime(sessao);
      const hoje = hojeSP();
      return repo.leitura(TODOS, async (tx) => {
        const peds = (await tx.todos('pedidos')).filter((p) => p.status === 'confirmado'); const ats = await tx.todos('atendimentos'); const C = Object.fromEntries((await tx.todos('clientes')).map((x) => [x.id, x]));
        const itens = [];
        const fim = peds.map((p) => { const l = ats.filter((a) => a.pedidoId === p.id && a.status !== 'cancelado').map((a) => a.data).sort(); return { p, n: l.length, ultima: l.at(-1) }; }).filter((x) => x.n >= 2);
        for (const x of fim.filter((y) => y.ultima === somar(hoje, 1))) itens.push({ tipo: 'pacote_vence', titulo: `Pacote de ${primeiro(C[x.p.clienteId]?.nome)} vence amanhã`, sub: `Última de ${x.n} diárias: hora de oferecer a renovação`, ref: { pedidoId: x.p.id, clienteId: x.p.clienteId } });
        const semana = fim.filter((y) => y.ultima >= somar(hoje, 2) && y.ultima <= somar(hoje, 7));
        if (semana.length > 2) itens.push({ tipo: 'pacotes_semana', titulo: `${semana.length} pacotes vencem nos próximos 7 dias`, sub: 'Veja a lista de renovação', ref: {} });
        else for (const x of semana) itens.push({ tipo: 'pacote_vence', titulo: `Pacote de ${primeiro(C[x.p.clienteId]?.nome)} vence em ${ddmm(x.ultima)}`, sub: `Última de ${x.n} diárias`, ref: { pedidoId: x.p.id, clienteId: x.p.clienteId } });
        const limite = Date.now() - 7 * 86400000;
        for (const v of (await tx.todos('avaliacoes')).filter((y) => Number(y.notaFinal) <= 3 && Date.parse(y.criadoEm || 0) > limite)) {
          const a = ats.find((y) => y.id === v.atendimentoId); const p = a && (await tx.get('pedidos', a.pedidoId));
          if (p) itens.push({ tipo: 'avaliacao_baixa', titulo: `Avaliação baixa recebida: ${String(v.notaFinal).replace('.', ',')}`, sub: `Cliente: ${C[p.clienteId]?.nome} · nº ${num6(p.numeroSolicitacao)}`, ref: { atendimentoId: a.id, pedidoId: p.id, clienteId: p.clienteId } });
        }
        return { itens };
      });
    },
    async painelIndicadoresHome(mes, { sessao } = {}) {
      exigirPrime(sessao);
      const hoje = hojeSP();
      const ini = /^\d{4}-\d{2}$/.test(mes || '') ? `${mes}-01` : `${hoje.slice(0, 7)}-01`;
      const prox = new Date(Date.UTC(Number(ini.slice(0, 4)), Number(ini.slice(5, 7)), 1)).toISOString().slice(0, 10);
      const ant = new Date(Date.UTC(Number(ini.slice(0, 4)), Number(ini.slice(5, 7)) - 2, 1)).toISOString().slice(0, 10);
      const fim = somar(prox, -1);
      return repo.leitura(TODOS, async (tx) => {
        const ats = await tx.todos('atendimentos'); const P = Object.fromEntries((await tx.todos('pedidos')).map((x) => [x.id, x])); const C = Object.fromEntries((await tx.todos('clientes')).map((x) => [x.id, x]));
        const cfg = await tx.get('configPainel', 'meta_diarias'); const pct = cfg?.valor?.percentual ?? 10;
        const feitas = (de, ate) => ats.filter((a) => ['finalizado', 'avaliado'].includes(a.status) && a.data >= de && a.data <= ate).length;
        const mesAnterior = feitas(ant, somar(ini, -1)); const realizadas = feitas(ini, fim);
        const agendadas = ats.filter((a) => ['agendado', 'confirmado', 'diarista_a_caminho', 'em_andamento'].includes(a.status) && a.data >= (hoje > ini ? hoje : ini) && a.data <= fim && ['aguardando_pagamento', 'confirmado'].includes(P[a.pedidoId]?.status)).length;
        const meta = Math.ceil(mesAnterior * (1 + pct / 100));
        const motivos = (await motivosAtuais(tx)).filter((m) => m.tipo === 'cancelamento');
        const canc = {};
        for (const a of ats.filter((x) => x.status === 'cancelado' && x.data >= ini && x.data <= fim)) {
          const txt = P[a.pedidoId]?.cancelamento?.motivo || '';
          const m = P[a.pedidoId]?.cancelamento?.codigo ? motivos.find((x) => x.codigo === P[a.pedidoId].cancelamento.codigo) : motivos.filter((x) => txt.startsWith(x.rotulo)).sort((x, y) => y.rotulo.length - x.rotulo.length)[0];
          const k = m?.codigo || 'sem_motivo'; canc[k] = (canc[k] || 0) + 1;
        }
        const reg = {};
        for (const a of ats.filter((x) => x.data >= ini && x.data <= fim && x.status !== 'cancelado' && ['aguardando_pagamento', 'confirmado', 'concluido'].includes(P[x.pedidoId]?.status))) {
          const p = P[a.pedidoId]; const e = endereco(a, p, C[p.clienteId]); const cid = e.cidade || 'Sem cidade'; const bai = e.bairro || 'Sem bairro';
          reg[cid] ||= { total: 0, b: {} }; reg[cid].total++; reg[cid].b[bai] = (reg[cid].b[bai] || 0) + 1;
        }
        return { mes: ini.slice(0, 7), meta: { percentual: pct, mesAnterior, meta, realizadas, agendadas, faltam: Math.max(meta - realizadas - agendadas, 0) },
          cancelamentos: Object.entries(canc).map(([codigo, total]) => ({ codigo, rotulo: motivos.find((m) => m.codigo === codigo)?.rotulo || 'Sem motivo registrado', total })).sort((a, b) => b.total - a.total || a.codigo.localeCompare(b.codigo)),
          regioes: Object.entries(reg).map(([cidade, x]) => ({ cidade, total: x.total, bairros: Object.entries(x.b).map(([bairro, total]) => ({ bairro, total })).sort((a, b) => b.total - a.total || a.bairro.localeCompare(b.bairro)) })).sort((a, b) => b.total - a.total || a.cidade.localeCompare(b.cidade)) };
      });
    },
    async painelSolicitacoes(filtro = {}, { sessao } = {}) {
      exigirPrime(sessao);
      const EST = { novas: ['solicitado'], aguardando: ['aguardando_pagamento', 'disponibilidade_confirmada'], confirmadas: ['confirmado'], concluidas: ['concluido'], recusadas: ['recusado'], canceladas: ['cancelado'] };
      const lim = Math.min(Math.max(Number(filtro.limite) || 50, 1), 200); const pag = Math.max(Number(filtro.pagina) || 0, 0);
      return repo.leitura(TODOS, async (tx) => {
        const ats = await tx.todos('atendimentos'); const C = Object.fromEntries((await tx.todos('clientes')).map((c) => [c.id, c]));
        const itens = (await tx.todos('pedidos')).map((p) => {
          const lista = ats.filter((a) => a.pedidoId === p.id).sort((a, b) => Number(a.status === 'cancelado') - Number(b.status === 'cancelado') || a.data.localeCompare(b.data));
          const a = lista[0] || {}; const c = C[p.clienteId] || {}; const e = endereco(a, p, c);
          return { pedidoId: p.id, numero: p.numeroSolicitacao ?? null, criadoEm: p.criadoEm, status: p.status, modalidade: p.modalidade || null,
            cliente: { id: c.id, nome: c.nome, telefone: c.telefone, tipo: c.tipo }, local: { bairro: e.bairro, cidade: e.cidade }, servico: a.servico || p.pacote?.tipoServico,
            quantidade: lista.filter((x) => x.status !== 'cancelado').length, primeiraData: a.data, horaInicio: a.horaInicio || null,
            horas: Math.round(((a.duracaoMinutos || (p.pacote?.duracaoHoras || 0) * 60) / 60) * 10) / 10,
            imovel: { metragem: a.caracteristicas?.metragem ?? p.pacote?.metragem ?? null, ambientes: ambientes(a.caracteristicas), pecas: a.caracteristicas?.pecas ?? null, animais: !!a.caracteristicas?.animais?.tem, refeicao: a.localRefeicao ?? null },
            valorCentavos: p.pacote?.totalCentavos ?? 0, origem: p.origemCliente || null, enderecoNovoPacote: !!p.pacoteEnderecoNovo, proposta: p.propostaData || null, recusa: p.recusa || null, cancelamento: p.cancelamento || null };
        }).filter((x) => (!EST[filtro.estado] || EST[filtro.estado].includes(x.status)) && (!filtro.modalidade || x.modalidade === filtro.modalidade) && (!filtro.origem || x.origem?.origem === filtro.origem)
          && (!filtro.de || x.primeiraData >= filtro.de) && (!filtro.ate || x.primeiraData <= filtro.ate))
          .sort((a, b) => Number(a.status !== 'solicitado') - Number(b.status !== 'solicitado') || (a.status === 'solicitado' ? String(a.primeiraData).localeCompare(String(b.primeiraData)) : String(b.criadoEm).localeCompare(String(a.criadoEm))));
        return { total: itens.length, pagina: pag, itens: itens.slice(pag * lim, pag * lim + lim) };
      });
    },
    async painelFichaCliente(clienteId, { sessao } = {}) {
      exigirPrime(sessao);
      return repo.leitura(TODOS, async (tx) => {
        const c = await tx.get('clientes', clienteId);
        if (!c || c.anonimizadoEm) throw new ErroNegocio('NAO_ENCONTRADO', 'Cliente não encontrada');
        const peds = await tx.por('pedidos', 'clienteId', c.id); const ids = new Set(peds.map((p) => p.id));
        const ats = (await tx.todos('atendimentos')).filter((a) => ids.has(a.pedidoId)); const pgs = (await tx.todos('pagamentos')).filter((g) => ids.has(g.pedidoId));
        const TIT = { solicitado: 'Solicitação enviada', disponibilidade_confirmada: 'Disponibilidade confirmada', aguardando_pagamento: 'Cobrança emitida', confirmado: 'Solicitação confirmada', concluido: 'Solicitação concluída', cancelado: 'Solicitação cancelada', recusado: 'Solicitação recusada' };
        const tl = [];
        for (const p of peds) for (const h of p.historico || []) if (h.em) tl.push({ tipo: 'pedido', em: h.em, titulo: TIT[h.para] || h.evento || h.para, detalhe: [p.numeroSolicitacao ? `nº ${num6(p.numeroSolicitacao)}` : null, h.para === 'recusado' ? p.recusa?.motivo : h.para === 'cancelado' ? p.cancelamento?.motivo : null].filter(Boolean).join(' · '), ref: { pedidoId: p.id } });
        for (const g of pgs.filter((x) => ['confirmado', 'estornado'].includes(x.status))) tl.push({ tipo: 'pagamento', em: g.confirmadoEm || g.criadoEm, titulo: g.status === 'confirmado' ? 'Pagamento confirmado' : 'Pagamento estornado', detalhe: brl(g.valorCentavos), ref: { pagamentoId: g.id } });
        for (const e of (await tx.todos('execucoes')).filter((x) => x.contexto?.clienteId === c.id && REGRA[x.regra]?.destinatario === 'cliente' && ['enviada', 'entregue', 'lida', 'simulada', 'falhou'].includes(x.estado))) tl.push({ tipo: 'mensagem', em: e.atualizadoEm, titulo: REGRA[e.regra]?.descricao || e.regra, detalhe: e.estado === 'falhou' ? 'não saiu' : 'enviada', ref: { execucaoId: e.id } });
        tl.sort((a, b) => String(b.em).localeCompare(String(a.em)));
        const feitas = ats.filter((a) => ['finalizado', 'avaliado'].includes(a.status)).map((a) => a.data).sort();
        const prox = ats.filter((a) => ['agendado', 'confirmado'].includes(a.status) && a.data >= hojeSP()).map((a) => a.data).sort();
        return { cliente: { id: c.id, nome: c.nome, tipo: c.tipo, telefone: c.telefone, email: c.email, documento: null, razaoSocial: c.razaoSocial || null, responsavel: c.responsavel || null, origem: c.origem || null, criadoEm: c.criadoEm || null, temAcesso: !!(await tx.get('credenciais', c.email)), pendencias: c.pendencias || [] },
          resumo: { pedidos: peds.length, diariasFeitas: feitas.length, ultimaDiaria: feitas.at(-1) || null, proximaDiaria: prox[0] || null, totalPagoCentavos: pgs.filter((g) => g.status === 'confirmado').reduce((t, g) => t + g.valorCentavos, 0) },
          linhaDoTempo: tl.slice(0, 80), consentimentos: [], pedidosDados: [] };
      });
    },
    async painelProfissionais(filtro = {}, { sessao } = {}) {
      exigirPrime(sessao);
      const hoje = hojeSP(); const busca = String(filtro.busca || '').trim().toLowerCase();
      return repo.leitura(TODOS, async (tx) => {
        const ats = await tx.todos('atendimentos'); const avs = await tx.todos('avaliacoes');
        const itens = (await tx.todos('diaristas')).filter((d) => d.status !== 'rascunho' && (!filtro.status || d.status === filtro.status) && (!busca || d.nome.toLowerCase().includes(busca))).map((d) => {
          const minhas = ats.filter((a) => a.diaristaId === d.id); const notas = avs.filter((v) => minhas.some((a) => a.id === v.atendimentoId)).map((v) => Number(v.notaFinal)).filter(Number.isFinite);
          return { id: d.id, nome: d.nome, telefone: d.telefone, status: d.status, habilidades: d.habilidades || [], disponibilidade: d.disponibilidade || null, ordem: d.status === 'pendente' ? '0' : d.status === 'aprovada' ? '1' : '2',
            diariasSemana: minhas.filter((a) => a.status !== 'cancelado' && a.data >= hoje && a.data <= somar(hoje, 6)).length,
            hojeStandby: d.status === 'aprovada' && (d.disponibilidade?.dias || []).includes(dow(hoje)) && !minhas.some((a) => a.data === hoje && a.status !== 'cancelado'), bloqueadaHoje: false, documentosVencidos: 0,
            mediaAvaliacoes: notas.length ? Math.round((notas.reduce((t, n) => t + n, 0) / notas.length) * 10) / 10 : null, avaliacoes: notas.length };
        }).sort((a, b) => a.ordem.localeCompare(b.ordem) || a.nome.localeCompare(b.nome));
        return { itens };
      });
    },
    async marcarEscala(data, acao, motivo, { sessao, chave } = {}) {
      exigirPrime(sessao);
      if (!data || !['revisar', 'publicar', 'reabrir'].includes(acao)) throw new ErroNegocio('DADOS_INVALIDOS', 'Ação de escala inválida');
      const mot = String(motivo || '').trim().replace(/\s+/g, ' ').slice(0, 280);
      return repo.transacao(TODOS, (tx) => idem(tx, 'marcarEscala', sessao, chave, { data, acao, motivo: mot }, async () => {
        if (data < hojeSP()) throw new ErroNegocio('DATA_INVALIDA', 'A escala de um dia que já passou não muda');
        const agora = agoraISO();
        let esc = (await tx.get('escalas', data)) || { data, estado: 'em_preparacao', versao: 0, historico: [] };
        const ats = (await tx.todos('atendimentos')).filter((a) => a.data === data);
        const P = Object.fromEntries((await tx.todos('pedidos')).map((x) => [x.id, x]));
        let avisadas = 0;
        if (acao === 'reabrir') {
          if (mot.length < 3) throw new ErroNegocio('DADOS_INVALIDOS', 'Escreva o motivo da reabertura');
          if (esc.estado === 'em_preparacao') throw new ErroNegocio('TRANSICAO_PROIBIDA', 'A escala já está em preparação');
          esc = { ...esc, estado: 'em_preparacao', historico: [...esc.historico, { de: esc.estado, para: 'em_preparacao', em: agora, por: sessao.id, motivo: mot }] };
        } else if (acao === 'revisar') {
          if (esc.estado !== 'em_preparacao') throw new ErroNegocio('TRANSICAO_PROIBIDA', 'Só uma escala em preparação vira revisada');
          esc = { ...esc, estado: 'revisada', revisadaEm: agora, revisadaPor: sessao.nome || null, historico: [...esc.historico, { de: esc.estado, para: 'revisada', em: agora, por: sessao.id }] };
        } else {
          if (esc.estado === 'publicada' && !ats.some((a) => (a.atualizadoEm || '') > esc.publicadaEm)) throw new ErroNegocio('TRANSICAO_PROIBIDA', 'A escala já está publicada e nada mudou desde então');
          if (ats.some((a) => !a.diaristaId && ['agendado', 'confirmado'].includes(a.status) && ['aguardando_pagamento', 'confirmado'].includes(P[a.pedidoId]?.status))) throw new ErroNegocio('CONDICAO_NAO_ATENDIDA', 'Ainda há diária sem profissional nesse dia. Designe antes de publicar.');
          esc = { ...esc, estado: 'publicada', versao: esc.versao + 1, publicadaEm: agora, publicadaPor: sessao.nome || null, historico: [...esc.historico, { de: esc.estado, para: 'publicada', em: agora, por: sessao.id, versao: esc.versao + 1 }] };
          for (const a of ats.filter((x) => x.diaristaId && ['confirmado', 'agendado'].includes(x.status) && ['aguardando_pagamento', 'confirmado'].includes(P[x.pedidoId]?.status))) {
            await registrarEvento(tx, 'escala_publicada', { atendimentoId: a.id, pedidoId: a.pedidoId, diaristaId: a.diaristaId }, { data, versao: esc.versao }); avisadas++;
          }
        }
        await tx.put('escalas', esc);
        return { escala: { data, estado: esc.estado, versao: esc.versao, publicadaEm: esc.publicadaEm || null, publicadaPor: esc.publicadaPor || null }, avisadas };
      }));
    },
    async decidirStandby(diaristaId, data, decisao, motivo, { sessao } = {}) {
      exigirPrime(sessao);
      if (!['confirmada', 'liberada'].includes(decisao) || !data) throw new ErroNegocio('DADOS_INVALIDOS', 'Decisão inválida');
      return repo.transacao(TODOS, async (tx) => {
        const d = await tx.get('diaristas', diaristaId);
        if (d?.status !== 'aprovada') throw new ErroNegocio('NAO_ENCONTRADO', 'Profissional não encontrada');
        await tx.put('standbyDecisoes', { chave: `${diaristaId}:${data}`, diaristaId, data, estado: decisao, motivo: String(motivo || '').trim().slice(0, 280) || null, decididoPor: sessao.id, em: agoraISO() });
        return { diaristaId, data, estado: decisao };
      });
    },
    async registrarSolicitacaoProfissional(dados = {}, { sessao, chave } = {}) {
      if (!['prime', 'diarista'].includes(sessao?.ator)) throw new ErroNegocio('ATOR_SEM_PERMISSAO', 'Sem permissão');
      return repo.transacao(TODOS, (tx) => idem(tx, 'registrarSolicitacaoProfissional', sessao, chave, dados, async () => {
        const diaristaId = sessao.ator === 'diarista' ? sessao.id : dados.diaristaId;
        if ((await tx.get('diaristas', diaristaId))?.status !== 'aprovada') throw new ErroNegocio('NAO_ENCONTRADO', 'Profissional não encontrada');
        const valor = Number(dados.valorCentavos);
        if (!['adiantamento', 'reembolso_transporte'].includes(dados.tipo) || !Number.isInteger(valor) || valor <= 0 || valor > 500000) throw new ErroNegocio('DADOS_INVALIDOS', 'Informe o tipo e um valor entre R$ 0,01 e R$ 5.000,00');
        if (dados.atendimentoId && (await tx.get('atendimentos', dados.atendimentoId))?.diaristaId !== diaristaId) throw new ErroNegocio('DADOS_INVALIDOS', 'Diária de outra profissional');
        const x = { id: gerarId(), diaristaId, atendimentoId: dados.atendimentoId || null, tipo: dados.tipo, valorCentavos: valor, descricao: String(dados.descricao || '').trim().slice(0, 280), estado: 'pendente', criadoEm: agoraISO() };
        await tx.put('solicitacoesProfissional', x);
        return { id: x.id, estado: x.estado };
      }));
    },
    async decidirSolicitacaoProfissional(id, decisao, motivo, { sessao, chave } = {}) {
      exigirPrime(sessao);
      const mot = String(motivo || '').trim().replace(/\s+/g, ' ').slice(0, 280);
      return repo.transacao(TODOS, (tx) => idem(tx, 'decidirSolicitacaoProfissional', sessao, chave, { id, decisao, motivo: mot }, async () => {
        if (!['aprovada', 'recusada'].includes(decisao)) throw new ErroNegocio('DADOS_INVALIDOS', 'Decisão inválida');
        if (decisao === 'recusada' && mot.length < 3) throw new ErroNegocio('DADOS_INVALIDOS', 'Escreva o motivo da recusa');
        const x = await tx.get('solicitacoesProfissional', id);
        if (!x) throw new ErroNegocio('NAO_ENCONTRADO', 'Pedido não encontrado');
        if (x.estado !== 'pendente') throw new ErroNegocio('TRANSICAO_PROIBIDA', 'Este pedido já foi decidido');
        await tx.put('solicitacoesProfissional', { ...x, estado: decisao, motivo: mot || null, decididoPor: sessao.id, decididoEm: agoraISO() });
        return { id, estado: decisao };
      }));
    },
    async listarSolicitacoesProfissional(filtro = {}, { sessao } = {}) {
      exigirPrime(sessao);
      return repo.leitura(TODOS, async (tx) => {
        const D = Object.fromEntries((await tx.todos('diaristas')).map((x) => [x.id, x]));
        return { itens: (await tx.todos('solicitacoesProfissional')).filter((x) => !filtro.estado || x.estado === filtro.estado).sort((a, b) => b.criadoEm.localeCompare(a.criadoEm))
          .map((x) => ({ ...x, profissional: { id: x.diaristaId, nome: D[x.diaristaId]?.nome } })) };
      });
    },
    async salvarHabilidades(diaristaId, habilidades = [], { sessao } = {}) {
      exigirPrime(sessao);
      if (!habilidades.every((h) => HABILIDADES.includes(h))) throw new ErroNegocio('DADOS_INVALIDOS', 'Habilidade desconhecida');
      return repo.transacao(TODOS, async (tx) => {
        const d = await tx.get('diaristas', diaristaId);
        if (!d) throw new ErroNegocio('NAO_ENCONTRADO', 'Profissional não encontrada');
        const habs = [...new Set(habilidades)].sort();
        await tx.put('diaristas', { ...d, habilidades: habs });
        return { id: d.id, habilidades: habs };
      });
    },
    async motivosPadrao({ sessao } = {}) {
      exigirPrime(sessao);
      return repo.leitura(TODOS, async (tx) => {
        const l = (await motivosAtuais(tx)).filter((m) => m.ativo || m.codigo === 'outro');
        return { recusa: l.filter((m) => m.tipo === 'recusa').map(({ codigo, rotulo }) => ({ codigo, rotulo })), cancelamento: l.filter((m) => m.tipo === 'cancelamento').map(({ codigo, rotulo }) => ({ codigo, rotulo })) };
      });
    },
    async listarMotivos({ sessao } = {}) { exigirPrime(sessao); return repo.leitura(TODOS, async (tx) => ({ itens: (await motivosAtuais(tx)).map(({ tipo, codigo, rotulo, ativo, ordem }) => ({ tipo, codigo, rotulo, ativo, ordem })) })); },
    async salvarMotivo(dados = {}, { sessao } = {}) {
      exigirPrime(sessao);
      if (sessao?.papel && sessao.papel !== 'prime_admin') throw new ErroNegocio('ATOR_SEM_PERMISSAO', 'Só a administração muda as configurações');
      const rotulo = String(dados.rotulo || '').trim().replace(/\s+/g, ' ').slice(0, 80);
      if (!['recusa', 'cancelamento'].includes(dados.tipo) || rotulo.length < 3) throw new ErroNegocio('DADOS_INVALIDOS', 'Escolha o tipo e escreva o motivo (3 letras ou mais)');
      if (rotulo.includes(':')) throw new ErroNegocio('DADOS_INVALIDOS', 'O motivo não pode ter dois-pontos (separa o detalhe)');
      const codigo = dados.codigo || rotulo.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
      if (codigo === 'outro' && dados.ativo === false) throw new ErroNegocio('DADOS_INVALIDOS', '"Outro" fica sempre disponível');
      return repo.transacao(TODOS, async (tx) => {
        const atual = (await motivosAtuais(tx)).find((m) => m.tipo === dados.tipo && m.codigo === codigo);
        const ordem = dados.ordem ?? atual?.ordem ?? (Math.max(0, ...(await motivosAtuais(tx)).filter((m) => m.tipo === dados.tipo).map((m) => m.ordem)) + 1);
        const m = { chave: `${dados.tipo}:${codigo}`, tipo: dados.tipo, codigo, rotulo, ativo: dados.ativo !== false, ordem };
        await tx.put('motivos', m);
        return { tipo: m.tipo, codigo, rotulo, ativo: m.ativo };
      });
    },
    async salvarMeta(percentual, { sessao } = {}) {
      exigirPrime(sessao);
      if (sessao?.papel && sessao.papel !== 'prime_admin') throw new ErroNegocio('ATOR_SEM_PERMISSAO', 'Só a administração muda as configurações');
      const pct = Number(percentual);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new ErroNegocio('DADOS_INVALIDOS', 'Meta entre 0% e 100% sobre o mês anterior');
      return repo.transacao(TODOS, async (tx) => { await tx.put('configPainel', { chave: 'meta_diarias', valor: { percentual: pct } }); return { percentual: pct }; });
    },
    async proporNovaData(pedidoId, dados = {}, { sessao, chave } = {}) {
      exigirPrime(sessao);
      return repo.transacao(TODOS, (tx) => idem(tx, 'proporNovaData', sessao, chave, { id: pedidoId, ...dados }, async () => {
        const p = await tx.get('pedidos', pedidoId);
        if (!p) throw new ErroNegocio('NAO_ENCONTRADO', 'Solicitação não encontrada');
        if (p.status !== 'solicitado') throw new ErroNegocio('TRANSICAO_PROIBIDA', 'Só dá pra negociar a data de uma solicitação nova');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dados.data || '') || dados.data <= hojeSP()) throw new ErroNegocio('DATA_INVALIDA', 'Escolha uma data a partir de amanhã');
        if (dow(dados.data) === 0) throw new ErroNegocio('DATA_INVALIDA', 'A Prime não atende aos domingos');
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(dados.horaInicio || '')) throw new ErroNegocio('DATA_INVALIDA', 'Horário fora do horário de trabalho para essa duração');
        const a = (await tx.por('atendimentos', 'pedidoId', p.id)).filter((x) => x.status !== 'cancelado').sort((x, y) => x.data.localeCompare(y.data))[0];
        const proposta = { data: dados.data, horaInicio: dados.horaInicio, mensagem: String(dados.mensagem || '').trim().slice(0, 280) || null, dataPedida: a?.data || null, em: agoraISO(), por: sessao.id, validaAte: new Date(Date.parse(agoraISO()) + 48 * 3600000).toISOString() };
        await tx.put('pedidos', { ...p, propostaData: proposta, historico: [...(p.historico || []), { de: p.status, para: p.status, evento: 'propor_nova_data', em: agoraISO(), ator: 'prime', data: dados.data, horaInicio: dados.horaInicio }] });
        await registrarEvento(tx, 'proposta_nova_data', { pedidoId: p.id, clienteId: p.clienteId }, proposta);
        return { pedidoId: p.id, proposta };
      }));
    },
    async aprovarEnderecoPacote(pedidoId, { sessao } = {}) {
      exigirPrime(sessao);
      return repo.transacao(TODOS, async (tx) => {
        const p = await tx.get('pedidos', pedidoId);
        if (!p || p.status !== 'solicitado' || !p.pacoteEnderecoNovo) throw new ErroNegocio('TRANSICAO_PROIBIDA', 'Não há endereço novo pra aprovar nesta solicitação');
        await tx.put('pedidos', { ...p, pacoteEnderecoNovo: false, historico: [...(p.historico || []), { de: p.status, para: p.status, evento: 'endereco_novo_aprovado', em: agoraISO(), ator: 'prime' }] });
        return { pedidoId, enderecoNovoPacote: false };
      });
    },
    async recusarInformePagamento(pagamentoId, motivo, { sessao, chave } = {}) {
      exigirPrime(sessao);
      const mot = String(motivo || '').trim().replace(/\s+/g, ' ').slice(0, 280);
      return repo.transacao(TODOS, (tx) => idem(tx, 'recusarInformePagamento', sessao, chave, { id: pagamentoId, motivo: mot }, async () => {
        if (mot.length < 3) throw new ErroNegocio('DADOS_INVALIDOS', 'Escreva o motivo');
        const g = await tx.get('pagamentos', pagamentoId);
        if (!g) throw new ErroNegocio('NAO_ENCONTRADO', 'Pagamento não encontrado');
        if (g.status !== 'informado_pelo_cliente') throw new ErroNegocio('TRANSICAO_PROIBIDA', 'Este pagamento não está aguardando conferência');
        const novo = { ...g, status: 'pendente', informadoEm: null, conferencia: [...(g.conferencia || []), { resultado: 'nao_identificado', motivo: mot, em: agoraISO(), por: sessao.id }] };
        await tx.put('pagamentos', novo);
        const p = await tx.get('pedidos', g.pedidoId);
        await registrarEvento(tx, 'pagamento_nao_identificado', { pedidoId: g.pedidoId, clienteId: p?.clienteId, pagamentoId }, { motivo: mot });
        return { pagamento: novo };
      }));
    },
  };
  return casos;
}
