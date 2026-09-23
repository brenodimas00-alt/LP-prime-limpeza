// Edge Function "conta" (B2): toda autenticação por SENHA passa por aqui.
// A senha do Auth é HMAC-SHA256(AUTH_PEPPER, senha digitada): sem o pepper, o endpoint de senha do GoTrue não serve pra
// adivinhar senha, e o hook_token recusa login por senha sem o ticket que só esta function emite (login_iniciar).
// Ações: entrar | cadastrar | trocar_senha | definir_senha (depois do link de recuperação) | bloquear | desbloquear |
//        redefinir_senha (Prime) | completar_email (Prime, B7).
// Erro sempre em { erro: { codigo, mensagem, detalhes? } }, o mesmo formato do adapter http.
import { createClient } from 'npm:@supabase/supabase-js@2.117.1';

const URL_SUPABASE = Deno.env.get('SUPABASE_URL')!;
const CHAVE_SECRETA = Deno.env.get('PRIME_SECRET_KEY')!;
const CHAVE_PUBLICA = Deno.env.get('PRIME_PUBLISHABLE_KEY')!;
const PEPPER = Deno.env.get('AUTH_PEPPER')!;
const ORIGENS = [/^https:\/\/([a-z0-9-]+\.)?prime-limpeza\.pages\.dev$/, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/];
const OPCOES = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const PAPEIS_PRIME = ['prime_admin', 'prime_atendimento'];

const admin = createClient(URL_SUPABASE, CHAVE_SECRETA, OPCOES);
const publico = () => createClient(URL_SUPABASE, CHAVE_PUBLICA, OPCOES);

class ErroConta extends Error {
  constructor(public status: number, public codigo: string, mensagem: string, public detalhes?: unknown) { super(mensagem); }
}

async function derivar(senha: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(PEPPER), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(senha));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function cors(origem: string | null): Record<string, string> {
  const ok = origem && ORIGENS.some((r) => r.test(origem));
  return {
    ...(ok ? { 'Access-Control-Allow-Origin': origem!, Vary: 'Origin' } : {}),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function ipDe(req: Request): string | null {
  const bruto = req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for')?.split(',')[0] || '';
  const ip = bruto.trim();
  return /^[0-9a-fA-F:.]{3,45}$/.test(ip) ? ip : null;
}

async function rpc<T>(nome: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await admin.rpc(nome, args);
  if (error) {
    // códigos de negócio levantados pelo SQL (raise exception 'CODIGO')
    if (error.message === 'ATOR_SEM_PERMISSAO') throw new ErroConta(403, 'ATOR_SEM_PERMISSAO', 'Você não tem permissão pra isso.');
    if (error.message === 'NAO_ENCONTRADO') throw new ErroConta(404, 'NAO_ENCONTRADO', 'Cadastro não encontrado.');
    if (error.message === 'EMAIL_EM_USO') throw new ErroConta(409, 'EMAIL_EM_USO', 'Este e-mail já é usado por outra conta.', { email: 'E-mail já usado por outra conta' });
    if (error.message === 'DADOS_INVALIDOS') throw new ErroConta(400, 'DADOS_INVALIDOS', 'Confira o e-mail.', { email: 'Confira o e-mail' });
    if (error.message === 'CONDICAO_NAO_ATENDIDA') throw new ErroConta(409, 'CONDICAO_NAO_ATENDIDA', 'Este cadastro já tem acesso ou não veio da base importada.');
    if (error.message === 'ACESSO_BLOQUEADO') throw new ErroConta(403, 'ACESSO_BLOQUEADO', 'Seu acesso está bloqueado. Fale com a Prime.');
    throw new ErroConta(500, 'ERRO_INTERNO', 'Não deu pra concluir agora. Tente de novo em instantes.');
  }
  return data as T;
}

async function configAuth() {
  const { data } = await admin.from('configuracao').select('valor').eq('chave', 'auth').single();
  return data!.valor as { senha_minima_site: number };
}

function emailValido(e: unknown): string {
  const v = String(e ?? '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) || v.length > 254) throw new ErroConta(400, 'DADOS_INVALIDOS', 'Confira o e-mail.', { email: 'Confira o e-mail' });
  return v;
}

async function exigirSenhaNova(nova: unknown) {
  const { senha_minima_site } = await configAuth();
  const s = String(nova ?? '');
  if (s.length < senha_minima_site || s.length > 72) {
    throw new ErroConta(400, 'DADOS_INVALIDOS', `A senha precisa ter pelo menos ${senha_minima_site} caracteres.`, { senha: `Pelo menos ${senha_minima_site} caracteres` });
  }
  return s;
}

/** Usuário do token (Authorization: Bearer). */
async function usuarioDoToken(req: Request) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) throw new ErroConta(401, 'SESSAO_EXPIRADA', 'Entre de novo pra continuar.');
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new ErroConta(401, 'SESSAO_EXPIRADA', 'Entre de novo pra continuar.');
  const claims = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  return { user: data.user, token, claims };
}

async function exigirPrime(req: Request) {
  const { user } = await usuarioDoToken(req);
  const { data: p } = await admin.from('perfis').select('papel, bloqueado').eq('user_id', user.id).single();
  if (!p || p.bloqueado || !PAPEIS_PRIME.includes(p.papel)) throw new ErroConta(403, 'ATOR_SEM_PERMISSAO', 'Só a Prime pode fazer isso.');
  return user;
}

/** Tentativa de senha contra o Auth, com bloqueio progressivo e registro em acessos. */
async function tentarSenha(req: Request, email: string, senha: string) {
  const ini = await rpc<{ invalido?: boolean; bloqueado?: boolean; segundos?: number; tentativa?: number }>('login_iniciar', {
    p_email: email, p_ip: ipDe(req), p_dispositivo: (req.headers.get('user-agent') || '').slice(0, 300),
  });
  if (ini.invalido) throw new ErroConta(400, 'DADOS_INVALIDOS', 'Confira o e-mail.', { email: 'Confira o e-mail' });
  if (ini.bloqueado) {
    const min = Math.max(1, Math.ceil((ini.segundos || 60) / 60));
    throw new ErroConta(429, 'MUITAS_TENTATIVAS', `Muitas tentativas com este e-mail. Por segurança, espere ${min} minuto${min > 1 ? 's' : ''} e tente de novo, ou use "Esqueci minha senha".`, { segundos: ini.segundos });
  }
  const cliente = publico();
  const { data, error } = await cliente.auth.signInWithPassword({ email, password: await derivar(senha) });
  if (error || !data.session) {
    const msg = error?.message || '';
    const codigoAuth = (error as { code?: string } | null)?.code || '';
    const motivo = /bloqueado/i.test(msg) ? 'bloqueado pela Prime' : codigoAuth === 'email_not_confirmed' ? 'e-mail não confirmado' : 'senha incorreta ou conta inexistente';
    await rpc('login_finalizar', { p_tentativa: ini.tentativa, p_sucesso: false, p_motivo: motivo });
    if (motivo === 'bloqueado pela Prime') throw new ErroConta(403, 'ACESSO_BLOQUEADO', 'Seu acesso está bloqueado. Fale com a Prime.');
    if (motivo === 'e-mail não confirmado') throw new ErroConta(403, 'EMAIL_NAO_CONFIRMADO', 'Confirme seu e-mail pelo link que enviamos antes de entrar.');
    throw new ErroConta(401, 'CREDENCIAIS_INVALIDAS', 'E-mail ou senha incorretos. Confira os dois ou use "Esqueci minha senha".');
  }
  await rpc('login_finalizar', { p_tentativa: ini.tentativa, p_sucesso: true, p_motivo: null });
  return data.session;
}

async function registrarAcaoAdmin(ator: string, alvo: string, acao: string, detalhe: Record<string, unknown> = {}) {
  await rpc('conta_registrar_acao', { p_ator: ator, p_alvo: alvo, p_acao: acao, p_detalhe: detalhe });
}

/** Marca da importação no usuário do Auth (hash do documento; o mesmo de scripts/importa-clientes.mjs). */
async function marcaDocumento(documento: string) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`prime-importacao:${documento}`));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const ACOES: Record<string, (req: Request, corpo: Record<string, unknown>) => Promise<unknown>> = {
  async entrar(req, c) {
    const email = emailValido(c.email);
    const s = await tentarSenha(req, email, String(c.senha ?? ''));
    const papel = JSON.parse(atob(s.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).papel;
    return { sessao: { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at }, papel, usuario: { id: s.user.id, email: s.user.email } };
  },

  async cadastrar(_req, c) {
    const email = emailValido(c.email);
    const senha = await exigirSenhaNova(c.senha);
    const redirect = typeof c.redirectTo === 'string' && ORIGENS.some((r) => r.test(new URL(c.redirectTo as string).origin)) ? c.redirectTo as string : undefined;
    await rpc('conta_ticket_cadastro', { p_email: email });
    const { data, error } = await publico().auth.signUp({ email, password: await derivar(senha), options: { emailRedirectTo: redirect } });
    if (error) {
      const cod = (error as { code?: string }).code || '';
      console.error('conta.cadastrar: Auth recusou', cod, (error as { status?: number }).status);
      if (/not authorized/i.test(error.message) || /over_email_send_rate_limit/.test((error as { code?: string }).code || '')) {
        // SMTP padrão do Supabase: só entrega pro time do projeto e 2 e-mails/hora. BLOQUEADO até SMTP próprio.
        throw new ErroConta(503, 'EMAIL_INDISPONIVEL', 'Não conseguimos enviar o e-mail de confirmação agora. Fale com a Prime pelo WhatsApp.');
      }
      if (cod === 'email_address_invalid' || /email address .*invalid/i.test(error.message)) throw new ErroConta(400, 'DADOS_INVALIDOS', 'Confira o e-mail.', { email: 'Confira o e-mail' });
      throw new ErroConta(400, 'DADOS_INVALIDOS', 'Não deu pra criar a conta com esses dados.');
    }
    // e-mail já cadastrado: o Auth devolve usuário sem identidades (não revela se existe)
    return { criado: true, confirmarEmail: true, jaExistia: (data.user?.identities?.length ?? 0) === 0 };
  },

  async trocar_senha(req, c) {
    const { user, token } = await usuarioDoToken(req);
    const nova = await exigirSenhaNova(c.nova);
    await tentarSenha(req, user.email!, String(c.atual ?? '')).catch((e) => {
      if (e instanceof ErroConta && e.codigo === 'CREDENCIAIS_INVALIDAS') throw new ErroConta(401, 'SENHA_ATUAL_INCORRETA', 'A senha atual não confere.', { atual: 'A senha atual não confere' });
      throw e;
    });
    const { error } = await admin.auth.admin.updateUserById(user.id, { password: await derivar(nova) });
    if (error) throw new ErroConta(500, 'ERRO_INTERNO', 'Não deu pra trocar a senha agora. Tente de novo.');
    await admin.auth.admin.signOut(token, 'others').catch(() => {});
    await registrarAcaoAdmin(user.id, user.id, 'trocar_senha');
    return { trocada: true };
  },

  async definir_senha(req, c) {
    const { user, claims } = await usuarioDoToken(req);
    const amr: { method: string; timestamp: number }[] = claims.amr || [];
    const rec = amr.find((a) => a.method === 'recovery' || a.method === 'otp');
    if (!rec || Date.now() / 1000 - rec.timestamp > 15 * 60) throw new ErroConta(403, 'LINK_EXPIRADO', 'O link de recuperação expirou. Peça outro em "Esqueci minha senha".');
    const nova = await exigirSenhaNova(c.nova);
    // sessão de recuperação emitida ANTES de um bloqueio da Prime não pode trocar a senha
    const { data: perfil } = await admin.from('perfis').select('bloqueado').eq('user_id', user.id).maybeSingle();
    if (perfil?.bloqueado) throw new ErroConta(403, 'ACESSO_BLOQUEADO', 'Seu acesso está bloqueado. Fale com a Prime.');
    const { error } = await admin.auth.admin.updateUserById(user.id, { password: await derivar(nova) });
    if (error) throw new ErroConta(500, 'ERRO_INTERNO', 'Não deu pra salvar a senha agora. Tente de novo.');
    await registrarAcaoAdmin(user.id, user.id, 'definir_senha_recuperacao');
    return { definida: true };
  },

  /**
   * B7: a Prime completa o e-mail de cliente importado sem acesso; o acesso nasce na hora (6 primeiros dígitos).
   * Retomável: conta órfã de uma queda anterior é reaproveitada (mesmo e-mail) ou apagada; o vínculo fecha atômico no banco.
   */
  async completar_email(req, c) {
    const ator = await exigirPrime(req);
    const email = emailValido(c.email);
    const clienteId = String(c.clienteId ?? '');
    const ini = await rpc<{ documento: string; email: string; marca: string; reaproveitar: string | null; apagar: string[] }>('conta_completar_email_iniciar', { p_ator: ator.id, p_cliente: clienteId, p_email: email });
    for (const id of ini.apagar) await admin.auth.admin.deleteUser(id).catch(() => {});
    let userId = ini.reaproveitar;
    let criadaAgora = false;
    if (!userId) {
      const { data, error } = await admin.auth.admin.createUser({
        email: ini.email, password: await derivar(ini.documento.slice(0, 6)), email_confirm: true,
        app_metadata: { origem: 'importado', marca_importacao: ini.marca }, user_metadata: { origem: 'importado' },
      });
      if (error || !data.user) throw new ErroConta(409, 'EMAIL_EM_USO', 'Este e-mail já é usado por outra conta.', { email: 'E-mail já usado por outra conta' });
      userId = data.user.id; criadaAgora = true;
    }
    const ok = await rpc<boolean>('conta_completar_email_concluir', { p_ator: ator.id, p_cliente: clienteId, p_email: ini.email, p_user: userId });
    if (!ok) {
      if (criadaAgora) await admin.auth.admin.deleteUser(userId).catch(() => {}); // outra chamada concluiu antes
      throw new ErroConta(409, 'CONDICAO_NAO_ATENDIDA', 'Este cadastro acabou de receber acesso por outra pessoa da Prime.');
    }
    await registrarAcaoAdmin(ator.id, userId, 'completar_email', { clienteId });
    return { acessoCriado: true };
  },

  async bloquear(req, c) { return definirBloqueio(req, c, true); },
  async desbloquear(req, c) { return definirBloqueio(req, c, false); },

  async redefinir_senha(req, c) {
    const ator = await exigirPrime(req);
    const alvo = String(c.userId ?? '');
    const { data: cli } = await admin.from('clientes').select('origem, documento').eq('usuario_id', alvo).maybeSingle();
    const { data: u } = await admin.auth.admin.getUserById(alvo);
    if (!u?.user) throw new ErroConta(404, 'NAO_ENCONTRADO', 'Usuário não encontrado.');
    if (cli?.origem === 'importado' && cli.documento) {
      // regra da cliente (B7): importado volta pra os 6 primeiros caracteres do documento
      const { error: eu } = await admin.auth.admin.updateUserById(alvo, { password: await derivar(cli.documento.slice(0, 6)) });
      if (eu) throw new ErroConta(500, 'ERRO_INTERNO', 'Não deu pra redefinir a senha agora. Tente de novo.');
      await registrarAcaoAdmin(ator.id, alvo, 'redefinir_senha', { regra: 'seis_digitos_documento' });
      return { redefinida: true, regra: 'seis_digitos_documento' };
    }
    const { error } = await publico().auth.resetPasswordForEmail(u.user.email!);
    await registrarAcaoAdmin(ator.id, alvo, 'redefinir_senha', { regra: 'link_por_email', enviado: !error });
    if (error) throw new ErroConta(503, 'EMAIL_INDISPONIVEL', 'Não conseguimos enviar o link de nova senha agora (e-mail indisponível).');
    return { redefinida: false, linkEnviado: true };
  },
};

async function definirBloqueio(req: Request, c: Record<string, unknown>, bloquear: boolean) {
  const ator = await exigirPrime(req);
  const alvo = String(c.userId ?? '');
  if (alvo === ator.id) throw new ErroConta(400, 'DADOS_INVALIDOS', 'Você não pode bloquear o próprio acesso.');
  await rpc('conta_definir_bloqueio', { p_ator: ator.id, p_alvo: alvo, p_bloquear: bloquear, p_motivo: String(c.motivo ?? '').slice(0, 200) });
  return { bloqueado: bloquear };
}

Deno.serve(async (req) => {
  const h = cors(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: h });
  const responder = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers: { ...h, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  try {
    if (req.method !== 'POST') throw new ErroConta(405, 'DADOS_INVALIDOS', 'Método não permitido.');
    const texto = await req.text();
    if (texto.length > 4096) throw new ErroConta(413, 'DADOS_INVALIDOS', 'Pedido grande demais.');
    const corpo = JSON.parse(texto || '{}');
    const fn = ACOES[String(corpo.acao)];
    if (!fn) throw new ErroConta(400, 'DADOS_INVALIDOS', 'Ação desconhecida.');
    return responder(200, await fn(req, corpo));
  } catch (e) {
    if (e instanceof ErroConta) return responder(e.status, { erro: { codigo: e.codigo, mensagem: e.message, detalhes: e.detalhes } });
    if (e instanceof SyntaxError) return responder(400, { erro: { codigo: 'DADOS_INVALIDOS', mensagem: 'Pedido inválido.' } });
    console.error('conta: erro inesperado', (e as Error)?.message);
    return responder(500, { erro: { codigo: 'ERRO_INTERNO', mensagem: 'Não deu pra concluir agora. Tente de novo em instantes.' } });
  }
});
