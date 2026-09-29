// S1: imagem de compartilhamento (Open Graph / Twitter), 1200x630, montada SÓ com assets da marca que já estão no repo
// (logo branco, foto de limpeza residencial, dourado da home). Uso: node scripts/gera-og.mjs  -> assets/og-prime.jpg
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { abrirNavegador } from './pw.mjs';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const b64 = (f) => readFileSync(`${RAIZ}${f}`).toString('base64');
const html = `<!doctype html><html><head><style>
  *{margin:0;box-sizing:border-box}
  body{width:1200px;height:630px;background:#2a2456;font-family:'DM Sans',system-ui,sans-serif;display:flex;overflow:hidden}
  .txt{width:640px;padding:72px 56px 64px 72px;display:flex;flex-direction:column;justify-content:space-between;color:#fff}
  .logo{width:230px}
  h1{font-size:54px;line-height:1.08;font-weight:800;letter-spacing:-.5px}
  h1 span{background:linear-gradient(135deg,#A57E37 0%,#F7F4C0 50%,#BA984D 100%);-webkit-background-clip:text;background-clip:text;color:transparent}
  p{font-size:25px;line-height:1.4;color:#e7e3f2}
  .barra{height:8px;width:120px;border-radius:4px;background:linear-gradient(135deg,#A57E37 0%,#F7F4C0 50%,#BA984D 100%)}
  .foto{flex:1;background:url(data:image/webp;base64,${b64('assets/limpeza-residencial.webp')}) center/cover}
</style></head><body>
  <div class="txt">
    <img class="logo" src="data:image/svg+xml;base64,${b64('assets/logo-branco.svg')}" alt="">
    <div><h1>Limpeza com <span>acompanhamento</span> da Prime</h1></div>
    <div><div class="barra"></div><p style="margin-top:18px">Belo Horizonte e Região Metropolitana</p></div>
  </div>
  <div class="foto"></div>
</body></html>`;
const b = await abrirNavegador();
const p = await (await b.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })).newPage();
await p.setContent(html, { waitUntil: 'load' });
writeFileSync(`${RAIZ}assets/og-prime.jpg`, await p.screenshot({ type: 'jpeg', quality: 85 }));
await b.close();
console.log('assets/og-prime.jpg (1200x630)');
