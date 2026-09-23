# API da Prime (contrato dos casos de uso)

Este documento é o contrato entre o front e o backend. Os dois adapters (`mock` e `http`) implementam exatamente estes casos de uso, e `scripts/fake-api.mjs` implementa as rotas HTTP. Tudo que está aqui vale pro backend da fase 2.

## Regras fixas

1. **O backend recalcula e revalida tudo.** Preço, entrada, restante e parcelas são recalculados a partir da *especificação* do pacote. Transições, permissões e condições são revalidadas. O que o navegador manda é só o comando de negócio.
2. **O front não monta payload de provedor**, não escolhe destinatário e não escolhe template. Eventos e notificações são gerados pelo backend (no mock, por `src/app` + `src/automacoes/motor.js`). Um mesmo evento nunca gera mensagem nos dois lados.
3. **Contexto de autorização e de pagamento vem dos registros do backend**, nunca do corpo da requisição. `?dev=1` e `?id=` na URL não são autorização.
4. **Dinheiro em centavos inteiros.** Datas de calendário em `AAAA-MM-DD`; instantes em ISO 8601 UTC. Fuso de negócio: `America/Sao_Paulo`.
5. **Idempotência** em toda operação que cria ou muda estado (ver abaixo).

## Formato HTTP

- Base: `API_BASE_URL` (`src/config/app.js`). JSON UTF-8. Upload de documento em `multipart/form-data`.
- Cabeçalho `Idempotency-Key: <chave>` em toda escrita (o corpo não repete a chave).
- Sucesso: `200` (leitura, repetição idempotente) ou `201` (criação). Corpo = saída do caso de uso.
- Erro: status HTTP + `{"erro": {"codigo": "...", "mensagem": "...", "detalhes": ...}}`.
- Autenticação (fase 2, Supabase Auth): cliente por telefone + código (OTP por SMS/WhatsApp), diarista por e-mail + senha, Prime por e-mail + senha com papel em tabela própria. O backend deriva o **ator** e o **atorId** da sessão. **A guarda de rota no front (`src/services/auth.js`, `exigirPapel`) é só conveniência de navegação: a autorização real é do backend (RLS por papel e por dono do registro).** No modo mock a "sessão" é um registro em localStorage, sem segurança nenhuma. O `fake-api` aceita `X-Ator-Teste: cliente:<id> | diarista:<id> | prime | sistema` **só para teste**; o backend real ignora esse cabeçalho.

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
| `CONDICAO_NAO_ATENDIDA` | 409 | ex.: confirmar sem entrada confirmada; a caminho com diarista não aprovada |
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
| `confirmar` | agendado | confirmado | prime, sistema | entrada do pedido **confirmada** |
| `sair_a_caminho` | confirmado | diarista_a_caminho | diarista (a atribuída), prime | diarista atribuída, com status `aprovada` |
| `iniciar` | diarista_a_caminho | em_andamento | diarista (a atribuída), prime | |
| `finalizar` | em_andamento | finalizado | diarista (a atribuída), prime | |
| `avaliar` | finalizado | avaliado | cliente (dono), sistema | feito por `criarAvaliacao` |
| `cancelar` | agendado, confirmado, diarista_a_caminho | cancelado | cliente (dono), prime, sistema | cancela notificações agendadas e a parcela do dia |
| `reagendar` | agendado, confirmado | (mesmo) | cliente (dono), prime | `dados.data` e `dados.turno`; data revalidada no calendário; lembretes recalculados |

Quando a entrada é confirmada, o **sistema** aplica `confirmar` em todos os atendimentos `agendado` do pedido e o pedido vai de `aguardando_entrada` para `ativo` (se não estiver cancelado/concluído: estados terminais não voltam).

Status do pedido: `aguardando_entrada → ativo` (entrada confirmada); `concluido` quando nenhum atendimento está em agendado/confirmado/diarista_a_caminho/em_andamento e pelo menos um chegou a finalizado/avaliado; `cancelado` quando todos os atendimentos foram cancelados.

## Elegibilidade de pagamento

- **Entrada**: pagável enquanto `pendente` ou `informado_pelo_cliente` e o pedido não está cancelado.
- **Parcela do dia**: pagável quando o atendimento está em `diarista_a_caminho`, `em_andamento`, `finalizado` ou `avaliado` (lista explícita) e a parcela não está `confirmado` nem `cancelado`.
- Cancelar o pedido cancela só as parcelas de atendimentos cancelados. Parcelas de atendimentos realizados continuam pagáveis.
- "Já paguei" (`informarPagamento`) só leva a `informado_pelo_cliente`. Só a Prime confirma (`confirmarPagamento`).

---

## Casos de uso

Notação: **E** entrada, **S** saída, **Erros**, **Ator**, **Falha parcial**. Toda escrita recebe `chaveIdempotencia` (HTTP: cabeçalho) e pode devolver `CONFLITO_IDEMPOTENCIA`, `SERVICO_INDISPONIVEL`, `ERRO_INTERNO`.

### confirmarAutoagendamento — `POST /autoagendamentos`
Caso de uso composto do autoagendamento: cria cliente + pedido + atendimentos + pagamento da entrada + parcelas do dia, numa transação.
- **E** `{ cliente: {tipo, nome, telefone, email, cpf?, cnpj?, razaoSocial?, responsavel?, endereco}, pacote: {tipoServico, duracaoHoras, horasExtras?, metragem? (obrigatória, exceto passadoria), pecas?, passadoriaCombinada?, semLocalAlmoco?, quantidadeDiarias, frequencia}, primeiraData, turno }` (turno `integral` obrigatório pra 8h; `manha`/`tarde` pras demais)
- **S** `201 { cliente, pedido, atendimentos[], pagamentos[] , pagamentoEntradaId }`
- **Erros** `DADOS_INVALIDOS`, `DATA_INVALIDA`, `REGIAO_NAO_ATENDIDA`, `REGIAO_SOB_CONSULTA`, `CONFLITO_IDEMPOTENCIA`
- **Ator** público (vira o cliente dono do pedido)
- **Falha parcial** nenhuma: tudo ou nada. Se o Pix não estiver configurado, cria os pagamentos com `brcode: null` (a tela avisa e não mostra cobrança).
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
- **S** `{ atendimento, pedido, diarista?: {id, nome, status}, pagamentoDia?, avaliacao? }`. **Erros** `NAO_ENCONTRADO`. **Ator** cliente (dono), diarista (atribuída), prime.

### transicionarAtendimento — `POST /atendimentos/{id}/eventos`
- **E** `{ evento, dados? }` (ex.: `{evento: "reagendar", dados: {data, turno}}`). O ator vem da sessão.
- **S** `200 { atendimento, pedido }`. **Erros** `NAO_ENCONTRADO`, `EVENTO_INVALIDO`, `TRANSICAO_PROIBIDA`, `ATOR_SEM_PERMISSAO`, `CONDICAO_NAO_ATENDIDA`, `DATA_INVALIDA`.
- **Ator** conforme a tabela de transições. **Falha parcial** nenhuma: mudança + histórico + status do pedido + evento na mesma transação. **Eventos** `atendimento_<estado>` / `atendimento_reagendado`.

### atribuirDiarista — `POST /atendimentos/{id}/diarista`
- **E** `{ diaristaId }`. **S** `200 { atendimento }`. **Erros** `NAO_ENCONTRADO`, `CONDICAO_NAO_ATENDIDA` (diarista não aprovada), `TRANSICAO_PROIBIDA` (atendimento fora de agendado/confirmado). **Ator** prime. **Eventos** `atendimento_atribuido` (reatribuição cancela lembretes da diarista anterior).

### criarPagamento — `POST /pagamentos`
- **E** `{ pedidoId, parcela: 'entrada'|'dia', atendimentoId? }`. Valor calculado pelo backend a partir do pedido. Se já existe pagamento não cancelado pra essa parcela, devolve o existente.
- **S** `201 Pagamento` (com `pixTxid` e `brcode`). **Erros** `NAO_ENCONTRADO`, `CONFIG_INCOMPLETA`, `PAGAMENTO_NAO_ELEGIVEL`. **Ator** cliente (dono), prime.

### obterPagamento — `GET /pagamentos/{id}`
- **S** `{ pagamento, pedido, atendimento?, elegibilidade: {pagavel, motivo?} }`. **Erros** `NAO_ENCONTRADO`. **Ator** cliente (dono), prime.

### informarPagamento — `POST /pagamentos/{id}/informar`
- **E** `{}`. **S** `200 Pagamento` com `status: informado_pelo_cliente`. Repetir (mesma chave ou já informado) devolve o mesmo registro sem novo evento.
- **Erros** `NAO_ENCONTRADO`, `PAGAMENTO_NAO_ELEGIVEL`. **Ator** cliente (dono). **Eventos** `pagamento_informado`.

### confirmarPagamento — `POST /pagamentos/{id}/confirmar`
- **E** `{}`. **S** `200 { pagamento, pedido, atendimentos[] }`. Se for a entrada: aplica `confirmar` nos atendimentos agendados e recalcula o pedido.
- **Erros** `NAO_ENCONTRADO`, `PAGAMENTO_NAO_ELEGIVEL`. **Ator** prime. **Eventos** `pagamento_confirmado` (+ `atendimento_confirmado` por atendimento).

### cancelarPedido — `POST /pedidos/{id}/cancelar`
- **E** `{ motivo? }`. Cancela atendimentos em agendado/confirmado/diarista_a_caminho (não mexe em em_andamento nem nos realizados), as parcelas desses atendimentos, a entrada se nenhum atendimento foi realizado e ainda não foi confirmada, e as notificações agendadas. Status do pedido é recalculado (pode ficar `cancelado` ou `concluido`/`ativo` se ainda houver realizado/em andamento).
- **S** `200 { pedido, atendimentos[], pagamentos[] }`. **Erros** `NAO_ENCONTRADO`, `TRANSICAO_PROIBIDA` (já cancelado/concluído). **Ator** cliente (dono), prime. **Eventos** `pedido_cancelado` (uma mensagem de cancelamento, não uma por atendimento).

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
