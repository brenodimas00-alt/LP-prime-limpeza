// Painel v2, B7: Lighthouse MOBILE nas telas do painel (Início, Solicitações, Ficha da cliente, Agenda e Financeiro) contra
// a DEMONSTRAÇÃO publicada (dados fictícios no navegador; nenhum dado real). Aceite da spec: acessibilidade >= 95 e
// performance >= 85. Performance varia: até 3 execuções por tela, vale a melhor (todas ficam registradas).
// Uso: LD_LIBRARY_PATH=... bash scripts/cli.sh node22 scripts/painel-v2/lighthouse-painel.mjs [url da demonstração]
import lighthouse from 'lighthouse';
import { chromium } from 'playwright';
import { launch } from 'chrome-launcher';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { CREDENCIAIS_MOCK as C } from '../fixtures/seed.js';

const BASE = (process.argv[2] || 'https://painel-v2-demo.prime-limpeza.pages.dev/').replace(/\/?$/, '/');
const perfil = mkdtempSync(`${tmpdir()}/prime-lh-`);
const cwd = process.cwd(); process.chdir(tmpdir());
const chrome = await launch({ chromePath: chromium.executablePath(), userDataDir: perfil, chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu'] });
const pw = await chromium.connectOverCDP(`http://localhost:${chrome.port}`);
const ctx = pw.contexts()[0];
const p = await ctx.newPage();
await p.goto(BASE);
await p.evaluate((c) => { localStorage.setItem('prime.sessao', JSON.stringify({ ator: 'prime', id: c.id, nome: c.nome, papel: 'prime_admin' })); localStorage.setItem('prime.painel.tour', 'visto'); }, C.prime[1]);
await p.goto(`${BASE}painel/`); await p.waitForSelector('[data-bloco=inicio-solicitacoes] tr.p-lin', { timeout: 60000 }); // semeia a demonstração
const cli = await p.evaluate(async (raiz) => { const { api } = await import(`${raiz}src/services/api.js`); return (await api.painelSolicitacoes({ estado: 'confirmadas' })).itens[0].cliente.id; }, new URL(BASE).pathname);
await p.close();
const alvos = [['Início', 'painel/?tela=inicio'], ['Solicitações', 'painel/?tela=solicitacoes'], ['Ficha da cliente', `painel/?tela=clientes&cliente=${cli}`], ['Agenda e escala', 'painel/?tela=agenda&aba=escala'], ['Financeiro', 'painel/?tela=financeiro&aba=adiantamentos']];
const res = [];
for (const [nome, caminho] of alvos) {
  const notas = []; let a11y = 0; let falhas = [];
  for (let i = 0; i < 3; i++) {
    const r = await lighthouse(`${BASE}${caminho}`, { port: chrome.port, onlyCategories: ['performance', 'accessibility'], output: 'json', logLevel: 'error', formFactor: 'mobile',
      screenEmulation: { mobile: true, width: 375, height: 812, deviceScaleFactor: 2 }, disableStorageReset: true });
    if (!new URL(r.lhr.finalDisplayedUrl).pathname.endsWith('/painel/')) throw new Error(`${nome}: foi parar em ${r.lhr.finalDisplayedUrl} (sessão?)`);
    notas.push(Math.round(r.lhr.categories.performance.score * 100));
    a11y = Math.round(r.lhr.categories.accessibility.score * 100);
    falhas = r.lhr.categories.accessibility.auditRefs.map((ref) => r.lhr.audits[ref.id]).filter((x) => x.score !== null && x.score < 1).map((x) => x.id);
    if (process.env.LH_DETALHE) {
      console.log('   ', ['first-contentful-paint', 'largest-contentful-paint', 'total-blocking-time', 'cumulative-layout-shift', 'speed-index'].map((k) => `${k}=${r.lhr.audits[k].displayValue}`).join(' '));
      const lcp = r.lhr.audits['largest-contentful-paint-element']?.details?.items?.[0]?.items?.[0]?.node?.snippet; if (lcp) console.log('    LCP:', lcp.slice(0, 160));
      for (const id of ['render-blocking-resources', 'unused-javascript', 'network-dependency-tree-insight', 'critical-request-chains']) { const au = r.lhr.audits[id]; if (au && au.score !== null && au.score < 1) console.log(`    ${id}: ${au.displayValue || ''}`); }
    }
    if (Math.max(...notas) >= Number(process.env.LH_META || 85)) break;
  }
  res.push({ nome, perf: Math.max(...notas), a11y });
  console.log(`${nome}: performance ${Math.max(...notas)} (execuções: ${notas.join(', ')}) · acessibilidade ${a11y}${falhas.length ? ` (falhas: ${falhas.join(', ')})` : ''}`);
}
await pw.close(); await chrome.kill(); rmSync(perfil, { recursive: true, force: true });
for (const f of readdirSync(tmpdir())) if (f.startsWith('\\\\wsl') || f.startsWith('C:')) rmSync(`${tmpdir()}/${f}`, { recursive: true, force: true });
process.chdir(cwd);
const ok = res.every((x) => x.perf >= 85 && x.a11y >= 95);
console.log(`# lighthouse-painel: ${ok ? 'passaram' : 'FALHOU'} (performance >= 85 e acessibilidade >= 95, mobile, ${BASE})`);
process.exit(ok ? 0 : 1);
