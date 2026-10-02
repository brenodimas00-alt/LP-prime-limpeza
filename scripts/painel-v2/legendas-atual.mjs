// Legendas do painel-atual.pdf (português simples, pra cliente). Só dados fictícios do seed-local.
const A = (nome) => `docs/painel-v2/atual/1440-${nome}.png`;
const M = (nome) => `docs/painel-v2/atual/390-${nome}.png`;
export default {
  capa: {
    titulo: 'Painel da Prime: como está hoje',
    subtitulo: 'Todas as telas da área da equipe, fotografadas em 1º de outubro de 2026',
    linhas: [
      'Este PDF mostra o painel interno do jeito que ele está hoje, antes do redesenho. Serve pra gente olhar junto o que pesa, o que confunde e o que já funciona bem.',
      'Todos os nomes, telefones, endereços e valores são inventados (ambiente de teste, nenhum dado de cliente real).',
      'As telas de computador estão em 1440 px de largura. As quatro telas mais usadas aparecem também no celular (390 px) no fim.',
    ],
  },
  paginas: [
    { arquivo: A('entrar'), titulo: 'Entrar no painel', legenda: 'A porta de entrada da equipe: e-mail e senha. A mesma faixa azul-marinho e o mesmo cabeçalho do site aparecem em todas as telas internas.' },
    { arquivo: A('visao'), titulo: 'Visão geral', legenda: 'Primeira aba: busca de cliente, indicadores do período (solicitações, faturamento, recebido, vencidos, clientes novas, ticket médio) e a saúde do sistema. Os números aparecem em caixas de texto, sem gráfico, e o período começa só no dia de hoje.', notas: ['"Worker parado" e "nenhum backup" aparecem porque o ambiente de teste não tem o robô de mensagens nem o backup ligados.'] },
    { arquivo: A('solicitacoes'), titulo: 'Solicitações', legenda: 'Pedidos novos de diária esperando a Prime. Em cada cartão: serviço, local, contato, valor, datas com horário ajustável, campo de motivo e os botões "Confirmar disponibilidade" e "Recusar".' },
    { arquivo: A('solicitacoes-sugestoes'), titulo: 'Solicitações: sugestão de profissional', legenda: 'Ao abrir "Sugestões de profissional" numa data, o sistema lista quem está livre no horário, atende a região e quantas diárias já tem na semana; "Designar" atribui na hora.' },
    { arquivo: A('agenda'), titulo: 'Agenda', legenda: 'Semana por profissional, com a linha "Sem profissional" embaixo. Dá pra arrastar uma diária pra outro dia ou outra pessoa e ver só o dia de hoje.' },
    { arquivo: A('agenda-diaria'), titulo: 'Agenda: abrir uma diária', legenda: 'Clicando numa diária abre a janela com os dados, os check-ins e a opção de mudar data, horário ou profissional, mostrando os conflitos antes de salvar.' },
    { arquivo: A('atribuir'), titulo: 'Atribuir profissional', legenda: 'Todas as diárias futuras numa tabela só: as sem profissional primeiro, depois as já designadas (pra trocar). Cada linha tem uma lista de escolha e um botão.' },
    { arquivo: A('atribuir-sugestoes'), titulo: 'Atribuir: sugestões abertas', legenda: 'A mesma tabela com as sugestões de profissional abertas numa linha. A tabela fica longa porque mistura o que precisa de decisão com o que já está resolvido.' },
    { arquivo: A('pagamentos'), titulo: 'Pagamentos', legenda: 'Cobranças vencidas, horas extras pra aprovar, pagamentos informados pela cliente (pra conferir no extrato), ainda não pagos e recebidos, tudo numa página só, de cima pra baixo.' },
    { arquivo: A('pagamentos-aberto'), titulo: 'Pagamentos: estorno e prazo', legenda: 'As ações escondidas em "Registrar estorno" e "Dar mais prazo" abertas: o campo e o botão aparecem dentro da própria linha da tabela.' },
    { arquivo: A('clientes'), titulo: 'Clientes', legenda: 'Base de clientes com busca, filtro por pendência e acesso. As ações (completar e-mail, bloquear, redefinir senha) ficam dobradas em cada linha. Não existe uma ficha da cliente com o histórico dela.' },
    { arquivo: A('clientes-busca'), titulo: 'Clientes: resultado de busca', legenda: 'Busca por nome. O termo digitado fica na barra de endereço do navegador.' },
    { arquivo: A('ocorrencias'), titulo: 'Ocorrências', legenda: 'Reclamações abertas pela cliente depois da diária, com filtro por situação. Mudar a situação avisa a cliente no WhatsApp.' },
    { arquivo: A('cadastros'), titulo: 'Cadastros', legenda: 'Cadastro de profissional esperando aprovação (dados, documentos pra abrir, motivo e botões), a lista das profissionais, as certidões de antecedentes e o repasse do mês, tudo na mesma aba.' },
    { arquivo: A('notificacoes'), titulo: 'Automações', legenda: 'As 36 regras de mensagem automática (cliente, profissional, equipe e novidades) numa tabela com horário, canais, situação, contagem dos últimos 30 dias e botões "Testar", "Texto" e "Envios". É a tela mais densa do painel.' },
    { arquivo: A('notificacoes-linha'), titulo: 'Automações: linha do tempo de uma cliente', legenda: 'Tudo que o sistema mandou ou agendou pra uma cliente, em ordem. Hoje fica escondido dentro da aba Automações; o caminho é Clientes > "Mensagens".' },
    { arquivo: A('notificacoes-template'), titulo: 'Automações: texto de uma mensagem', legenda: 'Edição do texto de uma mensagem automática, com as variáveis permitidas, prévia com dados fictícios e histórico de versões.' },
    { arquivo: A('relacionamento'), titulo: 'Relacionamento', legenda: 'Listas de renovação (quem tem pacote vencendo) e reativação (quem sumiu), com consentimento de marketing, mais as planilhas pra exportar.' },
    { arquivo: A('avaliacoes'), titulo: 'Pesquisa de satisfação', legenda: 'Média por profissional e as últimas avaliações das clientes (notas de 1 a 5 e comentário). Só a Prime vê.' },
    { arquivo: A('precos'), titulo: 'Preços', legenda: 'Tabela de preços vigente (só a administração edita), horários de trabalho e as versões anteriores da tabela.' },
    { arquivo: A('privacidade'), titulo: 'Pedidos LGPD', legenda: 'Pedidos de exclusão de dados feitos pelas clientes em "Minha conta", com as ações de executar ou recusar.' },
    { arquivo: A('config'), titulo: 'Configurações', legenda: 'Opções que ligam e desligam partes do sistema (com registro de quem mudou) e os checklists que a profissional marca no fim da diária.' },
    { arquivo: A('ajuda'), titulo: 'Ajuda', legenda: 'Central de ajuda da equipe: passo a passo das tarefas do dia a dia com imagens de exemplo.' },
    { arquivo: M('solicitacoes'), titulo: 'Celular: Solicitações', legenda: 'No celular, a faixa azul, as seis caixas de contagem e as 16 abas ocupam a primeira tela inteira; a primeira solicitação só aparece depois de rolar.' },
    { arquivo: M('agenda'), titulo: 'Celular: Agenda', legenda: 'A grade da semana não cabe na tela: é preciso rolar pros lados pra ver os dias.' },
    { arquivo: M('atribuir'), titulo: 'Celular: Atribuir profissional', legenda: 'A tabela larga vira rolagem lateral; a lista de escolha e o botão ficam fora da área do polegar.' },
    { arquivo: M('pagamentos'), titulo: 'Celular: Pagamentos', legenda: 'Cinco blocos e três tabelas numa página só: conferir um Pix informado exige rolar muito e ler colunas cortadas.' },
  ],
};
