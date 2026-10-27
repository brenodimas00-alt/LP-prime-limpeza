#!/usr/bin/env bash
# Restauração de um backup de scripts/backup.sh no projeto do ambiente (~/.prime-env ou PRIME_ENV=<arquivo>), o mesmo
# procedimento ensaiado em scripts/ensaio-restauracao-local.mjs: carga com os gatilhos desligados (parando no primeiro
# erro) e, depois, cada sequência sobe pro maior id existente (o dump volta as sequências pro momento do backup).
# Restaura POR CIMA: o que já existe fica (ON CONFLICT DO NOTHING); o que sumiu volta. Pede confirmação digitada.
# Uso: cd ~/projetos/LP-prime-limpeza && bash scripts/restaura.sh ~/.prime-dados/backup-<ref>-<data>.sql
set -euo pipefail
cd "$(dirname "$0")/.."
arq="${1:?uso: bash scripts/restaura.sh <arquivo de backup>}"
[ -f "$arq" ] || { echo "Arquivo não encontrado: $arq"; exit 2; }
ENVF="${PRIME_ENV:-$HOME/.prime-env}"
set -a; . "$ENVF"; set +a
# pg_dump/psql num contêiner postgres:17. Banco LOCAL do ensaio (SUPABASE_DB_URL_LOCAL, só 127.0.0.1) ou o pooler do projeto.
pg() {
  local prog="$1"; shift
  if [ -n "${SUPABASE_DB_URL_LOCAL:-}" ]; then
    case "$SUPABASE_DB_URL_LOCAL" in postgresql://*@127.0.0.1:*|postgresql://*@localhost:*) ;; *) echo "SUPABASE_DB_URL_LOCAL só aceita 127.0.0.1"; exit 2 ;; esac
    docker run --rm -i --network host postgres:17 "$prog" "$SUPABASE_DB_URL_LOCAL" "$@"
  else
    docker run --rm -i -e PGPASSWORD="$SUPABASE_DB_PASSWORD" -e PGSSLMODE=require postgres:17 "$prog" -h aws-0-sa-east-1.pooler.supabase.com -p 5432 -U "postgres.${SUPABASE_PROJECT_REF}" -d postgres "$@"
  fi
}
echo "Restaurar $(basename "$arq") no projeto ${SUPABASE_PROJECT_REF}?"
read -r -p "Digite o ref do projeto pra confirmar: " r; [ "$r" = "$SUPABASE_PROJECT_REF" ] || { echo "Cancelado."; exit 1; }
psql_() { pg psql -v ON_ERROR_STOP=1 -q "$@"; }
psql_ -c 'SET session_replication_role = replica' -f - < "$arq"
psql_ -f - < scripts/sql/ajusta-sequencias.sql
echo "Restaurado. Rode node scripts/confere-config.mjs e os testes de preview."
