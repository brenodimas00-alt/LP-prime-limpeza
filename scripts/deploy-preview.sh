#!/usr/bin/env bash
# Deploy de PREVIEW (homologação) no Cloudflare Pages, projeto prime-limpeza, alias = branch atual.
# Produção (branch main / domínio) fica fora: é o go-live.
# Uso: cd ~/projetos/LP-prime-limpeza && bash scripts/deploy-preview.sh
set -euo pipefail
cd "$(dirname "$0")/.."
PROJETO=prime-limpeza
wr() { bash scripts/cli.sh wrangler "$@"; }

branch="$(git branch --show-current)"
[ -n "$branch" ] || { echo "HEAD destacado: faça checkout da branch de trabalho." >&2; exit 2; }
alias_branch="$(printf '%s' "$branch" | tr '/_.' '---' | tr 'A-Z' 'a-z')"
# compara DEPOIS de normalizar: "Main" viraria o alias da produção
case "$alias_branch" in main|master|production) echo "Branch $branch vira alias de produção: preview só em branch de trabalho." >&2; exit 2 ;; esac

node scripts/gera-ambiente.mjs
node scripts/monta-dist.mjs
node scripts/varre-segredos.mjs dist

if ! wr whoami > /dev/null 2>&1; then
  echo 'BLOQUEADO: Wrangler sem sessão. Rode: wsl -e bash -lc "cd ~/projetos/LP-prime-limpeza && npx -y wrangler login"' >&2; exit 3
fi
lista="$(wr pages project list 2>/dev/null)" || { echo "Falha ao listar projetos do Pages (rede ou sessão). Nada publicado." >&2; exit 4; }
if ! printf '%s' "$lista" | grep -q "│ ${PROJETO} "; then
  # --force: cria no Pages clássico; sem ele o wrangler 4.13x delega pro "Pages em Workers" e falha. Só na criação.
  wr pages project create "$PROJETO" --production-branch main --force
fi
wr pages deploy dist --project-name "$PROJETO" --branch "$alias_branch" --commit-hash "$(git rev-parse HEAD)" --commit-message "$(git log -1 --format=%s | cut -c1-100)" --commit-dirty=true
echo "Alias estável da branch: https://${alias_branch}.${PROJETO}.pages.dev"
