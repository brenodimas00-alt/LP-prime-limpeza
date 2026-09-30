// Mais de um papel na mesma conta (migration 20260930110000), CONTRA A HOMOLOGAÇÃO, só com fictícios:
// papel principal mantido pelo banco, papel ativo por requisição (header x-papel) sem acumular acesso, header forjado
// não dá papel que a conta não tem, token com a lista de papéis, login pelo CPF exige a senha própria, exclusão de dados
// recusada pra conta que também é da equipe, e a unificação de duas contas (a da equipe e a de cliente) sem perder nada.
// Uso: bash scripts/cli.sh node22 scripts/testa-papeis.mjs
import { createClient } from '@supabase/supabase-js';
import { criarSuite, assert } from './lib-teste.mjs';
import { ENV, criarUsuario, sql, fecharSql, limparFicticios, cpfFicticio, conta, aceitarTermos } from './lib-supabase.mjs';

const t = criarSuite('papéis múltiplos (homologação)');
await limparFicticios();

const end = JSON.stringify({ cep: '30130010', logradouro: 'Rua Fictícia', numero: '1', complemento: '', bairro: 'Savassi', cidade: 'Belo Horizonte', uf: 'MG' });
async function cliente(usuario, nome, cpf = cpfFicticio()) {
  const [r] = await sql(`insert into public.clientes (usuario_id, tipo, nome, email, tipo_documento, documento, data_nascimento, endereco, origem, ficticio)
    values ($1, 'residencial', $2, $3, 'cpf', $4, '1980-02-03', $5::jsonb, 'site', true) returning id`, [usuario.id, nome, usuario.email, cpf, end]);
  await aceitarTermos(usuario.id);
  return r.id;
}
async function pedido(clienteId) {
  const [p] = await sql(`insert into public.pedidos (cliente_id, pacote, status, total_centavos, ficticio)
    values ($1, '{"tipoServico":"residencial","modoPagamento":"por_diaria"}', 'solicitado', 35000, true) returning id`, [clienteId]);
  return p.id;
}
/** Sessão pela function (como o site) e um cliente supabase-js por papel pedido (null = sem header). */
async function sessao(email, senha, area = 'cliente') {
  const r = await conta('entrar', { email, senha, area });
  if (r.status !== 200) throw new Error(`login: ${r.status} ${r.corpo?.erro?.codigo}`);
  return r.corpo;
}
function como(s, papel) {
  const c = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${s.sessao.access_token}`, ...(papel ? { 'x-papel': papel } : {}) } },
  });
  return c;
}
const claims = (s) => JSON.parse(Buffer.from(s.sessao.access_token.split('.')[1], 'base64url').toString());
const ids = async (c, tabela) => { const { data, error } = await c.from(tabela).select('id'); if (error) throw new Error(`${tabela}: ${error.message}`); return data.map((x) => x.id); };

// ---------- fixture ----------
const dupla = await criarUsuario('dupla');
const cpfDupla = cpfFicticio();
const cliDupla = await cliente(dupla, 'Dupla Teste Papéis', cpfDupla);
const pedDupla = await pedido(cliDupla);
await sql(`update public.perfis set papeis = array['cliente', 'prime_admin'] where user_id = $1`, [dupla.id]);
const outra = await criarUsuario('outra');
const pedOutra = await pedido(await cliente(outra, 'Outra Teste Papéis'));

t.teste('banco mantém o papel principal (o de mais privilégio) e a lista coerente', async () => {
  const [p] = await sql('select papel, papeis from public.perfis where user_id = $1', [dupla.id]);
  assert.equal(p.papel, 'prime_admin');
  assert.deepEqual(p.papeis, ['cliente', 'prime_admin']);
  // código antigo que só troca papel: conta de um papel troca (cliente que vira diarista), conta de vários ganha o novo
  const um = await criarUsuario('um');
  await sql(`update public.perfis set papel = 'diarista' where user_id = $1`, [um.id]);
  assert.deepEqual((await sql('select papeis from public.perfis where user_id = $1', [um.id]))[0].papeis, ['diarista']);
  await sql(`update public.perfis set papeis = array['cliente', 'diarista'] where user_id = $1`, [um.id]);
  await sql(`update public.perfis set papel = 'prime_atendimento' where user_id = $1`, [um.id]);
  const [q] = await sql('select papel, papeis from public.perfis where user_id = $1', [um.id]);
  assert.equal(q.papel, 'prime_atendimento');
  assert.deepEqual(q.papeis, ['cliente', 'diarista', 'prime_atendimento']);
  await assert.rejects(sql(`update public.perfis set papeis = array['cliente', 'dono'] where user_id = $1`, [um.id]), /perfis_papeis_validos/);
  await assert.rejects(sql(`update public.perfis set papeis = array[]::text[] where user_id = $1`, [um.id]), /perfis_papeis_validos|not-null/);
});

const sDupla = await sessao(dupla.email, dupla.senha, 'prime');

t.teste('token e resposta do login trazem a lista de papéis; o papel do token continua o principal', async () => {
  assert.equal(sDupla.papel, 'prime_admin');
  assert.deepEqual(sDupla.papeis, ['cliente', 'prime_admin']);
  assert.deepEqual(claims(sDupla).papeis, ['cliente', 'prime_admin']);
  const sOutra = await sessao(outra.email, outra.senha);
  assert.deepEqual(sOutra.papeis, ['cliente']);
});

t.teste('papel ativo: como cliente vê só o que é dela e não usa RPC da Prime; como admin vê tudo; nunca os dois juntos', async () => {
  const cli = como(sDupla, 'cliente');
  const peds = await ids(cli, 'pedidos');
  assert.ok(peds.includes(pedDupla) && !peds.includes(pedOutra), 'como cliente: só o próprio pedido');
  assert.deepEqual(await ids(cli, 'clientes'), [cliDupla]);
  const { error } = await cli.rpc('listar_clientes', { p_filtro: {} });
  assert.ok(error, 'RPC do painel negada como cliente');
  const adm = como(sDupla, 'prime_admin');
  const todos = await ids(adm, 'pedidos');
  assert.ok(todos.includes(pedDupla) && todos.includes(pedOutra), 'como admin: todos');
  const { error: e2 } = await adm.rpc('listar_clientes', { p_filtro: {} });
  assert.equal(e2, null);
  // sem header: vale o principal
  assert.ok((await ids(como(sDupla, null), 'pedidos')).includes(pedOutra));
});

t.teste('header forjado: papel que a conta não tem não dá acesso nenhum (nem cai no principal)', async () => {
  const sOutra = await sessao(outra.email, outra.senha);
  for (const p of ['prime_admin', 'prime_atendimento', 'diarista', 'qualquer']) {
    const c = como(sOutra, p);
    assert.deepEqual(await ids(c, 'pedidos'), [], `cliente pedindo ${p}`);
    assert.deepEqual(await ids(c, 'clientes'), [], `cliente pedindo ${p}: nem o próprio cadastro`);
    const { error } = await c.rpc('listar_clientes', { p_filtro: {} });
    assert.ok(error, `RPC da Prime negada pedindo ${p}`);
  }
  assert.deepEqual(await ids(como(sDupla, 'diarista'), 'pedidos'), [], 'conta dupla pedindo papel que não tem');
  assert.ok((await ids(como(sOutra, 'cliente'), 'pedidos')).includes(pedOutra), 'o próprio papel continua valendo');
});

t.teste('bloqueio e troca de senha pendente negam tudo em qualquer papel pedido', async () => {
  const x = await criarUsuario('bloq');
  const cx = await cliente(x, 'Bloqueada Teste Papéis');
  await sql(`update public.perfis set papeis = array['cliente', 'prime_admin'] where user_id = $1`, [x.id]);
  const s = await sessao(x.email, x.senha, 'prime');
  await pedido(cx);
  await sql(`update auth.users set raw_app_meta_data = raw_app_meta_data || '{"troca_senha_obrigatoria": true}' where id = $1`, [x.id]);
  for (const p of ['cliente', 'prime_admin', null]) assert.deepEqual(await ids(como(s, p), 'pedidos'), [], `troca pendente, ${p}`);
  await sql(`update auth.users set raw_app_meta_data = raw_app_meta_data - 'troca_senha_obrigatoria' where id = $1`, [x.id]);
  assert.equal((await ids(como(s, 'cliente'), 'pedidos')).length, 1);
  await sql('update public.perfis set bloqueado = true where user_id = $1', [x.id]);
  for (const p of ['cliente', 'prime_admin', null]) assert.deepEqual(await ids(como(s, p), 'pedidos'), [], `bloqueada, ${p}`);
});

t.teste('conta com papel da equipe: pelo CPF só entra com a senha própria (nunca com a data de nascimento)', async () => {
  const pelaData = await conta('entrar', { identificador: cpfDupla, senha: '03021980' });
  assert.equal(pelaData.status, 401);
  const pelaSenha = await conta('entrar', { identificador: cpfDupla, senha: dupla.senha });
  assert.equal(pelaSenha.status, 200);
  assert.deepEqual(pelaSenha.corpo.papeis, ['cliente', 'prime_admin']);
});

t.teste('exclusão de dados pedida pela conta que também é da equipe: a function recusa (não apaga o acesso da equipe)', async () => {
  const cli = como(sDupla, 'cliente');
  const { data: p, error } = await cli.rpc('pedir_exclusao', { p_motivo: 'teste' });
  assert.equal(error, null);
  const adm = await criarUsuario('adm', 'prime_admin');
  const sAdm = await sessao(adm.email, adm.senha, 'prime');
  const r = await conta('executar_exclusao', { pedidoId: p.id }, sAdm.sessao.access_token);
  assert.equal(r.status, 409);
  assert.equal(r.corpo.erro.codigo, 'CONDICAO_NAO_ATENDIDA');
  const [c] = await sql('select anonimizado_em, usuario_id from public.clientes where id = $1', [cliDupla]);
  assert.equal(c.anonimizado_em, null);
  assert.equal(c.usuario_id, dupla.id);
});

t.teste('unificar a conta da equipe na de cliente: leva papel e senha, bloqueia a antiga, nada é apagado, idempotente', async () => {
  const equipe = await criarUsuario('equipe', 'prime_admin');
  const cliente2 = await criarUsuario('cliente2');
  const cli2 = await cliente(cliente2, 'Cliente Unificada Teste');
  const ped2 = await pedido(cli2);
  await conta('entrar', { email: equipe.email, senha: equipe.senha, area: 'prime' }); // gera acesso no histórico da antiga
  await sql(`insert into public.auditoria (tabela, operacao, ator_user_id, ator_papel, ator_contexto) values ('teste', 'UPDATE', $1, 'prime_admin', 'teste')`, [equipe.id]);
  const antes = (await sql('select (select count(*) from public.acessos where user_id = $1)::int ac, (select count(*) from public.auditoria where ator_user_id = $1)::int au', [equipe.id]))[0];
  // revisão do GPT: sem levar a senha, a cliente com a senha padrão não vira equipe
  await assert.rejects(sql('select public.conta_unificar($1, $2, false)', [equipe.id, cliente2.id]), /CONDICAO_NAO_ATENDIDA/);
  // origem com cadastro de cliente não pode (só leva papéis da equipe)
  await assert.rejects(sql('select public.conta_unificar($1, $2, true)', [cliente2.id, equipe.id]), /CONDICAO_NAO_ATENDIDA/);
  const [{ r }] = await sql('select public.conta_unificar($1, $2, true) r', [equipe.id, cliente2.id]);
  assert.equal(r.jaUnificada, false);
  assert.deepEqual(r.papeis.sort(), ['cliente', 'prime_admin']);
  // entra com o e-mail de cliente e a senha que usava na equipe; a senha antiga da cliente não vale mais
  const nova = await conta('entrar', { email: cliente2.email, senha: equipe.senha, area: 'prime' });
  assert.equal(nova.status, 200);
  assert.deepEqual(nova.corpo.papeis, ['cliente', 'prime_admin']);
  assert.equal((await conta('entrar', { email: cliente2.email, senha: cliente2.senha })).status, 401);
  // a antiga não entra mais, e deixou de ser da equipe
  const velha = await conta('entrar', { email: equipe.email, senha: equipe.senha, area: 'prime' });
  assert.ok([401, 403].includes(velha.status), `antiga entrou: ${velha.status}`);
  const [pv] = await sql('select papeis, bloqueado, bloqueado_motivo from public.perfis where user_id = $1', [equipe.id]);
  assert.deepEqual(pv.papeis, ['cliente']);
  assert.equal(pv.bloqueado, true);
  // nada apagado: cadastro e pedido da cliente, histórico da antiga (acessos e auditoria)
  assert.equal((await sql('select count(*)::int n from public.pedidos where id = $1 and cliente_id = $2', [ped2, cli2]))[0].n, 1);
  const depois = (await sql('select (select count(*) from public.acessos where user_id = $1)::int ac, (select count(*) from public.auditoria where ator_user_id = $1)::int au', [equipe.id]))[0];
  assert.ok(depois.ac >= antes.ac && depois.au >= antes.au, 'histórico da antiga preservado');
  assert.equal((await sql(`select count(*)::int n from public.auditoria where tabela = 'auth.users' and registro_id = $1 and ator_contexto = 'servico:unificar_contas'`, [cliente2.id]))[0].n, 1);
  // de novo: nada muda
  const [{ r: r2 }] = await sql('select public.conta_unificar($1, $2, true) r', [equipe.id, cliente2.id]);
  assert.equal(r2.jaUnificada, true);
  // e a cliente unificada funciona nas duas áreas
  const cliUni = como(nova.corpo, 'cliente');
  assert.deepEqual(await ids(cliUni, 'clientes'), [cli2]);
  assert.ok((await ids(como(nova.corpo, 'prime_admin'), 'pedidos')).includes(pedOutra));
});

t.teste('function documentos aceita o header x-papel (CORS) e repassa ao banco', async () => {
  const r = await fetch(`${ENV.SUPABASE_URL}/functions/v1/documentos`, {
    method: 'OPTIONS', headers: { Origin: 'http://localhost:8080', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type,x-papel' },
  });
  assert.match(r.headers.get('access-control-allow-headers') || '', /x-papel/);
});

await t.fim();
await limparFicticios({ soEstaExecucao: true });
await fecharSql();
