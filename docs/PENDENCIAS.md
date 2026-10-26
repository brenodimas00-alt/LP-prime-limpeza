# Pendências: confirmar com a cliente

Cada item abaixo já está implementado com o padrão indicado. Mudar é trocar valor em `src/config/precos.js` ou `src/config/prime.js` (sem mexer em código), salvo onde indicado.

## Para a cliente responder (fonte do `pendencias-cliente.docx`)
Resumo, em linguagem simples, do que está em aberto nas seções abaixo e depende da Prime. O documento da cliente é gerado só desta seção (`scripts/gera-pendencias-docx.mjs`). Em cada item, "Hoje" é como o sistema já funciona enquanto não houver resposta.

### Dados da empresa
- **Dados da Prime:** razão social, CNPJ, endereço com CEP e e-mail. Aparecem no site, no recibo e nas páginas legais. Hoje: os campos ficam em branco e não são publicados.
- **Pix e transferência:** chave Pix, nome do recebedor (até 25 letras), cidade e os dados bancários para transferência. Hoje: a tela de pagamento pede para falar com a Prime pelo WhatsApp.
- **WhatsApp oficial:** o botão "Falar com a Prime" deve usar o (31) 97236-3590 do rodapé? Hoje: o botão leva aos contatos do rodapé.
- **Encarregado de dados (LGPD):** nome e e-mail da pessoa que responde por privacidade. Hoje: em branco na Política de Privacidade.
- **Endereço do site:** com ou sem "www"? Hoje: sem www.

### Duração, locais e horários do agendamento
- **Tabela de duração:** confirmar as faixas de 70 m² (6 horas) e 110 m² (8 horas), no lugar de 80 e 120, e que banheiro e cozinha contam como 1,5 ambiente. Hoje: já funciona assim, e os ambientes sobem no máximo uma faixa.
- **Empresarial:** a duração do empresarial continua 40, 60, 90 e 130 m²? Hoje: sim.
- **Vila da Serra e vizinhos:** qual a faixa de CEP do Vila da Serra (taxa de R$ 10)? Algum outro bairro de Nova Lima deve ter a mesma taxa? Quais? Hoje: sem a faixa, o Vila da Serra paga a taxa de Nova Lima (R$ 20).
- **Sábado:** o atendimento de sábado termina às 14:00, como diz o rodapé do site, ou às 18:30, como nos outros dias? Hoje: 18:30 no agendamento.
- **Sábado que é feriado:** cobra uma taxa só (R$ 20) ou as duas? Hoje: uma só.
- **Feriados de 2026 e 2027:** conferir a lista de feriados nacionais, de Minas e de BH no painel (Gestão > Configurações). Hoje: a lista que está no painel.
- **Horários de 30 em 30 minutos:** a cliente escolhe o início de 30 em 30 minutos (08:00, 08:30...). Está bom? Hoje: sim.
- **"Ver mais" de Pré e pós-eventos:** escrever o que está incluído nesse serviço e aprovar o texto dos outros serviços. Hoje: Pré e pós-eventos aparece sem a lista do que está incluído.
- **Passadoria combinada (+ R$ 55):** volta como opção no agendamento ou fica só com a Prime? Hoje: fora do agendamento.

### Pagamento, cupom e pacotes
- **Cupom de primeira contratação:** vale só para quem nunca teve contratação confirmada e o desconto é sobre a 1ª diária? O cupom soma com o desconto do pacote? Hoje: sim para a primeira pergunta; não soma, o cupom substitui o desconto.
- **Pacote com número ímpar de diárias:** em quantas diárias vence a 2ª metade? Hoje: num pacote de 5, a 2ª metade vence antes da 3ª diária.
- **Cancelamento de pacote com a 1ª metade paga:** a cliente recebe reembolso, fica com crédito ou outra regra? Hoje: o pacote inteiro é cancelado e o acerto é feito à mão.
- **Cancelar só parte de um pacote:** deve ser possível? Com qual regra? Hoje: só cancela o pacote inteiro.
- **Pacote com endereço novo:** a confirmação deve ficar travada até a Prime verificar o endereço? Hoje: o painel só avisa "verificar".
- **Estorno:** prazo e forma de devolução, quando houver. Hoje: em branco nas Condições do atendimento.
- **Hora extra:** limite de 4 horas por diária e pagamento em até 2 dias (14h). Está certo? Hoje: assim.

### Painel e equipe
- **Motivos de recusa e de cancelamento:** as listas abaixo servem? Recusa: sem disponibilidade na data ou no horário; endereço fora da área atendida; serviço que a Prime não realiza; endereço novo no pacote não aprovado; dados incompletos ou sem retorno da cliente; outro. Cancelamento: pedido da cliente; pagamento não identificado no prazo; sem profissional disponível; imprevisto no local (sem água, sem energia); outro.
- **Stand-by:** é a profissional que trabalha naquele dia da semana e está sem diária e sem folga? Ou ela mesma marca? Hoje: a primeira opção.
- **Aviso de diária para a profissional:** ela recebe na hora em que é designada ou só quando a escala é publicada? Hoje: nas duas vezes.
- **Adiantamento e Uber:** a profissional pede pelo app dela ou a Prime registra no painel? Hoje: a Prime registra.
- **Foto da profissional:** querem enviar foto? Hoje: o painel mostra as iniciais.
- **Meta do mês:** 10% acima do mês anterior está bom? Hoje: sim, e dá para mudar no painel.
- **Certidão de antecedentes:** vale por quantos dias? Hoje: 90 dias.
- **Repasse para a profissional:** qual a regra (percentual ou valor por carga horária, e a hora extra)? Hoje: desligado.
- **Profissionais atuais:** mandar a planilha no modelo e dizer como elas recebem o primeiro acesso.
- **Teste com alguém da equipe:** uma pessoa da Prime usar o painel com o manual e dizer o que não entendeu.

### Mensagens automáticas
- **Horários padrão:** lembrete da véspera às 18h (cliente) e 17h (profissional), prazo de pagamento 24h e 3h antes, sem mensagens das 20h às 8h. Está bom? Hoje: assim, e dá para mudar no painel.
- **Véspera de segunda e de dia depois de feriado:** mandar o lembrete no sábado? Hoje: não sai lembrete.
- **E-mail:** além do WhatsApp, a Prime quer avisos por e-mail? Para quais?
- **Avisos para a equipe:** só no painel ou também por WhatsApp ou e-mail da equipe? Se sim, qual número ou e-mail.
- **Textos das mensagens:** aprovar os textos das mensagens de WhatsApp antes de mandar para a Meta.

### Site e textos legais
- **Advogado:** revisar Termos e Condições do atendimento, Política de Privacidade e Termos de Uso (os três arquivos .docx na pasta, com o que falta em amarelo).
- **Regras antigas de cancelamento:** as regras que vieram do sistema antigo (retenção de 50% fora do prazo, multa de 30% em pacote, datas do pacote em 30 dias) continuam valendo?
- **Perguntas frequentes:** aprovar as 9 respostas da home.
- **Depoimentos:** 3 ou 4 depoimentos reais, com nome autorizado e serviço. Hoje: a seção fica escondida.
- **Fotos próprias:** fotos da equipe e de atendimentos reais. Hoje: o site não usa foto de banco de imagens.
- **Visual novo:** aprovar a direção visual com o PDF antes e depois.
- **Links antigos:** algum link do site antigo foi divulgado em anúncio ou no Instagram, além da página inicial e do autoagendamento?

### Clientes
- **113 clientes sem e-mail:** criar acesso para elas pelo CPF ou celular? Hoje: continuam sem acesso.
- **Senha das clientes novas:** mínimo de 8 caracteres ou os 6 primeiros números do CPF, como as antigas? Hoje: 8 caracteres.
- **Senha esquecida:** a Prime redefine pelo painel. Está bom? Hoje: assim.

## Precisa da Gabrielle (fica fora do documento da cliente)
- **Contas de produção:** em nome de quem ficam Cloudflare, Supabase (plano pago) e GitHub (GO-LIVE, passo 1).
- **SMTP próprio:** conta de envio com domínio verificado. Sem ela, confirmação de e-mail e "esqueci a senha" não saem.
- **Entrar com Google:** OAuth client no Google Cloud.
- **Turnstile e Web Analytics:** criar no painel da Cloudflare (precisa de login).
- **Desempenho do painel:** 84 a 88 no Lighthouse mobile (meta 90). A entrada do agendamento ficou em 80 (meta 85, pendência antiga). Decidir sobre bundler (ver "Acabamento" abaixo).
- **Auditoria B1 a B6 e HSTS:** baixas, ver a seção da auditoria.
- **Templates na Meta:** enviar para aprovação depois que a cliente aprovar os textos.

### Dívida técnica pós-lançamento (revisão de arquitetura, 26/10/2026)
Nada aqui muda o que a cliente vê hoje. Ficou de fora porque é grande ou arriscado pra véspera do lançamento.
- **Leitura anônima de `configuracao` por lista de exclusão** (`supabase/migrations/20260923200100_rls.sql:53` e `20261018120000_painel_v2_telas.sql:120`; apontado pelo Codex): toda chave nova nasce pública. Trocar por lista permitida. Mexe em RLS: migration nova com backup e `testa-rls`.
- **Dois sistemas de modal:** `div` com foco preso no painel novo (`painel2/componentes.js`) e `dialog` nativo no site e nas telas antigas. A aparência é a mesma; o código é separado. Unificar mexe em foco, Esc e vários testes de navegador.
- **Duas opções em cartão:** `.opcoes.cartoes .opcao` (`src/ui/form.js`, cadastro de profissional e avaliação) e `.card-escolha` (agendamento). Migrar o form.js muda o markup que os testes do cadastro usam.
- **Três estilos de tabela:** `.p-tabela` (painel novo), `table.painel` (seções antigas, agora em cartão no celular) e `.tabela` (biblioteca).
- **Seções antigas do painel** (`src/ui/paginas/painel-*.js`, cerca de 1720 linhas): reaproveitadas dentro das telas novas. Migrar uma a uma pros componentes do painel novo.
- **Desempenho:** o painel fica em 84 a 88 e a entrada do agendamento em 80 no Lighthouse mobile. O gargalo é a cascata de módulos sem bundler e o `await` de topo da tabela de preços. Um bundler só no `monta-dist` resolve a primeira parte.

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
- [x] ~~Logo branco cortado~~: resolvido com o kit do logo (21/10/2026, `assets/marca/logo-branco.svg` tirado do material da cliente). Texto antigo: o logo branco (`assets/logo-branco.svg`) está com "LIMPEZA ESPECIALIZAD" (sem o A final) no próprio arquivo; o colorido (`logo.svg`) está certo. Pedir o branco corrigido e rodar `node scripts/gera-og.mjs` de novo.

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

## Auditoria de segurança (30/09/2026): baixas, sem correção agora (detalhe em docs/AUDITORIA-2026-09-30.md)
- [ ] **B1, e-mail em uso no cadastro de profissional:** a tela diz "Já existe conta com este e-mail". Mitigado por Turnstile e 10 cadastros/IP/hora. Resposta igual pra todos só com SMTP próprio (avisar por e-mail).
- [ ] **B2, busca de clientes na URL:** o termo (pode ser CPF ou telefone) fica no histórico do navegador da equipe. Trocar a busca pra não ir na URL quando mexer no painel.
- [ ] **B3, CSP de estilo:** `style-src 'unsafe-inline'` por causa de `style=` nas telas. Script já é só por hash.
- [ ] **B4, worker com corpo gigante sem segredo:** a conexão do atacante fica pendurada até o gateway; o worker responde 401 sem ler.
- [ ] **B5, dependências de teste:** `npm audit` com 23 avisos (5 altos) em Lighthouse, exceljs e nodemailer, nada publicado. Quando o SMTP entrar em produção, usar o nodemailer atual na Edge Function.
- [ ] **B6, listar_documentos:** id inexistente devolve lista vazia em vez de erro (sem vazamento).
- [ ] **HSTS no go-live:** hoje sem `includeSubDomains`/`preload`. Conferir os subdomínios do domínio da Prime (e-mail, webmail) antes de ligar.

## Pré-lançamento (01/10/2026): parado pela metade
- [ ] **Teste de volume:** a otimização do painel entrou no acabamento (21/10/2026, migration `20261021100000_painel_volume`, aplicada no homolog com backup; teste `testa-painel-volume-homolog`). Falta medir com ~2 anos de dados sintéticos no projeto `prime-carga` (PAUSADO; scripts em `scripts/carga/`). Reativar o projeto precisa do painel do Supabase.
- [ ] **Documentos do pré-lançamento:** não começados.

## Painel v2, etapa A (01/10/2026)
- [ ] **Material da cliente:** `Prime_Limpeza/sistema-atual/` (prints do sistema antigo) e `Prime_Limpeza/referencia-isa/` (referência visual) ainda não existem. Quando chegarem: cruzar com `docs/painel-v2/auditoria.md` e ajustar a proposta antes da etapa B.
- [ ] **Aprovação da etapa A** (Gabs + opinião da Isa sobre `painel-atual.pdf` e `painel-proposta.pdf`) antes de qualquer linha da etapa B.
- [ ] **Seed local:** a diária de 8 h de hoje (Condomínio) ficou de fora do seed porque nenhuma profissional fictícia estava livre o dia inteiro; o protótipo mostra o cenário completo.

## Autoagendamento v3 (06/10/2026): depende da cliente
- [ ] **Tabela de duração:** confirmar a troca 80/120 por 70/110 m² (0.1) e os pesos de banheiro e cozinha (1,5) e a subida máxima de uma faixa pelos ambientes.
- [ ] **Empresarial:** a tabela 2 só cita residencial; o empresarial segue a do v2 (40/60/90/130 m²). Confirmar.
- [ ] **Vila da Serra:** informar a faixa de CEP (painel > Configurações). Até lá cai em Nova Lima (R$ 20).
- [ ] **Expediente de sábado:** informar se termina antes das 18:30 (configurável).
- [ ] **Feriados:** conferir a lista nacional, de MG e de BH de 2026 e 2027 (painel).
- [ ] **Sábado que é feriado:** hoje uma taxa só (R$ 20). Confirmar.
- [ ] **Cupom:** regra de primeira contratação (hoje: só quem não tem contratação confirmada; desconto sobre a 1ª diária) e se cupom acumula com o desconto do pacote (hoje: não, o cupom substitui).
- [ ] **Pacote com quantidade ímpar:** hoje o marco da 2ª parcela é a 3ª de 5 diárias (índice floor(n/2)). Confirmar; e a 2ª parcela sai 2 dias antes do vencimento (14h do dia útil anterior ao marco).
- [ ] **Cartão de crédito** (à vista e 2x no pacote): preparado atrás de flag, depende do Asaas (B4).
- [x] **Bateria de contrato no homolog (técnico):** as datas fixas de outubro de `scripts/cenarios.mjs` viravam passado no homolog (relógio real). Resolvido em 17/10/2026: `usarDatasRelativas()` escolhe a primeira segunda a partir de hoje + antecedência sem feriado em nenhuma data usada (dentro do horizonte de 120 dias, conferido pra cada dia de um ano em `testa-app`); o desconto do mês do pacote da empresa é conferido pela regra. Mock e fake-api seguem no relógio fixo de 01/10/2026.
- [ ] **"Ver mais" de cada serviço:** a lista do que NÃO está incluído foi separada por serviço a partir do item 52; o "O que está incluído" de Pré e Pós-Eventos continua sem texto da cliente. Revisar no painel (V6).
- [ ] **Sábado:** o rodapé do site já diz "Sábado 08:00 às 14:00". Se valer pro agendamento, configurar `fimExpedienteSabado = 14:00` (hoje o sábado usa 18:30).
- [ ] **Motivos de recusa:** as listas de recusa (6) e cancelamento (5) em `public.motivos_padrao()` são sugestão minha, fixas no banco (mudar = migration). Validar com a Isa.
- [ ] **Cancelamento parcial de pacote:** não entrou no v3 (fica como no v2: cancela o pedido inteiro). Definir a regra se a cliente quiser.
- [ ] **Meta:** reenviar pra aprovação `solicitacao_recebida` v2, `lembrete_prazo_pagamento` v2 e `cobranca_parcela2` antes do go-live.
- [ ] **Pacote com endereço novo:** o painel marca "Pacote com novo endereço · verificar". Confirmar se a Isa quer bloquear a confirmação até verificar.
- [ ] **Mock/demonstração (técnico):** a rotina da 2ª parcela só roda quando chamada (`rodarRotinaParcela2`); no Supabase é o cron.
- [ ] **Performance da entrada do agendamento (técnico):** 81 a 84 no Lighthouse mobile (meta da spec: 85). Causa: a tabela de preços vigente é buscada no Supabase em `await` de topo (`src/config/precos.js`) antes de qualquer tela desenhar. Proposta: desenhar a casca (cabeçalho e título) antes e esperar a tabela só onde ela é usada. Mexe em todas as páginas: PR separado.
- [ ] **Cancelamento de pacote com a 1ª metade paga:** hoje cancela também as diárias já cobertas pela 1ª metade (como o v2 fazia com as diárias pagas). Reembolso ou crédito: regra da cliente.

## Painel v2, etapa B (19/10/2026): depende da cliente
- [ ] **Escala publicada (D09):** hoje a profissional recebe a designação na hora (D04) e de novo quando a escala é publicada. Confirmar se a D04 deve esperar a publicação.
- [ ] **Adiantamento e Uber:** por enquanto a Prime registra o pedido no painel. Confirmar se a profissional deve pedir pelo app dela.
- [ ] **Foto da profissional:** o painel usa as iniciais (não há foto cadastrada). Confirmar se querem upload de foto.
- [ ] **Stand-by:** definido como "trabalha nesse dia da semana, sem diária e sem folga". Confirmar se é isso ou se a profissional marca o stand-by.
- [ ] **Meta:** +10% sobre o mês anterior por padrão (Gestão > Configurações > Motivos e meta).
- [ ] **Meta (WhatsApp):** aprovar os templates `escala_publicada`, `proposta_nova_data` e `pagamento_nao_identificado`.
- [ ] **Celular (técnico, B6):** o Início no celular ainda é longo (cada linha vira cartão com todos os campos).
- [ ] **Equipe e papéis em Gestão (técnico):** a spec cita; não entrou nesta etapa (papéis seguem pelo suporte técnico).
- [ ] **Performance do Início e da Agenda (técnico):** 85 no Lighthouse mobile, no limite da meta. Margem pequena.
- [ ] **Teste do novato com pessoa (cliente):** o automático mede caminho e cliques, não compreensão. Fazer uma rodada com alguém da equipe da Prime.


## Design system (19/10/2026): depende da cliente
- Aprovar a direção visual: fontes (Source Serif 4 nos títulos, Source Sans 3 no texto), marinho do logo, dourado só como acento e a home sem fotos. Para isso: a demonstração e o PDF `design-system-antes-depois.pdf` na pasta Prime_Limpeza.
- Fotos próprias da Prime (equipe, atendimento real, com luz natural). As 7 fotos de banco saíram da home; quando chegarem as próprias, entram numa seção só, sem virar fundo nem decoração.
- Depoimentos reais pra seção "O que nossos clientes dizem" (continua oculta sem eles).
- Revisar junto com o painel v2 (PR #8): o PR do design system está empilhado sobre ele.

## Acabamento (21/10/2026): precisa da Gabrielle
- Desempenho do painel no celular: 84 a 88 na demonstração (meta 90). O gargalo é a cascata de módulos sem bundler (ver DECISOES, "Desempenho do painel"). Decidir se entra um bundler (esbuild) só no `monta-dist`.
