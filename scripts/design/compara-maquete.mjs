// Comparação objetiva da maquete (ou da tela) com a referência: captura em 1536 x 1024, DPR 1, fontes carregadas e
// animação desligada; sobreposição 50%, imagem de diferença e desvio de cada bloco e elemento (docs/painel-referencia.json).
// Uso: node scripts/design/compara-maquete.mjs <referencia.png> <pasta-de-saida> [url-relativa=_dev/inicio-maquete/]
// Sai com erro se algum bloco desviar mais de 4 px numa borda (posição ou tamanho).
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { abrirNavegador, subirServidor } from '../pw.mjs';

const [ref, saida, caminho = '_dev/inicio-maquete/'] = process.argv.slice(2);
const MED = JSON.parse(readFileSync(new URL('../../docs/painel-referencia.json', import.meta.url)));
const LIMITE = 4;
mkdirSync(saida, { recursive: true });
const { base, fechar } = await subirServidor();
const b = await abrirNavegador();
const p = await (await b.newContext({ viewport: { width: 1536, height: 1024 }, deviceScaleFactor: 1, reducedMotion: 'reduce' })).newPage();
const erros = []; p.on('pageerror', (e) => erros.push(e.message)); p.on('console', (m) => m.type() === 'error' && erros.push(m.text()));
await p.goto(`${base}${caminho}`);
await p.waitForSelector('body[data-pronto="1"], .pn-inicio');
await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(300);
await p.screenshot({ path: join(saida, 'maquete.png') });
const caixa = async (sel) => p.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map((v) => Math.round(v)); }, sel);
const linhas = []; let falhas = 0;
const conferir = (nome, alvo, real, lim) => {
  if (!real) { linhas.push(`FALTA ${nome}`); falhas++; return; }
  const d = [real[0] - alvo[0], real[1] - alvo[1], (real[0] + real[2]) - (alvo[0] + alvo[2]), (real[1] + real[3]) - (alvo[1] + alvo[3])];
  const pior = Math.max(...d.map(Math.abs)); const ok = pior <= lim; if (!ok) falhas++;
  linhas.push(`${ok ? 'ok  ' : 'DESV'} ${nome.padEnd(34)} ref ${alvo.join(',').padEnd(20)} nossa ${real.join(',').padEnd(20)} esq ${d[0]} topo ${d[1]} dir ${d[2]} base ${d[3]}`);
};
for (const [nome, alvo] of Object.entries(MED.blocos)) conferir(`bloco ${nome}`, alvo, await caixa(`[data-bloco=${nome}]`), LIMITE);
for (const [sel, alvo] of Object.entries(MED.elementos)) conferir(sel, alvo, await caixa(sel), LIMITE * 2); // texto: largura depende da fonte, tolerância maior
// sobreposição e diferença no próprio navegador
const png = (f) => `data:image/png;base64,${readFileSync(f).toString('base64')}`;
const imgs = await p.evaluate(async ([a, c]) => {
  const carregar = async (s) => { const i = new Image(); i.src = s; await i.decode(); return i; };
  const [ia, ic] = [await carregar(a), await carregar(c)];
  const cv = (w, h) => { const x = document.createElement('canvas'); x.width = w; x.height = h; return x; };
  const o = cv(1536, 1024); const go = o.getContext('2d'); go.drawImage(ia, 0, 0); go.globalAlpha = 0.5; go.drawImage(ic, 0, 0);
  const d = cv(1536, 1024); const gd = d.getContext('2d'); gd.drawImage(ia, 0, 0); gd.globalCompositeOperation = 'difference'; gd.drawImage(ic, 0, 0);
  const dados = gd.getImageData(0, 0, 1536, 1024).data; let soma = 0; for (let i = 0; i < dados.length; i += 4) soma += (dados[i] + dados[i + 1] + dados[i + 2]) / 3;
  return { overlay: o.toDataURL('image/png'), diff: d.toDataURL('image/png'), media: soma / (dados.length / 4) / 255 };
}, [png(ref), png(join(saida, 'maquete.png'))]);
writeFileSync(join(saida, 'overlay.png'), Buffer.from(imgs.overlay.split(',')[1], 'base64'));
writeFileSync(join(saida, 'diferenca.png'), Buffer.from(imgs.diff.split(',')[1], 'base64'));
const rel = [...linhas, '', `diferença média de pixel: ${(imgs.media * 100).toFixed(1)}%`, `blocos e elementos fora do limite: ${falhas}`, erros.length ? `ERROS DE CONSOLE: ${erros.join(' | ')}` : 'console sem erro'].join('\n');
writeFileSync(join(saida, 'relatorio.txt'), rel); console.log(rel);
await b.close(); await fechar();
process.exit(falhas || erros.length ? 1 : 0);
