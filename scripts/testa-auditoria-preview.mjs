// Auditoria de segurança (30/09) no NAVEGADOR, contra o preview do Pages e o Supabase de homologação: XSS em todo texto
// livre que volta pra tela (nome, endereço, observação, motivo, ocorrência, hora extra, folga, pedido LGPD, template) e
// dado pessoal em localStorage, sessionStorage e console depois de sair. Só fictícios; limpa o que criou.
// Uso: LD_LIBRARY_PATH=... bash scripts/cli.sh node22 scripts/testa-auditoria-preview.mjs [url]
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { criarSuite, assert } from './lib-teste.mjs';
import { abrirNavegador } from './pw.mjs';
import { sql, fecharSql, limparFicticios, criarUsuario, cpfFicticio, aceitarTermos } from './lib-supabase.mjs';

const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim().replace(/[/_.]/g, '-').toLowerCase();
const BASE = (process.argv[2] || `https://${branch}.prime-limpeza.pages.dev/`).replace(/\/?$/, '/');
const t = criarSuite(`auditoria no navegador (${BASE})`);
await limparFicticios();

const M = `XSS${randomUUID().slice(0, 6)}`;
// cada campo leva um payload que, se virasse HTML, criaria um elemento com a marca (e tentaria rodar script)
// (curto: o banco limita nome e observação a 120 caracteres)
const X = (onde) => `${M}-${onde.slice(0, 10)}"><img src=x-${M} onerror=__xss='${onde.slice(0, 10)}'><svg onload=__xss=2><b data-xss=${M}>`;

const admin = await criarUsuario('audp-admin', 'prime_admin');
const cli = await criarUsuario('audp-cli', 'cliente', 'SenhaCliente-123');
const dia = await criarUsuario('audp-dia', 'diarista');
const cpf = cpfFicticio();
const end = { cep: '30130010', logradouro: X('rua'), numero: '1', complemento: X('complemento'), bairro: X('bairro'), cidade: 'Belo Horizonte', uf: 'MG' };
const [c] = await sql(`insert into public.clientes (usuario_id, tipo, nome, telefone, email, tipo_documento, documento, endereco, data_nascimento, origem, ficticio)
  values ($1, 'residencial', $2, '31911112295', $3, 'cpf', $4, $5::jsonb, '1980-02-03', 'site', true) returning id`, [cli.id, X('nome'), cli.email, cpf, JSON.stringify(end)]);
await sql('update public.perfis set senha_propria = true where user_id = $1', [cli.id]);
await aceitarTermos(cli.id);
const [d] = await sql(`insert into public.diaristas (usuario_id, nome, cpf, telefone, email, data_nascimento, identidade, status, aceite_termos_em, ficticio)
  values ($1, $2, $3, '31955554444', $4, '1985-04-12', 'cnh', 'aprovada', now(), true) returning id`, [dia.id, X('profissional'), cpfFicticio(), dia.email]);
const [p1] = await sql(`insert into public.pedidos (cliente_id, pacote, status, total_centavos, endereco, dados_informados, observacao_disponibilidade, ficticio)
  values ($1, '{"tipoServico":"residencial","modoPagamento":"por_diaria","duracaoHoras":4,"frequencia":"avulso","quantidadeDiarias":2}', 'solicitado', 17500, $2::jsonb, $3::jsonb, $4, true) returning id`,
[c.id, JSON.stringify(end), JSON.stringify({ nome: X('informado'), telefone: '31911112295' }), X('observacao')]);
const [a1] = await sql(`insert into public.atendimentos (pedido_id, sequencia, data, hora_inicio, duracao_minutos, diarista_id, valor_dia_centavos, status)
  values ($1, 1, current_date - 1, '08:00', 240, $2, 17500, 'finalizado') returning id`, [p1.id, d.id]);
await sql(`insert into public.atendimentos (pedido_id, sequencia, data, hora_inicio, duracao_minutos, diarista_id, valor_dia_centavos)
  values ($1, 2, current_date + 3, '08:00', 240, $2, 17500)`, [p1.id, d.id]);
await sql(`insert into public.ocorrencias (atendimento_id, cliente_id, tipo, descricao) values ($1, $2, 'outro', $3)`, [a1.id, c.id, X('ocorrencia')]);
await sql(`insert into public.horas_extras (atendimento_id, horas, observacao) values ($1, 1, $2)`, [a1.id, X('horaextra')]);
await sql(`insert into public.bloqueios_profissional (diarista_id, de, ate, motivo, observacao) values ($1, current_date + 1, current_date + 2, 'folga', $2)`, [d.id, X('folga')]);
await sql(`insert into public.pedidos_titular (user_id, titular_tipo, titular_id, tipo, estado, motivo) values ($1, 'cliente', $2, 'exclusao', 'aberto', $3)`, [cli.id, c.id, X('lgpd')]);

const b = await abrirNavegador();
async function sessao(area, u) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  p.console = []; p.erros = [];
  p.on('console', (m) => p.console.push(m.text()));
  p.on('pageerror', (e) => p.erros.push(e.message));
  p.on('dialog', (dl) => { p.erros.push(`diálogo inesperado: ${dl.message()}`); dl.dismiss(); });
  const rota = { cliente: 'entrar/', prime: 'painel/entrar/' }[area];
  await p.goto(`${BASE}${rota}`);
  await p.fill(area === 'cliente' ? '#identificador' : '#email', u.email); await p.fill('#senha', u.senha);
  await p.getByRole('button', { name: 'Entrar', exact: true }).click();
  await p.waitForURL(area === 'cliente' ? /minha-conta/ : /painel\/(\?|$)/);
  return { ctx, p };
}
/** Nenhum elemento com a marca (HTML injetado) e nenhum script rodou. Devolve quantas vezes a marca apareceu como TEXTO. */
async function semXss(p, onde) {
  await p.waitForFunction(() => !document.querySelector('.carregando'), null, { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(400);
  const r = await p.evaluate((m) => ({
    xss: window.__xss || null,
    elementos: document.querySelectorAll(`img[src="x-${m}"], [data-xss="${m}"], svg[onload]`).length,
    texto: (document.body.innerText.match(new RegExp(m, 'g')) || []).length,
  }), M);
  assert.equal(r.xss, null, `${onde}: script rodou (${r.xss})`);
  assert.equal(r.elementos, 0, `${onde}: HTML injetado`);
  return r.texto;
}

t.teste('painel: nenhum texto livre vira HTML em nenhuma aba (e a marca aparece como texto)', async () => {
  const { ctx, p } = await sessao('prime', admin);
  let vistos = 0;
  for (const aba of ['solicitacoes', 'agenda', 'atribuir', 'pagamentos', 'clientes', 'cadastros', 'ocorrencias', 'relacionamento', 'avaliacoes', 'privacidade', 'config', 'visao']) {
    await p.goto(`${BASE}painel/?aba=${aba}${aba === 'clientes' ? `&busca=${encodeURIComponent(M)}` : ''}`);
    vistos += await semXss(p, `aba ${aba}`);
  }
  await p.goto(`${BASE}painel/?aba=ocorrencias`); await semXss(p, 'ocorrências');
  await p.goto(`${BASE}acompanhamento/?pedido=${p1.id}`); vistos += await semXss(p, 'acompanhamento (Prime)');
  // busca global da visão geral com o payload no termo
  await p.goto(`${BASE}painel/?aba=visao`);
  const busca = p.locator('input[type=search]').first();
  if (await busca.count()) { await busca.fill(X('busca')); await busca.press('Enter'); await semXss(p, 'busca global'); }
  // editor de template: prévia com o payload no corpo (sem salvar)
  await p.goto(`${BASE}painel/?aba=notificacoes&sub=template&codigo=solicitacao_recebida&canal=whatsapp`);
  await p.waitForSelector('#corpo-template');
  await p.fill('#corpo-template', `Olá ${X('template')}`);
  await p.locator('#corpo-template').dispatchEvent('input');
  await semXss(p, 'prévia do template');
  assert.ok(vistos >= 5, `a marca quase não apareceu como texto (${vistos}): o teste não está olhando os campos`);
  assert.deepEqual(p.erros, []);
  await ctx.close();
});

t.teste('cliente: Minha conta e acompanhamento não viram HTML; depois de sair, nada de dado pessoal no navegador', async () => {
  const { ctx, p } = await sessao('cliente', cli);
  let vistos = await semXss(p, 'minha conta');
  await p.goto(`${BASE}acompanhamento/?pedido=${p1.id}`); vistos += await semXss(p, 'acompanhamento (cliente)');
  assert.ok(vistos >= 1, 'a marca não apareceu como texto nem na Minha conta nem no acompanhamento');
  await p.goto(`${BASE}minha-conta/`);
  await p.getByRole('button', { name: /^Sair/ }).first().click();
  await p.waitForURL((u) => !/minha-conta/.test(u.pathname));
  const guardado = await p.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  for (const [nome, v] of [['CPF', cpf], ['e-mail', cli.email], ['nome', M], ['telefone', '31911112295']]) assert.ok(!guardado.includes(v), `${nome} ficou no navegador depois de sair`);
  assert.ok(!p.console.some((l) => l.includes(cpf) || l.includes(cli.email) || l.includes('31911112295')), 'dado pessoal no console');
  assert.deepEqual(p.erros, []);
  await ctx.close();
});

const falhas = await t.fim();
await b.close();
await sql('delete from public.pedidos_titular where titular_id = $1', [c.id]);
await limparFicticios({ soEstaExecucao: true });
await fecharSql();
process.exit(falhas ? 1 : 0);
