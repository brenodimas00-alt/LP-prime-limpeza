// Pré-lançamento (27/10/2026): ensaio de backup e restauração no Supabase LOCAL (docker, descartável), com dados fictícios.
// 1. importa 3 clientes fictícios (o mesmo caminho da importação real, com acesso criado no Auth);
// 2. backup dos dados (public e auth) com pg_dump --inserts --on-conflict-do-nothing (o formato que o docs/GO-LIVE.md manda
//    usar antes da virada);
// 3. "desastre": apaga os clientes e as contas fictícias;
// 4. restaura o arquivo com psql (gatilhos desligados durante a carga, como o Supabase recomenda) e confere que os clientes,
//    as contas e o acesso (login pela function "conta") voltaram.
// Trava: exige SUPABASE_DB_URL_LOCAL (127.0.0.1) no ambiente de PRIME_ENV; pg_dump e psql rodam dentro do contêiner local.
// Uso: cd ~/projetos/LP-prime-limpeza && PRIME_ENV=<env local do ensaio-producao-local> bash scripts/cli.sh node22 scripts/ensaio-restauracao-local.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { ENV, sql, fecharSql, limparFicticios, emailTeste, cpfFicticio, entrar } from './lib-supabase.mjs';
import { lerPlanilha, planejar, executar } from './importa-clientes.mjs';

if (!ENV.SUPABASE_DB_URL_LOCAL || !/^postgresql:\/\/[^@]+@(127\.0\.0\.1|localhost):/.test(ENV.SUPABASE_DB_URL_LOCAL)) { console.error('ABORTADO: só roda no banco local (PRIME_ENV com SUPABASE_DB_URL_LOCAL)'); process.exit(2); }
const CONTEINER = 'supabase_db_prime-limpeza';
/** scripts/sql/ajusta-sequencias.sql: o mesmo SQL que o scripts/restaura.sh roda depois da carga. */
const AJUSTA_SEQUENCIAS = readFileSync(new URL('./sql/ajusta-sequencias.sql', import.meta.url), 'utf8');
const falhas = [];
const conferir = (ok, msg) => { console.log(`  ${ok ? 'ok  ' : 'FALHOU'} ${msg}`); if (!ok) falhas.push(msg); };
const pasta = mkdtempSync(join(tmpdir(), 'prime-restauracao-'));

// 1. três clientes fictícios pelo caminho da importação
const docs = [cpfFicticio(), cpfFicticio(), cpfFicticio()];
const emails = docs.map((_, i) => emailTeste(`rest-${i}`));
const arq = join(pasta, 'ficticios.xlsx');
const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Clientes');
ws.addRow(['Tipo', 'CPF/CNPJ', 'CPF/CNPJ (só números)', 'Nome completo', 'Data de nascimento', 'Endereço', 'E-mail', 'Telefone', 'Cadastrado em', 'Pendências']);
docs.forEach((d, i) => ws.addRow(['CPF', '', d, `Restauração Teste ${i}`, '01/01/1990', 'Rua Fictícia, 1, Centro, Belo Horizonte, MG', emails[i], `3198888000${i}`, '2024-01-01 10:00:00', '']));
await wb.xlsx.writeFile(arq);
const r = await executar(planejar(await lerPlanilha(arq)), { ficticio: true });
conferir(r.clientesCriados === 3 && r.acessosCriados === 3, `importados 3 clientes fictícios com acesso (${JSON.stringify({ c: r.clientesCriados, a: r.acessosCriados })})`);
const contar = async () => ({
  clientes: (await sql('select count(*)::int n from public.clientes where documento = any($1)', [docs]))[0].n,
  contas: (await sql('select count(*)::int n from auth.users where email = any($1)', [emails]))[0].n,
});
const antes = await contar();

// 2. backup (dados de public e auth, INSERT com ON CONFLICT DO NOTHING: restaura por cima sem duplicar)
const backup = join(pasta, 'backup.sql');
writeFileSync(backup, execFileSync('docker', ['exec', CONTEINER, 'pg_dump', '-U', 'postgres', '-d', 'postgres', '--data-only', '--inserts', '--on-conflict-do-nothing', '--schema=public', '--schema=auth', '--exclude-table-data=auth.schema_migrations'], { maxBuffer: 1 << 30 }));
conferir(readFileSync(backup, 'utf8').includes('INSERT INTO'), `backup gravado (${Math.round(readFileSync(backup).length / 1024)} KB)`);

// 3. desastre
await limparFicticios({ soEstaExecucao: true });
const depoisDoDesastre = await contar();
conferir(depoisDoDesastre.clientes === 0 && depoisDoDesastre.contas === 0, 'desastre simulado: clientes e contas fictícias apagados');

// 4. restauração (gatilhos desligados na carga; para no primeiro erro)
execFileSync('docker', ['exec', '-i', CONTEINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-c', 'SET session_replication_role = replica', '-f', '-'], { input: readFileSync(backup), maxBuffer: 1 << 30, stdio: ['pipe', 'ignore', 'pipe'] });
// o dump traz o setval das sequências do momento do backup: restaurar por cima de um banco que mudou depois volta a
// sequência pra trás e o próximo insert colide. Depois da carga, cada sequência sobe pro maior id que existe.
execFileSync('docker', ['exec', '-i', CONTEINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-f', '-'], { input: Buffer.from(AJUSTA_SEQUENCIAS), stdio: ['pipe', 'ignore', 'pipe'] });
const depois = await contar();
conferir(depois.clientes === antes.clientes && depois.contas === antes.contas, `restaurado: ${depois.clientes} clientes e ${depois.contas} contas (antes ${antes.clientes} e ${antes.contas})`);
let login = false;
try { await entrar({ email: emails[0], senha: docs[0].slice(0, 6) }, 'cliente'); login = true; } catch { login = false; }
conferir(login, 'cliente restaurada entra com a mesma senha (e-mail + 6 primeiros dígitos)');

await limparFicticios({ soEstaExecucao: true });
await fecharSql();
rmSync(pasta, { recursive: true, force: true });
console.log(`\n# ensaio de backup e restauração (local): ${falhas.length ? `${falhas.length} falha(s)` : 'tudo certo'}`);
process.exit(falhas.length ? 1 : 0);
