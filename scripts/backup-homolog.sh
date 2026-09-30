#!/usr/bin/env bash
# Backup dos DADOS do prime-homolog (tem clientes reais desde o B7). O plano free não oferece backup pra baixar.
# Vai pra ~/.prime-dados (700), arquivo 600. Nunca no repo. Uso: cd ~/projetos/LP-prime-limpeza && bash scripts/backup-homolog.sh
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . "$HOME/.prime-env"; set +a
umask 077
mkdir -p "$HOME/.prime-dados"; chmod 700 "$HOME/.prime-dados"
destino="$HOME/.prime-dados/backup-homolog-$(date +%Y%m%d-%H%M%S).sql"
bash scripts/cli.sh supabase db dump --linked --data-only --schema public,auth -f "$destino" > /dev/null
chmod 600 "$destino"
# O1: a "Saúde do sistema" do painel mostra o último backup (só tamanho e nome do arquivo, nada do conteúdo)
bash scripts/cli.sh node22 scripts/registra-backup.mjs "$(stat -c %s "$destino")" "~/.prime-dados/$(basename "$destino")" > /dev/null || echo "aviso: backup feito, mas não registrado no banco"
echo "Backup: $(basename "$destino") ($(du -h "$destino" | cut -f1)), em ~/.prime-dados. Restaurar: psql com a URL do banco < arquivo (ver docs/GO-LIVE.md)."
