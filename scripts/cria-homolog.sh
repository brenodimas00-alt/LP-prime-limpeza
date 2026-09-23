#!/usr/bin/env bash
# Cria (ou completa) o projeto Supabase prime-homolog em sa-east-1, só na org da Prime, e linka o repo.
# Idempotente: se o projeto já existe, só completa o ~/.prime-env e o link. Não imprime segredo.
# Uso: cd ~/projetos/LP-prime-limpeza && bash scripts/cria-homolog.sh
set -euo pipefail
cd "$(dirname "$0")/.."
ORG=ucfrebowewgwcfvebczk   # Prime-Limpeza. Proibido usar outra org (spec, seção 3).
NOME=prime-homolog
REGIAO=sa-east-1
ENVF="$HOME/.prime-env"
sb() { bash scripts/cli.sh supabase "$@"; }

umask 077
touch "$ENVF"; chmod 600 "$ENVF"
le() { grep -E "^$1=" "$ENVF" | tail -1 | cut -d= -f2- | sed "s/^'//; s/'$//" || true; }
grava() { # grava/substitui KEY='valor' sem ecoar
  local k="$1" v="$2"; local tmp; tmp="$(mktemp)"
  grep -vE "^$k=" "$ENVF" > "$tmp" || true
  printf "%s='%s'\n" "$k" "$v" >> "$tmp"; mv "$tmp" "$ENVF"; chmod 600 "$ENVF"
}

# 1. A sessão só pode enxergar a org da Prime como destino.
sb orgs list --output json 2>/dev/null | node -e "
const j=JSON.parse(require('fs').readFileSync(0,'utf8'));const o=Array.isArray(j)?j:(j.organizations||[]);
if(!o.some(x=>x.id==='$ORG')){console.error('Org $ORG não encontrada na sessão. BLOQUEADO: rode npx -y supabase login');process.exit(3)}"

# 2. Projeto existente nessa org?
ref="$(sb projects list --output json 2>/dev/null | node -e "
const l=JSON.parse(require('fs').readFileSync(0,'utf8')||'[]');
const p=l.find(x=>x.name==='$NOME'&&x.organization_id==='$ORG');process.stdout.write(p?p.id:'')")"

if [ -z "$ref" ]; then
  # senha gravada ANTES da criação: se algo falhar no meio, não se perde
  if [ -z "$(le SUPABASE_DB_PASSWORD)" ]; then
    grava SUPABASE_DB_PASSWORD "$(openssl rand -base64 36 | tr -d '/+=\n' | cut -c1-40)"
  fi
  echo "Criando $NOME em $REGIAO na org $ORG..."
  sb projects create "$NOME" --org-id "$ORG" --region "$REGIAO" --db-password "$(le SUPABASE_DB_PASSWORD)" --output json > /dev/null
  ref="$(sb projects list --output json 2>/dev/null | node -e "
const l=JSON.parse(require('fs').readFileSync(0,'utf8')||'[]');
const p=l.find(x=>x.name==='$NOME'&&x.organization_id==='$ORG');process.stdout.write(p?p.id:'')")"
  [ -n "$ref" ] || { echo "Projeto criado mas não apareceu na lista." >&2; exit 4; }
elif [ -z "$(le SUPABASE_DB_PASSWORD)" ]; then
  echo "O projeto $NOME já existe mas ~/.prime-env não tem a senha do banco." >&2
  echo "Não troco a senha sozinho. Redefina no painel do Supabase (Database > Settings) e grave SUPABASE_DB_PASSWORD='...' em ~/.prime-env." >&2
  exit 5
fi
grava SUPABASE_PROJECT_REF "$ref"
grava SUPABASE_URL "https://$ref.supabase.co"

# 3. Espera o projeto ficar saudável (criação leva alguns minutos).
for i in $(seq 1 60); do
  st="$(sb projects list --output json 2>/dev/null | node -e "
const l=JSON.parse(require('fs').readFileSync(0,'utf8')||'[]');process.stdout.write((l.find(x=>x.id==='$ref')||{}).status||'')")"
  [ "$st" = "ACTIVE_HEALTHY" ] && break
  echo "status: ${st:-?} (aguardando)"; sleep 10
done
[ "$st" = "ACTIVE_HEALTHY" ] || { echo "Projeto não ficou ACTIVE_HEALTHY a tempo; rode de novo." >&2; exit 6; }

# 4. Chave PÚBLICA (publishable; anon legada se não houver). A secreta nunca sai daqui.
chave="$(sb projects api-keys --project-ref "$ref" --output json 2>/dev/null | node -e "
const l=JSON.parse(require('fs').readFileSync(0,'utf8')||'[]');
const pub=l.find(k=>k.type==='publishable')||l.find(k=>k.name==='anon');
process.stdout.write(pub?pub.api_key:'')")"
[ -n "$chave" ] || { echo "Não achei a chave pública do projeto." >&2; exit 7; }
case "$chave" in sb_secret_*) echo "Chave recusada: é secreta." >&2; exit 8 ;; esac
grava SUPABASE_PUBLISHABLE_KEY "$chave"

# 5. Link do repo com o projeto.
SUPABASE_DB_PASSWORD="$(le SUPABASE_DB_PASSWORD)" sb link --project-ref "$ref" > /dev/null
echo "OK: $NOME ($ref) em $REGIAO, linkado. Variáveis em ~/.prime-env (600)."
