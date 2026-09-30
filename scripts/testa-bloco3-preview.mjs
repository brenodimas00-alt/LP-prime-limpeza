// Bloco 3 da fase 2 no NAVEGADOR contra o preview do Pages e o Supabase de homologação, só com fictícios.
// P2: agenda por profissional (...). P3: prazo vencido (liberar a vaga), hora extra (a profissional registra, a Prime
// aprova), recibo em PDF baixado em Minha conta.
// P2: agenda por profissional (arrastar pra outro dia com confirmação, mover pelo teclado trocando a profissional com
// aviso de disponibilidade, férias pela ficha da profissional), sugestão na aba Atribuir.
// Uso: LD_LIBRARY_PATH=... bash scripts/cli.sh node22 scripts/testa-bloco3-preview.mjs [url]
import { execFileSync } from 'node:child_process';
import { criarSuite, assert } from './lib-teste.mjs';
import { abrirNavegador } from './pw.mjs';
import { sql, fecharSql, limparFicticios, criarUsuario, cpfFicticio, entrar, aceitarTermos } from './lib-supabase.mjs';
import { montarApiDeTeste } from './lib-api-teste.mjs';
import { agendar, chave, liberarCobranca, levarAteFinalizado } from './cenarios.mjs';
import { CLIENTE_RESIDENCIAL, proximaDataPermitida } from './fixtures/seed.js';
import { CONFIG_PRECOS } from '../src/config/precos.js';
import { dataNoFuso, somarDias } from '../src/domain/calendario.js';

const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim().replace(/[/_.]/g, '-').toLowerCase();
const BASE = (process.argv[2] || `https://${branch}.prime-limpeza.pages.dev/`).replace(/\/?$/, '/');
const t = criarSuite(`bloco 3 no navegador (${BASE})`);
await limparFicticios();
const PRIME = { ator: 'prime' };
const { api, porEmail, porDiaristaId } = await montarApiDeTeste('b3p', { avisarDisponibilidade: true });
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
  porDiaristaId.set(r.id, entrar(u)); // a profissional age pela própria sessão (check-in nos casos do P4)
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

// ---------- P3
async function loginCliente(u, largura = 390) {
  const ctx = await b.newContext({ viewport: { width: largura, height: 900 }, reducedMotion: 'reduce', acceptDownloads: true });
  const p = await ctx.newPage();
  await p.goto(`${BASE}entrar/`);
  await p.fill('#identificador', u.email); await p.fill('#senha', u.senha);
  await p.getByRole('button', { name: 'Entrar', exact: true }).click();
  await p.waitForURL(/minha-conta\//);
  return { ctx, p };
}

t.teste('P3: a profissional registra hora extra na agenda; a Prime aprova no painel; a cliente baixa o recibo em PDF', async () => {
  const uCli = await criarUsuario('b3p-cli');
  porEmail.set(uCli.email, entrar(uCli));
  const cliente = { ...CLIENTE_RESIDENCIAL, email: uCli.email, cpf: cpfFicticio() };
  const r3 = await agendar(api, { cliente, pacote: { tipoServico: 'residencial', duracaoHoras: 4, metragem: 45, quantidadeDiarias: 1, frequencia: 'avulso' }, primeiraData: somarDias(D, 5), turno: 'manha' }, chave('b3p'));
  await aceitarTermos(uCli.id);
  const uDia = await criarUsuario('b3p-dora', 'diarista');
  const [{ id: DORA }] = await sql(`insert into public.diaristas (usuario_id, nome, cpf, telefone, email, data_nascimento, identidade, status, aceite_termos_em, disponibilidade, ficticio)
    values ($1, 'Dora Navegador P3', $2, '31955554444', $3, '1985-04-12', 'cnh', 'aprovada', now(), '{"dias":[1,2,3,4,5,6],"turnos":["integral"],"regioes":["BH - Centro-Sul"]}', true) returning id`, [uDia.id, cpfFicticio(), uDia.email]);
  await sql(`insert into public.aceites_termos (user_id, titular_tipo, titular_id, versao, origem) values ($1, 'diarista', $2, public.versao_legal(), 'cadastro_diarista') on conflict do nothing`, [uDia.id, DORA]);
  porDiaristaId.set(DORA, entrar(uDia));
  await levarAteFinalizado(api, r3, DORA, r3.atendimentos[0].id);
  const at = r3.atendimentos[0].id;
  // profissional
  const cd = await b.newContext({ viewport: { width: 390, height: 900 }, reducedMotion: 'reduce' });
  const pd = await cd.newPage();
  await pd.goto(`${BASE}diarista/entrar/`);
  await pd.fill('#email', uDia.email); await pd.fill('#senha', uDia.senha);
  await pd.getByRole('button', { name: 'Entrar', exact: true }).click();
  await pd.waitForURL(/diarista\/agenda\//);
  const li = pd.locator(`li[data-atendimento="${at}"]`);
  await li.locator('summary').click();
  await li.locator(`#he-${at}`).selectOption('2');
  await li.getByRole('button', { name: 'Registrar' }).click();
  await pd.locator(`li[data-atendimento="${at}"]`).getByText('Hora extra: 2h, aguardando a Prime.').waitFor();
  await cd.close();
  // Prime
  const { ctx, p } = await pagina();
  await p.goto(`${BASE}painel/?aba=pagamentos`);
  await semCarregando(p);
  const linha = p.locator('[data-tabela="horas-extras"] tr', { hasText: 'Dora Navegador P3' });
  await linha.getByRole('button', { name: /Aprovar R\$ 60,00/ }).click();
  await p.waitForFunction(() => !document.querySelector('[aria-busy=true]'));
  for (let i = 0; i < 20; i++) { const [x] = await sql(`select status from public.horas_extras h where h.atendimento_id = $1`, [at]); if (x?.status === 'aprovada') break; await new Promise((ok) => setTimeout(ok, 500)); }
  const [he] = await sql(`select h.status, g.valor_centavos, g.id from public.horas_extras h join public.pagamentos g on g.id = h.pagamento_id where h.atendimento_id = $1`, [at]);
  assert.deepEqual([he.status, Number(he.valor_centavos)], ['aprovada', 6000]);
  await ctx.close();
  // cliente: recibo da diária (paga no levarAteFinalizado)
  const c = await loginCliente(uCli);
  await c.p.locator('#h-rec').waitFor();
  const [dl] = await Promise.all([c.p.waitForEvent('download'), c.p.locator('[data-recibo]').first().click()]);
  assert.match(dl.suggestedFilename(), /^recibo-prime-\d{6}\.pdf$/);
  const bytes = await (await import('node:fs/promises')).readFile(await dl.path());
  assert.equal(bytes.subarray(0, 8).toString('latin1'), '%PDF-1.4');
  await print(c.p, 'p3-minha-conta-390');
  await c.ctx.close();
});

t.teste('P3: cobrança vencida aparece no painel e "Liberar vaga" cancela a diária', async () => {
  const r4 = await agendar(api, { cliente: CLIENTE_RESIDENCIAL, pacote: { tipoServico: 'residencial', duracaoHoras: 4, metragem: 45, quantidadeDiarias: 1, frequencia: 'avulso' }, primeiraData: somarDias(D, 6), turno: 'manha' }, chave('b3p'));
  const [g] = await liberarCobranca(api, r4);
  await sql('update public.pagamentos set vence_em = current_date - 1 where id = $1', [g.id]);
  const { ctx, p } = await pagina();
  await p.goto(`${BASE}painel/?aba=pagamentos`);
  await semCarregando(p);
  await p.locator('[data-tabela=vencidos]').scrollIntoViewIfNeeded();
  if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/p3-pagamentos-1280.png` });
  await p.locator(`[data-vencido="${g.id}"]`).getByRole('button', { name: 'Liberar vaga' }).click();
  for (let i = 0; i < 20; i++) { const [x] = await sql('select status from public.atendimentos where id = $1', [r4.atendimentos[0].id]); if (x.status === 'cancelado') break; await new Promise((ok) => setTimeout(ok, 500)); }
  assert.equal((await sql('select status from public.atendimentos where id = $1', [r4.atendimentos[0].id]))[0].status, 'cancelado');
  assert.deepEqual(p.erros, []);
  await ctx.close();
});

// ---------- P4
t.teste('P4: agenda da profissional como PWA; sem conexão abre a agenda salva, guarda o check-in e manda quando volta (uma vez)', async () => {
  const uDia = await criarUsuario('b3p-pwa', 'diarista');
  const [{ id: DIA }] = await sql(`insert into public.diaristas (usuario_id, nome, cpf, telefone, email, data_nascimento, identidade, status, aceite_termos_em, disponibilidade, ficticio)
    values ($1, 'Pia Navegador P4', $2, '31955554444', $3, '1985-04-12', 'cnh', 'aprovada', now(), '{"dias":[0,1,2,3,4,5,6],"turnos":["integral"],"regioes":["BH - Centro-Sul"]}', true) returning id`, [uDia.id, cpfFicticio(), uDia.email]);
  await sql(`insert into public.aceites_termos (user_id, titular_tipo, titular_id, versao, origem) values ($1, 'diarista', $2, public.versao_legal(), 'cadastro_diarista') on conflict do nothing`, [uDia.id, DIA]);
  porDiaristaId.set(DIA, entrar(uDia));
  const r5 = await agendar(api, { cliente: CLIENTE_RESIDENCIAL, pacote: { tipoServico: 'residencial', duracaoHoras: 4, metragem: 45, quantidadeDiarias: 1, frequencia: 'avulso' }, primeiraData: somarDias(D, 7), turno: 'manha' }, chave('b3p'));
  const at = r5.atendimentos[0].id;
  // diária de "hoje" pro cache do dia (a data é da solicitação; o teste move pra hoje direto no banco)
  const hoje = dataNoFuso(new Date().toISOString());
  await liberarCobranca(api, r5);
  await api.atribuirDiarista(at, { diaristaId: DIA }, { sessao: PRIME, chave: chave('atr') });
  const [g] = (await api.obterPedido(r5.pedido.id, { sessao: PRIME })).pagamentos;
  await api.confirmarPagamento(g.id, { sessao: PRIME, chave: chave('conf') });
  await sql('update public.atendimentos set data = $2 where id = $1', [at, hoje]);
  const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  const man = await (await ctx.request.get(`${BASE}diarista/manifest.webmanifest`)).json();
  assert.equal(man.display, 'standalone');
  assert.ok(man.icons.some((i) => i.sizes === '512x512') && man.icons.some((i) => i.purpose === 'maskable'));
  await p.goto(`${BASE}diarista/entrar/`);
  await p.fill('#email', uDia.email); await p.fill('#senha', uDia.senha);
  await p.getByRole('button', { name: 'Entrar', exact: true }).click();
  await p.waitForURL(/diarista\/agenda\//);
  assert.ok(await p.evaluate(async () => !!(await navigator.serviceWorker.ready).active), 'service worker ativo');
  assert.equal(await p.locator('link[rel=manifest]').count(), 1);
  await p.reload(); // segunda visita: o service worker guarda os arquivos da página
  const botao = p.locator(`li[data-atendimento="${at}"]`).getByRole('button', { name: 'Estou a caminho' });
  await botao.waitFor();
  await ctx.setOffline(true);
  await p.reload();
  await p.getByText(/Sem conexão\. Esta é a agenda salva/).waitFor();
  await p.locator(`li[data-atendimento="${at}"]`).getByRole('button', { name: 'Estou a caminho' }).click();
  await p.locator(`li[data-atendimento="${at}"]`).getByText('Sem conexão: este aviso sai assim que o sinal voltar.').waitFor();
  assert.equal((await sql('select status from public.atendimentos where id = $1', [at]))[0].status, 'confirmado');
  await ctx.setOffline(false);
  await p.evaluate(() => window.dispatchEvent(new Event('online')));
  for (let i = 0; i < 30; i++) { const [x] = await sql('select status from public.atendimentos where id = $1', [at]); if (x.status === 'diarista_a_caminho') break; await new Promise((ok) => setTimeout(ok, 500)); }
  const [x] = await sql(`select status, (select count(*)::int from jsonb_array_elements(historico) h where h ->> 'evento' = 'sair_a_caminho') n from public.atendimentos where id = $1`, [at]);
  assert.deepEqual([x.status, x.n], ['diarista_a_caminho', 1]);
  // chegou e check-out com o checklist
  await p.reload();
  await p.locator(`li[data-atendimento="${at}"]`).getByRole('button', { name: 'Iniciei a diária' }).click();
  await p.locator(`li[data-atendimento="${at}"]`).getByRole('button', { name: 'Finalizei' }).click();
  const dlg = p.locator('dialog.checklist[open]');
  await dlg.waitFor();
  await dlg.getByRole('button', { name: 'Salvar e finalizar' }).click();
  await dlg.locator('.alerta-erro:not([hidden])').waitFor(); // nada marcado
  const n = await dlg.locator('.item-checklist').count();
  for (let i = 0; i < n; i++) await dlg.locator(`#ck-${i}-${i === 1 ? 'nao' : 'sim'}`).check();
  await dlg.locator('#ck-motivo-1').fill('sem material de limpeza de vidro');
  await print(p, 'p4-checklist-390');
  await dlg.getByRole('button', { name: 'Salvar e finalizar' }).click();
  for (let i = 0; i < 30; i++) { const [y] = await sql('select status from public.atendimentos where id = $1', [at]); if (y.status === 'finalizado') break; await new Promise((ok) => setTimeout(ok, 500)); }
  const [ck] = await sql('select itens from public.checklist_respostas where atendimento_id = $1', [at]);
  assert.equal(ck.itens[1].feito, false);
  assert.equal((await sql('select status from public.atendimentos where id = $1', [at]))[0].status, 'finalizado');
  await ctx.close();
});

t.teste('P4: a cliente relata um problema com foto no acompanhamento; a Prime vê no painel e responde', async () => {
  const uCli = await criarUsuario('b3p-oc');
  porEmail.set(uCli.email, entrar(uCli));
  const r6 = await agendar(api, { cliente: { ...CLIENTE_RESIDENCIAL, email: uCli.email, cpf: cpfFicticio() }, pacote: { tipoServico: 'residencial', duracaoHoras: 4, metragem: 45, quantidadeDiarias: 1, frequencia: 'avulso' }, primeiraData: somarDias(D, 8), turno: 'manha' }, chave('b3p'));
  await aceitarTermos(uCli.id);
  await levarAteFinalizado(api, r6, ANA, r6.atendimentos[0].id);
  const at = r6.atendimentos[0].id;
  const c = await loginCliente(uCli);
  await c.p.goto(`${BASE}acompanhamento/?atendimento=${at}`);
  await c.p.getByRole('button', { name: 'Relatar um problema' }).click();
  await c.p.selectOption('#oc-tipo', 'dano');
  await c.p.fill('#oc-descricao', 'A porta do armário ficou riscada depois da limpeza.');
  const { ARQUIVOS } = await import('./fixtures/arquivos.mjs');
  await c.p.setInputFiles('#oc-foto', { name: 'porta.png', mimeType: 'image/png', buffer: Buffer.from(ARQUIVOS.png.bytes) });
  await c.p.getByRole('button', { name: 'Enviar para a Prime' }).click();
  await c.p.getByText('Recebemos seu relato. A Prime analisa e responde pelo WhatsApp.').waitFor();
  await c.ctx.close();
  const [oc] = await sql('select id, foto_path is not null foto from public.ocorrencias where atendimento_id = $1', [at]);
  assert.equal(oc.foto, true);
  const { ctx, p } = await pagina();
  await p.goto(`${BASE}painel/?aba=ocorrencias`);
  await semCarregando(p);
  const li = p.locator(`[data-ocorrencia="${oc.id}"]`);
  await li.waitFor();
  await print(p, 'p4-ocorrencias-1280');
  await li.locator(`#oc-estado-${oc.id}`).selectOption('resolvido');
  await li.locator(`#oc-com-${oc.id}`).fill('Vamos arcar com o reparo.');
  await li.getByRole('button', { name: 'Salvar' }).click();
  for (let i = 0; i < 20; i++) { const [y] = await sql('select estado from public.ocorrencias where id = $1', [oc.id]); if (y.estado === 'resolvido') break; await new Promise((ok) => setTimeout(ok, 500)); }
  assert.equal((await sql('select estado from public.ocorrencias where id = $1', [oc.id]))[0].estado, 'resolvido');
  assert.deepEqual(p.erros, []);
  await ctx.close();
});

// ---------- P5
t.teste('P5: aba Cadastros mostra certidões vencendo e o repasse (desligado até a Prime definir a regra)', async () => {
  const { ctx, p } = await pagina();
  await p.goto(`${BASE}painel/?aba=cadastros`);
  await semCarregando(p);
  await p.locator('[data-certidoes] h2').waitFor();
  await p.locator('[data-repasse]').getByText(/Repasse desligado até a Prime definir a regra/).waitFor();
  assert.deepEqual(p.erros, []);
  await ctx.close();
});

// ---------- P6
t.teste('P6: link da renovação passa pelo login e abre a revisão com as datas do mês seguinte; a Prime exporta a planilha', async () => {
  const uCli = await criarUsuario('b3p-ren');
  porEmail.set(uCli.email, entrar(uCli));
  const r7 = await agendar(api, { cliente: { ...CLIENTE_RESIDENCIAL, email: uCli.email, cpf: cpfFicticio() }, pacote: { tipoServico: 'residencial', duracaoHoras: 4, metragem: 45, quantidadeDiarias: 2, frequencia: 'semanal' }, primeiraData: somarDias(D, 9), turno: 'manha' }, chave('b3p'));
  await aceitarTermos(uCli.id);
  const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  await p.goto(`${BASE}autoagendamento/?repetir=${r7.pedido.id}`);
  await p.waitForURL(/entrar\/\?destino=/);
  await p.fill('#identificador', uCli.email); await p.fill('#senha', uCli.senha);
  await p.getByRole('button', { name: 'Entrar', exact: true }).click();
  await p.waitForURL(/autoagendamento\/$/);
  await p.getByText('Trouxemos o mesmo pacote com as datas do mês seguinte').waitFor();
  await p.getByText('Revise sua solicitação').waitFor();
  const d = await api.dadosRenovacao(r7.pedido.id, { sessao: { ator: 'cliente', id: r7.cliente.id } });
  const [, mes, dia] = d.datas[0].split('-');
  assert.ok((await p.locator('main').textContent()).includes(`${dia}/${mes}`), 'datas do mês seguinte na revisão');
  await ctx.close();
  const pa = await pagina();
  await pa.p.goto(`${BASE}painel/?aba=relacionamento`);
  await semCarregando(pa.p);
  await pa.p.locator('[data-lista=M01] h2').waitFor();
  const [dl] = await Promise.all([pa.p.waitForEvent('download'), pa.p.locator('[data-exportar=pedidos]').click()]);
  const csv = await (await import('node:fs/promises')).readFile(await dl.path(), 'utf8');
  assert.ok(csv.startsWith('\uFEFFPedido;Cliente;Serviço;'), 'CSV do Excel');
  assert.deepEqual(pa.p.erros, []);
  await pa.ctx.close();
});

// ---------- P7, O1, P1
t.teste('P7: a entrada mostra a verificação da Cloudflare e o campo isca não aparece nem recebe foco; entrar funciona', async () => {
  const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  const script = p.waitForRequest(/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js/, { timeout: 20000 });
  await p.goto(`${BASE}entrar/`);
  await script;
  // a caixinha fica num shadow DOM; o que dá pra conferir é o token que a Cloudflare põe no formulário
  await p.waitForFunction(() => [...document.querySelectorAll('[name="cf-turnstile-response"]')].some((i) => i.value), null, { timeout: 20000 });
  const isca = p.locator('input[name=site_empresa]');
  assert.equal(await isca.getAttribute('tabindex'), '-1');
  const caixa = await isca.boundingBox();
  assert.ok(caixa.x + caixa.width < 0, 'campo isca fora da tela');
  const u = await criarUsuario('b3p-ts');
  await sql(`insert into public.clientes (usuario_id, tipo, nome, email, tipo_documento, documento, origem, ficticio) values ($1, 'residencial', 'Turnstile Teste', $2, 'cpf', $3, 'site', true)`, [u.id, u.email, cpfFicticio()]);
  await aceitarTermos(u.id);
  await p.fill('#identificador', u.email); await p.fill('#senha', u.senha);
  await p.getByRole('button', { name: 'Entrar', exact: true }).click();
  await p.waitForURL(/minha-conta\//);
  await ctx.close();
});

t.teste('O1: erro provocado na página aparece agrupado na saúde do sistema, sem dado pessoal', async () => {
  const marca = `provocado${Math.random().toString(36).replace(/[^a-z]/g, '').slice(0, 8)}`;
  const ctx = await b.newContext({ viewport: { width: 390, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(`${BASE}condicoes/`);
  await p.waitForLoadState('networkidle');
  for (let i = 0; i < 2; i++) await p.evaluate((m) => setTimeout(() => { throw new Error(`${m} fulana@example.com`); }), marca);
  await p.waitForTimeout(3000);
  await ctx.close();
  const [e] = await sql('select assinatura, mensagem, contagem from public.erros where mensagem like $1', [`%${marca}%`]);
  assert.ok(e, 'erro registrado');
  assert.doesNotMatch(e.mensagem, /example\.com/);
  const pa = await pagina();
  await pa.p.goto(`${BASE}painel/?aba=visao`);
  await semCarregando(pa.p);
  await pa.p.locator('[data-saude] table').getByText(marca).first().waitFor();
  await print(pa.p, 'p1-visao-1280');
  await pa.ctx.close();
  await sql(`delete from public.eventos where tipo = 'erro_sistema' and refs ->> 'erroId' = $1`, [e.assinatura]);
  await sql('delete from public.erros where assinatura = $1', [e.assinatura]);
});

t.teste('P1: visão geral mostra os indicadores do mês pra admin e a busca devolve o resultado mascarado', async () => {
  const { ctx, p } = await pagina();
  await p.goto(`${BASE}painel/?aba=visao`);
  await semCarregando(p);
  await p.locator('[data-indicadores] .indicador').first().waitFor();
  await p.fill('#busca-global', 'Ana Navegador');
  await p.getByRole('button', { name: 'Buscar' }).click();
  const r = p.locator(`[data-resultado="${ANA}"]`);
  await r.waitFor();
  assert.match(await r.textContent(), /\*\*\*\.\d{3}\.\d{3}-\*\*/);
  assert.deepEqual(p.erros, []);
  await ctx.close();
});

await t.fim();
await b.close();
await limparFicticios({ soEstaExecucao: true });
await fecharSql();
