// E5 no navegador: cadastro de diarista com fixtures, documentos no IndexedDB, retomada, bloqueio de obrigatório, envio duplo.
import { criarSuite, assert } from './lib-teste.mjs';
import { abrirNavegador, subirServidor } from './pw.mjs';
import { DIARISTA_FICTICIA } from './fixtures/seed.js';

const t = criarSuite('E5 navegador (cadastro de diarista)');
const { base, fechar } = await subirServidor();
const b = await abrirNavegador();
const ctx = await b.newContext({ viewport: { width: 390, height: 900 } });
await ctx.route('https://viacep.com.br/**', (route) => route.fulfill({ json: { logradouro: 'Rua Modelo', bairro: 'Funcionários', localidade: 'Belo Horizonte', uf: 'MG' } }));
await ctx.route('**/src/config/prime.js', (route) => route.fulfill({ path: 'src/config/prime.teste.js', contentType: 'text/javascript' }));
const p = await ctx.newPage();
const erros = [];
p.on('console', (m) => m.type() === 'error' && erros.push(m.text()));
p.on('pageerror', (e) => erros.push(e.message));
const avancar = () => p.getByRole('button', { name: 'Continuar' }).click();
const titulo = () => p.locator('#titulo-passo').textContent();
// Inputs de opção ficam visualmente ocultos (1px): marca via clique no DOM, que dispara change como o clique real.
const marcar = (sel) => p.locator(sel).evaluate((i) => { if (!i.checked) i.click(); });
const D = DIARISTA_FICTICIA;

t.teste('passo 1: menor de idade e CPF inválido bloqueiam com mensagem', async () => {
  await p.goto(`${base}diarista/cadastro/`); await p.waitForSelector('#titulo-passo');
  await p.fill('#nome', D.nome); await p.fill('#cpf', '111.111.111-11'); await p.fill('#dataNascimento', '2015-01-01'); await p.fill('#telefone', D.telefone); await p.fill('#email', D.email);
  await avancar();
  assert.match(await p.locator('[data-campo=cpf] .erro-campo').textContent(), /CPF inválido/);
  assert.match(await p.locator('[data-campo=dataNascimento] .erro-campo').textContent(), /18 anos/);
  await p.fill('#cpf', D.cpf); await p.fill('#dataNascimento', D.dataNascimento);
  await avancar(); assert.match(await titulo(), /Onde você mora/);
});

t.teste('passo 2 e 3: endereço via CEP; disponibilidade exige dia, período e região', async () => {
  await p.fill('#cep', '30140-071'); await p.waitForFunction(() => document.querySelector('#cidade').value === 'Belo Horizonte');
  await p.fill('#numero', '45'); await avancar(); assert.match(await titulo(), /Experiência/);
  await avancar();
  assert.match(await p.locator('[data-campo=experienciaAnos] .erro-campo').textContent(), /anos/);
  assert.match(await p.locator('[data-campo=dias] .erro-campo').textContent(), /um dia/);
  await p.fill('#experienciaAnos', '8');
  for (const d of ['1', '3']) await marcar(`input[name=dias][value="${d}"]`);
  await marcar('input[name=turnos][value=manha]');
  await marcar('input[name=regioes][value="BH - Centro-Sul"]');
  await avancar();
  await p.waitForFunction(() => /Documentos/.test(document.querySelector('#titulo-passo')?.textContent || '')); // passo assíncrono (lista documentos)
});

t.teste('passo 4: conteúdo que não confere e arquivo > 5 MB são recusados; sem obrigatórios não avança; prévia; troca', async () => {
  await marcar('input[name=identidade][value=cnh]');
  const { readFileSync } = await import('node:fs');
  await p.locator('#doc-foto_perfil').setInputFiles({ name: 'falso.png', mimeType: 'image/png', buffer: readFileSync('scripts/fixtures/documento-ficticio.pdf') });
  await p.waitForSelector('[data-doc=foto_perfil][data-estado=invalido]');
  assert.match(await p.locator('[data-doc=foto_perfil] .erro-campo').textContent(), /não confere/);
  const grande = Buffer.concat([readFileSync('scripts/fixtures/foto-ficticia.png'), Buffer.alloc(5 * 1024 * 1024)]);
  await p.locator('#doc-foto_perfil').setInputFiles({ name: 'grande.png', mimeType: 'image/png', buffer: grande });
  await p.waitForFunction(() => /5 MB/.test(document.querySelector('[data-doc=foto_perfil] .erro-campo')?.textContent || ''));
  await avancar();
  await p.waitForFunction(() => /Anexe os documentos que faltam/.test(document.querySelector('.alerta-erro')?.textContent || '')); // validação assíncrona
  for (const tipo of ['cnh_frente', 'cnh_verso', 'foto_perfil']) {
    await p.locator(`#doc-${tipo}`).setInputFiles('scripts/fixtures/foto-ficticia.png');
    await p.waitForSelector(`[data-doc=${tipo}][data-estado=ok]`);
  }
  assert.equal(await p.locator('[data-doc=foto_perfil] .previa img').count(), 1, 'prévia da imagem');
  for (const tipo of ['comprovante_residencia', 'antecedentes']) {
    await p.locator(`#doc-${tipo}`).setInputFiles('scripts/fixtures/documento-ficticio.pdf');
    await p.waitForSelector(`[data-doc=${tipo}][data-estado=ok]`);
  }
  assert.equal(await p.locator('[data-doc=antecedentes] .previa').textContent(), 'PDF');
  await p.locator('#doc-foto_perfil').setInputFiles('scripts/fixtures/foto-ficticia.png'); // troca
  await p.waitForSelector('[data-doc=foto_perfil][data-estado=ok]');
});

t.teste('recarregar mostra os documentos já enviados (IndexedDB) e o mesmo passo', async () => {
  await p.reload(); await p.waitForSelector('[data-doc=cnh_frente][data-estado=ok]');
  assert.match(await titulo(), /Documentos/);
  assert.equal(await p.locator('[data-doc][data-estado=ok]').count(), 5);
  await p.waitForSelector('[data-doc=foto_perfil] .previa img');
  await avancar();
  await p.waitForFunction(() => /Conferir e enviar/.test(document.querySelector('#titulo-passo')?.textContent || ''));
});

t.teste('passo 5: termos obrigatórios; envio duplo não duplica; sucesso com WhatsApp manual', async () => {
  await p.getByRole('button', { name: 'Enviar cadastro' }).click();
  assert.match(await p.locator('[data-campo=aceiteTermos] .erro-campo').textContent(), /aceite/);
  await marcar('input[name=aceiteTermos][value=sim]');
  await p.getByRole('button', { name: 'Enviar cadastro' }).dblclick();
  await p.waitForSelector('[data-cadastro]');
  assert.ok(await p.locator('[data-whatsapp=manual]').isVisible());
  const n = await p.evaluate(async (raiz) => { const { api } = await import(`${raiz}src/services/api.js`); const r = await api.listarDiaristas({}, { sessao: { ator: 'prime' } }); return r.itens.filter((d) => d.cpf === '11144477735' && d.nome.includes('Fictícia') && d.status === 'pendente').length; }, base);
  assert.equal(n, 1, 'uma diarista pendente (a do seed já está aprovada)');
  await p.reload(); await p.waitForSelector('[data-cadastro]');
  const notif = await p.evaluate(async (raiz) => { const { api } = await import(`${raiz}src/services/api.js`); const r = await api.listarNotificacoes({}, { sessao: { ator: 'prime' } }); return r.itens.filter((x) => x.template === 'cadastro_recebido').length; }, base);
  assert.equal(notif, 1, 'cadastro_recebido uma vez');
});

t.teste('página de antecedentes abre com links oficiais', async () => {
  await p.goto(`${base}diarista/antecedentes/`); await p.waitForSelector('h1');
  const hrefs = await p.locator('a[target=_blank]').evaluateAll((l) => l.map((a) => a.href));
  assert.ok(hrefs.some((h) => h.includes('policiacivil.mg.gov.br')) && hrefs.some((h) => h.includes('gov.br')));
});

t.teste('sem overflow em 390px e sem erro no console', async () => {
  for (const u of ['diarista/cadastro/', 'diarista/antecedentes/']) {
    await p.goto(base + u); await p.waitForLoadState('networkidle');
    const ov = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(ov <= 0, `${u} overflow ${ov}`);
  }
  assert.deepEqual(erros, [], JSON.stringify(erros));
});

const falhas = await t.fim();
await b.close(); await fechar();
process.exit(falhas ? 1 : 0);
