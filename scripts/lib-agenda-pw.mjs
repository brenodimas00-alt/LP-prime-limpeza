// Agenda e Escala nos testes de navegador contra o backend real (preview): designar uma profissional como a equipe faz.
// A tela já pré-designa uma Sugerida ao abrir; aqui a profissional escolhida entra no lugar, a diária é revisada,
// enviada e o aceite é registrado (o WhatsApp do homolog é simulado: nenhuma mensagem sai).

/** Abre a agenda do dia da diária e espera a linha dela. */
export async function abrirDiaria(p, base, { id, data }) {
  await p.goto(`${base}painel/?tela=agenda&data=${data}`);
  await p.waitForSelector(`tr[data-diaria="${id}"]`, { timeout: 30000 });
  return p.locator(`tr[data-diaria="${id}"]`);
}

/** Seleciona a profissional pelo nome no seletor "Alterar ou selecionar profissional". */
export async function selecionarProfissional(p, linha, nome) {
  await linha.locator('.ae-selecionar, .ae-alterar').first().click();
  await p.waitForSelector('.ae-sel-lista li', { timeout: 30000 });
  await p.fill('#sel-busca', nome);
  const item = p.locator('.ae-sel-lista li', { hasText: nome }).first();
  if (await item.locator('.ae-ja').count()) { await p.keyboard.press('Escape'); return; }
  await item.getByRole('button', { name: /Selecionar/ }).click();
  const confirmar = p.locator('.p-modal').getByRole('button', { name: 'Tentar mesmo assim' });
  if (await confirmar.isVisible({ timeout: 1500 }).catch(() => false)) await confirmar.click();
}

/** Designa, revisa, envia e registra o aceite. `id` e `data` da diária; `nome` da profissional. */
export async function designarNaAgenda(p, base, { id, data, nome }) {
  const linha = await abrirDiaria(p, base, { id, data });
  await selecionarProfissional(p, linha, nome);
  await p.waitForFunction(({ id: x, nome: n }) => {
    const tr = document.querySelector(`tr[data-diaria="${x}"]`);
    return tr && tr.querySelector('.ae-prof')?.textContent.includes(n.split(' ')[0]) && tr.querySelector('[data-acao=revisar], [data-acao=enviar]');
  }, { id, nome }, { timeout: 30000 });
  if (await linha.locator('[data-acao=revisar]').count()) {
    await linha.locator('[data-acao=revisar]').click();
    await p.waitForSelector(`tr[data-diaria="${id}"] [data-acao=enviar]`, { timeout: 30000 });
  }
  await linha.locator('[data-acao=enviar]').click();
  await p.waitForFunction((x) => /Enviada|Aguardando/.test(document.querySelector(`tr[data-diaria="${x}"] .ae-status`)?.textContent || ''), id, { timeout: 30000 });
  await linha.locator('.ae-aviao').click();
  await p.locator('.ae-pop').getByRole('menuitem', { name: /Registrar aceite/ }).click();
  await p.waitForFunction((x) => /Confirmada|Em andamento/.test(document.querySelector(`tr[data-diaria="${x}"] .ae-status`)?.textContent || ''), id, { timeout: 30000 });
}
