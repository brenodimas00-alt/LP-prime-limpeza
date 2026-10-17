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
// no WSL o chrome-launcher converte userDataDir pra caminho Windows; o Chrome Linux trata como relativo ao cwd.
// Rodando a partir da pasta temporária, qualquer sobra fica fora do repo.
const cwdOriginal = process.cwd();
process.chdir(tmpdir());
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
// Agendamento v3: cada tela do fluxo (cliente logada do seed, endereço salvo). O rascunho fica no localStorage e a página
// abre no passo gravado; o Lighthouse roda sem limpar o armazenamento.
{
  const V3 = await import('./lib-v3-pw.mjs');
  const p = await ctx.newPage();
  await p.goto(base); await p.evaluate((s) => { localStorage.clear(); localStorage.setItem('prime.sessao', JSON.stringify(s)); }, { ator: 'cliente', id: C.clientes[0].id, nome: C.clientes[0].nome });
  await p.goto(`${base}autoagendamento/`); await p.waitForSelector('[data-passo=servico]');
  await V3.marcar(p, 'segmento', 'residencial'); await V3.marcar(p, 'servico', 'residencial'); await V3.continuar(p);
  await p.waitForSelector('[data-passo=endereco] [data-acao=substituir]'); await V3.continuar(p); await p.waitForSelector('[data-passo=local]');
  await p.fill('#metragem', '45'); await p.getByRole('button', { name: 'Aumentar quartos' }).click();
  await V3.marcar(p, 'animais', 'nao'); await V3.marcar(p, 'localRefeicao', 'sim'); await V3.continuar(p); await p.waitForSelector('[data-passo=modalidade]');
  await V3.marcar(p, 'modalidade', 'pacote'); await V3.continuar(p); await p.waitForSelector('[data-passo=datas]');
  await V3.marcar(p, 'frequencia', 'semanal'); await V3.escolherData(p, V3.diaUtil(3));
  await V3.horario(p, 'horario', '08', '00'); await V3.marcar(p, 'manterHorario', 'sim');
  await V3.continuar(p); await p.waitForSelector('[data-passo=configuracao]'); await V3.continuar(p); await p.waitForSelector('[data-valor=total]');
  await p.close();
  for (const passo of ['endereco', 'local', 'modalidade', 'datas', 'configuracao', 'revisao']) {
    const q = await ctx.newPage(); await q.goto(base);
    await q.evaluate((ps) => { const k = 'prime.rascunho.agendamento.v3'; const r = JSON.parse(localStorage.getItem(k)); r.passo = ps; localStorage.setItem(k, JSON.stringify(r)); }, passo);
    await q.goto(`${base}autoagendamento/`); await q.waitForSelector(`[data-passo=${passo}]`, { timeout: 10000 }); // abre mesmo nesse passo
    await q.close();
    const r = await lighthouse(`${base}autoagendamento/`, { port: chrome.port, onlyCategories: ['accessibility'], output: 'json', logLevel: 'error', formFactor: 'mobile', disableStorageReset: true, screenEmulation: { mobile: true, width: 375, height: 812, deviceScaleFactor: 2 } });
    const nota = Math.round(r.lhr.categories.accessibility.score * 100);
    const falhas = Object.values(r.lhr.audits).filter((a) => a.score !== null && a.score < 1 && a.scoreDisplayMode !== 'informative').map((a) => a.id);
    res.push({ nome: `agendamento: ${passo}`, nota, falhas, minimo: 95 });
    console.log(`agendamento ${passo}: acessibilidade ${nota}${falhas.length ? ` (falhas: ${falhas.join(', ')})` : ''}`);
  }
}
await chrome.kill(); await fechar(); rmSync(perfil, { recursive: true, force: true });
for (const f of (await import('node:fs')).readdirSync(tmpdir())) if (f.startsWith('\\\\wsl') || f.startsWith('C:')) rmSync(`${tmpdir()}/${f}`, { recursive: true, force: true });
process.chdir(cwdOriginal);
process.exit(res.every((x) => x.nota >= (x.minimo || 90)) ? 0 : 1);
