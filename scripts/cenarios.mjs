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
export const chave = (p = 'k') => `${p}-${Date.now().toString(36)}-${(++n).toString(36)}-teste`;

const AVULSO = { tipoServico: 'residencial', duracaoHoras: 4, metragem: 45, quantidadeDiarias: 1, frequencia: 'avulso' };
const SEMANAL4 = { tipoServico: 'empresarial', duracaoHoras: 6, metragem: 100, quantidadeDiarias: 4, frequencia: 'semanal', semLocalAlmoco: true };

export async function criarAvulso(api, k = chave('auto')) {
  return api.confirmarAutoagendamento({ cliente: CLIENTE_RESIDENCIAL, pacote: AVULSO, primeiraData: PRIMEIRA, turno: 'manha' }, { sessao: { ator: 'publico' }, chave: k });
}

export async function criarDiaristaAprovada(api) {
  const id = crypto.randomUUID();
  for (const tipo of ['cnh_frente', 'cnh_verso', 'comprovante_residencia', 'foto_perfil', 'antecedentes']) {
    const arq = tipo === 'antecedentes' || tipo === 'comprovante_residencia' ? ARQUIVOS.pdf : ARQUIVOS.png;
    await api.salvarDocumento({ diaristaId: id, tipo, nomeArquivo: `${tipo}.${arq.ext}`, mime: arq.mime, tamanho: arq.bytes.length, conteudo: arq.bytes }, { sessao: { ator: 'publico' }, chave: chave('doc') });
  }
  const d = await api.cadastrarDiarista({ id, ...DIARISTA_FICTICIA, identidade: 'cnh', aceiteTermos: true }, { sessao: { ator: 'publico' }, chave: chave('cad') });
  assert.equal(d.status, 'pendente');
  await api.aprovarDiarista(id, {}, { sessao: PRIME, chave: chave('apr') });
  return id;
}

/** Leva um atendimento de agendado até finalizado. */
export async function levarAteFinalizado(api, r, diaristaId, atendimentoId) {
  const at = atendimentoId || r.atendimentos[0].id;
  await api.atribuirDiarista(at, { diaristaId }, { sessao: PRIME, chave: chave('atr') });
  const entrada = r.pagamentos.find((p) => p.parcela === 'entrada');
  const pg = await api.obterPagamento(entrada.id, { sessao: PRIME });
  if (pg.pagamento.status !== 'confirmado') await api.confirmarPagamento(entrada.id, { sessao: PRIME, chave: chave('conf') });
  const sd = { ator: 'diarista', id: diaristaId };
  await api.transicionarAtendimento(at, { evento: 'sair_a_caminho' }, { sessao: sd, chave: chave('t') });
  await api.transicionarAtendimento(at, { evento: 'iniciar' }, { sessao: sd, chave: chave('t') });
  return api.transicionarAtendimento(at, { evento: 'finalizar' }, { sessao: sd, chave: chave('t') });
}

export function registrarCenarios(t, ctx) {
  const api = () => ctx.api;
  const cli = (r) => ({ ator: 'cliente', id: r.cliente.id });

  t.teste('autoagendamento residencial avulso: pedido, 1 atendimento, entrada e parcela corretos', async () => {
    const r = await criarAvulso(api());
    assert.equal(r.pedido.status, 'aguardando_entrada');
    assert.equal(r.atendimentos.length, 1);
    assert.equal(r.atendimentos[0].data, PRIMEIRA);
    const { totalCentavos, entradaCentavos, restanteCentavos } = r.pedido.pacote;
    assert.equal(entradaCentavos, Math.floor(totalCentavos / 2));
    assert.equal(entradaCentavos + restanteCentavos, totalCentavos);
    const entrada = r.pagamentos.find((p) => p.parcela === 'entrada');
    const dia = r.pagamentos.filter((p) => p.parcela === 'dia');
    assert.equal(entrada.valorCentavos, entradaCentavos);
    assert.equal(dia.length, 1); assert.equal(dia[0].valorCentavos, restanteCentavos); assert.equal(dia[0].venceEm, PRIMEIRA);
    assert.ok(/^[A-Za-z0-9]{25}$/.test(entrada.pixTxid) && entrada.pixTxid !== entrada.id);
    assert.equal(lerTLV(entrada.brcode)['54'], `${Math.floor(entradaCentavos / 100)}.${String(entradaCentavos % 100).padStart(2, '0')}`);
    assert.equal(r.pagamentoEntradaId, entrada.id);
  });

  t.teste('idempotência: mesma chave repetida devolve o mesmo pedido (sem duplicar)', async () => {
    const k = chave('idem');
    const a = await criarAvulso(api(), k);
    const b = await criarAvulso(api(), k);
    assert.equal(a.pedido.id, b.pedido.id);
    assert.equal(a.pagamentoEntradaId, b.pagamentoEntradaId);
    const lista = await api().listarPedidos({ clienteId: a.cliente.id }, { sessao: PRIME });
    assert.equal(lista.itens.filter((p) => p.id === a.pedido.id).length, 1);
    assert.equal(lista.itens.length, 1, 'cliente novo só tem 1 pedido');
  });

  t.teste('idempotência: mesma chave com conteúdo diferente -> CONFLITO_IDEMPOTENCIA', async () => {
    const k = chave('idem2');
    await criarAvulso(api(), k);
    await lancaCodigo(() => api().confirmarAutoagendamento({ cliente: CLIENTE_RESIDENCIAL, pacote: { ...AVULSO, duracaoHoras: 6 }, primeiraData: PRIMEIRA, turno: 'manha' }, { sessao: { ator: 'publico' }, chave: k }), 'CONFLITO_IDEMPOTENCIA');
  });

  t.teste('empresa 4 diárias semanais: datas, parcelas somam o restante (centavo na última)', async () => {
    const r = await api().confirmarAutoagendamento({ cliente: CLIENTE_EMPRESA, pacote: SEMANAL4, primeiraData: PRIMEIRA, turno: 'tarde' }, { sessao: { ator: 'publico' }, chave: chave('emp') });
    assert.deepEqual(r.atendimentos.map((a) => a.data), ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
    const dias = r.pagamentos.filter((p) => p.parcela === 'dia');
    assert.equal(dias.length, 4);
    assert.equal(dias.reduce((s, p) => s + p.valorCentavos, 0), r.pedido.pacote.restanteCentavos);
    assert.ok(dias[3].valorCentavos >= dias[0].valorCentavos);
    assert.equal(r.cliente.cnpj, '12ABC34501DE35');
  });

  t.teste('backend recalcula preço: total enviado pelo navegador é ignorado', async () => {
    const r = await api().confirmarAutoagendamento({ cliente: CLIENTE_RESIDENCIAL, pacote: { ...AVULSO, totalCentavos: 1, entradaCentavos: 1 }, primeiraData: PRIMEIRA, turno: 'manha' }, { sessao: { ator: 'publico' }, chave: chave('preco') });
    assert.equal(r.pedido.pacote.totalCentavos, 17500);
  });

  t.teste('validação no servidor: região não atendida e domingo', async () => {
    const fora = { ...CLIENTE_RESIDENCIAL, endereco: { ...CLIENTE_RESIDENCIAL.endereco, cidade: 'São Paulo', uf: 'SP' } };
    await lancaCodigo(() => api().confirmarAutoagendamento({ cliente: fora, pacote: AVULSO, primeiraData: PRIMEIRA, turno: 'manha' }, { sessao: { ator: 'publico' }, chave: chave('reg') }), 'REGIAO_NAO_ATENDIDA');
    await lancaCodigo(() => api().confirmarAutoagendamento({ cliente: CLIENTE_RESIDENCIAL, pacote: AVULSO, primeiraData: '2026-10-04', turno: 'manha' }, { sessao: { ator: 'publico' }, chave: chave('dom') }), 'DATA_INVALIDA');
  });

  t.teste('id inexistente -> NAO_ENCONTRADO; pedido de outra cliente também', async () => {
    await lancaCodigo(() => api().obterPedido('nao-existe', { sessao: PRIME }), 'NAO_ENCONTRADO');
    await lancaCodigo(() => api().obterPagamento('nao-existe', { sessao: PRIME }), 'NAO_ENCONTRADO');
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
    await lancaCodigo(() => api().confirmarPagamento(r.pagamentoEntradaId, { sessao: cli(r), chave: chave('x') }), 'ATOR_SEM_PERMISSAO');
  });

  t.teste('fluxo completo até avaliado; parcela do dia de atendimento avaliado continua pagável', async () => {
    const r = await criarAvulso(api());
    const diaristaId = await criarDiaristaAprovada(api());
    const conf = await api().confirmarPagamento(r.pagamentoEntradaId, { sessao: PRIME, chave: chave('c') });
    assert.equal(conf.pedido.status, 'ativo');
    assert.equal(conf.atendimentos[0].status, 'confirmado');
    await levarAteFinalizado(api(), r, diaristaId);
    const at = r.atendimentos[0].id;
    await lancaCodigo(() => api().criarAvaliacao(at, { notas: { pontualidade: 5, qualidade: 4, cuidado: 5, comunicacao: 6 } }, { sessao: cli(r), chave: chave('av') }), 'DADOS_INVALIDOS');
    const av = await api().criarAvaliacao(at, { notas: { pontualidade: 5, qualidade: 4, cuidado: 5, comunicacao: 4 }, comentario: 'Ótimo' }, { sessao: cli(r), chave: chave('av') });
    assert.equal(av.avaliacao.notaFinal, 4.5);
    assert.equal(av.atendimento.status, 'avaliado');
    await lancaCodigo(() => api().criarAvaliacao(at, { notas: { pontualidade: 5, qualidade: 5, cuidado: 5, comunicacao: 5 } }, { sessao: cli(r), chave: chave('av2') }), 'JA_AVALIADO');
    const dia = r.pagamentos.find((p) => p.parcela === 'dia');
    const pg = await api().obterPagamento(dia.id, { sessao: cli(r) });
    assert.equal(pg.elegibilidade.pagavel, true, 'parcela de avaliado é pagável');
    const p = await api().obterPedido(r.pedido.id, { sessao: PRIME });
    assert.equal(p.pedido.status, 'concluido');
  });

  t.teste('informar pagamento duas vezes não duplica (mesma chave e chave nova)', async () => {
    const r = await criarAvulso(api());
    const k = chave('inf');
    const a = await api().informarPagamento(r.pagamentoEntradaId, { sessao: cli(r), chave: k });
    const b = await api().informarPagamento(r.pagamentoEntradaId, { sessao: cli(r), chave: k });
    const c = await api().informarPagamento(r.pagamentoEntradaId, { sessao: cli(r), chave: chave('inf') });
    assert.equal(a.status, 'informado_pelo_cliente');
    assert.equal(b.informadoEm, a.informadoEm); assert.equal(c.informadoEm, a.informadoEm);
    const evs = await api().listarEventos({}, { sessao: PRIME });
    assert.equal(evs.itens.filter((e) => e.tipo === 'pagamento_informado' && e.refs.pagamentoId === r.pagamentoEntradaId).length, 1);
    // parcela do dia de atendimento não iniciado não é pagável
    const dia = r.pagamentos.find((p) => p.parcela === 'dia');
    await lancaCodigo(() => api().informarPagamento(dia.id, { sessao: cli(r), chave: chave('inf') }), 'PAGAMENTO_NAO_ELEGIVEL');
  });

  t.teste('cancelar pedido com um atendimento já finalizado: cancela só os futuros e as parcelas deles', async () => {
    const r = await api().confirmarAutoagendamento({ cliente: CLIENTE_EMPRESA, pacote: SEMANAL4, primeiraData: PRIMEIRA, turno: 'tarde' }, { sessao: { ator: 'publico' }, chave: chave('canc') });
    const diaristaId = await criarDiaristaAprovada(api());
    await levarAteFinalizado(api(), r, diaristaId, r.atendimentos[0].id);
    const c = await api().cancelarPedido(r.pedido.id, { motivo: 'teste' }, { sessao: cli(r), chave: chave('cp') });
    assert.deepEqual(c.atendimentos.map((a) => a.status), ['finalizado', 'cancelado', 'cancelado', 'cancelado']);
    const parcelas = c.pagamentos.filter((p) => p.parcela === 'dia');
    assert.equal(parcelas.find((p) => p.atendimentoId === r.atendimentos[0].id).status, 'pendente');
    assert.ok(parcelas.filter((p) => p.atendimentoId !== r.atendimentos[0].id).every((p) => p.status === 'cancelado'));
    assert.equal(c.pedido.status, 'concluido');
    const pg = await api().obterPagamento(parcelas.find((p) => p.atendimentoId === r.atendimentos[0].id).id, { sessao: cli(r) });
    assert.equal(pg.elegibilidade.pagavel, true);
    await lancaCodigo(() => api().cancelarPedido(r.pedido.id, {}, { sessao: cli(r), chave: chave('cp') }), 'TRANSICAO_PROIBIDA');
  });

  t.teste('GPT#6: diarista não recebe duas diárias no mesmo dia e período (integral conflita com tudo)', async () => {
    const d = await criarDiaristaAprovada(api());
    const r1 = await criarAvulso(api());
    const r2 = await criarAvulso(api());
    await api().atribuirDiarista(r1.atendimentos[0].id, { diaristaId: d }, { sessao: PRIME, chave: chave('s') });
    await lancaCodigo(() => api().atribuirDiarista(r2.atendimentos[0].id, { diaristaId: d }, { sessao: PRIME, chave: chave('s') }), 'CONDICAO_NAO_ATENDIDA');
    const r3 = await api().confirmarAutoagendamento({ cliente: CLIENTE_RESIDENCIAL, pacote: AVULSO, primeiraData: PRIMEIRA, turno: 'tarde' }, { sessao: { ator: 'publico' }, chave: chave('t') });
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
