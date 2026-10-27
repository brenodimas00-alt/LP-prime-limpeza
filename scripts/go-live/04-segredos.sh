#!/usr/bin/env bash
# Passo 4: segredos NOVOS de produção (pepper, Turnstile, chaves das functions e PRODUCAO_REF). Gerados aqui, nunca copiados
# do homolog. O AUTH_PEPPER fica no ~/.prime-env de produção (600; a importação do passo 5 deriva as senhas com ele) e
# deve ir também pro cofre da Prime: perder = ninguém entra (as senhas são HMAC com ele). Não se troca depois de importar.
source "$(dirname "$0")/_comum.sh"
exige_env_producao
[ -n "${TURNSTILE_SECRET_PROD:-}" ] || { echo "Defina TURNSTILE_SECRET_PROD (widget do Turnstile, docs/GO-LIVE.md seção 8)."; exit 2; }
[ -z "${AUTH_PEPPER:-}" ] || { echo "O $ENVF já tem AUTH_PEPPER: o pepper não se troca (as senhas importadas deixariam de valer). Parado."; exit 2; }
read -r -p "Gravar os segredos de produção no projeto $PROD_REF? (digite SEGREDOS) " r; [ "$r" = "SEGREDOS" ] || exit 1
umask 077
PEPPER=$(openssl rand -base64 48 | tr -d '\n')
printf "AUTH_PEPPER='%s'\n" "$PEPPER" >> "$ENVF"
passo "Secrets das functions (conta, documentos, notificacoes) por arquivo temporário (nada na linha de comando)"
# PRODUCAO_REF = o ref do próprio projeto: é o que libera envio real (supabase/functions/_shared/provedores.js). WhatsApp e
# e-mail continuam simulados até os segredos de cada canal (passos 6 e 9).
tmp="$(mktemp "$HOME/.prime-dados/segredos-XXXXXX")"; trap 'rm -f "$tmp"' EXIT
printf 'AUTH_PEPPER=%s\nTURNSTILE_SECRET=%s\nPRODUCAO_REF=%s\nPRIME_PUBLISHABLE_KEY=%s\nPRIME_SECRET_KEY=%s\n' "$PEPPER" "$TURNSTILE_SECRET_PROD" "$PROD_REF" "$SUPABASE_PUBLISHABLE_KEY" "$SUPABASE_SECRET_KEY" > "$tmp"
sb secrets set --project-ref "$PROD_REF" --env-file "$tmp"
unset PEPPER
echo "AUTH_PEPPER gravado no $ENVF (600). Copie AGORA pro cofre da Prime. Depois: bash scripts/cli.sh node22 scripts/configura-worker.mjs https://primelimpezaespecializada.com.br/"
passo "Deploy das functions"
for f in conta documentos notificacoes whatsapp-webhook; do sb functions deploy "$f" --no-verify-jwt --project-ref "$PROD_REF"; done
