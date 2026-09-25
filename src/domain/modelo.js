// Modelo de dados. Cada typedef vira uma tabela no backend (ver docs/BACKEND.md). Dinheiro sempre em centavos inteiros.

/**
 * @typedef {Object} Endereco
 * @property {string} cep 8 dígitos
 * @property {string} logradouro
 * @property {string} numero
 * @property {string} [complemento]
 * @property {string} bairro
 * @property {string} cidade
 * @property {string} uf
 */

/**
 * @typedef {Object} Cliente
 * @property {string} id
 * @property {'residencial'|'empresa'} tipo
 * @property {string} nome
 * @property {string} telefone só dígitos com DDD
 * @property {string} email
 * @property {string} [cpf]
 * @property {string} [cnpj] 14 caracteres (numérico ou alfanumérico)
 * @property {string} [razaoSocial]
 * @property {string} [responsavel]
 * @property {Endereco} endereco
 * @property {string} criadoEm ISO 8601
 */

/**
 * @typedef {Object} Pacote
 * @property {string} tipoServico chave de PRECOS.tiposServico (residencial, empresarial, condominial, pre_pos_mudanca, pre_pos_evento, passadoria)
 * @property {2|4|6|8} duracaoHoras
 * @property {number} horasExtras
 * @property {number} [metragem] só recomenda a duração (obrigatória, exceto passadoria exclusiva)
 * @property {number} [pecas] passadoria exclusiva: volume de peças (recomendação)
 * @property {boolean} passadoriaCombinada adicional dentro da mesma carga horária
 * @property {boolean} semLocalAlmoco taxa
 * @property {number} quantidadeDiarias avulso = 1 sempre
 * @property {'avulso'|'semanal'|'quinzenal'|'mensal'} frequencia
 * @property {{codigo:string, descricao:string, centavos:number}[]} itensDia discriminação do preço-base do dia
 * @property {number} valorDiaBaseCentavos sem taxa de sábado/feriado
 * @property {number} taxaDeslocamentoCentavos
 * @property {number|null} recomendacaoHoras
 * @property {number} totalCentavos soma dos dias (com taxa de sábado/feriado) menos desconto mensal
 * @property {number} descontoMensalCentavos
 * @property {'por_diaria'|'pacote'} modoPagamento pagamento antecipado e integral: uma cobrança por diária ou uma pro pacote
 */

/**
 * @typedef {Object} Pedido
 * @property {string} id
 * @property {string} clienteId
 * @property {Pacote} pacote
 * @property {string[]} atendimentoIds
 * @property {'solicitado'|'disponibilidade_confirmada'|'aguardando_pagamento'|'confirmado'|'concluido'|'recusado'|'cancelado'} status
 * @property {string} [preferenciaProfissional] preferência opcional do cliente (não é garantia; a Prime vê no painel)
 * @property {{em:string, motivo:string, ator:string}} [recusa] quando a Prime não tem disponibilidade
 * @property {HistoricoItem[]} historico
 * @property {string} criadoEm
 */

/**
 * @typedef {Object} HistoricoItem
 * @property {string} de
 * @property {string} para
 * @property {string} evento
 * @property {string} em ISO 8601
 * @property {string} ator 'cliente'|'prime'|'diarista'|'sistema'
 */

/**
 * @typedef {Object} Atendimento
 * @property {string} id
 * @property {string} pedidoId
 * @property {number} sequencia 1..n
 * @property {string} data AAAA-MM-DD
 * @property {'manha'|'tarde'|'integral'} turno
 * @property {string} [diaristaId]
 * @property {'agendado'|'confirmado'|'diarista_a_caminho'|'em_andamento'|'finalizado'|'avaliado'|'cancelado'} status
 * @property {HistoricoItem[]} historico
 * @property {number} valorDiaCentavos base + taxa de sábado/feriado
 * @property {number} [taxaDiaCentavos]
 * @property {boolean} [deslocada] data movida por bloqueio
 * @property {number} versao incrementa a cada mudança (invalida eventos antigos)
 * @property {string} criadoEm
 */

/**
 * @typedef {Object} Pagamento
 * @property {string} id
 * @property {string} pedidoId
 * @property {string} [atendimentoId]
 * @property {'diaria'|'pacote'} parcela cobrança antecipada e integral (entrada/dia: só em registros antigos)
 * @property {number} valorCentavos
 * @property {number} [descontoCentavos] desconto mensal embutido nesta cobrança
 * @property {'pix'|'manual'} metodo
 * @property {string} pixTxid até 25 alfanuméricos, separado do id
 * @property {string|null} brcode null quando a config Pix está incompleta
 * @property {'pendente'|'informado_pelo_cliente'|'confirmado'|'cancelado'|'estornado'} status
 * @property {string} venceEm AAAA-MM-DD (dia útil anterior à diária)
 * @property {string} venceAs 'HH:MM' (14:00)
 * @property {{em:string, motivo:string, ator:string}} [estorno] registro manual da Prime
 * @property {string} [informadoEm]
 * @property {string} [confirmadoEm]
 * @property {string} chaveIdempotencia
 * @property {string} criadoEm
 */

/**
 * @typedef {Object} Diarista
 * @property {string} id
 * @property {string} nome
 * @property {string} cpf
 * @property {string} telefone
 * @property {string} email
 * @property {string} dataNascimento AAAA-MM-DD
 * @property {Endereco} endereco
 * @property {number} experienciaAnos
 * @property {{dias:number[], turnos:string[], regioes:string[]}} disponibilidade
 * @property {string[]} documentos ids de Documento
 * @property {'pendente'|'aprovada'|'reprovada'} status
 * @property {string} criadoEm
 */

/**
 * @typedef {Object} Documento
 * @property {string} id
 * @property {string} diaristaId
 * @property {'rg_frente'|'rg_verso'|'cnh_frente'|'cnh_verso'|'cpf'|'comprovante_residencia'|'foto_perfil'|'antecedentes'} tipo
 * @property {string} nomeArquivo
 * @property {string} mime
 * @property {number} tamanho bytes
 * @property {string} blobRef no mock: chave no store 'arquivos'; no backend: caminho no storage privado
 */

/**
 * @typedef {Object} Avaliacao
 * @property {string} id
 * @property {string} atendimentoId
 * @property {{pontualidade:number, qualidade:number, cuidado:number, comunicacao:number}} notas 1 a 5
 * @property {number} notaFinal média com 1 casa decimal
 * @property {string} comentario
 * @property {string} criadoEm
 */

/**
 * @typedef {Object} Notificacao
 * @property {string} id
 * @property {string} gatilho evento que originou
 * @property {'whatsapp'} canal
 * @property {{tipo:'cliente'|'diarista'|'prime', id:string, telefone:string}} destinatario
 * @property {string} template
 * @property {Object<string,string>} variaveis
 * @property {string} [agendadaPara] ISO 8601
 * @property {'pendente'|'simulada'|'enviada'|'erro'|'cancelada'} status
 * @property {string} [previa] texto renderizado (mock)
 * @property {{pedidoId?:string, atendimentoId?:string, diaristaId?:string, versao?:number}} refs
 * @property {string} chaveIdempotencia
 * @property {string} criadoEm
 */

export const TIPOS_DOCUMENTO = ['rg_frente', 'rg_verso', 'cnh_frente', 'cnh_verso', 'cpf', 'comprovante_residencia', 'foto_perfil', 'antecedentes'];
export const TURNOS = { manha: 'Manhã (início às 8h)', tarde: 'Tarde (início às 13h)', integral: 'Dia inteiro (8h às 17h)' };
export const FREQUENCIAS = { avulso: 'Avulso', semanal: 'Semanal', quinzenal: 'Quinzenal', mensal: 'Mensal' };

/** Erro de negócio com código estável (os mesmos códigos de docs/API.md). */
export class ErroNegocio extends Error {
  constructor(codigo, mensagem, detalhes) {
    super(mensagem || codigo);
    this.name = 'ErroNegocio';
    this.codigo = codigo;
    if (detalhes !== undefined) this.detalhes = detalhes;
  }
  toJSON() { return { codigo: this.codigo, mensagem: this.message, detalhes: this.detalhes }; }
}

export const CODIGOS_ERRO = [
  'DADOS_INVALIDOS', 'NAO_ENCONTRADO', 'EVENTO_INVALIDO', 'TRANSICAO_PROIBIDA', 'ATOR_SEM_PERMISSAO',
  'CONDICAO_NAO_ATENDIDA', 'CONFLITO_IDEMPOTENCIA', 'PAGAMENTO_NAO_ELEGIVEL', 'CONFIG_INCOMPLETA',
  'REGIAO_NAO_ATENDIDA', 'REGIAO_SOB_CONSULTA', 'DATA_INVALIDA', 'JA_AVALIADO', 'SERVICO_INDISPONIVEL', 'ERRO_INTERNO',
];
