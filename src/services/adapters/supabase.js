// Adapter SUPABASE: cada caso de uso vira uma RPC (security definer) no Postgres; o banco decide preço, transição,
// permissão e idempotência. A sessão vem do JWT do usuário logado (src/services/auth.js): a opção `sessao` é ignorada
// aqui, exceto em testes, que passam `clientePara(sessao)` pra escolher o usuário fictício certo.
// Erros: o SQL levanta message = CÓDIGO (docs/API.md), details = mensagem, hint = detalhes JSON.
import { ErroNegocio, CODIGOS_ERRO } from '../../domain/modelo.js';
import { validarArquivo } from '../../domain/validacao.js';

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKET = 'documentos-diaristas';
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf' };

function traduzir(error, { semPermissao = 'ATOR_SEM_PERMISSAO' } = {}) {
  if (!error) return new ErroNegocio('ERRO_INTERNO', 'Erro desconhecido');
  const codigo = String(error.message || '');
  // anônimo não tem EXECUTE nas RPCs: leitura vira "não encontrado" e escrita "sem permissão", como no mock
  if (error.code === '42501') return new ErroNegocio(semPermissao, semPermissao === 'NAO_ENCONTRADO' ? 'Não encontrado' : 'Entre na sua conta pra continuar');
  if (CODIGOS_ERRO.includes(codigo)) {
    let detalhes;
    try { detalhes = error.hint ? JSON.parse(error.hint) : undefined; } catch { detalhes = undefined; }
    return new ErroNegocio(codigo, error.details || codigo, detalhes);
  }
  if (error.code === '22P02' || error.code === 'PGRST202') return new ErroNegocio('NAO_ENCONTRADO', 'Não encontrado');
  if (error.code === 'PGRST301' || /JWT/i.test(codigo)) return new ErroNegocio('SESSAO_EXPIRADA', 'Entre de novo pra continuar.');
  if (/fetch|network|Failed to/i.test(codigo)) return new ErroNegocio('SERVICO_INDISPONIVEL', 'Não conseguimos falar com o servidor. Tente de novo.');
  console.error('supabase:', error);
  return new ErroNegocio('ERRO_INTERNO', 'Não foi possível concluir. Tente de novo em instantes.');
}

/** Id que não é UUID nunca existe: vira NAO_ENCONTRADO sem ir ao banco (o Postgres daria erro de sintaxe). */
function uuid(id) {
  if (!RE_UUID.test(String(id || ''))) throw new ErroNegocio('NAO_ENCONTRADO', 'Não encontrado');
  return id;
}

/**
 * @param {{cliente: () => Promise<import('@supabase/supabase-js').SupabaseClient>, clientePara?: (sessao) => Promise<any>}} op
 *  cliente: o supabase-js do navegador (usuário logado). clientePara: só testes (usuário fictício por sessão).
 */
export function criarAdapterSupabase({ cliente, clientePara }) {
  const c = (o = {}) => (clientePara ? clientePara(o.sessao) : cliente());

  async function rpc(nome, params, o, op) {
    const { data, error } = await (await c(o)).rpc(nome, params);
    if (error) throw traduzir(error, op);
    return data;
  }
  const LER = { semPermissao: 'NAO_ENCONTRADO' };
  const obter = (nome, id, o) => rpc(nome, { p_id: uuid(id) }, o, LER);
  const acao = (nome, id, dados, o) => rpc(nome, { p_id: uuid(id), p_dados: dados ?? {}, p_chave: o?.chave ?? null }, o);

  return {
    tipo: 'supabase',
    criarCliente: async () => { throw new ErroNegocio('ATOR_SEM_PERMISSAO', 'O cadastro da cliente nasce no agendamento'); },
    criarPedido: async () => { throw new ErroNegocio('ATOR_SEM_PERMISSAO', 'Use o agendamento'); },
    confirmarAutoagendamento: (d, o) => rpc('confirmar_autoagendamento', { p_dados: { cliente: d.cliente, pacote: d.pacote, primeiraData: d.primeiraData, turno: d.turno, preferenciaProfissional: d.preferenciaProfissional ?? '' }, p_chave: o?.chave ?? null }, o),
    obterPedido: (id, o) => obter('obter_pedido', id, o),
    listarPedidos: (f = {}, o) => rpc('listar_pedidos', { p_filtro: f }, o),
    obterAtendimento: (id, o) => obter('obter_atendimento', id, o),
    transicionarAtendimento: (id, d, o) => acao('transicionar_atendimento', id, d, o),
    atribuirDiarista: (id, d, o) => acao('atribuir_diarista', id, d, o),
    confirmarDisponibilidade: (id, d, o) => acao('confirmar_disponibilidade', id, d, o),
    recusarSolicitacao: (id, d, o) => acao('recusar_solicitacao', id, d, o),
    registrarEstorno: (id, d, o) => acao('registrar_estorno', id, d, o),
    obterPagamento: (id, o) => obter('obter_pagamento', id, o),
    informarPagamento: (id, o) => rpc('informar_pagamento', { p_id: uuid(id), p_chave: o?.chave ?? null }, o),
    confirmarPagamento: (id, o) => rpc('confirmar_pagamento', { p_id: uuid(id), p_chave: o?.chave ?? null }, o),
    cancelarPedido: (id, d, o) => acao('cancelar_pedido', id, d, o),

    /** Upload direto no bucket privado (policy: só a dona, no caminho do próprio cadastro) e registro no banco. */
    async salvarDocumento({ diaristaId, tipo, nomeArquivo, mime, tamanho, conteudo }, o = {}) {
      if (!EXT[mime]) throw new ErroNegocio('DADOS_INVALIDOS', 'Formato não aceito: use JPG, PNG ou PDF', { arquivo: 'Formato não aceito: use JPG, PNG ou PDF' });
      const sb = await c(o);
      await rpc('iniciar_cadastro_diarista', { p_id: uuid(diaristaId) }, o);
      const caminho = `diaristas/${diaristaId}/${tipo}-${crypto.randomUUID()}.${EXT[mime]}`;
      const corpo = conteudo instanceof Blob ? conteudo : new Blob([conteudo], { type: mime });
      const tamanhoReal = corpo.size;
      if (tamanho !== undefined && tamanho !== tamanhoReal) throw new ErroNegocio('DADOS_INVALIDOS', 'Tamanho do arquivo não confere');
      // mesma validação do mock (tipo, tamanho, assinatura dos bytes); o servidor repete a assinatura na Edge Function (B6)
      const cabecalho = new Uint8Array(await corpo.slice(0, 8).arrayBuffer());
      const erro = validarArquivo({ nome: nomeArquivo, mime, tamanho: tamanhoReal, cabecalho });
      if (erro) throw new ErroNegocio('DADOS_INVALIDOS', erro, { arquivo: erro });
      const { error } = await sb.storage.from(BUCKET).upload(caminho, corpo, { contentType: mime, upsert: false });
      if (error) throw traduzir({ message: /row-level security|policy/i.test(error.message) ? 'ATOR_SEM_PERMISSAO' : error.message, details: 'Não deu pra enviar o arquivo. Tente de novo.' });
      return rpc('registrar_documento', { p_dados: { diaristaId, tipo, nomeArquivo, mime, tamanho: tamanhoReal, storagePath: caminho }, p_chave: o.chave ?? null }, o);
    },
    listarDocumentos: (id, o) => rpc('listar_documentos', { p_diarista: uuid(id) }, o, LER),
    /** URL assinada de 5 minutos (só a dona ou a Prime conseguem) e o conteúdo. */
    async obterArquivo(docId, o = {}) {
      const sb = await c(o);
      const d = await rpc('obter_documento', { p_id: uuid(docId) }, o, LER);
      const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(d.blobRef, 300);
      if (error) throw traduzir({ message: 'NAO_ENCONTRADO', details: 'Documento não encontrado' });
      const resp = await fetch(data.signedUrl);
      if (!resp.ok) throw new ErroNegocio('NAO_ENCONTRADO', 'Documento não encontrado');
      return { documento: d, conteudo: await resp.blob(), url: data.signedUrl };
    },
    cadastrarDiarista: (d, o) => rpc('cadastrar_diarista', { p_dados: d, p_chave: o?.chave ?? null }, o),
    obterDiarista: (id, o) => obter('obter_diarista', id, o),
    listarDiaristas: (f = {}, o) => rpc('listar_diaristas', { p_filtro: f }, o),
    aprovarDiarista: (id, d, o) => acao('aprovar_diarista', id, d, o),
    reprovarDiarista: (id, d, o) => acao('reprovar_diarista', id, d, o),
    criarAvaliacao: (id, d, o) => rpc('criar_avaliacao', { p_atendimento: uuid(id), p_dados: d ?? {}, p_chave: o?.chave ?? null }, o),
    obterAvaliacaoDoAtendimento: (id, o) => rpc('obter_avaliacao_do_atendimento', { p_atendimento: uuid(id) }, o, LER),
    listarNotificacoes: (f = {}, o) => rpc('listar_notificacoes', { p_filtro: f }, o),
    listarEventos: (f = {}, o) => rpc('listar_eventos', { p_filtro: f }, o),
    registrarContatoManual: (d, o) => rpc('registrar_contato_manual', { p_dados: d, p_chave: o?.chave ?? null }, o),
    listarAtendimentos: (f = {}, o) => rpc('listar_atendimentos', { p_filtro: f }, o),
    listarAtendimentosDaDiarista: (id, o) => rpc('listar_atendimentos_da_diarista', { p_diarista: uuid(id) }, o, LER),
    listarAvaliacoes: (f = {}, o) => rpc('listar_avaliacoes', { p_filtro: f }, o),
  };
}
