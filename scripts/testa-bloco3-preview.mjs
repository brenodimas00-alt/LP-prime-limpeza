// Bloco 3 da fase 2 no NAVEGADOR contra o preview do Pages e o Supabase de homologação, só com fictícios.
// P2: agenda por profissional (arrastar pra outro dia com confirmação, mover pelo teclado trocando a profissional com
// aviso de disponibilidade, férias pela ficha da profissional), sugestão na aba Atribuir.
// Uso: LD_LIBRARY_PATH=... bash scripts/cli.sh node22 scripts/testa-bloco3-preview.mjs [url]
import { execFileSync } from 'node:child_process';
import { criarSuite, assert } from './lib-teste.mjs';
import { abrirNavegador } from './pw.mjs';
import { sql, fecharSql, limparFicticios, criarUsuario, cpfFicticio } from './lib-supabase.mjs';
import { montarApiDeTeste } from './lib-api-teste.mjs';
import { agendar, chave } from './cenarios.mjs';
import { CLIENTE_RESIDENCIAL, proximaDataPermitida } from './fixtures/seed.js';
import { CONFIG_PRECOS } from '../src/config/precos.js';
import { dataNoFuso, somarDias } from '../src/domain/calendario.js';

const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim().replace(/[/_.]/g, '-').toLowerCase();
const BASE = (process.argv[2] || `https://${branch}.prime-limpeza.pages.dev/`).replace(/\/?$/, '/');
const t = criarSuite(`bloco 3 no navegador (${BASE})`);
await limparFicticios();
const PRIME = { ator: 'prime' };
const { api } = await montarApiDeTeste('b3p', { avisarDisponibilidade: true });
const b = await abrirNavegador();
const admin = await criarUsuario('b3p-admin', 'prime_admin');

async function pagina(largura = 1280) {
  const ctx = await b.newContext({ viewport: { width: largura, height: 900 }, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  p.erros = [];
  p.on('pageerror', (e) => p.erros.push(e.message));
  p.on('dialog', (d) => d.accept()); // "Atribuir mesmo assim?" (confirm nativo)
  await p.goto(`${BASE}painel/entrar/`);
  await p.fill('#email', admin.email); await p.fill('#senha', admin.senha);
  await p.getByRole('button', { name: 'Entrar', exact: true }).click();
  await p.waitForURL(/painel\/(\?|$)/);
  return { ctx, p };
}
const semCarregando = (p) => p.waitForFunction(() => !document.querySelector('.carregando'));
/** SHOTS=<pasta>: guarda prints pra inspeção visual. */
const print = async (p, nome) => { if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/${nome}.png`, fullPage: true }); };

// quarta útil daqui a ~3 semanas; duas profissionais (Ana e Bia, só sábado à tarde em Contagem)
let D = proximaDataPermitida(somarDias(dataNoFuso(new Date().toISOString()), 18), 1, CONFIG_PRECOS);
while (new Date(`${D}T12:00:00Z`).getUTCDay() !== 3 || CONFIG_PRECOS.feriados.includes(D) || CONFIG_PRECOS.feriados.includes(somarDias(D, 1))) D = somarDias(D, 1);
async function diarista(nome, disp) {
  const u = await criarUsuario(`b3p-${nome.toLowerCase()}`, 'diarista');
  const [r] = await sql(`insert into public.diaristas (usuario_id, nome, cpf, telefone, email, data_nascimento, identidade, status, aceite_termos_em, disponibilidade, ficticio)
    values ($1, $2, $3, '31955554444', $4, '1985-04-12', 'cnh', 'aprovada', now(), $5::jsonb, true) returning id`, [u.id, `${nome} Navegador P2`, cpfFicticio(), u.email, JSON.stringify(disp)]);
  return r.id;
}
const ANA = await diarista('Ana', { dias: [1, 2, 3, 4, 5], turnos: ['integral'], regioes: ['BH - Centro-Sul'] });
const BIA = await diarista('Bia', { dias: [6], turnos: ['tarde'], regioes: ['Contagem'] });
const r = await agendar(api, { cliente: CLIENTE_RESIDENCIAL, pacote: { tipoServico: 'residencial', duracaoHoras: 4, metragem: 45, quantidadeDiarias: 1, frequencia: 'avulso' }, primeiraData: D, turno: 'manha' }, chave('b3p'));
const AT = r.atendimentos[0].id;
await api.atribuirDiarista(AT, { diaristaId: ANA }, { sessao: PRIME, chave: chave('atr') });
const dataDe = async () => (await sql('select to_char(data, \'YYYY-MM-DD\') d, to_char(hora_inicio, \'HH24:MI\') h, diarista_id from public.atendimentos where id = $1', [AT]))[0];

t.teste('P2: arrastar a diária pra outro dia abre a confirmação sem conflito e remarca no banco', async () => {
  const { ctx, p } = await pagina();
  await p.goto(`${BASE}painel/?aba=agenda&data=${D}`);
  await semCarregando(p);
  const chip = p.locator(`[data-diaria="${AT}"]`);
  await chip.waitFor();
  assert.equal(await chip.evaluate((x) => x.closest('td').dataset.profissional), ANA);
  await print(p, 'p2-agenda-1280');
  await chip.dragTo(p.locator(`td[data-dia="${somarDias(D, 1)}"][data-profissional="${ANA}"]`));
  const dlg = p.locator('dialog[open]');
  await dlg.waitFor();
  assert.equal(await p.inputValue('#mover-data'), somarDias(D, 1));
  await dlg.getByText('Sem conflito com a agenda e a disponibilidade.').waitFor();
  await print(p, 'p2-mover-1280');
  await dlg.getByRole('button', { name: 'Confirmar mudança' }).click();
  await p.waitForURL(/aba=agenda/);
  await p.locator(`td[data-dia="${somarDias(D, 1)}"] [data-diaria="${AT}"]`).waitFor();
  assert.deepEqual(await dataDe(), { d: somarDias(D, 1), h: '08:00', diarista_id: ANA });
  assert.deepEqual(p.erros, []);
  await ctx.close();
});

t.teste('P2: mover pelo teclado pra profissional fora da disponibilidade mostra o aviso e atribui com confirmação', async () => {
  const { ctx, p } = await pagina(390);
  await p.goto(`${BASE}painel/?aba=agenda&data=${D}`);
  await semCarregando(p);
  await p.locator(`[data-diaria="${AT}"]`).focus();
  await p.keyboard.press('Enter');
  const dlg = p.locator('dialog[open]');
  await dlg.waitFor();
  await p.selectOption('#mover-prof', BIA);
  await dlg.locator('.conflitos li.aviso').first().waitFor();
  await print(p, 'p2-mover-aviso-390');
  const avisos = await dlg.locator('.conflitos li').allTextContents();
  assert.ok(avisos.some((x) => /Não atende Belo Horizonte/.test(x)) && avisos.every((x) => /^Aviso/.test(x)), avisos.join(' | '));
  await dlg.getByRole('button', { name: 'Confirmar mudança' }).click();
  await p.waitForURL(/aba=agenda/);
  await p.locator(`td[data-profissional="${BIA}"] [data-diaria="${AT}"]`).waitFor();
  assert.equal((await dataDe()).diarista_id, BIA);
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  assert.equal(overflow, false, 'overflow horizontal em 390');
  await ctx.close();
});

t.teste('P2: férias pela ficha da profissional aparecem na grade e impedem mover pra lá', async () => {
  const { ctx, p } = await pagina();
  await p.goto(`${BASE}painel/?aba=agenda&data=${D}`);
  await semCarregando(p);
  await p.getByRole('button', { name: 'Ana Navegador P2' }).click();
  const dlg = p.locator('dialog[open]');
  await p.fill('#bloq-de', D); await p.fill('#bloq-ate', D); await p.selectOption('#bloq-motivo', 'ferias');
  await dlg.getByRole('button', { name: 'Adicionar período' }).click();
  await p.waitForURL(/aba=agenda/);
  await p.locator(`td[data-dia="${D}"][data-profissional="${ANA}"].bloqueada`).waitFor();
  await p.locator(`[data-diaria="${AT}"]`).click();
  await p.selectOption('#mover-prof', ANA);
  await p.fill('#mover-data', D); await p.locator('#mover-data').dispatchEvent('change');
  await p.locator('dialog[open] .conflitos li.erro').first().waitFor();
  await p.locator('dialog[open]').getByRole('button', { name: 'Confirmar mudança' }).click();
  await p.locator('dialog[open] .alerta-erro:not([hidden])').waitFor();
  assert.match(await p.locator('dialog[open] .alerta-erro').textContent(), /Resolva o que impede/);
  await ctx.close();
});

t.teste('P2: sugestão na aba Atribuir lista as profissionais e designa com um clique', async () => {
  const r2 = await agendar(api, { cliente: CLIENTE_RESIDENCIAL, pacote: { tipoServico: 'residencial', duracaoHoras: 4, metragem: 45, quantidadeDiarias: 1, frequencia: 'avulso' }, primeiraData: somarDias(D, 2), turno: 'manha' }, chave('b3p'));
  const { ctx, p } = await pagina();
  await p.goto(`${BASE}painel/?aba=atribuir`);
  await semCarregando(p);
  const caixa = p.locator(`[data-sugestoes="${r2.atendimentos[0].id}"]`);
  await caixa.locator('summary').click();
  const item = caixa.locator(`[data-sugestao="${ANA}"]`);
  await item.waitFor();
  assert.match(await item.textContent(), /livre no horário · atende a região · no dia e turno/);
  await item.getByRole('button', { name: 'Designar' }).click();
  await p.waitForFunction((id) => !document.querySelector(`[data-sugestoes="${id}"] [aria-busy=true]`), r2.atendimentos[0].id);
  await p.waitForTimeout(1500);
  const [x] = await sql('select diarista_id from public.atendimentos where id = $1', [r2.atendimentos[0].id]);
  assert.equal(x.diarista_id, ANA);
  await ctx.close();
});

await t.fim();
await b.close();
await limparFicticios({ soEstaExecucao: true });
await fecharSql();
