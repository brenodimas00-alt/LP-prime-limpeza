# Go-live: roteiro de virada

Roteiro de 27/10/2026 (turno pré-lançamento). Cada passo tem responsável, comando e conferência. Tempos são **ESTIMATIVA** (não medidos). Comandos rodam a partir de `cd ~/projetos/LP-prime-limpeza`. Os scripts `scripts/go-live/NN-*.sh` param sem `GO_LIVE=sim` e `PROD_REF=<ref de produção>`, recusam o ref de homologação e pedem confirmação digitada antes do que muda algo (`node scripts/testa-go-live.mjs` confere as travas).

A conferência de qualquer ambiente, antes e depois da virada, é obrigatória e não mostra segredo:
`cd ~/projetos/LP-prime-limpeza && node scripts/confere-config.mjs [--env <arquivo>] [--url https://site/]`
Ela diz, serviço por serviço, LIGADO, DESLIGADO, MAL CONFIGURADO (sai com erro) ou PRESENTE (o nome existe, mas o valor não é validável daqui).

## 1. Serviços: o que liga cada um (sem mexer em código)

| Serviço | Variável ou segredo | Onde fica | Formato | Quem fornece | Desligado (hoje) | Ligado |
|---|---|---|---|---|---|---|
| Banco e site | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, `PRIME_AMBIENTE=producao` | `~/.prime-env` de produção (fora do repo) | URL `https://<ref>.supabase.co`; chave pública `sb_publishable_...`; `PRIME_AMBIENTE` só `producao` | Gabrielle (projeto pago da Prime) | O site usa o homolog | O site usa o banco de produção |
| Functions | `AUTH_PEPPER`, `PRIME_PUBLISHABLE_KEY`, `PRIME_SECRET_KEY` | Segredos do Supabase (`supabase secrets set`) | Pepper aleatório de 48 bytes (passo 4) | Gabrielle | Ninguém entra | Login e cadastro |
| Envio real de mensagens | `PRODUCAO_REF` | Segredos do Supabase | O ref do próprio projeto | Gabrielle (passo 4) | Tudo simulado (registrado, não enviado). O homolog nunca envia, nem com o segredo | Cada canal liga pelo seu segredo |
| WhatsApp oficial | `PROVEDOR_WHATSAPP=meta_cloud`, `META_PHONE_NUMBER_ID`, `META_TOKEN`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` | Segredos do Supabase | Token permanente de usuário do sistema da Meta | Prime (Meta Business com o CNPJ), Gabrielle (templates) | Mensagens simuladas. A equipe avisa pelo botão de WhatsApp manual do painel. Cliente e profissional não recebem aviso automático | Cobrança, lembretes e avisos saem sozinhos |
| E-mail das notificações | `EMAIL_PROVEDOR=api`, `EMAIL_CHAVE`, `EMAIL_REMETENTE` | Segredos do Supabase | API no formato do Resend; remetente do domínio verificado | Gabrielle (conta no provedor), Prime (DNS) | E-mails simulados; os avisos seguem pelo WhatsApp e pelo painel | Avisos também por e-mail |
| E-mail do login (SMTP) | `SMTP_HOST`, `SMTP_PORTA`, `SMTP_USUARIO`, `SMTP_SENHA`, `SMTP_REMETENTE`, `SMTP_NOME` | `~/.prime-env` de produção, aplicado com `node scripts/configura-smtp.mjs --aplicar` | Porta 465 ou 587 | Gabrielle (provedor), Prime (DNS) | "Esqueci a senha" só entrega pra equipe do projeto. A cliente pede à Prime, que redefine no painel. O cadastro não depende de e-mail (a conta nasce confirmada) | "Esqueci a senha" chega pra cliente |
| Turnstile | `TURNSTILE_SITEKEY` (site) e `TURNSTILE_SECRET` (backend), mais a flag `p7_turnstile` | `~/.prime-env` (site) e segredos do Supabase (backend); flag no painel, em Configurações | Chave de site `0x...` | Gabrielle (seção 8) | Com a flag desligada: honeypot e limite por IP. Com a flag ligada e sem segredo, login, solicitação e cadastro de profissional param (a function fecha por segurança) | Caixinha anti-robô nos 3 formulários |
| Web Analytics | `WEB_ANALYTICS_TOKEN` | `~/.prime-env` de produção (vai no build) | Token do snippet da Cloudflare | Gabrielle (seção 8) | Nenhum script de análise carrega | Visitas por página, sem cookie |
| Automações (worker) | `WORKER_SEGREDO`, `URL_SITE` | `~/.prime-env`, segredos do Supabase e Vault do banco (`node scripts/configura-worker.mjs https://<domínio>/`) | URL com barra final | Gabrielle | Nenhuma mensagem é processada | Fila processada a cada minuto |
| Pix | `pix.chave`, `nomeRecebedor`, `cidadeRecebedor` | `src/config/prime.js` (dado da empresa, não segredo) | Até 25 e 15 caracteres | Prime | Sem QR; a página manda pedir os dados no WhatsApp | QR e copia e cola com o identificador |
| Pix automático e cartão (Asaas previsto) | Não existe | A montar depois do lançamento (seção 10) | | Prime (conta no CNPJ e definições de cobrança) | A Prime cobra como hoje e confirma no painel; cartão aparece "Em breve" | Ver a seção 10 |
| Domínio | DNS e domínio personalizado do Pages | Cloudflare (depois da troca dos servidores) | | Prime (login do registro.br e da Hostinger), Gabrielle | Site antigo na Hostinger | Site novo; e-mail continua na Hostinger |

O build de produção recusa a chave de TESTE do Turnstile quando `PRIME_AMBIENTE=producao` (`scripts/gera-ambiente.mjs`). Com o segredo real no backend, a chave de teste faria todo login ser recusado.

## 1b. Lançamento com a cobrança de hoje (decisão de 27/10/2026)
O site vai pro domínio com o agendamento recebendo as solicitações normalmente e a Prime cobrando como já faz hoje. O Pix automático entra logo em seguida, depois das definições de cobrança da cliente (tema "Cobrança pelo Pix automático" no `pendencias-cliente.docx`).
- **Quando a Prime aprova a solicitação:** o sistema cria a cobrança (integral, ou a 1ª metade do pacote). A mensagem de cobrança fica registrada e só sai sozinha com o WhatsApp oficial ligado.
- **Sem o WhatsApp oficial:** a equipe manda a cobrança pelo botão de WhatsApp manual do painel ou como faz hoje.
- **Com a chave Pix preenchida** em `src/config/prime.js`: a página de pagamento mostra o QR e o copia e cola da chave da Prime. Sem a chave, pede os dados no WhatsApp.
- **A cliente** pode tocar em "Já paguei". O pagamento aparece em "Precisa de você" e no Financeiro.
- **A equipe** confere no extrato e clica em "Confirmar recebimento". A diária fica confirmada e o recibo em PDF fica disponível.
- **Nada disso depende do Asaas.** É o caminho que os testes de pagamento já cobrem: "Já paguei" e confirmação em `testa-e4-navegador`, `testa-b3` e `testa-f2-preview` (no preview real), e o painel em `testa-e6-navegador`.

## 2. Antes: o que precisa ter chegado da cliente
1. Razão social, CNPJ, endereço com CEP, e-mail e o encarregado de dados. Vão em `src/config/prime.js`, `src/config/seo.js` e nas 3 páginas legais.
2. Chave Pix, recebedor e cidade, e a regra de estorno.
3. Número do WhatsApp do botão e acesso ao Meta Business (pra ligar o envio automático; o lançamento pode ser sem).
4. Login do registro.br e da Hostinger, ou alguém que entre no dia, e a conta paga do Supabase.
5. Planilhas atualizadas de clientes e profissionais, no formato das já importadas.

## 3. Preparação (dias antes; o site atual não muda)

| # | Passo | Responsável | Comando e conferência | Tempo (ESTIMATIVA) |
|---|---|---|---|---|
| P1 | Turnstile e Web Analytics (seção 8) | Gabrielle | Chaves no `~/.prime-env` de produção | 15 min |
| P2 | Projeto Supabase de produção (Pro, backup diário) | Gabrielle, com o cartão da Prime | `SENHA_BANCO_PROD='<senha>' GO_LIVE=sim PROD_REF=novo bash scripts/go-live/02-supabase-producao.sh` e depois Pro e backups no painel | 30 min |
| P3 | `~/.prime-env` de produção | Gabrielle | Guardar o do homolog (ex.: `cp ~/.prime-env ~/.prime-env.homolog`) e criar o novo, com `PRIME_AMBIENTE=producao` e as chaves do P1. Conferir: `node scripts/confere-config.mjs` | 15 min |
| P4 | Dados da empresa e nova versão legal | Gabrielle | PR com `prime.js`, `seo.js`, páginas legais, migration em `documentos_legais` e `VERSAO_LEGAL`; `node scripts/gera-seo.mjs && node scripts/verifica-seo.mjs` | 1 h |
| P5 | Migrations e Auth | Gabrielle | `GO_LIVE=sim PROD_REF=<ref> bash scripts/go-live/03-migrations.sh`. Ensaiado no banco local: `node scripts/ensaio-producao-local.mjs` | 20 min |
| P6 | Segredos e functions | Gabrielle | `TURNSTILE_SECRET_PROD='<secret>' GO_LIVE=sim PROD_REF=<ref> bash scripts/go-live/04-segredos.sh`, depois `bash scripts/cli.sh node22 scripts/configura-worker.mjs https://primelimpezaespecializada.com.br/` | 30 min |
| P7 | Importação da base | Gabrielle | `GO_LIVE=sim PROD_REF=<ref> bash scripts/go-live/05-importacao.sh`: backup, simulação, conferência das contagens, importação, rodada de novo (não cria nada), admin da cliente, backup | 1 h |
| P8 | SMTP do login (se já houver provedor) | Gabrielle | `node scripts/configura-smtp.mjs` (confere) e `--aplicar` | 30 min, mais a verificação do domínio no provedor |
| P9 | Deploy de produção no `pages.dev` | Gabrielle | `GO_LIVE=sim PROD_REF=<ref> bash scripts/go-live/14-deploy-pages.sh` (a partir da main) | 15 min |
| P10 | Fumaça no `pages.dev` | Gabrielle | `node scripts/confere-config.mjs --url https://prime-limpeza.pages.dev/`; testes de preview contra ele (seção 5); uma solicitação fictícia pela admin da cliente, depois cancelada | 1 h |
| P11 | Zona espelho na Cloudflare (seção 7, fase A) | Gabrielle, com a Prime no registro.br | Copiar a zona inteira, inclusive o e-mail, e trocar os servidores no registro.br. O site e o e-mail continuam na Hostinger | 1 h, mais até 48 h de propagação dos servidores |

## 4. Durante: a virada (domingo à noite; a Prime não atende)
1. **Gabrielle (5 min):** `node scripts/confere-config.mjs --url https://prime-limpeza.pages.dev/` sem nada mal configurado e `bash scripts/backup.sh --storage`.
2. **Gabrielle (10 min):** no projeto Pages `prime-limpeza`, Custom domains: adicionar `primelimpezaespecializada.com.br` e `www.primelimpezaespecializada.com.br`. Na zona da Cloudflare, os dois CNAMEs da Hostinger (seção 7) são trocados pelos do Pages, com proxy ligado.
3. **Gabrielle (5 min):** Redirect Rule `www.primelimpezaespecializada.com.br/*` > `https://primelimpezaespecializada.com.br/${1}` (301, com a query) e Always Use HTTPS.
4. **Gabrielle (15 min):** `GO_LIVE=sim PROD_REF=<ref> URL_PROD=https://primelimpezaespecializada.com.br/ bash scripts/go-live/12-fumaca-e-virada.sh` e `node scripts/testa-redirects.mjs https://primelimpezaespecializada.com.br/`.
5. **Gabrielle (5 min):** confirmar que o e-mail da Prime ainda chega (mandar um e-mail de fora e ver na caixa da Prime).

## 5. Depois
- **Na hora:**
  - `node scripts/confere-config.mjs --url https://primelimpezaespecializada.com.br/`;
  - os testes de preview contra o domínio, todos aceitam a URL: `for t in testa-b0-preview testa-b2-preview testa-f2-preview testa-i1-preview testa-q1-preview testa-aut-preview testa-bloco3-preview testa-auditoria-preview testa-v3-preview; do bash scripts/cli.sh node22 scripts/$t.mjs https://primelimpezaespecializada.com.br/; done`.
  - Os testes de preview criam contas e pedidos fictícios (`teste-*@example.com`, `ficticio=true`) e apagam no fim. Mensagens a esses contatos fictícios não chegam a ninguém, mas, com o WhatsApp oficial ligado, rode antes de ligar o canal ou confira a fila no painel.
- **Primeiras 24 h (de hora em hora no começo):**
  - `bash scripts/go-live/13-monitoramento-48h.sh`;
  - painel em Gestão: saúde do sistema, fila de automações e falhas;
  - Search Console: enviar o `sitemap.xml`.

## 6. Volta atrás (alvo: menos de 10 minutos)
- **Site:**
  - Na zona da Cloudflare, tirar os domínios personalizados do Pages.
  - Recriar os dois CNAMEs da Hostinger: `primelimpezaespecializada.com.br` > `primelimpezaespecializada.com.br.cdn.hstgr.net` e `www` > `www.primelimpezaespecializada.com.br.cdn.hstgr.net`, sem proxy, TTL Auto.
  - Com a zona já na Cloudflare, a mudança vale em minutos. Isso é ESTIMATIVA: depende do cache dos resolvedores (hoje o TTL desses registros é 60 s) e não foi ensaiado.
  - O e-mail não é afetado, porque os registros dele nunca mudam.
- **Dados:** o banco de produção é novo e o site antigo tem o próprio banco na Hostinger, então nada se perde no site antigo. Solicitações feitas no site novo durante a janela ficam no banco de produção (aparecem no painel e entram no `backup.sh`); a Prime atende essas pelo painel ou pelo WhatsApp.
- **Mensagens:** `bash scripts/cli.sh supabase secrets unset PRODUCAO_REF --project-ref <ref>` devolve tudo pro modo simulado.
- **Banco:** `bash scripts/restaura.sh ~/.prime-dados/backup-<ref>-<data>.sql` restaura por cima (ensaiado só no banco local: `node scripts/ensaio-restauracao-local.mjs`). Arquivos do Storage: `bash scripts/cli.sh supabase storage cp -r <pasta>/<bucket> ss:///<bucket> --experimental --linked`. Não verificado.

## 7. DNS: o que muda e o que não pode mudar
Consulta pública feita em 27/10/2026 (DNS sobre HTTPS da Cloudflare):
- **Servidores de nome:** `solar.dns-parking.com` e `lunar.dns-parking.com` (Hostinger).
- **Não podem mudar** (e-mail da Prime na Hostinger):
  - MX `mx1.hostinger.com` (prioridade 5) e `mx2.hostinger.com` (10);
  - TXT `v=spf1 include:_spf.mail.hostinger.com ~all`;
  - TXT `_dmarc` `v=DMARC1; p=none`;
  - CNAMEs `hostingermail-a._domainkey`, `hostingermail-b._domainkey` e `hostingermail-c._domainkey` > `hostingermail-{a,b,c}.dkim.mail.hostinger.com`;
  - CNAMEs `autodiscover` > `autodiscover.mail.hostinger.com` e `autoconfig` > `autoconfig.mail.hostinger.com`.
  - Não há CAA.
- **Outros nomes não verificados:** a consulta pública não lista todos os nomes da zona. Antes da fase A, exporte a zona inteira no painel da Hostinger e compare.
- **Mudam na virada:** só `primelimpezaespecializada.com.br` (hoje CDN da Hostinger, `...cdn.hstgr.net`, IPs que variam) e `www` (CNAME `www.primelimpezaespecializada.com.br.cdn.hstgr.net`).
- **Fase A (dias antes, sem mudança visível):**
  1. Criar a zona na Cloudflare.
  2. Copiar todos os registros, com os dois nomes do site como CNAME pra CDN da Hostinger, sem proxy.
  3. Conferir registro por registro.
  4. Trocar os servidores de nome no registro.br.
  5. Esperar a propagação, até 48 h (ESTIMATIVA).
- **Fase B (a virada):** trocar só os dois nomes do site, dentro da Cloudflare (seção 4). A volta atrás também fica dentro da Cloudflare.
- **E-mail transacional futuro:** o provedor (Resend, SES ou outro) vai pedir registros próprios. Exemplos de forma (os valores reais vêm do painel do provedor; nada aqui é valor de verdade):
  - SPF: acrescentar o `include:` do provedor ao TXT que já existe (um SPF só por domínio);
  - DKIM: CNAME ou TXT em `<seletor>._domainkey`;
  - DMARC: o `_dmarc` já existe.

## 8. Turnstile e Web Analytics (chaves que são da Gabrielle)
A sessão do wrangler não tem as permissões pra criar isso por API: `wrangler whoami` mostra `challenge-widgets.write` faltando, e renovar pede `wrangler login`, que é interativo. Então é pelo painel da Cloudflare, na conta do Pages:
1. **Turnstile:**
   - Clique em Turnstile > Add widget.
   - Nome: Prime Limpeza.
   - Domínios: `primelimpezaespecializada.com.br` e `prime-limpeza.pages.dev`.
   - Modo: Managed. Clique em Create.
2. Copie a **Site Key** para o `~/.prime-env` de produção, numa linha `TURNSTILE_SITEKEY='<site key>'`.
3. A **Secret Key** vai no passo P6, como `TURNSTILE_SECRET_PROD='<secret key>'` na frente do comando. Não guarde em arquivo do repo.
4. **Web Analytics:** clique em Analytics & Logs > Web Analytics > Add a site, com o domínio `primelimpezaespecializada.com.br`. Copie o token do snippet para o `~/.prime-env` de produção, numa linha `WEB_ANALYTICS_TOKEN='<token>'`.
5. Confira: `cd ~/projetos/LP-prime-limpeza && node scripts/confere-config.mjs --env ~/.prime-env`.

## 9. Backup e restauração
- **Backup** (homolog ou produção, pelo ambiente): `bash scripts/backup.sh --storage`.
  - Grava o banco em `~/.prime-dados/backup-<ref>-<data>.sql`, com public e auth, INSERT com ON CONFLICT DO NOTHING, sem a tabela interna do Auth.
  - Com `--storage`, grava também os buckets `documentos-diaristas` e `ocorrencias`.
  - Testado em 27/10: homolog com 135 MB e 41 arquivos.
- **Restauração:** `bash scripts/restaura.sh <arquivo>`. Carga numa transação só: se falhar, nada fica pela metade.
  - Pede o ref digitado.
  - Carrega com os gatilhos desligados e depois sobe cada sequência pro maior id (`scripts/sql/ajusta-sequencias.sql`).
  - Ensaiada no banco local pelos próprios scripts: 2 clientes fictícios, apagados, restaurados para 2. Também pelo `scripts/ensaio-restauracao-local.mjs`, que confere o login da cliente restaurada.
  - Nunca rodada contra projeto remoto.
- **Rede de segurança:** o plano Pro guarda backup diário por 7 dias ([supabase.com/pricing](https://supabase.com/pricing)).

## 10. Pix automático (Asaas): o que falta pra existir (logo depois do lançamento)
Não há integração com o Asaas no código. O que existe:
- as colunas `asaas_id` e `asaas_invoice_url` em `pagamentos`;
- o cartão desabilitado atrás de `PAGAMENTO_CARTAO`;
- a confirmação manual que o webhook chamaria como sistema.

Não há conta sandbox configurada (nenhuma variável do Asaas no `~/.prime-env`). Pra construir, falta decidir:
- se a cobrança Pix passa a ser do Asaas ou continua o Pix da chave da Prime;
- o cartão à vista e em 2x no pacote (`docs/PENDENCIAS.md`);
- quem paga as taxas;
- a segunda parcela do pacote;
- o comprovante.

Construir e testar em sandbox é uma etapa própria, depois dessas respostas. As perguntas foram pra cliente no tema "Cobrança pelo Pix automático" do `pendencias-cliente.docx`.

## 11. Ensaios feitos em 27/10/2026 (sem custo, sem tocar no homolog além de leitura)
- `node scripts/ensaio-producao-local.mjs` (Supabase local, descartável):
  - 62 de 62 migrations;
  - RLS em todas as tabelas do public;
  - zero dado pessoal;
  - configuração inicial presente (preços 4, regiões 9, feriados 30, motivos 11, flags 13, automações 41, templates 89);
  - anônimo barrado em clientes e no painel e liberado no conteúdo público do agendamento.
- **Contra esse banco novo**, com as functions servidas no local: `testa-rls` 12/12, `testa-paridade-v3` 8/8 e `testa-importacao` 12/12 (inclui o modo ensaio pelo comando real, sem gravar).
- `node scripts/ensaio-restauracao-local.mjs`: backup, desastre, restauração, segunda restauração sem duplicar, cadastro novo depois sem colisão de sequência e login da cliente restaurada (7/7, duas rodadas seguidas).
- `node scripts/confere-config.mjs` no homolog: só o endereço raiz do `pages.dev` fora do Auth (corrigido no `supabase/config.toml`; aplicar no homolog com `supabase config push` pede ok da Gabrielle).
- URLs do site antigo levantadas de novo (`docs/urls-antigas.txt`): as mesmas de 28/09; `testa-redirects` 5/5 em `prime-limpeza.pages.dev`.

---

# Detalhes por assunto (turnos anteriores)

## Base de clientes (B7)
- Criar o projeto Supabase de produção (plano pago), aplicar as migrations (`supabase db push`) e a function `conta` com os segredos (`PRIME_SECRET_KEY`, `PRIME_PUBLISHABLE_KEY`, `AUTH_PEPPER` NOVO de produção).
- Importar a base no projeto de produção com o MESMO script, apontando o `~/.prime-env` pro projeto de produção: primeiro `bash scripts/cli.sh node22 scripts/importa-clientes.mjs` (simulação, conferir as contagens), depois `--importar`, depois rodar de novo pra conferir que não cria nada.
- A base de homologação tem os mesmos clientes reais: depois do go-live, decidir se apaga a homologação ou troca por dados fictícios.
- Backup antes e depois da importação: `bash scripts/backup.sh --storage` (passo 5 já chama).

## Auth
- SMTP próprio (confirmação de cadastro e recuperação de senha).
- Google OAuth (client do Google Cloud) se a Prime quiser.
- Guardar o `AUTH_PEPPER` de produção em cofre: perder = ninguém entra.

## Notificações (B5)
- O segredo `PRODUCAO_REF` (o ref do próprio projeto) libera o envio real; sem ele o provedor continua `simulado`. O homolog nunca envia, nem com o segredo (`HOMOLOG_REFS` em `supabase/functions/_shared/provedores.js`).
- Secrets da function `notificacoes`: `PROVEDOR_WHATSAPP=meta_cloud`, `META_PHONE_NUMBER_ID`, `META_TOKEN` (token permanente de usuário do sistema), e `scripts/configura-worker.mjs https://<domínio>/` (gera `WORKER_SEGREDO` próprio de produção, `URL_SITE` e o Vault).
- Templates aprovados na Meta com os nomes do catálogo (`src/automacoes/catalogo.js`, docs/WHATSAPP.md); versão editada no painel = `<codigo>_v<n>`, aprovar antes de usar.
- E-mail: segredo `EMAIL_PROVEDOR=api` só com remetente verificado (`EMAIL_REMETENTE`, `EMAIL_CHAVE`).
- Horários do cron estão em UTC (21h = 18h de Brasília, 12h = 9h), valendo enquanto o Brasil não tiver horário de verão.

## SEO e redirecionamentos (fase 2, S1 e S2)
- Domínio canônico: `DOMINIO` em `src/config/seo.js` (hoje `https://primelimpezaespecializada.com.br`, sem www). Se a cliente preferir www, trocar ali, rodar `node scripts/gera-seo.mjs` e `node scripts/verifica-seo.mjs`.
- www e http: o site antigo responde nos dois hosts. `_redirects` do Pages só casa caminho, não host: criar na Cloudflare uma Redirect Rule `www.primelimpezaespecializada.com.br/*` -> `https://primelimpezaespecializada.com.br/${1}` (301, preservando a query) e ligar "Always Use HTTPS".
- `_redirects` (URLs antigas -> novas) já vai no deploy e passa a valer sozinho quando o domínio apontar pro Pages. Antes de virar o DNS: `node scripts/levanta-urls-antigas.mjs` de novo (o site antigo pode ter ganhado página) e, depois da virada, `node scripts/testa-redirects.mjs https://primelimpezaespecializada.com.br/`.
- Preencher em `src/config/seo.js` razão social, CNPJ, e-mail e endereço (o JSON-LD omite o que está `PREENCHER`) e rodar `gera-seo`.
- Enviar o `sitemap.xml` no Google Search Console (propriedade de domínio, verificação por DNS) e pedir a inspeção da home.
- O preview (`*.pages.dev`) continua com `X-Robots-Tag: noindex`; em produção só as páginas de sistema ficam fora (robots.txt + noindex).

## Legal e LGPD (fase 2, L1)
- Preencher os `PREENCHER` das páginas `privacidade/` e `termos/` (razão social, CNPJ, endereço, encarregado, política de cancelamento e estorno) e passar as duas por advogado.
- Mudou o texto de forma relevante: nova linha em `documentos_legais` (migration nova) e `VERSAO_LEGAL` em `src/config/legal.js` com a mesma data; `verifica-seo` confere as duas. Quem já tem conta aceita de novo no próximo acesso.
- Quando entrarem Asaas e WhatsApp oficial, atualizar a lista de operadores da Política de Privacidade (hoje citados como "no futuro").

## Admin da cliente (fase 2, A0)
- Produção: criar o admin da cliente com `bash scripts/cli.sh node22 scripts/a0-admin-cliente.mjs <email>` apontando o `~/.prime-env` pro projeto de produção (senha temporária só no terminal, troca obrigatória no primeiro acesso). O e-mail não pode ser de conta de cliente ou profissional (o script aborta).

## Automações (fase 2, AUT)
- Segredo `PRODUCAO_REF` posto no passo 4; sem ele WhatsApp e e-mail continuam simulados.
- Secrets da `notificacoes`: `PROVEDOR_WHATSAPP=meta_cloud`, `META_PHONE_NUMBER_ID`, `META_TOKEN` (token permanente), e `scripts/configura-worker.mjs https://<domínio>/`. E-mail: remetente verificado, `EMAIL_PROVEDOR=api`, `EMAIL_CHAVE`/`EMAIL_REMETENTE`.
- Webhook: secrets `WHATSAPP_VERIFY_TOKEN` e `WHATSAPP_APP_SECRET`, deploy `whatsapp-webhook --no-verify-jwt`, cadastrar a URL `https://<ref>.supabase.co/functions/v1/whatsapp-webhook` no app da Meta (campos `messages`), testar a verificação.
- Contato de teste do painel: trocar o fictício por um número da equipe (`configurar_automacoes`).
- Conferir no painel o que ligar antes da virada (M01-M03 nascem desligadas e exigem consentimento).
