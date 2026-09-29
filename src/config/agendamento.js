// Conteúdo do autoagendamento v2. Fontes: autoagendamento-isa.txt (títulos e textos LITERAIS da cliente), home-isa.txt
// (descrição curta de cada serviço, literal) e o sistema antigo da Prime (o autoagendamento do site atual da Prime,
// lido em 28/09/2026: listas do que está incluído em cada serviço). PENDÊNCIA: a cliente aprovar as listas (docs/PENDENCIAS.md).

/** Etapa 1: onde será realizada a limpeza (cards). */
export const ONDE = {
  residencial: { titulo: 'Residencial', sub: 'Casa ou apartamento' },
  empresa: { titulo: 'Empresarial', sub: 'Empresa ou escritório' },
};

/** Serviços: nome, descrição curta (card, literal da home) e "O que está incluído" (detalhes). */
export const SERVICOS_AGENDAMENTO = {
  residencial: {
    nome: 'Limpeza Residencial',
    descricao: 'Atendimento para casas e apartamentos, de acordo com a carga horária contratada e as prioridades do cliente.',
    incluido: [
      'Limpeza dos pisos e dos revestimentos de paredes',
      'Limpeza completa de banheiros',
      'Limpeza de espelhos e vidros',
      'Limpeza externa e interna de fogão (incluindo forno), micro-ondas e air fryer',
      'Organização de roupas expostas e arrumação de camas',
      'Limpeza interna de janelas',
      'Lavagem de louças',
      'Limpeza da superfície de móveis',
      'Limpeza externa e interna de geladeira',
      'Remoção do lixo',
      'Limpeza de portas',
      'Área externa: limpeza de pisos em garagem, quintal, varanda e terraço',
    ],
  },
  empresarial: {
    nome: 'Limpeza Empresarial e Comercial',
    descricao: 'Atendimento para empresas, escritórios, lojas e outros ambientes comerciais.',
    incluido: [
      'Remoção de poeira e limpeza de superfícies, mesas e balcões',
      'Desinfecção de áreas de contato frequente, como maçanetas e corrimãos',
      'Lavagem de pisos',
      'Limpeza de vidros, espelhos e janelas',
      'Higienização de banheiros',
      'Organização de áreas de trabalho',
      'Reposição de materiais de higiene',
      'Coleta e descarte do lixo',
    ],
  },
  condominial: {
    nome: 'Limpeza Condominial',
    descricao: 'Serviços direcionados às necessidades de limpeza e conservação de ambientes condominiais.',
    incluido: [
      'Varrer e lavar áreas comuns: corredores, halls, áreas de lazer e outros espaços compartilhados',
      'Limpeza de superfícies, escadas e elevadores',
      'Retirada e descarte do lixo',
      'Limpeza de portas, interfones e áreas de convivência',
    ],
  },
  pre_pos_mudanca: {
    nome: 'Limpeza Pré e Pós-Mudança',
    descricao: 'Para preparar o imóvel antes da mudança ou realizar a limpeza após a saída.',
    incluido: [
      'Pisos: varrição e lavagem',
      'Superfícies: bancadas, prateleiras e outras superfícies livres de poeira',
      'Vidros e janelas: limpeza interna',
      'Banheiros: higienização completa, com desinfecção de pias, vasos sanitários e chuveiros',
      'Cozinha: limpeza das áreas de preparo de alimentos, como bancadas e armários',
    ],
  },
  pre_pos_evento: {
    nome: 'Limpeza Pré e Pós-Eventos',
    descricao: 'Para preparar o ambiente antes do evento ou realizar a limpeza após sua realização.',
    incluido: ['PREENCHER: a Prime vai descrever o que está incluído neste serviço.'],
  },
  passadoria: {
    nome: 'Passadoria de Roupas',
    descricao: 'Serviço de passadoria realizado por carga horária, considerando a quantidade e as características das peças.',
    incluido: [
      'Passar as roupas separadas pelo cliente, dentro da carga horária contratada',
      'O ferro de passar e a tábua são fornecidos pelo cliente',
      'Não inclui limpeza: o atendimento é só de passadoria',
    ],
  },
};

/** Textos literais da cliente (autoagendamento-isa.txt). */
export const TEXTOS_AGENDAMENTO = {
  etapas: ['Serviço', 'Local', 'Características do local', 'Data e horário', 'Seus dados', 'Revisão'],
  tituloServico: 'O que você deseja contratar?',
  perguntaOnde: 'Onde será realizada a limpeza?',
  verDetalhes: 'Ver detalhes do serviço',
  tituloCep: 'Vamos verificar se atendemos sua região.',
  tituloEndereco: 'Onde será realizada a limpeza?',
  tituloLocal: 'Conte um pouco sobre o local',
  perguntaMetragem: 'Você sabe a metragem aproximada?',
  naoSeiMetragem: 'Não sei a metragem',
  tituloSugestao: 'Sugestão de duração',
  sugestao: (h) => `Pelas informações do local, sugerimos uma diária de ${h} horas.`,
  sugestaoAviso: 'Essa sugestão serve apenas como orientação para ajudar na escolha. A necessidade real pode variar conforme as características e as condições do local.',
  detalhadaTitulo: 'Precisa de uma limpeza mais detalhada?',
  detalhada: 'Locais que estão há mais tempo sem limpeza ou que exigem tarefas mais detalhadas podem precisar de mais tempo para a realização do serviço.',
  tituloQuantidade: 'Quantas diárias você deseja?',
  tituloComoAgendar: 'Como deseja agendar?',
  tituloDatas: 'Escolha as datas do atendimento',
  suasDatas: 'Suas datas',
  adicionarDiaria: 'Adicionar outra diária',
  tituloHorario: 'Qual horário você prefere?',
  tituloRepetir: 'Deseja manter este horário nas próximas diárias?',
  repetirSim: 'Sim, manter o mesmo horário',
  repetirNao: 'Não, escolher os horários individualmente',
  tituloDados: 'Seus dados',
  jaCliente: 'Já é cliente? Entrar',
  tituloRevisao: 'Revise sua solicitação',
  aceite: 'Li e concordo com as condições do atendimento.',
  avisoFinal: 'Importante: o envio da solicitação não confirma automaticamente o atendimento. A Prime verificará a disponibilidade e entrará em contato para confirmar o atendimento e o horário solicitado.',
  botaoFinal: 'ENVIAR SOLICITAÇÃO',
  enviadaTitulo: 'Solicitação enviada!',
  enviada: 'Recebemos sua solicitação. A Prime irá verificar a disponibilidade e entrar em contato para confirmar o atendimento e o horário solicitado.',
  enviadaWhatsApp: 'Acompanhe seu WhatsApp para receber o retorno da Prime.',
  enviadaAcesso: 'Para acompanhar pelo site, entre com seu e-mail ou celular e os 6 primeiros números do seu CPF.',
  // pagamento na revisão (item 22), curto e sem repetir o aviso final
  pagamento: 'Depois que a Prime confirmar a disponibilidade, você recebe as orientações de pagamento. O pagamento é antecipado e integral, por PIX, transferência ou depósito.',
  posObra: 'No momento não realizamos limpeza pós-obra.',
};
