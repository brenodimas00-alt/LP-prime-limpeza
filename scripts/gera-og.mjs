// S1: imagem de compartilhamento (Open Graph / Twitter), 1200x630, montada SÓ com assets da marca que já estão no repo
// (logo branco e as fontes do design system). Uso: node scripts/gera-og.mjs  -> assets/og-prime.jpg
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { abrirNavegador } from './pw.mjs';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const b64 = (f) => readFileSync(`${RAIZ}${f}`).toString('base64');
const fonte = (arq, familia, peso) => `@font-face{font-family:'${familia}';font-weight:${peso};src:url(data:font/woff2;base64,${b64(`assets/fonts/${arq}`)}) format('woff2')}`;
// design system (19/10/2026): marinho do logo, título em Source Serif 4, linha dourada fina, sem foto de banco e sem degradê
const html = `<!doctype html><html><head><style>
  ${fonte('source-serif-4-latin-600.woff2', 'Source Serif 4', 600)}${fonte('source-sans-3-latin-400.woff2', 'Source Sans 3', 400)}
  *{margin:0;box-sizing:border-box}
  body{width:1200px;height:630px;background:#25225d;color:#fff;font-family:'Source Sans 3',sans-serif;overflow:hidden;padding:80px 88px;display:flex;flex-direction:column;justify-content:space-between}
  .logo{width:220px}
  h1{font-family:'Source Serif 4',serif;font-weight:600;font-size:68px;line-height:1.08;letter-spacing:-.5px;max-width:15ch}
  .rodape{border-top:2px solid #c9a24a;padding-top:22px;width:520px;font-size:28px;color:#e5e4ef}
</style></head><body>
  <img class="logo" src="data:image/png;base64,${b64('assets/marca/logo-branco@2x.png')}" alt="">
  <h1>Limpeza com acompanhamento da Prime</h1>
  <p class="rodape">Belo Horizonte e Região Metropolitana</p>
</body></html>`;
const b = await abrirNavegador();
const p = await (await b.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })).newPage();
await p.setContent(html, { waitUntil: 'load' });
writeFileSync(`${RAIZ}assets/og-prime.jpg`, await p.screenshot({ type: 'jpeg', quality: 85 }));
await b.close();
console.log('assets/og-prime.jpg (1200x630)');
