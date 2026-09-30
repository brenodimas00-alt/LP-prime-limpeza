// Q1 (fase 2): qualidade no PREVIEW, só com dados fictícios. Completa o que testa-f2/b2/i1-preview já cobrem.
// Matriz (requisito da spec -> onde está o teste):
//   solicitação residencial avulsa até a confirmação do pagamento ...... testa-f2-preview (1 a 3)
//   empresa com 4 diárias ................................................. testa-f2-preview; DESCONTO: aqui (empresa 4 diárias)
//   recusa por falta de disponibilidade, remarcação, estorno registrado ... aqui
//   cadastro de profissional com documentos e aprovação ................... testa-f2-preview
//   atendimento até a pesquisa de satisfação .............................. testa-f2-preview
//   login pelos três identificadores, bloqueio de login ................... testa-b2-preview
//   cliente importado ..................................................... testa-f2-preview
//   sessão expirada ....................................................... testa-f2-preview
//   duplo clique .......................................................... testa-f2-preview (enviar) e aqui (confirmar disponibilidade)
//   recarregar no meio, voltar do navegador, id inexistente, transição proibida, papel sem permissão, evento repetido,
//   centavo ímpar, rede caindo no envio (e resposta perdida depois de gravar) ......................... aqui
//   L1 no navegador (novo aceite, consentimento, baixar, excluir, pedido no painel) e A0 (troca obrigatória) ... aqui
//   overflow horizontal em 320, 375 e 768 ................................. aqui (todas as páginas, públicas e logadas)
//   Lighthouse acessibilidade >= 90 e performance >= 80 ................... scripts/lighthouse-q1.mjs
// Uso: LD_LIBRARY_PATH=... bash scripts/cli.sh node22 scripts/testa-q1-preview.mjs [url]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { criarSuite, assert } from './lib-teste.mjs';
import { abrirNavegador } from './pw.mjs';
import { admin, anonimo, entrar, criarUsuario, emailTeste, sql, transacao, fecharSql, limparFicticios, cpfFicticio, aceitarTermos, ENV, TOKEN_TESTE_TURNSTILE } from './lib-supabase.mjs';
import { criarAdapterSupabase } from '../src/services/adapters/supabase.js';
import { proximaDataPermitida } from './fixtures/seed.js';
import { dataNoFuso, somarDias } from '../src/domain/calendario.js';
import { CONFIG_PRECOS } from '../src/config/precos.js';
import { validarCNPJ } from '../src/domain/validacao.js';

const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim().replace(/[/_.]/g, '-').toLowerCase();
const BASE = (process.argv[2] || `https://${branch}.prime-limpeza.pages.dev/`).replace(/\/?$/, '/');
const t = criarSuite(`Q1 qualidade (${BASE})`);
await limparFicticios();
const b = await abrirNavegador();
const HOJE = dataNoFuso(new Date().toISOString());
const util = (d) => new Date(`${d}T12:00:00Z`).getUTCDay() !== 6 && !CONFIG_PRECOS.feriados.includes(d);
function dataLivre(depois, dias = 1) { let d = proximaDataPermitida(somarDias(depois, dias - 1), 1, CONFIG_PRECOS); while (!util(d)) d = proximaDataPermitida(d, 1, CONFIG_PRECOS); return d; }
const D1 = dataLivre(HOJE, 2); // dentro da agenda de 7 dias do painel
const D2 = dataLivre(D1, 1);
const PRIME = { ator: 'prime' }; const CLI = { ator: 'cliente' };
const chave = (p) => `q1-${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

const adminU = await criarUsuario('q1-admin', 'prime_admin');
const adminC = await entrar(adminU);

/** CNPJ alfanumérico fictício com dígito verificador válido (mesma validação do front e do banco). */
function cnpjFicticio() {
  const base = `Q1${Math.random().toString(36).slice(2).toUpperCase().replace(/[^0-9A-Z]/g, '').padEnd(10, '7').slice(0, 10)}`;
  for (let dv = 0; dv < 100; dv++) { const c = `${base}${String(dv).padStart(2, '0')}`; if (!validarCNPJ(c)) return c; }
  throw new Error('CNPJ fictício');
}
async function celularLivre() {
  for (;;) { const tel = `319${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`; const [{ n }] = await sql('select count(*)::int n from public.clientes where telefone = $1', [tel]); if (!n) return tel; }
}
/** Cliente fictícia com login conhecido (e-mail + senha), cadastro pronto e, se quiser, aceite dos termos. */
async function cliente(rotulo, { tipo = 'residencial', aceite = true } = {}) {
  const u = await criarUsuario(`q1-${rotulo}`);
  const tel = await celularLivre();
  const empresa = tipo === 'empresa';
  const doc = empresa ? cnpjFicticio() : cpfFicticio();
  const endereco = { cep: '30130010', logradouro: 'Rua Fictícia', numero: '10', complemento: '', bairro: 'Savassi', cidade: 'Belo Horizonte', uf: 'MG' };
  const [{ id }] = await sql(`insert into public.clientes (usuario_id, tipo, nome, email, telefone, tipo_documento, documento, razao_social, responsavel, data_nascimento, endereco, origem, ficticio)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'site', true) returning id`,
  [u.id, tipo, empresa ? 'Carla Responsável Q1' : `Cliente Q1 ${rotulo}`, u.email, tel, empresa ? 'cnpj' : 'cpf', doc, empresa ? 'Empresa Fictícia Q1 Ltda' : null, empresa ? 'Carla Responsável Q1' : null, empresa ? null : '1988-05-06', JSON.stringify(endereco)]);
  if (aceite) await aceitarTermos(u.id);
  const c = await entrar(u);
  const dados = { tipo, nome: empresa ? 'Carla Responsável Q1' : `Cliente Q1 ${rotulo}`, telefone: tel, email: u.email, ...(empresa ? { cnpj: doc, razaoSocial: 'Empresa Fictícia Q1 Ltda', responsavel: 'Carla Responsável Q1' } : { cpf: doc, dataNascimento: '1988-05-06' }), endereco };
  const api = criarAdapterSupabase({ provaHumana: async () => ({ turnstile: TOKEN_TESTE_TURNSTILE }), clientePara: async (s) => (s?.ator === 'prime' ? adminC : s?.ator === 'cliente' ? c : anonimo()) });
  return { ...u, clienteId: id, c, dados, api };
}
const AVULSO = { tipoServico: 'residencial', duracaoHoras: 4, metragem: 45, quantidadeDiarias: 1, frequencia: 'avulso' };
const pedir = (x, pacote, data, turno = 'manha') => x.api.confirmarAutoagendamento({ cliente: x.dados, pacote, primeiraData: data, turno, preferenciaProfissional: '' }, { sessao: CLI, chave: chave('ped') });

async function contexto(largura = 1280) {
  const ctx = await b.newContext({ viewport: { width: largura, height: 900 }, reducedMotion: 'reduce', acceptDownloads: true });
  await ctx.route('https://viacep.com.br/**', (r) => r.fulfill({ json: { logradouro: 'Rua Fictícia', bairro: 'Savassi', localidade: 'Belo Horizonte', uf: 'MG' } }));
  const p = await ctx.newPage();
  p.erros = [];
  p.on('pageerror', (e) => p.erros.push(e.message));
  p.on('console', (m) => m.type() === 'error' && !/status of (400|401|403|404|409|429)|Failed to load resource|net::ERR_FAILED/.test(m.text()) && p.erros.push(m.text()));
  return p;
}
async function entrarComo(p, area, u) {
  const rota = { cliente: 'entrar/', prime: 'painel/entrar/', diarista: 'diarista/entrar/' }[area];
  await p.goto(`${BASE}${rota}`);
  await p.fill(area === 'cliente' ? '#identificador' : '#email', u.email); await p.fill('#senha', u.senha);
  await p.getByRole('button', { name: 'Entrar', exact: true }).click();
}
async function painel(p, aba, extra = '') {
  await p.goto(`${BASE}painel/?aba=${aba}${extra}`);
  await p.waitForSelector('.abas [aria-current=page]');
  await p.waitForFunction(() => !document.querySelector('.carregando'));
}
const S = {};
/** Agendamento v2 até um passo (residencial 4h, 40 m², uma diária em `data`, 08:00). Logada: os dados vêm travados. */
const ok = (p) => p.getByRole('button', { name: 'Continuar' }).click();
const marcarV2 = (p, nome, valor) => p.locator(`input[name="${nome}"][value="${valor}"]`).evaluate((i) => { if (!i.checked) i.click(); });
async function fluxoV2(p, data, { ate = 'revisao', metragem = '40', aoLocal } = {}) {
  await p.goto(`${BASE}autoagendamento/`); await p.waitForSelector('#titulo-passo');
  await marcarV2(p, 'tipoCliente', 'residencial'); await marcarV2(p, 'tipoServico', 'residencial'); await ok(p);
  await p.fill('#cep', '30130-010'); await p.waitForSelector('[data-regiao=atendida]'); await ok(p);
  await p.fill('#numero', '10'); await ok(p);
  await p.fill('#metragem', metragem); await marcarV2(p, 'semLocalAlmoco', 'sim');
  if (aoLocal) await aoLocal();
  if (ate === 'local') return;
  await ok(p); await marcarV2(p, 'quantidade', 'uma'); await ok(p);
  for (let i = 0; i < 6 && !(await p.locator(`.cal-dia[data-dia="${data}"]`).count()); i++) await p.getByRole('button', { name: 'Próximo mês' }).click();
  await p.locator(`.cal-dia[data-dia="${data}"]`).click(); await ok(p);
  await marcarV2(p, 'horario', '08:00'); await ok(p);
  if (ate === 'dados') return;
  await p.waitForSelector('[data-passo=dados]'); await ok(p);
  await p.waitForSelector('[data-valor=total]');
}

// ---------- fluxos que faltavam ----------
t.teste('recusa por falta de disponibilidade: motivo obrigatório; a cliente vê a recusa com o motivo', async () => {
  const x = await cliente('recusa');
  const r = await pedir(x, AVULSO, D1);
  const p = await contexto(); S.prime = p;
  await entrarComo(p, 'prime', adminU); await p.waitForURL(/painel\/(\?|$)/);
  await painel(p, 'solicitacoes');
  const card = p.locator(`[data-solicitacao="${r.pedido.id}"]`);
  await card.getByRole('button', { name: 'Recusar' }).click();
  await card.locator('.erro-campo', { hasText: 'motivo' }).waitFor();
  assert.equal((await sql('select status from public.pedidos where id = $1', [r.pedido.id]))[0].status, 'solicitado', 'sem motivo não recusa');
  await card.locator('input').fill('Sem profissional disponível nesta data');
  await card.getByRole('button', { name: 'Recusar' }).click();
  await p.waitForFunction((id) => !document.querySelector(`[data-solicitacao="${id}"]`), r.pedido.id);
  const [ped] = await sql('select status, recusa from public.pedidos where id = $1', [r.pedido.id]);
  assert.equal(ped.status, 'recusado'); assert.match(ped.recusa.motivo, /Sem profissional/);
  const q = await contexto(390);
  await entrarComo(q, 'cliente', x); await q.waitForURL(/minha-conta\//);
  await q.goto(`${BASE}acompanhamento/?pedido=${r.pedido.id}`);
  await q.waitForFunction(() => /Sem profissional disponível/.test(document.body.textContent));
  assert.deepEqual([...p.erros, ...q.erros], []);
  await q.context().close();
});

t.teste('duplo clique em "Confirmar disponibilidade" gera uma cobrança só; remarcação pelo painel move a diária e o prazo', async () => {
  const x = await cliente('remarca');
  const r = await pedir(x, AVULSO, D1, 'tarde');
  const p = S.prime;
  await painel(p, 'solicitacoes');
  await p.locator(`[data-solicitacao="${r.pedido.id}"]`).getByRole('button', { name: 'Confirmar disponibilidade' }).dblclick();
  await p.waitForFunction((id) => !document.querySelector(`[data-solicitacao="${id}"]`), r.pedido.id);
  const cobs = await sql('select id, vence_em::text v from public.pagamentos where pedido_id = $1', [r.pedido.id]);
  assert.equal(cobs.length, 1, 'uma cobrança');
  // P2: remarcar pela agenda por profissional (a diária sem profissional fica na linha "Sem profissional")
  await painel(p, 'agenda', `&data=${D1}`);
  await p.locator(`[data-diaria="${r.atendimentos[0].id}"]`).click();
  await p.fill('#mover-data', D2); await p.locator('#mover-data').dispatchEvent('change');
  await p.selectOption('#mover-hora', '10:30'); // v2: hora exata
  await p.locator('dialog[open]').getByRole('button', { name: 'Confirmar mudança' }).click();
  for (let i = 0; i < 40; i++) { const [a] = await sql('select data::text d from public.atendimentos where id = $1', [r.atendimentos[0].id]); if (a.d === D2) break; await new Promise((res) => setTimeout(res, 250)); }
  const [a] = await sql(`select data::text d, to_char(hora_inicio, 'HH24:MI') h, turno, historico from public.atendimentos where id = $1`, [r.atendimentos[0].id]);
  assert.deepEqual([a.d, a.h, a.turno], [D2, '10:30', null]);
  const [g] = await sql('select vence_em::text v from public.pagamentos where id = $1', [cobs[0].id]);
  assert.ok(g.v < D2 && g.v >= cobs[0].v, `prazo acompanha a nova data (${cobs[0].v} -> ${g.v}, diária ${D2})`);
  assert.deepEqual(p.erros, []);
});

t.teste('estorno registrado: exige motivo; cobrança vira estornada e a diária futura coberta é cancelada', async () => {
  const x = await cliente('estorno');
  const r = await pedir(x, AVULSO, D2, 'manha');
  const [g] = (await x.api.confirmarDisponibilidade(r.pedido.id, {}, { sessao: PRIME, chave: chave('disp') })).pagamentos;
  await x.api.confirmarPagamento(g.id, { sessao: PRIME, chave: chave('conf') });
  const p = S.prime;
  await painel(p, 'pagamentos');
  const linha = p.locator(`[data-tabela=recebidos] tr[data-pagamento="${g.id}"]`);
  await linha.locator('summary', { hasText: 'Registrar estorno' }).click();
  await linha.getByRole('button', { name: 'Confirmar estorno' }).click();
  await linha.locator('.erro-campo', { hasText: 'motivo' }).waitFor();
  await linha.locator('input').fill('Profissional com imprevisto, sem substituição');
  await linha.getByRole('button', { name: 'Confirmar estorno' }).click();
  for (let i = 0; i < 40; i++) { const [y] = await sql('select status from public.pagamentos where id = $1', [g.id]); if (y.status === 'estornado') break; await new Promise((res) => setTimeout(res, 250)); }
  const [y] = await sql('select status, estorno from public.pagamentos where id = $1', [g.id]);
  assert.equal(y.status, 'estornado'); assert.match(y.estorno.motivo, /imprevisto/);
  const [a] = await sql('select status from public.atendimentos where id = $1', [r.atendimentos[0].id]);
  assert.equal(a.status, 'cancelado');
});

t.teste('empresa com 4 diárias no mesmo mês: desconto de R$ 20 na cobrança da última e total = soma das cobranças', async () => {
  const x = await cliente('empresa', { tipo: 'empresa' });
  // 4 semanas dentro do mesmo mês de calendário
  let ini = dataLivre(HOJE, 2);
  const fimMes = (d) => new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0)).getUTCDate();
  while (Number(ini.slice(8)) + 21 > fimMes(ini) || ![0, 6].every((k) => k !== new Date(`${ini}T12:00:00Z`).getUTCDay()) || [7, 14, 21].some((k) => !util(somarDias(ini, k)))) ini = dataLivre(ini, 1);
  const r = await pedir(x, { tipoServico: 'empresarial', duracaoHoras: 4, metragem: 100, quantidadeDiarias: 4, frequencia: 'semanal' }, ini, 'manha');
  assert.equal(r.atendimentos.length, 4);
  const d = await x.api.confirmarDisponibilidade(r.pedido.id, {}, { sessao: PRIME, chave: chave('disp') });
  const cobs = d.pagamentos.map((g) => ({ v: g.valorCentavos, desc: g.descontoCentavos || 0, at: g.atendimentoId }));
  const [ped] = await sql('select total_centavos t from public.pedidos where id = $1', [r.pedido.id]);
  assert.equal(cobs.reduce((s, c) => s + c.v, 0), Number(ped.t), 'total = soma');
  const ultima = r.atendimentos.at(-1).id;
  assert.deepEqual(cobs.filter((c) => c.desc).map((c) => [c.at, c.desc]), [[ultima, 2000]], 'desconto só na última');
  const cheia = cobs.find((c) => c.at !== ultima).v;
  assert.equal(cobs.find((c) => c.at === ultima).v, cheia - 2000);
});

// ---------- casos de borda ----------
t.teste('recarregar no meio da solicitação mantém o passo e os dados; voltar do navegador depois de enviar não reenvia', async () => {
  const x = await cliente('volta');
  const p = await contexto(390);
  await entrarComo(p, 'cliente', x); await p.waitForURL(/minha-conta\//);
  await fluxoV2(p, D2, { ate: 'local', metragem: '52' });
  await p.reload(); await p.waitForSelector('[data-passo=local]');
  assert.equal(await p.inputValue('#metragem'), '52', 'metragem mantida depois de recarregar');
  await marcarV2(p, 'semLocalAlmoco', 'sim'); await ok(p); await marcarV2(p, 'quantidade', 'uma'); await ok(p);
  for (let k = 0; k < 6 && !(await p.locator(`.cal-dia[data-dia="${D2}"]`).count()); k++) await p.getByRole('button', { name: 'Próximo mês' }).click();
  await p.locator(`.cal-dia[data-dia="${D2}"]`).click(); await ok(p); await marcarV2(p, 'horario', '12:00'); await ok(p);
  await p.waitForSelector('[data-travados]'); await ok(p); await p.waitForSelector('[data-valor=total]');
  assert.equal(await p.locator('#aceite-termos').count(), 0, 'quem já tem conta não aceita de novo aqui');
  await p.locator('#aceite-condicoes').check();
  await p.getByRole('button', { name: 'ENVIAR SOLICITAÇÃO' }).click();
  await p.waitForSelector('[data-passo=enviado]', { timeout: 30000 });
  await p.goBack(); await p.waitForSelector('#titulo-passo');
  await p.waitForTimeout(1500);
  const [{ n }] = await sql('select count(*)::int n from public.pedidos where cliente_id = $1', [x.clienteId]);
  assert.equal(n, 1, 'um pedido só');
  assert.doesNotMatch(await p.locator('#titulo-passo').textContent(), /Revise sua solicitação/, 'o rascunho enviado não volta pronto pra reenviar');
  const [a] = await sql(`select to_char(hora_inicio, 'HH24:MI') h, duracao_minutos d from public.atendimentos a join public.pedidos p on p.id = a.pedido_id where p.cliente_id = $1`, [x.clienteId]);
  assert.deepEqual([a.h, a.d], ['12:00', 360], '52 m²: 6h sugeridas (último início 12:30); hora escolhida gravada');
  assert.deepEqual(p.erros, []);
});

t.teste('rede caindo no envio: erro claro e dados mantidos; resposta perdida depois de gravar: reenviar não duplica', async () => {
  const x = await cliente('rede');
  const p = await contexto(390);
  await entrarComo(p, 'cliente', x); await p.waitForURL(/minha-conta\//);
  await fluxoV2(p, D1);
  await p.locator('#aceite-condicoes').check();
  const enviar = () => p.getByRole('button', { name: 'ENVIAR SOLICITAÇÃO' }).click();
  // 1) rede cai antes de chegar ao servidor
  await p.route('**/rest/v1/rpc/solicitar_atendimento', (r) => r.abort('internetdisconnected'));
  await enviar();
  await p.waitForFunction(() => /Não conseguimos falar com o servidor/.test(document.body.textContent));
  assert.equal((await sql('select count(*)::int n from public.pedidos where cliente_id = $1', [x.clienteId]))[0].n, 0);
  // 2) o servidor grava, a resposta se perde no caminho
  await p.unroute('**/rest/v1/rpc/solicitar_atendimento');
  let chegou; const gravou = new Promise((res) => { chegou = res; });
  await p.route('**/rest/v1/rpc/solicitar_atendimento', async (r) => { const resp = await r.fetch(); chegou(resp.status()); await r.abort('connectionreset'); });
  await enviar();
  assert.equal(await gravou, 200, 'o servidor respondeu (e a resposta se perdeu)');
  await p.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent === 'ENVIAR SOLICITAÇÃO'); return b && !b.disabled; });
  assert.match(await p.locator('main').textContent(), /Não conseguimos falar com o servidor/);
  assert.equal((await sql('select count(*)::int n from public.pedidos where cliente_id = $1', [x.clienteId]))[0].n, 1, 'gravou uma vez');
  // 3) rede volta: a mesma chave devolve o pedido já gravado
  await p.unroute('**/rest/v1/rpc/solicitar_atendimento');
  await enviar();
  await p.waitForSelector('[data-passo=enviado]', { timeout: 30000 });
  assert.equal((await sql('select count(*)::int n from public.pedidos where cliente_id = $1', [x.clienteId]))[0].n, 1, 'reenviar não duplica');
  await p.context().close();
});

t.teste('id inexistente: acompanhamento, pagamento e pesquisa mostram "não encontrado" sem quebrar', async () => {
  const x = await cliente('inexistente');
  const p = await contexto(390);
  await entrarComo(p, 'cliente', x); await p.waitForURL(/minha-conta\//);
  const falso = crypto.randomUUID();
  for (const u of [`acompanhamento/?pedido=${falso}`, `acompanhamento/?atendimento=${falso}`, `pagamento/?pagamento=${falso}`, `avaliacao/?atendimento=${falso}`, 'acompanhamento/?pedido=nao-e-uuid']) {
    await p.goto(`${BASE}${u}`);
    await p.waitForFunction(() => /Não encontramos/.test(document.querySelector('h1')?.textContent || '') && /Confira o link/.test(document.querySelector('main')?.textContent || ''), null, { timeout: 15000 });
    assert.doesNotMatch(await p.locator('main').textContent(), /demonstração/, `${u}: texto da demonstração no real`);
  }
  assert.deepEqual(p.erros, []);
  await p.context().close();
});

t.teste('transição proibida e papel sem permissão: o banco recusa; a tela da diarista não abre o painel', async () => {
  const x = await cliente('transicao');
  const r = await pedir(x, AVULSO, D2, 'tarde');
  const at = r.atendimentos[0].id;
  const e1 = await x.api.transicionarAtendimento(at, { evento: 'finalizar' }, { sessao: CLI, chave: chave('t') }).catch((e) => e);
  assert.ok(['ATOR_SEM_PERMISSAO', 'TRANSICAO_PROIBIDA'].includes(e1.codigo), e1.codigo);
  const e2 = await x.api.transicionarAtendimento(at, { evento: 'finalizar' }, { sessao: PRIME, chave: chave('t') }).catch((e) => e);
  assert.equal(e2.codigo, 'TRANSICAO_PROIBIDA');
  const e3 = await x.api.confirmarDisponibilidade(r.pedido.id, {}, { sessao: CLI, chave: chave('d') }).catch((e) => e);
  assert.equal(e3.codigo, 'ATOR_SEM_PERMISSAO');
  const { error } = await x.c.rpc('listar_clientes', { p_filtro: {} });
  assert.ok(error, 'cliente não lista clientes');
  const du = await criarUsuario('q1-dia', 'diarista');
  const p = await contexto(390);
  await entrarComo(p, 'diarista', du); await p.waitForURL(/diarista\/agenda\//);
  await p.goto(`${BASE}painel/`); await p.waitForURL(/painel\/entrar\//);
  await p.context().close();
});

t.teste('evento repetido: confirmar o mesmo pagamento duas vezes com a mesma chave devolve o mesmo resultado, um evento só', async () => {
  const x = await cliente('repetido');
  const r = await pedir(x, AVULSO, D1, 'tarde');
  const [g] = (await x.api.confirmarDisponibilidade(r.pedido.id, {}, { sessao: PRIME, chave: chave('disp') })).pagamentos;
  const k = chave('conf');
  const [a, b2] = await Promise.all([x.api.confirmarPagamento(g.id, { sessao: PRIME, chave: k }), x.api.confirmarPagamento(g.id, { sessao: PRIME, chave: k })]);
  const c3 = await x.api.confirmarPagamento(g.id, { sessao: PRIME, chave: k });
  assert.deepEqual([a.pagamento?.status || a.status, b2.pagamento?.status || b2.status, c3.pagamento?.status || c3.status], ['confirmado', 'confirmado', 'confirmado']);
  const [{ n }] = await sql(`select count(*)::int n from public.eventos where tipo = 'pagamento_confirmado' and refs ->> 'pagamentoId' = $1`, [g.id]);
  assert.equal(n, 1, 'um evento');
  const [{ m }] = await sql(`select count(*)::int m from public.auditoria where tabela = 'pagamentos' and registro_id = $1 and depois ->> 'status' = 'confirmado' and antes ->> 'status' <> 'confirmado'`, [g.id]);
  assert.equal(m, 1, 'uma confirmação');
});

t.teste('centavo ímpar: com preço de R$ 175,01 (tabela de teste numa transação desfeita), cada cobrança é inteira e o total fecha', async () => {
  const x = await cliente('centavo');
  const res = await transacao(async (q) => {
    const [{ tabela }] = await q('select tabela from public.precos where vigente_desde <= now() order by vigente_desde desc, id desc limit 1');
    const nova = structuredClone(tabela);
    const d4 = nova.PRECOS.duracoes.find ? nova.PRECOS.duracoes.find((d) => d.horas === 4) : nova.PRECOS.duracoes['4'];
    d4.centavos += 1; // 17501
    await q(`insert into public.precos (vigente_desde, tabela) values (now() - interval '1 second', $1::text::jsonb)`, [JSON.stringify(nova)]);
    await q(`select set_config('request.jwt.claims', $1, true), set_config('role', 'authenticated', true)`, [JSON.stringify({ sub: x.id, role: 'authenticated' })]);
    const [{ r }] = await q('select public.confirmar_autoagendamento($1::text::jsonb, $2) r', [JSON.stringify({ cliente: x.dados, pacote: { ...AVULSO, frequencia: 'semanal', quantidadeDiarias: 3 }, primeiraData: D1, turno: 'manha', preferenciaProfissional: '' }), chave('cent')]);
    await q(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: adminU.id, role: 'authenticated' })]);
    const [{ d }] = await q('select public.confirmar_disponibilidade($1::uuid, $2::jsonb, $3) d', [r.pedido.id, '{}', chave('cd')]);
    const [{ t: total }] = await q('select total_centavos t from public.pedidos where id = $1', [r.pedido.id]);
    throw Object.assign(new Error('desfaz'), { res: { cobs: d.pagamentos.map((g) => g.valorCentavos), total: Number(total), dia: r.atendimentos.map((a) => a.valorDiaCentavos) } });
  }).catch((e) => { if (!e.res) throw e; return e.res; });
  assert.ok(res.dia.every((v) => v % 100 === 1), `diária com centavo ímpar: ${res.dia}`);
  assert.ok(res.cobs.every(Number.isInteger));
  assert.equal(res.cobs.reduce((s, v) => s + v, 0), res.total);
  const [{ n }] = await sql('select count(*)::int n from public.pedidos where cliente_id = $1', [x.clienteId]);
  assert.equal(n, 0, 'nada ficou no banco');
});

// ---------- L1 e A0 no navegador ----------
t.teste('L1: novo aceite no modal (Esc não fecha), consentimento, baixar meus dados e pedido de exclusão que aparece no painel', async () => {
  const x = await cliente('lgpd', { aceite: false });
  const p = await contexto(390);
  await entrarComo(p, 'cliente', x); await p.waitForURL(/minha-conta\//);
  const modal = p.locator('dialog.modal-legal[open]');
  await modal.waitFor();
  await p.keyboard.press('Escape');
  assert.equal(await modal.count(), 1, 'Esc não fecha');
  assert.equal(await p.evaluate(() => document.activeElement?.textContent), 'Li e aceito', 'foco no botão');
  await modal.getByRole('button', { name: 'Li e aceito' }).click();
  await p.locator('#privacidade').waitFor();
  const [{ n }] = await sql(`select count(*)::int n from public.aceites_termos where titular_id = $1 and origem = 'reaceite'`, [x.clienteId]);
  assert.equal(n, 1);
  await p.locator('input[data-consentimento=marketing_email]').check();
  for (let i = 0; i < 20; i++) { const [{ c }] = await sql(`select privado.consentimentos_atuais('cliente', $1) c`, [x.clienteId]); if (c.marketing_email) break; await new Promise((res) => setTimeout(res, 250)); }
  assert.deepEqual((await sql(`select privado.consentimentos_atuais('cliente', $1) c`, [x.clienteId]))[0].c, { marketing_email: true });
  const [download] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: 'Baixar meus dados' }).click()]);
  const dados = JSON.parse(readFileSync(await download.path(), 'utf8'));
  assert.equal(dados.cadastro.id, x.clienteId);
  await p.getByRole('button', { name: 'Excluir meus dados' }).click();
  await p.locator('dialog.modal-legal[open] #motivo-exclusao').fill('teste Q1');
  await p.getByRole('button', { name: 'Pedir a exclusão' }).click();
  await p.locator('#exclusao-andamento:not([hidden])').waitFor();
  const [pt] = await sql(`select id, estado from public.pedidos_titular where titular_id = $1 and tipo = 'exclusao'`, [x.clienteId]);
  assert.equal(pt.estado, 'aberto');
  const q = S.prime;
  await painel(q, 'privacidade');
  const linha = q.locator(`tr[data-pedido-titular="${pt.id}"]`);
  await linha.waitFor();
  assert.match(await linha.textContent(), /\*\*\*\.\d{3}\.\*\*\*-\*\*/, 'documento mascarado');
  assert.equal(await linha.locator('summary', { hasText: 'Executar exclusão' }).count(), 1);
  assert.deepEqual([...p.erros, ...q.erros], []);
  await p.context().close();
});

t.teste('L1: cliente nova não envia a solicitação sem marcar o aceite dos termos (nada sai pro servidor)', async () => {
  const p = await contexto(390);
  let enviados = 0;
  await p.route('**/functions/v1/conta', (r) => { if (/"acao":"(cadastrar|solicitar)"/.test(r.request().postData() || '')) enviados++; return r.continue(); });
  await fluxoV2(p, D1, { ate: 'dados' });
  await p.fill('#nome', 'Nova Sem Aceite'); await p.fill('#telefone', '31900000000'); await p.fill('#email', emailTeste('q1-sem-aceite'));
  await p.fill('#cpf', cpfFicticio()); await p.fill('#dataNascimento', '1990-04-12');
  await ok(p); await p.waitForSelector('[data-valor=total]');
  await p.locator('#aceite-condicoes').check();
  assert.equal(await p.getByRole('button', { name: 'ENVIAR SOLICITAÇÃO' }).isDisabled(), true, 'sem o aceite dos termos: não envia');
  assert.equal(enviados, 0);
  assert.match(p.url(), /autoagendamento/);
  await p.context().close();
});

t.teste('A0: admin com senha temporária cai na tela "Crie sua senha", não abre o painel antes, e depois entra', async () => {
  const u = await criarUsuario('q1-temp', 'prime_admin');
  await admin.auth.admin.updateUserById(u.id, { app_metadata: { troca_senha_obrigatoria: true } });
  const p = await contexto(390);
  await entrarComo(p, 'prime', u);
  await p.locator('#form-troca-senha').waitFor();
  await p.goto(`${BASE}painel/`); await p.waitForURL(/painel\/entrar\//);
  await p.locator('#form-troca-senha').waitFor();
  await p.fill('#atual', u.senha); await p.fill('#nova', u.senha); await p.fill('#confirma', u.senha);
  await p.getByRole('button', { name: 'Salvar e abrir o painel' }).click();
  await p.locator('#nova-erro', { hasText: 'diferente' }).waitFor();
  await p.fill('#nova', 'Nova-Senha-Q1-2026'); await p.fill('#confirma', 'Nova-Senha-Q1-2026');
  await p.getByRole('button', { name: 'Salvar e abrir o painel' }).click();
  await p.waitForURL(/painel\/(\?|$)/);
  await p.waitForSelector('.abas');
  assert.deepEqual(p.erros, []);
  await p.context().close();
});

// ---------- overflow ----------
t.teste('sem overflow horizontal em 320, 375 e 768: páginas públicas, de entrada e logadas (cliente, diarista, painel)', async () => {
  const x = await cliente('overflow');
  const r = await pedir(x, AVULSO, D2, 'manha');
  const publicas = ['', 'autoagendamento/', 'diarista/cadastro/', 'diarista/antecedentes/', 'privacidade/', 'termos/', 'entrar/', 'painel/entrar/', 'diarista/entrar/', 'pagina-que-nao-existe/'];
  const logadas = { cliente: ['minha-conta/', `acompanhamento/?pedido=${r.pedido.id}`], prime: ['painel/?aba=solicitacoes', 'painel/?aba=agenda', 'painel/?aba=pagamentos', 'painel/?aba=clientes', 'painel/?aba=privacidade', 'painel/?aba=config', 'painel/?aba=precos'] };
  const ruins = [];
  for (const larg of [320, 375, 768]) {
    const ctx = await b.newContext({ viewport: { width: larg, height: 800 }, reducedMotion: 'reduce' });
    const p = await ctx.newPage();
    const medir = async (u) => {
      await p.goto(`${BASE}${u}`);
      // a tela tem que ter terminado de montar (sem "Carregando", com conteúdo no main): senão a medida não vale
      await p.waitForFunction(() => !document.querySelector('.carregando') && (document.querySelector('main')?.textContent.trim().length || 0) > 40, null, { timeout: 30000 });
      const w = await p.evaluate(() => document.documentElement.scrollWidth);
      if (w > larg) ruins.push(`${larg}px ${u || '/'}: ${w}`);
    };
    for (const u of publicas) await medir(u);
    await entrarComo(p, 'cliente', x); await p.waitForURL(/minha-conta\//);
    for (const u of logadas.cliente) await medir(u);
    await p.evaluate(() => localStorage.clear());
    await entrarComo(p, 'prime', adminU); await p.waitForURL(/painel\/(\?|$)/);
    for (const u of logadas.prime) await medir(u);
    await ctx.close();
  }
  assert.deepEqual(ruins, []);
});

const falhas = await t.fim();
await b.close();
console.log(`# limpeza: ${await limparFicticios({ soEstaExecucao: true })} usuários fictícios removidos`);
await fecharSql();
process.exit(falhas ? 1 : 0);
