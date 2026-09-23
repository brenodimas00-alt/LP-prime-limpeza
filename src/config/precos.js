// TABELA OFICIAL DA PRIME (fonte: cliente, 23/09/2026, arquivo precos-prime.txt). Valores em centavos.
// O backend futuro recalcula o preço a partir desta mesma especificação. Itens marcados PENDÊNCIA estão em docs/PENDENCIAS.md.

export const PRECOS = {
  // A diária é vendida por DURAÇÃO. 2 horas só pra locais até 30 m².
  duracoes: {
    2: { centavos: 13800, metragemMaxima: 30 },
    4: { centavos: 17500 },
    6: { centavos: 20300 },
    8: { centavos: 22000 },
  },
  horaExtraCentavos: 3000,
  horasExtrasMaximo: 4,

  // Metragem só RECOMENDA a duração (a cliente pode escolher outra).
  metragem: { minimo: 10, maximo: 1000 },
  recomendacaoPorMetragem: [
    { ate: 50, horas: 4 },
    { ate: 80, horas: 6 },
    { ate: 120, horas: 8 },
  ], // acima de 120 m²: aviso "considere mais de uma profissional" + contato no WhatsApp
  avisoTempo: 'Vidros, geladeira, armários internos e revestimentos exigem mais tempo.',

  // Tipos de serviço (acréscimo por diária). Passadoria exclusiva usa a mesma tabela de horas.
  tiposServico: {
    residencial: { nome: 'Limpeza residencial', centavos: 0 },
    empresarial: { nome: 'Limpeza empresarial ou comercial', centavos: 1000 },
    condominial: { nome: 'Limpeza condominial', centavos: 1000 },
    pre_pos_mudanca: { nome: 'Pré ou pós-mudança', centavos: 2000 },
    pre_pos_evento: { nome: 'Pré ou pós-evento', centavos: 2000 },
    passadoria: { nome: 'Passadoria de roupas (serviço exclusivo)', centavos: 0, exclusivo: true },
  },
  naoOferecidos: { pos_obra: 'No momento não realizamos limpeza pós-obra.' },

  // Passadoria combinada com a limpeza: adicional dentro da mesma carga horária, só pra pouca demanda.
  passadoriaCombinada: { centavos: 5500, aviso: 'A passadoria combinada é para pouca demanda, dentro das mesmas horas da limpeza.' },
  // Passadoria exclusiva: recomendação de horas por volume de peças.
  recomendacaoPassadoria: [
    { ate: 15, horas: 2, descricao: 'até 15 peças básicas' },
    { ate: 25, horas: 4, descricao: 'até 25 peças básicas e sociais leves' },
    { ate: 40, horas: 6, descricao: 'até 40 peças mistas' },
    { ate: 60, horas: 8, descricao: 'até 60 peças ou peças sociais elaboradas' },
  ], // acima de 60: 8 horas ou mais
  avisoPassadoria: 'Peças delicadas ou muito amarrotadas exigem mais tempo.',

  // Taxas por diária.
  taxaSabadoFeriadoCentavos: 2000,
  taxaSemLocalAlmocoCentavos: 2500,

  // Desconto mensal por pedido, por mês de calendário.
  descontoMensal: [
    { minimoDiarias: 5, centavos: 4000 },
    { minimoDiarias: 3, centavos: 2000 },
  ],

  quantidadeDiarias: { minimo: 1, maximo: 12 },
};

// Como o restante (50%) é cobrado: 'por_atendimento' (padrão) ou 'no_primeiro'. PENDÊNCIA.
export const cobrancaRestante = 'por_atendimento';

// Prazo da parcela restante: 'no_dia' (regra do projeto: 50% no dia) ou 'dia_util_anterior_14h' (tabela da cliente:
// comprovante até 14h do dia útil anterior). PENDÊNCIA: conflito registrado em docs/PENDENCIAS.md.
export const prazoRestante = 'no_dia';

// Domingo bloqueado.
export const diasBloqueados = [0];

// Feriados nacionais e de BH (sábado ou feriado tem taxa; domingo continua bloqueado). PENDÊNCIA: conferir a lista anual.
export const feriados = [
  // 2026
  '2026-01-01', '2026-02-16', '2026-02-17', '2026-04-03', '2026-04-21', '2026-05-01', '2026-06-04', '2026-08-15', '2026-09-07',
  '2026-10-12', '2026-11-02', '2026-11-15', '2026-11-20', '2026-12-08', '2026-12-25',
  // 2027
  '2027-01-01', '2027-02-08', '2027-02-09', '2027-03-26', '2027-04-21', '2027-05-01', '2027-05-27', '2027-08-15', '2027-09-07',
  '2027-10-12', '2027-11-02', '2027-11-15', '2027-11-20', '2027-12-08', '2027-12-25',
];
// Datas em que a Prime não atende de jeito nenhum (além de domingo). Feriado NÃO bloqueia: cobra taxa.
export const datasBloqueadas = [];

export const regrasCalendario = {
  antecedenciaMinimaDias: 1,
  horizonteMaximoDias: 120,
  buscaDeslocamentoMaxDias: 7,
};

// Regiões e taxa de deslocamento por diária. 'sobConsulta' não calcula preço: leva pro WhatsApp.
export const regioesAtendidas = [
  { cidade: 'Belo Horizonte', uf: 'MG', taxaCentavos: 0 },
  { cidade: 'Contagem', uf: 'MG', taxaCentavos: 1000 },
  { cidade: 'Santa Luzia', uf: 'MG', taxaCentavos: 1000 },
  { cidade: 'Ribeirão das Neves', uf: 'MG', taxaCentavos: 1000 },
  { cidade: 'Sabará', uf: 'MG', taxaCentavos: 1000 },
  { cidade: 'Betim', uf: 'MG', taxaCentavos: 1500 },
  { cidade: 'Ibirité', uf: 'MG', taxaCentavos: 1500 },
  { cidade: 'Vespasiano', uf: 'MG', taxaCentavos: 1500 },
  { cidade: 'Nova Lima', uf: 'MG', sobConsulta: true },
];

// Regiões que a diarista pode marcar no cadastro (BH por regional + RMBH atendida).
export const regioesDiarista = [
  'BH - Centro-Sul', 'BH - Pampulha', 'BH - Oeste', 'BH - Barreiro', 'BH - Noroeste', 'BH - Norte',
  'BH - Nordeste', 'BH - Leste', 'BH - Venda Nova', 'Contagem', 'Santa Luzia', 'Ribeirão das Neves', 'Sabará',
  'Betim', 'Ibirité', 'Vespasiano', 'Nova Lima',
];

export const regrasNotificacao = {
  fuso: 'America/Sao_Paulo',
  horaLembreteVespera: 18,
  minutosAposFinalizado: 120,
};

export const CONFIG_PRECOS = {
  PRECOS, cobrancaRestante, prazoRestante, diasBloqueados, feriados, datasBloqueadas, regrasCalendario,
  regioesAtendidas, regioesDiarista, regrasNotificacao,
};
