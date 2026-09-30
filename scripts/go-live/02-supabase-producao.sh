#!/usr/bin/env bash
# Passo 2: projeto Supabase de produção na org Prime-Limpeza, sa-east-1. Depois: plano pago e backup diário (PITR se couber) no painel.
source "$(dirname "$0")/_comum.sh"
passo "Criando o projeto (a senha do banco vem de SENHA_BANCO_PROD, fora do repo)"
[ -n "${SENHA_BANCO_PROD:-}" ] || { echo "Defina SENHA_BANCO_PROD."; exit 2; }
sb projects create prime-producao --org-id "$ORG_PRIME" --region sa-east-1 --db-password "$SENHA_BANCO_PROD"
echo "Anote o ref novo, ponha em PROD_REF e ative plano pago + backups no painel antes do passo 3."
