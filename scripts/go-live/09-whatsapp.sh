#!/usr/bin/env bash
# Passo 9: WhatsApp oficial (Meta Cloud API) com os templates aprovados (docs/WHATSAPP.md).
source "$(dirname "$0")/_comum.sh"
[ -n "${META_TOKEN_PROD:-}" ] && [ -n "${META_PHONE_ID_PROD:-}" ] || { echo "Defina META_TOKEN_PROD e META_PHONE_ID_PROD."; exit 2; }
echo "Confira: todos os templates de docs/WHATSAPP.md aprovados na Meta; PRODUCAO_REFS com \"$PROD_REF\" em supabase/functions/_shared/provedores.js (commit e deploy)."
read -r -p "Tudo aprovado? (digite LIGAR) " r; [ "$r" = "LIGAR" ] || exit 1
sb secrets set --project-ref "$PROD_REF" PROVEDOR_WHATSAPP=meta_cloud META_TOKEN="$META_TOKEN_PROD" META_PHONE_NUMBER_ID="$META_PHONE_ID_PROD"
echo "Webhook: WHATSAPP_VERIFY_TOKEN e WHATSAPP_APP_SECRET nos secrets e a URL https://$PROD_REF.supabase.co/functions/v1/whatsapp-webhook no app da Meta."
