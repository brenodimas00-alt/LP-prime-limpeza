// AUT: worker do motor de automações v2. Chamado pelo pg_cron (pg_net) a cada minuto com o cabeçalho x-worker-segredo.
// Um tique: eventos (um por transação, em ordem), varredura da agenda, envio (duas fases, FOR UPDATE SKIP LOCKED) e
// reconciliação. WhatsApp e e-mail fora de produção são SEMPRE simulados (travado em _shared/provedores.js).
// verify_jwt = false: o segredo é a autenticação.
import postgres from 'npm:postgres@3.4.5';
import { criarPortaPg } from '../_shared/porta-pg.js';
import { ambienteDoProjeto, criarProvedores } from '../_shared/provedores.js';
import { tique } from '../../../src/automacoes/v2/motor.js';

const SEGREDO = Deno.env.get('WORKER_SEGREDO') ?? '';
const URL_SITE = Deno.env.get('URL_SITE') ?? '';
const AMBIENTE = ambienteDoProjeto(Deno.env.get('SUPABASE_URL')!);
const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { max: 2, prepare: false, idle_timeout: 20 });

const provedores = criarProvedores({
  ambiente: AMBIENTE,
  fetch,
  whatsappLigado: Deno.env.get('PROVEDOR_WHATSAPP') === 'meta_cloud',
  meta: { phoneNumberId: Deno.env.get('META_PHONE_NUMBER_ID'), token: Deno.env.get('META_TOKEN') },
  email: { tipo: 'api', chave: Deno.env.get('EMAIL_CHAVE'), remetente: Deno.env.get('EMAIL_REMETENTE'), urlSite: URL_SITE },
});

const porta = criarPortaPg({
  transacao: (fn: (q: (t: string, p?: unknown[]) => Promise<any[]>) => Promise<unknown>) =>
    sql.begin((t) => fn((texto, params = []) => t.unsafe(texto, params as any[]))),
  urlSite: URL_SITE,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });

async function mesmoSegredo(a: string, b: string) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let d = 0;
  for (let i = 0; i < u.length; i++) d |= u[i] ^ v[i];
  return d === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { erro: { codigo: 'METODO', mensagem: 'Use POST' } });
  if (SEGREDO.length < 32 || !(await mesmoSegredo(req.headers.get('x-worker-segredo') ?? '', SEGREDO))) {
    return json(401, { erro: { codigo: 'NAO_AUTORIZADO', mensagem: 'Não autorizado' } });
  }
  if (!URL_SITE) return json(500, { erro: { codigo: 'CONFIG_INCOMPLETA', mensagem: 'URL_SITE não configurada' } });
  const corpo = await req.json().catch(() => ({}));
  // Relógio adiantado: só fora de produção e sempre com escopo (ids de pedido/diarista/cliente fictícios do teste).
  // Eventos e agenda andam SEMPRE no relógio real (a fila e a varredura são globais); só o envio usa o relógio do teste.
  let agoraISO = new Date().toISOString();
  let escopo: string[] | null = null;
  if (corpo.agora !== undefined) {
    const escopoOk = Array.isArray(corpo.escopo) && corpo.escopo.length > 0 && corpo.escopo.length <= 20 && corpo.escopo.every((x: unknown) => UUID.test(String(x)));
    if (AMBIENTE === 'producao' || !escopoOk || Number.isNaN(Date.parse(corpo.agora))) {
      return json(400, { erro: { codigo: 'DADOS_INVALIDOS', mensagem: 'agora só em homologação e com escopo' } });
    }
    agoraISO = new Date(Date.parse(corpo.agora)).toISOString();
    escopo = corpo.escopo;
  }
  try {
    const prazo = Date.now() + 45000;
    const real = await tique({ porta, provedores, agoraISO: new Date().toISOString(), ambiente: provedores.ambiente, prazo });
    // teste: varredura e envio no relógio adiantado, envio restrito ao escopo, sem reconciliação (ela é global)
    const teste = escopo ? await tique({ porta, provedores, agoraISO, ambiente: provedores.ambiente, escopo, prazo, reconciliar: false }) : null;
    return json(200, { ambiente: AMBIENTE, motivo: String(corpo.motivo ?? '').slice(0, 40), ...real, ...(teste ? { teste } : {}) });
  } catch (e) {
    console.error('worker', (e as Error).message);
    const detalhe = AMBIENTE === 'producao' ? undefined : String((e as Error).message).slice(0, 300);
    return json(500, { erro: { codigo: 'ERRO_INTERNO', mensagem: 'Falha no worker', detalhe } });
  }
});
