// F2: o front no backend real. Fluxos no NAVEGADOR contra o preview do Pages (DADOS=supabase) e o Supabase de
// homologação, só com dados fictícios: solicitação residencial até a confirmação manual do pagamento; empresa com 4
// diárias; cadastro de diarista com documentos e aprovação; atribuição, execução e avaliação; cancelamento com diária
// já feita; login de importado; painel (clientes, preços, notificações); sessão expirada e erro de rede.
// Uso: LD_LIBRARY_PATH=... bash scripts/cli.sh node22 scripts/testa-f2-preview.mjs [url]
import { execFileSync } from 'node:child_process';
import { criarSuite, assert } from './lib-teste.mjs';
import { abrirNavegador } from './pw.mjs';
import { admin, criarUsuario, emailTeste, sql, fecharSql, limparFicticios, cpfFicticio, exigirTelefonesLivres, ENV, EXECUCAO } from './lib-supabase.mjs';
import { proximaDataPermitida } from './fixtures/seed.js';
import { dataNoFuso } from '../src/domain/calendario.js';
import { CONFIG_PRECOS } from '../src/config/precos.js';

const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim().replace(/[/_.]/g, '-').toLowerCase();
const BASE = (process.argv[2] || `https://${branch}.prime-limpeza.pages.dev/`).replace(/\/?$/, '/');
const t = criarSuite(`F2 front no backend real (${BASE})`);
await limparFicticios();
const b = await abrirNavegador();
const HOJE = dataNoFuso(new Date().toISOString());
let DATA = proximaDataPermitida(HOJE, 3, CONFIG_PRECOS);
while (new Date(`${DATA}T12:00:00Z`).getUTCDay() === 6 || CONFIG_PRECOS.feriados.includes(DATA)) DATA = proximaDataPermitida(DATA, 1, CONFIG_PRECOS);
// empresa noutro dia: integral conflita com a diária da manhã da mesma profissional
let DATA2 = proximaDataPermitida(DATA, 1, CONFIG_PRECOS);
while (new Date(`${DATA2}T12:00:00Z`).getUTCDay() === 6 || CONFIG_PRECOS.feriados.includes(DATA2) || DATA2 === DATA) DATA2 = proximaDataPermitida(DATA2, 1, CONFIG_PRECOS);
const CNPJ = '98XYZ76501AB46';
const [{ n: cnpjReal }] = await sql('select count(*)::int n from public.clientes where documento = $1 and not ficticio', [CNPJ]);
if (cnpjReal) throw new Error('CNPJ fictício existe na base real: troque');
await exigirTelefonesLivres(['31988887777', '31977776666']);
const MARCA = `F2 ${EXECUCAO}`; // nome dos clientes criados à mão (sem usuário), pra limpar

const adminPrime = await criarUsuario('f2-admin', 'prime_admin');
const atendPrime = await criarUsuario('f2-atend', 'prime_atendimento');
const extras = { usuarios: [] }; // contas criadas fora do padrão (completar e-mail)

async function contexto(largura = 390) {
  const ctx = await b.newContext({ viewport: { width: largura, height: 900 }, reducedMotion: 'reduce' });
  await ctx.route('https://viacep.com.br/**', (r) => r.fulfill({ json: { logradouro: 'Rua Fictícia', bairro: 'Savassi', localidade: 'Belo Horizonte', uf: 'MG' } }));
  return ctx;
}
async function pagina(ctx) {
  const p = await ctx.newPage();
  p.erros = [];
  p.on('pageerror', (e) => p.erros.push(e.message));
  p.on('console', (m) => m.type() === 'error' && !/status of (400|401|403|404|409|429)|Failed to load resource/.test(m.text()) && p.erros.push(m.text()));
  return p;
}
const avancar = (p) => p.getByRole('button', { name: 'Continuar' }).click();
const titulo = (p) => p.locator('#titulo-passo').textContent();
const marcar = (p, sel) => p.locator(sel).evaluate((i) => { if (!i.checked) i.click(); });
async function entrarPainel(p, u) {
  await p.goto(`${BASE}painel/entrar/`);
  await p.fill('#email', u.email); await p.fill('#senha', u.senha);
  await p.getByRole('button', { name: 'Entrar', exact: true }).click();
  await p.waitForURL(/painel\/(\?|$)/);
}
async function painel(p, aba, extra = '') {
  await p.goto(`${BASE}painel/?aba=${aba}${extra}`);
  await p.waitForSelector('.abas [aria-current=page]');
  await p.waitForFunction(() => !document.querySelector('.carregando'));
}
async function tique(escopo) {
  const r = await fetch(`${ENV.SUPABASE_URL}/functions/v1/notificacoes`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-worker-segredo': ENV.WORKER_SEGREDO }, body: JSON.stringify({ agora: new Date(Date.now() + 10000).toISOString(), escopo }) });
  assert.equal(r.status, 200);
}
async function passoCliente(p, { tipo, email, cpf, cnpj }) {
  await p.goto(`${BASE}autoagendamento/`); await p.waitForSelector('#titulo-passo');
  await marcar(p, `input[name=tipo][value=${tipo}]`);
  if (tipo === 'empresa') { await p.fill('#cnpj', cnpj); await p.fill('#razaoSocial', 'Empresa Fictícia de Teste Ltda'); await p.fill('#responsavel', 'Carlos Teste'); }
  await avancar(p);
  return { email, cpf };
}

const S = {}; // estado entre os testes

t.teste('residencial avulso pelo site: a cliente nova ganha conta e o pedido nasce no banco, sem cobrança', async () => {
  const ctx = await contexto(); const p = await pagina(ctx);
  S.cli = { ctx, email: emailTeste('f2-cli'), cpf: cpfFicticio() };
  await passoCliente(p, { tipo: 'residencial' });
  await p.fill('#metragem', '45'); await marcar(p, 'input[name=duracaoHoras][value="4"]');
  assert.equal(await p.locator('[data-valor=dia]').textContent(), 'R$ 175,00', 'preço da tabela vigente no banco');
  await avancar(p);
  await p.fill('#cep', '30130-010'); await p.waitForFunction(() => document.querySelector('#cidade').value === 'Belo Horizonte');
  await p.fill('#numero', '100'); await avancar(p);
  await p.fill('#primeiraData', DATA); await marcar(p, 'input[name=turno][value=manha]');
  await p.waitForSelector(`#calendario [data-data="${DATA}"]`);
  await avancar(p);
  await p.fill('#nome', 'Clara Fictícia F2'); await p.fill('#telefone', '31988887777'); await p.fill('#email', S.cli.email);
  await p.fill('#cpf', S.cli.cpf); await p.fill('#dataNascimento', '1990-04-12');
  await avancar(p);
  assert.match(await titulo(p), /Confira e envie/);
  await p.getByRole('button', { name: 'Enviar solicitação' }).dblclick(); // duplo clique
  await p.waitForURL(/acompanhamento\/\?pedido=/, { timeout: 30000 });
  await p.waitForSelector('#solicitacao-enviada');
  S.pedido = new URL(p.url()).searchParams.get('pedido');
  const ped = await sql(`select p.status, p.ficticio, c.email, c.origem, (select count(*)::int from public.pagamentos g where g.pedido_id = p.id) pgs,
    (select count(*)::int from public.pedidos x where x.cliente_id = c.id) n from public.pedidos p join public.clientes c on c.id = p.cliente_id where p.id = $1`, [S.pedido]);
  assert.equal(ped.length, 1);
  assert.deepEqual([ped[0].status, ped[0].ficticio, ped[0].email, ped[0].origem, ped[0].pgs, ped[0].n], ['solicitado', true, S.cli.email, 'site', 0, 1]);
  S.cli.p = p;
  assert.deepEqual(p.erros, []);
});

t.teste('Prime no painel: confirma a disponibilidade (nasce a cobrança integral)', async () => {
  const ctx = await contexto(1280); const p = await pagina(ctx);
  S.prime = { ctx, p };
  await entrarPainel(p, adminPrime);
  await painel(p, 'solicitacoes');
  const card = p.locator(`[data-solicitacao="${S.pedido}"]`);
  await card.waitFor();
  await card.getByRole('button', { name: 'Confirmar disponibilidade' }).click();
  await p.waitForFunction((id) => !document.querySelector(`[data-solicitacao="${id}"]`), S.pedido);
  const [g] = await sql('select id, status, valor_centavos, parcela from public.pagamentos where pedido_id = $1', [S.pedido]);
  assert.deepEqual([g.status, Number(g.valor_centavos), g.parcela], ['pendente', 17500, 'diaria']);
  S.pagamento = g.id;
});

t.teste('cliente vê a cobrança e avisa que pagou; a Prime confirma o recebimento (auditado)', async () => {
  const p = S.cli.p;
  await p.goto(`${BASE}pagamento/?pagamento=${S.pagamento}`);
  await p.getByRole('button', { name: 'Já paguei' }).click();
  await p.waitForFunction(async () => true);
  for (let i = 0; i < 20; i++) { const [x] = await sql('select status from public.pagamentos where id = $1', [S.pagamento]); if (x.status === 'informado_pelo_cliente') break; await new Promise((r) => setTimeout(r, 500)); }
  const [x] = await sql('select status from public.pagamentos where id = $1', [S.pagamento]);
  assert.equal(x.status, 'informado_pelo_cliente');
  const pp = S.prime.p;
  await painel(pp, 'pagamentos');
  await pp.locator(`tr[data-pagamento="${S.pagamento}"]`).getByRole('button', { name: 'Confirmar recebimento' }).click();
  await pp.waitForSelector(`tr[data-pagamento="${S.pagamento}"][data-status=confirmado]`);
  const [y] = await sql('select status, metodo, confirmado_por from public.pagamentos where id = $1', [S.pagamento]);
  assert.deepEqual([y.status, y.metodo, y.confirmado_por], ['confirmado', 'manual', adminPrime.id]);
  const [a] = await sql(`select count(*)::int n from public.auditoria where tabela = 'pagamentos' and registro_id = $1 and ator_contexto = 'prime'`, [S.pagamento]);
  assert.ok(a.n > 0);
});

t.teste('diarista nova: conta no passo 1, documentos pela function, envio; Prime abre documento e aprova no painel', async () => {
  const ctx = await contexto(); const p = await pagina(ctx);
  S.dia = { ctx, p, email: emailTeste('f2-dia'), senha: `Senha-${EXECUCAO}` };
  await p.goto(`${BASE}diarista/cadastro/`); await p.waitForSelector('#titulo-passo');
  await p.fill('#nome', 'Joana Fictícia F2'); await p.fill('#cpf', cpfFicticio()); await p.fill('#dataNascimento', '1985-07-20');
  await p.fill('#telefone', '31977775555'); await p.fill('#email', S.dia.email);
  await avancar(p);
  assert.match(await p.locator('[data-campo=senha] .erro-campo').textContent(), /8 caracteres/);
  await p.fill('#senha', S.dia.senha);
  await avancar(p);
  await p.waitForFunction(() => /Onde você mora/.test(document.querySelector('#titulo-passo')?.textContent || ''), null, { timeout: 30000 });
  await p.fill('#cep', '30140-071'); await p.waitForFunction(() => document.querySelector('#cidade').value === 'Belo Horizonte');
  await p.fill('#numero', '45'); await avancar(p);
  await p.fill('#experienciaAnos', '6');
  for (const d of ['1', '2', '3', '4', '5']) await marcar(p, `input[name=dias][value="${d}"]`);
  await marcar(p, 'input[name=turnos][value=manha]'); await marcar(p, 'input[name=regioes][value="BH - Centro-Sul"]');
  await avancar(p);
  await p.waitForFunction(() => /Documentos/.test(document.querySelector('#titulo-passo')?.textContent || ''));
  await marcar(p, 'input[name=identidade][value=cnh]');
  for (const [tipo, arq] of [['cnh_frente', 'foto-ficticia.png'], ['cnh_verso', 'foto-ficticia.png'], ['foto_perfil', 'foto-ficticia.png'], ['comprovante_residencia', 'documento-ficticio.pdf'], ['antecedentes', 'documento-ficticio.pdf']]) {
    await p.locator(`#doc-${tipo}`).setInputFiles(`scripts/fixtures/${arq}`);
    await p.waitForSelector(`[data-doc=${tipo}][data-estado=ok]`, { timeout: 30000 });
  }
  assert.equal(await p.locator('[data-doc=foto_perfil] .previa img').count(), 1, 'prévia da própria foto nesta página');
  await avancar(p);
  await marcar(p, 'input[name=aceiteTermos]');
  await p.getByRole('button', { name: 'Enviar cadastro' }).click();
  await p.waitForSelector('[data-cadastro]', { timeout: 30000 });
  const [d] = await sql(`select d.id, d.status, d.ficticio, (select count(*)::int from public.documentos x where x.diarista_id = d.id and x.excluido_em is null) docs
    from public.diaristas d where d.email = $1`, [S.dia.email]);
  assert.deepEqual([d.status, d.ficticio, d.docs], ['pendente', true, 5]);
  S.dia.id = d.id;
  const pp = S.prime.p;
  await painel(pp, 'cadastros');
  const bloco = pp.locator(`[data-diarista="${d.id}"]`).first();
  await bloco.getByRole('button', { name: 'Ver' }).first().click();
  await bloco.locator('img, iframe').first().waitFor({ timeout: 30000 });
  const [ac] = await sql('select count(*)::int n from public.acessos_documentos where diarista_id = $1 and user_id = $2', [d.id, adminPrime.id]);
  assert.equal(ac.n, 1, 'abertura registrada');
  await bloco.getByRole('button', { name: 'Aprovar cadastro' }).click();
  for (let i = 0; i < 20; i++) { const [x] = await sql('select status from public.diaristas where id = $1', [d.id]); if (x.status === 'aprovada') break; await new Promise((r) => setTimeout(r, 500)); }
  const [x] = await sql('select status from public.diaristas where id = $1', [d.id]);
  assert.equal(x.status, 'aprovada');
});

t.teste('Prime atribui; a diarista entra, vê a agenda e leva a diária até finalizada; a cliente responde a pesquisa', async () => {
  const pp = S.prime.p;
  const [at] = await sql('select id from public.atendimentos where pedido_id = $1', [S.pedido]);
  S.atendimento = at.id;
  await painel(pp, 'atribuir');
  const linha = pp.locator(`tr[data-atendimento="${at.id}"]`);
  await linha.locator('select').selectOption(S.dia.id);
  await linha.getByRole('button', { name: 'Atribuir' }).click();
  for (let i = 0; i < 20; i++) { const [x] = await sql('select diarista_id from public.atendimentos where id = $1', [at.id]); if (x.diarista_id) break; await new Promise((r) => setTimeout(r, 500)); }
  // login de verdade, em outro aparelho (o do cadastro já está logado)
  const ctxLogin = await contexto(); const p = await pagina(ctxLogin);
  S.dia.p = p;
  await p.goto(`${BASE}diarista/entrar/`);
  await p.fill('#email', S.dia.email); await p.fill('#senha', S.dia.senha);
  await p.getByRole('button', { name: 'Entrar', exact: true }).click();
  await p.waitForURL(/diarista\/agenda\//);
  for (const botao of ['Estou a caminho', 'Iniciei a diária', 'Finalizei']) {
    const btn = p.locator(`[data-atendimento="${at.id}"]`).getByRole('button', { name: botao });
    await btn.waitFor({ timeout: 30000 });
    await btn.click();
    await btn.waitFor({ state: 'detached', timeout: 30000 });
  }
  const [x] = await sql('select status from public.atendimentos where id = $1', [at.id]);
  assert.equal(x.status, 'finalizado');
  const c = S.cli.p;
  await c.goto(`${BASE}avaliacao/?atendimento=${at.id}`);
  for (const k of ['pontualidade', 'qualidade', 'cuidado', 'comunicacao']) await marcar(c, `input[name=${k}][value="5"]`);
  await c.getByRole('button', { name: 'Enviar resposta' }).click();
  for (let i = 0; i < 20; i++) { const [y] = await sql('select status from public.atendimentos where id = $1', [at.id]); if (y.status === 'avaliado') break; await new Promise((r) => setTimeout(r, 500)); }
  const [y] = await sql('select status from public.atendimentos where id = $1', [at.id]);
  assert.equal(y.status, 'avaliado');
});

t.teste('notificações do fluxo aparecem no painel, pelo simulado', async () => {
  await tique([S.pedido, S.dia.id]);
  const pp = S.prime.p;
  await painel(pp, 'notificacoes');
  await pp.waitForSelector('[data-saude]');
  for (const tpl of ['solicitacao_recebida', 'pagamento_confirmado', 'atendimento_finalizado', 'cadastro_aprovado']) {
    assert.ok(await pp.locator(`#lista-notificacoes li[data-template=${tpl}][data-status=simulada]`).count() >= 1, tpl);
  }
  assert.match(await pp.locator('#lista-notificacoes').textContent(), /simulado/);
});

t.teste('empresa com 4 diárias pelo site; cancelamento com a primeira já feita cancela só as futuras', async () => {
  const ctx = await contexto(1280); const p = await pagina(ctx);
  const email = emailTeste('f2-emp');
  await passoCliente(p, { tipo: 'empresa', cnpj: CNPJ });
  await marcar(p, 'input[name=tipoServico][value=empresarial]'); await p.fill('#metragem', '100');
  await marcar(p, 'input[name=duracaoHoras][value="8"]'); await marcar(p, 'input[name=semLocalAlmoco][value=nao]');
  await marcar(p, 'input[name=frequencia][value=semanal]'); await p.fill('#quantidadeDiarias', '4');
  await avancar(p);
  await p.fill('#cep', '30130-010'); await p.waitForFunction(() => document.querySelector('#cidade').value === 'Belo Horizonte');
  await p.fill('#numero', '500'); await avancar(p);
  await p.fill('#primeiraData', DATA2); await marcar(p, 'input[name=turno][value=integral]');
  await p.waitForSelector('#calendario li >> nth=3');
  await avancar(p);
  await p.fill('#nome', 'Carlos Teste'); await p.fill('#telefone', '31977776666'); await p.fill('#email', email);
  await avancar(p);
  await p.getByRole('button', { name: 'Enviar solicitação' }).click();
  await p.waitForURL(/acompanhamento\/\?pedido=/, { timeout: 30000 });
  const pedido = new URL(p.url()).searchParams.get('pedido');
  const ats = await sql('select id, data from public.atendimentos where pedido_id = $1 order by sequencia', [pedido]);
  assert.equal(ats.length, 4);
  // Prime confirma, recebe a 1ª, atribui e a 1ª é feita (pelo painel e pela agenda)
  const pp = S.prime.p;
  await painel(pp, 'solicitacoes');
  await pp.locator(`[data-solicitacao="${pedido}"]`).getByRole('button', { name: 'Confirmar disponibilidade' }).click();
  await pp.waitForFunction((id) => !document.querySelector(`[data-solicitacao="${id}"]`), pedido);
  const [g1] = await sql('select id from public.pagamentos where atendimento_id = $1', [ats[0].id]);
  await painel(pp, 'pagamentos');
  await pp.locator(`tr[data-pagamento="${g1.id}"]`).getByRole('button', { name: 'Confirmar recebimento' }).click();
  await pp.waitForSelector(`tr[data-pagamento="${g1.id}"][data-status=confirmado]`);
  await painel(pp, 'atribuir');
  const linha = pp.locator(`tr[data-atendimento="${ats[0].id}"]`);
  await linha.locator('select').selectOption(S.dia.id);
  await linha.getByRole('button', { name: 'Atribuir' }).click();
  await pp.waitForSelector(`tr[data-atendimento="${ats[0].id}"] select`, { state: 'attached' });
  for (let i = 0; i < 20; i++) { const [x] = await sql('select diarista_id from public.atendimentos where id = $1', [ats[0].id]); if (x.diarista_id) break; await new Promise((r) => setTimeout(r, 500)); }
  const [atr] = await sql('select diarista_id from public.atendimentos where id = $1', [ats[0].id]);
  assert.equal(atr.diarista_id, S.dia.id, 'atribuída pelo painel');
  const d = S.dia.p;
  await d.goto(`${BASE}diarista/agenda/`);
  for (const botao of ['Estou a caminho', 'Iniciei a diária', 'Finalizei']) {
    const btn = d.locator(`[data-atendimento="${ats[0].id}"]`).getByRole('button', { name: botao });
    await btn.waitFor({ timeout: 30000 }); await btn.click(); await btn.waitFor({ state: 'detached', timeout: 30000 });
  }
  // a cliente cancela o pedido pelo acompanhamento
  await p.goto(`${BASE}acompanhamento/?pedido=${pedido}`);
  await p.getByRole('button', { name: 'Cancelar pedido' }).click();
  await p.getByRole('button', { name: 'Sim, cancelar as diárias pendentes' }).click();
  for (let i = 0; i < 20; i++) { const [x] = await sql(`select count(*)::int n from public.atendimentos where pedido_id = $1 and status = 'cancelado'`, [pedido]); if (x.n === 3) break; await new Promise((r) => setTimeout(r, 500)); }
  const st = (await sql('select status from public.atendimentos where pedido_id = $1 order by sequencia', [pedido])).map((x) => x.status);
  assert.deepEqual(st, ['finalizado', 'cancelado', 'cancelado', 'cancelado']);
  const pend = await sql(`select status from public.pagamentos where pedido_id = $1 and atendimento_id <> $2`, [pedido, ats[0].id]);
  assert.ok(pend.every((x) => x.status === 'cancelado'), 'cobranças das canceladas saem');
  assert.deepEqual(p.erros, []);
});

t.teste('cliente importado fictício (CPF com zero à esquerda) entra pelo e-mail e vê Minha conta', async () => {
  let cpf = cpfFicticio(); while (!cpf.startsWith('0')) cpf = cpfFicticio();
  const u = await criarUsuario('f2-imp', 'cliente', cpf.slice(0, 6));
  await sql(`insert into public.clientes (usuario_id, tipo, nome, email, tipo_documento, documento, data_nascimento, origem, ficticio)
    values ($1, 'residencial', 'Importada Fictícia F2', $2, 'cpf', $3, '1970-01-02', 'importado', true)`, [u.id, u.email, cpf]);
  const ctx = await contexto(); const p = await pagina(ctx);
  await p.goto(`${BASE}entrar/`);
  await p.fill('#identificador', u.email); await p.fill('#senha', cpf.slice(0, 6));
  await p.getByRole('button', { name: 'Entrar', exact: true }).click();
  await p.waitForURL(/minha-conta\//);
  await p.waitForFunction(() => /Importada/.test(document.body.textContent));
  await ctx.close();
});

t.teste('painel Clientes: filtro de pendência e sem acesso, completar e-mail cria o acesso, bloquear e desbloquear', async () => {
  const [c] = await sql(`insert into public.clientes (tipo, nome, tipo_documento, documento, origem, pendencias, ficticio)
    values ('residencial', $1, 'cpf', $2, 'importado', '{sem_email}', true) returning id`, [`${MARCA} Sem Email`, cpfFicticio()]);
  const pp = S.prime.p;
  await painel(pp, 'clientes', `&pendencia=sem_email&semAcesso=1&busca=${encodeURIComponent(MARCA)}`);
  const linha = pp.locator(`tr[data-cliente="${c.id}"]`);
  await linha.waitFor();
  assert.match(await linha.textContent(), /sem e-mail/);
  assert.match(await pp.locator('select[name=pendencia]').textContent(), /sem e-mail \(\d+\)/, 'contagem por pendência');
  const email = emailTeste('f2-completa');
  await linha.locator('summary', { hasText: 'Completar e-mail' }).click();
  await linha.locator('input[type=email]').fill(email);
  await linha.getByRole('button', { name: 'Salvar e criar acesso' }).click();
  for (let i = 0; i < 20; i++) { const [x] = await sql('select usuario_id from public.clientes where id = $1', [c.id]); if (x.usuario_id) break; await new Promise((r) => setTimeout(r, 500)); }
  const [x] = await sql('select usuario_id, email, pendencias from public.clientes where id = $1', [c.id]);
  assert.ok(x.usuario_id); assert.equal(x.email, email); assert.deepEqual(x.pendencias, []);
  extras.usuarios.push(x.usuario_id);
  await painel(pp, 'clientes', `&busca=${encodeURIComponent(MARCA)}`);
  const l2 = pp.locator(`tr[data-cliente="${c.id}"]`);
  await l2.getByRole('button', { name: 'Bloquear acesso' }).click();
  await pp.waitForSelector(`tr[data-cliente="${c.id}"] >> text=bloqueado`);
  const [pf] = await sql('select bloqueado from public.perfis where user_id = $1', [x.usuario_id]);
  assert.equal(pf.bloqueado, true);
  await pp.locator(`tr[data-cliente="${c.id}"]`).getByRole('button', { name: 'Desbloquear' }).click();
  await pp.waitForSelector(`tr[data-cliente="${c.id}"] >> text=nunca entrou`);
});

t.teste('painel Preços: admin grava tabela nova e o site passa a mostrar; atendimento só vê', async () => {
  const pp = S.prime.p;
  try {
    await painel(pp, 'precos');
    await pp.fill('#preco-duracao-4', '176,00');
    await pp.getByRole('button', { name: 'Salvar nova tabela' }).click();
    for (let i = 0; i < 20; i++) { const [x] = await sql(`select tabela #>> '{PRECOS,duracoes,4,centavos}' v from public.precos order by vigente_desde desc limit 1`); if (x.v === '17600') break; await new Promise((r) => setTimeout(r, 500)); }
    const [x] = await sql(`select tabela #>> '{PRECOS,duracoes,4,centavos}' v, criado_por from public.precos order by vigente_desde desc limit 1`);
    assert.equal(x.v, '17600'); assert.equal(x.criado_por, adminPrime.id);
    const ctx = await contexto(); const p = await pagina(ctx);
    await passoCliente(p, { tipo: 'residencial' });
    await p.fill('#metragem', '45'); await marcar(p, 'input[name=duracaoHoras][value="4"]');
    assert.equal(await p.locator('[data-valor=dia]').textContent(), 'R$ 176,00', 'site lê a tabela vigente do banco');
    await ctx.close();
    const c2 = await contexto(1280); const q = await pagina(c2);
    await entrarPainel(q, atendPrime);
    await painel(q, 'precos');
    assert.equal(await q.getByRole('button', { name: 'Salvar nova tabela' }).count(), 0);
    assert.ok(await q.locator('#preco-duracao-4').getAttribute('readonly') !== null);
    await c2.close();
  } finally {
    // tira a versão de teste: a anterior volta a ser a vigente
    await sql('delete from public.precos where criado_por = $1', [adminPrime.id]);
  }
});

t.teste('sessão expirada no painel leva pra entrada; erro de rede mostra "Tentar de novo"', async () => {
  const ctx = await contexto(1280); const p = await pagina(ctx);
  await entrarPainel(p, atendPrime);
  await ctx.route('**/rest/v1/rpc/listar_atendimentos', (r) => r.abort());
  await p.goto(`${BASE}painel/?aba=agenda`);
  await p.waitForSelector('.alerta-erro');
  assert.match(await p.locator('.alerta-erro').textContent(), /Não conseguimos falar com o servidor/);
  assert.equal(await p.locator('[data-acao=tentar-de-novo]').count(), 1);
  await ctx.unroute('**/rest/v1/rpc/listar_atendimentos');
  const [u] = await sql(`select id from auth.users where email = $1`, [atendPrime.email]);
  await sql('delete from auth.sessions where user_id = $1', [u.id]); // derruba a sessão (refresh deixa de valer)
  await p.goto(`${BASE}painel/?aba=agenda`);
  await p.waitForURL(/painel\/entrar\//, { timeout: 30000 });
  await ctx.close();
});

t.teste('sem overflow em 375 no painel de clientes e sem erro de console nas páginas percorridas', async () => {
  const ctx = await contexto(375); const p = await pagina(ctx);
  await entrarPainel(p, adminPrime);
  await painel(p, 'clientes', `&busca=${encodeURIComponent(MARCA)}`);
  const larg = await p.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(larg <= 375, `scrollWidth ${larg}`);
  for (const pg of [S.cli.p, S.dia.p, S.prime.p, p]) assert.deepEqual(pg.erros, []);
  await ctx.close();
});

try {
  await t.fim();
} finally {
  for (const id of extras.usuarios) {
    await sql('update public.clientes set usuario_id = null where usuario_id = $1', [id]);
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }
  await sql(`delete from public.clientes where ficticio and usuario_id is null and nome like $1`, [`${MARCA}%`]);
  await limparFicticios({ soEstaExecucao: true });
  await b.close();
  await fecharSql();
}
