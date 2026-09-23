# WhatsApp da Prime

Situação: a Prime **não tem** API oficial hoje. Vai contratar um provedor oficial (provavelmente Gestor Corp) quando a integração estiver pronta pra plugar. Nesta fase:

- **Mock:** as mensagens são geradas e gravadas como `simulada`, com a prévia visível em `/_dev/servicos.html?dev=1`. Nada é enviado.
- **Botões "Falar com a Prime no WhatsApp":** abrem `wa.me` com a mensagem pronta. É contato **manual**, registrado como `contato_manual` no histórico, não é notificação.
- **Backend (fase 2):** único que fala com o provedor. O front nunca monta payload de provedor. `src/automacoes/payloadMeta.js` é a **referência** do corpo da Cloud API pro backend (testada em `scripts/testa-whatsapp.mjs`).

Valores de preço abaixo são referência de mercado em set/2026 e **precisam ser conferidos** na tabela oficial da Meta e na proposta do provedor antes de fechar.

---

## 1. Checklist pra Prime contratar

**Pré-requisitos (a Prime faz)**
- [ ] **Meta Business verificada** (business.facebook.com > Central de segurança > Verificação da empresa), com CNPJ, razão social, endereço e site iguais aos do cartão CNPJ. Leva de 2 a 10 dias úteis.
- [ ] **Número dedicado**, que não esteja no WhatsApp comum nem no WhatsApp Business app (ou que seja migrado, o que apaga o histórico do app). Pode ser fixo ou celular, precisa receber SMS ou ligação pra ativação. Sugestão: um número novo só pra automação, mantendo os dois números atuais de atendimento humano.
- [ ] **WABA** (WhatsApp Business Account) criada dentro da Meta Business verificada. O provedor pode criar pelo Embedded Signup; nesse caso, confirmar que a **WABA fica em nome da Prime** (portabilidade se trocar de provedor).
- [ ] **Nome de exibição** aprovado pela Meta (ex.: "Prime Limpeza Especializada"). Precisa bater com a marca do site.
- [ ] **Forma de pagamento** na Meta (cartão) ou via provedor (fatura), conforme o contrato.

**O que pedir ao provedor (Gestor Corp ou outro BSP)**
- [ ] Acesso à **WhatsApp Cloud API oficial** (não API "não oficial"/QR code, que pode ser banida).
- [ ] **Token permanente** (System User token) com permissões `whatsapp_business_messaging` e `whatsapp_business_management`, ou credencial equivalente da API do provedor.
- [ ] **`phone_number_id`** e **`waba_id`** do número.
- [ ] **URL de webhook** configurável apontando pro nosso backend (ver parte 3) e o **verify token**; ou, se o provedor intermedia, o formato do webhook dele e como ele assina.
- [ ] Submissão e acompanhamento da **aprovação dos templates** da parte 2 (categoria UTILITY, pt_BR).
- [ ] Ambiente de **teste/sandbox** e número de teste.
- [ ] **Limites** de envio (tier inicial de 250 conversas/24h até a verificação; depois 1k, 10k...) e como sobe.
- [ ] **SLA**, suporte em português e **portabilidade** da WABA/número se o contrato acabar.

**Modelo de cobrança**
- A Meta cobra **por mensagem de template entregue**, conforme a **categoria** (marketing, utility, authentication) e o país do destinatário. Referência Brasil: utility ≈ US$ 0,007 a 0,008; marketing ≈ US$ 0,06; authentication ≈ US$ 0,03 por mensagem. **Conferir a tabela oficial vigente.**
- **Utility dentro da janela de atendimento de 24h** (quando a cliente mandou mensagem nas últimas 24h) não é cobrada pela Meta. Mensagem livre (não template) só é permitida dentro dessa janela.
- **Taxa do provedor** vem por cima: mensalidade fixa, taxa por mensagem ou pacote. Pedir tudo por escrito: mensalidade, custo por mensagem utility, setup, número adicional.
- Estimativa de volume por diária: cliente 6 a 8 mensagens (pedido, entrada, lembrete, a caminho, início, fim, cobrança, obrigado) e diarista 2 a 3. Com 200 diárias/mês ≈ 2.000 mensagens utility/mês.

---

## 2. Templates (formato de aprovação da Meta)

Regras seguidas em todos: nome em `snake_case`, categoria **UTILITY**, idioma **pt_BR**, variáveis `{{1}}`, `{{2}}`... em sequência, nenhuma variável no início nem no fim do corpo, sem asterisco/formatação, com exemplo pra cada variável. O texto do corpo é **idêntico** ao de `src/automacoes/mensagens.js` (verificado por `scripts/verifica-templates.mjs`).

<!-- TEMPLATES:INICIO (gerado por: node scripts/verifica-templates.mjs --gerar; não editar à mão) -->

### Mapa gatilho → template → variáveis

| template | destinatário | disparado por | variáveis |
|---|---|---|---|
| `pedido_recebido` | cliente | `pedido_criado` (na hora) | {{1}} nome, {{2}} resumo, {{3}} valorEntrada, {{4}} link |
| `entrada_confirmada` | cliente | `pagamento_confirmado` (na hora) | {{1}} nome, {{2}} primeiraData |
| `lembrete_vespera` | cliente | `atendimento_confirmado` (18h da véspera (America/Sao_Paulo))<br>`atendimento_reagendado` (18h da véspera (America/Sao_Paulo)) | {{1}} nome, {{2}} quando, {{3}} periodo |
| `diarista_a_caminho` | cliente | `atendimento_diarista_a_caminho` (na hora) | {{1}} nome, {{2}} diarista |
| `atendimento_iniciado` | cliente | `atendimento_em_andamento` (na hora) | {{1}} nome, {{2}} diarista |
| `atendimento_finalizado` | cliente | `atendimento_finalizado` (na hora) | {{1}} nome, {{2}} link |
| `cobranca_dia` | cliente | `atendimento_finalizado` (2h depois de finalizada) | {{1}} nome, {{2}} data, {{3}} valor, {{4}} link |
| `obrigado_avaliacao` | cliente | `atendimento_avaliado` (na hora) | {{1}} nome |
| `cancelamento` | cliente | `atendimento_cancelado` (na hora)<br>`pedido_cancelado` (na hora) | {{1}} nome, {{2}} oque |
| `cadastro_recebido` | diarista | `diarista_cadastrada` (na hora) | {{1}} nome, {{2}} prazo |
| `cadastro_aprovado` | diarista | `diarista_aprovada` (na hora) | {{1}} nome |
| `cadastro_reprovado` | diarista | `diarista_reprovada` (na hora) | {{1}} nome |
| `atendimento_atribuido` | diarista | `atendimento_atribuido` (na hora) | {{1}} nome, {{2}} data, {{3}} periodo, {{4}} bairro |
| `lembrete_vespera_diarista` | diarista | `atendimento_atribuido` (18h da véspera (America/Sao_Paulo))<br>`atendimento_reagendado` (18h da véspera (America/Sao_Paulo)) | {{1}} nome, {{2}} quando, {{3}} periodo, {{4}} endereco |
| `atendimento_cancelado_diarista` | diarista | `atendimento_atribuido` (na hora)<br>`atendimento_cancelado` (na hora)<br>`pedido_cancelado` (na hora) | {{1}} nome, {{2}} data, {{3}} periodo |

### pedido_recebido

- Categoria: UTILITY · Idioma: pt_BR · Destinatário: cliente
- Variáveis: {{1}} = nome (ex.: "Ana"); {{2}} = resumo (ex.: "4 diárias semanais a partir de 05/10/2026"); {{3}} = valorEntrada (ex.: "R$ 350,00"); {{4}} = link (ex.: "https://prime.exemplo/acompanhamento/?pedido=abc")

```text
Oi, {{1}}! Recebemos seu pedido na Prime: {{2}}. Pra garantir a data, falta o Pix da entrada de {{3}}. Você paga e acompanha por aqui: {{4}}
Qualquer dúvida, é só responder.
```

### entrada_confirmada

- Categoria: UTILITY · Idioma: pt_BR · Destinatário: cliente
- Variáveis: {{1}} = nome (ex.: "Ana"); {{2}} = primeiraData (ex.: "segunda, 05/10/2026 (manhã, das 8h às 12h)")

```text
Oi, {{1}}! Confirmamos o pagamento da entrada. Sua primeira diária está marcada pra {{2}}. Na véspera a gente te lembra por aqui.
```

### lembrete_vespera

- Categoria: UTILITY · Idioma: pt_BR · Destinatário: cliente
- Variáveis: {{1}} = nome (ex.: "Ana"); {{2}} = quando (ex.: "amanhã, 05/10/2026,"); {{3}} = periodo (ex.: "manhã, das 8h às 12h")

```text
Oi, {{1}}! Passando pra lembrar: {{2}} tem diária da Prime no período da {{3}}. Se precisar mudar algo, responda esta mensagem.
```

### diarista_a_caminho

- Categoria: UTILITY · Idioma: pt_BR · Destinatário: cliente
- Variáveis: {{1}} = nome (ex.: "Ana"); {{2}} = diarista (ex.: "Maria")

```text
Oi, {{1}}! A {{2}} já está a caminho do seu endereço. Até daqui a pouco!
```

### atendimento_iniciado

- Categoria: UTILITY · Idioma: pt_BR · Destinatário: cliente
- Variáveis: {{1}} = nome (ex.: "Ana"); {{2}} = diarista (ex.: "Maria")

```text
Oi, {{1}}! A {{2}} chegou e começou a diária de hoje. A gente avisa quando terminar.
```

### atendimento_finalizado

- Categoria: UTILITY · Idioma: pt_BR · Destinatário: cliente
- Variáveis: {{1}} = nome (ex.: "Ana"); {{2}} = link (ex.: "https://prime.exemplo/avaliacao/?atendimento=abc")

```text
Oi, {{1}}! A diária de hoje terminou. Conta pra gente como foi? Leva menos de um minuto: {{2}}
Obrigada!
```

### cobranca_dia

- Categoria: UTILITY · Idioma: pt_BR · Destinatário: cliente
- Variáveis: {{1}} = nome (ex.: "Ana"); {{2}} = data (ex.: "05/10/2026"); {{3}} = valor (ex.: "R$ 175,00"); {{4}} = link (ex.: "https://prime.exemplo/pagamento/?pagamento=abc")

```text
Oi, {{1}}! A parcela da diária de {{2}} ficou em {{3}}. Você paga pelo Pix neste link: {{4}}
Obrigada pela confiança!
```

### obrigado_avaliacao

- Categoria: UTILITY · Idioma: pt_BR · Destinatário: cliente
- Variáveis: {{1}} = nome (ex.: "Ana")

```text
Obrigada pela avaliação, {{1}}! Sua opinião ajuda a manter o padrão da Prime em cada diária.
```

### cancelamento

- Categoria: UTILITY · Idioma: pt_BR · Destinatário: cliente
- Variáveis: {{1}} = nome (ex.: "Ana"); {{2}} = oque (ex.: "todas as diárias pendentes do seu pedido")

```text
Oi, {{1}}. Confirmamos o cancelamento de {{2}}. Se foi engano ou quiser remarcar, é só responder esta mensagem.
```

### cadastro_recebido

- Categoria: UTILITY · Idioma: pt_BR · Destinatário: diarista
- Variáveis: {{1}} = nome (ex.: "Maria"); {{2}} = prazo (ex.: "5")

```text
Oi, {{1}}! Recebemos seu cadastro na Prime. Vamos analisar seus documentos e responder por aqui em até {{2}} dias úteis.
```

### cadastro_aprovado

- Categoria: UTILITY · Idioma: pt_BR · Destinatário: diarista
- Variáveis: {{1}} = nome (ex.: "Maria")

```text
Parabéns, {{1}}! Seu cadastro na Prime foi aprovado. As próximas diárias chegam por aqui.
```

### cadastro_reprovado

- Categoria: UTILITY · Idioma: pt_BR · Destinatário: diarista
- Variáveis: {{1}} = nome (ex.: "Maria")

```text
Oi, {{1}}. Analisamos seu cadastro e, por enquanto, não conseguimos seguir. Se quiser entender o motivo, responda esta mensagem.
```

### atendimento_atribuido

- Categoria: UTILITY · Idioma: pt_BR · Destinatário: diarista
- Variáveis: {{1}} = nome (ex.: "Maria"); {{2}} = data (ex.: "05/10/2026"); {{3}} = periodo (ex.: "manhã, das 8h às 12h"); {{4}} = bairro (ex.: "Savassi")

```text
Oi, {{1}}! Você tem uma nova diária: {{2}}, período da {{3}}, no bairro {{4}}. O endereço completo chega por aqui antes da diária.
```

### lembrete_vespera_diarista

- Categoria: UTILITY · Idioma: pt_BR · Destinatário: diarista
- Variáveis: {{1}} = nome (ex.: "Maria"); {{2}} = quando (ex.: "amanhã, 05/10/2026,"); {{3}} = periodo (ex.: "manhã, das 8h às 12h"); {{4}} = endereco (ex.: "Rua Exemplo, 100, Savassi, Belo Horizonte")

```text
Oi, {{1}}! Lembrete: {{2}} você tem diária no período da {{3}}. Endereço: {{4}}. Bom trabalho!
```

### atendimento_cancelado_diarista

- Categoria: UTILITY · Idioma: pt_BR · Destinatário: diarista
- Variáveis: {{1}} = nome (ex.: "Maria"); {{2}} = data (ex.: "05/10/2026"); {{3}} = periodo (ex.: "manhã, das 8h às 12h")

```text
Oi, {{1}}. A diária de {{2}}, período da {{3}}, foi cancelada e saiu da sua agenda. Qualquer dúvida, responda esta mensagem.
```

<!-- TEMPLATES:FIM -->

---

## 3. Webhook e agendador (backend)

**Verificação (GET)**
```
GET /webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=<TOKEN>&hub.challenge=<N>
```
Se `hub.mode === "subscribe"` e `hub.verify_token` igual ao segredo configurado (variável de ambiente, nunca no código), responder `200` com o corpo **exatamente** igual a `hub.challenge` (texto puro). Senão `403`.

**Assinatura (todo POST)**
- Header `X-Hub-Signature-256: sha256=<hex>` = HMAC-SHA256 do **corpo cru** (bytes, antes de parsear o JSON) com o **App Secret**.
- Comparar em tempo constante (`crypto.timingSafeEqual`). Assinatura inválida: `401` e descartar.
- Responder `200` rápido (menos de 5 s) e processar de forma assíncrona; a Meta reenvia em caso de erro, então o processamento é **idempotente** pelo `id` da mensagem/status.

**POST de status** (`entry[].changes[].value.statuses[]`)
- Campos: `id` (wamid da mensagem enviada), `status` (`sent`, `delivered`, `read`, `failed`), `timestamp`, `recipient_id`, `errors[]`, `pricing.category`.
- Ação: localizar a `Notificacao` pelo `wamid` salvo no envio e atualizar: `sent/delivered/read` → `enviada` (guardando cada instante); `failed` → `erro` com `errors[0].code/title`. Status fora de ordem não regride (`read` não volta pra `delivered`).

**POST de mensagens recebidas** (`entry[].changes[].value.messages[]`)
- Campos: `from` (telefone), `id`, `timestamp`, `type` (`text`, `button`, `interactive`, `image`...).
- Roteamento: toda mensagem recebida vai pra **fila de atendimento da Prime** (painel) e, se configurado, é encaminhada ao WhatsApp humano da Prime. Associa ao cliente/diarista pelo telefone.
- **Janela de 24h:** cada mensagem recebida abre (ou renova) a janela de atendimento daquele contato; guardar `janelaAteEm = timestamp + 24h`. Resposta livre da Prime só dentro da janela; fora dela, só template.
- Opt-out: palavras como "SAIR"/"PARAR" marcam o contato como não receber mensagens não essenciais (backend registra; mensagens transacionais do pedido continuam, conforme política da Meta).

**Agendador dos lembretes**
- Job a cada 1 minuto (cron do provedor de hospedagem ou fila com agendamento): busca `Notificacao` com `status = pendente` e `agendadaPara <= agora`, em lotes, com lock por linha (`SELECT ... FOR UPDATE SKIP LOCKED`).
- Antes de enviar, **revalida** (mesma regra de `aindaValida` em `src/automacoes/gatilhos.js`): atendimento ainda no estado esperado, mesma data/turno/diarista e o envio ainda cai no dia pra que o texto foi escrito. Obsoleta vira `cancelada`.
- Envia com `payloadMeta.js` (ou o formato do provedor), grava o `wamid` e marca `enviada` só quando a API aceitar; erro de rede ou 5xx: retentativa com backoff (1, 5, 15 min, até 3x) e depois `erro`.
- Horários sempre calculados em `America/Sao_Paulo` e gravados em UTC.

---

## 4. Comparativo: Meta direto x BSP

| | Meta Cloud API direto | BSP (Gestor Corp, Twilio etc.) |
|---|---|---|
| Custo | só a tarifa da Meta por mensagem | tarifa da Meta + taxa do provedor (mensalidade e/ou por mensagem) |
| Setup | a Prime/nós fazemos tudo no Business Manager | provedor conduz (Embedded Signup), mais rápido pra quem não é técnico |
| Aprovação de templates | pelo WhatsApp Manager | provedor submete e acompanha |
| Suporte | documentação e suporte da Meta (limitado) | suporte humano do provedor, em português (no caso de BSP nacional) |
| Painel de atendimento humano | não tem (só API) | normalmente inclui inbox multiatendente |
| Dependência | nenhuma | contrato; exigir portabilidade da WABA e do número |
| Integração com nosso backend | direta, formato de `payloadMeta.js` | pela API do provedor (adapter no backend) ou repasse da Cloud API |

- **Twilio:** API madura e bem documentada, cobra taxa por mensagem em dólar em cima da Meta, suporte em inglês; bom pra quem é só API.
- **Gestor Corp (ou BSP nacional):** faturamento em real, suporte em português e inbox pro time da Prime atender. Confirmar se expõe a Cloud API "crua" ou uma API própria, e se repassa webhook com assinatura.

**Recomendação:** contratar o **BSP nacional (Gestor Corp)** pelo suporte em português, pela condução da verificação/aprovação e pelo inbox que o time da Prime vai usar no dia a dia, **com três condições no contrato**: (1) WABA e número em nome da Prime, com portabilidade; (2) acesso à Cloud API oficial ou API equivalente com webhook assinado; (3) preço por mensagem utility por escrito. No backend, o envio fica atrás de uma interface `ProvedorWhatsApp` (ver BACKEND.md): se um dia valer migrar pra Meta direto, troca-se o adapter sem mexer em gatilhos nem templates.
