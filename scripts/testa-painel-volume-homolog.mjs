// F1 volume (migration 20261021100000_painel_volume), contra a HOMOLOGAÇÃO, só com fictícios: as leituras que deixam as
// seções antigas do painel abrirem com anos de dados.
// - painel_operacao: solicitações e cobranças abertas no MESMO formato do obter_pedido (as abas antigas usam igual),
//   diárias sem profissional sempre, recebidos recentes em linha leve; só a equipe da Prime.
// - listar_avaliacoes com limite: só as N últimas, média por profissional e total calculados sobre todas; sem limite, igual
//   ao de antes (sem médias).
// - listas_relacionamento: mesma forma de antes (renovação e reativação com total, itens até 200 e regra ligada).
// Uso: bash scripts/cli.sh node22 scripts/testa-painel-volume-homolog.mjs
import { criarSuite, assert } from './lib-teste.mjs';
import { fecharSql, limparFicticios, entrar, criarUsuario, anonimo } from './lib-supabase.mjs';
import { montarApiDeTeste } from './lib-api-teste.mjs';
import { agendar, chave, liberarCobranca } from './cenarios.mjs';
import { CLIENTE_RESIDENCIAL, proximaDataSemTaxa } from './fixtures/seed.js';
import { CONFIG_PRECOS } from '../src/config/precos.js';
import { dataNoFuso } from '../src/domain/calendario.js';

const t = criarSuite('F1 volume: leituras do painel numa chamada (homologação)');
await limparFicticios();
const { api } = await montarApiDeTeste('vol');
const ADM = await entrar(await criarUsuario('vol-adm', 'prime_admin'));
const rpc = async (c, nome, args) => { const { data, error } = await c.rpc(nome, args); if (error) throw Object.assign(new Error(`${nome}: ${error.message}`), { codigo: error.message }); return data; };
const D = proximaDataSemTaxa(dataNoFuso(new Date().toISOString()), 3, CONFIG_PRECOS);
const novoPedido = () => agendar(api, { cliente: CLIENTE_RESIDENCIAL, pacote: { tipoServico: 'residencial', duracaoHoras: 4, metragem: 45, quantidadeDiarias: 1, frequencia: 'avulso' }, primeiraData: D, turno: 'manha' }, chave('vol'));

t.teste('painel_operacao: solicitação e cobrança aberta no formato do obter_pedido; diária sem profissional aparece', async () => {
  const solicitado = await novoPedido();
  const comCobranca = await novoPedido();
  await liberarCobranca(api, comCobranca);
  const op = await rpc(ADM, 'painel_operacao', { p_dias: 7 });
  for (const r of [solicitado, comCobranca]) {
    const doPainel = op.pedidos.find((x) => x.pedido.id === r.pedido.id);
    assert.ok(doPainel, `pedido ${r.pedido.id} fora do painel_operacao`);
    assert.deepEqual(doPainel, await rpc(ADM, 'obter_pedido', { p_id: r.pedido.id }), 'mesmo formato e conteúdo do obter_pedido');
  }
  const at = op.atendimentos.find((x) => x.atendimento.id === comCobranca.atendimentos[0].id);
  assert.ok(at && !at.atendimento.diaristaId, 'diária sem profissional, qualquer data');
  assert.ok(Array.isArray(op.recebidos) && op.diasConfirmados === 7);
});

t.teste('painel_operacao e listar_avaliacoes só pra equipe da Prime (anônimo e cliente não leem)', async () => {
  for (const c of [anonimo(), await entrar(await criarUsuario('vol-cli', 'cliente'))]) {
    const { error } = await c.rpc('painel_operacao', { p_dias: 7 });
    assert.ok(error, 'não podia ler');
  }
});

t.teste('listar_avaliacoes: com limite traz só as N últimas e a média sobre todas; sem limite, a forma de antes', async () => {
  const sem = await rpc(ADM, 'listar_avaliacoes', { p_filtro: {} });
  assert.ok(Array.isArray(sem.itens) && sem.medias == null && sem.total == null, 'sem limite: só itens, como antes');
  const com = await rpc(ADM, 'listar_avaliacoes', { p_filtro: { limite: 1 } });
  assert.ok(com.itens.length <= 1);
  assert.equal(com.total, sem.itens.length, 'total sobre todas');
  assert.ok(Array.isArray(com.medias));
});

t.teste('listas_relacionamento: renovação e reativação com total, itens (até 200) e regra ligada', async () => {
  const r = await rpc(ADM, 'listas_relacionamento', {});
  for (const k of ['renovacao', 'reativacao']) {
    assert.ok(Number.isInteger(r[k].total) && Array.isArray(r[k].itens) && r[k].itens.length <= 200 && typeof r[k].regraLigada === 'boolean', k);
    assert.ok(r[k].itens.length === Math.min(200, r[k].total), `${k}: itens batem com o total`);
  }
});

const falhas = await t.fim();
await limparFicticios({ soEstaExecucao: true });
await fecharSql();
process.exit(falhas ? 1 : 0);
