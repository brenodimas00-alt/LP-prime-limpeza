// Casos de uso sobre repositório em memória (mesmo núcleo do adapter mock). node scripts/testa-app.mjs
import { criarSuite, assert } from './lib-teste.mjs';
import { registrarCenarios, AGORA_TESTE, criarAvulso } from './cenarios.mjs';
import { montarAmbiente } from './ambiente.mjs';

const t = criarSuite('casos de uso (memória)');
const amb = montarAmbiente(AGORA_TESTE);
registrarCenarios(t, { api: amb.casos });

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
