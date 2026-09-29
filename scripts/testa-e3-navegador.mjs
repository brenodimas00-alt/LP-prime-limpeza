// Autoagendamento v2 no navegador (mock), spec-agendamento-v2.txt seção 5: fluxos completos (residencial 1 diária com
// metragem; várias datas por cômodos com horários individuais; empresarial recorrente semanal com o mesmo horário;
// cliente que entra no meio do fluxo), CEP (atendido, fora, sob consulta, ViaCEP fora e resposta atrasada), nenhum "R$"
// antes da etapa 6, nada de hora extra/preferência/quantidade de profissionais, aceite obrigatório, aviso de
// disponibilidade uma vez só, voltar do navegador, recarregar, deep link, teclado e leitor de tela, 320 px.
// node scripts/testa-e3-navegador.mjs [--shots]   (--shots grava cada etapa em 375 e 1440 em docs/shots/agendamento-v2/)
import { mkdirSync } from 'node:fs';
import { criarSuite, assert } from './lib-teste.mjs';
import { abrirNavegador, subirServidor, horarioComercial } from './pw.mjs';
import { CREDENCIAIS_MOCK as C } from './fixtures/seed.js';
import { dataNoFuso, somarDias, diaDaSemana } from '../src/domain/calendario.js';
import { CONFIG_PRECOS } from '../src/config/precos.js';

const SHOTS = process.argv.includes('--shots');
const PASTA = 'docs/shots/agendamento-v2';
if (SHOTS) mkdirSync(PASTA, { recursive: true });
const t = criarSuite('E3 navegador (autoagendamento v2)');
const { base, fechar } = await subirServidor();
const b = await abrirNavegador();
const HOJE = dataNoFuso(horarioComercial());
/** Próximo dia de semana (seg a sex) sem feriado, a partir de hoje + n. */
function diaUtil(n) {
  let d = somarDias(HOJE, n);
  while ([0, 6].includes(diaDaSemana(d)) || CONFIG_PRECOS.feriados.includes(d)) d = somarDias(d, 1);
  return d;
}
const D1 = diaUtil(3); const D2 = diaUtil(Number(somarDias(D1, 7).slice(8)) ? 10 : 10);
let SAB = somarDias(HOJE, 3); while (diaDaSemana(SAB) !== 6 || CONFIG_PRECOS.feriados.includes(SAB)) SAB = somarDias(SAB, 1);
const VIACEP = {
  30130010: { logradouro: 'Rua Fictícia', bairro: 'Savassi', localidade: 'Belo Horizonte', uf: 'MG' },
  32010000: { logradouro: 'Avenida Exemplo', bairro: 'Centro', localidade: 'Contagem', uf: 'MG' },
  35400000: { logradouro: 'Rua Direita', bairro: 'Centro', localidade: 'Ouro Preto', uf: 'MG' },
  34000000: { logradouro: 'Alameda Teste', bairro: 'Centro', localidade: 'Nova Lima', uf: 'MG' },
};

async function novaPagina(largura = 375, { atrasar } = {}) {
  const ctx = await b.newContext({ viewport: { width: largura, height: 860 }, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  p.erros = []; p.largura = largura; p.textos = [];
  p.on('console', (m) => m.type() === 'error' && !/viacep/.test(m.location()?.url || '') && p.erros.push(m.text()));
  p.on('pageerror', (e) => p.erros.push(e.message));
  await ctx.route('https://viacep.com.br/**', async (route) => {
    const cep = route.request().url().match(/ws\/(\d{8})/)[1];
    if (cep === '99999999') return route.abort();
    if (atrasar?.[cep]) await new Promise((r) => setTimeout(r, atrasar[cep]));
    return route.fulfill({ json: VIACEP[cep] || { erro: true } });
  });
  // WhatsApp configurado (prime.teste.js): "Falar com a Prime" vira link de verdade
  await ctx.route('**/src/config/prime.js', (route) => route.fulfill({ path: 'src/config/prime.teste.js', contentType: 'text/javascript' }));
  return p;
}
const titulo = (p) => p.locator('#titulo-passo').textContent();
const continuar = (p) => p.getByRole('button', { name: 'Continuar' }).click();
const marcar = (p, nome, valor) => p.locator(`input[name="${nome}"][value="${valor}"]`).evaluate((i) => { if (!i.checked) i.click(); });
/** Guarda o texto visível de cada tela (pra conferir "R$" e repetição) e, com --shots, a imagem. */
async function registrar(p, nome) {
  await p.waitForSelector('#titulo-passo');
  p.textos.push({ passo: await p.locator('[data-passo]').first().getAttribute('data-passo'), texto: await p.evaluate(() => document.body.innerText) });
  if (SHOTS) await p.screenshot({ path: `${PASTA}/${nome}-${p.largura}.png`, fullPage: true });
}
async function escolherData(p, d) {
  for (let i = 0; i < 6 && !(await p.locator(`.cal-dia[data-dia="${d}"]`).count()); i++) await p.getByRole('button', { name: 'Próximo mês' }).click();
  await p.locator(`.cal-dia[data-dia="${d}"]`).click();
}
async function ateLocal(p, { onde = 'residencial', servico = 'residencial', cep = '30130010' } = {}) {
  await p.goto(`${base}autoagendamento/`); await registrar(p, '01-servico');
  await marcar(p, 'tipoCliente', onde); await marcar(p, 'tipoServico', servico); await continuar(p);
  await p.fill('#cep', cep); await p.waitForSelector('[data-regiao=atendida]'); await registrar(p, '02-cep'); await continuar(p);
  await p.fill('#numero', '100'); await registrar(p, '03-endereco'); await continuar(p);
  await p.waitForSelector('[data-passo=local]');
}
async function dadosNovos(p, { cpf = '36192847509', email = `nova-${Date.now()}@exemplo.com` } = {}) {
  await p.fill('#nome', 'Ana Nova Fictícia'); await p.fill('#telefone', '31955554444'); await p.fill('#email', email);
  await p.fill('#cpf', cpf); await p.fill('#dataNascimento', '1990-03-07');
}
async function enviar(p) {
  await p.waitForSelector('[data-valor=total]');
  await registrar(p, '10-revisao');
  await p.locator('#aceite-condicoes').check();
  if (await p.locator('#aceite-termos').count()) await p.locator('#aceite-termos').check();
  await p.getByRole('button', { name: 'ENVIAR SOLICITAÇÃO' }).click();
  await p.waitForSelector('[data-passo=enviado]');
  await registrar(p, '11-enviado');
}
/** Regras transversais sobre tudo que a pessoa viu antes do envio. */
function conferirTransversais(p, minimo = 8) {
  const antes = p.textos.filter((x) => x.passo !== 'revisao' && x.passo !== 'enviado');
  assert.ok(antes.length >= minimo, `telas registradas: ${antes.length}`);
  for (const x of antes) assert.ok(!/R\$/.test(x.texto), `"R$" antes da etapa 6 em ${x.passo}`);
  for (const x of p.textos) assert.ok(!/hora extra|horas extras|preferência por (alguma )?profissional|Nome da profissional|quantas profissionais|quantidade de profissionais/i.test(x.texto), `campo removido apareceu em ${x.passo}`);
  const aviso = /verificará a disponibilidade/;
  assert.deepEqual(p.textos.filter((x) => aviso.test(x.texto)).map((x) => x.passo), ['revisao'], 'aviso de disponibilidade só na revisão');
}

t.teste('residencial, 1 diária, com metragem: sugestão 4h pré-selecionada, horário, dados, revisão com R$ 175,00 e envio', async () => {
  const p = await novaPagina(375);
  const inicio = Date.now();
  await ateLocal(p);
  await p.fill('#metragem', '45');
  await p.waitForSelector('[data-sugestao="4"]');
  assert.match(await p.locator('#sugestao').textContent(), /sugerimos uma diária de 4 horas\.Essa sugestão serve apenas como orientação/);
  assert.equal(await p.locator('input[name=duracaoHoras][value="4"]').isChecked(), true, 'sugerida vem marcada');
  assert.match(await p.locator('label[data-valor="4"]').textContent(), /sugerida/);
  await marcar(p, 'semLocalAlmoco', 'sim'); await registrar(p, '04-local'); await continuar(p);
  await marcar(p, 'quantidade', 'uma'); await registrar(p, '05-quantidade'); await continuar(p);
  await escolherData(p, D1); await registrar(p, '06-datas'); await continuar(p);
  const horarios = await p.locator('input[name=horario]').evaluateAll((l) => l.map((i) => i.value));
  assert.deepEqual([horarios[0], horarios.at(-1)], ['08:00', '14:30'], '4h: de 08:00 a 14:30');
  await marcar(p, 'horario', '09:30'); await registrar(p, '07-horario'); await continuar(p);
  assert.equal(await titulo(p), 'Seus dados', 'uma data: sem a pergunta de repetir o horário');
  await dadosNovos(p); await registrar(p, '09-dados'); await continuar(p);
  await p.waitForSelector('[data-valor=total]');
  assert.equal(await p.locator('[data-valor=total]').textContent(), 'R$ 175,00');
  assert.equal(await p.locator('[data-valor=diaria]').count(), 0, 'uma diária: sem "por diária"');
  await enviar(p);
  assert.match(await p.locator('[data-passo=enviado]').textContent(), /Solicitação enviada!Recebemos sua solicitação\. A Prime irá verificar.*Acompanhe seu WhatsApp.*6 primeiros números do seu CPF/);
  p.tempo = Date.now() - inicio;
  console.log(`       tempo do fluxo no celular (automatizado, 375 px): ${(p.tempo / 1000).toFixed(1)} s`);
  conferirTransversais(p);
  assert.deepEqual(p.erros, []);
});

t.teste('várias datas por cômodos com horários individuais (1440): sábado com acréscimo, valor por diária e duas horas diferentes', async () => {
  const p = await novaPagina(1440);
  await ateLocal(p);
  await p.getByRole('button', { name: 'Não sei a metragem' }).click();
  for (let i = 0; i < 3; i++) await p.getByRole('button', { name: 'Aumentar quartos' }).click();
  await p.getByRole('button', { name: 'Aumentar banheiros' }).click(); await p.getByRole('button', { name: 'Aumentar salas' }).click();
  assert.equal(await p.locator('#comodo-quartos-valor').getAttribute('aria-label'), 'Quartos, 3', 'leitor de tela anuncia o valor');
  await p.waitForSelector('[data-sugestao="4"]'); // 5 cômodos -> 4h (tabela residencial)
  assert.equal(await p.locator('input[name=duracaoHoras][value="2"]').isDisabled(), true, '5 cômodos: 2h fora do limite');
  await marcar(p, 'semLocalAlmoco', 'nao'); await continuar(p);
  await marcar(p, 'quantidade', 'varias'); await continuar(p);
  await marcar(p, 'modo', 'datas_escolhidas');
  await escolherData(p, D1); await escolherData(p, SAB);
  assert.deepEqual(await p.locator('.suas-datas li').evaluateAll((l) => l.map((x) => x.dataset.data)), [D1, SAB].sort());
  await continuar(p);
  await marcar(p, 'horario', '08:00'); await continuar(p);
  assert.equal(await titulo(p), 'Deseja manter este horário nas próximas diárias?');
  await marcar(p, 'manterHorario', 'nao');
  await marcar(p, `horario-${SAB}`, '13:00'); await registrar(p, '08-repetir'); await continuar(p);
  await dadosNovos(p, { cpf: '27418596391' }); await continuar(p);
  await p.waitForSelector('[data-valor=total]');
  // 4h 175 + sem local pra refeição 25 = 200 por diária; sábado +20 = 220 -> 420
  assert.equal(await p.locator('[data-valor=total]').textContent(), 'R$ 420,00');
  assert.equal(await p.locator('[data-valor=diaria]').textContent(), 'de R$ 200,00 a R$ 220,00 por diária');
  const hor = await p.locator('[data-bloco=horarios]').textContent();
  assert.match(hor, /às 08:00/); assert.match(hor, /às 13:00/);
  await enviar(p);
  conferirTransversais(p, 4);
  assert.deepEqual(p.erros, []);
});

t.teste('empresarial recorrente semanal com o mesmo horário: 4 datas geradas, frequência na revisão, dados de empresa', async () => {
  const p = await novaPagina(375);
  await ateLocal(p, { onde: 'empresa', servico: 'empresarial', cep: '32010000' });
  await p.fill('#metragem', '55'); await p.waitForSelector('[data-sugestao="4"]'); // 55 m² comercial: 4h
  await marcar(p, 'semLocalAlmoco', 'sim'); await continuar(p);
  await marcar(p, 'quantidade', 'varias'); await continuar(p);
  await marcar(p, 'modo', 'recorrente'); await marcar(p, 'frequencia', 'semanal');
  await escolherData(p, D1);
  assert.equal(await p.locator('.suas-datas li').count(), 4, 'padrão: 4 diárias');
  await continuar(p);
  await marcar(p, 'horario', '13:00'); await continuar(p);
  await marcar(p, 'manterHorario', 'sim'); await continuar(p);
  await p.fill('#responsavel', 'Carlos Novo Teste'); await p.fill('#telefone', '31944443333'); await p.fill('#email', `empresa-${Date.now()}@exemplo.com`);
  await p.fill('#cnpj', '11222333000181'); await p.fill('#razaoSocial', 'Empresa Nova Fictícia Ltda'); await continuar(p);
  await p.waitForSelector('[data-valor=total]');
  assert.match(await p.locator('[data-bloco=frequencia]').textContent(), /Semanal, 4 diárias/);
  assert.match(await p.locator('[data-bloco=horarios]').textContent(), /13:00 em todas as datas/);
  // 175 + empresarial 10 + Contagem 10 = 195 por diária x 4 (desconto de 20 se 3+ no mesmo mês)
  const total = await p.locator('[data-valor=total]').textContent();
  assert.ok(['R$ 780,00', 'R$ 760,00', 'R$ 740,00'].includes(total), total);
  await enviar(p);
  assert.match(await p.locator('[data-passo=enviado]').textContent(), /6 primeiros caracteres do CNPJ/);
  assert.deepEqual(p.erros, []);
});

t.teste('cliente entra no meio do fluxo: dados vêm do cadastro e travados, sem perder o rascunho; envio leva ao acompanhamento', async () => {
  const p = await novaPagina(375);
  await ateLocal(p);
  await p.fill('#metragem', '70'); await marcar(p, 'semLocalAlmoco', 'sim'); await continuar(p);
  await marcar(p, 'quantidade', 'uma'); await continuar(p);
  await escolherData(p, D2); await continuar(p);
  await marcar(p, 'horario', '10:00'); await continuar(p);
  await p.getByRole('button', { name: 'Já é cliente? Entrar' }).click();
  await p.fill('#entrar-identificador', C.clientes[0].email); await p.fill('#entrar-senha', C.clientes[0].senha);
  await p.getByRole('button', { name: 'Entrar', exact: true }).click();
  await p.waitForSelector('[data-travados]');
  assert.match(await p.locator('[data-travados]').textContent(), /Ana Teste Fictícia/);
  assert.equal(await p.locator('#nome').count(), 0, 'sem campo editável');
  await continuar(p);
  await p.waitForSelector('[data-valor=total]');
  assert.equal(await p.locator('#aceite-termos').count(), 0, 'logada: termos já aceitos');
  assert.equal(await p.getByRole('button', { name: 'ENVIAR SOLICITAÇÃO' }).isDisabled(), true, 'sem aceite: desabilitado');
  await p.locator('#aceite-condicoes').check();
  await p.getByRole('button', { name: 'ENVIAR SOLICITAÇÃO' }).click();
  await p.waitForSelector('[data-passo=enviado]');
  assert.match(await p.locator('[data-passo=enviado] a.btn').getAttribute('href'), /acompanhamento\/\?pedido=/);
  assert.deepEqual(p.erros, []);
});

t.teste('CEP: fora da área para no passo 2; Nova Lima mostra "Falar com a Prime"; ViaCEP fora cai na cidade manual; resposta atrasada não vale', async () => {
  const p = await novaPagina(375, { atrasar: { 30130010: 1500 } });
  await p.goto(`${base}autoagendamento/`); await p.waitForSelector('#titulo-passo');
  await marcar(p, 'tipoCliente', 'residencial'); await marcar(p, 'tipoServico', 'residencial'); await continuar(p);
  await p.fill('#cep', '35400000'); await p.waitForSelector('[data-regiao=nao-atendida]');
  await continuar(p);
  assert.equal(await titulo(p), 'Vamos verificar se atendemos sua região.', 'não segue');
  await p.fill('#cep', '34000000'); await p.waitForSelector('[data-regiao=sob-consulta]');
  assert.equal(await p.locator('[data-regiao=sob-consulta]').getByText('Falar com a Prime').count(), 1);
  await continuar(p); assert.equal(await titulo(p), 'Vamos verificar se atendemos sua região.');
  await p.fill('#cep', '99999999'); await p.waitForSelector('#cidade-manual');
  await p.selectOption('#cidade-manual', 'Belo Horizonte'); await p.waitForSelector('[data-regiao=atendida]');
  // atrasada: 30130010 (BH) responde depois do 32010000 (Contagem); vale o último digitado
  await p.fill('#cep', '30130010'); await p.fill('#cep', '32010000');
  await p.waitForFunction(() => /Contagem/.test(document.querySelector('[data-regiao=atendida]')?.textContent || ''));
  await p.waitForTimeout(1800);
  assert.match(await p.locator('[data-regiao=atendida]').textContent(), /Contagem/);
  assert.deepEqual(p.erros, []);
});

t.teste('passos vazios não avançam (erro visível e foco); zero cômodos pede pelo menos um; 2h acima do limite fica bloqueada', async () => {
  const p = await novaPagina(375);
  await p.goto(`${base}autoagendamento/`); await p.waitForSelector('#titulo-passo');
  await continuar(p);
  assert.match(await p.locator('[data-campo=tipoCliente] .erro-campo').textContent(), /Escolha onde/);
  await marcar(p, 'tipoCliente', 'residencial'); await continuar(p);
  assert.match(await p.locator('[data-campo=tipoServico] .erro-campo').textContent(), /Escolha o serviço/);
  await marcar(p, 'tipoServico', 'residencial'); await continuar(p);
  await p.fill('#cep', '30130010'); await p.waitForSelector('[data-regiao=atendida]'); await continuar(p);
  await continuar(p);
  assert.match(await p.locator('[data-campo=numero] .erro-campo').textContent(), /número/);
  await p.fill('#numero', '5'); await continuar(p);
  await p.getByRole('button', { name: 'Não sei a metragem' }).click(); await continuar(p);
  assert.match(await p.locator('.alerta-erro[role=alert]').textContent(), /pelo menos um cômodo/);
  await p.getByRole('button', { name: 'Sei a metragem' }).click();
  await p.fill('#metragem', '31');
  assert.equal(await p.locator('input[name=duracaoHoras][value="2"]').isDisabled(), true, '31 m²: sem 2h');
  await p.fill('#metragem', '25');
  assert.equal(await p.locator('input[name=duracaoHoras][value="2"]').isDisabled(), false);
  await continuar(p);
  assert.match(await p.locator('[data-campo=semLocalAlmoco] .erro-campo').textContent(), /refeição/);
  assert.deepEqual(p.erros, []);
});

t.teste('voltar do navegador, recarregar e deep link da home: nada se perde; CPF não fica salvo; ?servico= cai no CEP', async () => {
  const p = await novaPagina(375);
  await ateLocal(p);
  await p.fill('#metragem', '45'); await marcar(p, 'semLocalAlmoco', 'sim'); await continuar(p);
  await p.waitForSelector('[data-passo=quantidade]');
  await p.goBack(); await p.waitForSelector('[data-passo=local]');
  assert.equal(await p.inputValue('#metragem'), '45', 'voltar mantém o que foi preenchido');
  await p.goBack(); await p.waitForSelector('[data-passo=endereco]');
  assert.equal(await p.inputValue('#numero'), '100');
  await p.goForward(); await p.waitForSelector('[data-passo=local]');
  await continuar(p); await marcar(p, 'quantidade', 'uma'); await continuar(p);
  await escolherData(p, D1); await continuar(p); await marcar(p, 'horario', '08:00'); await continuar(p);
  await dadosNovos(p); await continuar(p); await p.waitForSelector('[data-valor=total]');
  const salvo = await p.evaluate(() => localStorage.getItem('prime.rascunho.agendamento.v2'));
  assert.ok(!/36192847509|361\.928|1990-03-07/.test(salvo), 'CPF e nascimento fora do localStorage');
  await p.reload(); await p.waitForSelector('[data-passo=dados]');
  assert.equal(await p.inputValue('#nome'), 'Ana Nova Fictícia', 'recarregar mantém o resto');
  assert.equal(await p.inputValue('#cpf'), '', 'CPF pedido de novo');
  const q = await novaPagina(375);
  await q.goto(`${base}autoagendamento/?servico=condominial`); await q.waitForSelector('[data-passo=cep]');
  await q.getByRole('button', { name: 'Voltar' }).click(); await q.waitForSelector('[data-passo=servico]').catch(() => {});
  assert.deepEqual(p.erros, []); assert.deepEqual(q.erros, []);
});

t.teste('teclado: contadores e calendário (setas, Enter, PageDown) e cards; leitor de tela lê a data e o estado', async () => {
  const p = await novaPagina(375);
  await ateLocal(p);
  await p.getByRole('button', { name: 'Não sei a metragem' }).click();
  await p.getByRole('button', { name: 'Aumentar quartos' }).focus(); await p.keyboard.press('Enter'); await p.keyboard.press('Space');
  assert.equal(await p.locator('#comodo-quartos-valor').textContent(), '2');
  await marcar(p, 'semLocalAlmoco', 'sim'); await continuar(p);
  await p.locator('input[name=quantidade][value=uma]').focus(); await p.keyboard.press('Space'); await continuar(p);
  await p.locator('.cal-dia[tabindex="0"]').focus();
  await p.keyboard.press('PageDown'); await p.keyboard.press('ArrowRight');
  const alvo = await p.evaluate(() => document.activeElement.dataset.dia);
  const rotulo = await p.evaluate(() => document.activeElement.getAttribute('aria-label'));
  assert.match(rotulo, /^(domingo|segunda|terça|quarta|quinta|sexta|sábado), \d+ de \w+ de \d{4}/);
  if (!/indisponível/.test(rotulo)) {
    await p.keyboard.press('Enter');
    assert.equal(await p.locator(`.cal-dia[data-dia="${alvo}"]`).getAttribute('aria-pressed'), 'true');
    assert.match(await p.locator(`.cal-dia[data-dia="${alvo}"]`).getAttribute('aria-label'), /escolhida/);
  }
  assert.deepEqual(p.erros, []);
});

t.teste('sem overflow horizontal em 320 px em nenhuma etapa; detalhes do serviço abrem e fecham com foco devolvido', async () => {
  const p = await novaPagina(320);
  const ruins = [];
  const medir = async (nome) => { const w = await p.evaluate(() => document.documentElement.scrollWidth); if (w > 320) ruins.push(`${nome}: ${w} ${await p.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > 320.5).slice(0, 4).map((e) => `${e.tagName}.${e.className}`.slice(0, 60)).join(','))}`); };
  await p.goto(`${base}autoagendamento/`); await p.waitForSelector('#titulo-passo'); await medir('servico');
  await marcar(p, 'tipoCliente', 'residencial'); await marcar(p, 'tipoServico', 'residencial');
  const ver = p.getByRole('button', { name: 'Ver detalhes do serviço' });
  await ver.click(); await p.waitForSelector('dialog[open]');
  assert.match(await p.locator('dialog[open]').textContent(), /O que está incluído/);
  await p.keyboard.press('Escape'); await p.waitForSelector('dialog[open]', { state: 'detached' });
  assert.equal(await p.evaluate(() => document.activeElement?.dataset.acao), 'ver-detalhes');
  await continuar(p); await p.fill('#cep', '30130010'); await p.waitForSelector('[data-regiao=atendida]'); await medir('cep'); await continuar(p);
  await p.fill('#numero', '1'); await medir('endereco'); await continuar(p);
  await p.getByRole('button', { name: 'Não sei a metragem' }).click(); await medir('local'); await p.getByRole('button', { name: 'Aumentar salas' }).click();
  await marcar(p, 'semLocalAlmoco', 'sim'); await continuar(p); await medir('quantidade');
  await marcar(p, 'quantidade', 'varias'); await continuar(p); await medir('datas');
  await escolherData(p, D1); await escolherData(p, D2); await continuar(p); await medir('horario');
  await marcar(p, 'horario', '08:00'); await continuar(p); await marcar(p, 'manterHorario', 'nao'); await medir('repetir'); await continuar(p);
  await dadosNovos(p); await medir('dados'); await continuar(p); await p.waitForSelector('[data-valor=total]'); await medir('revisao');
  await p.getByRole('button', { name: 'Condições do atendimento' }).click(); await p.waitForSelector('dialog[open] h2');
  await p.waitForFunction(() => /Cancelamento e remarcação/.test(document.querySelector('dialog[open]')?.textContent || ''));
  await medir('condicoes'); await p.getByRole('button', { name: 'Fechar' }).click();
  assert.deepEqual(ruins, [], ruins.join(' | '));
  assert.deepEqual(p.erros, []);
});

if (SHOTS) {
  t.teste('--shots: cada etapa em 375 e 1440 (várias datas, horários individuais), detalhes do serviço e condições', async () => {
    for (const largura of [375, 1440]) {
      const p = await novaPagina(largura);
      await p.goto(`${base}autoagendamento/`); await registrar(p, '01-servico');
      await marcar(p, 'tipoCliente', 'residencial'); await marcar(p, 'tipoServico', 'residencial'); await registrar(p, '01b-servico-escolhido');
      await p.getByRole('button', { name: 'Ver detalhes do serviço' }).click(); await p.waitForSelector('dialog[open]');
      await p.screenshot({ path: `${PASTA}/01c-detalhes-${largura}.png` }); await p.keyboard.press('Escape');
      await continuar(p); await p.fill('#cep', '30130010'); await p.waitForSelector('[data-regiao=atendida]'); await registrar(p, '02-cep'); await continuar(p);
      await p.fill('#numero', '100'); await p.fill('#complemento', 'apto 201'); await registrar(p, '03-endereco'); await continuar(p);
      await p.getByRole('button', { name: 'Não sei a metragem' }).click();
      for (const k of ['quartos', 'quartos', 'banheiros', 'salas', 'cozinhas']) await p.getByRole('button', { name: `Aumentar ${k}` }).click();
      await marcar(p, 'semLocalAlmoco', 'sim'); await registrar(p, '04-local'); await continuar(p);
      await marcar(p, 'quantidade', 'varias'); await registrar(p, '05-quantidade'); await continuar(p);
      await marcar(p, 'modo', 'datas_escolhidas'); await escolherData(p, D1); await escolherData(p, D2); await registrar(p, '06-datas'); await continuar(p);
      await marcar(p, 'horario', '08:30'); await registrar(p, '07-horario'); await continuar(p);
      await marcar(p, 'manterHorario', 'nao'); await marcar(p, `horario-${D2}`, '13:00'); await registrar(p, '08-repetir'); await continuar(p);
      await dadosNovos(p); await registrar(p, '09-dados'); await continuar(p);
      await p.waitForSelector('[data-valor=total]'); await registrar(p, '10-revisao');
      await p.getByRole('button', { name: 'Condições do atendimento' }).click();
      await p.waitForFunction(() => /Cancelamento e remarcação/.test(document.querySelector('dialog[open]')?.textContent || ''));
      await p.screenshot({ path: `${PASTA}/10b-condicoes-${largura}.png` }); await p.keyboard.press('Escape');
      await p.locator('#aceite-condicoes').check(); await p.locator('#aceite-termos').check();
      await p.getByRole('button', { name: 'ENVIAR SOLICITAÇÃO' }).click(); await p.waitForSelector('[data-passo=enviado]'); await registrar(p, '11-enviado');
      assert.deepEqual(p.erros, []);
    }
  });
}

const falhas = await t.fim();
await b.close(); await fechar();
process.exit(falhas ? 1 : 0);
