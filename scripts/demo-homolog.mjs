// I1: homologação pra cliente. Usuários de demonstração (1 prime_admin pra Isa, 1 diarista aprovada, 1 cliente) e
// pedidos fictícios em vários estados. Idempotente; --reset apaga SÓ o que é da demonstração e semeia de novo.
// Nunca toca cliente importado nem dado real: só linhas ficticio = true ligadas às contas @prime-homolog.example.
// Credenciais: geradas uma vez, guardadas no ~/.prime-env (600, fora do repo) e impressas SÓ no terminal.
// Uso: bash scripts/cli.sh node22 scripts/demo-homolog.mjs [--reset] [--sem-senhas]
import { randomBytes } from 'node:crypto';
import { appendFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { admin, anonimo, sql, transacao, fecharSql, senhaDerivada, cpfFicticio, conta, ENV } from './lib-supabase.mjs';
import { criarAdapterSupabase } from '../src/services/adapters/supabase.js';
import { ARQUIVOS } from './fixtures/arquivos.mjs';
import { proximaDataPermitida } from './fixtures/seed.js';
import { dataNoFuso, somarDias } from '../src/domain/calendario.js';
import { CONFIG_PRECOS } from '../src/config/precos.js';

const DOMINIO = 'prime-homolog.example'; // .example: reservado, nunca entrega e-mail
const EMAIL = { admin: `isa.admin@${DOMINIO}`, diarista: `diarista.demo@${DOMINIO}`, cliente: `cliente.demo@${DOMINIO}` };
const reset = process.argv.includes('--reset');
const mostrarSenhas = !process.argv.includes('--sem-senhas');

// ---------- credenciais estáveis (fora do repo) ----------
function segredo(nome, gerar) {
  if (ENV[nome]) return ENV[nome];
  const v = gerar();
  appendFileSync(`${homedir()}/.prime-env`, `${nome}='${v}'\n`);
  chmodSync(`${homedir()}/.prime-env`, 0o600);
  ENV[nome] = v;
  return v;
}
const senhaForte = () => `Prime-${randomBytes(9).toString('base64url')}`;
const SENHA_ADMIN = segredo('DEMO_SENHA_ADMIN', senhaForte);
const SENHA_DIARISTA = segredo('DEMO_SENHA_DIARISTA', senhaForte);
async function documentoLivre(chave) {
  if (ENV[chave]) return ENV[chave];
  for (;;) {
    const cpf = cpfFicticio();
    const [{ n }] = await sql('select (select count(*) from public.clientes where documento = $1) + (select count(*) from public.diaristas where cpf = $1) n', [cpf]);
    if (!Number(n)) return segredo(chave, () => cpf);
  }
}
/** Telefone da cliente demo: nunca igual ao de outra cliente (celular repetido derruba o login por celular dela). */
async function telefoneLivre(chave) {
  const usado = async (tel) => (await sql(`select count(*)::int n from public.clientes c left join auth.users u on u.id = c.usuario_id
    where c.telefone = $1 and coalesce(u.email, '') not like $2`, [tel, `%@${DOMINIO}`]))[0].n > 0;
  if (ENV[chave] && !(await usado(ENV[chave]))) return ENV[chave];
  for (;;) {
    const tel = `3197${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
    if (await usado(tel)) continue;
    appendFileSync(`${homedir()}/.prime-env`, `${chave}='${tel}'\n`); // a última linha vale
    ENV[chave] = tel;
    await sql(`update public.clientes c set telefone = $1 from auth.users u where u.id = c.usuario_id and u.email = $2 and c.ficticio`, [tel, EMAIL.cliente]);
    return tel;
  }
}
const CPF_CLIENTE = await documentoLivre('DEMO_CPF_CLIENTE');
const CPF_DIARISTA = await documentoLivre('DEMO_CPF_DIARISTA');
const TEL_CLIENTE = await telefoneLivre('DEMO_TEL_CLIENTE');
const NASC_CLIENTE = '1987-03-15';

// ---------- limpeza da demonstração (só contas @prime-homolog.example, só ficticio) ----------
async function apagarDemo() {
  const us = (await sql(`select id from auth.users where email like $1 and raw_user_meta_data ->> 'demo' = 'true'`, [`%@${DOMINIO}`])).map((x) => x.id);
  if (!us.length) return 0;
  await transacao(async (q) => {
    const cli = (await q('select id, origem, ficticio from public.clientes where usuario_id = any($1::uuid[])', [us]));
    // trava de segurança: nada importado ou real entra aqui
    if (cli.some((c) => c.origem === 'importado' || !c.ficticio)) throw new Error('reset abortado: conta de demonstração ligada a cliente real/importado');
    const cids = cli.map((c) => c.id);
    const dia = (await q('select id from public.diaristas where ficticio and usuario_id = any($1::uuid[])', [us])).map((x) => x.id);
    const ped = (await q('select id from public.pedidos where ficticio and cliente_id = any($1::uuid[])', [cids])).map((x) => x.id);
    // diarista de demonstração num pedido de fora (real): não desfaz nada, para (revisão do GPT)
    const [{ fora }] = await q('select count(*)::int fora from public.atendimentos where diarista_id = any($1::uuid[]) and not (pedido_id = any($2::uuid[]))', [dia, ped]);
    if (fora) throw new Error(`reset abortado: a diarista de demonstração está em ${fora} diária(s) de pedido que não é da demonstração; troque a profissional no painel antes`);
    const ate = (await q('select id from public.atendimentos where pedido_id = any($1::uuid[])', [ped])).map((x) => x.id);
    // eventos e avisos: os dos pedidos da demonstração e os do cadastro (sem pedido); nada de pedido alheio
    await q(`delete from public.eventos where refs ->> 'pedidoId' = any($1::text[]) or refs ->> 'clienteId' = any($3::text[])
      or (refs ->> 'pedidoId' is null and refs ->> 'diaristaId' = any($2::text[]))`, [ped, dia, cids]);
    await q(`delete from public.notificacoes where refs ->> 'pedidoId' = any($1::text[]) or (refs ->> 'pedidoId' is null and refs ->> 'diaristaId' = any($2::text[]))`, [ped, dia]);
    await q('delete from public.avaliacoes where atendimento_id = any($1::uuid[])', [ate]);
    await q('delete from public.pagamentos where pedido_id = any($1::uuid[])', [ped]);
    await q('delete from public.atendimentos where pedido_id = any($1::uuid[])', [ped]);
    await q('delete from public.pedidos where id = any($1::uuid[])', [ped]);
    const docs = await q('select storage_path from public.documentos where diarista_id = any($1::uuid[])', [dia]);
    if (docs.length) await admin.storage.from('documentos-diaristas').remove(docs.map((d) => d.storage_path));
    await q('delete from public.documentos where diarista_id = any($1::uuid[])', [dia]);
    await q('delete from public.diaristas where id = any($1::uuid[])', [dia]);
    await q('delete from public.clientes where id = any($1::uuid[])', [cids]);
    await q('delete from public.acessos where user_id = any($1::uuid[])', [us]);
    const ids = [...cids, ...dia, ...ped, ...us].map(String);
    if (ids.length) await q(`delete from public.idempotencia where exists (select 1 from unnest($1::text[]) i where chave like '%' || i || '%' or resultado::text like '%' || i || '%')`, [ids]);
  }, { ator: 'reset_demo' });
  for (const id of us) await admin.auth.admin.deleteUser(id);
  return us.length;
}

// ---------- contas ----------
async function usuario(email, senhaDigitada, papel) {
  const [ja] = await sql('select id from auth.users where email = $1', [email]);
  if (ja) return ja.id;
  const { data, error } = await admin.auth.admin.createUser({
    email, password: senhaDerivada(senhaDigitada), email_confirm: true, user_metadata: { ficticio: true, demo: true, origem: 'site' },
  });
  if (error) throw new Error(`createUser ${email.split('@')[0]}: ${error.message}`);
  if (papel && papel !== 'cliente') await sql('update public.perfis set papel = $1 where user_id = $2', [papel, data.user.id]);
  return data.user.id;
}
async function sessao(email, senha, area) {
  const r = await conta('entrar', { email, senha, area });
  if (r.status !== 200) throw new Error(`entrar ${email.split('@')[0]}: ${r.status} ${r.corpo?.erro?.codigo}`);
  const c = anonimo();
  await c.auth.setSession(r.corpo.sessao);
  return c;
}

if (reset) console.log(`reset: ${await apagarDemo()} contas de demonstração apagadas (e só os dados delas)`);

const idAdmin = await usuario(EMAIL.admin, SENHA_ADMIN, 'prime_admin');
const idCliente = await usuario(EMAIL.cliente, CPF_CLIENTE.slice(0, 6));
const idDiaristaUser = await usuario(EMAIL.diarista, SENHA_DIARISTA);

const [cliExiste] = await sql('select id from public.clientes where usuario_id = $1', [idCliente]);
if (!cliExiste) {
  await sql(`select public.conta_cadastrar_cliente($1, $2::jsonb)`, [idCliente, JSON.stringify({
    tipo: 'residencial', nome: 'Cliente Demonstração', telefone: TEL_CLIENTE, email: EMAIL.cliente, cpf: CPF_CLIENTE, dataNascimento: NASC_CLIENTE,
    endereco: { cep: '30130010', logradouro: 'Rua Fictícia', numero: '100', complemento: '', bairro: 'Savassi', cidade: 'Belo Horizonte', uf: 'MG' },
  })]);
}

const sAdmin = await sessao(EMAIL.admin, SENHA_ADMIN, 'prime');
const sCliente = await sessao(EMAIL.cliente, CPF_CLIENTE.slice(0, 6), 'cliente');
let [dia] = await sql('select id, status from public.diaristas where usuario_id = $1', [idDiaristaUser]);
if (!dia) {
  const id = crypto.randomUUID();
  await sql('select public.conta_criar_rascunho_diarista($1, $2)', [idDiaristaUser, id]);
  await sql('select public.conta_senha_propria($1, true)', [idDiaristaUser]);
  dia = { id, status: 'rascunho' };
}
const sDiarista = await sessao(EMAIL.diarista, SENHA_DIARISTA, 'diarista');
const api = criarAdapterSupabase({ clientePara: async (s) => ({ prime: sAdmin, cliente: sCliente, diarista: sDiarista })[s?.ator] || anonimo() });
const P = { sessao: { ator: 'prime' } }; const C = { sessao: { ator: 'cliente' } }; const D = { sessao: { ator: 'diarista' } };
const k = (x) => `demo-${x}-${randomBytes(4).toString('hex')}`;

if (dia.status === 'rascunho') {
  for (const [tipo, arq] of [['cnh_frente', ARQUIVOS.png], ['cnh_verso', ARQUIVOS.png], ['foto_perfil', ARQUIVOS.png], ['comprovante_residencia', ARQUIVOS.pdf], ['antecedentes', ARQUIVOS.pdf]]) {
    await api.salvarDocumento({ diaristaId: dia.id, tipo, nomeArquivo: `${tipo}.${arq.ext}`, mime: arq.mime, tamanho: arq.bytes.length, conteudo: arq.bytes }, { ...D, chave: k('doc') });
  }
  await api.cadastrarDiarista({
    id: dia.id, nome: 'Diarista Demonstração', cpf: CPF_DIARISTA, telefone: '31966661111', email: EMAIL.diarista, dataNascimento: '1984-06-10',
    endereco: { cep: '30140071', logradouro: 'Rua Modelo', numero: '45', complemento: '', bairro: 'Funcionários', cidade: 'Belo Horizonte', uf: 'MG' },
    experienciaAnos: 7, disponibilidade: { dias: [1, 2, 3, 4, 5], turnos: ['manha', 'tarde', 'integral'], regioes: ['BH - Centro-Sul', 'BH - Pampulha'] },
    identidade: 'cnh', aceiteTermos: true,
  }, { ...D, chave: k('cad') });
  dia.status = 'pendente';
}
if (dia.status === 'pendente') await api.aprovarDiarista(dia.id, {}, { ...P, chave: k('apr') });

// ---------- pedidos de demonstração (só se a cliente demo ainda não tem) ----------
const [{ n: temPedidos }] = await sql('select count(*)::int n from public.pedidos p join public.clientes c on c.id = p.cliente_id where c.usuario_id = $1', [idCliente]);
if (!temPedidos) {
  const hoje = dataNoFuso(new Date().toISOString());
  const dia1 = (d) => { let x = proximaDataPermitida(d, 1, CONFIG_PRECOS); while (new Date(`${x}T12:00:00Z`).getUTCDay() === 6 || CONFIG_PRECOS.feriados.includes(x)) x = proximaDataPermitida(x, 1, CONFIG_PRECOS); return x; };
  const d1 = dia1(somarDias(hoje, 2)); const d2 = dia1(somarDias(hoje, 5)); const d3 = dia1(somarDias(hoje, 8)); const d4 = dia1(somarDias(hoje, 12));
  const cli = { tipo: 'residencial', nome: 'Cliente Demonstração', telefone: TEL_CLIENTE, email: EMAIL.cliente, cpf: CPF_CLIENTE, dataNascimento: NASC_CLIENTE,
    endereco: { cep: '30130010', logradouro: 'Rua Fictícia', numero: '100', complemento: '', bairro: 'Savassi', cidade: 'Belo Horizonte', uf: 'MG' } };
  const pedir = (data, turno, pacote) => api.confirmarAutoagendamento({ cliente: cli, pacote, primeiraData: data, turno, preferenciaProfissional: '' }, { ...C, chave: k('ped') });
  const AVULSO = { tipoServico: 'residencial', duracaoHoras: 4, metragem: 60, quantidadeDiarias: 1, frequencia: 'avulso' };
  // 1) solicitação aguardando a Prime
  await pedir(d4, 'manha', AVULSO);
  // 2) disponibilidade confirmada, aguardando pagamento
  const b2 = await pedir(d3, 'tarde', { ...AVULSO, duracaoHoras: 6 });
  await api.confirmarDisponibilidade(b2.pedido.id, {}, { ...P, chave: k('disp') });
  // 3) pago, confirmado e com a profissional designada
  const b3 = await pedir(d2, 'manha', AVULSO);
  const [g3] = (await api.confirmarDisponibilidade(b3.pedido.id, {}, { ...P, chave: k('disp') })).pagamentos;
  await api.informarPagamento(g3.id, { ...C, chave: k('inf') });
  await api.confirmarPagamento(g3.id, { ...P, chave: k('conf') });
  await api.atribuirDiarista(b3.atendimentos[0].id, { diaristaId: dia.id }, { ...P, chave: k('atr') });
  // 4) pacote semanal de 4 diárias: primeira paga e atribuída, cliente avisou o pagamento da segunda
  const b4 = await pedir(d1, 'tarde', { ...AVULSO, frequencia: 'semanal', quantidadeDiarias: 4 });
  const cob4 = (await api.confirmarDisponibilidade(b4.pedido.id, {}, { ...P, chave: k('disp') })).pagamentos;
  await api.confirmarPagamento(cob4[0].id, { ...P, chave: k('conf') });
  await api.atribuirDiarista(b4.atendimentos[0].id, { diaristaId: dia.id }, { ...P, chave: k('atr') });
  if (cob4[1]) await api.informarPagamento(cob4[1].id, { ...C, chave: k('inf') });
  console.log('pedidos de demonstração: 4 (solicitação, aguardando pagamento, confirmado com profissional, pacote semanal)');
}

const [{ n: importados }] = await sql(`select count(*)::int n from public.clientes where origem = 'importado' and not ficticio`);
console.log(`base importada visível no painel: ${importados} clientes`);
console.log(`\nURL: https://turno-2026-09-23.prime-limpeza.pages.dev/`);
if (mostrarSenhas) {
  console.log('CREDENCIAIS (só aqui no terminal; guardadas no ~/.prime-env):');
  console.log(`  Prime (admin, Isa)  painel/entrar/    ${EMAIL.admin} / ${SENHA_ADMIN}`);
  console.log(`  Diarista aprovada   diarista/entrar/  ${EMAIL.diarista} / ${SENHA_DIARISTA}`);
  console.log(`  Cliente             entrar/           ${EMAIL.cliente} / ${CPF_CLIENTE.slice(0, 6)} (ou CPF ${CPF_CLIENTE} + nascimento 15031987)`);
}
await fecharSql();
