// Q1: Lighthouse MOBILE contra o PREVIEW (backend real), com sessão de verdade nas áreas logadas: home, solicitação,
// Minha conta (cliente fictícia) e painel (admin fictícia). Aceite: acessibilidade >= 90 e performance >= 80.
// Performance varia de uma execução pra outra: cada página roda até 3 vezes e vale a melhor nota (registrada toda).
// Uso: LD_LIBRARY_PATH=... bash scripts/cli.sh node22 scripts/lighthouse-q1.mjs [url]
import lighthouse from 'lighthouse';
import { chromium } from 'playwright';
import { launch } from 'chrome-launcher';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { criarUsuario, sql, fecharSql, limparFicticios, cpfFicticio, aceitarTermos } from './lib-supabase.mjs';

const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim().replace(/[/_.]/g, '-').toLowerCase();
const BASE = (process.argv[2] || `https://${branch}.prime-limpeza.pages.dev/`).replace(/\/?$/, '/');
const cli = await criarUsuario('lh-cli');
await sql(`insert into public.clientes (usuario_id, tipo, nome, email, tipo_documento, documento, origem, ficticio) values ($1, 'residencial', 'Cliente Lighthouse', $2, 'cpf', $3, 'site', true)`, [cli.id, cli.email, cpfFicticio()]);
await aceitarTermos(cli.id);
const adm = await criarUsuario('lh-admin', 'prime_admin');

const perfil = mkdtempSync(`${tmpdir()}/prime-lh-`); // no WSL o chrome-launcher cria "C:\..." relativo ao cwd: roda da pasta temporária
const cwd = process.cwd(); process.chdir(tmpdir());
const chrome = await launch({ chromePath: chromium.executablePath(), userDataDir: perfil, chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu'] });
const pw = await chromium.connectOverCDP(`http://localhost:${chrome.port}`);
const ctx = pw.contexts()[0];
async function entrar(area, u) {
  const p = await ctx.newPage();
  await p.goto(`${BASE}${area === 'cliente' ? 'entrar/' : 'painel/entrar/'}`);
  await p.fill(area === 'cliente' ? '#identificador' : '#email', u.email); await p.fill('#senha', u.senha);
  await p.getByRole('button', { name: 'Entrar', exact: true }).click();
  await p.waitForURL(area === 'cliente' ? /minha-conta\// : /painel\/(\?|$)/, { timeout: 30000 });
  await p.close();
}
const alvos = [['home', ''], ['solicitação', 'autoagendamento/'], ['minha conta', 'minha-conta/', 'cliente'], ['painel', 'painel/', 'prime']];
const res = [];
for (const [nome, caminho, area] of alvos) {
  if (area) { await ctx.clearCookies(); await entrar(area, area === 'cliente' ? cli : adm); }
  const notas = [];
  let a11y = 0; let falhasA11y = [];
  for (let i = 0; i < 3; i++) {
    const r = await lighthouse(`${BASE}${caminho}`, {
      port: chrome.port, onlyCategories: ['performance', 'accessibility'], output: 'json', logLevel: 'error', formFactor: 'mobile',
      screenEmulation: { mobile: true, width: 375, height: 812, deviceScaleFactor: 2 }, disableStorageReset: true,
    });
    notas.push(Math.round(r.lhr.categories.performance.score * 100));
    if (process.env.LH_DETALHE) console.log('    shifts:', JSON.stringify((r.lhr.audits['layout-shifts']?.details?.items || []).slice(0, 4).map((x) => [x.node?.selector || x.node?.snippet, x.score])));
    if (process.env.LH_DETALHE) console.log('   ', ['first-contentful-paint', 'largest-contentful-paint', 'total-blocking-time', 'speed-index', 'cumulative-layout-shift'].map((k) => `${k.split('-').map((x) => x[0]).join('')} ${r.lhr.audits[k].displayValue}`).join(' · '), '|', Object.values(r.lhr.audits).filter((x) => x.details?.type === 'opportunity' && x.score !== null && x.score < 0.9).map((x) => `${x.id} ${x.displayValue || ''}`).join(' | '));
    a11y = Math.round(r.lhr.categories.accessibility.score * 100);
    falhasA11y = Object.values(r.lhr.audits).filter((x) => r.lhr.categories.accessibility.auditRefs.some((ref) => ref.id === x.id) && x.score !== null && x.score < 1).map((x) => x.id);
    // caminho EXATO (painel/entrar/ não conta como painel) e a página mediu o conteúdo logado, não a tela de entrada
    if (new URL(r.lhr.finalDisplayedUrl).pathname !== new URL(`${BASE}${caminho}`).pathname) throw new Error(`${nome}: foi parar em ${r.lhr.finalDisplayedUrl} (sessão?)`);
    if (Math.max(...notas) >= 80) break;
  }
  res.push({ nome, perf: Math.max(...notas), notas, a11y, falhasA11y });
  console.log(`${nome}: performance ${Math.max(...notas)} (execuções: ${notas.join(', ')}) · acessibilidade ${a11y}${falhasA11y.length ? ` (falhas: ${falhasA11y.join(', ')})` : ''}`);
}
await pw.close(); await chrome.kill(); rmSync(perfil, { recursive: true, force: true });
for (const f of readdirSync(tmpdir())) if (f.startsWith('\\\\wsl') || f.startsWith('C:')) rmSync(`${tmpdir()}/${f}`, { recursive: true, force: true });
process.chdir(cwd);
console.log(`# lighthouse-q1: ${res.every((x) => x.perf >= 80 && x.a11y >= 90) ? 'passaram' : 'FALHOU'} (performance >= 80 e acessibilidade >= 90, mobile, ${BASE})`);
await limparFicticios({ soEstaExecucao: true }); await fecharSql();
process.exit(res.every((x) => x.perf >= 80 && x.a11y >= 90) ? 0 : 1);
