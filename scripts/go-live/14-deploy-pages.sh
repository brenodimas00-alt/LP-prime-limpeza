#!/usr/bin/env bash
# Passo 14 (roda ANTES da virada do DNS, ver docs/GO-LIVE.md): deploy de produção do Pages (branch main do projeto
# prime-limpeza) com o ambiente de PRODUÇÃO. O site fica em https://prime-limpeza.pages.dev até o domínio apontar pra ele.
# Exige o ~/.prime-env de produção: PRIME_AMBIENTE=producao, SUPABASE_URL do PROD_REF e a chave de site real do Turnstile
# (o gera-ambiente recusa a de teste). O projeto Pages é de upload direto: merge na main NÃO publica sozinho.
source "$(dirname "$0")/_comum.sh"
exige_env_producao
[ "$(git branch --show-current)" = "main" ] && [ -z "$(git status --porcelain)" ] || { echo "Publique a partir da main, sem mudança local (nem arquivo novo). Parado."; exit 2; }
passo "Build com o ambiente de produção"
node scripts/gera-ambiente.mjs && node scripts/monta-dist.mjs && node scripts/varre-segredos.mjs dist
read -r -p "Publicar a main ($(git rev-parse --short HEAD)) em prime-limpeza.pages.dev? (digite PUBLICAR) " r; [ "$r" = "PUBLICAR" ] || exit 1
bash scripts/cli.sh wrangler pages deploy dist --project-name prime-limpeza --branch main --commit-hash "$(git rev-parse HEAD)" --commit-message "produção $(git rev-parse --short HEAD)"
echo "Confira: node scripts/confere-config.mjs --url https://prime-limpeza.pages.dev/"
