// E3 no navegador: autoagendamento (solicitação) residencial avulso e empresa 4 diárias, com a calculadora na etapa 2.
import { criarSuite, assert } from './lib-teste.mjs';
import { abrirNavegador, subirServidor } from './pw.mjs';
import { proximaDataPermitida } from './fixtures/seed.js';
import { dataNoFuso } from '../src/domain/calendario.js';
import { CONFIG_PRECOS } from '../src/config/precos.js';

const t = criarSuite('E3 navegador (autoagendamento)');
const { base, fechar } = await subirServidor();
const b = await abrirNavegador();
const HOJE = dataNoFuso(new Date().toISOString());
// Dia útil sem feriado (sábado/feriado tem taxa e mudaria os valores conferidos à mão).
let DATA = proximaDataPermitida(HOJE, 3, CONFIG_PRECOS);
while (new Date(`${DATA}T12:00:00Z`).getUTCDay() === 6 || CONFIG_PRECOS.feriados.includes(DATA)) DATA = proximaDataPermitida(DATA, 1, CONFIG_PRECOS);
const VIACEP = {
  30130010: { logradouro: 'Rua Fictícia', bairro: 'Savassi', localidade: 'Belo Horizonte', uf: 'MG' },
  32010000: { logradouro: 'Avenida Exemplo', bairro: 'Centro', localidade: 'Contagem', uf: 'MG' },
  35400000: { logradouro: 'Rua Direita', bairro: 'Centro', localidade: 'Ouro Preto', uf: 'MG' },
  34000000: { logradouro: 'Alameda Teste', bairro: 'Centro', localidade: 'Nova Lima', uf: 'MG' },
};

async function novaPagina(largura = 390) {
  const ctx = await b.newContext({ viewport: { width: largura, height: 900 }, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  p.erros = [];
  // o teste derruba o ViaCEP de propósito: esse erro de rede é esperado
  p.on('console', (m) => m.type() === 'error' && !/viacep/.test(m.location()?.url || '') && p.erros.push(m.text()));
  p.on('pageerror', (e) => p.erros.push(e.message));
  await ctx.route('https://viacep.com.br/**', (route) => {
    const cep = route.request().url().match(/ws\/(\d{8})/)[1];
    if (cep === '99999999') return route.abort();
    return route.fulfill({ json: VIACEP[cep] || { erro: true } });
  });
  // Pix configurado (prime.teste.js) pra a entrada ter BR Code; sem ?dev=1 pra testar a sessão real da cliente.
  await ctx.route('**/src/config/prime.js', (route) => route.fulfill({ path: 'src/config/prime.teste.js', contentType: 'text/javascript' }));
  return p;
}
const avancar = (p) => p.getByRole('button', { name: 'Continuar' }).click();
const titulo = (p) => p.locator('#titulo-passo').textContent();

async function passo1(p, tipo) {
  await p.goto(`${base}autoagendamento/`);
  await p.waitForSelector('#titulo-passo');
  await p.locator(`input[name=tipo][value=${tipo}]`).check({ force: true });
}

let pr;
t.teste('passo 1: não avança sem escolher; empresa exige CNPJ válido (alfanumérico aceito)', async () => {
  pr = await novaPagina();
  await pr.goto(`${base}autoagendamento/`); await pr.waitForSelector('#titulo-passo');
  await avancar(pr);
  assert.match(await titulo(pr), /Quem contrata/);
  assert.match(await pr.locator('[data-campo=tipo] .erro-campo').textContent(), /Escolha/);
  await pr.locator('input[name=tipo][value=empresa]').check({ force: true });
  await pr.fill('#cnpj', '12ABC34501DE36'); await pr.fill('#razaoSocial', 'Empresa Teste Ltda'); await pr.fill('#responsavel', 'Carlos Teste');
  await avancar(pr);
  assert.match(await pr.locator('[data-campo=cnpj] .erro-campo').textContent(), /dígito/);
  assert.equal(await pr.locator('#cnpj').getAttribute('aria-invalid'), 'true');
  await pr.fill('#cnpj', '12abc34501de35');
  assert.equal(await pr.inputValue('#cnpj'), '12.ABC.345/01DE-35');
  await pr.locator('input[name=tipo][value=residencial]').check({ force: true });
  await avancar(pr);
  assert.match(await titulo(pr), /Calcule sua diária/);
});

t.teste('passo 2 (calculadora): sugere carga horária sem prometer tarefas; valor em tempo real sem endereço; 2h bloqueada acima de 30 m²', async () => {
  assert.match(await pr.locator('#aviso-calculadora').textContent(), /sugestão: a quantidade de tarefas realizadas dependerá do tempo disponível/);
  await avancar(pr);
  assert.match(await pr.locator('[data-campo=metragem] .erro-campo').textContent(), /metragem/);
  assert.ok(await pr.locator('input[name=tipoServico][value=pos_obra]').isDisabled());
  await pr.fill('#metragem', '70');
  assert.match(await pr.locator('#recomendacao').textContent(), /70 m², sugerimos 6 horas/);
  assert.ok(await pr.locator('input[name=duracaoHoras][value="6"]').isChecked(), 'recomendação pré-selecionada');
  assert.ok(await pr.locator('input[name=duracaoHoras][value="2"]').isDisabled(), '2h só até 30 m²');
  assert.equal(await pr.locator('[data-valor=dia]').textContent(), 'R$ 203,00');
  assert.match(await pr.locator('#preco').textContent(), /taxa de deslocamento entra depois do endereço/);
  await pr.locator('input[name=duracaoHoras][value="4"]').check({ force: true });
  await pr.locator('input[name=passadoriaCombinada][value=sim]').check({ force: true });
  assert.equal(await pr.locator('[data-valor=dia]').textContent(), 'R$ 230,00');
  await pr.locator('input[name=passadoriaCombinada][value=sim]').uncheck({ force: true });
  assert.equal(await pr.inputValue('#quantidadeDiarias'), '1');
  assert.ok(await pr.locator('#quantidadeDiarias').isDisabled());
  await pr.fill('#metragem', '150');
  assert.ok(await pr.locator('#acima-120').isVisible(), 'acima de 120 m² mostra aviso');
  await pr.fill('#metragem', '70');
  await avancar(pr);
  assert.match(await titulo(pr), /Endereço da limpeza/);
});

t.teste('passo 3: ViaCEP preenche; região não atendida bloqueia; ViaCEP fora cai no manual', async () => {
  await pr.fill('#cep', '35400-000');
  await pr.waitForFunction(() => document.querySelector('#cidade').value === 'Ouro Preto');
  await pr.fill('#numero', '10');
  await avancar(pr);
  assert.match(await pr.locator('.alerta-erro').textContent(), /Ainda não atendemos Ouro Preto/);
  await pr.fill('#cep', '34000-000');
  await pr.waitForFunction(() => document.querySelector('#cidade').value === 'Nova Lima');
  await avancar(pr);
  await pr.waitForSelector('[data-regiao=sob-consulta]:not([hidden])');
  assert.ok(await pr.locator('[data-regiao=sob-consulta] [data-whatsapp=manual]').isVisible(), 'Nova Lima leva pro WhatsApp');
  await pr.fill('#cep', '99999-999');
  await pr.waitForFunction(() => /à mão/.test(document.querySelector('[role=status].ajuda')?.textContent || ''));
  await pr.fill('#cep', '30130-010');
  await pr.waitForFunction(() => document.querySelector('#cidade').value === 'Belo Horizonte');
  assert.equal(await pr.inputValue('#logradouro'), 'Rua Fictícia');
  await pr.fill('#numero', '100');
  await avancar(pr);
  assert.match(await titulo(pr), /Escolha o dia/);
});

t.teste('passo 4: data obrigatória, domingo recusado, calendário e pagamento integral (sem 50/50), preferência opcional', async () => {
  await avancar(pr);
  assert.match(await pr.locator('[data-campo=primeiraData] .erro-campo').textContent(), /Informe a data/);
  let dom = HOJE; while (new Date(`${dom}T12:00:00Z`).getUTCDay() !== 0 || dom <= HOJE) dom = new Date(Date.parse(`${dom}T12:00:00Z`) + 86400e3).toISOString().slice(0, 10);
  await pr.fill('#primeiraData', dom);
  await pr.locator('input[name=turno][value=manha]').check({ force: true });
  await avancar(pr);
  assert.match(await pr.locator('[data-campo=primeiraData] .erro-campo').textContent(), /domingo/);
  await pr.fill('#primeiraData', DATA);
  await pr.waitForSelector(`#calendario [data-data="${DATA}"]`);
  assert.equal(await pr.locator('#calendario [data-valor=total]').textContent(), 'R$ 175,00');
  const cal = await pr.locator('#calendario').textContent();
  assert.ok(!/entrada|50%|restante/i.test(cal), 'sem entrada nem restante');
  assert.match(cal, /antecipadamente e de forma integral/);
  assert.match(await pr.locator('.preferencia').textContent(), /Tem preferência por alguma profissional\?.*sempre que houver disponibilidade/);
  await pr.fill('#preferencia', 'Maria');
  await avancar(pr);
  assert.match(await titulo(pr), /Seus contatos/);
});

t.teste('recarregar retoma no mesmo passo com os dados', async () => {
  await pr.fill('#nome', 'Ana Teste Fictícia');
  await pr.reload(); await pr.waitForSelector('#titulo-passo');
  assert.match(await titulo(pr), /Seus contatos/);
  assert.equal(await pr.inputValue('#nome'), 'Ana Teste Fictícia');
});

t.teste('passo 5: sem senha; CPF e nascimento obrigatórios; explica como entrar depois', async () => {
  assert.equal(await pr.locator('input[type=password]').count(), 0, 'não cria senha');
  assert.match(await pr.locator('#como-entrar').textContent(), /6 primeiros números do seu CPF.*data de nascimento/);
  await pr.fill('#telefone', '31 1234'); await pr.fill('#email', 'ana@'); await pr.fill('#cpf', '111.111.111-11');
  await avancar(pr);
  for (const c of ['telefone', 'email', 'cpf', 'dataNascimento']) assert.ok((await pr.locator(`[data-campo=${c}] .erro-campo`).textContent()).length > 0, c);
  await pr.fill('#telefone', '31988887777'); await pr.fill('#email', 'ana.e3@exemplo.com'); await pr.fill('#cpf', '11144477735');
  await pr.fill('#dataNascimento', '1988-05-14');
  assert.equal(await pr.inputValue('#telefone'), '(31) 98888-7777');
  await avancar(pr);
  assert.match(await titulo(pr), /Confira e envie a solicitação/);
});

t.teste('residencial avulso: resumo, duplo clique, solicitação sem cobrança; a Prime confirma e nasce a cobrança integral', async () => {
  assert.match(await pr.locator('dl.dados').textContent(), /Savassi/);
  assert.match(await pr.locator('dl.dados').textContent(), /Maria \(se houver disponibilidade\)/);
  assert.match(await pr.locator('#solicitacao-nao-confirma').textContent(), /não confirma o atendimento/);
  assert.match(await pr.locator('[data-cobranca="1"]').textContent(), /R\$ 175,00/);
  await pr.getByRole('button', { name: 'Enviar solicitação' }).dblclick();
  await pr.waitForURL(/acompanhamento\/\?pedido=/);
  await pr.waitForSelector('#solicitacao-enviada');
  assert.ok(await pr.locator('#sem-cobranca').isVisible(), 'sem cobrança antes da Prime');
  const id = new URL(pr.url()).searchParams.get('pedido');
  const r = await pr.evaluate(async ([raiz, pid]) => {
    const { api } = await import(`${raiz}src/services/api.js`);
    const ped = await api.obterPedido(pid);
    const lista = await api.listarPedidos({});
    const d = await api.confirmarDisponibilidade(pid, {}, { chave: crypto.randomUUID(), sessao: { ator: 'prime' } });
    return { status: ped.pedido.status, pref: ped.pedido.preferenciaProfissional, ats: ped.atendimentos.map((a) => [a.data, a.turno, a.status]), pgs: ped.pagamentos.length, total: ped.pedido.pacote.totalCentavos, pedidos: lista.itens.length, rascunho: localStorage.getItem('prime.rascunho.autoagendamento'), depois: d.pagamentos.map((g) => [g.parcela, g.valorCentavos, !!g.brcode]), statusDepois: d.pedido.status };
  }, [base, id]);
  assert.equal(r.status, 'solicitado'); assert.equal(r.pref, 'Maria'); assert.equal(r.total, 17500); assert.equal(r.pgs, 0);
  assert.deepEqual(r.ats, [[DATA, 'manha', 'agendado']]);
  assert.equal(r.pedidos, 1, 'duplo clique não criou duas solicitações');
  assert.equal(r.rascunho, null);
  assert.deepEqual(r.depois, [['diaria', 17500, true]]); assert.equal(r.statusDepois, 'aguardando_pagamento');
});

t.teste('empresa 4 diárias semanais: solicitação com 4 atendimentos; cobrança por diária com desconto na última do mês', async () => {
  const p = await novaPagina(1440);
  await passo1(p, 'empresa');
  // empresa NOVA (a do seed já tem conta: agendaria logada)
  await p.fill('#cnpj', '98XYZ76501AB46'); await p.fill('#razaoSocial', 'Empresa Teste de Exemplo Ltda'); await p.fill('#responsavel', 'Carlos Teste');
  await avancar(p);
  assert.ok(await p.locator('input[name=frequencia][value=avulso]').isDisabled(), 'empresa sem avulso');
  await p.locator('input[name=tipoServico][value=empresarial]').check({ force: true });
  await p.fill('#metragem', '100');
  await p.locator('input[name=duracaoHoras][value="8"]').check({ force: true });
  await p.locator('input[name=semLocalAlmoco][value=nao]').check({ force: true });
  await p.locator('input[name=frequencia][value=semanal]').check({ force: true });
  await p.fill('#quantidadeDiarias', '4');
  assert.equal(await p.locator('[data-valor=dia]').textContent(), 'R$ 255,00'); // 220 + 10 empresarial + 25 almoço (sem endereço ainda)
  await avancar(p);
  await p.fill('#cep', '32010-000'); await p.waitForFunction(() => document.querySelector('#cidade').value === 'Contagem');
  await p.fill('#numero', '500'); await avancar(p);
  assert.equal(await p.locator('input[name=turno]').count(), 1, '8h só tem integral');
  await p.fill('#primeiraData', DATA); await p.locator('input[name=turno][value=integral]').check({ force: true });
  await p.waitForSelector('#calendario li >> nth=3');
  await avancar(p);
  assert.equal(await p.locator('#dataNascimento').count(), 0, 'empresa não informa nascimento');
  assert.match(await p.locator('#como-entrar').textContent(), /6 primeiros caracteres do CNPJ/);
  await p.fill('#nome', 'Carlos Teste'); await p.fill('#telefone', '31977776666'); await p.fill('#email', 'nova@empresa-teste.exemplo');
  await avancar(p);
  await p.getByRole('button', { name: 'Enviar solicitação' }).click();
  await p.waitForURL(/acompanhamento\/\?pedido=/);
  const id = new URL(p.url()).searchParams.get('pedido');
  const r = await p.evaluate(async ([raiz, pid]) => {
    const { api } = await import(`${raiz}src/services/api.js`);
    const ped = await api.obterPedido(pid);
    const d = await api.confirmarDisponibilidade(pid, {}, { chave: crypto.randomUUID(), sessao: { ator: 'prime' } });
    return { cliente: ped.cliente, pacote: ped.pedido.pacote, n: ped.atendimentos.length, cobr: d.pagamentos.map((x) => [x.parcela, x.valorCentavos, x.descontoCentavos]) };
  }, [base, id]);
  assert.equal(r.n, 4);
  assert.equal(r.cliente.cnpj, '98XYZ76501AB46'); assert.equal(r.cliente.tipo, 'empresa');
  assert.ok(r.pacote.itensDia.some((i) => i.codigo === 'deslocamento'), 'Contagem tem taxa');
  assert.equal(r.pacote.valorDiaBaseCentavos, 26500);
  assert.equal(r.cobr.length, 4);
  assert.equal(r.cobr.reduce((s, x) => s + x[1], 0), r.pacote.totalCentavos);
  assert.deepEqual(p.erros, []);
});

t.teste('botões da home: ?etapa=calculadora e ?frequencia=semanal abrem a calculadora (depois do tipo)', async () => {
  const q = await novaPagina();
  await q.goto(`${base}autoagendamento/?frequencia=semanal`);
  await q.waitForSelector('#titulo-passo');
  assert.match(await titulo(q), /Quem contrata/, 'sem tipo, começa por ele');
  await q.locator('input[name=tipo][value=residencial]').check({ force: true });
  await avancar(q);
  assert.match(await titulo(q), /Calcule sua diária/);
  assert.ok(await q.locator('input[name=frequencia][value=semanal]').isChecked(), 'pacote já com frequência');
  await q.goto(`${base}autoagendamento/?etapa=calculadora`);
  await q.waitForSelector('#titulo-passo');
  assert.match(await titulo(q), /Calcule sua diária/, 'com o tipo escolhido, vai direto pra calculadora');
});

t.teste('cards da home: ?servico= pré-seleciona o tipo de serviço no rascunho', async () => {
  const q = await novaPagina();
  await q.goto(`${base}autoagendamento/?servico=passadoria`);
  await q.waitForSelector('#titulo-passo');
  const tipo = await q.evaluate(() => JSON.parse(localStorage.getItem('prime.rascunho.autoagendamento')).pacote.tipoServico);
  assert.equal(tipo, 'passadoria');
  await q.goto(`${base}autoagendamento/?servico=inventado`);
  await q.waitForSelector('#titulo-passo');
  assert.equal(await q.evaluate(() => JSON.parse(localStorage.getItem('prime.rascunho.autoagendamento')).pacote.tipoServico), 'passadoria', 'valor desconhecido é ignorado');
  const links = await q.evaluate(async (raiz) => { const r = await fetch(raiz); const h = await r.text(); return { externos: (h.match(/primelimpezaespecializada\.com\.br/g) || []).length, servicos: (h.match(/autoagendamento\/\?servico=/g) || []).length, cadastro: (h.match(/diarista\/cadastro\//g) || []).length }; }, base);
  assert.deepEqual(links, { externos: 0, servicos: 6, cadastro: 1 });
});

t.teste('sem erro no console e sem overflow em 390px', async () => {
  const ov = await pr.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(ov <= 0);
  assert.deepEqual(pr.erros, [], JSON.stringify(pr.erros));
});

const falhas = await t.fim();
await b.close(); await fechar();
process.exit(falhas ? 1 : 0);
