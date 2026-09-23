// Monta casos de uso + motor em memória com relógio fixo (testes Node).
import { randomUUID, randomBytes } from 'node:crypto';
import { criarCasosDeUso } from '../src/app/casos-de-uso.js';
import { criarRepoMemoria } from '../src/app/repo-memoria.js';
import { criarMotor } from '../src/automacoes/motor.js';
import { criarRelogioFixo } from '../src/automacoes/relogio.js';
import { canalSimulado } from '../src/services/whatsapp.js';
import { CONFIG_PRECOS } from '../src/config/precos.js';
import { PRIME } from '../src/config/prime.teste.js';

export function montarAmbiente(agoraISO, { configPrime = () => PRIME, cfg = CONFIG_PRECOS } = {}) {
  const repo = criarRepoMemoria();
  const relogio = criarRelogioFixo(agoraISO);
  const deps = { repo, relogio, gerarId: randomUUID, bytesAleatorios: (n) => new Uint8Array(randomBytes(n)), configPrime, cfg };
  const casosBase = criarCasosDeUso(deps);
  const motor = criarMotor({ ...deps, urlSite: 'https://prime.exemplo/LP-prime-limpeza/', canal: canalSimulado });
  // Igual ao adapter mock: depois de cada escrita, o motor dá um tique.
  const casos = {};
  for (const [k, fn] of Object.entries(casosBase)) {
    casos[k] = typeof fn === 'function' ? async (...a) => { const r = await fn(...a); await motor.tique(); return r; } : fn;
  }
  return { repo, relogio, casos, casosBase, motor };
}
