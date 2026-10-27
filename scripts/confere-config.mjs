// Pré-lançamento (27/10/2026): confere, serviço por serviço, se um ambiente está ligado, desligado ou mal configurado.
// Só lê: nomes do arquivo de ambiente (nunca valores), segredos das Edge Functions pelo SHA-256 que o CLI devolve
// (compara com o valor esperado sem ver o valor), Auth e flags pela API de gestão do Supabase (consulta só de leitura),
// o site publicado (ambiente.js e cabeçalhos públicos), o projeto do Pages e o DNS público. Não imprime segredo.
// Estados: LIGADO, DESLIGADO (de propósito, com o comportamento descrito), MAL CONFIGURADO (sai com código 1) e
// PRESENTE (o nome existe, mas não dá pra validar o valor daqui).
// Uso: cd ~/projetos/LP-prime-limpeza && node scripts/confere-config.mjs [--env ~/.prime-env] [--url https://site/] [--dominio primelimpezaespecializada.com.br]
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { lerPrimeEnv, TURNSTILE_TESTE } from './gera-ambiente.mjs';
import { HOMOLOG_REFS } from '../supabase/functions/_shared/provedores.js';

const arg = (n, padrao) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : padrao; };
const ARQ_ENV = arg('--env', `${homedir()}/.prime-env`);
const env = lerPrimeEnv(ARQ_ENV);
const REF = (env.SUPABASE_URL || '').match(/^https:\/\/([a-z0-9]{20})\.supabase\.co$/)?.[1] || null;
const PRODUCAO = env.PRIME_AMBIENTE === 'producao';
const DOMINIO = arg('--dominio', 'primelimpezaespecializada.com.br');
const URL_SITE = (arg('--url', PRODUCAO ? `https://${DOMINIO}/` : 'https://prime-limpeza.pages.dev/')).replace(/\/?$/, '/');
const sha = (v) => createHash('sha256').update(v).digest('hex');
const linhas = [];
const marcar = (servico, estado, detalhe) => linhas.push({ servico, estado, detalhe });

// ---------- fontes (cada uma falha sozinha, sem derrubar as outras) ----------
function segredos() {
  if (!REF) return null;
  try {
    const out = execFileSync('bash', ['scripts/cli.sh', 'supabase', 'secrets', 'list', '--project-ref', REF, '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60000 });
    return new Map(JSON.parse(out).map((s) => [s.name, s.value])); // value = SHA-256 do valor (o CLI não devolve o valor)
  } catch { return null; }
}
const TOKEN_SB = existsSync(`${homedir()}/.supabase/access-token`) ? readFileSync(`${homedir()}/.supabase/access-token`, 'utf8').trim() : '';
async function gestao(caminho, corpo) {
  if (!REF || !TOKEN_SB) return null;
  try {
    const r = await fetch(`https://api.supabase.com/v1/projects/${REF}${caminho}`, { method: corpo ? 'POST' : 'GET', headers: { Authorization: `Bearer ${TOKEN_SB}`, 'Content-Type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined, signal: AbortSignal.timeout(20000) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}
async function doh(nome, tipo) {
  try {
    const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${nome}&type=${tipo}`, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(10000) });
    return ((await r.json()).Answer || []).map((a) => a.data);
  } catch { return null; }
}
async function sitePublicado() {
  try {
    const r = await fetch(`${URL_SITE}src/config/ambiente.js`, { signal: AbortSignal.timeout(15000) });
    const csp = (await fetch(URL_SITE, { method: 'HEAD', signal: AbortSignal.timeout(15000) })).headers.get('content-security-policy') || '';
    if (!r.ok) return { ok: false, status: r.status };
    const t = await r.text();
    const sitekey = t.match(/"turnstileSiteKey":\s*"([^"]+)"/)?.[1] || null; // valores públicos (vão pro navegador)
    return { ok: true, sitekey, analytics: /"webAnalyticsToken"/.test(t), dados: t.match(/"dados":\s*"([^"]+)"/)?.[1], ref: t.match(/https:\/\/([a-z0-9]{20})\.supabase\.co/)?.[1], csp };
  } catch (e) { return { ok: false, status: e.message }; }
}

const S = segredos();
const temSegredo = (n) => S?.has(n) || false;
const segredoIgual = (n, valor) => (S?.has(n) ? S.get(n) === sha(valor) : false);
const [auth, flags, site, ns, aApex, cnameWww, mx] = await Promise.all([
  gestao('/config/auth'),
  gestao('/database/query', { query: 'select chave, ligada from public.config_flags order by 1', read_only: true }),
  sitePublicado(), doh(DOMINIO, 'NS'), doh(DOMINIO, 'A'), doh(`www.${DOMINIO}`, 'CNAME'), doh(DOMINIO, 'MX'),
]);
const flag = (k) => (Array.isArray(flags) ? flags.find((f) => f.chave === k)?.ligada : undefined);

// ---------- banco e ambiente ----------
if (!REF) marcar('Banco (Supabase)', 'MAL CONFIGURADO', `SUPABASE_URL ausente ou inválida em ${ARQ_ENV}`);
else {
  const homolog = HOMOLOG_REFS.includes(REF);
  if (PRODUCAO && homolog) marcar('Banco (Supabase)', 'MAL CONFIGURADO', 'PRIME_AMBIENTE=producao apontando pro projeto de homologação');
  else marcar('Banco (Supabase)', 'LIGADO', `${homolog ? 'homologação' : 'projeto'} ${REF}; ${S ? `${S.size} segredos nas functions` : 'segredos não lidos (CLI sem acesso)'}; ${auth ? 'Auth lido pela API' : 'Auth não lido (sem token da API de gestão)'}`);
  const prodRef = segredoIgual('PRODUCAO_REF', REF);
  if (homolog) marcar('Envio real de mensagens', 'DESLIGADO', 'homologação: WhatsApp e e-mail sempre simulados (trava no código, vale mesmo com segredo)');
  else if (prodRef) marcar('Envio real de mensagens', 'LIGADO', 'PRODUCAO_REF confere com o ref do projeto');
  else marcar('Envio real de mensagens', PRODUCAO ? 'MAL CONFIGURADO' : 'DESLIGADO', temSegredo('PRODUCAO_REF') ? 'PRODUCAO_REF diferente do ref do projeto: tudo simulado' : 'sem PRODUCAO_REF: tudo simulado');
}

// ---------- WhatsApp oficial ----------
{
  const ligado = segredoIgual('PROVEDOR_WHATSAPP', 'meta_cloud');
  const faltam = ['META_PHONE_NUMBER_ID', 'META_TOKEN', 'WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_APP_SECRET'].filter((n) => !temSegredo(n));
  if (!S) marcar('WhatsApp oficial', 'PRESENTE', 'segredos não lidos');
  else if (!ligado) marcar('WhatsApp oficial', 'DESLIGADO', 'PROVEDOR_WHATSAPP diferente de meta_cloud: mensagens simuladas (registradas, não enviadas); a equipe avisa pelo botão de WhatsApp manual');
  else if (faltam.length) marcar('WhatsApp oficial', 'MAL CONFIGURADO', `ligado sem ${faltam.join(', ')}`);
  else marcar('WhatsApp oficial', 'PRESENTE', 'ligado e com as 4 credenciais; validade do token e templates aprovados não verificáveis daqui');
}

// ---------- e-mail das notificações (API) ----------
{
  const ligado = segredoIgual('EMAIL_PROVEDOR', 'api');
  const faltam = ['EMAIL_CHAVE', 'EMAIL_REMETENTE'].filter((n) => !temSegredo(n));
  if (!S) marcar('E-mail das notificações', 'PRESENTE', 'segredos não lidos');
  else if (!ligado) marcar('E-mail das notificações', 'DESLIGADO', 'EMAIL_PROVEDOR diferente de api: e-mails simulados; os avisos seguem pelo WhatsApp e pelo painel');
  else if (faltam.length) marcar('E-mail das notificações', 'MAL CONFIGURADO', `ligado sem ${faltam.join(', ')}`);
  else marcar('E-mail das notificações', 'PRESENTE', 'ligado com chave e remetente; domínio verificado no provedor não verificável daqui');
}

// ---------- e-mail do Auth (SMTP: "esqueci a senha") ----------
if (!auth) marcar('E-mail do login (SMTP)', 'PRESENTE', 'Auth não lido (sem token da API de gestão)');
else if (!auth.smtp_host) marcar('E-mail do login (SMTP)', 'DESLIGADO', `sem SMTP próprio: o e-mail padrão do Supabase só entrega pra equipe do projeto (limite ${auth.rate_limit_email_sent}/h); a cliente pede a senha nova à Prime, que redefine no painel`);
else marcar('E-mail do login (SMTP)', auth.smtp_admin_email ? 'PRESENTE' : 'MAL CONFIGURADO', `SMTP ${auth.smtp_host}${auth.smtp_admin_email ? ', remetente definido' : ', sem remetente'}; entrega não verificável daqui`);

// ---------- Auth: endereços ----------
if (auth) {
  const lista = String(auth.uri_allow_list || '').split(',').filter(Boolean);
  const host = new URL(URL_SITE).host;
  const cobre = (u) => lista.some((p) => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '.*').replace(/(?<!\.)\*/g, '[^/]*')}$`).test(u));
  const ok = cobre(`${URL_SITE}entrar/`) || String(auth.site_url || '').startsWith(URL_SITE);
  marcar('Auth: endereço do site', ok ? 'LIGADO' : 'MAL CONFIGURADO', ok ? `${host} coberto (site_url ou lista de redirecionamento)` : `${host} fora do site_url e da lista: o link de "esqueci a senha" volta pro endereço errado`);
}

// ---------- Turnstile ----------
{
  const sitekey = site.ok ? site.sitekey : env.TURNSTILE_SITEKEY || null;
  const teste = !sitekey || sitekey === TURNSTILE_TESTE;
  const fl = flag('p7_turnstile');
  const seg = temSegredo('TURNSTILE_SECRET');
  if (fl === false) marcar('Turnstile', 'DESLIGADO', 'flag p7_turnstile desligada: só honeypot e limite por IP');
  else if (!seg) marcar('Turnstile', 'MAL CONFIGURADO', `flag ${fl === undefined ? 'não lida (conta como ligada)' : 'ligada'} sem TURNSTILE_SECRET: login, solicitação e cadastro de profissional param (a function fecha por segurança)`);
  else if (PRODUCAO && teste) marcar('Turnstile', 'MAL CONFIGURADO', 'produção com a chave de site de TESTE: com o segredo real, todo login é recusado');
  else marcar('Turnstile', teste ? 'LIGADO' : 'PRESENTE', teste ? 'chaves de teste da Cloudflare (homologação: sempre passa)' : 'chave de site real publicada e segredo presente; par não verificável daqui');
}

// ---------- Web Analytics ----------
if (site.ok) marcar('Web Analytics', site.analytics ? 'LIGADO' : 'DESLIGADO', site.analytics ? `token no site publicado${/cloudflareinsights/.test(site.csp) ? ' e liberado na CSP' : ' mas a CSP não libera o script (refazer o deploy)'}` : 'sem WEB_ANALYTICS_TOKEN no build: nenhum script de análise carrega');
else marcar('Web Analytics', env.WEB_ANALYTICS_TOKEN ? 'PRESENTE' : 'DESLIGADO', `site ${URL_SITE} não lido (${site.status}); ${env.WEB_ANALYTICS_TOKEN ? 'token' : 'sem token'} no arquivo de ambiente`);

// ---------- site publicado ----------
if (!site.ok) marcar('Site publicado', 'MAL CONFIGURADO', `${URL_SITE}src/config/ambiente.js respondeu ${site.status}`);
else marcar('Site publicado', site.ref && REF && site.ref !== REF ? 'MAL CONFIGURADO' : 'LIGADO', `${URL_SITE} com dados=${site.dados}, banco ${site.ref || '?'}${site.ref && REF && site.ref !== REF ? ` (o arquivo de ambiente aponta pra ${REF})` : ''}`);

// ---------- worker das automações ----------
if (S) {
  const faltam = ['WORKER_SEGREDO', 'URL_SITE'].filter((n) => !temSegredo(n));
  const urlCerta = segredoIgual('URL_SITE', URL_SITE);
  marcar('Automações (worker)', faltam.length ? 'MAL CONFIGURADO' : urlCerta ? 'LIGADO' : 'PRESENTE', faltam.length ? `sem ${faltam.join(', ')}` : urlCerta ? `URL_SITE = ${URL_SITE}` : `URL_SITE diferente de ${URL_SITE} (links das mensagens apontam pra outro endereço)`);
}

// ---------- Pix e Asaas ----------
{
  const prime = readFileSync(new URL('../src/config/prime.js', import.meta.url), 'utf8');
  const semPix = /chave:\s*'PREENCHER'/.test(prime);
  marcar('Pix (QR da Prime)', semPix ? (PRODUCAO ? 'MAL CONFIGURADO' : 'DESLIGADO') : 'LIGADO', semPix ? 'chave PREENCHER em src/config/prime.js: a página de pagamento não mostra QR e manda pedir os dados no WhatsApp' : 'chave preenchida em src/config/prime.js');
  marcar('Asaas (cartão e cobrança automática)', 'DESLIGADO', 'não implementado (B4 adiado): pagamento por Pix com confirmação manual; cartão aparece como "Em breve"');
}

// ---------- domínio ----------
{
  const nsCf = (ns || []).some((n) => /\.ns\.cloudflare\.com\.?$/.test(n));
  let nosso = false;
  // o site antigo responde 200 pra qualquer caminho: vale o conteúdo do ambiente.js, não o status
  try { const r = await fetch(`https://${DOMINIO}/src/config/ambiente.js`, { signal: AbortSignal.timeout(10000) }); nosso = r.ok && /export const AMBIENTE/.test(await r.text()); } catch { nosso = false; }
  const detalhe = `NS ${ns ? ns.join(', ') : 'não lido'}; A ${aApex ? aApex.join(', ') : '?'}; www ${cnameWww?.length ? cnameWww.join(', ') : 'sem CNAME'}; MX ${mx?.length ? mx.join(' | ') : 'nenhum'}`;
  if (nosso) marcar('Domínio', 'LIGADO', `${DOMINIO} serve o site novo. ${detalhe}`);
  else marcar('Domínio', 'DESLIGADO', `${DOMINIO} ainda no site antigo${nsCf ? ' (zona já na Cloudflare)' : ''}. ${detalhe}`);
}

// ---------- saída ----------
const larg = Math.max(...linhas.map((l) => l.servico.length));
console.log(`confere-config: ${ARQ_ENV} (${PRODUCAO ? 'produção' : 'homologação/preview'}), site ${URL_SITE}, ${new Date().toISOString()}\n`);
for (const l of linhas) console.log(`${l.servico.padEnd(larg)}  ${l.estado.padEnd(15)}  ${l.detalhe}`);
const mal = linhas.filter((l) => l.estado === 'MAL CONFIGURADO').length;
console.log(`\n# confere-config: ${mal ? `${mal} mal configurado(s)` : 'nada mal configurado'} (${linhas.length} itens)`);
process.exit(mal ? 1 : 0);
