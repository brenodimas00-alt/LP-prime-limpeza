// Agendamento v3, V7: o fluxo inteiro no NAVEGADOR contra o preview do Pages e o Supabase de homologação, só com fictícios
// (e-mail teste-*@example.com, ficticio=true, mensagens pelo simulado). Cenários da spec: avulsa residencial, passadoria,
// mudança intensa, eventos após, 3 profissionais em endereços diferentes, pacote semanal de 5 com desconto, pacote com
// endereço novo, cliente com endereço salvo, cadastro abandonado, cupom válido e inválido, desconto especial não cumulativo,
// faturamento autorizado, troca de frequência, duração menor com alerta, menor de idade, nome de uma palavra, duplo clique,
// e sem rolagem lateral em 320, 375 e 768.
// Uso: LD_LIBRARY_PATH=... bash scripts/cli.sh node22 scripts/testa-v3-preview.mjs [url]
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { criarSuite, assert } from './lib-teste.mjs';
import { abrirNavegador } from './pw.mjs';
import { sql, fecharSql, limparFicticios, emailTeste, cpfFicticio, entrar, criarUsuario } from './lib-supabase.mjs';
import { somarDias } from '../src/domain/calendario.js';
import { T3 } from '../src/config/agendamento-v3.js';
import { CONFIG_PRECOS } from '../src/config/precos.js';
import { diaUtil, continuar, marcar, titulo, escolherData, horario, semOverflow, inicio, cadastro, entrarNoFluxo, enderecoNovo, local, avulsa, aceitarEEnviar } from './lib-v3-pw.mjs';

const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim().replace(/[/_.]/g, '-').toLowerCase();
const URL_ARG = process.argv.slice(2).find((a, i, l) => /^https?:/.test(a) && l[i - 1] !== '--so');
const BASE = (URL_ARG || `https://${branch}.prime-limpeza.pages.dev/`).replace(/\/?$/, '/');
const t = criarSuite(`agendamento v3 no preview (${BASE})`);
await limparFicticios();
const b = await abrirNavegador();
const VIACEP = {
  30130010: { logradouro: 'Rua Fictícia', bairro: 'Savassi', localidade: 'Belo Horizonte', uf: 'MG' },
  32010000: { logradouro: 'Avenida Exemplo', bairro: 'Centro', localidade: 'Contagem', uf: 'MG' },
  30140000: { logradouro: 'Rua Teste', bairro: 'Funcionários', localidade: 'Belo Horizonte', uf: 'MG' },
};
const ADM = await entrar(await criarUsuario('v3p-adm', 'prime_admin'));
const rpc = async (nome, args) => { const { data, error } = await ADM.rpc(nome, args); if (error) throw new Error(`${nome}: ${error.message}`); return data; };

async function celularLivre() {
  for (;;) {
    const tel = `319${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
    if (!(await sql('select 1 from public.clientes where telefone = $1', [tel])).length) return tel;
  }
}
const pessoa = async (extra = {}) => ({ nome: 'Ana Preview Fictícia', telefone: await celularLivre(), email: emailTeste('v3p'), cpf: cpfFicticio(), ...extra });
async function pagina(largura = 390) {
  await sql('delete from privado.cadastros_ip'); // o limite de cadastros por IP acumula entre execuções (homologação, só teste)
  const ctx = await b.newContext({ viewport: { width: largura, height: 900 }, reducedMotion: 'reduce' });
  await ctx.route('https://viacep.com.br/**', (r) => r.fulfill({ json: VIACEP[r.request().url().match(/ws\/(\d{8})/)[1]] || { erro: true } }));
  const p = await ctx.newPage();
  p.erros = [];
  p.on('pageerror', (e) => p.erros.push(e.message));
  p.on('console', (m) => m.type() === 'error' && !/status of (400|401|403|404|409|429)|Failed to load resource/.test(m.text()) && p.erros.push(m.text()));
  return p;
}
const fechar = (p) => p.context().close();
const pedidoDo = async (numero) => (await sql(`select p.id, p.status, p.modalidade, p.total_centavos::int total, p.pacote_endereco_novo, p.faturamento, p.cupom_id, p.condicao_comercial_id,
  c.email, c.ficticio, (select count(*)::int from public.pagamentos g where g.pedido_id = p.id) pgs from public.pedidos p join public.clientes c on c.id = p.cliente_id where p.numero_solicitacao = $1`, [Number(numero)]))[0];
const atendimentosDo = (id) => sql('select servico, data::text, hora_inicio::text hora, duracao_minutos, justificativa, endereco, caracteristicas from public.atendimentos where pedido_id = $1 order by sequencia', [id]);
const valores = (p) => p.locator('[data-bloco=valores]').innerText();
/** Primeiro dia útil a partir de hoje + n cuja série semanal de 4 datas não tem feriado nem sábado. */
const semanaLimpa = (n) => { for (let k = n; ; k++) { const d = diaUtil(k); if ([0, 7, 14, 21].every((i) => { const x = somarDias(d, i); return !CONFIG_PRECOS.feriados.includes(x) && new Date(`${x}T12:00:00Z`).getUTCDay() !== 6; })) return d; } };
const S = {};

t.teste('avulsa residencial de cliente nova: cadastro, endereço salvo, envio com duplo clique vira UM pedido com número, sem cobrança; 375 sem rolagem lateral', async () => {
  const p = await pagina(375);
  S.ana = await pessoa();
  await inicio(p, BASE); await cadastro(p, S.ana); await p.waitForSelector('[data-passo=endereco]', { timeout: 30000 });
  await enderecoNovo(p); await semOverflow(p);
  await local(p, 'residencial'); await semOverflow(p);
  await avulsa(p, diaUtil(3)); await semOverflow(p);
  assert.equal(await p.locator('[data-valor=total]').textContent(), 'R$175,00', 'cotação do servidor');
  const numero = await aceitarEEnviar(p, { duplo: true });
  assert.match(await p.locator('[data-passo=enviado]').innerText(), new RegExp(`Nº da solicitação: ${String(Number(numero)).padStart(6, '0')}`));
  const ped = await pedidoDo(numero);
  assert.deepEqual([ped.status, ped.modalidade, ped.total, ped.pgs, ped.ficticio, ped.email], ['solicitado', 'avulsa', 17500, 0, true, S.ana.email]);
  assert.equal((await sql('select count(*)::int n from public.pedidos p join public.clientes c on c.id = p.cliente_id where c.email = $1', [S.ana.email]))[0].n, 1, 'duplo clique não duplica');
  assert.equal((await sql(`select count(*)::int n from public.enderecos e join public.clientes c on c.id = e.cliente_id where c.email = $1 and e.ativo and not e.uso_unico`, [S.ana.email]))[0].n, 1, 'endereço salvo');
  assert.deepEqual(p.erros, []);
  await fechar(p);
});

t.teste('cliente com endereço salvo: entra no fluxo (regra padrão), usa o salvo, passadoria avulsa', async () => {
  const p = await pagina(390);
  await inicio(p, BASE, { servico: 'passadoria' });
  await entrarNoFluxo(p, S.ana.email, S.ana.cpf.slice(0, 6));
  assert.match(await p.locator('[data-passo=endereco]').innerText(), /Rua Fictícia, 100/);
  await continuar(p); await p.waitForSelector('[data-passo=local]');
  await local(p, 'passadoria');
  await avulsa(p, diaUtil(5), ['09', '15']);
  const numero = await aceitarEEnviar(p);
  const ped = await pedidoDo(numero);
  const [a] = await atendimentosDo(ped.id);
  assert.deepEqual([a.servico, a.hora.slice(0, 5)], ['passadoria', '09:15']);
  assert.equal((await sql(`select count(*)::int n from public.enderecos e join public.clientes c on c.id = e.cliente_id where c.email = $1`, [S.ana.email]))[0].n, 1, 'não criou endereço novo');
  assert.deepEqual(p.erros, []);
  await fechar(p);
});

t.teste('mudança intensa sugere 8h e eventos após o evento: características gravadas no atendimento', async () => {
  for (const [servico, ajuste, esperado] of [
    ['pre_pos_mudanca', async (p) => marcar(p, 'condicao', 'intensa'), { condicao: 'intensa' }],
    ['pre_pos_evento', async (p) => { await marcar(p, 'momento', 'depois'); await marcar(p, 'condicao', 'intenso'); }, { momento: 'depois', condicao: 'intenso' }],
  ]) {
    const p = await pagina(390);
    await inicio(p, BASE, { servico }); await cadastro(p, await pessoa()); await p.waitForSelector('[data-passo=endereco]', { timeout: 30000 });
    await enderecoNovo(p, { uso: 'unico' });
    await local(p, servico, { extra: () => ajuste(p) });
    await marcar(p, 'modalidade', 'avulsa'); await continuar(p); await p.waitForSelector('[data-passo=datas]');
    await escolherData(p, diaUtil(4)); await horario(p, 'horario', '08', '00');
    await continuar(p); await p.waitForSelector('[data-valor=total]', { timeout: 30000 });
    const numero = await aceitarEEnviar(p);
    const [a] = await atendimentosDo((await pedidoDo(numero)).id);
    assert.equal(a.servico, servico);
    for (const [k, v] of Object.entries(esperado)) assert.equal(a.caracteristicas[k], v, `${servico}.${k}`);
    assert.equal(a.duracao_minutos, 480, `${servico}: sugestão de 8h aceita`);
    assert.deepEqual(p.erros, []);
    await fechar(p);
  }
});

t.teste('3 profissionais no mesmo dia em endereços diferentes (uma em Contagem com deslocamento); 768 sem rolagem lateral', async () => {
  const p = await pagina(768);
  await inicio(p, BASE); await cadastro(p, await pessoa()); await p.waitForSelector('[data-passo=endereco]', { timeout: 30000 });
  await enderecoNovo(p); await local(p);
  await marcar(p, 'modalidade', 'multi_profissional'); await continuar(p); await p.waitForSelector('[data-passo=datas]');
  await escolherData(p, diaUtil(6));
  await p.getByRole('button', { name: 'Aumentar quantidade de profissionais' }).click();
  await horario(p, 'horario', '08', '00'); await marcar(p, 'manterHorario', 'sim');
  await continuar(p); await p.waitForSelector('[data-passo=configuracao]'); await semOverflow(p);
  for (const [i, cep, num] of [[1, '32010000', '9'], [2, '30140000', '55']]) {
    const c = p.locator('details.card-config').nth(i);
    if (await c.getAttribute('open') === null) await c.locator('summary').click();
    await c.locator('select[id^=end-]').selectOption('outro');
    await p.locator(`#cep-p${i}`).fill(cep); await c.locator('.endereco-extra [data-regiao=atendida]').waitFor({ timeout: 15000 });
    await p.fill(`#num-p${i}`, num); await p.selectOption(`#tipo-p${i}`, 'Casa');
    await p.locator(`input[name="uso-p${i}"][value="unico"]`).evaluate((x) => x.click());
  }
  await continuar(p); await p.waitForSelector('[data-valor=total]', { timeout: 30000 }); await semOverflow(p);
  assert.match(await valores(p), /3 profissionais × R\$175,00[\s\S]*Deslocamento \(Contagem\)[\s\S]*\+ R\$10,00[\s\S]*Desconto por profissionais:[\s\S]*– R\$20,00[\s\S]*R\$515,00/);
  const numero = await aceitarEEnviar(p);
  const ped = await pedidoDo(numero);
  const ats = await atendimentosDo(ped.id);
  assert.equal(ped.modalidade, 'multi_profissional');
  assert.equal(new Set(ats.map((a) => a.data)).size, 1, 'mesmo dia');
  assert.deepEqual(ats.map((a) => a.endereco.cidade).sort(), ['Belo Horizonte', 'Belo Horizonte', 'Contagem']);
  assert.equal(new Set(ats.map((a) => a.endereco.cep)).size, 3, 'três endereços');
  assert.deepEqual(p.erros, []);
  await fechar(p);
});

t.teste('pacote semanal de 5 com desconto; trocar a frequência pede confirmação e zera as datas; a Prime confirma e nasce só a 1ª metade', async () => {
  const p = await pagina(390);
  await inicio(p, BASE); await cadastro(p, await pessoa()); await p.waitForSelector('[data-passo=endereco]', { timeout: 30000 });
  await enderecoNovo(p); await local(p);
  await marcar(p, 'modalidade', 'pacote'); await continuar(p); await p.waitForSelector('[data-passo=datas]');
  const d1 = diaUtil(3);
  await marcar(p, 'frequencia', 'quinzenal'); await escolherData(p, d1);
  await marcar(p, 'frequencia', 'semanal'); await p.waitForSelector('dialog.dialogo-confirmar');
  assert.match(await p.locator('dialog.dialogo-confirmar').innerText(), new RegExp(T3.alterarFrequenciaTexto.replace(/[.?]/g, '\\$&')));
  await p.getByRole('button', { name: 'Alterar', exact: true }).click();
  await p.waitForFunction(() => !document.querySelector('.chips-datas'));
  await escolherData(p, d1);
  await p.getByRole('button', { name: 'Aumentar quantidade de diárias' }).click();
  assert.equal(await p.locator('.chips-datas li').count(), 5);
  await horario(p, 'horario', '08', '00'); await marcar(p, 'manterHorario', 'sim');
  await continuar(p); await p.waitForSelector('[data-passo=configuracao]'); await continuar(p);
  await p.waitForSelector('[data-valor=total]', { timeout: 30000 });
  const v = await valores(p);
  assert.match(v, /5 diárias × R\$175,00[\s\S]*Desconto do pacote:/);
  assert.ok(v.includes(T3.pagamentoPacote), 'texto de pagamento do pacote');
  const numero = await aceitarEEnviar(p);
  const ped = await pedidoDo(numero);
  const ats = await atendimentosDo(ped.id);
  assert.equal(ats.length, 5);
  assert.equal(ats[0].data, d1);
  assert.ok(ats.every((a, i) => !i || a.data > ats[i - 1].data), 'datas em ordem');
  await rpc('confirmar_disponibilidade', { p_id: ped.id, p_dados: {}, p_chave: `cd-${randomUUID()}` });
  const gs = await sql('select parcela, valor_centavos::int v from public.pagamentos where pedido_id = $1', [ped.id]);
  assert.deepEqual(gs.map((g) => g.parcela), ['metade_1']);
  assert.equal(gs[0].v, Math.ceil(ped.total / 2));
  assert.deepEqual(p.erros, []);
  await fechar(p);
});

t.teste('pacote com endereço novo numa diária: aviso na configuração e flag pro painel', async () => {
  const p = await pagina(390);
  await inicio(p, BASE); await entrarNoFluxo(p, S.ana.email, S.ana.cpf.slice(0, 6));
  await continuar(p); await p.waitForSelector('[data-passo=local]'); await local(p);
  await marcar(p, 'modalidade', 'pacote'); await continuar(p); await p.waitForSelector('[data-passo=datas]');
  await marcar(p, 'frequencia', 'semanal'); await escolherData(p, diaUtil(8));
  await horario(p, 'horario', '10', '00'); await marcar(p, 'manterHorario', 'sim');
  await continuar(p); await p.waitForSelector('[data-passo=configuracao]');
  const datas = await p.evaluate(() => JSON.parse(localStorage.getItem('prime.rascunho.agendamento.v3')).datas);
  const c = p.locator('details.card-config').nth(1); await c.locator('summary').click();
  await c.locator('select[id^=end-]').selectOption('outro');
  await p.locator(`#cep-${datas[1]}`).fill('30140000'); await c.locator('.endereco-extra [data-regiao=atendida]').waitFor({ timeout: 15000 });
  await p.fill(`#num-${datas[1]}`, '12'); await p.selectOption(`#tipo-${datas[1]}`, 'Casa');
  await p.locator(`input[name="uso-${datas[1]}"][value="unico"]`).evaluate((x) => x.click());
  await p.locator('[data-aviso=pacote-endereco-novo]').waitFor();
  await continuar(p); await p.waitForSelector('[data-valor=total]', { timeout: 30000 });
  const numero = await aceitarEEnviar(p);
  const ped = await pedidoDo(numero);
  assert.equal(ped.pacote_endereco_novo, true);
  assert.deepEqual(p.erros, []);
  await fechar(p);
});

t.teste('cadastro abandonado depois do cadastro aparece em "Cadastros sem solicitação" e não tem pedido', async () => {
  const p = await pagina(390);
  const x = await pessoa({ nome: 'Abandono Preview Fictícia' });
  await inicio(p, BASE); await cadastro(p, x); await p.waitForSelector('[data-passo=endereco]', { timeout: 30000 });
  await fechar(p);
  const [cli] = await sql('select id from public.clientes where email = $1', [x.email]);
  assert.ok(cli, 'cadastro salvo ao concluir a etapa');
  const lista = await rpc('listar_cadastros_sem_solicitacao', { p_filtro: { limite: 200 } });
  assert.ok(lista.itens.some((i) => i.id === cli.id));
});

t.teste('cupom válido aplicado e inválido com a mensagem literal; consumo só na confirmação', async () => {
  const codigo = `PREV${randomUUID().slice(0, 6).toUpperCase().replace(/-/g, '')}`;
  const cupom = await rpc('salvar_cupom', { p_dados: { codigo, tipo: 'valor', valor: 1500 } });
  try {
    const p = await pagina(390);
    await inicio(p, BASE); await cadastro(p, await pessoa()); await p.waitForSelector('[data-passo=endereco]', { timeout: 30000 });
    await enderecoNovo(p); await local(p); await avulsa(p, diaUtil(4));
    await p.fill('#cupom', 'naoexiste'); await p.getByRole('button', { name: 'Aplicar' }).click();
    await p.waitForFunction(() => /inválido/.test(document.querySelector('#cupom-msg')?.textContent || ''));
    assert.equal(await p.locator('#cupom-msg').textContent(), 'Cupom inválido ou indisponível.');
    await p.fill('#cupom', codigo.toLowerCase()); await p.getByRole('button', { name: 'Aplicar' }).click();
    await p.waitForFunction(() => /aplicado/.test(document.querySelector('#cupom-msg')?.textContent || ''));
    assert.equal(await p.locator('#cupom-msg').textContent(), 'Cupom aplicado!');
    assert.match(await valores(p), new RegExp(`Cupom ${codigo}:[\\s\\S]*– R\\$15,00`));
    assert.equal(await p.locator('[data-valor=total]').textContent(), 'R$160,00');
    const ped = await pedidoDo(await aceitarEEnviar(p));
    assert.equal(ped.cupom_id, cupom.id); assert.equal(ped.total, 16000);
    assert.equal((await sql('select count(*)::int n from public.cupons_uso where cupom_id = $1', [cupom.id]))[0].n, 0, 'envio não consome');
    assert.deepEqual(p.erros, []);
    await fechar(p);
  } finally {
    await sql('delete from public.cupons_uso where cupom_id = $1', [cupom.id]);
    await sql('update public.pedidos set cupom_id = null where cupom_id = $1', [cupom.id]);
    await sql('delete from public.cupons where id = $1', [cupom.id]);
  }
});

t.teste('desconto especial não cumulativo substitui o desconto do pacote (cliente logada)', async () => {
  const [cli] = await sql('select id from public.clientes where email = $1', [S.ana.email]);
  await rpc('salvar_condicao_comercial', { p_cliente: cli.id, p_dados: { tipo: 'percentual', valor: 10, validade: 'recorrente', acumula: false } });
  const p = await pagina(390);
  await inicio(p, BASE); await entrarNoFluxo(p, S.ana.email, S.ana.cpf.slice(0, 6));
  await continuar(p); await p.waitForSelector('[data-passo=local]'); await local(p);
  await marcar(p, 'modalidade', 'pacote'); await continuar(p); await p.waitForSelector('[data-passo=datas]');
  // série semanal sem feriado nem sábado (com feriado, a taxa entra no subtotal e o desconto deixa de ser R$70)
  await marcar(p, 'frequencia', 'semanal'); await escolherData(p, semanaLimpa(10));
  await horario(p, 'horario', '08', '00'); await marcar(p, 'manterHorario', 'sim');
  await continuar(p); await p.waitForSelector('[data-passo=configuracao]'); await continuar(p);
  await p.waitForSelector('[data-valor=total]', { timeout: 30000 });
  await p.waitForFunction(() => /Total:/.test(document.querySelector('[data-bloco=valores]')?.innerText || ''));
  const v = await valores(p);
  assert.match(v, /Desconto especial:[\s\S]*– R\$70,00/, v);
  assert.ok(!/Desconto do pacote/.test(v), 'não acumula com o do pacote');
  const ped = await pedidoDo(await aceitarEEnviar(p));
  assert.ok(ped.condicao_comercial_id); assert.equal(ped.total, 63000);
  assert.deepEqual(p.erros, []);
  await fechar(p);
});

t.teste('empresa com faturamento autorizado: texto do faturamento na revisão; confirmar não gera Pix', async () => {
  const base12 = `${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}0001`;
  const dv = (x) => { let s = 0; let w = x.length - 7; for (const ch of x) { s += Number(ch) * w; w = w === 2 ? 9 : w - 1; } const r = s % 11; return r < 2 ? 0 : 11 - r; };
  const emp = { responsavel: 'Carlos Preview Fictício', razaoSocial: 'Empresa Preview Ltda', cnpj: `${base12}${dv(base12)}${dv(base12 + dv(base12))}`, telefone: await celularLivre(), email: emailTeste('v3p-emp') };
  // 1º: cadastro pelo site (abandona), a administração autoriza o faturamento, 2º: entra e solicita
  let p = await pagina(390);
  await inicio(p, BASE, { segmento: 'empresa', servico: 'empresarial' }); await cadastro(p, emp); await p.waitForSelector('[data-passo=endereco]', { timeout: 30000 });
  await fechar(p);
  const [cli] = await sql('select id from public.clientes where documento = $1', [emp.cnpj]);
  await rpc('salvar_faturamento', { p_cliente: cli.id, p_dados: { autorizado: true, forma: 'transferencia', prazoDias: 10, nf: true } });
  p = await pagina(1280);
  await inicio(p, BASE, { segmento: 'empresa', servico: 'empresarial' }); await entrarNoFluxo(p, emp.email, emp.cnpj.slice(0, 6));
  await enderecoNovo(p, { cep: '32010000', tipo: 'Escritório' }); await local(p, 'empresarial', { refeicao: 'nao' });
  await avulsa(p, diaUtil(5));
  assert.ok((await valores(p)).includes(T3.pagamentoFaturamento));
  const ped = await pedidoDo(await aceitarEEnviar(p));
  await rpc('confirmar_disponibilidade', { p_id: ped.id, p_dados: {}, p_chave: `cd-${randomUUID()}` });
  const gs = await sql('select parcela, brcode is null sem_pix from public.pagamentos where pedido_id = $1', [ped.id]);
  assert.deepEqual(gs.map((g) => [g.parcela, g.sem_pix]), [['faturamento', true]]);
  assert.equal((await sql('select status from public.pedidos where id = $1', [ped.id]))[0].status, 'confirmado');
  assert.deepEqual(p.erros, []);
  await fechar(p);
});

t.teste('duração menor que a sugerida: alerta, justificativa gravada no atendimento', async () => {
  const p = await pagina(390);
  await inicio(p, BASE); await cadastro(p, await pessoa()); await p.waitForSelector('[data-passo=endereco]', { timeout: 30000 });
  await enderecoNovo(p, { uso: 'unico' });
  await p.fill('#metragem', '100'); await p.getByRole('button', { name: 'Aumentar quartos' }).click();
  await marcar(p, 'animais', 'nao'); await marcar(p, 'localRefeicao', 'sim');
  await marcar(p, 'duracaoHoras', '4');
  await p.locator('[data-alerta=duracao-menor]').waitFor();
  await p.fill('#justificativa', 'Só alguns cômodos (teste)');
  await p.getByRole('button', { name: 'Estou ciente e quero continuar' }).click();
  await continuar(p); await p.waitForSelector('[data-passo=modalidade]');
  await avulsa(p, diaUtil(6));
  const [a] = await atendimentosDo((await pedidoDo(await aceitarEEnviar(p))).id);
  assert.equal(a.duracao_minutos, 240); assert.equal(a.justificativa, 'Só alguns cômodos (teste)');
  assert.deepEqual(p.erros, []);
  await fechar(p);
});

t.teste('cadastro bloqueado: menor de idade e nome de uma palavra (mensagens literais), nada gravado; 320 sem rolagem lateral', async () => {
  const p = await pagina(320);
  const x = await pessoa({ nome: 'Ana', nascimento: somarDias(diaUtil(0), -365 * 17) });
  await inicio(p, BASE); await cadastro(p, x);
  await p.locator('[data-campo=nome] .erro-campo').filter({ hasText: /./ }).waitFor();
  assert.equal(await p.locator('[data-campo=nome] .erro-campo').textContent(), 'Informe seu nome completo.');
  assert.equal(await p.locator('[data-campo=dataNascimento] .erro-campo').textContent(), 'É necessário ter 18 anos ou mais para realizar uma solicitação.');
  assert.equal(await titulo(p).then(() => p.locator('[data-passo]').first().getAttribute('data-passo')), 'cadastro');
  await semOverflow(p);
  assert.equal((await sql('select count(*)::int n from public.clientes where email = $1', [x.email]))[0].n, 0);
  assert.deepEqual(p.erros, []);
  await fechar(p);
});

const falhas = await t.fim();
await b.close();
await limparFicticios({ soEstaExecucao: true });
await fecharSql();
process.exit(falhas ? 1 : 0);
