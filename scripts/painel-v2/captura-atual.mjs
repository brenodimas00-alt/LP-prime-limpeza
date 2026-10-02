// Painel v2 (etapa A1): fotografa o painel ATUAL (backend real) contra o Supabase LOCAL com o seed fictício, em 1440 px
// (todas as abas e os fluxos principais) e 390 px (as 4 telas mais usadas). Nunca o homolog: lib-local recusa.
// A function "conta" não roda no local: o login do painel é respondido aqui com a sessão do usuário fictício.
// Uso: SUPABASE_LOCAL_STATUS=<json> LD_LIBRARY_PATH=... bash scripts/cli.sh node22 scripts/painel-v2/captura-atual.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { abrirNavegador, subirServidor } from '../pw.mjs';
import { URL_API, CHAVE_PUBLICA, sessaoDe, SENHA_PRIME_LOCAL, fecharSql } from './lib-local.mjs';

const PASTA = new URL('../../docs/painel-v2/atual/', import.meta.url);
mkdirSync(PASTA, { recursive: true });
const seed = JSON.parse(readFileSync(new URL('../../docs/painel-v2/seed-local.json', import.meta.url), 'utf8'));
const prime = { email: seed.prime.email, senha: SENHA_PRIME_LOCAL, id: null };
const { base, fechar } = await subirServidor();
const b = await abrirNavegador();
const manifesto = [];
const erros = [];

async function contexto(largura) {
  const ctx = await b.newContext({ viewport: { width: largura, height: largura < 600 ? 844 : 900 }, reducedMotion: 'reduce', deviceScaleFactor: 1, isMobile: largura < 600, hasTouch: largura < 600 });
  await ctx.route('**/src/config/ambiente.js', (route) => route.fulfill({ contentType: 'text/javascript', body: `export const AMBIENTE = ${JSON.stringify({ supabaseUrl: URL_API, supabaseChavePublica: CHAVE_PUBLICA, auth: 'supabase', dados: 'supabase', turnstileSiteKey: '1x00000000000000000000AA' })};\n` }));
  await ctx.route('**/functions/v1/conta', async (route) => {
    const { sessao, user } = await sessaoDe(prime);
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ sessao: { access_token: sessao.access_token, refresh_token: sessao.refresh_token, expires_at: sessao.expires_at }, papel: 'prime_admin', papeis: ['prime_admin'], usuario: { id: user.id, email: user.email } }) });
  });
  const p = await ctx.newPage();
  p.on('console', (m) => m.type() === 'error' && erros.push(`${largura}: ${m.text().slice(0, 160)}`));
  p.on('pageerror', (e) => erros.push(`${largura}: ${e.message.slice(0, 160)}`));
  return { ctx, p };
}
async function entrar(p) {
  await p.goto(`${base}painel/entrar/`);
  await p.fill('#email', prime.email); await p.fill('#senha', prime.senha);
  await p.getByRole('button', { name: 'Entrar', exact: true }).click();
  await p.waitForURL(/painel\/(\?|$)/, { timeout: 30000 });
}
const pronto = async (p) => { await p.waitForFunction(() => !document.querySelector('.carregando'), null, { timeout: 30000 }); await p.waitForTimeout(600); };
async function ir(p, aba, extra = '') { await p.goto(`${base}painel/?aba=${aba}${extra}`); await pronto(p); }
async function foto(p, largura, nome, { full = true } = {}) {
  const arquivo = `${largura}-${nome}.png`;
  await p.screenshot({ path: new URL(arquivo, PASTA).pathname, fullPage: full });
  const alt = await p.evaluate(() => document.documentElement.scrollHeight);
  manifesto.push({ arquivo, largura, nome, altura: alt });
  console.log(`${arquivo} (${alt}px)`);
}

// ---------- 1440: todas as abas e fluxos ----------
{
  const { ctx, p } = await contexto(1440);
  await p.goto(`${base}painel/entrar/`); await p.waitForSelector('#email'); await p.waitForTimeout(800);
  await foto(p, 1440, 'entrar', { full: false });
  await entrar(p);
  for (const aba of ['visao', 'solicitacoes', 'agenda', 'atribuir', 'pagamentos', 'clientes', 'ocorrencias', 'cadastros', 'notificacoes', 'relacionamento', 'avaliacoes', 'precos', 'privacidade', 'config', 'ajuda']) {
    await ir(p, aba);
    await foto(p, 1440, aba);
  }
  // fluxos: sugestões de profissional numa solicitação
  await ir(p, 'solicitacoes');
  const sug = p.locator('[data-sugestoes] summary').first();
  if (await sug.count()) { await sug.click(); await p.waitForTimeout(1500); await foto(p, 1440, 'solicitacoes-sugestoes'); }
  // remarcar pela agenda (diálogo da diária)
  await ir(p, 'agenda');
  const diaria = p.locator('[data-diaria]').first();
  if (await diaria.count()) { await diaria.click(); await p.waitForSelector('dialog[open]'); await p.waitForTimeout(1500); await foto(p, 1440, 'agenda-diaria', { full: false }); await p.keyboard.press('Escape'); }
  // atribuir: lista de sugestões aberta
  await ir(p, 'atribuir');
  const sugAt = p.locator('tr[data-atendimento] details summary').first();
  if (await sugAt.count()) { await sugAt.click(); await p.waitForTimeout(1500); await foto(p, 1440, 'atribuir-sugestoes'); }
  // pagamentos: estorno e prazo abertos
  await ir(p, 'pagamentos');
  for (const s of ['Registrar estorno', 'Dar mais prazo']) { const d = p.locator('details summary', { hasText: s }).first(); if (await d.count()) await d.click(); }
  await p.waitForTimeout(400); await foto(p, 1440, 'pagamentos-aberto');
  // automações: linha do tempo de uma cliente e detalhe de um template
  const cli = Object.values(seed.clientes)[0];
  await ir(p, 'notificacoes', `&sub=linha&clienteId=${cli}`); await foto(p, 1440, 'notificacoes-linha');
  const tpl = p.locator('a[href*="sub=template"], a[href*="template="]').first();
  await ir(p, 'notificacoes');
  if (await tpl.count()) { await tpl.click(); await pronto(p); await foto(p, 1440, 'notificacoes-template'); }
  // busca de cliente (Visão geral) e lista de clientes filtrada
  await ir(p, 'visao', '&busca=Beatriz'); await foto(p, 1440, 'visao-busca');
  await ir(p, 'clientes', '&busca=Renata'); await foto(p, 1440, 'clientes-busca');
  await ctx.close();
}

// ---------- 390: as 4 telas mais usadas ----------
{
  const { ctx, p } = await contexto(390);
  await entrar(p);
  for (const aba of ['solicitacoes', 'agenda', 'atribuir', 'pagamentos']) { await ir(p, aba); await foto(p, 390, aba); }
  await ctx.close();
}

writeFileSync(new URL('manifesto.json', PASTA), JSON.stringify({ hoje: seed.hoje, telas: manifesto, erros }, null, 2));
if (erros.length) console.log(`\nerros de console (${erros.length}):\n${[...new Set(erros)].slice(0, 20).join('\n')}`);
await b.close(); await fechar(); await fecharSql();
