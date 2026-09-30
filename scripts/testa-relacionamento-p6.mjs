// P6 (bloco 3) CONTRA A HOMOLOGAÇÃO, só fictícios: listas de renovação e reativação (com consentimento), dados do link
// de renovação (só a dona, mesmas datas no mês seguinte), exportações (só admin, mascaradas por padrão, completa só
// pedida, auditadas, limite por hora). Nenhum dado real é impresso nem pedido sem máscara.
// Uso: bash scripts/cli.sh node22 scripts/testa-relacionamento-p6.mjs
import { criarSuite, assert } from './lib-teste.mjs';
import { sql, transacao, fecharSql, limparFicticios, entrar, criarUsuario, cpfFicticio } from './lib-supabase.mjs';
import { montarApiDeTeste } from './lib-api-teste.mjs';
import { agendar, chave, liberarCobranca } from './cenarios.mjs';
import { CLIENTE_RESIDENCIAL, proximaDataPermitida } from './fixtures/seed.js';
import { CONFIG_PRECOS } from '../src/config/precos.js';
import { dataNoFuso, somarDias } from '../src/domain/calendario.js';

const t = criarSuite('P6 relacionamento e exportações (homologação)');
await limparFicticios();
const PRIME = { ator: 'prime' };
const { api, porEmail } = await montarApiDeTeste('p6');
const falha = async (p, codigo) => { try { await p; } catch (e) { assert.equal(e.codigo, codigo, e.message); return e; } assert.fail(`esperava ${codigo}`); };
const rpc = async (c, nome, args = {}) => { const { data, error } = await c.rpc(nome, args); if (error) throw Object.assign(new Error(error.details || error.message), { codigo: error.message }); return data; };
const HOJE = dataNoFuso(new Date().toISOString());
const MES = HOJE.slice(0, 7);
const admin = await entrar(await criarUsuario('p6-adm', 'prime_admin'));
const atend = await entrar(await criarUsuario('p6-atend', 'prime_atendimento'));
let D = proximaDataPermitida(somarDias(HOJE, 10), 1, CONFIG_PRECOS);
while ([0, 6].includes(new Date(`${D}T12:00:00Z`).getUTCDay()) || CONFIG_PRECOS.feriados.includes(D)) D = somarDias(D, 1);

async function clienteCom(rotulo, { frequencia = 'semanal', quantidade = 4 } = {}) {
  const u = await criarUsuario(`p6-${rotulo}`);
  porEmail.set(u.email, entrar(u));
  const cliente = { ...CLIENTE_RESIDENCIAL, email: u.email, cpf: cpfFicticio() };
  const r = await agendar(api, { cliente, pacote: { tipoServico: 'residencial', duracaoHoras: 4, metragem: 45, quantidadeDiarias: quantidade, frequencia }, primeiraData: D, turno: 'manha' }, chave('p6'));
  return { u, r, sessao: { ator: 'cliente', id: r.cliente.id } };
}

const pacote = await clienteCom('pacote');
await liberarCobranca(api, pacote.r);
// diárias do pacote neste mês (dias 3, 10, 17, 24 do mês), horário 09:00
for (const [i, a] of pacote.r.atendimentos.entries()) await sql(`update public.atendimentos set data = $2, hora_inicio = '09:00' where id = $1`, [a.id, `${MES}-${String(3 + 7 * i).padStart(2, '0')}`]);
await sql(`insert into public.consentimentos (user_id, titular_tipo, titular_id, tipo, concedido, canal, origem) values ($1, 'cliente', $2, 'marketing_whatsapp', true, 'site', 'minha_conta')`, [pacote.u.id, pacote.r.cliente.id]);
const sumida = await clienteCom('sumida', { frequencia: 'avulso', quantidade: 1 });
await sql(`update public.atendimentos set data = $2, status = 'finalizado' where id = $1`, [sumida.r.atendimentos[0].id, somarDias(HOJE, -70)]);
await sql(`update public.pedidos set status = 'concluido' where id = $1`, [sumida.r.pedido.id]);

t.teste('listas: renovação (pacote com diária neste mês) e reativação (70 dias sem diária), com o consentimento de cada uma', async () => {
  const l = await api.listasRelacionamento({ sessao: PRIME });
  const ren = l.renovacao.itens.find((x) => x.clienteId === pacote.r.cliente.id);
  assert.deepEqual(ren?.consentimento, { whatsapp: true, email: false });
  assert.match(ren.telefone, /\*\*\*\*-/);
  assert.ok(l.renovacao.comConsentimento >= 1);
  assert.ok(l.reativacao.itens.some((x) => x.clienteId === sumida.r.cliente.id), 'reativação');
  assert.ok(!l.reativacao.itens.some((x) => x.clienteId === pacote.r.cliente.id));
  await falha(api.listasRelacionamento({ sessao: pacote.sessao }), 'ATOR_SEM_PERMISSAO');
  // uma diária marcada pra frente tira da reativação
  const [{ ped }] = await sql(`insert into public.pedidos (cliente_id, pacote, status, total_centavos, ficticio) values ($1, '{"tipoServico":"residencial","modoPagamento":"por_diaria"}', 'aguardando_pagamento', 17500, true) returning id ped`, [sumida.r.cliente.id]);
  await sql(`insert into public.atendimentos (pedido_id, sequencia, data, hora_inicio, duracao_minutos, valor_dia_centavos) values ($1, 1, $2, '08:00', 240, 17500)`, [ped, D]);
  assert.ok(!(await api.listasRelacionamento({ sessao: PRIME })).reativacao.itens.some((x) => x.clienteId === sumida.r.cliente.id));
});

t.teste('renovação: a dona recebe o mesmo pacote com as datas no mês seguinte (domingo anda pra segunda); ninguém mais', async () => {
  const d = await api.dadosRenovacao(pacote.r.pedido.id, { sessao: pacote.sessao });
  const prox = new Date(`${MES}-01T12:00:00Z`); prox.setUTCMonth(prox.getUTCMonth() + 1);
  const m2 = prox.toISOString().slice(0, 7);
  const esperado = [3, 10, 17, 24].map((dia) => { let x = `${m2}-${String(dia).padStart(2, '0')}`; while (new Date(`${x}T12:00:00Z`).getUTCDay() === 0) x = somarDias(x, 1); return x; });
  assert.deepEqual(d.datas, esperado);
  assert.deepEqual([d.tipoServico, d.duracaoHoras, d.horario, d.tipoCliente], ['residencial', 4, '09:00', 'residencial']);
  assert.equal(d.endereco.cidade, CLIENTE_RESIDENCIAL.endereco.cidade);
  await falha(api.dadosRenovacao(pacote.r.pedido.id, { sessao: sumida.sessao }), 'NAO_ENCONTRADO');
  await falha(api.dadosRenovacao(pacote.r.pedido.id, { sessao: PRIME }), 'NAO_ENCONTRADO');
});

t.teste('exportar: só a admin; mascarado por padrão (nenhum CPF inteiro na planilha); auditado', async () => {
  await falha(rpc(atend, 'exportar', { p_tipo: 'clientes' }), 'ATOR_SEM_PERMISSAO');
  await falha(rpc(admin, 'exportar', { p_tipo: 'senhas' }), 'DADOS_INVALIDOS');
  const antes = (await sql(`select count(*)::int n from public.auditoria where tabela = 'exportacao'`))[0].n;
  const r = await rpc(admin, 'exportar', { p_tipo: 'clientes' });
  assert.equal(r.completo, false);
  const minha = r.linhas.find((x) => x.email && x.email.endsWith('@example.com') && x.nome === CLIENTE_RESIDENCIAL.nome);
  assert.ok(minha, 'cliente fictícia na planilha');
  assert.match(minha.documento, /^\*\*\*\.\d{3}\.\d{3}-\*\*$/);
  assert.match(minha.email, /^.\*\*\*@example\.com$/);
  assert.ok(r.linhas.every((x) => !/\d{11}/.test(String(x.documento || '').replace(/\D/g, '')) && !/^\d{10,11}$/.test(String(x.telefone || ''))), 'nada sem máscara');
  const [{ n: depois }] = await sql(`select count(*)::int n from public.auditoria where tabela = 'exportacao'`);
  assert.equal(depois, antes + 1);
  for (const tipo of ['pedidos', 'pagamentos']) assert.ok(Array.isArray((await rpc(admin, 'exportar', { p_tipo: tipo })).linhas));
});

t.teste('exportar completa só quando pedida (repasse fictício) e fica marcada na auditoria; limite por hora', async () => {
  const u = await criarUsuario('p6-dia', 'diarista');
  const cpf = cpfFicticio();
  const [{ id: dia }] = await sql(`insert into public.diaristas (usuario_id, nome, cpf, telefone, email, data_nascimento, identidade, status, aceite_termos_em, ficticio)
    values ($1, 'Teo Teste P6', $2, '31955554444', $3, '1985-04-12', 'cnh', 'aprovada', now(), true) returning id`, [u.id, cpf, u.email]);
  await sql(`insert into public.repasses_fechamentos (mes, regra) values ('2025-02-01', '{"tipo":"percentual","percentual":"50"}')`);
  try {
    await sql(`insert into public.repasses (mes, diarista_id, diarias, horas, horas_extras, valor_centavos) values ('2025-02-01', $1, 2, 8, 0, 17500)`, [dia]);
    const masc = (await rpc(admin, 'exportar', { p_tipo: 'repasses' })).linhas.find((x) => x.profissional === 'Teo Teste P6');
    assert.equal(masc.cpf, `***.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-**`);
    const comp = await rpc(admin, 'exportar', { p_tipo: 'repasses', p_completo: true });
    assert.equal(comp.linhas.find((x) => x.profissional === 'Teo Teste P6').cpf, cpf);
    const [a] = await sql(`select depois from public.auditoria where tabela = 'exportacao' order by id desc limit 1`);
    assert.deepEqual([a.depois.tipo, a.depois.completo], ['repasses', true]);
    const uid = (await admin.auth.getUser()).data.user.id;
    await sql(`insert into privado.limites_acao (chave) select $1 from generate_series(1, 20)`, [`exportar:${uid}`]);
    await falha(rpc(admin, 'exportar', { p_tipo: 'pedidos' }), 'CONDICAO_NAO_ATENDIDA');
  } finally {
    await transacao(async (q) => { await q(`delete from public.repasses where mes = '2025-02-01'`); await q(`delete from public.repasses_fechamentos where mes = '2025-02-01'`); }, { ator: 'limpeza_teste' });
    await sql(`delete from privado.limites_acao where chave like 'exportar:%' and em > now() - interval '1 hour' and chave = $1`, [`exportar:${(await admin.auth.getUser()).data.user.id}`]);
  }
});

await t.fim();
await limparFicticios({ soEstaExecucao: true });
await fecharSql();
