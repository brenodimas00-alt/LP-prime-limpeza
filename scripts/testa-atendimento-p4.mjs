// P4 (bloco 3) CONTRA A HOMOLOGAÇÃO, só fictícios: checklist (semente = serviços, edição só da admin, marcação no
// check-out com motivo), localização aproximada (só com consentimento, só junto do check-in, arredondada, só a Prime
// vê, some ao revogar e em 30 dias), ocorrência (cliente dona, depois do atendimento, limite diário, estados com
// comentário, I05/C15, foto pela function com bytes conferidos e URL assinada só pra Prime).
// Uso: bash scripts/cli.sh node22 scripts/testa-atendimento-p4.mjs
import { criarSuite, assert } from './lib-teste.mjs';
import { sql, transacao, fecharSql, limparFicticios, entrar, criarUsuario, cpfFicticio, ENV } from './lib-supabase.mjs';
import { montarApiDeTeste } from './lib-api-teste.mjs';
import { agendar, chave, liberarCobranca } from './cenarios.mjs';
import { CLIENTE_RESIDENCIAL, proximaDataPermitida } from './fixtures/seed.js';
import { ARQUIVOS } from './fixtures/arquivos.mjs';
import { CONFIG_PRECOS } from '../src/config/precos.js';
import { SERVICOS_AGENDAMENTO } from '../src/config/agendamento.js';
import { dataNoFuso, somarDias } from '../src/domain/calendario.js';
import { criarPortaPg } from '../supabase/functions/_shared/porta-pg.js';
import { criarProvedores } from '../supabase/functions/_shared/provedores.js';
import { tique } from '../src/automacoes/v2/motor.js';

const t = criarSuite('P4 atendimento acompanhado (homologação)');
await limparFicticios();
const PRIME = { ator: 'prime' };
const { api, porDiaristaId, porEmail } = await montarApiDeTeste('p4');
const falha = async (p, codigo) => { try { await p; } catch (e) { assert.equal(e.codigo, codigo, e.message); return e; } assert.fail(`esperava ${codigo}`); };
const HOJE = dataNoFuso(new Date().toISOString());
let D = proximaDataPermitida(somarDias(HOJE, 10), 1, CONFIG_PRECOS);
while ([0, 6].includes(new Date(`${D}T12:00:00Z`).getUTCDay()) || CONFIG_PRECOS.feriados.includes(D)) D = somarDias(D, 1);

const uDia = await criarUsuario('p4-dia', 'diarista');
const [{ id: DIA }] = await sql(`insert into public.diaristas (usuario_id, nome, cpf, telefone, email, data_nascimento, identidade, status, aceite_termos_em, disponibilidade, ficticio)
  values ($1, 'Lia Teste P4', $2, '31955554444', $3, '1985-04-12', 'cnh', 'aprovada', now(), '{"dias":[1,2,3,4,5,6],"turnos":["integral"],"regioes":["BH - Centro-Sul"]}', true) returning id`, [uDia.id, cpfFicticio(), uDia.email]);
porDiaristaId.set(DIA, entrar(uDia));
const SD = { ator: 'diarista', id: DIA };
const uCli = await criarUsuario('p4-cli');
porEmail.set(uCli.email, entrar(uCli));
const CLIENTE = { ...CLIENTE_RESIDENCIAL, email: uCli.email, cpf: cpfFicticio() };
const r = await agendar(api, { cliente: CLIENTE, pacote: { tipoServico: 'residencial', duracaoHoras: 4, metragem: 45, quantidadeDiarias: 1, frequencia: 'avulso' }, primeiraData: D, turno: 'manha' }, chave('p4'));
const AT = r.atendimentos[0].id;
const SC = { ator: 'cliente', id: r.cliente.id };
const etapa = (evento, s = SD) => api.transicionarAtendimento(AT, { evento }, { sessao: s, chave: chave('t') });
const LISTA = SERVICOS_AGENDAMENTO.residencial.incluido;

t.teste('checklist: semente = "O que está incluído" de cada serviço (sem os PREENCHER)', async () => {
  const linhas = await sql('select tipo_servico, itens from public.checklists order by tipo_servico');
  for (const [tipo, s] of Object.entries(SERVICOS_AGENDAMENTO)) {
    assert.deepEqual(linhas.find((x) => x.tipo_servico === tipo).itens, s.incluido.filter((i) => !i.startsWith('PREENCHER')), tipo);
  }
});

t.teste('checklist: só a admin edita (limpa espaços e repetidos, até 30 itens de 3 a 160 caracteres)', async () => {
  const [{ itens: original }] = await sql(`select itens from public.checklists where tipo_servico = 'passadoria'`);
  const admin = await entrar(await criarUsuario('p4-adm', 'prime_admin'));
  const atend = await entrar(await criarUsuario('p4-atend', 'prime_atendimento'));
  try {
    const { data, error } = await admin.rpc('salvar_checklist', { p_tipo: 'passadoria', p_itens: ['  Passar   camisas ', 'passar camisas', 'Dobrar lençóis'] });
    assert.equal(error, null);
    assert.deepEqual(data.itens, ['Passar camisas', 'Dobrar lençóis']);
    assert.ok((await atend.rpc('salvar_checklist', { p_tipo: 'passadoria', p_itens: ['x x x'] })).error, 'atendimento não edita');
    assert.equal((await admin.rpc('salvar_checklist', { p_tipo: 'passadoria', p_itens: ['ok'] })).error?.message, 'DADOS_INVALIDOS');
    assert.equal((await admin.rpc('salvar_checklist', { p_tipo: 'passadoria', p_itens: Array.from({ length: 31 }, (_, i) => `item ${i}`) })).error?.message, 'DADOS_INVALIDOS');
  } finally { await sql(`update public.checklists set itens = $1::jsonb where tipo_servico = 'passadoria'`, [JSON.stringify(original)]); }
});

t.teste('localização: sem consentimento não grava; com consentimento só junto do check-in, arredondada e sem duplicar', async () => {
  await liberarCobranca(api, r);
  await api.atribuirDiarista(AT, { diaristaId: DIA }, { sessao: PRIME, chave: chave('atr') });
  const [g] = (await api.obterPedido(r.pedido.id, { sessao: PRIME })).pagamentos;
  await api.confirmarPagamento(g.id, { sessao: PRIME, chave: chave('conf') });
  await etapa('sair_a_caminho');
  const loc = { evento: 'sair_a_caminho', lat: -19.93456789, lon: -43.93812345, precisao: 35 };
  assert.deepEqual(await api.registrarLocalizacao(AT, loc, { sessao: SD }), { gravada: false, motivo: 'sem_consentimento' });
  await api.definirConsentimento('localizacao_profissional', true, { sessao: SD, origem: 'agenda_diarista' });
  assert.equal((await api.registrarLocalizacao(AT, loc, { sessao: SD })).gravada, true);
  await api.registrarLocalizacao(AT, { ...loc, lat: -19.5 }, { sessao: SD }); // repetir não duplica nem troca
  await falha(api.registrarLocalizacao(AT, { ...loc, evento: 'iniciar' }, { sessao: SD }), 'CONDICAO_NAO_ATENDIDA'); // ainda não chegou
  await falha(api.registrarLocalizacao(AT, loc, { sessao: SC }), 'ATOR_SEM_PERMISSAO');
  const linhas = await sql('select lat, lon, precisao_m from public.localizacoes_atendimento where atendimento_id = $1', [AT]);
  assert.deepEqual(linhas.map((x) => [Number(x.lat), Number(x.lon), x.precisao_m]), [[-19.935, -43.938, 35]]);
  const dia = await entrar(uDia);
  assert.deepEqual((await dia.from('localizacoes_atendimento').select('id')).data, [], 'a profissional não lê');
  const cs = await api.checkinsAtendimento(AT, { sessao: PRIME });
  assert.equal(cs[0].evento, 'sair_a_caminho');
  assert.equal(Number(cs[0].lat), -19.935);
  await falha(api.checkinsAtendimento(AT, { sessao: SD }), 'ATOR_SEM_PERMISSAO');
});

t.teste('checklist no check-out: só em andamento, todos os itens, motivo no não feito, uma vez; a Prime vê', async () => {
  const itens = LISTA.map((texto, i) => ({ texto, feito: i !== 2, ...(i === 2 ? { motivo: 'cliente pediu pra não mexer' } : {}) }));
  await falha(api.registrarChecklist(AT, itens, { sessao: SD, chave: chave('ck') }), 'CONDICAO_NAO_ATENDIDA'); // ainda a caminho
  await etapa('iniciar');
  await falha(api.registrarChecklist(AT, itens.slice(1), { sessao: SD, chave: chave('ck') }), 'DADOS_INVALIDOS');
  await falha(api.registrarChecklist(AT, itens.map((x, i) => (i === 2 ? { texto: x.texto, feito: false } : x)), { sessao: SD, chave: chave('ck') }), 'DADOS_INVALIDOS');
  const lista = await api.checklistAtendimento(AT, { sessao: SD });
  assert.deepEqual(lista.itens, LISTA);
  const ok = await api.registrarChecklist(AT, itens, { sessao: SD, chave: chave('ck') });
  assert.equal(ok.naoFeitos, 1);
  await falha(api.registrarChecklist(AT, itens, { sessao: SD, chave: chave('ck') }), 'CONDICAO_NAO_ATENDIDA');
  assert.equal((await api.checklistAtendimento(AT, { sessao: PRIME })).resposta[2].motivo, 'cliente pediu pra não mexer');
  const outra = await entrar(await criarUsuario('p4-outra-dia', 'diarista'));
  assert.deepEqual((await outra.from('checklist_respostas').select('atendimento_id')).data, []);
});

let OC;
t.teste('ocorrência: só depois do atendimento, só a cliente dona, descrição de 10 a 1000; gera o I05', async () => {
  await falha(api.abrirOcorrencia(AT, { tipo: 'dano', descricao: 'Quebrou um copo da cozinha' }, { sessao: SC, chave: chave('oc') }), 'CONDICAO_NAO_ATENDIDA');
  await etapa('finalizar');
  await falha(api.abrirOcorrencia(AT, { tipo: 'dano', descricao: 'curta' }, { sessao: SC, chave: chave('oc') }), 'DADOS_INVALIDOS');
  await falha(api.abrirOcorrencia(AT, { tipo: 'xyz', descricao: 'Quebrou um copo da cozinha' }, { sessao: SC, chave: chave('oc') }), 'DADOS_INVALIDOS');
  await falha(api.abrirOcorrencia(AT, { tipo: 'dano', descricao: 'Quebrou um copo da cozinha' }, { sessao: { ator: 'cliente', id: '00000000-0000-4000-8000-000000000000' }, chave: chave('oc') }), 'NAO_ENCONTRADO');
  const o = await api.abrirOcorrencia(AT, { tipo: 'dano', descricao: 'Quebrou um copo da cozinha' }, { sessao: SC, chave: chave('oc') });
  OC = o.ocorrencia.id;
  assert.equal(o.ocorrencia.estado, 'aberto');
  assert.equal((await sql(`select count(*)::int n from public.eventos where tipo = 'ocorrencia_aberta' and refs ->> 'ocorrenciaId' = $1`, [OC]))[0].n, 1);
  const outra = await entrar(await criarUsuario('p4-outra-cli'));
  assert.deepEqual((await outra.from('ocorrencias').select('id')).data, [], 'outra cliente não lê');
});

t.teste('Prime muda a situação com comentário: histórico, evento e C15 com a situação nova; a cliente vê o comentário', async () => {
  await falha(api.atualizarOcorrencia(OC, { estado: 'em_analise' }, { sessao: SC, chave: chave('at') }), 'ATOR_SEM_PERMISSAO');
  const x = await api.atualizarOcorrencia(OC, { estado: 'em_analise', comentario: 'Vamos repor o copo.' }, { sessao: PRIME, chave: chave('at') });
  assert.equal(x.ocorrencia.historico.length, 2);
  await falha(api.atualizarOcorrencia(OC, { estado: 'em_analise' }, { sessao: PRIME, chave: chave('at') }), 'TRANSICAO_PROIBIDA');
  const minhas = await api.listarOcorrencias({ atendimentoId: AT }, { sessao: SC });
  assert.equal(minhas[0].historico[1].comentario, 'Vamos repor o copo.');
  const porta = criarPortaPg({ transacao: (fn) => transacao(fn), urlSite: 'https://turno-2026-09-28.prime-limpeza.pages.dev/' });
  const provedores = criarProvedores({ ambiente: 'homologacao', fetch });
  let msg;
  for (let i = 0; i < 8 && !msg; i++) {
    await tique({ porta, provedores, agoraISO: `${somarDias(HOJE, 1)}T14:00:00.000Z`, ambiente: provedores.ambiente, escopo: [r.pedido.id] });
    [msg] = await sql(`select m.conteudo from public.automacao_execucoes e join public.mensagens m on m.execucao_id = e.id where e.regra = 'C15' and e.contexto ->> 'atendimentoId' = $1`, [AT]);
    if (!msg) await new Promise((ok) => setTimeout(ok, 1500));
  }
  assert.ok(msg, 'C15 enviado (simulado)');
  assert.match(msg.conteudo, /está em análise/);
});

t.teste('foto: a cliente dona envia uma imagem (bytes conferidos); PDF e segunda foto recusados; só a Prime abre', async () => {
  const png = new File([ARQUIVOS.png.bytes], 'copo.png', { type: 'image/png' });
  await falha(api.enviarFotoOcorrencia(OC, new File([ARQUIVOS.pdf.bytes], 'x.pdf', { type: 'application/pdf' }), { sessao: SC }), 'DADOS_INVALIDOS');
  await falha(api.enviarFotoOcorrencia(OC, new File([ARQUIVOS.pdf.bytes], 'x.png', { type: 'image/png' }), { sessao: SC }), 'DADOS_INVALIDOS'); // bytes de PDF
  const outra = await criarUsuario('p4-cli-foto');
  const sb = await entrar(outra);
  const { data: s } = await sb.auth.getSession();
  const form = new FormData(); form.append('ocorrenciaId', OC); form.append('arquivo', png);
  const alheia = await fetch(`${ENV.SUPABASE_URL}/functions/v1/documentos?acao=foto_ocorrencia`, { method: 'POST', headers: { Authorization: `Bearer ${s.session.access_token}` }, body: form });
  assert.equal(alheia.status, 404, 'foto em ocorrência de outra cliente');
  const ok = await api.enviarFotoOcorrencia(OC, png, { sessao: SC });
  assert.equal(ok.ocorrencia.temFoto, true);
  await falha(api.enviarFotoOcorrencia(OC, png, { sessao: SC }), 'CONDICAO_NAO_ATENDIDA');
  await falha(api.abrirFotoOcorrencia(OC, { sessao: SC }), 'ATOR_SEM_PERMISSAO');
  const aberta = await api.abrirFotoOcorrencia(OC, { sessao: PRIME });
  const resp = await fetch(aberta.url);
  assert.equal(resp.status, 200);
  assert.deepEqual(new Uint8Array(await resp.arrayBuffer()).slice(0, 8), ARQUIVOS.png.bytes.slice(0, 8));
});

t.teste('limite de 5 ocorrências por dia por cliente; flag desligada impede abrir', async () => {
  for (let i = 0; i < 4; i++) await api.abrirOcorrencia(AT, { tipo: 'outro', descricao: `Outro assunto número ${i}` }, { sessao: SC, chave: chave('oc') });
  await falha(api.abrirOcorrencia(AT, { tipo: 'outro', descricao: 'Mais um assunto aqui' }, { sessao: SC, chave: chave('oc') }), 'CONDICAO_NAO_ATENDIDA');
  await sql(`update public.config_flags set ligada = false where chave = 'p4_ocorrencias'`);
  try { await falha(api.abrirOcorrencia(AT, { tipo: 'outro', descricao: 'Mais um assunto aqui' }, { sessao: SC, chave: chave('oc') }), 'CONDICAO_NAO_ATENDIDA'); }
  finally { await sql(`update public.config_flags set ligada = true where chave = 'p4_ocorrencias'`); }
});

t.teste('localização: revogar o consentimento apaga; a retenção apaga o que passou de 30 dias', async () => {
  await sql(`update public.localizacoes_atendimento set registrada_em = now() - interval '31 days' where atendimento_id = $1`, [AT]);
  // outra linha recente pra provar que a retenção não pega o que está no prazo (dentro de transação desfeita)
  await transacao(async (q) => {
    await q(`insert into public.localizacoes_atendimento (atendimento_id, diarista_id, evento, lat, lon) values ($1, $2, 'finalizar', -19.9, -43.9)`, [AT, DIA]);
    const [{ n }] = await q('select privado.apagar_localizacoes_antigas() n');
    assert.ok(n >= 1);
    assert.equal((await q('select count(*)::int n from public.localizacoes_atendimento where atendimento_id = $1', [AT]))[0].n, 1);
    throw new Error('desfaz');
  }).catch((e) => { if (e.message !== 'desfaz') throw e; });
  await sql(`insert into public.localizacoes_atendimento (atendimento_id, diarista_id, evento, lat, lon) values ($1, $2, 'finalizar', -19.9, -43.9) on conflict do nothing`, [AT, DIA]);
  await api.definirConsentimento('localizacao_profissional', false, { sessao: SD, origem: 'agenda_diarista' });
  assert.equal((await sql('select count(*)::int n from public.localizacoes_atendimento where diarista_id = $1', [DIA]))[0].n, 0);
});

await t.fim();
await sql(`delete from public.ocorrencias where atendimento_id in (select a.id from public.atendimentos a join public.pedidos p on p.id = a.pedido_id where p.ficticio and p.cliente_id = $1)`, [r.cliente.id]);
await limparFicticios({ soEstaExecucao: true });
await fecharSql();
