// A0 (fase 2): admin da cliente. Troca a conta de demonstração isa.admin@prime-homolog.example pelo e-mail real dela,
// papel prime_admin, com senha temporária forte e troca obrigatória no primeiro acesso (app_metadata; o banco nega tudo
// até trocar, migration 20260928100000). Nenhum e-mail sai (conta criada já confirmada pela API admin).
// A senha temporária NÃO é gravada em arquivo: aparece só no terminal. Rodar de novo não mexe na senha; perdeu a
// temporária antes do primeiro acesso: --nova-senha gera outra (e volta a exigir a troca).
// O e-mail NÃO fica no repo (é dado pessoal): vem do argumento ou de ADMIN_CLIENTE_EMAIL no ~/.prime-env.
// Trava: se o e-mail já for de uma conta de cliente ou profissional, ABORTA (um usuário tem um papel só; promover a
// conta de cliente a admin misturaria os acessos). Decidir com a cliente outro e-mail pra administração.
// Uso: bash scripts/cli.sh node22 scripts/a0-admin-cliente.mjs [email] [--nova-senha]
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { admin, anonimo, conta, sql, fecharSql, senhaDerivada, ENV } from './lib-supabase.mjs';

const EMAIL = String(process.argv.slice(2).find((a) => a.includes('@')) || ENV.ADMIN_CLIENTE_EMAIL || '').trim().toLowerCase();
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(EMAIL)) { console.error('Informe o e-mail: argumento ou ADMIN_CLIENTE_EMAIL no ~/.prime-env'); process.exit(2); }
const ANTIGA = 'isa.admin@prime-homolog.example';
const novaSenha = process.argv.includes('--nova-senha');
const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim().replace(/[/_.]/g, '-').toLowerCase();
const URL_SITE = `https://${branch}.prime-limpeza.pages.dev/`;
const temporaria = () => `Prime-${randomBytes(12).toString('base64url')}`;

let [u] = await sql('select id from auth.users where lower(email) = $1', [EMAIL]);
if (u) {
  const [ocupado] = await sql(`select (select papel from public.perfis where user_id = $1) papel,
    exists (select 1 from public.clientes where usuario_id = $1) cliente, exists (select 1 from public.diaristas where usuario_id = $1) diarista`, [u.id]);
  if (ocupado.cliente || ocupado.diarista || ocupado.papel !== 'prime_admin') {
    console.error(`ABORTADO: este e-mail já é de uma conta de ${ocupado.cliente ? 'cliente' : ocupado.diarista ? 'profissional' : ocupado.papel}. Nada foi alterado. Use outro e-mail pra administração.`);
    await fecharSql(); process.exit(3);
  }
}
let senha = null;
if (!u) {
  senha = temporaria();
  const { data, error } = await admin.auth.admin.createUser({
    email: EMAIL, password: senhaDerivada(senha), email_confirm: true,
    app_metadata: { troca_senha_obrigatoria: true }, user_metadata: { origem: 'prime' },
  });
  if (error) throw new Error(`createUser: ${error.message}`);
  u = { id: data.user.id };
  console.log('conta criada');
} else if (novaSenha) {
  senha = temporaria();
  const { error } = await admin.auth.admin.updateUserById(u.id, { password: senhaDerivada(senha), app_metadata: { troca_senha_obrigatoria: true } });
  if (error) throw new Error(`updateUser: ${error.message}`);
  console.log('conta já existia: senha temporária nova, troca obrigatória de novo');
} else {
  console.log('conta já existia: senha mantida (use --nova-senha pra gerar outra temporária)');
}
await sql(`update public.perfis set papel = 'prime_admin', bloqueado = false where user_id = $1 and papel <> 'prime_admin'`, [u.id]);
const [{ papel }] = await sql('select papel from public.perfis where user_id = $1', [u.id]);
if (papel !== 'prime_admin') throw new Error(`papel ${papel}`);

// Teste do login com a temporária (sem gastá-la): entra, o banco nega a RPC do painel e a function avisa a troca.
if (senha) {
  const r = await conta('entrar', { email: EMAIL, senha, area: 'prime' });
  if (r.status !== 200 || r.corpo.papel !== 'prime_admin' || r.corpo.trocaSenha !== true) throw new Error(`login de teste: ${r.status} ${r.corpo?.erro?.codigo || ''}`);
  const c = anonimo();
  await c.auth.setSession(r.corpo.sessao);
  const { error } = await c.rpc('listar_clientes', { p_filtro: {} });
  if (!error) throw new Error('a RPC do painel NÃO foi negada antes da troca');
  await c.auth.signOut({ scope: 'local' });
  console.log('login testado: entra como prime_admin, painel bloqueado até trocar a senha');
}

// Só depois de validar a substituta: apaga a conta de demonstração antiga (só se for mesmo a de demonstração).
const [velha] = await sql(`select id from auth.users where email = $1 and raw_user_meta_data ->> 'demo' = 'true'`, [ANTIGA]);
if (velha) {
  await sql('delete from public.acessos where user_id = $1', [velha.id]);
  const { error } = await admin.auth.admin.deleteUser(velha.id);
  if (error) throw new Error(`apagar ${ANTIGA}: ${error.message}`);
  console.log(`${ANTIGA} apagada`);
}

console.log(`\nURL de homologação:      ${URL_SITE}`);
console.log(`Entrada da equipe Prime: ${URL_SITE}painel/entrar/`);
console.log(`E-mail:                  ${EMAIL}`);
if (senha) console.log(`Senha temporária:        ${senha}   (só aqui; no primeiro acesso ela cria a própria)`);
await fecharSql();
