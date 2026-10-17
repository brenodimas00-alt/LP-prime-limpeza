// Autoagendamento v3: textos LITERAIS da cliente (autoagendamento-v3-isa.txt, 56 itens, 06/10/2026) e o conteúdo padrão
// editável no painel (tipos de imóvel e "Ver mais" de cada serviço). Não reescrever os textos: a cliente pediu fidelidade.
// O "Ver mais" foi montado com as restrições do item 52 separadas por serviço (item 4): PENDÊNCIA, a cliente revisar.
// Sem emoji na interface (item 56): os do documento viram ícones (src/ui/icones.js).

/** Item 8: tipos do imóvel por segmento. "Outro" abre o campo curto. */
export const TIPOS_IMOVEL = {
  residencial: ['Apartamento', 'Casa', 'Cobertura', 'Flat', 'Kitnet', 'Loft', 'Condomínio residencial', 'Outro'],
  empresa: ['Escritório', 'Sala comercial', 'Loja', 'Consultório', 'Clínica', 'Academia', 'Escola', 'Restaurante', 'Salão de beleza',
    'Condomínio comercial', 'Prédio comercial', 'Galpão', 'Indústria', 'Instituição financeira', 'Hotel', 'Pousada', 'Espaço de eventos',
    'Quiosque', 'Coworking', 'Outro'],
};

const ALTURA = 'Por segurança, as profissionais não realizam atividades em alturas superiores a 2 metros.';
const MANGUEIRA = 'A lavagem de áreas externas somente poderá ser realizada quando houver mangueira disponível no local.';
const PRODUTOS = 'Os produtos, materiais, equipamentos e EPIs necessários ao atendimento deverão ser fornecidos pelo cliente.';

/**
 * Item 4: "Ver mais" de cada serviço, cadastrado separadamente (a Prime muda um sem mexer nos outros). naoInclui só com as
 * restrições pertinentes àquele serviço; a lista completa fica nos Termos e Condições do atendimento (item 52).
 */
export const VER_MAIS = {
  residencial: {
    naoInclui: ['lavagem de roupas, tapetes e sapatos', 'limpeza de piscina', 'jardinagem', 'limpeza de estofados', 'ventiladores de teto',
      'cortinas/persianas', 'cristaleiras', 'adegas', 'lustres', 'grelha de churrasqueira', 'remoção de fezes de animais',
      'tratamento/remoção de mofo', 'organização de guarda-roupas/closets', 'cozinhar e preparo de alimentos', 'remoção de cera'],
    observacoes: [ALTURA, MANGUEIRA, PRODUTOS],
  },
  empresarial: {
    naoInclui: ['limpeza de cozinha industrial', 'limpeza de estofados', 'cortinas/persianas', 'lustres', 'portões', 'remoção de cera',
      'transporte de objetos pesados', 'serviços que demandem equipamentos especiais', 'tratamento/remoção de mofo'],
    observacoes: [ALTURA, MANGUEIRA, PRODUTOS],
  },
  condominial: {
    naoInclui: ['limpeza de piscina', 'jardinagem', 'portões', 'lustres', 'remoção de cera', 'transporte de objetos pesados',
      'serviços que demandem equipamentos especiais'],
    observacoes: [ALTURA, MANGUEIRA, PRODUTOS],
  },
  pre_pos_mudanca: {
    naoInclui: ['limpeza pós-obra', 'transporte de objetos pesados', 'remoção de cera', 'tratamento/remoção de mofo', 'limpeza de estofados',
      'lustres', 'cortinas/persianas'],
    observacoes: [ALTURA, MANGUEIRA, PRODUTOS],
  },
  pre_pos_evento: {
    naoInclui: ['grelha de churrasqueira', 'limpeza de cozinha industrial', 'remoção de cera', 'transporte de objetos pesados',
      'limpeza de estofados', 'serviços que demandem equipamentos especiais'],
    observacoes: [ALTURA, MANGUEIRA, PRODUTOS],
  },
  passadoria: {
    naoInclui: ['lavagem de roupas'],
    observacoes: [
      'O ferro de passar, a tábua e demais equipamentos são fornecidos pelo cliente.',
      'A duração é uma estimativa e pode variar conforme a quantidade, o tipo e o estado das peças, além do equipamento disponível para a realização da passadoria.',
    ],
  },
};

/** Conteúdo padrão (o banco guarda a versão editada em configuracao 'agendamento'). */
export const CONTEUDO_AGENDAMENTO_PADRAO = { tiposImovel: TIPOS_IMOVEL, verMais: VER_MAIS };

/** Textos literais da cliente, na ordem do fluxo. */
export const T3 = {
  // itens 2 e 3
  titulo: 'Solicite seu |atendimento|',
  lead: 'Falta pouco para concluir sua solicitação.',
  etapas: ['Serviço', 'Identificação', 'Endereço', 'Características do local', 'Data e horário', 'Revisão'],
  tituloServico: 'O que você deseja contratar?',
  perguntaOnde: 'Onde será realizado o atendimento?',
  verMais: 'Ver mais',
  naoInclui: 'Não está incluído neste serviço',
  incluido: 'O que está incluído',
  termosCompletos: 'A relação completa de atividades que não fazem parte dos atendimentos está nos Termos e Condições do atendimento.',
  posObra: 'No momento não realizamos limpeza pós-obra.',
  // item 5
  tituloIdentificacao: 'Identificação',
  jaSouCliente: 'JÁ SOU CLIENTE',
  jaTenhoCadastro: 'Já tenho cadastro',
  naoSouCliente: 'AINDA NÃO SOU CLIENTE',
  quero: 'Quero me cadastrar',
  // item 6
  tituloCep: 'Informe o CEP do local do atendimento',
  subCep: 'Vamos verificar se atendemos sua região.',
  foraArea: 'No momento, não atendemos esta região.',
  foraAreaContato: 'Se quiser confirmar a possibilidade de atendimento para este endereço, entre em contato diretamente com a Prime.',
  falarComPrime: 'Falar com a Prime',
  adicionarEndereco: 'Adicionar novo endereço',
  // item 7
  tituloEndereco: 'Informe o endereço do atendimento',
  ajudaComplemento: 'Informe bloco, torre, andar, apartamento ou sala, se houver.',
  pontoReferencia: 'Ponto de referência',
  ajudaReferencia: 'O objetivo é facilitar a localização pela profissional.',
  tipoImovel: 'Tipo do imóvel',
  tipoImovelOutro: 'Informe o tipo do imóvel',
  // item 9
  usoEndereco: 'Como deseja utilizar este endereço?',
  salvar: 'SALVAR EM MEUS ENDEREÇOS',
  salvarSub: 'Este é um endereço que pretendo utilizar novamente.',
  unico: 'USAR SOMENTE NESTE ATENDIMENTO',
  unicoSub: 'Este endereço será utilizado apenas nesta solicitação e não ficará salvo em Meus Endereços.',
  apelido: 'Identificação do endereço (opcional)',
  apelidoAjuda: 'Dê um nome para identificar este endereço com facilidade.',
  apelidoEx: 'Ex.: Minha casa, Escritório, Galpão (bairro).',
  substituir: 'Substituir endereço',
  solicitarRemocao: 'Solicitar remoção',
  remocaoMensagem: (end) => `Olá! Gostaria de solicitar a remoção deste endereço do meu cadastro na Prime: ${end}.`,
  // item 10 a 17
  tituloLocal: 'Conte um pouco sobre o local',
  pecas: 'Quantas peças, mais ou menos?',
  tiposPecas: 'Quais tipos de peças predominam?',
  opcoesPecas: {
    basicas: ['Básicas e leves', 'Camisetas, bermudas e peças simples.'],
    roupas_cama: ['Roupas de cama', 'Lençóis, fronhas e peças similares.'],
    sociais: ['Sociais', 'Camisas, calças com vinco e peças que exigem mais atenção.'],
    delicadas: ['Delicadas ou tecidos difíceis', 'Linho, algodão puro, jeans grosso, vestidos e peças delicadas.'],
    mistas: ['Mistas', 'Quando houver diferentes tipos de peças.'],
  },
  passadoriaDividir: 'Pelas características e quantidade das peças, recomendamos mais tempo de passadoria. Considere dividir o atendimento em mais de uma diária.',
  passadoriaEstimativa: 'A duração é uma estimativa e pode variar conforme a quantidade, o tipo e o estado das peças, além do equipamento disponível para a realização da passadoria.',
  imovelEsta: 'O imóvel está:',
  mobiliado: { vazio: 'Vazio', parcial: 'Parcialmente mobiliado', mobiliado: 'Mobiliado' },
  condicaoMudanca: 'Como está a condição atual do imóvel?',
  opcoesCondicaoMudanca: {
    leve: ['Leve', 'Pouca sujeira e necessidade de limpeza geral.'],
    moderada: ['Moderada', 'Sujeira acumulada em diferentes ambientes e necessidade de maior detalhamento.'],
    intensa: ['Intensa', 'Maior acúmulo de sujeira e necessidade de atenção mais detalhada em diversos ambientes.'],
  },
  momentoEvento: 'O atendimento será realizado:',
  momentos: { antes: 'Antes do evento', depois: 'Após o evento' },
  metragemEspaco: 'Metragem aproximada do espaço',
  ambientesEvento: 'Quantidade aproximada de ambientes utilizados',
  condicaoEvento: 'Como você estima que estará o espaço após o evento?',
  opcoesCondicaoEvento: {
    leve: ['Leve', 'Organização e limpeza geral do espaço.'],
    moderado: ['Moderado', 'Resíduos e sujeira distribuídos em diferentes áreas.'],
    intenso: ['Intenso', 'Maior volume de resíduos e necessidade de limpeza mais detalhada.'],
  },
  metragem: 'Metragem aproximada (m²)',
  metragemAjuda: 'Não precisa ser exata. Uma estimativa aproximada já é suficiente.',
  aviso120: 'Para imóveis acima de 120 m², recomendamos mais de uma profissional para a realização das tarefas.',
  ambientes: { quartos: 'Quartos', banheiros: 'Banheiros', salas: 'Salas', cozinhas: 'Cozinhas', areaExterna: 'Área externa' },
  animais: 'Há animais no local?',
  animaisTipos: { caes: 'Cães', gatos: 'Gatos', outros: 'Outros animais' },
  animalQual: 'Qual?',
  refeicao: 'Há um local disponível para guardar e aquecer a refeição da profissional?',
  refeicaoNaoSub: 'Será aplicada taxa adicional de R$25,00.', // item 16: "Não" + esta frase (sem o travessão, barrado no verifica-texto)
  detalhadaTitulo: 'Precisa de uma limpeza mais detalhada?',
  detalhada: 'Locais que estão há mais tempo sem limpeza ou que exigem tarefas mais detalhadas podem precisar de mais tempo para a realização do serviço.',
  // itens 18 e 19
  sugestao: (h) => `Pelas informações do local, sugerimos uma diária de ${h} horas.`,
  sugestaoPassadoria: (h) => `Pelas informações das peças, sugerimos uma diária de ${h} horas.`,
  sugestaoAviso: 'Essa sugestão serve apenas como orientação para ajudar na escolha. A necessidade real pode variar conforme as características e as condições do local.',
  maisProfissionais: 'Pelas informações do local, recomendamos mais de uma profissional para a realização das tarefas.',
  duracao: 'Duração da diária',
  atencao: 'Atenção!',
  alertaMenor: 'A duração escolhida é menor que a sugerida para as características informadas do atendimento.',
  alertaPergunta: 'Existe alguma particularidade que explique a escolha de uma duração menor?',
  alertaEx: 'Ex.: desejo realizar o atendimento somente em alguns cômodos.',
  alertaCampo: 'Informe aqui, se necessário.',
  alertaReferencia: 'A duração sugerida é apenas uma referência e pode variar conforme as condições do local, as tarefas solicitadas e o ritmo de execução de cada profissional.',
  ciente: 'Estou ciente e quero continuar',
  // itens 21 e 22
  tituloModalidade: 'Como deseja contratar?',
  modalidades: {
    avulsa: { titulo: 'DIÁRIA AVULSA', sub: 'Uma diária em uma única data.', selo: null },
    multi_profissional: { titulo: 'MAIS DE UMA PROFISSIONAL NO MESMO DIA', sub: 'Escolha 2 ou mais profissionais para o mesmo dia. O valor é calculado por profissional.', selo: 'DESCONTO A PARTIR DE 3 PROFISSIONAIS' },
    pacote: { titulo: 'PACOTE DE DIÁRIAS', sub: 'Agende 2 ou mais datas de atendimento.', selo: 'DESCONTO A PARTIR DE 3 DIÁRIAS' },
  },
  infoModalidade: 'Informações da modalidade',
  infoPagamento: {
    avulsa: '100% antecipado e integral após confirmação.',
    multi_profissional: '100% antecipado e integral após confirmação.',
    pacote: '50% após a confirmação da contratação + 50% antes do início da segunda metade do pacote.',
  },
  infoPagamentoForma: 'Pagamento por PIX ou cartão de crédito, conforme a integração disponível.',
  infoDesconto: { multi_profissional: '2 profissionais: sem desconto. 3 ou 4: R$20 de desconto sobre o total. 5 ou mais: R$40 de desconto sobre o total.', pacote: '2 diárias: pacote sem desconto. 3 ou 4: R$20 de desconto. 5 ou mais: R$40 de desconto.' },
  // itens 23 a 26
  tituloDatas: 'Escolha as datas do atendimento',
  suasDatas: 'Suas datas',
  quantidadeDiarias: 'Quantidade de diárias',
  frequencia: 'Frequência',
  frequencias: { semanal: 'Semanal', quinzenal: 'Quinzenal', mensal: 'Mensal', datas: 'Datas avulsas' },
  alterarFrequencia: 'Alterar frequência?',
  alterarFrequenciaTexto: 'Ao alterar a frequência, as datas selecionadas serão removidas para que você faça uma nova configuração.',
  cancelar: 'Cancelar',
  alterar: 'Alterar',
  domingo: 'A Prime não realiza atendimentos aos domingos.',
  feriadoTaxa: 'Feriado: taxa adicional de R$20,00.',
  sabadoTaxa: 'Sábado: taxa adicional de R$20,00.',
  // itens 27 e 28
  horarioInicio: 'HORÁRIO DE INÍCIO',
  horarioComercial: 'Os atendimentos são realizados exclusivamente dentro do horário comercial.',
  hora: 'Hora',
  minutos: 'Minutos',
  manterHorario: 'Deseja manter este horário nas próximas diárias?',
  manterSim: 'Sim, manter o mesmo horário',
  manterNao: 'Não, escolher os horários individualmente',
  mesmoHorarioProf: 'Deseja utilizar este mesmo horário para as demais profissionais?',
  manterNaoProf: 'Não, definir individualmente',
  adicionarProfissional: '+ Adicionar profissional',
  novoEnderecoPacote: 'Novo endereço no pacote',
  novoEnderecoPacoteTexto: 'A utilização deste endereço ficará sujeita à validação da Prime antes da confirmação da solicitação.',
  // itens 29 a 33
  tituloCadastro: 'Seus dados',
  nomeCompleto: 'Nome completo',
  nomeErro: 'Informe seu nome completo.',
  cpfValido: 'CPF válido',
  cpfInvalido: 'CPF inválido. Confira o número informado.',
  menorIdade: 'É necessário ter 18 anos ou mais para realizar uma solicitação.',
  whatsappInvalido: 'Confira o número informado e tente novamente.',
  confirmeWhatsapp: 'Confirme seu WhatsApp',
  confirmeWhatsappTexto: 'É por este número que a Prime entrará em contato para confirmar o atendimento e enviar as orientações de pagamento.',
  confirmarNumero: 'Confirmar número',
  corrigir: 'Corrigir',
  // itens 35, 36, 47 a 51
  tituloRevisao: 'Revise sua solicitação',
  blocoResumo: 'Resumo do atendimento',
  blocoValores: 'Valores e pagamento',
  blocoFinalizacao: 'Finalização',
  cupomPergunta: 'Tem um cupom de desconto?',
  cupomCampo: 'Digite seu cupom',
  cupomAplicar: 'Aplicar',
  cupomOk: 'Cupom aplicado!',
  cupomErro: 'Cupom inválido ou indisponível.',
  origemPergunta: 'Como você conheceu a Prime?',
  origens: { indicacao: 'Indicação', instagram: 'Instagram', google: 'Google', whatsapp: 'WhatsApp', outro: 'Outro' },
  quemIndicou: 'Quem indicou a Prime?',
  pagamento: 'Pagamento',
  pagamentoTexto: 'Após a confirmação da disponibilidade pela Prime, você receberá pelo WhatsApp as orientações para realizar o pagamento de acordo com a modalidade escolhida.',
  pagamentoPacote: 'Para pacotes de diárias, o pagamento é realizado em duas etapas: 50% após a confirmação da contratação e 50% antes do início da segunda metade do pacote.',
  pagamentoPacote2: 'Após a confirmação da disponibilidade pela Prime, você receberá as orientações para pagamento.',
  pagamentoFaturamento: 'Esta contratação seguirá as condições de faturamento previamente acordadas com a Prime.',
  avisoFinal: 'Importante: o envio registra sua solicitação de atendimento. A Prime realizará a validação da disponibilidade para a data e o horário escolhidos e, em seguida, enviará as orientações de pagamento. A confirmação do atendimento ocorrerá após a validação da Prime e a identificação do pagamento.',
  // itens 52 a 55
  aceiteTitulo: 'Leia e aceite os Termos e Condições do atendimento',
  aceiteTexto: 'Este documento reúne as condições aplicáveis à sua solicitação. A leitura e o aceite são necessários para concluir.',
  lerTermos: 'Ler Termos e Condições',
  botaoFinal: 'ENVIAR SOLICITAÇÃO',
  recebida: 'Solicitação recebida!',
  numero: (n) => `Nº da solicitação: ${String(n).padStart(6, '0')}`,
  recebidaTexto: 'Agora a Prime verificará a disponibilidade e dará continuidade ao atendimento pelo WhatsApp.',
};
