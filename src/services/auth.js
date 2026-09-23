// Autenticação com adapters: mock (demonstração, localStorage) agora; supabase na fase 2 (mesma interface).
// Interface: entrar(credenciais) -> sessao | sair() | sessaoAtual() -> {ator, id, nome} | papel() -> ator.
// A GUARDA DE ROTA NO FRONT É SÓ CONVENIÊNCIA: a autorização real é do backend (RLS no Supabase). Ver docs/API.md.
import { ADAPTER, modoDev } from '../config/app.js';
import { definirSessao, sessaoGuardada } from './sessao.js';
import { CREDENCIAIS_MOCK } from '../../scripts/fixtures/seed.js';

const CODIGO_DEMO = '123456';

const erro = (m, codigo = 'DADOS_INVALIDOS') => Object.assign(new Error(m), { codigo });

function limparSessao() { try { localStorage.removeItem('prime.sessao'); } catch { /* ignora */ } }

const mock = {
  tipo: 'mock',
  /** Cliente: telefone + código de 6 dígitos (no mock o código é fixo e aparece na tela com ?dev=1). */
  async pedirCodigo(telefone) {
    const d = String(telefone).replace(/\D/g, '');
    const c = CREDENCIAIS_MOCK.clientes.find((x) => x.telefone === d);
    return { enviado: true, existe: !!c, codigoDemo: modoDev() ? CODIGO_DEMO : undefined };
  },
  async entrarCliente({ telefone, codigo }) {
    const d = String(telefone).replace(/\D/g, '');
    const c = CREDENCIAIS_MOCK.clientes.find((x) => x.telefone === d);
    if (!c) throw erro('Não achamos agendamento com esse WhatsApp. Confira o número ou faça um agendamento.', 'NAO_ENCONTRADO');
    if (String(codigo) !== CODIGO_DEMO) throw erro('Código incorreto. Confira os 6 dígitos.');
    const s = { ator: 'cliente', id: c.id, nome: c.nome };
    definirSessao(s);
    return s;
  },
  async entrarDiarista({ email, senha }) {
    const d = CREDENCIAIS_MOCK.diaristas.find((x) => x.email === String(email).trim().toLowerCase() && x.senha === senha);
    if (!d) throw erro('E-mail ou senha incorretos.');
    const s = { ator: 'diarista', id: d.id, nome: d.nome };
    definirSessao(s);
    return s;
  },
  async entrarPrime({ email, senha }) {
    const u = CREDENCIAIS_MOCK.prime.find((x) => x.email === String(email).trim().toLowerCase() && x.senha === senha);
    if (!u) throw erro('E-mail ou senha incorretos.');
    const s = { ator: 'prime', id: u.id, nome: u.nome };
    definirSessao(s);
    return s;
  },
  async sair() { limparSessao(); },
  sessaoAtual() { return sessaoGuardada() || null; },
};

// Esqueleto do adapter Supabase (fase 2): mesma interface, chamando supabase.auth.* e lendo o papel de um claim/tabela.
const supabase = {
  tipo: 'supabase',
  async pedirCodigo() { throw new Error('Supabase Auth ainda não configurado (fase 2): auth.signInWithOtp({ phone })'); },
  async entrarCliente() { throw new Error('fase 2: auth.verifyOtp({ phone, token, type: "sms" })'); },
  async entrarDiarista() { throw new Error('fase 2: auth.signInWithPassword({ email, password })'); },
  async entrarPrime() { throw new Error('fase 2: auth.signInWithPassword + papel via tabela usuarios_prime'); },
  async sair() { throw new Error('fase 2: auth.signOut()'); },
  sessaoAtual() { return null; },
};

export const auth = ADAPTER === 'http' ? supabase : mock;
export function papel() { return auth.sessaoAtual()?.ator || 'publico'; }

/** Guarda de rota: redireciona pra tela de entrada se o papel não bate. Devolve a sessão quando ok. */
export function exigirPapel(esperado, urlEntrar) {
  const s = auth.sessaoAtual();
  if (!s || s.ator !== esperado) { location.replace(urlEntrar); return null; }
  return s;
}
