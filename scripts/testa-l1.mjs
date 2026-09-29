// L1 (LGPD) contra a HOMOLOGAÇÃO, só com dados fictícios: aceite com versão, novo aceite, consentimentos com histórico,
// "baixar meus dados" (só os próprios), pedido de exclusão, execução pela Prime (anonimiza, apaga o acesso, preserva
// pagamentos, limpa a auditoria) e flags (só prime_admin alterna, auditado).
// Uso: bash scripts/cli.sh node22 scripts/testa-l1.mjs
import { criarSuite, assert } from './lib-teste.mjs';
import { admin, conta, entrar, criarUsuario, sql, transacao, fecharSql, limparFicticios, cpfFicticio } from './lib-supabase.mjs';
import { montarApiDeTeste } from './lib-api-teste.mjs';
import { criarAvulso, liberarCobranca, chave } from './cenarios.mjs';

const t = criarSuite('L1 LGPD (homologação)');
await limparFicticios();
const VERSAO = (await sql('select public.versao_legal() v'))[0].v;
const { api, porClienteId } = await montarApiDeTeste('l1');
const adm = await entrar(await criarUsuario('l1-admin', 'prime_admin'));
const atend = await entrar(await criarUsuario('l1-atend', 'prime_atendimento'));
const PRIME = { ator: 'prime' };
const rpc = async (c, nome, args = {}) => { const { data, error } = await c.rpc(nome, args); if (error) throw Object.assign(new Error(error.details || error.message), { codigo: error.message, pg: error.code }); return data; };
const falha = async (p, codigo) => { try { await p; } catch (e) { if (codigo) assert.equal(e.codigo, codigo, e.message); return e; } assert.fail(`esperava ${codigo}`); };

/** Cliente fictícia com conta na regra padrão e cadastro (sem aceite, como os importados). */
async function clienteSemAceite(rotulo) {
  const u = await criarUsuario(rotulo);
  const cpf = cpfFicticio();
  const [{ id }] = await sql(`insert into public.clientes (usuario_id, tipo, nome, email, telefone, tipo_documento, documento, data_nascimento, endereco, origem, ficticio)
    values ($1, 'residencial', 'Cliente LGPD Teste', $2, null, 'cpf', $3, '1990-01-02', '{"cidade":"Belo Horizonte","uf":"MG","logradouro":"Rua Fictícia"}', 'importado', true) returning id`, [u.id, u.email, cpf]);
  return { ...u, cpf, clienteId: id, c: await entrar(u) };
}

t.teste('tabelas novas fechadas: nem cliente nem Prime leem direto (só por RPC)', async () => {
  const x = await clienteSemAceite('l1-rls');
  for (const tab of ['aceites_termos', 'consentimentos', 'pedidos_titular', 'config_flags', 'documentos_legais']) {
    for (const c of [x.c, adm]) { const { error } = await c.from(tab).select('*').limit(1); assert.ok(error, `${tab} legível`); }
  }
});

t.teste('importada sem aceite: situação pede aceite; versão velha é recusada; aceitar grava 1 linha (idempotente)', async () => {
  const x = await clienteSemAceite('l1-aceite');
  const s = await rpc(x.c, 'situacao_legal');
  assert.deepEqual([s.versaoVigente, s.aceitouVigente, s.pedirAceite], [VERSAO, false, true]);
  await falha(rpc(x.c, 'registrar_aceite', { p_versao: '2000-01-01' }), 'CONDICAO_NAO_ATENDIDA');
  await rpc(x.c, 'registrar_aceite', { p_versao: VERSAO });
  await rpc(x.c, 'registrar_aceite', { p_versao: VERSAO });
  assert.equal((await rpc(x.c, 'situacao_legal')).aceitouVigente, true);
  const [{ n }] = await sql(`select count(*)::int n from public.aceites_termos where titular_tipo = 'cliente' and titular_id = $1`, [x.clienteId]);
  assert.equal(n, 1);
});

t.teste('versão nova dos termos pede novo aceite a quem aceitou a anterior (numa transação desfeita: ninguém de fora vê a versão de teste)', async () => {
  const x = await clienteSemAceite('l1-versao');
  await rpc(x.c, 'registrar_aceite', { p_versao: VERSAO });
  const r = await transacao(async (q) => {
    await q(`insert into public.documentos_legais (versao, vigente_desde, resumo) values ('2099-01-01', now() - interval '1 second', 'teste l1')`);
    await q(`select set_config('request.jwt.claims', $1, true), set_config('role', 'authenticated', true)`, [JSON.stringify({ sub: x.id, role: 'authenticated' })]);
    const [{ s }] = await q('select public.situacao_legal() s');
    let erro = null;
    try { await q(`select public.registrar_aceite('${VERSAO}')`); } catch (e) { erro = e.message; }
    throw Object.assign(new Error('desfaz'), { resultado: { s, erro } });
  }).catch((e) => e.resultado);
  assert.deepEqual([r.s.versaoVigente, r.s.aceitouVigente, r.erro], ['2099-01-01', false, 'CONDICAO_NAO_ATENDIDA']);
  assert.equal((await sql(`select count(*)::int n from public.documentos_legais where versao = '2099-01-01'`))[0].n, 0);
  assert.equal((await rpc(x.c, 'situacao_legal')).aceitouVigente, true);
});

t.teste('consentimentos: separados, histórico só cresce quando muda; localização só pra profissional', async () => {
  const x = await clienteSemAceite('l1-cons');
  let s = await rpc(x.c, 'definir_consentimento', { p_tipo: 'marketing_whatsapp', p_concedido: true });
  assert.deepEqual(s, { marketing_whatsapp: true });
  await rpc(x.c, 'definir_consentimento', { p_tipo: 'marketing_whatsapp', p_concedido: true }); // repetido: sem linha nova
  s = await rpc(x.c, 'definir_consentimento', { p_tipo: 'marketing_email', p_concedido: true });
  s = await rpc(x.c, 'definir_consentimento', { p_tipo: 'marketing_whatsapp', p_concedido: false });
  assert.deepEqual(s, { marketing_whatsapp: false, marketing_email: true });
  const [{ n }] = await sql(`select count(*)::int n from public.consentimentos where titular_id = $1`, [x.clienteId]);
  assert.equal(n, 3);
  await falha(rpc(x.c, 'definir_consentimento', { p_tipo: 'localizacao_profissional', p_concedido: true }), 'DADOS_INVALIDOS');
  await falha(rpc(adm, 'definir_consentimento', { p_tipo: 'marketing_email', p_concedido: true }), 'ATOR_SEM_PERMISSAO');
});

t.teste('diarista: enviar o cadastro grava o aceite da versão vigente no banco; localização é consentimento dela', async () => {
  const u = await criarUsuario('l1-dia');
  const id = crypto.randomUUID();
  await sql('select public.conta_criar_rascunho_diarista($1, $2)', [u.id, id]);
  await sql(`update public.diaristas set aceite_termos_em = now() where id = $1`, [id]); // o que cadastrar_diarista faz ao enviar
  const [a] = await sql(`select versao, origem from public.aceites_termos where titular_tipo = 'diarista' and titular_id = $1`, [id]);
  assert.deepEqual([a?.versao, a?.origem], [VERSAO, 'cadastro_diarista']);
  const c = await entrar(u);
  assert.deepEqual(await rpc(c, 'definir_consentimento', { p_tipo: 'localizacao_profissional', p_concedido: true, p_origem: 'agenda_diarista' }), { localizacao_profissional: true });
  await falha(rpc(c, 'pedir_exclusao', {}), 'CONDICAO_NAO_ATENDIDA'); // profissional pede à Prime
});

t.teste('baixar meus dados: só os próprios, sem campo interno; o acesso fica registrado', async () => {
  const a = await clienteSemAceite('l1-dados-a');
  const b = await clienteSemAceite('l1-dados-b');
  const d = await rpc(a.c, 'meus_dados');
  assert.equal(d.cadastro.id, a.clienteId);
  assert.equal(d.cadastro.documento, a.cpf);
  assert.ok(!JSON.stringify(d).includes(b.cpf), 'dado de outra cliente');
  assert.ok(!('importacao' in d.cadastro) && !('usuario_id' in d.cadastro));
  assert.ok(Array.isArray(d.acessos) && d.acessos.length >= 1);
  const [{ n }] = await sql(`select count(*)::int n from public.pedidos_titular where titular_id = $1 and tipo = 'acesso'`, [a.clienteId]);
  assert.equal(n, 1);
  await falha(rpc(adm, 'meus_dados'), 'ATOR_SEM_PERMISSAO');
});

t.teste('pedido de exclusão: pedir de novo devolve o mesmo; aparece no painel com documento mascarado; cliente não lista', async () => {
  const x = await clienteSemAceite('l1-pedido');
  const p1 = await rpc(x.c, 'pedir_exclusao', { p_motivo: 'teste' });
  const p2 = await rpc(x.c, 'pedir_exclusao', { p_motivo: 'outra vez' });
  assert.equal(p1.id, p2.id);
  assert.equal((await rpc(x.c, 'situacao_legal')).exclusaoEmAndamento, true);
  const lista = await rpc(atend, 'listar_pedidos_titular', { p_filtro: { estado: 'aberto' } });
  const item = lista.find((i) => i.id === p1.id);
  assert.ok(item, 'aparece no painel');
  assert.equal(item.documento, `***.${x.cpf.slice(3, 6)}.***-**`);
  assert.ok(!JSON.stringify(lista).includes(x.cpf));
  await falha(rpc(x.c, 'listar_pedidos_titular', {}), 'ATOR_SEM_PERMISSAO');
});

t.teste('executar exclusão: atendimento não pode; com cobrança em aberto recusa; depois anonimiza, apaga o acesso, preserva pagamento e limpa a auditoria', async () => {
  const r = await criarAvulso(api, chave('l1-exc'));
  const u = porClienteId.get(r.cliente.id);
  const cob = await liberarCobranca(api, r);
  const [{ usuario_id: userId, documento, nome, email, telefone }] = await sql('select usuario_id, documento, nome, email, telefone from public.clientes where id = $1', [r.cliente.id]);
  await rpc(u, 'definir_consentimento', { p_tipo: 'marketing_email', p_concedido: true });
  const p = await rpc(u, 'pedir_exclusao', { p_motivo: 'quero sair, meu nome é Fulana' });
  await sql(`update public.pedidos set observacao_disponibilidade = 'ligar pra Fulana no 31999990000' where id = $1`, [r.pedido.id]);
  await sql(`insert into public.acessos (user_id, email, resultado, identificador, tipo_identificador, finalizado_em) values (null, $1, 'falha', $2, 'cpf', now())`, [email, documento]);
  assert.equal((await conta('executar_exclusao', { pedidoId: p.id }, atend.token)).status, 403, 'atendimento não executa');
  const aberto = await conta('executar_exclusao', { pedidoId: p.id }, adm.token);
  assert.equal(aberto.status, 409, JSON.stringify(aberto.corpo)); assert.match(aberto.corpo.erro.mensagem, /em aberto/);
  // resolve a pendência como a Prime faria: cancela o pedido
  await api.cancelarPedido(r.pedido.id, { motivo: 'cliente pediu exclusão' }, { sessao: PRIME, chave: chave('canc') });
  const [{ nome_antes }] = await sql(`select count(*)::int nome_antes from public.auditoria where tabela = 'clientes' and registro_id = $1 and (antes ? 'nome' or depois ? 'nome')`, [r.cliente.id]);
  assert.ok(nome_antes > 0, 'auditoria tinha o nome antes');
  // avisos do pedido ainda na fila do worker (pg_cron, 1 por minuto): a exclusão espera, e tentar de novo é seguro
  let ok;
  for (let i = 0; i < 18; i++) {
    ok = await conta('executar_exclusao', { pedidoId: p.id }, adm.token);
    if (ok.status !== 409 || !/fila/.test(ok.corpo.erro.mensagem)) break;
    await new Promise((res) => setTimeout(res, 10000));
  }
  assert.equal(ok.status, 200, JSON.stringify(ok.corpo)); assert.equal(ok.corpo.estado, 'executado');
  const [c] = await sql('select nome, email, telefone, data_nascimento, endereco, documento, usuario_id, anonimizado_em is not null an from public.clientes where id = $1', [r.cliente.id]);
  assert.deepEqual([c.nome, c.email, c.telefone, c.data_nascimento, c.usuario_id, c.an, c.documento], ['Titular excluída', null, null, null, null, true, documento]);
  assert.ok(!('logradouro' in c.endereco) && !('numero' in c.endereco), JSON.stringify(c.endereco));
  const { data: au } = await admin.auth.admin.getUserById(userId);
  assert.ok(!au?.user, 'usuário do Auth apagado');
  assert.equal((await sql('select count(*)::int n from public.pagamentos where id = any($1::uuid[])', [cob.map((g) => g.id)]))[0].n, cob.length, 'pagamentos preservados');
  // nenhum valor pessoal original sobra na auditoria (as linhas novas só têm o cadastro já anonimizado)
  for (const [rotulo, valor] of [['nome', nome], ['e-mail', email], ['telefone', telefone]]) {
    const [{ n }] = await sql(`select count(*)::int n from public.auditoria where ((tabela = 'clientes' and registro_id = $1) or (tabela in ('perfis', 'auth.users') and registro_id = $2))
      and strpos(coalesce(antes::text, '') || coalesce(depois::text, ''), $3) > 0`, [r.cliente.id, userId, valor]);
    assert.equal(n, 0, `${rotulo} ainda na auditoria`);
  }
  const [{ n: ac }] = await sql(`select count(*)::int n from public.acessos where email is not null and user_id is null and identificador = $1`, [documento]);
  assert.equal(ac, 0);
  assert.deepEqual(Object.values((await sql(`select privado.consentimentos_atuais('cliente', $1) c`, [r.cliente.id]))[0].c), [false], 'marketing revogado');
  // revisão do GPT: textos livres, motivo do pedido e tentativa de login sem conta resolvida também saem
  const [pd] = await sql('select observacao_disponibilidade o, cancelamento from public.pedidos where id = $1', [r.pedido.id]);
  assert.deepEqual([pd.o, pd.cancelamento?.motivo], [null, undefined]);
  assert.equal((await sql('select motivo from public.pedidos_titular where id = $1', [p.id]))[0].motivo, null);
  assert.equal((await sql('select count(*)::int n from public.acessos where identificador = $1 or lower(email) = lower($2)', [documento, email]))[0].n, 0);
  // e nada volta a ter dado pessoal nem ganha pedido novo (trava no banco, contra corrida com agendamento em andamento)
  const volta = await sql(`update public.clientes set email = 'volta@example.com' where id = $1`, [r.cliente.id]).catch((e) => e);
  assert.equal(volta.message, 'CONDICAO_NAO_ATENDIDA');
  const novo = await sql(`insert into public.pedidos (cliente_id, pacote, status, total_centavos, entrada_centavos, restante_centavos, ficticio) values ($1, '{}', 'solicitado', 0, 0, 0, true)`, [r.cliente.id]).catch((e) => e);
  assert.equal(novo.message, 'CONDICAO_NAO_ATENDIDA');
  const de_novo = await conta('executar_exclusao', { pedidoId: p.id }, adm.token);
  assert.equal(de_novo.status, 200); assert.equal(de_novo.corpo.estado, 'executado');
  const [{ estado }] = await sql('select estado from public.pedidos_titular where id = $1', [p.id]);
  assert.equal(estado, 'executado');
});

t.teste('recusar pedido exige motivo e só prime_admin', async () => {
  const x = await clienteSemAceite('l1-recusa');
  const p = await rpc(x.c, 'pedir_exclusao', {});
  await falha(rpc(atend, 'recusar_pedido_titular', { p_id: p.id, p_resposta: 'motivo longo' }), 'ATOR_SEM_PERMISSAO');
  await falha(rpc(adm, 'recusar_pedido_titular', { p_id: p.id, p_resposta: '' }), 'DADOS_INVALIDOS');
  assert.equal((await rpc(adm, 'recusar_pedido_titular', { p_id: p.id, p_resposta: 'há diária em andamento' })).estado, 'recusado');
});

t.teste('flags: cliente não vê; atendimento vê mas não muda; admin muda, é auditado e o servidor obedece', async () => {
  const x = await clienteSemAceite('l1-flag');
  await falha(rpc(x.c, 'listar_flags'), 'ATOR_SEM_PERMISSAO');
  assert.ok((await rpc(atend, 'listar_flags')).some((f) => f.chave === 'lgpd_portal_titular'));
  await falha(rpc(atend, 'alternar_flag', { p_chave: 'lgpd_portal_titular', p_ligada: false }), 'ATOR_SEM_PERMISSAO');
  try {
    await rpc(adm, 'alternar_flag', { p_chave: 'lgpd_portal_titular', p_ligada: false });
    await falha(rpc(x.c, 'meus_dados'), 'CONDICAO_NAO_ATENDIDA');
    assert.equal((await rpc(x.c, 'situacao_legal')).portal, false);
    const [{ n }] = await sql(`select count(*)::int n from public.auditoria where tabela = 'config_flags' and depois ->> 'chave' = 'lgpd_portal_titular' and ator_user_id = $1`, [adm.userId || (await adm.auth.getUser()).data.user.id]);
    assert.ok(n >= 1, 'auditado');
  } finally {
    await rpc(adm, 'alternar_flag', { p_chave: 'lgpd_portal_titular', p_ligada: true });
  }
  assert.ok(await rpc(x.c, 'meus_dados'));
});

const falhas = await t.fim();
console.log(`# limpeza: ${await limparFicticios({ soEstaExecucao: true })} usuários fictícios removidos`);
await fecharSql();
process.exit(falhas ? 1 : 0);
