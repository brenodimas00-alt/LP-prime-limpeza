# Trava comum dos passos do go-live (docs/GO-LIVE.md). Nenhum passo roda sem:
#  GO_LIVE=sim             (confirmação explícita de quem está virando)
#  PROD_REF=<ref>          (projeto Supabase de PRODUÇÃO; nunca o de homologação)
# e todos param no primeiro erro. Uso: source "$(dirname "$0")/_comum.sh"
set -euo pipefail
cd "$(dirname "$0")/../.."
HOMOLOG_REF=dkafhwekgvwjttbsfxvu
ORG_PRIME=ucfrebowewgwcfvebczk
[ "${GO_LIVE:-}" = "sim" ] || { echo "Passo do go-live. Leia docs/GO-LIVE.md e rode com GO_LIVE=sim PROD_REF=<ref de produção>."; exit 2; }
[ -n "${PROD_REF:-}" ] || { echo "Falta PROD_REF (ref do projeto de produção)."; exit 2; }
[ "$PROD_REF" != "$HOMOLOG_REF" ] || { echo "PROD_REF é o projeto de homologação. Parado."; exit 2; }
sb() { bash scripts/cli.sh supabase "$@"; }
passo() { printf '\n== %s\n' "$1"; }
