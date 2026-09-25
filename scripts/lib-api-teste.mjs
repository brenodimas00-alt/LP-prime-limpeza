// Adapter supabase dos testes de homologação com um usuário fictício por papel (mesmo desenho do testa-b3):
// cliente nova vira uma conta no agendamento; cada cadastro de diarista tem conta, CPF e e-mail fictícios próprios.
import { criarAdapterSupabase } from '../src/services/adapters/supabase.js';
import { anonimo, entrar, criarUsuario, emailTeste, cpfFicticio, exigirTelefonesLivres } from './lib-supabase.mjs';
import { CLIENTE_RESIDENCIAL, CLIENTE_EMPRESA } from './fixtures/seed.js';

export async function montarApiDeTeste(prefixo) {
  await exigirTelefonesLivres([CLIENTE_RESIDENCIAL.telefone, CLIENTE_EMPRESA.telefone]);
  const prime = await entrar(await criarUsuario(`${prefixo}-prime`, 'prime_atendimento'));
  const outra = await entrar(await criarUsuario(`${prefixo}-outra`));
  const porEmail = new Map(); const porClienteId = new Map(); const porDiaristaId = new Map(); const identidade = new Map();
  async function usuarioCliente(email) {
    if (!porEmail.has(email)) porEmail.set(email, entrar(await criarUsuario(`${prefixo}-cli-${porEmail.size}`)));
    return porEmail.get(email);
  }
  async function usuarioDiarista(id) {
    if (!porDiaristaId.has(id)) porDiaristaId.set(id, entrar(await criarUsuario(`${prefixo}-dia-${porDiaristaId.size}`)));
    return porDiaristaId.get(id);
  }
  async function clientePara(s) {
    if (!s || s.ator === 'publico') return anonimo();
    if (s.ator === 'prime') return prime;
    if (s.ator === 'cliente') return porClienteId.get(s.id) || s.usuario || outra;
    if (s.ator === 'diarista') return porDiaristaId.get(s.id) || outra;
    return anonimo();
  }
  const base = criarAdapterSupabase({ clientePara });
  const api = {
    ...base,
    async confirmarAutoagendamento(d, o = {}) {
      const u = await usuarioCliente(d.cliente.email);
      const r = await base.confirmarAutoagendamento(d, { ...o, sessao: { ator: 'cliente', usuario: u } });
      porClienteId.set(r.cliente.id, u);
      return r;
    },
    async salvarDocumento(d, o = {}) { await usuarioDiarista(d.diaristaId); return base.salvarDocumento(d, { ...o, sessao: { ator: 'diarista', id: d.diaristaId } }); },
    async cadastrarDiarista(d, o = {}) {
      await usuarioDiarista(d.id);
      if (!identidade.has(d.id)) identidade.set(d.id, { cpf: cpfFicticio(), email: emailTeste('dia') });
      return base.cadastrarDiarista({ ...d, ...identidade.get(d.id) }, { ...o, sessao: { ator: 'diarista', id: d.id } });
    },
  };
  return { api, prime, outra, usuarioDiarista, porDiaristaId, porClienteId, porEmail };
}
