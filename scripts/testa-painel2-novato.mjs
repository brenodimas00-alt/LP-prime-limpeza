// Painel v2, B7: "teste do novato" automatizado (spec-painel-v2, B7). Cada tarefa do dia começa no Início e segue SÓ
// rótulos visíveis (getByRole/getByText, nada de seletor técnico pra achar o caminho), contando os cliques. O limite é a
// tabela da etapa A (docs/painel-v2/auditoria.md, seção 6): nenhuma tarefa com mais cliques que a proposta, e confirmar a
// disponibilidade em 1 clique. Roda no mock com o seed rico de demonstração (tudo fictício).
// O que mede é o caminho (cliques e rótulos), não a compreensão de uma pessoa nova (essa é a revisão humana com a cliente).
import { criarSuite, assert } from './lib-teste.mjs';
import { abrirNavegador, subirServidor } from './pw.mjs';
import { CREDENCIAIS_MOCK as C } from './fixtures/seed.js';

const t = criarSuite('painel v2 B7: teste do novato (mock, demonstração)');
const { base, fechar } = await subirServidor();
const b = await abrirNavegador();
// escala: 3 desde a Agenda e Escala (abrir a agenda do dia, Enviar todas as revisadas e confirmar o envio às profissionais);
// antes eram o selo e Publicar dentro do Início. Designar: a agenda já pré-designa a Sugerida, a equipe abre e revisa.
const LIMITE = { aprovar: 1, designar: 2, pagamento: 2, achar: 1, verDia: 0, cadastro: 2, escala: 3, recusar: 2 };
const cliques = {};

async function inicio(largura = 1440) {
  const ctx = await b.newContext({ viewport: { width: largura, height: 900 }, reducedMotion: 'reduce', locale: 'pt-BR' });
  const p = await ctx.newPage(); p.erros = [];
  p.on('pageerror', (e) => p.erros.push(e.message)); p.on('console', (m) => m.type() === 'error' && p.erros.push(m.text()));
  await p.goto(base);
  await p.evaluate((c) => { localStorage.setItem('prime.sessao', JSON.stringify({ ator: 'prime', id: c.id, nome: c.nome, papel: 'prime_admin' })); localStorage.setItem('prime.seedDemo', 'painel'); }, C.prime[1]);
  await p.goto(`${base}painel/`); // o painel abre no Início
  await p.getByRole('heading', { name: 'Solicitações novas' }).waitFor();
  await p.locator('section.p-bloco .esqueleto').first().waitFor({ state: 'detached', timeout: 30000 }).catch(() => {});
  let n = 0;
  const clicar = async (loc) => { await loc.click(); n++; };
  return { p, clicar, total: () => n };
}
const registrar = (tarefa, n) => { cliques[tarefa] = n; assert.ok(n <= LIMITE[tarefa], `${tarefa}: ${n} cliques (limite ${LIMITE[tarefa]})`); };

t.teste('confirmar a disponibilidade de uma solicitação nova: 1 clique a partir do Início', async () => {
  const { p, clicar, total } = await inicio();
  const bloco = p.getByRole('region', { name: 'Solicitações novas' });
  const total0 = Number((await bloco.locator('.p-cont-bloco').innerText()).match(/\d+/)[0]);
  await clicar(bloco.getByRole('button', { name: /^Aprovar a solicitação de/ }).first());
  await p.waitForFunction(() => /Disponibilidade confirmada/.test(document.body.textContent));
  await p.waitForFunction((n) => document.querySelector('[data-bloco=inicio-solicitacoes] .p-cont-bloco')?.textContent.includes(`(${n})`), total0 - 1);
  registrar('aprovar', total());
  assert.deepEqual(p.erros, []);
});

t.teste('recusar com motivo: abre o motivo e confirma (2 cliques + a escolha do motivo)', async () => {
  const { p, clicar, total } = await inicio();
  await clicar(p.getByRole('button', { name: /^Recusar a solicitação de/ }).first());
  await p.getByRole('dialog').getByLabel('Motivo').selectOption({ label: 'Sem disponibilidade na data ou no horário' });
  await clicar(p.getByRole('button', { name: 'Recusar e avisar a cliente' }));
  await p.getByText('Solicitação recusada.').waitFor();
  registrar('recusar', total());
});

t.teste('designar profissional numa diária de amanhã sem profissional: "Abrir na agenda" (já vem a Sugerida) e "Revisar" (2 cliques)', async () => {
  const { p, clicar, total } = await inicio();
  const pend = p.getByRole('region', { name: 'Precisa de você' });
  await clicar(pend.locator('[data-tipo=sem_profissional]').getByRole('link', { name: 'Abrir na agenda' }).first());
  await p.locator('tr.ae-lin-aberta').waitFor();
  await p.locator('tr.ae-lin-aberta .ae-origem', { hasText: 'Sugerida' }).waitFor();
  await clicar(p.locator('tr.ae-lin-aberta').getByRole('button', { name: /^Revisar a diária/ }));
  await p.getByText('Diária revisada.').waitFor();
  registrar('designar', total());
});

t.teste('conferir um pagamento informado: aprovar direto em "Precisa de você" (1 a 2 cliques)', async () => {
  const { p, clicar, total } = await inicio();
  const pend = p.getByRole('region', { name: 'Precisa de você' });
  await clicar(pend.getByRole('button', { name: /^Conferir pagamento de .*: aprovar$/ }).first());
  await p.getByText('Pagamento confirmado.').waitFor();
  registrar('pagamento', total());
});

t.teste('achar uma cliente pelo nome: busca do topo e Enter abre a ficha (1 ação)', async () => {
  const { p, total } = await inicio();
  await p.getByRole('combobox', { name: /Buscar cliente/ }).fill('Mariana');
  await p.getByRole('option').first().waitFor();
  await p.keyboard.press('Enter');
  await p.getByRole('heading', { name: 'Linha do tempo' }).waitFor();
  registrar('achar', total() + 1);
});

t.teste('ver o dia de hoje: está no Início, sem clique', async () => {
  const { p, total } = await inicio();
  const hoje = p.getByRole('region', { name: 'Diárias de hoje' });
  await hoje.getByRole('table').waitFor();
  assert.ok(await hoje.getByRole('row').count() >= 2);
  registrar('verDia', total());
});

t.teste('aprovar o cadastro de uma profissional: "Ver" e "Aprovar cadastro" (2 cliques, sem filtrar)', async () => {
  const { p, clicar, total } = await inicio();
  const pend = p.getByRole('region', { name: 'Precisa de você' });
  await clicar(pend.locator('li', { hasText: 'Cadastro de profissional pra analisar' }).getByRole('link', { name: 'Ver' }));
  await clicar(p.getByRole('button', { name: 'Aprovar cadastro' }).first());
  await p.waitForFunction(() => !document.querySelector('.cartao.principal[data-diarista]'));
  registrar('cadastro', total());
});

t.teste('enviar a escala de amanhã: "Abrir na Agenda e Escala", "Enviar todas as revisadas" e confirmar (3 cliques)', async () => {
  const { p, clicar, total } = await inicio();
  const amanha = p.getByRole('region', { name: 'Diárias de amanhã' });
  await clicar(amanha.getByRole('link', { name: /Abrir na Agenda e Escala/ }).first());
  await p.locator('.ae-tabela').waitFor();
  // preparo (não conta: é a tarefa "designar"): revisar uma por uma, como a cliente pediu
  for (let i = 0; i < 8 && await p.getByRole('button', { name: /^Revisar a diária/ }).count(); i++) {
    await p.getByRole('button', { name: /^Revisar a diária/ }).first().click();
    await p.waitForTimeout(600);
  }
  const antes = total();
  await clicar(p.getByRole('button', { name: /^Enviar todas as revisadas \(\d+\)$/ }));
  await clicar(p.getByRole('dialog').getByRole('button', { name: /^Enviar \d+ diária/ }));
  await p.waitForFunction(() => /\(0\)/.test(document.querySelector('.ae-enviar-todas')?.textContent || ''));
  registrar('escala', total() - antes + 1);
  assert.deepEqual(p.erros, []);
});

const falhas = await t.fim();
console.log(`cliques por tarefa (limite da proposta): ${Object.entries(cliques).map(([k, v]) => `${k} ${v}/${LIMITE[k]}`).join(', ')}`);
await b.close(); await fechar();
process.exit(falhas ? 1 : 0);
