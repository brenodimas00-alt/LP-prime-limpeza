// B7: importação com planilha FICTÍCIA (gerada em pasta temporária, fora do repo) contra a homologação.
// Uso: bash scripts/cli.sh node22 scripts/testa-importacao.mjs
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { criarSuite, assert } from './lib-teste.mjs';
import { lerPlanilha, planejar, contar, executar, normalizarDocumento, lerEndereco, lerData, marcaDocumento as marcaDocumentoLimpeza } from './importa-clientes.mjs';
import { admin, conta, entrar, criarUsuario, emailTeste, sql, transacao, fecharSql, limparFicticios, cpfFicticio } from './lib-supabase.mjs';

const t = criarSuite('B7 importação (fictícia, homologação)');
await limparFicticios();

// ---------- regras puras ----------
t.teste('documento: zero à esquerda recomposto quando a planilha guardou como número; CNPJ com 14', () => {
  assert.equal(normalizarDocumento('1234567890', 'CPF'), '01234567890');
  assert.equal(normalizarDocumento('012.345.678-90', 'CPF'), '01234567890');
  assert.equal(normalizarDocumento('12345678000195', 'CNPJ'), '12345678000195');
  assert.equal(normalizarDocumento('', 'CPF'), null);
});

t.teste('data de nascimento: dd/mm/aaaa válida; ano negativo, data impossível e futura viram nula', () => {
  assert.equal(lerData('05/04/1985'), '1985-04-05');
  for (const d of ['05/04/-1985', '31/02/1990', '01/01/2999', 'x']) assert.equal(lerData(d), null, d);
});

t.teste('endereço: 5 partes com UF; UF ausente em cidade atendida vira MG inferido; curto vai pra revisão; vazio = sem endereço', () => {
  const a = lerEndereco('Rua Exemplo, 100, Savassi, Belo Horizonte, MG');
  assert.deepEqual([a.endereco.cidade, a.endereco.uf, a.pendencias], ['Belo Horizonte', 'MG', []]);
  const b = lerEndereco('Rua Exemplo, 100, Centro, Contagem, ');
  assert.deepEqual([b.endereco.uf, b.endereco.ufInferida, b.pendencias], ['MG', true, []]);
  assert.deepEqual(lerEndereco('Rua Solta, 5').pendencias, ['endereco_revisar']);
  assert.deepEqual(lerEndereco('').pendencias, ['sem_endereco']);
  assert.equal(lerEndereco('Rua X, 1, Bairro, Longe, ').pendencias[0], 'endereco_revisar');
});

// ---------- planilha fictícia ----------
const PASTA = mkdtempSync(join(tmpdir(), 'prime-importacao-teste-'));
const ARQ = join(PASTA, 'clientes-ficticios.xlsx');
let cpfZero = cpfFicticio(); while (!cpfZero.startsWith('0')) cpfZero = cpfFicticio();
const F = {
  zero: { doc: cpfZero, email: emailTeste('imp-zero') },
  semEmail: { doc: cpfFicticio(), email: '' },
  invalido: { doc: cpfFicticio(), email: 'sem-arroba.example.com' },
  dupDoc: { doc: cpfFicticio(), email: emailTeste('imp-dup') },
  mesmoEmail: emailTeste('imp-mesmo'),
  cnpj: { doc: '11222333000181', email: emailTeste('imp-cnpj') },
};
const docsFixture = [F.zero.doc, F.semEmail.doc, F.invalido.doc, F.dupDoc.doc, F.cnpj.doc];
const LINHAS = [
  ['CPF', F.zero.doc.slice(0, 3) + '.xxx', Number(F.zero.doc), 'Zélia Teste Importada', '05/04/1985', 'Rua Fictícia, 10, Savassi, Belo Horizonte, MG', F.zero.email, '31988887777', '2024-01-10 10:00:00'],
  ['CPF', '', F.semEmail.doc, 'Sem Email Teste', '-01/01/1980', 'Rua Fictícia, 11, Centro, Contagem, ', '', '31988887776', '2024-01-11 10:00:00'],
  ['CPF', '', F.invalido.doc, 'Email Ruim Teste', '01/01/1981', '', F.invalido.email, '0', '2024-01-12 10:00:00'],
  ['CPF', '', F.dupDoc.doc, 'Duplicada Antiga', '01/01/1982', 'Rua A, 1, B, Belo Horizonte, MG', emailTeste('imp-dup-antiga'), '31988887775', '2023-05-01 10:00:00'],
  ['CPF', '', F.dupDoc.doc, 'Duplicada Nova', '01/01/1982', 'Rua A, 1, B, Belo Horizonte, MG', F.dupDoc.email, '31988887775', '2025-05-01 10:00:00'],
  ['CPF', '', cpfFicticio(), 'Mesmo Email Um', '01/01/1983', 'Rua C, 2, D, Belo Horizonte, MG', F.mesmoEmail, '31988887774', '2024-02-01 10:00:00'],
  ['CPF', '', cpfFicticio(), 'Mesmo Email Dois', '01/01/1984', 'Rua C, 3, D, Belo Horizonte, MG', F.mesmoEmail, '31988887773', '2024-02-02 10:00:00'],
  ['CNPJ', '', F.cnpj.doc, 'Empresa Teste Importada Ltda', '', 'Av. Teste, 500, Centro, Betim, MG', F.cnpj.email, '3133334444', '2024-03-01 10:00:00'],
  ['', '', '', 'Sem Documento Teste', '', '', emailTeste('imp-sem-doc'), '', '2024-03-02 10:00:00'],
];
{
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Clientes');
  ws.addRow(['Tipo', 'CPF/CNPJ', 'CPF/CNPJ (só números)', 'Nome completo', 'Data de nascimento', 'Endereço', 'E-mail', 'Telefone', 'Cadastrado em', 'Pendências']);
  for (const l of LINHAS) ws.addRow([...l, '']);
  await wb.xlsx.writeFile(ARQ);
}
docsFixture.push(...LINHAS.slice(5, 7).map((l) => l[2]));
const reais = await sql('select count(*)::int n from public.clientes where documento = any($1) and not ficticio', [docsFixture]);
if (reais[0].n) throw new Error('documento fictício colidiu com a base real; rode de novo');

const linhas = await lerPlanilha(ARQ);
const plano = planejar(linhas);

t.teste('planejamento confere com a planilha: 9 linhas = 7 clientes + 1 repetida pra revisão + 1 sem documento', () => {
  const c = contar(linhas, plano);
  assert.equal(c.linhas, 9); assert.equal(c.clientes, 7); assert.equal(c.linhasRepetidasParaRevisao, 1);
  assert.deepEqual(c.ignorados, { sem_documento: 1 });
  assert.equal(c.comAcesso, 3, 'zero, duplicada nova e CNPJ');
  assert.deepEqual(c.semAcesso, { sem_email: 1, email_invalido: 1, email_repetido: 2 });
  assert.equal(c.confere, true);
  const dup = plano.clientes.find((x) => x.documento === F.dupDoc.doc);
  assert.equal(dup.nome, 'Duplicada Nova', 'fica a mais recente por "Cadastrado em"');
  assert.ok(dup.pendencias.includes('documento_repetido')); assert.equal(dup.importacao.duplicatas.length, 1);
  const zero = plano.clientes.find((x) => x.documento === F.zero.doc);
  assert.equal(zero.documento, cpfZero, 'zero à esquerda recomposto (célula numérica)');
  const semEmail = plano.clientes.find((x) => x.documento === F.semEmail.doc);
  assert.ok(semEmail.pendencias.includes('nascimento_invalido')); assert.equal(semEmail.dataNascimento, null);
  const ruim = plano.clientes.find((x) => x.documento === F.invalido.doc);
  assert.ok(ruim.pendencias.includes('telefone_invalido') && ruim.pendencias.includes('sem_endereco'));
  assert.equal(plano.clientes.find((x) => x.documento === F.cnpj.doc).tipo, 'empresa');
});

t.teste('e-mail já usado por outra conta (não importada) = importa sem acesso', () => {
  const p2 = planejar(linhas, { emailsEmUso: new Set([F.zero.email]) });
  const z = p2.clientes.find((x) => x.documento === F.zero.doc);
  assert.equal(z.acesso, false); assert.ok(z.pendencias.includes('email_em_uso'));
});

let r1;
t.teste('importação em homologação: cria 7 clientes e 3 acessos; rodar de novo não cria nada', async () => {
  r1 = await executar(plano, { ficticio: true });
  assert.deepEqual([r1.clientesCriados, r1.acessosCriados, r1.semAcesso, r1.erros], [7, 3, 4, 0], JSON.stringify(r1));
  const r2 = await executar(plano, { ficticio: true });
  assert.deepEqual([r2.clientesCriados, r2.acessosCriados, r2.clientesJaExistiam, r2.acessosJaExistiam, r2.erros], [0, 0, 7, 3, 0], JSON.stringify(r2));
  const [{ n }] = await sql(`select count(*)::int n from public.clientes where documento = any($1) and origem = 'importado' and ficticio`, [docsFixture]);
  assert.equal(n, 7);
  const aud = await sql(`select count(*)::int n from public.auditoria where tabela = 'clientes' and ator_contexto = 'importacao' and registro_id in (select id from public.clientes where documento = any($1))`, [docsFixture]);
  assert.ok(aud[0].n >= 7, 'importação auditada');
});

t.teste('execução interrompida (conta criada sem vínculo): reimportar vincula e NÃO troca a senha', async () => {
  const [c] = await sql('select id, usuario_id from public.clientes where documento = $1', [F.cnpj.doc]);
  await transacao((q) => q('update public.clientes set usuario_id = null where id = $1', [c.id]), { ator: 'teste' });
  await conta('entrar', { email: F.cnpj.email, senha: F.cnpj.doc.slice(0, 6) }); // senha continua a do documento
  const r = await executar(plano, { ficticio: true });
  assert.equal(r.acessosVinculados, 1); assert.equal(r.acessosCriados, 0);
  const [d] = await sql('select usuario_id from public.clientes where id = $1', [c.id]);
  assert.equal(d.usuario_id, c.usuario_id);
});

t.teste('cliente com CPF começando em zero entra com e-mail + 6 primeiros dígitos, troca a senha e depois só entra com a nova', async () => {
  const seis = cpfZero.slice(0, 6);
  assert.ok(seis.startsWith('0'));
  const s = await entrar({ email: F.zero.email, senha: seis });
  assert.equal(s.papel, 'cliente');
  const { data } = await s.from('clientes').select('id, origem').single();
  assert.equal(data.origem, 'importado', 'vê o próprio cadastro importado');
  const tr = await conta('trocar_senha', { atual: seis, nova: 'MinhaNova-2026' }, s.token);
  assert.equal(tr.status, 200, JSON.stringify(tr.corpo));
  assert.equal((await conta('entrar', { email: F.zero.email, senha: seis })).status, 401, '6 dígitos não entram mais');
  assert.equal((await conta('entrar', { email: F.zero.email, senha: 'MinhaNova-2026' })).status, 200);
});

t.teste('tentativas erradas bloqueiam e aparecem em acessos', async () => {
  for (let i = 0; i < 5; i++) await conta('entrar', { email: F.cnpj.email, senha: `000${i}00` });
  const b = await conta('entrar', { email: F.cnpj.email, senha: F.cnpj.doc.slice(0, 6) });
  assert.equal(b.status, 429);
  const a = await sql(`select resultado, count(*)::int n from public.acessos where email = $1 group by resultado`, [F.cnpj.email]);
  const m = Object.fromEntries(a.map((x) => [x.resultado, x.n]));
  assert.ok(m.falha >= 5 && m.bloqueado >= 1, JSON.stringify(m));
});

t.teste('Prime completa o e-mail de quem veio sem acesso: acesso criado na hora com os 6 dígitos; e-mail em uso é recusado', async () => {
  const prime = await entrar(await criarUsuario('imp-prime', 'prime_atendimento'));
  const [c] = await sql('select id, pendencias from public.clientes where documento = $1', [F.semEmail.doc]);
  assert.ok(c.pendencias.includes('sem_email'));
  const emUso = await conta('completar_email', { clienteId: c.id, email: F.zero.email }, prime.token);
  assert.equal(emUso.status, 409); assert.equal(emUso.corpo.erro.codigo, 'EMAIL_EM_USO');
  const novo = emailTeste('imp-completado');
  const r = await conta('completar_email', { clienteId: c.id, email: novo }, prime.token);
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  const [d] = await sql('select usuario_id, pendencias from public.clientes where id = $1', [c.id]);
  assert.ok(d.usuario_id); assert.ok(!d.pendencias.includes('sem_email'));
  assert.equal((await conta('entrar', { email: novo, senha: F.semEmail.doc.slice(0, 6) })).status, 200);
  const cli = await entrar(await criarUsuario('imp-cli'));
  assert.equal((await conta('completar_email', { clienteId: c.id, email: emailTeste('x') }, cli.token)).status, 403, 'cliente não completa e-mail');
  const [{ marca }] = await sql(`select raw_app_meta_data ->> 'marca_importacao' as marca from auth.users where id = $1`, [d.usuario_id]);
  assert.ok(marca, 'marca em app_metadata');
});

t.teste('completar e-mail retomável: conta órfã (queda depois de criar) é reaproveitada; duas chamadas com e-mails diferentes = uma vence', async () => {
  const prime = await entrar(await criarUsuario('imp-prime2', 'prime_atendimento'));
  const [c] = await sql('select id, documento from public.clientes where documento = $1', [F.invalido.doc]);
  // simula queda: conta criada com a marca, sem vínculo
  const orfa = emailTeste('imp-orfa');
  const { marcaDocumento } = await import('./importa-clientes.mjs');
  const { senhaDerivada } = await import('./lib-supabase.mjs');
  const { data } = await admin.auth.admin.createUser({ email: orfa, password: senhaDerivada(c.documento.slice(0, 6)), email_confirm: true, app_metadata: { origem: 'importado', marca_importacao: marcaDocumento(c.documento) }, user_metadata: { ficticio: true } });
  const r = await conta('completar_email', { clienteId: c.id, email: orfa }, prime.token);
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  const [d] = await sql('select usuario_id from public.clientes where id = $1', [c.id]);
  assert.equal(d.usuario_id, data.user.id, 'reaproveitou a órfã em vez de criar outra');
  assert.equal((await conta('entrar', { email: orfa, senha: c.documento.slice(0, 6) })).status, 200);
  // concorrência: outro cliente sem acesso, duas chamadas simultâneas com e-mails diferentes
  const [c2] = await sql(`select id from public.clientes where documento = $1`, [LINHAS[5][2]]);
  const [a, b] = await Promise.all([conta('completar_email', { clienteId: c2.id, email: emailTeste('imp-c1') }, prime.token), conta('completar_email', { clienteId: c2.id, email: emailTeste('imp-c2') }, prime.token)]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409], JSON.stringify([a.corpo, b.corpo]));
  const [d2] = await sql('select usuario_id, email from public.clientes where id = $1', [c2.id]);
  const [{ email: emailAuth }] = await sql('select email from auth.users where id = $1', [d2.usuario_id]);
  assert.equal(d2.email, emailAuth, 'e-mail do cliente = e-mail da conta vinculada');
  const [{ n }] = await sql(`select count(*)::int n from auth.users where raw_app_meta_data ->> 'marca_importacao' = $1`, [marcaDocumento(LINHAS[5][2])]);
  assert.equal(n, 1, 'a conta perdedora foi apagada');
});

const falhas = await t.fim();
// limpeza: só as linhas fictícias desta planilha e os usuários de teste
const marcas = docsFixture.map((d) => (marcaDocumentoLimpeza(d)));
const us = [...new Set([...(await sql(`select usuario_id from public.clientes where ficticio and documento = any($1) and usuario_id is not null`, [docsFixture])).map((x) => x.usuario_id),
  ...(await sql(`select id from auth.users where raw_app_meta_data ->> 'marca_importacao' = any($1)`, [marcas])).map((x) => x.id)])];
await sql(`update auth.users set raw_user_meta_data = raw_user_meta_data || '{"ficticio": true}' where id = any($1::uuid[]) and email like 'teste-%@example.com'`, [us]);
await transacao(async (q) => {
  await q('delete from public.acessos where user_id = any($1::uuid[])', [us]);
  await q('delete from public.clientes where ficticio and documento = any($1)', [docsFixture]);
}, { ator: 'limpeza_teste' });
console.log(`# limpeza: ${await limparFicticios({ soEstaExecucao: true })} usuários fictícios removidos`);
rmSync(PASTA, { recursive: true, force: true });
await fecharSql();
process.exit(falhas ? 1 : 0);
