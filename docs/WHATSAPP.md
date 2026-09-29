# WhatsApp da Prime

Situação: a Prime **não tem** API oficial hoje. Vai contratar um provedor oficial (provavelmente Gestor Corp) quando a integração estiver pronta pra plugar. Nesta fase:

- **Mock:** as mensagens são geradas e gravadas como `simulada`, com a prévia visível em `/_dev/servicos.html?dev=1`. Nada é enviado.
- **Botões "Falar com a Prime no WhatsApp":** abrem `wa.me` com a mensagem pronta. É contato **manual**, registrado como `contato_manual` no histórico, não é notificação.
- **Backend (fase 2, AUT):** único que fala com o provedor. O front nunca monta payload de provedor. O worker (Edge Function `notificacoes`) envia com `src/automacoes/payloadMeta.js`; fora de produção é sempre `simulado`. O webhook (`whatsapp-webhook`) está pronto e desligado até os segredos serem configurados.

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
- Estimativa de volume por diária (catálogo da fase 2): cliente 8 a 11 mensagens (solicitação recebida, disponibilidade confirmada, lembretes do prazo 24h e 3h antes, pagamento confirmado, profissional designada, véspera, a caminho, início, fim com a pesquisa e, se não responder, um lembrete) e profissional 2 a 3. O limite diário corta excesso de lembretes (3 por cliente por dia). Com 200 diárias/mês ≈ 2.200 mensagens utility/mês.

---

## 2. Templates (formato de aprovação da Meta)

Regras seguidas em todos: nome em `snake_case`, idioma **pt_BR**, categoria **UTILITY** pra atendimento e lembrete e **MARKETING** pra M01 a M03 (com "responda SAIR"), variáveis `{{1}}`, `{{2}}`... na ordem em que aparecem, nenhuma variável no início nem no fim do corpo nem duas seguidas, sem asterisco/formatação, com exemplo pra cada variável. O texto é **idêntico** ao do catálogo (`src/automacoes/catalogo.js`, onde as variáveis têm nome, como `{{nome}}`), verificado por `scripts/verifica-templates.mjs`. Quando a Prime edita um texto no painel, nasce uma versão nova (`<nome>_v2`, `_v3`...) que precisa de aprovação própria na Meta antes de valer em produção. Os avisos internos da equipe (I01 a I09) saem só no painel e não entram aqui.

<!-- TEMPLATES:INICIO (gerado por: node scripts/verifica-templates.mjs --gerar; não editar à mão) -->

### Mapa regra → template → variáveis

| regra | template | categoria | destinatário | quando | variáveis |
|---|---|---|---|---|---|
| C01 | `solicitacao_recebida` | UTILITY | cliente | `pedido_criado` (na hora) | {{1}} nome, {{2}} resumo, {{3}} link |
| C02 | `disponibilidade_confirmada` | UTILITY | cliente | `disponibilidade_confirmada` (na hora) | {{1}} nome, {{2}} resumo, {{3}} total, {{4}} valor, {{5}} prazo, {{6}} link |
| C03 | `solicitacao_recusada` | UTILITY | cliente | `solicitacao_recusada` (na hora) | {{1}} nome, {{2}} resumo, {{3}} motivo |
| C04 | `lembrete_prazo_pagamento` | UTILITY | cliente | 24h e 3h antes do prazo | {{1}} nome, {{2}} valor, {{3}} data, {{4}} prazo, {{5}} link |
| C05 | `pagamento_confirmado` | UTILITY | cliente | `pagamento_confirmado` (na hora) | {{1}} nome, {{2}} oque, {{3}} link |
| C06 | `lembrete_vespera` | UTILITY | cliente | véspera, 18:00 | {{1}} nome, {{2}} quando, {{3}} horario, {{4}} carga |
| C07 | `profissional_designada` | UTILITY | cliente | `atendimento_atribuido` (na hora) | {{1}} nome, {{2}} data, {{3}} profissional |
| C08 | `profissional_a_caminho` | UTILITY | cliente | `atendimento_diarista_a_caminho` (na hora) | {{1}} nome, {{2}} profissional |
| C09 | `atendimento_iniciado` | UTILITY | cliente | `atendimento_em_andamento` (na hora) | {{1}} nome, {{2}} profissional |
| C10 | `atendimento_finalizado` | UTILITY | cliente | `atendimento_finalizado` (na hora) | {{1}} nome, {{2}} link |
| C11 | `lembrete_pesquisa` | UTILITY | cliente | `atendimento_finalizado` + 24h | {{1}} nome, {{2}} data, {{3}} link |
| C12 | `remarcacao_confirmada` | UTILITY | cliente | `atendimento_reagendado` (na hora) | {{1}} nome, {{2}} quando, {{3}} horario |
| C13 | `estorno_registrado` | UTILITY | cliente | `estorno_registrado` (na hora) | {{1}} nome, {{2}} valor, {{3}} oque |
| C14 | `hora_extra_registrada` | UTILITY | cliente | `hora_extra_aprovada` (na hora) | {{1}} nome, {{2}} horas, {{3}} data, {{4}} valor, {{5}} link |
| C15 | `ocorrencia_atualizada` | UTILITY | cliente | `ocorrencia_atualizada` (na hora) | {{1}} nome, {{2}} data, {{3}} estado, {{4}} link |
| C16 | `optout_confirmado` | UTILITY | cliente | `marketing_revogado` (na hora) | {{1}} nome |
| M01 | `renovacao_pacote` | MARKETING | cliente | dia 25, 09:00 (nasce desligada) | {{1}} nome, {{2}} mes, {{3}} link |
| M02 | `reativacao` | MARKETING | cliente | sem diária há 60 dias (no máximo a cada 90), 09:00 (nasce desligada) | {{1}} nome, {{2}} link |
| M03 | `aniversario_cliente` | MARKETING | cliente | aniversário, 09:00 (nasce desligada) | {{1}} nome |
| D01 | `cadastro_recebido` | UTILITY | diarista | `diarista_cadastrada` (na hora) | {{1}} nome, {{2}} dias |
| D02 | `cadastro_aprovado` | UTILITY | diarista | `diarista_aprovada` (na hora) | {{1}} nome |
| D03 | `cadastro_reprovado` | UTILITY | diarista | `diarista_reprovada` (na hora) | {{1}} nome |
| D04 | `diaria_designada` | UTILITY | diarista | `atendimento_atribuido`, `pagamento_confirmado` (na hora) | {{1}} nome, {{2}} data, {{3}} horario, {{4}} endereco |
| D05 | `lembrete_vespera_profissional` | UTILITY | diarista | véspera, 17:00 | {{1}} nome, {{2}} quando, {{3}} horario, {{4}} endereco |
| D06 | `lembrete_checkin` | UTILITY | diarista | 30 min depois do início do turno | {{1}} nome, {{2}} horario |
| D07 | `documento_vencendo` | UTILITY | diarista | 15 e 3 dias antes do vencimento, 09:00 | {{1}} nome, {{2}} documento, {{3}} dias |
| D08 | `diaria_cancelada_ou_remarcada` | UTILITY | diaristas_afetadas | `atendimento_cancelado`, `atendimento_reagendado`, `pedido_cancelado`, `atendimento_atribuido` (na hora) | {{1}} nome, {{2}} data, {{3}} horario, {{4}} oque |

### solicitacao_recebida

- Regra: C01 (Solicitação recebida) · Categoria: UTILITY · Idioma: pt_BR
- Variáveis: {{1}} = nome (ex.: "Ana"); {{2}} = resumo (ex.: "1 diária em 05/10/2026"); {{3}} = link (ex.: "https://primelimpezaespecializada.com.br/acompanhamento/?pedido=exemplo")

```text
Oi, {{1}}! Recebemos sua solicitação de atendimento na Prime: {{2}}. A solicitação ainda não é a confirmação: agora a Prime verifica a disponibilidade e responde por aqui. Você acompanha em {{3}}
Qualquer dúvida, é só responder.
```

### disponibilidade_confirmada

- Regra: C02 (Disponibilidade confirmada, com valor, formas e prazo de pagamento) · Categoria: UTILITY · Idioma: pt_BR
- Variáveis: {{1}} = nome (ex.: "Ana"); {{2}} = resumo (ex.: "1 diária em 05/10/2026"); {{3}} = total (ex.: "3"); {{4}} = valor (ex.: "R$ 175,00"); {{5}} = prazo (ex.: "14h de sex, 02/10"); {{6}} = link (ex.: "https://primelimpezaespecializada.com.br/acompanhamento/?pedido=exemplo")

```text
Oi, {{1}}! A Prime confirmou a disponibilidade para {{2}}. O valor total é {{3}}. Para confirmar, faça o pagamento antecipado de {{4}} por PIX, transferência ou depósito até {{5}} e envie o comprovante. Detalhes e link de pagamento: {{6}}
Dúvidas? É só responder.
```

### solicitacao_recusada

- Regra: C03 (Solicitação recusada, com o motivo) · Categoria: UTILITY · Idioma: pt_BR
- Variáveis: {{1}} = nome (ex.: "Ana"); {{2}} = resumo (ex.: "1 diária em 05/10/2026"); {{3}} = motivo (ex.: "sem profissional livre no período da manhã")

```text
Oi, {{1}}. Verificamos sua solicitação para {{2}} e, desta vez, não temos disponibilidade. Motivo: {{3}}. Se quiser, responda esta mensagem e a Prime ajuda a encontrar outra data.
```

### lembrete_prazo_pagamento

- Regra: C04 (Lembrete do prazo de pagamento (24h e 3h antes)) · Categoria: UTILITY · Idioma: pt_BR
- Variáveis: {{1}} = nome (ex.: "Ana"); {{2}} = valor (ex.: "R$ 175,00"); {{3}} = data (ex.: "05/10/2026"); {{4}} = prazo (ex.: "14h de sex, 02/10"); {{5}} = link (ex.: "https://primelimpezaespecializada.com.br/acompanhamento/?pedido=exemplo")

```text
Oi, {{1}}. Lembrete da Prime: o pagamento antecipado de {{2}}, da diária de {{3}}, vence {{4}}. Os detalhes estão em {{5}}
Se já pagou, pode desconsiderar esta mensagem.
```

### pagamento_confirmado

- Regra: C05 (Pagamento confirmado) · Categoria: UTILITY · Idioma: pt_BR
- Variáveis: {{1}} = nome (ex.: "Ana"); {{2}} = oque (ex.: "R$ 175,00 da diária de 05/10/2026"); {{3}} = link (ex.: "https://primelimpezaespecializada.com.br/acompanhamento/?pedido=exemplo")

```text
Oi, {{1}}! A Prime confirmou o pagamento de {{2}}. Seu atendimento está confirmado. Acompanhe em {{3}}
Na véspera, a gente te lembra por aqui.
```

### lembrete_vespera

- Regra: C06 (Lembrete da véspera) · Categoria: UTILITY · Idioma: pt_BR
- Variáveis: {{1}} = nome (ex.: "Ana"); {{2}} = quando (ex.: "amanhã, 05/10/2026,"); {{3}} = horario (ex.: "das 08:30 às 12:30"); {{4}} = carga (ex.: "4 horas")

```text
Oi, {{1}}! Passando pra lembrar: {{2}} tem atendimento da Prime {{3}}, com {{4}}. O material de limpeza é seu; para área externa, deixe uma mangueira disponível. Se precisar mudar algo, responda esta mensagem.
```

### profissional_designada

- Regra: C07 (Profissional designada ou trocada (primeiro nome)) · Categoria: UTILITY · Idioma: pt_BR
- Variáveis: {{1}} = nome (ex.: "Ana"); {{2}} = data (ex.: "05/10/2026"); {{3}} = profissional (ex.: "Maria")

```text
Oi, {{1}}. A profissional designada pela Prime para a diária de {{2}} é {{3}}. Qualquer dúvida, responda esta mensagem.
```

### profissional_a_caminho

- Regra: C08 (Profissional a caminho) · Categoria: UTILITY · Idioma: pt_BR
- Variáveis: {{1}} = nome (ex.: "Ana"); {{2}} = profissional (ex.: "Maria")

```text
Oi, {{1}}. A profissional designada pela Prime, {{2}}, já está a caminho do seu endereço. Qualquer imprevisto, responda esta mensagem.
```

### atendimento_iniciado

- Regra: C09 (Atendimento iniciado) · Categoria: UTILITY · Idioma: pt_BR
- Variáveis: {{1}} = nome (ex.: "Ana"); {{2}} = profissional (ex.: "Maria")

```text
Oi, {{1}}! A profissional {{2}} chegou e começou o atendimento de hoje. A Prime avisa quando terminar.
```

### atendimento_finalizado

- Regra: C10 (Atendimento finalizado, com a pesquisa de satisfação) · Categoria: UTILITY · Idioma: pt_BR
- Variáveis: {{1}} = nome (ex.: "Ana"); {{2}} = link (ex.: "https://primelimpezaespecializada.com.br/acompanhamento/?pedido=exemplo")

```text
Oi, {{1}}. O atendimento de hoje terminou. Pode responder a pesquisa de satisfação da Prime? Sua resposta vai direto para a equipe da Prime: {{2}}
Obrigada!
```

### lembrete_pesquisa

- Regra: C11 (Lembrete da pesquisa (24h depois, uma vez)) · Categoria: UTILITY · Idioma: pt_BR
- Variáveis: {{1}} = nome (ex.: "Ana"); {{2}} = data (ex.: "05/10/2026"); {{3}} = link (ex.: "https://primelimpezaespecializada.com.br/acompanhamento/?pedido=exemplo")

```text
Oi, {{1}}. Ainda dá tempo de responder a pesquisa sobre o atendimento de {{2}}. Leva menos de um minuto: {{3}}
Obrigada!
```

### remarcacao_confirmada

- Regra: C12 (Remarcação confirmada) · Categoria: UTILITY · Idioma: pt_BR
- Variáveis: {{1}} = nome (ex.: "Ana"); {{2}} = quando (ex.: "amanhã, 05/10/2026,"); {{3}} = horario (ex.: "das 08:30 às 12:30")

```text
Oi, {{1}}. Seu atendimento foi remarcado para {{2}}, {{3}}. Se precisar de outro ajuste, responda esta mensagem.
```

### estorno_registrado

- Regra: C13 (Estorno registrado) · Categoria: UTILITY · Idioma: pt_BR
- Variáveis: {{1}} = nome (ex.: "Ana"); {{2}} = valor (ex.: "R$ 175,00"); {{3}} = oque (ex.: "R$ 175,00 da diária de 05/10/2026")

```text
Oi, {{1}}. A Prime registrou o estorno de {{2}} ({{3}}). Se tiver qualquer dúvida, responda esta mensagem.
```

### hora_extra_registrada

- Regra: C14 (Hora extra aprovada, com valor e link (evento do bloco 3, P3)) · Categoria: UTILITY · Idioma: pt_BR
- Variáveis: {{1}} = nome (ex.: "Ana"); {{2}} = horas (ex.: "1 hora"); {{3}} = data (ex.: "05/10/2026"); {{4}} = valor (ex.: "R$ 175,00"); {{5}} = link (ex.: "https://primelimpezaespecializada.com.br/acompanhamento/?pedido=exemplo")

```text
Oi, {{1}}. A Prime registrou {{2}} de hora extra na diária de {{3}}, no valor de {{4}}. O pagamento está em {{5}}
Dúvidas? É só responder.
```

### ocorrencia_atualizada

- Regra: C15 (Ocorrência atualizada (evento do bloco 3, P4)) · Categoria: UTILITY · Idioma: pt_BR
- Variáveis: {{1}} = nome (ex.: "Ana"); {{2}} = data (ex.: "05/10/2026"); {{3}} = estado (ex.: "em análise"); {{4}} = link (ex.: "https://primelimpezaespecializada.com.br/acompanhamento/?pedido=exemplo")

```text
Oi, {{1}}. O chamado sobre a diária de {{2}} está {{3}}. Acompanhe em {{4}}
Se quiser acrescentar algo, é só responder.
```

### optout_confirmado

- Regra: C16 (Confirmação única de que a pessoa saiu das mensagens de novidades) · Categoria: UTILITY · Idioma: pt_BR
- Variáveis: {{1}} = nome (ex.: "Ana")

```text
Oi, {{1}}. Pronto: você não vai mais receber mensagens de novidades da Prime por este canal. As mensagens do seu atendimento continuam normalmente.
```

### renovacao_pacote

- Regra: M01 (Renovação do pacote (dia 25)) · Categoria: MARKETING · Idioma: pt_BR
- Variáveis: {{1}} = nome (ex.: "Ana"); {{2}} = mes (ex.: "novembro"); {{3}} = link (ex.: "https://primelimpezaespecializada.com.br/acompanhamento/?pedido=exemplo")

```text
Oi, {{1}}! Quer manter as mesmas diárias em {{2}}? A solicitação já vem preenchida com as datas do seu pacote: {{3}}
Se não quiser mais receber estas mensagens, responda SAIR.
```

### reativacao

- Regra: M02 (Reativação: sem diária há 60 dias (no máximo a cada 90)) · Categoria: MARKETING · Idioma: pt_BR
- Variáveis: {{1}} = nome (ex.: "Ana"); {{2}} = link (ex.: "https://primelimpezaespecializada.com.br/acompanhamento/?pedido=exemplo")

```text
Oi, {{1}}! Faz um tempo desde a sua última diária com a Prime. Quando precisar, é só solicitar por {{2}}
Se não quiser mais receber estas mensagens, responda SAIR.
```

### aniversario_cliente

- Regra: M03 (Aniversário da cliente, 9h) · Categoria: MARKETING · Idioma: pt_BR
- Variáveis: {{1}} = nome (ex.: "Ana")

```text
Feliz aniversário, {{1}}! A equipe da Prime deseja um dia muito especial para você.
Se não quiser mais receber estas mensagens, responda SAIR.
```

### cadastro_recebido

- Regra: D01 (Cadastro recebido) · Categoria: UTILITY · Idioma: pt_BR
- Variáveis: {{1}} = nome (ex.: "Ana"); {{2}} = dias (ex.: "15")

```text
Oi, {{1}}! Recebemos seu cadastro na Prime. Vamos analisar seus documentos e responder por aqui em até {{2}} dias úteis.
```

### cadastro_aprovado

- Regra: D02 (Cadastro aprovado) · Categoria: UTILITY · Idioma: pt_BR
- Variáveis: {{1}} = nome (ex.: "Ana")

```text
Parabéns, {{1}}! Seu cadastro na Prime foi aprovado. As próximas diárias chegam por aqui.
```

### cadastro_reprovado

- Regra: D03 (Cadastro reprovado (sem expor o motivo interno)) · Categoria: UTILITY · Idioma: pt_BR
- Variáveis: {{1}} = nome (ex.: "Ana")

```text
Oi, {{1}}. Analisamos seu cadastro e, por enquanto, não conseguimos seguir. Se quiser conversar sobre isso, responda esta mensagem.
```

### diaria_designada

- Regra: D04 (Diária designada, com endereço completo (só com o atendimento confirmado)) · Categoria: UTILITY · Idioma: pt_BR
- Variáveis: {{1}} = nome (ex.: "Ana"); {{2}} = data (ex.: "05/10/2026"); {{3}} = horario (ex.: "das 08:30 às 12:30"); {{4}} = endereco (ex.: "Rua Exemplo, 100, Savassi, Belo Horizonte")

```text
Oi, {{1}}! Você tem uma diária confirmada: {{2}}, {{3}}. Endereço: {{4}}. Qualquer dúvida, responda esta mensagem.
```

### lembrete_vespera_profissional

- Regra: D05 (Lembrete da véspera (profissional), 17h) · Categoria: UTILITY · Idioma: pt_BR
- Variáveis: {{1}} = nome (ex.: "Ana"); {{2}} = quando (ex.: "amanhã, 05/10/2026,"); {{3}} = horario (ex.: "das 08:30 às 12:30"); {{4}} = endereco (ex.: "Rua Exemplo, 100, Savassi, Belo Horizonte")

```text
Oi, {{1}}. Lembrete: {{2}} você tem diária {{3}}. Endereço: {{4}}. Bom trabalho!
```

### lembrete_checkin

- Regra: D06 (Sem check-in 30 minutos depois do horário de início) · Categoria: UTILITY · Idioma: pt_BR
- Variáveis: {{1}} = nome (ex.: "Ana"); {{2}} = horario (ex.: "das 08:30 às 12:30")

```text
Oi, {{1}}. A diária de hoje, {{2}}, ainda está sem check-in. Se já chegou, avise pela sua agenda; se teve imprevisto, responda esta mensagem.
```

### documento_vencendo

- Regra: D07 (Documento vencendo em 15 e 3 dias (validade do bloco 3, P5)) · Categoria: UTILITY · Idioma: pt_BR
- Variáveis: {{1}} = nome (ex.: "Ana"); {{2}} = documento (ex.: "certidão de antecedentes"); {{3}} = dias (ex.: "15")

```text
Oi, {{1}}. Seu documento {{2}} vence em {{3}} dias. Envie a versão atualizada pelo seu cadastro para continuar recebendo diárias.
```

### diaria_cancelada_ou_remarcada

- Regra: D08 (Diária cancelada, remarcada ou trocada de profissional) · Categoria: UTILITY · Idioma: pt_BR
- Variáveis: {{1}} = nome (ex.: "Ana"); {{2}} = data (ex.: "05/10/2026"); {{3}} = horario (ex.: "das 08:30 às 12:30"); {{4}} = oque (ex.: "R$ 175,00 da diária de 05/10/2026")

```text
Oi, {{1}}. A diária de {{2}}, {{3}}, {{4}} e saiu da sua agenda. Qualquer dúvida, responda esta mensagem.
```

<!-- TEMPLATES:FIM -->

---

## 3. Webhook e agendador (implementados na fase 2, AUT)

**Webhook** (`supabase/functions/whatsapp-webhook`, lógica em `_shared/webhook-whatsapp.js`). Pronto e **desligado**: sem os segredos `WHATSAPP_VERIFY_TOKEN` e `WHATSAPP_APP_SECRET`, responde 503. Deploy com `--no-verify-jwt` (a Meta não manda JWT; a autenticação é a assinatura).
- **Verificação (GET):** `hub.mode=subscribe` e `hub.verify_token` igual ao segredo (comparação em tempo constante) devolve `hub.challenge`; senão 403.
- **Assinatura (todo POST):** `X-Hub-Signature-256 = sha256=` HMAC-SHA256 do **corpo cru** com o App Secret; errada = 401. Corpo acima de 512 KB = 413.
- **Status** (`statuses[]`): `webhook_status` grava cada (id, status) uma vez só (a Meta reenvia) e o estado **só avança**: `sent` < `delivered` < `read`; `failed` marca falha e avisa a equipe (I08), mas é ignorado se a mensagem já foi entregue ou lida.
- **Mensagens recebidas** (`messages[]`): `webhook_mensagem` grava uma vez por id, renova a janela de 24h do telefone (`whatsapp_janelas`) e: "SAIR" (ou "PARAR"/"STOP") revoga o consentimento de novidades por WhatsApp de quem tem aquele telefone e manda **uma** confirmação (C16); qualquer outra vira aviso pra equipe no painel (I09).
- **Janela de 24h:** todo envio automático é template aprovado (vale fora da janela). Mensagem livre não é enviada pelo sistema; a janela registrada serve pro atendimento humano.

**Agendador** (Edge Function `notificacoes`, pg_cron a cada minuto; motor em `src/automacoes/v2`):
- Regras e textos no banco (`automacao_regras`, `templates`), editáveis no painel dentro de limites.
- Eventos um por transação; lembretes com data (véspera, prazo, check-in, relacionamento) saem da **varredura da agenda** sobre o estado atual, com chave única `regra:entidade:id:marco` (sem duplicar, e recupera ciclo perdido que ainda vale).
- Envio em duas fases com `FOR UPDATE SKIP LOCKED`; revalida a condição, aplica horário silencioso (20h às 8h), domingo/feriado, limite diário (3 lembretes e 1 novidade por cliente) e consentimento a cada tentativa. Falha transitória: 1, 5, 15 e 60 min; depois o próximo canal; o último é o painel. Resultado incerto (caiu no meio) não é reenviado: vira falha com aviso.

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
