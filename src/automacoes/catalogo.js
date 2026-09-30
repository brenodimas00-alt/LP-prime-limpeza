// AUT (fase 2): catálogo de automações como DADO. É a semente das tabelas automacao_regras e templates
// (scripts/gera-seed-automacoes.mjs) e o padrão do mock. No banco a Prime liga/desliga, muda horário/atraso dentro dos
// LIMITES e edita o texto dos templates (nova versão); a lógica de cada tipo de gatilho fica no motor (src/automacoes/v2).
//
// Regra: { codigo, template, descricao, categoria, destinatario, canais, gatilho, atraso, condicoes, cancelamento,
//          ligada, entidade, marco?, doDia?, validadeMin? }
//  - categoria: atendimento | lembrete | marketing | interno (limite diário e consentimento dependem dela)
//  - destinatario: cliente | diarista | diaristas_afetadas (anterior na troca, as dos cancelamentos) | equipe_prime
//  - gatilho: { tipo: 'evento', eventos: [...] } | { tipo: 'agenda' } (o atraso diz quando)
//  - atraso: imediato | apos{minutos} | vespera{hora} | antes_prazo{minutos[]} | prazo_vencido | apos_inicio_turno{minutos}
//            | diario{hora} | semanal{diaSemana,hora} | mensal{dia,hora} | aniversario{hora} | inatividade{dias,intervaloDias,hora}
//            | antes_vencimento_documento{dias[],hora}
//  - condicoes: predicados do motor (CONDICOES_PERMITIDAS), valem no planejamento E de novo no envio
//  - doDia: mensagem do atendimento em andamento no próprio dia (fura horário silencioso, domingo e feriado)
//  - cancelamento: eventos que cancelam as execuções agendadas da mesma entidade

export const CATEGORIAS = ['atendimento', 'lembrete', 'marketing', 'interno'];
export const CANAIS = ['whatsapp', 'email', 'painel'];
export const CONDICOES_PERMITIDAS = ['pedidoStatus', 'atendimentoStatus', 'pagamentoStatus', 'mesmaData', 'mesmaProfissional', 'mesmoPrazo', 'semAvaliacao', 'temCobranca', 'temProfissional'];

const EXTERNOS = ['whatsapp', 'email', 'painel'];
const INTERNO = ['painel'];
const MARKETING = ['whatsapp', 'email'];
const ev = (...eventos) => ({ tipo: 'evento', eventos });
const AGENDA = { tipo: 'agenda' };

export const REGRAS = [
  // ---------- cliente, atendimento ----------
  { codigo: 'C01', template: 'solicitacao_recebida', descricao: 'Solicitação recebida', categoria: 'atendimento', destinatario: 'cliente', canais: EXTERNOS, gatilho: ev('pedido_criado'), atraso: { tipo: 'imediato' }, entidade: 'pedido', ligada: true },
  { codigo: 'C02', template: 'disponibilidade_confirmada', descricao: 'Disponibilidade confirmada, com valor, formas e prazo de pagamento', categoria: 'atendimento', destinatario: 'cliente', canais: EXTERNOS, gatilho: ev('disponibilidade_confirmada'), atraso: { tipo: 'imediato' }, entidade: 'pedido', condicoes: { temCobranca: true, pedidoStatus: ['aguardando_pagamento', 'confirmado'] }, cancelamento: ['pedido_cancelado'], ligada: true },
  { codigo: 'C03', template: 'solicitacao_recusada', descricao: 'Solicitação recusada, com o motivo', categoria: 'atendimento', destinatario: 'cliente', canais: EXTERNOS, gatilho: ev('solicitacao_recusada'), atraso: { tipo: 'imediato' }, entidade: 'pedido', ligada: true },
  { codigo: 'C04', template: 'lembrete_prazo_pagamento', descricao: 'Lembrete do prazo de pagamento (24h e 3h antes)', categoria: 'lembrete', destinatario: 'cliente', canais: EXTERNOS, gatilho: AGENDA, atraso: { tipo: 'antes_prazo', minutos: [1440, 180] }, entidade: 'pagamento', condicoes: { pagamentoStatus: ['pendente'], pedidoStatus: ['aguardando_pagamento', 'confirmado'], mesmoPrazo: true }, cancelamento: ['pagamento_confirmado', 'pedido_cancelado', 'solicitacao_recusada', 'atendimento_cancelado'], ligada: true },
  { codigo: 'C05', template: 'pagamento_confirmado', descricao: 'Pagamento confirmado', categoria: 'atendimento', destinatario: 'cliente', canais: EXTERNOS, gatilho: ev('pagamento_confirmado'), atraso: { tipo: 'imediato' }, entidade: 'pagamento', ligada: true },
  { codigo: 'C06', template: 'lembrete_vespera', descricao: 'Lembrete da véspera', categoria: 'lembrete', destinatario: 'cliente', canais: EXTERNOS, gatilho: AGENDA, atraso: { tipo: 'vespera', hora: '18:00' }, entidade: 'atendimento', condicoes: { atendimentoStatus: ['confirmado'], mesmaData: true }, cancelamento: ['atendimento_cancelado', 'pedido_cancelado', 'atendimento_reagendado'], ligada: true },
  { codigo: 'C07', template: 'profissional_designada', descricao: 'Profissional designada ou trocada (primeiro nome)', categoria: 'atendimento', destinatario: 'cliente', canais: EXTERNOS, gatilho: ev('atendimento_atribuido'), atraso: { tipo: 'imediato' }, entidade: 'atendimento', condicoes: { atendimentoStatus: ['agendado', 'confirmado'], mesmaProfissional: true }, cancelamento: ['atendimento_cancelado', 'pedido_cancelado'], ligada: true },
  { codigo: 'C08', template: 'profissional_a_caminho', descricao: 'Profissional a caminho', categoria: 'atendimento', destinatario: 'cliente', canais: EXTERNOS, gatilho: ev('atendimento_diarista_a_caminho'), atraso: { tipo: 'imediato' }, entidade: 'atendimento', doDia: true, validadeMin: 180, ligada: true },
  { codigo: 'C09', template: 'atendimento_iniciado', descricao: 'Atendimento iniciado', categoria: 'atendimento', destinatario: 'cliente', canais: EXTERNOS, gatilho: ev('atendimento_em_andamento'), atraso: { tipo: 'imediato' }, entidade: 'atendimento', doDia: true, validadeMin: 180, ligada: true },
  { codigo: 'C10', template: 'atendimento_finalizado', descricao: 'Atendimento finalizado, com a pesquisa de satisfação', categoria: 'atendimento', destinatario: 'cliente', canais: EXTERNOS, gatilho: ev('atendimento_finalizado'), atraso: { tipo: 'imediato' }, entidade: 'atendimento', doDia: true, validadeMin: 720, ligada: true },
  { codigo: 'C11', template: 'lembrete_pesquisa', descricao: 'Lembrete da pesquisa (24h depois, uma vez)', categoria: 'lembrete', destinatario: 'cliente', canais: EXTERNOS, gatilho: ev('atendimento_finalizado'), atraso: { tipo: 'apos', minutos: 1440 }, entidade: 'atendimento', marco: 'unico', condicoes: { atendimentoStatus: ['finalizado'], semAvaliacao: true }, cancelamento: ['atendimento_avaliado'], ligada: true },
  { codigo: 'C12', template: 'remarcacao_confirmada', descricao: 'Remarcação confirmada', categoria: 'atendimento', destinatario: 'cliente', canais: EXTERNOS, gatilho: ev('atendimento_reagendado'), atraso: { tipo: 'imediato' }, entidade: 'atendimento', ligada: true },
  { codigo: 'C13', template: 'estorno_registrado', descricao: 'Estorno registrado', categoria: 'atendimento', destinatario: 'cliente', canais: EXTERNOS, gatilho: ev('estorno_registrado'), atraso: { tipo: 'imediato' }, entidade: 'pagamento', ligada: true },
  { codigo: 'C14', template: 'hora_extra_registrada', descricao: 'Hora extra aprovada, com valor e link (evento do bloco 3, P3)', categoria: 'atendimento', destinatario: 'cliente', canais: EXTERNOS, gatilho: ev('hora_extra_aprovada'), atraso: { tipo: 'imediato' }, entidade: 'atendimento', ligada: true },
  { codigo: 'C15', template: 'ocorrencia_atualizada', descricao: 'Ocorrência atualizada (evento do bloco 3, P4)', categoria: 'atendimento', destinatario: 'cliente', canais: EXTERNOS, gatilho: ev('ocorrencia_atualizada'), atraso: { tipo: 'imediato' }, entidade: 'atendimento', ligada: true },
  { codigo: 'C16', template: 'optout_confirmado', descricao: 'Confirmação única de que a pessoa saiu das mensagens de novidades', categoria: 'atendimento', destinatario: 'cliente', canais: ['whatsapp', 'email'], gatilho: ev('marketing_revogado'), atraso: { tipo: 'imediato' }, entidade: 'cliente', ligada: true },
  // ---------- cliente, relacionamento (marketing: só com consentimento; nascem DESLIGADAS) ----------
  { codigo: 'M01', template: 'renovacao_pacote', descricao: 'Renovação do pacote (dia 25)', categoria: 'marketing', destinatario: 'cliente', canais: MARKETING, gatilho: AGENDA, atraso: { tipo: 'mensal', dia: 25, hora: '09:00' }, entidade: 'cliente', ligada: false },
  { codigo: 'M02', template: 'reativacao', descricao: 'Reativação: sem diária há 60 dias (no máximo a cada 90)', categoria: 'marketing', destinatario: 'cliente', canais: MARKETING, gatilho: AGENDA, atraso: { tipo: 'inatividade', dias: 60, intervaloDias: 90, hora: '09:00' }, entidade: 'cliente', ligada: false },
  { codigo: 'M03', template: 'aniversario_cliente', descricao: 'Aniversário da cliente, 9h', categoria: 'marketing', destinatario: 'cliente', canais: MARKETING, gatilho: AGENDA, atraso: { tipo: 'aniversario', hora: '09:00' }, entidade: 'cliente', ligada: false },
  // ---------- profissional ----------
  { codigo: 'D01', template: 'cadastro_recebido', descricao: 'Cadastro recebido', categoria: 'atendimento', destinatario: 'diarista', canais: EXTERNOS, gatilho: ev('diarista_cadastrada'), atraso: { tipo: 'imediato' }, entidade: 'diarista', ligada: true },
  { codigo: 'D02', template: 'cadastro_aprovado', descricao: 'Cadastro aprovado', categoria: 'atendimento', destinatario: 'diarista', canais: EXTERNOS, gatilho: ev('diarista_aprovada'), atraso: { tipo: 'imediato' }, entidade: 'diarista', ligada: true },
  { codigo: 'D03', template: 'cadastro_reprovado', descricao: 'Cadastro reprovado (sem expor o motivo interno)', categoria: 'atendimento', destinatario: 'diarista', canais: EXTERNOS, gatilho: ev('diarista_reprovada'), atraso: { tipo: 'imediato' }, entidade: 'diarista', ligada: true },
  { codigo: 'D04', template: 'diaria_designada', descricao: 'Diária designada, com endereço completo (só com o atendimento confirmado)', categoria: 'atendimento', destinatario: 'diarista', canais: EXTERNOS, gatilho: ev('atendimento_atribuido', 'pagamento_confirmado'), atraso: { tipo: 'imediato' }, entidade: 'atendimento', marco: 'designacao', condicoes: { atendimentoStatus: ['confirmado'], mesmaProfissional: true }, cancelamento: ['atendimento_cancelado', 'pedido_cancelado'], ligada: true },
  { codigo: 'D05', template: 'lembrete_vespera_profissional', descricao: 'Lembrete da véspera (profissional), 17h', categoria: 'lembrete', destinatario: 'diarista', canais: EXTERNOS, gatilho: AGENDA, atraso: { tipo: 'vespera', hora: '17:00' }, entidade: 'atendimento', condicoes: { atendimentoStatus: ['confirmado'], mesmaData: true, mesmaProfissional: true }, cancelamento: ['atendimento_cancelado', 'pedido_cancelado', 'atendimento_reagendado'], ligada: true },
  { codigo: 'D06', template: 'lembrete_checkin', descricao: 'Sem check-in 30 minutos depois do horário de início', categoria: 'atendimento', destinatario: 'diarista', canais: EXTERNOS, gatilho: AGENDA, atraso: { tipo: 'apos_inicio_turno', minutos: 30 }, entidade: 'atendimento', doDia: true, condicoes: { atendimentoStatus: ['confirmado'], mesmaData: true, mesmaProfissional: true }, ligada: true },
  { codigo: 'D07', template: 'documento_vencendo', descricao: 'Documento vencendo em 15 e 3 dias (validade do bloco 3, P5)', categoria: 'lembrete', destinatario: 'diarista', canais: EXTERNOS, gatilho: AGENDA, atraso: { tipo: 'antes_vencimento_documento', dias: [15, 3], hora: '09:00' }, entidade: 'documento', ligada: true },
  { codigo: 'D08', template: 'diaria_cancelada_ou_remarcada', descricao: 'Diária cancelada, remarcada ou trocada de profissional', categoria: 'atendimento', destinatario: 'diaristas_afetadas', canais: EXTERNOS, gatilho: ev('atendimento_cancelado', 'atendimento_reagendado', 'pedido_cancelado', 'atendimento_atribuido'), atraso: { tipo: 'imediato' }, entidade: 'atendimento', ligada: true },
  // ---------- equipe Prime (interno: painel; e-mail/WhatsApp da equipe quando existir) ----------
  { codigo: 'I01', template: 'nova_solicitacao', descricao: 'Nova solicitação', categoria: 'interno', destinatario: 'equipe_prime', canais: INTERNO, gatilho: ev('pedido_criado'), atraso: { tipo: 'imediato' }, entidade: 'pedido', ligada: true },
  { codigo: 'I02', template: 'pagamento_informado', descricao: 'Cliente avisou que pagou: conferir', categoria: 'interno', destinatario: 'equipe_prime', canais: INTERNO, gatilho: ev('pagamento_informado'), atraso: { tipo: 'imediato' }, entidade: 'pagamento', ligada: true },
  { codigo: 'I03', template: 'checkin_atrasado', descricao: 'Check-in atrasado (30 minutos depois do início)', categoria: 'interno', destinatario: 'equipe_prime', canais: INTERNO, gatilho: AGENDA, atraso: { tipo: 'apos_inicio_turno', minutos: 30 }, entidade: 'atendimento', condicoes: { atendimentoStatus: ['confirmado'], mesmaData: true }, ligada: true },
  { codigo: 'I04', template: 'pagamento_vencido', descricao: 'Prazo de pagamento vencido: liberar vaga ou dar prazo', categoria: 'interno', destinatario: 'equipe_prime', canais: INTERNO, gatilho: AGENDA, atraso: { tipo: 'prazo_vencido' }, entidade: 'pagamento', condicoes: { pagamentoStatus: ['pendente'], mesmoPrazo: true }, cancelamento: ['pagamento_confirmado', 'pedido_cancelado'], ligada: true },
  { codigo: 'I05', template: 'ocorrencia_aberta', descricao: 'Ocorrência aberta pela cliente (evento do bloco 3, P4)', categoria: 'interno', destinatario: 'equipe_prime', canais: INTERNO, gatilho: ev('ocorrencia_aberta'), atraso: { tipo: 'imediato' }, entidade: 'atendimento', ligada: true },
  { codigo: 'I06', template: 'resumo_diario', descricao: 'Resumo do dia, 7h', categoria: 'interno', destinatario: 'equipe_prime', canais: INTERNO, gatilho: AGENDA, atraso: { tipo: 'diario', hora: '07:00' }, entidade: 'dia', ligada: true },
  { codigo: 'I07', template: 'resumo_semanal', descricao: 'Resumo da semana, segunda 8h', categoria: 'interno', destinatario: 'equipe_prime', canais: INTERNO, gatilho: AGENDA, atraso: { tipo: 'semanal', diaSemana: 1, hora: '08:00' }, entidade: 'dia', ligada: true },
  { codigo: 'I08', template: 'falha_envio', descricao: 'Envio que falhou de vez', categoria: 'interno', destinatario: 'equipe_prime', canais: INTERNO, gatilho: ev('envio_falhou'), atraso: { tipo: 'imediato' }, entidade: 'execucao', ligada: true },
  { codigo: 'I09', template: 'mensagem_recebida', descricao: 'Mensagem recebida no WhatsApp da Prime (responder pela equipe)', categoria: 'interno', destinatario: 'equipe_prime', canais: INTERNO, gatilho: ev('mensagem_recebida'), atraso: { tipo: 'imediato' }, entidade: 'conversa', ligada: true },
  { codigo: 'I10', template: 'erro_sistema', descricao: 'Erro novo no sistema ou worker parado (O1)', categoria: 'interno', destinatario: 'equipe_prime', canais: INTERNO, gatilho: ev('erro_sistema'), atraso: { tipo: 'imediato' }, entidade: 'erro', ligada: true },
];

/** Limites de edição pelo painel (o banco confere de novo). */
export const LIMITES = {
  hora: { min: '06:00', max: '21:00' },
  apos: { min: 60, max: 4320 },
  antes_prazo: { min: 30, max: 2880 },
  apos_inicio_turno: { min: 10, max: 180 },
  inatividade: { dias: [30, 365], intervaloDias: [30, 365] },
  mensal: { dia: [1, 28] },
  antes_vencimento_documento: { dias: [1, 60] },
};

// ---------- templates ----------
// Variáveis por NOME ({{nome}}), com o exemplo usado na prévia e no pedido de aprovação da Meta. Pro WhatsApp oficial
// o corpo vira {{1}}, {{2}}... na ordem em que as variáveis aparecem (paraMeta).
const V = {
  nome: 'Ana', resumo: '1 diária em 05/10/2026', link: 'https://primelimpezaespecializada.com.br/acompanhamento/?pedido=exemplo',
  valor: 'R$ 175,00', prazo: '14h de sex, 02/10', motivo: 'sem profissional livre no período da manhã', oque: 'R$ 175,00 da diária de 05/10/2026',
  quando: 'amanhã, 05/10/2026,', horario: 'das 08:30 às 12:30', carga: '4 horas', profissional: 'Maria', data: '05/10/2026',
  horas: '1 hora', estado: 'em análise', endereco: 'Rua Exemplo, 100, Savassi, Belo Horizonte', documento: 'certidão de antecedentes',
  dias: '15', cliente: 'Ana Souza', telefone: '(31) 9****-7777', total: '3', diarias: '6', pendencias: '2', checkins: '4', ocorrencias: '0',
  semana: '28/09 a 04/10', solicitacoes: '12', recusas: '1', recebido: 'R$ 2.100,00', regra: 'C06 Lembrete da véspera', erro: 'telefone inválido',
  texto: 'Oi, quero mudar o horário', mes: 'novembro', origem: 'site (página de pagamento)',
};
const T = (categoriaMeta, corpo, assunto) => ({ categoriaMeta, corpo, assunto });

export const TEMPLATES = {
  solicitacao_recebida: T('UTILITY', 'Oi, {{nome}}! Recebemos sua solicitação de atendimento na Prime: {{resumo}}. A solicitação ainda não é a confirmação: agora a Prime verifica a disponibilidade e responde por aqui. Você acompanha em {{link}}\nQualquer dúvida, é só responder.', 'Recebemos sua solicitação'),
  disponibilidade_confirmada: T('UTILITY', 'Oi, {{nome}}! A Prime confirmou a disponibilidade para {{resumo}}. O valor total é {{total}}. Para confirmar, faça o pagamento antecipado de {{valor}} por PIX, transferência ou depósito até {{prazo}} e envie o comprovante. Detalhes e link de pagamento: {{link}}\nDúvidas? É só responder.', 'Disponibilidade confirmada: falta o pagamento'),
  solicitacao_recusada: T('UTILITY', 'Oi, {{nome}}. Verificamos sua solicitação para {{resumo}} e, desta vez, não temos disponibilidade. Motivo: {{motivo}}. Se quiser, responda esta mensagem e a Prime ajuda a encontrar outra data.', 'Sobre a sua solicitação'),
  lembrete_prazo_pagamento: T('UTILITY', 'Oi, {{nome}}. Lembrete da Prime: o pagamento antecipado de {{valor}}, da diária de {{data}}, vence {{prazo}}. Os detalhes estão em {{link}}\nSe já pagou, pode desconsiderar esta mensagem.', 'Lembrete do prazo de pagamento'),
  pagamento_confirmado: T('UTILITY', 'Oi, {{nome}}! A Prime confirmou o pagamento de {{oque}}. Seu atendimento está confirmado. Acompanhe em {{link}}\nNa véspera, a gente te lembra por aqui.', 'Pagamento confirmado'),
  lembrete_vespera: T('UTILITY', 'Oi, {{nome}}! Passando pra lembrar: {{quando}} tem atendimento da Prime {{horario}}, com {{carga}}. O material de limpeza é seu; para área externa, deixe uma mangueira disponível. Se precisar mudar algo, responda esta mensagem.', 'Lembrete do seu atendimento Prime'),
  profissional_designada: T('UTILITY', 'Oi, {{nome}}. A profissional designada pela Prime para a diária de {{data}} é {{profissional}}. Qualquer dúvida, responda esta mensagem.', 'Profissional designada'),
  profissional_a_caminho: T('UTILITY', 'Oi, {{nome}}. A profissional designada pela Prime, {{profissional}}, já está a caminho do seu endereço. Qualquer imprevisto, responda esta mensagem.', 'A profissional está a caminho'),
  atendimento_iniciado: T('UTILITY', 'Oi, {{nome}}! A profissional {{profissional}} chegou e começou o atendimento de hoje. A Prime avisa quando terminar.', 'Atendimento iniciado'),
  atendimento_finalizado: T('UTILITY', 'Oi, {{nome}}. O atendimento de hoje terminou. Pode responder a pesquisa de satisfação da Prime? Sua resposta vai direto para a equipe da Prime: {{link}}\nObrigada!', 'Como foi o atendimento?'),
  lembrete_pesquisa: T('UTILITY', 'Oi, {{nome}}. Ainda dá tempo de responder a pesquisa sobre o atendimento de {{data}}. Leva menos de um minuto: {{link}}\nObrigada!', 'Sua opinião sobre o atendimento'),
  remarcacao_confirmada: T('UTILITY', 'Oi, {{nome}}. Seu atendimento foi remarcado para {{quando}}, {{horario}}. Se precisar de outro ajuste, responda esta mensagem.', 'Atendimento remarcado'),
  estorno_registrado: T('UTILITY', 'Oi, {{nome}}. A Prime registrou o estorno de {{valor}} ({{oque}}). Se tiver qualquer dúvida, responda esta mensagem.', 'Estorno registrado'),
  hora_extra_registrada: T('UTILITY', 'Oi, {{nome}}. A Prime registrou {{horas}} de hora extra na diária de {{data}}, no valor de {{valor}}. O pagamento está em {{link}}\nDúvidas? É só responder.', 'Hora extra registrada'),
  ocorrencia_atualizada: T('UTILITY', 'Oi, {{nome}}. O chamado sobre a diária de {{data}} está {{estado}}. Acompanhe em {{link}}\nSe quiser acrescentar algo, é só responder.', 'Seu chamado foi atualizado'),
  optout_confirmado: T('UTILITY', 'Oi, {{nome}}. Pronto: você não vai mais receber mensagens de novidades da Prime por este canal. As mensagens do seu atendimento continuam normalmente.', 'Você saiu das mensagens de novidades'),
  renovacao_pacote: T('MARKETING', 'Oi, {{nome}}! Quer manter as mesmas diárias em {{mes}}? A solicitação já vem preenchida com as datas do seu pacote: {{link}}\nSe não quiser mais receber estas mensagens, responda SAIR.', 'Renove o seu pacote'),
  reativacao: T('MARKETING', 'Oi, {{nome}}! Faz um tempo desde a sua última diária com a Prime. Quando precisar, é só solicitar por {{link}}\nSe não quiser mais receber estas mensagens, responda SAIR.', 'A Prime está por aqui'),
  aniversario_cliente: T('MARKETING', 'Feliz aniversário, {{nome}}! A equipe da Prime deseja um dia muito especial para você.\nSe não quiser mais receber estas mensagens, responda SAIR.', 'Feliz aniversário'),
  cadastro_recebido: T('UTILITY', 'Oi, {{nome}}! Recebemos seu cadastro na Prime. Vamos analisar seus documentos e responder por aqui em até {{dias}} dias úteis.', 'Recebemos seu cadastro'),
  cadastro_aprovado: T('UTILITY', 'Parabéns, {{nome}}! Seu cadastro na Prime foi aprovado. As próximas diárias chegam por aqui.', 'Cadastro aprovado'),
  cadastro_reprovado: T('UTILITY', 'Oi, {{nome}}. Analisamos seu cadastro e, por enquanto, não conseguimos seguir. Se quiser conversar sobre isso, responda esta mensagem.', 'Sobre o seu cadastro'),
  diaria_designada: T('UTILITY', 'Oi, {{nome}}! Você tem uma diária confirmada: {{data}}, {{horario}}. Endereço: {{endereco}}. Qualquer dúvida, responda esta mensagem.', 'Nova diária confirmada'),
  lembrete_vespera_profissional: T('UTILITY', 'Oi, {{nome}}. Lembrete: {{quando}} você tem diária {{horario}}. Endereço: {{endereco}}. Bom trabalho!', 'Lembrete da sua próxima diária'),
  lembrete_checkin: T('UTILITY', 'Oi, {{nome}}. A diária de hoje, {{horario}}, ainda está sem check-in. Se já chegou, avise pela sua agenda; se teve imprevisto, responda esta mensagem.', 'Check-in da diária de hoje'),
  documento_vencendo: T('UTILITY', 'Oi, {{nome}}. Seu documento {{documento}} vence em {{dias}} dias. Envie a versão atualizada pelo seu cadastro para continuar recebendo diárias.', 'Documento vencendo'),
  diaria_cancelada_ou_remarcada: T('UTILITY', 'Oi, {{nome}}. A diária de {{data}}, {{horario}}, {{oque}} e saiu da sua agenda. Qualquer dúvida, responda esta mensagem.', 'Mudança na sua agenda'),
  nova_solicitacao: T(null, 'Nova solicitação de {{cliente}}: {{resumo}}. Verificar a disponibilidade.'),
  pagamento_informado: T(null, '{{cliente}} avisou que pagou {{valor}} ({{oque}}). Conferir o extrato e confirmar.'),
  checkin_atrasado: T(null, 'Diária de {{cliente}} ({{horario}}) sem check-in da profissional {{profissional}}. Falar com ela.'),
  pagamento_vencido: T(null, 'O prazo de pagamento de {{cliente}} ({{valor}}, diária de {{data}}) venceu. Decidir: liberar a vaga ou dar mais prazo.'),
  ocorrencia_aberta: T(null, '{{cliente}} abriu uma ocorrência sobre a diária de {{data}}. Analisar o chamado.'),
  resumo_diario: T(null, 'Hoje: {{diarias}} diárias, {{checkins}} check-ins esperados, {{pendencias}} pagamentos pendentes e {{ocorrencias}} ocorrências abertas.'),
  resumo_semanal: T(null, 'Semana {{semana}}: {{solicitacoes}} solicitações, {{recusas}} recusas, {{diarias}} diárias realizadas e {{recebido}} recebidos.'),
  falha_envio: T(null, 'Não foi possível enviar {{regra}} para {{cliente}} ({{telefone}}): {{erro}}. Fazer o contato manualmente.'),
  mensagem_recebida: T(null, 'Mensagem de {{cliente}} ({{telefone}}) no WhatsApp: {{texto}}'),
  erro_sistema: T(null, 'Erro novo no sistema ({{origem}}): {{erro}}. Detalhes em Visão geral, Saúde do sistema.'),
};
for (const t of Object.values(TEMPLATES)) {
  t.variaveis = [...new Set([...t.corpo.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))];
  t.exemplo = Object.fromEntries(t.variaveis.map((v) => [v, V[v]]));
}

/** Variáveis que o motor sabe preencher pra cada template (o editor do painel só aceita estas). */
export const VARIAVEIS_PERMITIDAS = Object.fromEntries(Object.entries(TEMPLATES).map(([k, t]) => [k, [...t.variaveis]]));
export const EXEMPLOS = V;

/** Corpo com variáveis nomeadas -> formato da Meta ({{1}}, {{2}}...) e a ordem das variáveis. */
export function paraMeta(corpo) {
  const ordem = [];
  const texto = corpo.replace(/\{\{(\w+)\}\}/g, (_, v) => { if (!ordem.includes(v)) ordem.push(v); return `{{${ordem.indexOf(v) + 1}}}`; });
  return { texto, ordem };
}

/** Problemas de um corpo de template (editor do painel e verifica-templates). Vazio = ok. */
export function validarCorpo(codigoTemplate, corpo, canal = 'whatsapp') {
  const erros = [];
  const permitidas = VARIAVEIS_PERMITIDAS[codigoTemplate];
  if (!permitidas) return ['template desconhecido'];
  const s = String(corpo ?? '');
  if (s.trim().length < 10) erros.push('texto curto demais');
  if (s.length > 1024) erros.push('texto com mais de 1.024 caracteres');
  for (const m of s.matchAll(/\{\{([^}]*)\}\}/g)) if (!permitidas.includes(m[1])) erros.push(`variável não permitida: {{${m[1]}}}`);
  if (/\{\{|\}\}/.test(s.replace(/\{\{\w+\}\}/g, ''))) erros.push('chaves soltas: use {{variavel}}');
  if (canal === 'whatsapp') {
    if (/^\s*\{\{/.test(s)) erros.push('não pode começar com variável (regra da Meta)');
    if (/\{\{\w+\}\}\s*[.!?]?\s*$/.test(s)) erros.push('não pode terminar com variável (regra da Meta)');
    if (/\{\{\w+\}\}\s*\{\{/.test(s)) erros.push('duas variáveis seguidas (regra da Meta)');
    if (/\*/.test(s)) erros.push('sem asterisco');
  }
  return erros;
}
