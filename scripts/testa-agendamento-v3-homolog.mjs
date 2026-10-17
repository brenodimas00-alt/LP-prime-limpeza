// Agendamento v3 contra a HOMOLOGAÇÃO (só fictícios). V2: cadastro ANTES do endereço pela function "conta" (itens 5 e 34):
// resposta igual pra CPF novo, CPF já cadastrado e e-mail de outra conta (sem revelar nada), mesmo piso de tempo, cadastro
// novo salvo com acesso pela regra padrão, existente intocado, repetição com a mesma chave devolve o mesmo ticket, isca,
// validações literais; endereços da cliente (listar, substituir, só a dona, fora da área); anônimo sem acesso às RPCs.
// Uso: bash scripts/cli.sh node22 scripts/testa-agendamento-v3-homolog.mjs
import { createHash, randomUUID } from 'node:crypto';
import { criarSuite, assert } from './lib-teste.mjs';
import { sql, fecharSql, limparFicticios, conta, emailTeste, cpfFicticio, entrar, anonimo } from './lib-supabase.mjs';

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

await t.fim();
console.log(`# limpeza: ${await limparFicticios({ soEstaExecucao: true })} usuários fictícios removidos`);
await fecharSql();
