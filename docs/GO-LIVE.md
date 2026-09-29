# Go-live: o que falta pra produção

(Documento vivo; o D1 completa. Itens já decididos nos turnos anteriores.)

## Base de clientes (B7)
- Criar o projeto Supabase de produção (plano pago), aplicar as migrations (`supabase db push`) e a function `conta` com os segredos (`PRIME_SECRET_KEY`, `PRIME_PUBLISHABLE_KEY`, `AUTH_PEPPER` NOVO de produção).
- Importar a base no projeto de produção com o MESMO script, apontando o `~/.prime-env` pro projeto de produção: primeiro `bash scripts/cli.sh node22 scripts/importa-clientes.mjs` (simulação, conferir as contagens), depois `--importar`, depois rodar de novo pra conferir que não cria nada.
- A base de homologação tem os mesmos clientes reais: depois do go-live, decidir se apaga a homologação ou troca por dados fictícios.
- Backup antes e depois da importação (em produção, pelo plano pago; `scripts/backup-homolog.sh` serve de modelo).

## Auth
- SMTP próprio (confirmação de cadastro e recuperação de senha).
- Google OAuth (client do Google Cloud) se a Prime quiser.
- Guardar o `AUTH_PEPPER` de produção em cofre: perder = ninguém entra.

## Notificações (B5)
- Pôr o ref do projeto de produção em `PRODUCAO_REFS` (`supabase/functions/_shared/provedores.js`). Sem isso o provedor continua `simulado` (travado no código de propósito).
- Secrets da function `notificacoes`: `PROVEDOR_NOTIFICACOES=meta_cloud`, `META_PHONE_NUMBER_ID`, `META_TOKEN` (token permanente de usuário do sistema), e `scripts/configura-worker.mjs https://<domínio>/` (gera `WORKER_SEGREDO` próprio de produção, `URL_SITE` e o Vault).
- Templates aprovados na Meta com os nomes do catálogo (`src/automacoes/catalogo.js`, docs/WHATSAPP.md); versão editada no painel = `<codigo>_v<n>`, aprovar antes de usar.
- E-mail: `EMAIL_HABILITADO = true` em `provedores.js` só com remetente verificado (`EMAIL_REMETENTE`, `EMAIL_CHAVE`).
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
- Pôr o ref de produção em `PRODUCAO_REFS` (`supabase/functions/_shared/provedores.js`); sem isso WhatsApp e e-mail continuam simulados.
- Secrets da `notificacoes`: `PROVEDOR_WHATSAPP=meta_cloud`, `META_PHONE_NUMBER_ID`, `META_TOKEN` (token permanente), e `scripts/configura-worker.mjs https://<domínio>/`. E-mail: remetente verificado, `EMAIL_HABILITADO = true`, `EMAIL_CHAVE`/`EMAIL_REMETENTE` (ou SMTP).
- Webhook: secrets `WHATSAPP_VERIFY_TOKEN` e `WHATSAPP_APP_SECRET`, deploy `whatsapp-webhook --no-verify-jwt`, cadastrar a URL `https://<ref>.supabase.co/functions/v1/whatsapp-webhook` no app da Meta (campos `messages`), testar a verificação.
- Contato de teste do painel: trocar o fictício por um número da equipe (`configurar_automacoes`).
- Conferir no painel o que ligar antes da virada (M01-M03 nascem desligadas e exigem consentimento).
