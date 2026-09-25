// B6: documentos das diaristas. Único caminho entre o front e o bucket privado "documentos-diaristas".
// - enviar (multipart, diarista logada, dona do rascunho): tipo, tamanho (5 MB) e assinatura real dos bytes conferidos
//   AQUI (mesma regra de src/domain/validacao.js); grava em <user_id>/<diarista_id>/<tipo>-<uuid>.<ext> e registra.
// - abrir (JSON, só Prime): registra o acesso (abrir_documento) e devolve URL assinada de validade curta.
// - retencao (JSON, x-worker-segredo, chamada pelo pg_cron): apaga do bucket os arquivos vencidos pela regra.
// Erro sempre em { erro: { codigo, mensagem, detalhes? } }. verify_jwt = false: o token é conferido no código.
import { createClient } from 'npm:@supabase/supabase-js@2.117.1';
import { validarArquivo, LIMITE_ARQUIVO_BYTES } from '../../../src/domain/validacao.js';

const URL_SUPABASE = Deno.env.get('SUPABASE_URL')!;
const CHAVE_SECRETA = Deno.env.get('PRIME_SECRET_KEY')!;
const CHAVE_PUBLICA = Deno.env.get('PRIME_PUBLISHABLE_KEY')!;
const SEGREDO_WORKER = Deno.env.get('WORKER_SEGREDO') ?? '';
const BUCKET = 'documentos-diaristas';
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf' };
const ORIGENS = [/^https:\/\/([a-z0-9-]+\.)?prime-limpeza\.pages\.dev$/, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/];
const OPCOES = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIPOS = ['rg_frente', 'rg_verso', 'cnh_frente', 'cnh_verso', 'cpf', 'comprovante_residencia', 'foto_perfil', 'antecedentes'];
const CODIGOS_NEGOCIO = ['DADOS_INVALIDOS', 'NAO_ENCONTRADO', 'ATOR_SEM_PERMISSAO', 'CONFLITO_IDEMPOTENCIA', 'TRANSICAO_PROIBIDA'];

const admin = createClient(URL_SUPABASE, CHAVE_SECRETA, OPCOES);

class ErroDoc extends Error {
  constructor(public status: number, public codigo: string, mensagem: string, public detalhes?: unknown) { super(mensagem); }
}
const invalido = (msg: string) => new ErroDoc(400, 'DADOS_INVALIDOS', msg, { arquivo: msg });

function cors(origem: string | null): Record<string, string> {
  const ok = origem && ORIGENS.some((r) => r.test(origem));
  return {
    ...(ok ? { 'Access-Control-Allow-Origin': origem!, Vary: 'Origin' } : {}),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

async function usuario(req: Request) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) throw new ErroDoc(401, 'SESSAO_EXPIRADA', 'Entre de novo pra continuar.');
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new ErroDoc(401, 'SESSAO_EXPIRADA', 'Entre de novo pra continuar.');
  // cliente com o token da usuária: as RPCs veem o ator dela (privado.ator()), como se o front chamasse
  const comoEla = createClient(URL_SUPABASE, CHAVE_PUBLICA, { ...OPCOES, global: { headers: { Authorization: `Bearer ${token}` } } });
  return { user: data.user, comoEla };
}

async function rpc(sb: ReturnType<typeof createClient>, nome: string, params: Record<string, unknown>) {
  const { data, error } = await sb.rpc(nome, params);
  if (error) {
    if (CODIGOS_NEGOCIO.includes(error.message)) throw new ErroDoc(error.message === 'NAO_ENCONTRADO' ? 404 : 400, error.message, error.details || error.message);
    if (error.code === '42501') throw new ErroDoc(403, 'ATOR_SEM_PERMISSAO', 'Sem permissão.');
    console.error(nome, error.message);
    throw new ErroDoc(500, 'ERRO_INTERNO', 'Não foi possível concluir. Tente de novo em instantes.');
  }
  return data;
}

async function sha256(bytes: Uint8Array) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function enviar(req: Request) {
  // Tamanho ANTES de ler o corpo: sem Content-Length (corpo em pedaços) não lê; com ele, o runtime não lê além do declarado.
  // Revisão do Codex: sem isso, formData() materializava um corpo de qualquer tamanho antes de validar.
  const declarado = Number(req.headers.get('content-length'));
  if (!Number.isFinite(declarado) || declarado <= 0) throw new ErroDoc(411, 'DADOS_INVALIDOS', 'Envio sem tamanho declarado');
  if (declarado > LIMITE_ARQUIVO_BYTES + 64 * 1024) throw invalido('Arquivo maior que 5 MB'); // multipart soma ~1 KB de campos
  const { user, comoEla } = await usuario(req);
  // a cota conta ANTES de ler o arquivo: tentativa inválida também gasta
  if (!(await rpc(comoEla, 'reservar_upload_documento', {}))) throw new ErroDoc(429, 'DADOS_INVALIDOS', 'Muitos envios em pouco tempo. Tente de novo em uma hora.');
  const form = await req.formData().catch(() => { throw invalido('Envio inválido'); });
  const arquivo = form.get('arquivo');
  const diaristaId = String(form.get('diaristaId') || '');
  const tipo = String(form.get('tipo') || '');
  const nomeArquivo = String(form.get('nomeArquivo') || (arquivo instanceof File ? arquivo.name : '')).slice(0, 120);
  const chave = form.get('chave') ? String(form.get('chave')).slice(0, 200) : null;
  if (!(arquivo instanceof File)) throw invalido('Selecione um arquivo');
  if (!UUID.test(diaristaId)) throw new ErroDoc(400, 'DADOS_INVALIDOS', 'Id do cadastro inválido');
  if (!TIPOS.includes(tipo)) throw new ErroDoc(400, 'DADOS_INVALIDOS', 'Tipo de documento inválido');
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  // mesma regra do front, agora com os bytes que chegaram de verdade (não o que o navegador declarou)
  const erro = validarArquivo({ nome: nomeArquivo, mime: arquivo.type, tamanho: bytes.length, cabecalho: bytes.slice(0, 8) });
  if (erro) throw invalido(erro);
  await rpc(comoEla, 'iniciar_cadastro_diarista', { p_id: diaristaId }); // dona do rascunho (ou cria), senão NAO_ENCONTRADO
  const caminho = `${user.id}/${diaristaId}/${tipo}-${crypto.randomUUID()}.${EXT[arquivo.type]}`;
  const { error: eu } = await admin.storage.from(BUCKET).upload(caminho, bytes, { contentType: arquivo.type, upsert: false });
  if (eu) { console.error('upload', eu.message); throw new ErroDoc(500, 'ERRO_INTERNO', 'Não deu pra enviar o arquivo. Tente de novo.'); }
  let doc;
  try {
    doc = await rpc(comoEla, 'registrar_documento', {
      p_dados: { diaristaId, tipo, nomeArquivo, storagePath: caminho, hashSha256: await sha256(bytes) }, p_chave: chave,
    });
  } catch (e) {
    // Só apaga se o registro NÃO ficou no banco: a resposta pode ter se perdido depois do commit (revisão do Codex).
    const { data: registrado, error: el } = await admin.from('documentos').select('id').eq('storage_path', caminho).maybeSingle();
    if (!el && !registrado) await admin.storage.from(BUCKET).remove([caminho]);
    throw e;
  }
  // repetição com a mesma chave devolve o documento da primeira vez: o arquivo desta tentativa sobra e sai
  if (doc.blobRef !== caminho) await admin.storage.from(BUCKET).remove([caminho]);
  return doc;
}

async function abrir(req: Request, corpo: Record<string, unknown>) {
  const { comoEla } = await usuario(req);
  const id = String(corpo.documentoId || '');
  if (!UUID.test(id)) throw new ErroDoc(404, 'NAO_ENCONTRADO', 'Documento não encontrado');
  const doc = await rpc(comoEla, 'abrir_documento', { p_id: id }); // só Prime; registra o acesso
  const validade = Math.min(Math.max(Number(doc.validadeUrlSegundos) || 120, 10), 600);
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(doc.blobRef, validade);
  if (error) throw new ErroDoc(404, 'NAO_ENCONTRADO', 'Documento não encontrado');
  return { documento: doc, url: data.signedUrl, validadeSegundos: validade };
}

async function mesmoSegredo(a: string, b: string) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let d = 0;
  for (let i = 0; i < u.length; i++) d |= u[i] ^ v[i];
  return d === 0;
}

async function retencao(req: Request) {
  if (SEGREDO_WORKER.length < 32 || !(await mesmoSegredo(req.headers.get('x-worker-segredo') ?? '', SEGREDO_WORKER))) {
    throw new ErroDoc(401, 'NAO_AUTORIZADO', 'Não autorizado');
  }
  let apagados = 0;
  for (let rodada = 0; rodada < 10; rodada++) {
    const lote = await rpc(admin, 'documentos_para_apagar', { p_limite: 100 }) as { id: string; storage_path: string }[];
    if (!lote.length) break;
    const { error } = await admin.storage.from(BUCKET).remove(lote.map((x) => x.storage_path));
    if (error) { console.error('retencao', error.message); throw new ErroDoc(500, 'ERRO_INTERNO', 'Falha ao apagar arquivos'); }
    apagados += await rpc(admin, 'marcar_arquivos_apagados', { p_ids: lote.map((x) => x.id) }) as number;
  }
  return { apagados };
}

Deno.serve(async (req) => {
  const h = cors(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: h });
  const resposta = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), {
    status, headers: { ...h, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
  try {
    if (req.method !== 'POST') throw new ErroDoc(405, 'DADOS_INVALIDOS', 'Use POST');
    if ((req.headers.get('content-type') || '').startsWith('multipart/form-data')) return resposta(200, await enviar(req));
    const corpo = await req.json().catch(() => ({}));
    if (corpo.acao === 'abrir') return resposta(200, await abrir(req, corpo));
    if (corpo.acao === 'retencao') return resposta(200, await retencao(req));
    throw new ErroDoc(400, 'DADOS_INVALIDOS', 'Ação desconhecida');
  } catch (e) {
    if (e instanceof ErroDoc) return resposta(e.status, { erro: { codigo: e.codigo, mensagem: e.message, detalhes: e.detalhes } });
    console.error('documentos', (e as Error).message);
    return resposta(500, { erro: { codigo: 'ERRO_INTERNO', mensagem: 'Não foi possível concluir. Tente de novo em instantes.' } });
  }
});
