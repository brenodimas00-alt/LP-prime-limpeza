// Fake API: implementa docs/API.md em Node http puro, com os MESMOS casos de uso do mock sobre repositório em memória.
// Faz o papel do backend (gera eventos e notificações). Só pra teste de contrato; não é servidor de produção.
// Uso: node scripts/fake-api.mjs [porta]  (padrão 8787). Rotas sob /api.
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { randomUUID, randomBytes } from 'node:crypto';
import { criarCasosDeUso } from '../src/app/casos-de-uso.js';
import { criarRepoMemoria } from '../src/app/repo-memoria.js';
import { criarMotor } from '../src/automacoes/motor.js';
import { criarRelogio, criarRelogioFixo } from '../src/automacoes/relogio.js';
import { canalSimulado } from '../src/services/whatsapp.js';
import { CONFIG_PRECOS } from '../src/config/precos.js';
import { PRIME as PRIME_TESTE } from '../src/config/prime.teste.js';
import { ErroNegocio } from '../src/domain/modelo.js';

const STATUS_ERRO = {
  DADOS_INVALIDOS: 400, EVENTO_INVALIDO: 400, DATA_INVALIDA: 422, REGIAO_NAO_ATENDIDA: 422, REGIAO_SOB_CONSULTA: 422, NAO_ENCONTRADO: 404,
  TRANSICAO_PROIBIDA: 409, CONDICAO_NAO_ATENDIDA: 409, CONFLITO_IDEMPOTENCIA: 409, PAGAMENTO_NAO_ELEGIVEL: 409, JA_AVALIADO: 409,
  ATOR_SEM_PERMISSAO: 403, CONFIG_INCOMPLETA: 503, SERVICO_INDISPONIVEL: 503, ERRO_INTERNO: 500,
};
const LIMITE_CORPO = 6 * 1024 * 1024;

export function criarFakeApi({ agoraFixo, urlSite = 'http://localhost:8080/LP-prime-limpeza/', configPrime = () => PRIME_TESTE } = {}) {
  const repo = criarRepoMemoria();
  const relogio = agoraFixo ? criarRelogioFixo(agoraFixo) : criarRelogio();
  const deps = { repo, relogio, gerarId: randomUUID, bytesAleatorios: (n) => new Uint8Array(randomBytes(n)), configPrime, cfg: CONFIG_PRECOS };
  const casos = criarCasosDeUso(deps);
  const motor = criarMotor({ ...deps, urlSite, canal: canalSimulado });

  function sessaoDe(req) {
    const h = String(req.headers['x-ator-teste'] || '');
    if (!h) return { ator: 'publico' };
    const [ator, id] = h.split(':');
    return id ? { ator, id } : { ator };
  }

  async function lerCorpo(req) {
    const partes = [];
    let total = 0;
    for await (const c of req) {
      total += c.length;
      if (total > LIMITE_CORPO) throw new ErroNegocio('DADOS_INVALIDOS', 'Corpo grande demais');
      partes.push(c);
    }
    return Buffer.concat(partes);
  }

  function lerJson(buf) {
    if (!buf.length) return {};
    try { return JSON.parse(buf.toString('utf8')); } catch { throw new ErroNegocio('DADOS_INVALIDOS', 'JSON inválido'); }
  }

  /** Parser multipart mínimo (campos texto + 1 arquivo). */
  function lerMultipart(buf, tipo) {
    const m = /boundary=(?:"([^"]+)"|([^;]+))/.exec(tipo || '');
    if (!m) throw new ErroNegocio('DADOS_INVALIDOS', 'multipart sem boundary');
    const sep = Buffer.from(`--${m[1] || m[2]}`);
    const campos = {};
    let i = buf.indexOf(sep);
    while (i !== -1) {
      const ini = i + sep.length;
      if (buf.slice(ini, ini + 2).toString() === '--') break;
      const fimCab = buf.indexOf('\r\n\r\n', ini);
      const prox = buf.indexOf(sep, fimCab);
      if (fimCab === -1 || prox === -1) break;
      const cab = buf.slice(ini + 2, fimCab).toString('utf8');
      const corpo = buf.slice(fimCab + 4, prox - 2);
      const nome = /name="([^"]+)"/.exec(cab)?.[1];
      const arq = /filename="([^"]*)"/.exec(cab)?.[1];
      const ct = /content-type:\s*([^\r\n]+)/i.exec(cab)?.[1]?.trim();
      if (nome) campos[nome] = arq !== undefined ? { nomeArquivo: arq, mime: ct, conteudo: new Uint8Array(corpo) } : corpo.toString('utf8');
      i = prox;
    }
    return campos;
  }

  const rotas = [
    ['POST', /^\/clientes$/, (c) => casos.criarCliente(c.corpo, c.o), 201],
    ['POST', /^\/pedidos$/, (c) => casos.criarPedido(c.corpo, c.o), 201],
    ['POST', /^\/autoagendamentos$/, (c) => casos.confirmarAutoagendamento(c.corpo, c.o), 201],
    ['GET', /^\/pedidos$/, (c) => casos.listarPedidos({ clienteId: c.q.get('clienteId') || undefined }, c.o)],
    ['GET', /^\/pedidos\/([^/]+)$/, (c) => casos.obterPedido(c.p[0], c.o)],
    ['POST', /^\/pedidos\/([^/]+)\/cancelar$/, (c) => casos.cancelarPedido(c.p[0], c.corpo, c.o)],
    ['GET', /^\/atendimentos$/, (c) => casos.listarAtendimentos({ de: c.q.get('de') || undefined, ate: c.q.get('ate') || undefined, status: c.q.get('status') || undefined }, c.o)],
    ['GET', /^\/atendimentos\/([^/]+)$/, (c) => casos.obterAtendimento(c.p[0], c.o)],
    ['GET', /^\/diaristas\/([^/]+)\/atendimentos$/, (c) => casos.listarAtendimentosDaDiarista(c.p[0], c.o)],
    ['GET', /^\/avaliacoes$/, (c) => casos.listarAvaliacoes({ diaristaId: c.q.get('diaristaId') || undefined }, c.o)],
    ['POST', /^\/atendimentos\/([^/]+)\/eventos$/, (c) => casos.transicionarAtendimento(c.p[0], c.corpo, c.o)],
    ['POST', /^\/atendimentos\/([^/]+)\/diarista$/, (c) => casos.atribuirDiarista(c.p[0], c.corpo, c.o)],
    ['POST', /^\/atendimentos\/([^/]+)\/avaliacao$/, (c) => casos.criarAvaliacao(c.p[0], c.corpo, c.o), 201],
    ['GET', /^\/atendimentos\/([^/]+)\/avaliacao$/, (c) => casos.obterAvaliacaoDoAtendimento(c.p[0], c.o)],
    ['POST', /^\/pedidos\/([^/]+)\/disponibilidade$/, (c) => casos.confirmarDisponibilidade(c.p[0], c.corpo, c.o)],
    ['POST', /^\/pedidos\/([^/]+)\/recusar$/, (c) => casos.recusarSolicitacao(c.p[0], c.corpo, c.o)],
    ['POST', /^\/pagamentos\/([^/]+)\/estorno$/, (c) => casos.registrarEstorno(c.p[0], c.corpo, c.o)],
    ['GET', /^\/pagamentos\/([^/]+)$/, (c) => casos.obterPagamento(c.p[0], c.o)],
    ['POST', /^\/pagamentos\/([^/]+)\/informar$/, (c) => casos.informarPagamento(c.p[0], c.o)],
    ['POST', /^\/pagamentos\/([^/]+)\/confirmar$/, (c) => casos.confirmarPagamento(c.p[0], c.o)],
    ['POST', /^\/diaristas$/, (c) => casos.cadastrarDiarista(c.corpo, c.o), 201],
    ['GET', /^\/diaristas$/, (c) => casos.listarDiaristas({ status: c.q.get('status') || undefined }, c.o)],
    ['GET', /^\/diaristas\/([^/]+)$/, (c) => casos.obterDiarista(c.p[0], c.o)],
    ['POST', /^\/diaristas\/([^/]+)\/aprovar$/, (c) => casos.aprovarDiarista(c.p[0], c.corpo, c.o)],
    ['POST', /^\/diaristas\/([^/]+)\/reprovar$/, (c) => casos.reprovarDiarista(c.p[0], c.corpo, c.o)],
    ['GET', /^\/diaristas\/([^/]+)\/documentos$/, (c) => casos.listarDocumentos(c.p[0], c.o)],
    ['POST', /^\/diaristas\/([^/]+)\/documentos$/, (c) => {
      const f = c.multipart || {};
      const a = f.arquivo || {};
      return casos.salvarDocumento({ diaristaId: c.p[0], tipo: f.tipo, nomeArquivo: a.nomeArquivo, mime: a.mime, tamanho: a.conteudo?.length, conteudo: a.conteudo }, c.o);
    }, 201],
    ['GET', /^\/notificacoes$/, (c) => casos.listarNotificacoes({ pedidoId: c.q.get('pedidoId') || undefined, diaristaId: c.q.get('diaristaId') || undefined, status: c.q.get('status') || undefined }, c.o)],
    ['GET', /^\/eventos$/, (c) => casos.listarEventos({ status: c.q.get('status') || undefined }, c.o)],
    ['POST', /^\/contatos-manuais$/, (c) => casos.registrarContatoManual(c.corpo, c.o), 201],
    // Só teste: avança o relógio do "backend" e roda o agendador.
    ['POST', /^\/_teste\/relogio$/, async (c) => { if (c.corpo.irPara) relogio.irPara(c.corpo.irPara); if (c.corpo.avancarMs) relogio.avancar(c.corpo.avancarMs); await motor.tique(); return { agora: relogio.agora().toISOString() }; }],
  ];

  function cors(req, res) {
    const origem = req.headers.origin || '';
    if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origem)) {
      res.setHeader('Access-Control-Allow-Origin', origem);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Idempotency-Key, X-Ator-Teste');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
  }

  function enviar(res, status, corpo) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(corpo));
  }

  const servidor = http.createServer(async (req, res) => {
    cors(req, res);
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith('/api/')) return enviar(res, 404, { erro: { codigo: 'NAO_ENCONTRADO', mensagem: 'Rota inexistente' } });
    const caminho = url.pathname.slice(4);
    try {
      // arquivo binário de documento
      const mArq = /^\/documentos\/([^/]+)\/arquivo$/.exec(caminho);
      if (req.method === 'GET' && mArq) {
        const r = await casos.obterArquivo(decodeURIComponent(mArq[1]), { sessao: sessaoDe(req) });
        res.writeHead(200, { 'Content-Type': r.documento.mime, 'Content-Disposition': 'inline', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store, private' });
        return res.end(Buffer.from(r.conteudo));
      }
      const rota = rotas.find(([m, re]) => m === req.method && re.test(caminho));
      if (!rota) return enviar(res, 404, { erro: { codigo: 'NAO_ENCONTRADO', mensagem: 'Rota inexistente' } });
      const [metodo, re, fn, status = 200] = rota;
      const buf = metodo === 'POST' ? await lerCorpo(req) : Buffer.alloc(0);
      const tipo = req.headers['content-type'] || '';
      const ctx = {
        p: re.exec(caminho).slice(1).map(decodeURIComponent), q: url.searchParams,
        corpo: tipo.startsWith('multipart/') ? {} : lerJson(buf),
        multipart: tipo.startsWith('multipart/') ? lerMultipart(buf, tipo) : null,
        o: { sessao: sessaoDe(req), chave: req.headers['idempotency-key'] || undefined },
      };
      const r = await fn(ctx);
      if (metodo === 'POST') await motor.tique();
      const repetido = r && r._repetido;
      if (repetido) delete r._repetido;
      return enviar(res, repetido ? 200 : status, r);
    } catch (e) {
      if (e instanceof ErroNegocio || e?.codigo) return enviar(res, STATUS_ERRO[e.codigo] || 500, { erro: { codigo: e.codigo, mensagem: e.message, detalhes: e.detalhes } });
      console.error(e);
      return enviar(res, 500, { erro: { codigo: 'ERRO_INTERNO', mensagem: 'Erro interno' } });
    }
  });

  return { servidor, casos, motor, relogio, repo };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const porta = Number(process.argv[2] || process.env.PORT || 8787);
  const { servidor } = criarFakeApi();
  servidor.listen(porta, () => console.log(`fake-api em http://localhost:${porta}/api`));
}
