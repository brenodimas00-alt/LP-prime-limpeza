// Casos de uso sobre repositório em memória (mesmo núcleo do adapter mock). node scripts/testa-app.mjs
import { criarSuite, assert } from './lib-teste.mjs';
import { registrarCenarios, registrarCenariosV2, AGORA_TESTE, criarAvulso, segundaRelativa } from './cenarios.mjs';
import { CONFIG_PRECOS } from '../src/config/precos.js';
import { somarDias, diaDaSemana } from '../src/domain/calendario.js';
import { registrarCenariosV3 } from './cenarios-v3.mjs';
import { montarAmbiente } from './ambiente.mjs';

const t = criarSuite('casos de uso (memória)');
const amb = montarAmbiente(AGORA_TESTE);
registrarCenarios(t, { api: amb.casos });
registrarCenariosV2(t, { api: amb.casos });
registrarCenariosV3(t, { api: amb.casos });

t.teste('datas relativas do homolog: pra cada dia de um ano, segunda livre de feriados, depois da antecedência e dentro do horizonte', () => {
  const fer = new Set(CONFIG_PRECOS.feriados);
  for (let i = 0; i < 366; i++) {
    const hoje = somarDias('2026-10-17', i);
    const m = segundaRelativa(hoje, CONFIG_PRECOS);
    assert.equal(diaDaSemana(m), 1, `${hoje}: segunda`);
    assert.ok(somarDias(m, -4) > hoje, `${hoje}: a quinta anterior (relógio dos cenários) fica depois de hoje`);
    for (const d of [-3, 0, 1, 2, 3, 4, 5, 7, 8, 11, 14, 18, 21]) assert.ok(!fer.has(somarDias(m, d)), `${hoje}: ${somarDias(m, d)} é feriado`);
    assert.ok(somarDias(m, 21) <= somarDias(hoje, CONFIG_PRECOS.regrasCalendario.horizonteMaximoDias), `${hoje}: dentro do horizonte`);
  }
});

t.teste('transação tudo-ou-nada: falha no meio não grava nada', async () => {
  const antes = amb.repo.contar('pedidos');
  await assert.rejects(() => amb.repo.transacao(null, async (tx) => {
    await tx.put('pedidos', { id: 'parcial' });
    throw new Error('falha simulada');
  }));
  assert.equal(amb.repo.contar('pedidos'), antes);
});

t.teste('falha de validação na composição não deixa cliente órfão', async () => {
  const antes = amb.repo.contar('clientes');
  await assert.rejects(() => criarAvulso({ confirmarAutoagendamento: (d, o) => amb.casos.confirmarAutoagendamento({ ...d, primeiraData: '2026-10-04' }, o) }));
  assert.equal(amb.repo.contar('clientes'), antes);
});

await t.fim();
