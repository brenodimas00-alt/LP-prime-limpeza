// Painel v2, B7: fotos do painel novo pra docs/painel-v2/novo/ e painel-novo.pdf, tiradas da DEMONSTRAÇÃO (mock com o seed
// rico fictício). Precisa do servidor local (node scripts/serve.mjs). Uso: LD_LIBRARY_PATH=... node scripts/painel-v2/captura-novo.mjs
import { mkdirSync } from 'node:fs';
import { abrirNavegador } from '../pw.mjs';
import { CREDENCIAIS_MOCK as C } from '../fixtures/seed.js';

const BASE = 'http://localhost:8080/LP-prime-limpeza/';
const PASTA = new URL('../../docs/painel-v2/novo/', import.meta.url).pathname;
mkdirSync(PASTA, { recursive: true });
const b = await abrirNavegador();
async function pagina(w) {
  const p = await (await b.newContext({ viewport: { width: w, height: w > 760 ? 900 : 844 }, reducedMotion: 'reduce', locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' })).newPage();
  await p.goto(BASE);
  await p.evaluate((c) => { localStorage.setItem('prime.sessao', JSON.stringify({ ator: 'prime', id: c.id, nome: c.nome, papel: 'prime_admin' })); localStorage.setItem('prime.seedDemo', 'painel'); localStorage.setItem('prime.painel.tour', 'visto'); }, C.prime[1]);
  return p;
}
async function foto(p, w, nome, q, sel, { inteira = true, antes } = {}) {
  await p.goto(`${BASE}painel/${q}`); await p.waitForSelector(sel, { timeout: 30000 }); await p.waitForTimeout(1200);
  if (antes) await antes(p);
  await p.screenshot({ path: `${PASTA}${w}-${nome}.png`, fullPage: inteira });
  console.log(`${w}-${nome}`);
}
const d = await pagina(1440);
await foto(d, 1440, 'inicio', '?tela=inicio', '[data-bloco=inicio-solicitacoes] tr.p-lin');
await foto(d, 1440, 'inicio-expandido', '?tela=inicio', '[data-bloco=inicio-solicitacoes] tr.p-lin', { inteira: false, antes: async (p) => {
  await p.getByRole('button', { name: /^Ver detalhes de/ }).first().click(); await p.waitForTimeout(600);
  await p.locator('.p-sistema-btn').click(); await p.waitForTimeout(300);
} });
await foto(d, 1440, 'solicitacoes', '?tela=solicitacoes&estado=todas', '[data-solicitacao]');
await foto(d, 1440, 'escala', '?tela=agenda&aba=escala', '[data-bloco=agenda-escala] tr.p-lin');
const cli = await d.evaluate(async () => { const { api } = await import('/LP-prime-limpeza/src/services/api.js'); return (await api.painelSolicitacoes({ estado: 'confirmadas' })).itens[0].cliente.id; });
await foto(d, 1440, 'ficha', `?tela=clientes&cliente=${cli}`, '#tl-titulo');
await foto(d, 1440, 'profissionais', '?tela=profissionais', '[data-profissional]');
await foto(d, 1440, 'financeiro', '?tela=financeiro&aba=adiantamentos', '[data-solicitacao]');
await foto(d, 1440, 'motivos', '?tela=gestao&sec=configuracoes&aba=motivos', '[data-bloco=gestao-motivos] li');
await foto(d, 1440, 'ajuda', '?tela=gestao&sec=ajuda', '.ajuda-tarefa', { inteira: false });
const m = await pagina(390);
await foto(m, 390, 'inicio-tela', '?tela=inicio', '[data-bloco=inicio-solicitacoes] tr.p-lin', { inteira: false });
await foto(m, 390, 'inicio', '?tela=inicio', '[data-bloco=inicio-solicitacoes] tr.p-lin');
await foto(m, 390, 'solicitacoes', '?tela=solicitacoes&estado=novas', '[data-solicitacao]', { inteira: false });
await foto(m, 390, 'mais', '?tela=inicio', '[data-bloco=inicio-solicitacoes] tr.p-lin', { inteira: false, antes: async (p) => { await p.getByRole('button', { name: 'Mais', exact: true }).click(); await p.waitForTimeout(300); } });
await b.close();
