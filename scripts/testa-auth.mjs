// B2: autenticação contra a HOMOLOGAÇÃO, pela Edge Function "conta". Só usuários fictícios (teste-*@example.com).
// Nenhum e-mail sai: links de confirmação/recuperação vêm do admin.generateLink (não envia). Uso: bash scripts/cli.sh node22 scripts/testa-auth.mjs
import { criarSuite, assert } from './lib-teste.mjs';
import { admin, anonimo, conta, entrar, criarUsuario, emailTeste, senhaDerivada, sql, fecharSql, limparFicticios, cpfFicticio } from './lib-supabase.mjs';

const t = criarSuite('B2 auth (homologação)');
await limparFicticios();
const acessos = (email) => sql('select resultado, motivo, ip is not null as tem_ip, dispositivo from public.acessos where email = $1 order by id', [email]);

t.teste('entrar: senha certa devolve sessão com papel e grava acesso com IP e dispositivo', async () => {
  const u = await criarUsuario('ok');
  const r = await conta('entrar', { email: u.email, senha: u.senha });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.equal(r.corpo.papel, 'cliente');
  assert.ok(r.corpo.sessao.access_token && r.corpo.sessao.refresh_token);
  const a = await acessos(u.email);
  assert.equal(a.at(-1).resultado, 'sucesso');
  assert.equal(a.at(-1).tem_ip, true, 'IP gravado');
});

t.teste('senha errada: 401 com mensagem clara, acesso "falha"; e-mail inexistente responde igual (não revela cadastro)', async () => {
  const u = await criarUsuario('erro');
  const r = await conta('entrar', { email: u.email, senha: 'errada-123' });
  assert.equal(r.status, 401); assert.equal(r.corpo.erro.codigo, 'CREDENCIAIS_INVALIDAS');
  assert.match(r.corpo.erro.mensagem, /E-mail ou senha incorretos/);
  const n = await conta('entrar', { email: emailTeste('nao-existe'), senha: 'errada-123' });
  assert.equal(n.status, 401); assert.equal(n.corpo.erro.mensagem, r.corpo.erro.mensagem);
  assert.equal((await acessos(u.email)).at(-1).resultado, 'falha');
});

t.teste('login direto no Auth (sem a function) é recusado mesmo com a senha derivada certa', async () => {
  const u = await criarUsuario('direto');
  const { error } = await anonimo().auth.signInWithPassword({ email: u.email, password: senhaDerivada(u.senha) });
  assert.ok(error); assert.equal(error.status, 403);
  const e2 = await anonimo().auth.signInWithPassword({ email: u.email, password: u.senha });
  assert.ok(e2.error, 'senha digitada sem pepper também não entra');
});

t.teste('bloqueio progressivo: 5 falhas bloqueiam 5 min (mesmo com a senha certa), 10 falhas bloqueiam 30 min', async () => {
  const u = await criarUsuario('bloq');
  for (let i = 0; i < 5; i++) assert.equal((await conta('entrar', { email: u.email, senha: 'errada-123' })).status, 401);
  const b = await conta('entrar', { email: u.email, senha: u.senha });
  assert.equal(b.status, 429); assert.equal(b.corpo.erro.codigo, 'MUITAS_TENTATIVAS');
  assert.match(b.corpo.erro.mensagem, /espere 5 minutos/);
  assert.equal((await acessos(u.email)).at(-1).resultado, 'bloqueado');
  // "passa o tempo": falhas ficam 6 min no passado
  await sql(`update public.acessos set em = em - interval '6 minutes' where email = $1`, [u.email]);
  assert.equal((await conta('entrar', { email: u.email, senha: u.senha })).status, 200, 'depois do prazo entra');
  // depois do sucesso a contagem zera; 10 falhas desde o último sucesso -> 30 min
  await sql(`insert into public.acessos (email, resultado, em) select $1, 'falha', now() from generate_series(1, 10)`, [u.email]);
  const b2 = await conta('entrar', { email: u.email, senha: u.senha });
  assert.equal(b2.status, 429); assert.match(b2.corpo.erro.mensagem, /espere 30 minutos/);
});

t.teste('corrida: 12 tentativas erradas em paralelo não passam de 5 falhas contra o Auth', async () => {
  const u = await criarUsuario('corrida');
  const rs = await Promise.all(Array.from({ length: 12 }, () => conta('entrar', { email: u.email, senha: 'errada-123' })));
  const falhas = rs.filter((r) => r.status === 401).length;
  const bloqueadas = rs.filter((r) => r.status === 429).length;
  assert.ok(falhas <= 5, `falhas que chegaram ao Auth: ${falhas}`);
  assert.equal(falhas + bloqueadas, 12);
});

t.teste('bloqueio por IP: 30 falhas do mesmo IP em 15 min bloqueiam qualquer e-mail desse IP', async () => {
  const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`; // faixa de documentação (TEST-NET-2)
  await sql(`insert into public.acessos (email, resultado, ip, em) select 'teste-ip-' || g || '@example.com', 'falha', $1::inet, now() - interval '1 minute' from generate_series(1, 30) g`, [ip]);
  const [{ r }] = await sql(`select public.login_iniciar('teste-outro@example.com', $1::inet, 'teste') as r`, [ip]);
  assert.equal(r.bloqueado, true);
  const [{ r: r2 }] = await sql(`select public.login_iniciar('teste-outro@example.com', '198.51.100.250'::inet, 'teste') as r`);
  assert.ok(!r2.bloqueado, 'outro IP segue livre');
  await sql(`delete from public.acessos where ip = $1::inet or email like 'teste-%@example.com'`, [ip]);
});

t.teste('trocar senha: exige a atual; depois só entra com a nova; sessões antigas não renovam', async () => {
  const u = await criarUsuario('troca');
  const c = await entrar(u);
  const errada = await conta('trocar_senha', { atual: 'nao-e-essa', nova: 'NovaSenha-2026' }, c.token);
  assert.equal(errada.status, 401); assert.equal(errada.corpo.erro.codigo, 'SENHA_ATUAL_INCORRETA');
  const curta = await conta('trocar_senha', { atual: u.senha, nova: '1234567' }, c.token);
  assert.equal(curta.status, 400);
  const ok = await conta('trocar_senha', { atual: u.senha, nova: 'NovaSenha-2026' }, c.token);
  assert.equal(ok.status, 200, JSON.stringify(ok.corpo));
  assert.equal((await conta('entrar', { email: u.email, senha: u.senha })).status, 401, 'senha antiga não entra');
  assert.equal((await conta('entrar', { email: u.email, senha: 'NovaSenha-2026' })).status, 200, 'nova entra');
  const aud = await sql(`select count(*)::int n from public.auditoria where tabela = 'auth.users' and registro_id = $1 and ator_contexto = 'conta:trocar_senha'`, [u.id]);
  assert.equal(aud[0].n, 1);
});

t.teste('recuperação: link de recuperação (gerado sem enviar e-mail) permite definir a nova senha; sessão comum não', async () => {
  const u = await criarUsuario('recupera');
  const comum = await entrar(u);
  const negado = await conta('definir_senha', { nova: 'Recuperada-2026' }, comum.token);
  assert.equal(negado.status, 403, 'sessão de login comum não define senha sem a atual');
  const { data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email: u.email });
  assert.ok(!error, error?.message);
  const c = anonimo();
  const v = await c.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: 'recovery' });
  assert.ok(!v.error, v.error?.message);
  const r = await conta('definir_senha', { nova: 'Recuperada-2026' }, v.data.session.access_token);
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.equal((await conta('entrar', { email: u.email, senha: 'Recuperada-2026' })).status, 200);
});

t.teste('confirmação de e-mail: conta não confirmada não entra; depois do link, entra', async () => {
  const email = emailTeste('confirma');
  const { data: cu, error } = await admin.auth.admin.createUser({ email, password: senhaDerivada('Confirma-2026'), email_confirm: false, user_metadata: { ficticio: true } });
  assert.ok(!error, error?.message);
  const r = await conta('entrar', { email, senha: 'Confirma-2026' });
  assert.equal(r.status, 403); assert.equal(r.corpo.erro.codigo, 'EMAIL_NAO_CONFIRMADO');
  const { data } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const v = await anonimo().auth.verifyOtp({ token_hash: data.properties.hashed_token, type: 'magiclink' });
  assert.ok(!v.error, v.error?.message);
  const [{ confirmado }] = await sql('select email_confirmed_at is not null as confirmado from auth.users where id = $1', [cu.user.id]);
  assert.equal(confirmado, true);
  assert.equal((await conta('entrar', { email, senha: 'Confirma-2026' })).status, 200);
});

t.teste('cadastro pela function: senha curta e e-mail reservado recusados com mensagem clara; cadastro direto no Auth recusado', async () => {
  const curta = await conta('cadastrar', { email: emailTeste('cad'), senha: '1234567' });
  assert.equal(curta.status, 400); assert.equal(curta.corpo.erro.codigo, 'DADOS_INVALIDOS');
  assert.match(curta.corpo.erro.mensagem, /pelo menos 8/);
  const { error } = await anonimo().auth.signUp({ email: emailTeste('cad-direto'), password: 'Qualquer-2026' });
  assert.ok(error); assert.equal(error.status, 403, 'sem ticket da function o Auth recusa');
  // Domínio reservado (example.com): o Auth recusa e a function devolve "Confira o e-mail". O envio real do link de
  // confirmação fica BLOQUEADO até existir SMTP próprio (o padrão só entrega pro time); nenhum teste manda e-mail.
  const r = await conta('cadastrar', { email: emailTeste('cad'), senha: 'Cadastro-2026' });
  // o Auth confere o limite de envio (2/h no SMTP padrão) antes do endereço: as duas recusas são claras
  const recusas = { 400: 'DADOS_INVALIDOS', 503: 'EMAIL_INDISPONIVEL' };
  assert.equal(recusas[r.status], r.corpo?.erro?.codigo, JSON.stringify(r.corpo));
});

t.teste('Prime bloqueia e desbloqueia: bloqueado não entra nem renova; atendimento não bloqueia admin; cliente não bloqueia ninguém', async () => {
  const atendU = await criarUsuario('p-atend', 'prime_atendimento');
  const atend = await entrar(atendU);
  const adm = await criarUsuario('p-admin', 'prime_admin');
  const alvo = await criarUsuario('alvo');
  const sessaoAlvo = await entrar(alvo);
  assert.equal((await conta('bloquear', { userId: alvo.id, motivo: 'teste' }, atend.token)).status, 200);
  const e = await conta('entrar', { email: alvo.email, senha: alvo.senha });
  assert.equal(e.status, 403); assert.equal(e.corpo.erro.codigo, 'ACESSO_BLOQUEADO');
  assert.ok((await sessaoAlvo.auth.refreshSession()).error, 'não renova token');
  const [{ ator }] = await sql(`select ator_user_id::text as ator from public.auditoria where tabela = 'perfis' and registro_id = $1 and depois ->> 'bloqueado' = 'true' order by id desc limit 1`, [alvo.id]);
  assert.equal(ator, atendU.id, 'auditoria registra quem bloqueou');
  assert.equal((await conta('desbloquear', { userId: alvo.id }, atend.token)).status, 200);
  assert.equal((await conta('entrar', { email: alvo.email, senha: alvo.senha })).status, 200);
  assert.equal((await conta('bloquear', { userId: adm.id }, atend.token)).status, 403, 'atendimento não bloqueia admin');
  const cli = await entrar(await criarUsuario('cli-tenta'));
  const n = await conta('bloquear', { userId: alvo.id }, cli.token);
  assert.equal(n.status, 403); assert.equal(n.corpo.erro.codigo, 'ATOR_SEM_PERMISSAO');
});

t.teste('Prime redefine senha de importado: volta pros 6 primeiros números do CPF (inclusive começando com zero)', async () => {
  const atend = await entrar(await criarUsuario('p-redef', 'prime_atendimento'));
  const u = await criarUsuario('importado');
  let cpf = cpfFicticio();
  while (!cpf.startsWith('0')) cpf = cpfFicticio();
  await sql(`insert into public.clientes (usuario_id, tipo, nome, email, tipo_documento, documento, origem, ficticio) values ($1, 'residencial', 'Importada Teste', $2, 'cpf', $3, 'importado', true)`, [u.id, u.email, cpf]);
  const r = await conta('redefinir_senha', { userId: u.id }, atend.token);
  assert.equal(r.status, 200, JSON.stringify(r.corpo)); assert.equal(r.corpo.regra, 'seis_digitos_documento');
  assert.equal((await conta('entrar', { email: u.email, senha: cpf.slice(0, 6) })).status, 200);
  assert.equal((await conta('entrar', { email: u.email, senha: u.senha })).status, 401);
});

t.teste('telefone: entrada por código SMS desligada', async () => {
  const { error } = await anonimo().auth.signInWithOtp({ phone: '+5531988887777' });
  assert.ok(error);
});

const falhas = await t.fim();
console.log(`# limpeza: ${await limparFicticios({ soEstaExecucao: true })} usuários fictícios removidos`);
await fecharSql();
process.exit(falhas ? 1 : 0);
