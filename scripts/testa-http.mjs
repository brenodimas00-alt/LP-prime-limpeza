// CONTRATO HTTP: adapter http (src/services/adapters/http.js) contra scripts/fake-api.mjs. node scripts/testa-http.mjs
import { criarSuite, assert, lancaCodigo } from './lib-teste.mjs';
import { registrarCenarios, AGORA_TESTE, criarAvulso } from './cenarios.mjs';
import { criarFakeApi } from './fake-api.mjs';
import { criarAdapterHttp } from '../src/services/adapters/http.js';

const t = criarSuite('contrato http (adapter http x fake-api)');
const { servidor } = criarFakeApi({ agoraFixo: AGORA_TESTE });
await new Promise((r) => servidor.listen(0, r));
const baseUrl = `http://localhost:${servidor.address().port}/api`;
const api = criarAdapterHttp({ baseUrl });

registrarCenarios(t, { api });

t.teste('HTTP: status 201 na criação, 200 na repetição idempotente, 409 no conflito', async () => {
  const corpo = JSON.stringify({ cliente: (await import('./fixtures/seed.js')).CLIENTE_RESIDENCIAL, pacote: { tipoServico: 'residencial', duracaoHoras: 4, metragem: 50, quantidadeDiarias: 1, frequencia: 'avulso' }, primeiraData: '2026-10-05', turno: 'manha' });
  const h = { 'Content-Type': 'application/json', 'Idempotency-Key': 'chave-http-status-1' };
  const a = await fetch(`${baseUrl}/autoagendamentos`, { method: 'POST', headers: h, body: corpo });
  const b = await fetch(`${baseUrl}/autoagendamentos`, { method: 'POST', headers: h, body: corpo });
  const c = await fetch(`${baseUrl}/autoagendamentos`, { method: 'POST', headers: h, body: corpo.replace('"duracaoHoras":4', '"duracaoHoras":6') });
  assert.equal(a.status, 201); assert.equal(b.status, 200); assert.equal(c.status, 409);
  assert.equal((await c.json()).erro.codigo, 'CONFLITO_IDEMPOTENCIA');
  assert.equal((await a.json()).pedido.id, (await b.json()).pedido.id);
});

t.teste('HTTP: escrita sem Idempotency-Key -> 400 DADOS_INVALIDOS', async () => {
  const r = await fetch(`${baseUrl}/pagamentos/x/informar`, { method: 'POST', headers: { 'X-Ator-Teste': 'prime' } });
  assert.equal(r.status, 400);
});

t.teste('HTTP: front não recebe nem envia payload de provedor (resposta sem campos da Meta)', async () => {
  const r = await criarAvulso(api);
  const txt = JSON.stringify(r);
  assert.ok(!/messaging_product|phone_number_id|graph\.facebook/.test(txt));
});

t.teste('falha do serviço: servidor fora -> SERVICO_INDISPONIVEL', async () => {
  const fora = criarAdapterHttp({ baseUrl: 'http://127.0.0.1:9/api' });
  await lancaCodigo(() => fora.obterPedido('x', { sessao: { ator: 'prime' } }), 'SERVICO_INDISPONIVEL');
});

const falhas = await t.fim();
servidor.close();
process.exit(falhas ? 1 : 0);
