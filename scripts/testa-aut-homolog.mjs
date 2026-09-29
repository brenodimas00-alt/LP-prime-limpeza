// AUT.6 contra a HOMOLOGAÇÃO (só dados fictícios; WhatsApp e e-mail sempre simulados): semente = catálogo, motor v2
// sobre o Postgres (porta-pg) com dois workers simultâneos, resultado incerto, limite diário atômico, consentimento,
// webhook do WhatsApp (assinatura, status idempotente e sem regredir, SAIR com confirmação única), RPCs do painel
// (limites, template com variável inválida, versões, ações auditadas, modo teste, métricas) e L1 (exclusão e baixar dados).
// O worker do pg_cron também roda durante o teste: as asserções valem com os dois concorrendo.
// Uso: bash scripts/cli.sh node22 scripts/testa-aut-homolog.mjs
import { criarSuite, assert } from './lib-teste.mjs';
import { sql, transacao, fecharSql, limparFicticios, entrar, criarUsuario, cpfFicticio, aceitarTermos, ENV } from './lib-supabase.mjs';
import { montarApiDeTeste } from './lib-api-teste.mjs';
import { agendar, liberarCobranca, chave } from './cenarios.mjs';
import { CLIENTE_RESIDENCIAL } from './fixtures/seed.js';
import { REGRAS, TEMPLATES } from '../src/automacoes/catalogo.js';
import { criarPortaPg } from '../supabase/functions/_shared/porta-pg.js';
import { criarProvedores } from '../supabase/functions/_shared/provedores.js';
import { criarWebhook, assinatura } from '../supabase/functions/_shared/webhook-whatsapp.js';
import { tique, prepararEnvio, reconciliar } from '../src/automacoes/v2/motor.js';
import { proximaDataPermitida } from './fixtures/seed.js';
import { CONFIG_PRECOS } from '../src/config/precos.js';
import { dataNoFuso, somarDias } from '../src/domain/calendario.js';

const t = criarSuite('AUT motor v2 (homologação)');
await limparFicticios();
const porta = criarPortaPg({ transacao: (fn) => transacao(fn), urlSite: 'https://turno-2026-09-28.prime-limpeza.pages.dev/' });
const provedores = criarProvedores({ ambiente: 'homologacao', fetch });
const agora = () => new Date().toISOString();
const rodar = (escopo, op = {}) => tique({ porta, provedores, agoraISO: agora(), ambiente: provedores.ambiente, escopo, ...op });
const { api } = await montarApiDeTeste('aut');
const admin = await entrar(await criarUsuario('aut-admin', 'prime_admin'));
const atend = await entrar(await criarUsuario('aut-atend', 'prime_atendimento'));
const rpc = async (c, nome, args = {}) => { const { data, error } = await c.rpc(nome, args); if (error) throw Object.assign(new Error(error.details || error.message), { codigo: error.message }); return data; };
const falha = async (p, codigo) => { try { await p; } catch (e) { assert.equal(e.codigo, codigo, e.message); return e; } assert.fail(`esperava ${codigo}`); };
let D = proximaDataPermitida(somarDias(dataNoFuso(agora()), 20), 1, CONFIG_PRECOS);
while (new Date(`${D}T12:00:00Z`).getUTCDay() === 6) D = proximaDataPermitida(D, 1, CONFIG_PRECOS);
const execsDe = (campo, id) => sql(`select e.*, (select json_agg(m order by m.criado_em) from public.mensagens m where m.execucao_id = e.id) msgs
  from public.automacao_execucoes e where e.contexto ->> '${campo}' = $1 order by e.criado_em`, [id]);

t.teste('semente no banco = catálogo (regras, templates por canal, marketing desligada, RLS forçada)', async () => {
  const regras = await sql('select codigo, template_codigo, categoria, canais_ordem, gatilho, atraso, condicoes, cancelamento, ligada from public.automacao_regras order by codigo');
  assert.equal(regras.length, REGRAS.length);
  for (const r of REGRAS) {
    const b = regras.find((x) => x.codigo === r.codigo);
    assert.deepEqual([b.template_codigo, b.categoria, b.canais_ordem, b.gatilho, b.condicoes, b.cancelamento], [r.template, r.categoria, r.canais, r.gatilho, r.condicoes || {}, r.cancelamento || []], r.codigo);
  }
  assert.deepEqual(regras.filter((x) => x.categoria === 'marketing').map((x) => x.ligada), [false, false, false]);
  const tpls = await sql('select codigo, canal, corpo from public.templates where ativo');
  for (const [k, x] of Object.entries(TEMPLATES)) for (const canal of x.categoriaMeta ? ['whatsapp', 'email'] : ['painel']) {
    const b = tpls.find((y) => y.codigo === k && y.canal === canal);
    assert.ok(b, `${k}/${canal}`);
    if (!(await sql('select count(*)::int n from public.templates where codigo = $1 and canal = $2', [k, canal]))[0].n > 1) assert.equal(b.corpo, x.corpo, `${k}/${canal}`);
  }
  const semForca = await sql(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not (c.relrowsecurity and c.relforcerowsecurity)`);
  assert.deepEqual(semForca, []);
  for (const tab of ['automacao_execucoes', 'mensagens', 'templates', 'automacao_regras']) { const { error } = await admin.from(tab).select('*').limit(1); assert.ok(error, `${tab} legível direto`); }
});

t.teste('fluxo real no Postgres: solicitação -> C01 simulada pelo WhatsApp e I01 no painel; evento repetido não duplica', async () => {
  const r = await agendar(api, { cliente: CLIENTE_RESIDENCIAL, pacote: { tipoServico: 'residencial', duracaoHoras: 4, metragem: 45, quantidadeDiarias: 1, frequencia: 'avulso' }, primeiraData: D, turno: 'manha' }, chave('aut'));
  await rodar([r.pedido.id]);
  // o worker do pg_cron também roda: espera nenhuma execução do pedido estar no meio do envio
  let es;
  for (let i = 0; i < 20; i++) { es = await execsDe('pedidoId', r.pedido.id); if (!es.some((e) => e.estado === 'enviando')) break; await new Promise((x) => setTimeout(x, 500)); }
  const c01 = es.find((e) => e.regra === 'C01'); const i01 = es.find((e) => e.regra === 'I01');
  const agoraSP = new Date().toLocaleString('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' });
  if (Number(agoraSP) >= 8 && Number(agoraSP) < 20 && new Date().getUTCDay() !== 0) {
    assert.equal(c01.estado, 'enviada', JSON.stringify(es.map((e) => [e.regra, e.estado, e.motivo]))); assert.deepEqual([c01.msgs[0].canal, c01.msgs[0].estado, c01.msgs[0].provedor], ['whatsapp', 'simulada', 'simulado']);
  } else assert.equal(c01.estado, 'agendada', `horário silencioso: fica pra 8h (${JSON.stringify(es.map((e) => [e.regra, e.estado, e.motivo]))})`);
  assert.equal(i01.estado, 'enviada', JSON.stringify(es.map((e) => [e.regra, e.estado, e.motivo])));
  await sql(`update public.eventos set status = 'pendente', processado_em = null where refs ->> 'pedidoId' = $1`, [r.pedido.id]);
  await rodar([r.pedido.id]);
  assert.equal((await execsDe('pedidoId', r.pedido.id)).filter((e) => e.regra === 'C01').length, 1, 'mesma chave, uma execução');
  globalThis.pedidoAut = r;
});

t.teste('concorrência: dois workers ao mesmo tempo em 12 execuções vencidas não enviam nenhuma duas vezes', async () => {
  const [{ id: cliente }] = await sql(`select c.id from public.clientes c where c.ficticio limit 1`);
  const ids = [];
  for (let i = 0; i < 12; i++) {
    const [x] = await sql(`insert into public.automacao_execucoes (regra, template_codigo, entidade_tipo, entidade_id, marco, chave_idempotencia, destinatario, categoria, agendada_para, valida_ate, estado, contexto)
      values ('I02', 'pagamento_informado', 'teste', $1, 'x', $2, '{"tipo":"equipe","id":"equipe"}', 'interno', now() - interval '1 minute', now() + interval '1 hour', 'agendada',
              jsonb_build_object('clienteId', $3::text, 'dados', jsonb_build_object('cliente', 'Cliente Concorrência', 'valorCentavos', 100))) returning id`, [`c${i}`, `aut-conc-${chave('c')}-${i}`, cliente]);
    ids.push(x.id);
  }
  // I02 precisa de pagamento pra "oque": sem ele a renderização falha; o que importa aqui é uma mensagem (ou falha) por execução
  await Promise.all([rodar([cliente], { agenda: false }), rodar([cliente], { agenda: false })]);
  const ms = await sql('select execucao_id, count(*)::int n from public.mensagens where execucao_id = any($1::uuid[]) group by 1', [ids]);
  assert.ok(ms.every((m) => m.n === 1), JSON.stringify(ms));
  const est = await sql('select estado, count(*)::int n from public.automacao_execucoes where id = any($1::uuid[]) group by 1', [ids]);
  assert.ok(est.every((e) => ['enviada', 'falhou'].includes(e.estado)), JSON.stringify(est));
  await sql('delete from public.automacao_execucoes where id = any($1::uuid[])', [ids]);
});

t.teste('resultado incerto no Postgres: preparado e não concluído vira falhou depois de 10 min, sem mensagem nova', async () => {
  const [x] = await sql(`insert into public.automacao_execucoes (regra, template_codigo, entidade_tipo, entidade_id, marco, chave_idempotencia, destinatario, categoria, agendada_para, valida_ate, estado, contexto)
    values ('I06', 'resumo_diario', 'dia', 'teste', 'x', $1, '{"tipo":"equipe","id":"equipe"}', 'interno', now(), now() + interval '1 day', 'agendada', '{"dia":"2026-10-01"}') returning id`, [`aut-incerto-${chave('i')}`]);
  const prep = await porta.transacao(async (p) => { const [e] = (await p.agendadasDasRegras(['I06'], { clienteId: 'x' })); return e; });
  assert.equal(prep, undefined);
  await porta.transacao(async (p) => {
    const e = (await sql('select * from public.automacao_execucoes where id = $1', [x.id]))[0];
    const exec = { id: e.id, regra: e.regra, destinatario: e.destinatario, contexto: e.contexto, validaAte: new Date(e.valida_ate).toISOString(), canalIdx: 0, tentativas: 0, categoria: 'interno' };
    return prepararEnvio(p, exec, { agoraISO: agora(), ambiente: {} });
  });
  assert.equal((await sql('select estado from public.automacao_execucoes where id = $1', [x.id]))[0].estado, 'enviando');
  const futuro = new Date(Date.now() + 11 * 60000).toISOString();
  await porta.transacao((p) => reconciliar(p, { agoraISO: futuro }));
  const [e] = await sql('select estado, motivo from public.automacao_execucoes where id = $1', [x.id]);
  assert.equal(e.estado, 'falhou'); assert.match(e.motivo, /resultado incerto/);
  const ms = await sql('select estado from public.mensagens where execucao_id = $1', [x.id]);
  assert.deepEqual(ms.map((m) => m.estado), ['falhou'], 'a mensagem que parou no meio, nenhuma nova');
  await sql('delete from public.automacao_execucoes where id = $1', [x.id]);
});

t.teste('limite diário com reserva atômica: 10 reservas simultâneas com máximo 3 aprovam exatamente 3', async () => {
  const [{ id }] = await sql(`select id from public.clientes where ficticio limit 1`);
  const titular = { tipo: 'cliente', id };
  const rs = await Promise.all(Array.from({ length: 10 }, () => porta.transacao((p) => p.reservarLimite(titular, 'lembrete', '2031-01-01', 3))));
  assert.equal(rs.filter(Boolean).length, 3);
  await sql(`delete from public.automacao_limites where titular_id = $1 and dia = '2031-01-01'`, [id]);
});

t.teste('webhook: assinatura errada 401; status avança sem regredir e é idempotente; failed depois de lida é ignorado', async () => {
  const [ex] = await sql(`insert into public.automacao_execucoes (regra, template_codigo, entidade_tipo, entidade_id, marco, chave_idempotencia, destinatario, categoria, agendada_para, valida_ate, estado, contexto)
    values ('C01', 'solicitacao_recebida', 'teste', 'w', 'x', $1, '{"tipo":"teste","id":"t"}', 'atendimento', now(), now() + interval '1 hour', 'enviada', '{}') returning id`, [`aut-wh-${chave('w')}`]);
  const wamid = `wamid.teste.${chave('w')}`;
  await sql(`insert into public.mensagens (execucao_id, canal, destino, conteudo, estado, provedor, id_externo) values ($1, 'whatsapp', '31900000001', 'x', 'enviada', 'meta_cloud', $2)`, [ex.id, wamid]);
  const segredo = 'segredo-de-teste-do-app';
  const wh = criarWebhook({
    verifyToken: 'token-teste', appSecret: segredo,
    status: async (id, st, em, erro) => (await sql('select public.webhook_status($1, $2, $3::timestamptz, $4::text::jsonb) r', [id, st, em, erro ? JSON.stringify(erro) : null]))[0].r,
    mensagem: async (id, tel, texto, tipo, em) => (await sql('select public.webhook_mensagem($1, $2, $3, $4, $5::timestamptz) r', [id, tel, texto, tipo, em]))[0].r,
  });
  const verif = await wh(new Request('https://x/?hub.mode=subscribe&hub.verify_token=token-teste&hub.challenge=4242'));
  assert.deepEqual([verif.status, await verif.text()], [200, '4242']);
  assert.equal((await wh(new Request('https://x/?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=1'))).status, 403);
  const post = async (statuses, assinar = true) => {
    const corpo = JSON.stringify({ entry: [{ changes: [{ value: { statuses } }] }] });
    return wh(new Request('https://x/', { method: 'POST', body: corpo, headers: { 'x-hub-signature-256': assinar ? await assinatura(segredo, corpo) : 'sha256=00' } }));
  };
  assert.equal((await post([{ id: wamid, status: 'read', timestamp: '1790000000' }], false)).status, 401);
  const ts = Math.floor(Date.now() / 1000);
  const r1 = await (await post([{ id: wamid, status: 'delivered', timestamp: String(ts) }, { id: wamid, status: 'read', timestamp: String(ts + 5) }])).json();
  assert.deepEqual(r1.status, ['atualizado', 'atualizado']);
  const r2 = await (await post([{ id: wamid, status: 'delivered', timestamp: String(ts) }, { id: wamid, status: 'failed', timestamp: String(ts + 9), errors: [{ code: 131000, title: 'x' }] }])).json();
  assert.deepEqual(r2.status, ['repetido', 'ignorado']);
  const [m] = await sql('select estado, entregue_em is not null e, lida_em is not null l from public.mensagens where id_externo = $1', [wamid]);
  assert.deepEqual([m.estado, m.e, m.l], ['lida', true, true]);
  assert.equal((await sql('select estado from public.automacao_execucoes where id = $1', [ex.id]))[0].estado, 'lida');
  await sql('delete from public.automacao_execucoes where id = $1', [ex.id]); await sql('delete from public.mensagem_status where id_externo = $1', [wamid]);
  globalThis.webhook = { wh, segredo };
});

t.teste('SAIR revoga o marketing por WhatsApp de quem tem o telefone e manda UMA confirmação; mensagem repetida não faz nada', async () => {
  const u = await criarUsuario('aut-sair');
  let tel;
  for (;;) { tel = `3198${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`; if (!(await sql('select 1 from public.clientes where telefone = $1', [tel])).length) break; }
  const [c] = await sql(`insert into public.clientes (usuario_id, tipo, nome, email, telefone, tipo_documento, documento, origem, ficticio) values ($1, 'residencial', 'Cliente Sair Teste', $2, $3, 'cpf', $4, 'site', true) returning id`, [u.id, u.email, tel, cpfFicticio()]);
  await aceitarTermos(u.id);
  const cc = await entrar(u);
  await rpc(cc, 'definir_consentimento', { p_tipo: 'marketing_whatsapp', p_concedido: true });
  const { wh, segredo } = globalThis.webhook;
  const inbound = async (id, texto) => {
    const corpo = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id, from: `55${tel}`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: texto } }] } }] }] });
    return (await wh(new Request('https://x/', { method: 'POST', body: corpo, headers: { 'x-hub-signature-256': await assinatura(segredo, corpo) } }))).json();
  };
  const id1 = `wamid.in.${chave('s')}`;
  assert.deepEqual((await inbound(id1, ' sair ')).mensagens, ['opt_out']);
  assert.deepEqual((await inbound(id1, ' sair ')).mensagens, ['repetida']);
  assert.equal((await sql(`select privado.consentimentos_atuais('cliente', $1) ->> 'marketing_whatsapp' v`, [c.id]))[0].v, 'false');
  await rodar([c.id], { agenda: false });
  const c16 = await sql(`select e.estado, (select json_agg(m.canal) from public.mensagens m where m.execucao_id = e.id) canais from public.automacao_execucoes e where e.regra = 'C16' and e.contexto ->> 'clienteId' = $1`, [c.id]);
  assert.equal(c16.length, 1, 'confirmação única');
  assert.ok(['enviada', 'agendada'].includes(c16[0].estado));
  const id2 = `wamid.in.${chave('t')}`;
  assert.deepEqual((await inbound(id2, 'Oi, quero mudar o horário')).mensagens, ['equipe']);
  const [j] = await sql('select ultima_entrada_em from public.whatsapp_janelas where telefone = $1', [tel]);
  assert.ok(j, 'janela de 24h registrada');
  await sql('delete from public.mensagens_recebidas where id_externo = any($1::text[])', [[id1, id2]]);
  await sql('delete from public.whatsapp_janelas where telefone = $1', [tel]);
});

t.teste('painel: só admin muda regra e dentro dos limites; atendimento só vê; auditado', async () => {
  const antes = (await sql(`select atraso, versao from public.automacao_regras where codigo = 'C06'`))[0];
  await falha(rpc(atend, 'atualizar_regra_automacao', { p_codigo: 'C06', p_dados: { ligada: false } }), 'ATOR_SEM_PERMISSAO');
  await falha(rpc(admin, 'atualizar_regra_automacao', { p_codigo: 'C06', p_dados: { atraso: { hora: '23:30' } } }), 'DADOS_INVALIDOS');
  await falha(rpc(admin, 'atualizar_regra_automacao', { p_codigo: 'C06', p_dados: { atraso: { tipo: 'imediato' } } }), 'DADOS_INVALIDOS');
  await falha(rpc(admin, 'atualizar_regra_automacao', { p_codigo: 'C06', p_dados: { canais: ['whatsapp', 'sms', 'painel'] } }), 'DADOS_INVALIDOS');
  await falha(rpc(admin, 'atualizar_regra_automacao', { p_codigo: 'C06', p_dados: { template: 'x' } }), 'DADOS_INVALIDOS');
  try {
    const r = await rpc(admin, 'atualizar_regra_automacao', { p_codigo: 'C06', p_dados: { atraso: { hora: '19:00' }, canais: ['email', 'whatsapp', 'painel'] } });
    assert.equal(r.versao, antes.versao + 1);
    const lista = await rpc(atend, 'listar_regras_automacao');
    assert.deepEqual(lista.regras.find((x) => x.codigo === 'C06').canais, ['email', 'whatsapp', 'painel']);
    const [{ n }] = await sql(`select count(*)::int n from public.auditoria where tabela = 'automacao_regras' and depois ->> 'codigo' = 'C06'`);
    assert.ok(n >= 1);
  } finally {
    await sql(`update public.automacao_regras set atraso = $1::text::jsonb, canais_ordem = array['whatsapp','email','painel'], versao = $2 where codigo = 'C06'`, [JSON.stringify(antes.atraso), antes.versao]);
  }
});

t.teste('painel: template com variável inválida ou regra da Meta quebrada não salva; versão nova ativa e restaurar vira outra versão', async () => {
  const cod = 'cadastro_aprovado';
  await falha(rpc(admin, 'salvar_template', { p_codigo: cod, p_canal: 'whatsapp', p_corpo: 'Parabéns, {{cpf}}! Aprovado.' }), 'DADOS_INVALIDOS');
  await falha(rpc(admin, 'salvar_template', { p_codigo: cod, p_canal: 'whatsapp', p_corpo: '{{nome}}, seu cadastro foi aprovado na Prime.' }), 'DADOS_INVALIDOS');
  await falha(rpc(atend, 'salvar_template', { p_codigo: cod, p_canal: 'whatsapp', p_corpo: 'Parabéns, {{nome}}! Tudo certo.' }), 'ATOR_SEM_PERMISSAO');
  try {
    const v2 = await rpc(admin, 'salvar_template', { p_codigo: cod, p_canal: 'whatsapp', p_corpo: 'Parabéns, {{nome}}! Seu cadastro foi aprovado e as diárias chegam por aqui.' });
    assert.equal(v2.versao, 2);
    const volta = await rpc(admin, 'restaurar_template', { p_codigo: cod, p_canal: 'whatsapp', p_versao: 1 });
    assert.equal(volta.versao, 3);
    const hist = await rpc(atend, 'listar_templates', { p_codigo: cod });
    const wpp = hist.filter((x) => x.canal === 'whatsapp');
    assert.deepEqual(wpp.map((x) => [x.versao, x.ativo]), [[3, true], [2, false], [1, false]]);
    assert.equal(wpp[0].corpo, TEMPLATES[cod].corpo);
  } finally {
    await sql(`delete from public.templates where codigo = $1 and canal = 'whatsapp' and versao > 1`, [cod]);
    await sql(`update public.templates set ativo = true where codigo = $1 and canal = 'whatsapp' and versao = 1`, [cod]);
  }
});

t.teste('painel: cancelar, enviar agora e reenviar auditados e idempotentes; modo teste manda pro contato fictício; linha do tempo mascarada; métricas', async () => {
  const r = globalThis.pedidoAut;
  const [c01] = await sql(`select id, estado from public.automacao_execucoes where regra = 'C01' and contexto ->> 'pedidoId' = $1`, [r.pedido.id]);
  if (c01.estado === 'enviada') {
    await falha(rpc(admin, 'acao_execucao', { p_id: c01.id, p_acao: 'cancelar', p_chave: chave('ac') }), 'TRANSICAO_PROIBIDA');
  }
  const [x] = await sql(`insert into public.automacao_execucoes (regra, template_codigo, entidade_tipo, entidade_id, marco, chave_idempotencia, destinatario, categoria, agendada_para, valida_ate, estado, contexto)
    values ('I01', 'nova_solicitacao', 'pedido', $1, 'acoes', $2, '{"tipo":"equipe","id":"equipe"}', 'interno', now() + interval '1 day', now() + interval '2 days', 'agendada', jsonb_build_object('pedidoId', $1::text)) returning id`, [r.pedido.id, `aut-acao-${chave('a')}`]);
  const k = chave('ac');
  const a1 = await rpc(admin, 'acao_execucao', { p_id: x.id, p_acao: 'cancelar', p_chave: k });
  const a2 = await rpc(admin, 'acao_execucao', { p_id: x.id, p_acao: 'cancelar', p_chave: k });
  assert.deepEqual([a1.execucao.estado, a2.execucao.estado], ['cancelada', 'cancelada']);
  await falha(rpc(atend, 'acao_execucao', { p_id: x.id, p_acao: 'reenviar', p_chave: chave('ac') }), 'ATOR_SEM_PERMISSAO');
  const re = await rpc(admin, 'acao_execucao', { p_id: x.id, p_acao: 'reenviar', p_chave: chave('ac') });
  assert.equal(re.execucao.estado, 'agendada');
  await rodar([r.pedido.id], { agenda: false });
  assert.equal((await sql('select estado from public.automacao_execucoes where id = $1', [x.id]))[0].estado, 'enviada');
  const [{ n }] = await sql(`select count(*)::int n from public.auditoria where tabela = 'automacao_execucoes' and registro_id = $1`, [x.id]);
  assert.equal(n, 2, 'cancelar + reenviar (a repetição idempotente não audita de novo)');
  // modo teste
  const tst = await rpc(admin, 'testar_regra_automacao', { p_codigo: 'C06' });
  await rodar([tst.id], { agenda: false });
  const [te] = await sql('select e.estado, m.canal, m.destino, m.conteudo, m.provedor from public.automacao_execucoes e join public.mensagens m on m.execucao_id = e.id where e.id = $1', [tst.id]);
  assert.deepEqual([te.estado, te.canal, te.destino, te.provedor], ['enviada', 'whatsapp', '31900000001', 'simulado']);
  assert.match(te.conteudo, /Exemplo nome/);
  await sql('delete from public.automacao_execucoes where id = $1', [tst.id]);
  // linha do tempo e métricas
  const lt = await rpc(atend, 'listar_execucoes', { p_filtro: { pedidoId: r.pedido.id } });
  const comMsg = lt.itens.flatMap((i) => i.mensagens).filter((m) => m.canal === 'whatsapp');
  assert.ok(comMsg.every((m) => /^\(\d\d\) \*\*\*\*-\d{4}$/.test(m.destino)), JSON.stringify(comMsg.map((m) => m.destino)));
  const met = await rpc(atend, 'metricas_automacoes', {});
  assert.ok(met.porRegra.I01.enviadas >= 1);
  assert.ok('taxa' in met.pesquisa);
  await falha(rpc(await entrar(await criarUsuario('aut-cli')), 'listar_execucoes', {}), 'ATOR_SEM_PERMISSAO');
});

t.teste('L1: exclusão da titular cancela o agendado e apaga texto e destino das mensagens; "Baixar meus dados" traz as mensagens', async () => {
  const u = await criarUsuario('aut-l1');
  const [c] = await sql(`insert into public.clientes (usuario_id, tipo, nome, email, telefone, tipo_documento, documento, origem, ficticio) values ($1, 'residencial', 'Cliente L1 AUT', $2, '31900000002', 'cpf', $3, 'site', true) returning id`, [u.id, u.email, cpfFicticio()]);
  await aceitarTermos(u.id);
  const mk = async (estado, marco) => (await sql(`insert into public.automacao_execucoes (regra, template_codigo, entidade_tipo, entidade_id, marco, chave_idempotencia, destinatario, titular_tipo, titular_id, categoria, agendada_para, valida_ate, estado, contexto)
    values ('C01', 'solicitacao_recebida', 'cliente', $1, $2, $3, jsonb_build_object('tipo','cliente','id',$1::text), 'cliente', $1::uuid, 'atendimento', now() + interval '1 day', now() + interval '2 days', $4, jsonb_build_object('clienteId', $1::text)) returning id`, [c.id, marco, `aut-l1-${chave(marco)}`, estado]))[0].id;
  const enviada = await mk('enviada', 'a'); const agendada = await mk('agendada', 'b');
  await sql(`insert into public.mensagens (execucao_id, canal, destino, conteudo, estado) values ($1, 'whatsapp', '31900000002', 'Oi, Cliente! texto pessoal', 'simulada')`, [enviada]);
  const cc = await entrar(u);
  const dados = await rpc(cc, 'meus_dados');
  assert.deepEqual(dados.mensagens.map((m) => m.conteudo), ['Oi, Cliente! texto pessoal']);
  await sql('update public.clientes set anonimizado_em = now(), nome = $2 where id = $1', [c.id, 'Titular excluída']);
  assert.equal((await sql('select estado from public.automacao_execucoes where id = $1', [agendada]))[0].estado, 'cancelada');
  const [m] = await sql('select destino, conteudo from public.mensagens where execucao_id = $1', [enviada]);
  assert.deepEqual([m.destino, m.conteudo], [null, '[removido a pedido da titular]']);
});

t.teste('webhook publicado responde 503 enquanto não configurado (pronto, sem ativar)', async () => {
  const r = await fetch(`${ENV.SUPABASE_URL}/functions/v1/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1`);
  assert.equal(r.status, 503);
});

await t.fim();
console.log(`# limpeza: ${await limparFicticios({ soEstaExecucao: true })} usuários fictícios removidos`);
await fecharSql();
