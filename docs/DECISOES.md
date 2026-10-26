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

### B2. Auth
- **Senha com pepper:** a senha que o Supabase Auth guarda é `HMAC-SHA256(AUTH_PEPPER, senha digitada)`. O pepper fica só em `supabase secrets` e `~/.prime-env`. Motivo: o endpoint de senha do GoTrue é público com a chave publishable; com senha de 6 dígitos (decisão da cliente pros importados), brute force direto nele contornaria nosso bloqueio. Sem o pepper, adivinhar no GoTrue não serve. **Perder o pepper = ninguém entra** (backup junto do `~/.prime-env`).
- **Edge Function `conta`** (`supabase/functions/conta`, `verify_jwt = false`, ações logadas conferem o token no código): `entrar`, `cadastrar`, `trocar_senha`, `definir_senha` (pós-recuperação), `bloquear`/`desbloquear` e `redefinir_senha` (Prime). Erros no formato `{ erro: { codigo, mensagem, detalhes } }`.
- **Hooks do Auth (plano free):** `hook_token` só emite sessão de login por SENHA com ticket de uso único da function (30 s), nega token (inclusive renovação) a bloqueado e põe o papel no JWT; `hook_antes_de_criar_usuario` só aceita conta de e-mail com ticket de cadastro. Conferido no homolog: login direto sem ticket 403, cadastro direto 403, senha errada 400 genérico, bloqueado não renova. `admin.createUser` (service role) não passa pelo hook de cadastro (esperado: é confiável).
- **Bloqueio progressivo** (`configuracao.auth`, editável): por e-mail, falhas desde o último sucesso (janela de 24 h): 5 → 5 min, 10 → 30 min, 15 → 2 h, 20 → 24 h. Por IP: 30 falhas em 15 min → 15 min. A tentativa é reservada sob `pg_advisory_xact_lock` antes de ir ao Auth: 12 tentativas em paralelo não passam de 5 (teste). IP de `cf-connecting-ip`/`x-forwarded-for`.
- **Tudo em `acessos`:** sucesso, falha (motivo), bloqueado, com IP e dispositivo (user-agent). Troca, definição e redefinição de senha e bloqueios vão pra `auditoria` com o autor.
- **Importado:** "redefinir senha" da Prime volta pros 6 primeiros caracteres do documento (CNPJ alfanumérico: os 6 primeiros caracteres). Outros usuários: link por e-mail.
- **Trocar senha** em Minha conta (seção recolhida, sem banner): confere a atual (conta como tentativa de login, sujeita ao bloqueio), mínimo 8, encerra as outras sessões.
- **Recuperação:** `resetPasswordForEmail` direto do front (resposta igual exista ou não a conta); o link volta em `entrar/?modo=nova-senha` (fluxo implícito, funciona em outro aparelho) e a nova senha é salva pela function, que exige sessão de recuperação com menos de 15 min.
- **Front:** supabase-js 2.117.1 vendorizado em `vendor/` (build UMD, carregado por `<script>` com CSP `'self'`). `src/config/app.js` lê `ambiente.js` se existir; ele é escrito só dentro do `dist/` pelo deploy (`AUTH=supabase DADOS=mock` no preview até o F2). Local e testes seguem 100% mock; `AMBIENTE_HOMOLOG=1` no `serve.mjs` serve o ambiente da homologação.
- **Guarda de rota no Supabase:** além do espelho local, `conferirSessao()` renova o token ao abrir página logada; sessão vencida ou usuário bloqueado volta pra entrada.
- **Config do Auth** (`supabase config push`): confirmação de e-mail ligada, `secure_password_change`, TOTP e SMS desligados, intervalo mínimo entre e-mails 60 s, URLs do preview e locais. Atenção: sem terminal interativo o `config push` NÃO pede confirmação (aplicou direto); sempre revisar o diff com `supabase config diff` antes.
- **E-mail em homologação:** o SMTP padrão só entrega pro time do projeto e 2 por hora; e-mail `example.com` é recusado no cadastro público. Testes nunca disparam envio: confirmação e recuperação são testadas com `admin.generateLink` (não envia).

### B7. Importação da base de clientes
- **Decisão da cliente (registrada, não reabrir):** a Prime decidiu, ciente do risco apresentado pela Gabrielle em 23/09/2026, que os clientes da base importada entram com e-mail + 6 primeiros dígitos do CPF (ou CNPJ) como senha permanente, sem troca obrigatória. Mitigações do B2 valem pra todos (pepper, bloqueio progressivo, `acessos`, trocar senha, bloqueio pela Prime).
- **Dados reais:** planilha só em `~/.prime-dados/` (700/600); nenhum nome, CPF, e-mail ou telefone no terminal (só contagens) nem no repo. `varre-segredos` agora também procura os documentos, e-mails e telefones da base real (lidos da planilha local, só em memória) e qualquer planilha no git; `verifica-historico.mjs` varre todos os blobs do histórico. Os telefones públicos da própria Prime (rodapé da home) não contam como dado de cliente (um deles também aparece na base).
- **`scripts/importa-clientes.mjs`:** simulação por padrão (`--importar` pra gravar); idempotente pelo documento (`insert ... on conflict do nothing`); acesso via `admin.createUser` com e-mail já confirmado (não envia e-mail) e senha `HMAC(pepper, 6 primeiros dígitos)`; nunca troca a senha de conta existente; execução interrompida entre criar a conta e vincular é recuperada pela marca `marca_importacao` (hash do documento, pra o CPF não ir no token). Gravação em transação com `app.ator = importacao` (auditada).
- **Regras aplicadas:** documento repetido: fica a linha mais recente por "Cadastrado em", as outras vão pra `importacao.duplicatas` e o cliente ganha a pendência `documento_repetido`; sem e-mail, e-mail inválido, repetido ou já usado por outra conta: importa sem acesso; nascimento inválido (ano negativo, anterior a 1900 ou futuro): sem a data; telefone inválido: sem telefone; endereço: texto original sempre guardado, campos preenchidos quando dá pra ler, UF ausente em cidade atendida vira MG (`ufInferida`), o resto fica `endereco_revisar`; CNPJ vira `empresa`.
- **Zero à esquerda:** a coluna "só números" veio como texto; se vier número, o documento é recomposto pelo tamanho do tipo (teste com CPF começando em zero).
- **Contagens (homologação, 23/09/2026):** 3.294 linhas = 3.289 clientes + 4 linhas repetidas pra revisão + 1 sem CPF/CNPJ (não importada). 3.176 com acesso, 113 sem acesso (106 sem e-mail, 7 e-mail inválido). Pendências: 65 nascimento inválido (46 ano negativo, como na planilha, + 18 antes de 1900 + 1 no futuro), 13 endereço a revisar, 4 sem endereço, 3 telefone inválido, 4 documento repetido. Segunda execução: 0 criados, 0 erros.
- **Completar e-mail (Prime):** ação `completar_email` da function `conta` + `conta_completar_email`/`conta_vincular_usuario` (auditadas): grava o e-mail, tira as pendências de e-mail e cria o acesso na hora com a mesma regra; e-mail já usado é recusado.
- **Backup:** o plano free não tem backup pra baixar; `scripts/backup-homolog.sh` gera dump de dados (public + auth) em `~/.prime-dados/` (600). Feito logo depois da importação.
- **Revisão do Codex (B2/B7), corrigido com teste:** marca da importação estava em `user_metadata` (o usuário edita pelo próprio token) → agora em `app_metadata` (migrados os 3.176 usuários); senha errada apagava todos os tickets de login do usuário (derrubava um login correto em paralelo) → ticket preso à tentativa; `definir_senha` não conferia bloqueio (link de recuperação emitido antes do bloqueio trocava a senha) → confere; `redefinir_senha` ignorava erro do Auth → confere; `completar_email` em três passos sem retomada → conta órfã de queda anterior é reaproveitada (mesmo e-mail) ou apagada, o vínculo fecha atômico com `usuario_id is null` e a chamada concorrente perdedora apaga a conta que criou. Lock de sessão entre RPCs foi descartado (pool de conexões não garante a mesma sessão).

### B3. Casos de uso no banco
- **Domínio portado pra PL/pgSQL** (`privado.*`, migration `b3_dominio`): validações (`validacao.js`), calendário (`calendario.js`), pacote e desconto mensal (`pacote.js`), parcelas (`dinheiro.js`) e BR Code com CRC16 (`brcode.js`). Configuração vigente vem de `precos` (última `vigente_desde`) + `regioes` + `feriados`. Paridade provada por `scripts/testa-paridade.mjs`: casos oficiais da tabela, 400 pacotes aleatórios (inclusive erros e código), BR Code e validação de cliente idênticos entre JS e SQL. Única diferença intencional: o banco devolve `duracaoHoras` como número mesmo quando chega texto.
- **RPCs** (`b3_casos_de_uso`, security definer, `search_path = ''`, EXECUTE só pra usuário logado e pro papel de serviço): assinatura uniforme `(p_dados jsonb, p_chave text)`, resposta no formato de `docs/API.md`. Ator SEMPRE do JWT (`privado.ator()`): bloqueado vira público. Idempotência `operacao|ator|chave` com hash SHA-256 do conteúdo e `pg_advisory_xact_lock` por chave (duas chamadas simultâneas: a segunda espera e recebe o resultado da primeira). Erro de negócio: `raise` com `message = CÓDIGO`, `detail = mensagem`, `hint = detalhes JSON`; o adapter traduz. Escritas travam a linha (`for update`) e recalculam o status do pedido; todo caso de uso grava evento na mesma transação; `app.ator` local à transação alimenta a auditoria.
- **Cliente importado que agenda** usa o cadastro existente (dados do formulário atualizam nome, telefone, endereço; documento diferente do cadastrado = `DADOS_INVALIDOS`); cliente novo pelo site nasce vinculado ao usuário logado (a conta vem antes, pela function `conta`). CPF/CNPJ já cadastrado por outra conta = `DADOS_INVALIDOS`.
- **Confirmação manual** grava `confirmado_por` e `metodo = manual`; o webhook do Asaas (B4) chama a mesma função como ator `sistema`.
- **Documentos** (`b3_storage`): bucket privado `documentos-diaristas` (5 MB, jpg/png/pdf), upload só pela dona em `diaristas/<id>/<tipo>-<uuid>.<ext>` (policy), leitura só dona ou Prime por URL assinada de 5 min; `iniciar_cadastro_diarista` abre o rascunho vinculado à usuária antes do primeiro upload (rascunho vira papel `diarista`). Assinatura real dos bytes hoje só no adapter (mesma regra do mock); a Edge Function do B6 repete no servidor.
- **Adapter `supabase`** (`src/services/adapters/supabase.js`): cada caso de uso é uma RPC; id que não é UUID vira `NAO_ENCONTRADO` sem ir ao banco; anônimo sem EXECUTE vira `NAO_ENCONTRADO` em leitura e `ATOR_SEM_PERMISSAO` em escrita (como o mock). `api.js` escolhe por `ADAPTER` (do `ambiente.js` gerado no deploy).
- **Bateria de contrato** (`scripts/cenarios.mjs`) parametrizada: no Supabase a conta nasce no Auth (`contaNoBackend`) e o wrapper de teste mapeia sessões pra usuários fictícios por papel; o banco exige CPF/e-mail únicos de diarista (o mock não), então o wrapper dá identidade fictícia distinta por cadastro. `testa-b3` soma corrida de idempotência, corrida de atribuição, anônimo, eventos/auditoria e isolamento do bucket.
- **Bugs que a bateria pegou (corrigidos):** `texto[] || 'literal'` era lido como array literal (todas as mensagens de validação de pacote); variável `cpf` com o mesmo nome da coluna em `cadastrar_diarista` (42702); `pode_ver_pedido` devolvia NULL pra usuário logado sem cadastro e o `if not` não barrava (agora `coalesce(..., false)`).
- **Lint do Supabase:** 27 avisos `authenticated_security_definer_function_executable` são as RPCs de negócio, que por desenho rodam como definer e validam o ator por dentro (`privado.ator()`, dono, papel). Aceito; helpers ficam no schema `privado`, fora da API.
- **Limpeza de testes** apaga também a idempotência das chamadas fictícias (chave com o escopo do ator ou resultado citando id fictício). As 158 linhas de execuções anteriores foram removidas à mão (nenhum pedido real existia).
- **Revisão do Codex no fim do B3: NÃO EXECUTADA.** Motivo: limite de uso da conta do Codex ("try again at 9:44 PM") na hora do envio. As revisões de B1, B2 e B7 foram executadas e incorporadas. Refazer no início do próximo turno com a evidência de `testa-paridade` e `testa-b3`.

## Turno 2026-09-24: ajustes da cliente antes do B5 (ajustes-isa.txt + home-isa.txt, pasta OneDrive/Área de Trabalho/Prime_Limpeza)

### Fluxo de negócio (B) e preços (C)
- **Solicitação, não garantia.** Pedido: `solicitado -> disponibilidade_confirmada -> aguardando_pagamento -> confirmado` (+ `concluido`), com `recusado` (motivo obrigatório) e `cancelado`. Enviar o formulário não gera cobrança.
- **A cobrança nasce quando a Prime confirma a disponibilidade**, na mesma transação (`confirmar_disponibilidade`). `disponibilidade_confirmada` fica como estado próprio porque, com o Asaas (B4), emitir a cobrança vira chamada externa e o pedido pode parar ali.
- **Pagamento antecipado e integral** (substitui o 50/50): uma cobrança por diária (`parcela = 'diaria'`), vencendo até 14h do dia útil anterior (precos-prime.txt). "Pacote de uma vez" (`parcela = 'pacote'`) implementado e DESLIGADO em `precos.js` (`pagamento.pacoteDeUmaVez`).
- **Desconto mensal sobre o total do mês** (3 ou 4 diárias R$ 20; 5+ R$ 40; faixas não somam; por mês de calendário, cada mês com a sua faixa, nunca acumulando entre pedidos). Como cada diária é paga separada, o desconto do mês entra inteiro na cobrança da **última diária daquele mês**. Cancelar ou remarcar uma diária recalcula as cobranças **pendentes** (se o mês cai abaixo de 3, o desconto some); cobrança já informada ou paga não muda (acerto manual).
- **Diária só vira `confirmado` com a cobrança dela (ou a do pacote) confirmada**; o pedido vira `confirmado` no primeiro pagamento confirmado.
- **Imprevisto:** substituir a profissional = "Trocar" na aba Atribuir; remarcar = "Remarcar" na agenda (a cobrança pendente acompanha o novo prazo); estorno = registro manual (`registrar_estorno`, motivo obrigatório, só pagamento confirmado): a diária coberta, se futura, é cancelada. Nada de prazo inventado.
- **Preferência por profissional:** campo opcional (até 120 caracteres) no passo da data, com o texto do item 13; vai pro pedido e aparece pra Prime nas abas Solicitações e Atribuir. Não designa ninguém.
- **Mensagens novas** (`mensagens.js`, WHATSAPP.md): solicitacao_recebida, disponibilidade_confirmada, solicitacao_recusada, pagamento_confirmado, lembrete_prazo_pagamento (9h do dia do vencimento, só se pendente e antes das 14h), lembrete_vespera, profissional_a_caminho, atendimento_iniciado, atendimento_finalizado (pesquisa de satisfação interna), obrigado_avaliacao, remarcacao, estorno_registrado, cancelamento. Saíram pedido_recebido, entrada_confirmada, cobranca_dia.
- **Banco:** migrations novas `20260924100000_fluxo_solicitacao` (+ correção `100100`); nenhuma anterior editada, nenhum registro alterado; valores antigos (`aguardando_entrada`, `ativo`, `entrada`, `dia`) continuam aceitos só pra histórico (não havia pedido no homolog). Nova linha em `precos` (vigente 24/09) com `pagamento`. Paridade JS x SQL inclui as cobranças.
- **Bug achado pela bateria (corrigido):** o CHECK `entrada + restante = total` dava NULL com só um lado preenchido e passava (mesma classe do `'{}'` no B1). Varri os CHECKs novos (recusa, estorno, parcela): todos avaliam sem NULL.
- **Autoagendamento:** a calculadora virou a etapa 2 (Tipo, Diária, Endereço, Data, Contatos, Resumo), pra "CALCULAR MINHA DIÁRIA" cair nela sem pedir endereço antes; o valor aparece sem deslocamento até o endereço. Botão final "Enviar solicitação" leva ao acompanhamento (sem Pix).
- **Posicionamento:** "profissional selecionada/designada" pra cliente; "diarista" continua em nomes técnicos, banco e painel. Cadastro de profissionais = "Trabalhe com a Prime". Avaliação = "Pesquisa de satisfação", resultado só no painel. `verifica-texto` passou a barrar as expressões do item 22 e o 50/50 em texto ao cliente (JS, home, 404, templates).

### Login (A)
- Campo único "CPF, e-mail ou celular"; tipo detectado no servidor (Edge Function `conta`, mesma regra de `detectarIdentificador`): `@` = e-mail; 11 dígitos com CPF válido = CPF; 10/11 dígitos (ou +55) = celular. CNPJ não é identificador.
- **Senha no Auth continua sendo HMAC(pepper, 6 primeiros do documento)**: por e-mail ou celular a senha digitada vai direto pro Auth; pelo CPF a function confere a data de nascimento (comparação em tempo constante) e entra com os 6 dígitos. Senha própria (`perfis.senha_propria`) vale pras três vias; trocar ou recuperar marca própria; a Prime redefinir volta à regra padrão.
- **Bloqueio progressivo por conta** (as três vias somam, `acessos.user_id`) ou pelo identificador quando não resolve, mais o limite por IP. Toda tentativa grava `identificador` e `tipo_identificador`.
- **Mensagem sempre genérica** (senha errada, CPF sem nascimento, celular de mais de um cliente, inexistente, CNPJ), com espera uniforme de 250 a 400 ms quando não há ida ao Auth (sem diferença de tempo que revele cadastro). A mensagem já orienta usar e-mail ou celular.
- **Cliente nova:** sem senha escolhida e sem confirmação de e-mail; pessoa física informa CPF e nascimento; a function cria conta (`admin.createUser`, e-mail confirmado) e cadastro juntos (compensa apagando a conta se o cadastro falhar); limite de 10 cadastros por IP por hora. **Bug achado pelo testa-auth (corrigido):** a validação depois de criar a conta achava o próprio e-mail "em uso" (migration `20260924110100`).
- Quem criou conta pelo site antes desta regra ficou com `senha_propria = true` (só havia usuários de teste).
- "Esqueci minha senha" virou a dica literal da cliente; quem tem senha própria fala com a Prime (WhatsApp manual). O fluxo `?modo=nova-senha` segue pra links de recuperação já emitidos.

### Home (D, E)
- Estrutura e textos do item 23 de home-isa.txt, literais. Segurança (item 11) junto de "O que a Prime não realiza" (visível); preferência (item 13) logo depois do passo a passo. "O que a Prime não realiza" e FAQ em `details/summary` (teclado nativo, foco visível, recolhidos).
- Script inline e `onclick` da home saíram pra `src/ui/home.js` (módulo): a CSP não precisa mais de hash pra home.
- "FALAR COM A PRIME" usa o WhatsApp de `prime.js`; enquanto estiver `PREENCHER`, leva aos contatos do rodapé (`#contato`) e mostra aviso claro. No header fica visível em qualquer largura (em ≤ 1320 px os links vão pro menu).
- Avaliações: componente pronto (`src/config/depoimentos.js`), oculto sem depoimento real. Nenhum placeholder.
- Imagens: as que já estavam no repo (inclusive `extras-nao-utilizados/voce-ja-passou.webp` e o quadro do vídeo do hero no card de condomínio; PENDÊNCIA de foto própria).
- Overflow em 320 px e heading-order corrigidos (Lighthouse acessibilidade 100). Referência visual do comparador passou a ser `docs/shots/home-v2/`.

### Revisão do GPT (2 chamadas, 24/09 à noite; a primeira tentativa bateu o limite de uso do Codex e ficou pra 20h52)
- **Home x item 22:** alcance declarado (index.html e depoimentos.js). Nenhuma expressão proibida, garantia ou inversão do item 23. Um apontamento: o FAQ "Como funciona o pagamento?" diz "depois que a Prime verifica a disponibilidade". **Mantido:** é o bloco B de ajustes-isa.txt ("só então vem a cobrança") e o passo 04 do item 12; o resumo que mandei pro GPT não incluía isso.
- **Fluxo B x briefing:** 5 achados, todos reais e corrigidos com teste na bateria de contrato (roda em mock, http e Supabase; os 4 testes de negócio falham no código antigo) e migration `20260924120000`:
  1. `registrarEstorno` no JS gravava `estornado` e o cancelamento da diária sobrescrevia pra `cancelado` (a resposta mentia). Cancelar só derruba cobrança `pendente`/`informado`.
  2. Desconto do mês em dobro: com a cobrança da última diária já confirmada com R$ 20, remarcar outra pra depois dela dava R$ 20 de novo à nova última. O recálculo desconta o que já foi concedido em cobrança informada/confirmada do mês; o total do pedido passou a acompanhar as diárias ativas.
  3. Ordem de locks no SQL (pagamento → pedido em confirmar/estornar; atendimento → pedido em transicionar; pedido → atendimentos → pagamentos em cancelar) podia dar deadlock entre confirmação e cancelamento simultâneos. Agora todo mundo trava `pedido` primeiro, depois `atendimento`, depois `pagamento`.
  4. Remarcar mantinha a taxa de sábado/feriado da data antiga: agora recalcula `taxaDiaCentavos`/`valorDiaCentavos` pela data nova e a cobrança pendente acompanha.
  5. Remarcar uma diária já designada podia cair em cima de outra diária da mesma profissional (só checava o próprio pedido): mesma regra de sobreposição de `atribuirDiarista`.
  Descartado: nada.

## Turno 2026-09-24 (noite): B5, B6, F2, I1

### B5. Automações reais
- **O mesmo motor do mock no servidor.** A Edge Function `notificacoes` importa `src/automacoes/motor.js`, `gatilhos.js` e `mensagens.js` sem porte (o bundle do Supabase segue o import pra fora de `supabase/functions`). O repositório do motor lê pelos `privado.j_*` (mesmo formato camelCase da API) e grava só `notificacoes` e `eventos`. Motivo: uma regra de notificação só, testada nos dois lados; portar pra PL/pgSQL duplicaria 350 linhas sem ganho (notificação não decide dinheiro nem permissão).
- **Conexão direta** (`SUPABASE_DB_URL`, postgres.js) com transação: um evento por transação, sob `pg_advisory_xact_lock` (dois workers não intercalam eventos; a ordem da fila vale) e `for update skip locked`. Envio também um por transação, com a linha travada. Cancelamento pelo motor nunca sobrescreve notificação que já saiu (`on conflict ... where status = 'pendente'`).
- **Falha não trava a fila:** evento que falha ganha backoff (1, 5, 15, 60 min) e na 5ª vai pra `erro`; notificação com falha retentável (rede, 429, 5xx) volta pra `pendente` com backoff (1, 5, 15 min) e na 4ª vai pra `erro`; erro definitivo (400, telefone inválido, template quebrado) vai direto. Tudo com mensagem visível (`listarNotificacoes`, `listarEventos`, `saudeNotificacoes`); a Prime reenvia/reprocessa (`reenviar_notificacao`, `reprocessar_evento`, idempotentes). Id que não é UUID dentro de evento falha o evento (dado corrompido) em vez de sumir calado.
- **Provedor travado no código:** `PRODUCAO_REFS` (vazio) em `supabase/functions/_shared/provedores.js`; fora dele o provedor é SEMPRE `simulado`, seja qual for `PROVEDOR_NOTIFICACOES`. `meta_cloud` implementado com `payloadMeta.js` e testado contra servidor fake; `email` (formato Resend) implementado e desligado (`EMAIL_HABILITADO = false`).
- **pg_cron + pg_net:** `prime-notificacoes` a cada minuto chama a function com `x-worker-segredo` (segredo e URL no Vault, gravados por `scripts/configura-worker.mjs`, nunca em migration). Cada notificação já nasce com o horário da regra (véspera 18h, prazo 9h), então o job de minuto envia na hora certa; `prime-lembrete-vespera` (21h UTC) e `prime-lembrete-pagamento` (12h UTC) ficam nomeados pra deixar a regra visível e garantir a rodada; `prime-varredura-fila` (10 min) redispara se houver fila atrasada; `prime-limpeza-cron` apaga histórico do cron com mais de 7 dias.
- **"Cobrança da 2ª parcela" da spec não existe mais:** pagamento antecipado e integral (24/09). O equivalente é o `lembrete_prazo_pagamento` (9h do dia do vencimento). "Pedido de avaliação após finalizar" é o `atendimento_finalizado` (imediato, com o link da pesquisa).
- **Relógio adiantado só pro teste:** o worker aceita `agora` fora de produção e sempre com `escopo` (até 20 UUIDs de pedido/diarista); o envio fica restrito ao escopo. Fora de produção, erro 500 devolve o detalhe (quem chama já tem o segredo).
- **Bug meu, pego pelo teste de homologação:** parâmetro `$n::jsonb` era serializado duas vezes pelo postgres.js (Deno) e virava escalar; o pg (Node) não faz isso. Agora `$n::text::jsonb` nos dois. O `testa-b5` falha no código antigo (worker 500 "cannot extract elements from a scalar").

### B6. Documentos das diaristas
- **Bucket sem nenhuma policy pro front.** Upload e leitura só pela Edge Function `documentos` (papel de serviço). Motivo: com upload direto, a validação de bytes ficava só no navegador (contornável). Caminho novo `<user_id>/<diarista_id>/<tipo>-<uuid>.<ext>` (spec: "por user_id").
- **Upload:** a function exige Content-Length ≤ 5 MB + 64 KB antes de ler o corpo, confere token, cota (30 envios/hora por usuária, `configuracao.documentos`, gasta mesmo em tentativa inválida), tipo, tamanho e magic bytes com a MESMA `validarArquivo` do front (`src/domain/validacao.js`, importada no bundle), grava e registra. `registrar_documento` só aceita objeto que existe no caminho da dona e lê tipo/tamanho do `storage.objects.metadata` (não do chamador); guarda o SHA-256.
- **Leitura só da Prime** (`abrir_documento`): cada abertura vai pra `acessos_documentos` (quem, papel, quando); URL assinada com validade de `configuracao.documentos.validadeUrlSegundos` (120 s). A dona não lê mais o arquivo do servidor: a prévia no cadastro vem do arquivo escolhido nesta página (cache preso à usuária); depois de recarregar, "Sem prévia".
- **Retenção** (`prime-retencao-documentos`, 4h de Brasília): arquivos de reprovadas há mais de 90 dias (padrão, PENDENCIAS) e documentos substituídos saem do bucket pela Storage API (delete direto em `storage.objects` é bloqueado); `arquivo_apagado_em` marcado e o histórico da diarista (auditado) registra.
- **Reprovar exige motivo no banco e no JS** (antes só a tela exigia). Teste novo na bateria de contrato (falha no código antigo nos três adapters).
- **Bug pego pela bateria:** `registrar_documento` com variáveis `tipo`/`mime` iguais a colunas (42702), mesma classe do B3; migration `210100` com prefixo `v_`. Varri as funções novas do B5/B6: sem outro caso.
- **Revisão do Codex (B6 + worker do B5), 4 achados, todos corrigidos:** (1) repetir o upload com a mesma chave dava `CONFLITO_IDEMPOTENCIA` porque o caminho novo entrava no conteúdo: agora o conteúdo é o hash do arquivo e o objeto da repetição é apagado (teste falha no antigo); (2) a compensação apagava o arquivo mesmo se o registro tinha sido gravado e só a resposta se perdeu: agora só apaga se não há registro (sem teste automático: exige derrubar a rede no meio); (3) `formData()` lia corpo de qualquer tamanho antes de validar: Content-Length obrigatório e cota antes da leitura (no homolog o gateway já recusa corpo grande em pedaços com 503; teste confere que nada é gravado); (4) o relógio adiantado do teste andava a fila GLOBAL de eventos: agora só o envio (com escopo) usa o relógio do teste. Descartado: nada.

### F2. Front no backend real
- **Preview com `DADOS=supabase`** (padrão do `monta-dist`); local e testes seguem mock. Tabela de preços: no modo Supabase o `precos.js` troca os valores de `PRECOS` pela linha vigente do banco (leitura anônima já liberada no B1); se o banco não responder em 5 s fica o arquivo, e o banco recalcula de todo jeito.
- **Cliente nova pelo site:** a solicitação chama a ação `cadastrar` da `conta`, que agora já devolve a sessão (entra pela mesma via do login, com log em `acessos`); o pedido nasce logado. **Diarista nova:** conta com e-mail e senha própria no passo 1 do cadastro (ação `cadastrar_diarista`: conta + rascunho + sessão), porque o upload do B6 exige a dona logada. Limite de cadastros por IP vale pros dois.
- **Painel:** abas novas Clientes (`listar_clientes`: busca, pendência com contagem, sem acesso, último acesso, bloqueio; completar e-mail, bloquear/desbloquear e redefinir senha pela `conta`, auditados) e Preços (`editar_precos`, só `prime_admin`: nova versão da tabela a partir da vigente, só os valores em centavos da lista permitida, 0 a R$ 1.000; histórico `listar_precos`). Notificações mostra a fila real (saúde, erro, reenviar, reprocessar). Deslocamento por cidade (tabela `regioes`) não entrou na edição (PENDENCIAS).
- **Estados:** carregando (já existia), erro de rede ou do servidor com "Tentar de novo" em todas as telas (`telaErro`), sessão expirada em ação ou carregamento leva pra entrada da área (`sessaoExpirada`), além da guarda de rota que já conferia a sessão ao abrir.
- **Reprovar cadastro:** motivo obrigatório no banco e no JS (B6).
- **Teste achou (erro do teste, regra certa):** integral de 8h no mesmo dia de uma manhã da mesma profissional é recusado na atribuição; o teste passou a usar outro dia.
- **Guarda nova nos testes de homologação:** telefone fictício que exista na base real aborta o teste (celular repetido derrubaria o login por celular da cliente real durante o teste). Hoje nenhum colide.

### I1. Homologação pra cliente
- `scripts/demo-homolog.mjs`: 3 contas `@prime-homolog.example` (domínio reservado, não entrega e-mail): `isa.admin` (prime_admin), `diarista.demo` (aprovada, com documentos) e `cliente.demo` (residencial), e 4 pedidos em estados diferentes. Senhas, CPFs e telefone fictícios gerados uma vez e guardados no `~/.prime-env`; credenciais só no terminal. Idempotente.
- `--reset` apaga só o que está ligado às contas de demonstração (metadado `demo`, linhas `ficticio`) e aborta se alguma delas estiver ligada a cliente importado ou não fictício; o teste confere o hash dos importados antes e depois.
- URL estável: `https://turno-2026-09-23.prime-limpeza.pages.dev/` com `X-Robots-Tag: noindex`.
- **Revisão do Codex (F2 + I1, antes da resposta final), 3 achados, todos corrigidos:** (1) o reset da demonstração (e a limpeza dos testes, mesma classe) desfazia a atribuição e apagava avaliação/eventos de pedido que não era do escopo se a diarista fictícia estivesse nele: agora só mexe nos pedidos do escopo e ABORTA se a diarista estiver em pedido alheio (teste no I1 falha no antigo); (2) o telefone guardado da cliente demo não era revalidado: se virar de outra cliente, troca sozinho (teste); (3) conta criada com a entrada falhando logo depois (limite, rede) deixava só "e-mail em uso": agora a function devolve sem sessão e a tela manda entrar com o e-mail e a senha (sem teste automático: exige derrubar a entrada no meio). Descartado: nada.

## Turno 2026-09-28: fase 2, bloco 1 (A0, Q1, S1, S2, L1)
Branch `turno/2026-09-28` a partir da main com o PR #1. Preview: `https://turno-2026-09-28.prime-limpeza.pages.dev/`. Backup do homolog antes das migrations (`~/.prime-dados/backup-homolog-20260928-194308.sql`).

### A0. Troca de senha obrigatória
- **Marca no `app_metadata`** (`troca_senha_obrigatoria`), que o usuário não edita, lida AO VIVO em `auth.users` (não do JWT): `privado.papel()` devolve NULL enquanto ela existir, então toda RPC e policy trata a conta como sem papel. A function `conta` confere a mesma marca em `exigirPrime` (a revisão do plano apontou que as ações de conta não passam por `privado.papel()`). Só a conta criada pelo `a0-admin-cliente.mjs` nasce com a marca.
- **Trocar a senha invalida a renovação da sessão atual** (comportamento do Auth, já coberto pelo `testa-auth`): na troca obrigatória o front entra de novo com a senha nova. Pego pelo Q1 no navegador (o painel caía na entrada na primeira renovação). Observação: em Minha conta a troca comum tem o mesmo efeito (a sessão vale até o token vencer, ~1h); não mexi (fora do bloco).
- **E-mail pedido já é de cliente importada** (achado pela varredura de dado pessoal antes do deploy): o script aborta se o e-mail for de conta de cliente ou profissional e o e-mail não fica no repo (argumento ou `ADMIN_CLIENTE_EMAIL` no `~/.prime-env`). A0 BLOQUEADA até a decisão (PENDENCIAS). A demonstração passou a usar `admin.demo@prime-homolog.example`.

### S1. SEO técnico
- **Fonte única** `src/config/seo.js` + `scripts/gera-seo.mjs` (bloco `<!-- seo -->` no head das 6 páginas públicas, `sitemap.xml`, `robots.txt`), idempotente; `scripts/verifica-seo.mjs` é o aceite (roda na suíte). Motivo: 6 páginas com title/description/canonical/OG/JSON-LD escritos à mão divergiriam.
- **Campo da empresa `PREENCHER` não é publicado**: o gerador omite do JSON-LD e lista como pendente (publicar a palavra PREENCHER seria pior do que omitir). Telefone e Instagram são os já publicados no rodapé. `areaServed` vem de `regioesAtendidas` (mesma fonte da tabela `regioes`).
- **Canonical** no domínio sem www (PENDENCIAS). Páginas públicas: home, solicitação, cadastro de profissional, certidão de antecedentes, privacidade e termos.
- **Imagem OG** 1200x630 (`scripts/gera-og.mjs`): logo branco, foto de limpeza residencial e o dourado da home, só assets do repo.
- **Alt:** fotos com texto descritivo (conferido olhando cada foto); ícones ao lado de texto seguem `alt=""` (decorativos, WCAG).

### S2. Redirecionamentos
- **Levantamento:** o site antigo não tem sitemap nem robots (200 com página "não encontrada"); `scripts/levanta-urls-antigas.mjs` rastreia até profundidade 3 a partir da home e das rotas conhecidas e grava `docs/urls-antigas.txt`. Hrefs de template JS (`${...}`, `'+href+'`) são ignorados.
- **`_redirects`:** `/autoagendamento` -> `/autoagendamento/`, `/cliente/autocadastro(/)` -> `/autoagendamento/` (a conta da cliente nasce na solicitação), `/diarista/autocadastro(/)` -> `/diarista/cadastro/`. Vai no deploy desde já (os caminhos antigos não existem no site novo). Testado no preview: 301 direto, destino 200, query preservada, sem cadeia.

### L1. Legal e LGPD
- **Páginas estáticas** (`privacidade/`, `termos/`): texto no HTML (legível sem JS e pelos buscadores), layout por `src/ui/paginas/legal.js`. Links no rodapé de todas as páginas.
- **Versão:** tabela `documentos_legais` (vigente = a mais recente já em vigor) + `VERSAO_LEGAL` no front; o banco recusa aceite de outra versão. Cliente nova: a function `conta` confere a versão ANTES de criar a conta (falhar depois deixaria cadastro órfão) e grava o aceite. Profissional: trigger no envio do cadastro (`aceite_termos_em`). Quem tem conta e não aceitou a versão vigente vê um modal (`dialog` nativo; Esc não fecha) em Minha conta, na solicitação e na agenda.
- **Consentimentos** só de inserção (estado atual = linha mais recente); repetir o mesmo valor não cria linha. Marketing só pra cliente, localização só pra profissional (CHECK no banco).
- **Exclusão:** a cliente pede; a Prime (só `prime_admin`) executa pelo painel -> function `conta` -> `conta_executar_exclusao` anonimiza cadastro, acessos, avisos, eventos, cache de idempotência e a AUDITORIA (que guardava a linha inteira do cadastro), revoga marketing, bloqueia, e a function apaga o usuário do Auth. Preserva pedidos, diárias, pagamentos e o documento (obrigação fiscal; PENDENCIAS: advogado). Recusa se houver diária/pagamento em aberto ou aviso na fila do worker. Retomável: se apagar o usuário falhar, chamar de novo termina.
- **Flags** (princípio 1.2): `config_flags` lida no servidor (`privado.flag`), alternada só por `prime_admin` e auditada; aba Configurações no painel. Nascem `lgpd_portal_titular` e `lgpd_reaceite_termos`, ligadas.
- **Teste de versão nova** roda dentro de uma transação desfeita (a versão de teste nunca fica visível pra ninguém de fora).

### Q1. Qualidade
- **Matriz** requisito x teste no cabeçalho de `scripts/testa-q1-preview.mjs`; o que f2/b2/i1 já cobriam não foi duplicado. Centavo ímpar: tabela com R$ 175,01 numa transação desfeita (não muda o preço de ninguém).
- **Fontes no próprio site** (`assets/fonts`, mesmos arquivos variáveis do Google Fonts, OFL, latin e latin-ext com o mesmo `unicode-range`), com preload da Inter. Tira duas origens do caminho crítico e o Google da lista de terceiros. A home ficou idêntica pixel a pixel acima do rodapé (conferido); a referência `docs/shots/home-v2` foi refeita só por causa dos links legais no rodapé.
- **Salto de layout (CLS) nas páginas montadas por JS:** o rodapé aparecia no primeiro quadro e era empurrado; e a abertura chegava depois dos dados. `main.pagina` com `min-height:100vh` e abertura provisória no primeiro quadro (painel, solicitação, acompanhamento, pagamento, avaliação, agenda e cadastro de profissional). Lighthouse mobile no preview: solicitação 74 -> 95, Minha conta 76 -> 95, painel 72 -> 95.
- **Imagens:** não gerei srcset (o Lighthouse aponta só 24 KiB na home, performance 95). Fica pra quando houver foto nova.

### Revisão do GPT (2 chamadas: crítica do plano e revisão do resultado)
- **Plano:** entraram a marca de troca também no `exigirPrime` da function, script do A0 reexecutável e que só apaga a conta antiga depois de validar a nova, `EXTENSOES` do monta-dist (xml/txt/_redirects), rota mantida sem redirecionar pra si mesma, aceite e versão conferidos no servidor, exclusão mapeando Auth/auditoria/retomável, matriz do Q1 e teste de resposta perdida, Lighthouse com sessão. Descartado: push da branch por entrega (regra da Gabrielle: push só com pergunta).
- **Resultado, corrigido com teste (migration `20260928120000`):** (1) cadastro e aceite em transações separadas deixavam cadastro órfão: agora `conta_cadastrar_cliente_com_aceite` numa transação e a compensação só apaga a conta se o cadastro não existir (resposta perdida vira sucesso); (2) consentimento na tela: resposta atrasada podia inverter a escolha mais nova: uma requisição por vez e a caixa mostra o valor confirmado pelo banco; (3) exclusão deixava texto livre: motivo do pedido do titular, observação, motivo de recusa/cancelamento e tentativas de login sem conta resolvida saem (teste no `testa-l1`); (4) corrida da exclusão com agendamento já autorizado: triggers impedem que cadastro anonimizado volte a ter dado pessoal ou ganhe pedido (teste); (5) limpeza de teste com escopo largo: fictícias anonimizadas só na limpeza completa; (6) teste de overflow engolia timeout; (7) Lighthouse aceitava `/painel/entrar/` como painel: caminho exato; (8) falha ao ler a situação legal sumia com o bloco de privacidade: aviso com "Tentar de novo".
- **Descartado:** chave de operação no consentimento (a serialização na tela resolve a reordenação; a revogação por "SAIR" nasce no servidor, bloco 2); L1 no adapter http (ninguém usa o http fora da bateria de contrato; o painel real já tem métodos só do supabase); mock sem distinção admin/atendimento (demonstração); limpeza de `C:`/`\\wsl` no tmp (lixo do chrome-launcher no WSL, mesmo padrão do `lighthouse-a11y`); `catch` vazio do marketing no cadastro (falha segura: sem registro, sem marketing; a cliente vê o estado real em Minha conta).
- **A suíte pegou depois:** a troca em massa do Google Fonts pelo preload quebrou o `404.html` (o regex pegou o prefixo de dentro de um `document.write`; `testa-b0-preview`), corrigido; `EXTENSOES` do monta-dist liberava .txt/.xml em qualquer pasta (um `painel/notas.txt` iria pro ar; `testa-b0`): agora só `sitemap.xml`, `robots.txt` e `_redirects` da raiz; tabelas novas sem RLS FORÇADA (`testa-rls`), corrigido na mesma migration; e a limpeza do `testa-auth` não apagava a tentativa com o CNPJ de teste (acumulava entre execuções até bloquear), corrigida.

### Ajuste pedido pela Gabrielle (28/09): equipe da Prime pela entrada da cliente
- **`entrar/` aceita conta `prime_admin` ou `prime_atendimento`** e leva pro painel; com troca obrigatória de senha pendente, leva pra `painel/entrar/` ("Crie sua senha", e o banco continua negando tudo até trocar). `painel/entrar/` segue igual. Sem mudança no servidor: a function `conta` já autenticava qualquer conta pelo e-mail na área da cliente; quem recusava era a tela. Falha continua com a mesma mensagem genérica. Diarista pela entrada da cliente continua recebendo "use Sou diarista" (só aparece com a senha certa). No mock, as credenciais de demonstração da equipe também entram por `entrar/`.

## Turno 2026-09-28 (noite): fase 2, bloco 2 (AUT, motor de automações)
Migration `20260929100000_aut_motor.sql` (backup antes: `~/.prime-dados/backup-homolog-20260928-223013.sql`).

- **Motor v2 em JS, o mesmo no mock, no fake-api e no worker** (decisão do B5 mantida): `src/automacoes/v2/{tempo,variaveis,motor}.js` sobre uma "porta" de IO (`porta-repo.js` no mock e testes; `supabase/functions/_shared/porta-pg.js` no Postgres). Motivo: uma regra só, testada com relógio simulado sem banco (`testa-aut`, 22 casos) e de novo no Postgres (`testa-aut-homolog`). O motor antigo (`motor.js`, `gatilhos.js`, `mensagens.js`, `_shared/worker.js`) saiu; a tabela `notificacoes` fica como histórico (as pendentes foram canceladas com motivo na migration).
- **Regras e templates como dado** (`automacao_regras`, `templates` versionados), semente gerada do catálogo (`src/automacoes/catalogo.js` + `scripts/gera-seed-automacoes.mjs`); `testa-aut-homolog` confere banco = catálogo. Texto com variáveis por nome (`{{nome}}`) pra edição; pra Meta vira `{{1}}...` na ordem de aparição (`paraMeta`). Versão editada = `<codigo>_v<n>` na Meta.
- **Lembretes com data vêm da varredura da agenda** (horizonte de 2 dias) sobre o estado atual, não do evento: remarcação gera marco novo (a velha é cancelada pelo evento e, se escapar, pela revalidação), ciclo perdido que ainda vale é recuperado, e a chave única impede repetir. Eventos criam só as imediatas e as "depois de X".
- **Envio em duas fases** (revisão do plano pelo GPT): transação 1 trava a execução (`FOR UPDATE SKIP LOCKED`), revalida, aplica janela, consentimento e limite, renderiza e grava a mensagem "enviando"; o provedor é chamado fora da transação; transação 2 grava o resultado. Execução parada em "enviando" por 10 min vira `falhou` com "resultado incerto" e aviso I08, **sem reenviar**. Resposta da Meta sem id também não retenta às cegas.
- **Regras globais** (AUT.2): silêncio 20h-8h e domingo/feriado valem no agendamento e de novo no envio (reenvio e "enviar agora" também). Exceção só pra `doDia` (C08, C09, C10, D06: atendimento do próprio dia) e interno (equipe). Validade por execução: adiar nunca manda depois da diária/prazo (obsoleta). Relacionamento (M01-M03) vale até 3 dias depois, pra caber o adiamento de domingo.
- **Limite diário com reserva atômica** (`automacao_limites`, insert/update condicional): testado com 10 reservas simultâneas (passam 3). **Consentimento** relido a cada tentativa e canal, sob a mesma trava do `definir_consentimento` e do SAIR.
- **Fallback:** canal indisponível ou falha definitiva passa ao próximo; o último é o painel, com "Enviar manualmente para <nome> (<telefone mascarado>)". Marketing nunca cai no painel e sem consentimento vira `ignorada`. E-mail desligado (`EMAIL_HABILITADO`) conta como canal indisponível.
- **Resumos da equipe (I06/I07)** calculados na hora do envio (pego pela bateria: calcular na varredura perdia os números no envio).
- **Webhook do WhatsApp** pronto e desligado (503 sem segredos); lógica pura testada em Node com as RPCs reais. **SMTP genérico** (`provedorSmtp`, interface do nodemailer) testado contra servidor SMTP falso; e-mail em HTML no visual da marca (`email-html.js`, texto escapado).
- **Integração L1:** revogar marketing (Minha conta ou SAIR) gera a confirmação única C16 no canal revogado (trigger em `consentimentos`); exclusão da titular cancela o agendado e apaga texto e destino das mensagens (trigger em `clientes`); "Baixar meus dados" traz as mensagens.
- **Painel** (aba Automações, só no backend real; o mock segue com a lista de compatibilidade): regras com métricas, liga/desliga, horário/atraso nos limites (o banco confere de novo), ordem dos canais, "Testar" (contato fictício da config, sai na hora, sem janela), editor com autocompletar depois de `{{`, prévia com exemplo, bloqueio de variável inválida e regra da Meta, histórico e restaurar; linha do tempo por cliente/pedido/profissional/regra com destino mascarado e ações cancelar/enviar agora/reenviar (auditadas, idempotentes); eventos com erro com "Processar de novo".
- **Testes do mock no navegador com relógio fixo** (11h de hoje em Brasília) via `scripts/pw.mjs`: sem isso, rodar à noite adia as mensagens pro silêncio (regra certa, teste dependente da hora). Preview segue no relógio real.
- **Tolerância de 5 s** na busca de vencidas no Postgres: o horário "na hora" vem do `now()` do banco e o worker pode estar um pouco atrás (0,6 s medido); sem isso a mensagem imediata esperava o próximo minuto.
- **Achados meus durante o bloco:** recorte que apagou `ROTULOS_PENDENCIA` e a lista de eventos com erro do painel (F2 pegou); editor abrindo no canal e-mail em vez do WhatsApp (teste do painel pegou); limite de cadastros por IP acumulando no F2 (zerado no início do teste, como no testa-auth).

## Turno 2026-09-29: agendamento v2 (spec-agendamento-v2.txt + 31 itens da cliente)
Migrations `20260930100000_agendamento_v2.sql`, `20260930100100_agendamento_v2_templates.sql`, `20260930100200_horarios_trabalho_painel.sql` (aditivas; `turno` fica nullable e deprecated).

- **Fonte das regras de duração e das condições: o sistema antigo da Prime** (autoagendamento do site atual), lido em 28/09 só com GET (nenhum formulário enviado, nenhuma conta criada; página guardada fora do repo). Decisões da Gabs por cima da spec: horários 08:00 até 18:30 menos a duração (sem tabela provisória de hora em hora); **sem conversão de cômodo em m²**: a sugestão é a menor carga cujo limite comporta a metragem E o total de cômodos, com as tabelas separadas de residencial e empresarial do antigo (6h residencial com 80 m², não o "70" do texto); preços da tabela oficial (o antigo está desatualizado); desconto só por mês; agenda até 120 dias; cupom fora; o "+2h" do antigo virou só o aviso discreto do item 9.
- **Domínio:** `src/domain/agenda.js` (estimarDuracao, validarSolicitacao, datasDaAgenda, cotarSolicitacao) e `src/domain/horario.js` (hora de início, duração, sobreposição pelo intervalo real, rótulo "08:30 às 12:30", horários de início). Espelho no banco (`privado.estimar_duracao`, `privado.cotar_solicitacao`); `testa-paridade` compara 400 solicitações aleatórias (~100 válidas) e os casos da decisão.
- **Três modos de agenda:** única, várias datas escolhidas (até 12, sem repetir) e recorrente (semanal, quinzenal, mensal, com deslocamento de dia não atendido). Hora de início por diária (a mesma pra todas ou individual). Todas as datas dentro de 120 dias.
- **Endereço do atendimento no pedido** (`pedidos.endereco`), não no cadastro (Codex, crítica do plano): a solicitação não sobrescreve o cadastro e listagens/mensagens usam o do pedido.
- **Solicitação sem login pela function `conta` (ação `solicitar`)**, tudo numa transação no banco (`conta_solicitar`): CPF/CNPJ já cadastrado vincula ao cadastro existente sem sobrescrever (o digitado fica em `pedidos.dados_informados` e aparece no painel); cadastro novo nasce sem acesso e a function cria o acesso depois pela regra padrão; e-mail já usado por outra conta vira pendência `email_em_uso`. A resposta é sempre `{enviado: true}` (não revela se o CPF existe). Falha do Auth que não seja "e-mail existe" devolve erro e o navegador repete com a mesma chave (o banco devolve o mesmo resultado). Logada: RPC `solicitar_atendimento`, cadastro intocado (edição só em Minha conta).
- **Valor calculado no servidor** na revisão (`cotar_solicitacao`, pública, não grava) e conferido de novo no envio (`valorEsperadoCentavos`): se a tabela mudou no meio, recusa com `precoMudou` e a tela mostra o valor novo.
- **Condições do atendimento** versionadas em tabela própria (`condicoes_atendimento`: a `documentos_legais` usa a versão como chave dos aceites de termos e as duas versões podem cair no mesmo dia); aceite gravado no pedido (`aceite_condicoes`); servidor recusa sem a versão vigente. Página `/condicoes/` com o texto; o modal da revisão lê a mesma página; o escopo de cada serviço vem de `src/config/agendamento.js` (mesma fonte do "Ver detalhes").
- **Horário real em tudo que usava turno:** sobreposição de profissional (atribuir e remarcar), remarcação por hora, confirmação de disponibilidade com ajuste de hora por diária, painel/agenda/Minha conta/acompanhamento/agenda da diarista, lembrete da véspera e check-in atrasado (marco `data:hora`), templates com `{{horario}}` ("das 08:30 às 12:30"; versões novas no banco). Diária antiga sem hora: gatilho no banco preenche pelo turno (backfill 08:00/13:00, duração da carga + horas extras antigas).
- **Tela:** 6 etapas na barra ("Etapa X de 6") e 10 telas (os passos 10 a 12 da cliente ficam na revisão), cards leves com check e contorno, contadores de 44 px, calendário próprio com teclado, horários em botões, painel lateral/folha inferior com `<dialog>`, fundo rosé claro, marca d'água a 4%, botão de avançar fixo no rodapé no celular. Rascunho sem CPF e nascimento. Nenhum "R$" antes da revisão (testado).
- **Codex, crítica do plano (11 de 12 itens incorporados):** estimativa com medida opcional, limite de 2h por tipo em JS e SQL, empresa com diária única, 120 dias pra todas as datas, endereço no pedido, contrato completo da solicitação anônima (idempotência, falha entre Auth e pedido, CNPJ), revalidar o valor no envio, pergunta do almoço mantida, compatibilidade com turno, recarregar sem CPF, mobile 320/foco/área segura. Parcial: antecedência continua 1 dia corrido (pendência).
- **Achados meus:** alias `p` e variável `P` são o mesmo identificador no plpgsql ("column reference p is ambiguous", a paridade pegou); cópia do `transicionar` da migration errada (b3, sem a condição de diária paga; o contrato pegou); teste de paridade que quase só gerava erro (5 de 400 válidas), refeito pra exercitar valor e desconto.

## Turno 2026-09-29 (noite): antes do bloco 3
- **`roda-testes.mjs` em três modos** (pedido da Gabrielle): `--rapido` (padrão, só Node, paralelo, ~3 s) durante o trabalho; `--entrega` antes de cada commit (+ navegador no mock em paralelo, no máximo 4 Chromium, + banco de homologação em fila, ao lado dos locais); `--completo` no fim do bloco (+ preview e o Lighthouse de performance, sozinho no fim porque CPU disputada derruba a nota). Paralelo só onde não há banco real: os de homologação dividem config, relógio e limites do mesmo Supabase. Tempo de cada script no fim, maior primeiro; saída dos que falharam no fim. `--so a,b` roda só alguns. Medido: rápido 3 s; entrega 512 s antes, com a `testa-b6` sozinha em 198 s por causa do caso do upload em pedaços (o gateway do Supabase só recusa depois de ~150 s): esse caso roda só no `--completo` (`TESTES_COMPLETOS=1`), com linha "pulado" nos outros modos.
- **Mais de um papel na mesma conta** (migration `20260930110000`): `perfis.papeis` com a lista; `perfis.papel` fica e vira o PRINCIPAL (o de mais privilégio, mantido por trigger), então toda checagem antiga pelo principal (exclusão só por prime_admin, senha própria obrigatória fora de cliente, órfão sem papel da equipe) continua certa sem redefinir função. **Papel ativo por requisição:** a tela manda o header `x-papel` com a área aberta (o cliente Supabase do navegador põe em toda chamada; a function `documentos` repassa); `privado.papel()` só aceita um papel que a conta tem e, sem header, usa o principal; papel que a conta não tem devolve NULL (nega tudo, não cai no principal). Motivo: nenhuma requisição acumula acesso de dois papéis (mesma regra do vínculo duplo da revisão do B1) e todas as policies e RPCs já passavam por `privado.papel()`. Alternativa descartada: papel ativo no token (trocar de área exigiria renovar a sessão e duas abas em áreas diferentes brigariam). Auditoria grava o papel ativo. Token traz `papeis`; a entrada da cliente mostra "Onde você quer entrar?" quando a conta tem mais de uma área, e cada área tem o botão pra outra (sem pedir senha). Código antigo que só troca `papel` (cliente que vira diarista) continua trocando em conta de um papel e acrescenta em conta de vários.
- **Unificação da admin** (`scripts/unifica-contas.mjs` + RPC `conta_unificar`, só serviço): a conta de cliente ganha os papéis da equipe e o hash da senha da conta `+prime` (a senha é HMAC com pepper, não depende do e-mail), então ela continua com a senha que criou; a `+prime` fica bloqueada, sem papel da equipe (desbloquear por engano não cria segunda admin) e com acessos/auditoria intactos; sessões dela caem. Rodada no homolog em 29/09 depois de simulação; conferido sem a senha dela (mesmo hash, contagens iguais, antiga sem acesso). Backup antes: `~/.prime-dados/backup-homolog-20260929-191519.sql`.
- **Exclusão de dados** de conta que também é da equipe ou profissional: a function `conta` recusa (apagar o usuário do Auth tiraria o outro acesso). PENDENCIAS.

## Turno 2026-09-29 (noite): fase 2, bloco 3
- **Bloco 3 só no backend real** (adapter supabase): regra no banco, testes de banco em Node (`testa-*-homolog`, `testa-agenda-p2`...) e de tela contra o preview (`testa-bloco3-preview`). O mock e o fake-api continuam com o contrato das entregas anteriores (demonstração); abas novas mostram a versão antiga no mock. Motivo: tudo do bloco 3 é operação da Prime sobre dados reais, e duplicar em três adapters triplicaria o risco sem uso.

### P2. Agenda e disponibilidade (migration `20261001100000`)
- **Conflito na atribuição:** sobreposição de horário e férias/folga IMPEDEM; fora do dia, do turno ou da região da profissional é AVISO que a Prime confirma ("atribuir mesmo assim", idempotência com o valor da confirmação no conteúdo). Remarcar respeita férias da profissional atribuída; os avisos de disponibilidade aparecem no diálogo antes de salvar. Flag `p2_disponibilidade` (ligada) desliga bloqueios e avisos; sobreposição vale sempre.
- **Turno x hora exata:** manhã = diária termina até 13:00; tarde = começa a partir de 12:00; integral ou manhã+tarde = qualquer. **Região:** cidade do pedido; Belo Horizonte casa com qualquer "BH - regional" (não há mapa bairro -> regional; PENDENCIAS).
- **Sugestão** (`sugerir_profissionais`): livres no horário primeiro, depois quem atende a região, quem está no dia e turno, e a menor carga da semana (seg a dom). Aparece em Solicitações (por diária) e Atribuir; "Designar" com um clique.
- **Agenda** (`agenda_profissionais`, até 31 dias): grade semana/dia, uma linha por profissional aprovada e "Sem profissional"; arrastar abre a confirmação com os conflitos que o banco devolve (`conflitos_atendimento`); o botão da diária abre o mesmo diálogo pelo teclado. Remarcar antes de trocar (o banco confere a sobreposição na data nova). Remarcação e troca geram `atendimento_reagendado`/`atendimento_atribuido`, que recalculam as automações.
- **Regiões da profissional** também no banco (`configuracao.regioes_diarista`, conferida contra `precos.js` no teste).

### P3. Pagamento sem trabalho manual (migrations `20261001110000`, `110100`)
- **Prazo vencido:** o I04 (bloco 2) avisa; no painel, aba Pagamentos, "Prazo vencido" com "Liberar vaga" (cancela a diária e a cobrança; recusa se ainda não venceu) e "Dar mais prazo" (data e hora no futuro e antes do início da diária; evento `prazo_prorrogado`). Liberação automática (`privado.liberar_vencidos`, pg_cron a cada 15 min) atrás da flag `p3_liberacao_automatica`, DESLIGADA; diária que já começou fica pra Prime.
- **Hora extra:** a profissional registra (1 a 4 horas) na agenda, depois do check-out, até 2 dias depois; uma por diária (recusada libera de novo). A Prime aprova (cobrança `hora_extra` = horas x `horaExtraCentavos` da tabela oficial, vence em 2 dias às 14h) ou recusa com motivo. Aprovação gera `hora_extra_aprovada` -> C14 com horas, valor e link. Paga como as outras cobranças. Flag `p3_hora_extra`.
- **Recibo:** número dado por um contador travado na MESMA transação da confirmação (trigger em `pagamentos`): rollback devolve o número, confirmações simultâneas saem em sequência sem buraco (testado com 5 em paralelo). Texto congelado na confirmação; estorno aparece no PDF sem mudar o número; o recibo nunca é apagado (FK vira nulo). PDF gerado no navegador por um gerador próprio (`src/domain/pdf.js`, Helvetica WinAnsi, sem biblioteca). Minha conta ("Recibos") e painel (Recebidos). Leitura só pela RPC (cliente dona ou Prime). Os já confirmados antes do P3 (só fictícios) ganharam recibo na ordem da confirmação.

### P4. Atendimento acompanhado (migration `20261001120000`)
- **Check-in:** as etapas que já existiam (a caminho, iniciei, finalizei) guardam o horário no histórico da diária; a Prime vê em "Check-ins" no diálogo da diária na agenda. **Localização aproximada** só com o consentimento ATUAL da profissional (L1), só junto do próprio check-in (até 2 h depois do evento), arredondada a 3 casas (~100 m), uma por etapa, legível só pela Prime; some ao revogar o consentimento e em 30 dias (pg_cron). Nunca atrasa nem impede o check-in. Permissions-Policy passou de `geolocation=()` pra `geolocation=(self)`.
- **Checklist:** tabela por serviço, semente = "O que está incluído" (`src/config/agendamento.js`, conferido no teste); só `prime_admin` edita (aba Configurações). Marcado no "Finalizei" (diária em andamento): cada item feito ou não feito, não feito exige motivo; uma vez por diária. O banco NÃO exige o checklist pra finalizar (a tela exige): obrigar no banco quebraria a finalização pela Prime e os fluxos antigos; registrado como decisão.
- **Ocorrência:** a cliente dona abre depois do atendimento (até 30 dias; até 5 por dia), pelo acompanhamento da diária (Minha conta leva até lá), com tipo, descrição e foto opcional. Foto pela function `documentos` (`?acao=foto_ocorrencia`): JPG/PNG até 5 MB com os bytes conferidos, bucket privado `ocorrencias`, uma por ocorrência; a Prime abre por URL assinada de 2 min. Chamado no painel (aba Ocorrências): aberto, em análise, resolvido, com comentário que a cliente vê; I05 ao abrir e C15 a cada mudança (situação no texto). Resumo diário (I06) passou a contar as ocorrências abertas.
- **PWA da agenda:** `diarista/manifest.webmanifest` (ícones gerados do logo, `scripts/gera-icones-pwa.mjs`) e `diarista/sw.js` (rede primeiro, cópia local sem sinal; nada de outra origem passa por ele). A agenda do dia (hoje e amanhã) e o checklist dessas diárias ficam no aparelho; sem sinal, a agenda abre pela cópia, e check-in e checklist entram numa fila com a mesma chave de idempotência, enviada em ordem quando a conexão volta (o banco não duplica). Sair apaga cópia e fila. Sem sinal, a sessão não é derrubada (o banco confere quando voltar). Os arquivos da página entram no cache a partir da segunda visita.

### P5. Profissionais (migrations `20261001130000`, `130100`)
- **Certidão de antecedentes** vale 90 dias a partir do envio (`configuracao.documentos.validadeAntecedentesDias`; PENDENCIAS). A aba Cadastros lista vencidas, sem certidão e vencendo em 30 dias. **D07** ligado: a varredura do motor pega a certidão ATUAL de cada profissional aprovada (a substituída ou excluída não conta) e agenda 15 e 3 dias antes do vencimento; os dias no texto são contados no dia do envio.
- **Repasse** atrás da flag `p5_repasse` DESLIGADA, só `prime_admin`. Regra configurável: percentual do valor cobrado (diárias + horas extras aprovadas) ou valor fixo por carga horária (2/4/6/8 h) + valor da hora extra; a regra fica fora da leitura pública da tabela de configuração. Fechar só mês que já terminou; grava as linhas e trava (trigger recusa update/delete; só a limpeza de teste apaga). CSV no formato do Excel (`src/domain/csv.js`: `;`, BOM, dd/mm/aaaa, vírgula decimal, proteção contra fórmula). **Achado pelo teste:** regra por carga com carga faltando passava (`bool_and` ignora NULL), corrigido em `130100`.
- **Importação de profissionais** (`scripts/importa-profissionais.mjs`, simulação por padrão, `--modelo` gera a planilha vazia): idempotente pelo CPF (quem já existe não muda), entram aprovadas, origem "importada", SEM acesso e sem aceite (pedido no primeiro login); CPF inválido/repetido e sem telefone não entram; o resto entra com marcação de "revisar". O CHECK de cadastro completo passou a aceitar importada sem identidade, e-mail, nascimento e aceite.
- **Corrida antiga do B7 corrigida** (migration `20261001140100`, pega pela `testa-importacao` de forma intermitente no `--entrega`): "completar e-mail" simultâneo com e-mails diferentes; a segunda chamada apagava como órfã a conta que a primeira acabara de criar e as duas respondiam sucesso. Órfã do MESMO e-mail segue reaproveitada; órfã de outro e-mail com menos de 2 minutos = chamada em andamento, recusa; só a mais antiga é apagada. Teste determinístico novo.

### P6. Relacionamento e exportações (migration `20261001140000`)
- **Listas** (aba Relacionamento): renovação (pacote com diária no mês, a mesma regra do M01) e reativação (sem diária há N dias da regra M02 e nada marcado), até 200 por lista, telefone mascarado e quem aceita novidades por canal. O envio continua só com a regra ligada em Automações.
- **Link da renovação** (`autoagendamento/?repetir=<pedido>`): só a cliente dona (RPC `dados_renovacao`); sem login, a entrada devolve pro link (`entrar/?destino=`, aceito só nesse formato, pra não virar redirecionamento aberto). Traz serviço, endereço, medida, carga, horário e o mesmo dia do mês no mês seguinte (31 em mês de 30 vira o último dia; domingo anda pra segunda) e abre na revisão, com o valor calculado no servidor como sempre.
- **Exportações** CSV (clientes, pedidos, pagamentos, repasses): só `prime_admin`, flag `p6_exportacoes`, 20 por hora por pessoa (`privado.limite_acao`, também usado no P7), auditadas com tipo, se foi completa e quantas linhas. Por padrão CPF com os 3 do meio visíveis (`***.456.789-**`), telefone e e-mail mascarados; completa só marcando a opção e confirmando. O arquivo é montado no navegador (`src/domain/csv.js`).

### P7. Proteção do site (migration `20261001150000`)
- **Turnstile** (Cloudflare) no login das três áreas (inclusive o login dentro da solicitação), na solicitação sem login e na criação de conta da profissional; conferido na function `conta` (`siteverify`, 8 s, flag `p7_turnstile`). Sem token, token grande demais ou reprovado: `400 VERIFICACAO_HUMANA`. **Homologação usa as chaves de TESTE públicas da Cloudflare** (site `1x00000000000000000000AA`, segredo `1x...AA`, que sempre passam): criar o widget de verdade depende do painel/API da Cloudflare com permissão de Turnstile, que o OAuth do Wrangler não tem. GO-LIVE: criar o widget pro domínio, pôr `TURNSTILE_SITEKEY` no `~/.prime-env` e `TURNSTILE_SECRET` nos secrets. A recusa de token reprovado foi conferida à mão em 29/09 trocando por um instante pro segredo de teste "sempre falha" (`2x...AA`): 400; e de volta, 401 normal.
- A caixinha fica num shadow DOM; o token de uso único é pego na hora da chamada (`src/ui/turnstile.js`, que espera até 20 s e renova a caixinha). Sem chave configurada (mock, testes locais) nada é montado. Os testes em Node mandam o token de teste (`TOKEN_TESTE_TURNSTILE`). CSP liberou só `challenges.cloudflare.com` (script, frame e connect).
- **Campo isca** (`site_empresa`, fora da tela, sem foco pelo teclado): preenchido, a solicitação responde "enviada" sem criar nada e o login dá o erro genérico sem contar tentativa.
- **Limites:** solicitação sem login e cadastro por IP (já existiam), solicitação logada 30 por conta em 24 h (trigger no pedido), ocorrência 5 por dia (P4), exportação 20 por hora (P6), busca 120 por hora (P1), erro e funil por IP (O1). `privado.limite_acao` genérico.

### O1. Observabilidade (migration `20261001160000`)
- **Erros** do site (`window.onerror`/promessa rejeitada, até 5 por página) e das functions `conta`, `documentos` e `notificacoes` numa tabela agrupada por assinatura (origem + mensagem limpa + página sem query), com contagem, primeiro e último. O banco limpa a mensagem antes de guardar: e-mail, números de 4+ dígitos (CPF, telefone), token/JWT e uuid viram marcadores. Erro novo (ou que volta depois de 24 h) gera o **I10** (regra nova, interna, só painel) e aparece em Visão geral. O navegador só registra com origem `site`.
- **Worker:** batimento a cada ciclo; a vigia (pg_cron a cada 5 min) registra "worker parado" (e o I10) se passar de 5 min sem ciclo com o motor ligado.
- **Funil** próprio, sem cookie e sem identificar ninguém: abriu a calculadora e iniciou a solicitação (tela, uma vez por aba), concluiu (pedido) e pagou (confirmação), contados por dia; fictícios não contam. A **Web Analytics da Cloudflare** não tem evento de funil; o código já injeta o beacon (sem cookie) e libera a CSP quando houver `WEB_ANALYTICS_TOKEN` no ambiente: **BLOQUEADA** até criar o site no painel da Cloudflare (GO-LIVE).
- **Saúde do sistema** (Visão geral): último ciclo do worker, fila atrasada, falhas de envio e erros em 24 h, erros agrupados, funil de 30 dias e último backup (o `backup-homolog.sh` registra tamanho e nome do arquivo).

### P1. Visão geral (migrations `20261001170000`, `170100`)
- **Indicadores** (só `prime_admin`, período até 1 ano, datas de Brasília): solicitações por situação, recusa e motivos, horas até confirmar a disponibilidade, faturamento previsto (cobranças com vencimento no período) e recebido (confirmado no período), pagamentos vencidos, diárias por serviço, carga e cidade, clientes novas x recorrentes, ticket médio, pesquisa por critério e por profissional (interno), ocorrências por tipo. Conferidos contra um conjunto fictício em março de 2031 dentro de uma transação desfeita (e contra SQL direto).
- **Busca global** (Prime) por nome, CPF/CNPJ, telefone ou e-mail, clientes e profissionais, até 20; resultado mascarado; cada busca vai pra auditoria SEM o termo (só tipo, tamanho e quantos resultados). **Achado pelo teste:** variável `tipo` com nome de coluna (42702), corrigido em `170100`.
- **EXPLAIN (homolog, 3,3 mil clientes):** busca por telefone 1,9 ms (índice `clientes_telefone`); recebido no período 2,5 ms (`pagamentos_confirmado_em`); diárias do período 1,3 ms (index only); agenda do dia por profissional 0,04 ms; busca por nome 57 ms (varredura: `like '%x%'` não usa índice b-tree; com a base maior, índice trigram `pg_trgm`).

### D1. Go-live e ajuda
- **GO-LIVE.md** virou checklist em ordem com um script por passo em `scripts/go-live/` (13 passos). Nenhum foi executado; todos param sem `GO_LIVE=sim` e `PROD_REF`, recusam o ref de homologação (`testa-go-live` confere) e pedem confirmação digitada antes do que muda algo. Seção "Voltar atrás" (DNS, backup, `PRODUCAO_REFS`).
- **Central de ajuda** (aba Ajuda do painel): 8 tarefas com passo a passo curto e print. Os prints são gerados do preview por `scripts/gera-prints-ajuda.mjs` com dados fictícios criados e apagados pelo próprio script, recortados no registro fictício (nunca numa lista que poderia ter cliente real).

### Revisão do GPT do bloco 3 (2 chamadas, por área)
- **Segurança e dado pessoal (corrigido, migration `20261001180000`):** unificar contas sem levar a senha deixaria a cliente com a senha padrão (6 dígitos) ganhando papel da equipe: recusa; falha ao ler a flag do Turnstile desligava a proteção (falha aberta): agora conta como ligada; a página do erro não passava pela limpeza de dado pessoal: passa.
- **Corrida e dinheiro (corrigido na mesma migration):** hora extra aprovada depois do fechamento do mês ficaria fora do repasse: fechar só a partir do dia 3 e sem hora extra pendente, e aprovar hora extra de mês fechado é recusado; hora extra de diária não finalizada entrava no repasse; gravar localização e revogar o consentimento ao mesmo tempo podia deixar a localização guardada: mesma trava por profissional nos dois lados.
- **Descartado:** "sem o header x-papel vale o papel principal" (é o desenho: só a própria dona omitiria o header, e ela já tem esse papel; as telas sempre mandam); regra por carga incompleta (já corrigida em `130100`; a revisão leu a migration antiga); fila offline entre duas abas (a releitura e a gravação da fila acontecem no mesmo instante síncrono; risco desprezível).

## Auditoria de segurança (30/09/2026)
- **Sessão viva no banco:** `privado.papel()` e a policy de `perfis` exigem que a sessão do token (`session_id`) exista em `auth.sessions`. Motivo: troca de senha e "sair" encerram a sessão no Auth, mas o JWT valia até expirar (1 h). Token sem `session_id` (chamada interna que monta o ator por `set_config`) segue igual. Efeito colateral: a troca de senha encerra também a sessão de quem trocou (o Auth encerra todas), então o front entra de novo com a senha nova, na mesma área.
- **Ação `cadastrar` removida da `conta`:** nenhuma tela chamava (a conta nasce na solicitação) e ela revelava CPF cadastrado. O `testa-auth` passou a criar a conta nova pela solicitação.
- **Piso de 900 ms em toda recusa de login:** igualar por soma de espera não igualava (a conta existente fazia a ida ao Auth antes).
- **CPF e nascimento do rascunho da profissional no `sessionStorage`:** mantém recarregar sem perder (o E5 exige), some ao fechar a aba. Mesma regra do agendamento (lá, só memória).
- **HSTS sem `includeSubDomains`** até conferir os subdomínios no go-live (PENDENCIAS).
- **Revisão do GPT** (1 chamada, alcance: as 6 correções): 2 médias no rascunho da profissional (rascunho antigo com CPF continuava no aparelho; outra aba sem CPF ficava num passo avançado), corrigidas com teste. Nada mais.

## Painel v2, etapa A (01/10/2026): pesquisa, material pra cliente e proposta (sem mexer no painel real)
- **Fotografia do painel atual:** contra um Supabase LOCAL (`supabase start` com as migrations do repo) e o seed fictício de `scripts/painel-v2/seed-local.mjs` (nunca o homolog). A function `conta` não roda no local: `captura-atual.mjs` responde o login do painel com a sessão do usuário fictício. 28 páginas em `painel-atual.pdf` (OneDrive e `docs/painel-v2/`), texto varrido contra a base real antes de gravar. "Worker parado" e "nenhum backup" na Visão geral são do ambiente local.
- **Auditoria de UX** (detalhe em `docs/painel-v2/auditoria.md`): 16 abas, uma por entrega. Toda tela repete cabeçalho e rodapé do site, faixa azul de 260 px, seis caixas azuis iguais e as 16 abas: o conteúdo começa a 560 px no computador e a 1.100 px no celular. Sete cores simultâneas, seis tamanhos de texto, rótulos em caixa alta, parágrafo cinza de regras em cada bloco, jargão ("txid", "worker parado", "eventos com erro", códigos C01..M03). As contagens têm o mesmo peso ("Semana 10" = "Pagamentos a confirmar 1") e "16 sem profissional" soma diárias de pedidos nem confirmados. Não existe ficha da cliente: o histórico fica dentro de Automações. No celular, Agenda, Atribuir e Pagamentos viram rolagem lateral.
- **Cliques hoje** (da tela que abre): confirmar disponibilidade 1; designar 3; confirmar pagamento 2 (rolando dois blocos); vencido 2 ou 5; remarcar 5; ocorrência 4; achar cliente 2 a 3 (duas buscas, sem ficha); ver o dia 2; aprovar cadastro 2 a 7. Teste do novato: trava em "o que acontece quando eu clico" (nenhum botão diz a consequência), em Atribuir x Agenda (os dois têm "sem profissional"), no "txid" do Pix e em achar o histórico de uma cliente.
- **Referências** (16 princípios com fonte em `docs/painel-v2/referencias.md`): contagem que é link pra lista filtrada; aviso só acima de um limite; triagem com poucas saídas (Confirmar, Recusar, Lembrar amanhã); prioridade por tempo (vencido, hoje, sem próximo passo, futuro); item parado há 48 h se marca; bandeja "sem profissional" separada da agenda; cartão no celular com 3 campos + 1 ação; nome humano primeiro; detalhe em painel lateral sem cobrir a lista; dinheiro tabular à direita; selo de estado discreto, no máximo 5 estados; desfazer em vez de confirmar e consequência no botão; uma busca só; barra inferior com até 5 itens; gráfico só barra ou linha, até 5 cores, azul x dourado em vez de vermelho x verde; tour curto e pulável (NN/g: tour não melhora desempenho).
- **Arquitetura proposta (6 + Ajuda):** Início · Solicitações e agenda · Clientes · Profissionais · Financeiro · Configurações. Mapa antigo -> novo: Visão geral e as caixas -> Início; Solicitações, Agenda, Atribuir -> Solicitações e agenda (abas Solicitações, Agenda, Sem profissional); Clientes, Relacionamento, Pedidos LGPD, linha do tempo -> Clientes (ficha única); Cadastros, certidões, repasse -> Profissionais; Pagamentos, recibos, horas extras, planilhas -> Financeiro; Preços, horários, Automações, checklists, flags, Pesquisa de satisfação -> Configurações (satisfação também vira número no Início); Ajuda no rodapé do menu.
- **Protótipo** (`painel-proposta/`, estático, sem login, noindex, só dados fictícios): Início, Solicitações, Agenda, Ficha da cliente, Financeiro, Profissionais; tokens próprios em `proposta.css` (fundo `#FBF7F5`, superfícies brancas, borda `#ECE7E2`, azul da Prime só em texto, navegação ativa e botão primário, dourado como acento, 3 tamanhos de texto, 2 pesos, números tabulares), 4 gráficos SVG com tabela alternativa, painel lateral de detalhe, tour de 5 passos pulável. Publicado no preview da branch em `/painel-proposta/`.
- **Cliques na proposta** (a partir de Início): confirmar disponibilidade 2; designar 2; confirmar pagamento 2; vencido 2; remarcar 3; ocorrência 3; achar cliente 1; ver o dia 0; aprovar cadastro 2. Nenhuma tarefa com mais cliques que hoje. Teste do novato refeito sobre a proposta em `docs/painel-v2/auditoria.md`.
- **Depende da cliente:** prints do sistema atual (`Prime_Limpeza/sistema-atual/`) e a referência visual dela (`Prime_Limpeza/referencia-isa/`) não chegaram; o cruzamento fica pendente e pode mudar paleta e tela Início antes da etapa B. Etapa B só com o ok da Gabs e da cliente.

## Autoagendamento v3 (06/10/2026): versão final da cliente (spec-agendamento-v3.txt + 56 itens)
Branch `turno/agendamento-v3`. Os 56 itens e a spec v3 prevalecem sobre o v2. Textos da cliente literais em `src/config/agendamento.js`.

### V1. Domínio e banco
- **Domínio puro em `src/domain/agendamento-v3.js`, espelhado no banco** (`privado.*_v3`, migration `20261006100000`): recomendação, horários, região, taxas, descontos, cupom, condição especial, marco e parcelas. Paridade em `testa-paridade-v3` com a configuração do PRÓPRIO banco nos dois lados (a vigente e uma variante com faixa de CEP, feriado em sábado e expediente de sábado), 32 casos de borda e 1000 cotações aleatórias comparando resultado e mensagem de erro.
- **Configuração numa fonte só:** `PRECOS.v3` entra na linha vigente de `precos` (editável pelo painel como o resto da tabela); feriados continuam na tabela `feriados` (feriado deixa de bloquear: só cobra); regiões na tabela `regioes` (Nova Lima R$ 20, decisão 0.2); faixas de CEP na tabela nova `faixas_cep` (vazia: Vila da Serra cai em Nova Lima até a cliente mandar a faixa). `privado.cfg_v3()` junta tudo no formato do JS.
- **Recomendação (0.1, item 14):** faixa pela metragem (30/50/70/110 m²; acima de 110 fica em 8h e acima de 120 aparece o aviso do item 12) cruzada com os ambientes ponderados (banheiro e cozinha 1,5, configurável): ambientes acima do esperado sobem no MÁXIMO uma faixa (`subidaMaximaPorAmbientes`). Mudança e evento "após" somam a condição (+0/+1/+2). Passadoria pela tabela 1, sociais e delicadas +1 faixa. Passou de 8h: sem carga, com `orientacao` mais_profissionais (limpezas) ou dividir_diarias (passadoria). Empresarial mantém a tabela própria do v2 (a cliente não citou).
- **Valores:** cada atendimento tem os itens dele (diária, acréscimo do serviço da tabela oficial, sábado, feriado, sem refeição, deslocamento do SEU endereço). Sábado que é feriado cobra uma taxa só (`acumulaSabadoFeriado: false`). Desconto por quantidade (3 ou 4 = R$ 20, 5+ = R$ 40) só em pacote e multi, uma vez sobre o total; substitui o desconto mensal no v3.
- **Descontos que não acumulam (item 44), padrão configurável:** desconto especial não cumulativo vale sozinho (some o do pacote e o cupom, que volta com motivo "nao_acumula"); cupom não cumulativo substitui o desconto do pacote; os marcados "acumula" somam. Percentual sobre o subtotal (com as taxas), arredondado ao centavo (meio pra cima); valor fixo; nada deixa o total negativo. Cupom de primeira contratação incide sobre a 1ª diária (a "unidade elegível").
- **Parcelas:** avulsa e multi = `integral`; pacote = `metade_1` (50%, arredonda pra cima no centavo) + `metade_2` (o resto). Marco da segunda metade = a diária de índice floor(n/2) nas datas da agenda VIGENTE (4 -> 3ª, 5 -> 3ª, 3 -> 2ª). Vencimentos pela regra oficial (14h do dia útil anterior à diária de referência); a 2ª parcela é gerada e enviada 2 dias antes do vencimento (configurável). Faturamento empresarial: uma parcela `faturamento` com vencimento = última diária + prazo acordado. Identidade da parcela = pedido + tipo (índice único), nunca a data.
- **Duração menor que a sugerida:** o servidor recusa sem `cienteDuracaoMenor` (o "Estou ciente e quero continuar" do item 19); a justificativa fica só no atendimento (item 20).
- **Modelo novo:** `enderecos` (salvo, uso único, principal, substituído/inativo; RLS forçada, só RPC), `cupons` + `cupons_uso` (consumo só na contratação confirmada), `condicoes_comerciais` (uma ativa por cliente; histórico fica), `faturamento_empresarial`, `aceites_solicitacao` (evidência por pedido), `faixas_cep`; pedido ganha número da solicitação (sequência; os pedidos antigos foram numerados pela data de criação), modalidade, origem, cupom, condição aplicada, flags de faturamento e de pacote com endereço novo; atendimento ganha endereço (id + retrato), serviço, características, refeição, duração recomendada, justificativa, taxas e itens; pagamento ganha marco, envio e dados do faturamento; cliente ganha base legal e status de prospecção.
- **Backfill de endereços:** os 3.289 importados não têm CEP (a planilha antiga não trazia), então só 1 cadastro entrou como principal no V1. O CEP passa a ser opcional SÓ para endereço importado (migration do V2) e o resto entra lá; todo endereço novo do fluxo exige CEP validado (item 6).
- **Achados da paridade (SQL):** `not (jsonb_typeof(null) = 'string' and ...)` e `privado.eh_inteiro(null)` dão NULL e não barram (campos ausentes passavam). As funções do v3 usam `privado.v3_int` (nunca NULL) e `is distinct from`; o helper antigo não mudou (o v2 depende dele).
- **Revisão do GPT do plano (1ª chamada):** entrou: retrato do endereço no atendimento, ticket do cadastro sem leitura nem alteração de conta já existente, resposta e tempo iguais, fonte única de configuração, parcela com identidade estável, travas na confirmação e no consumo de cupom, RLS forçada e backfill, hash dos documentos aceitos, mobile verificado em cada entrega. Descartado: "pesos e subida de faixa inventados" (a spec 0.1 manda os dois).

### V2. Serviço, identificação, cadastro e endereço
- **Tela nova em módulos** (`src/ui/paginas/agendamento-v3/`), atrás de `?v3=1` até o V5 (`autoagendamento-entrada.js` escolhe): o fluxo v2 continua no ar e testado enquanto o v3 é construído.
- **Cadastro antes do endereço e salvo ao concluir a etapa (item 34)** pela ação `cadastrar_v3` da function `conta` (Turnstile, 10/IP/hora, isca). Resposta SEMPRE `{ok, ticket}` e com o piso de 900 ms, pra CPF novo, CPF já cadastrado e e-mail de outra conta: a ação `cadastrar` saiu na auditoria de 30/09 justamente por revelar CPF. O ticket (64 hex, guardado só como SHA-256, 24 h) vai no rascunho e só serve pra enviar ESTA solicitação. CPF novo: cliente criado (`base_legal = execucao_contrato`, `status_prospeccao = novo`, endereço vazio) e acesso pela regra padrão (o aceite dos termos vem na solicitação, item 52; quem só se cadastrou aceita no modal de L1 ao entrar). CPF existente: o ticket não lê nem altera a conta; a solicitação vai vinculada com o digitado (como no v2). Mesma chave devolve o mesmo ticket (o resultado fica na tabela de idempotência).
- **Validações literais** (itens 30 a 33), iguais no JS (`validarCadastroV3`) e no SQL (`privado.v3_cadastro`, paridade): nome com duas palavras de 2+ letras (classe de letras fixa, sem depender do locale do banco), CPF só avaliado com 11 dígitos, 18 anos pela data inteira (29/02 conta em 28/02, como o Postgres), WhatsApp com a confirmação "Confirme seu WhatsApp" obrigatória na própria tela. Empresa: nome completo do responsável, CNPJ e razão social.
- **Endereço:** CEP primeiro e os campos do item 7 na MESMA tela quando atendido (item 56: menos páginas); fora da área, os dois textos do item 6 e "Falar com a Prime", sem seguir. Tipo do imóvel em lista por segmento (item 8), "Outro" pede o texto. "Como deseja utilizar este endereço?" com a identificação só no salvo. Cliente logada escolhe entre os salvos, "Adicionar novo endereço", "Substituir endereço" (RPC na hora: o anterior fica inativo com `substituido_por`) e "Solicitar remoção" (link do WhatsApp com o endereço na mensagem). O endereço novo é gravado junto da solicitação (V5).
- **Endereços importados:** CEP opcional só pra eles; 3.270 dos 3.290 cadastros viraram endereço principal (os 20 restantes não têm rua, número ou bairro). Exclusão (L1) apaga endereços e tickets da titular (trigger).
- **Conteúdo editável** (`configuracao` 'agendamento'): tipos de imóvel e "Ver mais" por serviço, padrão igual a `src/config/agendamento-v3.js` (paridade confere). O "Ver mais" separa as restrições do item 52 por serviço (item 4) e fica dentro de cada card.

### V3. Características e recomendação
- **Uma tela por serviço** (`passo-local.js`), com seleções rápidas: limpezas com metragem obrigatória (sem "Não sei a metragem"), ambientes em − / +, aviso de 120 m² discreto só enquanto a metragem passa disso; mudança com "O imóvel está:" e a condição; eventos com antes/após, metragem do espaço, ambientes utilizados e a condição só "após"; passadoria só com peças (− / + de 5 em 5) e tipos, sem metragem, ambientes nem o aviso de limpeza detalhada. Animais e refeição em Sim/Não para todos. A frase do item 16 ("Não — será aplicada taxa...") virou "Não" + descrição: o travessão é barrado no `verifica-texto` e as palavras ficam iguais.
- **Recomendação na mesma tela, logo abaixo** (ordem do item 18), recalculada a cada toque pela mesma função do servidor. Acima de 8h não há carga: limpezas mostram "recomendamos mais de uma profissional" e passadoria o texto literal de dividir em diárias. A 2h some acima de 30 m² (tabela oficial).
- **Duração menor que a sugerida:** o alerta literal do item 19 abre na hora, com o campo opcional e "Estou ciente e quero continuar"; sem o ciente não segue (e o servidor também recusa). Duração maior não alerta.
- **Testes antigos dependentes do dia (achados ao rodar num sábado):** `testa-e7` (a véspera da diária do seed caía no domingo: relógio do navegador fixo numa segunda a quinta útil) e `testa-pagamentos-p3`/`testa-atendimento-p4` ("amanhã às 11h" caía no domingo e passava da validade de 24 h: agora usam a primeira janela de envio pela regra do motor). Falhavam igual na main. A auditoria ganhou as RPCs públicas/da cliente do v3 nas listas de permitidas.

### V4. Modalidade, datas, horário e configuração
- **Modalidade** em três cards com os textos e selos literais (itens 21 e 22); as condições de pagamento ficam no painel "Informações da modalidade".
- **Datas e horário na mesma tela.** Pacote: frequência (semanal, quinzenal, mensal ou datas avulsas) e quantidade sincronizadas com o calendário (item 26): a 1ª data gera as ocorrências pela frequência (dia bloqueado vai pro próximo permitido, como no servidor), "+" acrescenta a próxima, "−" tira a última, a lixeira do chip e o clique no calendário também contam. Trocar a frequência com datas abre "Alterar frequência?" e zera datas, horários e configuração. Feriado e sábado ficam marcados (ponto e rótulo pro leitor de tela: "taxa adicional de R$20,00"); domingo bloqueado. Mudança de ano entre as datas mostra o ano nos chips (item 48).
- **Horário:** dois seletores nativos Hora | Minutos (sem digitação, no celular abre o seletor do sistema) só com o permitido pra duração e o dia. Pacote: "Deseja manter este horário nas próximas diárias?" com os seletores por data na mesma tela; multi: "Deseja utilizar este mesmo horário para as demais profissionais?" e, se não, o horário em cada card.
- **Configuração** (pacote e multi): cards `<details>` por diária ("Diária 1 · 08/10": o exemplo do item 21 sem o travessão, barrado no verifica-texto) ou por profissional, só o 1º aberto, com serviço, endereço (o da etapa 3, os salvos ou "Outro endereço" com CEP validado na hora), duração e horário; "+ Adicionar profissional" (até 10). Duração menor que a sugerida num card pede o próprio "Estou ciente". Pacote com endereço que não é do cadastro (outro endereço, uso único, ou novo de quem já tem endereços salvos) mostra "Novo endereço no pacote" (item 46).

### V5. Revisão, aceite único, envio, tela final e visual
- **O v3 virou o fluxo de `/autoagendamento/`** e a tela v2 saiu (`autoagendamento.js` e `testa-e3-navegador` removidos; as garantias do e3 que continuam valendo, como CEP fora, ViaCEP fora do ar e resposta atrasada, estão no `testa-v3-navegador`). A home continua com os mesmos links: `?servico=` cai na identificação; `?frequencia=semanal` já marca pacote semanal; `?etapa=calculadora` abre o serviço (o v3 só calcula depois da identificação, item 5). Renovação (`?repetir=`, P6) monta o rascunho com o mesmo serviço, endereço (o salvo, se bater CEP e número; senão de uso único), duração, horário e as datas do mês seguinte; o que o pedido antigo não tem (ambientes, animais) a cliente completa.
- **Revisão em três blocos numa tela** (item 47). Valores do item 49: "N diárias × valor" agrupado pelo valor-base, cada taxa numa linha (sábado e feriado com a contagem, refeição, deslocamento por cidade), subtotal só quando há desconto, descontos com "–" e o total. O cupom reconsulta o servidor ("Cupom aplicado!" / "Cupom inválido ou indisponível."). Pagamento com o texto da modalidade (item 50) ou o do faturamento autorizado.
- **Aceite único** (itens 52 a 54): "Ler Termos e Condições" abre o documento num painel e só então, com a caixa marcada, ENVIAR SOLICITAÇÃO libera; sem tempo mínimo de leitura. Os três documentos são clicáveis. Sem as caixas de marketing (o consentimento segue em Minha conta e no painel, L1). O envio desabilita o botão na hora e reusa a chave: duplo clique ou resposta perdida não duplicam.
- **Termos e Condições do atendimento, versão 2026-10-17** (`/condicoes/`): relação completa do item 52, as três declarações, "produtos corrosivos, agressivos ou que apresentem risco" no lugar do texto genérico, e o pagamento por modalidade. O hash do texto publicado (`scripts/hash-documentos.mjs`) fica na tabela junto da versão; Termos de Uso e Privacidade ganharam o hash dos dois textos.
- **Envio** (`solicitar_v3`, RPC direta; quem acabou de se cadastrar envia pelo ticket, que passou pelo anti-robô no cadastro): nunca cobra (item 37); grava os endereços novos (salvo vira ativo e principal se a cliente ainda não tem; uso único fica só no histórico; pelo ticket de CPF já cadastrado, sempre uso único e sem mexer na conta); pedido com número sequencial, modalidade, origem, cupom e condição aplicados (consumo só na confirmação, item 43), flag de pacote com endereço novo; cada atendimento com retrato do endereço, características, refeição, sugestão, justificativa, taxas e itens; evidência do aceite (`aceites_solicitacao`: quem, CPF/CNPJ, WhatsApp, versões dos três documentos, hash de versões + hashes dos textos + data, user agent e IP aproximado dos cabeçalhos da requisição). O ticket é de uso único; repetir com a mesma chave depois devolve o mesmo pedido. Contexto da cotação pelo ticket: cupom e primeira contratação, nunca condição comercial nem faturamento. "Primeira contratação" = nenhum pedido confirmado e cadastro que não veio da base importada (quem era cliente do sistema antigo não é primeira contratação).
- **Tela final** (item 55): "Solicitação recebida!", "Nº da solicitação: 00XXXX" (6 dígitos com zeros à esquerda) e o texto literal; o rascunho é apagado.
- **Visual** (item 1): fundo rosa-bebê `#fdf6f7` com borrifador, balde, esponja, escova, pano e frasco em traço fino nas laterais (SVG próprio em `assets/agendamento/`, opacidade 0,11 no computador e 0,08 menores no celular), centro limpo e o card com sombra rosada leve.

### V6. Painel, cobrança, mensagens e comprovantes
- **Confirmar disponibilidade no v3 cria só a 1ª cobrança:** integral (avulsa e multi) ou a 1ª metade do pacote (arredondada pra cima no centavo). A 2ª metade nasce pela rotina `privado.v3_rotina_parcela2` (cron a cada 15 min, `rodar_rotina_parcela2` só pro papel de serviço do backend): gerada e enviada 2 dias antes do vencimento, que é às 14h do dia útil anterior ao marco (diária de índice floor(n/2)). Reagendar uma diária recalcula a 2ª parcela pendente (trigger). É nessa confirmação que o cupom e a condição de uso único são consumidos (item 43), não no envio.
- **Faturamento empresarial autorizado:** confirmar já leva o pedido a confirmado, com uma parcela "faturamento" (forma e nota fiscal do cadastro, vencimento = última diária + prazo); sem Pix quando a forma é transferência. Conta como paga pra liberar a diária.
- **Painel:** aba "Cadastros sem solicitação" (item 34) com situação de prospecção; card da solicitação v3 com número, modalidade, origem, cupom, aceite, cada diária com endereço e características, alerta de duração menor que a sugerida e os valores do item 49; horários de 15 em 15 minutos; recusa e cancelamento com motivo padronizado (`motivos_padrao()`, o código vai junto pro dashboard) mais o detalhe; ficha da cliente com endereços (inativar), condição comercial e faturamento (só admin); Configurações com cupons, conteúdo do agendamento, feriados e faixas de CEP; Pagamentos mostra as parcelas do pedido, inclusive a 2ª prevista com a data de envio.
- **Mensagens:** `solicitacao_recebida` v2 com o número; `lembrete_prazo_pagamento` v2 diz o que vence ("a 1ª parte do pacote"); `cobranca_parcela2` novo (regra C17); C02 não dispara pra faturamento (`semFaturamento`). Os modelos alterados precisam de nova aprovação na Meta antes do go-live.
- **Comprovante e página de pagamento:** rótulo por parcela ("1ª parte do pacote", "Faturamento empresarial") e o número da solicitação; o acompanhamento mostra número e modalidade.

### V7. Preview, testes de ponta a ponta e acabamento
- **Teste de ponta a ponta no preview** (`scripts/testa-v3-preview.mjs`, entra no `--completo`): navegador contra o Pages e o Supabase de homologação, só fictícios, cobrindo os cenários da spec (avulsa, passadoria, mudança intensa, eventos após, 3 profissionais em endereços diferentes, pacote semanal de 5 com desconto e troca de frequência, pacote com endereço novo, cliente com endereço salvo, cadastro abandonado, cupom válido e inválido, desconto especial não cumulativo, faturamento, duração menor, menor de idade, nome de uma palavra, duplo clique, 320/375/768 sem rolagem lateral). Os passos comuns ficam em `scripts/lib-v3-pw.mjs`; os testes antigos de preview (b0, f2, q1, bloco 3) passaram pro fluxo v3.
- **Pacote que fica com uma data só** (cancelamento das outras) vira cobrança única e a 2ª metade ainda não paga cai (migration `20261017130000`): antes, cancelar dava `DATA_INVALIDA` sem mensagem.
- **Motivos padronizados** só pra equipe Prime (`public.motivos_padrao` exige o papel; a lista fica em `privado`, que o gatilho do código do motivo usa também no cancelamento pela cliente). Achado da auditoria.
- **Turnstile compacto** quando a caixa tem menos de 300 px (celular de 320 px): o "flexible" vazava 14 px pro lado.
- **Minha conta** com pedido v3: título pela modalidade ("Diária de...", "3 profissionais em...", "4 diárias, semanal"); antes quebrava a página (frequência nula no v3).
- **Lighthouse:** acessibilidade 100 em todas as telas do fluxo (cada passo medido com o rascunho gravado, `lighthouse-a11y`). Performance da entrada do agendamento no celular fica em 81 a 84: o título só desenha depois que `src/config/precos.js` busca a tabela vigente no Supabase em `await` de topo (decisão do F2, vale pro site todo). Modulepreload, preconnect e import estático foram testados e não mudaram a nota; ficou de fora (ver PENDENCIAS).
- **Revisão do Codex no V7** (migration `20261017140000`): pacote reduzido a uma data tem a 1ª parcela como cobrança única (cobre a diária restante e, se ainda aberta, vira o total); 2ª parcela com saldo zero ou negativo (diárias canceladas depois da 1ª paga) não é gerada e a aberta cai; a confirmação reconfere o cupom (limite de usos, primeira contratação) e a condição de uso único, que outro pedido pode ter usado depois do envio, e devolve o motivo pra Prime decidir (recusa ou combina); total zero (desconto de 100%) confirma sem cobrança e a diária conta como paga. O mock segue as mesmas regras.
- **Reset da demonstração** (`demo-homolog --reset`) apaga também endereços, aceites, tickets, condição e faturamento da cliente demo (a FK de `enderecos` barrava o reset desde o V1).

## Painel v2, etapa B (spec-painel-v2 versão 3, referência dashboard-isa.png)

### B1 a B3. Componentes, navegação e Início
- **Painel novo em `src/ui/painel2/`** com casca própria (sem cabeçalho e rodapé do site), classes `p-` pra conviver com o CSS das abas antigas. As 16 abas antigas viraram seções das telas novas (`src/ui/paginas/painel-legado.js`, o antigo `painel.js` sem montar página): nada some, e os links `?aba=` continuam abrindo a mesma seção dentro da tela nova (`MAPA_ABAS` em `src/ui/painel2/app.js`).
- **Navegação:** Início, Solicitações (com contador), Agenda e escala, Clientes, Profissionais, Financeiro e Gestão (Indicadores, Automações, Configurações, Ajuda). No celular: Início, Solicitações, Agenda, Clientes e "Mais" (5 itens, como a crítica do Codex pediu). Topo com busca única (`buscar_global`: cliente, endereço, profissional e número da solicitação; telefone mascarado, limite por hora e auditoria sem o termo), sino (urgentes + solicitações novas), ajuda, conta (trocar de área e sair) e a data.
- **Início:** um RPC por bloco (`painel_*`), cada bloco carrega sozinho com esqueleto e "Tentar de novo", é recolhível (lembra no aparelho) e mostra a urgência no cabeçalho mesmo recolhido. Stand-by, alertas e novos cadastros somem quando vazios; "Precisa de você" vira "Tudo resolvido". Cache de 30 s, limpo depois de cada ação; os blocos afetados e os contadores recarregam.
- **Aprovar é 1 clique** a partir do Início (a proposta da etapa A tinha 2). Recusar pede motivo padronizado; Negociar data manda a proposta pelo WhatsApp (C18) com validade de 48 h e marca a linha; a solicitação continua até aprovar ou recusar.
- **Estados novos** (migration `20261018110000`): escala do dia (Em preparação, Revisada, Publicada; publicar exige todas as diárias com profissional, é idempotente pela chave, só republica depois de mudança, reabrir pede motivo; publicar dispara D09 pra cada profissional); stand-by (profissional aprovada que trabalha no dia da semana, sem diária e sem folga; Confirmar designa numa diária de hoje sem profissional ou registra a prontidão; Liberar some com ela do bloco); adiantamento e Uber como pendência (a Prime registra pelo painel; recusa com motivo, decisão única, auditada); habilidades da profissional; motivos de recusa e cancelamento editáveis pela administração ("Outro" sempre fica); meta mensal (+10% configurável, só administração); pagamento informado e não encontrado no extrato volta pra pendente e avisa a cliente (C19).
- **"Precisa de você"** junta, por prioridade: diária sem profissional (hoje e amanhã urgentes), substituição (a profissional ficou impedida), pagamento informado (urgente depois de 2 h), pagamento vencido, adiantamento, Uber, hora extra, pacote com endereço novo, cadastro de profissional, documento vencido, ocorrência (urgente parada há 48 h) e mensagem automática que falhou (Reprocessar). "Resolver" mostra as profissionais compatíveis com quem está em stand-by primeiro.
- **Indicadores da Home:** meta = mês anterior realizado × (1 + %); progresso = realizadas + agendadas do mês; motivos de cancelamento pelas diárias canceladas do mês (código do motivo; sem código vira "Sem motivo registrado"); regiões pelas diárias do mês (cidades; clique abre os bairros). Conferidos contra SQL independente em `testa-painel2-homolog`.
- **Hoje e amanhã lado a lado** a partir de 1400 px de largura; abaixo disso, um embaixo do outro (com as colunas da referência não cabem em meia tela de notebook de 1366).
- **Demonstração pra cliente** (`https://painel-v2-demo.prime-limpeza.pages.dev`): build com dados só no navegador e o seed rico de `scripts/fixtures/seed-painel.js` (tudo inventado, datas relativas a hoje). O preview da branch continua no homolog pros testes. Nenhum dado real.

### B4 a B7. Telas, linguagem, celular e qualidade
- **Telas** (migration `20261018120000`): Solicitações com filtros (situação, modalidade, origem, período) e painel lateral pelo link `?pedido=`; Escala do dia; ficha da cliente com linha do tempo única (solicitações, pagamentos, mensagens sem conteúdo, ocorrências, acessos, aceites) e privacidade; Equipe com habilidades, stand-by de hoje, documentos vencidos e média das avaliações; Adiantamentos e reembolsos; Motivos e meta. As seções antigas continuam ao lado (agenda por profissional, designar, pagamentos, cadastros e documentos, automações, preços, LGPD, relacionamento, ocorrências).
- **Linguagem:** fora "motor", "worker", "txid", "eventos com erro" e os nomes técnicos das opções. Ajuda reescrita a partir do Início (14 tarefas) com prints da demonstração; o manual `.docx` sai do mesmo texto (`scripts/painel-v2/gera-manual.mjs`).
- **Tour:** convite discreto no 1º acesso, dentro do Início (não cobre nada); 5 passos; refeito pela Ajuda.
- **Celular:** colunas secundárias só na expansão, indicadores e listas secundárias começam recolhidos (a escolha da pessoa vale depois), alvos de 44 px.
- **Qualidade:** teste do novato (`testa-painel2-novato`) com os limites de cliques da proposta (aprovar 1, designar 2, conferir pagamento 2, achar cliente 1, ver o dia 0, aprovar cadastro 2, publicar escala 2). Lighthouse mobile na demonstração publicada (`scripts/painel-v2/lighthouse-painel.mjs`): Início 85, Solicitações 86, Ficha 87, Agenda 85, Financeiro 87; acessibilidade 100. A altura do esqueleto do Início é reservada (CLS de 0,71 pra perto de zero).
- **Revisão do Codex (B7):** "Precisa de você" mostra todas as pendências numa lista com rolagem própria; recusar pacote recarrega as solicitações; aprovar endereço novo idempotente (migration `20261019100000`); foco preso no modal e no "Mais" (com Fechar e fundo inerte); limpar a busca descarta o resultado antigo. Mantido de propósito: a profissional pode registrar o próprio adiantamento pela RPC (só o dela; o app dela é pendência da cliente) e a ordem dos blocos segue a spec e a referência (as urgências também aparecem no sino do topo).

## Design system e repaginação (spec-design-system.txt, 19/10/2026)
Branch `turno/design-system`, empilhada sobre `turno/painel-v2-b` (PR #8). Nenhuma RPC, RLS, cálculo ou fluxo muda.

### D1. Diagnóstico (antes)
Fotos de 32 telas em 390 e 1440 no mock com dados fictícios (`node scripts/design/fotos.mjs <pasta>`, que também mede a rolagem lateral em 320). Inventário: `node scripts/design/lint-design.mjs --inventario`.
- **Degradê:** 23 `linear-gradient` (20 na home); o botão principal é dourado em degradê em todas as páginas; 18 textos em degradê (`background-clip:text`: a palavra destacada do título da home e das páginas internas, os títulos do rodapé, o botão "fantasma").
- **Brilho e sombra colorida:** 23 sombras diferentes, 6 delas douradas ou coloridas (botão principal, cabeçalho); desfoque no topo do painel.
- **Cards iguais:** 4 grades de cartões idênticos na home (benefícios, passo a passo, por que contratar, serviços com foto); no painel, ícone num quadrado colorido no título de cada um dos 9 blocos do Início e em cada pendência.
- **Hero clichê:** título centralizado com palavra em degradê, subtítulo e dois botões na home; o mesmo título com palavra dourada em todas as páginas internas.
- **Selos demais:** 2 selos em caixa alta por pedido na Minha conta; no painel, 2 selos por diária e botões verde e vermelho em toda linha.
- **Ícones misturados:** 4 origens (src/ui/icones.js, src/ui/painel2/icones.js, 10 SVGs em assets/icons, 21 SVGs soltos no index.html), traço de 1,75 a 3, tamanhos de 14 a 34 px.
- **Tipografia:** DM Sans 800 nos títulos e Inter no texto (as duas de template), 61 tamanhos de fonte diferentes.
- **Espaço e forma:** 650 espaçamentos fora de escala; 21 raios diferentes; 106 cores escritas à mão (291 ocorrências).
- **Foto de banco:** 7 fotos genéricas na home (sorriso posado, luvas amarelas, mulher preocupada no sofá).
- **Animação em tudo:** entrada com fade em 40 blocos da home e em 20 módulos de tela (`.reveal`); botão que sobe no hover.
- **Já fora do padrão antes:** a ficha da cliente no painel rolava de lado em 320 px.

### D2. Fundamentos
- **Arquivo único:** `src/ui/tokens.css`. Nenhum outro arquivo tem valor visual; `scripts/design/lint-design.mjs` (na suíte `--rapido`) falha se tiver. Ordem de carregamento em toda página: `tokens.css`, `ds/base.css`, `ds/componentes.css`, CSS da área. Durante a migração o lint tem uma lista de arquivos pendentes, que fica vazia no D8.
- **Cor:** o marinho do logo (#25225d, o 700 da escala) em título, navegação ativa e botão principal; dourado só como acento (linha, foco sobre o fundo escuro, sobretítulo no dourado 700, que tem 7:1 no claro); neutros levemente quentes, fundo off-white. O rosa do agendamento vira `--rosado-*`, um neutro com um toque de rosa. Estados (sucesso, atenção, erro, informação, neutro) com fundo, borda e texto, todos AA. Gráficos: marinho 700, dourado 400, marinho 300, neutro 500 e dourado 200.
- **Degradê:** só no logo. Nenhum outro elemento de assinatura.
- **Fontes:** Source Serif 4 (600) nos títulos de página e de seção: serifa de leitura, sóbria, conversa com o PRIME serifado do logo e dá o tom de papelaria de qualidade. Source Sans 3 (400 e 600) no texto e na interface: mesma família de desenho, legível em 14 px, com números tabulares. Arquivos locais, só latin, `font-display:swap`, 3 arquivos de 15 a 21 kB. DM Sans e Inter saem no D8.
- **Escala:** 12, 14, 16, 18, 22, 28, 36 e 48 px, com altura de linha por nível; espaço em base 4 (4 a 96); raio 6 (campo e botão), 10 (cartão) e 999 (avatar e chip); 2 sombras neutras; movimento de 120 e 200 ms com uma curva só, zerado com "reduzir movimento".
- **Densidade:** site respirado (corpo 16 px); painel denso (`data-densidade="painel"`: corpo 14 px, fundo neutro 50, menos espaço interno).
- **Ícones:** Lucide (ISC), gerado em `src/ui/ds/icones.js` por `scripts/design/gera-icones.mjs`; `src/ui/icones.js` e `src/ui/painel2/icones.js` só reexportam. Traço fino, 16, 20 ou 24 px, sempre com texto ao lado ou nome acessível. WhatsApp e Instagram usam os ícones do Lucide (balão e câmera) com o nome escrito ao lado, sem marca de terceiros fora do conjunto.
- **Critério visual (pra não voltar a cara de IA):** composição alinhada à esquerda, com texto corrido de no máximo 68 caracteres por linha; uma ação primária por área; cor só pra ação e estado; título em serifa e o resto em sans; seção separada por espaço e linha fina, não por cartão; nenhuma grade de cartões iguais com ícone em círculo; imagem só se for da Prime (enquanto a cliente não mandar fotos, composição tipográfica).

### D3. Componentes
`src/ui/ds/componentes.css` é a biblioteca única: botão (primário, secundário, terciário, perigo; M e P; normal, hover, foco, desabilitado, carregando), campo, select, contador, checkbox, opção em cartão, data e hora, chip, selo de estado, contagem, alerta, toast, modal (folha de baixo no celular, com as ações fixas), painel lateral, abas (rolam de lado no celular), acordeão, tabela, cartão de conteúdo e de métrica, linha do tempo, avatar, vazio, carregando, esqueleto, paginação, etapas do agendamento, cabeçalho e rodapé do site. Os componentes do B1 do painel passam a usar estas classes. A página viva fica em `/_dev/design-system/` (noindex), com `scripts/testa-design-system.mjs` rodando o axe (WCAG 2.1 AA) em cada componente, conferindo as fontes locais e os números tabulares e procurando rolagem lateral em 320 e 390. O `axe-core` virou devDependency (antes vinha só pelo Lighthouse).

### D4. Início do painel
- Densidade do painel (`data-densidade="painel"` no body): corpo 14 px, fundo neutro.
- Os blocos não têm mais ícone em quadrado colorido. Título em sans 16 px com a contagem em cinza; urgência numa barra fina vermelha à esquerda e no texto ("5 urgentes").
- Botões da biblioteca: Aprovar e Confirmar são o primário da linha; Recusar é perigo, em contorno; Negociar é secundário.
- Um selo por diária (a situação). O pagamento vira texto de apoio, em cor de atenção só quando está pendente.
- Gráficos com a paleta de dados, por classe (`p-dado-1..5`), sem cor no JS.
- O véu do menu "Mais" no celular estava acima da folha (camada 60 contra 41); corrigido.
- Demonstração: https://design-system-demo.prime-limpeza.pages.dev/painel/entrar/ (a do painel v2 antigo continua em painel-v2-demo, pra comparar).

### D5 e D6. Site, agendamento, áreas logadas, profissional e demais telas do painel
- Todas as páginas na mesma pilha de CSS: `tokens.css`, `paginas.css` quando há, `ds/base.css`, `ds/componentes.css` e o CSS da área. `src/ui/base.css` saiu; cabeçalho e rodapé estão na biblioteca.
- **Home:** mesma ordem e mesmos textos da cliente.
  - Hero à esquerda, sem vídeo e sem palavra em degradê; a lista de serviços (item 1) fica ao lado, com linha dourada fina.
  - Os 4 blocos curtos (itens 2 e 16) são separados por linha, sem ícone.
  - "Você já passou por isso?" e a apresentação ficam em duas colunas (título e texto).
  - Serviços em grade de texto, sem foto, com "Agendar" secundário. O carrossel saiu: com 6 itens, a grade mostra tudo.
  - Uma única faixa escura, a do fechamento.
  - As 7 fotos de banco saíram da home; os arquivos continuam em `assets/` até a cliente mandar fotos próprias.
  - Referência nova do `compara-home` em `docs/shots/home-ds/`, inspecionada; a de 24/09 fica em `docs/shots/home-v2/`.
- **Agendamento:**
  - Fundo `--rosado-25`; marca-d'água redesenhada em traço de 1 px no marinho, com opacidade de 0,07 e só acima de 1100 px.
  - Cartão do passo com borda fina, sem sombra.
  - Opção em cartão, contador, calendário, seletor de hora e diálogos nativos entraram na biblioteca, com os nomes que o agendamento já usava. O progresso usa `.progresso-fluxo`.
- **Páginas internas:**
  - Abertura clara, com título em serifa e sem palavra em degradê.
  - O rótulo deixa de ser caixa alta e passa a sobretítulo dourado 700.
  - O cartão "principal" perde a barra dourada; os cartões escuros viram cartão sutil.
- **Consentimentos e aceites:** viraram caixa de marcar visível (`.check`), não mais pílula com o checkbox escondido.
- **Estilo inline:** os cerca de 150 estilos soltos em JS viraram utilitários da biblioteca (`u-*`), e o lint também confere `style:` em JS.
- **Ícones:** os SVG soltos e os 10 de `assets/icons` saíram; tudo vem de `ds/icones.js`. As 3 fontes antigas de ícone reexportam o conjunto.
- **Entrada animada:** saiu de 20 módulos (`.reveal`, `ativarReveal`).

### D7. Microcopy
- O `verifica-texto`, que já barrava emoji, travessão, exclamação em série e expressões de IA, ganhou as expressões da seção 4 da spec (experiência única, potencialize, revoluciona, incrível, sua jornada, mágica). Não há ocorrência.
- A caixa alta imposta pelo CSS saiu de rótulos, selos, títulos do rodapé e cabeçalhos de tabela.
- Reticências padronizadas (…).
- Textos literais da cliente mantidos, inclusive a caixa alta que vem dela ("HORÁRIO DE INÍCIO", "ENVIAR SOLICITAÇÃO").
- As mensagens de erro e de vazio já estavam diretas desde o B5 do painel e foram mantidas.

### D8. Qualidade
- **Lint de design** (`scripts/design/lint-design.mjs`, no `--rapido`) falha com:
  - cor, sombra, raio, tamanho, peso ou família de fonte, espaçamento ou duração fora dos tokens, em CSS, `style=""` do HTML e `style:` do JS;
  - degradê;
  - desfoque;
  - `@keyframes` além de `ds-pulso` e `ds-gira`;
  - hover com translate;
  - emoji;
  - SVG fora do conjunto;
  - classe `reveal`.

  Exceções: `tokens.css`, o módulo gerado de ícones, os gráficos do painel (SVG que não é ícone) e o protótipo histórico `painel-proposta/`, que mantém o visual da etapa A como registro e por isso ainda usa os arquivos da Inter.
- **Contraste** (`scripts/design/contraste.mjs`, no `--rapido`):
  - 57 pares reais (texto, apoio, título, borda de campo a 3:1, foco, selos, toast, faixa escura) passam no mínimo AA;
  - a paleta de dados é distinguível em protanopia, deuteranopia e tritanopia (menor ΔE 16,4);
  - a borda de campo e controle passou a ser `--cor-borda-campo` (neutro 500, 4:1), por causa do critério 1.4.11.
- **Fotos e PDF:** `scripts/design/fotos.mjs` fotografa as 32 telas. Nenhuma tem rolagem lateral em 320, 390 ou 1440, nem erro de console. O PDF antes e depois sai de `scripts/design/gera-pdf.mjs` (uma página por tela).
- **Lighthouse do painel** (demonstração publicada): Início 87, Solicitações 85, Ficha 87, Agenda 87, Financeiro 87; acessibilidade 100. O nome acessível do sino passou a começar pelo número que aparece nele.
- **Imagem de compartilhamento** (`assets/og-prime.jpg`) no visual novo: marinho, serifa e linha dourada, sem foto de banco e sem degradê.

## Referências e princípios de acabamento (20/10/2026)
Estudo das páginas públicas, só de princípio (nada de layout, texto, marca ou código copiado). Prints só pra uso interno, fora do repositório. Produto: Linear, Attio, Stripe, Vercel, Cal.com, Notion, Plain, Mercury. Serviço de alto padrão: Aman, One Medical, Parsley Health (Four Seasons bloqueou o acesso automatizado).

**Painel e produto**
1. Uma ação principal por tela, escura e sólida; o resto é contorno ou texto (Linear, Attio, Cal.com).
2. Cor só pra estado e alerta. A interface é neutra, e verde, âmbar e vermelho aparecem só em situação (Linear, Attio, Stripe).
3. Tabela com no máximo 7 colunas visíveis no computador; o resto vai pra expansão ou pro painel lateral (Attio, Linear).
4. Número alinhado à direita, com dígito tabular; valor em moeda sempre com a mesma casa decimal (Stripe, Attio).
5. Linha de tabela com 44 a 52 px, divisória de 1 px e hover que só muda o fundo, sem sombra nem movimento (Attio, Linear).
6. Métrica: número grande, rótulo pequeno em cima e comparação discreta embaixo, sem ícone decorativo (Vercel, Stripe).
7. Gráfico sem 3D e sem degradê, com legenda junto do dado, em poucas cores e eixos quase invisíveis (Stripe, Vercel).
8. Busca global sempre visível, com atalho de teclado mostrado no campo (/ ou Ctrl+K) (Linear, Attio).
9. Navegação lateral com itens curtos, ícone de traço fino e contagem só onde há trabalho esperando (Linear).
10. Estado vazio que diz o que acontece e o próximo passo, numa frase, sem ilustração grande (Linear, Plain).
11. Saudação e data no topo, depois "o que precisa de você"; o resto do dia vem embaixo (Attio, Linear).
12. Tipografia de interface com 2 pesos, tamanhos de 12 a 16 na operação e títulos sem caixa alta (Linear, Attio, Vercel).
13. Foco visível em tudo e ordem de Tab que segue a leitura; atalho de teclado nas ações frequentes (Linear).

**Site de serviço de alto padrão**
14. Título de seção em serifa, corpo em sans, sem caixa alta longa; serifa leve e grande no topo (Aman, Parsley).
15. Muito espaço: seção com pelo menos 96 px de respiro no computador; poucas coisas por dobra (Aman, Parsley).
16. Um CTA principal por dobra, sólido e escuro; o secundário em contorno ou texto (One Medical, Parsley).
17. Confiança por fato concreto (como funciona, o que inclui, o que não inclui, onde atende), não por adjetivo (One Medical, Parsley).
18. Preço e regra em texto curto e calmo, perto da decisão, sem tabela poluída nem destaque gritante (Parsley, Stripe).
19. Sem foto, a página se apoia na tipografia, em linhas finas e numa cor de marca; ilustração genérica não entra (Aman).
20. Composição alinhada à esquerda, texto com 60 a 75 caracteres por linha e grade de 12 colunas no computador (Parsley, Stripe).
21. Ritmo editorial: alternar bloco de texto, lista e destaque; evitar três grades de cartões seguidas (Aman, Parsley).
22. Fluxo de compra em passos claros, com resumo fixo ao lado no computador e o botão de avançar sempre visível no celular (Stripe Checkout, Cal.com).
23. Validação gentil: o erro aparece junto do campo, em texto, só depois de a pessoa tentar avançar (Stripe, Cal.com).

### Kit do logo (21/10/2026)
- **Fonte:** `Material_Completo_-_PDF.pdf` da cliente, com 12 páginas. Por página:
  - 1: colorido;
  - 2: selo colorido;
  - 3: colorido sobre marinho;
  - 4: selo sobre marinho;
  - 5: preto;
  - 6: selo preto;
  - 7: branco;
  - 8: selo branco;
  - 9 e 10: versões grandes do colorido e do selo;
  - 11 e 12: só os telhados.
- **Vetor:** o `pdftocairo` não existe neste ambiente. O vetor saiu do pdf.js 2.16 (`SVGGraphics`) no Chromium, recortado no que tem tinta. Saíram assim o branco, o preto e o selo branco (`assets/marca/*.svg`, de 30 a 66 kB).
- **Versões coloridas:** viram SVG de 20 a 146 MB, porque o degradê é expandido. Por isso, no fundo claro o site continua com `assets/logo.svg`, vetor e inteiro. Do PDF ficam os PNG 1x e 2x (`scripts/design/gera-marca.mjs`), que trazem a sombra cinza do material.
- **Onde cada versão entra:**
  - cabeçalho: colorido;
  - rodapé e imagem de compartilhamento: branco, agora com "LIMPEZA ESPECIALIZADA" inteiro (o `logo-branco.svg` antigo, cortado, saiu);
  - recibo em PDF: logo preto, em JPEG embutido pelo próprio gerador (`src/domain/pdf.js`, sem biblioteca);
  - favicon, ícone do iPhone e ícones do app da profissional: o símbolo (os telhados do logo branco) sobre o marinho (`scripts/gera-icones-pwa.mjs`).
- **Cores:** o marinho dos tokens (#25225d) é o mesmo do `logo.svg`. O dourado-500 (#b08a3a) está dentro da faixa do degradê do logo (#885600 a #f6e666). Nada mudou nos tokens. O degradê dourado continua só dentro do logo.

### Desempenho do painel (F1, 21/10/2026)
- **No dist:** as folhas de CSS de cada página viram um arquivo só (`otimizarPaginas` em `scripts/monta-dist.mjs`). O código-fonte não muda.
- **Modulepreload do grafo de imports:** testado e desligado. Com todos os módulos pré-carregados o Início caiu de 85 pra 75 (a banda vai embora antes do primeiro desenho). Fica atrás de `MODULEPRELOAD=1`.
- **Medido** (Lighthouse mobile, demonstração publicada, melhor de 3): Início 88, Solicitações 86, Ficha 86, Agenda 86, Financeiro 86; acessibilidade 100. A meta de 90 **não foi atingida**. Segunda medição em 21/10, depois da revisão visual: Início 86, Solicitações 85, Ficha 84, Agenda 85, Financeiro 85. A nota varia de 2 a 4 pontos entre rodadas. No preview real (`lighthouse-q1`): home 99, solicitação 80, Minha conta 96, painel 90; acessibilidade 100 em todas.
- **Gargalo:** o painel é montado pelo JavaScript. O FCP (2,5 s) e o LCP (3,7 a 3,9 s) esperam a cascata de ES modules sem bundler; o TBT é zero. O CSS único ainda conta 300 ms como bloqueante. Chegar a 90 pede um bundler (ou HTML pré-montado do painel), o que é mudança de arquitetura e fica pra decisão da Gabrielle.

### Revisão visual do GPT (N5, 21/10/2026)
8 telas antes e depois (home 390 e 1440, datas e revisão do agendamento, Minha conta, Início, Agenda e Solicitações do painel). Pergunta: "o que ainda parece amador ou feito por IA?". Cada item foi conferido no print antes de mexer.
- **Corrigidos:**
  - Agenda: as colunas mudavam de lugar de um dia pro outro. Agora largura fixa e igual (`colgroup`, `table-layout: fixed` a partir de 1100 px).
  - Agenda: todos os selos de situação tinham a mesma cor. Agora usam o tom do Início: a confirmar em atenção, confirmada em verde, a caminho e em andamento em azul.
  - Início: "Precisa de você" cortava a última pendência no meio (rolagem interna de 560 px). Agora mostra todas inteiras, sem rolagem interna. "Mostrar mais" foi tentado e saiu: escondia o cadastro que o teste do novato aprova em 2 cliques.
  - Solicitações no celular: os filtros estreitos empilhados ocupavam a primeira dobra. Agora ficam em duas colunas na largura toda.
  - Minha conta: a diária aparecia como cartão dentro do cartão do pedido. Agora é separada por linha fina.
- **Descartados:**
  - Barras fixas sobre o conteúdo: é efeito do print de página inteira; no celular a barra fica embaixo, como deve.
  - Respiro grande entre seções da home: é o princípio 15 das referências.
  - Hierarquia da home no celular: sem defeito concreto apontado.
  - Botão "Agendar" da faixa final: pedido literal da cliente (home-isa.txt, item 21).
  - Utensílios em marca-d'água no agendamento: pedido literal da cliente (autoagendamento-v3-isa.txt, item 1).

### Painel limpo (entrega final, 26/10/2026)
Fonte: dashboard-regras-isa.txt, dashboard-isa.png e os 23 princípios acima. Auditoria com `node scripts/design/fotos.mjs <pasta> --contar` (mock, seed fictício). Os números contam só o que está visível na área de conteúdo, na página inteira.

**Início, antes > depois:**

| Largura | Cores | Selos | Ícones | Botões | Colunas | Textos de ajuda |
|---|---|---|---|---|---|---|
| 1440 | 24 > 18 | 16 > 3 | 165 > 73 | 76 > 65 | 8 > 7 | 4 > 3 |
| 390 | 24 > 18 | 16 > 3 | 136 > 68 | 72 > 65 | 0 > 0 | 4 > 3 |

**Outras telas:**
- Financeiro: selos 120 > 0 e botões 120 > 25.
- Agenda: selos 25 > 11.
- Profissionais: selos 16 > 1.
- Solicitações: ícones 64 > 24 e colunas 8 > 7.

**O que mudou:**
- **Início:**
  - Abertos: Solicitações novas, Precisa de você, Stand-by e Diárias de hoje (ver o dia sem clique, aceite da spec).
  - Recolhidos por padrão: Diárias de amanhã, Alertas, Novos cadastros, Meta, Motivos e Regiões. O cabeçalho continua com a contagem, a urgência, o selo da escala e o resumo da meta. A escolha da pessoa fica gravada.
- **Botões:** uma ação principal, "Aprovar" sólido. Recusar, Negociar data, Resolver, Dar prazo, Liberar vaga, Confirmar e Liberar do stand-by viram secundários neutros, sem ícone decorativo. Os modais de confirmação continuam com o vermelho onde a ação apaga algo.
- **Selos:** só onde muda a decisão (a confirmar, sem profissional, urgente, documento vencido, cadastro pra analisar, estornado, cancelado). O andamento normal fica em texto neutro: confirmada, em andamento, concluída, ativa, em stand-by, folga.
- **Tabelas antigas no celular:** viram cartões com o rótulo de cada campo, sem rolagem lateral.

**Onde foi parar o que saiu do destaque (tudo a um clique):**
- Origem da solicitação: seta de detalhe e painel lateral ("Como conheceu").
- Local e imóvel no celular: seta de detalhe (endereço e características).
- Diárias de amanhã, alertas, novos cadastros e os três indicadores: seta do bloco.
- Frase "Analise, aprove, recuse ou negocie...": saiu; os botões dizem a mesma coisa.
- Situação repetida no Financeiro ("Pagamento informado", "Pendente", "Confirmado"): está no título de cada seção. A coluna só aparece quando alguma linha foge do padrão (ex.: estornado).
- Coluna "Informado em": só aparece quando alguma linha tem o dado.
- Recebidos: do mais recente pro mais antigo, 20 por vez, com "Mostrar mais".
- Ícones de tipo nas listas de pendências, alertas e cadastros: o título de cada item já diz o tipo; a urgência continua na borda e no título em vermelho.

**Fica como está, por regra da cliente:**
- Aprovar, Recusar e Negociar data em cada solicitação nova.
- Ícones de habilidade da profissional.
- WhatsApp visível.

**Fica igual:** as telas antigas não têm detalhe pra esconder campos. No celular viram cartão com todos os campos, sem tirar informação.

### Design system consistente (entrega final, 26/10/2026)
- **B1:** o lint de design (`scripts/design/lint-design.mjs`, no `--rapido`) cobre tokens, degradê, emoji, ícone fora do conjunto Lucide, animação de entrada e hover que levanta. Está verde nos 91 arquivos.
- **B2, consolidado:**
  - O selo virou uma função só (`src/ui/comum.js`); o do painel novo reexporta.
  - Os números de saúde das automações usam `.cartao` + `.metrica` da biblioteca; o `.kpi` próprio saiu.
  - A regra "só pra leitor de tela" ficou única na biblioteca (`.sr`, `.p-sr`, `.sr-only`, `.visualmente-oculto`).
  - Saiu o CSS sem uso: `.btn-largo`, `.titulo-pagina` e `.grade-horarios`.
- **B2, verificado e mantido:** `.chip`/`.p-chip`, `.avatar`/`.p-avatar-circulo`, `.modal`/`.p-modal` e `.lateral`/`.p-lateral` são a mesma regra com dois nomes; não são versões diferentes.
- **B2, dívida** (registrada em PENDENCIAS):
  - modal em `div` (painel novo) e em `dialog` nativo (site e telas antigas);
  - opção em cartão em `.opcao` (form.js) e em `.card-escolha` (agendamento);
  - três estilos de tabela (`.p-tabela`, `table.painel`, `.tabela`).
- **B3, página viva:** comparada pelo DOM renderizado das 32 telas (`fotos.mjs --classes`).
  - Classes da biblioteca mostradas na vitrine: de 66 para 87 (de 182).
  - Entraram os componentes reais: cartão de escolha, calendário, progresso do agendamento e diálogo nativo.
  - Fora da vitrine, de propósito: cabeçalho e rodapé do site (a vitrine linka as páginas reais) e o seletor de horário (importa a tabela de preços, que no preview busca no Supabase).

### Revisão de arquitetura (entrega final, 26/10/2026)
- **Como foi feita:** grafo de imports a partir das páginas mais a revisão do Codex. A 1ª chamada estourou o tempo; a 2ª veio com escopo menor (permissões, exports sem uso e erro).
- **Módulos:** 112 de 115 de `src/` são alcançados pelas páginas. Os 3 restantes servem às Edge Functions e à API falsa dos testes. Não há módulo morto. O agendamento v2 não tem arquivo próprio sobrando: `src/config/agendamento.js` ainda alimenta o v3.
- **Corrigido:**
  - Exports sem uso: saíram `hashSenha`, `caixaAceite` e `caixasMarketing`; `areasDe` e `numeroBR` ficaram só internas.
  - Falha lançada pela rede no adapter Supabase passa pela mesma tradução (`SERVICO_INDISPONIVEL`).
  - 401 da Edge Function sem envelope vira `SESSAO_EXPIRADA`, como a RPC. Teste novo: `testa-adapter-erros`, no `--rapido`.
  - Saíram 12 imagens e o vídeo da home antiga, sem referência em nenhuma página (972 KB a menos no dist). Os rascunhos locais de debug (`scripts/design/dbg*`, não versionados) também saíram.
- **Conferido e mantido:** as RPCs `security definer` sem checagem de papel são as públicas por desenho: cotação, versões legais, conteúdo do agendamento, registro de erro e funil com limite por IP. As de conta só rodam com a chave de serviço (Edge Function), nunca pelo navegador.
- **Dívida:** em `docs/PENDENCIAS.md`, seção "Dívida técnica pós-lançamento".
- **Mapa:** `docs/ARQUITETURA.md`.
