// Edge Function "conta" (B2): toda autenticação por SENHA passa por aqui.
// A senha do Auth é HMAC-SHA256(AUTH_PEPPER, senha): sem o pepper, o endpoint de senha do GoTrue não serve pra adivinhar
// senha, e o hook_token recusa login por senha sem o ticket que só esta function emite (login_iniciar_id).
// Login da cliente (decisão da cliente, 24/09/2026): campo único "CPF, e-mail ou celular", tipo detectado AQUI (mesma
// regra de detectarIdentificador em src/domain/validacao.js). Senha padrão: por e-mail ou celular, os 6 primeiros
// caracteres do CPF/CNPJ (é o que o Auth guarda); pelo CPF, a data de nascimento DDMMAAAA (conferida aqui). Senha própria
// (trocada pela cliente) vale pra qualquer via. Erro sempre genérico, com o mesmo tempo de resposta.
// Ações: entrar | cadastrar | trocar_senha | definir_senha (depois do link de recuperação) | bloquear | desbloquear |
//        redefinir_senha (Prime) | completar_email (Prime, B7) | executar_exclusao (prime_admin, L1).
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
    // códigos de negócio levantados pelo SQL. Com detalhes (privado.erro: detail = mensagem, hint = JSON): repassa.
    if (['DOCUMENTO_EM_USO', 'EMAIL_EM_USO', 'DADOS_INVALIDOS'].includes(error.message) && error.hint) {
      let detalhes; try { detalhes = JSON.parse(error.hint); } catch { detalhes = undefined; }
      throw new ErroConta(error.message === 'DADOS_INVALIDOS' ? 400 : 409, error.message, error.details || 'Confira os dados.', detalhes);
    }
    // solicitação sem login (agendamento v2): erros de negócio da cotação/gravação vão pro navegador como vieram
    if (['DATA_INVALIDA', 'REGIAO_NAO_ATENDIDA', 'REGIAO_SOB_CONSULTA', 'CONFLITO_IDEMPOTENCIA'].includes(error.message)
        || (error.message === 'CONDICAO_NAO_ATENDIDA' && error.hint)) {
      let detalhes; try { detalhes = error.hint ? JSON.parse(error.hint) : undefined; } catch { detalhes = undefined; }
      throw new ErroConta(error.message === 'CONFLITO_IDEMPOTENCIA' || error.message === 'CONDICAO_NAO_ATENDIDA' ? 409 : 400, error.message, error.details || 'Confira os dados.', detalhes);
    }
    if (error.message === 'ATOR_SEM_PERMISSAO') throw new ErroConta(403, 'ATOR_SEM_PERMISSAO', 'Você não tem permissão pra isso.');
    if (error.message === 'NAO_ENCONTRADO') throw new ErroConta(404, 'NAO_ENCONTRADO', 'Cadastro não encontrado.');
    if (error.message === 'EMAIL_EM_USO') throw new ErroConta(409, 'EMAIL_EM_USO', 'Este e-mail já é usado por outra conta.', { email: 'E-mail já usado por outra conta' });
    if (error.message === 'DADOS_INVALIDOS') throw new ErroConta(400, 'DADOS_INVALIDOS', 'Confira o e-mail.', { email: 'Confira o e-mail' });
    if (error.message === 'CONDICAO_NAO_ATENDIDA') throw new ErroConta(409, 'CONDICAO_NAO_ATENDIDA', error.details || 'Este cadastro já tem acesso ou não veio da base importada.');
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
  // A0: conta com troca de senha pendente não age como Prime (mesma regra de privado.papel() no banco)
  if (trocaPendente(user)) throw new ErroConta(403, 'TROCA_SENHA_OBRIGATORIA', 'Troque a senha temporária antes de continuar.');
  return user;
}

// ---------- login por identificador ----------
const MSG_GENERICA = 'Não conseguimos entrar com esses dados. Confira e tente de novo. Se não der pelo CPF, entre pelo e-mail ou pelo celular.';

function cpfValido(d: string): boolean {
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  for (const n of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i);
    if (((soma * 10) % 11) % 10 !== Number(d[n])) return false;
  }
  return true;
}

/** Mesma regra de detectarIdentificador (src/domain/validacao.js): e-mail tem @; CPF válido; celular 10/11 dígitos. */
function detectar(texto: unknown): { tipo: 'email' | 'cpf' | 'celular' | null; valor: string } {
  const t = String(texto ?? '').trim();
  if (t.includes('@')) return { tipo: 'email', valor: t.toLowerCase() };
  let d = t.replace(/\D/g, '');
  if (d.length === 11 && cpfValido(d)) return { tipo: 'cpf', valor: d };
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  if (d.length === 10 || d.length === 11) return { tipo: 'celular', valor: d };
  return { tipo: null, valor: '' };
}

function iguais(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a); const y = new TextEncoder().encode(b);
  let r = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) r |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return r === 0;
}

/** Recusa com o mesmo tempo aproximado de uma ida ao Auth (não dá pra saber pelo tempo se o cadastro existe). */
const esperaUniforme = () => new Promise((r) => setTimeout(r, 250 + Math.floor(Math.random() * 150)));

type Resolvido = { user_id?: string; email?: string; papel?: string; senha_propria?: boolean; doc6?: string | null; nascimento?: string | null; duplicado?: boolean };

/**
 * Login com bloqueio progressivo (por conta, somando as três vias, e por IP) e registro em acessos.
 * area: 'cliente' aceita CPF, e-mail ou celular; diarista e Prime entram só por e-mail (senha própria).
 */
async function autenticar(req: Request, identificador: unknown, senha: string, area = 'cliente') {
  const id = detectar(identificador);
  const tipo = area === 'cliente' ? id.tipo : (id.tipo === 'email' ? 'email' : null);
  const res: Resolvido = tipo ? await rpc<Resolvido>('login_resolver', { p_tipo: tipo, p_valor: id.valor }) : {};
  const ini = await rpc<{ bloqueado?: boolean; segundos?: number; tentativa?: number }>('login_iniciar_id', {
    p_tipo: tipo, p_ident: id.valor || String(identificador ?? '').trim().slice(0, 254), p_user: res.user_id ?? null, p_email: res.email ?? null,
    p_ip: ipDe(req), p_dispositivo: (req.headers.get('user-agent') || '').slice(0, 300),
  });
  if (ini.bloqueado) {
    const min = Math.max(1, Math.ceil((ini.segundos || 60) / 60));
    throw new ErroConta(429, 'MUITAS_TENTATIVAS', `Muitas tentativas. Por segurança, espere ${min} minuto${min > 1 ? 's' : ''} e tente de novo, ou fale com a Prime.`, { segundos: ini.segundos });
  }
  const recusar = async (motivo: string) => {
    await rpc('login_finalizar', { p_tentativa: ini.tentativa, p_sucesso: false, p_motivo: motivo });
    await esperaUniforme();
    throw new ErroConta(401, 'CREDENCIAIS_INVALIDAS', area === 'cliente' ? MSG_GENERICA : 'E-mail ou senha incorretos. Confira os dois.');
  };
  if (!tipo) return recusar('identificador inválido');
  if (res.duplicado) return recusar('celular de mais de um cliente');
  if (!res.user_id || !res.email) return recusar('conta inexistente');
  // senha que vai pro Auth: a própria (qualquer via) ou, na regra padrão, os 6 primeiros do documento
  let senhaAuth = senha;
  if (tipo === 'cpf' && !res.senha_propria) {
    if (!res.nascimento) return recusar('CPF sem data de nascimento');
    if (!res.doc6 || !iguais(senha, res.nascimento)) return recusar('senha incorreta');
    senhaAuth = res.doc6;
  }
  const { data, error } = await publico().auth.signInWithPassword({ email: res.email, password: await derivar(senhaAuth) });
  if (error || !data.session) {
    const msg = error?.message || '';
    const codigoAuth = (error as { code?: string } | null)?.code || '';
    const motivo = /bloqueado/i.test(msg) ? 'bloqueado pela Prime' : codigoAuth === 'email_not_confirmed' ? 'e-mail não confirmado' : 'senha incorreta';
    if (motivo === 'senha incorreta') return recusar(motivo);
    // senha certa, conta com restrição: dá pra dizer (quem chegou aqui acertou a senha)
    await rpc('login_finalizar', { p_tentativa: ini.tentativa, p_sucesso: false, p_motivo: motivo });
    if (motivo === 'bloqueado pela Prime') throw new ErroConta(403, 'ACESSO_BLOQUEADO', 'Seu acesso está bloqueado. Fale com a Prime.');
    throw new ErroConta(403, 'EMAIL_NAO_CONFIRMADO', 'Confirme seu e-mail pelo link que enviamos antes de entrar.');
  }
  await rpc('login_finalizar', { p_tentativa: ini.tentativa, p_sucesso: true, p_motivo: null });
  return data.session;
}

/** Tentativa de senha contra o Auth por e-mail (troca de senha de quem já tem senha própria). */
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

/** A0: marca de troca de senha obrigatória (app_metadata, que o usuário não edita). */
function trocaPendente(u: { app_metadata?: Record<string, unknown> } | null | undefined): boolean {
  return u?.app_metadata?.troca_senha_obrigatoria === true;
}

type SessaoAuth = { access_token: string; refresh_token: string; expires_at?: number; user: { id: string; email?: string; app_metadata?: Record<string, unknown> } };
function respostaSessao(s: SessaoAuth) {
  const papel = JSON.parse(atob(s.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).papel;
  return {
    sessao: { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at }, papel,
    usuario: { id: s.user.id, email: s.user.email }, ...(trocaPendente(s.user) ? { trocaSenha: true } : {}),
  };
}

/** A conta já existe: se a entrada falhar agora (limite, rede), devolve sem sessão e o front manda entrar (revisão do GPT). */
async function sessaoDepoisDoCadastro(req: Request, email: string, senha: string, area: string) {
  try { return respostaSessao(await autenticar(req, email, senha, area)); } catch { return { sessao: null }; }
}

const ACOES: Record<string, (req: Request, corpo: Record<string, unknown>) => Promise<unknown>> = {
  async entrar(req, c) {
    const area = ['cliente', 'diarista', 'prime'].includes(String(c.area)) ? String(c.area) : 'cliente';
    return respostaSessao(await autenticar(req, c.identificador ?? c.email, String(c.senha ?? ''), area));
  },

  /**
   * Cliente nova pelo site (decisão da cliente, 24/09/2026): sem senha escolhida e sem confirmação de e-mail. A conta nasce
   * com a regra padrão (6 primeiros do CPF/CNPJ; pelo CPF, a data de nascimento) e o cadastro já vinculado.
   * c.cliente: {tipo, nome, telefone, email, cpf|cnpj, dataNascimento (PF), razaoSocial, responsavel, endereco}.
   */
  async cadastrar(req, c) {
    if (!(await rpc<boolean>('conta_cadastro_permitido', { p_ip: ipDe(req) }))) {
      throw new ErroConta(429, 'MUITAS_TENTATIVAS', 'Muitos cadastros deste endereço. Tente de novo mais tarde ou fale com a Prime.');
    }
    const v = await rpc<{ cliente: { email: string }; documento: string }>('conta_validar_cliente_novo', { p_dados: c.cliente ?? {} });
    // L1: sem aceite da versão vigente dos termos, nem cria a conta (o banco confere a versão de novo ao gravar)
    const aceite = String(c.aceite ?? '');
    if (!aceite) throw new ErroConta(400, 'DADOS_INVALIDOS', 'Aceite os Termos de Uso e a Política de Privacidade.', { aceite: 'Aceite os termos para continuar' });
    // conferida ANTES de criar a conta: falhar depois deixaria cadastro órfão
    if (aceite !== await rpc<string>('versao_legal', {})) throw new ErroConta(409, 'CONDICAO_NAO_ATENDIDA', 'Os termos mudaram. Recarregue a página e leia a versão nova.');
    // conta de teste (padrão dos testes de homologação) nasce marcada: a limpeza só apaga o que tem as duas marcas
    const ficticio = /^teste-[a-z0-9-]+@example\.com$/.test(v.cliente.email);
    const { data, error } = await admin.auth.admin.createUser({
      email: v.cliente.email, password: await derivar(v.documento.slice(0, 6)), email_confirm: true,
      user_metadata: { origem: 'site', ...(ficticio ? { ficticio: true } : {}) },
    });
    if (error || !data.user) throw new ErroConta(409, 'EMAIL_EM_USO', 'Já existe conta com este e-mail. Entre na sua conta.', { email: 'Já existe conta com este e-mail' });
    try {
      // cadastro e aceite dos termos numa transação só (revisão do GPT: separados, falhar no meio deixava cadastro órfão)
      await rpc('conta_cadastrar_cliente_com_aceite', { p_user: data.user.id, p_dados: c.cliente, p_versao: aceite });
    } catch (e) {
      // nada fica pela metade: apaga a conta SÓ se o cadastro não foi gravado (a resposta pode ter se perdido depois do commit)
      const { data: gravado } = await admin.from('clientes').select('id').eq('usuario_id', data.user.id).maybeSingle();
      if (!gravado) { await admin.auth.admin.deleteUser(data.user.id).catch(() => {}); throw e; }
      // gravou e só a resposta se perdeu: segue como sucesso (repetir daria "e-mail em uso")
    }
    await registrarAcaoAdmin(data.user.id, data.user.id, 'cadastrar', { regra: 'padrao' });
    // F2: já devolve a sessão (entra pela mesma via do login, com log em acessos), pra solicitação seguir logada
    return { criado: true, ...(await sessaoDepoisDoCadastro(req, v.cliente.email, v.documento.slice(0, 6), 'cliente')) };
  },

  /**
   * Solicitação SEM login (agendamento v2, spec 1.4). A resposta é SEMPRE {enviado: true}: não revela se o CPF/CNPJ ou o
   * e-mail já existem. Tudo no banco numa transação (conta_solicitar): cadastro existente é vinculado sem sobrescrever;
   * cadastro novo nasce sem acesso e, se o e-mail estiver livre, o acesso é criado aqui pela regra padrão (6 primeiros do
   * CPF/CNPJ) e ligado depois. Falhou o acesso: o cliente e a solicitação ficam, com a pendência "e-mail usado por outra conta".
   * c: {cliente, solicitacao, endereco, aceiteCondicoes, valorEsperadoCentavos, aceite (termos), marketing[], chave}.
   */
  async solicitar(req, c) {
    if (!(await rpc<boolean>('conta_cadastro_permitido', { p_ip: ipDe(req) }))) {
      throw new ErroConta(429, 'MUITAS_TENTATIVAS', 'Muitas solicitações deste endereço. Tente de novo mais tarde ou fale com a Prime.');
    }
    const aceite = String(c.aceite ?? '');
    if (!aceite) throw new ErroConta(400, 'DADOS_INVALIDOS', 'Aceite os Termos de Uso e a Política de Privacidade.', { aceite: 'Aceite os termos para continuar' });
    if (aceite !== await rpc<string>('versao_legal', {})) throw new ErroConta(409, 'CONDICAO_NAO_ATENDIDA', 'Os termos mudaram. Recarregue a página e leia a versão nova.');
    const chave = String(c.chave ?? '');
    const r = await rpc<{ pedidoId: string; clienteId: string; criarAcesso: boolean }>('conta_solicitar', {
      p_dados: { cliente: c.cliente, solicitacao: c.solicitacao, endereco: c.endereco, aceiteCondicoes: c.aceiteCondicoes, valorEsperadoCentavos: c.valorEsperadoCentavos ?? null },
      p_chave: chave,
    });
    if (r.criarAcesso) {
      const { data: cli } = await admin.from('clientes').select('email, documento, usuario_id, ficticio').eq('id', r.clienteId).single();
      if (cli && !cli.usuario_id) {
        const { data, error } = await admin.auth.admin.createUser({
          email: cli.email, password: await derivar(String(cli.documento).slice(0, 6)), email_confirm: true,
          user_metadata: { origem: 'site', ...(cli.ficticio ? { ficticio: true } : {}) },
        });
        // e-mail já no Auth: pendência pra Prime. Outra falha (rede, Auth fora): erro; o navegador repete com a MESMA chave,
        // o banco devolve o mesmo resultado (sem pedido novo) e o acesso é tentado de novo.
        const marketing = Array.isArray(c.marketing) ? c.marketing.filter((k) => k === 'marketing_whatsapp' || k === 'marketing_email') : [];
        if (error || !data.user) {
          // repetição (ou chamada simultânea com a mesma chave) depois de o Auth criar o usuário: ele é religado a este
          // cadastro; já ligado por outra chamada, tudo certo; e-mail de outra conta, pendência; resto, erro e nova tentativa
          const u = await rpc<string | null>('conta_vincular_orfao', { p_cliente: r.clienteId, p_email: cli.email, p_versao: aceite, p_marketing: marketing });
          const { data: agora } = await admin.from('clientes').select('usuario_id').eq('id', r.clienteId).single();
          if (!u && !agora?.usuario_id) {
            if (error && /already|registered|exists/i.test(error.message)) await rpc('conta_marcar_pendencia', { p_cliente: r.clienteId, p_pendencia: 'email_em_uso' });
            else throw new ErroConta(503, 'SERVICO_INDISPONIVEL', 'Não conseguimos concluir agora. Tente de novo: sua solicitação não vai duplicar.');
          }
        } else {
          await rpc('conta_vincular_acesso', { p_cliente: r.clienteId, p_user: data.user.id, p_versao: aceite, p_marketing: marketing });
          await registrarAcaoAdmin(data.user.id, data.user.id, 'cadastrar', { regra: 'padrao', origem: 'solicitacao' });
        }
      }
    }
    return { enviado: true };
  },

  /**
   * Diarista nova pelo site (F2): conta com e-mail e senha própria + rascunho do cadastro (id do rascunho do front),
   * antes do primeiro documento. Devolve a sessão.
   */
  async cadastrar_diarista(req, c) {
    if (!(await rpc<boolean>('conta_cadastro_permitido', { p_ip: ipDe(req) }))) {
      throw new ErroConta(429, 'MUITAS_TENTATIVAS', 'Muitos cadastros deste endereço. Tente de novo mais tarde ou fale com a Prime.');
    }
    const email = emailValido(c.email);
    const senha = await exigirSenhaNova(c.senha);
    const id = String(c.id ?? '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new ErroConta(400, 'DADOS_INVALIDOS', 'Cadastro inválido. Recarregue a página.');
    const ficticio = /^teste-[a-z0-9-]+@example\.com$/.test(email);
    const { data, error } = await admin.auth.admin.createUser({
      email, password: await derivar(senha), email_confirm: true, user_metadata: { origem: 'site', ...(ficticio ? { ficticio: true } : {}) },
    });
    if (error || !data.user) throw new ErroConta(409, 'EMAIL_EM_USO', 'Já existe conta com este e-mail. Entre pela área da diarista.', { email: 'Já existe conta com este e-mail' });
    try {
      await rpc('conta_criar_rascunho_diarista', { p_user: data.user.id, p_id: id });
      await rpc('conta_senha_propria', { p_user: data.user.id, p_propria: true });
    } catch (e) {
      await admin.auth.admin.deleteUser(data.user.id).catch(() => {});
      throw e;
    }
    await registrarAcaoAdmin(data.user.id, data.user.id, 'cadastrar_diarista', {});
    return { criado: true, ...(await sessaoDepoisDoCadastro(req, email, senha, 'diarista')) };
  },

  async trocar_senha(req, c) {
    const { user, token } = await usuarioDoToken(req);
    const nova = await exigirSenhaNova(c.nova);
    // a atual é a que a cliente usa pra entrar: a própria, ou (regra padrão) os 6 primeiros do documento ou o nascimento
    const res = await rpc<Resolvido>('login_resolver', { p_tipo: 'email', p_valor: user.email! });
    const atual = String(c.atual ?? '');
    if (trocaPendente(user) && iguais(atual, nova)) throw new ErroConta(400, 'DADOS_INVALIDOS', 'A senha nova precisa ser diferente da temporária.', { nova: 'Use uma senha diferente da temporária' });
    const viaEmail = res.senha_propria || !res.nascimento || !iguais(atual, res.nascimento) ? atual : res.doc6!;
    await tentarSenha(req, user.email!, viaEmail).catch((e) => {
      if (e instanceof ErroConta && e.codigo === 'CREDENCIAIS_INVALIDAS') throw new ErroConta(401, 'SENHA_ATUAL_INCORRETA', 'A senha atual não confere.', { atual: 'A senha atual não confere' });
      throw e;
    });
    const { error } = await admin.auth.admin.updateUserById(user.id, { password: await derivar(nova) });
    if (error) throw new ErroConta(500, 'ERRO_INTERNO', 'Não deu pra trocar a senha agora. Tente de novo.');
    await rpc('conta_senha_propria', { p_user: user.id, p_propria: true });
    if (trocaPendente(user)) {
      const { error: em } = await admin.auth.admin.updateUserById(user.id, { app_metadata: { ...user.app_metadata, troca_senha_obrigatoria: false } });
      if (em) throw new ErroConta(500, 'ERRO_INTERNO', 'A senha foi trocada, mas não deu pra liberar o acesso. Tente trocar de novo.');
    }
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
    await rpc('conta_senha_propria', { p_user: user.id, p_propria: true });
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

  /**
   * L1: exclusão de dados pedida pela cliente (só prime_admin). O banco anonimiza e preserva o que a lei obriga; aqui
   * o usuário do Auth é apagado (encerra login e sessões). Retomável: se a remoção do Auth falhar, chamar de novo termina.
   */
  async executar_exclusao(req, c) {
    const ator = await exigirPrime(req);
    const pedido = String(c.pedidoId ?? '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pedido)) throw new ErroConta(404, 'NAO_ENCONTRADO', 'Pedido não encontrado.');
    const r = await rpc<{ estado: string; userId: string | null }>('conta_executar_exclusao', { p_ator: ator.id, p_pedido: pedido });
    if (r.estado === 'executado') return { estado: 'executado' };
    if (r.userId) {
      const { error } = await admin.auth.admin.deleteUser(r.userId);
      if (error && !/not.?found/i.test(error.message)) throw new ErroConta(503, 'SERVICO_INDISPONIVEL', 'Os dados foram anonimizados, mas o acesso ainda não foi encerrado. Tente de novo.');
    }
    await rpc('conta_concluir_exclusao', { p_ator: ator.id, p_pedido: pedido });
    return { estado: 'executado' };
  },

  async bloquear(req, c) { return definirBloqueio(req, c, true); },
  async desbloquear(req, c) { return definirBloqueio(req, c, false); },

  async redefinir_senha(req, c) {
    const ator = await exigirPrime(req);
    const alvo = String(c.userId ?? '');
    const { data: cli } = await admin.from('clientes').select('origem, documento').eq('usuario_id', alvo).maybeSingle();
    const { data: u } = await admin.auth.admin.getUserById(alvo);
    if (!u?.user) throw new ErroConta(404, 'NAO_ENCONTRADO', 'Usuário não encontrado.');
    if (cli?.documento) {
      // regra da cliente (importados e novos): volta pra regra padrão (6 primeiros do documento; pelo CPF, o nascimento)
      const { error: eu } = await admin.auth.admin.updateUserById(alvo, { password: await derivar(cli.documento.slice(0, 6)) });
      if (eu) throw new ErroConta(500, 'ERRO_INTERNO', 'Não deu pra redefinir a senha agora. Tente de novo.');
      await rpc('conta_senha_propria', { p_user: alvo, p_propria: false });
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
