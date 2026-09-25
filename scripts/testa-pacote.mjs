// E3: calcularPacote + gerarAtendimentos + calcularCobrancas com a TABELA OFICIAL da Prime (23/09/2026) e o pagamento
// antecipado e integral (24/09/2026). Totais conferidos à mão.
import { criarSuite, assert, lancaCodigo } from './lib-teste.mjs';
import { calcularPacote, gerarAtendimentos, calcularCobrancas, recomendarDuracao, recomendarPassadoria, calcularDescontosMensais } from '../src/domain/pacote.js';
import { CONFIG_PRECOS as CFG } from '../src/config/precos.js';

const t = criarSuite('pacote (E3, tabela oficial)');
const BH = { cidade: 'Belo Horizonte', uf: 'MG' };
const HOJE = '2026-10-01'; // quinta
const RES = (extra) => ({ tipoCliente: 'residencial', tipoServico: 'residencial', duracaoHoras: 4, metragem: 45, quantidadeDiarias: 1, frequencia: 'avulso', endereco: BH, ...extra });
const gerar = (p, extra) => gerarAtendimentos(p, { primeiraData: '2026-10-05', turno: 'manha', hoje: HOJE, endereco: BH, ...extra }, CFG);

t.teste('1. 4h residencial em BH: R$ 175,00, pagos antecipados e inteiros até 14h do dia útil anterior', () => {
  const p = calcularPacote(RES(), CFG);
  assert.deepEqual(p.itensDia.map((i) => [i.codigo, i.centavos]), [['diaria', 17500]]);
  const r = gerar(p);
  assert.equal(r.pacote.totalCentavos, 17500);
  assert.equal(r.pacote.modoPagamento, 'por_diaria');
  assert.equal('entradaCentavos' in r.pacote || 'restanteCentavos' in r.pacote, false, 'sem 50/50');
  assert.deepEqual(r.cobrancas, [{ parcela: 'diaria', sequencia: 1, valorCentavos: 17500, descontoCentavos: 0, venceEm: '2026-10-02', venceAs: '14:00' }]); // seg 05 -> sex 02
});

t.teste('2. 6h condominial em Contagem num sábado: 203 + 10 + 10 + 20 = R$ 243,00', () => {
  const end = { cidade: 'Contagem', uf: 'MG' };
  const p = calcularPacote(RES({ tipoServico: 'condominial', duracaoHoras: 6, metragem: 80, endereco: end }), CFG);
  assert.deepEqual(p.itensDia.map((i) => i.centavos), [20300, 1000, 1000]);
  const r = gerar(p, { primeiraData: '2026-10-10', endereco: end }); // sábado
  assert.equal(r.itens[0].taxaDiaCentavos, 2000);
  assert.equal(r.itens[0].valorDiaCentavos, 24300);
  assert.equal(r.pacote.totalCentavos, 24300); assert.equal(r.cobrancas[0].valorCentavos, 24300);
});

t.teste('3. 8h pós-mudança em Betim sem local pro almoço: 220 + 20 + 25 + 15 = R$ 280,00', () => {
  const end = { cidade: 'Betim', uf: 'MG' };
  const p = calcularPacote(RES({ tipoServico: 'pre_pos_mudanca', duracaoHoras: 8, metragem: 110, semLocalAlmoco: true, endereco: end }), CFG);
  assert.deepEqual(p.itensDia.map((i) => [i.codigo, i.centavos]), [['diaria', 22000], ['servico:pre_pos_mudanca', 2000], ['sem_local_almoco', 2500], ['deslocamento', 1500]]);
  const r = gerar(p, { turno: 'integral', endereco: end });
  assert.equal(r.pacote.totalCentavos, 28000); assert.equal(r.cobrancas[0].valorCentavos, 28000);
});

t.teste('4. 4h + passadoria combinada: 175 + 55 = R$ 230,00', () => {
  const p = calcularPacote(RES({ passadoriaCombinada: true }), CFG);
  assert.equal(p.valorDiaBaseCentavos, 23000);
  assert.equal(gerar(p).pacote.totalCentavos, 23000);
});

t.teste('5. 5 diárias semanais no mesmo mês: 5 × 175 = 875, desconto R$ 40 = R$ 835,00', () => {
  const p = calcularPacote(RES({ quantidadeDiarias: 5, frequencia: 'semanal' }), CFG);
  const r = gerar(p, { primeiraData: '2026-10-02' }); // sex 02, 09, 16, 23, 30 de outubro
  assert.deepEqual(r.itens.map((i) => i.data), ['2026-10-02', '2026-10-09', '2026-10-16', '2026-10-23', '2026-10-30']);
  assert.deepEqual(r.descontos, [{ mes: '2026-10', diarias: 5, centavos: 4000 }]);
  assert.equal(r.pacote.totalCentavos, 83500);
  // cada diária paga inteira; o desconto do mês (sobre o total) entra inteiro na cobrança da última diária do mês
  assert.deepEqual(r.cobrancas.map((c) => c.valorCentavos), [17500, 17500, 17500, 17500, 13500]);
  assert.equal(r.cobrancas.reduce((a, c) => a + c.valorCentavos, 0), r.pacote.totalCentavos);
});

t.teste('5b. desconto por mês de calendário: 3 em outubro (-20) + 1 em novembro (0)', () => {
  const p = calcularPacote(RES({ quantidadeDiarias: 4, frequencia: 'semanal' }), CFG);
  const r = gerar(p, { primeiraData: '2026-10-15' }); // 15, 22, 29/10 e 05/11
  assert.deepEqual(r.descontos, [{ mes: '2026-10', diarias: 3, centavos: 2000 }]);
  assert.equal(r.pacote.totalCentavos, 4 * 17500 - 2000);
  assert.deepEqual(calcularDescontosMensais(['2026-10-22', '2026-10-29', '2026-11-05', '2026-11-12'], CFG), []);
});

t.teste('6. 2h em 45 m²: bloqueado; 2h em 30 m²: R$ 138,00', async () => {
  const e = await lancaCodigo(() => calcularPacote(RES({ duracaoHoras: 2, metragem: 45 }), CFG), 'DADOS_INVALIDOS');
  assert.match(e.message, /2 horas é só para locais até 30/);
  assert.equal(calcularPacote(RES({ duracaoHoras: 2, metragem: 30 }), CFG).valorDiaBaseCentavos, 13800);
});

t.teste('7. Nova Lima: sob consulta (não calcula, leva pro WhatsApp)', async () => {
  await lancaCodigo(() => calcularPacote(RES({ endereco: { cidade: 'Nova Lima', uf: 'MG' } }), CFG), 'REGIAO_SOB_CONSULTA');
  await lancaCodigo(() => calcularPacote(RES({ endereco: { cidade: 'Lagoa Santa', uf: 'MG' } }), CFG), 'REGIAO_NAO_ATENDIDA');
});

t.teste('8. pós-obra: não oferecido', async () => {
  const e = await lancaCodigo(() => calcularPacote(RES({ tipoServico: 'pos_obra' }), CFG), 'DADOS_INVALIDOS');
  assert.match(e.message, /não realizamos limpeza pós-obra/);
});

t.teste('9. hora extra: 4h + 2 extras = 175 + 60 = R$ 235,00; máximo 4', async () => {
  assert.equal(calcularPacote(RES({ horasExtras: 2 }), CFG).valorDiaBaseCentavos, 23500);
  await lancaCodigo(() => calcularPacote(RES({ horasExtras: 5 }), CFG), 'DADOS_INVALIDOS');
});

t.teste('10. feriado (12/10) cobra taxa como sábado; domingo continua bloqueado', async () => {
  const p = calcularPacote(RES({ quantidadeDiarias: 2, frequencia: 'semanal' }), CFG);
  const r = gerar(p, { primeiraData: '2026-10-05' }); // 05/10 e 12/10 (feriado)
  assert.deepEqual(r.itens.map((i) => i.taxaDiaCentavos), [0, 2000]);
  assert.equal(r.pacote.totalCentavos, 17500 + 19500);
  await lancaCodigo(() => gerar(calcularPacote(RES(), CFG), { primeiraData: '2026-10-04' }), 'DATA_INVALIDA');
});

t.teste('11. recomendação de duração pela metragem e pelo volume de peças', () => {
  assert.equal(recomendarDuracao(50, CFG), 4); assert.equal(recomendarDuracao(80, CFG), 6); assert.equal(recomendarDuracao(120, CFG), 8); assert.equal(recomendarDuracao(121, CFG), null);
  assert.equal(recomendarPassadoria(15, CFG), 2); assert.equal(recomendarPassadoria(25, CFG), 4); assert.equal(recomendarPassadoria(40, CFG), 6); assert.equal(recomendarPassadoria(60, CFG), 8); assert.equal(recomendarPassadoria(90, CFG), 8);
  assert.equal(calcularPacote(RES({ metragem: 70 }), CFG).recomendacaoHoras, 6);
});

t.teste('12. passadoria exclusiva: mesma tabela de horas, sem metragem, sem combinar', async () => {
  const p = calcularPacote(RES({ tipoServico: 'passadoria', duracaoHoras: 4, metragem: undefined, pecas: 20 }), CFG);
  assert.equal(p.valorDiaBaseCentavos, 17500); assert.equal(p.recomendacaoHoras, 4); assert.equal(p.pecas, 20);
  await lancaCodigo(() => calcularPacote(RES({ tipoServico: 'passadoria', metragem: undefined, passadoriaCombinada: true }), CFG), 'DADOS_INVALIDOS');
});

t.teste('13. centavo ímpar: diária de R$ 100,01 é cobrada inteira, sem dividir', () => {
  const cfg = { ...CFG, PRECOS: { ...CFG.PRECOS, duracoes: { ...CFG.PRECOS.duracoes, 4: { centavos: 10001 } } } };
  const r = gerarAtendimentos(calcularPacote(RES(), cfg), { primeiraData: '2026-10-05', turno: 'manha', hoje: HOJE, endereco: BH }, cfg);
  assert.equal(r.cobrancas.length, 1); assert.equal(r.cobrancas[0].valorCentavos, 10001);
});

t.teste('14. prazo: cada cobrança vence até 14h do dia útil anterior à diária (pula fim de semana e feriado)', () => {
  const r = gerar(calcularPacote(RES({ quantidadeDiarias: 2, frequencia: 'semanal' }), CFG), { primeiraData: '2026-10-05' });
  assert.deepEqual(r.cobrancas.map((c) => [c.venceEm, c.venceAs]), [['2026-10-02', '14:00'], ['2026-10-09', '14:00']]); // seg 05 -> sex 02; seg 12 (feriado) -> sex 09
});

t.teste('15. turno coerente com a duração: 8h é integral; até 6h é manhã ou tarde', async () => {
  await lancaCodigo(() => gerar(calcularPacote(RES({ duracaoHoras: 8, metragem: 100 }), CFG), { turno: 'manha' }), 'DADOS_INVALIDOS');
  await lancaCodigo(() => gerar(calcularPacote(RES(), CFG), { turno: 'integral' }), 'DADOS_INVALIDOS');
});

t.teste('16. regras de quantidade/frequência e empresa', async () => {
  await lancaCodigo(() => calcularPacote(RES({ quantidadeDiarias: 2 }), CFG), 'DADOS_INVALIDOS');
  await lancaCodigo(() => calcularPacote(RES({ quantidadeDiarias: 1, frequencia: 'semanal' }), CFG), 'DADOS_INVALIDOS');
  await lancaCodigo(() => calcularPacote(RES({ tipoCliente: 'empresa' }), CFG), 'DADOS_INVALIDOS');
  await lancaCodigo(() => calcularPacote(RES({ metragem: 5 }), CFG), 'DADOS_INVALIDOS');
  await lancaCodigo(() => calcularPacote(RES({ duracaoHoras: 5 }), CFG), 'DADOS_INVALIDOS');
});

t.teste('17. desconto no TOTAL do mês, nos limites: 2 diárias 0; 3 e 4 diárias R$ 20; 5 diárias R$ 40 (nunca R$ 60)', () => {
  const casos = { 2: 0, 3: 2000, 4: 2000, 5: 4000 };
  for (const [n, desc] of Object.entries(casos)) {
    const r = gerar(calcularPacote(RES({ quantidadeDiarias: Number(n), frequencia: 'semanal' }), CFG), { primeiraData: '2026-10-02' }); // sextas de outubro
    assert.equal(r.pacote.descontoMensalCentavos, desc, `${n} diárias`);
    assert.equal(r.pacote.totalCentavos, Number(n) * 17500 - desc, `${n} diárias: total`);
    assert.deepEqual(r.cobrancas.map((c) => c.descontoCentavos), [...Array(Number(n) - 1).fill(0), desc], `${n} diárias: desconto só na última do mês, não por diária`);
  }
  // faixas não somam dentro do mês (5 diárias = 40, não 20 + 40)
  assert.deepEqual(calcularDescontosMensais(['2026-10-02', '2026-10-09', '2026-10-16', '2026-10-23', '2026-10-30'], CFG).map((d) => d.centavos), [4000]);
});

t.teste('17b. desconto não passa de um mês pro outro nem soma meses diferentes num único mês', () => {
  const r = gerar(calcularPacote(RES({ quantidadeDiarias: 6, frequencia: 'semanal' }), CFG), { primeiraData: '2026-10-16' }); // 16, 23, 30/10 e 06, 13, 20/11
  assert.deepEqual(r.descontos, [{ mes: '2026-10', diarias: 3, centavos: 2000 }, { mes: '2026-11', diarias: 3, centavos: 2000 }]);
  assert.deepEqual(r.cobrancas.map((c) => c.descontoCentavos), [0, 0, 2000, 0, 0, 2000]);
});

t.teste('17c. pacote de uma vez (desligado por padrão): uma cobrança com o total, vencendo antes da primeira diária', () => {
  assert.equal(CFG.pagamento.pacoteDeUmaVez, false);
  const cfg = { ...CFG, pagamento: { ...CFG.pagamento, pacoteDeUmaVez: true } };
  const p = calcularPacote(RES({ quantidadeDiarias: 5, frequencia: 'semanal' }), cfg);
  assert.equal(p.modoPagamento, 'pacote');
  const r = gerarAtendimentos(p, { primeiraData: '2026-10-02', turno: 'manha', hoje: HOJE, endereco: BH }, cfg);
  assert.deepEqual(r.cobrancas, [{ parcela: 'pacote', valorCentavos: 83500, descontoCentavos: 4000, venceEm: '2026-10-01', venceAs: '14:00' }]);
});

t.teste('17d. só diárias ativas contam: com 2 no mês não há desconto', () => {
  const itens = [{ sequencia: 1, data: '2026-10-02', valorDiaCentavos: 17500 }, { sequencia: 3, data: '2026-10-16', valorDiaCentavos: 17500 }];
  assert.deepEqual(calcularCobrancas(itens, 'por_diaria', CFG).map((c) => c.valorCentavos), [17500, 17500]);
});

t.teste('18. GPT#4: mensal a partir de 31/01: clamp em fevereiro e volta pro 31 em março; domingo deslocado', () => {
  const p = calcularPacote(RES({ quantidadeDiarias: 3, frequencia: 'mensal' }), CFG);
  const r = gerar(p, { primeiraData: '2027-01-30', hoje: '2027-01-02' }); // sáb 30/01; 28/02/2027 é domingo -> 01/03; 30/03 terça
  assert.deepEqual(r.itens.map((i) => [i.data, i.deslocada]), [['2027-01-30', false], ['2027-03-01', true], ['2027-03-30', false]]);
  const r2 = gerar(calcularPacote(RES({ quantidadeDiarias: 3, frequencia: 'mensal' }), CFG), { primeiraData: '2026-12-31', hoje: '2026-12-01' });
  assert.deepEqual(r2.itens.map((i) => i.data), ['2026-12-31', '2027-02-01', '2027-03-01']); // 31/01 e 28/02 de 2027 são domingos
});

await t.fim();
