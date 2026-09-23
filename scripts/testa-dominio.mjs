// Testes do domínio puro: dinheiro, estados, calendário, configuração. node scripts/testa-dominio.mjs
import { criarSuite, assert, lancaCodigo } from './lib-teste.mjs';
import { dividirEntrada, parcelarRestante, formatarBRL } from '../src/domain/dinheiro.js';
import { transicionar, derivarStatusPedido, elegibilidadePagamento } from '../src/domain/estados.js';
import { gerarOcorrencias, validarOcorrencias, instanteLocal, dataNoFuso } from '../src/domain/calendario.js';
import { validarConfiguracao, linkWhatsApp } from '../src/domain/configuracao.js';
import { PRIME as TESTE } from '../src/config/prime.teste.js';
import { PRIME as REAL } from '../src/config/prime.js';

const t = criarSuite('domínio');
const AGORA = '2026-10-01T12:00:00.000Z';
const at = (over = {}) => ({ id: 'a1', pedidoId: 'p1', sequencia: 1, data: '2026-10-05', turno: 'manha', status: 'agendado', historico: [], valorDiaCentavos: 100, versao: 0, ...over });

// ---- dinheiro
t.teste('centavo ímpar: 10001 -> entrada 5000, restante 5001', () => {
  assert.deepEqual(dividirEntrada(10001), { entradaCentavos: 5000, restanteCentavos: 5001 });
});
t.teste('par: 10000 -> 5000/5000; zero -> 0/0', () => {
  assert.deepEqual(dividirEntrada(10000), { entradaCentavos: 5000, restanteCentavos: 5000 });
  assert.deepEqual(dividirEntrada(0), { entradaCentavos: 0, restanteCentavos: 0 });
});
t.teste('dinheiro rejeita não inteiro', () => { assert.throws(() => dividirEntrada(100.5)); assert.throws(() => dividirEntrada(-1)); });
t.teste('restante por_atendimento: 5001 em 4 = 1250,1250,1250,1251', () => {
  const p = parcelarRestante(5001, 4);
  assert.deepEqual(p, [1250, 1250, 1250, 1251]);
  assert.equal(p.reduce((a, b) => a + b), 5001);
});
t.teste('restante no_primeiro', () => assert.deepEqual(parcelarRestante(5001, 3, 'no_primeiro'), [5001, 0, 0]));
t.teste('formatarBRL', () => { assert.equal(formatarBRL(10001), 'R$ 100,01'); assert.equal(formatarBRL(123456789), 'R$ 1.234.567,89'); assert.equal(formatarBRL(5), 'R$ 0,05'); });

// ---- estados
t.teste('fluxo feliz com histórico', () => {
  const dia = { id: 'd1', status: 'aprovada' };
  let a = at({ diaristaId: 'd1' });
  a = transicionar(a, 'confirmar', { ator: 'sistema', agora: AGORA, entradaConfirmada: true });
  a = transicionar(a, 'sair_a_caminho', { ator: 'diarista', atorId: 'd1', agora: AGORA, diarista: dia });
  a = transicionar(a, 'iniciar', { ator: 'diarista', atorId: 'd1', agora: AGORA });
  a = transicionar(a, 'finalizar', { ator: 'prime', agora: AGORA });
  a = transicionar(a, 'avaliar', { ator: 'cliente', atorId: 'c1', clienteIdDoPedido: 'c1', agora: AGORA });
  assert.equal(a.status, 'avaliado');
  assert.equal(a.historico.length, 5);
  assert.deepEqual(a.historico[0], { de: 'agendado', para: 'confirmado', evento: 'confirmar', em: AGORA, ator: 'sistema' });
  assert.equal(a.versao, 5);
});
t.teste('transicionar é pura (não muda o original)', () => {
  const a = at();
  transicionar(a, 'confirmar', { ator: 'prime', agora: AGORA, entradaConfirmada: true });
  assert.equal(a.status, 'agendado'); assert.equal(a.historico.length, 0);
});
t.teste('transição proibida: finalizar a partir de agendado', async () => {
  await lancaCodigo(() => transicionar(at(), 'finalizar', { ator: 'prime', agora: AGORA }), 'TRANSICAO_PROIBIDA');
});
t.teste('transição proibida: cancelar em_andamento', async () => {
  await lancaCodigo(() => transicionar(at({ status: 'em_andamento' }), 'cancelar', { ator: 'prime', agora: AGORA }), 'TRANSICAO_PROIBIDA');
});
t.teste('evento desconhecido', async () => {
  await lancaCodigo(() => transicionar(at(), 'teleportar', { ator: 'prime', agora: AGORA }), 'EVENTO_INVALIDO');
});
t.teste('ator sem permissão: cliente não confirma', async () => {
  await lancaCodigo(() => transicionar(at(), 'confirmar', { ator: 'cliente', atorId: 'c1', clienteIdDoPedido: 'c1', agora: AGORA, entradaConfirmada: true }), 'ATOR_SEM_PERMISSAO');
});
t.teste('ator sem permissão: diarista não atribuída', async () => {
  const a = at({ status: 'diarista_a_caminho', diaristaId: 'd1' });
  await lancaCodigo(() => transicionar(a, 'iniciar', { ator: 'diarista', atorId: 'd2', agora: AGORA }), 'ATOR_SEM_PERMISSAO');
});
t.teste('ator sem permissão: cliente de outro pedido', async () => {
  await lancaCodigo(() => transicionar(at(), 'cancelar', { ator: 'cliente', atorId: 'c2', clienteIdDoPedido: 'c1', agora: AGORA }), 'ATOR_SEM_PERMISSAO');
});
t.teste('condição não atendida: confirmar sem entrada', async () => {
  await lancaCodigo(() => transicionar(at(), 'confirmar', { ator: 'prime', agora: AGORA, entradaConfirmada: false }), 'CONDICAO_NAO_ATENDIDA');
});
t.teste('condição não atendida: a caminho com diarista pendente', async () => {
  const a = at({ status: 'confirmado', diaristaId: 'd1' });
  await lancaCodigo(() => transicionar(a, 'sair_a_caminho', { ator: 'prime', agora: AGORA, diarista: { id: 'd1', status: 'pendente' } }), 'CONDICAO_NAO_ATENDIDA');
});
t.teste('condição não atendida: a caminho sem diarista atribuída', async () => {
  await lancaCodigo(() => transicionar(at({ status: 'confirmado' }), 'sair_a_caminho', { ator: 'prime', agora: AGORA }), 'CONDICAO_NAO_ATENDIDA');
});
t.teste('reagendar troca data e mantém estado', () => {
  const a = transicionar(at({ status: 'confirmado' }), 'reagendar', { ator: 'prime', agora: AGORA, dados: { data: '2026-10-07', turno: 'tarde' } });
  assert.equal(a.status, 'confirmado'); assert.equal(a.data, '2026-10-07'); assert.equal(a.turno, 'tarde');
});
t.teste('status do pedido derivado', () => {
  assert.equal(derivarStatusPedido('aguardando_entrada', [at()], true), 'ativo');
  assert.equal(derivarStatusPedido('ativo', [at({ status: 'avaliado' }), at({ status: 'cancelado' })], true), 'concluido');
  assert.equal(derivarStatusPedido('ativo', [at({ status: 'avaliado' }), at({ status: 'confirmado' })], true), 'ativo');
  assert.equal(derivarStatusPedido('ativo', [at({ status: 'cancelado' })], true), 'cancelado');
  assert.equal(derivarStatusPedido('cancelado', [at()], true), 'cancelado', 'terminal não volta');
});
t.teste('elegibilidade: parcela de avaliado é pagável; de confirmado não; cancelada não', () => {
  const pg = { id: 'g', pedidoId: 'p1', atendimentoId: 'a1', parcela: 'dia', status: 'pendente' };
  assert.equal(elegibilidadePagamento(pg, { atendimento: at({ status: 'avaliado' }) }).pagavel, true);
  assert.equal(elegibilidadePagamento(pg, { atendimento: at({ status: 'confirmado' }) }).pagavel, false);
  assert.equal(elegibilidadePagamento(pg, { atendimento: at({ status: 'cancelado' }) }).pagavel, false);
  assert.equal(elegibilidadePagamento({ ...pg, status: 'confirmado' }, { atendimento: at({ status: 'avaliado' }) }).pagavel, false);
  const ent = { id: 'e', pedidoId: 'p1', parcela: 'entrada', status: 'informado_pelo_cliente' };
  assert.equal(elegibilidadePagamento(ent, { pedido: { id: 'p1', status: 'aguardando_entrada' } }).pagavel, true);
  assert.equal(elegibilidadePagamento(ent, { pedido: { id: 'p1', status: 'cancelado' } }).pagavel, false);
});

// ---- calendário
const R = { diasBloqueados: [0], datasBloqueadas: [], buscaDeslocamentoMaxDias: 7 };
t.teste('mensal a partir do dia 31: clamp no último dia do mês', () => {
  const o = gerarOcorrencias({ frequencia: 'mensal', quantidade: 4, primeiraData: '2026-12-31' }, { ...R, diasBloqueados: [] });
  assert.deepEqual(o.map((x) => x.data), ['2026-12-31', '2027-01-31', '2027-02-28', '2027-03-31']);
});
t.teste('mensal dia 31 em ano bissexto (fev 29)', () => {
  const o = gerarOcorrencias({ frequencia: 'mensal', quantidade: 3, primeiraData: '2027-12-31' }, { ...R, diasBloqueados: [] });
  assert.deepEqual(o.map((x) => x.data), ['2027-12-31', '2028-01-31', '2028-02-29']);
});
t.teste('quinzenal: a cada 14 dias', () => {
  const o = gerarOcorrencias({ frequencia: 'quinzenal', quantidade: 3, primeiraData: '2026-10-05' }, R);
  assert.deepEqual(o.map((x) => x.data), ['2026-10-05', '2026-10-19', '2026-11-02']);
  assert.ok(o.every((x) => !x.deslocada));
});
t.teste('semanal a partir de segunda: 4 datas', () => {
  const o = gerarOcorrencias({ frequencia: 'semanal', quantidade: 4, primeiraData: '2026-10-05' }, R);
  assert.deepEqual(o.map((x) => x.data), ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
});
t.teste('deslocamento de domingo: mensal que cai em domingo vai pra segunda e marca deslocada', () => {
  // 2026-10-04 é domingo -> primeira data válida escolhida: 2026-09-04 (sexta); mensal em 04/10 cai domingo
  const o = gerarOcorrencias({ frequencia: 'mensal', quantidade: 2, primeiraData: '2026-09-04' }, R);
  assert.equal(o[1].original, '2026-10-04');
  assert.equal(o[1].data, '2026-10-05');
  assert.equal(o[1].deslocada, true);
});
t.teste('validação: primeira data em domingo, passado e região', () => {
  const o = gerarOcorrencias({ frequencia: 'avulso', quantidade: 1, primeiraData: '2026-10-04' }, R);
  const p = validarOcorrencias(o, { hoje: '2026-10-01', ...R, antecedenciaMinimaDias: 1 });
  assert.ok(p.some((x) => /domingo/.test(x.motivo)));
  const passado = validarOcorrencias([{ sequencia: 1, data: '2026-09-01' }], { hoje: '2026-10-01', ...R });
  assert.ok(passado.some((x) => x.motivo === 'data no passado'));
  const reg = validarOcorrencias([{ sequencia: 1, data: '2026-10-05' }], { hoje: '2026-10-01', regiaoAtendida: false, ...R });
  assert.ok(reg.some((x) => x.motivo === 'região não atendida'));
});
t.teste('avulso com 2 diárias é inválido', async () => {
  await lancaCodigo(() => gerarOcorrencias({ frequencia: 'avulso', quantidade: 2, primeiraData: '2026-10-05' }, R), 'DADOS_INVALIDOS');
});
t.teste('sem dia disponível na busca', async () => {
  await lancaCodigo(() => gerarOcorrencias({ frequencia: 'semanal', quantidade: 2, primeiraData: '2026-10-05' }, { diasBloqueados: [0, 1, 2, 3, 4, 5, 6], buscaDeslocamentoMaxDias: 7 }), 'DATA_INVALIDA');
});
t.teste('fuso: 18h de 05/10 em São Paulo = 21h UTC; data no fuso', () => {
  assert.equal(instanteLocal('2026-10-05', 18, 0, 'America/Sao_Paulo'), '2026-10-05T21:00:00.000Z');
  assert.equal(dataNoFuso('2026-10-06T02:30:00.000Z'), '2026-10-05');
});

// ---- configuração
t.teste('config completa (teste) libera tudo', () => {
  const c = validarConfiguracao(TESTE);
  assert.ok(c.pix.ok && c.whatsapp.ok && c.email.ok);
});
t.teste('config real com PREENCHER bloqueia Pix e WhatsApp', () => {
  const c = validarConfiguracao(REAL);
  assert.equal(c.pix.ok, false); assert.deepEqual(c.pix.faltando, ['pix.chave', 'pix.nomeRecebedor', 'pix.cidadeRecebedor']);
  assert.equal(c.whatsapp.ok, false);
  assert.equal(linkWhatsApp(REAL, 'oi'), null);
});
t.teste('config incompleta por funcionalidade: sem e-mail não bloqueia Pix; sem cidade bloqueia só Pix', () => {
  const semEmail = validarConfiguracao({ ...TESTE, email: '' });
  assert.equal(semEmail.pix.ok, true); assert.equal(semEmail.email.ok, false);
  const semCidade = validarConfiguracao({ ...TESTE, pix: { ...TESTE.pix, cidadeRecebedor: 'PREENCHER' } });
  assert.equal(semCidade.pix.ok, false); assert.deepEqual(semCidade.pix.faltando, ['pix.cidadeRecebedor']);
  assert.equal(semCidade.whatsapp.ok, true);
  const semWa = validarConfiguracao({ ...TESTE, whatsapp: '31 9999' });
  assert.equal(semWa.whatsapp.ok, false); assert.equal(semWa.pix.ok, true);
});

await t.fim();
