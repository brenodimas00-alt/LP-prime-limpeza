// Autoagendamento v3 (domínio puro, spec-agendamento-v3 seção 2.5): faixas de metragem e ambientes nos limites, condição,
// passadoria, estouro de 8h, taxas isoladas e combinadas, desconto por quantidade, cupom, desconto especial não cumulativo,
// marco da segunda metade (par, ímpar, remarcação), horários permitidos. Totais conferidos à mão.
import { criarSuite, assert, lancaCodigo } from './lib-teste.mjs';
import {
  recomendarDuracao, validarCaracteristicas, horariosPermitidos, opcoesHoraMinuto, cotarV3, descontoQuantidade, marcoSegundaMetade,
  calcularParcelas, regiaoV3, avaliarCupom, totalAmbientes, ambientesPonderados,
} from '../src/domain/agendamento-v3.js';
import { CONFIG_PRECOS } from '../src/config/precos.js';

const CFG = structuredClone(CONFIG_PRECOS);
const t = criarSuite('agendamento v3 (domínio)');
const HOJE = '2026-10-06'; // terça
const BH = { cep: '30140071', cidade: 'Belo Horizonte', uf: 'MG' };
const AMB = (n) => ({ quartos: n, banheiros: 0, salas: 0, cozinhas: 0, areaExterna: 0 });
const SEM_ANIMAIS = { tem: false };
const RES = (metragem, ambientes = AMB(1), extra = {}) => ({ metragem, ambientes, animais: SEM_ANIMAIS, ...extra });
const rec = (servico, car, seg = 'residencial') => recomendarDuracao(servico, car, seg, CFG).horas;
// terça 13/10 (sem taxa), sábado 17/10, feriado 12/10 (segunda), sábado feriado 15/11/2026 é domingo: usar 02/11 (segunda feriado)
const AT = (extra = {}) => ({
  servico: 'residencial', caracteristicas: RES(45, AMB(2)), duracaoHoras: 4, data: '2026-10-13', horaInicio: '08:00',
  endereco: BH, localRefeicao: true, ...extra,
});
const PED = (atendimentos, extra = {}) => ({ segmento: 'residencial', modalidade: 'avulsa', atendimentos, ...extra });
const cotar = (p, ctx = {}, cfg = CFG) => cotarV3(p, { hoje: HOJE, ...ctx }, cfg);
// diária de 4h = 17500
const D4 = 17500;

t.teste('metragem nos limites (tabela 2): 30->2h, 31->4h, 50->4h, 51->6h, 70->6h, 71->8h, 110->8h, 300->8h', () => {
  assert.deepEqual([30, 31, 50, 51, 70, 71, 110, 300].map((m) => rec('residencial', RES(m))), [2, 4, 4, 6, 6, 8, 8, 8]);
});

t.teste('ambientes nos limites: 3->mantém 2h, 4 em 30 m² sobe uma faixa (4h), 10 em 30 m² sobe só uma (4h)', () => {
  assert.equal(rec('residencial', RES(30, AMB(3))), 2);
  assert.equal(rec('residencial', RES(30, AMB(4))), 4);
  assert.equal(rec('residencial', RES(30, AMB(10))), 4);
  assert.equal(rec('residencial', RES(50, AMB(5))), 4);
  assert.equal(rec('residencial', RES(50, AMB(6))), 6);
  assert.equal(rec('residencial', RES(70, AMB(7))), 6);
  assert.equal(rec('residencial', RES(70, AMB(8))), 8);
  assert.equal(rec('residencial', RES(110, AMB(10))), 8);
});

t.teste('banheiros e cozinhas pesam 1,5: 2 banheiros + 1 cozinha = 4,5 ambientes em 50 m² fica em 4h; com 1 quarto (5,5) sobe pra 6h', () => {
  assert.equal(ambientesPonderados({ banheiros: 2, cozinhas: 1 }, CFG), 4.5);
  assert.equal(totalAmbientes({ banheiros: 2, cozinhas: 1 }, CFG), 3);
  assert.equal(rec('residencial', RES(50, { banheiros: 2, cozinhas: 1 })), 4);
  assert.equal(rec('residencial', RES(50, { banheiros: 2, cozinhas: 1, quartos: 1 })), 6);
});

t.teste('110 m² com ambientes muito acima: estoura 8h e orienta mais de uma profissional; aviso de 120 m² só acima de 120', () => {
  const r = recomendarDuracao('residencial', RES(110, AMB(11)), 'residencial', CFG);
  assert.deepEqual(r, { horas: null, excedente: true, orientacao: 'mais_profissionais', avisoMetragem: false });
  assert.equal(recomendarDuracao('residencial', RES(120), 'residencial', CFG).avisoMetragem, false);
  assert.equal(recomendarDuracao('residencial', RES(121), 'residencial', CFG).avisoMetragem, true);
});

t.teste('mudança: base 4h + leve 4h, moderada 6h, intensa 8h; base 6h intensa estoura (mais de uma profissional); mobiliado não soma', () => {
  const m = (condicao, metragem = 45, mobiliado = 'vazio') => recomendarDuracao('pre_pos_mudanca', RES(metragem, AMB(2), { mobiliado, condicao }), 'residencial', CFG);
  assert.deepEqual(['leve', 'moderada', 'intensa'].map((c) => m(c).horas), [4, 6, 8]);
  assert.equal(m('leve', 45, 'mobiliado').horas, 4);
  assert.equal(m('intensa', 60).orientacao, 'mais_profissionais');
});

t.teste('eventos: antes = metragem + ambientes totais (sem peso); após soma a condição (leve 0, moderado +1, intenso +2)', () => {
  const ev = (momento, condicao, ambientesTotal = 4, metragem = 45) => rec('pre_pos_evento', { metragem, ambientesTotal, momento, condicao, animais: SEM_ANIMAIS });
  assert.equal(ev('antes'), 4);
  assert.equal(ev('antes', 'intenso'), 4); // condição só vale depois
  assert.deepEqual(['leve', 'moderado', 'intenso'].map((c) => ev('depois', c)), [4, 6, 8]);
  assert.equal(ev('antes', null, 6, 45), 6);
  assert.equal(recomendarDuracao('pre_pos_evento', { metragem: 200, ambientesTotal: 8, momento: 'depois', condicao: 'moderado', animais: SEM_ANIMAIS }, 'residencial', CFG).excedente, true);
});

t.teste('passadoria (tabela 1): 15->2h, 16->4h, 25->4h, 26->6h, 40->6h, 41->8h, 60->8h, 61->dividir em diárias', () => {
  const p = (pecas, tipoPecas = 'basicas') => recomendarDuracao('passadoria', { pecas, tipoPecas, animais: SEM_ANIMAIS }, 'residencial', CFG);
  assert.deepEqual([15, 16, 25, 26, 40, 41, 60].map((n) => p(n).horas), [2, 4, 4, 6, 6, 8, 8]);
  assert.deepEqual(p(61), { horas: null, excedente: true, orientacao: 'dividir_diarias', avisoMetragem: false });
});

t.teste('passadoria com tipos: 20 peças básicas ou mistas 4h; sociais ou delicadas 6h (exemplo do item 10); 50 sociais estoura', () => {
  const p = (tipoPecas, pecas = 20) => recomendarDuracao('passadoria', { pecas, tipoPecas, animais: SEM_ANIMAIS }, 'residencial', CFG);
  assert.deepEqual(['basicas', 'mistas', 'roupas_cama', 'sociais', 'delicadas'].map((x) => p(x).horas), [4, 4, 4, 6, 6]);
  assert.equal(p('sociais', 50).orientacao, 'dividir_diarias');
});

t.teste('características: passadoria não aceita metragem obrigatória; residencial exige metragem, ambiente e animais; outros animais pede qual', () => {
  assert.deepEqual(validarCaracteristicas('passadoria', { pecas: 10, tipoPecas: 'basicas', animais: SEM_ANIMAIS }, CFG), []);
  assert.deepEqual(validarCaracteristicas('residencial', { ambientes: AMB(0), animais: {} }, CFG), ['Metragem deve ser um inteiro entre 10 e 1000 m²', 'Informe pelo menos um ambiente', 'Responda se há animais no local']);
  assert.deepEqual(validarCaracteristicas('residencial', RES(40, AMB(1), { animais: { tem: true, caes: 0, gatos: 0, outros: 1 } }), CFG), ['Informe qual animal']);
  assert.deepEqual(validarCaracteristicas('residencial', RES(40, AMB(1), { animais: { tem: true, caes: 1, gatos: 2, outros: 1, outrosQual: 'Calopsita' } }), CFG), []);
  assert.deepEqual(validarCaracteristicas('pre_pos_mudanca', RES(40), CFG), ['Informe se o imóvel está vazio ou mobiliado', 'Informe a condição atual do imóvel']);
  assert.deepEqual(validarCaracteristicas('pre_pos_evento', { metragem: 40, ambientesTotal: 2, momento: 'depois', animais: SEM_ANIMAIS }, CFG), ['Informe como estará o espaço após o evento']);
});

t.teste('horários permitidos: 2h até 16:30, 4h até 14:30, 6h até 12:30, 8h até 10:30 (às 10 só 00, 15 e 30)', () => {
  const ult = (h) => horariosPermitidos(h, '2026-10-13', CFG).at(-1);
  assert.deepEqual([2, 4, 6, 8].map(ult), ['16:30', '14:30', '12:30', '10:30']);
  assert.equal(horariosPermitidos(8, '2026-10-13', CFG)[0], '08:00');
  const o = opcoesHoraMinuto(8, '2026-10-13', CFG);
  assert.deepEqual(o.horas, ['08', '09', '10']);
  assert.deepEqual(o.minutos['10'], ['00', '15', '30']);
  assert.deepEqual(o.minutos['09'], ['00', '15', '30', '45']);
  assert.equal(horariosPermitidos(2, '2026-10-13', CFG).length, (16 - 8) * 4 + 3);
});

t.teste('sábado com expediente próprio (configurável): fim 13:00 dá 4h até 09:00', () => {
  const c = structuredClone(CFG); c.horariosTrabalho.fimExpedienteSabado = '13:00';
  assert.equal(horariosPermitidos(4, '2026-10-17', c).at(-1), '09:00');
  assert.equal(horariosPermitidos(4, '2026-10-16', c).at(-1), '14:30');
});

t.teste('avulsa simples: diária de 4h em BH, terça, com local para refeição = R$ 175,00 e uma parcela integral', () => {
  const r = cotar(PED([AT()]));
  assert.equal(r.totalCentavos, D4);
  assert.deepEqual(r.descontos, []);
  assert.deepEqual(r.parcelas, [{ parcela: 'integral', marco: 'confirmacao', valorCentavos: D4, venceEm: '2026-10-09', venceAs: '14:00' }]);
});

t.teste('cada taxa isolada: sábado +20, feriado +20, sem refeição +25, deslocamento Betim +15, Nova Lima +20', () => {
  const tot = (a) => cotar(PED([AT(a)])).totalCentavos - D4;
  assert.equal(tot({ data: '2026-10-17' }), 2000);
  assert.equal(tot({ data: '2026-10-12' }), 2000);
  assert.equal(tot({ localRefeicao: false }), 2500);
  assert.equal(tot({ endereco: { cep: '32600000', cidade: 'Betim', uf: 'MG' } }), 1500);
  assert.equal(tot({ endereco: { cep: '34000000', cidade: 'Nova Lima', uf: 'MG' } }), 2000);
});

t.teste('taxas combinadas: feriado + sem refeição + Betim numa diária de 6h = 203 + 20 + 25 + 15 = R$ 263,00 (exemplo do item 49)', () => {
  const r = cotar(PED([AT({ duracaoHoras: 6, caracteristicas: RES(60), data: '2026-11-02', localRefeicao: false, endereco: { cep: '32600000', cidade: 'Betim', uf: 'MG' } })]));
  assert.equal(r.totalCentavos, 26300);
  assert.deepEqual(r.atendimentos[0].itens.map((i) => i.codigo), ['diaria', 'feriado', 'sem_refeicao', 'deslocamento']);
});

t.teste('sábado que é feriado cobra uma taxa só (padrão), ou as duas se configurado', () => {
  const c = structuredClone(CFG); c.feriados = [...c.feriados, '2026-10-17'];
  assert.equal(cotar(PED([AT({ data: '2026-10-17' })]), {}, c).totalCentavos, D4 + 2000);
  c.PRECOS.v3.taxas.acumulaSabadoFeriado = true;
  assert.equal(cotar(PED([AT({ data: '2026-10-17' })]), {}, c).totalCentavos, D4 + 4000);
});

t.teste('Vila da Serra: faixa de CEP vence a cidade (Nova Lima +20 vira +10); fora da faixa continua Nova Lima', () => {
  const c = structuredClone(CFG); c.faixasCep = [{ nome: 'Vila da Serra', cepInicio: '34006000', cepFim: '34006999', taxaCentavos: 1000 }];
  assert.deepEqual(regiaoV3({ cep: '34006-100', cidade: 'Nova Lima', uf: 'MG' }, c), { nome: 'Vila da Serra', taxaCentavos: 1000 });
  assert.deepEqual(regiaoV3({ cep: '34000000', cidade: 'Nova Lima', uf: 'MG' }, c), { nome: 'Nova Lima', taxaCentavos: 2000 });
  assert.equal(regiaoV3({ cep: '01000000', cidade: 'São Paulo', uf: 'SP' }, c), null);
});

t.teste('domingo bloqueado; feriado não bloqueia; região fora da área recusada', async () => {
  await lancaCodigo(() => cotar(PED([AT({ data: '2026-10-18' })])), 'DATA_INVALIDA');
  assert.equal(cotar(PED([AT({ data: '2026-10-12' })])).atendimentos[0].taxas.feriado, 2000);
  await lancaCodigo(() => cotar(PED([AT({ endereco: { cep: '01000000', cidade: 'São Paulo', uf: 'SP' } })])), 'REGIAO_NAO_ATENDIDA');
});

t.teste('desconto por quantidade: 2 sem, 3 e 4 R$ 20, 5 R$ 40 (pacote e multi); avulsa nunca', () => {
  assert.deepEqual([2, 3, 4, 5, 13].map((n) => descontoQuantidade('pacote', n, CFG)), [0, 2000, 2000, 4000, 4000]);
  assert.equal(descontoQuantidade('multi_profissional', 3, CFG), 2000);
  assert.equal(descontoQuantidade('avulsa', 5, CFG), 0);
});

const datasTer = ['2026-10-13', '2026-10-20', '2026-10-27', '2026-11-03', '2026-11-10'];
const pacote = (n, extra = {}) => PED(datasTer.slice(0, n).map((data) => AT({ data })), { modalidade: 'pacote', frequencia: 'semanal', ...extra });

t.teste('pacote 4 diárias (exemplo do item 49 com 4 × 175): 700 − 20 = 680; desconto uma vez sobre o total', () => {
  const r = cotar(pacote(4));
  assert.equal(r.subtotalCentavos, 4 * D4);
  assert.deepEqual(r.descontos, [{ codigo: 'quantidade', descricao: 'Desconto do pacote', centavos: 2000 }]);
  assert.equal(r.totalCentavos, 4 * D4 - 2000);
});

t.teste('pacote com 3 endereços: desconto pelo total de diárias e deslocamento por diária/endereço', () => {
  const ends = [BH, { cep: '32600000', cidade: 'Betim', uf: 'MG' }, { cep: '32000000', cidade: 'Contagem', uf: 'MG' }];
  const p = PED(datasTer.map((data, i) => AT({ data, endereco: ends[i % 3] })), { modalidade: 'pacote', frequencia: 'semanal' });
  const r = cotar(p);
  assert.equal(r.subtotalCentavos, 5 * D4 + 1500 * 2 + 1000);
  assert.equal(r.descontoCentavos, 4000);
});

t.teste('multi-profissional: 3 profissionais no mesmo dia, serviços e endereços diferentes, desconto R$ 20; datas diferentes recusadas', async () => {
  const p = PED([
    AT(), AT({ servico: 'passadoria', caracteristicas: undefined, horaInicio: '10:00', endereco: { cep: '32000000', cidade: 'Contagem', uf: 'MG' } }),
    AT({ duracaoHoras: 8, caracteristicas: undefined, horaInicio: '08:30' }),
  ], { modalidade: 'multi_profissional' });
  const r = cotar(p);
  assert.equal(r.subtotalCentavos, D4 + D4 + 1000 + 22000);
  assert.equal(r.descontoCentavos, 2000);
  assert.equal(r.parcelas[0].parcela, 'integral');
  p.atendimentos[2].data = '2026-10-14';
  await lancaCodigo(() => cotar(p), 'DADOS_INVALIDOS');
});

const CUPOM = (extra = {}) => ({ codigo: 'PRIME10', tipo: 'percentual', valor: 10, modalidades: [], primeiraContratacao: false, validoAte: null, ativo: true, esgotado: false, acumula: false, ...extra });

t.teste('cupom válido (10%): substitui o desconto do pacote (não cumulativo); cumulativo soma os dois', () => {
  const r = cotar({ ...pacote(4), cupom: 'prime10' }, { cupom: CUPOM() });
  assert.deepEqual(r.descontos.map((d) => [d.codigo, d.centavos]), [['cupom', 7000]]);
  assert.equal(r.cupom.aplicado, true);
  const r2 = cotar({ ...pacote(4), cupom: 'PRIME10' }, { cupom: CUPOM({ acumula: true }) });
  assert.deepEqual(r2.descontos.map((d) => [d.codigo, d.centavos]), [['quantidade', 2000], ['cupom', 7000]]);
});

t.teste('cupom inválido, vencido, esgotado, de outra modalidade ou de primeira contratação pra quem já contratou: não aplica', () => {
  const base = { ...pacote(4), cupom: 'X' };
  assert.equal(cotar(base, { cupom: null }).cupom.motivo, 'inexistente');
  assert.equal(cotar(base, { cupom: CUPOM({ validoAte: '2026-10-05' }) }).cupom.motivo, 'vencido');
  assert.equal(cotar(base, { cupom: CUPOM({ esgotado: true }) }).cupom.motivo, 'esgotado');
  assert.equal(cotar(base, { cupom: CUPOM({ modalidades: ['avulsa'] }) }).cupom.motivo, 'modalidade');
  assert.equal(cotar(base, { cupom: CUPOM({ primeiraContratacao: true }), primeiraContratacao: false }).cupom.motivo, 'primeira_contratacao');
  assert.equal(cotar(base, { cupom: null }).totalCentavos, 4 * D4 - 2000); // segue com o desconto normal
});

t.teste('cupom de primeira contratação: aplicado uma vez sobre a unidade elegível (1ª diária), não multiplicado', () => {
  const r = cotar({ ...pacote(4), cupom: 'BEMVINDA' }, { cupom: CUPOM({ codigo: 'BEMVINDA', primeiraContratacao: true, tipo: 'percentual', valor: 20 }), primeiraContratacao: true });
  assert.deepEqual(r.descontos, [{ codigo: 'cupom', descricao: 'Cupom BEMVINDA', centavos: 3500 }]);
  const r2 = cotar({ ...pacote(2), cupom: 'BEMVINDA' }, { cupom: CUPOM({ codigo: 'BEMVINDA', primeiraContratacao: true, tipo: 'valor', valor: 50000 }), primeiraContratacao: true });
  assert.equal(r2.descontoCentavos, D4);
});

t.teste('cupom de uso único não é consumido na cotação (avaliar não altera o cupom)', () => {
  const c = CUPOM({ limite: 1 });
  const antes = JSON.stringify(c);
  cotar({ ...pacote(3), cupom: 'PRIME10' }, { cupom: c });
  assert.equal(JSON.stringify(c), antes);
  assert.deepEqual(avaliarCupom(c, { modalidade: 'pacote', hoje: HOJE, primeiraContratacao: false }), { ok: true });
});

const ESP = (extra = {}) => ({ tipo: 'valor', valor: 10000, modalidades: [], quantidadeMinima: null, validade: 'recorrente', validoAte: null, acumula: false, consumida: false, ...extra });

t.teste('desconto especial não cumulativo (item 44): só ele aparece, sem o do pacote e sem o cupom', () => {
  const r = cotar({ ...pacote(5), cupom: 'PRIME10' }, { cupom: CUPOM(), condicao: ESP() });
  assert.deepEqual(r.descontos, [{ codigo: 'especial', descricao: 'Desconto especial', centavos: 10000 }]);
  assert.equal(r.totalCentavos, 5 * D4 - 10000);
  assert.deepEqual(r.cupom, { codigo: 'PRIME10', aplicado: false, motivo: 'nao_acumula' });
});

t.teste('desconto especial: cumulativo soma; quantidade mínima, modalidade, uso único consumido e período vencido não aplicam', () => {
  assert.equal(cotar(pacote(5), { condicao: ESP({ acumula: true }) }).descontoCentavos, 10000 + 4000);
  assert.equal(cotar(pacote(5), { condicao: ESP({ quantidadeMinima: 8 }) }).descontoCentavos, 4000);
  assert.equal(cotar(pacote(5), { condicao: ESP({ modalidades: ['avulsa'] }) }).descontoCentavos, 4000);
  assert.equal(cotar(pacote(5), { condicao: ESP({ validade: 'uso_unico', consumida: true }) }).descontoCentavos, 4000);
  assert.equal(cotar(pacote(5), { condicao: ESP({ validade: 'periodo', validoAte: '2026-10-01' }) }).descontoCentavos, 4000);
  assert.equal(cotar(pacote(5), { condicao: ESP({ tipo: 'percentual', valor: 10 }) }).descontoCentavos, 8750);
});

t.teste('total nunca negativo: especial maior que o subtotal zera', () => {
  assert.equal(cotar(PED([AT()]), { condicao: ESP({ valor: 999999 }) }).totalCentavos, 0);
});

t.teste('marco da segunda metade: 4 diárias -> 3ª; 5 -> 3ª; 2 -> 2ª; 3 -> 2ª; remarcação muda o marco pela agenda vigente', () => {
  assert.equal(marcoSegundaMetade(datasTer.slice(0, 4)), '2026-10-27');
  assert.equal(marcoSegundaMetade(datasTer), '2026-10-27');
  assert.equal(marcoSegundaMetade(datasTer.slice(0, 2)), '2026-10-20');
  assert.equal(marcoSegundaMetade(datasTer.slice(0, 3)), '2026-10-20');
  // a 2ª diária remarcada pra depois da 3ª: agenda vigente 13, 27, 29/10, 03/11 -> marco 29/10
  assert.equal(marcoSegundaMetade(['2026-10-13', '2026-10-29', '2026-10-27', '2026-11-03']), '2026-10-29');
});

t.teste('parcelas do pacote: 50% (arredonda pra cima no centavo) + o resto; vencimento no dia útil anterior, envio 2 dias antes', () => {
  const p = calcularParcelas({ modalidade: 'pacote', datas: datasTer.slice(0, 4), totalCentavos: 68001 }, CFG);
  assert.deepEqual(p, [
    { parcela: 'metade_1', marco: 'confirmacao', valorCentavos: 34001, venceEm: '2026-10-09', venceAs: '14:00' },
    { parcela: 'metade_2', marco: 'segunda_metade', marcoData: '2026-10-27', valorCentavos: 34000, venceEm: '2026-10-26', venceAs: '14:00', envioEm: '2026-10-24' },
  ]);
  assert.deepEqual(cotar(pacote(4)).parcelas.map((x) => x.valorCentavos), [34000, 34000]);
  // pacote que ficou com uma data só (as outras canceladas): cobrança única, sem 2ª metade
  assert.deepEqual(calcularParcelas({ modalidade: 'pacote', datas: datasTer.slice(0, 1), totalCentavos: 17500 }, CFG),
    [{ parcela: 'integral', marco: 'confirmacao', valorCentavos: 17500, venceEm: '2026-10-09', venceAs: '14:00' }]);
});

t.teste('faturamento empresarial: uma parcela "faturamento" com vencimento pelo prazo acordado', () => {
  const r = cotar(PED([AT({ servico: 'empresarial' })], { segmento: 'empresa' }), { faturamento: { prazoDias: 15 } });
  assert.deepEqual(r.parcelas, [{ parcela: 'faturamento', marco: 'confirmacao', valorCentavos: D4 + 1000, venceEm: '2026-10-28', venceAs: null }]);
});

t.teste('duração menor que a sugerida exige o "Estou ciente"; maior não; justificativa fica no atendimento', async () => {
  const menor = AT({ caracteristicas: RES(80, AMB(2)), duracaoHoras: 4 });
  await lancaCodigo(() => cotar(PED([menor])), 'DATA_INVALIDA');
  assert.equal(cotar(PED([{ ...menor, cienteDuracaoMenor: true, justificativa: 'Só 3 cômodos' }])).atendimentos[0].duracaoRecomendadaHoras, 8);
  assert.equal(cotar(PED([AT({ duracaoHoras: 8 })])).totalCentavos, 22000);
});

t.teste('horário fora do permitido recusado (8h às 10:45); 2h só até 30 m²', async () => {
  await lancaCodigo(() => cotar(PED([AT({ duracaoHoras: 8, horaInicio: '10:45', cienteDuracaoMenor: true })])), 'DATA_INVALIDA');
  await lancaCodigo(() => cotar(PED([AT({ duracaoHoras: 2, cienteDuracaoMenor: true })])), 'DADOS_INVALIDOS');
  assert.equal(cotar(PED([AT({ duracaoHoras: 2, caracteristicas: RES(30) })])).totalCentavos, 13800);
});

await t.fim();
