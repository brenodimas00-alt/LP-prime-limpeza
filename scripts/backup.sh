#!/usr/bin/env bash
# Backup dos DADOS (schemas public e auth) do projeto do ambiente (~/.prime-env, ou PRIME_ENV=<arquivo>): homologação ou
# produção. Formato do ensaio de restauração (scripts/ensaio-restauracao-local.mjs): INSERT com ON CONFLICT DO NOTHING,
# sem a tabela interna de versões do Auth, então restaura por cima de um banco novo (que já tem a configuração das
# migrations) sem duplicar. Com --storage, copia também os arquivos dos buckets (documentos das profissionais e fotos de
# ocorrência), que não ficam no banco; exige o projeto do ambiente linkado (supabase link).
# Vai pra ~/.prime-dados (700), arquivo 600. Nunca no repo. pg_dump roda num contêiner postgres:17 (não precisa instalar).
# O pg_dump avisa de chave estrangeira circular (pedidos, condicoes_comerciais, enderecos): esperado, a restauração carrega
# com os gatilhos desligados (session_replication_role = replica), como o ensaio prova.
# Uso: cd ~/projetos/LP-prime-limpeza && bash scripts/backup.sh [--storage]
set -euo pipefail
cd "$(dirname "$0")/.."
ENVF="${PRIME_ENV:-$HOME/.prime-env}"
set -a; . "$ENVF"; set +a
if [ -n "${SUPABASE_DB_URL_LOCAL:-}" ]; then # banco local do ensaio: só 127.0.0.1/localhost, conferido antes de tudo
  host="${SUPABASE_DB_URL_LOCAL#*@}"; host="${host%%[:/]*}"
  [ "$host" = "127.0.0.1" ] || [ "$host" = "localhost" ] || { echo "SUPABASE_DB_URL_LOCAL só aceita 127.0.0.1" >&2; exit 2; }
fi
# pg_dump/psql num contêiner postgres:17. Banco LOCAL do ensaio (SUPABASE_DB_URL_LOCAL, só 127.0.0.1) ou o pooler do projeto.
pg() {
  local prog="$1"; shift
  if [ -n "${SUPABASE_DB_URL_LOCAL:-}" ]; then
    docker run --rm -i --network host postgres:17 "$prog" "$SUPABASE_DB_URL_LOCAL" "$@"
  else
    docker run --rm -i -e PGPASSWORD="$SUPABASE_DB_PASSWORD" -e PGSSLMODE=require postgres:17 "$prog" -h aws-0-sa-east-1.pooler.supabase.com -p 5432 -U "postgres.${SUPABASE_PROJECT_REF}" -d postgres "$@"
  fi
}
[ -n "${SUPABASE_PROJECT_REF:-}" ] && { [ -n "${SUPABASE_DB_PASSWORD:-}" ] || [ -n "${SUPABASE_DB_URL_LOCAL:-}" ]; } || { echo "Falta SUPABASE_PROJECT_REF ou SUPABASE_DB_PASSWORD em $ENVF."; exit 2; }
umask 077
mkdir -p "$HOME/.prime-dados"; chmod 700 "$HOME/.prime-dados"
destino="$HOME/.prime-dados/backup-${SUPABASE_PROJECT_REF}-$(date +%Y%m%d-%H%M%S).sql"
# senha só pela variável de ambiente do contêiner (não aparece na linha de comando)
pg pg_dump --data-only --inserts --on-conflict-do-nothing --schema=public --schema=auth --exclude-table-data=auth.schema_migrations > "$destino"
chmod 600 "$destino"
grep -q '^INSERT INTO' "$destino" || { echo "Backup sem dados: confira o arquivo $destino"; exit 1; }
echo "Backup: $(basename "$destino") ($(du -h "$destino" | cut -f1), $(grep -c '^INSERT INTO' "$destino") linhas), em ~/.prime-dados. Restaurar: bash scripts/restaura.sh <arquivo>."

if [ "${1:-}" = "--storage" ]; then
  linkado="$(cat supabase/.temp/project-ref 2>/dev/null || true)"
  [ "$linkado" = "$SUPABASE_PROJECT_REF" ] || { echo "Storage: o projeto linkado ($linkado) não é o do ambiente. Rode supabase link --project-ref $SUPABASE_PROJECT_REF."; exit 2; }
  pasta="${destino%.sql}-storage"; mkdir -p "$pasta"
  for b in documentos-diaristas ocorrencias; do
    bash scripts/cli.sh supabase storage cp -r "ss:///$b" "$pasta/" --experimental --linked > /dev/null 2>&1 || { echo "Storage: falhou ao copiar $b"; exit 1; }
  done
  chmod -R go-rwx "$pasta"
  echo "Storage: $(find "$pasta" -type f | wc -l) arquivos em ~/.prime-dados/$(basename "$pasta"). Restaurar: supabase storage cp -r <pasta>/<bucket> ss:///<bucket> --experimental --linked."
fi
