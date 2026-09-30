#!/usr/bin/env bash
# Passo 13: as 48 horas depois da virada. Mostra o que olhar; rode de hora em hora no primeiro dia.
source "$(dirname "$0")/_comum.sh"
echo "Painel > Visão geral > Saúde do sistema: worker funcionando, fila atrasada 0, falhas de envio e erros novos."
echo "Painel > Automações: mensagens saindo (não mais simuladas) e entregues."
echo "Search Console: erros de rastreamento e as URLs antigas redirecionando."
echo "Backups diários aparecendo no painel do Supabase."
