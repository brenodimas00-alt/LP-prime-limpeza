// P2 (bloco 3) CONTRA A HOMOLOGAÇÃO, só fictícios: disponibilidade, bloqueios (férias/folga), conflito na atribuição
// (sobreposição e bloqueio impedem; fora do dia/turno/região pede confirmação), remarcação que respeita férias,
// sugestão ordenada (livre, região, disponível, carga da semana), agenda por profissional e RLS dos bloqueios.
// Uso: bash scripts/cli.sh node22 scripts/testa-agenda-p2.mjs
import { criarSuite, assert } from './lib-teste.mjs';
import { sql, fecharSql, limparFicticios, entrar, criarUsuario, cpfFicticio } from './lib-supabase.mjs';
import { montarApiDeTeste } from './lib-api-teste.mjs';
import { agendar, chave } from './cenarios.mjs';
import { CLIENTE_RESIDENCIAL, proximaDataPermitida } from './fixtures/seed.js';
import { CONFIG_PRECOS } from '../src/config/precos.js';
import { dataNoFuso, somarDias } from '../src/domain/calendario.js';

const t = criarSuite('P2 agenda e disponibilidade (homologação)');
await limparFicticios();
const PRIME = { ator: 'prime' };
const { api } = await montarApiDeTeste('p2', { avisarDisponibilidade: true });
const falha = async (p, codigo) => { try { await p; } catch (e) { assert.equal(e.codigo, codigo, e.message); return e; } assert.fail(`esperava ${codigo}`); };

// quarta-feira útil daqui a ~3 semanas (dia 3 da semana)
let D = proximaDataPermitida(somarDias(dataNoFuso(new Date().toISOString()), 18), 1, CONFIG_PRECOS);
while (new Date(`${D}T12:00:00Z`).getUTCDay() !== 3 || CONFIG_PRECOS.feriados.includes(D)) D = somarDias(D, 1);
const TUDO = { dias: [1, 2, 3, 4, 5, 6], turnos: ['integral'], regioes: ['BH - Centro-Sul'] };
async function diarista(nome, disp = TUDO) {
  const u = await criarUsuario(`p2-${nome.toLowerCase()}`, 'diarista');
  const [r] = await sql(`insert into public.diaristas (usuario_id, nome, cpf, telefone, email, data_nascimento, identidade, status, aceite_termos_em, disponibilidade, ficticio)
    values ($1, $2, $3, '31955554444', $4, '1985-04-12', 'cnh', 'aprovada', now(), $5::jsonb, true) returning id`, [u.id, `${nome} Teste P2`, cpfFicticio(), u.email, JSON.stringify(disp)]);
  return { id: r.id, u };
}
const solicitar = async (data = D) => agendar(api, { cliente: CLIENTE_RESIDENCIAL, pacote: { tipoServico: 'residencial', duracaoHoras: 4, metragem: 45, quantidadeDiarias: 1, frequencia: 'avulso' }, primeiraData: data, turno: 'manha' }, chave('p2'));
const atribuir = (atId, diaristaId, extra = {}) => api.atribuirDiarista(atId, { diaristaId, ...extra }, { sessao: PRIME, chave: chave('atr') });

const A = await diarista('Ana');
const A2 = await diarista('Alice');
const B = await diarista('Bruna', { dias: [6], turnos: ['tarde'], regioes: ['Contagem'] });
const C = await diarista('Carla');
const E = await diarista('Eva');
const r = await solicitar();
const at = r.atendimentos[0].id;
// Eva já tem diária no mesmo horário; Alice tem duas na semana (carga)
const outra = await solicitar();
await atribuir(outra.atendimentos[0].id, E.id);
for (const dd of [somarDias(D, 1), somarDias(D, 2)]) { const x = await solicitar(dd); await atribuir(x.atendimentos[0].id, A2.id); }

t.teste('lista de regiões da profissional no banco = src/config/precos.js', async () => {
  const [{ valor }] = await sql(`select valor from public.configuracao where chave = 'regioes_diarista'`);
  assert.deepEqual(valor, CONFIG_PRECOS.regioesDiarista);
});

t.teste('disponibilidade: Prime edita com dias, turnos e regiões válidos; inválido recusa; cliente não pode', async () => {
  const d = await api.definirDisponibilidade(C.id, { dias: [1, 3], turnos: ['manha'], regioes: ['BH - Centro-Sul', 'Contagem'] }, { sessao: PRIME });
  assert.deepEqual(d.disponibilidade, { dias: [1, 3], turnos: ['manha'], regioes: ['BH - Centro-Sul', 'Contagem'] });
  await falha(api.definirDisponibilidade(C.id, { dias: [7], turnos: ['manha'], regioes: ['Contagem'] }, { sessao: PRIME }), 'DADOS_INVALIDOS');
  await falha(api.definirDisponibilidade(C.id, { dias: [1], turnos: ['noite'], regioes: ['Contagem'] }, { sessao: PRIME }), 'DADOS_INVALIDOS');
  await falha(api.definirDisponibilidade(C.id, { dias: [1], turnos: ['manha'], regioes: ['Marte'] }, { sessao: PRIME }), 'DADOS_INVALIDOS');
  await falha(api.definirDisponibilidade(C.id, { dias: [1], turnos: ['manha'], regioes: [] }, { sessao: PRIME }), 'DADOS_INVALIDOS');
  await falha(api.definirDisponibilidade(C.id, TUDO, { sessao: { ator: 'cliente', id: r.cliente.id } }), 'ATOR_SEM_PERMISSAO');
  await api.definirDisponibilidade(C.id, TUDO, { sessao: PRIME });
});

t.teste('fora do dia, do turno e da região: pede confirmação; com "mesmo assim" atribui e devolve os avisos', async () => {
  const e = await falha(atribuir(at, B.id), 'CONDICAO_NAO_ATENDIDA');
  assert.deepEqual(e.detalhes.avisos.map((x) => x.tipo).sort(), ['dia', 'regiao', 'turno']);
  assert.match(e.message, /Confirme pra atribuir mesmo assim/);
  const ok = await atribuir(at, B.id, { atribuirMesmoAssim: true });
  assert.equal(ok.atendimento.diaristaId, B.id);
  assert.equal(ok.avisos.length, 3);
});

t.teste('sobreposição impede sempre (mesmo com "mesmo assim" e com a flag desligada)', async () => {
  const e = await falha(atribuir(at, E.id, { atribuirMesmoAssim: true }), 'CONDICAO_NAO_ATENDIDA');
  assert.equal(e.detalhes.conflitos[0].tipo, 'sobreposicao');
  await sql(`update public.config_flags set ligada = false where chave = 'p2_disponibilidade'`);
  try { await falha(atribuir(at, E.id), 'CONDICAO_NAO_ATENDIDA'); } finally { await sql(`update public.config_flags set ligada = true where chave = 'p2_disponibilidade'`); }
});

t.teste('férias impedem atribuir; criar o período conta as diárias dela que caem nele; remover libera', async () => {
  const b = await api.criarBloqueio(C.id, { de: somarDias(D, -2), ate: somarDias(D, 3), motivo: 'ferias', observacao: 'viagem' }, { sessao: PRIME });
  assert.equal(b.diariasNoPeriodo, 0);
  const e = await falha(atribuir(at, C.id, { atribuirMesmoAssim: true }), 'CONDICAO_NAO_ATENDIDA');
  assert.match(e.message, /férias/i);
  await falha(api.criarBloqueio(C.id, { de: D, ate: somarDias(D, -1), motivo: 'ferias' }, { sessao: PRIME }), 'DADOS_INVALIDOS');
  await falha(api.criarBloqueio(C.id, { de: D, ate: D, motivo: 'passeio' }, { sessao: PRIME }), 'DADOS_INVALIDOS');
  // folga da Alice na semana: as duas diárias dela aparecem na contagem
  const f = await api.criarBloqueio(A2.id, { de: somarDias(D, 1), ate: somarDias(D, 2), motivo: 'folga' }, { sessao: PRIME });
  assert.equal(f.diariasNoPeriodo, 2);
  await api.removerBloqueio(f.id, { sessao: PRIME });
  // com a flag desligada o bloqueio não vale (a sobreposição sim)
  await sql(`update public.config_flags set ligada = false where chave = 'p2_disponibilidade'`);
  try { assert.deepEqual(await api.conflitosAtendimento(at, { diaristaId: C.id }, { sessao: PRIME }), []); } finally { await sql(`update public.config_flags set ligada = true where chave = 'p2_disponibilidade'`); }
  await api.removerBloqueio(b.id, { sessao: PRIME });
  await falha(api.removerBloqueio(b.id, { sessao: PRIME }), 'NAO_ENCONTRADO');
  assert.equal((await atribuir(at, C.id)).atendimento.diaristaId, C.id);
});

t.teste('remarcar pra um dia de férias da profissional atribuída é recusado; pra outro dia remarca e gera o evento', async () => {
  const b = await api.criarBloqueio(C.id, { de: somarDias(D, 7), ate: somarDias(D, 7), motivo: 'folga' }, { sessao: PRIME });
  await falha(api.transicionarAtendimento(at, { evento: 'reagendar', dados: { data: somarDias(D, 7), horaInicio: '08:00' } }, { sessao: PRIME, chave: chave('rea') }), 'CONDICAO_NAO_ATENDIDA');
  const novo = somarDias(D, 1);
  const x = await api.transicionarAtendimento(at, { evento: 'reagendar', dados: { data: novo, horaInicio: '09:00' } }, { sessao: PRIME, chave: chave('rea') });
  assert.equal(x.atendimento.data, novo);
  const [ev] = await sql(`select count(*)::int n from public.eventos where tipo = 'atendimento_reagendado' and refs ->> 'atendimentoId' = $1`, [at]);
  assert.equal(ev.n, 1);
  await api.removerBloqueio(b.id, { sessao: PRIME });
  await api.transicionarAtendimento(at, { evento: 'reagendar', dados: { data: D, horaInicio: '08:00' } }, { sessao: PRIME, chave: chave('rea') });
});

t.teste('sugestão: livres primeiro, depois região, disponibilidade e menor carga da semana; ocupada por último', async () => {
  const lista = await api.sugerirProfissionais(at, { sessao: PRIME });
  const minhas = lista.filter((s) => [A.id, A2.id, B.id, C.id, E.id].includes(s.id));
  const ordem = minhas.map((s) => s.id);
  assert.ok(ordem.indexOf(A.id) < ordem.indexOf(A2.id), 'mesma disponibilidade: menor carga primeiro');
  assert.ok(ordem.indexOf(A2.id) < ordem.indexOf(B.id), 'fora da região e do dia depois');
  assert.equal(ordem.at(-1), E.id, 'ocupada por último');
  const a2 = minhas.find((s) => s.id === A2.id);
  assert.equal(a2.cargaSemana, 2);
  assert.deepEqual([minhas.find((s) => s.id === B.id).regiao, minhas.find((s) => s.id === B.id).disponivel], [false, false]);
  assert.equal(minhas.find((s) => s.id === C.id).atual, true);
  await falha(api.sugerirProfissionais(at, { sessao: { ator: 'cliente', id: r.cliente.id } }), 'ATOR_SEM_PERMISSAO');
});

t.teste('agenda por profissional: diária na linha da profissional, bloqueio no período, até 31 dias, só a Prime', async () => {
  const b = await api.criarBloqueio(A.id, { de: somarDias(D, 3), ate: somarDias(D, 20), motivo: 'ferias' }, { sessao: PRIME });
  const ag = await api.agendaProfissionais({ de: D, ate: somarDias(D, 6) }, { sessao: PRIME });
  const minha = ag.diarias.find((x) => x.id === at);
  assert.equal(minha.diaristaId, C.id);
  assert.equal(minha.horaInicio, '08:00');
  assert.equal(minha.duracaoMinutos, 240);
  assert.equal(minha.cliente, CLIENTE_RESIDENCIAL.nome.split(' ')[0]);
  assert.equal(ag.profissionais.find((p) => p.id === A.id).bloqueios.length, 1);
  await falha(api.agendaProfissionais({ de: D, ate: somarDias(D, 40) }, { sessao: PRIME }), 'DADOS_INVALIDOS');
  await falha(api.agendaProfissionais({ de: D, ate: D }, { sessao: { ator: 'cliente', id: r.cliente.id } }), 'ATOR_SEM_PERMISSAO');
  await api.removerBloqueio(b.id, { sessao: PRIME });
});

t.teste('RLS dos bloqueios: a profissional lê só os dela; cliente nada; ninguém escreve direto', async () => {
  const b = await api.criarBloqueio(A.id, { de: somarDias(D, 30), ate: somarDias(D, 31), motivo: 'folga' }, { sessao: PRIME });
  await api.criarBloqueio(E.id, { de: somarDias(D, 30), ate: somarDias(D, 31), motivo: 'folga' }, { sessao: PRIME });
  const ana = await entrar(A.u);
  const { data } = await ana.from('bloqueios_profissional').select('id, diarista_id');
  assert.deepEqual(data.map((x) => x.diarista_id), [A.id]);
  const cli = await entrar(await criarUsuario('p2-cli'));
  assert.deepEqual((await cli.from('bloqueios_profissional').select('id')).data, []);
  const { error } = await ana.from('bloqueios_profissional').insert({ diarista_id: A.id, de: D, ate: D, motivo: 'folga' });
  assert.ok(error, 'insert direto negado');
  const [{ n }] = await sql(`select count(*)::int n from public.auditoria where tabela = 'bloqueios_profissional' and registro_id = $1`, [b.id]);
  assert.equal(n, 1, 'criação auditada');
});

await t.fim();
await sql('delete from public.bloqueios_profissional where diarista_id in (select id from public.diaristas where ficticio and nome like $1)', ['% Teste P2']);
await limparFicticios({ soEstaExecucao: true });
await fecharSql();
