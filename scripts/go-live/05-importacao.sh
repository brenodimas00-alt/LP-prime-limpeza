#!/usr/bin/env bash
# Passo 5: base de clientes e profissionais no projeto de produção (planilhas em ~/.prime-dados; ~/.prime-env apontando pra produção).
source "$(dirname "$0")/_comum.sh"
passo "Backup antes"; bash scripts/backup-homolog.sh
passo "Clientes: simulação"; bash scripts/cli.sh node22 scripts/importa-clientes.mjs
read -r -p "As contagens batem com a planilha? (digite IMPORTAR) " r; [ "$r" = "IMPORTAR" ] || exit 1
bash scripts/cli.sh node22 scripts/importa-clientes.mjs --importar
bash scripts/cli.sh node22 scripts/importa-clientes.mjs   # de novo: não pode criar nada
passo "Profissionais: simulação e importação"
bash scripts/cli.sh node22 scripts/importa-profissionais.mjs
read -r -p "Importar profissionais? (digite IMPORTAR) " r; [ "$r" = "IMPORTAR" ] || exit 1
bash scripts/cli.sh node22 scripts/importa-profissionais.mjs --importar
passo "Admin da cliente (senha temporária só no terminal)"; echo "bash scripts/cli.sh node22 scripts/a0-admin-cliente.mjs <email>  e depois, se for o mesmo e-mail de cliente, scripts/unifica-contas.mjs"
passo "Backup depois"; bash scripts/backup-homolog.sh
