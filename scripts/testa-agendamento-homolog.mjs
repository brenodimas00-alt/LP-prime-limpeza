// Agendamento v2 contra a HOMOLOGAÇÃO (só fictícios): solicitação SEM login pela function "conta" (spec 1.4). CPF novo,
// CPF já cadastrado e e-mail de outra conta dão a MESMA resposta; o existente é vinculado sem sobrescrever; conta nova entra
// pela regra padrão; aceite das condições e dos termos obrigatório; mesma chave não duplica; backfill do horário.
// Uso: bash scripts/cli.sh node22 scripts/testa-agendamento-homolog.mjs
import { criarSuite, assert } from './lib-teste.mjs';
import { sql, fecharSql, limparFicticios, conta, emailTeste, cpfFicticio, admin } from './lib-supabase.mjs';
import { CLIENTE_RESIDENCIAL, proximaDataPermitida, proximaDataSemTaxa } from './fixtures/seed.js';
import { CONFIG_PRECOS } from '../src/config/precos.js';
import { VERSAO_LEGAL, VERSAO_CONDICOES } from '../src/config/legal.js';
import { dataNoFuso } from '../src/domain/calendario.js';
import { randomUUID } from 'node:crypto';

const t = criarSuite('agendamento v2 sem login (homologação)');
await limparFicticios();
await sql('delete from privado.cadastros_ip'); // limite por IP acumula entre execuções da suíte

const DATA = proximaDataSemTaxa(dataNoFuso(new Date().toISOString()), 9, CONFIG_PRECOS);
async function celularLivre() {
  for (;;) {
    const tel = `319${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
    if (!(await sql('select 1 from public.clientes where telefone = $1', [tel])).length) return tel;
  }
}
const marca = () => `ap v2-${randomUUID().slice(0, 8)}`;
const solicitar = async (cliente, extra = {}) => {
  await sql('delete from privado.cadastros_ip'); // o limite por IP (10/h) é da produção; a bateria faz mais que isso
  const complemento = marca();
  const r = await conta('solicitar', {
    cliente, endereco: { ...CLIENTE_RESIDENCIAL.endereco, complemento },
    solicitacao: { tipoCliente: 'residencial', tipoServico: 'residencial', duracaoHoras: 4, metragem: 45, agenda: { modo: 'unica', datas: [DATA], horario: '09:30' } },
    aceiteCondicoes: VERSAO_CONDICOES, aceite: VERSAO_LEGAL, chave: `v2-${randomUUID()}`, valorEsperadoCentavos: 17500, ...extra,
  });
  const [p] = await sql(`select p.id, p.cliente_id, p.dados_informados, p.aceite_condicoes, p.endereco from public.pedidos p where p.endereco ->> 'complemento' = $1`, [complemento]);
  return { ...r, pedido: p };
};
const S = {};

t.teste('CPF novo: {enviado: true}; cliente com acesso pela regra padrão (6 primeiros do CPF); diária com hora e duração', async () => {
  S.email = emailTeste('v2-novo'); S.cpf = cpfFicticio();
  const cli = { ...CLIENTE_RESIDENCIAL, nome: 'Ana Nova Fictícia', email: S.email, cpf: S.cpf, telefone: await celularLivre() };
  const r = await solicitar(cli);
  assert.equal(r.status, 200, JSON.stringify(r.corpo)); assert.deepEqual(r.corpo, { enviado: true });
  S.resposta = r.corpo;
  const [c] = await sql('select id, usuario_id, nome, ficticio from public.clientes where documento = $1', [S.cpf]);
  assert.ok(c.usuario_id, 'acesso criado'); assert.equal(c.ficticio, true);
  S.cliente = c;
  assert.equal(r.pedido.cliente_id, c.id); assert.equal(r.pedido.aceite_condicoes.versao, VERSAO_CONDICOES);
  const [a] = await sql(`select to_char(hora_inicio, 'HH24:MI') h, duracao_minutos d, turno from public.atendimentos where pedido_id = $1`, [r.pedido.id]);
  assert.deepEqual([a.h, a.d, a.turno], ['09:30', 240, null]);
  const login = await conta('entrar', { identificador: S.email, senha: S.cpf.slice(0, 6) });
  assert.equal(login.status, 200, 'entra pelo e-mail com os 6 primeiros do CPF');
  const [{ n }] = await sql(`select count(*)::int n from public.aceites_termos where titular_id = $1 and versao = $2`, [c.id, VERSAO_LEGAL]);
  assert.equal(n, 1, 'aceite dos termos registrado');
});

t.teste('CPF já cadastrado: MESMA resposta; pedido vinculado ao cadastro existente; cadastro não sobrescrito; digitado em dados_informados', async () => {
  const r = await solicitar({ ...CLIENTE_RESIDENCIAL, nome: 'Outro Nome Digitado', email: emailTeste('v2-outro'), cpf: S.cpf, telefone: await celularLivre() });
  assert.equal(r.status, 200); assert.deepEqual(r.corpo, S.resposta, 'resposta idêntica: não revela que o CPF existe');
  assert.equal(r.pedido.cliente_id, S.cliente.id);
  assert.equal(r.pedido.dados_informados.nome, 'Outro Nome Digitado');
  const [c] = await sql('select nome, email from public.clientes where id = $1', [S.cliente.id]);
  assert.deepEqual([c.nome, c.email], [S.cliente.nome, S.email]);
});

t.teste('e-mail de outra conta com CPF novo: MESMA resposta; cliente sem acesso com a pendência pra Prime', async () => {
  const cpf = cpfFicticio();
  const r = await solicitar({ ...CLIENTE_RESIDENCIAL, nome: 'Bia Fictícia', email: S.email, cpf, telefone: await celularLivre() });
  assert.equal(r.status, 200); assert.deepEqual(r.corpo, S.resposta);
  const [c] = await sql('select usuario_id, pendencias from public.clientes where documento = $1', [cpf]);
  assert.deepEqual([c.usuario_id, c.pendencias], [null, ['email_em_uso']]);
});

t.teste('revisão do GPT: acesso criado pelo site que ficou órfão (vínculo falhou) é religado na repetição com a mesma chave', async () => {
  const email = emailTeste('v2-orfao'); const cpf = cpfFicticio(); const chave = `v2-${randomUUID()}`; const complemento = marca();
  const corpo = {
    cliente: { ...CLIENTE_RESIDENCIAL, nome: 'Orfã Fictícia', email, cpf, telefone: await celularLivre() }, endereco: { ...CLIENTE_RESIDENCIAL.endereco, complemento },
    solicitacao: { tipoCliente: 'residencial', tipoServico: 'residencial', duracaoHoras: 4, metragem: 45, agenda: { modo: 'unica', datas: [DATA], horario: '09:30' } },
    aceiteCondicoes: VERSAO_CONDICOES, valorEsperadoCentavos: 17500,
  };
  // 1ª tentativa: o banco grava e pede o acesso; o Auth cria o usuário, mas o vínculo "falha" (não é chamado)
  const [{ r }] = await sql('select public.conta_solicitar($1::text::jsonb, $2) r', [JSON.stringify(corpo), chave]);
  assert.equal(r.criarAcesso, true);
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'Qualquer-Senha-1', email_confirm: true, user_metadata: { origem: 'site', ficticio: true } });
  assert.ok(!error, error?.message);
  // repetição pela function com a MESMA chave: o banco devolve o mesmo resultado, o Auth diz "já existe" e o órfão é religado
  await sql('delete from privado.cadastros_ip');
  const rep = await conta('solicitar', { ...corpo, aceite: VERSAO_LEGAL, chave });
  assert.deepEqual([rep.status, rep.corpo], [200, { enviado: true }]);
  const [c] = await sql('select usuario_id, pendencias from public.clientes where documento = $1', [cpf]);
  assert.deepEqual([c.usuario_id, c.pendencias], [data.user.id, []]);
  const [{ n }] = await sql(`select count(*)::int n from public.pedidos where endereco ->> 'complemento' = $1`, [complemento]);
  assert.equal(n, 1, 'sem pedido duplicado');
});

t.teste('sem o valor da revisão: recusado (a pessoa precisa saber por quanto)', async () => {
  const r = await solicitar({ ...CLIENTE_RESIDENCIAL, email: emailTeste('v2-valor'), cpf: cpfFicticio(), telefone: await celularLivre() }, { valorEsperadoCentavos: undefined });
  assert.deepEqual([r.status, r.corpo.erro.codigo, r.pedido], [400, 'DADOS_INVALIDOS', undefined]);
});

t.teste('sem aceite das condições ou dos termos: recusado antes de gravar; mesma chave repetida não duplica', async () => {
  const cli = { ...CLIENTE_RESIDENCIAL, email: emailTeste('v2-aceite'), cpf: cpfFicticio(), telefone: await celularLivre() };
  const a = await solicitar(cli, { aceiteCondicoes: undefined });
  assert.deepEqual([a.status, a.corpo.erro?.codigo, a.pedido], [409, 'CONDICAO_NAO_ATENDIDA', undefined], JSON.stringify(a.corpo));
  const b = await solicitar(cli, { aceite: undefined });
  assert.deepEqual([b.status, b.corpo.erro.codigo], [400, 'DADOS_INVALIDOS']);
  const chave = `v2-${randomUUID()}`; const complemento = marca();
  const corpo = { cliente: cli, endereco: { ...CLIENTE_RESIDENCIAL.endereco, complemento }, solicitacao: { tipoCliente: 'residencial', tipoServico: 'residencial', duracaoHoras: 6, agenda: { modo: 'unica', datas: [DATA], horario: '08:00' } }, aceiteCondicoes: VERSAO_CONDICOES, aceite: VERSAO_LEGAL, chave, valorEsperadoCentavos: 20300 };
  await sql('delete from privado.cadastros_ip');
  const [r1, r2] = await Promise.all([conta('solicitar', corpo), conta('solicitar', corpo)]);
  assert.deepEqual([r1.status, r2.status], [200, 200], JSON.stringify([r1.corpo, r2.corpo]));
  const [{ n }] = await sql(`select count(*)::int n from public.pedidos where endereco ->> 'complemento' = $1`, [complemento]);
  assert.equal(n, 1, 'uma solicitação só');
});

t.teste('horário fora do expediente e domingo recusados no servidor (DATA_INVALIDA)', async () => {
  const cli = { ...CLIENTE_RESIDENCIAL, email: emailTeste('v2-hora'), cpf: cpfFicticio(), telefone: await celularLivre() };
  const r = await solicitar(cli, { solicitacao: { tipoCliente: 'residencial', tipoServico: 'residencial', duracaoHoras: 8, agenda: { modo: 'unica', datas: [DATA], horario: '11:00' } } });
  assert.deepEqual([r.status, r.corpo.erro.codigo], [400, 'DATA_INVALIDA']);
  let dom = DATA; while (new Date(`${dom}T12:00:00Z`).getUTCDay() !== 0) dom = proximaDataPermitida(dom, 1, { diasBloqueados: [], datasBloqueadas: [] });
  const d = await solicitar(cli, { solicitacao: { tipoCliente: 'residencial', tipoServico: 'residencial', duracaoHoras: 4, agenda: { modo: 'unica', datas: [dom], horario: '08:00' } } });
  assert.deepEqual([d.status, d.corpo.erro.codigo], [400, 'DATA_INVALIDA']);
});

t.teste('backfill: toda diária tem hora e duração; turno antigo virou 08:00/13:00 e a duração a da carga', async () => {
  const [{ sem }] = await sql('select count(*)::int sem from public.atendimentos where hora_inicio is null or duracao_minutos is null');
  assert.equal(sem, 0);
  const errados = await sql(`select count(*)::int n from public.atendimentos a join public.pedidos p on p.id = a.pedido_id
    where a.turno is not null and (a.hora_inicio <> case a.turno when 'tarde' then time '13:00' else time '08:00' end
      or a.duracao_minutos <> ((p.pacote ->> 'duracaoHoras')::int + coalesce((p.pacote ->> 'horasExtras')::int, 0)) * 60)`);
  assert.equal(errados[0].n, 0);
});

const falhas = await t.fim();
console.log(`# limpeza: ${await limparFicticios({ soEstaExecucao: true })} usuários fictícios removidos`);
await fecharSql();
process.exit(falhas ? 1 : 0);
