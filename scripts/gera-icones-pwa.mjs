// P4: ícones do PWA da agenda da profissional (192 e 512, e o "maskable" com margem), a partir do logo existente
// (assets/logo.svg) sobre fundo branco. Sem imagem nova inventada. Uso: node scripts/gera-icones-pwa.mjs
import { readFileSync } from 'node:fs';
import { abrirNavegador } from './pw.mjs';

const svg = readFileSync(new URL('../assets/logo.svg', import.meta.url), 'utf8');
const b = await abrirNavegador();
for (const [nome, lado, margem] of [['app-192.png', 192, 0.12], ['app-512.png', 512, 0.12], ['app-maskable-512.png', 512, 0.24]]) {
  const p = await b.newPage({ viewport: { width: lado, height: lado } });
  await p.setContent(`<html><body style="margin:0;width:${lado}px;height:${lado}px;background:#fff;display:flex;align-items:center;justify-content:center">
    <div style="width:${Math.round(lado * (1 - 2 * margem))}px">${svg.replace('<svg', '<svg style="width:100%;height:auto;display:block"')}</div></body></html>`);
  await p.screenshot({ path: new URL(`../assets/icons/${nome}`, import.meta.url).pathname, omitBackground: false });
  await p.close();
  console.log('gerado assets/icons/' + nome);
}
await b.close();
