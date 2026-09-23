// E6: Lighthouse (só acessibilidade) na home, autoagendamento, minha-conta e painel. node scripts/lighthouse-a11y.mjs
import lighthouse from 'lighthouse';
import { chromium } from 'playwright';
import { subirServidor } from './pw.mjs';
import { CREDENCIAIS_MOCK as C } from './fixtures/seed.js';

const { base, fechar } = await subirServidor();
const exe = chromium.executablePath();
const { launch } = await import('chrome-launcher');
const { mkdtempSync, rmSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const perfil = mkdtempSync(`${tmpdir()}/prime-lh-`); // sem isso o chrome-launcher no WSL cria "C:\Users\..." dentro do repo
const chrome = await launch({ chromePath: exe, userDataDir: perfil, chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu'] });
// sessões pras áreas logadas: abre uma vez com Playwright ligado ao mesmo Chrome? Mais simples: páginas logadas
// recebem a sessão por um script de setup (localStorage) usando o CDP do próprio Chrome do Lighthouse.
const alvos = [
  ['home', `${base}`], ['autoagendamento', `${base}autoagendamento/`],
  ['minha-conta', `${base}minha-conta/`, { ator: 'cliente', id: C.clientes[0].id, nome: C.clientes[0].nome }],
  ['painel', `${base}painel/`, { ator: 'prime', id: C.prime[0].id, nome: C.prime[0].nome }],
];
const b = await chromium.connectOverCDP(`http://localhost:${chrome.port}`);
const ctx = b.contexts()[0];
const res = [];
for (const [nome, url, sessao] of alvos) {
  if (sessao) { const p = await ctx.newPage(); await p.goto(base); await p.evaluate((s) => localStorage.setItem('prime.sessao', JSON.stringify(s)), sessao); await p.close(); }
  const r = await lighthouse(url, { port: chrome.port, onlyCategories: ['accessibility'], output: 'json', logLevel: 'error', formFactor: 'mobile', screenEmulation: { mobile: true, width: 375, height: 812, deviceScaleFactor: 2 } });
  const nota = Math.round(r.lhr.categories.accessibility.score * 100);
  const falhas = Object.values(r.lhr.audits).filter((a) => a.score !== null && a.score < 1 && a.scoreDisplayMode !== 'informative').map((a) => a.id);
  res.push({ nome, nota, falhas });
  console.log(`${nome}: acessibilidade ${nota}${falhas.length ? ` (falhas: ${falhas.join(', ')})` : ''}`);
}
await chrome.kill(); await fechar(); rmSync(perfil, { recursive: true, force: true });
process.exit(res.every((x) => x.nota >= 90) ? 0 : 1);
