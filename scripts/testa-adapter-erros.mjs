// Adapter Supabase: tradução de erro (entrega final, 26/10/2026; revisão de arquitetura). Sem rede: cliente falso.
// - falha LANÇADA pelo supabase-js (rede caiu) vira SERVICO_INDISPONIVEL, como o erro devolvido com "Failed to fetch";
// - Edge Function com 401 sem o envelope { erro } (gateway recusou o token) vira SESSAO_EXPIRADA, como a RPC com JWT vencido;
// - os caminhos que já existiam continuam iguais (código de negócio, 42501, PGRST301, function com envelope, sem resposta).
// Uso: node scripts/testa-adapter-erros.mjs
import { criarSuite, lancaCodigo } from './lib-teste.mjs';
import { criarAdapterSupabase } from '../src/services/adapters/supabase.js';

const t = criarSuite('adapter supabase: tradução de erro');
const adapter = (falso) => criarAdapterSupabase({ cliente: async () => falso });
const rpcDevolve = (error) => adapter({ rpc: async () => ({ data: null, error }) });
const funcaoDevolve = (error) => adapter({ functions: { invoke: async () => ({ data: null, error }) } });
const contexto = (status, corpo) => ({ status, json: async () => { if (corpo === undefined) throw new Error('sem json'); return corpo; } });

t.teste('rpc: falha lançada pela rede vira SERVICO_INDISPONIVEL', async () => {
  await lancaCodigo(() => adapter({ rpc: async () => { throw new TypeError('Failed to fetch'); } }).motivosPadrao(), 'SERVICO_INDISPONIVEL');
});
t.teste('rpc: falha lançada desconhecida vira ERRO_INTERNO (não escapa crua)', async () => {
  await lancaCodigo(() => adapter({ rpc: async () => { throw new Error('quebrou'); } }).motivosPadrao(), 'ERRO_INTERNO');
});
t.teste('rpc: erros devolvidos seguem como antes', async () => {
  await lancaCodigo(() => rpcDevolve({ message: 'TypeError: Failed to fetch' }).motivosPadrao(), 'SERVICO_INDISPONIVEL');
  await lancaCodigo(() => rpcDevolve({ code: 'PGRST301', message: 'JWT expired' }).motivosPadrao(), 'SESSAO_EXPIRADA');
  await lancaCodigo(() => rpcDevolve({ code: '42501', message: 'permission denied' }).motivosPadrao(), 'ATOR_SEM_PERMISSAO');
  await lancaCodigo(() => rpcDevolve({ message: 'NAO_ENCONTRADO', details: 'Não encontrado' }).motivosPadrao(), 'NAO_ENCONTRADO');
});
t.teste('function: 401 sem envelope vira SESSAO_EXPIRADA; com envelope, o código da function', async () => {
  await lancaCodigo(() => funcaoDevolve({ context: contexto(401) }).cadastrarClienteV3({}), 'SESSAO_EXPIRADA');
  await lancaCodigo(() => funcaoDevolve({ context: contexto(400, { erro: { codigo: 'DADOS_INVALIDOS', mensagem: 'x' } }) }).cadastrarClienteV3({}), 'DADOS_INVALIDOS');
  await lancaCodigo(() => funcaoDevolve({ context: contexto(500) }).cadastrarClienteV3({}), 'ERRO_INTERNO');
  await lancaCodigo(() => funcaoDevolve({}).cadastrarClienteV3({}), 'SERVICO_INDISPONIVEL');
  await lancaCodigo(() => adapter({ functions: { invoke: async () => { throw new TypeError('Failed to fetch'); } } }).cadastrarClienteV3({}), 'SERVICO_INDISPONIVEL');
});

const falhas = await t.fim();
process.exit(falhas ? 1 : 0);
