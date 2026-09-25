# API da Prime (contrato dos casos de uso)

Este documento é o contrato entre o front e o backend. Os dois adapters (`mock` e `http`) implementam exatamente estes casos de uso, e `scripts/fake-api.mjs` implementa as rotas HTTP. Tudo que está aqui vale pro backend da fase 2.

## Regras fixas

1. **O backend recalcula e revalida tudo.** Preço, desconto mensal e cobranças são recalculados a partir da *especificação* do pacote. Transições, permissões e condições são revalidadas. O que o navegador manda é só o comando de negócio.
2. **O front não monta payload de provedor**, não escolhe destinatário e não escolhe template. Eventos e notificações são gerados pelo backend (no mock, por `src/app` + `src/automacoes/motor.js`). Um mesmo evento nunca gera mensagem nos dois lados.
3. **Contexto de autorização e de pagamento vem dos registros do backend**, nunca do corpo da requisição. `?dev=1` e `?id=` na URL não são autorização.
4. **Dinheiro em centavos inteiros.** Datas de calendário em `AAAA-MM-DD`; instantes em ISO 8601 UTC. Fuso de negócio: `America/Sao_Paulo`.
5. **Idempotência** em toda operação que cria ou muda estado (ver abaixo).

## Formato HTTP

- Base: `API_BASE_URL` (`src/config/app.js`). JSON UTF-8. Upload de documento em `multipart/form-data`.
- Cabeçalho `Idempotency-Key: <chave>` em toda escrita (o corpo não repete a chave).
- Sucesso: `200` (leitura, repetição idempotente) ou `201` (criação). Corpo = saída do caso de uso.
- Erro: status HTTP + `{"erro": {"codigo": "...", "mensagem": "...", "detalhes": ...}}`.
- Autenticação (Supabase Auth pela function `conta`): cliente por CPF, e-mail ou celular (senha padrão: 6 primeiros do CPF/CNPJ; pelo CPF, a data de nascimento; senha própria opcional), diarista por e-mail + senha, Prime por e-mail + senha com papel em tabela própria. O backend deriva o **ator** e o **atorId** da sessão. **A guarda de rota no front (`src/services/auth.js`, `exigirPapel`) é só conveniência de navegação: a autorização real é do backend (RLS por papel e por dono do registro).** No modo mock a "sessão" é um registro em localStorage, sem segurança nenhuma. O `fake-api` aceita `X-Ator-Teste: cliente:<id> | diarista:<id> | prime | sistema` **só para teste**; o backend real ignora esse cabeçalho.

## Códigos de erro

| código | HTTP | quando |
|---|---|---|
| `DADOS_INVALIDOS` | 400 | entrada fora do formato ou regra de campo; `detalhes` traz os campos |
| `DATA_INVALIDA` | 422 | data no passado, bloqueada, fora do horizonte, colisão de ocorrências |
| `REGIAO_NAO_ATENDIDA` | 422 | cidade do endereço fora de `regioesAtendidas` |
| `REGIAO_SOB_CONSULTA` | 422 | cidade marcada `sobConsulta` (Nova Lima): o front leva pro WhatsApp |
| `NAO_ENCONTRADO` | 404 | id inexistente (ou que o ator não pode ver: não vazamos existência) |
| `EVENTO_INVALIDO` | 400 | evento desconhecido |
| `TRANSICAO_PROIBIDA` | 409 | evento não permitido a partir do estado atual |
| `ATOR_SEM_PERMISSAO` | 403 | papel sem permissão ou não é dono do recurso |
| `CONDICAO_NAO_ATENDIDA` | 409 | ex.: confirmar diária sem o pagamento dela confirmado; a caminho com diarista não aprovada |
| `CONFLITO_IDEMPOTENCIA` | 409 | mesma chave de idempotência (mesma operação) com conteúdo diferente |
| `PAGAMENTO_NAO_ELEGIVEL` | 409 | informar/confirmar pagamento fora da elegibilidade |
| `JA_AVALIADO` | 409 | segunda avaliação pro mesmo atendimento |
| `CONFIG_INCOMPLETA` | 503 | funcionalidade sem config (ex.: Pix sem chave) |
| `SERVICO_INDISPONIVEL` | 503 | backend fora / timeout (o front mostra "tente de novo" e reusa a chave) |
| `ERRO_INTERNO` | 500 | qualquer outro |

## Idempotência

- A chave é gerada **uma vez por tentativa** na UI e guardada junto do rascunho/ação (`localStorage`). Clique repetido, recarregar a página e nova tentativa após falha **reutilizam a mesma chave**.
- Escopo da chave: `operação + ator + chave`. O backend guarda `hash(conteúdo)` e o resultado.
  - mesma chave + mesmo conteúdo → devolve o **mesmo resultado** (HTTP 200), sem criar nada de novo e sem gerar evento de novo;
  - mesma chave + conteúdo diferente → `CONFLITO_IDEMPOTENCIA`.
- A mudança de negócio, o registro de idempotência e os eventos pendentes são gravados **na mesma transação**. Falha em qualquer parte desfaz tudo (não existe estado "meio criado").
- Eventos também são idempotentes no consumo: cada notificação tem `chaveIdempotencia = eventoId:template:destinatario`; reprocessar um evento não duplica mensagem.

## Atores e transições do atendimento

`agendado → confirmado → diarista_a_caminho → em_andamento → finalizado → avaliado`; lateral `cancelado` (só antes de `em_andamento`). `reagendar` troca data/turno sem mudar estado.

| evento | de | para | atores | condições |
|---|---|---|---|---|
| `confirmar` | agendado | confirmado | prime, sistema | cobrança da diária (ou do pacote) **confirmada** |
| `sair_a_caminho` | confirmado | diarista_a_caminho | diarista (a atribuída), prime | diarista atribuída, com status `aprovada` |
| `iniciar` | diarista_a_caminho | em_andamento | diarista (a atribuída), prime | |
| `finalizar` | em_andamento | finalizado | diarista (a atribuída), prime | |
| `avaliar` | finalizado | avaliado | cliente (dono), sistema | feito por `criarAvaliacao` |
| `cancelar` | agendado, confirmado, diarista_a_caminho | cancelado | cliente (dono), prime, sistema | cancela notificações agendadas e a cobrança aberta da diária; recalcula as pendentes do mês |
| `reagendar` | agendado, confirmado | (mesmo) | cliente (dono), prime | `dados.data` e `dados.turno`; data revalidada no calendário; lembretes recalculados |

Quando a cobrança de uma diária é confirmada, o **sistema** aplica `confirmar` nela (na cobrança do pacote, em todas as `agendado`).

Status do pedido (ajustes da cliente, 24/09/2026): `solicitado` (cliente enviou; sem cobrança) → `disponibilidade_confirmada` → `aguardando_pagamento` (a cobrança nasce junto com a confirmação da Prime) → `confirmado` (primeiro pagamento confirmado); laterais `recusado` (sem disponibilidade, com motivo) e `cancelado` (todas as diárias canceladas); `concluido` quando nada está ativo e ao menos uma diária foi realizada. Terminais não voltam. `aguardando_entrada` e `ativo` só existem em registros antigos.

## Elegibilidade de pagamento (antecipado e integral)

- **Cobrança da diária** (`parcela: 'diaria'`, valor integral; o desconto do mês fica na última diária do mês) e **do pacote** (`parcela: 'pacote'`, desligada por configuração): pagáveis enquanto `pendente` ou `informado_pelo_cliente`, com o pedido em `aguardando_pagamento`, `confirmado` ou `concluido` e a diária não cancelada. Vencem até 14h do dia útil anterior à diária.
- Cancelar diárias cancela as cobranças abertas delas; pagamento confirmado continua confirmado (devolução = `registrarEstorno`).
- "Já paguei" (`informarPagamento`) só leva a `informado_pelo_cliente`. Só a Prime confirma (`confirmarPagamento`).

---

## Casos de uso

Notação: **E** entrada, **S** saída, **Erros**, **Ator**, **Falha parcial**. Toda escrita recebe `chaveIdempotencia` (HTTP: cabeçalho) e pode devolver `CONFLITO_IDEMPOTENCIA`, `SERVICO_INDISPONIVEL`, `ERRO_INTERNO`.

### confirmarAutoagendamento — `POST /autoagendamentos`
Caso de uso composto do autoagendamento: cria a SOLICITAÇÃO (cliente, se nova, + pedido `solicitado` + atendimentos), numa transação, SEM cobrança.
- **E** `{ cliente: {tipo, nome, telefone, email, cpf? (obrigatório pra pessoa física nova), dataNascimento? (idem), cnpj?, razaoSocial?, responsavel?, endereco}, preferenciaProfissional? (até 120), pacote: {tipoServico, duracaoHoras, horasExtras?, metragem? (obrigatória, exceto passadoria), pecas?, passadoriaCombinada?, semLocalAlmoco?, quantidadeDiarias, frequencia}, primeiraData, turno }` (turno `integral` obrigatório pra 8h; `manha`/`tarde` pras demais)
- **S** `201 { cliente, pedido, atendimentos[], pagamentos: [] }`
- **Erros** `DADOS_INVALIDOS`, `DATA_INVALIDA`, `REGIAO_NAO_ATENDIDA`, `REGIAO_SOB_CONSULTA`, `CONFLITO_IDEMPOTENCIA`
- **Ator** público (conta nova: e-mail ou documento já cadastrado = `DADOS_INVALIDOS`, "entre na sua conta") ou cliente logada (reaproveita o cadastro). No Supabase a conta nasce antes, pela function `conta` (`cadastrar`).
- **Falha parcial** nenhuma: tudo ou nada.
- **Eventos** `pedido_criado`.

### criarCliente — `POST /clientes`
- **E** dados do cliente (como acima). **S** `201 Cliente`. **Erros** `DADOS_INVALIDOS`. **Ator** público. **Falha parcial** nenhuma.

### criarPedido — `POST /pedidos`
- **E** `{ clienteId, pacote (especificação), primeiraData, turno }`. O backend recalcula o preço e gera os atendimentos.
- **S** `201 { pedido, atendimentos[] }`. **Erros** `DADOS_INVALIDOS`, `DATA_INVALIDA`, `REGIAO_NAO_ATENDIDA`, `NAO_ENCONTRADO` (cliente). **Ator** cliente (dono) ou prime. **Falha parcial** nenhuma. **Eventos** `pedido_criado`.

### obterPedido — `GET /pedidos/{id}`
- **S** `{ pedido, cliente, atendimentos[], pagamentos[] }`. **Erros** `NAO_ENCONTRADO`. **Ator** cliente (dono), prime.

### listarPedidos — `GET /pedidos?clienteId=`
- **S** `{ itens: Pedido[] }` (mais recentes primeiro). **Ator** cliente (só os seus), prime (todos).

### obterAtendimento — `GET /atendimentos/{id}`
- **S** `{ atendimento, pedido, diarista?: {id, nome, status}, pagamento? (cobrança da diária ou do pacote; nunca pra diarista), avaliacao? }`. **Erros** `NAO_ENCONTRADO`. **Ator** cliente (dono), diarista (atribuída), prime.

### transicionarAtendimento — `POST /atendimentos/{id}/eventos`
- **E** `{ evento, dados? }` (ex.: `{evento: "reagendar", dados: {data, turno}}`). O ator vem da sessão.
- **S** `200 { atendimento, pedido }`. **Erros** `NAO_ENCONTRADO`, `EVENTO_INVALIDO`, `TRANSICAO_PROIBIDA`, `ATOR_SEM_PERMISSAO`, `CONDICAO_NAO_ATENDIDA`, `DATA_INVALIDA`.
- **Ator** conforme a tabela de transições. **Falha parcial** nenhuma: mudança + histórico + status do pedido + evento na mesma transação. **Eventos** `atendimento_<estado>` / `atendimento_reagendado`.

### atribuirDiarista — `POST /atendimentos/{id}/diarista`
- **E** `{ diaristaId }`. **S** `200 { atendimento }`. **Erros** `NAO_ENCONTRADO`, `CONDICAO_NAO_ATENDIDA` (diarista não aprovada), `TRANSICAO_PROIBIDA` (atendimento fora de agendado/confirmado). **Ator** prime. **Eventos** `atendimento_atribuido` (reatribuição cancela lembretes da diarista anterior).

### confirmarDisponibilidade — `POST /pedidos/{id}/disponibilidade`
- **E** `{ observacao? }`. Pedido `solicitado` → `disponibilidade_confirmada` → `aguardando_pagamento`, criando as cobranças (uma por diária, integral, vencendo até 14h do dia útil anterior; `brcode: null` se o Pix não estiver configurado).
- **S** `200 { pedido, atendimentos[], pagamentos[] }`. **Erros** `NAO_ENCONTRADO`, `TRANSICAO_PROIBIDA`. **Ator** prime. **Eventos** `disponibilidade_confirmada` e um `cobranca_emitida` por cobrança.

### recusarSolicitacao — `POST /pedidos/{id}/recusar`
- **E** `{ motivo }` (3 a 300). Sem disponibilidade: diárias futuras e cobranças abertas canceladas; pedido `recusado`. Pedido com pagamento confirmado não é recusado (cancelar + estorno).
- **S** `200 { pedido, atendimentos[], pagamentos[] }`. **Erros** `DADOS_INVALIDOS`, `NAO_ENCONTRADO`, `TRANSICAO_PROIBIDA`, `CONDICAO_NAO_ATENDIDA`. **Ator** prime. **Eventos** `solicitacao_recusada`.

### registrarEstorno — `POST /pagamentos/{id}/estorno`
- **E** `{ motivo }`. Registro MANUAL (a devolução é feita pela Prime): pagamento `confirmado` → `estornado`; diárias cobertas que ainda não aconteceram são canceladas.
- **S** `200 { pagamento, pedido, atendimentos[] }`. **Erros** `DADOS_INVALIDOS`, `NAO_ENCONTRADO`, `PAGAMENTO_NAO_ELEGIVEL`. **Ator** prime. **Eventos** `estorno_registrado`.

### obterPagamento — `GET /pagamentos/{id}`
- **S** `{ pagamento, pedido, atendimento?, elegibilidade: {pagavel, motivo?} }`. **Erros** `NAO_ENCONTRADO`. **Ator** cliente (dono), prime.

### informarPagamento — `POST /pagamentos/{id}/informar`
- **E** `{}`. **S** `200 Pagamento` com `status: informado_pelo_cliente`. Repetir (mesma chave ou já informado) devolve o mesmo registro sem novo evento.
- **Erros** `NAO_ENCONTRADO`, `PAGAMENTO_NAO_ELEGIVEL`. **Ator** cliente (dono). **Eventos** `pagamento_informado`.

### confirmarPagamento — `POST /pagamentos/{id}/confirmar`
- **E** `{}`. **S** `200 { pagamento, pedido, atendimentos[] }`. Aplica `confirmar` na diária paga (ou em todas, no pacote) e recalcula o pedido.
- **Erros** `NAO_ENCONTRADO`, `PAGAMENTO_NAO_ELEGIVEL`. **Ator** prime. **Eventos** `pagamento_confirmado` (+ `atendimento_confirmado` por atendimento).

### cancelarPedido — `POST /pedidos/{id}/cancelar`
- **E** `{ motivo? }`. Cancela atendimentos em agendado/confirmado/diarista_a_caminho (não mexe em em_andamento nem nos realizados), as cobranças abertas desses atendimentos (recalculando as pendentes que ficam) e as notificações agendadas. Status do pedido é recalculado.
- **S** `200 { pedido, atendimentos[], pagamentos[] }`. **Erros** `NAO_ENCONTRADO`, `TRANSICAO_PROIBIDA` (já cancelado, concluído ou recusado). **Ator** cliente (dono), prime. **Eventos** `pedido_cancelado` (uma mensagem de cancelamento, não uma por atendimento).

### cadastrarDiarista — `POST /diaristas`
- **E** dados da Diarista (sem status) + `identidade: 'rg'|'cnh'` + `documentoIds[]` já enviados. Valida os documentos obrigatórios.
- **S** `201 Diarista` com `status: pendente`. **Erros** `DADOS_INVALIDOS` (inclui documentos faltando), `CONFLITO_IDEMPOTENCIA`. **Ator** público. **Eventos** `diarista_cadastrada`.
- **Fluxo**: o front gera um `id` (UUID v4, não adivinhável) no início do rascunho, usa esse id nos uploads (`salvarDocumento`) e envia o mesmo id em `cadastrarDiarista`. O backend aceita o id só se ainda não existir diarista com ele, e só aceita documentos enviados pra esse id.

### salvarDocumento — `POST /diaristas/{id}/documentos` (multipart)
- **E** campos `tipo`, `arquivo` (jpg/png/pdf, até 5 MB; o backend confere a assinatura do arquivo, não só o mime). Substitui o documento anterior do mesmo tipo.
- **S** `201 Documento` (sem conteúdo). **Erros** `DADOS_INVALIDOS`. **Ator** público enquanto o cadastro não foi enviado; depois, só prime.
- **Falha parcial** documento salvo sem cadastro enviado fica órfão e é removido pelo backend após 7 dias (LGPD).

### obterDiarista — `GET /diaristas/{id}`
- **S** `{ diarista, documentos: Documento[] }` (metadados; o arquivo em si só por URL assinada de curta duração no backend). **Ator** a própria diarista, prime.

### listarDiaristas — `GET /diaristas?status=`
- **S** `{ itens }`. **Ator** prime.

### aprovarDiarista / reprovarDiarista — `POST /diaristas/{id}/aprovar` | `/reprovar`
- **E** `{ motivo? }`. **S** `200 Diarista`. **Erros** `NAO_ENCONTRADO`, `TRANSICAO_PROIBIDA` (só a partir de `pendente`). **Ator** prime. **Eventos** `diarista_aprovada` / `diarista_reprovada`.

### criarAvaliacao — `POST /atendimentos/{id}/avaliacao`
- **E** `{ notas: {pontualidade, qualidade, cuidado, comunicacao} (inteiros 1..5), comentario? (até 500) }`. `notaFinal` é calculada pelo backend (média, 1 casa).
- **S** `201 { avaliacao, atendimento }` e o atendimento vai a `avaliado`. **Erros** `NAO_ENCONTRADO`, `TRANSICAO_PROIBIDA` (não finalizado), `JA_AVALIADO`, `DADOS_INVALIDOS`. **Ator** cliente (dono). **Eventos** `atendimento_avaliado`.

### obterAvaliacaoDoAtendimento — `GET /atendimentos/{id}/avaliacao`
- **S** `Avaliacao` ou `404 NAO_ENCONTRADO`. **Ator** cliente (dono), prime.

### listarAtendimentos — `GET /atendimentos?de=&ate=&status=`
- **S** `{ itens: [{atendimento, pedido:{id,status,pacote}, cliente:{id,nome,telefone,endereco}, diarista?}] }` por data. **Ator** prime. Usado na agenda do painel.

### listarAtendimentosDaDiarista — `GET /diaristas/{id}/atendimentos`
- **S** `{ diarista:{id,nome,status,decisao?}, itens:[{atendimento, pacote, cliente:{nome (primeiro), bairro, cidade, endereco? , telefone?}}] }`. Endereço completo e telefone da cliente só a partir da véspera da diária (regra de privacidade). **Ator** a própria diarista, prime. **Erros** `NAO_ENCONTRADO`.

### listarAvaliacoes — `GET /avaliacoes?diaristaId=`
- **S** `{ itens:[{avaliacao, atendimento:{id,data}, diarista:{id,nome}}] }` mais recentes primeiro. **Ator** prime.

### enfileirarNotificacao — interno (sem rota pública)
- Chamado só pelo motor de automações a partir de eventos. **E** `{ gatilho, template, destinatario, variaveis, agendadaPara?, refs }`. **S** Notificacao. Idempotente pela `chaveIdempotencia`. **Ator** sistema.

### listarNotificacoes — `GET /notificacoes?pedidoId=&diaristaId=&status=`
- **S** `{ itens: Notificacao[] }` ordenado por `agendadaPara ?? criadoEm`. **Ator** prime.

## Comportamento do front em falha

- Timeout/rede: mostra "Não conseguimos falar com o servidor. Tente de novo." e **mantém a chave de idempotência** da tentativa.
- `CONFLITO_IDEMPOTENCIA`: a UI descarta a chave e pede pra revisar os dados.
- `4xx` de negócio: mensagem do campo ou do erro, sem perder o que foi digitado.

### Fila de notificações (painel da Prime, B5): só no adapter `supabase`
- `listarNotificacoes({ pedidoId?, diaristaId?, status? })`: cada notificação com `status` (`pendente` | `simulada` | `enviada` | `erro` | `cancelada`), `provedor`, `previa`, `agendadaPara`, `tentativas`, `erro` `{ codigo, mensagem, em, tentativa }` e `motivo` (cancelada por quê).
- `listarEventos({ status? })`: fila de eventos com `tentativas`, `erro`, `tentarApos`.
- `saudeNotificacoes()`: `{ eventosPendentes, eventosAtrasados, eventosComErro, notificacoesAtrasadas, notificacoesComErro, ultimaExecucao }`.
- `reenviarNotificacao(id)` / `reprocessarEvento(id)`: só Prime, só o que está em `erro` (senão `TRANSICAO_PROIBIDA`); idempotentes pela chave.

### Documentos (B6): adapter `supabase`
- `salvarDocumento` vai pela Edge Function `documentos` (multipart: `diaristaId`, `tipo`, `nomeArquivo`, `chave`, `arquivo`). Erros: `DADOS_INVALIDOS` (formato, tamanho, bytes que não conferem, cadastro já enviado), `NAO_ENCONTRADO` (cadastro de outra pessoa), 429 com `DADOS_INVALIDOS` (muitos envios), `SESSAO_EXPIRADA`.
- `obterArquivo` só pra Prime (`{ acao: 'abrir', documentoId }`): devolve URL assinada curta; o acesso fica em `acessos_documentos`.
- `reprovarDiarista` exige `motivo` (senão `DADOS_INVALIDOS`).
