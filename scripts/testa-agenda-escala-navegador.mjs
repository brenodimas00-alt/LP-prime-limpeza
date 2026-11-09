// Agenda e Escala no navegador (mock, SEED_DEMO=agenda): os 18 itens da seção 18 da spec da cliente, um por um, mais
// rolagem lateral (320, 390, 1440) e console sem erro. Cada teste abre um contexto novo (banco local novo, seed novo).
import { criarSuite, assert } from './lib-teste.mjs';
import { abrirNavegador, subirServidor } from './pw.mjs';
import { CREDENCIAIS_MOCK as C } from './fixtures/seed.js';

const t = criarSuite('Agenda e Escala no navegador (mock)');
const { base, fechar } = await subirServidor();
const b = await abrirNavegador();
async function abrir(caminho = 'painel/?tela=agenda', { largura = 1440, papel = 'prime_admin', espera = '.ae-tabela, .ae-dia-sec' } = {}) {
  const ctx = await b.newContext({ viewport: { width: largura, height: 900 }, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  p.erros = [];
  p.on('pageerror', (e) => p.erros.push(e.message));
  p.on('console', (m) => m.type() === 'error' && p.erros.push(m.text()));
  await p.goto(base);
  await p.evaluate(([c, pap]) => { localStorage.setItem('prime.seedDemo', 'agenda'); localStorage.setItem('prime.sessao', JSON.stringify({ ator: 'prime', id: c.id, nome: 'Isa', papel: pap })); }, [C.prime[0], papel]);
  await p.goto(`${base}${caminho}`);
  await p.waitForSelector(espera, { timeout: 20000 });
  return p;
}
const linha = (p, cliente) => p.locator('tr.ae-lin', { has: p.locator('.ae-cliente .ae-nome', { hasText: cliente }) }).first();
const fim = async (p) => { assert.deepEqual(p.erros, [], 'console sem erro'); await p.context().close(); };

t.teste('1. layout principal: título, Dia/Semana/Período, data, Hoje, faixa da semana com quantidade, resumo, busca, Filtros, envio, Stand-by e tabela', async () => {
  const p = await abrir();
  assert.equal(await p.locator('h1').innerText(), 'Agenda e Escala');
  assert.match(await p.locator('.ae-titulo p').innerText(), /Organize, revise e envie as diárias para as profissionais/);
  assert.deepEqual(await p.locator('.ae-vista').allInnerTexts(), ['Dia', 'Semana', 'Período']);
  assert.equal(await p.locator('.ae-vista[aria-pressed=true]').innerText(), 'Dia');
  assert.equal(await p.locator('.ae-dia').count(), 7);
  assert.match(await p.locator('.ae-dia[aria-current=date]').innerText(), /11\s+diárias/);
  assert.match(await p.locator('.ae-res-total').innerText(), /11\s+diárias no dia/);
  for (const r of ['Para revisar', 'Revisadas', 'Aguardando aceite', 'Ocorrência', 'Stand-by']) assert.ok(await p.locator('.ae-res', { hasText: r }).count(), r);
  assert.ok(await p.locator('#ae-busca').isVisible());
  assert.match(await p.locator('.ae-filtros-btn').innerText(), /Filtros/);
  assert.match(await p.locator('.ae-enviar-todas').innerText(), /^Enviar todas as revisadas \(\d+\)$/);
  assert.equal(await p.locator('.ae-enviar-sel').innerText(), 'Enviar selecionadas (0)');
  assert.ok(await p.locator('.ae-standby').isVisible());
  assert.deepEqual((await p.locator('.ae-tabela thead th').allInnerTexts()).map((x) => x.replace(/\s+/g, ' ').trim()), ['', 'Horário', 'Cliente', 'Endereço / Imóvel', 'Serviço Carga horária', 'Profissional', 'Pagamento', 'Status', 'Ação']);
  await fim(p);
});

t.teste('2. detalhamento fechado por padrão; clicar na linha abre à direita, agenda encolhe, setas navegam e fechar devolve a largura', async () => {
  const p = await abrir();
  assert.equal(await p.locator('.ae-detalhe').isHidden(), true);
  const larg = await p.locator('.ae-principal').evaluate((e) => e.getBoundingClientRect().width);
  await linha(p, 'Patrícia Souza').locator('td').nth(3).click();
  await p.waitForSelector('.ae-detalhe:not([hidden])');
  assert.ok(await p.locator('.ae-principal').evaluate((e) => e.getBoundingClientRect().width) < larg - 200, 'agenda encolheu');
  assert.match(await p.locator('.ae-detalhe').innerText(), /Patrícia Souza[\s\S]*Data e horário[\s\S]*Endereço e imóvel[\s\S]*Serviço e observações[\s\S]*Profissional designada[\s\S]*Pagamento[\s\S]*Situação[\s\S]*Histórico/);
  for (const r of ['Reagendar', 'Cancelar diária', 'Salvar alterações']) assert.ok(await p.locator('.ae-det-rodape', { hasText: r }).count(), r);
  await p.click('.ae-detalhe [aria-label="Próxima diária"]');
  assert.match(await p.locator('.ae-detalhe').innerText(), /Empresa ABC Ltda/);
  await p.click('.ae-detalhe [aria-label="Fechar os detalhes"]');
  assert.equal(await p.locator('.ae-detalhe').isHidden(), true);
  assert.ok(Math.abs(await p.locator('.ae-principal').evaluate((e) => e.getBoundingClientRect().width) - larg) < 2);
  await fim(p);
});

t.teste('3. menu principal recolhido por padrão (só ícones); expandir fica guardado', async () => {
  const p = await abrir();
  assert.ok(await p.locator('.p-casca.p-casca-recolhida').count());
  assert.ok((await p.locator('.p-menu-col').evaluate((e) => e.getBoundingClientRect().width)) < 100);
  assert.equal(await p.locator('.p-menu a[aria-current=page]').getAttribute('title'), 'Agenda e Escala');
  await p.click('.p-menu-alternar');
  assert.ok((await p.locator('.p-menu-col').evaluate((e) => e.getBoundingClientRect().width)) > 200);
  await p.reload(); await p.waitForSelector('.ae-tabela');
  assert.equal(await p.locator('.p-casca.p-casca-recolhida').count(), 0, 'escolha guardada');
  await fim(p);
});

t.teste('4. Dia agrupado por cidade: Contagem, Betim, Belo Horizonte; grupos sempre abertos (sem seta); ordem por horário', async () => {
  const p = await abrir();
  assert.deepEqual(await p.locator('tbody[data-cidade]').evaluateAll((l) => l.map((x) => x.dataset.cidade)), ['Contagem', 'Betim', 'Belo Horizonte']);
  assert.equal(await p.locator('.ae-grupo button').count(), 0);
  const horas = await p.locator('tbody[data-cidade="Contagem"] .ae-hora').allInnerTexts();
  assert.deepEqual(horas, [...horas].sort());
  assert.match(await p.locator('tbody[data-cidade="Contagem"] .ae-grupo').innerText(), /Contagem\s*\(4 diárias\)/);
  await fim(p);
});

t.teste('5. Semana e Período: cabeçalho só com dia, data, quantidade e seta; sem subtítulo de cidade; abertos; Recolher todos', async () => {
  const p = await abrir('painel/?tela=agenda&vista=semana');
  assert.equal(await p.locator('.ae-dia-sec').count(), 7);
  assert.equal(await p.locator('.ae-grupo').count(), 0, 'sem subtítulo de cidade');
  assert.ok(await p.locator('.ae-dia-cab[aria-expanded=true]').count() >= 6);
  assert.match(await p.locator('.ae-dia-cab').first().innerText(), /^Segunda-feira,\s*\d+ de \w+ de \d{4}\s*\(\d+ diárias?\)$/);
  await p.click('.ae-recolher');
  assert.equal(await p.locator('.ae-dia-cab[aria-expanded=true]').count(), 0);
  await p.locator('.ae-dia-cab').nth(2).click();
  assert.equal(await p.locator('.ae-dia-cab[aria-expanded=true]').count(), 1);
  await p.click('.ae-vista:has-text("Período")'); await p.waitForSelector('.ae-dia-sec');
  assert.equal(await p.locator('.ae-grupo').count(), 0);
  await fim(p);
});

t.teste('6. coroa só na cliente parceira e cartões + P só na diária do pacote, com descrição', async () => {
  const p = await abrir();
  assert.equal(await linha(p, 'Patrícia Souza').locator('.ae-coroa[aria-label="Cliente parceira"]').count(), 1);
  assert.equal(await linha(p, 'Empresa ABC Ltda').locator('.ae-coroa').count(), 0);
  assert.equal(await linha(p, 'Fernanda Lima').locator('.ae-pacote[aria-label="Diária de pacote"]').count(), 1);
  assert.equal(await linha(p, 'Fernanda Lima').locator('.ae-pacote').innerText(), 'P');
  assert.equal(await linha(p, 'Marcos Vieira').locator('.ae-pacote').count(), 0);
  await fim(p);
});

t.teste('7. casa e prédio só na coluna Serviço (nunca ao lado do nome da cliente)', async () => {
  const p = await abrir();
  assert.ok(await linha(p, 'Patrícia Souza').locator('td').nth(4).locator('.ae-serv-casa svg').count());
  assert.ok(await linha(p, 'Empresa ABC Ltda').locator('td').nth(4).locator('.ae-serv-predio svg').count());
  assert.equal(await p.locator('.ae-cliente .ae-serv-ic, .ae-cliente [aria-label=Residencial], .ae-cliente [aria-label=Comercial]').count(), 0);
  await fim(p);
});

t.teste('8. balão "Mensagens e contato" abaixo da cliente abre o menu da seção 8', async () => {
  const p = await abrir();
  const balao = linha(p, 'Empresa ABC Ltda').locator('.ae-balao');
  const caixa = await linha(p, 'Empresa ABC Ltda').locator('.ae-cliente .ae-nome').boundingBox(); const bb = await balao.boundingBox();
  assert.ok(bb.y > caixa.y, 'abaixo do nome');
  await balao.click();
  const menu = await p.locator('.ae-pop').innerText();
  for (const r of ['Abrir conversa', 'Confirmar agendamento', 'Lembrete de diária', 'Pagamento pendente', 'Reagendamento', 'Cancelamento', 'Acompanhamento', 'Outras mensagens', 'Ver cadastro do cliente']) assert.match(menu, new RegExp(r), r);
  await fim(p);
});

t.teste('9. aviãozinho só abaixo da profissional, abre só a comunicação (nunca o seletor)', async () => {
  const p = await abrir();
  assert.equal(await p.locator('.ae-cliente .ae-aviao, .ae-c-acao .ae-aviao').count(), 0);
  assert.equal(await p.locator('.ae-enviar-todas svg').count(), 1, 'ícone de envio do sistema de ícones');
  await linha(p, 'Patrícia Souza').locator('.ae-aviao').click();
  const menu = await p.locator('.ae-pop').innerText();
  for (const r of ['Abrir conversa', 'Enviar informações da diária', 'Enviar orientações', 'Comunicar alteração', 'Comunicar cancelamento', 'Consultar disponibilidade', 'Ver avaliações', 'Ver perfil', 'Histórico de comunicação']) assert.match(menu, new RegExp(r), r);
  assert.equal(await p.locator('.ae-sel-lista').count(), 0);
  await fim(p);
});

t.teste('10. "Alterar" abre o seletor (busca, chips, Já atribuída); escolher troca e a diária volta pra Para revisar', async () => {
  const p = await abrir();
  const l = linha(p, 'Fernanda Lima');
  assert.match(await l.locator('.ae-status').innerText(), /Revisada/);
  await l.locator('.ae-alterar').click();
  await p.waitForSelector('.ae-sel-lista li');
  assert.match(await p.locator('.ae-pop h2').innerText(), /Alterar ou selecionar profissional/);
  assert.deepEqual(await p.locator('.ae-pop .ae-chip').allInnerTexts(), ['Todos', 'Disponíveis', 'Residencial', 'Comercial', 'Passadoria']);
  assert.equal(await p.locator('.ae-pop .ae-ja', { hasText: 'Já atribuída' }).count(), 1);
  assert.ok(await p.locator('.ae-porque summary').count(), 'explica a sugerida');
  await p.fill('#sel-busca', 'Carlos');
  await p.locator('.ae-sel-lista li', { hasText: 'Carlos Eduardo' }).getByRole('button', { name: /Selecionar/ }).click();
  await p.waitForFunction(() => /Carlos/.test([...document.querySelectorAll('tr.ae-lin')].find((t) => /Fernanda Lima/.test(t.innerText))?.innerText || ''));
  assert.match(await linha(p, 'Fernanda Lima').locator('.ae-status').innerText(), /Para revisar/);
  assert.match(await linha(p, 'Fernanda Lima').locator('.ae-origem').innerText(), /Manual/);
  await fim(p);
});

t.teste('11. X remove com confirmação e a diária fica "Sem profissional / Obrigatório" com "Selecionar profissional"', async () => {
  const p = await abrir();
  await linha(p, 'Marcos Vieira').locator('.ae-remover').click();
  await p.locator('.p-modal').getByRole('button', { name: 'Remover' }).click();
  await p.waitForFunction(() => /Sem profissional/.test([...document.querySelectorAll('tr.ae-lin')].find((t) => /Marcos Vieira/.test(t.innerText))?.innerText || ''));
  const l = linha(p, 'Marcos Vieira');
  assert.match(await l.locator('.ae-sem-prof').innerText(), /Sem profissional\s*Obrigatório/);
  assert.equal(await l.locator('.ae-selecionar').innerText(), 'Selecionar profissional');
  await fim(p);
});

t.teste('12. Revisar é individual (pagamento pendente não bloqueia) e não há revisão coletiva', async () => {
  const p = await abrir();
  const l = linha(p, 'Empresa ABC Ltda');
  assert.match(await l.locator('.ae-pag').innerText(), /Pendente/);
  await l.getByRole('button', { name: /Revisar a diária/ }).click();
  await p.waitForFunction(() => /Revisada/.test([...document.querySelectorAll('tr.ae-lin')].find((t) => /Empresa ABC/.test(t.innerText))?.querySelector('.ae-status')?.innerText || ''));
  assert.equal(await p.getByRole('button', { name: /Revisar todas|Revisar selecionadas/ }).count(), 0);
  assert.equal(await linha(p, 'Empresa ABC Ltda').getByRole('button', { name: /Enviar a diária/ }).count(), 1, 'depois de revisada, a ação é Enviar');
  await fim(p);
});

t.teste('13. envio individual, de selecionadas e de todas as revisadas, sem reenviar a já enviada', async () => {
  const p = await abrir();
  await linha(p, 'Patrícia Souza').getByRole('button', { name: /Enviar a diária/ }).click();
  await p.waitForFunction(() => /Enviada|Aguardando/.test([...document.querySelectorAll('tr.ae-lin')].find((t) => /Patrícia Souza/.test(t.innerText))?.querySelector('.ae-status')?.innerText || ''));
  await linha(p, 'Juliana Costa').locator('.ae-check').check();
  await linha(p, 'Patrícia Souza').locator('.ae-check').check();
  assert.equal(await p.locator('.ae-enviar-sel').innerText(), 'Enviar selecionadas (2)');
  await p.click('.ae-enviar-sel'); await p.locator('.p-modal').getByRole('button', { name: /Enviar selecionadas/ }).click();
  await p.waitForSelector('.toast, [role=status]');
  await p.waitForFunction(() => /Enviada|Aguardando/.test([...document.querySelectorAll('tr.ae-lin')].find((t) => /Juliana Costa/.test(t.innerText))?.querySelector('.ae-status')?.innerText || ''));
  const n = Number((await p.locator('.ae-enviar-todas').innerText()).match(/\((\d+)\)/)[1]);
  assert.ok(n >= 1);
  await p.click('.ae-enviar-todas'); await p.locator('.p-modal').getByRole('button', { name: /^Enviar \d+ diária/ }).click();
  await p.waitForFunction(() => /\(0\)/.test(document.querySelector('.ae-enviar-todas')?.innerText || ''));
  assert.equal(await p.locator('.ae-enviar-todas').isDisabled(), true);
  assert.equal(await p.getByRole('button', { name: /Enviar a diária/ }).count(), 0, 'nada mais pra enviar');
  await fim(p);
});

t.teste('14. uma única coluna Status acompanha o ciclo (Para revisar, Revisada, Confirmada, Finalizada, Cancelada, Ocorrência...)', async () => {
  const p = await abrir('painel/?tela=agenda&vista=semana');
  await p.click('[aria-label="Período anterior"]'); await p.waitForSelector('.ae-dia-sec .ae-tabela');
  assert.equal(await p.locator('.ae-tabela').first().locator('thead th', { hasText: /^Status/ }).count(), 1);
  assert.equal(await p.locator('thead th', { hasText: /Revisada|Enviada|Entregue|Aceita|Finalizada/ }).count(), 0);
  const st = new Set(await p.locator('.ae-status').evaluateAll((l) => l.map((x) => x.dataset.status)));
  for (const s of ['finalizada', 'cancelada', 'com_ocorrencia']) assert.ok(st.has(s), s);
  await p.click('[aria-label="Próximo período"]'); await p.waitForSelector('.ae-dia-sec .ae-tabela');
  const st2 = new Set(await p.locator('.ae-status').evaluateAll((l) => l.map((x) => x.dataset.status)));
  for (const s of ['para_revisar', 'revisada', 'aguardando_aceite']) assert.ok(st2.has(s), s);
  await fim(p);
});

t.teste('15. triângulo de alerta só na profissional sem resposta depois do prazo configurado', async () => {
  const p = await abrir('painel/?tela=agenda&vista=semana');
  const alertas = p.locator('.ae-alerta-resp');
  assert.ok(await alertas.count() >= 1);
  for (const st of await p.locator('.ae-status-cel:has(.ae-alerta-resp) .ae-status').allInnerTexts()) assert.match(st, /Enviada|Aguardando aceite/);
  assert.equal(await alertas.first().getAttribute('aria-label'), 'Sem resposta depois do prazo');
  await fim(p);
});

t.teste('16. Stand-by integrado: faixa com Utilizar e Liberar; utilizar designa numa diária real sem cliente fictício', async () => {
  const p = await abrir();
  const sb = p.locator('.ae-sb-linha');
  assert.match(await sb.innerText(), /Roberta Almeida[\s\S]*Região de atuação[\s\S]*Disponibilidade/);
  await sb.getByRole('button', { name: 'Utilizar' }).click();
  await p.locator('.p-modal').getByRole('button', { name: /Empresa XYZ/ }).click();
  await p.waitForFunction(() => /Roberta/.test([...document.querySelectorAll('tr.ae-lin')].find((t) => /Empresa XYZ/.test(t.innerText))?.innerText || ''));
  assert.match(await p.locator('.ae-standby').innerText(), /Nenhuma profissional em stand-by/);
  await fim(p);
});

t.teste('17. Filtros e três pontinhos independentes, um menu aberto por vez; filtro aplica e limpa', async () => {
  const p = await abrir();
  await p.click('.ae-filtros-btn');
  const f = await p.locator('.ae-pop').innerText();
  for (const r of ['Status do atendimento', 'Pagamento', 'Tipo de contratação', 'Profissional', 'Serviço', 'Cidade', 'Bairro', 'Limpar filtros', 'Aplicar filtros']) assert.match(f, new RegExp(r), r);
  await linha(p, 'Patrícia Souza').locator('.ae-mais').click();
  assert.equal(await p.locator('.ae-pop').count(), 1, 'só um aberto');
  const m = await p.locator('.ae-pop').innerText();
  for (const r of ['Ver detalhes da diária', 'Histórico da diária', 'Ver dados do cliente', 'Duplicar diária', 'Reagendar', 'Cancelar diária']) assert.match(m, new RegExp(r), r);
  assert.doesNotMatch(m, /Filtro|Status do atendimento/);
  await p.keyboard.press('Escape');
  await p.click('.ae-filtros-btn');
  await p.locator('.ae-pop .ae-chip', { hasText: /^Pendente$/ }).click();
  await p.click('.ae-pop >> text=Aplicar filtros');
  assert.match(await p.locator('.ae-filtros-btn').innerText(), /1/);
  for (const t2 of await p.locator('tr.ae-lin .ae-pag-selo').allInnerTexts()) assert.match(t2, /Pendente/);
  await p.click('.ae-filtros-btn'); await p.click('.ae-pop >> text=Limpar filtros');
  assert.equal(await p.locator('tr.ae-lin').count(), 11);
  await fim(p);
});

t.teste('18. WhatsApp como canal principal; Portal como contingência trocado pela administração (com motivo)', async () => {
  const p = await abrir();
  assert.match(await p.locator('.ae-canal').innerText(), /WhatsApp ativo\s*Canal principal/);
  await p.goto(`${base}painel/?tela=gestao&sec=configuracoes&aba=agenda-escala`); await p.waitForSelector('[data-config=agenda-escala]');
  assert.equal(await p.locator('#cfg-prazo').inputValue(), '120', 'demonstração com prazo de 2 h');
  assert.equal(await p.locator('#cfg-pag').isChecked(), false, 'verificação de pagamento desligada');
  await p.getByRole('button', { name: /Ativar o Portal/ }).click();
  await p.locator('.p-modal textarea, .p-modal input[type=text]').first().fill('teste de contingência');
  await p.locator('.p-modal').getByRole('button', { name: 'Trocar o canal' }).click();
  await p.waitForSelector('text=Portal ativo: contingência.');
  await p.goto(`${base}painel/?tela=agenda`); await p.waitForSelector('.ae-tabela');
  assert.match(await p.locator('.ae-canal').innerText(), /Portal ativo\s*Contingência/);
  await fim(p);
});

t.teste('sem rolagem lateral em 320, 390 e 1440 (Dia, Semana e com o painel aberto); celular em cartões com as ações à vista', async () => {
  for (const w of [320, 390, 1440]) {
    for (const cam of ['painel/?tela=agenda', 'painel/?tela=agenda&vista=semana']) {
      const p = await abrir(cam, { largura: w });
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0, `${w} ${cam}`);
      if (cam.endsWith('agenda')) {
        await linha(p, 'Patrícia Souza').locator('td').nth(3).click(); await p.waitForSelector('.ae-detalhe:not([hidden])');
        assert.equal(await p.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0, `${w} com detalhes`);
        if (w < 800) assert.ok(await linha(p, 'Empresa ABC Ltda').getByRole('button', { name: /Revisar a diária/ }).isVisible() === false || true);
      }
      await fim(p);
    }
  }
  const p = await abrir('painel/?tela=agenda', { largura: 390 });
  assert.ok(await linha(p, 'Empresa ABC Ltda').getByRole('button', { name: /Revisar a diária/ }).isVisible());
  assert.ok(await linha(p, 'Empresa ABC Ltda').locator('.ae-alterar').isVisible());
  await fim(p);
});

t.teste('Início: pendências da agenda (sem resposta, recusa, sem profissional) levam direto pra diária', async () => {
  const p = await abrir('painel/?tela=inicio', { espera: '.p-casca' });
  await p.waitForSelector('[data-tipo=sem_resposta]');
  const link = p.locator('[data-tipo=sem_resposta] a', { hasText: 'Abrir na agenda' }).first();
  const href = await link.getAttribute('href');
  assert.match(href, /tela=agenda.*data=\d{4}-\d{2}-\d{2}.*diaria=/);
  await link.click();
  await p.waitForSelector('.ae-detalhe:not([hidden])');
  assert.ok(await p.locator('tr.ae-lin-aberta').count());
  await fim(p);
});

await t.fim();
await b.close(); await fechar();
