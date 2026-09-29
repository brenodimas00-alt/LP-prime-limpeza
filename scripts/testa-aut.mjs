// AUT.6: motor de automações v2 com relógio simulado (memória, sem banco): catálogo, horários, regras globais,
// cancelamento, remarcação, idempotência, revalidação, variável faltando, retentativa e fallback, resultado incerto.
// O mesmo motor roda no worker (Postgres): scripts/testa-aut-homolog.mjs cobre concorrência e persistência lá.
// Uso: node scripts/testa-aut.mjs
import { criarSuite, assert } from './lib-teste.mjs';
import { montarAmbiente } from './ambiente.mjs';
import { agendar, liberarCobranca, levarAteFinalizado, criarDiaristaAprovada, chave, SOL_V2, enderecoV2, VERSAO_CONDICOES_TESTE } from './cenarios.mjs';
import { CLIENTE_RESIDENCIAL, CLIENTE_EMPRESA } from './fixtures/seed.js';
import { REGRAS, TEMPLATES, validarCorpo, paraMeta, VARIAVEIS_PERMITIDAS } from '../src/automacoes/catalogo.js';
import { ajustarJanela, instantesDaAgenda } from '../src/automacoes/v2/tempo.js';
import { renderizar } from '../src/automacoes/v2/variaveis.js';
import { prepararEnvio } from '../src/automacoes/v2/motor.js';
import { PROVEDORES_SIMULADOS } from '../src/automacoes/v2/local.js';
import { CONFIG_PRECOS } from '../src/config/precos.js';
import { dataNoFuso } from '../src/domain/calendario.js';

const t = criarSuite('AUT motor v2 (relógio simulado)');
const PRIME = { ator: 'prime' };
const CFG = { fuso: 'America/Sao_Paulo', silencioInicio: '20:00', silencioFim: '08:00', horaDiaUtil: '09:00' };
const SP = (data, hora) => new Date(`${data}T${hora}:00-03:00`).toISOString(); // Brasil sem horário de verão
const AVULSO = { tipoServico: 'residencial', duracaoHoras: 4, metragem: 45, quantidadeDiarias: 1, frequencia: 'avulso' };
// quarta 07/10: prazo do pagamento = terça 06/10 14h; véspera = terça 18h
const QUARTA = '2026-10-07';

function amb(agora = SP('2026-10-01', '09:00'), op = {}) { return montarAmbiente(agora, op); }
const pedir = (a, { data = QUARTA, turno = 'manha', cliente = CLIENTE_RESIDENCIAL, pacote = AVULSO } = {}) => agendar(a.casos, { cliente, pacote, primeiraData: data, turno }, chave('ped'));
async function execs(a, regra) {
  return a.repo.leitura(null, async (tx) => {
    const es = (await tx.todos('execucoes')).filter((e) => !regra || e.regra === regra);
    const ms = await tx.todos('mensagens');
    return es.map((e) => ({ ...e, mensagens: ms.filter((m) => m.execucaoId === e.id) })).sort((x, y) => x.agendadaPara.localeCompare(y.agendadaPara));
  });
}
async function irPara(a, iso) { a.relogio.irPara(iso); return a.motor.tique(); }

// ------------------------------------------------------------------ catálogo
t.teste('catálogo: 36 regras (C01-C16, M01-M03, D01-D08, I01-I09), cada uma com template válido; marketing nasce desligada', () => {
  const codigos = REGRAS.map((r) => r.codigo);
  for (const c of ['C01', 'C04', 'C06', 'C11', 'C14', 'C15', 'M01', 'M02', 'M03', 'D01', 'D04', 'D06', 'D07', 'D08', 'I01', 'I03', 'I04', 'I06', 'I07', 'I08']) assert.ok(codigos.includes(c), c);
  assert.equal(new Set(codigos).size, codigos.length, 'código repetido');
  for (const r of REGRAS) {
    const tpl = TEMPLATES[r.template];
    assert.ok(tpl, `${r.codigo} sem template`);
    assert.deepEqual(validarCorpo(r.template, tpl.corpo, tpl.categoriaMeta ? 'whatsapp' : 'painel'), [], r.codigo);
    assert.ok(renderizar(tpl.corpo, tpl.exemplo), `${r.codigo} não renderiza com o exemplo`);
    if (r.categoria === 'marketing') { assert.equal(r.ligada, false, `${r.codigo} deveria nascer desligada`); assert.equal(tpl.categoriaMeta, 'MARKETING'); }
    if (r.destinatario === 'equipe_prime') assert.deepEqual(r.canais, ['painel']);
    else if (r.categoria !== 'marketing') assert.equal(r.canais.at(-1), r.codigo === 'C16' ? 'email' : 'painel', `${r.codigo}: último canal é o painel`);
  }
  assert.deepEqual(paraMeta('Oi, {{nome}}! Até {{data}}, {{nome}}.'), { texto: 'Oi, {{1}}! Até {{2}}, {{1}}.', ordem: ['nome', 'data'] });
  assert.deepEqual(validarCorpo('lembrete_vespera', 'Oi {{cpf}} tudo bem por aí?'), ['variável não permitida: {{cpf}}']);
  assert.ok(VARIAVEIS_PERMITIDAS.lembrete_vespera.includes('quando'));
});

// ------------------------------------------------------------------ tempo e janelas
t.teste('janela: silêncio 20h-8h, domingo e feriado vão pro próximo dia livre 9h; interno e atendimento do dia saem na hora', () => {
  const fer = ['2026-10-12'];
  assert.equal(ajustarJanela(SP('2026-10-06', '21:30'), { categoria: 'lembrete' }, CFG, fer), SP('2026-10-07', '08:00'));
  assert.equal(ajustarJanela(SP('2026-10-07', '06:10'), { categoria: 'atendimento' }, CFG, fer), SP('2026-10-07', '08:00'));
  assert.equal(ajustarJanela(SP('2026-10-04', '10:00'), { categoria: 'marketing' }, CFG, fer), SP('2026-10-05', '09:00'), 'domingo -> segunda 9h');
  assert.equal(ajustarJanela(SP('2026-10-10', '21:00'), { categoria: 'lembrete' }, CFG, fer), SP('2026-10-13', '09:00'), 'sábado 21h -> (domingo, feriado seg 12/10) -> terça 9h');
  assert.equal(ajustarJanela(SP('2026-10-04', '23:00'), { categoria: 'interno' }, CFG, fer), SP('2026-10-04', '23:00'));
  assert.equal(ajustarJanela(SP('2026-10-04', '22:00'), { categoria: 'atendimento', doDia: true }, CFG, fer), SP('2026-10-04', '22:00'));
});

t.teste('horários da agenda: véspera 18h, prazo 24h e 3h antes, check-in +30 min, marcos distintos', () => {
  const [v] = instantesDaAgenda({ tipo: 'vespera', hora: '18:00' }, { atendimento: { data: QUARTA, turno: 'tarde' } }, CFG);
  assert.deepEqual([v.em, v.validaAte, v.marco], [SP('2026-10-06', '18:00'), SP(QUARTA, '13:00'), `${QUARTA}:13:00`]); // diária antiga: hora do turno
  // v2: hora exata e duração da diária
  const [v2] = instantesDaAgenda({ tipo: 'vespera', hora: '18:00' }, { atendimento: { data: QUARTA, horaInicio: '09:30', duracaoMinutos: 360 } }, CFG);
  assert.deepEqual([v2.validaAte, v2.marco], [SP(QUARTA, '09:30'), `${QUARTA}:09:30`]);
  const [c2] = instantesDaAgenda({ tipo: 'apos_inicio_turno', minutos: 30 }, { atendimento: { data: QUARTA, horaInicio: '09:30', duracaoMinutos: 360 } }, CFG);
  assert.deepEqual([c2.em, c2.validaAte], [SP(QUARTA, '10:00'), SP(QUARTA, '15:30')]);
  const p = instantesDaAgenda({ tipo: 'antes_prazo', minutos: [1440, 180] }, { pagamento: { venceEm: '2026-10-06', venceAs: '14:00' } }, CFG);
  assert.deepEqual(p.map((x) => x.em), [SP('2026-10-05', '14:00'), SP('2026-10-06', '11:00')]);
  assert.notEqual(p[0].marco, p[1].marco);
  const [c] = instantesDaAgenda({ tipo: 'apos_inicio_turno', minutos: 30 }, { atendimento: { data: QUARTA, turno: 'manha' } }, CFG);
  assert.equal(c.em, SP(QUARTA, '08:30'));
});

// ------------------------------------------------------------------ fluxo e idempotência
t.teste('C01 e I01 na hora ao solicitar; evento repetido não duplica (chave regra:entidade:id:marco)', async () => {
  const a = amb();
  const r = await pedir(a);
  const c01 = await execs(a, 'C01'); const i01 = await execs(a, 'I01');
  assert.equal(c01.length, 1); assert.equal(c01[0].estado, 'enviada');
  assert.deepEqual([c01[0].mensagens[0].canal, c01[0].mensagens[0].estado], ['whatsapp', 'simulada']);
  assert.match(c01[0].mensagens[0].conteudo, /Oi, Ana! Recebemos sua solicitação/);
  assert.deepEqual([i01[0].mensagens[0].canal, i01[0].estado], ['painel', 'enviada']);
  // reprocessa o MESMO evento
  await a.repo.transacao(null, async (tx) => { for (const e of await tx.todos('eventos')) if (e.refs?.pedidoId === r.pedido.id) await tx.put('eventos', { ...e, status: 'pendente' }); });
  await a.motor.tique();
  assert.equal((await execs(a, 'C01')).length, 1, 'evento repetido não cria outra');
  assert.equal((await execs(a, 'C01'))[0].mensagens.length, 1, 'nem outra mensagem');
});

t.teste('C02 e C04: disponibilidade avisa com valor total e link; lembrete 24h e 3h antes do prazo; pagar cancela o que falta', async () => {
  const a = amb();
  const r = await pedir(a);
  await liberarCobranca(a.casos, r);
  const c02 = await execs(a, 'C02');
  assert.equal(c02[0].estado, 'enviada'); assert.match(c02[0].mensagens[0].conteudo, /valor total é R\$ 175,00/);
  assert.equal((await execs(a, 'C04')).length, 0, 'lembretes com data nascem da varredura (horizonte de 2 dias)');
  await irPara(a, SP('2026-10-04', '09:00'));
  let c04 = await execs(a, 'C04');
  assert.deepEqual(c04.map((e) => e.agendadaPara), [SP('2026-10-05', '14:00'), SP('2026-10-06', '11:00')]);
  await irPara(a, SP('2026-10-05', '14:01'));
  c04 = await execs(a, 'C04');
  assert.deepEqual(c04.map((e) => e.estado), ['enviada', 'agendada']);
  assert.match(c04[0].mensagens[0].conteudo, /vence 14h de ter, 06\/10/);
  const [g] = (await a.casos.obterPedido(r.pedido.id, { sessao: PRIME })).pagamentos;
  await a.casos.confirmarPagamento(g.id, { sessao: PRIME, chave: chave('conf') });
  c04 = await execs(a, 'C04');
  assert.deepEqual([c04[1].estado, c04[1].motivo], ['cancelada', 'cancelada por pagamento_confirmado']);
  assert.equal((await execs(a, 'C05'))[0].estado, 'enviada');
});

t.teste('C06 e D05: véspera 18h (cliente) e 17h (profissional); remarcação cancela os antigos e recria na data nova', async () => {
  const a = amb();
  const r = await pedir(a);
  const dia = await criarDiaristaAprovada(a.casos);
  await liberarCobranca(a.casos, r);
  const [g] = (await a.casos.obterPedido(r.pedido.id, { sessao: PRIME })).pagamentos;
  await a.casos.confirmarPagamento(g.id, { sessao: PRIME, chave: chave('conf') });
  await a.casos.atribuirDiarista(r.atendimentos[0].id, { diaristaId: dia }, { sessao: PRIME, chave: chave('atr') });
  await irPara(a, SP('2026-10-05', '09:00'));
  assert.deepEqual((await execs(a, 'C06')).map((e) => [e.agendadaPara, e.estado]), [[SP('2026-10-06', '18:00'), 'agendada']]);
  assert.deepEqual((await execs(a, 'D05')).map((e) => e.agendadaPara), [SP('2026-10-06', '17:00')]);
  assert.equal((await execs(a, 'D04'))[0].estado, 'enviada', 'D04 com endereço (confirmado)');
  assert.match((await execs(a, 'D04'))[0].mensagens[0].conteudo, /Endereço: Rua Fictícia, 100 apto 201, Savassi/);
  // remarca pra quinta 08/10
  await a.casos.transicionarAtendimento(r.atendimentos[0].id, { evento: 'reagendar', dados: { data: '2026-10-08', turno: 'manha' } }, { sessao: PRIME, chave: chave('rem') });
  await irPara(a, SP('2026-10-06', '09:00'));
  const c06 = await execs(a, 'C06');
  assert.deepEqual(c06.map((e) => [e.marco, e.estado, e.motivo]), [[`${QUARTA}:08:00`, 'cancelada', 'cancelada por atendimento_reagendado'], ['2026-10-08:08:00', 'agendada', null]]);
  assert.equal((await execs(a, 'C12'))[0].estado, 'enviada', 'C12 remarcação');
  await irPara(a, SP('2026-10-07', '18:00'));
  const c06b = await execs(a, 'C06');
  assert.equal(c06b[1].estado, 'enviada'); assert.match(c06b[1].mensagens[0].conteudo, /amanhã, 08\/10\/2026, tem atendimento da Prime das 08:00 às 12:00, com 4 horas.*mangueira/);
});

t.teste('v2: solicitação com hora exata; véspera diz "das 09:30 às 13:30"; remarcar só o horário recria o lembrete no marco novo', async () => {
  const a = amb();
  const marca = chave('v2');
  await a.casos.solicitarAtendimento({ cliente: CLIENTE_RESIDENCIAL, solicitacao: SOL_V2({}, { datas: [QUARTA], horario: '09:30' }), endereco: enderecoV2(marca), aceiteCondicoes: VERSAO_CONDICOES_TESTE, valorEsperadoCentavos: 17500 }, { sessao: { ator: 'publico' }, chave: chave('v2') });
  const ped = (await a.casos.listarPedidos({}, { sessao: PRIME })).itens.find((p) => p.endereco?.complemento === `ap ${marca}`);
  const r = await a.casos.obterPedido(ped.id, { sessao: PRIME });
  await liberarCobranca(a.casos, r);
  const [g] = (await a.casos.obterPedido(ped.id, { sessao: PRIME })).pagamentos;
  await a.casos.confirmarPagamento(g.id, { sessao: PRIME, chave: chave('conf') });
  await irPara(a, SP('2026-10-05', '09:00')); // a varredura agenda a véspera do horário original
  assert.deepEqual((await execs(a, 'C06')).map((e) => [e.marco, e.estado]), [[`${QUARTA}:09:30`, 'agendada']]);
  await a.casos.transicionarAtendimento(r.atendimentos[0].id, { evento: 'reagendar', dados: { data: QUARTA, horaInicio: '14:00' } }, { sessao: PRIME, chave: chave('rem') });
  await irPara(a, SP('2026-10-06', '18:00'));
  const c06 = await execs(a, 'C06');
  assert.deepEqual(c06.map((e) => [e.marco, e.estado]), [[`${QUARTA}:09:30`, 'cancelada'], [`${QUARTA}:14:00`, 'enviada']]);
  assert.match(c06[1].mensagens[0].conteudo, /amanhã, 07\/10\/2026, tem atendimento da Prime das 14:00 às 18:00/);
  assert.match((await execs(a, 'C12'))[0].mensagens[0].conteudo, /remarcado para qua, 07\/10, das 14:00 às 18:00\./);
});

t.teste('horário silencioso: solicitação às 21h manda C01 às 8h do dia seguinte (o interno I01 sai na hora)', async () => {
  const a = amb(SP('2026-10-01', '21:00'));
  await pedir(a);
  const [c01] = await execs(a, 'C01');
  assert.deepEqual([c01.estado, c01.agendadaPara], ['agendada', SP('2026-10-02', '08:00')]);
  assert.equal((await execs(a, 'I01'))[0].estado, 'enviada');
  await irPara(a, SP('2026-10-02', '07:59'));
  assert.equal((await execs(a, 'C01'))[0].estado, 'agendada');
  await irPara(a, SP('2026-10-02', '08:00'));
  assert.equal((await execs(a, 'C01'))[0].estado, 'enviada');
});

t.teste('domingo e feriado: lembrete que cairia no domingo vai pro próximo dia livre às 9h; se passar da validade, não sai (obsoleto)', async () => {
  const a = amb(SP('2026-10-01', '09:00'), { cfg: { ...CONFIG_PRECOS, feriados: [...CONFIG_PRECOS.feriados, '2026-10-13'] } });
  // diária segunda 12/10: véspera = domingo 18h -> segunda 9h > início 8h: não sai
  const r = await pedir(a, { data: '2026-10-12' });
  await liberarCobranca(a.casos, r);
  const [g] = (await a.casos.obterPedido(r.pedido.id, { sessao: PRIME })).pagamentos;
  await a.casos.confirmarPagamento(g.id, { sessao: PRIME, chave: chave('conf') });
  await irPara(a, SP('2026-10-10', '09:00'));
  assert.equal((await execs(a, 'C06')).length, 0, 'véspera de segunda (domingo) não é enviada nem agendada depois da diária');
  // diária quarta 14/10 depois do feriado de terça 13: véspera terça 18h (feriado) -> quarta 9h > 8h: também não sai
  const r2 = await pedir(a, { data: '2026-10-14', turno: 'tarde' });
  await liberarCobranca(a.casos, r2);
  const [g2] = (await a.casos.obterPedido(r2.pedido.id, { sessao: PRIME })).pagamentos;
  await a.casos.confirmarPagamento(g2.id, { sessao: PRIME, chave: chave('conf') });
  await irPara(a, SP('2026-10-13', '10:00'));
  const [v] = await execs(a, 'C06');
  assert.deepEqual([v.agendadaPara, v.estado], [SP('2026-10-14', '09:00'), 'agendada'], 'tarde começa 13h: quarta 9h ainda vale');
});

t.teste('atendimento do dia fura silêncio e domingo: C09 às 21h de domingo sai na hora', async () => {
  const a = amb(SP('2026-10-01', '09:00'));
  const r = await pedir(a, { data: '2026-10-03', turno: 'tarde' }); // sábado
  const dia = await criarDiaristaAprovada(a.casos);
  a.relogio.irPara(SP('2026-10-03', '21:00'));
  await levarAteFinalizado(a.casos, r, dia);
  const c09 = await execs(a, 'C09');
  assert.equal(c09[0].estado, 'enviada');
  const c10 = await execs(a, 'C10');
  assert.equal(c10[0].estado, 'enviada');
});

t.teste('C11: lembrete da pesquisa 24h depois (uma vez); responder a pesquisa cancela', async () => {
  const a = amb();
  const r = await pedir(a, { data: '2026-10-05' });
  const dia = await criarDiaristaAprovada(a.casos);
  a.relogio.irPara(SP('2026-10-05', '15:00'));
  await levarAteFinalizado(a.casos, r, dia);
  let [c11] = await execs(a, 'C11');
  assert.deepEqual([c11.agendadaPara, c11.marco], [SP('2026-10-06', '15:00'), 'unico']);
  await irPara(a, SP('2026-10-06', '15:01'));
  [c11] = await execs(a, 'C11');
  assert.equal(c11.estado, 'enviada');
  assert.match(c11.mensagens[0].conteudo, /atendimento de 05\/10\/2026/);
  // cancelamento pela resposta: segundo atendimento finalizado e avaliado antes das 24h
  const a2 = amb();
  const x = await pedir(a2, { data: '2026-10-05' });
  const d2 = await criarDiaristaAprovada(a2.casos);
  a2.relogio.irPara(SP('2026-10-05', '15:00'));
  await levarAteFinalizado(a2.casos, x, d2);
  await a2.casos.criarAvaliacao(x.atendimentos[0].id, { notas: { pontualidade: 5, qualidade: 5, cuidado: 5, comunicacao: 5 }, comentario: '' }, { sessao: { ator: 'cliente', id: x.cliente.id }, chave: chave('av') });
  const [c] = await execs(a2, 'C11');
  assert.deepEqual([c.estado, c.motivo], ['cancelada', 'cancelada por atendimento_avaliado']);
});

t.teste('revalidação no envio: diária cancelada por fora (sem evento) faz o lembrete cancelar com motivo', async () => {
  const a = amb();
  const r = await pedir(a);
  await liberarCobranca(a.casos, r);
  await irPara(a, SP('2026-10-04', '09:00')); // C04 agendados pela varredura
  await a.repo.transacao(null, async (tx) => { const g = (await tx.por('pagamentos', 'pedidoId', r.pedido.id))[0]; await tx.put('pagamentos', { ...g, status: 'cancelado' }); });
  await irPara(a, SP('2026-10-05', '14:00'));
  const [c04] = await execs(a, 'C04');
  assert.deepEqual([c04.estado, c04.motivo], ['cancelada', 'condição não vale mais: cobrança cancelado']);
  assert.equal(c04.mensagens.length, 0, 'nada enviado');
});

t.teste('variável obrigatória vazia: execução falha com o motivo, nada sai com placeholder, e a equipe recebe I08', async () => {
  const a = amb();
  const r = await pedir(a);
  await liberarCobranca(a.casos, r);
  await irPara(a, SP('2026-10-04', '09:00'));
  await a.repo.transacao(null, async (tx) => { const c = await tx.get('clientes', r.cliente.id); await tx.put('clientes', { ...c, nome: '   ' }); });
  await irPara(a, SP('2026-10-05', '14:00'));
  const [c04] = await execs(a, 'C04');
  assert.deepEqual([c04.estado, c04.motivo, c04.mensagens.length], ['falhou', 'variável obrigatória vazia: nome', 0]);
  await a.motor.tique();
  const i08 = (await execs(a, 'I08')).filter((e) => /C04/.test(e.mensagens[0]?.conteudo));
  assert.equal(i08.length, 1); assert.match(i08[0].mensagens[0].conteudo, /Não foi possível enviar C04 .*: variável obrigatória vazia: nome/);
});

t.teste('limite diário: no máximo 3 lembretes por cliente por dia; o 4º vira ignorada com motivo', async () => {
  const a = amb();
  for (const turno of ['manha', 'tarde']) for (const data of ['2026-10-07', '2026-10-08']) {
    const r = await pedir(a, { data, turno });
    await liberarCobranca(a.casos, r);
  }
  // 4 prazos: 06/10 14h e 07/10 14h; lembretes 3h antes de cada: 06/10 11h (2) e 07/10 11h (2); 24h antes: 05/10 14h (2) e 06/10 14h (2)
  for (const [d, h] of [['2026-10-04', '09:00'], ['2026-10-05', '14:00'], ['2026-10-06', '11:00'], ['2026-10-06', '14:00']]) await irPara(a, SP(d, h));
  const c04 = (await execs(a, 'C04')).filter((e) => dataNoFuso(e.agendadaPara) === '2026-10-06');
  const estados = c04.map((e) => e.estado).sort();
  assert.deepEqual(estados, ['enviada', 'enviada', 'enviada', 'ignorada'], JSON.stringify(c04.map((e) => [e.agendadaPara, e.estado])));
  assert.match(c04.find((e) => e.estado === 'ignorada').motivo, /limite diário de lembrete \(3\)/);
});

t.teste('marketing só com consentimento do canal: sem ele, ignorada; com WhatsApp autorizado, sai só pelo WhatsApp', async () => {
  const regras = REGRAS.map((r) => (r.codigo === 'M03' ? { ...r, ligada: true } : r));
  const consentidos = new Set();
  const a = amb(SP('2026-05-14', '08:00'), { regras, consentimentos: (tit, tipo) => consentidos.has(`${tit.id}:${tipo}`) });
  const r = await pedir(a, { data: '2026-05-20' });
  await irPara(a, SP('2026-05-14', '09:00'));
  let [m03] = await execs(a, 'M03');
  assert.deepEqual([m03.estado, m03.agendadaPara], ['ignorada', SP('2026-05-14', '09:00')]);
  assert.match(m03.motivo, /sem consentimento/);
  consentidos.add(`${r.cliente.id}:marketing_whatsapp`);
  const b = amb(SP('2026-05-14', '08:00'), { regras, consentimentos: (tit, tipo) => tipo === 'marketing_whatsapp' });
  await pedir(b, { data: '2026-05-20' });
  await irPara(b, SP('2026-05-14', '09:00'));
  [m03] = await execs(b, 'M03');
  assert.deepEqual([m03.estado, m03.mensagens.map((m) => m.canal)], ['enviada', ['whatsapp']]);
  assert.match(m03.mensagens[0].conteudo, /Feliz aniversário, Ana!.*responda SAIR/s);
  // limite de 1 marketing por dia: M01 no mesmo dia seria ignorada (coberto pela reserva do limite, mesma função dos lembretes)
});

t.teste('retentativa (1, 5, 15, 60 min) e fallback: WhatsApp fora do ar esgota as 4 retentativas e cai no painel', async () => {
  let chamadas = 0;
  const prov = { ...PROVEDORES_SIMULADOS, whatsapp: { nome: 'meta_cloud', enviar: async () => { chamadas++; return { ok: false, retentavel: true, erro: { codigo: '503', mensagem: 'indisponível' }, provedor: 'meta_cloud' }; } } };
  const a = amb(SP('2026-10-01', '09:00'), { provedores: prov });
  await pedir(a);
  let [c01] = await execs(a, 'C01');
  assert.deepEqual([c01.estado, c01.tentativas, c01.agendadaPara], ['agendada', 1, SP('2026-10-01', '09:01')]);
  for (const [min, n] of [[1, 2], [6, 3], [21, 4], [81, 5]]) {
    await irPara(a, new Date(Date.parse(SP('2026-10-01', '09:00')) + min * 60000).toISOString());
    assert.equal(chamadas, n, `tentativa ${n}`);
  }
  [c01] = await execs(a, 'C01');
  assert.equal(c01.estado, 'enviada');
  assert.deepEqual(c01.mensagens.map((m) => `${m.canal}:${m.estado}`), [...Array(5).fill('whatsapp:falhou'), 'painel:enviada'], 'e-mail desligado é pulado');
  assert.match(c01.mensagens.at(-1).conteudo, /^Enviar manualmente para Ana Teste Fictícia \(\(31\) 9\*\*\*\*-7777\): Oi, Ana!/);
});

t.teste('erro definitivo (telefone inválido) vai direto pro próximo canal, sem retentar', async () => {
  const prov = { ...PROVEDORES_SIMULADOS, whatsapp: { nome: 'meta_cloud', enviar: async () => ({ ok: false, retentavel: false, erro: { codigo: '400', mensagem: 'número inválido' }, provedor: 'meta_cloud' }) } };
  const a = amb(SP('2026-10-01', '09:00'), { provedores: prov });
  await pedir(a);
  const [c01] = await execs(a, 'C01');
  assert.deepEqual(c01.mensagens.map((m) => `${m.canal}:${m.estado}`), ['whatsapp:falhou', 'painel:enviada']);
});

t.teste('resultado incerto: envio que parou no meio (provedor pode ter aceitado) NÃO é reenviado; vira falhou e avisa a equipe', async () => {
  const a = amb();
  await pedir(a, {});
  // simula queda: prepara (grava "enviando") e não conclui
  const r = await pedir(a, { data: '2026-10-08' });
  await a.repo.transacao(null, async (tx) => { for (const e of await tx.todos('execucoes')) if (e.regra === 'C01' && e.contexto.pedidoId === r.pedido.id) await tx.put('execucoes', { ...e, estado: 'agendada' }); });
  const porta = a.motor.porta;
  await porta.transacao(async (p) => { const ex = (await p.agendadasDasRegras(['C01'])).find((e) => e.contexto.pedidoId === r.pedido.id); return prepararEnvio(p, ex, { agoraISO: SP('2026-10-01', '09:00'), ambiente: {} }); });
  await irPara(a, SP('2026-10-01', '09:05'));
  let c = (await execs(a, 'C01')).find((e) => e.contexto.pedidoId === r.pedido.id);
  assert.equal(c.estado, 'enviando', 'antes de 10 min continua enviando');
  await irPara(a, SP('2026-10-01', '09:11'));
  c = (await execs(a, 'C01')).find((e) => e.contexto.pedidoId === r.pedido.id);
  assert.equal(c.estado, 'falhou'); assert.match(c.motivo, /resultado incerto/);
  assert.equal(c.mensagens.length, 2, 'a mensagem antiga (enviada antes da simulação) e a incerta; nenhuma nova');
  await a.motor.tique();
  assert.ok((await execs(a, 'I08')).some((e) => e.estado === 'enviada'));
});

t.teste('D04 só com a diária confirmada (endereço completo); troca de profissional avisa a anterior (D08) e a cliente (C07)', async () => {
  const a = amb();
  const r = await pedir(a);
  const d1 = await criarDiaristaAprovada(a.casos);
  const d2 = await criarDiaristaAprovada(a.casos);
  await liberarCobranca(a.casos, r);
  await a.casos.atribuirDiarista(r.atendimentos[0].id, { diaristaId: d1 }, { sessao: PRIME, chave: chave('atr') });
  assert.equal((await execs(a, 'D04')).length, 0, 'sem pagamento, sem endereço');
  const [g] = (await a.casos.obterPedido(r.pedido.id, { sessao: PRIME })).pagamentos;
  await a.casos.confirmarPagamento(g.id, { sessao: PRIME, chave: chave('conf') });
  assert.deepEqual((await execs(a, 'D04')).map((e) => [e.destinatario.id, e.estado]), [[d1, 'enviada']]);
  await a.casos.atribuirDiarista(r.atendimentos[0].id, { diaristaId: d2 }, { sessao: PRIME, chave: chave('atr2') });
  assert.deepEqual((await execs(a, 'D04')).map((e) => e.destinatario.id).sort(), [d1, d2].sort());
  const d08 = await execs(a, 'D08');
  assert.deepEqual(d08.map((e) => [e.destinatario.id, e.estado]), [[d1, 'enviada']]);
  assert.match(d08[0].mensagens[0].conteudo, /passou para outra profissional/);
  assert.equal((await execs(a, 'C07')).length, 2, 'cliente avisada da designação e da troca');
});

t.teste('agenda interna: I06 7h, I07 segunda 8h, I04 no prazo vencido, I03 e D06 sem check-in 30 min depois do início', async () => {
  const a = amb(SP('2026-10-04', '10:00')); // domingo
  const r = await pedir(a, { data: '2026-10-06' });
  const dia = await criarDiaristaAprovada(a.casos);
  await liberarCobranca(a.casos, r);
  await irPara(a, SP('2026-10-05', '07:00'));
  assert.equal((await execs(a, 'I06')).filter((e) => e.estado === 'enviada').length >= 1, true);
  assert.ok((await execs(a, 'I07')).some((e) => e.marco === '2026-10-05' && e.estado === 'agendada' && e.agendadaPara === SP('2026-10-05', '08:00')), 'segunda 8h');
  await irPara(a, SP('2026-10-05', '14:00')); // prazo: segunda 05/10 14h (dia útil anterior à terça)
  assert.ok((await execs(a, 'I07')).some((e) => e.marco === '2026-10-05' && e.estado === 'enviada'));
  const i04 = await execs(a, 'I04');
  assert.deepEqual(i04.map((e) => e.estado), ['enviada']);
  const [g] = (await a.casos.obterPedido(r.pedido.id, { sessao: PRIME })).pagamentos;
  await a.casos.confirmarPagamento(g.id, { sessao: PRIME, chave: chave('conf') });
  await a.casos.atribuirDiarista(r.atendimentos[0].id, { diaristaId: dia }, { sessao: PRIME, chave: chave('atr') });
  await irPara(a, SP('2026-10-06', '08:31'));
  assert.equal((await execs(a, 'D06'))[0].estado, 'enviada');
  assert.equal((await execs(a, 'I03'))[0].estado, 'enviada');
});

t.teste('eventos do bloco 3 (sintéticos): C14 hora extra, C15 ocorrência, I05 ocorrência aberta; C16 confirmação única do SAIR no canal revogado', async () => {
  const a = amb();
  const r = await pedir(a);
  await a.repo.transacao(null, async (tx) => {
    const base = { status: 'pendente', criadoEm: a.relogio.agora().toISOString() };
    await tx.put('eventos', { id: 'e-he', tipo: 'hora_extra_aprovada', refs: { atendimentoId: r.atendimentos[0].id, pedidoId: r.pedido.id }, dados: { horas: 1, valorCentavos: 3000, pagamentoId: 'pg-x' }, seq: 1, ...base });
    await tx.put('eventos', { id: 'e-oc', tipo: 'ocorrencia_atualizada', refs: { atendimentoId: r.atendimentos[0].id }, dados: { estado: 'em análise' }, seq: 2, ...base });
    await tx.put('eventos', { id: 'e-oa', tipo: 'ocorrencia_aberta', refs: { atendimentoId: r.atendimentos[0].id }, dados: {}, seq: 3, ...base });
    await tx.put('eventos', { id: 'e-sair', tipo: 'marketing_revogado', refs: { clienteId: r.cliente.id }, dados: { canal: 'whatsapp' }, seq: 4, ...base });
  });
  await a.motor.tique();
  const c14 = (await execs(a, 'C14'))[0];
  assert.match(c14.mensagens[0].conteudo, /1 hora de hora extra.*R\$ 30,00/);
  assert.match((await execs(a, 'C15'))[0].mensagens[0].conteudo, /está em análise/);
  assert.equal((await execs(a, 'I05'))[0].estado, 'enviada');
  const c16 = await execs(a, 'C16');
  assert.deepEqual([c16.length, c16[0].mensagens.map((m) => m.canal)], [1, ['whatsapp']]);
  await a.motor.tique();
  assert.equal((await execs(a, 'C16')).length, 1, 'confirmação única');
});

t.teste('agenda idempotente e recupera ciclo perdido: worker parado não perde o lembrete que ainda vale, nem repete', async () => {
  const a = amb();
  const r = await pedir(a);
  await liberarCobranca(a.casos, r);
  // worker "parado" das 13h às 15h do dia 05: o lembrete de 14h (24h antes) sai às 15h, uma vez
  await irPara(a, SP('2026-10-05', '15:00'));
  await a.motor.tique(); await a.motor.tique();
  const c04 = await execs(a, 'C04');
  assert.equal(c04.length, 2);
  assert.equal(c04.filter((e) => e.estado === 'enviada').length, 1);
  assert.equal(c04[0].mensagens.length, 1);
});

t.teste('M01 dia 25 (pacote do mês, link de renovação) e M02 inatividade uma vez por período', async () => {
  const regras = REGRAS.map((r) => (r.categoria === 'marketing' ? { ...r, ligada: true } : r));
  const a = amb(SP('2026-10-01', '09:00'), { regras, consentimentos: () => true });
  await pedir(a, { data: '2026-10-05', pacote: { ...AVULSO, frequencia: 'semanal', quantidadeDiarias: 3 } });
  const pd = (await a.repo.leitura(null, (tx) => tx.todos('pedidos')))[0];
  await a.repo.transacao(null, async (tx) => { await tx.put('pedidos', { ...pd, status: 'confirmado' }); });
  await irPara(a, SP('2026-10-25', '09:00')); // domingo: vai pra segunda 9h
  let [m01] = await execs(a, 'M01');
  assert.deepEqual([m01.estado, m01.agendadaPara], ['agendada', SP('2026-10-26', '09:00')]);
  await irPara(a, SP('2026-10-26', '09:00'));
  [m01] = await execs(a, 'M01');
  assert.equal(m01.estado, 'enviada'); assert.match(m01.mensagens[0].conteudo, /em novembro\?.*autoagendamento\/\?repetir=/s);
  // M02: última diária finalizada há 60 dias
  const b = amb(SP('2026-08-01', '09:00'), { regras, consentimentos: () => true });
  const x = await pedir(b, { data: '2026-08-03' });
  const dia = await criarDiaristaAprovada(b.casos);
  b.relogio.irPara(SP('2026-08-03', '12:00'));
  await levarAteFinalizado(b.casos, x, dia);
  await irPara(b, SP('2026-10-02', '09:00'));
  await irPara(b, SP('2026-10-03', '09:00'));
  const m02 = await execs(b, 'M02');
  assert.deepEqual(m02.map((e) => e.estado), ['enviada'], 'uma vez só no período');
});

await t.fim();
