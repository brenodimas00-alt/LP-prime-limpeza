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
