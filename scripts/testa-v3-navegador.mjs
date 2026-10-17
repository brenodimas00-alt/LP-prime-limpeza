// Autoagendamento v3 no navegador (mock), spec-agendamento-v3 + 56 itens da cliente. Cresce a cada entrega (V2 a V5).
// node scripts/testa-v3-navegador.mjs [--shots]   (--shots grava as telas em 375 e 1440 em ~/.claude/build/build-20261006-agendamento-v3/shots/)
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { criarSuite, assert } from './lib-teste.mjs';
import { abrirNavegador, subirServidor, horarioComercial } from './pw.mjs';
import { CREDENCIAIS_MOCK as C } from './fixtures/seed.js';
import { dataNoFuso } from '../src/domain/calendario.js';
import { TIPOS_IMOVEL } from '../src/config/agendamento-v3.js';

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
const URL_V3 = () => `${base}autoagendamento/?v3=1`;

async function novaPagina(largura = 375) {
  const ctx = await b.newContext({ viewport: { width: largura, height: 860 }, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  p.erros = []; p.largura = largura;
  p.on('console', (m) => m.type() === 'error' && !/viacep/.test(m.location()?.url || '') && p.erros.push(m.text()));
  p.on('pageerror', (e) => p.erros.push(e.message));
  await ctx.route('https://viacep.com.br/**', async (route) => {
    const cep = route.request().url().match(/ws\/(\d{8})/)[1];
    if (cep === '99999999') return route.abort();
    return route.fulfill({ json: VIACEP[cep] || { erro: true } });
  });
  await ctx.route('**/src/config/prime.js', (route) => route.fulfill({ path: 'src/config/prime.teste.js', contentType: 'text/javascript' }));
  return p;
}
const titulo = (p) => p.locator('#titulo-passo').textContent();
const passo = (p) => p.locator('[data-passo]').first().getAttribute('data-passo');
const continuar = (p) => p.getByRole('button', { name: 'Continuar' }).click();
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
async function enderecoNovo(p, { cep = '30130010', uso = 'salvar', apelido = '' } = {}) {
  await p.fill('#cep', cep); await p.waitForSelector('[data-regiao=atendida]');
  await p.fill('#numero', '100'); await p.selectOption('#tipoImovel', 'Apartamento');
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
  await p.goto(`${base}autoagendamento/?v3=1&servico=passadoria`);
  await p.waitForSelector('[data-passo=identificacao]');
  assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('prime.rascunho.agendamento.v3')).servico), 'passadoria');
  assert.equal(await p.evaluate(() => location.search), '?v3=1', 'a URL perde o ?servico=');
  await p.goto(URL_V3()); await p.waitForSelector('[data-passo=identificacao]');
  await marcar(p, 'identificacao', 'novo'); await continuar(p); await p.waitForSelector('[data-passo=cadastro]');
  await p.fill('#nome', 'Bia Rascunho'); await p.fill('#cpf', '52998224725');
  await p.reload(); await p.waitForSelector('[data-passo=cadastro]');
  assert.equal(await p.locator('#nome').inputValue(), 'Bia Rascunho');
  assert.equal(await p.locator('#cpf').inputValue(), '', 'CPF não volta do aparelho');
  await p.goBack(); await p.waitForSelector('[data-passo=identificacao]');
  assert.deepEqual(p.erros, []);
});

await t.fim();
await b.close();
await fechar();
