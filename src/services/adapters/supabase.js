// Adapter SUPABASE: cada caso de uso vira uma RPC (security definer) no Postgres; o banco decide preço, transição,
// permissão e idempotência. A sessão vem do JWT do usuário logado (src/services/auth.js): a opção `sessao` é ignorada
// aqui, exceto em testes, que passam `clientePara(sessao)` pra escolher o usuário fictício certo.
// Erros: o SQL levanta message = CÓDIGO (docs/API.md), details = mensagem, hint = detalhes JSON.
import { ErroNegocio, CODIGOS_ERRO } from '../../domain/modelo.js';
import { validarArquivo } from '../../domain/validacao.js';

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
export function criarAdapterSupabase({ cliente, clientePara, provaHumana = async () => ({}) }) {
  const c = (o = {}) => (clientePara ? clientePara(o.sessao) : cliente());

  async function rpc(nome, params, o, op) {
    const { data, error } = await (await c(o)).rpc(nome, params);
    if (error) throw traduzir(error, op);
    return data;
  }
  const LER = { semPermissao: 'NAO_ENCONTRADO' };
  const obter = (nome, id, o) => rpc(nome, { p_id: uuid(id) }, o, LER);
  const previasLocais = new Map();
  const usuarioAtual = async (o) => (await (await c(o)).auth.getSession()).data.session?.user?.id ?? null;

  /** Edge Function com o token da usuária; erro no formato { erro: { codigo, mensagem, detalhes } }. */
  async function funcao(nome, body, o) {
    const { data, error } = await (await c(o)).functions.invoke(nome, { body });
    if (!error) return data;
    let e = null;
    try { e = (await error.context?.json())?.erro; } catch { e = null; }
    if (e?.codigo === 'SESSAO_EXPIRADA' || (e && CODIGOS_ERRO.includes(e.codigo))) throw new ErroNegocio(e.codigo, e.mensagem, e.detalhes);
    if (!error.context) throw new ErroNegocio('SERVICO_INDISPONIVEL', 'Não conseguimos falar com o servidor. Tente de novo.');
    throw new ErroNegocio('ERRO_INTERNO', 'Não foi possível concluir. Tente de novo em instantes.');
  }
  const acao = (nome, id, dados, o) => rpc(nome, { p_id: uuid(id), p_dados: dados ?? {}, p_chave: o?.chave ?? null }, o);

  return {
    tipo: 'supabase',
    criarCliente: async () => { throw new ErroNegocio('ATOR_SEM_PERMISSAO', 'O cadastro da cliente nasce no agendamento'); },
    criarPedido: async () => { throw new ErroNegocio('ATOR_SEM_PERMISSAO', 'Use o agendamento'); },
    // agendamento v2: cotação pública; envio logado pela RPC, sem login pela function "conta" (resposta sempre igual)
    // RLS: a cliente só lê a própria linha
    obterMeuCadastro: async (o) => {
      const { data, error } = await (await c(o)).from('clientes').select('tipo, nome, telefone, email, tipo_documento, documento, razao_social, responsavel, endereco').maybeSingle();
      if (error) throw traduzir(error);
      if (!data) throw new ErroNegocio('ATOR_SEM_PERMISSAO', 'Entre na sua conta');
      return { tipo: data.tipo, nome: data.nome, telefone: data.telefone, email: data.email, endereco: data.endereco,
        ...(data.tipo_documento === 'cnpj' ? { cnpj: data.documento, razaoSocial: data.razao_social, responsavel: data.responsavel } : { cpf: data.documento }) };
    },
    cotarSolicitacao: (d, o) => rpc('cotar_solicitacao', { p_dados: { solicitacao: d.solicitacao, endereco: d.endereco ?? null } }, o),
    solicitarAtendimento: async (d, o) => {
      const dados = { solicitacao: d.solicitacao, endereco: d.endereco, aceiteCondicoes: d.aceiteCondicoes, valorEsperadoCentavos: d.valorEsperadoCentavos ?? null };
      if (await usuarioAtual(o)) return rpc('solicitar_atendimento', { p_dados: dados, p_chave: o?.chave ?? null }, o);
      return funcao('conta', { acao: 'solicitar', ...dados, cliente: d.cliente, aceite: d.aceite, marketing: d.marketing || [], chave: o?.chave ?? null, ...(await provaHumana()) }, o);
    },
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

    /**
     * Upload pela Edge Function "documentos" (B6): o bucket não aceita nada direto do navegador. Ela repete tipo, tamanho e
     * assinatura dos bytes, grava no caminho da dona e registra. A checagem daqui é só pra responder rápido.
     */
    async salvarDocumento({ diaristaId, tipo, nomeArquivo, mime, tamanho, conteudo }, o = {}) {
      if (!EXT[mime]) throw new ErroNegocio('DADOS_INVALIDOS', 'Formato não aceito: use JPG, PNG ou PDF', { arquivo: 'Formato não aceito: use JPG, PNG ou PDF' });
      const corpo = conteudo instanceof Blob ? conteudo : new Blob([conteudo], { type: mime });
      if (tamanho !== undefined && tamanho !== corpo.size) throw new ErroNegocio('DADOS_INVALIDOS', 'Tamanho do arquivo não confere');
      const cabecalho = new Uint8Array(await corpo.slice(0, 8).arrayBuffer());
      const erro = validarArquivo({ nome: nomeArquivo, mime, tamanho: corpo.size, cabecalho });
      if (erro) throw new ErroNegocio('DADOS_INVALIDOS', erro, { arquivo: erro });
      const form = new FormData();
      form.append('diaristaId', uuid(diaristaId));
      form.append('tipo', tipo);
      form.append('nomeArquivo', nomeArquivo);
      if (o.chave) form.append('chave', o.chave);
      form.append('arquivo', new File([corpo], nomeArquivo, { type: mime }));
      const doc = await funcao('documentos', form, o);
      // a dona não lê do bucket (só a Prime): a prévia desta página vem do arquivo escolhido, presa a quem enviou
      previasLocais.set(doc.id, { dono: await usuarioAtual(o), corpo });
      return doc;
    },
    listarDocumentos: (id, o) => rpc('listar_documentos', { p_diarista: uuid(id) }, o, LER),
    /** Só a Prime abre documento: a function registra o acesso e devolve URL assinada curta. */
    async obterArquivo(docId, o = {}) {
      const local = previasLocais.get(docId);
      if (local && local.dono && local.dono === (await usuarioAtual(o))) return { documento: null, conteudo: local.corpo };
      const r = await funcao('documentos', { acao: 'abrir', documentoId: uuid(docId) }, o);
      const resp = await fetch(r.url);
      if (!resp.ok) throw new ErroNegocio('NAO_ENCONTRADO', 'Documento não encontrado');
      return { documento: r.documento, conteudo: await resp.blob(), url: r.url };
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
    listarClientes: (f = {}, o) => rpc('listar_clientes', { p_filtro: f }, o),
    editarPrecos: (d, o) => rpc('editar_precos', { p_dados: d, p_chave: o?.chave ?? null }, o),
    listarPrecos: (o) => rpc('listar_precos', {}, o),
    editarHorariosTrabalho: (d, o) => rpc('editar_horarios_trabalho', { p_dados: d, p_chave: o?.chave ?? null }, o),
    reprocessarEvento: (id, o) => rpc('reprocessar_evento', { p_dados: { id: uuid(id) }, p_chave: o?.chave ?? null }, o),
    registrarContatoManual: (d, o) => rpc('registrar_contato_manual', { p_dados: d, p_chave: o?.chave ?? null }, o),
    listarAtendimentos: (f = {}, o) => rpc('listar_atendimentos', { p_filtro: f }, o),
    listarAtendimentosDaDiarista: (id, o) => rpc('listar_atendimentos_da_diarista', { p_diarista: uuid(id) }, o, LER),
    listarAvaliacoes: (f = {}, o) => rpc('listar_avaliacoes', { p_filtro: f }, o),
    // L1 (LGPD): o banco confere versão, titular e flags
    situacaoLegal: (o) => rpc('situacao_legal', {}, o),
    registrarAceite: (versao, o) => rpc('registrar_aceite', { p_versao: versao }, o),
    definirConsentimento: (tipo, concedido, o) => rpc('definir_consentimento', { p_tipo: tipo, p_concedido: !!concedido, p_origem: o?.origem || 'minha_conta' }, o),
    meusDados: (o) => rpc('meus_dados', {}, o),
    pedirExclusao: (motivo, o) => rpc('pedir_exclusao', { p_motivo: motivo || null }, o),
    listarPedidosTitular: (f = {}, o) => rpc('listar_pedidos_titular', { p_filtro: f }, o),
    recusarPedidoTitular: (id, resposta, o) => rpc('recusar_pedido_titular', { p_id: uuid(id), p_resposta: resposta }, o),
    listarFlags: (o) => rpc('listar_flags', {}, o),
    alternarFlag: (chave, ligada, o) => rpc('alternar_flag', { p_chave: chave, p_ligada: !!ligada }, o),
    // AUT: painel de automações
    listarRegrasAutomacao: (o) => rpc('listar_regras_automacao', {}, o),
    atualizarRegraAutomacao: (codigo, dados, o) => rpc('atualizar_regra_automacao', { p_codigo: codigo, p_dados: dados }, o),
    listarTemplates: (codigo, o) => rpc('listar_templates', { p_codigo: codigo }, o),
    salvarTemplate: ({ codigo, canal, corpo, assunto }, o) => rpc('salvar_template', { p_codigo: codigo, p_canal: canal, p_corpo: corpo, p_assunto: assunto ?? null }, o),
    restaurarTemplate: ({ codigo, canal, versao }, o) => rpc('restaurar_template', { p_codigo: codigo, p_canal: canal, p_versao: versao }, o),
    listarExecucoes: (f = {}, o) => rpc('listar_execucoes', { p_filtro: f }, o),
    acaoExecucao: (id, acao, o) => rpc('acao_execucao', { p_id: uuid(id), p_acao: acao, p_chave: o?.chave ?? null }, o),
    testarRegraAutomacao: (codigo, o) => rpc('testar_regra_automacao', { p_codigo: codigo }, o),
    metricasAutomacoes: (f = {}, o) => rpc('metricas_automacoes', { p_de: f.de ?? null, p_ate: f.ate ?? null }, o),
    saudeAutomacoes: (o) => rpc('saude_automacoes', {}, o),
    configurarAutomacoes: (valor, o) => rpc('configurar_automacoes', { p_valor: valor }, o),
    // P2: agenda por profissional, disponibilidade, bloqueios e sugestão
    agendaProfissionais: ({ de, ate }, o) => rpc('agenda_profissionais', { p_de: de, p_ate: ate }, o),
    definirDisponibilidade: (diaristaId, disp, o) => rpc('definir_disponibilidade', { p_diarista: uuid(diaristaId), p_disp: disp }, o),
    criarBloqueio: (diaristaId, dados, o) => rpc('criar_bloqueio', { p_diarista: uuid(diaristaId), p_dados: dados }, o),
    removerBloqueio: (id, o) => rpc('remover_bloqueio', { p_id: uuid(id) }, o),
    conflitosAtendimento: (id, dados, o) => rpc('conflitos_atendimento', { p_id: uuid(id), p_dados: dados }, o),
    sugerirProfissionais: (atendimentoId, o) => rpc('sugerir_profissionais', { p_atendimento: uuid(atendimentoId) }, o),
    // P3: hora extra, prazo vencido e recibo
    registrarHoraExtra: (atendimentoId, dados, o) => rpc('registrar_hora_extra', { p_atendimento: uuid(atendimentoId), p_dados: dados, p_chave: o?.chave ?? null }, o),
    decidirHoraExtra: (id, dados, o) => rpc('decidir_hora_extra', { p_id: uuid(id), p_dados: dados, p_chave: o?.chave ?? null }, o),
    listarHorasExtras: (f = {}, o) => rpc('listar_horas_extras', { p_filtro: f }, o),
    prorrogarPrazo: (pagamentoId, dados, o) => rpc('prorrogar_prazo', { p_pagamento: uuid(pagamentoId), p_dados: dados, p_chave: o?.chave ?? null }, o),
    liberarVaga: (pagamentoId, o) => rpc('liberar_vaga', { p_pagamento: uuid(pagamentoId), p_chave: o?.chave ?? null }, o),
    obterRecibo: (pagamentoId, o) => rpc('obter_recibo', { p_pagamento: uuid(pagamentoId) }, o, LER),
    // P4: check-in com localização, checklist e ocorrências
    registrarLocalizacao: (atendimentoId, dados, o) => rpc('registrar_localizacao', { p_atendimento: uuid(atendimentoId), p_dados: dados }, o),
    checkinsAtendimento: (id, o) => rpc('checkins_atendimento', { p_id: uuid(id) }, o, LER),
    checklistAtendimento: (id, o) => rpc('checklist_atendimento', { p_id: uuid(id) }, o, LER),
    registrarChecklist: (id, itens, o) => rpc('registrar_checklist', { p_atendimento: uuid(id), p_itens: itens, p_chave: o?.chave ?? null }, o),
    async listarChecklists(o) {
      const { data, error } = await (await c(o)).from('checklists').select('tipo_servico, itens');
      if (error) throw traduzir(error);
      return data.map((x) => ({ tipoServico: x.tipo_servico, itens: x.itens }));
    },
    salvarChecklist: (tipo, itens, o) => rpc('salvar_checklist', { p_tipo: tipo, p_itens: itens }, o),
    abrirOcorrencia: (atendimentoId, dados, o) => rpc('abrir_ocorrencia', { p_atendimento: uuid(atendimentoId), p_dados: dados, p_chave: o?.chave ?? null }, o),
    atualizarOcorrencia: (id, dados, o) => rpc('atualizar_ocorrencia', { p_id: uuid(id), p_dados: dados, p_chave: o?.chave ?? null }, o),
    listarOcorrencias: (f = {}, o) => rpc('listar_ocorrencias', { p_filtro: f }, o),
    /** Foto opcional da ocorrência pela function "documentos" (confere tipo, tamanho e os bytes de novo). */
    async enviarFotoOcorrencia(ocorrenciaId, arquivo, o = {}) {
      const cabecalho = new Uint8Array(await arquivo.slice(0, 8).arrayBuffer());
      const erro = validarArquivo({ nome: arquivo.name || 'foto', mime: arquivo.type, tamanho: arquivo.size, cabecalho })
        || (['image/jpeg', 'image/png'].includes(arquivo.type) ? null : 'Envie uma foto em JPG ou PNG');
      if (erro) throw new ErroNegocio('DADOS_INVALIDOS', erro, { foto: erro });
      const form = new FormData();
      form.append('ocorrenciaId', uuid(ocorrenciaId));
      form.append('arquivo', arquivo);
      return funcao('documentos?acao=foto_ocorrencia', form, o);
    },
    // P5: certidões e repasse
    documentosVencimento: (dias, o) => rpc('documentos_vencimento', { p_dias: dias ?? 30 }, o),
    repasseMes: (mes, o) => rpc('repasse_mes', { p_mes: mes }, o),
    fecharRepasse: (mes, o) => rpc('fechar_repasse', { p_mes: mes, p_chave: o?.chave ?? null }, o),
    salvarRegraRepasse: (regra, o) => rpc('salvar_regra_repasse', { p_regra: regra }, o),
    // P6: relacionamento e exportações
    listasRelacionamento: (o) => rpc('listas_relacionamento', {}, o),
    dadosRenovacao: (pedidoId, o) => rpc('dados_renovacao', { p_pedido: uuid(pedidoId) }, o, LER),
    exportar: (tipo, completo, o) => rpc('exportar', { p_tipo: tipo, p_completo: !!completo }, o),
    // P1 e O1: visão geral, busca e saúde
    indicadores: (de, ate, o) => rpc('indicadores', { p_de: de, p_ate: ate }, o),
    buscar: (termo, o) => rpc('buscar', { p_termo: termo }, o),
    saudeSistema: (o) => rpc('saude_sistema', {}, o),
    painelOperacao: (o) => rpc('painel_operacao', { p_dias: 7 }, o),
    abrirFotoOcorrencia: (id, o) => funcao('documentos', { acao: 'abrir_foto_ocorrencia', ocorrenciaId: uuid(id) }, o),
  };
}
