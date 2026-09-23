// Casos de uso da Prime. Mesmo núcleo roda no adapter mock (IndexedDB) e no scripts/fake-api.mjs (memória).
// Cada escrita: valida -> transação única (mudança + idempotência + evento pendente). Contrato: docs/API.md.
import { ErroNegocio, TIPOS_DOCUMENTO as TIPOS_DOC } from '../domain/modelo.js';
import { parcelarRestante } from '../domain/dinheiro.js';
import { transicionar, derivarStatusPedido, elegibilidadePagamento, ESTADOS_FUTUROS, ESTADOS_REALIZADOS } from '../domain/estados.js';
import { calcularPacote, gerarAtendimentos } from '../domain/pacote.js';
import { dataNoFuso, validarOcorrencias, regiaoDoEndereco } from '../domain/calendario.js';
import { montarBRCode, txidDeBytes } from '../domain/brcode.js';
import { validarConfiguracao } from '../domain/configuracao.js';
import { validarCliente, validarDiarista, validarArquivo, documentosFaltando, soDigitos, normalizarCNPJ } from '../domain/validacao.js';

// ---------- utilitários ----------

/** JSON com chaves ordenadas (hash estável do conteúdo). */
export function jsonEstavel(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(jsonEstavel).join(',')}]`;
  return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${jsonEstavel(v[k])}`).join(',')}}`;
}

/** Hash de 53 bits (cyrb53) em hex. Suficiente pra comparar conteúdo de uma mesma chave. */
export function hashTexto(s) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

const TODOS = null; // escopo de stores: todos

function naoEncontrado(o, oque = 'Registro') {
  if (!o) throw new ErroNegocio('NAO_ENCONTRADO', `${oque} não encontrado`);
  return o;
}

function exigirChave(chave) {
  if (!chave || typeof chave !== 'string' || chave.length < 8 || chave.length > 100) {
    throw new ErroNegocio('DADOS_INVALIDOS', 'chaveIdempotencia obrigatória (8 a 100 caracteres)');
  }
}

function escopoSessao(s) {
  return s?.ator === 'cliente' || s?.ator === 'diarista' ? `${s.ator}:${s.id}` : s?.ator || 'publico';
}

function podeVerPedido(sessao, pedido) {
  if (!pedido) return false;
  if (sessao?.ator === 'prime' || sessao?.ator === 'sistema') return true;
  return sessao?.ator === 'cliente' && sessao.id === pedido.clienteId;
}

function exigirPrime(sessao) {
  if (sessao?.ator !== 'prime' && sessao?.ator !== 'sistema') throw new ErroNegocio('ATOR_SEM_PERMISSAO', 'Só a Prime pode fazer isso');
}

function limparTexto(s) {
  return typeof s === 'string' ? s.trim().replace(/\s+/g, ' ') : s;
}

function normalizarEndereco(e = {}) {
  return {
    cep: soDigitos(e.cep), logradouro: limparTexto(e.logradouro), numero: limparTexto(String(e.numero ?? '')),
    complemento: limparTexto(e.complemento || ''), bairro: limparTexto(e.bairro), cidade: limparTexto(e.cidade), uf: String(e.uf || '').toUpperCase(),
  };
}

function erroCampos(erros) {
  if (Object.keys(erros).length) throw new ErroNegocio('DADOS_INVALIDOS', Object.values(erros)[0], erros);
}

async function lerCabecalho(conteudo) {
  if (!conteudo) return null;
  if (conteudo instanceof Uint8Array) return conteudo.slice(0, 8);
  if (typeof conteudo.slice === 'function' && typeof conteudo.arrayBuffer === 'function') {
    return new Uint8Array(await conteudo.slice(0, 8).arrayBuffer());
  }
  return null;
}

// ---------- fábrica ----------

/**
 * @param {{repo, relogio:{agora:()=>Date}, gerarId:()=>string, bytesAleatorios:(n:number)=>Uint8Array, configPrime:()=>object, cfg:object}} deps
 */
export function criarCasosDeUso({ repo, relogio, gerarId, bytesAleatorios, configPrime, cfg }) {
  const agoraISO = () => relogio.agora().toISOString();
  const hojeSP = () => dataNoFuso(agoraISO(), cfg.regrasNotificacao.fuso);

  /** Envolve a escrita com idempotência dentro da transação. */
  async function idem(tx, operacao, sessao, chave, conteudo, fn) {
    exigirChave(chave);
    const id = `${operacao}|${escopoSessao(sessao)}|${chave}`;
    const hash = hashTexto(jsonEstavel(conteudo ?? null));
    const reg = await tx.get('idempotencia', id);
    if (reg) {
      if (reg.hash !== hash) throw new ErroNegocio('CONFLITO_IDEMPOTENCIA', 'Esta chave já foi usada com outro conteúdo');
      return { ...reg.resultado, _repetido: true };
    }
    const resultado = await fn();
    await tx.put('idempotencia', { chave: id, operacao, hash, resultado, criadoEm: agoraISO() });
    return resultado;
  }

  let seqEvento = 0;
  async function evento(tx, tipo, refs, dados = {}) {
    const ev = { id: gerarId(), tipo, refs, dados, status: 'pendente', criadoEm: agoraISO(), seq: ++seqEvento };
    await tx.put('eventos', ev);
    return ev;
  }

  function novoTxid() {
    return txidDeBytes(bytesAleatorios(25), 25);
  }

  function brcodePara(valorCentavos, txid) {
    const prime = configPrime();
    if (!validarConfiguracao(prime).pix.ok || valorCentavos <= 0) return null;
    return montarBRCode({ chave: prime.pix.chave, nome: prime.pix.nomeRecebedor, cidade: prime.pix.cidadeRecebedor, valorCentavos, txid });
  }

  function novoPagamento({ pedidoId, atendimentoId, parcela, valorCentavos, venceEm, venceAs, chave }) {
    const pixTxid = novoTxid();
    return {
      id: gerarId(), pedidoId, ...(atendimentoId ? { atendimentoId } : {}), parcela, valorCentavos, metodo: 'pix', pixTxid,
      brcode: brcodePara(valorCentavos, pixTxid), status: 'pendente', ...(venceEm ? { venceEm } : {}), ...(venceAs ? { venceAs } : {}),
      chaveIdempotencia: chave, criadoEm: agoraISO(),
    };
  }

  function normalizarCliente(d = {}) {
    const c = {
      tipo: d.tipo, nome: limparTexto(d.nome), telefone: soDigitos(d.telefone), email: limparTexto(d.email || '').toLowerCase(),
      endereco: normalizarEndereco(d.endereco),
    };
    if (d.tipo === 'empresa') {
      c.cnpj = normalizarCNPJ(d.cnpj); c.razaoSocial = limparTexto(d.razaoSocial); c.responsavel = limparTexto(d.responsavel);
    } else if (d.cpf) c.cpf = soDigitos(d.cpf);
    erroCampos(validarCliente(c));
    return c;
  }

  /** Monta pedido + atendimentos + pagamentos (sem gravar). O preço é SEMPRE recalculado aqui. */
  function montarPedido({ cliente, pacote: esp, primeiraData, turno, chave }) {
    const especificacao = { ...esp, tipoCliente: cliente.tipo, endereco: cliente.endereco };
    const base = calcularPacote(especificacao, cfg);
    const { itens, pacote } = gerarAtendimentos(base, { primeiraData, turno, hoje: hojeSP(), endereco: cliente.endereco }, cfg);
    const agora = agoraISO();
    const pedidoId = gerarId();
    const atendimentos = itens.map((it) => ({
      id: gerarId(), pedidoId, sequencia: it.sequencia, data: it.data, turno: it.turno, status: 'agendado', historico: [],
      valorDiaCentavos: it.valorDiaCentavos, taxaDiaCentavos: it.taxaDiaCentavos, deslocada: it.deslocada,
      ...(it.deslocada ? { dataOriginal: it.original } : {}), versao: 0, criadoEm: agora,
    }));
    const pedido = {
      id: pedidoId, clienteId: cliente.id, pacote, atendimentoIds: atendimentos.map((a) => a.id), status: 'aguardando_entrada',
      historico: [{ de: 'rascunho', para: 'aguardando_entrada', evento: 'criar', em: agora, ator: 'cliente' }], criadoEm: agora,
    };
    const pagamentos = [novoPagamento({ pedidoId, parcela: 'entrada', valorCentavos: pacote.entradaCentavos, chave: `${chave}:entrada` })];
    itens.forEach((it, i) => {
      if (it.parcelaCentavos > 0) {
        pagamentos.push(novoPagamento({ pedidoId, atendimentoId: atendimentos[i].id, parcela: 'dia', valorCentavos: it.parcelaCentavos, venceEm: it.venceEm, venceAs: it.venceAs, chave: `${chave}:dia:${i + 1}` }));
      }
    });
    return { pedido, atendimentos, pagamentos };
  }

  async function gravarPedido(tx, { pedido, atendimentos, pagamentos }) {
    await tx.put('pedidos', pedido);
    for (const a of atendimentos) await tx.put('atendimentos', a);
    for (const p of pagamentos) await tx.put('pagamentos', p);
    await evento(tx, 'pedido_criado', { pedidoId: pedido.id, clienteId: pedido.clienteId });
  }

  async function carregarPedidoCompleto(tx, pedidoId) {
    const pedido = await tx.get('pedidos', pedidoId);
    if (!pedido) return null;
    const cliente = await tx.get('clientes', pedido.clienteId);
    const atendimentos = (await tx.por('atendimentos', 'pedidoId', pedidoId)).sort((a, b) => a.sequencia - b.sequencia);
    const pagamentos = (await tx.por('pagamentos', 'pedidoId', pedidoId)).sort((a, b) => (a.parcela === 'entrada' ? -1 : b.parcela === 'entrada' ? 1 : (a.venceEm || '').localeCompare(b.venceEm || '')));
    return { pedido, cliente, atendimentos, pagamentos };
  }

  function entradaConfirmada(pagamentos) {
    return pagamentos.some((p) => p.parcela === 'entrada' && p.status === 'confirmado');
  }

  /** Recalcula e grava o status do pedido, registrando no histórico. */
  async function atualizarStatusPedido(tx, pedido, atendimentos, pagamentos, ator, eventoNome) {
    const novo = derivarStatusPedido(pedido.status, atendimentos, entradaConfirmada(pagamentos));
    if (novo === pedido.status) return pedido;
    const atualizado = { ...pedido, status: novo, historico: [...pedido.historico, { de: pedido.status, para: novo, evento: eventoNome, em: agoraISO(), ator }] };
    await tx.put('pedidos', atualizado);
    return atualizado;
  }

  async function aplicarTransicao(tx, atendimento, ev, sessao, dados) {
    const pedido = naoEncontrado(await tx.get('pedidos', atendimento.pedidoId), 'Pedido');
    const pagamentos = await tx.por('pagamentos', 'pedidoId', pedido.id);
    const diarista = atendimento.diaristaId ? await tx.get('diaristas', atendimento.diaristaId) : null;
    if (ev === 'reagendar') {
      const problemas = validarOcorrencias([{ sequencia: atendimento.sequencia, data: dados?.data }], {
        hoje: hojeSP(), diasBloqueados: cfg.diasBloqueados, datasBloqueadas: cfg.datasBloqueadas, ...cfg.regrasCalendario,
      });
      if (problemas.length) throw new ErroNegocio('DATA_INVALIDA', problemas.map((p) => p.motivo).join('; '), problemas);
      const irmaos = await tx.por('atendimentos', 'pedidoId', pedido.id);
      if (irmaos.some((a) => a.id !== atendimento.id && a.status !== 'cancelado' && a.data === dados.data)) {
        throw new ErroNegocio('DATA_INVALIDA', 'Já existe diária deste pedido nessa data');
      }
    }
    const novo = transicionar(atendimento, ev, {
      ator: sessao?.ator, atorId: sessao?.id, agora: agoraISO(), entradaConfirmada: entradaConfirmada(pagamentos),
      diarista: diarista ? { id: diarista.id, status: diarista.status } : undefined, clienteIdDoPedido: pedido.clienteId, dados,
    });
    await tx.put('atendimentos', novo);
    if (ev === 'cancelar') {
      for (const p of pagamentos) {
        if (p.atendimentoId === novo.id && p.status !== 'confirmado' && p.status !== 'cancelado') await tx.put('pagamentos', { ...p, status: 'cancelado' });
      }
    }
    if (ev === 'reagendar') {
      for (const p of pagamentos) if (p.atendimentoId === novo.id && p.status === 'pendente') await tx.put('pagamentos', { ...p, venceEm: novo.data });
    }
    const todos = (await tx.por('atendimentos', 'pedidoId', pedido.id)).map((a) => (a.id === novo.id ? novo : a));
    const pgs = await tx.por('pagamentos', 'pedidoId', pedido.id);
    const pedidoNovo = await atualizarStatusPedido(tx, pedido, todos, pgs, sessao?.ator, `atendimento_${ev}`);
    const tipo = ev === 'reagendar' ? 'atendimento_reagendado' : `atendimento_${novo.status}`;
    await evento(tx, tipo, { pedidoId: pedido.id, atendimentoId: novo.id, diaristaId: novo.diaristaId }, { versao: novo.versao });
    return { atendimento: novo, pedido: pedidoNovo };
  }

  // ---------- casos de uso ----------

  const casos = {
    async criarCliente(dados, { sessao, chave } = {}) {
      const c = normalizarCliente(dados);
      return repo.transacao(TODOS, (tx) => idem(tx, 'criarCliente', sessao, chave, c, async () => {
        const cliente = { id: gerarId(), ...c, criadoEm: agoraISO() };
        await tx.put('clientes', cliente);
        return cliente;
      }));
    },

    async criarPedido({ clienteId, pacote, primeiraData, turno }, { sessao, chave } = {}) {
      return repo.transacao(TODOS, (tx) => idem(tx, 'criarPedido', sessao, chave, { clienteId, pacote, primeiraData, turno }, async () => {
        const cliente = naoEncontrado(await tx.get('clientes', clienteId), 'Cliente');
        if (sessao?.ator === 'cliente' && sessao.id !== clienteId) throw new ErroNegocio('ATOR_SEM_PERMISSAO', 'Cliente diferente');
        const montado = montarPedido({ cliente, pacote, primeiraData, turno, chave });
        await gravarPedido(tx, montado);
        return { pedido: montado.pedido, atendimentos: montado.atendimentos };
      }));
    },

    /** Autoagendamento: cliente + pedido + atendimentos + entrada + parcelas, tudo ou nada. */
    async confirmarAutoagendamento({ cliente: dadosCliente, pacote, primeiraData, turno }, { sessao, chave } = {}) {
      const c = normalizarCliente(dadosCliente);
      const conteudo = { cliente: c, pacote, primeiraData, turno };
      return repo.transacao(TODOS, (tx) => idem(tx, 'confirmarAutoagendamento', sessao, chave, conteudo, async () => {
        const cliente = { id: gerarId(), ...c, criadoEm: agoraISO() };
        const montado = montarPedido({ cliente, pacote, primeiraData, turno, chave });
        await tx.put('clientes', cliente);
        await gravarPedido(tx, montado);
        const entrada = montado.pagamentos.find((p) => p.parcela === 'entrada');
        return { cliente, ...montado, pagamentoEntradaId: entrada.id };
      }));
    },

    async obterPedido(id, { sessao } = {}) {
      return repo.leitura(TODOS, async (tx) => {
        const r = await carregarPedidoCompleto(tx, id);
        if (!r || !podeVerPedido(sessao, r.pedido)) throw new ErroNegocio('NAO_ENCONTRADO', 'Pedido não encontrado');
        return r;
      });
    },

    async listarPedidos({ clienteId } = {}, { sessao } = {}) {
      return repo.leitura(TODOS, async (tx) => {
        let itens;
        if (sessao?.ator === 'cliente') itens = await tx.por('pedidos', 'clienteId', sessao.id);
        else if (sessao?.ator === 'prime') itens = clienteId ? await tx.por('pedidos', 'clienteId', clienteId) : await tx.todos('pedidos');
        else throw new ErroNegocio('ATOR_SEM_PERMISSAO', 'Sem permissão');
        return { itens: itens.sort((a, b) => b.criadoEm.localeCompare(a.criadoEm)) };
      });
    },

    async obterAtendimento(id, { sessao } = {}) {
      return repo.leitura(TODOS, async (tx) => {
        const atendimento = await tx.get('atendimentos', id);
        const pedido = atendimento && (await tx.get('pedidos', atendimento.pedidoId));
        const podeDiarista = sessao?.ator === 'diarista' && atendimento?.diaristaId === sessao.id;
        if (!atendimento || !(podeVerPedido(sessao, pedido) || podeDiarista)) throw new ErroNegocio('NAO_ENCONTRADO', 'Atendimento não encontrado');
        const d = atendimento.diaristaId ? await tx.get('diaristas', atendimento.diaristaId) : null;
        const pagamentoDia = (await tx.por('pagamentos', 'atendimentoId', id)).find((p) => p.parcela === 'dia' && p.status !== 'cancelado') || null;
        const avaliacao = (await tx.por('avaliacoes', 'atendimentoId', id))[0] || null;
        const cliente = await tx.get('clientes', pedido.clienteId);
        return {
          atendimento, pedido, cliente: { id: cliente.id, nome: cliente.nome, endereco: { bairro: cliente.endereco.bairro, cidade: cliente.endereco.cidade } },
          diarista: d ? { id: d.id, nome: d.nome, status: d.status } : null, pagamentoDia, avaliacao,
        };
      });
    },

    async transicionarAtendimento(id, { evento: ev, dados } = {}, { sessao, chave } = {}) {
      return repo.transacao(TODOS, (tx) => idem(tx, 'transicionarAtendimento', sessao, chave, { id, ev, dados }, async () => {
        const atendimento = await tx.get('atendimentos', id);
        const pedido = atendimento && (await tx.get('pedidos', atendimento.pedidoId));
        const podeDiarista = sessao?.ator === 'diarista' && atendimento?.diaristaId === sessao.id;
        if (!atendimento || !(podeVerPedido(sessao, pedido) || podeDiarista)) throw new ErroNegocio('NAO_ENCONTRADO', 'Atendimento não encontrado');
        if (ev === 'avaliar' && sessao?.ator === 'cliente') throw new ErroNegocio('ATOR_SEM_PERMISSAO', 'Use a avaliação para avaliar');
        return aplicarTransicao(tx, atendimento, ev, sessao, dados);
      }));
    },

    async atribuirDiarista(id, { diaristaId } = {}, { sessao, chave } = {}) {
      exigirPrime(sessao);
      return repo.transacao(TODOS, (tx) => idem(tx, 'atribuirDiarista', sessao, chave, { id, diaristaId }, async () => {
        const a = naoEncontrado(await tx.get('atendimentos', id), 'Atendimento');
        if (!['agendado', 'confirmado'].includes(a.status)) throw new ErroNegocio('TRANSICAO_PROIBIDA', 'Só dá pra atribuir antes da diarista sair');
        const d = naoEncontrado(await tx.get('diaristas', diaristaId), 'Diarista');
        if (d.status !== 'aprovada') throw new ErroNegocio('CONDICAO_NAO_ATENDIDA', 'Diarista não está aprovada');
        if (a.diaristaId === diaristaId) return { atendimento: a };
        const novo = { ...a, diaristaId, versao: (a.versao || 0) + 1 };
        await tx.put('atendimentos', novo);
        await evento(tx, 'atendimento_atribuido', { pedidoId: a.pedidoId, atendimentoId: a.id, diaristaId }, { anterior: a.diaristaId || null, versao: novo.versao });
        return { atendimento: novo };
      }));
    },

    async criarPagamento({ pedidoId, parcela, atendimentoId } = {}, { sessao, chave } = {}) {
      return repo.transacao(TODOS, (tx) => idem(tx, 'criarPagamento', sessao, chave, { pedidoId, parcela, atendimentoId }, async () => {
        const r = await carregarPedidoCompleto(tx, pedidoId);
        if (!r || !podeVerPedido(sessao, r.pedido)) throw new ErroNegocio('NAO_ENCONTRADO', 'Pedido não encontrado');
        if (!['entrada', 'dia'].includes(parcela)) throw new ErroNegocio('DADOS_INVALIDOS', 'Parcela inválida');
        const existente = r.pagamentos.find((p) => p.parcela === parcela && (parcela === 'entrada' || p.atendimentoId === atendimentoId) && p.status !== 'cancelado');
        if (existente) return existente;
        if (!validarConfiguracao(configPrime()).pix.ok) throw new ErroNegocio('CONFIG_INCOMPLETA', 'Pix da Prime não configurado');
        let valor;
        let venceEm;
        if (parcela === 'entrada') valor = r.pedido.pacote.entradaCentavos;
        else {
          const at = naoEncontrado(r.atendimentos.find((a) => a.id === atendimentoId), 'Atendimento');
          const partes = r.atendimentos.map((a) => a.id);
          valor = parcelarRestante(r.pedido.pacote.restanteCentavos, partes.length, r.pedido.pacote.cobrancaRestante)[partes.indexOf(at.id)];
          venceEm = at.data;
          if (!valor) throw new ErroNegocio('PAGAMENTO_NAO_ELEGIVEL', 'Este atendimento não tem parcela');
        }
        const p = novoPagamento({ pedidoId, atendimentoId, parcela, valorCentavos: valor, venceEm, chave });
        await tx.put('pagamentos', p);
        return p;
      }));
    },

    async obterPagamento(id, { sessao } = {}) {
      return repo.leitura(TODOS, async (tx) => {
        const pagamento = await tx.get('pagamentos', id);
        const pedido = pagamento && (await tx.get('pedidos', pagamento.pedidoId));
        if (!pagamento || !podeVerPedido(sessao, pedido)) throw new ErroNegocio('NAO_ENCONTRADO', 'Pagamento não encontrado');
        const atendimento = pagamento.atendimentoId ? await tx.get('atendimentos', pagamento.atendimentoId) : null;
        return { pagamento, pedido, atendimento, elegibilidade: elegibilidadePagamento(pagamento, { pedido, atendimento }) };
      });
    },

    async informarPagamento(id, { sessao, chave } = {}) {
      return repo.transacao(TODOS, (tx) => idem(tx, 'informarPagamento', sessao, chave, { id }, async () => {
        const p = await tx.get('pagamentos', id);
        const pedido = p && (await tx.get('pedidos', p.pedidoId));
        if (!p || !podeVerPedido(sessao, pedido)) throw new ErroNegocio('NAO_ENCONTRADO', 'Pagamento não encontrado');
        if (sessao?.ator !== 'cliente' && sessao?.ator !== 'prime') throw new ErroNegocio('ATOR_SEM_PERMISSAO', 'Só a cliente informa o pagamento');
        if (p.status === 'informado_pelo_cliente') return p;
        const atendimento = p.atendimentoId ? await tx.get('atendimentos', p.atendimentoId) : null;
        const el = elegibilidadePagamento(p, { pedido, atendimento });
        if (!el.pagavel) throw new ErroNegocio('PAGAMENTO_NAO_ELEGIVEL', el.motivo);
        const novo = { ...p, status: 'informado_pelo_cliente', informadoEm: agoraISO() };
        await tx.put('pagamentos', novo);
        await evento(tx, 'pagamento_informado', { pedidoId: p.pedidoId, pagamentoId: p.id, atendimentoId: p.atendimentoId });
        return novo;
      }));
    },

    async confirmarPagamento(id, { sessao, chave } = {}) {
      exigirPrime(sessao);
      return repo.transacao(TODOS, (tx) => idem(tx, 'confirmarPagamento', sessao, chave, { id }, async () => {
        const p = naoEncontrado(await tx.get('pagamentos', id), 'Pagamento');
        const r = await carregarPedidoCompleto(tx, p.pedidoId);
        const atendimento = p.atendimentoId ? r.atendimentos.find((a) => a.id === p.atendimentoId) : null;
        const el = elegibilidadePagamento(p, { pedido: r.pedido, atendimento });
        if (!el.pagavel) throw new ErroNegocio('PAGAMENTO_NAO_ELEGIVEL', el.motivo);
        const pg = { ...p, status: 'confirmado', confirmadoEm: agoraISO() };
        await tx.put('pagamentos', pg);
        await evento(tx, 'pagamento_confirmado', { pedidoId: p.pedidoId, pagamentoId: p.id, atendimentoId: p.atendimentoId }, { parcela: p.parcela });
        let atendimentos = r.atendimentos;
        let pedido = r.pedido;
        if (p.parcela === 'entrada' && pedido.status === 'aguardando_entrada') {
          atendimentos = [];
          for (const a of r.atendimentos) {
            if (a.status === 'agendado') atendimentos.push((await aplicarTransicao(tx, a, 'confirmar', { ator: 'sistema' })).atendimento);
            else atendimentos.push(a);
          }
          const pgs = await tx.por('pagamentos', 'pedidoId', pedido.id);
          pedido = await atualizarStatusPedido(tx, await tx.get('pedidos', pedido.id), atendimentos, pgs, 'sistema', 'entrada_confirmada');
        }
        return { pagamento: pg, pedido, atendimentos };
      }));
    },

    async cancelarPedido(id, { motivo } = {}, { sessao, chave } = {}) {
      return repo.transacao(TODOS, (tx) => idem(tx, 'cancelarPedido', sessao, chave, { id, motivo }, async () => {
        const r = await carregarPedidoCompleto(tx, id);
        if (!r || !podeVerPedido(sessao, r.pedido)) throw new ErroNegocio('NAO_ENCONTRADO', 'Pedido não encontrado');
        if (!['cliente', 'prime'].includes(sessao?.ator)) throw new ErroNegocio('ATOR_SEM_PERMISSAO', 'Sem permissão');
        if (['cancelado', 'concluido'].includes(r.pedido.status)) throw new ErroNegocio('TRANSICAO_PROIBIDA', `Pedido já está ${r.pedido.status}`);
        const agora = agoraISO();
        const atendimentos = [];
        const cancelados = [];
        for (const a of r.atendimentos) {
          if (ESTADOS_FUTUROS.includes(a.status)) {
            const novo = transicionar(a, 'cancelar', { ator: sessao.ator === 'cliente' ? 'cliente' : 'prime', atorId: sessao.id, agora, clienteIdDoPedido: r.pedido.clienteId });
            await tx.put('atendimentos', novo);
            atendimentos.push(novo);
            cancelados.push(novo.id);
          } else atendimentos.push(a);
        }
        const algumRealizado = atendimentos.some((a) => ESTADOS_REALIZADOS.includes(a.status) || a.status === 'em_andamento');
        const pagamentos = [];
        for (const p of r.pagamentos) {
          let novo = p;
          const aberto = p.status === 'pendente' || p.status === 'informado_pelo_cliente';
          if (aberto && p.parcela === 'dia' && cancelados.includes(p.atendimentoId)) novo = { ...p, status: 'cancelado' };
          if (aberto && p.parcela === 'entrada' && !algumRealizado) novo = { ...p, status: 'cancelado' };
          if (novo !== p) await tx.put('pagamentos', novo);
          pagamentos.push(novo);
        }
        let pedido = { ...r.pedido };
        const statusFinal = derivarStatusPedido(pedido.status, atendimentos, entradaConfirmada(pagamentos));
        if (statusFinal !== pedido.status) {
          pedido = { ...pedido, status: statusFinal, historico: [...pedido.historico, { de: pedido.status, para: statusFinal, evento: 'cancelar_pedido', em: agora, ator: sessao.ator }] };
        }
        pedido.cancelamento = { em: agora, ator: sessao.ator, motivo: limparTexto(motivo || ''), atendimentosCancelados: cancelados };
        await tx.put('pedidos', pedido);
        await evento(tx, 'pedido_cancelado', { pedidoId: id, clienteId: pedido.clienteId }, { atendimentosCancelados: cancelados });
        return { pedido, atendimentos, pagamentos };
      }));
    },

    async salvarDocumento({ diaristaId, tipo, nomeArquivo, mime, tamanho, conteudo } = {}, { sessao, chave } = {}) {
      const cabecalho = await lerCabecalho(conteudo);
      if (!TIPOS_DOC.includes(tipo)) throw new ErroNegocio('DADOS_INVALIDOS', 'Tipo de documento inválido');
      if (!/^[0-9a-f-]{36}$/i.test(diaristaId || '')) throw new ErroNegocio('DADOS_INVALIDOS', 'Id do cadastro inválido');
      const erro = validarArquivo({ nome: nomeArquivo, mime, tamanho, cabecalho: cabecalho || new Uint8Array() });
      if (erro) throw new ErroNegocio('DADOS_INVALIDOS', erro, { arquivo: erro });
      return repo.transacao(TODOS, (tx) => idem(tx, 'salvarDocumento', sessao, chave, { diaristaId, tipo, nomeArquivo, mime, tamanho }, async () => {
        const existe = await tx.get('diaristas', diaristaId);
        if (existe && sessao?.ator !== 'prime') throw new ErroNegocio('ATOR_SEM_PERMISSAO', 'Cadastro já enviado; fale com a Prime pra trocar documentos');
        for (const d of await tx.por('documentos', 'diaristaId', diaristaId)) {
          if (d.tipo === tipo) { await tx.del('documentos', d.id); await tx.del('arquivos', d.blobRef); }
        }
        const doc = { id: gerarId(), diaristaId, tipo, nomeArquivo: String(nomeArquivo).slice(0, 120), mime, tamanho, blobRef: gerarId(), criadoEm: agoraISO() };
        await tx.put('arquivos', { id: doc.blobRef, conteudo });
        await tx.put('documentos', doc);
        return doc;
      }));
    },

    /** Metadados dos documentos de um cadastro (rascunho ou enviado). */
    async listarDocumentos(diaristaId, { sessao } = {}) {
      return repo.leitura(TODOS, async (tx) => {
        const d = await tx.get('diaristas', diaristaId);
        if (d && !(sessao?.ator === 'prime' || (sessao?.ator === 'diarista' && sessao.id === diaristaId))) throw new ErroNegocio('NAO_ENCONTRADO', 'Cadastro não encontrado');
        return { itens: await tx.por('documentos', 'diaristaId', diaristaId) };
      });
    },

    /** Conteúdo do arquivo (mock). No backend real vira URL assinada de curta duração. */
    async obterArquivo(documentoId, { sessao } = {}) {
      return repo.leitura(TODOS, async (tx) => {
        const doc = naoEncontrado(await tx.get('documentos', documentoId), 'Documento');
        const d = await tx.get('diaristas', doc.diaristaId);
        if (d && !(sessao?.ator === 'prime' || (sessao?.ator === 'diarista' && sessao.id === d.id))) throw new ErroNegocio('NAO_ENCONTRADO', 'Documento não encontrado');
        const a = naoEncontrado(await tx.get('arquivos', doc.blobRef), 'Arquivo');
        return { documento: doc, conteudo: a.conteudo };
      });
    },

    async cadastrarDiarista(dados = {}, { sessao, chave } = {}) {
      const d = {
        id: dados.id, nome: limparTexto(dados.nome), cpf: soDigitos(dados.cpf), telefone: soDigitos(dados.telefone),
        email: limparTexto(dados.email || '').toLowerCase(), dataNascimento: dados.dataNascimento, endereco: normalizarEndereco(dados.endereco),
        experienciaAnos: dados.experienciaAnos, disponibilidade: {
          dias: [...new Set(dados.disponibilidade?.dias || [])].sort(), turnos: [...new Set(dados.disponibilidade?.turnos || [])],
          regioes: [...new Set(dados.disponibilidade?.regioes || [])],
        },
      };
      if (!/^[0-9a-f-]{36}$/i.test(d.id || '')) throw new ErroNegocio('DADOS_INVALIDOS', 'Id do cadastro inválido');
      const erros = validarDiarista(d, hojeSP());
      if (d.disponibilidade.regioes.some((r) => !cfg.regioesDiarista.includes(r))) erros['disponibilidade.regioes'] = 'Região inválida';
      if (!['rg', 'cnh'].includes(dados.identidade)) erros.identidade = 'Escolha RG ou CNH';
      if (dados.aceiteTermos !== true) erros.aceiteTermos = 'É preciso aceitar os termos';
      erroCampos(erros);
      return repo.transacao(TODOS, (tx) => idem(tx, 'cadastrarDiarista', sessao, chave, { ...d, identidade: dados.identidade }, async () => {
        if (await tx.get('diaristas', d.id)) throw new ErroNegocio('DADOS_INVALIDOS', 'Este cadastro já foi enviado');
        const docs = await tx.por('documentos', 'diaristaId', d.id);
        const faltando = documentosFaltando(docs.map((x) => x.tipo), dados.identidade);
        if (faltando.length) throw new ErroNegocio('DADOS_INVALIDOS', 'Faltam documentos obrigatórios', { documentos: faltando });
        const diarista = { ...d, identidade: dados.identidade, documentos: docs.map((x) => x.id), status: 'pendente', criadoEm: agoraISO(), aceiteTermosEm: agoraISO() };
        await tx.put('diaristas', diarista);
        await evento(tx, 'diarista_cadastrada', { diaristaId: d.id });
        return diarista;
      }));
    },

    async obterDiarista(id, { sessao } = {}) {
      return repo.leitura(TODOS, async (tx) => {
        const d = await tx.get('diaristas', id);
        if (!d || !(sessao?.ator === 'prime' || (sessao?.ator === 'diarista' && sessao.id === id))) throw new ErroNegocio('NAO_ENCONTRADO', 'Cadastro não encontrado');
        return { diarista: d, documentos: await tx.por('documentos', 'diaristaId', id) };
      });
    },

    async listarDiaristas({ status } = {}, { sessao } = {}) {
      exigirPrime(sessao);
      return repo.leitura(TODOS, async (tx) => ({ itens: status ? await tx.por('diaristas', 'status', status) : await tx.todos('diaristas') }));
    },

    async aprovarDiarista(id, { motivo } = {}, ctx = {}) { return decidirDiarista(id, 'aprovada', motivo, ctx); },
    async reprovarDiarista(id, { motivo } = {}, ctx = {}) { return decidirDiarista(id, 'reprovada', motivo, ctx); },

    async criarAvaliacao(atendimentoId, { notas, comentario } = {}, { sessao, chave } = {}) {
      const criterios = ['pontualidade', 'qualidade', 'cuidado', 'comunicacao'];
      if (!notas || criterios.some((k) => !Number.isInteger(notas[k]) || notas[k] < 1 || notas[k] > 5)) {
        throw new ErroNegocio('DADOS_INVALIDOS', 'Dê uma nota de 1 a 5 em cada critério');
      }
      const texto = String(comentario ?? '').trim();
      if (texto.length > 500) throw new ErroNegocio('DADOS_INVALIDOS', 'Comentário com no máximo 500 caracteres');
      const n = Object.fromEntries(criterios.map((k) => [k, notas[k]]));
      return repo.transacao(TODOS, (tx) => idem(tx, 'criarAvaliacao', sessao, chave, { atendimentoId, n, texto }, async () => {
        const a = await tx.get('atendimentos', atendimentoId);
        const pedido = a && (await tx.get('pedidos', a.pedidoId));
        if (!a || !podeVerPedido(sessao, pedido)) throw new ErroNegocio('NAO_ENCONTRADO', 'Atendimento não encontrado');
        if (sessao?.ator !== 'cliente') throw new ErroNegocio('ATOR_SEM_PERMISSAO', 'Só a cliente avalia');
        if (a.status === 'avaliado' || (await tx.por('avaliacoes', 'atendimentoId', atendimentoId)).length) throw new ErroNegocio('JA_AVALIADO', 'Esta diária já foi avaliada');
        if (a.status !== 'finalizado') throw new ErroNegocio('TRANSICAO_PROIBIDA', 'A avaliação abre quando a diária é finalizada');
        const soma = criterios.reduce((s, k) => s + n[k], 0);
        const avaliacao = { id: gerarId(), atendimentoId, notas: n, notaFinal: Math.round((soma / 4) * 10) / 10, comentario: texto, criadoEm: agoraISO() };
        await tx.put('avaliacoes', avaliacao);
        const r = await aplicarTransicao(tx, a, 'avaliar', sessao);
        return { avaliacao, atendimento: r.atendimento };
      }));
    },

    async obterAvaliacaoDoAtendimento(atendimentoId, { sessao } = {}) {
      return repo.leitura(TODOS, async (tx) => {
        const a = await tx.get('atendimentos', atendimentoId);
        const pedido = a && (await tx.get('pedidos', a.pedidoId));
        if (!a || !podeVerPedido(sessao, pedido)) throw new ErroNegocio('NAO_ENCONTRADO', 'Atendimento não encontrado');
        return naoEncontrado((await tx.por('avaliacoes', 'atendimentoId', atendimentoId))[0], 'Avaliação');
      });
    },

    async listarNotificacoes({ pedidoId, diaristaId, status } = {}, { sessao } = {}) {
      exigirPrime(sessao);
      return repo.leitura(TODOS, async (tx) => {
        let itens = await tx.todos('notificacoes');
        if (pedidoId) itens = itens.filter((n) => n.refs?.pedidoId === pedidoId);
        if (diaristaId) itens = itens.filter((n) => n.refs?.diaristaId === diaristaId || n.destinatario?.id === diaristaId);
        if (status) itens = itens.filter((n) => n.status === status);
        const ordem = (n) => `${n.agendadaPara || n.criadoEm}|${n.criadoEm}|${String(n.ordem ?? 0).padStart(4, '0')}`;
        return { itens: itens.sort((a, b) => ordem(a).localeCompare(ordem(b))) };
      });
    },

    /** Contato manual pelo WhatsApp (wa.me): registra no histórico, NÃO é notificação. */
    async registrarContatoManual({ pedidoId, diaristaId, contexto } = {}, { sessao, chave } = {}) {
      const ctxTexto = String(contexto || '').slice(0, 60);
      return repo.transacao(TODOS, (tx) => idem(tx, 'registrarContatoManual', sessao, chave, { pedidoId, diaristaId, ctxTexto }, async () => {
        const item = { evento: 'contato_manual', canal: 'whatsapp', contexto: ctxTexto, em: agoraISO(), ator: sessao?.ator || 'publico' };
        if (pedidoId) {
          const p = await tx.get('pedidos', pedidoId);
          if (!p || !podeVerPedido(sessao, p)) throw new ErroNegocio('NAO_ENCONTRADO', 'Pedido não encontrado');
          await tx.put('pedidos', { ...p, historico: [...p.historico, { de: p.status, para: p.status, ...item }] });
          return { registrado: true };
        }
        const d = diaristaId && (await tx.get('diaristas', diaristaId));
        if (!d || !(sessao?.ator === 'prime' || (sessao?.ator === 'diarista' && sessao.id === d.id))) throw new ErroNegocio('NAO_ENCONTRADO', 'Cadastro não encontrado');
        await tx.put('diaristas', { ...d, historico: [...(d.historico || []), item] });
        return { registrado: true };
      }));
    },

    /** Só pra tela de dev/testes: eventos da fila. */
    async listarEventos({ status } = {}, { sessao } = {}) {
      exigirPrime(sessao);
      return repo.leitura(TODOS, async (tx) => ({ itens: (status ? await tx.por('eventos', 'status', status) : await tx.todos('eventos')).sort((a, b) => a.criadoEm.localeCompare(b.criadoEm)) }));
    },

    /** Existe algum pedido? (seed só com storage vazio) */
    async estaVazio() {
      return repo.leitura(TODOS, async (tx) => (await tx.todos('pedidos')).length === 0 && (await tx.todos('diaristas')).length === 0);
    },

    /** Grava registros prontos (seed de fixtures). Só usado quando o storage está vazio. */
    async semear({ clientes = [], diaristas = [] }, pedidos = []) {
      return repo.transacao(TODOS, async (tx) => {
        if ((await tx.todos('pedidos')).length) return { semeado: false };
        for (const c of clientes) await tx.put('clientes', { ...c, criadoEm: agoraISO() });
        for (const d of diaristas) await tx.put('diaristas', { ...d, criadoEm: agoraISO() });
        for (const p of pedidos) {
          const cliente = clientes.find((c) => c.id === p.clienteId);
          const montado = montarPedido({ cliente, pacote: p.pacote, primeiraData: p.primeiraData, turno: p.turno, chave: `seed-${p.clienteId}` });
          await gravarPedido(tx, montado);
        }
        return { semeado: true };
      });
    },

    /** Checagem de região (pro passo 2 do autoagendamento). */
    regiaoAtendida(endereco) { return regiaoDoEndereco(endereco, cfg.regioesAtendidas); },
    hoje: hojeSP,
  };

  async function decidirDiarista(id, status, motivo, { sessao, chave } = {}) {
    exigirPrime(sessao);
    return repo.transacao(TODOS, (tx) => idem(tx, status === 'aprovada' ? 'aprovarDiarista' : 'reprovarDiarista', sessao, chave, { id, motivo }, async () => {
      const d = naoEncontrado(await tx.get('diaristas', id), 'Diarista');
      if (d.status !== 'pendente') throw new ErroNegocio('TRANSICAO_PROIBIDA', `Cadastro já está ${d.status}`);
      const novo = { ...d, status, decisao: { em: agoraISO(), motivo: limparTexto(motivo || '') } };
      await tx.put('diaristas', novo);
      await evento(tx, status === 'aprovada' ? 'diarista_aprovada' : 'diarista_reprovada', { diaristaId: id });
      return novo;
    }));
  }

  return casos;
}
