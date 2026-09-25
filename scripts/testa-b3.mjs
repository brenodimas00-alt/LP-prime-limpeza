// B3: o adapter SUPABASE passa na MESMA bateria de contrato dos adapters mock e http (scripts/cenarios.mjs), contra a
// homologação, com usuários fictícios por papel; mais corrida de idempotência, anônimo barrado e eventos/auditoria.
// Uso: bash scripts/cli.sh node22 scripts/testa-b3.mjs
import { criarSuite, assert, lancaCodigo } from './lib-teste.mjs';
import { registrarCenarios, criarAvulso, criarDiaristaAprovada, liberarCobranca, chave } from './cenarios.mjs';
import { criarAdapterSupabase } from '../src/services/adapters/supabase.js';
import { CLIENTE_RESIDENCIAL, CLIENTE_EMPRESA, DIARISTA_FICTICIA } from './fixtures/seed.js';
import { anonimo, entrar, criarUsuario, emailTeste, sql, fecharSql, limparFicticios, cpfFicticio, exigirTelefonesLivres } from './lib-supabase.mjs';

const t = criarSuite('B3 contrato do adapter supabase (homologação)');
await limparFicticios();

// Documentos fictícios da bateria não podem colidir com a base real
const docsFixture = [CLIENTE_RESIDENCIAL.cpf, CLIENTE_EMPRESA.cnpj];
const [{ n }] = await sql('select count(*)::int n from public.clientes where documento = any($1) and not ficticio', [docsFixture]);
if (n) throw new Error('CPF/CNPJ das fixtures existe na base real: troque as fixtures antes de rodar');
const [{ m }] = await sql('select count(*)::int m from public.diaristas where cpf = $1 and not ficticio', [DIARISTA_FICTICIA.cpf]);
if (m) throw new Error('CPF da diarista fictícia existe na base real');
await exigirTelefonesLivres([CLIENTE_RESIDENCIAL.telefone, CLIENTE_EMPRESA.telefone]);

// ---------- usuários fictícios por sessão ----------
const prime = await entrar(await criarUsuario('b3-prime', 'prime_atendimento'));
const outra = await entrar(await criarUsuario('b3-outra')); // cliente sem cadastro: "outra pessoa"
const porEmail = new Map(); const porClienteId = new Map(); const porDiaristaId = new Map();
async function usuarioCliente(email) {
  if (!porEmail.has(email)) porEmail.set(email, entrar(await criarUsuario(`b3-cli-${porEmail.size}`)));
  return porEmail.get(email);
}
async function usuarioDiarista(id) {
  if (!porDiaristaId.has(id)) porDiaristaId.set(id, entrar(await criarUsuario(`b3-dia-${porDiaristaId.size}`)));
  return porDiaristaId.get(id);
}
async function clientePara(s) {
  if (!s || s.ator === 'publico') return anonimo();
  if (s.ator === 'prime' || s.ator === 'sistema') return prime;
  if (s.ator === 'cliente') return porClienteId.get(s.id) || (s.usuario ? s.usuario : outra);
  if (s.ator === 'diarista') return porDiaristaId.get(s.id) || outra;
  return anonimo();
}
const base = criarAdapterSupabase({ clientePara });
// A bateria manda { ator: 'publico' } onde o mock não exige conta; no Supabase esses passos são do usuário logado.
const api = {
  ...base,
  async confirmarAutoagendamento(d, o = {}) {
    const u = await usuarioCliente(d.cliente.email);
    const r = await base.confirmarAutoagendamento(d, { ...o, sessao: { ator: 'cliente', usuario: u } });
    porClienteId.set(r.cliente.id, u);
    return r;
  },
  async salvarDocumento(d, o = {}) { await usuarioDiarista(d.diaristaId); return base.salvarDocumento(d, { ...o, sessao: { ator: 'diarista', id: d.diaristaId } }); },
  // O mock deixa várias diaristas com a mesma fixture; o banco (certo) exige CPF e e-mail únicos: um fictício por cadastro.
  async cadastrarDiarista(d, o = {}) {
    await usuarioDiarista(d.id);
    if (!identidadePorDiarista.has(d.id)) identidadePorDiarista.set(d.id, { cpf: cpfFicticio(), email: emailTeste('dia') });
    return base.cadastrarDiarista({ ...d, ...identidadePorDiarista.get(d.id) }, { ...o, sessao: { ator: 'diarista', id: d.id } });
  },
};
const identidadePorDiarista = new Map();

registrarCenarios(t, { api, contaNoBackend: true });

t.teste('corrida: duas chamadas simultâneas com a MESMA chave criam um pedido só', async () => {
  const k = chave('corrida');
  const antes = (await api.listarPedidos({}, { sessao: { ator: 'prime' } })).itens.length;
  const [a, b] = await Promise.all([criarAvulso(api, k), criarAvulso(api, k)]);
  assert.equal(a.pedido.id, b.pedido.id);
  const depois = (await api.listarPedidos({}, { sessao: { ator: 'prime' } })).itens.length;
  assert.equal(depois, antes + 1);
});

t.teste('corrida: a mesma diarista atribuída ao mesmo dia/período por duas chamadas simultâneas: só uma vence', async () => {
  const r1 = await criarAvulso(api); const r2 = await criarAvulso(api);
  const d = await criarDiaristaAprovada(api); // nova: sem diária nesse dia ainda
  const rs = await Promise.allSettled([
    api.atribuirDiarista(r1.atendimentos[0].id, { diaristaId: d }, { sessao: { ator: 'prime' }, chave: chave('x') }),
    api.atribuirDiarista(r2.atendimentos[0].id, { diaristaId: d }, { sessao: { ator: 'prime' }, chave: chave('y') }),
  ]);
  const ok = rs.filter((x) => x.status === 'fulfilled').length;
  assert.equal(ok, 1, JSON.stringify(rs.map((x) => x.status === 'rejected' ? x.reason.codigo : 'ok')));
  assert.equal(rs.find((x) => x.status === 'rejected').reason.codigo, 'CONDICAO_NAO_ATENDIDA');
});

t.teste('anônimo não chama nenhuma RPC de negócio; cliente não agenda com CPF de outra pessoa', async () => {
  const pub = { sessao: { ator: 'publico' } };
  await lancaCodigo(() => base.confirmarAutoagendamento({ cliente: CLIENTE_RESIDENCIAL, pacote: {}, primeiraData: '2026-10-05', turno: 'manha' }, { ...pub, chave: chave('an') }), 'ATOR_SEM_PERMISSAO');
  await lancaCodigo(() => base.listarPedidos({}, pub), 'ATOR_SEM_PERMISSAO');
  await lancaCodigo(() => base.listarDiaristas({}, pub), 'ATOR_SEM_PERMISSAO');
  const { error } = await anonimo().rpc('listar_atendimentos', { p_filtro: {} });
  assert.ok(error, 'anon sem EXECUTE');
  // "outra" cliente logada tenta agendar com o CPF da CLIENTE_RESIDENCIAL (já cadastrado por outra conta)
  await lancaCodigo(() => base.confirmarAutoagendamento({ cliente: CLIENTE_RESIDENCIAL, pacote: { tipoServico: 'residencial', duracaoHoras: 4, metragem: 45, quantidadeDiarias: 1, frequencia: 'avulso' }, primeiraData: '2026-10-06', turno: 'manha' }, { sessao: { ator: 'cliente', id: 'outra' }, chave: chave('dup') }), 'DADOS_INVALIDOS');
});

t.teste('toda escrita deixa evento na mesma transação e auditoria com o contexto certo', async () => {
  const r = await criarAvulso(api);
  const ev = await sql(`select tipo from public.eventos where refs ->> 'pedidoId' = $1 order by seq`, [r.pedido.id]);
  assert.deepEqual(ev.map((x) => x.tipo), ['pedido_criado']);
  const [g] = await liberarCobranca(api, r);
  await api.informarPagamento(g.id, { sessao: { ator: 'cliente', id: r.cliente.id }, chave: chave('i') });
  await api.confirmarPagamento(g.id, { sessao: { ator: 'prime' }, chave: chave('c') });
  const ev2 = await sql(`select tipo from public.eventos where refs ->> 'pedidoId' = $1 order by seq`, [r.pedido.id]);
  assert.deepEqual(ev2.map((x) => x.tipo), ['pedido_criado', 'disponibilidade_confirmada', 'cobranca_emitida', 'pagamento_informado', 'pagamento_confirmado', 'atendimento_confirmado']);
  const aud = await sql(`select distinct ator_contexto from public.auditoria where tabela = 'pagamentos' and registro_id = $1 order by 1`, [g.id]);
  assert.deepEqual(aud.map((x) => x.ator_contexto), ['cliente', 'prime']);
  const audPed = await sql(`select depois ->> 'status' as st, ator_contexto from public.auditoria where tabela = 'pedidos' and registro_id = $1 and operacao = 'UPDATE' order by id`, [r.pedido.id]);
  assert.deepEqual(audPed.map((x) => `${x.st}:${x.ator_contexto}`), ['aguardando_pagamento:prime', 'confirmado:prime'], 'disponibilidade e pagamento auditados com a Prime');
  const [{ metodo, confirmado_por }] = await sql('select metodo, confirmado_por from public.pagamentos where id = $1', [g.id]);
  assert.equal(metodo, 'manual'); assert.ok(confirmado_por, 'quem confirmou fica registrado');
});

t.teste('diarista A não lê documento da diarista B nem pelo bucket; cliente não lê documento nenhum', async () => {
  const idA = [...porDiaristaId.keys()][0]; const idB = [...porDiaristaId.keys()][1];
  assert.ok(idA && idB, 'duas diaristas da bateria');
  const docsB = await api.listarDocumentos(idB, { sessao: { ator: 'prime' } });
  const doc = docsB.itens[0];
  await lancaCodigo(() => api.obterArquivo(doc.id, { sessao: { ator: 'diarista', id: idA } }), 'NAO_ENCONTRADO');
  const sA = await porDiaristaId.get(idA);
  const { data, error } = await sA.storage.from('documentos-diaristas').createSignedUrl(doc.blobRef, 60);
  assert.ok(error || !data, 'bucket não assina pra quem não é dona');
  const cli = await porEmail.get(CLIENTE_RESIDENCIAL.email);
  const r2 = await cli.storage.from('documentos-diaristas').list(`diaristas/${idB}`);
  assert.ok(!r2.data?.length, 'cliente não lista o bucket');
  const ok = await api.obterArquivo(doc.id, { sessao: { ator: 'prime' } });
  assert.ok(ok.conteudo.size > 0, 'Prime lê por URL assinada');
});

const falhas = await t.fim();
console.log(`# limpeza: ${await limparFicticios({ soEstaExecucao: true })} usuários fictícios removidos`);
await fecharSql();
process.exit(falhas ? 1 : 0);
