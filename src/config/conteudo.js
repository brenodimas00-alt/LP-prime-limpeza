// Conteúdo informativo da Prime (fonte: cliente, 23/09/2026). Usado no autoagendamento e na home.
export const CONTEUDO = {
  material: 'O cliente fornece todos os produtos e equipamentos de limpeza, inclusive EPI quando necessário.',
  seguranca: [
    'As profissionais não sobem em alturas acima de 2 metros.',
    'Área externa só é lavada se houver mangueira no local.',
  ],
  naoRealizamos: [
    'lavagem de roupas, tapetes ou sapatos', 'piscina', 'jardinagem', 'estofados', 'ventilador de teto', 'cortinas e persianas',
    'cristaleiras', 'adegas', 'lustres', 'portões', 'grelha de churrasqueira', 'fezes de animais', 'mofo',
    'organização de guarda-roupa e closet', 'cozinhar ou preparar alimentos', 'manipulação de produtos químicos',
    'transporte de objetos pesados', 'serviços com equipamento especial', 'atendimento fora do horário comercial sem autorização',
  ],
  pagamento: 'Pagamento por Pix, transferência ou depósito. A Prime pede o comprovante até 14h do dia útil anterior à diária.',
  incluso: 'O valor já inclui transporte e alimentação da profissional em Belo Horizonte.',
  acimaDe120: 'Acima de 120 m², considere mais de uma profissional ou dividir o serviço em mais de um dia. Fale com a gente pra montar o melhor formato.',
};

// Textos pra cliente no fluxo novo (ajustes da cliente, 24/09/2026). Os marcados "literal" vêm de home-isa.txt sem mudança.
export const TEXTOS_CLIENTE = {
  leadAgendamento: 'Leva uns 3 minutos. Você envia a solicitação, a Prime verifica a disponibilidade e só depois vem a cobrança.',
  // literal (item 13)
  preferenciaTitulo: 'Tem preferência por alguma profissional?',
  preferenciaTexto: 'Você pode informar sua preferência durante o agendamento. A solicitação será considerada sempre que houver disponibilidade para a data, horário e região escolhidos.',
  // literal (item 4)
  imprevistoTitulo: 'Suporte em caso de imprevistos',
  imprevisto: [
    'Caso ocorra algum imprevisto com a profissional, a Prime verifica a possibilidade de substituição conforme a disponibilidade.',
    'Quando não houver possibilidade de substituição, o atendimento poderá ser remarcado ou o valor pago poderá ser estornado, conforme o caso.',
  ],
  // literal (item 3) + prazo da tabela oficial (precos-prime.txt)
  pagamentoAntecipado: 'O pagamento da diária é realizado antecipadamente e de forma integral.',
  formasPagamento: 'PIX • Transferência • Depósito',
  prazoPagamento: 'A Prime pede o comprovante até 14h do dia útil anterior à diária.',
  solicitacaoNaoEConfirmacao: 'Enviar a solicitação não confirma o atendimento: a Prime verifica a disponibilidade e responde pelo WhatsApp. A cobrança só vem depois disso.',
  // item 9 (a calculadora sugere carga horária; nunca promete concluir todas as tarefas)
  avisoCalculadora: 'A carga horária é uma sugestão: a quantidade de tarefas realizadas dependerá do tempo disponível, do tamanho e das condições do local e do nível de detalhamento solicitado.',
  // login (decisão da cliente em áudio)
  dicaLogin: 'Pelo e-mail ou celular, a senha são os 6 primeiros números do seu CPF. Pelo CPF, é a sua data de nascimento (só números).',
  dicaLoginEmpresa: 'Empresa: pelo e-mail ou celular, a senha são os 6 primeiros caracteres do CNPJ.',
  senhaPropria: 'Criou uma senha própria e não lembra?',
};
