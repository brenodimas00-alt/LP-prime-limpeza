#!/usr/bin/env bash
# CLIs pinadas. Uso: bash scripts/cli.sh supabase <args> | bash scripts/cli.sh wrangler <args>
# Wrangler 4.9x+ exige Node 22 e o WSL tem Node 20: o node@22 vem pelo npx, só pra ele.
set -euo pipefail
SUPABASE_VERSAO=2.117.0
WRANGLER_VERSAO=4.137.0
qual="${1:?uso: cli.sh supabase|wrangler ...}"; shift
case "$qual" in
  supabase) exec npx -y "supabase@${SUPABASE_VERSAO}" "$@" ;;
  wrangler) exec npx -y -p node@22 -p "wrangler@${WRANGLER_VERSAO}" -- wrangler "$@" ;;
  *) echo "CLI desconhecida: $qual" >&2; exit 2 ;;
esac
