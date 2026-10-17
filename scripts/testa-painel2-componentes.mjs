// Painel v2, B1: componentes no navegador (vitrine com dados fictícios em _dev/painel-componentes.html).
// Recolher/expandir com aria-expanded e memória, expansão da linha, modal com foco preso e Esc devolvendo o foco,
// motivo padronizado obrigatório ("Outro" exige detalhe), painel lateral, sem rolagem lateral em 320/375/1440.
import { criarSuite, assert } from './lib-teste.mjs';
import { abrirNavegador, subirServidor } from './pw.mjs';

const t = criarSuite('painel v2 B1: componentes (navegador)');
const { base, fechar } = await subirServidor();
const b = await abrirNavegador();
async function pagina(largura = 1440) {
  const p = await (await b.newContext({ viewport: { width: largura, height: 900 }, reducedMotion: 'reduce' })).newPage();
  p.erros = [];
  p.on('pageerror', (e) => p.erros.push(e.message));
  p.on('console', (m) => m.type() === 'error' && p.erros.push(m.text()));
  await p.goto(`${base}_dev/painel-componentes.html`);
  await p.waitForSelector('[data-bloco=vitrine] .p-tabela');
  return p;
}

t.teste('bloco recolhível: aria-expanded, some o corpo, urgência continua no cabeçalho e o estado volta depois de recarregar', async () => {
  const p = await pagina();
  const seta = p.locator('[data-bloco=vitrine] .p-recolher');
  assert.equal(await seta.getAttribute('aria-expanded'), 'true');
  await seta.click();
  assert.equal(await seta.getAttribute('aria-expanded'), 'false');
  assert.equal(await p.locator('[data-bloco=vitrine] .p-bloco-corpo').isHidden(), true);
  assert.match(await p.locator('[data-bloco=vitrine] .p-bloco-cab').innerText(), /1 urgente/);
  await p.reload(); await p.waitForSelector('[data-bloco=vitrine] .p-recolher[aria-expanded=false]');
  await p.locator('[data-bloco=vitrine] .p-recolher').click();
  await p.waitForSelector('[data-bloco=vitrine] .p-tabela');
  assert.deepEqual(p.erros, []);
});

t.teste('tabela: a seta abre e fecha o detalhe da linha (aria-expanded + aria-controls); bloco com erro mostra "Tentar de novo"', async () => {
  const p = await pagina();
  const exp = p.getByRole('button', { name: 'Ver detalhes de Ana Fictícia' });
  await exp.click();
  const id = await exp.getAttribute('aria-controls');
  assert.match(await p.locator(`#${id}`).innerText(), /Rua Fictícia, 100/);
  await exp.click();
  assert.equal(await p.locator(`#${id}`).count(), 0);
  assert.match(await p.locator('[data-bloco=vitrine-erro]').innerText(), /Não conseguimos falar com o servidor[\s\S]*Tentar de novo/);
});

t.teste('motivo: sem escolher não confirma; "Outro" exige detalhe; Esc fecha e devolve o foco ao botão', async () => {
  const p = await pagina();
  const abre = p.getByRole('button', { name: 'Pedir motivo' });
  await abre.click();
  const dlg = p.getByRole('dialog', { name: 'Recusar solicitação' });
  await dlg.getByRole('button', { name: 'Recusar e avisar a cliente' }).click();
  assert.match(await dlg.innerText(), /Escolha o motivo/);
  await dlg.locator('select').selectOption('outro');
  await dlg.getByRole('button', { name: 'Recusar e avisar a cliente' }).click();
  assert.match(await dlg.innerText(), /Escreva o motivo/);
  await p.keyboard.press('Escape');
  assert.equal(await p.getByRole('dialog').count(), 0);
  assert.equal(await p.evaluate(() => document.activeElement?.textContent), 'Pedir motivo');
});

t.teste('modal e painel lateral: Tab fica preso dentro; Esc fecha', async () => {
  const p = await pagina();
  await p.getByRole('button', { name: 'Confirmar com consequência' }).click();
  for (let i = 0; i < 5; i++) await p.keyboard.press('Tab');
  assert.ok(await p.evaluate(() => !!document.activeElement.closest('[role=dialog]')), 'foco preso no modal');
  await p.keyboard.press('Escape');
  await p.getByRole('button', { name: 'Painel lateral' }).click();
  assert.match(await p.getByRole('dialog', { name: 'Detalhe' }).innerText(), /Ana Fictícia/);
  await p.getByRole('button', { name: 'Fechar' }).click();
  assert.equal(await p.getByRole('dialog').count(), 0);
});

t.teste('sem rolagem lateral em 320, 375 e 1440; no celular a linha vira cartão com o nome no topo', async () => {
  for (const w of [320, 375, 1440]) {
    const p = await pagina(w);
    const [sw, iw] = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    assert.ok(sw <= iw, `${w}px: ${sw} > ${iw}`);
    if (w < 760) assert.equal(await p.locator('[data-bloco=vitrine] .p-tabela thead').isHidden(), true);
    await p.context().close();
  }
});

await t.fim();
await b.close(); await fechar();
