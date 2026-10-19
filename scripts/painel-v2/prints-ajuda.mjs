// Painel v2, B5: prints da central de ajuda das telas novas (assets/ajuda/*.png), tirados da DEMONSTRAÇÃO (mock com o seed
// rico de scripts/fixtures/seed-painel.js: tudo fictício). Precisa do servidor local (node scripts/serve.mjs).
// Uso: LD_LIBRARY_PATH=... node scripts/painel-v2/prints-ajuda.mjs
import { abrirNavegador } from '../pw.mjs';
import { CREDENCIAIS_MOCK as C } from '../fixtures/seed.js';

const BASE = 'http://localhost:8080/LP-prime-limpeza/';
const PASTA = new URL('../../assets/ajuda/', import.meta.url).pathname;
const b = await abrirNavegador();
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', deviceScaleFactor: 1, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
const p = await ctx.newPage();
await p.goto(BASE);
await p.evaluate((c) => { localStorage.setItem('prime.sessao', JSON.stringify({ ator: 'prime', id: c.id, nome: c.nome, papel: 'prime_admin' })); localStorage.setItem('prime.seedDemo', 'painel'); localStorage.setItem('prime.painel.tour', 'visto'); }, C.prime[1]);
const abrir = async (q, sel) => { await p.goto(`${BASE}painel/${q}`); await p.waitForSelector(sel, { timeout: 30000 }); await p.waitForTimeout(800); };
const foto = async (nome, sel) => { await p.locator(sel).first().screenshot({ path: `${PASTA}${nome}.png` }); console.log('print', nome); };

await abrir('?tela=inicio', '[data-bloco=inicio-solicitacoes] tr.p-lin');
await foto('aprovar', '[data-bloco=inicio-solicitacoes]');
await foto('designar', '[data-bloco=inicio-pendencias]');
await foto('standby', '[data-bloco=inicio-standby]');
await p.locator('[data-bloco=inicio-solicitacoes] tr.p-lin').first().getByRole('button', { name: /^Negociar data/ }).click();
await foto('recusar-negociar', '.p-modal');
await p.keyboard.press('Escape');
await p.locator('[data-bloco=inicio-pendencias]').getByRole('button', { name: 'Financeiro' }).click();
await foto('confirmar-pagamento', '[data-bloco=inicio-pendencias]');
await foto('adiantamento', '[data-bloco=inicio-pendencias]');
await abrir('?tela=agenda&aba=escala', '[data-bloco=agenda-escala] tr.p-lin');
await foto('escala', '[data-bloco=agenda-escala]');
await abrir('?tela=gestao&sec=configuracoes&aba=motivos', '[data-bloco=gestao-motivos] li');
await foto('motivos-meta', 'main');
const c = await p.evaluate(async () => { const { api } = await import('/LP-prime-limpeza/src/services/api.js'); return (await api.painelSolicitacoes({ estado: 'confirmadas' })).itens[0].cliente.id; });
await abrir(`?tela=clientes&cliente=${c}`, '#tl-titulo');
await foto('buscar-cliente', 'main');
await b.close();
