// E3: calcularPacote + gerarAtendimentos (puras). node scripts/testa-pacote.mjs
import { criarSuite, assert, lancaCodigo } from './lib-teste.mjs';
import { calcularPacote, gerarAtendimentos } from '../src/domain/pacote.js';
import { diaDaSemana } from '../src/domain/calendario.js';
import { CONFIG_PRECOS as CFG } from '../src/config/precos.js';

const t = criarSuite('pacote (E3)');
const BH = { cidade: 'Belo Horizonte', uf: 'MG' };
const HOJE = '2026-10-01';
const soma = (it) => it.reduce((s, i) => s + i.centavos, 0);

t.teste('1. residencial avulso 70 m² + geladeira: preço discriminado, entrada/restante', () => {
  const p = calcularPacote({ tipoCliente: 'residencial', tipoLimpeza: 'padrao', metragem: 70, quantidadeDiarias: 1, frequencia: 'avulso', adicionais: ['geladeira'], endereco: BH }, CFG);
  assert.deepEqual(p.itens.map((i) => [i.codigo, i.centavos]), [['base', 24000], ['adicional:geladeira', 3000]]);
  assert.equal(p.valorDiaCentavos, 27000); assert.equal(p.totalCentavos, 27000);
  assert.equal(p.entradaCentavos, 13500); assert.equal(p.restanteCentavos, 13500);
  const at = gerarAtendimentos(p, { primeiraData: '2026-10-05', turno: 'manha', hoje: HOJE, endereco: BH }, CFG);
  assert.equal(at.length, 1); assert.equal(at[0].parcelaCentavos, 13500);
});

t.teste('2. 4 semanais pesada por cômodos com desconto semanal', () => {
  const p = calcularPacote({ tipoCliente: 'residencial', tipoLimpeza: 'pesada', comodos: 5, quantidadeDiarias: 4, frequencia: 'semanal', adicionais: [], endereco: BH }, CFG);
  // base 9000 + 5*2500 = 21500; pesada 140% = 30100 (+8600); desconto 10% = -3010
  assert.deepEqual(p.itens.map((i) => i.centavos), [21500, 8600, -3010]);
  assert.equal(p.valorDiaCentavos, 27090); assert.equal(p.totalCentavos, 108360);
  assert.equal(soma(p.itens), p.valorDiaCentavos);
  const at = gerarAtendimentos(p, { primeiraData: '2026-10-05', turno: 'tarde', hoje: HOJE, endereco: BH }, CFG);
  assert.deepEqual(at.map((a) => a.data), ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
  assert.equal(at.reduce((s, a) => s + a.parcelaCentavos, 0), p.restanteCentavos);
});

t.teste('3. quinzenal: 3 diárias a cada 14 dias, desconto 5%', () => {
  const p = calcularPacote({ tipoCliente: 'residencial', tipoLimpeza: 'padrao', metragem: 40, quantidadeDiarias: 3, frequencia: 'quinzenal', adicionais: [], endereco: BH }, CFG);
  assert.equal(p.valorDiaCentavos, 18000 - 900);
  const at = gerarAtendimentos(p, { primeiraData: '2026-10-06', turno: 'manha', hoje: HOJE, endereco: BH }, CFG);
  assert.deepEqual(at.map((a) => a.data), ['2026-10-06', '2026-10-20', '2026-11-03']);
});

t.teste('4. empresa mensal com adicionais a partir do dia 31: clamp no fim do mês e domingo deslocado', () => {
  const end = { cidade: 'Contagem', uf: 'MG' };
  const p = calcularPacote({ tipoCliente: 'empresa', tipoLimpeza: 'padrao', metragem: 150, quantidadeDiarias: 4, frequencia: 'mensal', adicionais: ['janelas', 'armarios'], endereco: end }, CFG);
  // base 32000 + empresa 15% 4800 + janelas 4000 + armários 4000 + deslocamento Contagem 1500
  assert.deepEqual(p.itens.map((i) => [i.codigo, i.centavos]), [['base', 32000], ['empresa', 4800], ['adicional:janelas', 4000], ['adicional:armarios', 4000], ['deslocamento', 1500]]);
  const at = gerarAtendimentos(p, { primeiraData: '2026-12-31', turno: 'integral', hoje: '2026-12-01', endereco: end }, CFG);
  // 31/01/2027 é domingo -> 01/02; 28/02/2027 é domingo -> 01/03; 31/03/2027 quarta
  assert.deepEqual(at.map((a) => [a.data, a.deslocada]), [['2026-12-31', false], ['2027-02-01', true], ['2027-03-01', true], ['2027-03-31', false]]);
  assert.ok(at.every((a) => diaDaSemana(a.data) !== 0));
});

t.teste('5. centavo ímpar: total 10001 -> entrada 5000, restante 5001', () => {
  const cfg = { ...CFG, PRECOS: { ...CFG.PRECOS, faixasMetragem: [{ ate: 250, centavos: 10001 }] } };
  const p = calcularPacote({ tipoCliente: 'residencial', tipoLimpeza: 'padrao', metragem: 50, quantidadeDiarias: 1, frequencia: 'avulso', adicionais: [], endereco: BH }, cfg);
  assert.equal(p.totalCentavos, 10001); assert.equal(p.entradaCentavos, 5000); assert.equal(p.restanteCentavos, 5001);
});

t.teste('6. região não atendida', async () => {
  await lancaCodigo(() => calcularPacote({ tipoCliente: 'residencial', tipoLimpeza: 'padrao', metragem: 50, quantidadeDiarias: 1, frequencia: 'avulso', adicionais: [], endereco: { cidade: 'Ouro Preto', uf: 'MG' } }, CFG), 'REGIAO_NAO_ATENDIDA');
});

t.teste('7. domingo deslocado (mensal a partir de 04/09 cai em 04/10, domingo)', () => {
  const p = calcularPacote({ tipoCliente: 'residencial', tipoLimpeza: 'padrao', metragem: 50, quantidadeDiarias: 2, frequencia: 'mensal', adicionais: [], endereco: BH }, CFG);
  const at = gerarAtendimentos(p, { primeiraData: '2026-09-04', turno: 'manha', hoje: '2026-09-01', endereco: BH }, CFG);
  assert.equal(at[1].original, '2026-10-04'); assert.equal(at[1].data, '2026-10-05'); assert.equal(at[1].deslocada, true);
});

t.teste('8. feriado configurado desloca a semanal', () => {
  const cfg = { ...CFG, datasBloqueadas: ['2026-10-12'] };
  const p = calcularPacote({ tipoCliente: 'residencial', tipoLimpeza: 'padrao', metragem: 50, quantidadeDiarias: 2, frequencia: 'semanal', adicionais: [], endereco: BH }, cfg);
  const at = gerarAtendimentos(p, { primeiraData: '2026-10-05', turno: 'manha', hoje: HOJE, endereco: BH }, cfg);
  assert.deepEqual(at.map((a) => a.data), ['2026-10-05', '2026-10-13']);
});

t.teste('9. regras de quantidade/frequência: avulso só 1; frequência exige 2+; empresa exige frequência', async () => {
  const base = { tipoCliente: 'residencial', tipoLimpeza: 'padrao', metragem: 50, adicionais: [] };
  await lancaCodigo(() => calcularPacote({ ...base, quantidadeDiarias: 2, frequencia: 'avulso' }, CFG), 'DADOS_INVALIDOS');
  await lancaCodigo(() => calcularPacote({ ...base, quantidadeDiarias: 1, frequencia: 'semanal' }, CFG), 'DADOS_INVALIDOS');
  await lancaCodigo(() => calcularPacote({ ...base, tipoCliente: 'empresa', quantidadeDiarias: 1, frequencia: 'avulso' }, CFG), 'DADOS_INVALIDOS');
  await lancaCodigo(() => calcularPacote({ ...base, quantidadeDiarias: 13, frequencia: 'semanal' }, CFG), 'DADOS_INVALIDOS');
});

t.teste('10. metragem OU cômodos; limites; adicional inválido ou repetido', async () => {
  const base = { tipoCliente: 'residencial', tipoLimpeza: 'padrao', quantidadeDiarias: 1, frequencia: 'avulso', adicionais: [] };
  await lancaCodigo(() => calcularPacote({ ...base, metragem: 50, comodos: 3 }, CFG), 'DADOS_INVALIDOS');
  await lancaCodigo(() => calcularPacote({ ...base }, CFG), 'DADOS_INVALIDOS');
  await lancaCodigo(() => calcularPacote({ ...base, metragem: 5 }, CFG), 'DADOS_INVALIDOS');
  await lancaCodigo(() => calcularPacote({ ...base, metragem: 60.5 }, CFG), 'DADOS_INVALIDOS');
  await lancaCodigo(() => calcularPacote({ ...base, metragem: 50, adicionais: ['piscina'] }, CFG), 'DADOS_INVALIDOS');
  await lancaCodigo(() => calcularPacote({ ...base, metragem: 50, adicionais: ['forno', 'forno'] }, CFG), 'DADOS_INVALIDOS');
  await lancaCodigo(() => calcularPacote({ ...base, metragem: 50, tipoLimpeza: 'x' }, CFG), 'DADOS_INVALIDOS');
});

t.teste('11. cobrança no_primeiro: todo o restante no 1º atendimento', () => {
  const cfg = { ...CFG, cobrancaRestante: 'no_primeiro' };
  const p = calcularPacote({ tipoCliente: 'residencial', tipoLimpeza: 'padrao', metragem: 50, quantidadeDiarias: 3, frequencia: 'semanal', adicionais: [], endereco: BH }, cfg);
  const at = gerarAtendimentos(p, { primeiraData: '2026-10-05', turno: 'manha', hoje: HOJE, endereco: BH }, cfg);
  assert.deepEqual(at.map((a) => a.parcelaCentavos), [p.restanteCentavos, 0, 0]);
  assert.equal(p.cobrancaRestante, 'no_primeiro');
});

t.teste('12. primeira data no passado, hoje (antecedência) e domingo são recusadas', async () => {
  const p = calcularPacote({ tipoCliente: 'residencial', tipoLimpeza: 'padrao', metragem: 50, quantidadeDiarias: 1, frequencia: 'avulso', adicionais: [], endereco: BH }, CFG);
  await lancaCodigo(() => gerarAtendimentos(p, { primeiraData: '2026-09-30', turno: 'manha', hoje: HOJE, endereco: BH }, CFG), 'DATA_INVALIDA');
  await lancaCodigo(() => gerarAtendimentos(p, { primeiraData: HOJE, turno: 'manha', hoje: HOJE, endereco: BH }, CFG), 'DATA_INVALIDA');
  await lancaCodigo(() => gerarAtendimentos(p, { primeiraData: '2026-10-04', turno: 'manha', hoje: HOJE, endereco: BH }, CFG), 'DATA_INVALIDA');
  await lancaCodigo(() => gerarAtendimentos(p, { primeiraData: '2026-10-05', turno: 'noite', hoje: HOJE, endereco: BH }, CFG), 'DADOS_INVALIDOS');
});

t.teste('13. taxa de deslocamento por cidade entra por diária (sem acento/caixa)', () => {
  const p = calcularPacote({ tipoCliente: 'residencial', tipoLimpeza: 'padrao', metragem: 50, quantidadeDiarias: 2, frequencia: 'semanal', adicionais: [], endereco: { cidade: 'SABARA', uf: 'mg' } }, CFG);
  assert.equal(p.taxaDeslocamentoCentavos, 2000);
  assert.equal(p.itens.at(-1).codigo, 'deslocamento');
  assert.equal(p.totalCentavos, p.valorDiaCentavos * 2);
});

await t.fim();
