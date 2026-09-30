// P3 (bloco 3) CONTRA A HOMOLOGAÇÃO, só fictícios: hora extra (profissional registra no check-out, Prime aprova, nasce
// a cobrança e o C14), recibo com número sequencial sem buraco (inclusive com confirmações simultâneas e rollback),
// prazo vencido (liberar a vaga, dar mais prazo, liberação automática atrás da flag desligada).
// Uso: bash scripts/cli.sh node22 scripts/testa-pagamentos-p3.mjs
import { criarSuite, assert } from './lib-teste.mjs';
import { sql, transacao, fecharSql, limparFicticios, entrar, criarUsuario, cpfFicticio } from './lib-supabase.mjs';
import { montarApiDeTeste } from './lib-api-teste.mjs';
import { agendar, chave, liberarCobranca, levarAteFinalizado } from './cenarios.mjs';
import { CLIENTE_RESIDENCIAL, proximaDataPermitida } from './fixtures/seed.js';
import { CONFIG_PRECOS } from '../src/config/precos.js';
import { dataNoFuso, somarDias } from '../src/domain/calendario.js';
import { criarPortaPg } from '../supabase/functions/_shared/porta-pg.js';
import { criarProvedores } from '../supabase/functions/_shared/provedores.js';
import { tique } from '../src/automacoes/v2/motor.js';

const t = criarSuite('P3 pagamentos sem trabalho manual (homologação)');
await limparFicticios();
const PRIME = { ator: 'prime' };
const { api, porDiaristaId } = await montarApiDeTeste('p3');
const falha = async (p, codigo) => { try { await p; } catch (e) { assert.equal(e.codigo, codigo, e.message); return e; } assert.fail(`esperava ${codigo}`); };
const HOJE = dataNoFuso(new Date().toISOString());
let D = proximaDataPermitida(somarDias(HOJE, 10), 1, CONFIG_PRECOS);
while ([0, 6].includes(new Date(`${D}T12:00:00Z`).getUTCDay()) || CONFIG_PRECOS.feriados.includes(D)) D = somarDias(D, 1);
/** n-ésimo dia útil (seg a sex, sem feriado) depois de D: nenhuma data do teste cai em domingo. */
const util = (n) => { let d = D; for (let i = 0; i < n;) { d = somarDias(d, 1); if (![0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay()) && !CONFIG_PRECOS.feriados.includes(d)) i++; } return d; };
const solicitar = (cliente = CLIENTE_RESIDENCIAL, data = D) => agendar(api, { cliente, pacote: { tipoServico: 'residencial', duracaoHoras: 4, metragem: 45, quantidadeDiarias: 1, frequencia: 'avulso' }, primeiraData: data, turno: 'manha' }, chave('p3'));

const uDia = await criarUsuario('p3-dia', 'diarista');
const [{ id: DIA }] = await sql(`insert into public.diaristas (usuario_id, nome, cpf, telefone, email, data_nascimento, identidade, status, aceite_termos_em, disponibilidade, ficticio)
  values ($1, 'Dora Teste P3', $2, '31955554444', $3, '1985-04-12', 'cnh', 'aprovada', now(), '{"dias":[1,2,3,4,5,6],"turnos":["integral"],"regioes":["BH - Centro-Sul"]}', true) returning id`, [uDia.id, cpfFicticio(), uDia.email]);
porDiaristaId.set(DIA, entrar(uDia));
const SD = { ator: 'diarista', id: DIA };

// ---------- hora extra
const r = await solicitar();
const AT = r.atendimentos[0].id;
let HE;

t.teste('hora extra: só a profissional da diária, só no check-out, de 1 a 4 horas, uma por diária', async () => {
  await liberarCobranca(api, r);
  await api.atribuirDiarista(AT, { diaristaId: DIA }, { sessao: PRIME, chave: chave('atr') });
  await falha(api.registrarHoraExtra(AT, { horas: 1 }, { sessao: SD, chave: chave('he') }), 'CONDICAO_NAO_ATENDIDA'); // antes do check-out
  await levarAteFinalizado(api, r, DIA, AT);
  await falha(api.registrarHoraExtra(AT, { horas: 1 }, { sessao: PRIME, chave: chave('he') }), 'ATOR_SEM_PERMISSAO');
  await falha(api.registrarHoraExtra(AT, { horas: 0 }, { sessao: SD, chave: chave('he') }), 'DADOS_INVALIDOS');
  await falha(api.registrarHoraExtra(AT, { horas: 5 }, { sessao: SD, chave: chave('he') }), 'DADOS_INVALIDOS');
  const k = chave('he');
  const x = await api.registrarHoraExtra(AT, { horas: 2, observacao: 'cozinha pesada' }, { sessao: SD, chave: k });
  const y = await api.registrarHoraExtra(AT, { horas: 2, observacao: 'cozinha pesada' }, { sessao: SD, chave: k });
  assert.equal(x.horaExtra.id, y.horaExtra.id, 'mesma chave, mesmo registro');
  await falha(api.registrarHoraExtra(AT, { horas: 1 }, { sessao: SD, chave: chave('he') }), 'CONDICAO_NAO_ATENDIDA');
  HE = x.horaExtra.id;
  const outra = await entrar(await criarUsuario('p3-outra-dia', 'diarista'));
  assert.deepEqual((await outra.from('horas_extras').select('id')).data, [], 'outra profissional não lê');
});

t.teste('Prime aprova: cobrança de 2 x R$ 30 com vencimento em 2 dias, evento pro C14; a mensagem sai com horas, valor e link', async () => {
  await falha(api.decidirHoraExtra(HE, { aprovar: false }, { sessao: PRIME, chave: chave('dec') }), 'DADOS_INVALIDOS'); // recusar sem motivo
  const d = await api.decidirHoraExtra(HE, { aprovar: true }, { sessao: PRIME, chave: chave('dec') });
  assert.equal(d.horaExtra.status, 'aprovada');
  assert.equal(d.pagamento.parcela, 'hora_extra');
  assert.equal(d.pagamento.valorCentavos, 2 * CONFIG_PRECOS.PRECOS.horaExtraCentavos);
  assert.equal(d.pagamento.venceEm, somarDias(HOJE, 2));
  await falha(api.decidirHoraExtra(HE, { aprovar: true }, { sessao: PRIME, chave: chave('dec') }), 'TRANSICAO_PROIBIDA');
  const porta = criarPortaPg({ transacao: (fn) => transacao(fn), urlSite: 'https://turno-2026-09-28.prime-limpeza.pages.dev/' });
  const provedores = criarProvedores({ ambiente: 'homologacao', fetch });
  let msg;
  for (let i = 0; i < 8 && !msg; i++) {
    // amanhã às 11h de Brasília: fora do horário silencioso, seja qual for a hora em que o teste roda
    await tique({ porta, provedores, agoraISO: `${somarDias(HOJE, 1)}T14:00:00.000Z`, ambiente: provedores.ambiente, escopo: [r.pedido.id] });
    [msg] = await sql(`select m.conteudo from public.automacao_execucoes e join public.mensagens m on m.execucao_id = e.id where e.regra = 'C14' and e.contexto ->> 'atendimentoId' = $1`, [AT]);
    if (!msg) await new Promise((ok) => setTimeout(ok, 1500));
  }
  assert.ok(msg, `C14 enviado (simulado): ${JSON.stringify(await sql(`select regra, estado, motivo from public.automacao_execucoes where contexto ->> 'atendimentoId' = $1 order by criado_em`, [AT]))} eventos ${JSON.stringify(await sql(`select tipo, status, erro from public.eventos where refs ->> 'atendimentoId' = $1 order by seq`, [AT]))}`);
  assert.match(msg.conteudo, /2 horas/);
  assert.match(msg.conteudo, /R\$ 60,00/);
  assert.match(msg.conteudo, new RegExp(`pagamento/\\?pagamento=${d.pagamento.id}`));
  // a cliente vê e paga como as outras cobranças
  const pg = await api.obterPagamento(d.pagamento.id, { sessao: { ator: 'cliente', id: r.cliente.id } });
  assert.equal(pg.elegibilidade.pagavel, true);
  await api.confirmarPagamento(d.pagamento.id, { sessao: PRIME, chave: chave('conf') });
  const rec = await api.obterRecibo(d.pagamento.id, { sessao: { ator: 'cliente', id: r.cliente.id } });
  assert.match(rec.referente, /^Hora extra da diária de /);
  assert.equal(rec.valorCentavos, 6000);
});

t.teste('recusa com motivo; flag desligada impede registrar', async () => {
  const r2 = await solicitar(CLIENTE_RESIDENCIAL, util(1));
  await levarAteFinalizado(api, r2, DIA, r2.atendimentos[0].id);
  const x = await api.registrarHoraExtra(r2.atendimentos[0].id, { horas: 1 }, { sessao: SD, chave: chave('he') });
  const d = await api.decidirHoraExtra(x.horaExtra.id, { aprovar: false, motivo: 'combinado no pacote' }, { sessao: PRIME, chave: chave('dec') });
  assert.equal(d.horaExtra.status, 'recusada');
  assert.ok(!d.pagamento, 'recusa sem cobrança');
  await sql(`update public.config_flags set ligada = false where chave = 'p3_hora_extra'`);
  try { await falha(api.registrarHoraExtra(r2.atendimentos[0].id, { horas: 1 }, { sessao: SD, chave: chave('he') }), 'CONDICAO_NAO_ATENDIDA'); }
  finally { await sql(`update public.config_flags set ligada = true where chave = 'p3_hora_extra'`); }
});

// ---------- recibos
t.teste('recibo: número na confirmação; confirmações simultâneas e rollback não deixam buraco nem repetem', async () => {
  const pedidos = [];
  const dias = []; for (let d = somarDias(D, 2); dias.length < 5; d = somarDias(d, 1)) if (new Date(`${d}T12:00:00Z`).getUTCDay() !== 0 && !CONFIG_PRECOS.feriados.includes(d)) dias.push(d);
  for (const d of dias) pedidos.push(await solicitar(CLIENTE_RESIDENCIAL, d));
  const pags = [];
  for (const p of pedidos) pags.push(...(await liberarCobranca(api, p)));
  // rollback de uma confirmação: o número volta
  const [{ antes }] = await sql('select ultimo antes from privado.recibos_contador');
  await transacao(async (q) => {
    await q(`update public.pagamentos set status = 'confirmado', confirmado_em = now() where id = $1`, [pags[0].id]);
    throw new Error('desfaz');
  }).catch(() => {});
  assert.equal((await sql('select ultimo from privado.recibos_contador'))[0].ultimo, antes);
  await Promise.all(pags.map((g) => api.confirmarPagamento(g.id, { sessao: PRIME, chave: chave('conf') })));
  const nums = (await sql('select numero from public.recibos where pagamento_id = any($1::uuid[]) order by numero', [pags.map((g) => g.id)])).map((x) => x.numero);
  assert.equal(nums.length, 5);
  assert.deepEqual(nums, Array.from({ length: 5 }, (_, i) => nums[0] + i), 'sequência contínua');
  const [{ buracos }] = await sql('select (max(numero) - min(numero) + 1 - count(*))::int buracos from public.recibos');
  assert.equal(buracos, 0, 'sem buraco em toda a numeração');
  const [{ ultimo }] = await sql('select ultimo from privado.recibos_contador');
  assert.equal(ultimo, (await sql('select max(numero)::int m from public.recibos'))[0].m);
});

t.teste('recibo: cliente dona e Prime leem; outra cliente não; tabela fechada pra leitura direta; estorno aparece', async () => {
  const [g] = (await api.obterPedido(r.pedido.id, { sessao: PRIME })).pagamentos.filter((x) => x.parcela === 'diaria');
  const dona = await api.obterRecibo(g.id, { sessao: { ator: 'cliente', id: r.cliente.id } });
  assert.equal(dona.situacao, 'confirmado');
  assert.match(dona.referente, /^Diária de limpeza de .*, das 08:00 às 12:00$/);
  assert.equal((await api.obterRecibo(g.id, { sessao: PRIME })).numero, dona.numero);
  await falha(api.obterRecibo(g.id, { sessao: { ator: 'cliente', id: '00000000-0000-4000-8000-000000000000' } }), 'NAO_ENCONTRADO');
  const adm = await entrar(await criarUsuario('p3-adm', 'prime_admin'));
  const { error } = await adm.from('recibos').select('numero').limit(1);
  assert.ok(error, 'recibos só pela RPC');
  await api.registrarEstorno(g.id, { motivo: 'teste de estorno' }, { sessao: PRIME, chave: chave('est') });
  const est = await api.obterRecibo(g.id, { sessao: PRIME });
  assert.equal(est.situacao, 'estornado');
  assert.equal(est.numero, dona.numero, 'estorno não muda o número');
});

// ---------- prazo vencido
t.teste('prazo vencido: liberar antes de vencer recusa; vencido cancela a diária e a cobrança', async () => {
  const x = await solicitar(CLIENTE_RESIDENCIAL, util(8));
  const [g] = await liberarCobranca(api, x);
  await falha(api.liberarVaga(g.id, { sessao: PRIME, chave: chave('lib') }), 'CONDICAO_NAO_ATENDIDA');
  await sql(`update public.pagamentos set vence_em = current_date - 1 where id = $1`, [g.id]);
  await falha(api.liberarVaga(g.id, { sessao: { ator: 'cliente', id: x.cliente.id }, chave: chave('lib') }), 'ATOR_SEM_PERMISSAO');
  const k = chave('lib');
  const rl = await api.liberarVaga(g.id, { sessao: PRIME, chave: k });
  assert.equal(rl.atendimento.status, 'cancelado');
  const rl2 = await api.liberarVaga(g.id, { sessao: PRIME, chave: k });
  const dif = (a, b, c = '') => (JSON.stringify(a) === JSON.stringify(b) ? [] : a && b && typeof a === 'object' ? Object.keys({ ...a, ...b }).flatMap((k) => dif(a[k], b[k], `${c}.${k}`)) : [`${c}: ${JSON.stringify(a)} x ${JSON.stringify(b)}`]);
  assert.equal(rl2._repetido, true);
  delete rl2._repetido;
  assert.deepEqual(dif(rl2, rl), [], `mesma chave, mesmo resultado: ${dif(rl2, rl).join(' | ').slice(0, 600)}`);
  const [pg] = await sql('select status from public.pagamentos where id = $1', [g.id]);
  assert.equal(pg.status, 'cancelado');
});

t.teste('dar mais prazo: no futuro e antes da diária; move o vencimento e gera o evento', async () => {
  const x = await solicitar(CLIENTE_RESIDENCIAL, util(9));
  const [g] = await liberarCobranca(api, x);
  await falha(api.prorrogarPrazo(g.id, { venceEm: somarDias(HOJE, -1) }, { sessao: PRIME, chave: chave('pr') }), 'DADOS_INVALIDOS');
  await falha(api.prorrogarPrazo(g.id, { venceEm: somarDias(util(9), 1), venceAs: '14:00' }, { sessao: PRIME, chave: chave('pr') }), 'DADOS_INVALIDOS');
  const novo = somarDias(HOJE, 3);
  const p = await api.prorrogarPrazo(g.id, { venceEm: novo, venceAs: '18:00' }, { sessao: PRIME, chave: chave('pr') });
  assert.equal(p.pagamento.venceEm, novo);
  assert.equal(p.pagamento.venceAs, '18:00');
  assert.equal((await sql(`select count(*)::int n from public.eventos where tipo = 'prazo_prorrogado' and refs ->> 'pagamentoId' = $1`, [g.id]))[0].n, 1);
});

t.teste('liberação automática: com a flag desligada não faz nada; ligada, cancela os vencidos', async () => {
  const x = await solicitar(CLIENTE_RESIDENCIAL, util(11));
  const [g] = await liberarCobranca(api, x);
  await sql(`update public.pagamentos set vence_em = current_date - 1 where id = $1`, [g.id]);
  assert.equal((await sql('select privado.liberar_vencidos() n'))[0].n, 0);
  assert.equal((await sql('select status from public.pagamentos where id = $1', [g.id]))[0].status, 'pendente');
  // ligada só dentro de uma transação desfeita (não libera vaga de mais ninguém no homolog)
  await transacao(async (q) => {
    await q(`update public.config_flags set ligada = true where chave = 'p3_liberacao_automatica'`);
    await q(`update public.pagamentos set status = 'cancelado' where status = 'pendente' and parcela = 'diaria' and id <> $1 and privado.prazo_vencido(pagamentos)`, [g.id]);
    const [{ n }] = await q('select privado.liberar_vencidos() n');
    assert.equal(n, 1);
    const [a] = await q('select a.status from public.atendimentos a join public.pagamentos p on p.atendimento_id = a.id where p.id = $1', [g.id]);
    assert.equal(a.status, 'cancelado');
    throw new Error('desfaz');
  }).catch((e) => { if (e.message !== 'desfaz') throw e; });
  assert.equal((await sql(`select ligada from public.config_flags where chave = 'p3_liberacao_automatica'`))[0].ligada, false);
});

await t.fim();
await limparFicticios({ soEstaExecucao: true });
await fecharSql();
