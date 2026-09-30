#!/usr/bin/env bash
# Passo 7: domínio. ANTES de mexer no DNS, ver onde está o e-mail da Prime (MX): mudar os servidores de nome sem copiar o MX derruba o e-mail.
source "$(dirname "$0")/_comum.sh"
D=primelimpezaespecializada.com.br
passo "Registros atuais (guarde a saída)"
for t in NS MX TXT A AAAA CNAME; do echo "-- $t"; dig +short "$t" "$D"; done
echo "-- www"; dig +short CNAME "www.$D"
echo
echo "Depois: adicionar o domínio no projeto Pages prime-limpeza (Custom domains), copiar TODOS os registros de e-mail (MX, SPF, DKIM, DMARC) pra Cloudflare,"
echo "Redirect Rule www -> sem www (301, com query) e Always Use HTTPS. A virada em si é o passo 12."
