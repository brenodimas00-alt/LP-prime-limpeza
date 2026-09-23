# Pendências: confirmar com a cliente

Cada item abaixo já está implementado com o padrão indicado. Mudar é trocar valor em `src/config/precos.js` ou `src/config/prime.js` (sem mexer em código), salvo onde indicado.

## Dados da Prime (`src/config/prime.js`) — PREENCHER
- [ ] Chave Pix, nome do recebedor (até 25 caracteres) e cidade (até 15). **Sem isso a tela de Pix mostra aviso e não gera cobrança.**
- [ ] WhatsApp de atendimento (formato `5531...`). Sem isso os botões "abrir no WhatsApp" somem.
- [ ] E-mail e endereço (opcionais).

## Preços (`src/config/precos.js`) — todos PROVISÓRIOS
- [ ] Valor base por faixa de metragem (até 60, 120, 250 m²) e alternativa por cômodos (base + por cômodo).
- [ ] Multiplicador por tipo de limpeza (padrão 100%, pesada 140%, pré/pós-mudança 150%, pré/pós-evento 130%, passadoria 80%).
- [ ] Acréscimo pra empresa (15%).
- [ ] Adicionais e valores (geladeira, forno, armários, janelas, passar roupa).
- [ ] Desconto por frequência (semanal 10%, quinzenal 5%, mensal 0%).
- [ ] Taxa de deslocamento por cidade e lista de cidades atendidas.
- [ ] Limite de diárias por pedido (1 a 12).

## Regras comerciais
- [ ] **Cobrança do restante:** padrão `por_atendimento` (restante dividido igual entre as diárias, sobra na última, cada parcela vence na data da diária). Alternativa pronta: `no_primeiro`.
- [ ] **Entrada de 50%** arredondada pra baixo (DECIDIDO); confirmar se a Prime aceita o centavo ímpar no restante.
- [ ] **Dias bloqueados:** domingo. Feriados: lista `datasBloqueadas` vazia.
- [ ] **Antecedência mínima:** 1 dia (não agenda pra hoje). Horizonte máximo: 120 dias.
- [ ] **Calendário:** semanal = 7 dias, quinzenal = 14, mensal = mesmo dia (último dia se não existir). Diária que cair em dia bloqueado vai pro próximo dia permitido e aparece como "deslocada".
- [ ] **Empresa exige frequência** (não existe empresa avulso).
- [ ] **Turnos:** manhã 8h às 12h, tarde 13h às 17h, integral 8h às 17h.
- [ ] **Entrada de pedido cancelado:** se nenhuma diária foi realizada, a entrada ainda não confirmada é cancelada. Entrada já paga: reembolso é processo manual da Prime (não implementado).
- [ ] **Confirmação de parcela do dia:** a Prime só confirma parcela de diária que já começou (diarista a caminho em diante).

## Automações e WhatsApp
- [ ] **Novo template** `atendimento_cancelado_diarista` (não estava na lista original): avisa a diarista quando perde a diária. Confirmar texto.
- [ ] **Horário do lembrete:** 18h da véspera (America/Sao_Paulo). Diária marcada depois das 18h da véspera recebe o lembrete na hora.
- [ ] **Cobrança do dia:** mensagem 2 horas depois de a diária ser finalizada (`minutosAposFinalizado`).
- [ ] **Avisos internos pra Prime** (novo pedido, "já paguei" da cliente, cadastro novo de diarista): hoje aparecem só no painel/fila; não há template de WhatsApp pra Prime.
- [ ] **Prazo de análise do cadastro de diarista:** 5 dias úteis (texto do `cadastro_recebido`).
