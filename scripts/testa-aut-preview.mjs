// AUT.6: painel de automações no NAVEGADOR contra o preview + homologação (só fictícios): liga/desliga e horário com
// limite, editor de template (autocompletar, prévia, bloqueio de variável inválida, versão nova e restaurar), modo teste,
// linha do tempo com destino mascarado e reenviar, atendimento só vê. Tudo o que muda é desfeito no fim.
// Uso: LD_LIBRARY_PATH=... bash scripts/cli.sh node22 scripts/testa-aut-preview.mjs [url]
import { execFileSync } from 'node:child_process';
import { criarSuite, assert } from './lib-teste.mjs';
import { abrirNavegador } from './pw.mjs';
import { sql, fecharSql, limparFicticios, criarUsuario } from './lib-supabase.mjs';

const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim().replace(/[/_.]/g, '-').toLowerCase();
const BASE = (process.argv[2] || `https://${branch}.prime-limpeza.pages.dev/`).replace(/\/?$/, '/');
const t = criarSuite(`AUT painel de automações (${BASE})`);
await limparFicticios();
const b = await abrirNavegador();
const admin = await criarUsuario('autp-admin', 'prime_admin');
const atend = await criarUsuario('autp-atend', 'prime_atendimento');
const originalC06 = (await sql(`select ligada, atraso, versao, canais_ordem from public.automacao_regras where codigo = 'C06'`))[0];

async function pagina(u) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  p.erros = [];
  p.on('pageerror', (e) => p.erros.push(e.message));
  p.on('console', (m) => m.type() === 'error' && !/status of (400|401|403|404|409)/.test(m.text()) && p.erros.push(m.text()));
  await p.goto(`${BASE}painel/entrar/`);
  await p.fill('#email', u.email); await p.fill('#senha', u.senha);
  await p.getByRole('button', { name: 'Entrar', exact: true }).click();
  await p.waitForURL(/painel\/(\?|$)/);
  return p;
}
async function ir(p, extra = '') {
  await p.goto(`${BASE}painel/?aba=notificacoes${extra}`);
  await p.waitForFunction(() => !document.querySelector('.carregando'));
}
const P = await pagina(admin);

t.teste('aba Automações: regras com métricas; desligar C06 e mudar a véspera pra 19h grava no banco; 23h é recusado', async () => {
  await ir(P);
  await P.waitForSelector('[data-tabela=regras] tr[data-regra=C06]');
  assert.equal(await P.locator('.abas [aria-current=page]').textContent(), 'Automações');
  const linha = P.locator('tr[data-regra=C06]');
  await linha.locator('input[type=time]').fill('23:00');
  await linha.getByRole('button', { name: 'Salvar' }).click();
  await P.locator('.toast', { hasText: /limites/ }).waitFor();
  await linha.locator('input[type=time]').fill('19:00');
  await linha.locator('input[data-ligada=C06]').uncheck();
  await linha.getByRole('button', { name: 'Salvar' }).click();
  await P.locator('.toast', { hasText: 'C06 salva' }).waitFor();
  const [r] = await sql(`select ligada, atraso ->> 'hora' hora from public.automacao_regras where codigo = 'C06'`);
  assert.deepEqual([r.ligada, r.hora], [false, '19:00']);
  assert.deepEqual(P.erros, []);
});

t.teste('editor de template: autocompletar depois de {{, prévia com dados fictícios, variável inválida bloqueia; salvar e restaurar criam versões', async () => {
  await ir(P, '&sub=template&codigo=cadastro_aprovado');
  const txt = P.locator('#corpo-template');
  await txt.waitFor();
  await txt.fill('Parabéns, {{cpf}}! Seu cadastro foi aprovado.');
  await P.locator('#erros-template li', { hasText: 'variável não permitida: {{cpf}}' }).waitFor();
  assert.equal(await P.getByRole('button', { name: 'Salvar nova versão' }).isDisabled(), true);
  await txt.fill('Parabéns, {{no');
  await txt.press('End');
  await P.getByRole('option', { name: 'nome' }).click();
  await txt.press('End');
  await txt.type('! Seu cadastro na Prime foi aprovado. Até breve.');
  assert.equal(await txt.inputValue(), 'Parabéns, {{nome}}! Seu cadastro na Prime foi aprovado. Até breve.');
  assert.equal(await P.locator('#previa-template').textContent(), 'Parabéns, Ana! Seu cadastro na Prime foi aprovado. Até breve.');
  await P.getByRole('button', { name: 'Salvar nova versão' }).click();
  await P.waitForSelector('[data-tabela=versoes] tr[data-versao="2"]');
  const vs = await sql(`select versao, ativo from public.templates where codigo = 'cadastro_aprovado' and canal = 'whatsapp' order by versao`);
  assert.deepEqual(vs.map((x) => [x.versao, x.ativo]), [[1, false], [2, true]]);
  await P.locator('[data-tabela=versoes] tr[data-versao="1"]').getByRole('button', { name: 'Restaurar' }).click();
  await P.waitForSelector('[data-tabela=versoes] tr[data-versao="3"]');
  assert.match(await txt.inputValue(), /^Parabéns, \{\{nome\}\}! Seu cadastro na Prime foi aprovado\. As próximas diárias/);
});

t.teste('modo teste manda a regra pro contato fictício; linha do tempo da regra mostra destino mascarado e permite reenviar', async () => {
  await ir(P);
  await P.locator('tr[data-regra=D02]').getByRole('button', { name: 'Testar' }).click();
  await P.locator('.toast', { hasText: 'contato fictício' }).waitFor();
  const [ex] = await sql(`select id from public.automacao_execucoes where teste and regra = 'D02' order by criado_em desc limit 1`);
  await sql(`update public.automacao_execucoes set estado = 'falhou', motivo = 'falha simulada pelo teste' where id = $1`, [ex.id]);
  await sql(`insert into public.mensagens (execucao_id, canal, destino, conteudo, estado, provedor) values ($1, 'whatsapp', '31900000001', 'Parabéns, Exemplo nome!', 'falhou', 'simulado')`, [ex.id]);
  await ir(P, '&sub=linha&regra=D02');
  const item = P.locator(`#linha-do-tempo li[data-execucao="${ex.id}"]`);
  await item.waitFor();
  assert.match(await item.textContent(), /WhatsApp \(31\) \*\*\*\*-0001 · falhou/);
  await item.getByRole('button', { name: 'Reenviar' }).click();
  await P.waitForFunction((id) => document.querySelector(`#linha-do-tempo li[data-execucao="${id}"]`)?.dataset.estado === 'agendada', ex.id);
  const [{ n }] = await sql(`select count(*)::int n from public.auditoria where tabela = 'automacao_execucoes' and registro_id = $1 and depois ->> 'acao' = 'reenviar'`, [ex.id]);
  assert.equal(n, 1);
  await sql('delete from public.automacao_execucoes where id = $1', [ex.id]);
});

t.teste('atendimento vê regras e textos, mas sem salvar, testar, editar nem agir', async () => {
  const q = await pagina(atend);
  await ir(q);
  await q.waitForSelector('tr[data-regra=C01]');
  assert.equal(await q.getByRole('button', { name: 'Salvar' }).count(), 0);
  assert.equal(await q.getByRole('button', { name: 'Testar' }).count(), 0);
  await ir(q, '&sub=template&codigo=solicitacao_recebida');
  await q.locator('#corpo-template').waitFor();
  assert.equal(await q.locator('#corpo-template').getAttribute('readonly'), '');
  assert.equal(await q.getByRole('button', { name: 'Salvar nova versão' }).count(), 0);
  assert.deepEqual(q.erros, []);
  await q.context().close();
});

t.teste('sem overflow horizontal em 375 nas telas de automação', async () => {
  const ctx = await b.newContext({ viewport: { width: 375, height: 800 } });
  const p = await ctx.newPage();
  await p.goto(`${BASE}painel/entrar/`); await p.fill('#email', admin.email); await p.fill('#senha', admin.senha);
  await p.getByRole('button', { name: 'Entrar', exact: true }).click(); await p.waitForURL(/painel\/(\?|$)/);
  const ruins = [];
  for (const extra of ['', '&sub=template&codigo=lembrete_vespera', '&sub=linha&regra=I06']) {
    await ir(p, extra);
    const w = await p.evaluate(() => document.documentElement.scrollWidth);
    if (w > 375) ruins.push(`${extra || 'regras'}: ${w}`);
  }
  assert.deepEqual(ruins, []);
  await ctx.close();
});

const falhas = await t.fim();
// desfaz o que o teste mudou (regra C06 e versões do template)
await sql(`update public.automacao_regras set ligada = $1, atraso = $2::text::jsonb, versao = $3, canais_ordem = $4 where codigo = 'C06'`, [originalC06.ligada, JSON.stringify(originalC06.atraso), originalC06.versao, originalC06.canais_ordem]);
await sql(`delete from public.templates where codigo = 'cadastro_aprovado' and versao > 1`);
await sql(`update public.templates set ativo = true where codigo = 'cadastro_aprovado' and versao = 1`);
await b.close();
console.log(`# limpeza: ${await limparFicticios({ soEstaExecucao: true })} usuários fictícios removidos`);
await fecharSql();
process.exit(falhas ? 1 : 0);
