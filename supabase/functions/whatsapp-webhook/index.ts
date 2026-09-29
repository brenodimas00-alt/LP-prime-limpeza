// AUT.5: webhook do WhatsApp oficial. Pronto e SEM ativar: sem WHATSAPP_VERIFY_TOKEN e WHATSAPP_APP_SECRET nos secrets,
// responde 503. A Meta chama sem JWT (verify_jwt = false no deploy); a autenticação é a assinatura HMAC do corpo.
import postgres from 'npm:postgres@3.4.5';
import { criarWebhook } from '../_shared/webhook-whatsapp.js';

const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { max: 2, prepare: false, idle_timeout: 20 });

const tratar = criarWebhook({
  verifyToken: Deno.env.get('WHATSAPP_VERIFY_TOKEN') ?? '',
  appSecret: Deno.env.get('WHATSAPP_APP_SECRET') ?? '',
  status: async (id, st, em, erro) => (await sql`select public.webhook_status(${id}, ${st}, ${em}::timestamptz, ${erro ? JSON.stringify(erro) : null}::text::jsonb) r`)[0].r,
  mensagem: async (id, tel, texto, tipo, em) => (await sql`select public.webhook_mensagem(${id}, ${tel}, ${texto}, ${tipo}, ${em}::timestamptz) r`)[0].r,
});

Deno.serve(async (req) => {
  try { return await tratar(req); } catch (e) {
    console.error('webhook', (e as Error).message);
    return new Response('erro', { status: 500 }); // a Meta reenvia: o processamento é idempotente
  }
});
