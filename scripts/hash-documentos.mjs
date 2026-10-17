// Hash (SHA-256) do texto de cada documento legal publicado, guardado no banco junto da versão (itens 52 e 53): o aceite de
// cada solicitação aponta pra versão E pro hash do texto aceito. Texto = conteúdo do <article id="texto-legal">, sem tags e
// com espaços colapsados (comentários fora). Uso: node scripts/hash-documentos.mjs  (imprime versão e hash de cada página)
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export function textoDoDocumento(html) {
  const m = html.match(/<article id="texto-legal"[^>]*>([\s\S]*?)<\/article>/);
  if (!m) throw new Error('sem <article id="texto-legal">');
  return m[1].replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}
export function hashDocumento(caminho) {
  const html = readFileSync(caminho, 'utf8');
  const versao = (html.match(/data-versao>([0-9-]+)</) || [])[1];
  return { versao, sha256: createHash('sha256').update(textoDoDocumento(html), 'utf8').digest('hex') };
}
export const DOCUMENTOS = { condicoes: 'condicoes/index.html', termos: 'termos/index.html', privacidade: 'privacidade/index.html' };

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const [k, c] of Object.entries(DOCUMENTOS)) console.log(k, JSON.stringify(hashDocumento(c)));
}
