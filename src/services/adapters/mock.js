// Adapter MOCK: executa os casos de uso no navegador, persiste em IndexedDB e roda o motor de automações.
// Dados ficam SÓ neste navegador: nada chega à Prime e outro aparelho não vê.
import { criarCasosDeUso } from '../../app/casos-de-uso.js';
import { criarRepoIndexedDB } from '../../app/repo-indexeddb.js';
import { criarMotorLocal } from '../../automacoes/v2/local.js';
import { criarRelogio } from '../../automacoes/relogio.js';
import { CONFIG_PRECOS } from '../../config/precos.js';
import { configPrime, RAIZ, modoDev } from '../../config/app.js';
import { VERSAO_LEGAL } from '../../config/legal.js';
import { ErroNegocio } from '../../domain/modelo.js';

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
  const motor = criarMotorLocal({ repo: deps.repo, relogio: deps.relogio, gerarId: deps.gerarId, cfg: deps.cfg, urlSite: RAIZ.href }); // AUT: motor v2

  // Seed só com storage vazio.
  if (await casos.estaVazio()) {
    const { montarSeed } = await import('../../../scripts/fixtures/seed.js');
    const seed = montarSeed(casos.hoje(), CONFIG_PRECOS);
    await casos.semear(seed, seed.pedidos);
  }
  await motor.tique();

  const ESCRITAS = new Set([
    'criarCliente', 'criarPedido', 'confirmarAutoagendamento', 'transicionarAtendimento', 'atribuirDiarista', 'confirmarDisponibilidade', 'recusarSolicitacao', 'registrarEstorno',
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
  Object.assign(adapter, lgpdMock(adapter));
  return adapter;
}

/**
 * L1 na demonstração: aceite, consentimentos, pedidos do titular e flags só neste navegador (localStorage).
 * Contas do seed já nascem com o aceite da versão vigente; a regra de verdade está no banco (adapter supabase).
 */
function lgpdMock(adapter) {
  const CHAVE = 'prime.lgpd.demo';
  const ler = () => { try { return JSON.parse(localStorage.getItem(CHAVE)) || {}; } catch { return {}; } };
  const gravar = (d) => { try { localStorage.setItem(CHAVE, JSON.stringify(d)); } catch { /* ignora */ } };
  const titular = (o) => {
    const s = o?.sessao;
    if (!s || !['cliente', 'diarista'].includes(s.ator)) throw new ErroNegocio('ATOR_SEM_PERMISSAO', 'Entre na sua conta pra continuar.');
    return `${s.ator}:${s.id}`;
  };
  const exigirPrime = (o) => { if (o?.sessao?.ator !== 'prime') throw new ErroNegocio('ATOR_SEM_PERMISSAO', 'Só a Prime.'); };
  const flags = (d) => ({ lgpd_portal_titular: true, lgpd_reaceite_termos: true, ...(d.flags || {}) });
  return {
    async situacaoLegal(o) {
      const d = ler(); const t = titular(o); const f = flags(d);
      return {
        versaoVigente: VERSAO_LEGAL, aceitouVigente: (d.recusouAceite || {})[t] !== VERSAO_LEGAL, pedirAceite: f.lgpd_reaceite_termos, portal: f.lgpd_portal_titular,
        consentimentos: (d.consentimentos || {})[t] || {}, exclusaoEmAndamento: (d.pedidos || []).some((p) => p.titular === t && p.estado === 'aberto'),
      };
    },
    async registrarAceite(versao, o) {
      if (versao !== VERSAO_LEGAL) throw new ErroNegocio('CONDICAO_NAO_ATENDIDA', 'Os termos mudaram. Recarregue a página.');
      const d = ler(); const t = titular(o); if (d.recusouAceite) delete d.recusouAceite[t]; gravar(d);
      return { versao, aceito: true };
    },
    async definirConsentimento(tipo, concedido, o) {
      const d = ler(); const t = titular(o);
      d.consentimentos = d.consentimentos || {}; d.consentimentos[t] = { ...(d.consentimentos[t] || {}), [tipo]: !!concedido }; gravar(d);
      return d.consentimentos[t];
    },
    async meusDados(o) {
      titular(o);
      const pedidos = o.sessao.ator === 'cliente' ? (await adapter.listarPedidos({}, o)).itens : [];
      return { geradoEm: new Date().toISOString(), titular: o.sessao.ator, aviso: 'Demonstração: dados só deste navegador.', pedidos, consentimentos: (ler().consentimentos || {})[titular(o)] || {} };
    },
    async pedirExclusao(motivo, o) {
      const d = ler(); const t = titular(o); d.pedidos = d.pedidos || [];
      let p = d.pedidos.find((x) => x.titular === t && x.estado === 'aberto');
      if (!p) { p = { id: crypto.randomUUID(), titular: t, nome: o.sessao.nome, estado: 'aberto', tipo: 'exclusao', motivo: motivo || null, criadoEm: new Date().toISOString() }; d.pedidos.push(p); gravar(d); }
      return { id: p.id, estado: p.estado, criadoEm: p.criadoEm };
    },
    async listarPedidosTitular(f, o) { exigirPrime(o); return (ler().pedidos || []).filter((p) => !f?.estado || p.estado === f.estado).map((p) => ({ ...p, titularTipo: p.titular.split(':')[0], documento: null })); },
    async recusarPedidoTitular(id, resposta, o) {
      exigirPrime(o); const d = ler(); const p = (d.pedidos || []).find((x) => x.id === id && x.estado === 'aberto');
      if (!p) throw new ErroNegocio('CONDICAO_NAO_ATENDIDA', 'Pedido não está aberto.');
      Object.assign(p, { estado: 'recusado', resposta }); gravar(d); return { id, estado: 'recusado' };
    },
    async listarFlags(o) { exigirPrime(o); return Object.entries(flags(ler())).map(([chave, ligada]) => ({ chave, ligada, padrao: true, descricao: chave })); },
    async alternarFlag(chave, ligada, o) { exigirPrime(o); const d = ler(); d.flags = { ...(d.flags || {}), [chave]: !!ligada }; gravar(d); return { chave, ligada: !!ligada }; },
  };
}
