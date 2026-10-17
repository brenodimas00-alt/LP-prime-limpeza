// Bateria de contrato do agendamento v3 nos adapters mock (testa-app) e http (testa-http). O Supabase tem a bateria própria
// contra o homolog (testa-agendamento-v3-homolog), porque o cadastro passa pela function "conta".
import { assert, lancaCodigo } from './lib-teste.mjs';
import { CLIENTE_RESIDENCIAL } from './fixtures/seed.js';

const chave = (p) => `${p}-${crypto.randomUUID()}`;
const PF = (extra = {}) => ({ tipo: 'residencial', nome: 'Ana Nova Fictícia', telefone: '31955554444', email: `nova-${crypto.randomUUID().slice(0, 8)}@exemplo.com`, cpf: '36192847509', dataNascimento: '1990-03-07', ...extra });

export function registrarCenariosV3(t, { api: adapter }) {
  const api = () => adapter;
  t.teste('v3 cadastro: CPF novo e CPF já cadastrado respondem igual ({ok, ticket}); mesma chave devolve o mesmo ticket', async () => {
    const k = chave('cad');
    const d = PF();
    const a = await api().cadastrarClienteV3(d, { chave: k });
    assert.deepEqual(Object.keys(a).sort(), ['ok', 'ticket']); assert.match(a.ticket, /^[0-9a-f]{64}$/);
    const b = await api().cadastrarClienteV3(d, { chave: k });
    assert.equal(b.ticket, a.ticket, 'repetição devolve o mesmo ticket');
    const c = await api().cadastrarClienteV3(PF({ cpf: CLIENTE_RESIDENCIAL.cpf, nome: 'Outro Nome' }), { chave: chave('cad') });
    assert.deepEqual(Object.keys(c).sort(), ['ok', 'ticket']);
    await lancaCodigo(() => api().cadastrarClienteV3({ ...d, nome: 'Outra Pessoa' }, { chave: k }), 'CONFLITO_IDEMPOTENCIA');
  });

  t.teste('v3 cadastro: mensagens literais (nome completo, CPF, maioridade, WhatsApp)', async () => {
    const e1 = await lancaCodigo(() => api().cadastrarClienteV3(PF({ nome: 'Isabela' }), { chave: chave('v') }), 'DADOS_INVALIDOS');
    assert.equal(e1.detalhes.nome, 'Informe seu nome completo.');
    const e2 = await lancaCodigo(() => api().cadastrarClienteV3(PF({ cpf: '52998224724', telefone: '3155', dataNascimento: '2020-01-01' }), { chave: chave('v') }), 'DADOS_INVALIDOS');
    assert.deepEqual(e2.detalhes, { cpf: 'CPF inválido. Confira o número informado.', dataNascimento: 'É necessário ter 18 anos ou mais para realizar uma solicitação.', telefone: 'Confira o número informado e tente novamente.' });
  });

  t.teste('v3 endereços: só a cliente logada lista; conteúdo do agendamento público', async () => {
    await lancaCodigo(() => api().meusEnderecos({ sessao: { ator: 'publico' } }), 'ATOR_SEM_PERMISSAO');
    const c = await api().conteudoAgendamento();
    assert.ok(c.tiposImovel.empresa.includes('Galpão')); assert.ok(c.verMais.passadoria.naoInclui.includes('lavagem de roupas'));
  });
}
