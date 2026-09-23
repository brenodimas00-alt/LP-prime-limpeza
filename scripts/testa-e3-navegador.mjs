// E3 no navegador: autoagendamento residencial avulso e empresa 4 diárias até o redirecionamento pro Pix.
import { criarSuite, assert } from './lib-teste.mjs';
import { abrirNavegador, subirServidor } from './pw.mjs';
import { proximaDataPermitida } from './fixtures/seed.js';
import { dataNoFuso } from '../src/domain/calendario.js';
import { CONFIG_PRECOS } from '../src/config/precos.js';

const t = criarSuite('E3 navegador (autoagendamento)');
const { base, fechar } = await subirServidor();
const b = await abrirNavegador();
const HOJE = dataNoFuso(new Date().toISOString());
const DATA = proximaDataPermitida(HOJE, 3, CONFIG_PRECOS);
const VIACEP = {
  30130010: { logradouro: 'Rua Fictícia', bairro: 'Savassi', localidade: 'Belo Horizonte', uf: 'MG' },
  32010000: { logradouro: 'Avenida Exemplo', bairro: 'Centro', localidade: 'Contagem', uf: 'MG' },
  35400000: { logradouro: 'Rua Direita', bairro: 'Centro', localidade: 'Ouro Preto', uf: 'MG' },
};

async function novaPagina(largura = 390) {
  const ctx = await b.newContext({ viewport: { width: largura, height: 900 } });
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
  assert.match(await titulo(pr), /1\. Tipo/);
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
  assert.match(await titulo(pr), /2\. Endereço/);
});

t.teste('passo 2: ViaCEP preenche; região não atendida bloqueia; ViaCEP fora cai no manual', async () => {
  await pr.fill('#cep', '35400-000');
  await pr.waitForFunction(() => document.querySelector('#cidade').value === 'Ouro Preto');
  await pr.fill('#numero', '10');
  await avancar(pr);
  assert.match(await pr.locator('.alerta-erro').textContent(), /Ainda não atendemos Ouro Preto/);
  await pr.fill('#cep', '99999-999');
  await pr.waitForFunction(() => /à mão/.test(document.querySelector('[role=status].ajuda')?.textContent || ''));
  await pr.fill('#cep', '30130-010');
  await pr.waitForFunction(() => document.querySelector('#cidade').value === 'Belo Horizonte');
  assert.equal(await pr.inputValue('#logradouro'), 'Rua Fictícia');
  await pr.fill('#numero', '100');
  await avancar(pr);
  assert.match(await titulo(pr), /3\. Monte/);
});

t.teste('passo 3: preço discriminado em tempo real; valida metragem', async () => {
  await avancar(pr);
  assert.match(await pr.locator('[data-campo=metragem] .erro-campo').textContent(), /inteiro/);
  await pr.fill('#metragem', '70');
  await pr.locator('input[name=adicionais][value=geladeira]').check({ force: true });
  assert.equal(await pr.locator('[data-valor=dia]').textContent(), 'R$ 270,00');
  assert.equal(await pr.locator('[data-valor=entrada]').textContent(), 'R$ 135,00');
  assert.equal(await pr.inputValue('#quantidadeDiarias'), '1');
  assert.ok(await pr.locator('#quantidadeDiarias').isDisabled());
  await avancar(pr);
  assert.match(await titulo(pr), /4\. Data/);
});

t.teste('passo 4: data obrigatória, domingo recusado, calendário gerado', async () => {
  await avancar(pr);
  assert.match(await pr.locator('[data-campo=primeiraData] .erro-campo').textContent(), /Informe a data/);
  let dom = HOJE; while (new Date(`${dom}T12:00:00Z`).getUTCDay() !== 0 || dom <= HOJE) dom = new Date(Date.parse(`${dom}T12:00:00Z`) + 86400e3).toISOString().slice(0, 10);
  await pr.fill('#primeiraData', dom);
  await pr.locator('input[name=turno][value=manha]').check({ force: true });
  await avancar(pr);
  assert.match(await pr.locator('[data-campo=primeiraData] .erro-campo').textContent(), /domingo/);
  await pr.fill('#primeiraData', DATA);
  await pr.waitForSelector(`#calendario [data-data="${DATA}"]`);
  await avancar(pr);
  assert.match(await titulo(pr), /5\. Seus contatos/);
});

t.teste('recarregar retoma no mesmo passo com os dados', async () => {
  await pr.fill('#nome', 'Ana Teste Fictícia');
  await pr.reload(); await pr.waitForSelector('#titulo-passo');
  assert.match(await titulo(pr), /5\. Seus contatos/);
  assert.equal(await pr.inputValue('#nome'), 'Ana Teste Fictícia');
});

t.teste('passo 5: telefone, e-mail e CPF inválidos bloqueiam', async () => {
  await pr.fill('#telefone', '31 1234'); await pr.fill('#email', 'ana@'); await pr.fill('#cpf', '111.111.111-11');
  await avancar(pr);
  assert.ok((await pr.locator('[data-campo=telefone] .erro-campo').textContent()).length > 0);
  assert.ok((await pr.locator('[data-campo=email] .erro-campo').textContent()).length > 0);
  assert.ok((await pr.locator('[data-campo=cpf] .erro-campo').textContent()).length > 0);
  await pr.fill('#telefone', '31988887777'); await pr.fill('#email', 'ana.teste@exemplo.com'); await pr.fill('#cpf', '52998224725');
  assert.equal(await pr.inputValue('#telefone'), '(31) 98888-7777');
  await avancar(pr);
  assert.match(await titulo(pr), /6\. Confira/);
});

t.teste('residencial avulso: resumo, duplo clique, redireciona pro Pix com Pedido/Atendimento/Pagamento corretos', async () => {
  assert.match(await pr.locator('dl.dados').textContent(), /Savassi/);
  await pr.getByRole('button', { name: 'Confirmar e ir pro Pix' }).dblclick();
  await pr.waitForURL(/pagamento\/\?pagamento=/);
  const id = new URL(pr.url()).searchParams.get('pagamento');
  const r = await pr.evaluate(async ([raiz, pid]) => {
    const { api } = await import(`${raiz}src/services/api.js`);
    const pg = await api.obterPagamento(pid);
    const ped = await api.obterPedido(pg.pedido.id);
    const lista = await api.listarPedidos({});
    return { valor: pg.pagamento.valorCentavos, parcela: pg.pagamento.parcela, brcode: !!pg.pagamento.brcode, ats: ped.atendimentos.map((a) => [a.data, a.turno, a.status]), pgs: ped.pagamentos.map((x) => [x.parcela, x.valorCentavos]), total: ped.pedido.pacote.totalCentavos, pedidos: lista.itens.length, rascunho: localStorage.getItem('prime.rascunho.autoagendamento') };
  }, [base, id]);
  assert.equal(r.parcela, 'entrada'); assert.equal(r.valor, 13500); assert.equal(r.total, 27000); assert.equal(r.brcode, true);
  assert.deepEqual(r.ats, [[DATA, 'manha', 'agendado']]);
  assert.deepEqual(r.pgs, [['entrada', 13500], ['dia', 13500]]);
  assert.equal(r.pedidos, 1, 'duplo clique não criou dois pedidos');
  assert.equal(r.rascunho, null);
});

t.teste('empresa 4 diárias semanais: até o Pix com 4 atendimentos e 4 parcelas', async () => {
  const p = await novaPagina(1440);
  await passo1(p, 'empresa');
  await p.fill('#cnpj', '12ABC34501DE35'); await p.fill('#razaoSocial', 'Empresa Teste de Exemplo Ltda'); await p.fill('#responsavel', 'Carlos Teste');
  await avancar(p);
  await p.fill('#cep', '32010-000'); await p.waitForFunction(() => document.querySelector('#cidade').value === 'Contagem');
  await p.fill('#numero', '500'); await avancar(p);
  assert.ok(await p.locator('input[name=frequencia][value=avulso]').isDisabled(), 'empresa sem avulso');
  await p.locator('input[name=medida][value=comodos]').check({ force: true });
  await p.fill('#comodos', '6');
  await p.locator('input[name=frequencia][value=semanal]').check({ force: true });
  await p.fill('#quantidadeDiarias', '4');
  await p.locator('input[name=adicionais][value=janelas]').check({ force: true });
  const dia = await p.locator('[data-valor=dia]').textContent();
  await avancar(p);
  await p.fill('#primeiraData', DATA); await p.locator('input[name=turno][value=tarde]').check({ force: true });
  await p.waitForSelector('#calendario li >> nth=3');
  await avancar(p);
  await p.fill('#nome', 'Carlos Teste'); await p.fill('#telefone', '31977776666'); await p.fill('#email', 'contato@empresa-teste.exemplo');
  await avancar(p);
  await p.getByRole('button', { name: 'Confirmar e ir pro Pix' }).click();
  await p.waitForURL(/pagamento\/\?pagamento=/);
  const id = new URL(p.url()).searchParams.get('pagamento');
  const r = await p.evaluate(async ([raiz, pid]) => {
    const { api } = await import(`${raiz}src/services/api.js`);
    const pg = await api.obterPagamento(pid);
    const ped = await api.obterPedido(pg.pedido.id);
    return { cliente: ped.cliente, pacote: ped.pedido.pacote, n: ped.atendimentos.length, dias: ped.pagamentos.filter((x) => x.parcela === 'dia').map((x) => x.valorCentavos), entrada: pg.pagamento.valorCentavos };
  }, [base, id]);
  assert.equal(r.n, 4); assert.equal(r.dias.length, 4);
  assert.equal(r.cliente.cnpj, '12ABC34501DE35'); assert.equal(r.cliente.tipo, 'empresa');
  assert.equal(r.entrada + r.dias.reduce((s, x) => s + x, 0), r.pacote.totalCentavos);
  assert.equal(`R$ ${(r.pacote.valorDiaCentavos / 100).toFixed(2).replace('.', ',')}`, dia.replace(/\./g, ''));
  assert.ok(r.pacote.itens.some((i) => i.codigo === 'deslocamento'), 'Contagem tem taxa');
  assert.deepEqual(p.erros, []);
});

t.teste('sem erro no console e sem overflow em 390px', async () => {
  const ov = await pr.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(ov <= 0);
  assert.deepEqual(pr.erros, [], JSON.stringify(pr.erros));
});

const falhas = await t.fim();
await b.close(); await fechar();
process.exit(falhas ? 1 : 0);
