// Interface única que a UI usa. Escolhe o adapter por src/config/app.js (ADAPTER) e injeta a sessão.
// Uso: await api.obterPedido(id)  |  await api.transicionarAtendimento(id, { evento }, { chave })
// O argumento de opções ({ chave, sessao }) fica sempre na posição fixa definida em ARIDADE.
import { ADAPTER, API_BASE_URL } from '../config/app.js';
import { sessaoAtual } from './sessao.js';

/** Quantos argumentos posicionais cada caso de uso tem antes das opções. */
export const ARIDADE = {
  criarCliente: 1, criarPedido: 1, confirmarAutoagendamento: 1, obterPedido: 1, listarPedidos: 1, obterAtendimento: 1,
  transicionarAtendimento: 2, atribuirDiarista: 2, criarPagamento: 1, obterPagamento: 1, informarPagamento: 1,
  confirmarPagamento: 1, cancelarPedido: 2, salvarDocumento: 1, listarDocumentos: 1, obterArquivo: 1, cadastrarDiarista: 1,
  obterDiarista: 1, listarDiaristas: 1, aprovarDiarista: 2, reprovarDiarista: 2, criarAvaliacao: 2,
  obterAvaliacaoDoAtendimento: 1, listarNotificacoes: 1, listarEventos: 1, registrarContatoManual: 1,
  listarAtendimentos: 1, listarAtendimentosDaDiarista: 1, listarAvaliacoes: 1,
};

let pronto;

export function adapterAtual() {
  if (!pronto) {
    pronto = (async () => {
      if (ADAPTER === 'http') {
        const { criarAdapterHttp } = await import('./adapters/http.js');
        const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(`${API_BASE_URL}/`);
        return criarAdapterHttp({ baseUrl: API_BASE_URL, sessaoTeste: local ? sessaoAtual : undefined });
      }
      const { criarAdapterMock } = await import('./adapters/mock.js');
      return criarAdapterMock();
    })();
    pronto.catch(() => { pronto = undefined; });
  }
  return pronto;
}

async function chamar(nome, args) {
  const n = ARIDADE[nome];
  if (n === undefined) throw new Error(`caso de uso inexistente: ${nome}`);
  const a = await adapterAtual();
  const posicionais = Array.from({ length: n }, (_, i) => args[i]);
  const opcoes = args[n] || {};
  return a[nome](...posicionais, { sessao: sessaoAtual(), ...opcoes });
}

export const api = new Proxy({}, { get: (_, nome) => (...args) => chamar(nome, args) });

/** "Agora" do app: no mock respeita o relógio simulado (?dev=1); no http é o relógio do aparelho. */
export async function agora() {
  const a = await adapterAtual();
  return a.relogio ? a.relogio.agora() : new Date();
}

/** Nova chave de idempotência (UUID). Guardar junto do rascunho/ação e reutilizar nas repetições. */
export function novaChave() {
  return crypto.randomUUID();
}
