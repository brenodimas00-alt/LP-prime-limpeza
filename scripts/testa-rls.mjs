// B1: prova, CONTRA A HOMOLOGAÇÃO, que cada papel vê e altera só o permitido (inclusive as tentativas negadas).
// Só dados fictícios (ficticio = true, e-mails teste-*@example.com); limpa o que criou. Uso: node scripts/testa-rls.mjs
import { randomUUID } from 'node:crypto';
import { criarSuite, assert } from './lib-teste.mjs';
import { tabelaDePrecos } from './gera-seed-config.mjs';
import { CONFIG_PRECOS } from '../src/config/precos.js';
import { anonimo, criarUsuario, entrar, sql, transacao, fecharSql, limparFicticios, cpfFicticio } from './lib-supabase.mjs';

const t = criarSuite('B1 RLS (homologação)');
await limparFicticios(); // sobras de execuções anteriores (só fictícios)

// ---------- fixture: usuários de cada papel ----------
const u = {
  admin: await criarUsuario('admin', 'prime_admin'),
  atend: await criarUsuario('atend', 'prime_atendimento'),
  cliA: await criarUsuario('cli-a'), cliB: await criarUsuario('cli-b'), cliC: await criarUsuario('cli-c'),
  diaX: await criarUsuario('dia-x', 'diarista'), diaY: await criarUsuario('dia-y', 'diarista'),
  diaZ: await criarUsuario('dia-z', 'diarista'), atendB: await criarUsuario('atend-b', 'prime_atendimento'),
};
const end = JSON.stringify({ cep: '30130010', logradouro: 'Rua Fictícia', numero: '1', complemento: '', bairro: 'Savassi', cidade: 'Belo Horizonte', uf: 'MG' });
async function cliente(usuario, nome) {
  const [r] = await sql(`insert into public.clientes (usuario_id, tipo, nome, telefone, email, tipo_documento, documento, endereco, origem, ficticio)
    values ($1, 'residencial', $2, '31988887777', $3, 'cpf', $4, $5::jsonb, 'site', true) returning id`, [usuario.id, nome, usuario.email, cpfFicticio(), end]);
  return r.id;
}
async function diarista(usuario, nome) {
  const [r] = await sql(`insert into public.diaristas (usuario_id, nome, cpf, telefone, email, data_nascimento, identidade, status, aceite_termos_em, ficticio)
    values ($1, $2, $3, '31966665555', $4, '1985-04-12', 'cnh', 'aprovada', now(), true) returning id`, [usuario.id, nome, cpfFicticio(), usuario.email]);
  return r.id;
}
const ids = {
  cliA: await cliente(u.cliA, 'Ana Teste RLS'), cliB: await cliente(u.cliB, 'Bia Teste RLS'), cliC: await cliente(u.cliC, 'Cida Teste RLS'),
  diaX: await diarista(u.diaX, 'Xênia Teste RLS'), diaY: await diarista(u.diaY, 'Yara Teste RLS'), diaZ: await diarista(u.diaZ, 'Zuleica Teste RLS'),
};
// vínculo duplo: a conta da diarista X também tem um cadastro de cliente (não pode acumular acesso)
ids.cliDuplo = await cliente(u.diaX, 'Xênia Como Cliente');
async function pedido(clienteId, diaristaId) {
  const [p] = await sql(`insert into public.pedidos (cliente_id, pacote, status, total_centavos, ficticio)
    values ($1, '{"tipoServico":"residencial","modoPagamento":"por_diaria"}', 'aguardando_pagamento', 35000, true) returning id`, [clienteId]);
  const [a] = await sql(`insert into public.atendimentos (pedido_id, sequencia, data, turno, diarista_id, valor_dia_centavos)
    values ($1, 1, current_date + 7, 'manha', $2, 17500) returning id`, [p.id, diaristaId]);
  const [a2] = await sql(`insert into public.atendimentos (pedido_id, sequencia, data, turno, diarista_id, valor_dia_centavos)
    values ($1, 2, current_date + 14, 'manha', null, 17500) returning id`, [p.id]);
  // pagamento antecipado e integral: uma cobrança por diária
  const [e] = await sql(`insert into public.pagamentos (pedido_id, atendimento_id, parcela, valor_centavos, pix_txid, vence_em, vence_as) values ($1, $2, 'diaria', 17500, $3, current_date + 6, '14:00') returning id`, [p.id, a.id, randomUUID().replace(/-/g, '').slice(0, 25)]);
  const [d] = await sql(`insert into public.pagamentos (pedido_id, atendimento_id, parcela, valor_centavos, pix_txid, vence_em, vence_as) values ($1, $2, 'diaria', 17500, $3, current_date + 13, '14:00') returning id`, [p.id, a2.id, randomUUID().replace(/-/g, '').slice(0, 25)]);
  return { pedido: p.id, atendimento: a.id, atendimento2: a2.id, entrada: e.id, dia: d.id };
}
const pa = await pedido(ids.cliA, ids.diaX);
const pb = await pedido(ids.cliB, null);
await sql(`insert into public.avaliacoes (atendimento_id, notas, nota_final) values ($1, '{"pontualidade":5,"qualidade":5,"cuidado":5,"comunicacao":5}', 5)`, [pa.atendimento]);
for (const [dia, tipo] of [[ids.diaX, 'foto_perfil'], [ids.diaY, 'foto_perfil']]) {
  await sql(`insert into public.documentos (diarista_id, tipo, nome_arquivo, mime, tamanho, storage_path) values ($1, $2, 'foto.png', 'image/png', 10, $3)`, [dia, tipo, `teste/${randomUUID()}`]);
}
await sql(`insert into public.eventos (tipo, refs) values ('pedido_criado', $1::jsonb)`, [JSON.stringify({ pedidoId: pa.pedido, ficticio: true })]);
await sql(`insert into public.acessos (user_id, email, resultado, ip) values ($1, $2, 'sucesso', '203.0.113.1'), ($3, $4, 'sucesso', '203.0.113.2')`, [u.cliA.id, u.cliA.email, u.cliB.id, u.cliB.email]);
const s = {};
for (const k of Object.keys(u)) s[k] = await entrar(u[k]);
// bloqueio DEPOIS de o token ser emitido: o token continua válido, a leitura tem que parar
await sql(`update public.perfis set bloqueado = true, bloqueado_em = now() where user_id = any($1::uuid[])`, [[u.cliC.id, u.diaZ.id, u.atendB.id]]);
const anon = anonimo();

/** ids visíveis numa tabela (filtrando pelos ids da fixture, pra não depender do resto do banco). */
async function vejo(c, tabela, lista, coluna = 'id') {
  const { data, error } = await c.from(tabela).select(coluna).in(coluna, lista);
  if (error) return { erro: error.code || error.message };
  return [...new Set(data.map((x) => x[coluna]))].sort();
}
const ord = (a) => [...a].sort();
const TODOS_CLI = [ids.cliA, ids.cliB, ids.cliC];
const TODOS_PED = [pa.pedido, pb.pedido];
const TODOS_ATE = [pa.atendimento, pb.atendimento, pa.atendimento2, pb.atendimento2];
const TODOS_PAG = [pa.entrada, pa.dia, pb.entrada, pb.dia];

t.teste('anônimo: lê só a tabela oficial; nada de cliente, pedido, pagamento ou perfil', async () => {
  const { data: precos } = await anon.from('precos').select('id');
  assert.ok(precos.length >= 1);
  const { data: reg } = await anon.from('regioes').select('cidade');
  assert.ok(reg.length >= 9);
  for (const tb of ['clientes', 'pedidos', 'atendimentos', 'pagamentos', 'perfis', 'diaristas', 'documentos', 'avaliacoes', 'eventos', 'eventos_externos', 'auditoria', 'acessos', 'idempotencia', 'notificacoes']) {
    const { data, error } = await anon.from(tb).select('*').limit(1);
    assert.ok(error || data.length === 0, `anon leu ${tb}`);
    assert.ok(error, `anon deveria receber erro de permissão em ${tb}`);
  }
});

t.teste('cliente A: vê só o próprio cadastro, pedido, atendimento, pagamentos, avaliação e acessos', async () => {
  assert.deepEqual(await vejo(s.cliA, 'clientes', TODOS_CLI), [ids.cliA]);
  assert.deepEqual(await vejo(s.cliA, 'pedidos', TODOS_PED), [pa.pedido]);
  assert.deepEqual(await vejo(s.cliA, 'atendimentos', TODOS_ATE), ord([pa.atendimento, pa.atendimento2]));
  assert.deepEqual(await vejo(s.cliA, 'pagamentos', TODOS_PAG), ord([pa.entrada, pa.dia]));
  assert.deepEqual(await vejo(s.cliA, 'avaliacoes', [pa.atendimento], 'atendimento_id'), [pa.atendimento]);
  assert.deepEqual(await vejo(s.cliA, 'perfis', [u.cliA.id, u.cliB.id, u.admin.id], 'user_id'), [u.cliA.id]);
  assert.deepEqual(await vejo(s.cliA, 'acessos', [u.cliA.id, u.cliB.id], 'user_id'), [u.cliA.id]);
  for (const tb of ['diaristas', 'documentos']) assert.deepEqual(await vejo(s.cliA, tb, [ids.diaX, ids.diaY], tb === 'documentos' ? 'diarista_id' : 'id'), []);
  const { data: ev } = await s.cliA.from('eventos').select('id').limit(5);
  assert.equal(ev.length, 0);
  for (const tb of ['auditoria', 'eventos_externos', 'notificacoes']) {
    const { data } = await s.cliA.from(tb).select('id').limit(5);
    assert.equal(data.length, 0, tb);
  }
});

t.teste('cliente B não vê nada da A (e vice-versa)', async () => {
  assert.deepEqual(await vejo(s.cliB, 'pedidos', [pa.pedido]), []);
  assert.deepEqual(await vejo(s.cliB, 'pagamentos', [pa.entrada, pa.dia]), []);
  assert.deepEqual(await vejo(s.cliB, 'clientes', [ids.cliA]), []);
  assert.deepEqual(await vejo(s.cliA, 'atendimentos', [pb.atendimento]), []);
});

t.teste('diarista X: vê só o atendimento atribuído a ela e o próprio cadastro/documentos; nada de cliente, pedido ou pagamento', async () => {
  assert.deepEqual(await vejo(s.diaX, 'atendimentos', TODOS_ATE), [pa.atendimento]);
  assert.deepEqual(await vejo(s.diaX, 'diaristas', [ids.diaX, ids.diaY]), [ids.diaX]);
  assert.deepEqual(await vejo(s.diaX, 'documentos', [ids.diaX, ids.diaY], 'diarista_id'), [ids.diaX]);
  assert.deepEqual(await vejo(s.diaX, 'clientes', TODOS_CLI), []);
  assert.deepEqual(await vejo(s.diaX, 'pedidos', TODOS_PED), []);
  assert.deepEqual(await vejo(s.diaX, 'pagamentos', TODOS_PAG), []);
  assert.deepEqual(await vejo(s.diaX, 'avaliacoes', [pa.atendimento], 'atendimento_id'), []);
  assert.deepEqual(await vejo(s.diaY, 'atendimentos', TODOS_ATE), [], 'diarista Y não tem atendimento');
});

t.teste('Prime (atendimento): lê tudo da fixture, mas não a auditoria; admin lê a auditoria', async () => {
  assert.deepEqual(await vejo(s.atend, 'clientes', TODOS_CLI), ord(TODOS_CLI));
  assert.deepEqual(await vejo(s.atend, 'pedidos', TODOS_PED), ord(TODOS_PED));
  assert.deepEqual(await vejo(s.atend, 'pagamentos', TODOS_PAG), ord(TODOS_PAG));
  assert.deepEqual(await vejo(s.atend, 'diaristas', [ids.diaX, ids.diaY]), ord([ids.diaX, ids.diaY]));
  assert.deepEqual(await vejo(s.atend, 'acessos', [u.cliA.id, u.cliB.id], 'user_id'), ord([u.cliA.id, u.cliB.id]));
  assert.deepEqual(await vejo(s.atend, 'auditoria', [pa.pedido], 'registro_id'), []);
  const aud = await vejo(s.admin, 'auditoria', [pa.pedido], 'registro_id');
  assert.ok(aud.length >= 1 && aud.every((x) => x === pa.pedido), 'admin vê a auditoria do pedido');
});

t.teste('auditoria registra quem mudou o quê: usuário, papel e contexto (pedido, papel e bloqueio)', async () => {
  // simula a RPC: transação com o JWT do admin e app.ator local
  await transacao(async (q) => {
    await q(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: u.admin.id, role: 'authenticated' })]);
    await q(`update public.pedidos set status = 'confirmado' where id = $1`, [pa.pedido]);
    await q(`update public.perfis set papel = 'diarista' where user_id = $1`, [u.cliB.id]);
    await q(`update public.perfis set papel = 'cliente' where user_id = $1`, [u.cliB.id]);
  }, { ator: 'prime' });
  const r = await sql(`select operacao, ator_user_id, ator_papel, ator_contexto, antes ->> 'status' as antes, depois ->> 'status' as depois
    from public.auditoria where tabela = 'pedidos' and registro_id = $1 order by id`, [pa.pedido]);
  assert.equal(r[0].operacao, 'INSERT');
  const up = r.find((x) => x.operacao === 'UPDATE');
  assert.deepEqual([up.antes, up.depois, up.ator_contexto, up.ator_user_id, up.ator_papel], ['aguardando_pagamento', 'confirmado', 'prime', u.admin.id, 'prime_admin']);
  const pap = await sql(`select antes ->> 'papel' as de, depois ->> 'papel' as para from public.auditoria where tabela = 'perfis' and registro_id = $1 and operacao = 'UPDATE' order by id`, [u.cliB.id]);
  assert.deepEqual(pap.map((x) => `${x.de}>${x.para}`), ['cliente>diarista', 'diarista>cliente']);
  const bloq = await sql(`select count(*)::int as n from public.auditoria where tabela = 'perfis' and registro_id = $1 and depois ->> 'bloqueado' = 'true'`, [u.cliC.id]);
  assert.equal(bloq[0].n, 1, 'bloqueio auditado');
  for (const tb of ['clientes', 'atendimentos', 'pagamentos', 'diaristas']) {
    const [{ n }] = await sql('select count(*)::int as n from public.auditoria where tabela = $1 and registro_id = any($2::uuid[])', [tb, [...TODOS_CLI, ...TODOS_ATE, ...TODOS_PAG, ids.diaX, ids.diaY]]);
    assert.ok(n > 0, `auditoria de ${tb}`);
  }
  const [{ ator }] = await sql(`select current_setting('app.ator', true) as ator`);
  assert.ok(!ator, 'app.ator não vaza pra fora da transação');
});

t.teste('bloqueado DEPOIS do login (cliente, diarista e Prime) não lê nada, nem o próprio cadastro', async () => {
  assert.deepEqual(await vejo(s.cliC, 'clientes', [ids.cliC]), []);
  assert.deepEqual(await vejo(s.cliC, 'perfis', [u.cliC.id], 'user_id'), []);
  assert.deepEqual(await vejo(s.diaZ, 'diaristas', [ids.diaZ]), []);
  assert.deepEqual(await vejo(s.atendB, 'clientes', TODOS_CLI), []);
  assert.deepEqual(await vejo(s.atendB, 'pedidos', TODOS_PED), []);
});

t.teste('vínculo duplo não acumula acesso: a diarista X não vê o próprio cadastro de cliente', async () => {
  assert.deepEqual(await vejo(s.diaX, 'clientes', [ids.cliDuplo]), []);
  assert.deepEqual(await vejo(s.atend, 'clientes', [ids.cliDuplo]), [ids.cliDuplo]);
});

t.teste('constraints barram dado inconsistente mesmo pelo service role', async () => {
  const falha = async (rotulo, texto, params) => {
    let erro = null;
    try { await sql(texto, params); } catch (e) { erro = e; }
    assert.ok(erro, `${rotulo} deveria falhar`);
  };
  const txid = () => randomUUID().replace(/-/g, '').slice(0, 25);
  await falha('cobrança com atendimento de outro pedido', `insert into public.pagamentos (pedido_id, atendimento_id, parcela, valor_centavos, pix_txid) values ($1, $2, 'diaria', 100, $3)`, [pb.pedido, pa.atendimento, txid()]);
  await falha('cobrança de diária sem atendimento', `insert into public.pagamentos (pedido_id, parcela, valor_centavos, pix_txid) values ($1, 'diaria', 100, $2)`, [pa.pedido, txid()]);
  await falha('segunda cobrança ativa da mesma diária', `insert into public.pagamentos (pedido_id, atendimento_id, parcela, valor_centavos, pix_txid) values ($1, $2, 'diaria', 100, $3)`, [pa.pedido, pa.atendimento, txid()]);
  await sql(`insert into public.pagamentos (pedido_id, parcela, valor_centavos, pix_txid) values ($1, 'pacote', 100, $2)`, [pb.pedido, txid()]);
  await falha('segunda cobrança ativa do pacote', `insert into public.pagamentos (pedido_id, parcela, valor_centavos, pix_txid) values ($1, 'pacote', 100, $2)`, [pb.pedido, txid()]);
  await falha('valor negativo', `insert into public.pagamentos (pedido_id, atendimento_id, parcela, valor_centavos, pix_txid) values ($1, $2, 'diaria', -1, $3)`, [pb.pedido, pb.atendimento2, txid()]);
  await falha('entrada sem restante (modelo antigo pela metade)', `update public.pedidos set entrada_centavos = 1 where id = $1`, [pb.pedido]);
  await falha('estorno sem motivo', `update public.pagamentos set status = 'estornado' where id = $1`, [pb.dia]);
  await falha('recusa sem motivo', `update public.pedidos set status = 'recusado' where id = $1`, [pb.pedido]);
  await falha('notas vazias', `insert into public.avaliacoes (atendimento_id, notas, nota_final) values ($1, '{}', 5)`, [pb.atendimento]);
  await falha('nota fora de 1..5', `insert into public.avaliacoes (atendimento_id, notas, nota_final) values ($1, '{"pontualidade":6,"qualidade":5,"cuidado":5,"comunicacao":5}', 5.3)`, [pb.atendimento]);
  await falha('nota final incoerente', `insert into public.avaliacoes (atendimento_id, notas, nota_final) values ($1, '{"pontualidade":1,"qualidade":1,"cuidado":1,"comunicacao":1}', 5)`, [pb.atendimento]);
  await falha('documento duplicado de cliente', `insert into public.clientes (tipo, nome, tipo_documento, documento, origem, ficticio) select tipo, nome, tipo_documento, documento, origem, true from public.clientes where id = $1`, [ids.cliA]);
});

t.teste('escrita direta negada pra todo papel (insert, update, delete), inclusive subir o próprio papel', async () => {
  const tentativas = [
    ['cliA', (c) => c.from('perfis').update({ papel: 'prime_admin' }).eq('user_id', u.cliA.id).select()],
    ['cliA', (c) => c.from('clientes').update({ nome: 'Hack' }).eq('id', ids.cliA).select()],
    ['cliA', (c) => c.from('pagamentos').update({ status: 'confirmado' }).eq('id', pa.entrada).select()],
    ['cliA', (c) => c.from('pedidos').insert({ cliente_id: ids.cliA, pacote: {}, status: 'ativo', total_centavos: 1, entrada_centavos: 0, restante_centavos: 1 }).select()],
    ['cliA', (c) => c.from('avaliacoes').delete().eq('atendimento_id', pa.atendimento).select()],
    ['diaX', (c) => c.from('atendimentos').update({ status: 'finalizado' }).eq('id', pa.atendimento).select()],
    ['diaX', (c) => c.from('diaristas').update({ status: 'aprovada' }).eq('id', ids.diaY).select()],
    ['atend', (c) => c.from('pagamentos').update({ status: 'confirmado' }).eq('id', pb.entrada).select()],
    ['atend', (c) => c.from('perfis').update({ papel: 'prime_admin' }).eq('user_id', u.atend.id).select()],
    ['admin', (c) => c.from('precos').insert({ tabela: {} }).select()],
    ['admin', (c) => c.from('auditoria').delete().eq('registro_id', pa.pedido).select()],
    ['admin', (c) => c.from('idempotencia').select('*').limit(1)],
  ];
  for (const [quem, fn] of tentativas) {
    const { data, error } = await fn(s[quem]);
    assert.ok(error, `${quem} conseguiu: ${JSON.stringify(data)?.slice(0, 80)}`);
  }
  const [{ papel }] = await sql('select papel from public.perfis where user_id = $1', [u.cliA.id]);
  assert.equal(papel, 'cliente');
  const [{ status }] = await sql('select status from public.pagamentos where id = $1', [pa.entrada]);
  assert.equal(status, 'pendente');
  const [{ nome }] = await sql('select nome from public.clientes where id = $1', [ids.cliA]);
  assert.equal(nome, 'Ana Teste RLS');
});

t.teste('helpers internos não ficam expostos na API e o cadastro nasce com papel cliente', async () => {
  const { error } = await s.cliA.rpc('papel');
  assert.ok(error, 'privado.papel não pode ser chamado pela API');
  const [{ papel }] = await sql('select papel from public.perfis where user_id = $1', [u.cliB.id]);
  assert.equal(papel, 'cliente');
  const semRls = await sql(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not (c.relrowsecurity and c.relforcerowsecurity)`);
  assert.deepEqual(semRls, [], 'toda tabela com RLS forçada');
});

t.teste('tabela oficial no banco = src/config/precos.js (preços, regiões e feriados)', async () => {
  const [{ tabela }] = await sql('select tabela from public.precos order by vigente_desde desc, id desc limit 1');
  assert.deepEqual(tabela, JSON.parse(JSON.stringify(tabelaDePrecos())));
  const reg = await sql('select cidade, uf, taxa_centavos, sob_consulta from public.regioes order by cidade');
  const esperado = CONFIG_PRECOS.regioesAtendidas.map((r) => ({ cidade: r.cidade, uf: r.uf, taxa_centavos: r.sobConsulta ? null : String(r.taxaCentavos), sob_consulta: !!r.sobConsulta }))
    .sort((a, b) => a.cidade.localeCompare(b.cidade));
  assert.deepEqual(reg.sort((a, b) => a.cidade.localeCompare(b.cidade)), esperado);
  const fer = await sql(`select to_char(data, 'YYYY-MM-DD') as d from public.feriados where not bloqueia order by data`);
  assert.deepEqual(fer.map((x) => x.d), [...CONFIG_PRECOS.feriados].sort());
});

const falhas = await t.fim();
const n = await limparFicticios({ soEstaExecucao: true });
console.log(`# limpeza: ${n} usuários fictícios removidos`);
await fecharSql();
process.exit(falhas ? 1 : 0);
