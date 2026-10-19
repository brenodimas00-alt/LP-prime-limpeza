// Legendas do painel-novo.pdf (português simples, pra cliente). Telas da DEMONSTRAÇÃO: todos os nomes e valores são inventados.
const N = (nome) => `docs/painel-v2/novo/1440-${nome}.png`;
const M = (nome) => `docs/painel-v2/novo/390-${nome}.png`;
const A = (nome) => `docs/painel-v2/atual/1440-${nome}.png`;
export default {
  capa: {
    titulo: 'Painel da Prime: o painel novo',
    subtitulo: 'Etapa B construída a partir da referência da Isa (outubro de 2026)',
    linhas: [
      'Este é o painel novo funcionando, com dados de demonstração: todos os nomes, telefones, endereços e valores são inventados.',
      'A tela Início segue a imagem da Isa: solicitações novas com Aprovar, Recusar e Negociar data; diárias de hoje e de amanhã com a situação da escala; "Precisa de você" com o mais urgente em vermelho; stand-by, alertas, novos cadastros e três indicadores.',
      'Cada bloco abre e fecha, some quando não tem nada e carrega sozinho. As cores são sutis; só o urgente chama atenção.',
      'Aprovar uma solicitação é um clique a partir do Início. Recusar sempre pede o motivo, e o motivo vai pro gráfico.',
      'Primeiro as telas no computador (1440 px), depois no celular (390 px) e, no fim, antes e depois lado a lado.',
    ],
  },
  paginas: [
    { arquivo: N('inicio'), titulo: 'Início', legenda: 'A tela que abre. Em cima, as solicitações novas (as 4 mais próximas, com "Ver todas"). Depois as diárias de hoje e de amanhã, "Precisa de você" com filtros por tipo, stand-by, alertas, novos cadastros e os três indicadores: meta do mês, motivos de cancelamento e regiões.' },
    { arquivo: N('inicio-expandido'), titulo: 'Início: detalhe sem sair da tela', legenda: 'A seta abre o resto da solicitação (endereço, características, duração, como conheceu a Prime). "Sistema trabalhando por você" mostra as mensagens que saíram sozinhas hoje; as que falharam vão pra "Precisa de você".' },
    { arquivo: N('solicitacoes'), titulo: 'Solicitações', legenda: 'A lista completa, com os mesmos campos e botões do Início e filtros por situação, modalidade, origem e período.' },
    { arquivo: N('escala'), titulo: 'Agenda e escala: escala do dia', legenda: 'As diárias do dia escolhido e a situação da escala. Publicar avisa cada profissional pelo WhatsApp; só publica quando todas as diárias têm profissional.' },
    { arquivo: N('ficha'), titulo: 'Ficha da cliente', legenda: 'Aberta pela busca do topo: contato com WhatsApp, resumo (solicitações, diárias feitas, próxima, total pago) e a linha do tempo com solicitações, pagamentos, mensagens, ocorrências e acessos.' },
    { arquivo: N('profissionais'), titulo: 'Profissionais', legenda: 'A equipe com as habilidades em ícones, situação, quem está em stand-by hoje, diárias da semana e média das avaliações. Cadastros, documentos e avaliações continuam nas outras seções.' },
    { arquivo: N('financeiro'), titulo: 'Financeiro: adiantamentos e Uber', legenda: 'Pedidos de adiantamento e de reembolso de transporte, com aprovar e recusar (sempre com motivo). Pagamentos, vencidos, horas extras e recibos seguem na seção Pagamentos.' },
    { arquivo: N('motivos'), titulo: 'Gestão: motivos e meta', legenda: 'A administração escolhe os motivos de recusa e de cancelamento e a meta do mês (padrão: 10% a mais que o mês anterior).' },
    { arquivo: N('ajuda'), titulo: 'Ajuda', legenda: 'O passo a passo de cada tarefa, começando pelo Início, com imagens de exemplo. "Ver o tour de novo" refaz o passeio de 5 passos. O mesmo texto está no manual em Word.' },
    { arquivo: M('inicio-tela'), titulo: 'Celular: Início (primeira tela)', legenda: 'As solicitações novas logo em cima, com os botões ao alcance do polegar. Menu fixo embaixo: Início, Solicitações, Agenda, Clientes e Mais.' },
    { arquivo: M('inicio'), titulo: 'Celular: Início (página inteira)', legenda: 'Cada linha vira um cartão. Os indicadores começam fechados no celular, pra chegar mais rápido no que precisa de ação.' },
    { arquivo: M('solicitacoes'), titulo: 'Celular: Solicitações', legenda: 'Os mesmos botões, em cartões.' },
    { arquivo: M('mais'), titulo: 'Celular: "Mais"', legenda: 'Profissionais, Financeiro e Gestão ficam no "Mais".' },
    { arquivo: A('visao'), depois: N('inicio'), titulo: 'Antes e depois: a primeira tela', legenda: 'Antes: faixa azul, seis caixas iguais e 16 abas. Depois: o que precisa de você, com a ação ali mesmo.' },
    { arquivo: A('solicitacoes'), depois: N('solicitacoes'), titulo: 'Antes e depois: solicitações', legenda: 'Antes: cartão longo com o campo de motivo sempre aberto. Depois: uma linha por solicitação e o detalhe só quando precisa.' },
    { arquivo: A('pagamentos'), depois: N('financeiro'), titulo: 'Antes e depois: financeiro', legenda: 'Antes: cinco blocos de tabela. Depois: o que precisa de decisão aparece no Início; o Financeiro organiza o resto por assunto.' },
  ],
};
