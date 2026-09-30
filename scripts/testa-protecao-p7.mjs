// P7 e O1 CONTRA A HOMOLOGAÇÃO, só fictícios.
// P7: sem token do Turnstile o servidor recusa (entrar, cadastrar, cadastrar_diarista, solicitar); com a flag desligada
// passa; campo isca preenchido não faz nada (solicitação "enviada" sem pedido, login recusado mesmo com a senha certa);
// limite de solicitações por conta. (A recusa de token reprovado pela Cloudflare foi conferida trocando o segredo pelo
// de teste "sempre falha": ver DECISOES.)
// O1: erro do site agrupado e limpo (sem e-mail, CPF, token), I10 uma vez por janela, origem inválida recusada, vigia
// do worker parado, batimento do worker real, funil, saúde do sistema só pra Prime.
// Uso: bash scripts/cli.sh node22 scripts/testa-protecao-p7.mjs
import { criarSuite, assert } from './lib-teste.mjs';
import { sql, transacao, fecharSql, limparFicticios, entrar, criarUsuario, cpfFicticio, conta, emailTeste, anonimo, ENV, manterLimitePedidos } from './lib-supabase.mjs';
import { montarApiDeTeste } from './lib-api-teste.mjs';
import { agendar, chave } from './cenarios.mjs';
import { CLIENTE_RESIDENCIAL, proximaDataPermitida } from './fixtures/seed.js';
import { CONFIG_PRECOS } from '../src/config/precos.js';
import { dataNoFuso, somarDias } from '../src/domain/calendario.js';

const t = criarSuite('P7 proteção e O1 observabilidade (homologação)');
await limparFicticios();
const falha = async (p, codigo) => { try { await p; } catch (e) { assert.equal(e.codigo, codigo, e.message); return e; } assert.fail(`esperava ${codigo}`); };
const HOJE = dataNoFuso(new Date().toISOString());
let D = proximaDataPermitida(somarDias(HOJE, 10), 1, CONFIG_PRECOS);
while ([0, 6].includes(new Date(`${D}T12:00:00Z`).getUTCDay()) || CONFIG_PRECOS.feriados.includes(D)) D = somarDias(D, 1);
const { api, porEmail } = await montarApiDeTeste('p7');
const flag = (chaveFlag, v) => sql('update public.config_flags set ligada = $2 where chave = $1', [chaveFlag, v]);

// ---------- P7
t.teste('sem o token do Turnstile, as ações públicas são recusadas no servidor; com a flag desligada passam', async () => {
  const u = await criarUsuario('p7-login');
  for (const [acao, dados] of [['entrar', { email: u.email, senha: u.senha }], ['cadastrar_diarista', { email: emailTeste('p7'), senha: 'x' }], ['solicitar', {}]]) {
    const r = await conta(acao, { ...dados, turnstile: null });
    assert.deepEqual([r.status, r.corpo?.erro?.codigo], [400, 'VERIFICACAO_HUMANA'], acao);
  }
  assert.equal((await conta('entrar', { email: u.email, senha: u.senha, turnstile: 'x'.repeat(3000) })).status, 400, 'token grande demais');
  assert.equal((await conta('entrar', { email: u.email, senha: u.senha })).status, 200, 'com o token de teste');
  await flag('p7_turnstile', false);
  try { assert.equal((await conta('entrar', { email: u.email, senha: u.senha, turnstile: null })).status, 200, 'flag desligada'); }
  finally { await flag('p7_turnstile', true); }
});

t.teste('campo isca: login recusado mesmo com a senha certa (sem contar tentativa); solicitação "enviada" sem criar nada', async () => {
  const u = await criarUsuario('p7-isca');
  const antes = (await sql('select count(*)::int n from public.acessos where user_id = $1', [u.id]))[0].n;
  const r = await conta('entrar', { email: u.email, senha: u.senha, hp: 'http://spam' });
  assert.deepEqual([r.status, r.corpo.erro.codigo], [401, 'CREDENCIAIS_INVALIDAS']);
  assert.equal((await sql('select count(*)::int n from public.acessos where user_id = $1', [u.id]))[0].n, antes);
  const email = emailTeste('p7-robo');
  const s = await conta('solicitar', { hp: 'x', cliente: { tipo: 'residencial', nome: 'Robô Teste', email, telefone: '31955554444', cpf: cpfFicticio() } });
  assert.deepEqual([s.status, s.corpo], [200, { enviado: true }]);
  assert.equal((await sql('select count(*)::int n from public.clientes where email = $1', [email]))[0].n, 0);
});

t.teste('limite de solicitações por conta (30 em 24 h)', async () => {
  const u = await criarUsuario('p7-lim');
  porEmail.set(u.email, entrar(u));
  const cliente = { ...CLIENTE_RESIDENCIAL, email: u.email, cpf: cpfFicticio() };
  const pacote = { tipoServico: 'residencial', duracaoHoras: 4, metragem: 45, quantidadeDiarias: 1, frequencia: 'avulso' };
  await agendar(api, { cliente, pacote, primeiraData: D, turno: 'manha' }, chave('p7'));
  await sql(`insert into privado.limites_acao (chave) select $1 from generate_series(1, 30)`, [`pedido:${u.id}`]);
  manterLimitePedidos(true); // o adaptador de teste zeraria o contador antes da chamada
  try { await falha(agendar(api, { cliente, pacote, primeiraData: somarDias(D, 1), turno: 'manha' }, chave('p7')), 'CONDICAO_NAO_ATENDIDA'); }
  finally { manterLimitePedidos(false); await sql('delete from privado.limites_acao where chave = $1', [`pedido:${u.id}`]); }
});

// ---------- O1
const rest = (nome, corpo, extra = {}) => fetch(`${ENV.SUPABASE_URL}/rest/v1/rpc/${nome}`, {
  method: 'POST', headers: { apikey: ENV.SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(corpo),
}).then(async (r) => ({ status: r.status, corpo: await r.json().catch(() => null) }));

t.teste('erro do site: guardado limpo (sem e-mail, CPF, token, id), agrupado por assinatura, I10 uma vez; origem inválida recusada', async () => {
  const marca = `teste${Math.random().toString(36).replace(/[^a-z]/g, '').slice(0, 10)}x`; // só letras: número vira <n> na limpeza
  const msg = `Falhou ${marca} pra ana.souza@example.com cpf 123.456.789-09 token eyJhbGciOiJIUzI1NiJ9abc.eyJzdWIiOiIxMjMifQxyz id 3f2504e0-4f89-11d3-9a0c-0305e82c3301`;
  assert.equal((await rest('registrar_erro', { p_origem: 'site', p_mensagem: msg, p_pagina: '/pagamento/?pagamento=123' })).corpo, true);
  assert.equal((await rest('registrar_erro', { p_origem: 'site', p_mensagem: msg, p_pagina: '/pagamento/?pagamento=456' })).corpo, true);
  // revisão do GPT: a página também é limpa
  assert.equal((await rest('registrar_erro', { p_origem: 'site', p_mensagem: `outro ${marca}`, p_pagina: '/x/fulana@example.com/12345678901/' })).corpo, true);
  const [pg] = await sql(`select assinatura, pagina from public.erros where mensagem = $1`, [`outro ${marca}`]);
  assert.equal(pg.pagina, '/x/<email>/<n>/');
  await sql('delete from public.eventos where tipo = $1 and refs ->> $2 = $3', ['erro_sistema', 'erroId', pg.assinatura]);
  await sql('delete from public.erros where assinatura = $1', [pg.assinatura]);
  const [e] = await sql(`select assinatura, mensagem, pagina, contagem from public.erros where mensagem like $1`, [`%${marca}%`]);
  assert.equal(Number(e.contagem), 2, 'agrupado');
  assert.equal(e.pagina, '/pagamento/');
  assert.doesNotMatch(e.mensagem, /example\.com|123\.456|eyJ|3f2504e0/);
  assert.match(e.mensagem, /<email>.*<n>.*<token>.*<id>/);
  const [{ n }] = await sql(`select count(*)::int n from public.eventos where tipo = 'erro_sistema' and refs ->> 'erroId' = $1`, [e.assinatura]);
  assert.equal(n, 1, 'I10 uma vez');
  assert.equal((await rest('registrar_erro', { p_origem: 'function:conta', p_mensagem: 'forjado', p_pagina: '/' })).corpo, false, 'navegador não finge ser function');
  const leitura = await anonimo().from('erros').select('assinatura');
  assert.ok(leitura.error || leitura.data.length === 0, 'tabela fechada pra leitura direta');
  await sql('delete from public.eventos where tipo = $1 and refs ->> $2 = $3', ['erro_sistema', 'erroId', e.assinatura]);
  await sql('delete from public.erros where assinatura = $1', [e.assinatura]);
});

t.teste('vigia: worker sem batimento há mais de 5 min vira erro "worker parado"; o worker real bate', async () => {
  await transacao(async (q) => {
    await q(`insert into privado.batimentos (componente, em) values ('worker', now() - interval '20 minutes') on conflict (componente) do update set em = excluded.em`);
    const [{ parado }] = await q('select privado.vigiar_worker() parado');
    assert.equal(parado, true);
    const [{ n }] = await q(`select count(*)::int n from public.erros where origem = 'vigia' and mensagem like 'worker de automações parado%'`);
    assert.equal(n, 1);
    throw new Error('desfaz');
  }).catch((e) => { if (e.message !== 'desfaz') throw e; });
  // o pg_cron chama o worker a cada minuto; o batimento tem que aparecer
  let em = null;
  for (let i = 0; i < 20 && !em; i++) {
    [{ em }] = (await sql(`select em from privado.batimentos where componente = 'worker' and em > now() - interval '3 minutes'`)).concat([{ em: null }]);
    if (!em) await new Promise((ok) => setTimeout(ok, 6000));
  }
  assert.ok(em, 'batimento do worker nos últimos 3 minutos');
});

t.teste('funil: conta só os eventos da tela e do dia, sem identificar ninguém; saúde do sistema só pra Prime', async () => {
  const antes = (await sql(`select coalesce(sum(total), 0)::int n from public.funil_diario where dia = $1 and evento = 'abriu_calculadora'`, [HOJE]))[0].n;
  assert.equal((await rest('registrar_funil', { p_evento: 'abriu_calculadora' })).corpo, true);
  assert.equal((await rest('registrar_funil', { p_evento: 'pagou' })).corpo, false, 'pagou só o banco conta');
  assert.equal((await sql(`select total::int n from public.funil_diario where dia = $1 and evento = 'abriu_calculadora'`, [HOJE]))[0].n, antes + 1);
  const cols = (await sql(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'funil_diario'`)).map((x) => x.column_name).sort();
  assert.deepEqual(cols, ['dia', 'evento', 'total']);
  const adm = await entrar(await criarUsuario('p7-adm', 'prime_admin'));
  const { data, error } = await adm.rpc('saude_sistema');
  assert.equal(error, null);
  for (const k of ['worker', 'filaAtrasada', 'falhas24h', 'erros24h', 'ultimoBackup', 'erros', 'funil']) assert.ok(k in data, k);
  const cli = await entrar(await criarUsuario('p7-cli'));
  assert.ok((await cli.rpc('saude_sistema')).error, 'cliente não vê');
});

await t.fim();
await limparFicticios({ soEstaExecucao: true });
await fecharSql();
