# Painel v2, etapa A3: referências e princípios adicionais (01/10/2026)

Pesquisa em painéis operacionais claros (gestão de serviços e agendamento, CRMs enxutos, design systems de painel
administrativo e literatura de UX). Extraímos princípios, não layout nem marca. Os nove princípios da seção 1 da spec
continuam valendo; estes são os ADICIONAIS que guiam a proposta, cada um com a fonte e como entra no painel da Prime.

1. **Contagem que vira atalho.** Cada número leva à lista já filtrada. Prime: "3 solicitações pra confirmar" abre a lista nesse filtro, com a ação no card. Fonte: Jobber, Dashboard (help.getjobber.com/hc/en-us/articles/360033835353-Dashboard).
2. **Aviso só acima de um limite.** Card zerado some ou fica discreto ("tudo certo"); cada aviso tem seu limite (Pix informado há mais de 2 h). Fonte: Jobber, Dashboard.
3. **Triagem com poucas saídas fixas.** Solicitação nova tem só Confirmar, Recusar e Lembrar amanhã (o item adiado volta sozinho). Fonte: Linear, Triage (linear.app/docs/triage).
4. **Dona da fila visível.** Fica claro quem está cuidando das entradas hoje (faixa "Hoje quem confere Pix: Isa"). Fonte: Linear, Triage.
5. **Prioridade por tempo em 4 níveis.** Vencido, hoje, sem próximo passo, futuro; só os dois primeiros ganham destaque. Fonte: Pipedrive, pipeline view (support.pipedrive.com/hc/en-us/articles/115001107229).
6. **Item parado se marca sozinho.** Ocorrência aberta há mais de 48 h ganha a etiqueta "parada"; a marca sai quando alguém age. Fonte: Pipedrive, Rotting (support.pipedrive.com/en/article/the-rotting-feature).
7. **Bandeja do "sem profissional" separada da agenda.** Ao designar, a agenda do dia de cada profissional aparece ao lado. Fonte: Housecall Pro, Schedule (help.housecallpro.com/en/articles/6367496).
8. **Futuro agrupado por janelas.** Hoje, próximos 7 dias, 8 a 14 dias; vencidos ordenados por idade. Fonte: Jobber, Dashboard.
9. **Tabela no celular vira cartão.** Abaixo de 760 px: nome, data ou valor, estado e um botão; filtro antes da lista. Fonte: NN/g, Mobile Tables (nngroup.com/articles/mobile-tables/).
10. **Nome humano primeiro, filtros ativos à vista.** Primeira coluna sempre o nome da cliente, nunca id; filtros como etiquetas removíveis. Fonte: NN/g, Data Tables (nngroup.com/articles/data-tables/).
11. **Detalhe sem cobrir a lista.** Painel lateral no computador; tela cheia com "voltar" no celular, mantendo filtro e posição. Fonte: NN/g, Data Tables.
12. **Dinheiro tabular e à direita.** Valores sempre com algarismos de largura fixa, alinhados à direita. Fonte: Shopify Polaris, Using type e Data table (polaris-react.shopify.com).
13. **Estado como adjetivo, poucos estados.** Selo com texto junto da cor, fundo claro e texto escuro, sem parecer botão; no máximo 5 por entidade. Fonte: GOV.UK Design System, Tag (design-system.service.gov.uk/components/tag/).
14. **Desfazer em vez de confirmar.** Confirmação só pra irreversível ou dinheiro, e o botão diz a consequência ("Liberar a vaga e avisar a cliente"), nunca "Sim". Fonte: NN/g, Confirmation Dialogs e Bulk Actions.
15. **Uma busca só.** Nome, final do telefone, e-mail; o resultado abre a ficha. Fonte: Stripe, Dashboard search (docs.stripe.com/dashboard/search).
16. **Navegação à vista e cores seguras.** Barra inferior com até 5 itens rotulados (menu-sanduíche corta a descoberta quase pela metade); gráfico só barra ou linha; até 5 cores categóricas; azul x dourado em vez de vermelho x verde. Fontes: NN/g Hamburger Menus e Mobile Navigation; NN/g Dashboards (preattentive); Atlassian, cores em visualização de dados; Datawrapper, daltonismo.

Apoios: reconhecer em vez de lembrar (IxDF, recognition vs recall): a tela da ação mostra nome, endereço e valor; divulgação
progressiva com no máximo 2 níveis (UXPin); tour de cartões não melhora o desempenho e é esquecido (NN/g, Onboarding
Tutorials): o da proposta tem 5 passos, pula e pode ser revisto na Ajuda.

Anti-padrões do painel que cresceu "uma aba por funcionalidade" (todos presentes no painel atual): navegação estourada
(16 abas); estados divergentes entre abas; totais sem saída (as seis caixas não levam a lugar nenhum); confirmação em tudo;
tabela de computador no celular.
