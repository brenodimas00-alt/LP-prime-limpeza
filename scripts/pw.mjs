// Helper do Playwright: aponta LD_LIBRARY_PATH pras libs extraídas sem sudo (ver README) e sobe o servidor local.
import { chromium } from 'playwright';
import { criarServidor } from './serve.mjs';

export async function abrirNavegador() {
  return chromium.launch();
}

export async function subirServidor(porta = 0) {
  const srv = criarServidor();
  await new Promise((r) => srv.listen(porta, r));
  const base = `http://localhost:${srv.address().port}/LP-prime-limpeza/`;
  return { srv, base, fechar: () => new Promise((r) => srv.close(r)) };
}
