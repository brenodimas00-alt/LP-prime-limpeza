// Agendamento v2 (domínio): estimarDuracao pelas tabelas do sistema antigo (decisão de 28/09), horários de 08:00 até
// 18:30 − duração, datas únicas, escolhidas e recorrentes com hora por diária, valor e desconto por mês. Totais à mão.
import { criarSuite, assert, lancaCodigo } from './lib-teste.mjs';
import { estimarDuracao, cotarSolicitacao, validarSolicitacao, motivoDataIndisponivel, datasDaAgenda } from '../src/domain/agenda.js';
import { horariosDeInicio, sobrepoe, rotuloHorario, horaInicioDe } from '../src/domain/horario.js';
import { CONFIG_PRECOS as CFG } from '../src/config/precos.js';

const t = criarSuite('agenda v2 (duração, horários, datas, valor)');
const HOJE = '2026-10-01'; // quinta
const BH = { cidade: 'Belo Horizonte', uf: 'MG' };
const SOL = (extra = {}, agenda = {}) => ({
  tipoCliente: 'residencial', tipoServico: 'residencial', duracaoHoras: 4, metragem: 45,
  agenda: { modo: 'unica', datas: ['2026-10-05'], horario: '08:00', ...agenda }, ...extra,
});
const cotar = (s, ctx = {}) => cotarSolicitacao(s, { hoje: HOJE, endereco: BH, ...ctx }, CFG);
const est = (tipoCliente, metragem, comodos) => estimarDuracao({ tipoCliente, metragem, comodos }, CFG).horas;

t.teste('metragem nos limites (residencial): 30->2h, 31->4h, 50->4h, 51->6h, 80->6h, 81->8h, 120->8h, 121->sem sugestão', () => {
  assert.deepEqual([30, 31, 50, 51, 80, 81, 120, 121].map((m) => est('residencial', m)), [2, 4, 4, 6, 6, 8, 8, null]);
  assert.equal(estimarDuracao({ tipoCliente: 'residencial', metragem: 121 }, CFG).motivo, 'acima');
});

t.teste('empresarial usa a tabela própria: 40->2h, 41->4h, 60->4h, 90->6h, 130->8h, 131->sem sugestão', () => {
  assert.deepEqual([40, 41, 60, 61, 90, 91, 130, 131].map((m) => est('empresa', m)), [2, 4, 4, 6, 6, 8, 8, null]);
});

t.teste('cômodos: 3->2h, 4->4h, 8->6h, 10->8h, 11->sem (residencial); comercial 11->8h; zero cômodos sem metragem não sugere', () => {
  const c = (n) => ({ quartos: n });
  assert.deepEqual([3, 4, 5, 6, 8, 9, 10, 11].map((n) => est('residencial', undefined, c(n))), [2, 4, 4, 6, 6, 8, 8, null]);
  assert.equal(est('empresa', undefined, c(11)), 8);
  assert.deepEqual(estimarDuracao({ tipoCliente: 'residencial', comodos: { quartos: 0, salas: 0 } }, CFG), { horas: null, motivo: 'sem_dados', totalComodos: 0 });
  // soma dos tipos: 2 quartos + 1 banheiro + 1 sala + 1 cozinha = 5 -> 4h
  assert.equal(est('residencial', undefined, { quartos: 2, banheiros: 1, salas: 1, cozinhas: 1, areaExterna: 0 }), 4);
});

t.teste('metragem E cômodos: vale o que exigir mais (40 m² com 7 cômodos -> 6h; 70 m² com 2 cômodos -> 6h)', () => {
  assert.equal(est('residencial', 40, { quartos: 7 }), 6);
  assert.equal(est('residencial', 70, { quartos: 2 }), 6);
});

t.teste('2h bloqueada acima do limite dela (residencial 30 m² ou 3 cômodos; empresarial 40 m² ou 4); passadoria sem limite', () => {
  assert.match(validarSolicitacao(SOL({ duracaoHoras: 2, metragem: 31 }), CFG).join(), /2 horas é só para locais até 30 m²/);
  assert.match(validarSolicitacao(SOL({ duracaoHoras: 2, metragem: undefined, comodos: { quartos: 4 } }), CFG).join(), /2 horas/);
  assert.deepEqual(validarSolicitacao(SOL({ tipoCliente: 'empresa', tipoServico: 'empresarial', duracaoHoras: 2, metragem: 40 }), CFG), []);
  assert.deepEqual(validarSolicitacao(SOL({ tipoServico: 'passadoria', duracaoHoras: 2, metragem: undefined, pecas: 30 }), CFG), []);
});

t.teste('serviço precisa ser do tipo escolhido; pós-obra continua fora; metragem é opcional', () => {
  assert.match(validarSolicitacao(SOL({ tipoServico: 'empresarial' }), CFG).join(), /Escolha o serviço/);
  assert.match(validarSolicitacao(SOL({ tipoServico: 'pos_obra' }), CFG).join(), /pós-obra/);
  assert.deepEqual(validarSolicitacao(SOL({ metragem: undefined }), CFG), []);
});

t.teste('horários: 08:00 até 18:30 − duração, de 30 em 30 min (2h 16:30, 4h 14:30, 6h 12:30, 8h 10:30)', () => {
  const ht = CFG.horariosTrabalho;
  assert.deepEqual([2, 4, 6, 8].map((h) => horariosDeInicio(h, ht).at(-1)), ['16:30', '14:30', '12:30', '10:30']);
  assert.equal(horariosDeInicio(8, ht)[0], '08:00');
  assert.deepEqual(horariosDeInicio(8, ht), ['08:00', '08:30', '09:00', '09:30', '10:00', '10:30']);
});

t.teste('servidor recusa horário fora da duração (4h às 15:00), domingo e além de 120 dias', async () => {
  await lancaCodigo(() => cotar(SOL({}, { horario: '15:00' })), 'DATA_INVALIDA');
  await lancaCodigo(() => cotar(SOL({}, { datas: ['2026-10-04'] })), 'DATA_INVALIDA'); // domingo
  assert.match(motivoDataIndisponivel('2026-10-04', HOJE, CFG), /domingo/);
  assert.match(motivoDataIndisponivel('2027-01-30', HOJE, CFG), /120 dias/);
  assert.equal(motivoDataIndisponivel('2026-10-02', HOJE, CFG), null); // amanhã: antecedência de 1 dia
  assert.match(motivoDataIndisponivel(HOJE, HOJE, CFG), /antecedência/);
});

t.teste('única, 4h em BH segunda 08:00: R$ 175,00, hora e duração gravadas na diária', () => {
  const r = cotar(SOL());
  assert.equal(r.pacote.totalCentavos, 17500);
  assert.deepEqual([r.itens[0].horaInicio, r.itens[0].duracaoMinutos], ['08:00', 240]);
  assert.deepEqual([r.pacote.modoAgenda, r.pacote.frequencia, r.pacote.quantidadeDiarias, r.pacote.versao], ['unica', 'avulso', 1, 2]);
});

t.teste('várias datas em meses diferentes com horário individual: desconto por mês (3 em outubro -20; 2 em novembro sem)', () => {
  const datas = ['2026-10-06', '2026-10-13', '2026-10-20', '2026-11-03', '2026-11-10'];
  const horarios = { '2026-10-06': '08:00', '2026-10-13': '09:30', '2026-10-20': '14:30', '2026-11-03': '08:00', '2026-11-10': '10:00' };
  const r = cotar(SOL({}, { modo: 'datas_escolhidas', datas, horario: undefined, horarios }));
  assert.deepEqual(r.itens.map((i) => i.horaInicio), ['08:00', '09:30', '14:30', '08:00', '10:00']);
  assert.deepEqual(r.descontos, [{ mes: '2026-10', diarias: 3, centavos: 2000 }]);
  assert.equal(r.pacote.totalCentavos, 5 * 17500 - 2000);
});

t.teste('várias datas: mesma data repetida é recusada; datas chegam fora de ordem e saem ordenadas', async () => {
  await lancaCodigo(() => cotar(SOL({}, { modo: 'datas_escolhidas', datas: ['2026-10-06', '2026-10-06'] })), 'DADOS_INVALIDOS');
  const r = cotar(SOL({}, { modo: 'datas_escolhidas', datas: ['2026-10-09', '2026-10-06'] }));
  assert.deepEqual(r.itens.map((i) => [i.sequencia, i.data]), [[1, '2026-10-06'], [2, '2026-10-09']]);
});

t.teste('recorrente semanal x5 às 13:00, todos sábados (taxa de sábado em cada): valor e desconto de 5 no mês', () => {
  const r = cotar(SOL({ tipoCliente: 'empresa', tipoServico: 'empresarial', metragem: 50 }, { modo: 'recorrente', datas: undefined, primeiraData: '2026-10-03', frequencia: 'semanal', quantidade: 5, horario: '13:00' }));
  assert.deepEqual(r.itens.map((i) => i.data), ['2026-10-03', '2026-10-10', '2026-10-17', '2026-10-24', '2026-10-31']); // todos sábados
  assert.ok(r.itens.every((i) => i.horaInicio === '13:00' && i.taxaDiaCentavos === 2000));
  assert.equal(r.pacote.totalCentavos, 5 * (17500 + 1000 + 2000) - 4000);
  assert.deepEqual([r.pacote.frequencia, r.pacote.modoAgenda], ['semanal', 'recorrente']);
});

t.teste('recorrente que cai no domingo desloca pro próximo dia atendido; além de 120 dias é recusado', async () => {
  const d = datasDaAgenda({ modo: 'recorrente', primeiraData: '2026-10-01', frequencia: 'mensal', quantidade: 2 }, CFG);
  assert.deepEqual(d.map((x) => [x.data, x.deslocada]), [['2026-10-01', false], ['2026-11-02', true]]); // 01/11 é domingo
  await lancaCodigo(() => cotar(SOL({}, { modo: 'recorrente', datas: undefined, primeiraData: '2026-10-05', frequencia: 'mensal', quantidade: 5 })), 'DATA_INVALIDA');
});

t.teste('sem local pra refeição (+25) e deslocamento de Contagem (+10) entram no valor por diária', () => {
  const r = cotar(SOL({ semLocalAlmoco: true }), { endereco: { cidade: 'Contagem', uf: 'MG' } });
  assert.deepEqual(r.pacote.itensDia.map((i) => i.centavos), [17500, 2500, 1000]);
  assert.equal(r.pacote.totalCentavos, 21000);
});

t.teste('Nova Lima sob consulta e cidade fora não cotam', async () => {
  await lancaCodigo(() => cotar(SOL(), { endereco: { cidade: 'Nova Lima', uf: 'MG' } }), 'REGIAO_SOB_CONSULTA');
  await lancaCodigo(() => cotar(SOL(), { endereco: { cidade: 'Itabira', uf: 'MG' } }), 'REGIAO_NAO_ATENDIDA');
});

t.teste('sobreposição pelo horário real: 08:00-12:00 x 12:00-16:00 não sobrepõe; x 11:30 sobrepõe; turno antigo lido como 08:00/13:00', () => {
  const a = { data: '2026-10-05', horaInicio: '08:00', duracaoMinutos: 240 };
  assert.equal(sobrepoe(a, null, { data: '2026-10-05', horaInicio: '12:00', duracaoMinutos: 240 }, null), false);
  assert.equal(sobrepoe(a, null, { data: '2026-10-05', horaInicio: '11:30', duracaoMinutos: 120 }, null), true);
  assert.equal(sobrepoe(a, null, { data: '2026-10-06', horaInicio: '08:00', duracaoMinutos: 240 }, null), false);
  assert.equal(horaInicioDe({ turno: 'tarde' }), '13:00');
  assert.equal(sobrepoe({ data: '2026-10-05', turno: 'manha' }, { duracaoHoras: 4 }, { data: '2026-10-05', turno: 'tarde' }, { duracaoHoras: 4 }), false);
  assert.equal(rotuloHorario({ horaInicio: '08:30', duracaoMinutos: 360 }), '08:30 às 14:30');
});

await t.fim();
