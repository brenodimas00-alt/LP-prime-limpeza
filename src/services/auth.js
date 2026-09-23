// Autenticação com adapters: mock (demonstração) agora; supabase na fase 2 (mesma interface).
// Interface: entrarCliente({email, senha}) | entrarDiarista({email, senha}) | entrarPrime({email, senha}) | recuperarSenha(email)
//            | entrarGoogle() | pedirCodigo/entrarPorCodigo (só com LOGIN_WHATSAPP) | sair() | sessaoAtual() | papel()
// A GUARDA DE ROTA NO FRONT É SÓ CONVENIÊNCIA: a autorização real é do backend (RLS no Supabase). Ver docs/API.md.
// A senha nunca sai do navegador em texto: o mock guarda e compara o SHA-256 (o Supabase Auth cuida disso na fase 2).
import { ADAPTER, modoDev, LOGIN_WHATSAPP } from '../config/app.js';
import { definirSessao, sessaoGuardada } from './sessao.js';
import { CREDENCIAIS_MOCK } from '../../scripts/fixtures/seed.js';
import { adapterAtual } from './api.js';

const CODIGO_DEMO = '123456';
const SENHA_DEMO_DIARISTA = 'diarista123'; // toda diarista cadastrada na demonstração entra com esta senha
const erro = (m, codigo = 'DADOS_INVALIDOS') => Object.assign(new Error(m), { codigo });

export async function hashSenha(senha) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(senha)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function limparSessao() { try { localStorage.removeItem('prime.sessao'); } catch { /* ignora */ } }

const mock = {
  tipo: 'mock',
  async entrarCliente({ email, senha }) {
    const r = await (await adapterAtual()).verificarCredencial({ email, senhaHash: await hashSenha(senha) });
    if (!r || r.tipo !== 'cliente') throw erro('E-mail ou senha incorretos. Confira os dois ou use "Esqueci minha senha".');
    const s = { ator: 'cliente', id: r.id, nome: r.nome };
    definirSessao(s);
    return s;
  },
  async recuperarSenha(email) {
    const existe = await (await adapterAtual()).existeCredencial(email);
    // Na demonstração não existe e-mail: a resposta é a mesma exista ou não a conta (não vaza cadastro).
    return { enviado: true, demo: modoDev() ? (existe ? 'Na demonstração não mandamos e-mail. A senha da cliente de teste é cliente123.' : 'Na demonstração não mandamos e-mail. Não há conta com esse e-mail neste navegador.') : undefined };
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
  async sair() { limparSessao(); },
  sessaoAtual() { return sessaoGuardada() || null; },
};

// Esqueleto do adapter Supabase (B2): mesma interface, chamando supabase.auth.* e lendo o papel da tabela perfis.
const supabase = {
  tipo: 'supabase',
  async entrarCliente() { throw erro('fase 2: auth.signInWithPassword({ email, password })', 'BLOQUEADO'); },
  async recuperarSenha() { throw erro('fase 2: auth.resetPasswordForEmail(email, { redirectTo })', 'BLOQUEADO'); },
  async entrarGoogle() { throw erro('fase 2: auth.signInWithOAuth({ provider: "google" })', 'BLOQUEADO'); },
  async pedirCodigo() { throw erro('phone OTP desligado', 'BLOQUEADO'); },
  async entrarPorCodigo() { throw erro('phone OTP desligado', 'BLOQUEADO'); },
  async entrarDiarista() { throw erro('fase 2: auth.signInWithPassword', 'BLOQUEADO'); },
  async entrarPrime() { throw erro('fase 2: auth.signInWithPassword + papel em perfis', 'BLOQUEADO'); },
  async sair() { throw erro('fase 2: auth.signOut()', 'BLOQUEADO'); },
  sessaoAtual() { return null; },
};

export const auth = ADAPTER === 'supabase' ? supabase : mock;
export function papel() { return auth.sessaoAtual()?.ator || 'publico'; }

/** Guarda de rota: redireciona pra tela de entrada se o papel não bate. Devolve a sessão quando ok. */
export function exigirPapel(esperado, urlEntrar) {
  const s = auth.sessaoAtual();
  if (!s || s.ator !== esperado) { location.replace(urlEntrar); return null; }
  return s;
}
