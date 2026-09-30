#!/usr/bin/env bash
# Passo 11: Turnstile e Web Analytics de produção (painel da Cloudflare).
source "$(dirname "$0")/_comum.sh"
echo "Turnstile > Add widget (domínio de produção, Managed): Site Key em TURNSTILE_SITEKEY no ~/.prime-env de produção; Secret Key vai no passo 4."
echo "Web Analytics > Add a site: token em WEB_ANALYTICS_TOKEN no ~/.prime-env de produção."
echo "Depois: deploy de produção do Pages (o monta-dist libera a CSP da Web Analytics sozinho quando houver o token)."
