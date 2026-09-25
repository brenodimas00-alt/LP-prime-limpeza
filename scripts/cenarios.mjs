// Cenários de contrato compartilhados: rodam contra os casos de uso (memória) e contra o adapter http + fake-api.
// `ctx.api` tem a mesma assinatura nos dois: api.caso(...args, { sessao, chave }).
import { assert, lancaCodigo } from './lib-teste.mjs';
import { CLIENTE_RESIDENCIAL, CLIENTE_EMPRESA, DIARISTA_FICTICIA } from './fixtures/seed.js';
import { ARQUIVOS } from './fixtures/arquivos.mjs';
import { lerTLV } from '../src/domain/brcode.js';

export const AGORA_TESTE = '2026-10-01T12:00:00.000Z'; // quinta; hoje em SP = 2026-10-01
export const PRIMEIRA = '2026-10-05'; // segunda
const PRIME = { ator: 'prime' };
let n = 0;
// Conta da cliente (24/09/2026): sem senha no agendamento. Cliente nova agenda sem estar logada; quem já tem cadastro
// agenda LOGADA. A bateria lembra, por api, qual cliente cada e-mail virou (e mantém a mesma sessão pra mesma chave,
// senão a repetição idempotente mudaria de escopo).
const clientesPorApi = new WeakMap();
const sessaoPorChave = new Map();
export async function agendar(api, dados, k = chave('auto')) {
  if (!clientesPorApi.has(api)) clientesPorApi.set(api, new Map());
  const conhecidos = clientesPorApi.get(api);
  const id = conhecidos.get(dados.cliente.email);
  const sessao = sessaoPorChave.get(k) || (id ? { ator: 'cliente', id } : { ator: 'publico' });
  sessaoPorChave.set(k, sessao);
  const r = await api.confirmarAutoagendamento(dados, { sessao, chave: k });
  conhecidos.set(dados.cliente.email, r.cliente.id);
  return r;
}
export const chave = (p = 'k') => `${p}-${Date.now().toString(36)}-${(++n).toString(36)}-teste`;

const AVULSO = { tipoServico: 'residencial', duracaoHoras: 4, metragem: 45, quantidadeDiarias: 1, frequencia: 'avulso' };
const SEMANAL4 = { tipoServico: 'empresarial', duracaoHoras: 6, metragem: 100, quantidadeDiarias: 4, frequencia: 'semanal', semLocalAlmoco: true };

export async function criarAvulso(api, k = chave('auto')) {
  return agendar(api, { cliente: CLIENTE_RESIDENCIAL, pacote: AVULSO, primeiraData: PRIMEIRA, turno: 'manha' }, k);
}

export async function criarDiaristaAprovada(api) {
  const id = await criarDiaristaPendente(api);
  await api.aprovarDiarista(id, {}, { sessao: PRIME, chave: chave('apr') });
  return id;
}

/** Cadastro completo enviado, aguardando a Prime. */
export async function criarDiaristaPendente(api) {
  const id = crypto.randomUUID();
  for (const tipo of ['cnh_frente', 'cnh_verso', 'comprovante_residencia', 'foto_perfil', 'antecedentes']) {
    const arq = tipo === 'antecedentes' || tipo === 'comprovante_residencia' ? ARQUIVOS.pdf : ARQUIVOS.png;
    await api.salvarDocumento({ diaristaId: id, tipo, nomeArquivo: `${tipo}.${arq.ext}`, mime: arq.mime, tamanho: arq.bytes.length, conteudo: arq.bytes }, { sessao: { ator: 'publico' }, chave: chave('doc') });
  }
  const d = await api.cadastrarDiarista({ id, ...DIARISTA_FICTICIA, identidade: 'cnh', aceiteTermos: true }, { sessao: { ator: 'publico' }, chave: chave('cad') });
  assert.equal(d.status, 'pendente');
  return id;
}

/** A Prime confirma a disponibilidade (a cobrança nasce aqui). Devolve as cobranças. */
export async function liberarCobranca(api, r) {
  const d = await api.confirmarDisponibilidade(r.pedido.id, {}, { sessao: PRIME, chave: chave('disp') });
  return d.pagamentos;
}

/** Leva um atendimento de agendado até finalizado (disponibilidade, pagamento da diária, atribuição e execução). */
export async function levarAteFinalizado(api, r, diaristaId, atendimentoId) {
  const at = atendimentoId || r.atendimentos[0].id;
  const atual = await api.obterPedido(r.pedido.id, { sessao: PRIME });
  if (atual.pedido.status === 'solicitado') await liberarCobranca(api, r);
  await api.atribuirDiarista(at, { diaristaId }, { sessao: PRIME, chave: chave('atr') });
  const { pagamentos } = await api.obterPedido(r.pedido.id, { sessao: PRIME });
  const g = pagamentos.find((p) => p.parcela === 'pacote' || p.atendimentoId === at);
  if (g.status !== 'confirmado') await api.confirmarPagamento(g.id, { sessao: PRIME, chave: chave('conf') });
  const sd = { ator: 'diarista', id: diaristaId };
  await api.transicionarAtendimento(at, { evento: 'sair_a_caminho' }, { sessao: sd, chave: chave('t') });
  await api.transicionarAtendimento(at, { evento: 'iniciar' }, { sessao: sd, chave: chave('t') });
  return api.transicionarAtendimento(at, { evento: 'finalizar' }, { sessao: sd, chave: chave('t') });
}

const criarEmpresa = (api, k = chave('emp')) => agendar(api, { cliente: CLIENTE_EMPRESA, pacote: SEMANAL4, primeiraData: PRIMEIRA, turno: 'tarde' }, k);

export function registrarCenarios(t, ctx) {
  const api = () => ctx.api;
  const cli = (r) => ({ ator: 'cliente', id: r.cliente.id });

  t.teste('reprovar cadastro exige motivo (validado no servidor, não só na tela)', async () => {
    const id = await criarDiaristaPendente(api());
    await lancaCodigo(() => api().reprovarDiarista(id, {}, { sessao: PRIME, chave: chave('rep') }), 'DADOS_INVALIDOS');
    await lancaCodigo(() => api().reprovarDiarista(id, { motivo: '   ' }, { sessao: PRIME, chave: chave('rep') }), 'DADOS_INVALIDOS');
    const d = await api().reprovarDiarista(id, { motivo: '  documento   ilegível ' }, { sessao: PRIME, chave: chave('rep') });
    assert.equal(d.status, 'reprovada');
    assert.equal(d.decisao.motivo, 'documento ilegível');
  });

  t.teste('solicitação avulsa: pedido solicitado, 1 atendimento e NENHUMA cobrança antes da Prime', async () => {
    const r = await criarAvulso(api());
    assert.equal(r.pedido.status, 'solicitado');
    assert.equal(r.atendimentos.length, 1);
    assert.equal(r.atendimentos[0].data, PRIMEIRA);
    assert.equal(r.atendimentos[0].status, 'agendado');
    assert.deepEqual(r.pagamentos, [], 'solicitação não é cobrança');
    assert.equal('entradaCentavos' in r.pedido.pacote, false, 'sem 50/50');
  });

  t.teste('disponibilidade confirmada: cobrança antecipada e INTEGRAL da diária, até 14h do dia útil anterior', async () => {
    const r = await criarAvulso(api());
    const d = await api().confirmarDisponibilidade(r.pedido.id, {}, { sessao: PRIME, chave: chave('disp') });
    assert.equal(d.pedido.status, 'aguardando_pagamento');
    assert.deepEqual(d.pedido.historico.map((h) => h.para), ['solicitado', 'disponibilidade_confirmada', 'aguardando_pagamento']);
    assert.equal(d.pagamentos.length, 1);
    const g = d.pagamentos[0];
    assert.equal(g.parcela, 'diaria'); assert.equal(g.atendimentoId, r.atendimentos[0].id);
    assert.equal(g.valorCentavos, r.pedido.pacote.totalCentavos);
    assert.equal(g.venceEm, '2026-10-02'); assert.equal(g.venceAs, '14:00'); // seg 05 -> sex 02
    assert.ok(/^[A-Za-z0-9]{25}$/.test(g.pixTxid) && g.pixTxid !== g.id);
    assert.equal(lerTLV(g.brcode)['54'], `${Math.floor(g.valorCentavos / 100)}.${String(g.valorCentavos % 100).padStart(2, '0')}`);
    const pg = await api().obterPagamento(g.id, { sessao: cli(r) });
    assert.equal(pg.elegibilidade.pagavel, true, 'pagável antes da diária (antecipado)');
    await lancaCodigo(() => api().confirmarDisponibilidade(r.pedido.id, {}, { sessao: PRIME, chave: chave('disp') }), 'TRANSICAO_PROIBIDA');
  });

  t.teste('idempotência: mesma chave repetida devolve o mesmo pedido (sem duplicar)', async () => {
    const k = chave('idem');
    const a = await criarAvulso(api(), k);
    const b = await criarAvulso(api(), k);
    assert.equal(a.pedido.id, b.pedido.id);
    const lista = await api().listarPedidos({ clienteId: a.cliente.id }, { sessao: PRIME });
    assert.equal(lista.itens.filter((p) => p.id === a.pedido.id).length, 1);
    const c = await criarAvulso(api(), k);
    assert.equal((await api().listarPedidos({ clienteId: a.cliente.id }, { sessao: PRIME })).itens.length, lista.itens.length, 'terceira chamada com a mesma chave não cria pedido');
    assert.equal(c.pedido.id, a.pedido.id);
    const kd = chave('disp');
    const d1 = await api().confirmarDisponibilidade(a.pedido.id, {}, { sessao: PRIME, chave: kd });
    const d2 = await api().confirmarDisponibilidade(a.pedido.id, {}, { sessao: PRIME, chave: kd });
    assert.deepEqual(d2.pagamentos.map((g) => g.id), d1.pagamentos.map((g) => g.id), 'confirmar disponibilidade duas vezes não duplica cobrança');
  });

  t.teste('conta: cadastro existente só agenda logado (reaproveita, sem duplicar); CPF e nascimento obrigatórios na conta nova', async () => {
    const a = await criarAvulso(api());
    const b = await criarAvulso(api());
    assert.equal(a.cliente.id, b.cliente.id, 'mesma cliente');
    if (ctx.contaNoBackend) return; // Supabase: a conta nasce na function "conta" (testa-auth), o pedido já vem logado
    const dados = { cliente: CLIENTE_RESIDENCIAL, pacote: AVULSO, primeiraData: PRIMEIRA, turno: 'manha' };
    const e1 = await lancaCodigo(() => api().confirmarAutoagendamento(dados, { sessao: { ator: 'publico' }, chave: chave('conta') }), 'DADOS_INVALIDOS');
    assert.ok(e1.detalhes.email, 'e-mail já tem conta: pede pra entrar');
    const outraPessoa = { ...CLIENTE_RESIDENCIAL, email: `outra-${chave()}@exemplo.com` };
    const e2 = await lancaCodigo(() => api().confirmarAutoagendamento({ ...dados, cliente: outraPessoa }, { sessao: { ator: 'publico' }, chave: chave('conta') }), 'DADOS_INVALIDOS');
    assert.ok(e2.detalhes.cpf, 'CPF já cadastrado: pede pra entrar');
    const semNascimento = { ...outraPessoa, cpf: '11144477735', dataNascimento: undefined };
    const e3 = await lancaCodigo(() => api().confirmarAutoagendamento({ ...dados, cliente: semNascimento }, { sessao: { ator: 'publico' }, chave: chave('conta') }), 'DADOS_INVALIDOS');
    assert.ok(e3.detalhes.dataNascimento);
    const e4 = await lancaCodigo(() => api().confirmarAutoagendamento({ ...dados, cliente: { ...outraPessoa, cpf: undefined } }, { sessao: { ator: 'publico' }, chave: chave('conta') }), 'DADOS_INVALIDOS');
    assert.ok(e4.detalhes.cpf);
  });

  t.teste('idempotência: mesma chave com conteúdo diferente -> CONFLITO_IDEMPOTENCIA', async () => {
    const k = chave('idem2');
    await criarAvulso(api(), k);
    await lancaCodigo(() => agendar(api(), { cliente: CLIENTE_RESIDENCIAL, pacote: { ...AVULSO, duracaoHoras: 6 }, primeiraData: PRIMEIRA, turno: 'manha' }, k), 'CONFLITO_IDEMPOTENCIA');
  });

  t.teste('empresa 4 diárias semanais: uma cobrança por diária; desconto do mês (R$ 20) inteiro na última de outubro', async () => {
    const r = await criarEmpresa(api());
    assert.deepEqual(r.atendimentos.map((a) => a.data), ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
    const cobr = await liberarCobranca(api(), r);
    assert.equal(cobr.length, 4);
    assert.equal(cobr.reduce((s, p) => s + p.valorCentavos, 0), r.pedido.pacote.totalCentavos);
    const porSeq = r.atendimentos.map((a) => cobr.find((g) => g.atendimentoId === a.id));
    assert.deepEqual(porSeq.map((g) => g.descontoCentavos), [0, 0, 0, 2000]);
    assert.deepEqual(porSeq.map((g) => g.venceEm), ['2026-10-02', '2026-10-09', '2026-10-16', '2026-10-23']); // 12/10 é feriado: dia útil anterior é 09/10
    assert.equal(r.cliente.cnpj, '12ABC34501DE35');
  });

  t.teste('backend recalcula preço: total enviado pelo navegador é ignorado', async () => {
    const r = await agendar(api(), { cliente: CLIENTE_RESIDENCIAL, pacote: { ...AVULSO, totalCentavos: 1 }, primeiraData: PRIMEIRA, turno: 'manha' }, chave('preco'));
    assert.equal(r.pedido.pacote.totalCentavos, 17500);
    const [g] = await liberarCobranca(api(), r);
    assert.equal(g.valorCentavos, 17500);
  });

  t.teste('validação no servidor: região não atendida e domingo', async () => {
    const fora = { ...CLIENTE_RESIDENCIAL, endereco: { ...CLIENTE_RESIDENCIAL.endereco, cidade: 'São Paulo', uf: 'SP' } };
    await lancaCodigo(() => agendar(api(), { cliente: fora, pacote: AVULSO, primeiraData: PRIMEIRA, turno: 'manha' }, chave('reg')), 'REGIAO_NAO_ATENDIDA');
    await lancaCodigo(() => agendar(api(), { cliente: CLIENTE_RESIDENCIAL, pacote: AVULSO, primeiraData: '2026-10-04', turno: 'manha' }, chave('dom')), 'DATA_INVALIDA');
  });

  t.teste('preferência por profissional: opcional, guardada no pedido pra Prime; limite de tamanho', async () => {
    const r = await agendar(api(), { cliente: CLIENTE_RESIDENCIAL, pacote: AVULSO, primeiraData: PRIMEIRA, turno: 'manha', preferenciaProfissional: '  Maria   da semana passada ' }, chave('pref'));
    assert.equal(r.pedido.preferenciaProfissional, 'Maria da semana passada');
    assert.equal((await api().obterPedido(r.pedido.id, { sessao: PRIME })).pedido.preferenciaProfissional, 'Maria da semana passada');
    assert.equal(r.atendimentos[0].diaristaId, undefined, 'preferência não designa ninguém');
    await lancaCodigo(() => agendar(api(), { cliente: CLIENTE_RESIDENCIAL, pacote: AVULSO, primeiraData: PRIMEIRA, turno: 'manha', preferenciaProfissional: 'x'.repeat(121) }, chave('pref')), 'DADOS_INVALIDOS');
  });

  t.teste('id inexistente -> NAO_ENCONTRADO; pedido de outra cliente também', async () => {
    await lancaCodigo(() => api().obterPedido('nao-existe', { sessao: PRIME }), 'NAO_ENCONTRADO');
    await lancaCodigo(() => api().obterPagamento('nao-existe', { sessao: PRIME }), 'NAO_ENCONTRADO');
    await lancaCodigo(() => api().confirmarDisponibilidade('nao-existe', {}, { sessao: PRIME, chave: chave('x') }), 'NAO_ENCONTRADO');
    const r = await criarAvulso(api());
    await lancaCodigo(() => api().obterPedido(r.pedido.id, { sessao: { ator: 'cliente', id: 'outra' } }), 'NAO_ENCONTRADO');
    await lancaCodigo(() => api().obterPedido(r.pedido.id, { sessao: { ator: 'publico' } }), 'NAO_ENCONTRADO');
    const ok = await api().obterPedido(r.pedido.id, { sessao: cli(r) });
    assert.equal(ok.pedido.id, r.pedido.id);
  });

  t.teste('transição proibida, ator sem permissão e condição não atendida pela API', async () => {
    const r = await criarAvulso(api());
    const at = r.atendimentos[0].id;
    await lancaCodigo(() => api().transicionarAtendimento(at, { evento: 'finalizar' }, { sessao: PRIME, chave: chave('x') }), 'TRANSICAO_PROIBIDA');
    await lancaCodigo(() => api().transicionarAtendimento(at, { evento: 'confirmar' }, { sessao: cli(r), chave: chave('x') }), 'ATOR_SEM_PERMISSAO');
    await lancaCodigo(() => api().transicionarAtendimento(at, { evento: 'confirmar' }, { sessao: PRIME, chave: chave('x') }), 'CONDICAO_NAO_ATENDIDA');
    await lancaCodigo(() => api().transicionarAtendimento(at, { evento: 'voar' }, { sessao: PRIME, chave: chave('x') }), 'EVENTO_INVALIDO');
    await lancaCodigo(() => api().confirmarDisponibilidade(r.pedido.id, {}, { sessao: cli(r), chave: chave('x') }), 'ATOR_SEM_PERMISSAO');
    await lancaCodigo(() => api().recusarSolicitacao(r.pedido.id, { motivo: 'sem agenda' }, { sessao: cli(r), chave: chave('x') }), 'ATOR_SEM_PERMISSAO');
    const [g] = await liberarCobranca(api(), r);
    await lancaCodigo(() => api().confirmarPagamento(g.id, { sessao: cli(r), chave: chave('x') }), 'ATOR_SEM_PERMISSAO');
    await lancaCodigo(() => api().registrarEstorno(g.id, { motivo: 'teste' }, { sessao: cli(r), chave: chave('x') }), 'ATOR_SEM_PERMISSAO');
  });

  t.teste('fluxo completo: solicitado -> disponibilidade -> pago -> confirmado -> ... -> avaliado e concluído', async () => {
    const r = await criarAvulso(api());
    const diaristaId = await criarDiaristaAprovada(api());
    const [g] = await liberarCobranca(api(), r);
    const conf = await api().confirmarPagamento(g.id, { sessao: PRIME, chave: chave('c') });
    assert.equal(conf.pedido.status, 'confirmado');
    assert.equal(conf.atendimentos[0].status, 'confirmado');
    await levarAteFinalizado(api(), r, diaristaId);
    const at = r.atendimentos[0].id;
    await lancaCodigo(() => api().criarAvaliacao(at, { notas: { pontualidade: 5, qualidade: 4, cuidado: 5, comunicacao: 6 } }, { sessao: cli(r), chave: chave('av') }), 'DADOS_INVALIDOS');
    const av = await api().criarAvaliacao(at, { notas: { pontualidade: 5, qualidade: 4, cuidado: 5, comunicacao: 4 }, comentario: 'Ótimo' }, { sessao: cli(r), chave: chave('av') });
    assert.equal(av.avaliacao.notaFinal, 4.5);
    assert.equal(av.atendimento.status, 'avaliado');
    await lancaCodigo(() => api().criarAvaliacao(at, { notas: { pontualidade: 5, qualidade: 5, cuidado: 5, comunicacao: 5 } }, { sessao: cli(r), chave: chave('av2') }), 'JA_AVALIADO');
    const pg = await api().obterPagamento(g.id, { sessao: cli(r) });
    assert.equal(pg.elegibilidade.pagavel, false, 'já confirmado');
    const p = await api().obterPedido(r.pedido.id, { sessao: PRIME });
    assert.equal(p.pedido.status, 'concluido');
  });

  t.teste('informar pagamento duas vezes não duplica (mesma chave e chave nova)', async () => {
    const r = await criarAvulso(api());
    const [g] = await liberarCobranca(api(), r);
    const k = chave('inf');
    const a = await api().informarPagamento(g.id, { sessao: cli(r), chave: k });
    const b = await api().informarPagamento(g.id, { sessao: cli(r), chave: k });
    const c = await api().informarPagamento(g.id, { sessao: cli(r), chave: chave('inf') });
    assert.equal(a.status, 'informado_pelo_cliente');
    assert.equal(b.informadoEm, a.informadoEm); assert.equal(c.informadoEm, a.informadoEm);
    const evs = await api().listarEventos({}, { sessao: PRIME });
    assert.equal(evs.itens.filter((e) => e.tipo === 'pagamento_informado' && e.refs.pagamentoId === g.id).length, 1);
  });

  t.teste('recusa sem disponibilidade: motivo obrigatório; diárias e cobranças canceladas; não recusa pedido pago', async () => {
    const r = await criarAvulso(api());
    await lancaCodigo(() => api().recusarSolicitacao(r.pedido.id, { motivo: '' }, { sessao: PRIME, chave: chave('rec') }), 'DADOS_INVALIDOS');
    const x = await api().recusarSolicitacao(r.pedido.id, { motivo: 'Sem profissional livre nesse período' }, { sessao: PRIME, chave: chave('rec') });
    assert.equal(x.pedido.status, 'recusado');
    assert.equal(x.pedido.recusa.motivo, 'Sem profissional livre nesse período');
    assert.ok(x.atendimentos.every((a) => a.status === 'cancelado'));
    await lancaCodigo(() => api().confirmarDisponibilidade(r.pedido.id, {}, { sessao: PRIME, chave: chave('rec') }), 'TRANSICAO_PROIBIDA');
    // já com cobrança emitida: recusa cancela a cobrança aberta
    const r2 = await criarAvulso(api());
    const [g2] = await liberarCobranca(api(), r2);
    const x2 = await api().recusarSolicitacao(r2.pedido.id, { motivo: 'Profissional adoeceu, sem substituta' }, { sessao: PRIME, chave: chave('rec') });
    assert.equal(x2.pagamentos.find((g) => g.id === g2.id).status, 'cancelado');
    // pago: recusa não serve (vira cancelamento + estorno)
    const r3 = await criarAvulso(api());
    const [g3] = await liberarCobranca(api(), r3);
    await api().confirmarPagamento(g3.id, { sessao: PRIME, chave: chave('c') });
    await lancaCodigo(() => api().recusarSolicitacao(r3.pedido.id, { motivo: 'tarde demais' }, { sessao: PRIME, chave: chave('rec') }), 'TRANSICAO_PROIBIDA');
  });

  t.teste('imprevisto: estorno manual com motivo cancela a diária paga; só pagamento confirmado', async () => {
    const r = await criarAvulso(api());
    const [g] = await liberarCobranca(api(), r);
    await lancaCodigo(() => api().registrarEstorno(g.id, { motivo: 'sem substituta' }, { sessao: PRIME, chave: chave('est') }), 'PAGAMENTO_NAO_ELEGIVEL');
    await api().confirmarPagamento(g.id, { sessao: PRIME, chave: chave('c') });
    await lancaCodigo(() => api().registrarEstorno(g.id, { motivo: '' }, { sessao: PRIME, chave: chave('est') }), 'DADOS_INVALIDOS');
    const e = await api().registrarEstorno(g.id, { motivo: 'Profissional teve imprevisto e não houve substituição' }, { sessao: PRIME, chave: chave('est') });
    assert.equal(e.pagamento.status, 'estornado');
    assert.equal(e.pagamento.estorno.motivo, 'Profissional teve imprevisto e não houve substituição');
    assert.equal(e.atendimentos[0].status, 'cancelado');
    assert.equal(e.pedido.status, 'cancelado');
    const evs = await api().listarEventos({}, { sessao: PRIME });
    assert.equal(evs.itens.filter((x) => x.tipo === 'estorno_registrado' && x.refs.pagamentoId === g.id).length, 1);
  });

  t.teste('remarcação pela Prime move o vencimento da cobrança pendente pro dia útil anterior à nova data', async () => {
    const r = await criarAvulso(api());
    const [g] = await liberarCobranca(api(), r);
    await api().transicionarAtendimento(r.atendimentos[0].id, { evento: 'reagendar', dados: { data: '2026-10-08', turno: 'tarde' } }, { sessao: PRIME, chave: chave('rem') });
    const pg = await api().obterPagamento(g.id, { sessao: PRIME });
    assert.equal(pg.pagamento.venceEm, '2026-10-07'); assert.equal(pg.atendimento.data, '2026-10-08');
  });

  t.teste('cancelar uma diária do pacote recalcula as cobranças pendentes (o mês cai abaixo de 3: sem desconto)', async () => {
    const r = await agendar(api(), { cliente: CLIENTE_RESIDENCIAL, pacote: { ...AVULSO, quantidadeDiarias: 3, frequencia: 'semanal' }, primeiraData: PRIMEIRA, turno: 'manha' }, chave('rc'));
    const cobr = await liberarCobranca(api(), r);
    const ultima = cobr.find((g) => g.atendimentoId === r.atendimentos[2].id);
    assert.equal(ultima.descontoCentavos, 2000);
    await api().transicionarAtendimento(r.atendimentos[0].id, { evento: 'cancelar' }, { sessao: cli(r), chave: chave('rc') });
    const { pagamentos } = await api().obterPedido(r.pedido.id, { sessao: PRIME });
    assert.equal(pagamentos.find((g) => g.id === ultima.id).valorCentavos, 17500, 'desconto some com 2 diárias no mês');
    assert.equal(pagamentos.find((g) => g.atendimentoId === r.atendimentos[0].id).status, 'cancelado');
  });

  t.teste('GPT (24/09): estorno persiste como estornado (cancelar a diária não sobrescreve); total do pedido acompanha', async () => {
    const r = await criarAvulso(api());
    const [g] = await liberarCobranca(api(), r);
    await api().confirmarPagamento(g.id, { sessao: PRIME, chave: chave('c') });
    await api().registrarEstorno(g.id, { motivo: 'Imprevisto sem substituição' }, { sessao: PRIME, chave: chave('est') });
    const pg = await api().obterPagamento(g.id, { sessao: PRIME });
    assert.equal(pg.pagamento.status, 'estornado', 'lido do armazenamento, não da resposta');
    assert.equal(pg.pagamento.estorno.motivo, 'Imprevisto sem substituição');
    assert.equal(pg.atendimento.status, 'cancelado');
  });

  t.teste('GPT (24/09): desconto do mês já concedido numa cobrança confirmada não é dado de novo ao remarcar outra pra depois dela', async () => {
    const r = await agendar(api(), { cliente: CLIENTE_RESIDENCIAL, pacote: { ...AVULSO, quantidadeDiarias: 3, frequencia: 'semanal' }, primeiraData: PRIMEIRA, turno: 'manha' }, chave('dd'));
    const cobr = await liberarCobranca(api(), r); // 05, 12, 19/10: desconto de R$ 20 na de 19/10
    const ultima = cobr.find((g) => g.atendimentoId === r.atendimentos[2].id);
    assert.equal(ultima.descontoCentavos, 2000);
    await api().confirmarPagamento(ultima.id, { sessao: PRIME, chave: chave('c') });
    await api().transicionarAtendimento(r.atendimentos[1].id, { evento: 'reagendar', dados: { data: '2026-10-26', turno: 'manha' } }, { sessao: PRIME, chave: chave('rm') });
    const { pedido, pagamentos } = await api().obterPedido(r.pedido.id, { sessao: PRIME });
    const movida = pagamentos.find((g) => g.atendimentoId === r.atendimentos[1].id);
    assert.equal(movida.descontoCentavos, 0, 'o desconto do mês já foi concedido na confirmada');
    assert.equal(movida.valorCentavos, 17500);
    assert.equal(movida.venceEm, '2026-10-23');
    assert.equal(pedido.pacote.totalCentavos, 3 * 17500 - 2000, 'total do mês continua com um desconto só');
  });

  t.teste('GPT (24/09): remarcar pra sábado cobra a taxa da data nova (e tira a taxa ao sair do sábado)', async () => {
    const r = await criarAvulso(api());
    const [g] = await liberarCobranca(api(), r);
    await api().transicionarAtendimento(r.atendimentos[0].id, { evento: 'reagendar', dados: { data: '2026-10-10', turno: 'manha' } }, { sessao: PRIME, chave: chave('sab') });
    let { atendimento, pagamento, pedido } = await api().obterPagamento(g.id, { sessao: PRIME });
    assert.deepEqual([atendimento.taxaDiaCentavos, atendimento.valorDiaCentavos, pagamento.valorCentavos, pagamento.venceEm, pedido.pacote.totalCentavos], [2000, 19500, 19500, '2026-10-09', 19500]);
    await api().transicionarAtendimento(r.atendimentos[0].id, { evento: 'reagendar', dados: { data: '2026-10-13', turno: 'manha' } }, { sessao: PRIME, chave: chave('ter') });
    ({ atendimento, pagamento, pedido } = await api().obterPagamento(g.id, { sessao: PRIME }));
    assert.deepEqual([atendimento.taxaDiaCentavos, pagamento.valorCentavos, pedido.pacote.totalCentavos], [0, 17500, 17500]);
  });

  t.teste('GPT (24/09): remarcar diária já designada não pode cair em cima de outra diária da mesma profissional', async () => {
    const d = await criarDiaristaAprovada(api());
    const r1 = await criarAvulso(api());
    const r2 = await agendar(api(), { cliente: CLIENTE_RESIDENCIAL, pacote: AVULSO, primeiraData: '2026-10-06', turno: 'manha' }, chave('r2'));
    await api().atribuirDiarista(r1.atendimentos[0].id, { diaristaId: d }, { sessao: PRIME, chave: chave('a1') });
    await api().atribuirDiarista(r2.atendimentos[0].id, { diaristaId: d }, { sessao: PRIME, chave: chave('a2') });
    await lancaCodigo(() => api().transicionarAtendimento(r2.atendimentos[0].id, { evento: 'reagendar', dados: { data: PRIMEIRA, turno: 'manha' } }, { sessao: PRIME, chave: chave('rm') }), 'CONDICAO_NAO_ATENDIDA');
    const ok = await api().transicionarAtendimento(r2.atendimentos[0].id, { evento: 'reagendar', dados: { data: PRIMEIRA, turno: 'tarde' } }, { sessao: PRIME, chave: chave('rm2') });
    assert.equal(ok.atendimento.turno, 'tarde');
  });

  t.teste('cancelar pedido com um atendimento já finalizado: cancela só os futuros e as cobranças abertas deles', async () => {
    const r = await criarEmpresa(api(), chave('canc'));
    const diaristaId = await criarDiaristaAprovada(api());
    await levarAteFinalizado(api(), r, diaristaId, r.atendimentos[0].id);
    const c = await api().cancelarPedido(r.pedido.id, { motivo: 'teste' }, { sessao: cli(r), chave: chave('cp') });
    assert.deepEqual(c.atendimentos.map((a) => a.status), ['finalizado', 'cancelado', 'cancelado', 'cancelado']);
    const cobr = c.pagamentos.filter((p) => p.parcela === 'diaria');
    assert.equal(cobr.find((p) => p.atendimentoId === r.atendimentos[0].id).status, 'confirmado', 'o que foi pago continua pago');
    assert.ok(cobr.filter((p) => p.atendimentoId !== r.atendimentos[0].id).every((p) => p.status === 'cancelado'));
    assert.equal(c.pedido.status, 'concluido');
    await lancaCodigo(() => api().cancelarPedido(r.pedido.id, {}, { sessao: cli(r), chave: chave('cp') }), 'TRANSICAO_PROIBIDA');
  });

  t.teste('GPT#6: diarista não recebe duas diárias no mesmo dia e período (integral conflita com tudo)', async () => {
    const d = await criarDiaristaAprovada(api());
    const r1 = await criarAvulso(api());
    const r2 = await criarAvulso(api());
    await api().atribuirDiarista(r1.atendimentos[0].id, { diaristaId: d }, { sessao: PRIME, chave: chave('s') });
    await lancaCodigo(() => api().atribuirDiarista(r2.atendimentos[0].id, { diaristaId: d }, { sessao: PRIME, chave: chave('s') }), 'CONDICAO_NAO_ATENDIDA');
    const r3 = await agendar(api(), { cliente: CLIENTE_RESIDENCIAL, pacote: AVULSO, primeiraData: PRIMEIRA, turno: 'tarde' }, chave('t'));
    await api().atribuirDiarista(r3.atendimentos[0].id, { diaristaId: d }, { sessao: PRIME, chave: chave('s') }); // tarde não conflita com manhã
  });

  t.teste('cadastro de diarista: documento inválido, faltando obrigatório e envio duplo', async () => {
    const id = crypto.randomUUID();
    const pub = { ator: 'publico' };
    await lancaCodigo(() => api().salvarDocumento({ diaristaId: id, tipo: 'foto_perfil', nomeArquivo: 'x.png', mime: 'image/png', tamanho: ARQUIVOS.pdf.bytes.length, conteudo: ARQUIVOS.pdf.bytes }, { sessao: pub, chave: chave('d') }), 'DADOS_INVALIDOS');
    await api().salvarDocumento({ diaristaId: id, tipo: 'foto_perfil', nomeArquivo: 'foto.png', mime: 'image/png', tamanho: ARQUIVOS.png.bytes.length, conteudo: ARQUIVOS.png.bytes }, { sessao: pub, chave: chave('d') });
    const e = await lancaCodigo(() => api().cadastrarDiarista({ id, ...DIARISTA_FICTICIA, identidade: 'rg', aceiteTermos: true }, { sessao: pub, chave: chave('c') }), 'DADOS_INVALIDOS');
    assert.ok(e.detalhes.documentos.includes('rg_frente') && e.detalhes.documentos.includes('cpf'));
    for (const tipo of ['rg_frente', 'rg_verso', 'cpf', 'comprovante_residencia', 'antecedentes']) {
      await api().salvarDocumento({ diaristaId: id, tipo, nomeArquivo: `${tipo}.pdf`, mime: 'application/pdf', tamanho: ARQUIVOS.pdf.bytes.length, conteudo: ARQUIVOS.pdf.bytes }, { sessao: pub, chave: chave('d') });
    }
    const k = chave('c');
    const a = await api().cadastrarDiarista({ id, ...DIARISTA_FICTICIA, identidade: 'rg', aceiteTermos: true }, { sessao: pub, chave: k });
    const b = await api().cadastrarDiarista({ id, ...DIARISTA_FICTICIA, identidade: 'rg', aceiteTermos: true }, { sessao: pub, chave: k });
    assert.equal(a.id, b.id); assert.equal(a.criadoEm, b.criadoEm);
    const docs = await api().listarDocumentos(id, { sessao: { ator: 'diarista', id } });
    assert.equal(docs.itens.length, 6);
    const arq = await api().obterArquivo(docs.itens.find((d) => d.tipo === 'foto_perfil').id, { sessao: { ator: 'diarista', id } });
    assert.ok(arq.conteudo);
    await lancaCodigo(() => api().obterDiarista(id, { sessao: { ator: 'diarista', id: 'outra' } }), 'NAO_ENCONTRADO');
  });
}
