# Painel v2, etapa A: inventário e auditoria de UX do painel atual (01/10/2026)

Base: `painel-atual.pdf` (28 páginas, fotografado contra um Supabase local com as migrations do repo e o seed fictício de
`scripts/painel-v2/seed-local.mjs`; nenhum dado da base real). Resumo em `docs/DECISOES.md`.

## 1. Inventário: 16 abas, uma por entrega

| Aba | O que tem | Veio de |
|---|---|---|
| Visão geral | busca mascarada, indicadores do período (12 caixas de texto), saúde do sistema, funil, erros | P1, O1 |
| Solicitações | cartões com confirmar/recusar, horário por diária, sugestões de profissional | B3, v2, P2 |
| Agenda | semana por profissional, arrastar, diálogo da diária, disponibilidade e folgas | P2 |
| Atribuir profissional | tabela de TODAS as diárias futuras (sem e com profissional), select + sugestões | B3, P2 |
| Pagamentos | vencidos, horas extras, informados, não pagos, recebidos (5 blocos, 3 tabelas de 7 colunas) | B3, P3 |
| Clientes | base com filtros, ações dobradas por linha (e-mail, bloquear, senha), link "Mensagens" | B7, F2 |
| Ocorrências | lista com filtro de situação, select + comentário + Salvar | P4 |
| Cadastros | cadastro pendente (docs), lista de diaristas, certidões, repasse | B2, P5 |
| Automações | 36 regras em tabela, testar/texto/envios; sub-telas: template, envios, linha do tempo | AUT |
| Relacionamento | renovação, reativação, planilhas | P6 |
| Pesquisa de satisfação | média por profissional, últimas avaliações (8 colunas) | B3 |
| Preços | tabela vigente, horários de trabalho, versões | F2, v2 |
| Pedidos LGPD | exclusão de dados | L1 |
| Configurações | flags do sistema, checklists | L1, P4 |
| Ajuda | passo a passo com prints | D1 |
| (Entrar) | e-mail e senha | A0 |

Toda tela repete: cabeçalho do site (menu público + "Agendar minha limpeza"), faixa azul-marinho de 260 px com título
"Operação do dia" e um resumo em texto, seis caixas azuis de contagem (as mesmas em todas as abas), as 16 abas e o rodapé
completo do site. No celular isso ocupa a primeira tela inteira antes de qualquer conteúdo.

## 2. Tarefas diárias: cliques e telas hoje (a partir da tela que abre, Solicitações)

| Tarefa | Caminho hoje | Cliques | Telas | Onde pesa |
|---|---|---|---|---|
| Confirmar disponibilidade | cartão > "Confirmar disponibilidade" | 1 | 1 | o cartão mistura ajuste de horário, campo de motivo da recusa e dois botões; sem dizer o que acontece depois |
| Designar profissional | aba Atribuir > "Sugestões" > "Designar" (ou select + Atribuir) | 3 | 2 | a tabela lista 21 diárias, 16 delas de pedidos ainda nem confirmados; a sugestão fica dobrada |
| Confirmar um pagamento | aba Pagamentos > rolar 2 blocos > "Confirmar recebimento" | 2 | 2 | o bloco "Informados" é o 3º da página; "txid" na frente do botão |
| Vencido: liberar vaga ou dar prazo | aba Pagamentos > "Liberar vaga" / "Dar mais prazo" > data > hora > "Salvar prazo" | 2 ou 5 | 2 | prazo sem sugestão (digitar data e hora) |
| Remarcar | aba Agenda > diária > data > hora > "Confirmar mudança" | 5 | 2 + diálogo | diálogo denso; ou arrastar, que ninguém descobre sozinho |
| Tratar ocorrência | aba Ocorrências > select situação > opção > "Salvar" | 4 | 2 | "Salvar" não diz que avisa a cliente; "Em análise" e "Resolvido" só no select |
| Achar cliente por nome ou telefone | Visão geral > Buscar (resultado mascarado, sem ficha) ou Clientes > Filtrar > "Mensagens" | 2 a 3 | 2 a 3 | duas buscas diferentes; não existe ficha da cliente; o histórico fica em Automações |
| Ver o dia de hoje | aba Agenda > "Ver só o dia" | 2 | 2 | a abertura mostra só contagens, não as diárias de hoje |
| Aprovar cadastro de profissional | aba Cadastros > "Ver" (x5) > "Aprovar cadastro" | 2 a 7 | 2 | cada documento abre um por vez; motivo de reprovação sempre visível |

## 3. O que pesa o olhar

- Fundos fortes: três bandas escuras por tela (cabeçalho, faixa azul, rodapé) mais seis caixas azul-marinho com número dourado em gradiente; o conteúdo útil começa a 560 px do topo no computador e a 1.100 px no celular.
- Cores simultâneas: azul-marinho, dourado em gradiente (botão primário, barra dos cartões, rótulos), creme, verde, vermelho, cinza, mais o azul-claro dos links: 7 cores na mesma tela de Pagamentos.
- Bordas e sombras: cartão com sombra forte + barra dourada de 5 px; tabelas com linha em toda célula; caixas com borda em volta de cada documento; botões com três estilos (gradiente, contorno azul, contorno vermelho) lado a lado.
- Densidade: Automações com 36 linhas e 5 colunas de texto pequeno; Atribuir com 21 linhas; Pagamentos com 23 linhas em 3 tabelas; nada dobrado por prioridade.
- Tipografia: 6 tamanhos por tela (2,7 rem no título, 1,8 nos números, 1,4 nos h2, 0,95 no corpo, 0,9 no "mudo", 0,74 em caixa alta com espaçamento), 3 pesos; rótulos em CAIXA ALTA com letter-spacing em tabelas, dl e selos.
- Ícones: quase não há; o triângulo "▶ Sugestões de profissional" e o "+" do bloco informativo não explicam nada.
- Tabelas largas: 7 colunas em Pagamentos, 6 em Atribuir, 8 em Pesquisa; no celular viram rolagem lateral.
- Textos longos: cada bloco tem um parágrafo cinza de 2 linhas explicando regras ("Pagamento antecipado e integral de cada diária. Confira o extrato...") que ninguém lê na terceira vez e a novata não entende na primeira.
- Jargão: "txid", "WORKER PARADO", "Motor", "Eventos com erro", "Resposta da pesquisa", "Pedidos LGPD", códigos C01..M03, "flags", "idempotente" na Ajuda, "AGUARDANDO CONFIRMAÇÃO" (de quê?).
- Estados sem hierarquia: as seis caixas têm o mesmo peso ("Semana 10" vale o mesmo que "Pagamentos a confirmar 1"); "16 sem profissional" soma diárias de pedidos ainda não confirmados (assusta e não é pra agir); vencido e ocorrência parada não aparecem na abertura.
- Informação repetida: o resumo da faixa azul diz exatamente o que as seis caixas dizem; as 16 abas aparecem em toda tela; o cabeçalho e o rodapé do site (menu público, Instagram, horário de atendimento) em todas as telas internas.

## 4. Teste do novato (lendo só a tela atual)

- Confirmar disponibilidade: entende "Confirmar disponibilidade" mas não sabe se precisa mexer no horário nem o que acontece depois (a cobrança nasce e a cliente recebe WhatsApp: está no parágrafo cinza, que ela não leu). Trava no campo "Motivo (obrigatório pra recusar...)" sem saber se precisa preencher.
- Designar: não sabe se vai em "Agenda" ou em "Atribuir profissional" (os dois têm "Sem profissional"). Em Atribuir, vê 21 linhas iguais e não sabe por onde começar; não percebe que "▶ Sugestões" abre algo.
- Confirmar pagamento: abre Pagamentos e a primeira coisa é "Prazo vencido (0)" e "Horas extras"; rola até "Informados pela cliente", vê "txid R6X..." e não sabe o que conferir. Trava: "onde eu vejo o comprovante?".
- Vencido: vê "Liberar vaga" em vermelho e teme cancelar sem querer; "Dar mais prazo" pede data e hora sem sugerir nada.
- Remarcar: na Agenda não descobre que dá pra clicar na diária nem que dá pra arrastar; o texto explica, mas em 2 linhas cinza.
- Ocorrência: entende o cartão; não entende que "Salvar" manda WhatsApp pra cliente nem a diferença entre "Em análise" e "Resolvido".
- Achar cliente: digita o telefone em "Buscar" na Visão geral e recebe um resultado com CPF mascarado e sem ação; ou vai em Clientes e encontra, mas não acha o histórico (o link se chama "Mensagens" e leva pra aba Automações).
- Ver o dia: a abertura diz "3 diárias hoje" mas não quais; tem que achar "Agenda" e depois "Ver só o dia".
- Aprovar cadastro: entende; mas conferir cinco documentos é cinco cliques e cinco pré-visualizações que empurram o botão pra baixo.

## 5. Material da cliente

`Prime_Limpeza/sistema-atual/` e `Prime_Limpeza/referencia-isa/` ainda não existem (01/10/2026). O cruzamento com os prints do
sistema antigo e com a referência visual da Isa fica PENDENTE e deve ser feito antes da etapa B (pode mudar a paleta e a
tela Início da proposta). O sistema antigo não foi acessado com login.

## 6. Comparativo de cliques por tarefa (antes x proposta, a partir da tela que abre)

| Tarefa | Hoje | Proposta | Como na proposta |
|---|---|---|---|
| Confirmar disponibilidade | 1 | 2 | Início > card "solicitações pra confirmar" > "Confirmar disponibilidade" (na própria lista, com a profissional sugerida) |
| Designar profissional | 3 | 2 | Início > "sem profissional" (bandeja) > "Designar" na sugestão |
| Confirmar um pagamento | 2 | 2 | Início > card "pagamento informado" > "Confirmar pagamento" |
| Vencido: liberar vaga ou dar prazo | 2 ou 5 | 2 | Início > card "vencido" > "Dar mais prazo" (prazo sugerido: amanhã 12h) ou "Liberar a vaga" |
| Remarcar | 5 | 3 | Agenda > diária > nova data (hora mantida) > "Remarcar" |
| Tratar ocorrência | 4 | 3 | Início > card "ocorrência" > "Responder à cliente" > "Enviar e marcar em análise" |
| Achar cliente por nome ou telefone | 2 a 3 | 1 | busca única no topo, Enter abre a ficha |
| Ver o dia de hoje | 2 | 0 | o bloco "Hoje" está no Início |
| Aprovar cadastro de profissional | 2 a 7 | 2 | Início > card "cadastro" > "Aprovar cadastro" (documentos listados e abríveis ao lado) |

Nenhuma tarefa com mais cliques que hoje; "confirmar disponibilidade" ganha um clique (sai do Início) e perde a rolagem e o
campo de motivo sempre visível. Estes números viram o limite do teste automatizado do novato na etapa B.

## 7. Teste do novato refeito sobre a proposta (lendo só a tela)

- Confirmar disponibilidade: lê "3 solicitações pra confirmar", clica, vê "Maria está livre nesse horário" e o botão; o detalhe diz "A cliente recebe a confirmação e o link de pagamento no WhatsApp". Não trava. Dúvida possível: "Lembrar amanhã" (o texto da lista explica: tira daqui até amanhã às 8h).
- Designar: "sem profissional" é uma bandeja com nome, e cada item traz quem está livre; "Designar profissional" é o único botão. Não trava.
- Confirmar pagamento: o card diz quem informou, quanto e há quanto tempo; embaixo do botão: "Confira no extrato antes". Não trava; o Pix em si continua sendo conferido no banco (igual hoje).
- Vencido: "Dar mais prazo" vem com o prazo sugerido e o que a cliente recebe; "Liberar a vaga" diz que a diária sai da agenda e a cliente é avisada. Não trava.
- Remarcar: a Agenda diz "Clique numa diária pra ver o detalhe ou remarcar"; o painel avisa conflito ("Maria já tem diária das 08:00 às 12:00"). Não trava.
- Ocorrência: o card traz a etiqueta "parada" e "há 3 dias sem resposta"; a ação é responder à cliente. Não trava.
- Achar cliente: uma busca só, com o rótulo "Nome, telefone ou e-mail da cliente". Não trava.
- Ver o dia: está no Início. Não trava.
- Aprovar cadastro: documentos listados com "ver" e o aviso "Joana recebe o acesso ao app e já pode receber diárias". Não trava.
- Onde ainda pode travar: Configurações (fora do protótipo) e a tela de lista de clientes (o protótipo abre direto a ficha). Ficam pra etapa B com o mesmo padrão.
