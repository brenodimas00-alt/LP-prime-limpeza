// Autoagendamento v3 no navegador (mock), spec-agendamento-v3 + 56 itens da cliente. Cresce a cada entrega (V2 a V5).
// node scripts/testa-v3-navegador.mjs [--shots]   (--shots grava as telas em 375 e 1440 em ~/.claude/build/build-20261006-agendamento-v3/shots/)
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { criarSuite, assert } from './lib-teste.mjs';
import { abrirNavegador, subirServidor, horarioComercial } from './pw.mjs';
import { CREDENCIAIS_MOCK as C } from './fixtures/seed.js';
import { dataNoFuso } from '../src/domain/calendario.js';
import { TIPOS_IMOVEL, T3 } from '../src/config/agendamento-v3.js';

const SHOTS = process.argv.includes('--shots');
const PASTA = `${homedir()}/.claude/build/build-20261006-agendamento-v3/shots`;
if (SHOTS) mkdirSync(PASTA, { recursive: true });
const t = criarSuite('agendamento v3 navegador (mock)');
const { base, fechar } = await subirServidor();
const b = await abrirNavegador();
const HOJE = dataNoFuso(horarioComercial());
const VIACEP = {
  30130010: { logradouro: 'Rua Fictícia', bairro: 'Savassi', localidade: 'Belo Horizonte', uf: 'MG' },
  32010000: { logradouro: 'Avenida Exemplo', bairro: 'Centro', localidade: 'Contagem', uf: 'MG' },
  35400000: { logradouro: 'Rua Direita', bairro: 'Centro', localidade: 'Ouro Preto', uf: 'MG' },
  34000000: { logradouro: 'Alameda Teste', bairro: 'Centro', localidade: 'Nova Lima', uf: 'MG' },
};
const URL_V3 = () => `${base}autoagendamento/`;

async function novaPagina(largura = 375, { atrasar } = {}) {
  const ctx = await b.newContext({ viewport: { width: largura, height: 860 }, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  p.erros = []; p.largura = largura;
  p.on('console', (m) => m.type() === 'error' && !/viacep/.test(m.location()?.url || '') && p.erros.push(m.text()));
  p.on('pageerror', (e) => p.erros.push(e.message));
  await ctx.route('https://viacep.com.br/**', async (route) => {
    const cep = route.request().url().match(/ws\/(\d{8})/)[1];
    if (cep === '99999999') return route.abort();
    if (atrasar?.[cep]) await new Promise((r) => setTimeout(r, atrasar[cep]));
    return route.fulfill({ json: VIACEP[cep] || { erro: true } });
  });
  await ctx.route('**/src/config/prime.js', (route) => route.fulfill({ path: 'src/config/prime.teste.js', contentType: 'text/javascript' }));
  return p;
}
const titulo = (p) => p.locator('#titulo-passo').textContent();
const passo = (p) => p.locator('[data-passo]').first().getAttribute('data-passo');
const continuar = (p) => p.getByRole('button', { name: 'Continuar', exact: true }).click();
const marcar = (p, nome, valor) => p.locator(`input[name="${nome}"][value="${valor}"]`).evaluate((i) => { if (!i.checked) i.click(); });
async function foto(p, nome) { if (SHOTS) await p.screenshot({ path: `${PASTA}/${nome}-${p.largura}.png`, fullPage: true }); }
async function semOverflow(p) {
  const larg = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  assert.ok(larg[0] <= larg[1], `overflow horizontal em ${p.largura}px: ${larg[0]} > ${larg[1]}`);
}

async function ateIdentificacao(p, { segmento = 'residencial', servico = 'residencial' } = {}) {
  await p.goto(URL_V3()); await p.waitForSelector('[data-passo=servico]');
  await marcar(p, 'segmento', segmento); await marcar(p, 'servico', servico); await continuar(p);
  await p.waitForSelector('[data-passo=identificacao]');
}
async function cadastroNovo(p, { nome = 'Ana Nova Fictícia', cpf = '36192847509', email = `nova-${Date.now()}@exemplo.com` } = {}) {
  await marcar(p, 'identificacao', 'novo'); await continuar(p); await p.waitForSelector('[data-passo=cadastro]');
  await p.fill('#nome', nome); await p.fill('#telefone', '31955554444');
  await p.getByRole('button', { name: 'Confirmar número' }).click();
  await p.fill('#email', email); await p.fill('#cpf', cpf); await p.fill('#dataNascimento', '1990-03-07');
  await continuar(p); await p.waitForSelector('[data-passo=endereco]');
}
async function enderecoNovo(p, { cep = '30130010', uso = 'salvar', apelido = '', tipo = 'Apartamento' } = {}) {
  await p.fill('#cep', cep); await p.waitForSelector('[data-regiao=atendida]');
  await p.fill('#numero', '100'); await p.selectOption('#tipoImovel', tipo);
  await marcar(p, 'usoEndereco', uso);
  if (apelido) await p.fill('#apelido', apelido);
}

t.teste('V2 serviço: "Onde será realizado o atendimento?", cabeçalho novo, "Ver mais" de cada card só com as restrições daquele serviço', async () => {
  const p = await novaPagina(375);
  await p.goto(URL_V3()); await p.waitForSelector('[data-passo=servico]');
  const corpo = await p.evaluate(() => document.body.innerText);
  assert.match(corpo, /Onde será realizado o atendimento\?/);
  assert.match(corpo, /Falta pouco para concluir sua solicitação\./);
  assert.ok(!/Leva uns 3 minutos|Onde será realizada a limpeza|Ver detalhes do serviço/.test(corpo), 'textos antigos sumiram');
  await marcar(p, 'segmento', 'residencial');
  assert.equal(await p.locator('[data-ver-mais]').count(), 4, 'um "Ver mais" por card');
  await foto(p, '01-servico');
  await p.locator('[data-ver-mais=passadoria]').click();
  const painel = await p.locator('dialog.painel-lateral').innerText();
  assert.match(painel, /lavagem de roupas/);
  assert.ok(!/piscina|jardinagem|remoção de cera|cozinha industrial/.test(painel), 'restrições de limpeza fora da passadoria');
  await p.getByRole('button', { name: 'Fechar' }).click();
  await p.locator('[data-ver-mais=residencial]').click();
  assert.match(await p.locator('dialog.painel-lateral').innerText(), /piscina/);
  await p.getByRole('button', { name: 'Fechar' }).click();
  await semOverflow(p);
  assert.deepEqual(p.erros, []);
});

t.teste('V2 identificação: JÁ SOU CLIENTE / AINDA NÃO SOU CLIENTE, sem pedir CEP antes; "já sou" abre o login sem sair do fluxo', async () => {
  const p = await novaPagina(375);
  await ateIdentificacao(p);
  const corpo = await p.evaluate(() => document.body.innerText);
  for (const x of ['JÁ SOU CLIENTE', 'Já tenho cadastro', 'AINDA NÃO SOU CLIENTE', 'Quero me cadastrar']) assert.ok(corpo.includes(x), x);
  assert.equal(await p.locator('#cep').count(), 0, 'sem CEP antes da identificação');
  await continuar(p);
  assert.match(await p.locator('[data-campo=identificacao] .erro-campo').textContent(), /Escolha uma opção/);
  await marcar(p, 'identificacao', 'cliente');
  await p.waitForSelector('#entrar-identificador');
  await continuar(p);
  assert.match(await p.locator('.alerta-erro[role=alert]:not([hidden])').textContent(), /Entre com seus dados de acesso/);
  await p.fill('#entrar-identificador', C.clientes[0].email); await p.fill('#entrar-senha', C.clientes[0].senha);
  await p.getByRole('button', { name: 'Entrar', exact: true }).click();
  await p.waitForSelector('[data-passo=endereco]');
  await foto(p, '03-endereco-salvo');
  // endereço salvo do cadastro, com substituir e solicitar remoção (WhatsApp com o endereço na mensagem)
  assert.equal(await p.locator('[data-acao=substituir]').count(), 1);
  const href = await p.locator('[data-acao=solicitar-remocao]').getAttribute('href');
  assert.match(decodeURIComponent(href), /Olá! Gostaria de solicitar a remoção deste endereço do meu cadastro na Prime: Rua Fictícia, 100, apto 201 - Savassi, Belo Horizonte\/MG\./);
  await continuar(p);
  assert.notEqual(await passo(p), 'endereco', 'endereço salvo segue');
  assert.deepEqual(p.erros, []);
});

t.teste('V2 cadastro: nome de uma palavra, CPF só valida com 11 dígitos (check "CPF válido"), menor de idade e WhatsApp confirmado na mesma tela', async () => {
  const p = await novaPagina(375);
  await ateIdentificacao(p);
  await marcar(p, 'identificacao', 'novo'); await continuar(p); await p.waitForSelector('[data-passo=cadastro]');
  await p.fill('#nome', 'Isabela'); await p.fill('#telefone', '31955554444');
  await p.fill('#email', 'isa@exemplo.com'); await p.fill('#dataNascimento', '1990-03-07');
  await p.fill('#cpf', '529.982');
  assert.equal(await p.locator('[data-campo=cpf] .erro-campo').textContent(), '', 'incompleto: sem erro');
  await p.fill('#cpf', '52998224724');
  assert.equal(await p.locator('[data-campo=cpf] .erro-campo').textContent(), 'CPF inválido. Confira o número informado.');
  await p.fill('#cpf', '52998224725');
  assert.equal(await p.locator('#cpf-ok').isVisible(), true);
  assert.match(await p.locator('#cpf-ok').textContent(), /CPF válido/);
  assert.equal(await p.locator('#cpf').inputValue(), '529.982.247-25', 'máscara');
  // WhatsApp: a confirmação aparece depois do número válido, na mesma tela
  assert.match(await p.locator('#confirma-whatsapp').innerText(), /Confirme seu WhatsApp[\s\S]*\(31\) 95555-4444/);
  await foto(p, '02-cadastro');
  await continuar(p);
  assert.equal(await p.locator('[data-campo=nome] .erro-campo').textContent(), 'Informe seu nome completo.');
  await p.fill('#nome', 'Isabela Souza');
  await continuar(p);
  assert.match(await p.locator('[data-campo=telefone] .erro-campo').textContent(), /Confirme seu WhatsApp/);
  await p.getByRole('button', { name: 'Confirmar número' }).click();
  // menor de idade pela data completa: faz 18 amanhã
  const y = Number(HOJE.slice(0, 4)) - 18; const amanha = new Date(Date.parse(`${HOJE}T12:00:00Z`) + 86400000).toISOString().slice(5, 10);
  await p.fill('#dataNascimento', `${y}-${amanha}`); await p.locator('#dataNascimento').blur();
  assert.equal(await p.locator('[data-campo=dataNascimento] .erro-campo').textContent(), 'É necessário ter 18 anos ou mais para realizar uma solicitação.');
  await continuar(p);
  assert.equal(await passo(p), 'cadastro', 'menor não segue');
  await p.fill('#dataNascimento', `${y}-${HOJE.slice(5, 10)}`); // 18 hoje
  await continuar(p);
  await p.waitForSelector('[data-passo=endereco]');
  // cadastro salvo: CPF e nascimento nunca no aparelho
  const ls = await p.evaluate(() => JSON.stringify(localStorage));
  assert.ok(!ls.includes('52998224725') && !ls.includes('529.982.247-25'), 'CPF fora do localStorage');
  assert.match(ls, /"ticket\\?":\\?"[0-9a-f]{64}/, 'ticket do cadastro salvo no rascunho');
  assert.deepEqual(p.erros, []);
});

t.teste('V2 cadastro salvo mesmo sem enviar (item 34): CPF existente responde igual (ticket do mesmo formato), sem mexer no cadastro', async () => {
  const p = await novaPagina(375);
  await ateIdentificacao(p);
  await cadastroNovo(p, { nome: 'Outra Pessoa Fictícia', cpf: C.clientes[0].cpf, email: `outra-${Date.now()}@exemplo.com` });
  const ticket = await p.evaluate(() => JSON.parse(localStorage.getItem('prime.rascunho.agendamento.v3')).ticket);
  assert.match(ticket, /^[0-9a-f]{64}$/);
  // a cliente dona do CPF continua com o nome dela (entra e confere em Minha conta pelo adapter)
  const nome = await p.evaluate(async () => {
    const { api } = await import(new URL('src/services/api.js', document.baseURI.replace(/autoagendamento\/.*$/, '')).href);
    return (await api.obterMeuCadastro({ sessao: { ator: 'cliente', id: '00000000-0000-4000-8000-00000000c001' } })).nome;
  });
  assert.equal(nome, C.clientes[0].nome);
  assert.deepEqual(p.erros, []);
});

t.teste('V2 endereço: CEP fora da área (texto do item 6 + "Falar com a Prime", não segue); atendido abre os campos; tipo do imóvel por segmento; "Outro"; apelido só no salvo', async () => {
  const p = await novaPagina(375);
  await ateIdentificacao(p);
  await cadastroNovo(p);
  assert.equal(await titulo(p), 'Informe o CEP do local do atendimento');
  assert.match(await p.locator('.sub-passo').textContent(), /Vamos verificar se atendemos sua região\./);
  await p.fill('#cep', '35400000'); await p.waitForSelector('[data-regiao=nao-atendida]');
  const fora = await p.locator('[data-regiao=nao-atendida]').innerText();
  assert.match(fora, /No momento, não atendemos esta região\.[\s\S]*Se quiser confirmar a possibilidade de atendimento para este endereço, entre em contato diretamente com a Prime\./);
  assert.equal(await p.locator('[data-regiao=nao-atendida] [data-whatsapp=manual]').count(), 1);
  assert.match(await p.locator('[data-regiao=nao-atendida] [data-whatsapp=manual]').innerText(), /Falar com a Prime/);
  await continuar(p); assert.equal(await passo(p), 'endereco');
  await p.fill('#cep', '30130010'); await p.waitForSelector('[data-regiao=atendida]');
  assert.match(await p.locator('.detalhes-endereco').innerText(), /Informe o endereço do atendimento[\s\S]*Informe bloco, torre, andar, apartamento ou sala, se houver\.[\s\S]*Ponto de referência[\s\S]*O objetivo é facilitar a localização pela profissional\./);
  const opcoes = await p.locator('#tipoImovel option').allTextContents();
  assert.deepEqual(opcoes.slice(1), TIPOS_IMOVEL.residencial, 'tipos do residencial');
  await p.selectOption('#tipoImovel', 'Outro');
  await p.waitForSelector('#tipoImovelOutro');
  assert.match(await p.locator('label[for=tipoImovelOutro]').textContent(), /Informe o tipo do imóvel/);
  await p.fill('#numero', '12');
  await continuar(p);
  assert.match(await p.locator('[data-campo=tipoImovelOutro] .erro-campo').textContent(), /Informe o tipo do imóvel/);
  await p.fill('#tipoImovelOutro', 'Sítio');
  await continuar(p);
  assert.match(await p.locator('[data-campo=usoEndereco] .erro-campo').textContent(), /Escolha como deseja utilizar/);
  await marcar(p, 'usoEndereco', 'unico');
  assert.equal(await p.locator('#apelido').count(), 0, 'uso único não pede identificação');
  await marcar(p, 'usoEndereco', 'salvar');
  assert.match(await p.locator('[data-campo=apelido]').innerText(), /Identificação do endereço \(opcional\)[\s\S]*Ex\.: Minha casa, Escritório, Galpão \(bairro\)\./);
  await foto(p, '03-endereco-novo');
  await semOverflow(p);
  await continuar(p);
  assert.equal(await passo(p), 'local');
  assert.deepEqual(p.erros, []);
});

t.teste('V2 empresarial: tipos de imóvel empresariais; responsável com nome completo e CNPJ', async () => {
  const p = await novaPagina(1440);
  await ateIdentificacao(p, { segmento: 'empresa', servico: 'empresarial' });
  await marcar(p, 'identificacao', 'novo'); await continuar(p); await p.waitForSelector('[data-passo=cadastro]');
  await p.fill('#responsavel', 'Carlos'); await p.fill('#razaoSocial', 'Empresa Nova Ltda'); await p.fill('#cnpj', '11222333000181');
  await p.fill('#telefone', '31955554444'); await p.getByRole('button', { name: 'Confirmar número' }).click(); await p.fill('#email', `emp-${Date.now()}@exemplo.com`);
  await continuar(p);
  assert.equal(await p.locator('[data-campo=responsavel] .erro-campo').textContent(), 'Informe o nome completo do responsável.');
  await p.fill('#responsavel', 'Carlos Lima'); await continuar(p);
  await p.waitForSelector('[data-passo=endereco]');
  await p.fill('#cep', '32010000'); await p.waitForSelector('[data-regiao=atendida]');
  assert.deepEqual((await p.locator('#tipoImovel option').allTextContents()).slice(1), TIPOS_IMOVEL.empresa);
  await foto(p, '03-endereco-empresa');
  assert.deepEqual(p.erros, []);
});

t.teste('V2 voltar do navegador e recarregar mantêm o rascunho (sem CPF); deep link ?servico= cai na identificação', async () => {
  const p = await novaPagina(375);
  await p.goto(`${base}autoagendamento/?servico=passadoria`);
  await p.waitForSelector('[data-passo=identificacao]');
  assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('prime.rascunho.agendamento.v3')).servico), 'passadoria');
  assert.equal(await p.evaluate(() => location.search), '', 'a URL perde o ?servico=');
  await p.goto(URL_V3()); await p.waitForSelector('[data-passo=identificacao]');
  await marcar(p, 'identificacao', 'novo'); await continuar(p); await p.waitForSelector('[data-passo=cadastro]');
  await p.fill('#nome', 'Bia Rascunho'); await p.fill('#cpf', '52998224725');
  await p.reload(); await p.waitForSelector('[data-passo=cadastro]');
  assert.equal(await p.locator('#nome').inputValue(), 'Bia Rascunho');
  assert.equal(await p.locator('#cpf').inputValue(), '', 'CPF não volta do aparelho');
  await p.goBack(); await p.waitForSelector('[data-passo=identificacao]');
  assert.deepEqual(p.erros, []);
});

async function ateLocal(p, { segmento = 'residencial', servico = 'residencial' } = {}) {
  await ateIdentificacao(p, { segmento, servico });
  await cadastroNovo(p, segmento === 'empresa' ? { empresa: true } : {});
  await enderecoNovo(p, { cep: segmento === 'empresa' ? '32010000' : '30130010', tipo: segmento === 'empresa' ? 'Escritório' : 'Apartamento' });
  await continuar(p); await p.waitForSelector('[data-passo=local]');
}
const animaisNao = (p) => marcar(p, 'animais', 'nao');
const refeicao = (p, v = 'sim') => marcar(p, 'localRefeicao', v);
const sugestao = (p) => p.locator('#sugestao [data-sugestao]').getAttribute('data-sugestao');

// Bug da cliente (20/10/2026): "não consigo voltar pra etapa 1; só vai pra frente". O Voltar era history.back(): quem abre o
// agendamento com o rascunho já adiantado (fechou e abriu, link da home com ?servico=) não tem a etapa anterior no histórico,
// e o Voltar saía da página; ao voltar pelo "Agendar", o rascunho reabria na mesma etapa.
const naPagina = (p) => assert.match(p.url(), /autoagendamento\/(\?|$)/, `saiu do agendamento: ${p.url()}`);
const passoAtual = (p) => p.locator('[data-passo]').first().getAttribute('data-passo');
async function voltarAte(p, alvo, max = 8) {
  for (let i = 0; i < max && (await passoAtual(p)) !== alvo; i++) {
    await p.getByRole('button', { name: 'Voltar', exact: true }).click();
    await p.waitForTimeout(150); naPagina(p);
  }
  assert.equal(await passoAtual(p), alvo);
}
for (const largura of [390, 1440]) {
  t.teste(`voltar nunca prende (${largura}): rascunho reaberto, link da home, recarregar no meio e o voltar do navegador chegam na etapa 1`, async () => {
    // fechar e abrir de novo (rascunho salvo)
    const p = await novaPagina(largura);
    await ateIdentificacao(p);
    const q = await p.context().newPage(); await p.close();
    await q.goto(URL_V3()); await q.waitForSelector('[data-passo=identificacao]');
    await voltarAte(q, 'servico');
    // o rascunho continua: a escolha da etapa 1 está lá
    assert.equal(await q.locator('input[name=servico][value=residencial]').isChecked(), true);
    // voltar do navegador, com a página reaberta no meio, também volta uma etapa (e não sai do site)
    await continuar(q); await q.waitForSelector('[data-passo=identificacao]');
    const r = await q.context().newPage(); await q.close();
    await r.goto(URL_V3()); await r.waitForSelector('[data-passo=identificacao]');
    await r.goBack(); await r.waitForSelector('[data-passo=servico]'); naPagina(r);
    // link da home com ?servico=: cai na identificação e o Voltar leva ao serviço
    await r.goto(`${URL_V3()}?servico=passadoria`); await r.waitForSelector('[data-passo=identificacao]');
    await voltarAte(r, 'servico');
    assert.equal(await r.locator('input[name=servico][value=passadoria]').isChecked(), true);
    // recarregar no meio do fluxo (características do local) e voltar até o começo, etapa por etapa
    const s = await novaPagina(largura);
    await ateLocal(s);
    await s.reload(); await s.waitForSelector('[data-passo=local]');
    await voltarAte(s, 'servico');
    assert.deepEqual(s.erros, []);
  });
}

t.teste('indicador de passos: etapas já feitas são botões e levam de volta; a atual e as futuras não', async () => {
  const p = await novaPagina(390);
  await ateLocal(p);
  const ind = p.locator('.progresso-fluxo');
  assert.equal(await ind.getByRole('navigation', { name: 'Etapas da solicitação' }).getByRole('button').count(), 3, 'Serviço, Identificação e Endereço');
  assert.equal(await ind.locator('[aria-current=step]').innerText(), T3.etapas[3]);
  await ind.getByRole('button', { name: `Voltar para a etapa 1: ${T3.etapas[0]}` }).click();
  await p.waitForSelector('[data-passo=servico]'); naPagina(p);
  await p.goBack(); await p.waitForSelector('[data-passo=local]');
  // voltar pelo indicador e depois Voltar: vai pra etapa anterior à do indicador, nunca de volta pra frente
  await p.locator('.progresso-fluxo').getByRole('button', { name: `Voltar para a etapa 3: ${T3.etapas[2]}` }).click();
  await p.waitForSelector('[data-passo=endereco]');
  await p.getByRole('button', { name: 'Voltar', exact: true }).click();
  await p.waitForSelector('[data-passo=cadastro]'); naPagina(p);
});

t.teste('começar de novo: visível depois da etapa 1, pede confirmação, apaga o rascunho e volta ao começo', async () => {
  const p = await novaPagina(390);
  await ateIdentificacao(p);
  const q = await p.context().newPage(); await p.close();
  await q.goto(URL_V3()); await q.waitForSelector('[data-passo=identificacao]');
  const btn = q.getByRole('button', { name: 'Começar de novo' });
  assert.ok(await btn.isVisible());
  await btn.click();
  await q.getByRole('alertdialog').getByRole('button', { name: 'Cancelar' }).click();
  assert.equal(await passoAtual(q), 'identificacao', 'cancelar não apaga nada');
  await btn.click();
  await q.getByRole('alertdialog').getByRole('button', { name: 'Começar de novo' }).click();
  await q.waitForSelector('[data-passo=servico]');
  assert.equal(await q.locator('input[name=servico]:checked').count(), 0, 'rascunho apagado');
  assert.equal(await q.getByRole('button', { name: 'Começar de novo' }).count(), 0, 'na etapa 1 o botão some');
  // o voltar do navegador depois de recomeçar não leva pra uma etapa do rascunho antigo
  await marcar(q, 'segmento', 'residencial');
  await q.goBack(); await q.waitForTimeout(400);
  assert.equal(await passoAtual(q), 'servico'); naPagina(q);
});

t.teste('entrar no meio do fluxo (identificação some): Voltar e o voltar do navegador vão pro serviço, nunca pra frente', async () => {
  const p = await novaPagina(390);
  await ateIdentificacao(p);
  await marcar(p, 'identificacao', 'cliente'); await p.waitForSelector('#entrar-identificador');
  await p.fill('#entrar-identificador', C.clientes[0].email); await p.fill('#entrar-senha', C.clientes[0].senha);
  await p.getByRole('button', { name: 'Entrar', exact: true }).click();
  await p.waitForSelector('[data-passo=endereco]', { timeout: 20000 });
  await p.goBack(); await p.waitForSelector('[data-passo=servico]'); naPagina(p);
  await continuar(p); await p.waitForSelector('[data-passo=endereco]');
  await voltarAte(p, 'servico');
});

t.teste('cliente logada: Voltar do endereço vai pro serviço (sem identificação no meio) e o indicador também leva', async () => {
  const p = await novaPagina(1440);
  await p.goto(URL_V3());
  await p.evaluate((c) => { localStorage.setItem('prime.sessao', JSON.stringify({ ator: 'cliente', id: c.id, nome: c.nome })); localStorage.removeItem('prime.rascunho.agendamento.v3'); }, C.clientes[0]);
  await p.goto(`${URL_V3()}?servico=residencial`); await p.waitForSelector('[data-passo=endereco]');
  // logada não tem identificação: só a etapa 1 vira botão no indicador (nada de botão que não leva a lugar nenhum)
  assert.equal(await p.getByRole('navigation', { name: 'Etapas da solicitação' }).getByRole('button').count(), 1);
  await voltarAte(p, 'servico');
  await continuar(p); await p.waitForSelector('[data-passo=endereco]');
  await p.locator('.progresso-fluxo').getByRole('button', { name: `Voltar para a etapa 1: ${T3.etapas[0]}` }).click();
  await p.waitForSelector('[data-passo=servico]');
});

t.teste('V3 residencial: metragem sem "Não sei a metragem", ambientes − / +, sugestão pela tabela 2, aviso de 120 m² discreto, refeição com a taxa', async () => {
  const p = await novaPagina(375);
  await ateLocal(p);
  assert.equal(await titulo(p), 'Conte um pouco sobre o local');
  const corpo = await p.evaluate(() => document.body.innerText);
  assert.ok(!/Não sei a metragem/.test(corpo));
  assert.match(corpo, /Metragem aproximada \(m²\)[\s\S]*Não precisa ser exata\. Uma estimativa aproximada já é suficiente\./);
  assert.match(corpo, /Há um local disponível para guardar e aquecer a refeição da profissional\?[\s\S]*Será aplicada taxa adicional de R\$25,00\./);
  assert.match(corpo, /Precisa de uma limpeza mais detalhada\?/);
  await p.fill('#metragem', '45');
  await p.getByRole('button', { name: 'Aumentar quartos' }).click();
  assert.equal(await sugestao(p), '4');
  assert.match(await p.locator('#sugestao').innerText(), /Pelas informações do local, sugerimos uma diária de 4 horas\.[\s\S]*Essa sugestão serve apenas como orientação/);
  for (let i = 0; i < 5; i++) await p.getByRole('button', { name: 'Aumentar banheiros' }).click();
  assert.equal(await sugestao(p), '6', 'ambientes acima do esperado sobem uma faixa');
  assert.equal(await p.locator('#aviso-120').isVisible(), false);
  await p.fill('#metragem', '130');
  assert.equal(await p.locator('#aviso-120').isVisible(), true);
  assert.match(await p.locator('#aviso-120').textContent(), /Para imóveis acima de 120 m², recomendamos mais de uma profissional para a realização das tarefas\./);
  await p.fill('#metragem', '45');
  await animaisNao(p); await refeicao(p);
  await foto(p, '04-local');
  await semOverflow(p);
  await continuar(p); await p.waitForSelector('[data-passo=modalidade]');
  assert.deepEqual(p.erros, []);
});

t.teste('V3 duração menor que a sugerida: alerta literal na hora, campo opcional e "Estou ciente e quero continuar"; maior não alerta', async () => {
  const p = await novaPagina(375);
  await ateLocal(p);
  await p.fill('#metragem', '100'); await p.getByRole('button', { name: 'Aumentar quartos' }).click();
  await animaisNao(p); await refeicao(p);
  assert.equal(await sugestao(p), '8');
  await marcar(p, 'duracaoHoras', '4');
  const a = await p.locator('[data-alerta=duracao-menor]').innerText();
  for (const x of ['Atenção!', 'A duração escolhida é menor que a sugerida para as características informadas do atendimento.',
    'Existe alguma particularidade que explique a escolha de uma duração menor?', 'Ex.: desejo realizar o atendimento somente em alguns cômodos.',
    'Informe aqui, se necessário.', 'A duração sugerida é apenas uma referência e pode variar conforme as condições do local, as tarefas solicitadas e o ritmo de execução de cada profissional.',
    'Estou ciente e quero continuar']) assert.ok(a.includes(x), x);
  assert.ok(!/não será suficiente/.test(a));
  await foto(p, '04-alerta');
  await continuar(p); assert.equal(await passo(p), 'local', 'não segue sem o ciente');
  await p.fill('#justificativa', 'Só três cômodos');
  await p.getByRole('button', { name: 'Estou ciente e quero continuar' }).click();
  await continuar(p); await p.waitForSelector('[data-passo=modalidade]');
  await p.goBack(); await p.waitForSelector('[data-passo=local]');
  await marcar(p, 'duracaoHoras', '8');
  assert.equal(await p.locator('[data-alerta=duracao-menor]').count(), 0, 'igual ou maior não alerta');
  assert.deepEqual(p.erros, []);
});

t.teste('V3 passadoria: só peças e tipos (sem metragem, ambientes nem "limpeza mais detalhada"); 20 sociais sugere 6h; acima de 60 orienta dividir', async () => {
  const p = await novaPagina(375);
  await ateLocal(p, { servico: 'passadoria' });
  const corpo = await p.evaluate(() => document.body.innerText);
  assert.ok(!/Metragem|Quartos|Banheiros|Precisa de uma limpeza mais detalhada/.test(corpo));
  assert.match(corpo, /Quantas peças, mais ou menos\?[\s\S]*Quais tipos de peças predominam\?[\s\S]*Delicadas ou tecidos difíceis/);
  for (let i = 0; i < 4; i++) await p.getByRole('button', { name: 'Aumentar peças' }).click();
  await marcar(p, 'tipoPecas', 'basicas'); assert.equal(await sugestao(p), '4');
  assert.match(await p.locator('#sugestao').innerText(), /Pelas informações das peças, sugerimos uma diária de 4 horas\.[\s\S]*equipamento disponível/);
  await marcar(p, 'tipoPecas', 'sociais'); assert.equal(await sugestao(p), '6');
  for (let i = 0; i < 9; i++) await p.getByRole('button', { name: 'Aumentar peças' }).click();
  assert.match(await p.locator('#sugestao').innerText(), /Considere dividir o atendimento em mais de uma diária\./);
  assert.deepEqual(p.erros, []);
});

t.teste('V3 mudança: mobiliado e condição (base 4h, moderada 6h, intensa 8h); eventos: antes/após, ambientes utilizados e condição só após', async () => {
  const p = await novaPagina(375);
  await ateLocal(p, { servico: 'pre_pos_mudanca' });
  await p.fill('#metragem', '45'); await p.getByRole('button', { name: 'Aumentar quartos' }).click();
  await marcar(p, 'mobiliado', 'mobiliado');
  for (const [c, h] of [['leve', '4'], ['moderada', '6'], ['intensa', '8']]) { await marcar(p, 'condicao', c); assert.equal(await sugestao(p), h, c); }
  const q = await novaPagina(375);
  await ateLocal(q, { servico: 'pre_pos_evento' });
  assert.equal(await q.locator('input[name=condicao]').count(), 0, 'condição só depois de "Após o evento"');
  await marcar(q, 'momento', 'depois');
  assert.match(await q.evaluate(() => document.body.innerText), /Como você estima que estará o espaço após o evento\?/);
  await q.fill('#metragem', '45'); for (let i = 0; i < 3; i++) await q.getByRole('button', { name: 'Aumentar quantidade aproximada de ambientes utilizados' }).click();
  await marcar(q, 'condicao', 'intenso'); assert.equal(await sugestao(q), '8');
  await marcar(q, 'momento', 'antes'); assert.equal(await sugestao(q), '4');
  assert.deepEqual([...p.erros, ...q.erros], []);
});

t.teste('V3 animais: Não esconde as quantidades; Sim abre cães, gatos e outros; outros > 0 pede "Qual?"', async () => {
  const p = await novaPagina(375);
  await ateLocal(p);
  assert.equal(await p.locator('[data-contador=animal-caes]').count(), 0);
  await marcar(p, 'animais', 'sim');
  assert.equal(await p.locator('[data-contador=animal-caes]').count(), 1);
  await p.getByRole('button', { name: 'Aumentar outros animais' }).click();
  await p.waitForSelector('#outrosQual');
  await p.fill('#metragem', '45'); await p.getByRole('button', { name: 'Aumentar quartos' }).click(); await refeicao(p, 'nao');
  await continuar(p);
  assert.match(await p.locator('.alerta-erro[role=alert]:not([hidden])').textContent(), /Informe qual animal/);
  await p.fill('#outrosQual', 'Calopsita'); await continuar(p);
  await p.waitForSelector('[data-passo=modalidade]');
  assert.deepEqual(p.erros, []);
});

// ---------- V4: modalidade, datas, horário, configuração ----------
const FERIADOS = (await import('../src/config/precos.js')).CONFIG_PRECOS.feriados;
const { somarDias: soma, diaDaSemana: dds } = await import('../src/domain/calendario.js');
function diaUtil(n) { let d = soma(HOJE, n); while ([0, 6].includes(dds(d)) || FERIADOS.includes(d)) d = soma(d, 1); return d; }
function proximoSabado(n = 2) { let d = soma(HOJE, n); while (dds(d) !== 6 || FERIADOS.includes(d)) d = soma(d, 1); return d; }
function proximoDomingo() { let d = soma(HOJE, 2); while (dds(d) !== 0) d = soma(d, 1); return d; }
const FERIADO = FERIADOS.find((d) => d > soma(HOJE, 1) && dds(d) !== 0 && d < soma(HOJE, 110));
async function mostrarMes(p, d) { for (let i = 0; i < 6 && !(await p.locator(`.cal-dia[data-dia="${d}"]`).count()); i++) await p.getByRole('button', { name: 'Próximo mês' }).click(); }
async function escolherData(p, d) { await mostrarMes(p, d); await p.locator(`.cal-dia[data-dia="${d}"]`).click(); }
async function horario(p, id, hh, mm) { await p.selectOption(`#${id}-hora`, hh); await p.selectOption(`#${id}-min`, mm); }
async function ateModalidade(p, op = {}) {
  await ateLocal(p, op);
  if (op.servico === 'passadoria') { for (let i = 0; i < 4; i++) await p.getByRole('button', { name: 'Aumentar peças' }).click(); await marcar(p, 'tipoPecas', 'basicas'); } else {
    await p.fill('#metragem', '45'); await p.getByRole('button', { name: 'Aumentar quartos' }).click();
  }
  await marcar(p, 'animais', 'nao'); await marcar(p, 'localRefeicao', 'sim');
  await continuar(p); await p.waitForSelector('[data-passo=modalidade]');
}

t.teste('V4 modalidade: três cards com as descrições e selos da cliente; pagamento só dentro de "Informações da modalidade"', async () => {
  const p = await novaPagina(375);
  await ateModalidade(p);
  const cards = await p.locator('.cards-modalidade').innerText();
  for (const x of ['DIÁRIA AVULSA', 'Uma diária em uma única data.', 'MAIS DE UMA PROFISSIONAL NO MESMO DIA', 'Escolha 2 ou mais profissionais para o mesmo dia. O valor é calculado por profissional.',
    'DESCONTO A PARTIR DE 3 PROFISSIONAIS', 'PACOTE DE DIÁRIAS', 'Agende 2 ou mais datas de atendimento.', 'DESCONTO A PARTIR DE 3 DIÁRIAS']) assert.ok(cards.includes(x), x);
  assert.ok(!/antecipado|integral|50%/i.test(cards), 'condições de pagamento fora do card');
  await p.locator('[data-info-modalidade=pacote]').click();
  assert.match(await p.locator('dialog.painel-lateral').innerText(), /50% após a confirmação da contratação \+ 50% antes do início da segunda metade do pacote/);
  await p.getByRole('button', { name: 'Fechar' }).click();
  await foto(p, '05-modalidade');
  await semOverflow(p);
  assert.deepEqual(p.erros, []);
});

t.teste('V4 avulsa: domingo bloqueado, feriado e sábado marcados (e escolhíveis); 8h oferece só 08 a 10 e às 10 só 00, 15 e 30', async () => {
  const p = await novaPagina(375);
  await ateModalidade(p);
  await marcar(p, 'modalidade', 'avulsa'); await continuar(p); await p.waitForSelector('[data-passo=datas]');
  const dom = proximoDomingo(); await mostrarMes(p, dom);
  assert.equal(await p.locator(`.cal-dia[data-dia="${dom}"]`).getAttribute('aria-disabled'), 'true');
  if (FERIADO) { await mostrarMes(p, FERIADO); assert.match(await p.locator(`.cal-dia[data-dia="${FERIADO}"]`).getAttribute('class'), /cal-feriado/); }
  await p.goto(URL_V3()); await p.waitForSelector('[data-passo=datas]');
  const sab = proximoSabado(); await escolherData(p, sab);
  assert.match(await p.locator(`.cal-dia[data-dia="${sab}"]`).getAttribute('aria-label'), /taxa adicional de R\$20,00/);
  const d = diaUtil(3); await escolherData(p, d);
  assert.equal(await p.locator('.cal-dia.escolhido').count(), 1, 'avulsa: uma data');
  // duração 8h: volta e escolhe 8h
  await p.goBack(); await p.waitForSelector('[data-passo=modalidade]'); await p.goBack(); await p.waitForSelector('[data-passo=local]');
  await marcar(p, 'duracaoHoras', '8'); await continuar(p); await p.waitForSelector('[data-passo=modalidade]'); await continuar(p); await p.waitForSelector('[data-passo=datas]');
  assert.deepEqual(await p.locator('#horario-hora option').allTextContents(), ['--', '08', '09', '10']);
  await p.selectOption('#horario-hora', '10');
  assert.deepEqual(await p.locator('#horario-min option').allTextContents(), ['--', '00', '15', '30']);
  assert.match(await p.locator('.bloco-horario').innerText(), /HORÁRIO DE INÍCIO[\s\S]*Os atendimentos são realizados exclusivamente dentro do horário comercial\./);
  await p.selectOption('#horario-min', '30');
  await foto(p, '06-datas-avulsa');
  await continuar(p); await p.waitForSelector('[data-passo=revisao]');
  assert.deepEqual(p.erros, []);
});

t.teste('V4 pacote semanal: a 1ª data gera as ocorrências, quantidade sincronizada com calendário e chips (+, −, lixeira, clique), "Alterar frequência?" zera', async () => {
  const p = await novaPagina(375);
  await ateModalidade(p);
  await marcar(p, 'modalidade', 'pacote'); await continuar(p); await p.waitForSelector('[data-passo=datas]');
  await marcar(p, 'frequencia', 'semanal');
  const d1 = diaUtil(3); await escolherData(p, d1);
  const qtd = () => p.locator('#qtd-diarias-valor').textContent();
  const chips = () => p.locator('.chips-datas li').count();
  assert.equal(await chips(), 4); assert.equal(await qtd(), '4');
  assert.equal(await p.locator('.cal-dia.escolhido').count() >= 1, true);
  await p.getByRole('button', { name: 'Aumentar quantidade de diárias' }).click();
  assert.equal(await chips(), 5); assert.equal(await qtd(), '5');
  await p.getByRole('button', { name: 'Diminuir quantidade de diárias' }).click();
  assert.equal(await chips(), 4);
  await p.locator('.chips-datas li').nth(1).getByRole('button').click();
  assert.equal(await chips(), 3); assert.equal(await qtd(), '3');
  assert.match(await p.locator('.chip-remover').first().getAttribute('aria-label'), /^Remover \d\d\/\d\d\/\d{4}$/);
  const extra = soma(d1, 1); await escolherData(p, dds(extra) === 0 ? soma(extra, 1) : extra);
  assert.equal(await qtd(), '4', 'data marcada no calendário soma');
  // troca de frequência com datas: diálogo literal; Cancelar mantém; Alterar zera
  await marcar(p, 'frequencia', 'quinzenal');
  await p.waitForSelector('dialog.dialogo-confirmar');
  assert.match(await p.locator('dialog.dialogo-confirmar').innerText(), /Alterar frequência\?[\s\S]*Ao alterar a frequência, as datas selecionadas serão removidas para que você faça uma nova configuração\./);
  await p.getByRole('button', { name: 'Cancelar' }).click();
  assert.equal(await chips(), 4);
  await p.waitForFunction(() => document.querySelector('input[name=frequencia][value=semanal]')?.checked);
  await marcar(p, 'frequencia', 'quinzenal'); await p.getByRole('button', { name: 'Alterar', exact: true }).click();
  await p.waitForFunction(() => !document.querySelector('.chips-datas'));
  assert.equal(await chips(), 0);
  await escolherData(p, d1);
  assert.equal(await chips(), 4);
  const datas = await p.evaluate(() => JSON.parse(localStorage.getItem('prime.rascunho.agendamento.v3')).datas);
  assert.ok(datas[1] >= soma(d1, 14) && datas[1] <= soma(d1, 16), `quinzenal: a 2ª é 14 dias depois (ou o próximo dia permitido): ${datas}`);
  await horario(p, 'horario', '08', '30');
  await marcar(p, 'manterHorario', 'nao');
  assert.equal(await p.locator('.linha-horario').count(), 4, 'um seletor por data, na mesma tela');
  for (const dd of datas.slice(1)) await horario(p, `horario-${dd}`, '09', '00');
  await foto(p, '06-datas-pacote');
  await semOverflow(p);
  await continuar(p); await p.waitForSelector('[data-passo=configuracao]');
  assert.equal(await p.locator('details.card-config').count(), 4);
  assert.equal(await p.locator('details.card-config[open]').count(), 1, 'só a primeira aberta');
  assert.match(await p.locator('details.card-config summary').first().innerText(), /Diária 1 · \d\d\/\d\d/);
  // endereço novo numa diária do pacote: aviso do item 46
  const c2 = p.locator('details.card-config').nth(1);
  await c2.locator('summary').click();
  await c2.locator('select[id^=end-]').selectOption('outro');
  await p.locator(`#cep-${datas[1]}`).fill('32010000'); await p.waitForSelector('.endereco-extra [data-regiao=atendida]');
  await p.fill(`#num-${datas[1]}`, '9'); await p.selectOption(`#tipo-${datas[1]}`, 'Casa');
  await p.locator(`input[name="uso-${datas[1]}"][value="unico"]`).evaluate((i) => i.click());
  assert.match(await p.locator('[data-aviso=pacote-endereco-novo]').innerText(), /Novo endereço no pacote[\s\S]*A utilização deste endereço ficará sujeita à validação da Prime antes da confirmação da solicitação\./);
  await foto(p, '07-configuracao-pacote');
  await semOverflow(p);
  await continuar(p); await p.waitForSelector('[data-passo=revisao]');
  assert.deepEqual(p.erros, []);
});

t.teste('V4 várias profissionais: uma data, quantidade, "mesmo horário para as demais?" e cards por profissional com "+ Adicionar profissional"', async () => {
  const p = await novaPagina(375);
  await ateModalidade(p);
  await marcar(p, 'modalidade', 'multi_profissional'); await continuar(p); await p.waitForSelector('[data-passo=datas]');
  await escolherData(p, diaUtil(4));
  await p.getByRole('button', { name: 'Aumentar quantidade de profissionais' }).click();
  await horario(p, 'horario', '08', '00');
  assert.match(await p.locator('[data-campo=manterHorario]').innerText(), /Deseja utilizar este mesmo horário para as demais profissionais\?[\s\S]*Não, definir individualmente/);
  await marcar(p, 'manterHorario', 'nao');
  await continuar(p); await p.waitForSelector('[data-passo=configuracao]');
  assert.equal(await p.locator('details.card-config').count(), 3);
  await p.getByRole('button', { name: '+ Adicionar profissional' }).click();
  assert.equal(await p.locator('details.card-config').count(), 4);
  await continuar(p);
  assert.match(await p.locator('.alerta-erro[role=alert]:not([hidden])').textContent(), /Profissional 2: escolha o horário/);
  for (const i of [1, 2, 3]) {
    const c = p.locator('details.card-config').nth(i); if (!(await c.getAttribute('open') !== null)) await c.locator('summary').click();
    await horario(p, `hora-p${i}`, '10', '00');
  }
  const c3 = p.locator('details.card-config').nth(2);
  await c3.locator('select[id^=serv-]').selectOption('passadoria');
  await foto(p, '07-configuracao-multi');
  await continuar(p); await p.waitForSelector('[data-passo=revisao]');
  assert.deepEqual(p.erros, []);
});

t.teste('V4 320 px: datas e configuração sem rolagem lateral', async () => {
  const p = await novaPagina(320);
  await ateModalidade(p);
  await marcar(p, 'modalidade', 'pacote'); await continuar(p); await p.waitForSelector('[data-passo=datas]');
  await marcar(p, 'frequencia', 'semanal'); await escolherData(p, diaUtil(3));
  await semOverflow(p);
  await horario(p, 'horario', '08', '00'); await marcar(p, 'manterHorario', 'sim');
  await continuar(p); await p.waitForSelector('[data-passo=configuracao]');
  await semOverflow(p);
  assert.deepEqual(p.erros, []);
});

// ---------- V5: revisão, aceite único, envio e tela final ----------
async function ateRevisaoAvulsa(p, op = {}) {
  await ateModalidade(p, op);
  await marcar(p, 'modalidade', 'avulsa'); await continuar(p); await p.waitForSelector('[data-passo=datas]');
  await escolherData(p, op.data || diaUtil(3)); await horario(p, 'horario', '08', '30');
  await continuar(p); await p.waitForSelector('[data-passo=revisao]');
  await p.waitForSelector('[data-valor=total]');
}
async function aceitarEEnviar(p) {
  await p.getByRole('button', { name: 'Ler Termos e Condições' }).click();
  await p.waitForSelector('dialog.painel-lateral .texto-modal h2');
  await p.getByRole('button', { name: 'Fechar' }).click();
  await p.locator('#aceite-termos-v3').check();
  await p.getByRole('button', { name: 'ENVIAR SOLICITAÇÃO' }).click();
  await p.waitForSelector('[data-passo=enviado]');
}

t.teste('V5 avulsa: três blocos, valores transparentes, pagamento da modalidade, aviso do item 51, aceite único (botão só depois de abrir e marcar), número da solicitação', async () => {
  const p = await novaPagina(375);
  await ateRevisaoAvulsa(p);
  assert.equal(await titulo(p), 'Revise sua solicitação');
  const corpo = await p.locator('[data-passo=revisao]').innerText();
  for (const x of ['Resumo do atendimento', 'Valores e pagamento', 'Finalização', 'Residencial • 45 m² • 1 ambiente', '08:30', '4 horas por diária',
    'Tem um cupom de desconto?', 'Pagamento', T3.pagamentoTexto, 'Como você conheceu a Prime?', T3.avisoFinal,
    'Leia e aceite os Termos e Condições do atendimento', 'Este documento reúne as condições aplicáveis à sua solicitação. A leitura e o aceite são necessários para concluir.',
    'Declaro que li e concordo com os Termos e Condições do atendimento e estou ciente dos Termos de Uso e da Política de Privacidade.']) assert.ok(corpo.includes(x), x);
  assert.ok(!/Quero receber novidades/i.test(corpo), 'sem checkbox de marketing (item 54)');
  assert.ok(!/cômodos/.test(corpo), '"ambientes" no resumo, não cômodos');
  assert.equal(await p.locator('[data-valor=total]').textContent(), 'R$175,00');
  const enviar = p.getByRole('button', { name: 'ENVIAR SOLICITAÇÃO' });
  assert.equal(await enviar.isDisabled(), true);
  await p.locator('#aceite-termos-v3').check();
  assert.equal(await enviar.isDisabled(), true, 'sem abrir os Termos, continua desabilitado');
  await p.getByRole('button', { name: 'Ler Termos e Condições' }).click();
  await p.waitForSelector('dialog.painel-lateral .texto-modal h2');
  const termos = await p.locator('dialog.painel-lateral').innerText();
  for (const x of ['Lavagem de tapetes.', 'Remoção de cera.', 'Utilização/manipulação de produtos corrosivos, agressivos ou que apresentem risco à profissional ou às superfícies.',
    'Por segurança, as profissionais não realizam atividades em alturas superiores a 2 metros.', 'A lavagem de áreas externas somente poderá ser realizada quando houver mangueira disponível no local.',
    'Os produtos, materiais, equipamentos e EPIs necessários ao atendimento deverão ser fornecidos pelo cliente.']) assert.ok(termos.includes(x), x);
  assert.ok(!/não manipulamos produtos químicos/i.test(termos));
  await p.getByRole('button', { name: 'Fechar' }).click();
  assert.equal(await enviar.isDisabled(), false);
  await marcar(p, 'origem', 'indicacao');
  await p.fill('#quemIndicou', 'Vizinha');
  await foto(p, '08-revisao');
  await semOverflow(p);
  // duplo clique: uma solicitação só
  await enviar.dblclick();
  await p.waitForSelector('[data-passo=enviado]');
  const fim = await p.locator('[data-passo=enviado]').innerText();
  assert.match(fim, /Solicitação recebida![\s\S]*Nº da solicitação: \d{6}[\s\S]*Agora a Prime verificará a disponibilidade e dará continuidade ao atendimento pelo WhatsApp\./);
  await foto(p, '09-enviado');
  const n = await p.evaluate(async () => {
    const { api } = await import(new URL('src/services/api.js', document.baseURI.replace(/autoagendamento\/.*$/, '')).href);
    const { itens } = await api.listarPedidos({}, { sessao: { ator: 'prime' } });
    return itens.filter((x) => x.endereco?.numero === '100' && x.modalidade === 'avulsa').length;
  });
  assert.equal(n, 1, 'duplo clique não duplica');
  assert.equal(await p.evaluate(() => localStorage.getItem('prime.rascunho.agendamento.v3')), null, 'rascunho apagado depois do envio');
  assert.deepEqual(p.erros, []);
});

t.teste('V5 pacote semanal de 5 com desconto, taxa de sábado separada e o texto de pagamento do pacote; cupom inválido com a mensagem literal', async () => {
  const p = await novaPagina(1440);
  await ateModalidade(p);
  await marcar(p, 'modalidade', 'pacote'); await continuar(p); await p.waitForSelector('[data-passo=datas]');
  await marcar(p, 'frequencia', 'semanal');
  const sab = proximoSabado(3); await escolherData(p, sab);
  await p.getByRole('button', { name: 'Aumentar quantidade de diárias' }).click();
  assert.equal(await p.locator('.chips-datas li').count(), 5);
  await horario(p, 'horario', '08', '00'); await marcar(p, 'manterHorario', 'sim');
  await continuar(p); await p.waitForSelector('[data-passo=configuracao]'); await continuar(p);
  await p.waitForSelector('[data-passo=revisao]'); await p.waitForSelector('[data-valor=total]');
  const valores = await p.locator('[data-bloco=valores]').innerText();
  assert.match(valores, /5 diárias × R\$175,00[\s\S]*R\$875,00/);
  assert.match(valores, /Sábado \(\d×\)/);
  assert.match(valores, /Desconto do pacote:[\s\S]*– R\$40,00/);
  assert.ok(valores.includes(T3.pagamentoPacote) && valores.includes(T3.pagamentoPacote2));
  assert.match(await p.locator('[data-item=frequência]').innerText(), /Semanal, 5 diárias/);
  await p.fill('#cupom', 'naoexiste'); await p.getByRole('button', { name: 'Aplicar' }).click();
  await p.waitForFunction(() => document.querySelector('#cupom-msg')?.textContent);
  assert.equal(await p.locator('#cupom-msg').textContent(), 'Cupom inválido ou indisponível.');
  await foto(p, '08-revisao-pacote');
  await aceitarEEnviar(p);
  assert.deepEqual(p.erros, []);
});

t.teste('V5 cliente que já tem cadastro: entra, usa o endereço salvo e envia; a solicitação aparece no acompanhamento', async () => {
  const p = await novaPagina(375);
  await ateIdentificacao(p);
  await marcar(p, 'identificacao', 'cliente');
  await p.fill('#entrar-identificador', C.clientes[0].email); await p.fill('#entrar-senha', C.clientes[0].senha);
  await p.getByRole('button', { name: 'Entrar', exact: true }).click();
  await p.waitForSelector('[data-passo=endereco]'); await continuar(p); await p.waitForSelector('[data-passo=local]');
  await p.fill('#metragem', '45'); await p.getByRole('button', { name: 'Aumentar quartos' }).click();
  await marcar(p, 'animais', 'nao'); await marcar(p, 'localRefeicao', 'nao');
  await continuar(p); await p.waitForSelector('[data-passo=modalidade]');
  await marcar(p, 'modalidade', 'avulsa'); await continuar(p); await p.waitForSelector('[data-passo=datas]');
  await escolherData(p, diaUtil(4)); await horario(p, 'horario', '09', '15');
  await continuar(p); await p.waitForSelector('[data-valor=total]');
  assert.match(await p.locator('[data-bloco=valores]').innerText(), /Sem local para aquecer refeição[\s\S]*\+ R\$25,00/);
  assert.match(await p.locator('[data-item=local]').innerText(), /Rua Fictícia, 100/);
  await aceitarEEnviar(p);
  assert.equal(await p.getByRole('link', { name: 'Acompanhar a solicitação' }).count(), 1);
  assert.deepEqual(p.erros, []);
});

t.teste('CEP: resposta atrasada do ViaCEP não sobrescreve o CEP digitado depois; ViaCEP fora do ar cai na escolha da cidade', async () => {
  const p = await novaPagina(375, { atrasar: { 30130010: 1500 } });
  await ateIdentificacao(p); await cadastroNovo(p);
  await p.fill('#cep', '30130010'); await p.fill('#cep', '32010000');
  await p.waitForFunction(() => /Contagem/.test(document.querySelector('[data-regiao=atendida]')?.textContent || ''));
  await p.waitForTimeout(1800);
  assert.match(await p.locator('[data-regiao=atendida]').textContent(), /Contagem/);
  await p.fill('#cep', '99999999'); await p.waitForSelector('#cidade-manual');
  await p.selectOption('#cidade-manual', 'Belo Horizonte'); await p.waitForSelector('[data-regiao=atendida]');
  assert.deepEqual(p.erros, []);
});

// ---------- V6: painel ----------
t.teste('V6 painel (mock): solicitação v3 com número, modalidade, diárias e valores; recusa com motivo padronizado; cadastros sem solicitação; parcelas do pacote', async () => {
  const p = await novaPagina(1440);
  // um pacote enviado por cliente nova e um cadastro que não enviou nada
  await ateModalidade(p);
  await marcar(p, 'modalidade', 'pacote'); await continuar(p); await p.waitForSelector('[data-passo=datas]');
  await marcar(p, 'frequencia', 'semanal'); await escolherData(p, diaUtil(3));
  await horario(p, 'horario', '08', '00'); await marcar(p, 'manterHorario', 'sim');
  await continuar(p); await p.waitForSelector('[data-passo=configuracao]'); await continuar(p);
  await p.waitForSelector('[data-valor=total]');
  await marcar(p, 'origem', 'instagram');
  await aceitarEEnviar(p);
  const numero = await p.locator('[data-numero]').getAttribute('data-numero');
  await p.goto(URL_V3()); await p.waitForSelector('[data-passo]');
  await p.evaluate(() => localStorage.removeItem('prime.rascunho.agendamento.v3'));
  await ateIdentificacao(p); await cadastroNovo(p, { nome: 'Prospecção Fictícia', cpf: '11144477735', email: `prosp-${Date.now()}@exemplo.com` });
  // painel
  await p.evaluate((c) => localStorage.setItem('prime.sessao', JSON.stringify({ ator: 'prime', id: c.id, nome: c.nome })), C.prime[0]);
  await p.goto(`${base}painel/?aba=solicitacoes`); await p.waitForSelector('[data-solicitacao]');
  const card = p.locator('[data-solicitacao]').filter({ has: p.locator(`[data-numero="${numero}"]`) });
  const txt = await card.innerText();
  assert.match(txt, new RegExp(`Nº da solicitação\\s+${numero.padStart(6, '0')}`, 'i'));
  assert.match(txt, /Pacote de diárias · Semanal · 4 diárias/);
  assert.match(txt, /Instagram/);
  assert.match(txt, /4 diárias × R\$175,00/);
  assert.equal(await card.locator('select[id$=-motivo] option').count() > 3, true, 'motivos padronizados');
  await foto(p, '10-painel-solicitacao');
  await card.getByRole('button', { name: 'Confirmar disponibilidade' }).click();
  await p.waitForFunction((n) => !document.querySelector(`[data-numero="${n}"]`), numero);
  await p.goto(`${base}painel/?aba=pagamentos`); await p.waitForSelector('[data-parcelas-pedido]');
  const parc = await p.locator('[data-parcelas-pedido]').first().innerText();
  assert.match(parc, /1ª parte do pacote[\s\S]*Pendente[\s\S]*2ª parte do pacote[\s\S]*Prevista/i);
  await p.goto(`${base}painel/?aba=prospeccao`); await p.waitForSelector('[data-tabela=prospeccao]');
  assert.match(await p.locator('[data-tabela=prospeccao]').innerText(), /Prospecção Fictícia/);
  await foto(p, '11-painel-prospeccao');
  assert.deepEqual(p.erros, []);
});

await t.fim();
await b.close();
await fechar();
