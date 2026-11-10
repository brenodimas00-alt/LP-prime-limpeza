# Painel: medidas da referência

Referência: `Prime_Limpeza/dashboard-isa.png` (1536 x 1024, imagem gerada pela cliente). Regras de negócio: `Prime_Limpeza/dashboard-regras-isa.txt`. No painel a referência vence o design system do site (decisão da Gabs, 10/11/2026); degradê e sombra suave moram só em `src/ui/painel2/painel-tokens.css`.

## Como foi medido
- `scripts/design/mede-referencia.mjs` (Chromium): amostra de cor (média 3x3 em área chapada), recorte com zoom e grade de coordenadas, varredura de linha e coluna pra achar bordas.
- `scripts/design/compara-maquete.mjs`: renderiza em 1536 x 1024, DPR 1, fontes carregadas, sem animação; gera sobreposição 50%, imagem de diferença e o desvio de cada bloco e elemento contra `docs/painel-referencia.json`. Limite: 4 px em qualquer borda de bloco e na posição (esquerda, topo, base) de elemento; a largura de texto vale 8 px (depende da fonte).
- Rodadas guardadas em `Prime_Limpeza/inicio/comparativos/rodada-N` (maquete, sobreposição, diferença, relatório).

## Paleta (hex medidos)
| uso | valor |
|---|---|
| menu lateral | `#0b1c29` |
| item ativo (degradê) | `#f7dbb6` → `#cd9b63` → `#b48247` |
| fundo creme | `#faf0e9` (varia de `#f9efe7` a `#fbf1ea` na imagem) |
| cartão / topo do cartão | `#fdfcfd` / `#fef4f1` |
| faixa do cabeçalho de tabela | `#f5f3f5` |
| títulos (traço) | `#091669` → token `#0b1a6b` |
| Pago / Confirmada | fundo `#e2f9ec`, texto `#1c8e4f` |
| Pendente | fundo `#fdf1e2`, texto `#ec6d23` |
| Em andamento | fundo `#ddf1ff`, texto `#2a77d6` |
| urgente / Recusar | fundo `#fdeded` a `#fee9e7`, texto `#ea3640`, contador `#fb4d56` |
| Negociar data | fundo `#fdf3e7` |
| anel e barra da meta | `#be8440` → `#faca92` (token um pouco mais escuro pra legibilidade), trilho `#f3f0ef` |
| rosca | vermelho `#fe646c`, azul `#3373ad`, dourado `#efc179`, pêssego `#fddbbb`, cinza `#d8d8da` |
| barras de regiões | `#f9d3ad` → `#ebc095`, trilho `#f1f0ee` |

## Medidas (px em 1536)
- Menu: 178 de largura; itens de 38 de altura a cada 44, recuo 12 dos lados, ícone em x 26, texto em x 62, contador de 20.
- Conteúdo: margem esquerda 19, direita 16 (grade de 1323 px), espaço entre cartões 12.
- Topo: busca 670 x 30 em y 12; "Sistema trabalhando por você" 370 x 53 em x 912; data 224 x 45 em x 1297.
- Linhas de blocos (y): Solicitações 135 a 370; Diárias 384 a 602 (643 e 668 de largura); terceira linha 614 a 839 (418, 327, 286, 257); quarta 852 a 1003 (525, 365, 409).
- Cartões: raio 14, contorno de 1 px, sombra `0 1px 2px` + `0 6px 20px` em marrom translúcido; recuo interno 8.
- Tabelas: faixa de cabeçalho de 21; linha de 47 a 48 (Solicitações) e 46 (Diárias); avatar 36 (32 nas diárias, 34 no stand-by); botões de 30; Aprovar 77, Recusar 79, Negociar data 110.
- Gráficos: anel da meta de 104 (traço 13, ponta arredondada); rosca de 108 com furo de 66; barras de 11 de altura com trilho.

## Tipografia
Comparação por métrica (largura das frases medidas e altura de maiúscula) e renderização lado a lado, em `~/.claude/build/build-20261110-inicio/medidas/fontes-lado.png`:
- **Serifa: Merriweather 700.** Dá "Boa tarde, Isa!" com 219 px em 33 px e a maior altura de maiúscula entre as candidatas (IBM Plex Serif, Source Serif 4, Libre Caslon, DM Serif Text). O desenho robusto bate com o da imagem.
- **Texto: IBM Plex Sans Condensed (400 a 700).** Única com a mesma largura condensada da referência (a frase da saudação fecha em 399 px com 17 px). O "g" e o "ç" batem.
- Tamanhos: saudação 33, frase 17, títulos de bloco 13 a 17 (a imagem não é constante entre blocos; cada um foi ajustado à largura medida), tabela 13, linha secundária e legendas 12, números dos gráficos 26.

## Ícones
Um conjunto só: Lucide (traço fino, já usado no projeto), com fundo circular tingido onde a referência usa ícone colorido. WhatsApp e Google foram desenhados no mesmo traço (o Lucide não tem marcas).

## Diferenças deliberadas
- Logo oficial do kit (telhado + PRIME) no lugar da coroa decorativa da imagem gerada.
- Assinatura cursiva "Prime" do canto superior direito omitida: não existe no kit oficial. O espaço fica reservado (`--pn-topo-reserva`).
- Avatares ilustrados fictícios no lugar das fotos (nenhuma foto de pessoa real).
- Cores da legenda da rosca iguais às fatias (na imagem a legenda não bate com as fatias).
- Texto do botão "Cidades" em marinho, não em branco: branco sobre o dourado não passa no contraste.
- Barra da meta com o mesmo percentual do anel (86%); na imagem a barra mostra cerca de 73%, o que não fecha com nenhum número.
- Título "Meta de diárias · Outubro" com ponto médio no lugar do travessão (regra de texto do projeto).
