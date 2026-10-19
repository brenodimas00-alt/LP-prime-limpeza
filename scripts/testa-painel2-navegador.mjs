// Painel v2 no navegador (mock, seed fictício). Cresce a cada entrega da etapa B.
// B2: casca (menu lateral e inferior com "Mais"), links antigos ?aba= viram a tela nova com a mesma seção, busca única,
// contador de solicitações e sino, menu da conta, sem rolagem lateral em 320/375/1440.
import { criarSuite, assert } from './lib-teste.mjs';
import { abrirNavegador, subirServidor } from './pw.mjs';
import { CREDENCIAIS_MOCK as C } from './fixtures/seed.js';

const t = criarSuite('painel v2 no navegador (mock)');
const { base, fechar } = await subirServidor();
const b = await abrirNavegador();
async function paginaPrime(largura = 1440, caminho = 'painel/') {
  const ctx = await b.newContext({ viewport: { width: largura, height: 900 }, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  p.erros = [];
  p.on('pageerror', (e) => p.erros.push(e.message));
  p.on('console', (m) => m.type() === 'error' && p.erros.push(m.text()));
  await p.goto(base);
  await p.evaluate((c) => localStorage.setItem('prime.sessao', JSON.stringify({ ator: 'prime', id: c.id, nome: c.nome, papel: 'prime_admin' })), C.prime[0]);
  await p.goto(`${base}${caminho}`);
  await p.waitForSelector('.p-casca');
  return p;
}

t.teste('B2 links antigos: ?aba=pagamentos abre Financeiro com a seção antiga; ?aba=precos abre Gestão > Configurações na seção Preços', async () => {
  const p = await paginaPrime(1440, 'painel/?aba=pagamentos');
  await p.waitForSelector('.painel-legado');
  assert.equal(await p.locator('.p-menu a[aria-current=page]').innerText(), 'Financeiro');
  assert.equal(await p.locator('h1').innerText(), 'Financeiro');
  await p.goto(`${base}painel/?aba=precos`); await p.waitForSelector('.painel-legado');
  assert.equal(await p.locator('.p-submenu a[aria-current=page]').innerText(), 'Configurações');
  assert.equal(await p.locator('nav[aria-label=Seções] a[aria-current=page]').innerText(), 'Preços e horários');
  assert.deepEqual(p.erros, []);
});

t.teste('B2 menu: Gestão abre e fecha o submenu (aria-expanded) e o contador de solicitações tem rótulo pro leitor de tela', async () => {
  const p = await paginaPrime();
  const g = p.locator('.p-menu button[aria-controls=p-sub-gestao]');
  const antes = await g.getAttribute('aria-expanded');
  await g.click();
  assert.notEqual(await g.getAttribute('aria-expanded'), antes);
  await p.waitForFunction(() => document.querySelector('.p-menu .p-badge'));
  assert.match(await p.locator('.p-menu .p-badge').getAttribute('aria-label'), /^\d+ solicita(ção nova|ções novas)$/);
  assert.match(await p.locator('.p-topo a[aria-label^=Pendências]').getAttribute('aria-label'), /Pendências: \d+ urgente/);
});

t.teste('B2 busca única: 3 letras mostram cliente e profissional; Enter abre o primeiro; termo curto não busca', async () => {
  const p = await paginaPrime();
  await p.fill('#p-busca', 'Fi');
  await p.waitForTimeout(500);
  assert.equal(await p.locator('#p-busca-res').isHidden(), true);
  await p.fill('#p-busca', 'Fictícia');
  await p.waitForSelector('#p-busca-res [role=option]');
  const texto = await p.locator('#p-busca-res').innerText();
  assert.match(texto, /Clientes[\s\S]*Ana Teste Fictícia/);
  await p.keyboard.press('ArrowDown');
  assert.equal(await p.locator('#p-busca-res [role=option]').first().getAttribute('aria-selected'), 'true');
  await p.keyboard.press('Enter');
  await p.waitForURL(/tela=clientes&cliente=/);
  await p.goto(`${base}painel/`); await p.waitForSelector('.p-casca');
  await p.fill('#p-busca', 'Fictícia'); await p.waitForSelector('#p-busca-res [role=option]');
  await p.fill('#p-busca', ''); await p.waitForTimeout(450);
  assert.equal(await p.locator('#p-busca-res').isHidden(), true, 'limpar a busca fecha os resultados');
  await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  assert.doesNotMatch(p.url(), /cliente=/, 'Enter com a busca vazia não abre resultado antigo');
  await p.fill('#p-busca', 'nenhumacoisa');
  await p.waitForFunction(() => /Nada encontrado/.test(document.querySelector('#p-busca-res')?.textContent || ''));
});

t.teste('B2 celular: menu inferior com 4 telas + Mais; "Mais" abre Profissionais, Financeiro e a Gestão e fecha com Esc; menu da conta tem Sair', async () => {
  const p = await paginaPrime(390);
  const barra = p.locator('.p-barra-inferior');
  assert.deepEqual((await barra.locator('a, button').allInnerTexts()).map((x) => x.replace(/\d+/g, '').trim()), ['Início', 'Solicitações', 'Agenda', 'Clientes', 'Mais']);
  await barra.getByRole('button', { name: 'Mais' }).click();
  assert.match(await p.getByRole('dialog', { name: 'Mais opções' }).innerText(), /Profissionais[\s\S]*Financeiro[\s\S]*Indicadores[\s\S]*Automações[\s\S]*Configurações[\s\S]*Ajuda[\s\S]*Sair/);
  for (let i = 0; i < 14; i++) await p.keyboard.press('Tab');
  assert.ok(await p.evaluate(() => !!document.activeElement.closest('[role=dialog]')), 'Tab fica na folha');
  await p.getByRole('dialog', { name: 'Mais opções' }).getByRole('button', { name: 'Fechar' }).click();
  assert.equal(await p.getByRole('dialog', { name: 'Mais opções' }).count(), 0);
  await barra.getByRole('button', { name: 'Mais' }).click();
  await p.keyboard.press('Escape');
  assert.equal(await p.getByRole('dialog', { name: 'Mais opções' }).count(), 0);
  await p.locator('.p-usuario').click();
  assert.equal(await p.locator('.p-topo [role=menu] button', { hasText: 'Sair' }).isVisible(), true);
});

t.teste('B2 sem rolagem lateral em 320, 375 e 1440 nas telas da casca', async () => {
  for (const w of [320, 375, 1440]) {
    for (const tela of ['inicio', 'solicitacoes', 'agenda', 'clientes', 'profissionais', 'financeiro', 'gestao&sec=configuracoes']) {
      const p = await paginaPrime(w, `painel/?tela=${tela}`);
      await p.waitForSelector('.painel-legado, .p-vazio', { timeout: 15000 }).catch(() => {});
      const [sw, iw] = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
      assert.ok(sw <= iw, `${tela} em ${w}px: ${sw} > ${iw}`);
      assert.deepEqual(p.erros, [], `${tela} em ${w}px`);
      await p.context().close();
    }
  }
});

// ---------- B3: Início
const linhas = (p) => p.locator('[data-bloco=inicio-solicitacoes] tr.p-lin');
t.teste('B3 Início: blocos na ordem da spec, cada um carrega sozinho; solicitações novas com a primeira camada e expansão', async () => {
  const p = await paginaPrime();
  await p.waitForSelector('[data-bloco=inicio-solicitacoes] tr.p-lin');
  const titulos = await p.locator('section.p-bloco:not([hidden]) h2').allInnerTexts();
  assert.deepEqual(titulos.slice(0, 4), ['Solicitações novas', 'Diárias de hoje', 'Diárias de amanhã', 'Precisa de você']);
  assert.ok(titulos.includes('Meta de diárias') && titulos.includes('Motivos de cancelamento') && titulos.includes('Regiões mais atendidas'));
  assert.match(await p.locator('h1').innerText(), /^(Bom dia|Boa tarde|Boa noite), Equipe!$/);
  const l = linhas(p).first();
  assert.match(await l.innerText(), /Ana Teste Fictícia[\s\S]*Savassi - BH[\s\S]*Residencial[\s\S]*R\$ 203,00/);
  await l.getByRole('button', { name: /^Ver detalhes de/ }).click();
  await p.waitForFunction(() => /Nº da solicitação|Modalidade|Datas/.test(document.querySelector('[data-bloco=inicio-solicitacoes] tr.p-det')?.textContent || ''));
  assert.match(await p.locator('[data-bloco=inicio-solicitacoes] tr.p-det').innerText(), /Datas[\s\S]*Endereço/);
  assert.deepEqual(p.erros, []);
});

t.teste('B3 Aprovar é 1 clique a partir do Início: a linha sai, nasce a cobrança e o contador do menu desce', async () => {
  const p = await paginaPrime();
  await p.waitForSelector('[data-bloco=inicio-solicitacoes] tr.p-lin');
  const antes = await linhas(p).count();
  await linhas(p).first().getByRole('button', { name: /^Aprovar a solicitação de/ }).click();
  await p.waitForFunction((n) => document.querySelectorAll('[data-bloco=inicio-solicitacoes] tr.p-lin').length === n - 1, antes);
  await p.waitForFunction((n) => (document.querySelector('.p-menu .p-badge')?.textContent || '0') === String(n - 1) || (n === 1 && !document.querySelector('.p-menu .p-badge')), antes);
  assert.deepEqual(p.erros, []);
});

t.teste('B3 Recusar pede motivo padronizado; Negociar data manda a proposta e marca a linha', async () => {
  const p = await paginaPrime();
  await p.waitForSelector('[data-bloco=inicio-solicitacoes] tr.p-lin');
  const l = linhas(p).first();
  await l.getByRole('button', { name: /^Negociar data com/ }).click();
  const dlg = p.getByRole('dialog');
  await dlg.getByRole('button', { name: 'Enviar proposta à cliente' }).click();
  assert.match(await dlg.innerText(), /Escolha a nova data/);
  const { somarDias } = await import('../src/domain/calendario.js');
  let d = somarDias(new Date().toISOString().slice(0, 10), 3); while (new Date(`${d}T12:00:00Z`).getUTCDay() === 0) d = somarDias(d, 1);
  await dlg.locator('#neg-data').fill(d);
  await dlg.getByRole('button', { name: 'Enviar proposta à cliente' }).click();
  await p.waitForFunction(() => /Data proposta:/.test(document.querySelector('[data-bloco=inicio-solicitacoes]')?.textContent || ''));
  const antes = await linhas(p).count();
  await linhas(p).first().getByRole('button', { name: /^Recusar a solicitação de/ }).click();
  const m = p.getByRole('dialog');
  await m.getByRole('button', { name: 'Recusar e avisar a cliente' }).click();
  assert.match(await m.innerText(), /Escolha o motivo/);
  await m.locator('select').selectOption({ index: 1 });
  await m.getByRole('button', { name: 'Recusar e avisar a cliente' }).click();
  await p.waitForFunction((n) => document.querySelectorAll('[data-bloco=inicio-solicitacoes] tr.p-lin').length === n - 1 || /Nenhuma solicitação nova/.test(document.querySelector('[data-bloco=inicio-solicitacoes]')?.textContent || ''), antes);
  assert.deepEqual(p.erros, []);
});

t.teste('B3 Precisa de você: item com ação direta, filtro por tipo; blocos vazios somem; indicadores com tabela alternativa', async () => {
  const p = await paginaPrime();
  await p.waitForSelector('[data-bloco=inicio-pendencias] .p-lista, [data-bloco=inicio-pendencias] .p-resolvido');
  const pend = p.locator('[data-bloco=inicio-pendencias]');
  if (await pend.locator('.p-lista li').count()) {
    assert.match(await pend.innerText(), /Cadastro de profissional pra analisar/);
    await pend.getByRole('button', { name: /^Contratos/ }).click();
    assert.ok(await pend.locator('.p-lista li[data-tipo=cadastro_profissional]').count() >= 1);
  }
  for (const b of ['inicio-standby', 'inicio-alertas', 'inicio-cadastros']) {
    const sec = p.locator(`[data-bloco=${b}]`);
    await p.waitForFunction((id) => { const s = document.querySelector(`[data-bloco=${id}]`); return s && (s.hidden || !s.querySelector('.p-esqueleto')); }, b);
    if (await sec.isVisible()) assert.ok(await sec.locator('.p-lista li').count() >= 1, `${b} visível só com itens`);
  }
  await p.waitForSelector('[data-bloco=inicio-regioes] .p-alternancia');
  await p.locator('[data-bloco=inicio-regioes]').getByRole('button', { name: 'Bairros' }).click();
  assert.equal(await p.locator('[data-bloco=inicio-regioes]').getByRole('button', { name: 'Bairros' }).getAttribute('aria-pressed'), 'true');
  assert.deepEqual(p.erros, []);
});

// ---------- B4: demais telas
t.teste('B4 as 16 abas antigas abrem a tela nova com a mesma seção (nada some)', async () => {
  const p = await paginaPrime();
  const MAPA = { solicitacoes: 'Solicitações', agenda: 'Agenda e escala', atribuir: 'Agenda e escala', pagamentos: 'Financeiro', clientes: 'Clientes', prospeccao: 'Clientes', privacidade: 'Clientes',
    cadastros: 'Profissionais', avaliacoes: 'Profissionais', notificacoes: 'Automações', config: 'Configurações', precos: 'Configurações', ajuda: 'Ajuda' };
  for (const [aba, titulo] of Object.entries(MAPA)) {
    await p.goto(`${base}painel/?aba=${aba}`);
    await p.waitForSelector('.painel-legado, .p-vazio', { timeout: 15000 });
    assert.equal(await p.locator('h1').innerText(), titulo, aba);
  }
  assert.deepEqual(p.erros, []);
});

t.teste('B4 Solicitações: filtro de situação na URL, lista com as ações e o link ?pedido= abre o painel lateral', async () => {
  const p = await paginaPrime(1440, 'painel/?tela=solicitacoes');
  await p.waitForSelector('[data-solicitacao]');
  assert.match(await p.locator('[role=status]').first().innerText(), /2 solicitações/);
  await p.getByRole('group', { name: 'Situação' }).getByRole('button', { name: 'Confirmadas' }).click();
  await p.waitForURL(/estado=confirmadas/); await p.waitForSelector('text=Nenhuma solicitação com esses filtros.');
  await p.goto(`${base}painel/?tela=solicitacoes&estado=todas`); await p.waitForSelector('[data-solicitacao]');
  const id = await p.locator('[data-solicitacao]').first().getAttribute('data-solicitacao');
  await p.goto(`${base}painel/?tela=solicitacoes&estado=todas&pedido=${id}`);
  await p.waitForSelector('aside.p-lateral');
  await p.keyboard.press('Escape');
  assert.equal(await p.locator('aside.p-lateral').count(), 0);
  assert.deepEqual(p.erros, []);
});

t.teste('B4 Escala do dia: sem profissional não publica; designar e publicar marca "Publicada às"', async () => {
  const p = await paginaPrime(1440, 'painel/?tela=solicitacoes');
  await p.waitForSelector('[data-solicitacao]');
  await p.locator('[data-solicitacao]').first().getByRole('button', { name: /^Aprovar a solicitação de/ }).click(); // Ana: diária avulsa
  await p.waitForFunction(() => document.querySelectorAll('[data-solicitacao]').length === 1);
  const data = await p.evaluate(async () => { const { api } = await import('/LP-prime-limpeza/src/services/api.js'); const r = await api.painelSolicitacoes({ estado: 'aguardando' }); return r.itens[0].primeiraData; });
  await p.goto(`${base}painel/?tela=agenda&aba=escala&data=${data}`);
  await p.waitForSelector('[data-bloco=agenda-escala] .p-selo');
  await p.locator('[data-bloco=agenda-escala] button.p-selo').click();
  await p.getByRole('dialog').getByRole('button', { name: 'Marcar como revisada' }).click();
  await p.waitForFunction(() => /Revisada/.test(document.querySelector('[data-bloco=agenda-escala] button.p-selo')?.textContent || ''));
  await p.locator('[data-bloco=agenda-escala] button.p-selo').click();
  await p.getByRole('dialog').getByRole('button', { name: 'Publicar e avisar as profissionais' }).click();
  await p.waitForFunction(() => /Designe antes de publicar/.test(document.body.textContent));
  await p.evaluate(async (d) => {
    const { api } = await import('/LP-prime-limpeza/src/services/api.js');
    const at = (await api.painelDiarias(d)).itens.find((x) => !x.profissional);
    await api.atribuirDiarista(at.id, { diaristaId: '00000000-0000-4000-8000-00000000d001' }, { chave: crypto.randomUUID() });
  }, data);
  await p.reload(); await p.waitForSelector('[data-bloco=agenda-escala] button.p-selo');
  await p.locator('[data-bloco=agenda-escala] button.p-selo').click();
  await p.getByRole('dialog').getByRole('button', { name: 'Publicar e avisar as profissionais' }).click();
  await p.waitForFunction(() => /Publicada às \d\d:\d\d/.test(document.querySelector('[data-bloco=agenda-escala] button.p-selo')?.textContent || ''));
  assert.deepEqual(p.erros, []);
});

t.teste('B4 Profissionais: habilidades salvas aparecem como ícones; Financeiro: registrar adiantamento e recusar com motivo; Gestão: motivo novo e meta', async () => {
  const p = await paginaPrime(1440, 'painel/?tela=profissionais');
  await p.waitForSelector('[data-profissional]');
  const linha = p.locator('[data-profissional]', { hasText: 'Maria Teste Fictícia' });
  await linha.getByRole('button', { name: 'Habilidades' }).click();
  await p.locator('#hab-passadoria').check();
  await p.getByRole('button', { name: 'Salvar habilidades' }).click();
  await p.waitForFunction(() => [...document.querySelectorAll('[data-profissional] .p-habilidades [role=img]')].some((x) => x.getAttribute('aria-label') === 'Passadoria'));
  await p.goto(`${base}painel/?tela=financeiro&aba=adiantamentos`);
  await p.getByRole('button', { name: 'Registrar pedido da profissional' }).click();
  await p.fill('#rp-valor', '80,00');
  await p.getByRole('button', { name: 'Registrar', exact: true }).click();
  await p.waitForSelector('[data-solicitacao]');
  await p.locator('[data-solicitacao]').first().getByRole('button', { name: 'Recusar' }).click();
  await p.getByRole('dialog').locator('textarea').fill('Fora da política (teste)');
  await p.getByRole('dialog').getByRole('button', { name: 'Recusar' }).click();
  await p.waitForFunction(() => /Recusado/.test(document.querySelector('[data-solicitacao]')?.textContent || ''));
  await p.goto(`${base}painel/?tela=gestao&sec=configuracoes&aba=motivos`);
  await p.waitForSelector('#novo-cancelamento');
  await p.fill('#novo-cancelamento', 'Chuva forte (teste)');
  await p.locator('#novo-cancelamento').locator('xpath=../..').getByRole('button', { name: 'Adicionar' }).click();
  await p.waitForSelector('[data-motivo="cancelamento:chuva_forte_teste"]');
  await p.fill('#meta-pct', '15'); await p.getByRole('button', { name: 'Salvar meta' }).click();
  await p.waitForFunction(() => /Meta salva/.test(document.body.textContent));
  await p.goto(`${base}painel/?tela=inicio`);
  await p.waitForFunction(() => /\+15% sobre o mês anterior/.test(document.querySelector('[data-bloco=inicio-meta]')?.textContent || ''));
  assert.deepEqual(p.erros, []);
});

t.teste('B4 Clientes: a busca abre a ficha com a linha do tempo única e o resumo', async () => {
  const p = await paginaPrime();
  await p.fill('#p-busca', 'Ana Teste');
  await p.waitForSelector('#p-busca-res [role=option]');
  await p.keyboard.press('Enter');
  await p.waitForSelector('#tl-titulo');
  const txt = await p.locator('main').innerText();
  assert.match(txt, /Ana Teste Fictícia[\s\S]*Solicitações[\s\S]*Diárias feitas[\s\S]*Linha do tempo[\s\S]*Solicitação enviada/);
  assert.ok(!/\bI01\b|\bC01\b/.test(txt), 'mensagens com a descrição, não o código; só as da cliente');
  assert.deepEqual(p.erros, []);
});

t.teste('demonstração (seed rico): todos os blocos do Início com dados, urgências marcadas, sem erro no console', async () => {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const p = await ctx.newPage(); const erros = [];
  p.on('pageerror', (e) => erros.push(e.message)); p.on('console', (m) => m.type() === 'error' && erros.push(m.text()));
  await p.goto(base);
  await p.evaluate((c) => { localStorage.setItem('prime.sessao', JSON.stringify({ ator: 'prime', id: c.id, nome: c.nome, papel: 'prime_admin' })); localStorage.setItem('prime.seedDemo', 'painel'); }, C.prime[1]);
  await p.goto(`${base}painel/?tela=inicio`);
  await p.waitForSelector('[data-bloco=inicio-solicitacoes] tr.p-lin', { timeout: 30000 });
  await p.waitForFunction(() => document.querySelectorAll('section.p-bloco').length >= 9 && document.querySelectorAll('section.p-bloco .p-esqueleto').length === 0, null, { timeout: 30000 });
  for (const b2 of ['inicio-solicitacoes', 'inicio-pendencias', 'inicio-alertas', 'inicio-cadastros']) assert.ok(await p.locator(`[data-bloco=${b2}] .p-lista li, [data-bloco=${b2}] tr.p-lin`).count() >= 1, b2);
  assert.match(await p.locator('[data-bloco=inicio-pendencias] .p-bloco-cab').innerText(), /\d+ urgentes?/);
  assert.match(await p.locator('[data-bloco=inicio-meta]').innerText(), /Mês anterior[\s\S]*\d+/);
  assert.match(await p.locator('[data-bloco=inicio-regioes]').innerText(), /Belo Horizonte/);
  assert.match(await p.locator('.p-sistema-btn').innerText(), /\d+ ações automáticas hoje/);
  assert.deepEqual(erros, []);
  await ctx.close();
});

// ---------- B5: linguagem, ajuda e tour
t.teste('B5 tour: convite no 1º acesso (não cobre nada); "Agora não" some e lembra; pela Ajuda o tour passa pelos 5 passos e Esc fecha', async () => {
  const p = await paginaPrime();
  await p.waitForSelector('.p-tour-convite');
  await p.getByRole('button', { name: 'Agora não' }).click();
  await p.reload(); await p.waitForSelector('[data-bloco=inicio-solicitacoes] tr.p-lin');
  assert.equal(await p.locator('.p-tour-convite').count(), 0, 'lembra a escolha');
  await p.goto(`${base}painel/?tela=gestao&sec=ajuda`);
  await p.getByRole('link', { name: 'Ver o tour de novo' }).click();
  await p.waitForSelector('.p-tour[role=dialog]');
  const titulos = [];
  for (let i = 0; i < 5; i++) {
    titulos.push(await p.locator('#p-tour-titulo').innerText());
    assert.equal(await p.locator('.p-tour-alvo').count(), 1, 'aponta pra algo real da tela');
    if (i < 4) await p.getByRole('button', { name: 'Próximo' }).click();
  }
  assert.deepEqual(titulos, ['As partes do painel', 'Uma busca só', 'Solicitações novas', 'Precisa de você', 'Sistema trabalhando por você']);
  await p.keyboard.press('Escape');
  assert.equal(await p.locator('.p-tour').count(), 0);
  assert.deepEqual(p.erros, []);
});

t.teste('B5 ajuda e linguagem: 14 tarefas partindo do Início, com imagem e link; nenhum termo técnico nas telas principais', async () => {
  const p = await paginaPrime(1440, 'painel/?tela=gestao&sec=ajuda');
  await p.waitForSelector('.ajuda-tarefa');
  assert.equal(await p.locator('.ajuda-tarefa').count(), 14);
  const quebradas = await p.evaluate(async () => (await Promise.all([...document.querySelectorAll('.print-ajuda')].map(async (i) => ((await fetch(i.src)).ok ? null : i.src)))).filter(Boolean));
  assert.deepEqual(quebradas, []);
  for (const q of ['tela=inicio', 'tela=solicitacoes&estado=todas', 'tela=financeiro', 'tela=gestao&sec=configuracoes', 'tela=profissionais']) {
    await p.goto(`${base}painel/?${q}`); await p.waitForTimeout(1500);
    const txt = await p.locator('body').innerText();
    for (const j of [/\btxid\b/i, /\bworker\b/i, /\bmotor\b/i, /\bflag\b/i, /idempot/i, /\bRPC\b/, /\bpayload\b/i, /lgpd_|p\d_[a-z]/]) assert.ok(!j.test(txt), `${q}: ${j}`);
  }
});

// ---------- B6: celular
t.teste('B6 celular: indicadores e listas secundárias começam recolhidos; ações com alvo de 44 px; cartão sem coluna secundária; 320 sem rolagem lateral', async () => {
  for (const w of [390, 320]) {
    const p = await paginaPrime(w);
    await p.waitForSelector('[data-bloco=inicio-solicitacoes] tr.p-lin');
    for (const b2 of ['inicio-meta', 'inicio-motivos', 'inicio-regioes']) assert.equal(await p.locator(`[data-bloco=${b2}] .p-recolher`).getAttribute('aria-expanded'), 'false', `${b2} recolhido em ${w}`);
    assert.equal(await p.locator('[data-bloco=inicio-solicitacoes] .p-recolher').getAttribute('aria-expanded'), 'true', 'a prioridade fica aberta');
    const pequenos = await p.evaluate(() => [...document.querySelectorAll('[data-bloco=inicio-solicitacoes] .p-acoes-cel button, [data-bloco=inicio-pendencias] .p-acoes-item button, .p-recolher, .p-barra-inferior a, .p-barra-inferior button')]
      .filter((x) => x.getClientRects().length).map((x) => x.getBoundingClientRect()).filter((r) => r.height < 44 || r.width < 40).length);
    assert.equal(pequenos, 0, `alvos menores que 44 px em ${w}`);
    assert.equal(await p.locator('[data-bloco=inicio-solicitacoes] tr.p-lin').first().locator('td.p-oculta-celular').isVisible(), false);
    const [sw, iw] = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert.ok(sw <= iw, `${w}: ${sw} > ${iw}`);
    assert.equal(await p.locator('.p-barra-inferior').evaluate((e) => getComputedStyle(e).position), 'fixed');
    assert.deepEqual(p.erros, []);
    await p.context().close();
  }
});

await t.fim();
await b.close(); await fechar();
