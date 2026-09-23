// Adapter MOCK: executa os casos de uso no navegador, persiste em IndexedDB e roda o motor de automações.
// Dados ficam SÓ neste navegador: nada chega à Prime e outro aparelho não vê.
import { criarCasosDeUso } from '../../app/casos-de-uso.js';
import { criarRepoIndexedDB } from '../../app/repo-indexeddb.js';
import { criarMotor } from '../../automacoes/motor.js';
import { criarRelogio } from '../../automacoes/relogio.js';
import { canalSimulado } from '../whatsapp.js';
import { CONFIG_PRECOS } from '../../config/precos.js';
import { configPrime, RAIZ, modoDev } from '../../config/app.js';

const CHAVE_RELOGIO = 'prime.relogio.deslocamento';

export async function criarAdapterMock({ nomeBanco } = {}) {
  const repo = await criarRepoIndexedDB(nomeBanco);
  const relogio = criarRelogio({
    lerDeslocamento: () => { try { return modoDev() ? localStorage.getItem(CHAVE_RELOGIO) : 0; } catch { return 0; } },
    gravarDeslocamento: (v) => { try { localStorage.setItem(CHAVE_RELOGIO, String(v)); } catch { /* ignora */ } },
  });
  const deps = {
    repo, relogio, gerarId: () => crypto.randomUUID(), bytesAleatorios: (n) => crypto.getRandomValues(new Uint8Array(n)),
    configPrime, cfg: CONFIG_PRECOS,
  };
  const casos = criarCasosDeUso(deps);
  const motor = criarMotor({ ...deps, urlSite: RAIZ.href, canal: canalSimulado });

  // Seed só com storage vazio.
  if (await casos.estaVazio()) {
    const { montarSeed } = await import('../../../scripts/fixtures/seed.js');
    const seed = montarSeed(casos.hoje(), CONFIG_PRECOS);
    await casos.semear(seed, seed.pedidos);
  }
  await motor.tique();

  const ESCRITAS = new Set([
    'criarCliente', 'criarPedido', 'confirmarAutoagendamento', 'transicionarAtendimento', 'atribuirDiarista', 'criarPagamento',
    'informarPagamento', 'confirmarPagamento', 'cancelarPedido', 'salvarDocumento', 'cadastrarDiarista', 'aprovarDiarista',
    'reprovarDiarista', 'criarAvaliacao', 'registrarContatoManual',
  ]);
  const adapter = { tipo: 'mock', relogio, motor, fecharBanco: () => repo.fechar() };
  for (const [nome, fn] of Object.entries(casos)) {
    if (typeof fn !== 'function') continue;
    adapter[nome] = ESCRITAS.has(nome)
      ? async (...args) => { const r = await fn(...args); await motor.tique(); return r; }
      : fn;
  }
  return adapter;
}
