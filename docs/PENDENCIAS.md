# Pendências: confirmar com a cliente

Cada item abaixo já está implementado com o padrão indicado. Mudar é trocar valor em `src/config/precos.js` ou `src/config/prime.js` (sem mexer em código), salvo onde indicado.

## Dados da Prime (`src/config/prime.js`) — PREENCHER
- [ ] Chave Pix, nome do recebedor (até 25 caracteres) e cidade (até 15). **Sem isso a tela de Pix mostra aviso e não gera cobrança.**
- [ ] WhatsApp de atendimento (formato `5531...`). Sem isso os botões "abrir no WhatsApp" somem.
- [ ] E-mail e endereço (opcionais).

## Preços (`src/config/precos.js`): TABELA OFICIAL da cliente (23/09/2026), já aplicada
- [x] Diária por duração: 2h R$ 138 (só até 30 m²), 4h R$ 175, 6h R$ 203, 8h R$ 220; hora extra R$ 30.
- [x] Tipos: residencial 0; empresarial/comercial e condominial + R$ 10; pré/pós-mudança e pré/pós-evento + R$ 20; passadoria exclusiva na mesma tabela. Pós-obra não oferecido.
- [x] Passadoria combinada + R$ 55 (pouca demanda). Sábado/feriado + R$ 20. Sem local pro almoço + R$ 25. Domingo bloqueado.
- [x] Deslocamento: BH isento; Contagem, Santa Luzia, Ribeirão das Neves, Sabará + R$ 10; Betim, Ibirité, Vespasiano + R$ 15; Nova Lima sob consulta (vai pro WhatsApp); outras não atendidas.
- [x] Desconto mensal por pedido: 3 ou 4 diárias no mês − R$ 20; 5 ou mais − R$ 40 (por mês de calendário).
- [ ] **Lista de feriados** (nacionais + BH, 2026 e 2027) em `feriados`: conferir todo ano.
- [ ] Hora extra: limite de 4 por diária (padrão nosso, não veio na tabela).
- [ ] Metragem máxima aceita no formulário: 1.000 m² (acima de 120 mostra aviso e WhatsApp).

## Regras comerciais
- [x] ~~CONFLITO 50/50 x pagamento antecipado~~: resolvido pela cliente em 24/09/2026 (pagamento antecipado e integral). Texto antigo abaixo só pra histórico.
- [ ] (histórico) **CONFLITO 50/50 x pagamento antecipado.** A regra do projeto é 50% na contratação e 50% no dia; a tabela da cliente diz pagamento antecipado com comprovante até 14h do dia útil anterior. Mantido o 50/50. O prazo da parcela restante é configurável em `precos.js` (`prazoRestante`: `'no_dia'` padrão, ou `'dia_util_anterior_14h'`, que muda o vencimento pro dia útil anterior às 14h). **Atenção:** se a cliente escolher o pagamento antecipado, a regra de elegibilidade da parcela do dia (pagável só a partir de "diarista a caminho", DECIDIDA no projeto) também precisa mudar pra "pagável desde a confirmação da entrada"; só trocar o prazo não basta (apontado na revisão GPT #6). **Confirmar com a cliente.**
- [ ] **Cobrança do restante:** padrão `por_atendimento` (restante dividido igual entre as diárias, sobra na última, cada parcela vence na data da diária). Alternativa pronta: `no_primeiro`.
- [ ] **Entrada de 50%** arredondada pra baixo (DECIDIDO); confirmar se a Prime aceita o centavo ímpar no restante.
- [ ] **Dias bloqueados:** domingo. Feriados: lista `datasBloqueadas` vazia.
- [ ] **Antecedência mínima:** 1 dia (não agenda pra hoje). Horizonte máximo: 120 dias.
- [ ] **Calendário:** semanal = 7 dias, quinzenal = 14, mensal = mesmo dia (último dia se não existir). Diária que cair em dia bloqueado vai pro próximo dia permitido e aparece como "deslocada".
- [x] ~~Empresa exige frequência~~: no agendamento v2 (29/09) empresa também pode pedir uma diária só (item 13 da cliente).
- [x] ~~Turnos~~: substituídos pela hora de início exata no agendamento v2 (29/09). Diárias antigas: manhã 08:00, tarde 13:00, integral 08:00.
- [ ] **Entrada de pedido cancelado:** se nenhuma diária foi realizada, a entrada ainda não confirmada é cancelada. Entrada já paga: reembolso é processo manual da Prime (não implementado).
- [ ] **Confirmação de parcela do dia:** a Prime só confirma parcela de diária que já começou (diarista a caminho em diante).

## Operação
- [x] **Diarista com duas diárias no mesmo dia:** desde o agendamento v2 (29/09) vale o horário real: não pode haver cruzamento entre início e fim (08:00-12:00 e 12:00-16:00 pode; 08:00-12:00 e 11:00-13:00 não). A disponibilidade cadastrada (dias/regiões) ainda NÃO é checada na atribuição.

## Automações e WhatsApp
- [ ] **Novo template** `atendimento_cancelado_diarista` (não estava na lista original): avisa a diarista quando perde a diária. Confirmar texto.
- [ ] **Horário do lembrete:** 18h da véspera (America/Sao_Paulo). Diária marcada depois das 18h da véspera recebe o lembrete na hora.
- [ ] **Cobrança do dia:** mensagem 2 horas depois de a diária ser finalizada (`minutosAposFinalizado`).
- [ ] **Avisos internos pra Prime** (novo pedido, "já paguei" da cliente, cadastro novo de diarista): hoje aparecem só no painel/fila; não há template de WhatsApp pra Prime.
- [ ] **Prazo de análise do cadastro de diarista:** 5 dias úteis (texto do `cadastro_recebido`).

## Notificações (B5)
- [ ] **E-mail como canal:** provedor pronto e desligado até existir remetente verificado (domínio próprio + Resend ou similar). As mensagens hoje são de WhatsApp; confirmar se a Prime quer e-mail também (e pra quais avisos).
- [ ] **WhatsApp oficial (Meta Cloud API):** provedor pronto e testado contra servidor fake; em produção precisa do número verificado, token permanente e os templates aprovados (docs/WHATSAPP.md). Em homologação continua simulado.

## Documentos das diaristas (B6)
- [ ] **Retenção:** arquivos de cadastro reprovado apagados 90 dias depois da decisão (padrão nosso, `configuracao.documentos.retencaoReprovadasDias`). Confirmar prazo com a Prime (e se aprovadas desligadas também têm prazo).
- [ ] **Limite de envio:** 30 arquivos por hora por conta. **Validade do link de visualização:** 2 minutos.

## Homologação pra cliente (I1)
- [ ] ~~E-mail da Isa~~: virou o A0 da fase 2 (abaixo).
- [ ] **Deslocamento por cidade** não é editável no painel (só a tabela de preços em centavos). Confirmar se a Prime quer editar isso também.

## Infra (B0)
- [ ] **Supabase plano free** (`prime-homolog`): pausa depois de ~7 dias sem uso e não é para produção. Produção precisa de projeto no plano pago (GO-LIVE).
- [ ] **Cloudflare Pages na conta da Gabrielle** (projeto `prime-limpeza`): decidir no go-live se fica nela ou numa conta da Prime.

## Base importada (B7)
- [ ] **113 clientes sem acesso** (106 sem e-mail, 7 e-mail inválido): a Prime completa o e-mail no painel (aba Clientes, filtro "sem acesso").
- [ ] **4 CPFs/CNPJs repetidos** na planilha: ficou a linha mais recente; as outras estão no cadastro (pendência "documento repetido") pra Prime revisar.
- [ ] **65 datas de nascimento inválidas, 13 endereços a revisar, 4 sem endereço, 3 telefones inválidos:** importados sem o dado ruim; aparecem como pendência no painel (F2).
- [ ] **Backup do homolog:** plano free não tem backup pra baixar. Rodar `bash scripts/backup-homolog.sh` antes de mudanças grandes; produção precisa de plano pago (backups diários).

## Home (Breno)
- [x] ~~320px com rolagem horizontal~~: corrigido na home nova (24/09).

## Login e contas (F0/B2)
- [ ] **SMTP próprio: BLOQUEADO.** Sem ele, e-mail de confirmação de cadastro e link de "Esqueci minha senha" não saem pra ninguém fora do time do projeto (limite de 2/hora). Preciso de uma conta de envio (Resend, SES ou similar) com domínio verificado; depois: `supabase config push` com `[auth.email.smtp]`. Produção também precisa.
- [ ] **Senha dos clientes novos:** hoje mínimo 8 caracteres (`SENHA_MINIMA_SITE` em `src/config/app.js` e `configuracao.auth` no banco). Confirmar com a cliente se os novos também usam os 6 primeiros números do CPF/CNPJ.
- [ ] **Confirmação de e-mail no meio do agendamento:** com confirmação ligada, quem agenda pela primeira vez só acompanha o pedido depois de confirmar o e-mail. Confirmar com a cliente se aceita, ou se a confirmação pode vir depois do primeiro pedido.
- [x] ~~Preview em transição (até o F2)~~: desde o F2 o preview usa login e dados reais do Supabase de homologação.
- [x] ~~Painel da Prime (último acesso, bloquear, redefinir senha)~~: aba Clientes (F2).
- [ ] **Entrar com Google: BLOQUEADO** até criar o OAuth client no Google Cloud (tela de consentimento + client id/secret) e cadastrar no Supabase Auth (`[auth.external.google]`). O hook de cadastro já libera provedor externo; o botão explica que ainda não está disponível.
- [ ] Recuperação de senha: na demonstração não envia e-mail. Em homologação usa o e-mail padrão do Supabase (limite baixo); produção precisa de SMTP próprio.
- [ ] Entrada por código no WhatsApp: pronta atrás de `LOGIN_WHATSAPP` em `src/config/app.js`, desligada.

## Ajustes da cliente (24/09/2026): confirmar com a Isa
- [ ] **WhatsApp oficial** pro botão "FALAR COM A PRIME" (`prime.js` está `PREENCHER`): é o (31) 97236-3590 do rodapé? Enquanto não preencher, o botão leva aos contatos do rodapé e mostra aviso.
- [ ] **Pacote mensal:** hoje cada diária é paga antecipada e integralmente (leitura literal do briefing). "Pacote pago de uma vez" está pronto e desligado (`pagamento.pacoteDeUmaVez` em `precos.js`). Confirmar.
- [ ] **Desconto do mês na cobrança da última diária do mês:** confirmar se a Prime prefere na primeira. Se a cliente cancelar e o mês cair abaixo de 3 diárias, as cobranças pendentes são recalculadas; se a com desconto já foi paga, o acerto é manual.
- [ ] **Dados bancários** pra transferência e depósito (hoje a tela manda pedir à Prime pelo WhatsApp) e **chave PIX** real.
- [ ] **Prazo de estorno** e **política de remarcação** (não vieram; nada foi inventado: o painel só registra estorno e remarcação com motivo).
- [ ] **Lembrete do prazo de pagamento:** às 9h do dia do vencimento (padrão nosso).
- [ ] **FAQ:** aprovar as 9 respostas (escritas só com home-isa.txt e precos-prime.txt).
- [ ] **Avaliações da home:** 3 a 4 depoimentos reais, com nome autorizado e tipo de serviço. Sem eles a seção fica oculta.
- [ ] **Foto da limpeza condominial** (o card usa um quadro do vídeo do hero).
- [ ] **Clientes sem e-mail (113):** hoje continuam sem acesso. Com o login por CPF ou celular, dá pra criar acesso pra eles sem e-mail; confirmar se a Prime quer.
- [ ] **Login, contagem dos importados (homolog, 24/09):** 3.176 com acesso; entram por e-mail 3.176, por CPF 3.036 (15 sem data de nascimento válida e 125 empresas não entram por CPF), por celular 3.093 (81 com celular repetido entre clientes e 2 sem telefone não entram por celular).
- [ ] **Senha própria esquecida:** hoje é "fale com a Prime" e a Prime redefine no painel (volta à regra padrão). Confirmar.

## Fase 2, bloco 1 (28/09/2026)

### A0. Admin da cliente: feito em 28/09 (validado em homologação); unificada em 29/09
- [x] ~~Admin no e-mail `+prime`~~: em 29/09 a conta passou pro e-mail normal dela (`scripts/unifica-contas.mjs`), que agora tem os papéis cliente e prime_admin. Ela entra com a mesma senha que já usava no painel; pela entrada da cliente, escolhe entre a área da cliente e o painel. A conta `+prime` ficou bloqueada, com o histórico. **Atenção:** a senha da área da cliente dela deixou de ser os 6 números do CPF (é a do painel; conta com papel da equipe nunca entra pela regra padrão nem pela data de nascimento).
- [ ] **Papéis da equipe pelo painel:** hoje só por script (`unifica-contas.mjs`, `a0-admin-cliente.mjs`). Tela pra a admin dar ou tirar papel de outra pessoa fica pra quando a Prime tiver mais gente na equipe.
- [ ] **Exclusão de dados de quem também é da equipe ou profissional:** a function recusa (apagaria o acesso inteiro). Hoje é manual, com o suporte técnico.
- [x] ~~E-mail pedido já era de cliente importada~~: a Gabrielle escolheu a variação `+prime` do mesmo Gmail (chega na mesma caixa; e-mail fora do repo). Conta criada com senha temporária (passada só no terminal) e troca obrigatória no primeiro acesso; login testado. A conta de demonstração antiga (`isa.admin@prime-homolog.example`) não existe mais.

### S1. SEO
- [ ] **Domínio canônico com ou sem www** (hoje sem). **Dados da empresa** pro JSON-LD e pras páginas legais: razão social, CNPJ, e-mail, endereço com CEP (`src/config/seo.js`).
- [ ] **FAQ** continua pendente de aprovação (já estava): o FAQPage do JSON-LD reflete o FAQ que está na home.
- [ ] O logo branco (`assets/logo-branco.svg`, rodapé e imagem de compartilhamento) está com "LIMPEZA ESPECIALIZAD" (sem o A final) no próprio arquivo; o colorido (`logo.svg`) está certo. Pedir o branco corrigido e rodar `node scripts/gera-og.mjs` de novo.

### S2. Redirecionamentos
- [ ] O site antigo não tem sitemap nem robots (respondem 200 com página "não encontrada"). O rastreamento achou só `/`, `/autoagendamento`, `/cliente/autocadastro` e `/diarista/autocadastro` (docs/urls-antigas.txt). Se a cliente souber de outras URLs divulgadas (ex.: links em anúncios ou no Instagram), me passar.
- [ ] `/cliente/autocadastro` vai pra solicitação (a conta da cliente nasce nela). Confirmar.

### L1. Legal e LGPD
- [ ] **Revisão por advogado** da Política de Privacidade e dos Termos de Uso (texto fiel ao sistema, mas sem revisão jurídica). Campos `PREENCHER`: razão social, CNPJ, endereço, **encarregado (nome e e-mail)**, política de cancelamento e estorno.
- [ ] **Prazos de guarda:** pedidos e pagamentos 5 anos (fiscal); documento (CPF/CNPJ) mantido na exclusão pra ligar o pagamento ao pagador; registros de acesso "pelo menos 6 meses" (hoje não há rotina que apague acessos antigos). Confirmar com o advogado.
- [ ] **Exclusão de profissional:** pelo site só a cliente pede ("Excluir meus dados" em Minha conta). A profissional pede à Prime, que hoje faz manualmente.
- [ ] Profissionais já aprovadas antes do aceite versionado (hoje só fictícias) passam a ver o pedido de aceite na agenda.

## Fase 2, bloco 2 (AUT, 28/09/2026): confirmar com a cliente
- [ ] **Horários padrão:** véspera 18h (cliente) e 17h (profissional); prazo de pagamento 24h e 3h antes; sem check-in 30 min depois do início; resumo diário 7h; semanal segunda 8h; renovação dia 25 9h; reativação 60 dias sem diária (no máximo a cada 90); aniversário 9h. Tudo editável no painel.
- [ ] **Véspera de segunda e de dia depois de feriado:** pela regra global (domingo/feriado só atendimento do dia), o lembrete da véspera não sai (a próxima janela é depois do início da diária). Alternativa: mandar no último dia livre antes (sábado). Confirmar.
- [ ] **Silêncio 20h às 8h** e limites (3 lembretes e 1 novidade por cliente por dia): editáveis no painel (Configuração, via RPC).
- [ ] **D03 (cadastro reprovado):** hoje nunca mostra o motivo à profissional. Se a Prime quiser mostrar quando não for reservado, precisa do campo "reservado" na reprovação (bloco 3).
- [ ] **C05 (pagamento confirmado):** manda o link do acompanhamento; o recibo em PDF entra no P3.
- [ ] **M01 (renovação):** o link `autoagendamento/?repetir=<pedido>` precisa do preenchimento na tela de solicitação (P6). Regras de marketing nascem desligadas.
- [ ] **D07 (documento vencendo):** depende da validade dos documentos (P5); até lá não dispara.
- [ ] **Avisos pra equipe (I01-I09):** só no painel. Se a Prime quiser também por WhatsApp ou e-mail da equipe, informar o número/e-mail.
- [ ] **Contato de teste** do painel: número fictício (`31900000001`) na homologação; em produção trocar por um número da equipe.
- [ ] **Templates na Meta:** 27 templates (24 UTILITY, 3 MARKETING) em docs/WHATSAPP.md pra aprovação; texto editado no painel vira versão nova que precisa de aprovação própria.

## Agendamento v2 (29/09/2026): confirmar com a cliente
Base: spec-agendamento-v2.txt, autoagendamento-isa.txt (31 itens) e decisões da Gabs de 28/09. O que veio do sistema antigo da Prime (autoagendamento do site atual, lido em 28/09) está marcado.
- [ ] **Preços do sistema antigo x tabela oficial:** o sistema antigo cobra + R$ 10 no sábado, domingo e feriado e dá desconto também por "diárias no mesmo dia" (3 = R$ 20, 5 = R$ 40). O novo segue a tabela oficial (precos-prime.txt): sábado e feriado + R$ 20, domingo fechado, desconto só por mês. A cliente confirmar que o antigo está desatualizado.
- [ ] **Horários de trabalho:** segunda a sábado, primeiro início 08:00, fim do atendimento até 18:30 (último início 2h 16:30, 4h 14:30, 6h 12:30, 8h 10:30), iguais pra residencial e empresarial. O antigo aceitava qualquer minuto; aqui as opções vão de **30 em 30 minutos** (confirmar). Editável no painel (aba Preços, "Horários de trabalho"). O rodapé do site ainda diz "Sábado 08:00 às 14:00" (horário de atendimento da equipe?): confirmar se é outra coisa ou se muda.
- [ ] **Limites de cada carga (do sistema antigo):** residencial 2h até 3 cômodos/30 m², 4h 5/50, 6h 8/80, 8h 10/120; empresarial 2h 4/40, 4h 6/60, 6h 9/90, 8h 11/130. No antigo, o texto da 6h residencial diz "até 70 m²" e o limite configurado é 80: usamos 80 (Gabs). A 2h empresarial vai até 40 m² (a tabela oficial fala em 2h só até 30 m², escrita pensando no residencial).
- [ ] **Cômodos contados:** quartos, banheiros, salas, cozinhas e área externa (os do sistema antigo). A spec citava também área de serviço.
- [ ] **O que está incluído em cada serviço:** listas tiradas das descrições do sistema antigo (residencial, empresarial/comercial, condominial, pré e pós-mudança, passadoria). **Pré e pós-eventos está PREENCHER** (o antigo não tinha esse serviço). Aprovar os textos.
- [ ] **Condições do atendimento** (`condicoes/`, versão 2026-09-29): aprovar o texto e revisão por advogado. Vieram do texto antigo e **precisam de confirmação de que ainda valem**: cancelamento/remarcação até o dia anterior (1h antes do fim do expediente) com retenção de 50%; valor total se a profissional já estiver a caminho; pacotes com 30 dias pra usar e multa de 30% no cancelamento de datas pagas; pausa mínima de 30 min pra refeição nas diárias de 6 e 8 horas; tolerância de atraso de 30 min a 1 h, compensada no fim; sem devolução se terminar antes; não usar eletrodomésticos (aspirador). PREENCHER: prazo de estorno e condições gerais.
- [ ] **Local pra refeição:** a pergunta "Há local para a profissional guardar e esquentar a refeição?" continua (sim/não) e o "não" soma + R$ 25 (tabela oficial). O antigo não perguntava (taxa zerada lá).
- [ ] **Passadoria combinada (+ R$ 55)** saiu do fluxo (não está nos 31 itens). Voltar como opção ou deixar só com a Prime?
- [ ] **Antecedência mínima:** 1 dia corrido (a spec sugeria 1 dia útil). Agenda até 120 dias à frente pra todas as datas (Gabs), então recorrente mensal vai no máximo a 4 diárias.
- [ ] **Solicitação com e-mail de outra conta:** o cadastro novo nasce sem acesso e aparece no painel (Clientes, "e-mail usado por outra conta") pra Prime resolver; a pessoa recebe a mesma resposta de sempre (não revela conta existente).
- [ ] **Pausa pra refeição e ocupação:** a pausa de 30 min fica dentro da carga contratada; pra sobreposição de agenda vale a duração inteira.

## Fase 2, bloco 3 (29/09/2026): confirmar com a cliente
- [ ] **P2, região em BH:** o cadastro da profissional usa regionais de BH ("BH - Pampulha"...), mas o pedido só tem bairro e cidade. Hoje qualquer regional cobre qualquer bairro de BH. Pra sugerir pela regional, precisamos da lista bairro -> regional (a PBH publica) ou que a cliente diga se isso importa.
- [ ] **P2, turnos:** manhã = diária que termina até 13:00; tarde = começa a partir de 12:00. Confirmar.
- [ ] **P3, nota fiscal:** o recibo NÃO é nota fiscal. A emissão de NF é assunto da cliente (contador/prefeitura).
- [ ] **P3, dados da empresa no recibo:** razão social, CNPJ e endereço estão "a preencher" (`src/config/seo.js`).
- [ ] **P3, hora extra:** prazo de pagamento da cobrança de hora extra (hoje 2 dias, 14h) e limite de 4 horas por diária. Confirmar.
- [ ] **P3, liberar vaga sozinho:** a opção existe e está DESLIGADA. Ligar só se a Prime quiser que diária não paga no prazo seja cancelada sem ninguém decidir.
- [ ] **P3, recibo e exclusão de dados (LGPD):** o recibo guarda nome e documento de quem pagou mesmo depois da exclusão (obrigação fiscal). Advogado confirmar.
- [ ] **P4, checklist:** as listas vieram do "O que está incluído" de cada serviço; Pré e pós-eventos está vazio (PREENCHER). A Prime ajusta na aba Configurações.
- [ ] **P4, ocorrência:** prazo de 30 dias depois da diária e limite de 5 por dia. Confirmar.
- [ ] **P4, localização:** hoje a profissional autoriza na agenda (Privacidade). Confirmar com o advogado o texto e a retenção de 30 dias.
- [ ] **P5, validade da certidão:** 90 dias (padrão da spec). Confirmar o prazo que a Prime exige.
- [ ] **P5, repasse:** a Prime definir a regra (percentual ou valor por carga horária, e quanto vale a hora extra pra profissional) e só então ligar "Repasse" em Configurações.
- [ ] **P5, planilha das profissionais atuais:** mandar no modelo (`importa-profissionais.mjs --modelo`); depois de importadas, falta definir como elas ganham acesso (senha temporária com troca obrigatória, como a admin?).
- [ ] **P7, Turnstile de verdade: BLOQUEADA.** Passo: no painel da Cloudflare (conta do Pages), Turnstile > Add widget, domínio de produção (e o `*.pages.dev` se quiser no preview), modo "Managed". Copiar a Site Key pro `~/.prime-env` como `TURNSTILE_SITEKEY` e a Secret Key com `cd ~/projetos/LP-prime-limpeza && bash scripts/cli.sh supabase secrets set TURNSTILE_SECRET=<secret>`. Hoje o homolog usa as chaves de teste da Cloudflare (sempre passam).
- [ ] **O1, Web Analytics: BLOQUEADA.** Passo: painel da Cloudflare > Analytics & Logs > Web Analytics > Add a site (domínio de produção), copiar o token do snippet pro `~/.prime-env` como `WEB_ANALYTICS_TOKEN` e refazer o deploy. O funil do painel já funciona sem ela.
