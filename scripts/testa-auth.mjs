// B2: autenticação contra a HOMOLOGAÇÃO, pela Edge Function "conta". Só usuários fictícios (teste-*@example.com).
// Nenhum e-mail sai: links de confirmação/recuperação vêm do admin.generateLink (não envia). Uso: bash scripts/cli.sh node22 scripts/testa-auth.mjs
import { criarSuite, assert } from './lib-teste.mjs';
import { admin, anonimo, conta, entrar, criarUsuario, emailTeste, senhaDerivada, sql, fecharSql, limparFicticios, cpfFicticio } from './lib-supabase.mjs';

const t = criarSuite('B2 auth (homologação)');
await limparFicticios();
const acessos = (email) => sql('select resultado, motivo, ip is not null as tem_ip, dispositivo from public.acessos where email = $1 order by id', [email]);
const acessosPor = (ident) => sql('select resultado, motivo, tipo_identificador from public.acessos where identificador = $1 order by id', [ident]);
const MSG = /Não conseguimos entrar com esses dados/;
const identsUsados = [];

/** Telefone que não existe na base (real ou fictícia): o celular é identificador. */
async function celularLivre() {
  for (;;) {
    const t = `319${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
    const [{ n }] = await sql('select count(*)::int n from public.clientes where telefone = $1', [t]);
    if (!n) return t;
  }
}
async function cpfLivre(comecaComZero = false) {
  for (;;) {
    const c = cpfFicticio();
    if (comecaComZero && !c.startsWith('0')) continue;
    const [{ n }] = await sql("select count(*)::int n from public.clientes where tipo_documento = 'cpf' and documento = $1", [c]);
    if (!n) return c;
  }
}
/** Cliente fictícia com conta no Auth na REGRA PADRÃO (6 primeiros do CPF), como os importados. */
async function clientePadrao(rotulo, { nascimento = '1990-03-07', telefone } = {}) {
  const cpf = await cpfLivre(true);
  const u = await criarUsuario(rotulo, 'cliente', cpf.slice(0, 6));
  const tel = telefone || await celularLivre();
  await sql(`insert into public.clientes (usuario_id, tipo, nome, email, telefone, tipo_documento, documento, data_nascimento, origem, ficticio)
    values ($1, 'residencial', 'Cliente Teste Login', $2, $3, 'cpf', $4, $5, 'importado', true)`, [u.id, u.email, tel, cpf, nascimento]);
  identsUsados.push(cpf, tel);
  return { ...u, cpf, telefone: tel, nascimento: nascimento && `${nascimento.slice(8, 10)}${nascimento.slice(5, 7)}${nascimento.slice(0, 4)}` };
}

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
  assert.match(r.corpo.erro.mensagem, MSG);
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
  await sql(`insert into public.acessos (user_id, email, resultado, em) select $2, $1, 'falha', now() from generate_series(1, 10)`, [u.email, u.id]);
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

t.teste('corrida mista: senha certa e erradas ao mesmo tempo; a certa entra (o ticket é da própria tentativa)', async () => {
  const u = await criarUsuario('mista');
  const rs = await Promise.all([conta('entrar', { email: u.email, senha: u.senha }), ...Array.from({ length: 3 }, () => conta('entrar', { email: u.email, senha: 'errada-123' }))]);
  assert.equal(rs[0].status, 200, JSON.stringify(rs[0].corpo));
  assert.ok(rs.slice(1).every((r) => r.status === 401));
});

t.teste('bloqueio por IP: 30 falhas do mesmo IP em 15 min bloqueiam qualquer e-mail desse IP', async () => {
  const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`; // faixa de documentação (TEST-NET-2)
  await sql(`insert into public.acessos (email, resultado, ip, em) select 'teste-ip-' || g || '@example.com', 'falha', $1::inet, now() - interval '1 minute' from generate_series(1, 30) g`, [ip]);
  const [{ r }] = await sql(`select public.login_iniciar_id('email', 'teste-outro@example.com', null, null, $1::inet, 'teste') as r`, [ip]);
  assert.equal(r.bloqueado, true);
  const [{ r: r2 }] = await sql(`select public.login_iniciar_id('email', 'teste-outro@example.com', null, null, '198.51.100.250'::inet, 'teste') as r`);
  assert.ok(!r2.bloqueado, 'outro IP segue livre');
  await sql(`delete from public.acessos where ip = $1::inet or email like 'teste-%@example.com' or identificador like 'teste-%@example.com'`, [ip]);
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

t.teste('link de recuperação emitido ANTES do bloqueio da Prime não troca a senha', async () => {
  const u = await criarUsuario('recupera-bloq');
  const { data } = await admin.auth.admin.generateLink({ type: 'recovery', email: u.email });
  const c = anonimo();
  const v = await c.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: 'recovery' });
  assert.ok(!v.error, v.error?.message);
  await sql('update public.perfis set bloqueado = true where user_id = $1', [u.id]);
  const r = await conta('definir_senha', { nova: 'Tentativa-2026' }, v.data.session.access_token);
  assert.equal(r.status, 403); assert.equal(r.corpo.erro.codigo, 'ACESSO_BLOQUEADO');
  await sql('update public.perfis set bloqueado = false where user_id = $1', [u.id]);
  assert.equal((await conta('entrar', { email: u.email, senha: 'Tentativa-2026' })).status, 401, 'senha não mudou');
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

t.teste('cadastro pela function (cliente nova): sem senha e sem confirmação; CPF e nascimento obrigatórios; entra pelas 3 vias', async () => {
  await sql('delete from privado.cadastros_ip'); // o limite por IP acumula entre execuções da suíte (homologação, só teste)
  const cpf = await cpfLivre(true);
  const tel = await celularLivre();
  identsUsados.push(cpf, tel);
  const cli = { tipo: 'residencial', nome: 'Nova Cliente Teste', telefone: tel, email: emailTeste('cad'), cpf, dataNascimento: '1985-11-02',
    endereco: { cep: '30130010', logradouro: 'Rua Fictícia', numero: '10', complemento: '', bairro: 'Savassi', cidade: 'Belo Horizonte', uf: 'MG' } };
  const semNasc = await conta('cadastrar', { cliente: { ...cli, dataNascimento: undefined } });
  assert.equal(semNasc.status, 400); assert.ok(semNasc.corpo.erro.detalhes?.dataNascimento, JSON.stringify(semNasc.corpo));
  const semCpf = await conta('cadastrar', { cliente: { ...cli, cpf: undefined } });
  assert.equal(semCpf.status, 400); assert.ok(semCpf.corpo.erro.detalhes?.cpf);
  const ok = await conta('cadastrar', { cliente: cli });
  assert.equal(ok.status, 200, JSON.stringify(ok.corpo));
  const [c] = await sql('select origem, ficticio, usuario_id is not null as com_conta, data_nascimento::text as n from public.clientes where documento = $1', [cpf]);
  assert.deepEqual([c.origem, c.ficticio, c.com_conta, c.n], ['site', true, true, '1985-11-02']);
  assert.equal((await conta('entrar', { identificador: cli.email, senha: cpf.slice(0, 6) })).status, 200, 'e-mail + 6 primeiros do CPF, sem confirmar e-mail');
  assert.equal((await conta('entrar', { identificador: cpf, senha: '02111985' })).status, 200, 'CPF + nascimento');
  assert.equal((await conta('entrar', { identificador: tel, senha: cpf.slice(0, 6) })).status, 200, 'celular + 6 primeiros');
  const dup = await conta('cadastrar', { cliente: { ...cli, email: emailTeste('cad2') } });
  assert.equal(dup.status, 409); assert.equal(dup.corpo.erro.codigo, 'DOCUMENTO_EM_USO');
  const { error } = await anonimo().auth.signUp({ email: emailTeste('cad-direto'), password: 'Qualquer-2026' });
  assert.ok(error); assert.equal(error.status, 403, 'sem ticket da function o Auth recusa');
});

t.teste('cadastro: limite de 10 por IP por hora', async () => {
  const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
  const rs = [];
  for (let k = 0; k < 11; k++) rs.push((await sql('select public.conta_cadastro_permitido($1::inet) as ok', [ip]))[0].ok);
  assert.deepEqual([rs.slice(0, 10).every(Boolean), rs[10]], [true, false]);
  await sql('delete from privado.cadastros_ip where ip = $1::inet', [ip]);
});

t.teste('login pelos 3 identificadores (importada com CPF começando em zero): e-mail e celular com 6 dígitos, CPF com nascimento', async () => {
  const u = await clientePadrao('tres');
  assert.equal((await conta('entrar', { identificador: u.email.toUpperCase(), senha: u.cpf.slice(0, 6) })).status, 200, 'e-mail');
  assert.equal((await conta('entrar', { identificador: `${u.cpf.slice(0, 3)}.${u.cpf.slice(3, 6)}.${u.cpf.slice(6, 9)}-${u.cpf.slice(9)}`, senha: u.nascimento })).status, 200, 'CPF com máscara');
  assert.equal((await conta('entrar', { identificador: `(${u.telefone.slice(0, 2)}) ${u.telefone.slice(2, 7)}-${u.telefone.slice(7)}`, senha: u.cpf.slice(0, 6) })).status, 200, 'celular');
  const cpfComDigitos = await conta('entrar', { identificador: u.cpf, senha: u.cpf.slice(0, 6) });
  assert.equal(cpfComDigitos.status, 401, 'pelo CPF, os dígitos do próprio CPF não valem (sem segredo)');
  const tipos = (await acessosPor(u.cpf)).map((x) => `${x.tipo_identificador}:${x.resultado}`);
  assert.deepEqual(tipos, ['cpf:sucesso', 'cpf:falha']);
});

t.teste('mesma mensagem genérica: senha errada, CPF sem nascimento, celular de dois clientes, identificador inexistente ou inválido', async () => {
  const u = await clientePadrao('generica');
  const semNasc = await clientePadrao('sem-nasc', { nascimento: null });
  const tel = await celularLivre();
  const d1 = await clientePadrao('dup1', { telefone: tel });
  await clientePadrao('dup2', { telefone: tel });
  const casos = [
    ['senha errada', { identificador: u.email, senha: '000000' }],
    ['CPF sem nascimento', { identificador: semNasc.cpf, senha: '07031990' }],
    ['celular duplicado (senha certa)', { identificador: tel, senha: d1.cpf.slice(0, 6) }],
    ['CPF inexistente', { identificador: await cpfLivre(), senha: '01011990' }],
    ['celular inexistente', { identificador: await celularLivre(), senha: '123456' }],
    ['e-mail inexistente', { identificador: emailTeste('nada'), senha: '123456' }],
    ['CNPJ não é identificador', { identificador: '12.ABC.345/01DE-35', senha: '12ABC3' }],
  ];
  const rs = [];
  for (const [nome, corpo] of casos) {
    const r = await conta('entrar', corpo);
    assert.equal(r.status, 401, `${nome}: ${JSON.stringify(r.corpo)}`);
    assert.match(r.corpo.erro.mensagem, MSG, nome);
    rs.push(r.corpo.erro.mensagem);
  }
  assert.equal(new Set(rs).size, 1, 'sempre a mesma mensagem');
  assert.equal((await acessosPor(semNasc.cpf)).at(-1).motivo, 'CPF sem data de nascimento');
  assert.equal((await acessosPor(tel)).at(-1).motivo, 'celular de mais de um cliente');
  identsUsados.push(...casos.map(([, c]) => String(c.identificador).replace(/\D/g, '')));
});

t.teste('bloqueio progressivo por CONTA: 5 falhas pelo CPF bloqueiam também o e-mail e o celular; outro IP não destrava', async () => {
  const u = await clientePadrao('bloq-conta');
  for (let i = 0; i < 5; i++) assert.equal((await conta('entrar', { identificador: u.cpf, senha: '01011900' })).status, 401);
  const b = await conta('entrar', { identificador: u.email, senha: u.cpf.slice(0, 6) });
  assert.equal(b.status, 429, 'mesma conta, outra via'); assert.equal(b.corpo.erro.codigo, 'MUITAS_TENTATIVAS');
  assert.equal((await conta('entrar', { identificador: u.telefone, senha: u.cpf.slice(0, 6) })).status, 429);
  await sql(`update public.acessos set em = em - interval '6 minutes' where user_id = $1`, [u.id]);
  assert.equal((await conta('entrar', { identificador: u.telefone, senha: u.cpf.slice(0, 6) })).status, 200, 'depois do prazo entra');
});

t.teste('senha própria (troca em Minha conta) vale pelas 3 vias; a padrão e o nascimento deixam de valer; a Prime redefine e volta a padrão', async () => {
  const u = await clientePadrao('propria');
  const c = await entrar({ email: u.email, senha: u.cpf.slice(0, 6) });
  const troca = await conta('trocar_senha', { atual: u.nascimento, nova: 'MinhaSenha-2026' }, c.token);
  assert.equal(troca.status, 200, `a atual pode ser a do CPF (nascimento): ${JSON.stringify(troca.corpo)}`);
  for (const ident of [u.email, u.cpf, u.telefone]) assert.equal((await conta('entrar', { identificador: ident, senha: 'MinhaSenha-2026' })).status, 200, ident);
  assert.equal((await conta('entrar', { identificador: u.cpf, senha: u.nascimento })).status, 401, 'nascimento não vale mais');
  assert.equal((await conta('entrar', { identificador: u.email, senha: u.cpf.slice(0, 6) })).status, 401, '6 dígitos não valem mais');
  const atend = await entrar(await criarUsuario('p-redef2', 'prime_atendimento'));
  assert.equal((await conta('redefinir_senha', { userId: u.id }, atend.token)).status, 200);
  assert.equal((await conta('entrar', { identificador: u.cpf, senha: u.nascimento })).status, 200, 'voltou pra regra padrão');
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
if (identsUsados.length) await sql('delete from public.acessos where user_id is null and identificador = any($1::text[])', [identsUsados]);
console.log(`# limpeza: ${await limparFicticios({ soEstaExecucao: true })} usuários fictícios removidos`);
await fecharSql();
process.exit(falhas ? 1 : 0);
