// Adapter HTTP: envia só o COMANDO de negócio pro backend (docs/API.md) e devolve o resultado.
// Não monta payload de provedor, não escolhe destinatário/template, não roda motor.
import { ErroNegocio } from '../../domain/modelo.js';

const TIMEOUT_MS = 10000;

/**
 * @param {{baseUrl:string, fetch?:typeof fetch, sessaoTeste?:()=>object}} op
 *  sessaoTeste: só pro fake-api local (cabeçalho X-Ator-Teste). O backend real ignora e usa a sessão de login.
 */
export function criarAdapterHttp({ baseUrl, fetch: f = globalThis.fetch.bind(globalThis), sessaoTeste } = {}) {
  const base = baseUrl.replace(/\/+$/, '');

  function atorTeste(sessao) {
    const s = sessao || sessaoTeste?.();
    if (!s || !s.ator || s.ator === 'publico') return null;
    return s.id ? `${s.ator}:${s.id}` : s.ator;
  }

  async function chamar(metodo, caminho, { corpo, chave, sessao, multipart, binario } = {}) {
    const headers = {};
    if (chave) headers['Idempotency-Key'] = chave;
    const at = atorTeste(sessao);
    if (at) headers['X-Ator-Teste'] = at;
    let body;
    if (multipart) body = multipart;
    else if (corpo !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(corpo); }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let resp;
    try {
      resp = await f(`${base}${caminho}`, { method: metodo, headers, body, signal: ctrl.signal });
    } catch {
      throw new ErroNegocio('SERVICO_INDISPONIVEL', 'Não conseguimos falar com o servidor. Tente de novo.');
    } finally { clearTimeout(timer); }
    if (binario && resp.ok) return resp.blob();
    let json = null;
    try { json = await resp.json(); } catch { /* corpo vazio ou não-JSON */ }
    if (!resp.ok) {
      const e = json?.erro;
      if (e?.codigo) throw new ErroNegocio(e.codigo, e.mensagem, e.detalhes);
      throw new ErroNegocio(resp.status >= 500 ? 'SERVICO_INDISPONIVEL' : 'ERRO_INTERNO', `Erro ${resp.status}`);
    }
    return json;
  }

  const q = (o) => { const p = new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '')); const s = p.toString(); return s ? `?${s}` : ''; };
  const e = encodeURIComponent;

  return {
    tipo: 'http',
    criarCliente: (d, o = {}) => chamar('POST', '/clientes', { corpo: d, ...o }),
    criarPedido: (d, o = {}) => chamar('POST', '/pedidos', { corpo: d, ...o }),
    confirmarAutoagendamento: (d, o = {}) => chamar('POST', '/autoagendamentos', { corpo: d, ...o }),
    obterPedido: (id, o = {}) => chamar('GET', `/pedidos/${e(id)}`, o),
    listarPedidos: (f2 = {}, o = {}) => chamar('GET', `/pedidos${q(f2)}`, o),
    obterAtendimento: (id, o = {}) => chamar('GET', `/atendimentos/${e(id)}`, o),
    transicionarAtendimento: (id, d, o = {}) => chamar('POST', `/atendimentos/${e(id)}/eventos`, { corpo: d, ...o }),
    atribuirDiarista: (id, d, o = {}) => chamar('POST', `/atendimentos/${e(id)}/diarista`, { corpo: d, ...o }),
    confirmarDisponibilidade: (id, d = {}, o = {}) => chamar('POST', `/pedidos/${e(id)}/disponibilidade`, { corpo: d, ...o }),
    recusarSolicitacao: (id, d = {}, o = {}) => chamar('POST', `/pedidos/${e(id)}/recusar`, { corpo: d, ...o }),
    registrarEstorno: (id, d = {}, o = {}) => chamar('POST', `/pagamentos/${e(id)}/estorno`, { corpo: d, ...o }),
    obterPagamento: (id, o = {}) => chamar('GET', `/pagamentos/${e(id)}`, o),
    informarPagamento: (id, o = {}) => chamar('POST', `/pagamentos/${e(id)}/informar`, { corpo: {}, ...o }),
    confirmarPagamento: (id, o = {}) => chamar('POST', `/pagamentos/${e(id)}/confirmar`, { corpo: {}, ...o }),
    cancelarPedido: (id, d = {}, o = {}) => chamar('POST', `/pedidos/${e(id)}/cancelar`, { corpo: d, ...o }),
    salvarDocumento: ({ diaristaId, tipo, nomeArquivo, mime, conteudo }, o = {}) => {
      const fd = new FormData();
      fd.set('tipo', tipo);
      fd.set('arquivo', conteudo instanceof Blob ? conteudo : new Blob([conteudo], { type: mime }), nomeArquivo);
      return chamar('POST', `/diaristas/${e(diaristaId)}/documentos`, { multipart: fd, ...o });
    },
    listarDocumentos: (id, o = {}) => chamar('GET', `/diaristas/${e(id)}/documentos`, o),
    obterArquivo: async (docId, o = {}) => ({ conteudo: await chamar('GET', `/documentos/${e(docId)}/arquivo`, { ...o, binario: true }) }),
    cadastrarDiarista: (d, o = {}) => chamar('POST', '/diaristas', { corpo: d, ...o }),
    obterDiarista: (id, o = {}) => chamar('GET', `/diaristas/${e(id)}`, o),
    listarDiaristas: (f2 = {}, o = {}) => chamar('GET', `/diaristas${q(f2)}`, o),
    aprovarDiarista: (id, d = {}, o = {}) => chamar('POST', `/diaristas/${e(id)}/aprovar`, { corpo: d, ...o }),
    reprovarDiarista: (id, d = {}, o = {}) => chamar('POST', `/diaristas/${e(id)}/reprovar`, { corpo: d, ...o }),
    criarAvaliacao: (id, d, o = {}) => chamar('POST', `/atendimentos/${e(id)}/avaliacao`, { corpo: d, ...o }),
    obterAvaliacaoDoAtendimento: (id, o = {}) => chamar('GET', `/atendimentos/${e(id)}/avaliacao`, o),
    listarNotificacoes: (f2 = {}, o = {}) => chamar('GET', `/notificacoes${q(f2)}`, o),
    listarEventos: (f2 = {}, o = {}) => chamar('GET', `/eventos${q(f2)}`, o),
    registrarContatoManual: (d, o = {}) => chamar('POST', '/contatos-manuais', { corpo: d, ...o }),
    listarAtendimentos: (f2 = {}, o = {}) => chamar('GET', `/atendimentos${q(f2)}`, o),
    listarAtendimentosDaDiarista: (id, o = {}) => chamar('GET', `/diaristas/${e(id)}/atendimentos`, o),
    listarAvaliacoes: (f2 = {}, o = {}) => chamar('GET', `/avaliacoes${q(f2)}`, o),
  };
}
