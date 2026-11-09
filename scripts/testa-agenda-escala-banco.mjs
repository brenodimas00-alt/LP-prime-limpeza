// Agenda e Escala no BANCO (migration 20261109100000; contrato em docs/AGENDA-ESCALA.md). Só dados fictícios, criados e
// apagados por esta execução. Nenhuma mensagem sai: o teste olha os eventos e simula o retorno das execuções do D10.
// Cobre: máquina de estados (o trigger recusa transição inválida), pagamento pendente não bloqueia, envio idempotente
// (uma vez por versão, nunca reenvia), revisão invalidada por alteração relevante, sem resposta não vira recusa (pendência
// só com prazo configurado), aceite e recusa pelo webhook (remetente e versão conferidos, callback atrasado ignorado),
// fixa nunca trocada sozinha, pré-designação explicável e igual à conta do domínio, stand-by, remoção avisa a anterior,
// permissões (anon, cliente, diarista, atendimento x administração) e RLS das tabelas novas.
// Uso (Supabase LOCAL): PRIME_ENV=<env local> bash scripts/cli.sh node22 scripts/testa-agenda-escala-banco.mjs
//   (o env local sai de scripts/ensaio-producao-local.mjs ou de `supabase status`: SUPABASE_URL/SUPABASE_DB_URL_LOCAL 127.0.0.1)
import { randomUUID } from 'node:crypto';
import { criarSuite, assert } from './lib-teste.mjs';
import { sql, transacao, fecharSql, criarUsuario, cpfFicticio, admin as adminAuth } from './lib-supabase.mjs';
import { pontuarCandidata } from '../src/domain/escala.js';
import { dataNoFuso, somarDias } from '../src/domain/calendario.js';

const t = criarSuite('agenda e escala (banco)');
const HOJE = dataNoFuso(new Date().toISOString());
let D = somarDias(HOJE, 3); // cada teste usa o seu dia (profissionais não se cruzam entre testes)
let nDia = 0;
const novoDia = () => { D = somarDias(HOJE, 2 + (nDia++)); };
const dow = (d) => new Date(`${d}T12:00:00Z`).getUTCDay();
const k = (p = 'k') => `${p}-${randomUUID()}`;
const criados = { usuarios: [], diaristas: [], clientes: [], pedidos: [] };

/** RPC como um usuário (papel authenticated + sub do JWT) ou como anon. Erro vira { codigo }. */
async function rpc(quem, chamada, params = []) {
  try {
    return await transacao(async (q) => {
      if (quem === 'anon') await q('set local role anon');
      else {
        await q(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: quem.id, role: 'authenticated' })]);
        await q('set local role authenticated');
      }
      return (await q(`select ${chamada} r`, params))[0].r;
    });
  } catch (e) { throw Object.assign(new Error(`${chamada.split('(')[0]}: ${e.message} ${e.detail || ''}`), { codigo: e.message }); }
}
const falha = async (p, codigo) => { try { await p; } catch (e) { assert.equal(e.codigo, codigo, e.message); return e; } assert.fail(`esperava ${codigo}`); };
/** SQL direto (como o dono do banco) com o erro no mesmo formato do rpc. */
const bruto = (texto, params) => sql(texto, params).catch((e) => { throw Object.assign(e, { codigo: e.message }); });
const at = async (id) => (await sql('select * from public.atendimentos where id = $1', [id]))[0];
const eventos = async (tipo, id) => (await sql(`select * from public.eventos where tipo = $1 and refs ->> 'atendimentoId' = $2 order by criado_em`, [tipo, id]));

// ---------------------------------------------------------------- fixture
// sem a migration, nada é criado (nem usuário): falha antes de tocar no banco
if (!(await sql("select to_regclass('public.vinculos_fixos') is not null ok"))[0].ok) {
  console.log('\n# agenda e escala (banco)\n  FALHOU migration 20261109100000_agenda_escala não aplicada neste banco\n# agenda e escala (banco): 0/11 passaram');
  await fecharSql(); process.exit(1);
}
const ADM = await criarUsuario('ae-adm', 'prime_admin');
const ATD = await criarUsuario('ae-atd', 'prime_atendimento');
const CLI = await criarUsuario('ae-cli');
const DIA = await criarUsuario('ae-dia', 'diarista');
criados.usuarios.push(ADM.id, ATD.id, CLI.id, DIA.id);
await sql('update public.perfis set papeis = array[papel] where user_id = any($1::uuid[])', [criados.usuarios]);
const telefone = () => `3190${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;

async function diarista(nome, { dias = [0, 1, 2, 3, 4, 5, 6], usuario } = {}) {
  const u = usuario || await criarUsuario(`ae-${nome.toLowerCase()}`, 'diarista');
  if (!usuario) criados.usuarios.push(u.id);
  const tel = telefone();
  const [r] = await sql(`insert into public.diaristas (usuario_id, nome, cpf, telefone, email, data_nascimento, identidade, status, aceite_termos_em, disponibilidade, habilidades, ficticio)
    values ($1, $2, $3, $4, $5, '1985-04-12', 'cnh', 'aprovada', now(), $6::text::jsonb, array['residencial'], true) returning id`,
  [u.id, `${nome} Teste AE`, cpfFicticio(), tel, u.email, JSON.stringify({ dias, turnos: ['integral'], regioes: ['Contagem'] })]);
  criados.diaristas.push(r.id);
  return { id: r.id, telefone: tel };
}
const [ANA, BIA, CRIS] = [await diarista('Ana', { usuario: DIA }), await diarista('Bia'), await diarista('Cris')];
const [cliente] = await sql(`insert into public.clientes (usuario_id, tipo, nome, telefone, email, endereco, origem, ficticio)
  values ($1, 'residencial', 'Cliente Teste AE', $2, $3, $4::text::jsonb, 'site', true) returning id`,
[CLI.id, telefone(), CLI.email, JSON.stringify({ logradouro: 'Rua Teste', numero: '1', bairro: 'Eldorado', cidade: 'Contagem', uf: 'MG', cep: '32310000' })]);
criados.clientes.push(cliente.id);

/** Pedido + diárias (uma por data) + cobrança de cada diária. */
async function pedido({ datas = null, hora = '08:00', pago = false, modalidade = 'avulsa', diarista: dia = null } = {}) {
  datas ||= [D];
  const [p] = await sql(`insert into public.pedidos (cliente_id, pacote, status, total_centavos, modalidade, ficticio)
    values ($1, $2::text::jsonb, $3, $4, $5, true) returning id`,
  [cliente.id, JSON.stringify({ tipoServico: 'residencial', duracaoHoras: 4, quantidadeDiarias: datas.length, frequencia: datas.length > 1 ? 'semanal' : 'avulso' }),
    pago ? 'confirmado' : 'aguardando_pagamento', 17500 * datas.length, modalidade]);
  criados.pedidos.push(p.id);
  const ids = [];
  for (const [i, data] of datas.entries()) {
    const [a] = await sql(`insert into public.atendimentos (pedido_id, sequencia, data, hora_inicio, duracao_minutos, servico, status, diarista_id, valor_dia_centavos)
      values ($1, $2, $3, $4, 240, 'residencial', $5, $6, 17500) returning id`, [p.id, i + 1, data, hora, pago ? 'confirmado' : 'agendado', dia]);
    await sql(`insert into public.pagamentos (pedido_id, atendimento_id, parcela, valor_centavos, status, confirmado_em, vence_em)
      values ($1, $2, 'diaria', 17500, $3, $4, $5)`, [p.id, a.id, pago ? 'confirmado' : 'pendente', pago ? new Date().toISOString() : null, somarDias(data, -1)]);
    ids.push(a.id);
  }
  return { pedidoId: p.id, ids };
}
/** A rotina de preparação mexe em TODAS as diárias do período: só roda se as sem profissional do período forem desta execução. */
async function preparar(de, ate) {
  const [x] = await sql(`select count(*)::int n from public.atendimentos a join public.pedidos p on p.id = a.pedido_id
    where a.data between $1 and $2 and a.diarista_id is null and a.status in ('agendado', 'confirmado') and not (p.id = any($3::uuid[]))`, [de, ate, criados.pedidos]);
  assert.equal(x.n, 0, 'há diária de fora do teste sem profissional no período: a preparação mexeria nela');
  return rpc(ATD, 'public.escala_preparar($1::date, $2::date)', [de, ate]);
}
/** Leva a diária até "aguardando_envio" pela API (designa, revisa, envia). */
async function ateEnviada(id, dia = ANA.id) {
  await rpc(ATD, 'public.escala_alterar($1::uuid, $2::text::jsonb, $3)', [id, JSON.stringify({ diaristaId: dia }), k()]);
  const a = await at(id);
  await rpc(ATD, 'public.escala_revisar($1::uuid, $2, $3)', [id, a.escala_versao, k()]);
  return rpc(ATD, 'public.escala_enviar($1::uuid[], $2)', [[id], k()]);
}
/** Execução D10 simulada (o worker não roda no teste): avança o estado como o provedor faria. */
async function execucaoD10(id, versao) {
  const a = await at(id);
  const [e] = await sql(`insert into public.automacao_execucoes (regra, template_codigo, entidade_tipo, entidade_id, marco, chave_idempotencia, destinatario, categoria, agendada_para, valida_ate, estado, contexto)
    values ('D10', 'diaria_enviada', 'atendimento', $1, $2, $3, '{"tipo":"diarista"}', 'atendimento', now(), now() + interval '1 day', 'enviando', $4::text::jsonb) returning id`,
  [id, `envio:${versao}:${a.diarista_id}`, `D10:atendimento:${id}:envio:${versao}:${a.diarista_id}:${randomUUID()}`, JSON.stringify({ atendimentoId: id, diaristaId: a.diarista_id, dados: { versao } })]);
  return { id: e.id, estado: (estado) => sql('update public.automacao_execucoes set estado = $2, atualizado_em = now() where id = $1', [e.id, estado]) };
}
const configPadrao = () => sql(`update public.configuracao set valor = '{}' where chave = 'agenda_escala'`);
await configPadrao();

// ---------------------------------------------------------------- testes
t.teste('máquina de estados: o banco recusa pular etapas (sem profissional não revisa, aceite antes do envio não vale)', async () => {
  novoDia();
  const { ids: [id] } = await pedido();
  await falha(bruto(`update public.atendimentos set escala_estado = 'revisada' where id = $1`, [id]), 'new row for relation "atendimentos" violates check constraint "atendimentos_escala_com_profissional"');
  await falha(rpc(ATD, 'public.escala_revisar($1::uuid, 0, $2)', [id, k()]), 'CONDICAO_NAO_ATENDIDA');
  await rpc(ATD, 'public.escala_alterar($1::uuid, $2::text::jsonb, $3)', [id, JSON.stringify({ diaristaId: ANA.id }), k()]);
  await falha(bruto(`update public.atendimentos set escala_estado = 'confirmada' where id = $1`, [id]), 'TRANSICAO_PROIBIDA');
  await falha(bruto(`update public.atendimentos set escala_estado = 'aguardando_envio' where id = $1`, [id]), 'TRANSICAO_PROIBIDA');
  const a = await at(id);
  await falha(rpc(ATD, 'public.escala_responder($1::uuid, $2::text::jsonb, $3)', [id, JSON.stringify({ resposta: 'aceite', versao: a.escala_versao }), k()]), 'TRANSICAO_PROIBIDA');
  await rpc(ATD, 'public.escala_revisar($1::uuid, $2, $3)', [id, a.escala_versao, k()]);
  await falha(bruto(`update public.atendimentos set escala_estado = 'enviada' where id = $1`, [id]), 'TRANSICAO_PROIBIDA'); // revisada -> enviada sem passar pelo envio
  await falha(rpc(ATD, 'public.escala_revisar($1::uuid, $2, $3)', [id, a.escala_versao, k()]), 'TRANSICAO_PROIBIDA'); // revisão coletiva/repetida não existe
});

t.teste('pagamento pendente não bloqueia: designar, revisar e enviar uma diária sem pagamento', async () => {
  novoDia();
  const { ids: [id] } = await pedido({ pago: false });
  const r = await ateEnviada(id);
  assert.deepEqual(r.enviadas, [id]);
  const a = await at(id);
  assert.equal(a.status, 'agendado', 'o status do pagamento não mudou');
  assert.equal(a.escala_estado, 'aguardando_envio');
  assert.equal((await eventos('diaria_enviada', id)).length, 1);
  assert.equal((await eventos('atendimento_atribuido', id)).length, 0, 'ninguém é avisado antes do envio');
});

t.teste('envio idempotente: mesma chave devolve o mesmo resultado, chave nova e "enviar todas" não reenviam; retorno do provedor só avança', async () => {
  novoDia();
  const { ids: [id] } = await pedido();
  const { ids: [outra] } = await pedido({ hora: '13:00' });
  await rpc(ATD, 'public.escala_alterar($1::uuid, $2::text::jsonb, $3)', [id, JSON.stringify({ diaristaId: ANA.id }), k()]);
  const v = (await at(id)).escala_versao;
  await rpc(ATD, 'public.escala_revisar($1::uuid, $2, $3)', [id, v, k()]);
  const chave = k();
  const r1 = await rpc(ATD, 'public.escala_enviar($1::uuid[], $2)', [[id], chave]);
  const r2 = await rpc(ATD, 'public.escala_enviar($1::uuid[], $2)', [[id], chave]);
  assert.equal(r2._repetido, true); delete r2._repetido; assert.deepEqual(r2, r1);
  const r3 = await rpc(ATD, 'public.escala_enviar($1::uuid[], $2)', [[id, outra], k()]);
  assert.deepEqual(r3.enviadas, []);
  assert.deepEqual(r3.ignoradas.map((x) => x.motivo).sort(), ['já enviada', 'sem profissional']);
  assert.equal((await eventos('diaria_enviada', id)).length, 1, 'uma mensagem por versão');
  const ex = await execucaoD10(id, v);
  await ex.estado('enviada'); assert.equal((await at(id)).escala_estado, 'enviada');
  await ex.estado('entregue'); assert.equal((await at(id)).escala_estado, 'aguardando_aceite');
  const velha = await execucaoD10(id, v - 1); // execução de uma designação antiga
  await velha.estado('falhou');
  const a = await at(id);
  assert.equal(a.escala_estado, 'aguardando_aceite'); assert.equal(a.escala_envio.falhou, false);
  // falha do envio atual: aparece na linha (reenviar) e no Início; o reenvio reabre a mesma execução
  const { ids: [id2] } = await pedido({ hora: '14:00' });
  await ateEnviada(id2, BIA.id);
  const v2 = (await at(id2)).escala_versao;
  const ex2 = await execucaoD10(id2, v2);
  await ex2.estado('falhou');
  assert.equal((await at(id2)).escala_envio.falhou, true);
  const pend = await rpc(ATD, 'public.painel_pendencias()');
  assert.ok(pend.itens.some((x) => x.tipo === 'falha_envio_escala' && x.ref.atendimentoId === id2));
  assert.ok(!pend.itens.some((x) => x.tipo === 'falha_automacao' && x.ref.execucaoId === ex2.id), 'sem pendência duplicada');
  const re = await rpc(ATD, 'public.escala_enviar($1::uuid[], $2)', [[id2], k()]);
  assert.deepEqual(re.enviadas, [id2]);
  assert.equal((await sql('select estado from public.automacao_execucoes where id = $1', [ex2.id]))[0].estado, 'agendada');
  assert.equal((await eventos('diaria_enviada', id2)).length, 1);
});

t.teste('revisão invalidada: alteração relevante (remarcar, trocar profissional) volta pra Para revisar e a versão antiga não revisa', async () => {
  novoDia();
  const { ids: [id] } = await pedido();
  await rpc(ATD, 'public.escala_alterar($1::uuid, $2::text::jsonb, $3)', [id, JSON.stringify({ diaristaId: ANA.id }), k()]);
  const v = (await at(id)).escala_versao;
  await rpc(ATD, 'public.escala_revisar($1::uuid, $2, $3)', [id, v, k()]);
  await sql(`update public.atendimentos set hora_inicio = '09:00' where id = $1`, [id]); // remarcação por outro caminho
  let a = await at(id);
  assert.equal(a.escala_estado, 'para_revisar'); assert.equal(a.escala_versao, v + 1);
  await falha(rpc(ATD, 'public.escala_revisar($1::uuid, $2, $3)', [id, v, k()]), 'DESATUALIZADA');
  await rpc(ATD, 'public.escala_revisar($1::uuid, $2, $3)', [id, v + 1, k()]);
  await rpc(ATD, 'public.escala_alterar($1::uuid, $2::text::jsonb, $3)', [id, JSON.stringify({ diaristaId: BIA.id }), k()]);
  a = await at(id);
  assert.equal(a.escala_estado, 'para_revisar'); assert.equal(a.designacao_origem, 'manual');
});

t.teste('sem resposta não vira recusa: continua aguardando; triângulo/pendência só com prazo configurado (só a administração configura)', async () => {
  novoDia();
  const { ids: [id] } = await pedido();
  await ateEnviada(id, CRIS.id);
  const ex = await execucaoD10(id, (await at(id)).escala_versao);
  await ex.estado('enviada');
  await sql(`update public.atendimentos set escala_envio = escala_envio || jsonb_build_object('enviadaEm', to_char((now() - interval '3 hours') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) where id = $1`, [id]);
  let pend = await rpc(ATD, 'public.painel_pendencias()');
  assert.ok(!pend.itens.some((x) => x.tipo === 'sem_resposta'), 'sem prazo definido, sem alerta');
  await falha(rpc(ATD, 'public.salvar_config_agenda($1::text::jsonb)', [JSON.stringify({ prazoSemRespostaMin: 60 })]), 'ATOR_SEM_PERMISSAO');
  const cfg = await rpc(ADM, 'public.salvar_config_agenda($1::text::jsonb)', [JSON.stringify({ prazoSemRespostaMin: 60 })]);
  assert.equal(cfg.prazoSemRespostaMin, 60); assert.equal(cfg.verificacaoPagamento.ligada, false);
  pend = await rpc(ATD, 'public.painel_pendencias()');
  const p = pend.itens.find((x) => x.tipo === 'sem_resposta' && x.ref.atendimentoId === id);
  assert.ok(p, 'pendência no Início'); assert.equal(p.ref.data, D);
  const a = await at(id);
  assert.equal(a.escala_estado, 'enviada'); assert.equal(a.diarista_id, CRIS.id, 'ninguém foi trocado');
  await configPadrao();
});

t.teste('webhook: remetente errado e versão antiga são ignorados; aceite confirma (e libera o D04); repetido não reaplica; recusa volta pra equipe', async () => {
  novoDia();
  const { ids: [id] } = await pedido();
  await ateEnviada(id, ANA.id);
  const v = (await at(id)).escala_versao;
  assert.equal(await rpc('anon', 'public.webhook_resposta_escala($1, $2, $3, now())', [k('w'), ANA.telefone, `escala:aceite:${id}:${v}`]).catch((e) => e.codigo), 'permission denied for function webhook_resposta_escala');
  assert.equal((await sql('select public.webhook_resposta_escala($1, $2, $3, now()) r', [k('w'), BIA.telefone, `escala:aceite:${id}:${v}`]))[0].r, 'remetente_invalido');
  assert.equal((await sql('select public.webhook_resposta_escala($1, $2, $3, now()) r', [k('w'), `55${ANA.telefone}`, `escala:aceite:${id}:${v - 1}`]))[0].r, 'desatualizada');
  assert.equal((await at(id)).escala_estado, 'aguardando_envio');
  const msg = k('w');
  assert.equal((await sql('select public.webhook_resposta_escala($1, $2, $3, now()) r', [msg, `55${ANA.telefone}`, `escala:aceite:${id}:${v}`]))[0].r, 'aceite');
  assert.equal((await sql('select public.webhook_resposta_escala($1, $2, $3, now()) r', [msg, `55${ANA.telefone}`, `escala:aceite:${id}:${v}`]))[0].r, 'repetida');
  const a = await at(id);
  assert.equal(a.escala_estado, 'confirmada'); assert.equal(a.escala_envio.resposta, 'aceite'); assert.equal(a.status, 'agendado', 'aceite não é o "confirmado" do pagamento');
  assert.equal((await eventos('escala_aceita', id)).length, 1);
  const ex = await execucaoD10(id, v); await ex.estado('entregue'); // entrega chegando depois do aceite
  assert.equal((await at(id)).escala_estado, 'confirmada', 'não regride');
  // recusa
  const { ids: [id2] } = await pedido({ hora: '13:00' });
  await ateEnviada(id2, BIA.id);
  const v2 = (await at(id2)).escala_versao;
  assert.equal((await sql('select public.webhook_resposta_escala($1, $2, $3, now()) r', [k('w'), BIA.telefone, `escala:recusa:${id2}:${v2}`]))[0].r, 'recusa');
  const b = await at(id2);
  assert.equal(b.diarista_id, null); assert.equal(b.escala_estado, 'para_revisar'); assert.equal(b.escala_recusa.diaristaId, BIA.id); assert.equal(b.escala_sem_auto, true);
  const pend = await rpc(ATD, 'public.painel_pendencias()');
  assert.ok(pend.itens.some((x) => x.tipo === 'recusa_profissional' && x.ref.atendimentoId === id2));
  assert.ok(!pend.itens.some((x) => x.tipo === 'sem_profissional' && x.ref.atendimentoId === id2), 'sem pendência duplicada');
  await preparar(D, D);
  assert.equal((await at(id2)).diarista_id, null, 'a rotina não põe ninguém no lugar de quem recusou');
});

t.teste('fixa: vínculo por dia da semana (só administração) entra nas diárias futuras; impedida vira alerta e pendência, nunca troca sozinha', async () => {
  novoDia();
  const datas = [D, somarDias(D, 7), somarDias(D, 14)];
  const { pedidoId, ids } = await pedido({ datas, modalidade: 'pacote', pago: true });
  await falha(rpc(ATD, 'public.salvar_vinculo_fixo($1::uuid, $2::text::jsonb, $3)', [pedidoId, JSON.stringify({ diaSemana: dow(D), diaristaId: CRIS.id }), k()]), 'ATOR_SEM_PERMISSAO');
  await sql(`insert into public.bloqueios_profissional (diarista_id, de, ate, motivo) values ($1, $2, $2, 'folga')`, [CRIS.id, datas[2]]);
  const r = await rpc(ADM, 'public.salvar_vinculo_fixo($1::uuid, $2::text::jsonb, $3)', [pedidoId, JSON.stringify({ diaSemana: dow(D), diaristaId: CRIS.id }), k()]);
  assert.equal(r.aplicadas, 2); assert.equal(r.comConflito, 1);
  const [a0, , a2] = await Promise.all(ids.map(at));
  assert.equal(a0.diarista_id, CRIS.id); assert.equal(a0.designacao_origem, 'fixa'); assert.equal(a0.escala_estado, 'para_revisar');
  const prep = await preparar(D, datas[2]);
  assert.equal((await at(ids[2])).diarista_id, null, 'a fixa impedida não foi trocada por outra');
  assert.ok(prep.conflitosFixa >= 1);
  const ag = await rpc(ATD, 'public.agenda_escala($1::date, $2::date)', [datas[2], datas[2]]);
  const item = ag.itens.find((x) => x.id === a2.id);
  assert.match(item.alertaFixa, /indisponível: De folga/); assert.equal(item.vinculoFixo.diaristaId, CRIS.id); assert.equal(item.pacote, true);
  const pend = await rpc(ATD, 'public.painel_pendencias()');
  if (datas[2] <= somarDias(HOJE, 7)) assert.ok(pend.itens.some((x) => x.tipo === 'conflito_fixa' && x.ref.atendimentoId === a2.id));
  const hist = await rpc(ATD, 'public.vinculos_fixos_do_pedido($1::uuid)', [pedidoId]);
  assert.equal(hist.itens.length, 1);
  // trocar o vínculo pela linha (escopo futuro) é da administração; só esta diária, qualquer um da equipe
  await falha(rpc(ATD, 'public.escala_alterar($1::uuid, $2::text::jsonb, $3)', [ids[1], JSON.stringify({ diaristaId: ANA.id, escopo: 'vinculo_futuro' }), k()]), 'ATOR_SEM_PERMISSAO');
  await rpc(ADM, 'public.escala_alterar($1::uuid, $2::text::jsonb, $3)', [ids[1], JSON.stringify({ diaristaId: ANA.id, escopo: 'vinculo_futuro' }), k()]);
  const h2 = await rpc(ATD, 'public.vinculos_fixos_do_pedido($1::uuid)', [pedidoId]);
  assert.equal(h2.itens.length, 2); assert.equal(h2.itens.filter((x) => !x.encerradoEm)[0].diaristaId, ANA.id);
  assert.equal((await at(ids[1])).designacao_origem, 'fixa');
});

t.teste('pré-designação: diária sem fixa ganha a Sugerida com o porquê, igual à conta do domínio; sem candidata fica sem profissional', async () => {
  novoDia();
  const { ids: [id] } = await pedido({ hora: '06:00' });
  // ocupa as três no horário, menos a Bia
  for (const dia of [ANA.id, CRIS.id]) await pedido({ hora: '06:30', diarista: dia });
  await preparar(D, D);
  const a = await at(id);
  assert.equal(a.designacao_origem, 'sugerida');
  const cand = await rpc(ATD, 'public.escala_candidatas($1::uuid)', [id]);
  assert.deepEqual(cand.criteriosSemDado, ['deslocamento', 'imovel', 'perfil', 'preferencia']);
  const escolhida = cand.itens.find((x) => x.id === a.diarista_id);
  assert.equal(escolhida.impedida, false); assert.deepEqual(a.escala_sugestao.motivos, escolhida.motivos);
  assert.ok(cand.itens.find((x) => x.id === ANA.id).impedida);
  // mesma conta no JS (paridade da pontuação)
  const [d] = await sql('select * from public.diaristas where id = $1', [a.diarista_id]);
  const outras = await sql(`select to_char(hora_inicio, 'HH24:MI') "horaInicio", duracao_minutos "duracaoMinutos" from public.atendimentos where diarista_id = $1 and data = $2 and id <> $3 and status <> 'cancelado'`, [d.id, D, id]);
  const js = pontuarCandidata({ data: D, horaInicio: '06:00', duracaoMinutos: 240, cidade: 'Contagem', servico: 'residencial' },
    { status: d.status, disponibilidade: d.disponibilidade, habilidades: d.habilidades }, { outras });
  assert.equal(js.pontos, escolhida.pontos); assert.deepEqual(js.motivos, escolhida.motivos);
  // as três ocupadas no horário: fica sem profissional (pendência), sem forçar ninguém
  const { ids: [semNinguem] } = await pedido({ hora: '07:00' });
  const r = await preparar(D, D);
  assert.ok(r.semCandidata >= 1);
  assert.equal((await at(semNinguem)).diarista_id, null);
  const pend = await rpc(ATD, 'public.painel_pendencias()');
  if (D <= somarDias(HOJE, 7)) assert.ok(pend.itens.some((x) => x.tipo === 'sem_profissional' && x.ref.atendimentoId === semNinguem));
});

t.teste('stand-by: reservar, confirmar, utilizar numa diária real (sem cliente fictício) e liberar; perto da decisão vira pendência', async () => {
  novoDia();
  const { ids: [id] } = await pedido({ hora: '15:00' });
  const dados = { diaristaId: CRIS.id, data: D, horaInicio: '15:00', duracaoMinutos: 360, regiao: 'Contagem/BH' };
  await rpc(ATD, 'public.standby_reservar($1::text::jsonb, $2)', [JSON.stringify(dados), k()]);
  let ag = await rpc(ATD, 'public.agenda_escala($1::date, $2::date)', [D, D]);
  assert.ok(ag.standby.some((x) => x.diaristaId === CRIS.id && x.estado === 'reservada' && x.regiao === 'Contagem/BH'));
  await rpc(ATD, 'public.standby_confirmar($1::uuid, $2::date, $3)', [CRIS.id, D, k()]);
  const u = await rpc(ATD, 'public.standby_utilizar($1::uuid, $2::date, $3::uuid, $4)', [CRIS.id, D, id, k()]);
  assert.equal(u.estado, 'utilizada');
  const a = await at(id);
  assert.equal(a.diarista_id, CRIS.id); assert.equal(a.designacao_origem, 'manual'); assert.equal(a.escala_estado, 'para_revisar');
  await falha(rpc(ATD, 'public.standby_liberar($1::uuid, $2::date, null, $3)', [CRIS.id, D, k()]), 'TRANSICAO_PROIBIDA');
  ag = await rpc(ATD, 'public.agenda_escala($1::date, $2::date)', [D, D]);
  assert.ok(!ag.standby.some((x) => x.diaristaId === CRIS.id), 'utilizada sai da faixa');
  const [h] = await sql('select historico from public.standby_decisoes where diarista_id = $1 and data = $2', [CRIS.id, D]);
  assert.deepEqual(h.historico.map((x) => x.evento), ['reservada', 'confirmada', 'utilizada']);
  // hoje, com o horário de decisão já passado: pendência; liberar tira
  await rpc(ATD, 'public.standby_reservar($1::text::jsonb, $2)', [JSON.stringify({ diaristaId: BIA.id, data: HOJE, horaInicio: '00:30', duracaoMinutos: 120, regiao: 'BH' }), k()]);
  let pend = await rpc(ATD, 'public.painel_pendencias()');
  assert.ok(pend.itens.some((x) => x.tipo === 'standby_decisao' && x.ref.diaristaId === BIA.id));
  await rpc(ATD, 'public.standby_liberar($1::uuid, $2::date, $3, $4)', [BIA.id, HOJE, 'Sem necessidade (teste)', k()]);
  pend = await rpc(ATD, 'public.painel_pendencias()');
  assert.ok(!pend.itens.some((x) => x.tipo === 'standby_decisao' && x.ref.diaristaId === BIA.id));
});

t.teste('remover depois de comunicada pede o aviso da anterior (escala_alterada, D08); a rotina não repõe ninguém', async () => {
  novoDia();
  const { ids: [id] } = await pedido({ hora: '17:00' });
  await ateEnviada(id, ANA.id);
  const r = await rpc(ATD, 'public.escala_remover($1::uuid, $2)', [id, k()]);
  assert.equal(r.avisada, true);
  const ev = await eventos('escala_alterada', id);
  assert.equal(ev.length, 1); assert.equal(ev[0].dados.anterior, ANA.id); assert.equal(ev[0].dados.removida, true);
  await preparar(D, D);
  assert.equal((await at(id)).diarista_id, null);
});

t.teste('permissões e RLS: anon, cliente e profissional não leem nem chamam a escala; configuração fora da leitura pública; canal e parceria só administração', async () => {
  novoDia();
  for (const tab of ['vinculos_fixos', 'standby_decisoes']) {
    await falha(rpc('anon', `(select count(*) from public.${tab})`), `permission denied for table ${tab}`);
    await falha(rpc(CLI, `(select count(*) from public.${tab})`), `permission denied for table ${tab}`);
  }
  await falha(rpc('anon', 'public.agenda_escala($1::date, $2::date)', [D, D]), 'permission denied for function agenda_escala');
  await falha(rpc(CLI, 'public.agenda_escala($1::date, $2::date)', [D, D]), 'ATOR_SEM_PERMISSAO');
  await falha(rpc(DIA, 'public.escala_enviar($1::uuid[], $2)', [[randomUUID()], k()]), 'ATOR_SEM_PERMISSAO');
  await falha(rpc(CLI, 'public.webhook_resposta_escala($1, $2, $3, now())', [k(), '31999999999', 'x']), 'permission denied for function webhook_resposta_escala');
  assert.equal(await rpc('anon', `(select count(*)::int from public.configuracao where chave = 'agenda_escala')`), 0);
  await falha(rpc(ATD, 'public.definir_canal_ativo($1, $2)', ['portal', 'teste']), 'ATOR_SEM_PERMISSAO');
  await falha(rpc(ATD, 'public.definir_parceria($1::uuid, true)', [cliente.id]), 'ATOR_SEM_PERMISSAO');
  const c = await rpc(ADM, 'public.definir_canal_ativo($1, $2)', ['portal', 'Teste de contingência']);
  assert.equal(c.canalAtivo, 'portal'); assert.equal(c.historicoCanal.at(-1).para, 'portal');
  assert.equal((await rpc(ADM, 'public.definir_parceria($1::uuid, true)', [cliente.id])).parceria, true);
  const ag = await rpc(ATD, 'public.agenda_escala($1::date, $2::date)', [D, D]);
  assert.equal(ag.config.canalAtivo, 'portal'); assert.equal(ag.config.historicoCanal, undefined);
  assert.ok(ag.itens.every((x) => x.cliente.parceria === true || x.cliente.id !== cliente.id));
  await configPadrao();
});

try { await t.fim(); } finally {
  // limpeza só do que esta execução criou
  await transacao(async (q) => {
    const ped = criados.pedidos; const dia = criados.diaristas;
    const ats = (await q('select id from public.atendimentos where pedido_id = any($1::uuid[])', [ped])).map((x) => x.id);
    await q(`delete from public.eventos where refs ->> 'pedidoId' = any($1::text[]) or refs ->> 'atendimentoId' = any($2::text[])`, [ped, ats]);
    await q(`delete from public.automacao_execucoes where contexto ->> 'atendimentoId' = any($1::text[])`, [ats]);
    await q('delete from public.standby_decisoes where diarista_id = any($1::uuid[])', [dia]);
    await q('delete from public.vinculos_fixos where pedido_id = any($1::uuid[])', [ped]);
    await q('delete from public.bloqueios_profissional where diarista_id = any($1::uuid[])', [dia]);
    await q('delete from public.pagamentos where pedido_id = any($1::uuid[])', [ped]);
    await q('delete from public.atendimentos where pedido_id = any($1::uuid[])', [ped]);
    await q('delete from public.pedidos where id = any($1::uuid[])', [ped]);
    await q('delete from public.clientes where id = any($1::uuid[])', [criados.clientes]);
    await q('delete from public.diaristas where id = any($1::uuid[])', [dia]);
    await q('delete from public.whatsapp_janelas where telefone = any($1::text[])', [[ANA.telefone, BIA.telefone, CRIS.telefone]]);
  });
  for (const u of criados.usuarios) await adminAuth.auth.admin.deleteUser(u).catch(() => {});
  await configPadrao();
  await fecharSql();
}
