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
- [ ] **Empresa exige frequência** (não existe empresa avulso).
- [ ] **Turnos:** manhã 8h às 12h, tarde 13h às 17h, integral 8h às 17h.
- [ ] **Entrada de pedido cancelado:** se nenhuma diária foi realizada, a entrada ainda não confirmada é cancelada. Entrada já paga: reembolso é processo manual da Prime (não implementado).
- [ ] **Confirmação de parcela do dia:** a Prime só confirma parcela de diária que já começou (diarista a caminho em diante).

## Operação
- [ ] **Diarista com duas diárias no mesmo dia:** bloqueado no mesmo período (manhã com manhã, tarde com tarde, integral com qualquer). Manhã + tarde no mesmo dia é permitido. A disponibilidade cadastrada (dias/regiões) ainda NÃO é checada na atribuição: confirmar se deve bloquear ou só avisar.

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

### A0. Admin da cliente: BLOQUEADA (decisão)
- [ ] **O e-mail pedido pra administração (o da Isa) já é de uma CLIENTE da base importada**, com conta de acesso. Um usuário tem um papel só: promover essa conta a admin tiraria a área de cliente dela e misturaria os acessos. O script `a0-admin-cliente.mjs` aborta nesse caso. Opções: (1) usar o mesmo Gmail com `+prime` (ex.: `nome+prime@gmail.com`, chega na mesma caixa), recomendado; (2) outro e-mail; (3) converter a conta de cliente em admin (ela perde a área de cliente). Com a resposta: `bash scripts/cli.sh node22 scripts/a0-admin-cliente.mjs <email>`.
- [ ] Enquanto isso: a conta antiga `isa.admin@prime-homolog.example` foi apagada pelo reset da demonstração do teste I1 (tinha a marca de demonstração). A de demonstração agora é `admin.demo@prime-homolog.example`, com a mesma senha que a Isa usava (`DEMO_SENHA_ADMIN` no `~/.prime-env`).

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
