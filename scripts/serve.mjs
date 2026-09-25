// Servidor estático local que imita o GitHub Pages: publica a raiz do repo em /LP-prime-limpeza/.
// Uso: node scripts/serve.mjs [porta]   (padrão 8080). Também serve na raiz "/" se RAIZ=1.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ_REPO = fileURLToPath(new URL('..', import.meta.url));
const BASE = process.env.RAIZ === '1' ? '/' : '/LP-prime-limpeza/';
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.json': 'application/json', '.ico': 'image/x-icon',
};

export function criarServidor() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    let caminho = decodeURIComponent(url.pathname);
    if (BASE !== '/' && (caminho === '/' || caminho === BASE.slice(0, -1))) {
      res.writeHead(302, { Location: BASE }); return res.end();
    }
    if (!caminho.startsWith(BASE)) return enviar404(res);
    caminho = caminho.slice(BASE.length);
    const seguro = normalize(caminho).replace(/^(\.\.[/\\])+/, '');
    if (seguro.startsWith('node_modules') || seguro.startsWith('.git')) return enviar404(res);
    let arquivo = join(RAIZ_REPO, seguro);
    // PRIME_TESTE=1 troca a config real pela fictícia (usado pelos testes E2E).
    if (process.env.PRIME_TESTE === '1' && seguro === join('src', 'config', 'prime.js')) arquivo = join(RAIZ_REPO, 'src', 'config', 'prime.teste.js');
    // ambiente.js só existe no dist/ do deploy; local serve o padrão (tudo mock) em vez de 404 no console.
    // AMBIENTE_HOMOLOG=1 serve o da homologação (valores públicos de ~/.prime-env) pra testar o front contra o Supabase.
    if (seguro === join('src', 'config', 'ambiente.js')) {
      const { conteudoAmbiente, lerPrimeEnv } = await import('./gera-ambiente.mjs');
      const corpo = process.env.AMBIENTE_HOMOLOG === '1' ? conteudoAmbiente(lerPrimeEnv(), { auth: process.env.AUTH || 'supabase', dados: process.env.DADOS || 'mock' }) : 'export const AMBIENTE = {};\n';
      res.writeHead(200, { 'Content-Type': TIPOS['.js'], 'Cache-Control': 'no-store' });
      return res.end(corpo);
    }
    try {
      const s = await stat(arquivo);
      if (s.isDirectory()) {
        if (!caminho.endsWith('/') && caminho !== '') { res.writeHead(301, { Location: url.pathname + '/' + url.search }); return res.end(); }
        arquivo = join(arquivo, 'index.html');
      }
      const corpo = await readFile(arquivo);
      res.writeHead(200, { 'Content-Type': TIPOS[extname(arquivo)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(corpo);
    } catch { enviar404(res); }
  });

  async function enviar404(res) {
    try {
      const corpo = await readFile(join(RAIZ_REPO, '404.html'));
      res.writeHead(404, { 'Content-Type': TIPOS['.html'] }); res.end(corpo);
    } catch { res.writeHead(404); res.end('404'); }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const porta = Number(process.argv[2] || process.env.PORT || 8080);
  criarServidor().listen(porta, () => console.log(`Servindo em http://localhost:${porta}${BASE}`));
}
