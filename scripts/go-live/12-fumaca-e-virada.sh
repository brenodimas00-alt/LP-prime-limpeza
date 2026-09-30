#!/usr/bin/env bash
# Passo 12: teste de fumaça no endereço de produção e a virada (em horário de pouco movimento; sugestão: domingo à noite, a Prime não atende).
source "$(dirname "$0")/_comum.sh"
URL="${URL_PROD:?defina URL_PROD, ex. https://primelimpezaespecializada.com.br/}"
passo "Fumaça (só leitura)"
for p in "" autoagendamento/ entrar/ painel/entrar/ condicoes/ privacidade/ termos/ sitemap.xml robots.txt; do
  printf '%-22s %s\n' "/$p" "$(curl -s -o /dev/null -w '%{http_code}' "$URL$p")"
done
curl -sI "$URL" | grep -i 'content-security-policy' >/dev/null && echo "CSP ok" || echo "CSP AUSENTE"
echo "Manual: entrar como a admin da cliente, fazer uma solicitação fictícia (e cancelar), conferir a mensagem no painel (Automações)."
echo "Virada: apontar o domínio pro Pages (passo 7). Plano de volta: docs/GO-LIVE.md, 'Voltar atrás'."
