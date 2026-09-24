// Casos de uso da Prime. Mesmo núcleo roda no adapter mock (IndexedDB) e no scripts/fake-api.mjs (memória).
// Cada escrita: valida -> transação única (mudança + idempotência + evento pendente). Contrato: docs/API.md.
import { ErroNegocio, TIPOS_DOCUMENTO as TIPOS_DOC } from '../domain/modelo.js';
import { transicionar, transicionarPedido, derivarStatusPedido, elegibilidadePagamento, ESTADOS_FUTUROS } from '../domain/estados.js';
import { calcularPacote, gerarAtendimentos, calcularCobrancas } from '../domain/pacote.js';
import { dataNoFuso, validarOcorrencias, regiaoDoEndereco, somarDias as somarDiasISO } from '../domain/calendario.js';
import { montarBRCode, txidDeBytes } from '../domain/brcode.js';
import { validarConfiguracao } from '../domain/configuracao.js';
import { validarCliente, validarDiarista, validarArquivo, documentosFaltando, soDigitos, normalizarCNPJ, validarNascimentoCliente, detectarIdentificador, senhaPadraoCliente } from '../domain/validacao.js';

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

  function novoPagamento({ pedidoId, atendimentoId, parcela, valorCentavos, descontoCentavos, venceEm, venceAs, chave }) {
    const pixTxid = novoTxid();
    return {
      id: gerarId(), pedidoId, ...(atendimentoId ? { atendimentoId } : {}), parcela, valorCentavos, descontoCentavos: descontoCentavos || 0,
      metodo: 'pix', pixTxid, brcode: brcodePara(valorCentavos, pixTxid), status: 'pendente', venceEm, venceAs,
      chaveIdempotencia: chave, criadoEm: agoraISO(),
    };
  }

  /** Preferência por profissional: texto livre e opcional (não é garantia de designação). */
  function normalizarPreferencia(v) {
    const t = limparTexto(String(v ?? ''));
    if (t.length > 120) throw new ErroNegocio('DADOS_INVALIDOS', 'Preferência com no máximo 120 caracteres', { preferenciaProfissional: 'No máximo 120 caracteres' });
    return t;
  }

  function normalizarCliente(d = {}) {
    const c = {
      tipo: d.tipo, nome: limparTexto(d.nome), telefone: soDigitos(d.telefone), email: limparTexto(d.email || '').toLowerCase(),
      endereco: normalizarEndereco(d.endereco),
    };
    if (d.tipo === 'empresa') {
      c.cnpj = normalizarCNPJ(d.cnpj); c.razaoSocial = limparTexto(d.razaoSocial); c.responsavel = limparTexto(d.responsavel);
    } else if (d.cpf) c.cpf = soDigitos(d.cpf);
    if (d.tipo !== 'empresa' && d.dataNascimento) c.dataNascimento = String(d.dataNascimento);
    erroCampos(validarCliente(c));
    const erroNascimento = c.dataNascimento ? validarNascimentoCliente(c.dataNascimento, hojeSP()) : '';
    if (erroNascimento) erroCampos({ dataNascimento: erroNascimento });
    return c;
  }

  /** SHA-256 hex (Web Crypto, igual no navegador e no Node): só pra senha PRÓPRIA do mock. */
  async function sha256(texto) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(texto)));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /** Monta a SOLICITAÇÃO: pedido + atendimentos (sem gravar), sem cobrança. O preço é SEMPRE recalculado aqui. */
  function montarPedido({ cliente, pacote: esp, primeiraData, turno, preferenciaProfissional }) {
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
    const preferencia = normalizarPreferencia(preferenciaProfissional);
    const pedido = {
      id: pedidoId, clienteId: cliente.id, pacote, atendimentoIds: atendimentos.map((a) => a.id), status: 'solicitado',
      ...(preferencia ? { preferenciaProfissional: preferencia } : {}),
      historico: [{ de: 'rascunho', para: 'solicitado', evento: 'solicitar', em: agora, ator: 'cliente' }], criadoEm: agora,
    };
    return { pedido, atendimentos, pagamentos: [] };
  }

  async function gravarPedido(tx, { pedido, atendimentos }) {
    await tx.put('pedidos', pedido);
    for (const a of atendimentos) await tx.put('atendimentos', a);
    await evento(tx, 'pedido_criado', { pedidoId: pedido.id, clienteId: pedido.clienteId });
  }

  /** Cobranças do pagamento antecipado e integral (depois da disponibilidade confirmada). */
  function montarCobrancas(pedido, atendimentos, chave) {
    const ativos = atendimentos.filter((a) => a.status !== 'cancelado');
    const modo = pedido.pacote.modoPagamento || 'por_diaria';
    return calcularCobrancas(ativos, modo, cfg).map((c) => novoPagamento({
      pedidoId: pedido.id, parcela: c.parcela, valorCentavos: c.valorCentavos, descontoCentavos: c.descontoCentavos, venceEm: c.venceEm, venceAs: c.venceAs,
      ...(c.parcela === 'diaria' ? { atendimentoId: ativos.find((a) => a.sequencia === c.sequencia).id } : {}),
      chave: `${chave}:${c.parcela}:${c.sequencia || 0}`,
    }));
  }

  async function carregarPedidoCompleto(tx, pedidoId) {
    const pedido = await tx.get('pedidos', pedidoId);
    if (!pedido) return null;
    const cliente = await tx.get('clientes', pedido.clienteId);
    const atendimentos = (await tx.por('atendimentos', 'pedidoId', pedidoId)).sort((a, b) => a.sequencia - b.sequencia);
    const pagamentos = (await tx.por('pagamentos', 'pedidoId', pedidoId)).sort((a, b) => (a.venceEm || '').localeCompare(b.venceEm || '') || (a.criadoEm || '').localeCompare(b.criadoEm || ''));
    return { pedido, cliente, atendimentos, pagamentos };
  }

  const algumConfirmado = (pagamentos) => pagamentos.some((p) => p.status === 'confirmado');

  /** A diária está paga? (a cobrança dela ou a do pacote confirmada) */
  function pagamentoDaDiariaConfirmado(pagamentos, atendimentoId) {
    return pagamentos.some((p) => p.status === 'confirmado' && (p.parcela === 'pacote' || (p.parcela === 'diaria' && p.atendimentoId === atendimentoId)));
  }

  /**
   * Diária cancelada ou remarcada depois da cobrança: as cobranças PENDENTES do pedido são recalculadas (o desconto do
   * mês segue as diárias ativas). Cobrança já informada ou confirmada não muda: diferença é acerto manual da Prime.
   */
  async function recalcularCobrancasPendentes(tx, pedidoId) {
    const pedido = await tx.get('pedidos', pedidoId);
    if ((pedido.pacote.modoPagamento || 'por_diaria') !== 'por_diaria') return;
    const ativos = (await tx.por('atendimentos', 'pedidoId', pedidoId)).filter((a) => a.status !== 'cancelado');
    const esperadas = calcularCobrancas(ativos, 'por_diaria', cfg);
    for (const g of await tx.por('pagamentos', 'pedidoId', pedidoId)) {
      if (g.parcela !== 'diaria' || g.status !== 'pendente') continue;
      const a = ativos.find((x) => x.id === g.atendimentoId);
      const e = a && esperadas.find((c) => c.sequencia === a.sequencia);
      if (e && (e.valorCentavos !== g.valorCentavos || e.venceEm !== g.venceEm)) {
        await tx.put('pagamentos', { ...g, valorCentavos: e.valorCentavos, descontoCentavos: e.descontoCentavos, venceEm: e.venceEm, venceAs: e.venceAs, brcode: brcodePara(e.valorCentavos, g.pixTxid) });
      }
    }
  }

  /** Recalcula e grava o status do pedido, registrando no histórico. */
  async function atualizarStatusPedido(tx, pedido, atendimentos, pagamentos, ator, eventoNome) {
    const novo = derivarStatusPedido(pedido.status, atendimentos, algumConfirmado(pagamentos));
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
      ator: sessao?.ator, atorId: sessao?.id, agora: agoraISO(), pagamentoConfirmado: pagamentoDaDiariaConfirmado(pagamentos, atendimento.id),
      diarista: diarista ? { id: diarista.id, status: diarista.status } : undefined, clienteIdDoPedido: pedido.clienteId, dados,
    });
    await tx.put('atendimentos', novo);
    if (ev === 'cancelar') {
      for (const p of pagamentos) {
        if (p.atendimentoId === novo.id && p.status !== 'confirmado' && p.status !== 'cancelado') await tx.put('pagamentos', { ...p, status: 'cancelado' });
      }
    }
    if (ev === 'cancelar' || ev === 'reagendar') await recalcularCobrancasPendentes(tx, pedido.id);
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

    async criarPedido({ clienteId, pacote, primeiraData, turno, preferenciaProfissional }, { sessao, chave } = {}) {
      return repo.transacao(TODOS, (tx) => idem(tx, 'criarPedido', sessao, chave, { clienteId, pacote, primeiraData, turno, preferenciaProfissional }, async () => {
        const cliente = naoEncontrado(await tx.get('clientes', clienteId), 'Cliente');
        if (sessao?.ator === 'cliente' && sessao.id !== clienteId) throw new ErroNegocio('ATOR_SEM_PERMISSAO', 'Cliente diferente');
        const montado = montarPedido({ cliente, pacote, primeiraData, turno, preferenciaProfissional });
        await gravarPedido(tx, montado);
        return { pedido: montado.pedido, atendimentos: montado.atendimentos };
      }));
    },

    /**
     * Autoagendamento (SOLICITAÇÃO): cliente + conta + pedido + atendimentos, tudo ou nada. Sem cobrança: ela nasce quando
     * a Prime confirma a disponibilidade (confirmarDisponibilidade).
     * Conta (decisão da cliente, 24/09/2026): não se cria senha. Cliente nova entra com a regra padrão: por e-mail ou
     * celular, os 6 primeiros números do CPF (ou CNPJ); pelo CPF, a data de nascimento. Por isso pessoa física informa CPF
     * e nascimento. Quem já tem cadastro (e-mail ou documento) precisa ENTRAR pra agendar; logada, o cadastro é reaproveitado.
     */
    async confirmarAutoagendamento({ cliente: dadosCliente, pacote, primeiraData, turno, preferenciaProfissional }, { sessao, chave } = {}) {
      const c = normalizarCliente(dadosCliente);
      const logado = sessao?.ator === 'cliente' ? sessao.id : null;
      if (!logado && c.tipo !== 'empresa') {
        const erros = {};
        if (!c.cpf) erros.cpf = 'Informe o CPF (os 6 primeiros números são a sua senha)';
        const en = validarNascimentoCliente(c.dataNascimento, hojeSP());
        if (en) erros.dataNascimento = en;
        erroCampos(erros);
      }
      const conteudo = { cliente: c, pacote, primeiraData, turno, preferenciaProfissional, logado };
      return repo.transacao(TODOS, (tx) => idem(tx, 'confirmarAutoagendamento', sessao, chave, conteudo, async () => {
        let cliente;
        if (logado) {
          const atual = naoEncontrado(await tx.get('clientes', logado), 'Cliente');
          const docNovo = c.cnpj || c.cpf; const docAtual = atual.cnpj || atual.cpf;
          if (docAtual && docNovo && docAtual !== docNovo) throw new ErroNegocio('DADOS_INVALIDOS', 'O CPF/CNPJ informado não confere com o do seu cadastro. Fale com a Prime.', { [c.cnpj ? 'cnpj' : 'cpf']: 'Não confere com o cadastro' });
          cliente = { ...atual, ...c, id: atual.id, email: atual.email || c.email, ...(atual.cpf ? { cpf: atual.cpf } : {}), ...(atual.cnpj ? { cnpj: atual.cnpj } : {}), ...(atual.dataNascimento ? { dataNascimento: atual.dataNascimento } : {}) };
        } else {
          if (await tx.get('credenciais', c.email)) throw new ErroNegocio('DADOS_INVALIDOS', 'Já existe conta com este e-mail. Entre na sua conta pra agendar.', { email: 'Já existe conta com este e-mail' });
          const doc = c.cnpj || c.cpf;
          if (doc && (await tx.todos('clientes')).some((x) => (x.cnpj || x.cpf) === doc)) {
            throw new ErroNegocio('DADOS_INVALIDOS', `Já existe cadastro com este ${c.cnpj ? 'CNPJ' : 'CPF'}. Entre na sua conta pra agendar.`, { [c.cnpj ? 'cnpj' : 'cpf']: 'Já cadastrado: entre na sua conta' });
          }
          cliente = { id: gerarId(), ...c, criadoEm: agoraISO() };
          await tx.put('credenciais', { email: c.email, tipo: 'cliente', refId: cliente.id, hash: null, criadoEm: agoraISO() });
        }
        const montado = montarPedido({ cliente, pacote, primeiraData, turno, preferenciaProfissional });
        await tx.put('clientes', cliente);
        await gravarPedido(tx, montado);
        return { cliente, ...montado };
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
        // diarista não vê cobrança
        const pagamento = sessao?.ator === 'diarista' ? null : ((await tx.por('pagamentos', 'atendimentoId', id)).find((p) => p.parcela === 'diaria' && p.status !== 'cancelado')
          || (await tx.por('pagamentos', 'pedidoId', pedido.id)).find((p) => p.parcela === 'pacote' && p.status !== 'cancelado') || null);
        const avaliacao = (await tx.por('avaliacoes', 'atendimentoId', id))[0] || null;
        const cliente = await tx.get('clientes', pedido.clienteId);
        return {
          atendimento, pedido, cliente: { id: cliente.id, nome: cliente.nome, endereco: { bairro: cliente.endereco.bairro, cidade: cliente.endereco.cidade } },
          diarista: d ? { id: d.id, nome: d.nome, status: d.status } : null, pagamento, avaliacao,
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
        // Sem sobreposição: mesma data e período em conflito (integral conflita com tudo). GPT#6.
        const sobrepoe = (x) => x.id !== a.id && x.data === a.data && x.status !== 'cancelado' && (x.turno === a.turno || x.turno === 'integral' || a.turno === 'integral');
        const ocupada = (await tx.por('atendimentos', 'diaristaId', diaristaId)).find(sobrepoe);
        if (ocupada) throw new ErroNegocio('CONDICAO_NAO_ATENDIDA', `${d.nome.split(' ')[0]} já tem diária em ${a.data} nesse período`);
        const novo = { ...a, diaristaId, versao: (a.versao || 0) + 1 };
        await tx.put('atendimentos', novo);
        await evento(tx, 'atendimento_atribuido', { pedidoId: a.pedidoId, atendimentoId: a.id, diaristaId }, { anterior: a.diaristaId || null, versao: novo.versao });
        return { atendimento: novo };
      }));
    },

    /**
     * A Prime confirma a disponibilidade da solicitação e a cobrança nasce na mesma transação (pagamento antecipado e
     * integral): solicitado -> disponibilidade_confirmada -> aguardando_pagamento. Com o Asaas (B4) a emissão vira chamada
     * externa e o pedido pode parar em disponibilidade_confirmada até ela voltar.
     */
    async confirmarDisponibilidade(id, { observacao } = {}, { sessao, chave } = {}) {
      exigirPrime(sessao);
      const obs = limparTexto(String(observacao ?? '')).slice(0, 300);
      return repo.transacao(TODOS, (tx) => idem(tx, 'confirmarDisponibilidade', sessao, chave, { id, obs }, async () => {
        const r = naoEncontrado(await carregarPedidoCompleto(tx, id), 'Pedido');
        const agora = agoraISO();
        let pedido = transicionarPedido(r.pedido, 'confirmar_disponibilidade', { ator: 'prime', agora });
        if (obs) pedido.observacaoDisponibilidade = obs;
        const pagamentos = montarCobrancas(pedido, r.atendimentos, chave);
        for (const g of pagamentos) await tx.put('pagamentos', g);
        pedido = transicionarPedido(pedido, 'emitir_cobranca', { ator: 'sistema', agora });
        await tx.put('pedidos', pedido);
        await evento(tx, 'disponibilidade_confirmada', { pedidoId: id, clienteId: pedido.clienteId }, { pagamentos: pagamentos.map((g) => g.id) });
        for (const g of pagamentos) await evento(tx, 'cobranca_emitida', { pedidoId: id, clienteId: pedido.clienteId, pagamentoId: g.id, atendimentoId: g.atendimentoId });
        return { pedido, atendimentos: r.atendimentos, pagamentos };
      }));
    },

    /** Sem disponibilidade: a Prime recusa com motivo; as diárias e cobranças abertas são canceladas. */
    async recusarSolicitacao(id, { motivo } = {}, { sessao, chave } = {}) {
      exigirPrime(sessao);
      const m = limparTexto(String(motivo ?? ''));
      if (m.length < 3 || m.length > 300) throw new ErroNegocio('DADOS_INVALIDOS', 'Escreva o motivo (de 3 a 300 caracteres)', { motivo: 'Escreva o motivo' });
      return repo.transacao(TODOS, (tx) => idem(tx, 'recusarSolicitacao', sessao, chave, { id, m }, async () => {
        const r = naoEncontrado(await carregarPedidoCompleto(tx, id), 'Pedido');
        const agora = agoraISO();
        const pedido = { ...transicionarPedido(r.pedido, 'recusar', { ator: 'prime', agora, algumPagamentoConfirmado: algumConfirmado(r.pagamentos) }), recusa: { em: agora, motivo: m, ator: 'prime' } };
        const atendimentos = [];
        for (const a of r.atendimentos) {
          if (ESTADOS_FUTUROS.includes(a.status)) {
            const novo = transicionar(a, 'cancelar', { ator: 'prime', agora });
            await tx.put('atendimentos', novo);
            atendimentos.push(novo);
          } else atendimentos.push(a);
        }
        const pagamentos = [];
        for (const g of r.pagamentos) {
          const novo = ['pendente', 'informado_pelo_cliente'].includes(g.status) ? { ...g, status: 'cancelado' } : g;
          if (novo !== g) await tx.put('pagamentos', novo);
          pagamentos.push(novo);
        }
        await tx.put('pedidos', pedido);
        await evento(tx, 'solicitacao_recusada', { pedidoId: id, clienteId: pedido.clienteId }, { motivo: m });
        return { pedido, atendimentos, pagamentos };
      }));
    },

    /**
     * Imprevisto sem substituição: a Prime registra o estorno MANUAL de um pagamento confirmado, com motivo. As diárias
     * cobertas por ele que ainda não aconteceram são canceladas. Não movimenta dinheiro: é o registro do que a Prime fez.
     */
    async registrarEstorno(pagamentoId, { motivo } = {}, { sessao, chave } = {}) {
      exigirPrime(sessao);
      const m = limparTexto(String(motivo ?? ''));
      if (m.length < 3 || m.length > 300) throw new ErroNegocio('DADOS_INVALIDOS', 'Escreva o motivo do estorno (de 3 a 300 caracteres)', { motivo: 'Escreva o motivo' });
      return repo.transacao(TODOS, (tx) => idem(tx, 'registrarEstorno', sessao, chave, { pagamentoId, m }, async () => {
        const g = naoEncontrado(await tx.get('pagamentos', pagamentoId), 'Pagamento');
        if (g.status !== 'confirmado') throw new ErroNegocio('PAGAMENTO_NAO_ELEGIVEL', 'Só dá pra estornar pagamento confirmado');
        const agora = agoraISO();
        const pg = { ...g, status: 'estornado', estorno: { em: agora, motivo: m, ator: 'prime' } };
        await tx.put('pagamentos', pg);
        const alvo = (await tx.por('atendimentos', 'pedidoId', g.pedidoId)).filter((a) => (g.parcela === 'pacote' || a.id === g.atendimentoId) && ESTADOS_FUTUROS.includes(a.status));
        for (const a of alvo) await aplicarTransicao(tx, a, 'cancelar', { ator: 'prime' });
        await evento(tx, 'estorno_registrado', { pedidoId: g.pedidoId, pagamentoId: g.id, atendimentoId: g.atendimentoId }, { motivo: m });
        const r = await carregarPedidoCompleto(tx, g.pedidoId);
        return { pagamento: pg, pedido: r.pedido, atendimentos: r.atendimentos };
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
        // a diária paga (ou todas, no pacote) passa pra confirmada; o pedido vira confirmado no primeiro pagamento
        const atendimentos = [];
        for (const a of r.atendimentos) {
          const coberta = p.parcela === 'pacote' || a.id === p.atendimentoId;
          if (coberta && a.status === 'agendado') atendimentos.push((await aplicarTransicao(tx, a, 'confirmar', { ator: 'sistema' })).atendimento);
          else atendimentos.push(a);
        }
        const pgs = await tx.por('pagamentos', 'pedidoId', r.pedido.id);
        const pedido = await atualizarStatusPedido(tx, await tx.get('pedidos', r.pedido.id), atendimentos, pgs, 'sistema', 'pagamento_confirmado');
        return { pagamento: pg, pedido, atendimentos };
      }));
    },

    async cancelarPedido(id, { motivo } = {}, { sessao, chave } = {}) {
      return repo.transacao(TODOS, (tx) => idem(tx, 'cancelarPedido', sessao, chave, { id, motivo }, async () => {
        const r = await carregarPedidoCompleto(tx, id);
        if (!r || !podeVerPedido(sessao, r.pedido)) throw new ErroNegocio('NAO_ENCONTRADO', 'Pedido não encontrado');
        if (!['cliente', 'prime'].includes(sessao?.ator)) throw new ErroNegocio('ATOR_SEM_PERMISSAO', 'Sem permissão');
        if (['cancelado', 'concluido', 'recusado'].includes(r.pedido.status)) throw new ErroNegocio('TRANSICAO_PROIBIDA', `Pedido já está ${r.pedido.status}`);
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
        await recalcularCobrancasPendentes(tx, id);
        // cobranças abertas das diárias canceladas (e a do pacote, se nada dele vai acontecer) caem; pagamento já
        // confirmado continua confirmado: devolução é estorno manual da Prime (registrarEstorno)
        const nadaAtivo = atendimentos.every((a) => a.status === 'cancelado');
        const pagamentos = [];
        for (const p of await tx.por('pagamentos', 'pedidoId', id)) {
          let novo = p;
          const aberto = p.status === 'pendente' || p.status === 'informado_pelo_cliente';
          if (aberto && p.parcela === 'diaria' && cancelados.includes(p.atendimentoId)) novo = { ...p, status: 'cancelado' };
          if (aberto && p.parcela === 'pacote' && nadaAtivo) novo = { ...p, status: 'cancelado' };
          if (novo !== p) await tx.put('pagamentos', novo);
          pagamentos.push(novo);
        }
        let pedido = { ...r.pedido };
        const statusFinal = derivarStatusPedido(pedido.status, atendimentos, algumConfirmado(pagamentos));
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
      // Tamanho REAL do conteúdo (o informado pelo navegador não vale): GPT#5.
      const tamanhoReal = conteudo?.byteLength ?? conteudo?.size ?? conteudo?.length ?? 0;
      if (tamanho !== undefined && tamanho !== tamanhoReal) throw new ErroNegocio('DADOS_INVALIDOS', 'Tamanho do arquivo não confere');
      tamanho = tamanhoReal;
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

    /** Atendimentos por período (painel da Prime). */
    async listarAtendimentos({ de, ate, status } = {}, { sessao } = {}) {
      exigirPrime(sessao);
      return repo.leitura(TODOS, async (tx) => {
        let itens = await tx.todos('atendimentos');
        if (de) itens = itens.filter((a) => a.data >= de);
        if (ate) itens = itens.filter((a) => a.data <= ate);
        if (status) itens = itens.filter((a) => a.status === status);
        const out = [];
        for (const a of itens.sort((x, y) => x.data.localeCompare(y.data) || x.sequencia - y.sequencia)) {
          const pedido = await tx.get('pedidos', a.pedidoId);
          const cliente = pedido && (await tx.get('clientes', pedido.clienteId));
          const d = a.diaristaId ? await tx.get('diaristas', a.diaristaId) : null;
          out.push({ atendimento: a, pedido: pedido && { id: pedido.id, status: pedido.status, pacote: pedido.pacote, ...(pedido.preferenciaProfissional ? { preferenciaProfissional: pedido.preferenciaProfissional } : {}) }, cliente: cliente && { id: cliente.id, nome: cliente.nome, telefone: cliente.telefone, endereco: cliente.endereco }, diarista: d && { id: d.id, nome: d.nome, status: d.status } });
        }
        return { itens: out };
      });
    },

    /** Agenda da diarista: só os atendimentos atribuídos a ela. Endereço completo só a partir da véspera. */
    async listarAtendimentosDaDiarista(diaristaId, { sessao } = {}) {
      if (!(sessao?.ator === 'prime' || (sessao?.ator === 'diarista' && sessao.id === diaristaId))) throw new ErroNegocio('NAO_ENCONTRADO', 'Cadastro não encontrado');
      return repo.leitura(TODOS, async (tx) => {
        const d = naoEncontrado(await tx.get('diaristas', diaristaId), 'Cadastro');
        const itens = (await tx.por('atendimentos', 'diaristaId', diaristaId)).sort((x, y) => x.data.localeCompare(y.data));
        const hoje = hojeSP();
        const out = [];
        for (const a of itens) {
          const pedido = await tx.get('pedidos', a.pedidoId);
          const c = pedido && (await tx.get('clientes', pedido.clienteId));
          const vespera = a.data <= somarDiasISO(hoje, 1);
          out.push({
            atendimento: a, pacote: pedido?.pacote && { tipoServico: pedido.pacote.tipoServico, duracaoHoras: pedido.pacote.duracaoHoras, passadoriaCombinada: pedido.pacote.passadoriaCombinada },
            cliente: c && { nome: c.nome.split(' ')[0], bairro: c.endereco.bairro, cidade: c.endereco.cidade, ...(vespera ? { endereco: c.endereco, telefone: c.telefone } : {}) },
          });
        }
        return { diarista: { id: d.id, nome: d.nome, status: d.status, decisao: d.decisao }, itens: out };
      });
    },

    /** Avaliações recebidas (painel), com a diarista de cada uma. */
    async listarAvaliacoes({ diaristaId } = {}, { sessao } = {}) {
      exigirPrime(sessao);
      return repo.leitura(TODOS, async (tx) => {
        const out = [];
        for (const av of (await tx.todos('avaliacoes')).sort((x, y) => y.criadoEm.localeCompare(x.criadoEm))) {
          const a = await tx.get('atendimentos', av.atendimentoId);
          if (diaristaId && a?.diaristaId !== diaristaId) continue;
          const d = a?.diaristaId ? await tx.get('diaristas', a.diaristaId) : null;
          out.push({ avaliacao: av, atendimento: a && { id: a.id, data: a.data }, diarista: d && { id: d.id, nome: d.nome } });
        }
        return { itens: out };
      });
    },

    /**
     * SÓ MOCK (login de demonstração): mesma regra da Edge Function "conta". Campo único (CPF, e-mail ou celular), tipo
     * detectado aqui; senha própria (se a cliente trocou) vale pra qualquer via; sem ela, a regra padrão. Resposta nula
     * é sempre a mesma (não diz se o cadastro existe). No backend real é a function; não vira rota.
     */
    async verificarLoginCliente({ identificador, senha }) {
      const id = detectarIdentificador(identificador);
      if (!id.tipo) return null;
      return repo.leitura(TODOS, async (tx) => {
        const clientes = await tx.todos('clientes');
        let achados;
        if (id.tipo === 'email') achados = clientes.filter((x) => x.email === id.valor);
        else if (id.tipo === 'cpf') achados = clientes.filter((x) => x.cpf === id.valor);
        else achados = clientes.filter((x) => x.telefone === id.valor);
        if (achados.length !== 1) return null; // inexistente ou celular de mais de um cliente
        const cli = achados[0];
        const cred = cli.email ? await tx.get('credenciais', cli.email) : null;
        if (!cred || cred.refId !== cli.id) return null; // sem acesso
        if (cred.hash) return cred.hash === (await sha256(senha)) ? { tipo: 'cliente', id: cli.id, nome: cli.nome } : null;
        const esperada = senhaPadraoCliente(cli, id.tipo);
        return esperada && String(senha) === esperada ? { tipo: 'cliente', id: cli.id, nome: cli.nome } : null;
      });
    },
    /** SÓ MOCK: troca a senha da cliente conferindo a atual (própria ou a padrão). No Supabase é a Edge Function "conta". */
    async trocarSenhaMock({ clienteId, senhaAtual, senhaNova }) {
      if (String(senhaNova ?? '').length < 6) return false;
      return repo.transacao(TODOS, async (tx) => {
        const cli = await tx.get('clientes', clienteId);
        const cred = cli?.email && (await tx.get('credenciais', cli.email));
        if (!cred || cred.refId !== clienteId) return false;
        const ok = cred.hash ? cred.hash === (await sha256(senhaAtual))
          : [senhaPadraoCliente(cli, 'email'), senhaPadraoCliente(cli, 'cpf')].includes(String(senhaAtual));
        if (!ok) return false;
        await tx.put('credenciais', { ...cred, hash: await sha256(senhaNova) });
        return true;
      });
    },
    /** SÓ MOCK: existe conta com este e-mail? (recuperação de senha de demonstração) */
    async existeCredencial(email) {
      const e = String(email || '').trim().toLowerCase();
      return repo.leitura(TODOS, async (tx) => !!(await tx.get('credenciais', e)));
    },

    /** SÓ MOCK (login de demonstração): acha a cliente pelo WhatsApp. No backend real o OTP faz isso; não vira rota. */
    async buscarClientePorTelefone(telefone) {
      const d = soDigitos(telefone);
      return repo.leitura(TODOS, async (tx) => { const c = (await tx.todos('clientes')).find((x) => x.telefone === d); return c ? { id: c.id, nome: c.nome } : null; });
    },
    /** SÓ MOCK (login de demonstração): acha a diarista pelo e-mail. */
    async buscarDiaristaPorEmail(email) {
      const e = String(email || '').trim().toLowerCase();
      return repo.leitura(TODOS, async (tx) => { const d = (await tx.todos('diaristas')).find((x) => x.email === e); return d ? { id: d.id, nome: d.nome, status: d.status } : null; });
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
        for (const { senhaHash, ...c } of clientes) {
          await tx.put('clientes', { ...c, criadoEm: agoraISO() });
          if (c.email) await tx.put('credenciais', { email: c.email, hash: senhaHash || null, tipo: 'cliente', refId: c.id, criadoEm: agoraISO() });
        }
        for (const d of diaristas) await tx.put('diaristas', { ...d, criadoEm: agoraISO() });
        for (const p of pedidos) {
          const cliente = clientes.find((c) => c.id === p.clienteId);
          const montado = montarPedido({ cliente, pacote: p.pacote, primeiraData: p.primeiraData, turno: p.turno, preferenciaProfissional: p.preferenciaProfissional });
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
