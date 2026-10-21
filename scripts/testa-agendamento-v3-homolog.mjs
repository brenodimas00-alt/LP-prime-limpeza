// Agendamento v3 contra a HOMOLOGAÇÃO (só fictícios). V2: cadastro ANTES do endereço pela function "conta" (itens 5 e 34):
// resposta igual pra CPF novo, CPF já cadastrado e e-mail de outra conta (sem revelar nada), mesmo piso de tempo, cadastro
// novo salvo com acesso pela regra padrão, existente intocado, repetição com a mesma chave devolve o mesmo ticket, isca,
// validações literais; endereços da cliente (listar, substituir, só a dona, fora da área); anônimo sem acesso às RPCs.
// Uso: bash scripts/cli.sh node22 scripts/testa-agendamento-v3-homolog.mjs
import { createHash, randomUUID } from 'node:crypto';
import { criarSuite, assert } from './lib-teste.mjs';
import { sql, transacao, fecharSql, limparFicticios, conta, emailTeste, cpfFicticio, entrar, anonimo, admin, criarUsuario } from './lib-supabase.mjs';
import { criarPortaPg } from '../supabase/functions/_shared/porta-pg.js';
import { criarProvedores } from '../supabase/functions/_shared/provedores.js';
import { tique } from '../src/automacoes/v2/motor.js';
import { calcularParcelas } from '../src/domain/agendamento-v3.js';

const t = criarSuite('agendamento v3 (homologação)');
await limparFicticios();
const livre = async () => { await sql('delete from privado.cadastros_ip'); };
async function celularLivre() {
  for (;;) {
    const tel = `319${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
    if (!(await sql('select 1 from public.clientes where telefone = $1', [tel])).length) return tel;
  }
}
const PF = async (extra = {}) => ({ tipo: 'residencial', nome: 'Ana Nova Fictícia', telefone: await celularLivre(), email: emailTeste('v3'), cpf: cpfFicticio(), dataNascimento: '1990-03-07', ...extra });
const cadastrar = async (cliente, chave = `v3-${randomUUID()}`, extra = {}) => {
  await livre();
  const ini = Date.now();
  const r = await conta('cadastrar_v3', { cliente, chave, ...extra });
  return { ...r, ms: Date.now() - ini, chave };
};
const hash = (x) => createHash('sha256').update(x).digest('hex');
const S = {};

t.teste('CPF novo: {ok, ticket}; cadastro salvo sem solicitação (base legal), acesso pela regra padrão; ticket guardado só como hash', async () => {
  S.cli = await PF();
  const r = await cadastrar(S.cli);
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.deepEqual(Object.keys(r.corpo).sort(), ['ok', 'ticket']); assert.match(r.corpo.ticket, /^[0-9a-f]{64}$/);
  S.r1 = r;
  const [c] = await sql('select id, usuario_id, base_legal, endereco, ficticio, status_prospeccao from public.clientes where documento = $1', [S.cli.cpf]);
  assert.ok(c.usuario_id, 'acesso criado'); assert.equal(c.base_legal, 'execucao_contrato'); assert.deepEqual(c.endereco, {}); assert.equal(c.status_prospeccao, 'novo');
  S.c = c;
  const [{ n }] = await sql('select count(*)::int n from public.pedidos where cliente_id = $1', [c.id]);
  assert.equal(n, 0, 'nenhuma solicitação');
  const tk = await sql('select novo, hash from public.tickets_fluxo where cliente_id = $1', [c.id]);
  assert.deepEqual(tk.map((x) => [x.novo, x.hash]), [[true, hash(r.corpo.ticket)]]);
  const login = await conta('entrar', { identificador: S.cli.email, senha: S.cli.cpf.slice(0, 6) });
  assert.equal(login.status, 200, 'entra com os 6 primeiros do CPF');
});

t.teste('repetir com a mesma chave (resposta perdida) devolve o MESMO ticket e não duplica nada', async () => {
  const r = await cadastrar(S.cli, S.r1.chave);
  assert.equal(r.status, 200); assert.equal(r.corpo.ticket, S.r1.corpo.ticket);
  const [{ n }] = await sql('select count(*)::int n from public.clientes where documento = $1', [S.cli.cpf]);
  assert.equal(n, 1);
});

t.teste('CPF já cadastrado: mesma resposta (formato e piso de tempo), cadastro existente intocado, digitado só no ticket', async () => {
  const outro = await PF({ nome: 'Nome Digitado Outro', cpf: S.cli.cpf });
  const r = await cadastrar(outro);
  assert.equal(r.status, 200); assert.deepEqual(Object.keys(r.corpo).sort(), ['ok', 'ticket']); assert.notEqual(r.corpo.ticket, S.r1.corpo.ticket);
  assert.ok(r.ms >= 880 && S.r1.ms >= 880, `piso de tempo: ${r.ms} / ${S.r1.ms} ms`);
  const [c] = await sql('select nome, email from public.clientes where id = $1', [S.c.id]);
  assert.deepEqual([c.nome, c.email], [S.cli.nome, S.cli.email.toLowerCase()]);
  const [tk] = await sql('select novo, dados_informados d from public.tickets_fluxo where hash = $1', [hash(r.corpo.ticket)]);
  assert.equal(tk.novo, false); assert.equal(tk.d.nome, 'Nome Digitado Outro');
});

t.teste('e-mail de outra conta com CPF novo: mesma resposta; cliente sem acesso, com pendência pra Prime', async () => {
  const c2 = await PF({ email: S.cli.email });
  const r = await cadastrar(c2);
  assert.equal(r.status, 200); assert.deepEqual(Object.keys(r.corpo).sort(), ['ok', 'ticket']);
  const [c] = await sql('select usuario_id, pendencias from public.clientes where documento = $1', [c2.cpf]);
  assert.equal(c.usuario_id, null); assert.deepEqual(c.pendencias, ['email_em_uso']);
});

t.teste('validações com as mensagens literais da cliente (nome, CPF, maioridade, WhatsApp)', async () => {
  const casos = [
    [{ nome: 'Isabela' }, 'nome', 'Informe seu nome completo.'],
    [{ cpf: '52998224724' }, 'cpf', 'CPF inválido. Confira o número informado.'],
    [{ dataNascimento: `${Number(new Date().getFullYear()) - 17}-01-01` }, 'dataNascimento', 'É necessário ter 18 anos ou mais para realizar uma solicitação.'],
    [{ telefone: '3155' }, 'telefone', 'Confira o número informado e tente novamente.'],
  ];
  for (const [extra, campo, msg] of casos) {
    const r = await cadastrar(await PF(extra));
    assert.equal(r.status, 400, campo); assert.equal(r.corpo.erro.codigo, 'DADOS_INVALIDOS'); assert.equal(r.corpo.erro.detalhes[campo], msg);
  }
});

t.teste('isca preenchida: resposta de sucesso com ticket falso e nada gravado', async () => {
  const c = await PF();
  const r = await cadastrar(c, undefined, { hp: 'robo' });
  assert.equal(r.status, 200); assert.match(r.corpo.ticket, /^[0-9a-f]{64}$/);
  assert.equal((await sql('select count(*)::int n from public.clientes where documento = $1', [c.cpf]))[0].n, 0);
});

t.teste('endereços: a cliente lista os ativos e substitui (o anterior fica inativo, vinculado); outra cliente não mexe; fora da área recusado', async () => {
  const eu = await entrar({ email: S.cli.email, senha: S.cli.cpf.slice(0, 6) });
  const [e1] = await sql(`insert into public.enderecos (cliente_id, cep, logradouro, numero, bairro, cidade, uf, tipo_imovel, principal, ficticio)
    values ($1, '30130010', 'Rua Fictícia', '10', 'Centro', 'Belo Horizonte', 'MG', 'Casa', true, true) returning id`, [S.c.id]);
  let { data, error } = await eu.rpc('meus_enderecos');
  assert.ifError(error); assert.deepEqual(data.map((x) => x.id), [e1.id]);
  const novo = { cep: '32010000', logradouro: 'Avenida Exemplo', numero: '500', bairro: 'Centro', cidade: 'Contagem', uf: 'MG', tipoImovel: 'Apartamento', pontoReferencia: 'Perto da praça' };
  ({ data, error } = await eu.rpc('substituir_endereco', { p_id: e1.id, p_dados: { endereco: novo, apelido: 'Minha casa' }, p_chave: `sub-${randomUUID()}` }));
  assert.ifError(error); assert.equal(data.apelido, 'Minha casa'); assert.equal(data.principal, true);
  const [ant] = await sql('select ativo, principal, substituido_por, inativado_motivo from public.enderecos where id = $1', [e1.id]);
  assert.deepEqual([ant.ativo, ant.principal, ant.substituido_por, ant.inativado_motivo], [false, false, data.id, 'substituido']);
  ({ data } = await eu.rpc('meus_enderecos'));
  assert.deepEqual(data.map((x) => x.apelido), ['Minha casa'], 'o substituído não aparece');
  const fora = await eu.rpc('substituir_endereco', { p_id: data[0].id, p_dados: { endereco: { ...novo, cep: '01001000', cidade: 'São Paulo', uf: 'SP' } }, p_chave: `sub-${randomUUID()}` });
  assert.equal(fora.error?.message, 'REGIAO_NAO_ATENDIDA');
  // outra cliente (a do e-mail em uso não tem acesso; cria uma nova)
  const c3 = await PF(); await cadastrar(c3);
  const outra = await entrar({ email: c3.email, senha: c3.cpf.slice(0, 6) });
  const alheio = await outra.rpc('substituir_endereco', { p_id: data[0].id, p_dados: { endereco: novo }, p_chave: `sub-${randomUUID()}` });
  assert.equal(alheio.error?.message, 'NAO_ENCONTRADO');
  const anon = await anonimo().rpc('meus_enderecos');
  assert.ok(anon.error, 'anônimo não lista endereços');
  const conteudo = await anonimo().rpc('conteudo_agendamento');
  assert.ifError(conteudo.error); assert.ok(conteudo.data.tiposImovel.residencial.includes('Apartamento'));
});

// ---------------------------------------------------------------- V5: cotação e envio
const { VERSAO_CONDICOES, VERSAO_LEGAL } = await import('../src/config/legal.js');
const { proximaDataSemTaxa } = await import('./fixtures/seed.js');
const { CONFIG_PRECOS } = await import('../src/config/precos.js');
const { dataNoFuso, somarDias } = await import('../src/domain/calendario.js');
const HOJE = dataNoFuso(new Date().toISOString());
const D1 = proximaDataSemTaxa(HOJE, 5, CONFIG_PRECOS);
const ENDN = { cep: '30130010', logradouro: 'Rua Fictícia', numero: '10', bairro: 'Savassi', cidade: 'Belo Horizonte', uf: 'MG', tipoImovel: 'Apartamento' };
const CAR = { metragem: 45, ambientes: { quartos: 1 }, animais: { tem: false } };
const PED = (extra = {}, at = {}) => ({ segmento: 'residencial', modalidade: 'avulsa',
  atendimentos: [{ servico: 'residencial', caracteristicas: CAR, duracaoHoras: 4, data: D1, horaInicio: '08:30', endereco: { ref: 'novo:0' }, localRefeicao: true, ...at }], ...extra });
const ACEITE = { condicoes: VERSAO_CONDICOES, legal: VERSAO_LEGAL, leuTermos: true };
async function cadastroComTicket(extra = {}) { const c = await PF(extra); const r = await cadastrar(c); return { c, ticket: r.corpo.ticket }; }
const rpcAnon = async (nome, args) => { const { data, error } = await anonimo().rpc(nome, args); return error ? { erro: error.message, detalhes: error.details, hint: error.hint } : { ok: data }; };

t.teste('V5 cotação pelo ticket: valor, parcelas e "Novo endereço no pacote"; sem ticket nem login, endereço salvo não entra', async () => {
  const { ticket } = await cadastroComTicket();
  S.ticketNovo = ticket;
  const c = await rpcAnon('cotar_v3', { p_dados: { ticket, pedido: PED(), enderecosNovos: { 'novo:0': { ...ENDN, uso: 'salvar', apelido: 'Casa' } } } });
  assert.ok(c.ok, JSON.stringify(c)); assert.equal(c.ok.totalCentavos, 17500); assert.equal(c.ok.parcelas[0].parcela, 'integral'); assert.equal(c.ok.pacoteEnderecoNovo, false);
  const p2 = PED({ modalidade: 'pacote', frequencia: 'semanal' });
  p2.atendimentos.push({ ...p2.atendimentos[0], data: somarDias(D1, 7), endereco: { ref: 'novo:1' } });
  const c2 = await rpcAnon('cotar_v3', { p_dados: { ticket, pedido: p2, enderecosNovos: { 'novo:0': { ...ENDN, uso: 'salvar' }, 'novo:1': { ...ENDN, numero: '20', uso: 'unico' } } } });
  assert.ok(c2.ok, JSON.stringify(c2)); assert.equal(c2.ok.pacoteEnderecoNovo, true); assert.deepEqual(c2.ok.parcelas.map((x) => x.parcela), ['metade_1', 'metade_2']);
  const salvo = await rpcAnon('cotar_v3', { p_dados: { pedido: PED({}, { endereco: { ref: `salvo:${S.c.id}` } }) } });
  assert.equal(salvo.erro, 'DADOS_INVALIDOS');
});

t.teste('V5 envio pelo ticket (CPF novo): pedido com número, endereço salvo como principal, evidência do aceite, ticket de uso único, nenhuma cobrança', async () => {
  const dados = { ticket: S.ticketNovo, pedido: PED(), enderecosNovos: { 'novo:0': { ...ENDN, uso: 'salvar', apelido: 'Casa' } }, origem: { origem: 'indicacao', quemIndicou: 'Vizinha' }, aceite: ACEITE, valorEsperadoCentavos: 17500 };
  const k = `env-${randomUUID()}`;
  const r = await rpcAnon('solicitar_v3', { p_dados: dados, p_chave: k });
  assert.ok(r.ok, JSON.stringify(r)); assert.ok(r.ok.pedido.numero > 0);
  const r2 = await rpcAnon('solicitar_v3', { p_dados: dados, p_chave: k });
  assert.equal(r2.ok?.pedido?.id, r.ok.pedido.id, 'mesma chave, mesmo pedido');
  const outra = await rpcAnon('solicitar_v3', { p_dados: dados, p_chave: `env-${randomUUID()}` });
  assert.equal(outra.erro, 'ATOR_SEM_PERMISSAO', 'ticket usado não envia de novo');
  const [p] = await sql('select status, modalidade, origem_cliente o, numero_solicitacao n, pacote_endereco_novo f, total_centavos t from public.pedidos where id = $1', [r.ok.pedido.id]);
  assert.deepEqual([p.status, p.modalidade, p.o, Number(p.n), p.f, Number(p.t)], ['solicitado', 'avulsa', { origem: 'indicacao', quemIndicou: 'Vizinha' }, r.ok.pedido.numero, false, 17500]);
  assert.equal((await sql('select count(*)::int n from public.pagamentos where pedido_id = $1', [r.ok.pedido.id]))[0].n, 0, 'envio não gera cobrança (item 37)');
  const [a] = await sql(`select a.servico, to_char(a.hora_inicio, 'HH24:MI') h, a.local_refeicao, a.duracao_recomendada_horas rec, e.apelido, e.principal, e.ativo, e.uso_unico
    from public.atendimentos a join public.enderecos e on e.id = a.endereco_id where a.pedido_id = $1`, [r.ok.pedido.id]);
  assert.deepEqual([a.servico, a.h, a.local_refeicao, a.rec, a.apelido, a.principal, a.ativo, a.uso_unico], ['residencial', '08:30', true, 4, 'Casa', true, true, false]);
  const [ev] = await sql('select versao_condicoes vc, versao_termos_uso vt, hash_aceite h, user_agent ua from public.aceites_solicitacao where pedido_id = $1', [r.ok.pedido.id]);
  assert.equal(ev.vc, VERSAO_CONDICOES); assert.equal(ev.vt, VERSAO_LEGAL); assert.match(ev.h, /^[0-9a-f]{64}$/); assert.ok(ev.ua, 'user agent registrado');
});

t.teste('V5 envio pelo ticket de CPF já cadastrado: vinculado sem mexer na conta; endereço "salvo" vira uso único; flag de pacote', async () => {
  const { ticket } = await cadastroComTicket({ cpf: S.cli.cpf, nome: 'Outro Digitado' });
  const p2 = PED({ modalidade: 'pacote', frequencia: 'semanal' });
  p2.atendimentos.push({ ...p2.atendimentos[0], data: somarDias(D1, 7) });
  const cot = await rpcAnon('cotar_v3', { p_dados: { ticket, pedido: p2, enderecosNovos: { 'novo:0': { ...ENDN, numero: '33', uso: 'salvar', apelido: 'X' } } } });
  const r = await rpcAnon('solicitar_v3', { p_dados: { ticket, pedido: p2, enderecosNovos: { 'novo:0': { ...ENDN, numero: '33', uso: 'salvar', apelido: 'X' } }, aceite: ACEITE, valorEsperadoCentavos: cot.ok.totalCentavos }, p_chave: `env-${randomUUID()}` });
  assert.ok(r.ok, JSON.stringify(r));
  const [p] = await sql('select cliente_id, dados_informados d, pacote_endereco_novo f from public.pedidos where id = $1', [r.ok.pedido.id]);
  assert.equal(p.cliente_id, S.c.id); assert.equal(p.d.nome, 'Outro Digitado'); assert.equal(p.f, true);
  const ends = await sql(`select e.ativo, e.uso_unico, e.apelido from public.enderecos e where e.cliente_id = $1 and e.numero = '33'`, [S.c.id]);
  assert.deepEqual(ends, [{ ativo: false, uso_unico: true, apelido: null }]);
});

t.teste('V5 cliente logada: endereço salvo, valor conferido (preço mudou recusa), aceite obrigatório e versão vigente', async () => {
  const eu = await entrar({ email: S.cli.email, senha: S.cli.cpf.slice(0, 6) });
  const [{ id }] = await sql('select id from public.enderecos where cliente_id = $1 and ativo order by principal desc limit 1', [S.c.id]);
  const base = { pedido: PED({}, { endereco: { ref: `salvo:${id}` } }), enderecosNovos: {}, aceite: ACEITE };
  const cot = await eu.rpc('cotar_v3', { p_dados: base });
  assert.ifError(cot.error);
  let e = await eu.rpc('solicitar_v3', { p_dados: { ...base, valorEsperadoCentavos: cot.data.totalCentavos - 1 }, p_chave: `env-${randomUUID()}` });
  assert.equal(e.error?.message, 'CONDICAO_NAO_ATENDIDA'); assert.equal(JSON.parse(e.error.hint).precoMudou, true);
  e = await eu.rpc('solicitar_v3', { p_dados: { ...base, aceite: { ...ACEITE, leuTermos: false }, valorEsperadoCentavos: cot.data.totalCentavos }, p_chave: `env-${randomUUID()}` });
  assert.equal(e.error?.message, 'CONDICAO_NAO_ATENDIDA');
  e = await eu.rpc('solicitar_v3', { p_dados: { ...base, aceite: { ...ACEITE, condicoes: '2026-09-29' }, valorEsperadoCentavos: cot.data.totalCentavos }, p_chave: `env-${randomUUID()}` });
  assert.equal(e.error?.message, 'CONDICAO_NAO_ATENDIDA');
  const ok = await eu.rpc('solicitar_v3', { p_dados: { ...base, valorEsperadoCentavos: cot.data.totalCentavos }, p_chave: `env-${randomUUID()}` });
  assert.ifError(ok.error);
  const sem = await rpcAnon('solicitar_v3', { p_dados: { ...base, valorEsperadoCentavos: 1 }, p_chave: `env-${randomUUID()}` });
  assert.equal(sem.erro, 'ATOR_SEM_PERMISSAO', 'sem login e sem ticket não envia');
});

// ---------------------------------------------------------------- V6: confirmação, parcelas, rotina, painel
const PRIME_ADM = await entrar(await criarUsuario('v3-adm', 'prime_admin'));
const PRIME_ATD = await entrar(await criarUsuario('v3-atd', 'prime_atendimento'));
const rpcP = async (c, nome, args) => { const { data, error } = await c.rpc(nome, args); if (error) throw Object.assign(new Error(`${nome}: ${error.message} ${error.details || ''}`), { codigo: error.message }); return data; };
const porta = criarPortaPg({ transacao: (fn) => transacao(fn), urlSite: 'https://turno-agendamento-v3.prime-limpeza.pages.dev/' });
const provedores = criarProvedores({ ambiente: 'homologacao', fetch });
/** Relógio do motor: agora, ou o próximo horário comercial (à noite o horário silencioso segura as mensagens até 8h;
 * mesma regra do testa-f2-preview). Sem isso o teste falhava quando rodava depois das 20h. */
function agoraComercial() {
  const t = Date.now() + 10000;
  const hora = (x) => Number(new Date(x).toLocaleString('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' }));
  const dom = new Date(t).toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short' }) === 'Sun';
  if (hora(t) >= 8 && hora(t) < 20 && !dom) return new Date(t).toISOString();
  let d = dataNoFuso(new Date(t).toISOString());
  if (hora(t) >= 8) d = somarDias(d, 1);
  while (new Date(`${d}T12:00:00Z`).getUTCDay() === 0 || CONFIG_PRECOS.feriados.includes(d)) d = somarDias(d, 1);
  return new Date(`${d}T10:00:00-03:00`).toISOString();
}
async function mensagemDa(regra, pedidoId) {
  for (let i = 0; i < 8; i++) {
    await tique({ porta, provedores, agoraISO: agoraComercial(), ambiente: provedores.ambiente, escopo: [pedidoId] });
    const [m] = await sql(`select e.estado, e.motivo, m.conteudo from public.automacao_execucoes e left join public.mensagens m on m.execucao_id = e.id
                            where e.regra = $1 and e.contexto ->> 'pedidoId' = $2 order by m.conteudo nulls last limit 1`, [regra, pedidoId]);
    if (m && (m.conteudo || m.estado === 'cancelada')) return m;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}
async function enviarPeloTicket(pedido, extra = {}) {
  const { ticket } = await cadastroComTicket();
  const dados = { ticket, pedido, enderecosNovos: { 'novo:0': { ...ENDN, numero: String(100 + Math.floor(Math.random() * 800)), uso: 'salvar' } }, ...extra };
  const cot = await rpcAnon('cotar_v3', { p_dados: dados });
  assert.ok(cot.ok, JSON.stringify(cot));
  const r = await rpcAnon('solicitar_v3', { p_dados: { ...dados, aceite: ACEITE, valorEsperadoCentavos: cot.ok.totalCentavos }, p_chave: `env-${randomUUID()}` });
  assert.ok(r.ok, JSON.stringify(r));
  return { cot: cot.ok, pedidoId: r.ok.pedido.id, numero: r.ok.pedido.numero };
}
const pgs = (id) => sql(`select parcela, valor_centavos::int v, to_char(vence_em, 'YYYY-MM-DD') vence, to_char(marco_data, 'YYYY-MM-DD') marco, status, id from public.pagamentos where pedido_id = $1 order by vence_em`, [id]);
const datasPacote = (n) => Array.from({ length: n }, (_, i) => somarDias(D1, 7 * i));

t.teste('V6 avulsa: confirmação gera uma cobrança integral; C01 leva o número da solicitação; pagar confirma a diária', async () => {
  const r = await enviarPeloTicket(PED());
  const c01 = await mensagemDa('C01', r.pedidoId);
  assert.match(c01?.conteudo || '', new RegExp(`nº ${String(r.numero).padStart(6, '0')}\\)`), JSON.stringify(c01));
  const conf = await rpcP(PRIME_ATD, 'confirmar_disponibilidade', { p_id: r.pedidoId, p_dados: {}, p_chave: `cd-${randomUUID()}` });
  assert.equal(conf.pedido.status, 'aguardando_pagamento');
  const g = await pgs(r.pedidoId);
  assert.deepEqual(g.map((x) => [x.parcela, x.v]), [['integral', 17500]]);
  const pago = await rpcP(PRIME_ATD, 'confirmar_pagamento', { p_id: g[0].id, p_chave: `cp-${randomUUID()}` });
  assert.deepEqual([pago.pedido.status, pago.atendimentos.map((a) => a.status)], ['confirmado', ['confirmado']]);
});

t.teste('V6 pacote: só a 1ª metade na confirmação; a rotina gera a 2ª na data de envio (idempotente) com a C17; remarcação recalcula o marco', async () => {
  const datas = datasPacote(4);
  const ped = PED({ modalidade: 'pacote', frequencia: 'semanal' }); ped.atendimentos = datas.map((d) => ({ ...ped.atendimentos[0], data: d }));
  const r = await enviarPeloTicket(ped);
  await rpcP(PRIME_ATD, 'confirmar_disponibilidade', { p_id: r.pedidoId, p_dados: {}, p_chave: `cd-${randomUUID()}` });
  let g = await pgs(r.pedidoId);
  assert.deepEqual(g.map((x) => [x.parcela, x.v]), [['metade_1', Math.round(r.cot.totalCentavos / 2)]]);
  const prev = calcularParcelas({ modalidade: 'pacote', datas, totalCentavos: r.cot.totalCentavos }, CONFIG_PRECOS)[1];
  const antes = await admin.rpc('rodar_rotina_parcela2', { p_agora: `${somarDias(prev.envioEm, -1)}T11:05:00Z` });
  assert.ifError(antes.error);
  assert.equal((await pgs(r.pedidoId)).length, 1, 'antes da data de envio, nada');
  const cedo = await admin.rpc('rodar_rotina_parcela2', { p_agora: `${prev.envioEm}T10:00:00Z` });
  assert.equal(cedo.data, 0, '07:00 em SP: antes do horário da rotina');
  await admin.rpc('rodar_rotina_parcela2', { p_agora: `${prev.envioEm}T11:05:00Z` });
  await admin.rpc('rodar_rotina_parcela2', { p_agora: `${prev.envioEm}T11:20:00Z` });
  g = await pgs(r.pedidoId);
  assert.deepEqual(g.map((x) => [x.parcela, x.marco]), [['metade_1', null], ['metade_2', prev.marcoData]], 'uma 2ª parcela só');
  assert.equal(g[1].vence, prev.venceEm);
  const c17 = await mensagemDa('C17', r.pedidoId);
  assert.match(c17?.conteudo || '', /segunda parte do pagamento do seu pacote/, JSON.stringify(c17));
  // remarcar a diária do marco pra uma semana depois da última: o marco passa a ser a 3ª data da agenda vigente
  const [mar] = await sql(`select id from public.atendimentos where pedido_id = $1 and data = $2`, [r.pedidoId, prev.marcoData]);
  const nova = somarDias(datas[3], 7);
  await rpcP(PRIME_ATD, 'transicionar_atendimento', { p_id: mar.id, p_dados: { evento: 'reagendar', dados: { data: nova, horaInicio: '08:30' } }, p_chave: `rem-${randomUUID()}` });
  const vig = [datas[0], datas[1], datas[3], nova];
  const prev2 = calcularParcelas({ modalidade: 'pacote', datas: vig, totalCentavos: r.cot.totalCentavos }, CONFIG_PRECOS)[1];
  g = await pgs(r.pedidoId);
  assert.deepEqual([g[1].marco, g[1].vence], [prev2.marcoData, prev2.venceEm]);
  // pagar a 1ª metade confirma as diárias da primeira metade
  const p1 = await rpcP(PRIME_ATD, 'confirmar_pagamento', { p_id: g[0].id, p_chave: `cp-${randomUUID()}` });
  assert.deepEqual(p1.atendimentos.map((a) => a.status), ['confirmado', 'confirmado', 'agendado', 'agendado']);
});

t.teste('V7 revisão: cancelar depois da 1ª metade paga não gera 2ª negativa; pacote reduzido a uma data vira cobrança única e cobre a diária; cancelar o pedido não quebra', async () => {
  const datas = datasPacote(4);
  const ped = PED({ modalidade: 'pacote', frequencia: 'semanal' }); ped.atendimentos = datas.map((d) => ({ ...ped.atendimentos[0], data: d }));
  const cancelar = (id) => rpcP(PRIME_ATD, 'transicionar_atendimento', { p_id: id, p_dados: { evento: 'cancelar' }, p_chave: `can-${randomUUID()}` });
  const ats = (id) => sql('select id, status from public.atendimentos where pedido_id = $1 order by sequencia', [id]);
  // 1) 1ª metade paga e as duas últimas canceladas: a 2ª seria negativa -> a rotina não gera
  const r = await enviarPeloTicket(ped);
  await rpcP(PRIME_ATD, 'confirmar_disponibilidade', { p_id: r.pedidoId, p_dados: {}, p_chave: `cd-${randomUUID()}` });
  const [m1] = await pgs(r.pedidoId);
  await rpcP(PRIME_ATD, 'confirmar_pagamento', { p_id: m1.id, p_chave: `cp-${randomUUID()}` });
  for (const a of (await ats(r.pedidoId)).slice(2)) await cancelar(a.id);
  const prev = calcularParcelas({ modalidade: 'pacote', datas, totalCentavos: r.cot.totalCentavos }, CONFIG_PRECOS)[1];
  const rot = await admin.rpc('rodar_rotina_parcela2', { p_agora: `${prev.envioEm}T11:05:00Z` });
  assert.ifError(rot.error);
  assert.deepEqual((await pgs(r.pedidoId)).map((x) => x.parcela), ['metade_1'], 'sem 2ª parcela negativa');
  // 2) antes de pagar, cliente cancela o pedido com só a 1ª diária fora (era DATA_INVALIDA): e outro com três canceladas
  const r2 = await enviarPeloTicket(ped);
  await rpcP(PRIME_ATD, 'confirmar_disponibilidade', { p_id: r2.pedidoId, p_dados: {}, p_chave: `cd-${randomUUID()}` });
  for (const a of (await ats(r2.pedidoId)).slice(1)) await cancelar(a.id);
  const [g] = (await pgs(r2.pedidoId)).filter((x) => x.status !== 'cancelado');
  const [{ total }] = await sql('select total_centavos::int total from public.pedidos where id = $1', [r2.pedidoId]);
  assert.deepEqual([g.parcela, g.v], ['metade_1', total], 'a 1ª aberta vira o total');
  const pago = await rpcP(PRIME_ATD, 'confirmar_pagamento', { p_id: g.id, p_chave: `cp-${randomUUID()}` });
  assert.equal(pago.atendimentos[0].status, 'confirmado', 'a cobrança única cobre a diária restante');
  const can = await rpcP(PRIME_ATD, 'cancelar_pedido', { p_id: r2.pedidoId, p_dados: { motivo: 'Pedido da cliente: teste' }, p_chave: `cp-${randomUUID()}` });
  assert.ok(can.pedido, 'cancelar o pedido reduzido não dá erro');
});

t.teste('V7 revisão: cupom com limite usado por outro pedido depois do envio barra a confirmação; desconto de 100% confirma sem cobrança', async () => {
  const cod = `LIM${randomUUID().slice(0, 6).toUpperCase().replace(/-/g, '')}`;
  const c1 = await rpcP(PRIME_ADM, 'salvar_cupom', { p_dados: { codigo: cod, tipo: 'valor', valor: 1500, limiteDeUso: 1 } });
  const c2 = await rpcP(PRIME_ADM, 'salvar_cupom', { p_dados: { codigo: `${cod}Z`, tipo: 'percentual', valor: 100 } });
  try {
    const a = await enviarPeloTicket(PED({ cupom: cod }));
    const b = await enviarPeloTicket(PED({ cupom: cod }));
    await rpcP(PRIME_ATD, 'confirmar_disponibilidade', { p_id: a.pedidoId, p_dados: {}, p_chave: `cd-${randomUUID()}` });
    const neg = await PRIME_ATD.rpc('confirmar_disponibilidade', { p_id: b.pedidoId, p_dados: {}, p_chave: `cd-${randomUUID()}` });
    assert.equal(neg.error?.message, 'CONDICAO_NAO_ATENDIDA'); assert.match(neg.error?.details || '', /limite de usos/);
    const z = await enviarPeloTicket(PED({ cupom: `${cod}Z` }));
    assert.equal(z.cot.totalCentavos, 0);
    await rpcP(PRIME_ATD, 'confirmar_disponibilidade', { p_id: z.pedidoId, p_dados: {}, p_chave: `cd-${randomUUID()}` });
    assert.equal((await pgs(z.pedidoId)).length, 0, 'nada a cobrar');
    const [st] = await sql('select p.status, (select string_agg(status, \',\') from public.atendimentos where pedido_id = p.id) a from public.pedidos p where id = $1', [z.pedidoId]);
    assert.deepEqual([st.status, st.a], ['confirmado', 'confirmado']);
  } finally {
    for (const c of [c1, c2]) { await sql('delete from public.cupons_uso where cupom_id = $1', [c.id]); await sql('update public.pedidos set cupom_id = null where cupom_id = $1', [c.id]); await sql('delete from public.cupons where id = $1', [c.id]); }
  }
});

t.teste('V6 cupom consumido só na confirmação; condição comercial e faturamento só pela administração; faturamento confirma sem cobrança antecipada', async () => {
  await rpcP(PRIME_ADM, 'salvar_cupom', { p_dados: { codigo: `TESTE${randomUUID().slice(0, 6).toUpperCase().replace(/-/g, '')}`, tipo: 'valor', valor: 1500 } }).then(async (c) => {
    try {
      const atd = await PRIME_ATD.rpc('salvar_cupom', { p_dados: { codigo: 'NAOPODE1', tipo: 'valor', valor: 100 } });
      assert.equal(atd.error?.message, 'ATOR_SEM_PERMISSAO', 'atendimento não cria cupom');
      const r = await enviarPeloTicket(PED({ cupom: c.codigo }));
      assert.equal(r.cot.cupom.aplicado, true);
      assert.equal((await sql('select count(*)::int n from public.cupons_uso where cupom_id = $1', [c.id]))[0].n, 0, 'envio não consome');
      await rpcP(PRIME_ATD, 'confirmar_disponibilidade', { p_id: r.pedidoId, p_dados: {}, p_chave: `cd-${randomUUID()}` });
      assert.equal((await sql('select count(*)::int n from public.cupons_uso where cupom_id = $1', [c.id]))[0].n, 1);
    } finally { await sql('delete from public.cupons_uso where cupom_id = $1', [c.id]); await sql('update public.pedidos set cupom_id = null where cupom_id = $1', [c.id]); await sql('delete from public.cupons where id = $1', [c.id]); }
  });
  // empresa autorizada a faturar
  const emp = { tipo: 'empresa', responsavel: 'Carlos Lima Fictício', razaoSocial: 'Empresa Teste Ltda', cnpj: (await sql("select lpad((floor(random() * 1e8))::text, 8, '0') d"))[0].d, telefone: await celularLivre(), email: emailTeste('v3-emp') };
  const base12 = `${emp.cnpj}0001`; const dv = (b) => { let s2 = 0; let w = b.length - 7; for (const ch of b) { s2 += Number(ch) * w; w = w === 2 ? 9 : w - 1; } const r2 = s2 % 11; return r2 < 2 ? 0 : 11 - r2; };
  emp.cnpj = `${base12}${dv(base12)}${dv(base12 + dv(base12))}`;
  const cad = await cadastrar(emp);
  assert.equal(cad.status, 200, JSON.stringify(cad.corpo));
  const [cli] = await sql('select id from public.clientes where documento = $1', [emp.cnpj]);
  const negado = await PRIME_ATD.rpc('salvar_faturamento', { p_cliente: cli.id, p_dados: { autorizado: true } });
  assert.equal(negado.error?.message, 'ATOR_SEM_PERMISSAO');
  await rpcP(PRIME_ADM, 'salvar_faturamento', { p_cliente: cli.id, p_dados: { autorizado: true, forma: 'transferencia', prazoDias: 10, nf: true } });
  const eu = await entrar({ email: emp.email, senha: emp.cnpj.slice(0, 6) });
  const ped = PED({ segmento: 'empresa' }, { servico: 'empresarial' });
  const dados = { pedido: ped, enderecosNovos: { 'novo:0': { ...ENDN, tipoImovel: 'Escritório', uso: 'salvar' } } };
  const cot = await eu.rpc('cotar_v3', { p_dados: dados });
  assert.ifError(cot.error);
  assert.deepEqual(cot.data.faturamento, { prazoDias: 10, forma: 'transferencia', nf: true });
  const env = await eu.rpc('solicitar_v3', { p_dados: { ...dados, aceite: ACEITE, valorEsperadoCentavos: cot.data.totalCentavos }, p_chave: `env-${randomUUID()}` });
  assert.ifError(env.error);
  const conf = await rpcP(PRIME_ATD, 'confirmar_disponibilidade', { p_id: env.data.pedido.id, p_dados: {}, p_chave: `cd-${randomUUID()}` });
  assert.equal(conf.pedido.status, 'confirmado');
  const [f] = await sql(`select parcela, forma_faturamento, nf_emitir, brcode is null sem_pix from public.pagamentos where pedido_id = $1`, [env.data.pedido.id]);
  assert.deepEqual([f.parcela, f.forma_faturamento, f.nf_emitir, f.sem_pix], ['faturamento', 'transferencia', true, true]);
  const c02 = await mensagemDa('C02', env.data.pedido.id);
  assert.ok(!c02?.conteudo, `C02 não sai pra faturamento: ${JSON.stringify(c02)}`);
});

t.teste('V6 painel: cadastros sem solicitação, ficha com endereços, condição comercial (uma ativa, histórico), motivos padronizados viram código', async () => {
  const c = await PF(); await cadastrar(c);
  const [cli] = await sql('select id from public.clientes where documento = $1', [c.cpf]);
  const lista = await rpcP(PRIME_ATD, 'listar_cadastros_sem_solicitacao', { p_filtro: { limite: 200 } });
  assert.ok(lista.itens.some((x) => x.id === cli.id), 'cadastro sem solicitação listado');
  assert.ok(!lista.itens.some((x) => x.id === S.c.id), 'quem já solicitou não aparece');
  await rpcP(PRIME_ATD, 'definir_status_prospeccao', { p_cliente: cli.id, p_status: 'contatado' });
  await rpcP(PRIME_ADM, 'salvar_condicao_comercial', { p_cliente: cli.id, p_dados: { tipo: 'percentual', valor: 10, validade: 'recorrente', modalidades: ['pacote'], observacao: 'teste' } });
  await rpcP(PRIME_ADM, 'salvar_condicao_comercial', { p_cliente: cli.id, p_dados: { tipo: 'valor', valor: 5000, validade: 'uso_unico' } });
  const ficha = await rpcP(PRIME_ATD, 'ficha_cliente_v3', { p_cliente: S.c.id });
  assert.ok(ficha.enderecos.some((e) => e.usoUnico) && ficha.enderecos.some((e) => e.ativo), 'ativos e de uso único na ficha');
  const f2 = await rpcP(PRIME_ATD, 'ficha_cliente_v3', { p_cliente: cli.id });
  assert.deepEqual([f2.condicao.tipo, f2.condicoesAnteriores.length], ['valor', 1]);
  const ruim = await PRIME_ADM.rpc('salvar_condicao_comercial', { p_cliente: cli.id, p_dados: { tipo: 'percentual', valor: 150, validade: 'recorrente' } });
  assert.equal(ruim.error?.message, 'DADOS_INVALIDOS');
  const r = await enviarPeloTicket(PED());
  await rpcP(PRIME_ATD, 'recusar_solicitacao', { p_id: r.pedidoId, p_dados: { motivo: 'Sem disponibilidade na data ou no horário: sem profissional na manhã' }, p_chave: `rec-${randomUUID()}` });
  const [rec] = await sql('select recusa from public.pedidos where id = $1', [r.pedidoId]);
  assert.equal(rec.recusa.codigo, 'sem_disponibilidade');
});

await t.fim();
console.log(`# limpeza: ${await limparFicticios({ soEstaExecucao: true })} usuários fictícios removidos`);
await fecharSql();
