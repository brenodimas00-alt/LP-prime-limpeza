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
# Passos que gravam no projeto pelo ~/.prime-env (4, 5, 14): o arquivo tem que ser o de PRODUÇÃO e do PROD_REF.
exige_env_producao() {
  ENVF="${PRIME_ENV:-$HOME/.prime-env}"
  set -a; . "$ENVF"; set +a
  [ "${PRIME_AMBIENTE:-}" = "producao" ] || { echo "O $ENVF não é de produção (falta PRIME_AMBIENTE=producao). Parado."; exit 2; }
  local ref_url="${SUPABASE_URL#https://}"; ref_url="${ref_url%%.*}"
  [ "${SUPABASE_PROJECT_REF:-}" = "$PROD_REF" ] && [ "$ref_url" = "$PROD_REF" ] || { echo "O $ENVF aponta pra outro projeto (SUPABASE_PROJECT_REF ou SUPABASE_URL diferente do PROD_REF). Parado."; exit 2; }
}
