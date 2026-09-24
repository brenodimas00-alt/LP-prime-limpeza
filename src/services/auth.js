// Autenticação com adapters: mock (demonstração) agora; supabase na fase 2 (mesma interface).
// Interface: entrarCliente({identificador, senha}) (CPF, e-mail ou celular) | entrarDiarista({email, senha}) | entrarPrime({email, senha}) | recuperarSenha(email)
//            | entrarGoogle() | pedirCodigo/entrarPorCodigo (só com LOGIN_WHATSAPP) | trocarSenha({atual, nova})
//            | modoNovaSenha() | definirNovaSenha(nova) | sair() | sessaoAtual() | conferirSessao() | papel()
// A GUARDA DE ROTA NO FRONT É SÓ CONVENIÊNCIA: a autorização real é do backend (RLS no Supabase). Ver docs/API.md.
// A senha nunca sai do navegador em texto: o mock guarda e compara o SHA-256 (o Supabase Auth cuida disso na fase 2).
import { AUTH_ADAPTER, modoDev, LOGIN_WHATSAPP, SENHA_MINIMA_SITE, url } from '../config/app.js';
import { definirSessao, sessaoGuardada } from './sessao.js';
import { CREDENCIAIS_MOCK } from '../../scripts/fixtures/seed.js';
import { adapterAtual } from './api.js';
import { supabase, chamarConta } from './supabase.js';

const CODIGO_DEMO = '123456';
const SENHA_DEMO_DIARISTA = 'diarista123'; // toda diarista cadastrada na demonstração entra com esta senha
const erro = (m, codigo = 'DADOS_INVALIDOS') => Object.assign(new Error(m), { codigo });
/** Mensagem SEMPRE igual pra login de cliente recusado (não diz se o cadastro existe nem qual dado errou). */
export const MSG_LOGIN_CLIENTE = 'Não conseguimos entrar com esses dados. Confira e tente de novo. Se não der pelo CPF, entre pelo e-mail ou pelo celular.';

export async function hashSenha(senha) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(senha)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function limparSessao() { try { localStorage.removeItem('prime.sessao'); } catch { /* ignora */ } }

const mock = {
  tipo: 'mock',
  async entrarCliente({ identificador, senha }) {
    const r = await (await adapterAtual()).verificarLoginCliente({ identificador, senha });
    if (!r || r.tipo !== 'cliente') throw erro(MSG_LOGIN_CLIENTE, 'CREDENCIAIS_INVALIDAS');
    const s = { ator: 'cliente', id: r.id, nome: r.nome };
    definirSessao(s);
    return s;
  },
  async recuperarSenha(email) {
    const existe = await (await adapterAtual()).existeCredencial(email);
    // Na demonstração não existe e-mail: a resposta é a mesma exista ou não a conta (não vaza cadastro).
    return { enviado: true, demo: modoDev() ? (existe ? 'Na demonstração não mandamos e-mail.' : 'Na demonstração não mandamos e-mail. Não há conta com esse e-mail neste navegador.') : undefined };
  },
  async entrarGoogle() {
    throw erro('Entrar com Google entra na homologação, quando o acesso do Google for criado. Use e-mail e senha.', 'BLOQUEADO');
  },
  async pedirCodigo(telefone) {
    if (!LOGIN_WHATSAPP) throw erro('Entrada por código no WhatsApp desligada.', 'BLOQUEADO');
    const c = await (await adapterAtual()).buscarClientePorTelefone(telefone);
    return { enviado: true, existe: !!c, codigoDemo: modoDev() ? CODIGO_DEMO : undefined };
  },
  async entrarPorCodigo({ telefone, codigo }) {
    if (!LOGIN_WHATSAPP) throw erro('Entrada por código no WhatsApp desligada.', 'BLOQUEADO');
    const c = await (await adapterAtual()).buscarClientePorTelefone(telefone);
    if (!c) throw erro('Não achamos agendamento com esse WhatsApp. Confira o número ou faça um agendamento.', 'NAO_ENCONTRADO');
    if (String(codigo) !== CODIGO_DEMO) throw erro('Código incorreto. Confira os 6 dígitos.');
    const s = { ator: 'cliente', id: c.id, nome: c.nome };
    definirSessao(s);
    return s;
  },
  async entrarDiarista({ email, senha }) {
    const d = senha === SENHA_DEMO_DIARISTA ? await (await adapterAtual()).buscarDiaristaPorEmail(email) : null;
    if (!d) throw erro('E-mail ou senha incorretos. Confira os dois.');
    const s = { ator: 'diarista', id: d.id, nome: d.nome };
    definirSessao(s);
    return s;
  },
  async entrarPrime({ email, senha }) {
    const u = CREDENCIAIS_MOCK.prime.find((x) => x.email === String(email).trim().toLowerCase() && x.senha === senha);
    if (!u) throw erro('E-mail ou senha incorretos. Confira os dois.');
    const s = { ator: 'prime', id: u.id, nome: u.nome };
    definirSessao(s);
    return s;
  },
  async trocarSenha({ atual, nova }) {
    const s = sessaoGuardada();
    if (!s || s.ator !== 'cliente') throw erro('Entre de novo pra continuar.', 'SESSAO_EXPIRADA');
    if (String(nova).length < SENHA_MINIMA_SITE) throw Object.assign(erro(`A senha precisa ter pelo menos ${SENHA_MINIMA_SITE} caracteres.`), { detalhes: { nova: `Pelo menos ${SENHA_MINIMA_SITE} caracteres` } });
    const ok = await (await adapterAtual()).trocarSenhaMock({ clienteId: s.id, senhaAtual: atual, senhaNova: nova });
    if (!ok) throw Object.assign(erro('A senha atual não confere.', 'SENHA_ATUAL_INCORRETA'), { detalhes: { atual: 'A senha atual não confere' } });
    return { trocada: true };
  },
  modoNovaSenha: async () => false,
  async definirNovaSenha() { throw erro('Na demonstração não há link de recuperação.', 'BLOQUEADO'); },
  async sair() { limparSessao(); },
  sessaoAtual() { return sessaoGuardada() || null; },
  async conferirSessao() { return sessaoGuardada() || null; },
};

// Adapter Supabase (B2): toda entrada por senha passa pela Edge Function "conta" (bloqueio progressivo, log em acessos).
// A sessão do Supabase fica com o supabase-js; aqui guardamos só o espelho { ator, id, nome } que as telas usam.
const ATOR_DO_PAPEL = { cliente: 'cliente', diarista: 'diarista', prime_admin: 'prime', prime_atendimento: 'prime' };

async function espelharSessao(c, papel, usuario) {
  const ator = ATOR_DO_PAPEL[papel];
  if (ator === 'cliente') {
    const { data } = await c.from('clientes').select('id, nome').eq('usuario_id', usuario.id).maybeSingle();
    return { ator, id: data?.id || null, nome: data?.nome || usuario.email, usuarioId: usuario.id };
  }
  if (ator === 'diarista') {
    const { data } = await c.from('diaristas').select('id, nome').eq('usuario_id', usuario.id).maybeSingle();
    return { ator, id: data?.id || null, nome: data?.nome || usuario.email, usuarioId: usuario.id };
  }
  return { ator, id: usuario.id, nome: usuario.email.split('@')[0], usuarioId: usuario.id, papel };
}

async function entrarComo(esperado, { email, identificador, senha }) {
  const r = await chamarConta('entrar', { identificador: identificador ?? email, senha, area: esperado });
  const c = await supabase();
  const { error } = await c.auth.setSession({ access_token: r.sessao.access_token, refresh_token: r.sessao.refresh_token });
  if (error) throw erro('Não deu pra abrir a sessão. Tente de novo.', 'ERRO_INTERNO');
  const ator = ATOR_DO_PAPEL[r.papel];
  if (ator !== esperado) {
    await c.auth.signOut({ scope: 'local' });
    const onde = { cliente: '"Sou cliente"', diarista: '"Sou diarista"', prime: '"Equipe Prime"' }[ator] || 'a entrada certa';
    throw erro(`Esta conta não é desta área. Use ${onde}.`, 'ATOR_SEM_PERMISSAO');
  }
  const s = await espelharSessao(c, r.papel, r.usuario);
  definirSessao(s);
  return s;
}

const supabaseAuth = {
  tipo: 'supabase',
  entrarCliente: (d) => entrarComo('cliente', d),
  entrarDiarista: (d) => entrarComo('diarista', d),
  entrarPrime: (d) => entrarComo('prime', d),
  async recuperarSenha(email) {
    const c = await supabase();
    const destino = new URL(url('entrar/', { modo: 'nova-senha' }), location.origin).href;
    // A resposta é a mesma exista ou não a conta (não revela cadastro). Em homologação o e-mail só sai com SMTP próprio.
    await c.auth.resetPasswordForEmail(String(email).trim().toLowerCase(), { redirectTo: destino }).catch(() => {});
    return { enviado: true };
  },
  async entrarGoogle() {
    throw erro('Entrar com Google ainda não está disponível. Use e-mail e senha.', 'BLOQUEADO');
  },
  async pedirCodigo() { throw erro('Entrada por código desligada.', 'BLOQUEADO'); },
  async entrarPorCodigo() { throw erro('Entrada por código desligada.', 'BLOQUEADO'); },
  async trocarSenha({ atual, nova }) {
    const c = await supabase();
    const { data } = await c.auth.getSession();
    if (!data.session) throw erro('Entre de novo pra continuar.', 'SESSAO_EXPIRADA');
    return chamarConta('trocar_senha', { atual, nova }, data.session.access_token);
  },
  /** true quando a página abriu pelo link de recuperação (sessão de recuperação na URL). */
  async modoNovaSenha() {
    const c = await supabase();
    const { data } = await c.auth.getSession();
    const amr = data.session ? JSON.parse(atob(data.session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).amr || [] : [];
    return amr.some((a) => a.method === 'recovery' || a.method === 'otp');
  },
  async definirNovaSenha(nova) {
    const c = await supabase();
    const { data } = await c.auth.getSession();
    if (!data.session) throw erro('O link de recuperação expirou. Peça outro em "Esqueci minha senha".', 'LINK_EXPIRADO');
    const r = await chamarConta('definir_senha', { nova }, data.session.access_token);
    await c.auth.signOut({ scope: 'local' }); // entra de novo com a senha nova, e o acesso fica registrado
    limparSessao();
    return r;
  },
  async sair() {
    try { await (await supabase()).auth.signOut({ scope: 'local' }); } catch { /* sem rede: limpa mesmo assim */ }
    limparSessao();
  },
  sessaoAtual() { return sessaoGuardada() || null; },
  /** Confere com o Supabase se a sessão ainda vale (token renovável e usuário não bloqueado); se não, limpa. */
  async conferirSessao() {
    const espelho = sessaoGuardada();
    if (!espelho) return null;
    const c = await supabase();
    const { data } = await c.auth.getSession();
    const { error } = data.session ? await c.auth.refreshSession() : { error: true };
    if (error) { limparSessao(); await c.auth.signOut({ scope: 'local' }).catch(() => {}); return null; }
    return espelho;
  },
};

export const auth = AUTH_ADAPTER === 'supabase' ? supabaseAuth : mock;
export function papel() { return auth.sessaoAtual()?.ator || 'publico'; }

/** Guarda de rota: redireciona pra tela de entrada se o papel não bate. Devolve a sessão quando ok. */
export function exigirPapel(esperado, urlEntrar) {
  const s = auth.sessaoAtual();
  if (!s || s.ator !== esperado) { location.replace(urlEntrar); return null; }
  // No Supabase o espelho local pode estar vencido (sessão expirada ou acesso bloqueado): confere e manda pra entrada.
  if (auth.tipo === 'supabase') auth.conferirSessao().then((ok) => { if (!ok) location.replace(urlEntrar); }).catch(() => {});
  return s;
}
