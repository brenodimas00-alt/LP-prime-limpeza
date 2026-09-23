# Decisões técnicas (reversíveis)

Formato: **contexto**, **decisão**, **motivo**. Decisões marcadas DECIDIDO na especificação não aparecem aqui (não se reabrem).

## Turno 2026-09-22

### D1. Branch de trabalho
- **Contexto:** `main` limpa, último commit de hoje, branch `turno/2026-09-22` inexistente.
- **Decisão:** `git pull` na main e criar `turno/2026-09-22` a partir dela. Sem worktree (não havia alteração local).
- **Motivo:** regra G1.

### D2. Playwright só como dependência de teste
- **Contexto:** o site não tem build; os testes E2E precisam de navegador. O Chromium do Playwright precisa de `libnspr4`, `libnss3` e `libasound2`, ausentes no WSL e sem sudo.
- **Decisão:** `package.json` com `playwright` em `devDependencies` (o site continua sem build nem dependência em runtime). As 3 libs foram baixadas com `apt-get download` e extraídas em `~/.cache/pw-libs`; os scripts de teste rodam com `LD_LIBRARY_PATH` apontando pra lá (ver README).
- **Motivo:** A2 proíbe framework/bundler no site, não ferramenta de teste. Extrair libs evita pedir sudo.

### D3. CSS da home extraído em 3 arquivos
- **Contexto:** G4 pede extrair tokens e componentes da home mantendo o visual idêntico.
- **Decisão:** `src/ui/tokens.css` (variáveis), `src/ui/base.css` (reset, botões, header, footer e o responsivo deles) e `src/ui/home.css` (seções). A marcação da home continua estática (SEO e funciona sem JS). As páginas internas usam `tokens.css + base.css + paginas.css` e montam header/footer por `src/ui/layout.js`, com as mesmas classes.
- **Motivo:** reaproveitar sem mexer no HTML aprovado. Verificado: `scripts/compara-home.mjs` dá 0 pixel diferente em 375 e 1440 (e acusa diferença quando um token muda 1 unidade).

### D4. Caminhos relativos + raiz derivada do módulo
- **Contexto:** A4 exige funcionar em `/LP-prime-limpeza/` e local.
- **Decisão:** HTML usa caminhos relativos. `src/config/app.js` deriva a raiz do site de `import.meta.url` (`RAIZ`) e expõe `url()`. `scripts/serve.mjs` imita o Pages servindo em `/LP-prime-limpeza/` (e em `/` com `RAIZ=1`). `.nojekyll` na raiz porque o Jekyll do Pages ignora pastas com `_` (`_dev/`).
- **Motivo:** nenhum caminho absoluto fixo; o mesmo arquivo funciona em qualquer base.

### D5. Mesmo núcleo de casos de uso no mock e no fake-api
- **Contexto:** o fake-api precisa implementar API.md com a mesma semântica do backend futuro.
- **Decisão:** `src/app/casos-de-uso.js` recebe um repositório com `transacao(fn)`. Implementações: IndexedDB (navegador) e memória (Node, com cópia e troca atômica). O fake-api usa os casos de uso sobre memória e roda o motor (papel de backend).
- **Motivo:** uma regra, um lugar. O teste de contrato http passa pelos mesmos cenários do mock (`scripts/cenarios.mjs`).

### D6. Escopo da idempotência = operação + ator + chave
- **Contexto:** revisão GPT #1 apontou que a chave sozinha poderia devolver resultado de outra operação/cliente.
- **Decisão:** registro em `idempotencia` com id `operacao|ator:id|chave` e hash do conteúdo (JSON com chaves ordenadas, cyrb53).
- **Motivo:** evita colisão entre operações e entre clientes.

### D7. Dono do recurso na máquina de estados
- **Contexto:** revisão GPT #1: papel não basta; cliente precisa ser dono e diarista precisa ser a atribuída.
- **Decisão:** `transicionar` recebe `atorId` e `clienteIdDoPedido`; ator `cliente` só age no próprio pedido e `diarista` só no atendimento atribuído a ela. Leituras de recurso alheio devolvem `NAO_ENCONTRADO` (não vaza existência).
- **Motivo:** autorização por recurso, não só por papel.

### D8. Versão no atendimento + revalidação no envio
- **Contexto:** revisão GPT #1: evento antigo podia recriar lembrete depois de cancelamento/reagendamento/reatribuição.
- **Decisão:** `Atendimento.versao` incrementa a cada mudança; a notificação guarda `refs.data/turno/diaristaId`; no horário do envio `aindaValida()` confere o estado atual e cancela a notificação obsoleta.
- **Motivo:** o motor pode reprocessar eventos sem mandar mensagem errada.

### D9. Colisão e busca limitada no calendário
- **Contexto:** revisão GPT #1: deslocar dia bloqueado pode colidir com a ocorrência seguinte ou não terminar.
- **Decisão:** busca do próximo dia permitido limitada a `buscaDeslocamentoMaxDias` (7); ocorrência que cai no mesmo dia ou antes da anterior gera `DATA_INVALIDA`. A primeira data (escolhida pela cliente) não é deslocada: é validada.
- **Motivo:** termina sempre e nunca gera duas diárias no mesmo dia.

### D10. Confirmação de entrada não reativa pedido terminal
- **Contexto:** revisão GPT #1.
- **Decisão:** `derivarStatusPedido` nunca tira o pedido de `cancelado`/`concluido`. `confirmarPagamento` exige elegibilidade (entrada de pedido cancelado não é confirmável) e só aplica `confirmar` em atendimentos `agendado`.
- **Motivo:** estado terminal é terminal.

### D11. Campos extras no modelo
- **Decisão:** `Pagamento.venceEm` (a parcela vence na data do atendimento), `Atendimento.versao`, `Atendimento.deslocada/dataOriginal`, `Notificacao.refs/previa/ordem`, `Pedido.cancelamento`, `Diarista.identidade` (rg|cnh), `Diarista.historico` (contato manual). Todos opcionais; nenhum campo do modelo decidido foi removido ou renomeado.
- **Motivo:** necessários pras regras decididas (vencimento, idempotência de eventos, deslocamento, contato manual).

### D12. Pix sem config: pagamento existe, cobrança não
- **Contexto:** A5 diz que funcionalidade sem config mostra aviso e não gera cobrança.
- **Decisão:** o pedido e o registro de Pagamento são criados (a dívida existe), mas com `brcode: null`; a tela de Pix mostra aviso e não exibe QR nem copia e cola. `criarPagamento` avulso (fora do autoagendamento) devolve `CONFIG_INCOMPLETA`.
- **Motivo:** não perder o pedido da cliente por falta de config da Prime, e ao mesmo tempo nunca mostrar cobrança inválida.

### D13. Sessão de demonstração no mock
- **Contexto:** no mock não há login, mas `?id=` não pode ser autorização.
- **Decisão:** após o autoagendamento o navegador guarda `prime.sessao = {ator:'cliente', id}`; as telas de cliente só mostram o que é dessa sessão. Com `?dev=1` (só mock) a sessão vira `prime`. No http o backend deriva a sessão do login; o adapter só envia `X-Ator-Teste` quando `API_BASE_URL` é localhost (fake-api), e o backend real ignora esse cabeçalho.
- **Motivo:** demonstrar a regra de autorização sem inventar login nesta fase.

### D14. Ordem dos eventos na fila
- **Decisão:** eventos têm `criadoEm` + `seq` (contador do processo); o motor ordena pelos dois. Notificações têm `ordem`.
- **Motivo:** vários eventos na mesma transação têm o mesmo instante.

### D15. Lembretes com "amanhã/hoje" calculado no envio e validade por dia (revisão GPT #2)
- **Contexto:** GPT apontou que um lembrete atrasado (agendador parado) sairia no dia da diária dizendo "amanhã", e que atribuição no próprio dia deixava a diarista sem endereço.
- **Decisão:** a variável `quando` dos lembretes vira "amanhã, dd/mm/aaaa," ou "hoje, dd/mm/aaaa," conforme o dia (no fuso) do envio agendado; a notificação guarda `refs.diaEnvio` e `aindaValida` descarta o lembrete se o envio real cair em outro dia. O lembrete da diarista pode sair no mesmo dia (`mesmoDia`), o da cliente não. `aindaValida` do lembrete da diarista agora também compara o turno.
- **Motivo:** mensagem nunca mente sobre a data; diarista sempre recebe o endereço.

### D16. Template extra `atendimento_cancelado_diarista` (revisão GPT #2)
- **Contexto:** reatribuição e cancelamento só cancelavam lembretes pendentes; a diarista que já tinha recebido "nova diária" não era avisada e poderia ir ao local.
- **Decisão:** novo template UTILITY pra diarista, disparado na reatribuição (pra anterior), no cancelamento de atendimento e no cancelamento de pedido (uma por diária cancelada que tinha diarista). Entra no checklist de aprovação da Meta.
- **Motivo:** risco operacional real (diarista indo a um endereço cancelado). Ver PENDENCIAS.

### D17. Merge da origin/main (ajustes do Breno, 5655300)
- **Contexto:** Breno subiu pela main um gradiente dourado novo (#A57E37 → #F7F4C0 → #BA984D), ajustes de line-height e os 6 ícones de benefício, com o CSS ainda inline no index.html. Conflitou com a extração da E0.
- **Decisão:** conflito resolvido pegando o index.html dele inteiro, refazendo o screenshot de referência (`docs/shots/home-antes-*.png` agora é a home do Breno) e reextraindo o CSS com `scripts/extrai-css-home.mjs`. Resultado: 0 pixel diferente em 375 e 1440 contra a versão dele. `paginas.css` passou a usar o gradiente novo.
- **Motivo:** preservar 100% do que ele mudou. O script fica pra próximos uploads com CSS inline.

## Revisões GPT (registro)
- **#1 plano/modelo (antes da E0):** executada. 7 apontamentos, todos incorporados (D6 a D10).
- **#2 gatilhos + mensagens (E1):** executada. 4 apontamentos, todos incorporados (D15, D16), com testes.
- **#3 WHATSAPP.md x Meta (E2):** revisão GPT NÃO EXECUTADA: motivo: limite de uso do Codex atingido ("try again at 4:28 PM"). E2 segue com os testes próprios verdes; revisar quando o limite voltar.

### D18. Bloco de templates do WHATSAPP.md gerado do código
- **Decisão:** a parte 2 do WHATSAPP.md é gerada por `node scripts/verifica-templates.mjs --gerar` a partir de `mensagens.js` + `gatilhos.js`; sem `--gerar` o script verifica (texto idêntico, UTILITY, pt_BR, snake_case, variáveis em sequência, nada no início/fim, sem formatação, exemplos, algum gatilho dispara). `testa-whatsapp.mjs` confirma que o verificador acusa divergência.
- **Motivo:** o documento que vai pra aprovação da Meta nunca fica diferente do que o sistema manda.

### D19. QR Code próprio, sem CDN
- **Contexto:** E4 permite lib leve via CDN pinado ou própria.
- **Decisão:** `src/domain/qrcode.js` (byte mode, nível M, versões 1 a 40, ~180 linhas, função pura). Verificado decodificando com `jsqr` (só devDependency de teste) em versões 1 a 12.
- **Motivo:** zero dependência em runtime, zero request externo na tela de pagamento (CSP mais simples na fase 2) e sem risco de CDN fora do ar na hora de pagar.

### D20. E3 entregue primeiro com preços provisórios
- **Contexto:** a tabela oficial (`precos-prime.txt`, 23/09) chegou depois de a E3 estar pronta e testada.
- **Decisão:** commitar E3 + E4 como estão e refazer o modelo de pacote da E3 em seguida, num commit próprio (ver D21).

### D21. E3 refeita com a tabela oficial (precos-prime.txt, 23/09)
- **Contexto:** o modelo provisório era por metragem/cômodos + multiplicadores. A tabela real é por duração (2/4/6/8h), com acréscimos por tipo, taxas por data e desconto mensal.
- **Decisão:** `calcularPacote` calcula o preço-base de UMA diária (independe da data); `gerarAtendimentos` aplica taxa de sábado/feriado por diária, desconto por mês de calendário e devolve os totais (total, entrada, restante, parcelas). O `Pedido.pacote` guarda os totais já calculados. A UI mostra "valor da diária" no passo 3 e o total só no passo 4 (quando as datas existem). Feriados cobram taxa (não bloqueiam); domingo bloqueia.
- **Motivo:** o preço final depende das datas; separar deixa cada função pura e testável. Casos da cliente conferidos à mão em `scripts/testa-pacote.mjs` (17 casos).
- **Extras:** código `REGIAO_SOB_CONSULTA` (Nova Lima leva pro WhatsApp); turno amarrado à duração (8h = dia inteiro); `prazoRestante` configurável (ver PENDENCIAS); conteúdo informativo em `src/config/conteudo.js` (vai pra home na E6).

### D22. Home: links internos e ordem do menu (pedido da Gabs, 23/09)
- Todo link pra `primelimpezaespecializada.com.br/autoagendamento` virou `autoagendamento/` e `/diarista/autocadastro` virou `diarista/cadastro/` (relativos, sem `target=_blank`). Botão de cada card de serviço abre `autoagendamento/?servico=<tipo>` e o passo 3 já vem com o serviço marcado (valor desconhecido é ignorado). Menu, menu mobile e rodapé: "Serviços" antes de "Como funciona". `docs/shots/home-antes-*.png` refeitos com esta versão (nova referência pro comparador).

### Revisão GPT #4 (pacote + calendário + testes): executada
- 4 apontamentos: (1) deslocamento com endereço divergente: não se aplica, o backend calcula sempre a partir de `cliente.endereco` gravado, nunca de um preço vindo do navegador; (2) primeira data em domingo não é deslocada: mantido de propósito (D9), a data escolhida pela cliente é validada e a UI já explica; (3) e (4) testes de sobra na última parcela e de mensal com clamp + domingo: adicionados (casos 17 e 18 de `testa-pacote.mjs`).

### D23. E5: id do cadastro nasce no rascunho; documentos antes do envio
- **Decisão:** o rascunho da diarista cria um UUID no navegador; os uploads (`salvarDocumento`) usam esse id antes de `cadastrarDiarista`. Documentos ficam no store `arquivos` do IndexedDB (mock) e no backend viram storage privado (BACKEND.md). Validação local do arquivo (tipo, 5 MB, assinatura dos primeiros bytes) e revalidação no caso de uso. Qualquer tipo aceita jpg/png/pdf, inclusive foto de perfil.
- **Motivo:** permite parar e continuar, troca de arquivo e envio único idempotente; documento órfão (rascunho abandonado) é limpeza do backend (7 dias, API.md).

### Revisão GPT #5 (documentos, segurança e LGPD): executada
- 5 apontamentos. Corrigidos agora: tamanho do arquivo derivado do conteúdo real no caso de uso (o valor informado só é conferido); `Cache-Control: no-store, private` no download do fake-api. Registrados como obrigatórios na fase 2 (BACKEND.md, seção Segurança): (1) rascunho de cadastro vinculado à sessão/credencial, não só ao UUID (hoje o UUID v4 do rascunho funciona como segredo de acesso, aceitável só no mock); (2) validação real do conteúdo do arquivo (decodificar imagem/PDF), a assinatura de bytes é só filtro; (3) parser multipart robusto, o do fake-api é mínimo e só de teste.

## E6a. Estudo antes de mexer

### Referência (corpoealmabrasileira.ilikia.com, só a técnica; nada copiado)
1. Header fixo e translúcido (72px, fundo escuro a 28%), menu em caixa alta pequena e um CTA em pílula clara à direita.
2. Rótulo em caixa alta com letter-spacing e separador "·" acima de todo título ("PROTOCOLO · TECNOLOGIA · CLÍNICA").
3. Títulos grandes (51px no desktop), peso 900, line-height 0,96, quebrados de propósito em 2 ou 3 linhas, com uma palavra em cor de destaque.
4. Alternância firme de seções: escura com foto, clara em creme, azul claro, escura de novo; cada seção com respiro de 64 a 128px.
5. Itens em colunas verticais com legenda girada e número; cards de produto com legenda em caixa alta miúda embaixo.
6. Detalhamento de cada item em blocos de 2 colunas (texto à esquerda, lista com ícone de linha à direita), nunca 3 cards iguais.
7. CTAs com seta e texto em caixa alta; um só CTA primário por seção.
8. Formulário final sobre foto: labels em caixa alta pequena, campos claros sem ícone, botão largo escuro, aceite de política.
9. Rodapé claro em colunas: marca + frase, Explore, Contato com CTA.
10. Animações só de entrada (fade e leve subida) ao rolar e hover discreto; nada de partículas.
**O que trago:** 2 (rótulos), 3 (título com quebra intencional e palavra em destaque), 4 (alternância claro/escuro e respiro), 6 (composição em 2 colunas), 7 (seta no CTA de avanço), 8 (formulário limpo), 10 (entrada suave). Stepper vira "etapas numeradas" no estilo do item 5.

### Home da Prime (o padrão de todas as páginas)
- Tipografia: DM Sans 800 nos títulos (h2 clamp 1,8 a 2,6rem, letter-spacing -0,02em, line-height 1,08); h1 do hero em 400 com a frase final em 800 dourado; Inter no corpo (0,95 a 1,08rem, line-height 1,5 a 1,7); h3 1,1 a 1,2rem.
- Ritmo: seções com 40px 24px, cabeçalho de seção centrado com 36px abaixo, grids com gap 16px, largura máxima 1220px; bandas inteiras em azul (#2a2456) alternando com branco.
- Dourado (gradiente 135° #A57E37 → #F7F4C0 → #BA984D) só em: CTA primário, títulos sobre fundo azul (clip no texto), barra inferior de 5px dos cards, número das etapas, setas do slider e traço dos ícones. NÃO aparece em título sobre fundo claro (esses são azul), em corpo de texto nem em fundo de seção.
- Fotos: cantos 14px, proporção 4:5 ou 5:3, sem filtro; mockup com sombra projetada suave.
- Ícones: linha fina com stroke dourado, ou dentro de caixa 42px raio 10 em creme (#f4f1e4) no claro e dourado a 15% no escuro.
- Raios 8px em cards e 10px em botões; sombra só no card branco sobre azul (0 4px 20px 18%) e no CTA (dourada a 35%).
- Tom: frases curtas, segunda pessoa, "a gente", concreto ("Nada de acerto na porta"); FAQ com pergunta em azul e resposta em creme.
- CTAs: dourado cheio + "ghost" com texto dourado sublinhado; hover sobe 2px.

## E6. O que foi feito (resumo)
- **Visual:** `src/ui/paginas.css` reescrito: abertura em banda azul com rótulo em caixa alta e título com trecho dourado; etapas numeradas (01…06) com traço dourado na atual; card principal branco com barra dourada de 5px (como os cards da home); card escuro pra valores; CTAs de avanço com seta; formulários só com label em cima; entrada suave `.reveal` (IntersectionObserver, respeita reduced-motion). Nenhum gradiente fora do dourado, nenhum emoji, nenhum selo decorativo.
- **Microcopy:** títulos curtos e concretos ("Quem contrata", "Escolha o dia", "Monte sua diária"); erros dizem o que fazer; textos da Prime (material, o que não faz, regiões). `scripts/verifica-texto.mjs` garante zero ocorrências de emoji, palavras proibidas, gradiente fora do dourado e travessão.
- **Login e áreas:** `src/services/auth.js` (mock agora; esqueleto Supabase com a mesma interface), `entrar/`, `minha-conta/`, `diarista/entrar/`, `diarista/agenda/`, `painel/entrar/`, `painel/` (agenda do dia e da semana, atribuir, pagamentos informados, cadastros com documentos, notificações, avaliações com média por diarista), `404.html`. Páginas logadas com `noindex`. Guarda de rota no front é só navegação; a autorização real é do backend (API.md).
- **Home:** só o link "Entrar" no header (e no menu mobile). Referência do comparador refeita.
- **Aceite:** 24 imagens em `docs/shots/e6/` (2 da referência + 11 páginas × 2 larguras); Lighthouse acessibilidade home 98, autoagendamento 100, minha-conta 100, painel 100; sem overflow horizontal em 390px nas suítes E1 a E6.

### Proposta pra home (NÃO aplicada; pra aprovar com o Breno)
1. Rótulo em caixa alta com "·" acima de cada h2 ("SERVIÇOS · POR HORA · BH E REGIÃO"), como a referência faz e como as páginas internas já fazem.
2. "Como funciona" com as 4 etapas em coluna numerada (01 a 04) e uma foto ao lado, no lugar dos 4 cards iguais.
3. Hero com título em duas linhas de quebra intencional e uma só palavra em dourado (hoje são três linhas com a frase inteira em destaque).
4. Seção "Onde atendemos" com a lista real de cidades e taxas (já está no FAQ) em duas colunas, no lugar do botão de WhatsApp.
5. Faixa fina de "o que a Prime não faz" com os itens reais da tabela, antes do FAQ.
6. Rodapé com CTA "Agendar" e link "Entrar", e header que ganha fundo sólido ao rolar (hoje é branco fixo).

### Revisão GPT #7 (microcopy e acabamento, com as 2 imagens): executada
- Conseguiu abrir as imagens. 3 frases reescritas (minha-conta, cadastro: próximos passos e erro de documentos faltando). Acabamento: CTA do header vira secundário durante o agendamento e o cadastro (não compete com "Continuar"); contraste das etapas futuras já tinha sido corrigido pelo Lighthouse; alinhamento do eixo abertura/formulário conferido (mesma largura de 880px e mesmo padding de 24px; o deslocamento apontado é a sombra do card).

### Revisão GPT #6 (entregas e riscos): executada
- 5 riscos + 3 lacunas. Corrigidos: login de quem se cadastrou na demonstração (mock busca cliente pelo WhatsApp e diarista pelo e-mail com a senha de demonstração `diarista123`; casos `buscarClientePorTelefone`/`buscarDiaristaPorEmail` são só do mock, o OTP/Auth substitui na fase 2); diarista não recebe diárias sobrepostas (`atribuirDiarista`); docs alinhados (upload multipart pela API na fase 2; troca de adapter cobre dados, auth precisa do adapter supabase; webhook Pix com ator `sistema` já é permitido). Registrados: conflito pagamento antecipado x elegibilidade (PENDENCIAS); ações do painel não persistem chave entre recarregamentos (aceito: são idempotentes por estado, repetir "confirmar" cai em PAGAMENTO_NAO_ELEGIVEL); `prime.js` com PREENCHER é decisão da especificação (demonstração usa `?dev=1`).

## Turno 2026-09-23 (spec-prime.txt)

### F0. Correções urgentes do front
- **Validação (causa):** `aplicarErros` só bloqueava erro com campo correspondente na tela, e o formulário de entrada (cliente, diarista, Prime) não validava nada antes de enviar. Agora qualquer erro bloqueia (o sem campo vai pro aviso geral) e toda entrada exige os campos. Achado ao testar: com senha e confirmação vazias, `'' === ''` deixava a confirmação passar; corrigido com teste.
- **"null" na tela (classe de bug):** `append`/`replaceChildren` nativos escrevem "null" quando recebem `cond ? el : null`. Todas as páginas passaram a usar `trocar`/`anexar` de `src/ui/dom.js`, que ignoram vazio. Teste varre 20 telas atrás de null/undefined/NaN.
- **ViaCEP:** resposta atrasada de um CEP antigo não sobrescreve mais o endereço do CEP novo (revisão do Codex, com teste).
- **Stepper:** atual azul-marinho com barra sólida de 3px; concluídas em dourado-escuro #7A5C12 (6,6:1) com check e clicáveis; futuras #6b6b6b (5,3:1), sem botão.
- **Login da cliente:** e-mail e senha; conta criada no passo 5 do agendamento (senha ≥ 8 + confirmação, nunca salva no rascunho). No mock o front manda SHA-256 da senha e o caso de uso guarda no store `credenciais` (só mock; no Supabase é o Auth). E-mail já com conta e outra senha é recusado e o erro aparece embaixo do campo. Código por WhatsApp atrás de `LOGIN_WHATSAPP = false`. "Entrar com Google" visível e BLOQUEADO até o client do Google existir.
- **Header:** "Entrar" é botão secundário com ícone de pessoa (a home não tinha ícone de pessoa; desenhado no mesmo traço dos ícones de linha dela, em `src/ui/icones.js`), divisor fino, mesma altura e fonte do dourado; sombra do dourado reduzida; logado vira "Minha conta" (home por `src/ui/header-home.js`); no celular, ícone de conta ao lado do menu e "Entrar" dentro do menu. Menu da home ganhou `aria-expanded`/`aria-controls`.
- **Logo sumindo:** não reproduzido em `/LP-prime-limpeza/` nem na raiz. Causa provável: página aberta sem barra final (`.../entrar`), que quebra caminhos relativos. Todas as páginas geradas ganharam uma guarda que acrescenta a barra (sem mexer em `.html` nem na query). Teste confere `naturalWidth > 0` em 14 páginas nos três modos.
- **Referência visual da home refeita:** o único diff fora do header eram os 18px abaixo do botão dourado (sombra reduzida, pedida na spec). Conferido por comparação pixel a pixel excluindo o header antes de aceitar.
- **Lighthouse no WSL** deixava pastas `C:\Users\...` no repo: perfil do Chrome agora em pasta temporária do Linux, apagada no fim.
- Revisão do Codex (via /build, 2 chamadas): plano criticado antes (corrida do ViaCEP, 320px, não aceitar referência visual às cegas) e revisão com evidência depois (guarda com `.html`, erro de e-mail existente, aria do menu, screenshots esmaecidos pela animação, import sem uso). Tudo corrigido com teste; descartado só o Google (bloqueio externo).

### F1. Fechar o front pendente
- E3 (tabela oficial), E5 e E6 já estavam aceitos (aed6f8d, 5bf57ab, 03f13ca, ce40991); retestados na suíte completa junto com o E4.
- **Pagamento:** grupo "Forma de pagamento" com Pix marcado e "Cartão de crédito" visível, desabilitado, "Em breve". Liga por `PAGAMENTO_CARTAO` em `src/config/app.js` no B4. Só aparece quando a parcela está pendente e pagável.
- **Teste intermitente do E3 (causa):** radio de 1px marcado com `force` enquanto o formulário ainda desliza na animação `.reveal`; o clique caía fora. Não afeta a cliente (ela clica no rótulo, que se move junto). Contextos de teste do E3 e do E1 (os únicos com clique forçado) passaram a usar `reducedMotion: 'reduce'`. Antes: 2 falhas em 10; depois: 10/10.

### B0. Infra de homologação
- **Supabase:** projeto `prime-homolog` (ref `dkafhwekgvwjttbsfxvu`), sa-east-1, org Prime-Limpeza, criado e linkado por `scripts/cria-homolog.sh` (idempotente; a senha é gravada em `~/.prime-env` antes da criação; se o projeto existir sem senha no env, o script para em vez de trocar a senha). Chave do front é a `sb_publishable_*`; o script recusa chave secreta.
- **CLIs pinadas** num lugar só (`scripts/cli.sh`, também `npm run supabase|wrangler -- ...`). Wrangler 4.9x+ exige Node 22 e o WSL tem 20: o `node@22` entra só pro Wrangler via `npx -p`, sem trocar o Node do sistema.
- **Pages clássico:** o Wrangler 4.137 delega `pages project create` pro "Pages em Workers" e falha; criado com `--force` (Pages clássico, como a spec pede). Só a criação precisa disso.
- **dist/ montado por script** (`scripts/monta-dist.mjs`): só arquivos do git fora de docs/, scripts/, supabase/, _dev/ e configs; `scripts/fixtures/seed.js` entra porque o mock importa em runtime (apontado pelo Codex). Teste de aceite confere 404 em docs, scripts de teste, supabase, _dev e package.json.
- **CSP sem `unsafe-inline` em script:** a home do Breno tem 1 `<script>` inline e 2 `onclick`. Sem mexer nela, o monta-dist calcula o hash de cada um a cada deploy (`'unsafe-hashes'` só pros handlers com hash). `style-src` mantém `'unsafe-inline'` (a UI usa `style=`). `connect-src` só ViaCEP e o projeto Supabase.
- **noindex:** em todo `*.pages.dev` (projeto e alias de versão/branch) e nas páginas de sistema em qualquer host.
- **Varredura de segredo** (`scripts/varre-segredos.mjs`): tokens conhecidos, `sb_secret`, JWT não-anon, base64 longo, valores do `~/.prime-env`; nunca imprime o valor. A menção ao nome do papel de serviço do Supabase é liberada só em `supabase/` e nos dois scripts que o detectam (SQL e config citam o papel; a chave é pega pelos outros padrões, que valem em todo arquivo).
- **`src/config/ambiente.js`** é gerado e publicado, mas nada importa ainda: o adapter `supabase` entra no B2/F2.
- Teste do aceite: requisição de `<video>` abortada pelo Chrome pra refazer por faixa (`ERR_ABORTED`) não conta como falha; status >= 400 conta.
- Revisão do Codex (via /build, 2 chamadas no turno): plano criticado antes (seed.js do mock no dist, senha antes do create, noindex com `:version.:project`, aceite com status de módulos e 404 de arquivos internos) e revisão com evidência depois. Corrigidos com teste ou execução: dist por lista permitida (antes era por exclusão), varredura também do conteúdo staged e padrões valendo nos scripts que citam o papel, guarda do deploy normalizada (`Main` e HEAD destacado barrados), falha no `project list` não vira "criar projeto", variável morta. Guardas e idempotência do `cria-homolog.sh` executadas de novo.

## Turno 2026-09-23, spec nova (B1, B2, B7, B3)

### B1. Banco
- **Planilha real** movida pra `~/.prime-dados/` (700/600), conferida por SHA-256 antes de apagar a cópia da Área de Trabalho. `*.xlsx`, `*.xls`, `*.csv` e `.prime-dados/` no `.gitignore`.
- **Migrations** em `supabase/migrations/`: schema (17 tabelas da spec + `configuracao`), RLS, dados oficiais (gerados de `precos.js` por `scripts/gera-seed-config.mjs`, pra banco e front terem a mesma fonte) e índices. Dinheiro `bigint` em centavos; `date` pra calendário, `timestamptz` pra instantes.
- **Privilégios:** `REVOKE ALL` de `anon`/`authenticated` e dos privilégios padrão (tabelas, sequences, `EXECUTE`); `GRANT SELECT` só onde há policy. Anônimo lê só `precos`, `regioes`, `feriados`, `configuracao`. RLS forçada em todas; nenhuma policy de escrita (só RPC/service role).
- **Helpers** em schema `privado` (fora da API): `papel()`, `eh_prime()`, `eh_prime_admin()`, `meu_cliente_id()`, `minha_diarista_id()`. Bloqueado: todos devolvem nulo/falso, então ele não lê nada mesmo com token válido. Vínculo cliente/diarista só vale com o papel correspondente (revisão do Codex: conta com vínculo duplo acumulava acesso).
- **Integridade:** FK composta pagamento→atendimento do mesmo pedido; no máximo uma entrada e uma parcela ativa; `entrada + restante = total`; notas com exatamente os 4 critérios e nota final = média com 1 casa (revisão: `'{}'` passava porque o CHECK dava NULL); documento único por cliente (`tipo_documento`, `documento`).
- **Auditoria** por trigger em clientes, pedidos, atendimentos, pagamentos, diaristas e perfis (papel e bloqueio): usuário (`auth.uid()`), papel e contexto declarado pela RPC (`app.ator`, local à transação).
- **Homologação com Pix fictício** (o mesmo de `prime.teste.js`) em `configuracao`; a chave real entra no go-live (PENDENCIAS).
- **Testes contra o homolog** (`scripts/testa-rls.mjs`, 12 casos): só usuários `teste-<execução>-*@example.com` e linhas `ficticio`; limpeza restrita à execução, em transação. Conexão SQL com TLS validado pela CA raiz pública do Supabase (`scripts/certs/`), nunca `rejectUnauthorized: false` (revisão).
- **Node 22 só pros testes de homologação:** supabase-js 2.117 exige Node 22 (WSL tem 20); `bash scripts/cli.sh node22 <script>`, como o Wrangler.
- Lint do Supabase (`db advisors --type all`): só INFO (`idempotencia` sem policy, intencional).
