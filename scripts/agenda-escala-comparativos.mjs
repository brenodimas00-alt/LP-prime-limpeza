// Comparativos lado a lado: imagem de referência da cliente x nossa tela (prints de agenda-escala-prints.mjs).
// Uso: node scripts/agenda-escala-comparativos.mjs <pasta-das-referencias> <pasta-dos-prints> <pasta-de-saida>
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { abrirNavegador } from './pw.mjs';

const [refs, nossos, saida] = process.argv.slice(2);
mkdirSync(saida, { recursive: true });
const img = (p) => `data:image/png;base64,${readFileSync(p).toString('base64')}`;
const PARES = [
  ['1-dia', '1-principal-dia.png', ['dia-1440.png'], 'Layout principal (Dia)'],
  ['2-detalhes', '2-dia-com-detalhes.png', ['detalhes-1440.png'], 'Dia com o painel de detalhes'],
  ['3-periodo', '3-periodo.png', ['periodo-1440.png'], 'Semana / Período'],
  ['4-filtros-alterar-mais', '4-filtros-alterar-mais-opcoes.png', ['filtros-1440.png', 'alterar-1440.png', 'mais-1440.png'], 'Filtros, Alterar profissional e Mais opções'],
  ['5-celular', null, ['dia-390-tela1.png', 'dia-390-tela2.png', 'detalhes-390.png', 'alterar-390.png', 'filtros-390.png', 'mais-390.png'], 'Celular (390 px): a referência não tem versão de celular'],
];
const b = await abrirNavegador();
const p = await (await b.newContext({ viewport: { width: 2960, height: 1000 }, deviceScaleFactor: 1 })).newPage();
for (const [nome, ref, nossas, titulo] of PARES) {
  const lista = nossas.map((f) => join(nossos, f)).filter(existsSync);
  const col = (rot, itens, larg) => `<div class="c"><h2>${rot}</h2>${itens.map((s) => `<img src="${s}" style="width:${larg}">`).join('')}</div>`;
  const celular = !ref;
  const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:24px;font:20px system-ui;background:#f3f3f8;color:#25225d}h1{margin:0 0 16px}
    .g{display:flex;gap:24px;align-items:flex-start;${celular ? 'flex-wrap:wrap' : ''}}.c{flex:1;min-width:0}.c h2{margin:0 0 8px;font-size:22px}img{display:block;margin-bottom:12px;border:1px solid #c9c7dd;max-width:100%}</style>
    <h1>${titulo}</h1><div class="g">${ref ? col('Referência enviada pela cliente', [img(join(refs, ref))], '100%') : ''}${celular
      ? lista.map((f) => col('Nossa tela', [img(f)], '390px')).join('') : col('Nossa tela (seed fictício, 1440 px)', lista.map(img), '100%')}</div>`;
  await p.setContent(html); await p.waitForTimeout(300);
  await p.screenshot({ path: join(saida, `${nome}.png`), fullPage: true });
  console.log(`${nome}.png`);
}
await b.close();
