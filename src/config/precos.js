// TABELA DE PREÇOS PROVISÓRIA. Todos os valores são em centavos e PRECISAM ser confirmados com a cliente
// (ver docs/PENDENCIAS.md). O backend futuro recalcula o preço a partir desta mesma especificação.

export const PRECOS = {
  // Valor base de UMA diária por faixa de metragem (m², limite superior inclusivo).
  faixasMetragem: [
    { ate: 60, centavos: 18000 },
    { ate: 120, centavos: 24000 },
    { ate: 250, centavos: 32000 }, // acima de 120 m² a home indica 2 profissionais ou dividir em dias
  ],
  // Alternativa por cômodos: base + valor por cômodo.
  comodos: { baseCentavos: 9000, porComodoCentavos: 2500, minimo: 1, maximo: 12 },
  metragem: { minimo: 10, maximo: 250 },

  // Multiplicador do tipo de limpeza, em pontos percentuais (100 = preço base).
  tiposLimpeza: {
    padrao: { nome: 'Limpeza padrão', percentual: 100 },
    pesada: { nome: 'Limpeza pesada', percentual: 140 },
    pre_pos_mudanca: { nome: 'Pré ou pós-mudança', percentual: 150 },
    pre_pos_evento: { nome: 'Pré ou pós-evento', percentual: 130 },
    passadoria: { nome: 'Passadoria de roupas', percentual: 80 },
  },

  // Acréscimo por diária para empresa (percentual sobre o base do dia).
  acrescimoEmpresaPercentual: 15,

  // Adicionais cobrados por diária.
  adicionais: {
    geladeira: { nome: 'Limpeza interna de geladeira', centavos: 3000 },
    forno: { nome: 'Limpeza interna de forno', centavos: 2500 },
    armarios: { nome: 'Armários por dentro', centavos: 4000 },
    janelas: { nome: 'Janelas e vidros (até 2,5 m)', centavos: 4000 },
    passar_roupa: { nome: 'Passar roupas (até 2 h)', centavos: 5000 },
  },

  // Desconto por frequência (percentual sobre o subtotal do dia).
  descontoFrequenciaPercentual: { avulso: 0, semanal: 10, quinzenal: 5, mensal: 0 },

  // Quantidade de diárias permitida por pedido recorrente.
  quantidadeDiarias: { minimo: 1, maximo: 12 },
};

// Como o restante (50%) é cobrado: 'por_atendimento' (padrão) ou 'no_primeiro'. PENDÊNCIA: confirmar com a cliente.
export const cobrancaRestante = 'por_atendimento';

// Dias da semana bloqueados (0 = domingo ... 6 = sábado). Padrão: domingo.
export const diasBloqueados = [0];

// Datas específicas bloqueadas (feriados etc.), 'AAAA-MM-DD'.
export const datasBloqueadas = [];

// Regras de calendário.
export const regrasCalendario = {
  antecedenciaMinimaDias: 1, // primeira diária no mínimo amanhã
  horizonteMaximoDias: 120, // primeira diária no máximo em 120 dias
  buscaDeslocamentoMaxDias: 7, // procura o próximo dia permitido por até 7 dias
};

// Regiões atendidas: cidade (como vem do ViaCEP) + taxa de deslocamento por diária.
export const regioesAtendidas = [
  { cidade: 'Belo Horizonte', uf: 'MG', taxaCentavos: 0 },
  { cidade: 'Nova Lima', uf: 'MG', taxaCentavos: 2000 },
  { cidade: 'Contagem', uf: 'MG', taxaCentavos: 1500 },
  { cidade: 'Betim', uf: 'MG', taxaCentavos: 2500 },
  { cidade: 'Sabará', uf: 'MG', taxaCentavos: 2000 },
  { cidade: 'Santa Luzia', uf: 'MG', taxaCentavos: 2000 },
  { cidade: 'Ribeirão das Neves', uf: 'MG', taxaCentavos: 2500 },
  { cidade: 'Vespasiano', uf: 'MG', taxaCentavos: 2500 },
  { cidade: 'Lagoa Santa', uf: 'MG', taxaCentavos: 3000 },
  { cidade: 'Ibirité', uf: 'MG', taxaCentavos: 2500 },
];

// Regiões que a diarista pode marcar no cadastro (BH por regional + RMBH).
export const regioesDiarista = [
  'BH - Centro-Sul', 'BH - Pampulha', 'BH - Oeste', 'BH - Barreiro', 'BH - Noroeste', 'BH - Norte',
  'BH - Nordeste', 'BH - Leste', 'BH - Venda Nova', 'Nova Lima', 'Contagem', 'Betim', 'Sabará',
  'Santa Luzia', 'Ribeirão das Neves', 'Vespasiano', 'Lagoa Santa', 'Ibirité',
];

// Horário do lembrete e atraso da cobrança do dia (America/Sao_Paulo).
export const regrasNotificacao = {
  fuso: 'America/Sao_Paulo',
  horaLembreteVespera: 18,
  minutosAposFinalizado: 120,
};

export const CONFIG_PRECOS = {
  PRECOS, cobrancaRestante, diasBloqueados, datasBloqueadas, regrasCalendario,
  regioesAtendidas, regioesDiarista, regrasNotificacao,
};
