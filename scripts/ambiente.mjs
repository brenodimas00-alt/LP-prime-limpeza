// Monta casos de uso + motor de automações v2 em memória com relógio fixo (testes Node).
import { randomUUID, randomBytes } from 'node:crypto';
import { criarCasosDeUso } from '../src/app/casos-de-uso.js';
import { criarRepoMemoria } from '../src/app/repo-memoria.js';
import { criarMotorLocal } from '../src/automacoes/v2/local.js';
import { criarRelogioFixo } from '../src/automacoes/relogio.js';
import { CONFIG_PRECOS } from '../src/config/precos.js';
import { PRIME } from '../src/config/prime.teste.js';

export function montarAmbiente(agoraISO, { configPrime = () => PRIME, cfg = CONFIG_PRECOS, provedores, consentimentos, regras } = {}) {
  const repo = criarRepoMemoria();
  const relogio = criarRelogioFixo(agoraISO);
  const deps = { repo, relogio, gerarId: randomUUID, bytesAleatorios: (n) => new Uint8Array(randomBytes(n)), configPrime, cfg };
  const casosBase = criarCasosDeUso(deps);
  // AUT: motor v2 (o mesmo do worker), com os provedores simulados do mock
  const motor = criarMotorLocal({ repo, relogio, gerarId: randomUUID, cfg, urlSite: 'https://prime.exemplo/LP-prime-limpeza/', provedores, consentimentos, regras });
  // Igual ao adapter mock: depois de cada escrita, o motor dá um tique.
  const casos = {};
  for (const [k, fn] of Object.entries(casosBase)) {
    casos[k] = typeof fn === 'function' ? async (...a) => { const r = await fn(...a); await motor.tique(); return r; } : fn;
  }
  return { repo, relogio, casos, casosBase, motor };
}
