#!/usr/bin/env bash
# Passo 4: segredos NOVOS de produção (pepper, worker, Turnstile). Gerados aqui, nunca copiados do homolog.
# O AUTH_PEPPER vai pro cofre da Prime: perder = ninguém entra (as senhas são HMAC com ele).
source "$(dirname "$0")/_comum.sh"
[ -n "${TURNSTILE_SECRET_PROD:-}" ] || { echo "Defina TURNSTILE_SECRET_PROD (widget criado no passo 11)."; exit 2; }
PEPPER=$(openssl rand -base64 48 | tr -d '\n')
passo "Secrets das functions (conta, documentos, notificacoes)"
sb secrets set --project-ref "$PROD_REF" AUTH_PEPPER="$PEPPER" TURNSTILE_SECRET="$TURNSTILE_SECRET_PROD"
echo "Guarde AGORA o AUTH_PEPPER no cofre (não é mostrado de novo). Depois: node scripts/configura-worker.mjs https://<domínio>/ com o ~/.prime-env de produção."
unset PEPPER
passo "Deploy das functions"
for f in conta documentos notificacoes whatsapp-webhook; do sb functions deploy "$f" --no-verify-jwt --project-ref "$PROD_REF"; done
