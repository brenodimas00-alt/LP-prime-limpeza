#!/usr/bin/env bash
# Passo 1: decidir em nome de quem ficam Cloudflare, Supabase e GitHub (antes de criar qualquer coisa de produção).
source "$(dirname "$0")/_comum.sh"
passo "Confirme com a Prime e a Gabrielle, por escrito:"
echo " - Cloudflare (Pages, DNS, Turnstile, Web Analytics): conta da Prime ou da Gabrielle?"
echo " - Supabase de produção: org Prime-Limpeza ($ORG_PRIME), plano pago, cartão da Prime?"
echo " - GitHub: repo brenodimas00-alt/LP-prime-limpeza continua com o Breno?"
echo "Nada foi alterado."
