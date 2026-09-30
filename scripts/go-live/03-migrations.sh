#!/usr/bin/env bash
# Passo 3: migrations no projeto de produção (backup antes, mesmo vazio, pra ter o ponto de partida).
source "$(dirname "$0")/_comum.sh"
passo "Ligando o repo ao projeto de produção"
sb link --project-ref "$PROD_REF"
passo "Conferindo o que vai subir"
sb db push --dry-run
read -r -p "Aplicar essas migrations em PRODUÇÃO? (digite APLICAR) " r; [ "$r" = "APLICAR" ] || exit 1
sb db push
passo "Config do Auth (hooks, URLs): confira o diff antes"
sb config push --project-ref "$PROD_REF"
