// B5: worker de notificações. Chamado pelo pg_cron (pg_net) a cada minuto com o cabeçalho x-worker-segredo.
// Processa a fila de eventos e envia as notificações vencidas pelo provedor do ambiente: fora de produção, SEMPRE
// 'simulado' (travado em _shared/provedores.js, não em configuração). verify_jwt = false: o segredo é a autenticação.
import postgres from 'npm:postgres@3.4.5';
import { criarWorker } from '../_shared/worker.js';
import { ambienteDoProjeto, criarProvedor } from '../_shared/provedores.js';

const SEGREDO = Deno.env.get('WORKER_SEGREDO') ?? '';
const URL_SITE = Deno.env.get('URL_SITE') ?? '';
const AMBIENTE = ambienteDoProjeto(Deno.env.get('SUPABASE_URL')!);
const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { max: 2, prepare: false, idle_timeout: 20 });

const provedor = criarProvedor({
  ambiente: AMBIENTE,
  configurado: Deno.env.get('PROVEDOR_NOTIFICACOES'),
  fetch,
  meta: { phoneNumberId: Deno.env.get('META_PHONE_NUMBER_ID'), token: Deno.env.get('META_TOKEN') },
  email: { chave: Deno.env.get('EMAIL_CHAVE'), remetente: Deno.env.get('EMAIL_REMETENTE') },
});

const worker = criarWorker({
  transacao: (fn: (q: (t: string, p?: unknown[]) => Promise<any[]>) => Promise<unknown>) =>
    sql.begin((t) => fn((texto, params = []) => t.unsafe(texto, params as any[]))),
  urlSite: URL_SITE,
  provedor,
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
  // Relógio adiantado: só fora de produção e sempre com escopo (ids de pedido/diarista fictícios do teste).
  let agoraISO: string | undefined;
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
    const r = await worker.tique({ agoraISO, escopo });
    return json(200, { ambiente: AMBIENTE, motivo: String(corpo.motivo ?? '').slice(0, 40), ...r });
  } catch (e) {
    console.error('worker', (e as Error).message);
    // quem chama já tem o segredo; fora de produção o detalhe ajuda a depurar
    const detalhe = AMBIENTE === 'producao' ? undefined : String((e as Error).message).slice(0, 300);
    return json(500, { erro: { codigo: 'ERRO_INTERNO', mensagem: 'Falha no worker', detalhe } });
  }
});
