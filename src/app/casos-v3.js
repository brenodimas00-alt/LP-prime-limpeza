// Casos de uso do autoagendamento v3 no mock e no fake-api (o Supabase faz o mesmo em RPC: migrations 20261006*).
// Mesmo contrato dos três adapters (scripts/cenarios-v3.mjs).
// - cadastrarClienteV3: cadastro ANTES do endereço, salvo ao concluir a etapa (item 34). Resposta SEMPRE {ok, ticket}: não
//   revela se o CPF/CNPJ existe. Documento novo: cliente + acesso pela regra padrão. Documento existente: o ticket só deixa
//   enviar uma solicitação vinculada (dados digitados guardados à parte), sem ler nem alterar a conta.
// - meusEnderecos / substituirEndereco: endereços da cliente logada (item 9).
// - conteudoAgendamento: tipos de imóvel e "Ver mais" (editáveis no painel; aqui o padrão do arquivo).
import { ErroNegocio } from '../domain/modelo.js';
import { validarCadastroV3, validarEnderecoV3, soDigitos } from '../domain/validacao.js';
import { regiaoV3, cotarV3 } from '../domain/agendamento-v3.js';
import { VERSAO_CONDICOES, VERSAO_LEGAL } from '../config/legal.js';
import { CONTEUDO_AGENDAMENTO_PADRAO } from '../config/agendamento-v3.js';

const TODOS = null;
const HORAS_TICKET = 24;

export async function sha256Hex(texto) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const limpa = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');

function erroCampos(erros, prefixo = '') {
  const ks = Object.keys(erros);
  if (!ks.length) return;
  const det = Object.fromEntries(ks.map((k) => [`${prefixo}${k}`, erros[k]]));
  throw new ErroNegocio('DADOS_INVALIDOS', erros[ks[0]], det);
}

/** Endereço normalizado do v3 (mesmo formato de privado.v3_endereco). */
export function normalizarEnderecoV3(e = {}) {
  const t = limpa(e.tipoImovel);
  return {
    cep: soDigitos(e.cep), logradouro: limpa(e.logradouro), numero: limpa(e.numero), complemento: limpa(e.complemento), bairro: limpa(e.bairro),
    cidade: limpa(e.cidade), uf: String(e.uf ?? '').toUpperCase(), pontoReferencia: limpa(e.pontoReferencia), tipoImovel: t,
    tipoImovelOutro: t === 'Outro' ? limpa(e.tipoImovelOutro) : '',
  };
}

export function criarCasosV3({ repo, idem, agoraISO, hojeSP, gerarId, bytesAleatorios, cfg, registrarEvento, conteudo = () => CONTEUDO_AGENDAMENTO_PADRAO }) {
  const exigirCliente = (sessao) => {
    if (sessao?.ator !== 'cliente' || !sessao.id) throw new ErroNegocio('ATOR_SEM_PERMISSAO', 'Entre na sua conta');
    return sessao.id;
  };
  const tiposDe = (segmento) => conteudo().tiposImovel[segmento === 'empresa' ? 'empresa' : 'residencial'] || [];

  /** Endereço novo do fluxo: valida (erros com "endereco.") e normaliza. */
  function enderecoValido(e, segmento) {
    const n = normalizarEnderecoV3(e);
    erroCampos(validarEnderecoV3(n, tiposDe(segmento)), 'endereco.');
    return n;
  }

  /** Ticket válido (não vencido nem usado) ou null. Chamar FORA da transação (sha256 é assíncrono). */
  async function hashTicket(ticket) {
    return /^[0-9a-f]{64}$/.test(String(ticket || '')) ? sha256Hex(ticket) : null;
  }

  const casos = {
    async cadastrarClienteV3(dados = {}, { sessao, chave } = {}) {
      const { erros, cliente: c } = validarCadastroV3(dados, hojeSP());
      erroCampos(erros);
      // o ticket nasce fora da transação (o IndexedDB fecha a transação se ela esperar outra coisa)
      const bruto = hex(bytesAleatorios(32));
      const hash = await sha256Hex(bruto);
      const r = await repo.transacao(TODOS, (tx) => idem(tx, 'cadastrarV3', { ator: 'publico' }, chave, c, async () => {
        const doc = c.cnpj || c.cpf;
        const existente = (await tx.todos('clientes')).find((x) => !x.anonimizadoEm && (x.cnpj || x.cpf) === doc);
        let cliente = existente;
        if (!existente) {
          const emailEmUso = !!(await tx.get('credenciais', c.email)) || (await tx.todos('clientes')).some((x) => x.email === c.email);
          cliente = { id: gerarId(), ...c, endereco: {}, origem: 'site', baseLegal: 'execucao_contrato', statusProspeccao: 'novo', ...(emailEmUso ? { pendencias: ['email_em_uso'] } : {}), criadoEm: agoraISO() };
          await tx.put('clientes', cliente);
          if (!emailEmUso) await tx.put('credenciais', { email: c.email, tipo: 'cliente', refId: cliente.id, hash: null, criadoEm: agoraISO() });
        }
        const expira = new Date(Date.parse(agoraISO()) + HORAS_TICKET * 3600000).toISOString();
        await tx.put('tickets', { hash, clienteId: cliente.id, novo: !existente, dadosInformados: existente ? c : null, criadoEm: agoraISO(), expiraEm: expira, usadoEm: null });
        return { ok: true, ticket: bruto };
      }));
      return { ok: true, ticket: r.ticket };
    },

    async meusEnderecos({ sessao } = {}) {
      const id = exigirCliente(sessao);
      return repo.leitura(TODOS, async (tx) => (await tx.por('enderecos', 'clienteId', id))
        .filter((e) => e.ativo).sort((a, b) => Number(b.principal) - Number(a.principal) || a.criadoEm.localeCompare(b.criadoEm)));
    },

    async substituirEndereco(id, dados = {}, { sessao, chave } = {}) {
      const dona = exigirCliente(sessao);
      return repo.transacao(TODOS, (tx) => idem(tx, 'substituirEndereco', sessao, chave, { id, dados }, async () => {
        const ant = await tx.get('enderecos', id);
        if (!ant || ant.clienteId !== dona || !ant.ativo) throw new ErroNegocio('NAO_ENCONTRADO', 'Endereço não encontrado');
        const cli = await tx.get('clientes', dona);
        const e = enderecoValido(dados.endereco, cli.tipo);
        const reg = regiaoV3(e, cfg);
        if (!reg || reg.sobConsulta) throw new ErroNegocio('REGIAO_NAO_ATENDIDA', 'No momento, não atendemos esta região.', { 'endereco.cep': 'No momento, não atendemos esta região.' });
        const apelido = limpa(dados.apelido).slice(0, 40) || null;
        const novo = { id: gerarId(), clienteId: dona, ...e, apelido, principal: ant.principal, usoUnico: false, ativo: true, origem: 'site', criadoEm: agoraISO() };
        await tx.put('enderecos', { ...ant, ativo: false, principal: false, inativadoEm: agoraISO(), inativadoMotivo: 'substituido', substituidoPor: novo.id });
        await tx.put('enderecos', novo);
        return novo;
      }));
    },

    async conteudoAgendamento() { return structuredClone(conteudo()); },

    /** Cotação da revisão (itens 35 e 49): mesma regra de public.cotar_v3. */
    async cotarV3(dados = {}, { sessao } = {}) {
      const q = await quem(sessao, dados.ticket);
      return repo.leitura(TODOS, async (tx) => {
        const m = await montar(tx, dados, q);
        const ctx = await contexto(tx, q, m.pedido.cupom);
        const cot = cotarV3(m.pedido, ctxPublico(ctx), cfg);
        return { ...cot, pacoteEnderecoNovo: await pacoteEnderecoNovo(tx, m, q), faturamento: ctx.faturamento || null };
      });
    },

    /** Envio (itens 37 e 53 a 55): mesma regra de public.solicitar_v3. Nunca cobra. */
    async solicitarV3(dados = {}, { sessao, chave } = {}) {
      const q = await quem(sessao, dados.ticket);
      if (!q) {
        // repetição de um envio que já usou o ticket (resposta perdida): a mesma chave devolve o mesmo pedido
        const h = await hashTicket(dados.ticket);
        const t = h ? await repo.leitura(TODOS, (tx) => tx.get('tickets', h)) : null;
        const negar = () => { throw new ErroNegocio('ATOR_SEM_PERMISSAO', 'Entre na sua conta ou conclua o cadastro para enviar.'); };
        if (!t?.usadoEm) negar();
        const { ticket: _t, ...resto } = dados;
        return repo.transacao(TODOS, (tx) => idem(tx, 'solicitarV3', { ator: 'publico' }, chave, { ...resto, cliente: t.clienteId }, negar));
      }
      const ag = dados.aceite;
      if (!ag || ag.leuTermos !== true) throw new ErroNegocio('CONDICAO_NAO_ATENDIDA', 'Leia e aceite os Termos e Condições do atendimento para enviar.', { aceite: 'Leia e aceite os Termos e Condições do atendimento' });
      if (ag.condicoes !== VERSAO_CONDICOES || ag.legal !== VERSAO_LEGAL) throw new ErroNegocio('CONDICAO_NAO_ATENDIDA', 'Os Termos e Condições do atendimento mudaram. Leia a versão nova e aceite de novo.', { aceite: 'Versão nova dos termos' });
      const { ticket, ...semTicket } = dados;
      const conteudo = { ...semTicket, cliente: q.clienteId };
      const escopo = q.modo === 'logada' ? sessao : { ator: 'publico' };
      const em = agoraISO();
      const hashAceite = await sha256Hex(JSON.stringify({ cliente: q.clienteId, chave, condicoes: VERSAO_CONDICOES, legal: VERSAO_LEGAL, em }));
      return repo.transacao(TODOS, (tx) => idem(tx, 'solicitarV3', escopo, chave, conteudo, async () => {
        if (q.ticketHash) { const t = await tx.get('tickets', q.ticketHash); if (!t || t.usadoEm) throw new ErroNegocio('CONDICAO_NAO_ATENDIDA', 'Esta solicitação já foi enviada.'); }
        const cli = await tx.get('clientes', q.clienteId);
        let origem = null;
        const o = dados.origem;
        if (o && o.origem) {
          if (!['indicacao', 'instagram', 'google', 'whatsapp', 'outro'].includes(o.origem)) throw new ErroNegocio('DADOS_INVALIDOS', 'Origem inválida');
          origem = { origem: o.origem, ...(o.origem === 'indicacao' && limpa(o.quemIndicou) ? { quemIndicou: limpa(o.quemIndicou).slice(0, 80) } : {}), ...(o.origem === 'outro' && limpa(o.outroQual) ? { outroQual: limpa(o.outroQual).slice(0, 80) } : {}) };
        }
        const m = await montar(tx, dados, q);
        if (cli.tipo !== m.pedido.segmento) throw new ErroNegocio('DADOS_INVALIDOS', `Seu cadastro é de ${cli.tipo === 'empresa' ? 'empresa' : 'pessoa física'}. Escolha o tipo de atendimento do seu cadastro ou fale com a Prime.`);
        const ctx = await contexto(tx, q, m.pedido.cupom);
        const cot = cotarV3(m.pedido, ctxPublico(ctx), cfg);
        if (typeof dados.valorEsperadoCentavos !== 'number') throw new ErroNegocio('DADOS_INVALIDOS', 'Confira o valor na revisão antes de enviar.', { valor: 'Confira o valor na revisão' });
        if (dados.valorEsperadoCentavos !== cot.totalCentavos) throw new ErroNegocio('CONDICAO_NAO_ATENDIDA', 'O valor foi atualizado. Confira a revisão antes de enviar.', { valor: cot.totalCentavos, precoMudou: true });
        const vinc = q.modo === 'vinculado';
        const ids = {};
        for (const [ref, n] of Object.entries(m.novos)) {
          const temPrincipal = (await tx.por('enderecos', 'clienteId', cli.id)).some((e) => e.principal && e.ativo);
          const salvo = !vinc && n.uso === 'salvar';
          const { uso, apelido, ...campos } = n;
          const e = { id: gerarId(), clienteId: cli.id, ...campos, apelido: salvo ? apelido || null : null, usoUnico: !salvo, ativo: salvo, principal: salvo && !temPrincipal, origem: 'site', criadoEm: agoraISO() };
          await tx.put('enderecos', e); ids[ref] = e.id;
        }
        const numero = (await tx.todos('pedidos')).reduce((mx, p) => Math.max(mx, p.numeroSolicitacao || 0), 0) + 1;
        const pedidoId = gerarId();
        const ats = cot.atendimentos.map((a) => {
          const orig = m.pedido.atendimentos[a.posicao]; const rf = m.refs[a.posicao];
          const { uso, apelido, id: _id, ...snap } = rf.endereco;
          return {
            id: gerarId(), pedidoId, sequencia: a.sequencia, data: a.data, horaInicio: a.horaInicio, duracaoMinutos: a.duracaoMinutos, status: 'agendado', historico: [],
            valorDiaCentavos: a.valorCentavos, taxaDiaCentavos: a.taxas.sabado + a.taxas.feriado, deslocada: false, versao: 0, criadoEm: agoraISO(),
            enderecoId: rf.ref.startsWith('salvo:') ? rf.ref.slice(6) : ids[rf.ref], endereco: snap, servico: a.servico,
            caracteristicas: orig.caracteristicas || null, localRefeicao: orig.localRefeicao === true, duracaoRecomendadaHoras: a.duracaoRecomendadaHoras,
            justificativa: limpa(orig.justificativa).slice(0, 500) || null, taxas: a.taxas, itens: a.itens,
          };
        });
        const { uso: _u, id: _i, ...enderecoPedido } = m.refs[0].endereco;
        const pedido = {
          id: pedidoId, clienteId: cli.id, numeroSolicitacao: numero, status: 'solicitado', modalidade: cot.modalidade,
          pacote: { ...cot, tipoCliente: cot.segmento, tipoServico: cot.atendimentos[0].servico, duracaoHoras: cot.atendimentos[0].duracaoMinutos / 60, quantidadeDiarias: cot.atendimentos.length, modoPagamento: 'v3', horasExtras: 0 },
          endereco: enderecoPedido, atendimentoIds: ats.map((a) => a.id), aceiteCondicoes: { versao: VERSAO_CONDICOES, em: agoraISO() },
          ...(vinc ? { dadosInformados: q.dadosInformados } : {}), origemCliente: origem, cupomCodigo: cot.cupom?.aplicado ? cot.cupom.codigo : null,
          condicaoComercialId: cot.condicaoAplicada ? ctx.condicao._id : null, pacoteEnderecoNovo: await pacoteEnderecoNovo(tx, m, q), faturamento: !!ctx.faturamento,
          historico: [{ de: 'rascunho', para: 'solicitado', evento: 'solicitar', em: agoraISO(), ator: 'cliente' }], criadoEm: agoraISO(),
        };
        await tx.put('pedidos', pedido);
        for (const a of ats) await tx.put('atendimentos', a);
        const info = vinc ? q.dadosInformados : { nome: cli.nome, documento: cli.cpf || cli.cnpj, telefone: cli.telefone };
        await tx.put('aceitesSolicitacao', { pedidoId, clienteId: cli.id, nome: info.nome, documento: info.documento || info.cpf || info.cnpj, whatsapp: info.telefone,
          aceitoEm: em, versaoCondicoes: VERSAO_CONDICOES, versaoTermosUso: VERSAO_LEGAL, versaoPrivacidade: VERSAO_LEGAL, hashAceite });
        if (q.ticketHash) { const t = await tx.get('tickets', q.ticketHash); await tx.put('tickets', { ...t, usadoEm: agoraISO(), usadoPedido: pedidoId }); }
        if (cli.statusProspeccao !== 'convertido') await tx.put('clientes', { ...cli, statusProspeccao: 'convertido' });
        await registrarEvento(tx, 'pedido_criado', { pedidoId, clienteId: cli.id });
        return { pedido: { id: pedidoId, numero } };
      }));
    },
  };

  // ---------------------------------------------------------------- apoio do cotar/enviar
  /** Quem chama: cliente logada ou ticket válido do cadastro. Fora da transação (sha256 é assíncrono). */
  async function quem(sessao, ticket) {
    if (sessao?.ator === 'cliente' && sessao.id) return { modo: 'logada', clienteId: sessao.id };
    const h = await hashTicket(ticket);
    if (!h) return null;
    const t = await repo.leitura(TODOS, (tx) => tx.get('tickets', h));
    if (!t || t.usadoEm || Date.parse(t.expiraEm) <= Date.parse(agoraISO())) return null;
    return { modo: t.novo ? 'novo' : 'vinculado', clienteId: t.clienteId, ticketHash: h, dadosInformados: t.dadosInformados };
  }

  async function montar(tx, dados, q) {
    const ped = dados.pedido;
    if (!ped || typeof ped !== 'object' || !Array.isArray(ped.atendimentos)) throw new ErroNegocio('DADOS_INVALIDOS', 'Solicitação não informada');
    const novos = {}; const refs = [];
    const atendimentos = [];
    for (let i = 0; i < ped.atendimentos.length; i++) {
      const a = ped.atendimentos[i];
      const ref = a?.endereco?.ref || '';
      let end;
      if (/^salvo:[0-9a-f-]{36}$/.test(ref)) {
        if (q?.modo !== 'logada') throw new ErroNegocio('DADOS_INVALIDOS', `Diária ${i + 1}: escolha o endereço`);
        const e = await tx.get('enderecos', ref.slice(6));
        if (!e || e.clienteId !== q.clienteId || !e.ativo) throw new ErroNegocio('DADOS_INVALIDOS', `Diária ${i + 1}: endereço não encontrado. Escolha outro.`, { endereco: 'Endereço não encontrado' });
        end = e;
      } else if (/^novo:\d{1,2}$/.test(ref)) {
        if (!novos[ref]) {
          const n = dados.enderecosNovos?.[ref] || {};
          const e = enderecoValido(n, ped.segmento);
          if (!['salvar', 'unico'].includes(n.uso)) throw new ErroNegocio('DADOS_INVALIDOS', 'Escolha como deseja utilizar este endereço', { 'endereco.uso': 'Escolha como deseja utilizar este endereço' });
          novos[ref] = { ...e, uso: n.uso, apelido: n.uso === 'salvar' ? (limpa(n.apelido).slice(0, 40) || null) : null };
        }
        end = novos[ref];
      } else throw new ErroNegocio('DADOS_INVALIDOS', `Diária ${i + 1}: escolha o endereço`);
      atendimentos.push({ ...a, endereco: { cep: end.cep || '', cidade: end.cidade, uf: end.uf } });
      refs.push({ ref, endereco: end });
    }
    return { pedido: { ...ped, atendimentos }, refs, novos };
  }

  async function contexto(tx, q, codigoCupom) {
    const ctx = { hoje: hojeSP(), primeiraContratacao: false };
    const cli = q?.clienteId ? await tx.get('clientes', q.clienteId) : null;
    if (cli) {
      const peds = await tx.por('pedidos', 'clienteId', cli.id);
      ctx.primeiraContratacao = !peds.some((p) => ['disponibilidade_confirmada', 'aguardando_pagamento', 'confirmado', 'concluido'].includes(p.status)) && cli.origem !== 'importado';
    }
    if (limpa(codigoCupom)) {
      const c = await tx.get('cupons', limpa(codigoCupom).toUpperCase());
      if (c) {
        const usos = (await tx.por('cuponsUso', 'cupomCodigo', c.codigo)).length;
        ctx.cupom = { codigo: c.codigo, tipo: c.tipo, valor: c.valor, modalidades: c.modalidades || [], primeiraContratacao: !!c.primeiraContratacao, validoAte: c.validoAte || null,
          ativo: c.ativo !== false, esgotado: !!c.limiteDeUso && usos >= c.limiteDeUso, acumula: !!c.acumula };
      }
    }
    if (q?.modo === 'logada' && cli) {
      const cond = (await tx.por('condicoesComerciais', 'clienteId', cli.id)).find((x) => x.ativa);
      if (cond) ctx.condicao = { tipo: cond.tipo, valor: cond.valor, modalidades: cond.modalidades || [], quantidadeMinima: cond.quantidadeMinima ?? null, validade: cond.validade, validoAte: cond.validoAte || null, acumula: !!cond.acumula, consumida: !!cond.consumidaEm, ativa: true, _id: cond.id };
      const fat = await tx.get('faturamento', cli.id);
      if (fat?.autorizado && cli.tipo === 'empresa') ctx.faturamento = { prazoDias: fat.prazoDias || 0, forma: fat.forma, nf: fat.nf !== false };
    }
    return ctx;
  }
  const ctxPublico = (c) => { const { condicao, ...r } = c; return condicao ? { ...r, condicao: (({ _id, ...x }) => x)(condicao) } : r; };

  async function pacoteEnderecoNovo(tx, m, q) {
    if (m.pedido.modalidade !== 'pacote') return false;
    const temSalvo = q?.modo === 'logada' && (await tx.por('enderecos', 'clienteId', q.clienteId)).some((e) => e.ativo);
    return m.refs.some((r) => r.ref.startsWith('novo:') && (r.ref !== 'novo:0' || r.endereco.uso === 'unico' || q?.modo === 'vinculado' || temSalvo));
  }
  return casos;
}
