#!/usr/bin/env bash
# Passo 8: URLs antigas e SEO (antes da virada).
source "$(dirname "$0")/_comum.sh"
passo "Levantar de novo as URLs do site antigo"; node scripts/levanta-urls-antigas.mjs
passo "SEO com os dados da empresa preenchidos em src/config/seo.js"; node scripts/gera-seo.mjs && node scripts/verifica-seo.mjs
echo "Depois da virada: node scripts/testa-redirects.mjs https://$(grep -o 'primelimpezaespecializada.com.br' src/config/seo.js | head -1)/ e enviar o sitemap no Search Console."
