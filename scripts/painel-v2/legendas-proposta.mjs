// Legendas do painel-proposta.pdf (português simples, pra cliente). Só dados fictícios.
const P = (nome) => `docs/painel-v2/proposta/1440-${nome}.png`;
const M = (nome) => `docs/painel-v2/proposta/390-${nome}.png`;
const A = (nome) => `docs/painel-v2/atual/1440-${nome}.png`;
export default {
  capa: {
    titulo: 'Painel da Prime: proposta do novo desenho',
    subtitulo: 'Protótipo pra avaliar antes de construir (1º de outubro de 2026)',
    linhas: [
      'Isto é um protótipo: telas montadas pra gente olhar junto e decidir. Nada aqui está no sistema ainda. Todos os nomes e valores são inventados.',
      'A ideia central: a primeira tela responde "o que precisa de mim agora?", cada número leva direto pra lista certa, o sistema faz o repetitivo e mostra o que já fez, e cada botão diz o que vai acontecer.',
      'Menu com 6 lugares (Início, Solicitações e agenda, Clientes, Profissionais, Financeiro, Configurações) e Ajuda. No celular, uma barra embaixo com os 4 principais.',
      'Primeiro as telas no computador (1440 px), depois no celular (390 px) e, no fim, cada tela "antes e depois" lado a lado.',
    ],
  },
  paginas: [
    { arquivo: P('index'), titulo: 'Início', legenda: 'Saudação, "Isso é o que precisa de você hoje" e seis cartões de contagem clicáveis, cada um com a próxima ação. Embaixo, o que o sistema já fez sozinho hoje, as diárias de hoje, os números do mês e quatro gráficos que respondem uma pergunta cada.' },
    { arquivo: P('solicitacoes'), titulo: 'Solicitações e agenda', legenda: 'Pedidos novos em cartões curtos, com a profissional livre já sugerida e três saídas: Confirmar disponibilidade, Recusar, Lembrar amanhã. O detalhe abre ao lado, sem sair da lista, e diz o que acontece ao confirmar.' },
    { arquivo: P('agenda'), titulo: 'Agenda da semana', legenda: 'Uma linha por profissional, uma coluna por dia, hoje em destaque. As diárias pagas sem profissional ficam numa bandeja em cima, com quem está livre. Clicar numa diária abre o detalhe e a remarcação, com aviso de conflito.' },
    { arquivo: P('cliente'), titulo: 'Ficha da cliente', legenda: 'Tudo de uma cliente num lugar só: contato com botão de WhatsApp, próxima diária, ações rápidas e a linha do tempo com pedidos, pagamentos, mensagens automáticas, ocorrências e acessos. "Tudo certo" quando não há pendência.' },
    { arquivo: P('financeiro'), titulo: 'Financeiro', legenda: 'Primeiro o que precisa de decisão (Pix informado pra conferir, vencido), depois o que vem e o que entrou. Botões com a consequência escrita. A tabela usa números alinhados e selos discretos; no celular vira cartões.' },
    { arquivo: P('profissionais'), titulo: 'Profissionais', legenda: 'Cadastro pra aprovar com os documentos à vista, depois a equipe com disponibilidade, validade da certidão (aviso 15 dias antes), diárias no mês e satisfação. Clicar numa linha abre disponibilidade, folgas e repasse.' },
    { arquivo: M('index-tela'), titulo: 'Celular: Início (primeira tela)', legenda: 'O que precisa de você aparece sem rolar. Barra fixa embaixo com Início, Agenda, Financeiro, Clientes e Mais.' },
    { arquivo: M('index'), titulo: 'Celular: Início (página inteira)', legenda: 'Os cartões, o que o sistema fez, as diárias de hoje, os números e os gráficos empilhados, tudo legível sem zoom.' },
    { arquivo: M('solicitacoes'), titulo: 'Celular: Solicitações', legenda: 'Cada pedido é um cartão com três campos e a ação ao alcance do polegar. O detalhe abre em tela cheia com "Voltar".' },
    { arquivo: M('agenda'), titulo: 'Celular: Agenda', legenda: 'No celular a grade vira lista por dia, sem rolagem lateral.' },
    { arquivo: M('financeiro'), titulo: 'Celular: Financeiro', legenda: 'Os cartões de decisão primeiro; a tabela vira cartões com nome, valor, situação e um botão.' },
    { arquivo: M('profissionais'), titulo: 'Celular: Profissionais', legenda: 'Cadastro pra aprovar e a equipe em cartões.' },
    { arquivo: A('visao'), depois: P('index'), titulo: 'Antes e depois: a primeira tela', legenda: 'Antes: faixa azul, seis caixas iguais, 16 abas e indicadores em texto. Depois: o que precisa de você, o que o sistema fez, hoje, números e gráficos.' },
    { arquivo: A('solicitacoes'), depois: P('solicitacoes'), titulo: 'Antes e depois: Solicitações', legenda: 'Antes: cartão longo com campo de motivo sempre visível e dois botões sem dizer o que acontece. Depois: cartão curto, sugestão de profissional, três saídas e o detalhe ao lado.' },
    { arquivo: A('agenda'), depois: P('agenda'), titulo: 'Antes e depois: Agenda', legenda: 'A grade por profissional já era boa; a proposta tira o peso em volta, põe a bandeja "sem profissional" em cima com quem está livre e os estados com ícone.' },
    { arquivo: A('clientes'), depois: P('cliente'), titulo: 'Antes e depois: Clientes', legenda: 'Antes: lista com ações dobradas e sem histórico (as mensagens ficam em Automações). Depois: ficha da cliente com linha do tempo única e ações rápidas.' },
    { arquivo: A('pagamentos'), depois: P('financeiro'), titulo: 'Antes e depois: Financeiro', legenda: 'Antes: cinco blocos e três tabelas de sete colunas de cima pra baixo. Depois: decisões primeiro, uma tabela filtrável e botões com a consequência.' },
    { arquivo: A('cadastros'), depois: P('profissionais'), titulo: 'Antes e depois: Profissionais', legenda: 'Antes: cadastro, lista, certidões e repasse empilhados, cada documento abrindo um por vez. Depois: cadastro com documentos à vista e a equipe numa tabela com validade e satisfação.' },
  ],
};
