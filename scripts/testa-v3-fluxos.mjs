// Agendamento v3 de ponta a ponta nos casos de uso (mock, relógio simulado, motor de mensagens junto): cadastro pelo ticket,
// cotação, envio, confirmação com as parcelas da modalidade, rotina da 2ª parcela do pacote (C17), pagamento das metades,
// remarcação recalculando o marco, cupom consumido só na confirmação, condição especial não cumulativa e faturamento
// empresarial (sem C02). Mesmas regras das migrations 20261017* (o homolog confere em testa-agendamento-v3-homolog).
import { criarSuite, assert, lancaCodigo } from './lib-teste.mjs';
import { montarAmbiente } from './ambiente.mjs';
import { VERSAO_CONDICOES, VERSAO_LEGAL } from '../src/config/legal.js';
import { CONFIG_PRECOS } from '../src/config/precos.js';
import { calcularParcelas } from '../src/domain/agendamento-v3.js';

const t = criarSuite('agendamento v3: fluxos nos casos de uso (mock)');
const AGORA = '2026-10-01T12:00:00.000Z'; // quinta, 09:00 em SP
const PRIME = { sessao: { ator: 'prime' } };
const ACEITE = { condicoes: VERSAO_CONDICOES, legal: VERSAO_LEGAL, leuTermos: true };
const END = { cep: '30130010', logradouro: 'Rua Fictícia', numero: '10', bairro: 'Savassi', cidade: 'Belo Horizonte', uf: 'MG', tipoImovel: 'Apartamento' };
const CAR = { metragem: 45, ambientes: { quartos: 1 }, animais: { tem: false } };
const k = (p) => `${p}-${crypto.randomUUID()}`;
/** CPF válido novo a cada chamada (dígitos verificadores calculados). */
let seqCpf = 100000000;
function cpfNovo() {
  const b = String(seqCpf++).padStart(9, '0').split('').map(Number);
  for (const n of [9, 10]) { const s = b.slice(0, n).reduce((t, d, i) => t + d * (n + 1 - i), 0); b.push(((s * 10) % 11) % 10); }
  return b.join('');
}
const AT = (data, extra = {}) => ({ servico: 'residencial', caracteristicas: CAR, duracaoHoras: 4, data, horaInicio: '08:30', endereco: { ref: 'novo:0' }, localRefeicao: true, ...extra });

async function novoCliente(a, extra = {}) {
  const email = `v3-${crypto.randomUUID().slice(0, 8)}@exemplo.com`;
  const c = { tipo: 'residencial', nome: 'Ana Nova Fictícia', telefone: '31955554444', email, cpf: cpfNovo(), dataNascimento: '1990-03-07', ...extra };
  const { ticket } = await a.casos.cadastrarClienteV3(c, { chave: k('cad') });
  const id = await a.repo.leitura(null, async (tx) => (await tx.todos('clientes')).find((x) => x.email === email)?.id);
  return { ticket, id, email };
}
async function enviar(a, { ticket, sessao, pedido, enderecosNovos = { 'novo:0': { ...END, uso: 'salvar' } }, origem }) {
  const base = { pedido, enderecosNovos, ...(ticket ? { ticket } : {}) };
  const cot = await a.casos.cotarV3(base, { sessao });
  const r = await a.casos.solicitarV3({ ...base, origem, aceite: ACEITE, valorEsperadoCentavos: cot.totalCentavos }, { sessao, chave: k('env') });
  return { cot, ...r };
}
const pagamentos = (a, pedidoId) => a.repo.leitura(null, async (tx) => (await tx.por('pagamentos', 'pedidoId', pedidoId)).sort((x, y) => x.venceEm.localeCompare(y.venceEm)));
const mensagens = (a, regra) => a.repo.leitura(null, async (tx) => {
  const ex = (await tx.todos('execucoes')).filter((e) => e.regra === regra);
  const ms = await tx.todos('mensagens');
  return ex.map((e) => ({ estado: e.estado, motivo: e.motivo, conteudo: ms.find((m) => m.execucaoId === e.id)?.conteudo }));
});

t.teste('avulsa pelo ticket: C01 com o número da solicitação; confirmação gera UMA cobrança integral; pagar confirma a diária', async () => {
  const a = montarAmbiente(AGORA);
  const { ticket } = await novoCliente(a);
  const r = await enviar(a, { ticket, pedido: { segmento: 'residencial', modalidade: 'avulsa', atendimentos: [AT('2026-10-06')] } });
  const c01 = await mensagens(a, 'C01');
  assert.match(c01.find((m) => m.conteudo)?.conteudo || '', new RegExp(`nº ${String(r.pedido.numero).padStart(6, '0')}\\): 1 diária em 06/10/2026`));
  const conf = await a.casos.confirmarDisponibilidade(r.pedido.id, {}, { ...PRIME, chave: k('cd') });
  assert.deepEqual(conf.pagamentos.map((g) => [g.parcela, g.valorCentavos, g.venceEm]), [['integral', 17500, '2026-10-05']]);
  const c02 = await mensagens(a, 'C02');
  assert.match(c02.find((m) => m.conteudo)?.conteudo || '', /pagamento antecipado de R\$ 175,00 por PIX/);
  const p = await a.casos.confirmarPagamento(conf.pagamentos[0].id, { ...PRIME, chave: k('cp') });
  assert.deepEqual([p.pedido.status, p.atendimentos.map((x) => x.status)], ['confirmado', ['confirmado']]);
});

t.teste('pacote de 4: confirmação gera só a 1ª metade; a rotina da manhã gera a 2ª na data de envio (uma vez só) e manda a C17; cada metade confirma a sua metade', async () => {
  const a = montarAmbiente(AGORA);
  const { ticket } = await novoCliente(a);
  const datas = ['2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27'];
  const r = await enviar(a, { ticket, pedido: { segmento: 'residencial', modalidade: 'pacote', frequencia: 'semanal', atendimentos: datas.map((d) => AT(d)) } });
  assert.equal(r.cot.totalCentavos, 4 * 17500 - 2000);
  const conf = await a.casos.confirmarDisponibilidade(r.pedido.id, {}, { ...PRIME, chave: k('cd') });
  assert.deepEqual(conf.pagamentos.map((g) => [g.parcela, g.valorCentavos]), [['metade_1', 34000]]);
  assert.equal(await a.casos.rodarRotinaParcela2(PRIME), 0, 'antes da data de envio, nada');
  // marco = 3ª diária (20/10); vence 19/10 (segunda) 14h; envio 17/10
  const prev = calcularParcelas({ modalidade: 'pacote', datas, totalCentavos: 68000 }, CONFIG_PRECOS)[1];
  assert.deepEqual([prev.marcoData, prev.venceEm, prev.envioEm], ['2026-10-20', '2026-10-19', '2026-10-17']);
  a.relogio.irPara('2026-10-17T10:30:00.000Z'); // 07:30 em SP: antes do horário da rotina
  assert.equal(await a.casos.rodarRotinaParcela2(PRIME), 0, 'antes das 08:00, nada');
  a.relogio.irPara('2026-10-17T11:05:00.000Z');
  assert.equal(await a.casos.rodarRotinaParcela2(PRIME), 1);
  assert.equal(await a.casos.rodarRotinaParcela2(PRIME), 0, 'idempotente');
  const pgs = await pagamentos(a, r.pedido.id);
  assert.deepEqual(pgs.map((g) => [g.parcela, g.valorCentavos, g.venceEm]), [['metade_1', 34000, '2026-10-05'], ['metade_2', 34000, '2026-10-19']]);
  const c17 = await mensagens(a, 'C17');
  assert.match(c17.find((m) => m.conteudo)?.conteudo || '', /segunda parte do pagamento do seu pacote na Prime: R\$ 340,00, com vencimento até 14h de seg, 19\/10/);
  a.relogio.irPara('2026-10-01T12:00:00.000Z');
  const p1 = await a.casos.confirmarPagamento(pgs[0].id, { ...PRIME, chave: k('cp1') });
  assert.deepEqual(p1.atendimentos.map((x) => x.status), ['confirmado', 'confirmado', 'agendado', 'agendado'], 'a 1ª metade confirma as diárias 1 e 2');
  const p2 = await a.casos.confirmarPagamento(pgs[1].id, { ...PRIME, chave: k('cp2') });
  assert.deepEqual(p2.atendimentos.map((x) => x.status), ['confirmado', 'confirmado', 'confirmado', 'confirmado']);
});

t.teste('remarcação: a 2ª parcela pendente acompanha o marco e o vencimento pela agenda vigente; sábado novo cobra a taxa', async () => {
  const a = montarAmbiente(AGORA);
  const { ticket } = await novoCliente(a);
  const datas = ['2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27'];
  const r = await enviar(a, { ticket, pedido: { segmento: 'residencial', modalidade: 'pacote', frequencia: 'semanal', atendimentos: datas.map((d) => AT(d)) } });
  await a.casos.confirmarDisponibilidade(r.pedido.id, {}, { ...PRIME, chave: k('cd') });
  a.relogio.irPara('2026-10-17T11:05:00.000Z');
  await a.casos.rodarRotinaParcela2(PRIME);
  a.relogio.irPara('2026-10-01T12:00:00.000Z');
  const ped = await a.casos.obterPedido(r.pedido.id, PRIME);
  // a 3ª diária (marco) vai pra 24/10 (sábado): o marco vira a nova 3ª data pela ordem (24/10) e entra a taxa de sábado
  await a.casos.transicionarAtendimento(ped.atendimentos[2].id, { evento: 'reagendar', dados: { data: '2026-10-24', horaInicio: '08:30' } }, { ...PRIME, chave: k('rem') });
  const depois = await a.casos.obterPedido(r.pedido.id, PRIME);
  const mudou = depois.atendimentos.find((x) => x.data === '2026-10-24');
  assert.deepEqual([mudou.taxaDiaCentavos, mudou.valorDiaCentavos], [2000, 19500]);
  assert.equal(depois.pedido.pacote.totalCentavos, 68000 + 2000);
  const pgs = await pagamentos(a, r.pedido.id);
  const m2 = pgs.find((g) => g.parcela === 'metade_2');
  assert.deepEqual([m2.marcoData, m2.venceEm, m2.valorCentavos], ['2026-10-24', '2026-10-23', 70000 - 34000]);
});

t.teste('cupom: aplicado na cotação, consumido só na confirmação; limite de 1 esgota pra próxima', async () => {
  const a = montarAmbiente(AGORA);
  await a.casos.salvarCupom({ codigo: 'BEMVINDA', tipo: 'valor', valor: 1500, limiteDeUso: 1 }, PRIME);
  const c1 = await novoCliente(a);
  const ped = { segmento: 'residencial', modalidade: 'avulsa', atendimentos: [AT('2026-10-06')], cupom: 'bemvinda' };
  const r = await enviar(a, { ticket: c1.ticket, pedido: ped });
  assert.deepEqual([r.cot.cupom, r.cot.totalCentavos], [{ codigo: 'BEMVINDA', aplicado: true }, 16000]);
  assert.equal((await a.casos.listarCupons(PRIME))[0].usos, 0, 'abandono/envio não consome (item 43)');
  await a.casos.confirmarDisponibilidade(r.pedido.id, {}, { ...PRIME, chave: k('cd') });
  assert.equal((await a.casos.listarCupons(PRIME))[0].usos, 1);
  const c2 = await novoCliente(a);
  const cot = await a.casos.cotarV3({ ticket: c2.ticket, pedido: ped, enderecosNovos: { 'novo:0': { ...END, uso: 'unico' } } });
  assert.deepEqual(cot.cupom, { codigo: 'BEMVINDA', aplicado: false, motivo: 'esgotado' });
});

t.teste('revisão V7: diárias canceladas depois da 1ª metade paga: a 2ª não sai com valor zero ou negativo; pacote reduzido a uma data vira cobrança única', async () => {
  const a = montarAmbiente(AGORA);
  const datas = ['2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27'];
  const PAC = { segmento: 'residencial', modalidade: 'pacote', frequencia: 'semanal', atendimentos: datas.map((d) => AT(d)) };
  const cancelar = async (id) => a.casos.transicionarAtendimento(id, { evento: 'cancelar' }, { ...PRIME, chave: k('can') });
  // 1) 1ª metade paga (R$ 340) e duas diárias canceladas: total R$ 330, a 2ª seria -R$ 10 -> a rotina não gera
  const r = await enviar(a, { ticket: (await novoCliente(a)).ticket, pedido: PAC });
  const conf = await a.casos.confirmarDisponibilidade(r.pedido.id, {}, { ...PRIME, chave: k('cd') });
  await a.casos.confirmarPagamento(conf.pagamentos[0].id, { ...PRIME, chave: k('cp') });
  const ped = await a.casos.obterPedido(r.pedido.id, PRIME);
  for (const x of ped.atendimentos.slice(2)) await cancelar(x.id);
  assert.equal((await a.casos.obterPedido(r.pedido.id, PRIME)).pedido.pacote.totalCentavos, 33000);
  a.relogio.irPara('2026-10-17T11:05:00.000Z');
  assert.equal(await a.casos.rodarRotinaParcela2(PRIME), 0, 'sem 2ª parcela negativa');
  assert.deepEqual((await pagamentos(a, r.pedido.id)).map((g) => g.parcela), ['metade_1']);
  a.relogio.irPara(AGORA);
  // 2) antes de pagar: três canceladas -> a 1ª metade aberta vira o total (R$ 155) e paga a diária que sobrou
  const r2 = await enviar(a, { ticket: (await novoCliente(a)).ticket, pedido: PAC });
  const c2 = await a.casos.confirmarDisponibilidade(r2.pedido.id, {}, { ...PRIME, chave: k('cd') });
  const p2 = await a.casos.obterPedido(r2.pedido.id, PRIME);
  for (const x of p2.atendimentos.slice(1)) await cancelar(x.id);
  const [g] = (await pagamentos(a, r2.pedido.id)).filter((x) => x.status !== 'cancelado');
  assert.deepEqual([g.id, g.parcela, g.valorCentavos], [c2.pagamentos[0].id, 'metade_1', 17500 - 2000]);
  const pago = await a.casos.confirmarPagamento(g.id, { ...PRIME, chave: k('cp') });
  assert.equal(pago.atendimentos[0].status, 'confirmado', 'a cobrança única cobre a diária restante');
});

t.teste('revisão V7: cupom e condição revalidados na confirmação (outro pedido usou antes); desconto de 100% confirma sem cobrança', async () => {
  const a = montarAmbiente(AGORA);
  await a.casos.salvarCupom({ codigo: 'UMAVEZ', tipo: 'valor', valor: 1500, limiteDeUso: 1 }, PRIME);
  const ped = { segmento: 'residencial', modalidade: 'avulsa', atendimentos: [AT('2026-10-06')], cupom: 'umavez' };
  const r1 = await enviar(a, { ticket: (await novoCliente(a)).ticket, pedido: ped });
  const r2 = await enviar(a, { ticket: (await novoCliente(a)).ticket, pedido: ped });
  await a.casos.confirmarDisponibilidade(r1.pedido.id, {}, { ...PRIME, chave: k('cd') });
  await lancaCodigo(() => a.casos.confirmarDisponibilidade(r2.pedido.id, {}, { ...PRIME, chave: k('cd') }), 'CONDICAO_NAO_ATENDIDA');
  assert.equal((await a.casos.obterPedido(r2.pedido.id, PRIME)).pedido.status, 'solicitado', 'a Prime decide: recusa ou combina');
  await a.casos.salvarCupom({ codigo: 'CORTESIA', tipo: 'percentual', valor: 100 }, PRIME);
  const r3 = await enviar(a, { ticket: (await novoCliente(a)).ticket, pedido: { ...ped, cupom: 'cortesia' } });
  assert.equal(r3.cot.totalCentavos, 0);
  const c3 = await a.casos.confirmarDisponibilidade(r3.pedido.id, {}, { ...PRIME, chave: k('cd') });
  assert.deepEqual(c3.pagamentos, []);
  const p3 = await a.casos.obterPedido(r3.pedido.id, PRIME);
  assert.deepEqual([p3.pedido.status, p3.atendimentos[0].status], ['confirmado', 'confirmado']);
});

t.teste('condição especial não cumulativa (item 44) só pra cliente logada: substitui o desconto do pacote; uso único consumido na confirmação', async () => {
  const a = montarAmbiente(AGORA);
  const c = await novoCliente(a);
  await a.casos.salvarCondicaoComercial(c.id, { tipo: 'valor', valor: 10000, validade: 'uso_unico', acumula: false, observacao: 'cliente antiga' }, PRIME);
  const datas = ['2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27', '2026-11-03'];
  const pedido = { segmento: 'residencial', modalidade: 'pacote', frequencia: 'semanal', atendimentos: datas.map((d) => AT(d)) };
  const pelaTicket = await a.casos.cotarV3({ ticket: c.ticket, pedido, enderecosNovos: { 'novo:0': { ...END, uso: 'salvar' } } });
  assert.deepEqual(pelaTicket.descontos.map((d) => d.codigo), ['quantidade'], 'pelo ticket a condição não vale');
  const sessao = { ator: 'cliente', id: c.id };
  const r = await enviar(a, { sessao, pedido });
  assert.deepEqual(r.cot.descontos, [{ codigo: 'especial', descricao: 'Desconto especial', centavos: 10000 }]);
  await a.casos.confirmarDisponibilidade(r.pedido.id, {}, { ...PRIME, chave: k('cd') });
  const ficha = await a.casos.fichaClienteV3(c.id, PRIME);
  assert.ok(ficha.condicao.consumidaEm, 'uso único consumido');
  const de2 = await a.casos.cotarV3({ pedido, enderecosNovos: { 'novo:0': { ...END, uso: 'unico' } } }, { sessao });
  assert.deepEqual(de2.descontos.map((d) => d.codigo), ['quantidade'], 'consumida, volta o desconto normal');
});

t.teste('faturamento empresarial autorizado (itens 40 e 41): reconhecido ao entrar; confirmação sem pagamento antecipado, cobrança "A faturar" e sem a C02', async () => {
  const a = montarAmbiente(AGORA);
  const c = await novoCliente(a, { tipo: 'empresa', responsavel: 'Carlos Lima', razaoSocial: 'Empresa Teste Ltda', cnpj: '11222333000181', nome: undefined, cpf: undefined, dataNascimento: undefined });
  await lancaCodigo(() => a.casos.salvarFaturamento(c.id, { autorizado: true }, { sessao: { ator: 'cliente', id: c.id } }), 'ATOR_SEM_PERMISSAO');
  await a.casos.salvarFaturamento(c.id, { autorizado: true, forma: 'transferencia', prazoDias: 15, nf: true }, PRIME);
  const sessao = { ator: 'cliente', id: c.id };
  const pedido = { segmento: 'empresa', modalidade: 'avulsa', atendimentos: [AT('2026-10-06', { servico: 'empresarial', endereco: { ref: 'novo:0' } })] };
  const r = await enviar(a, { sessao, pedido, enderecosNovos: { 'novo:0': { ...END, tipoImovel: 'Escritório', uso: 'salvar' } } });
  assert.deepEqual(r.cot.faturamento, { prazoDias: 15, forma: 'transferencia', nf: true });
  assert.deepEqual(r.cot.parcelas, [{ parcela: 'faturamento', marco: 'confirmacao', valorCentavos: 18500, venceEm: '2026-10-21', venceAs: null }]);
  const conf = await a.casos.confirmarDisponibilidade(r.pedido.id, {}, { ...PRIME, chave: k('cd') });
  assert.equal(conf.pedido.status, 'confirmado');
  assert.deepEqual(conf.pagamentos.map((g) => [g.parcela, g.formaFaturamento, g.nfEmitir, g.brcode]), [['faturamento', 'transferencia', true, null]]);
  const c02 = await mensagens(a, 'C02');
  assert.ok(!c02.some((m) => m.conteudo), 'faturamento não recebe "faça o pagamento antecipado"');
});

t.teste('cadastros sem solicitação (item 34): quem se cadastrou e não enviou aparece; quem enviou sai da lista', async () => {
  const a = montarAmbiente(AGORA);
  const s1 = await novoCliente(a);
  const s2 = await novoCliente(a);
  await enviar(a, { ticket: s2.ticket, pedido: { segmento: 'residencial', modalidade: 'avulsa', atendimentos: [AT('2026-10-06')] } });
  const l = await a.casos.listarCadastrosSemSolicitacao({}, PRIME);
  assert.deepEqual(l.itens.map((x) => x.id), [s1.id]);
  await a.casos.definirStatusProspeccao(s1.id, 'contatado', PRIME);
  assert.equal((await a.casos.listarCadastrosSemSolicitacao({ status: 'contatado' }, PRIME)).itens.length, 1);
});

await t.fim();
