#!/usr/bin/env bash
# Passo 6: SMTP próprio (confirmação e recuperação de senha) com domínio verificado. Sem ele o Supabase manda 2 e-mails/hora.
source "$(dirname "$0")/_comum.sh"
echo "1) Conta de envio (Resend, SES...) com o domínio verificado (SPF/DKIM no DNS)."
echo "2) supabase/config.toml, [auth.email.smtp]: host, porta, usuário, remetente; a senha como env SMTP_SENHA."
echo "3) bash scripts/cli.sh supabase config push --project-ref \$PROD_REF (conferir o diff)."
echo "4) E-mail das automações: EMAIL_HABILITADO = true em supabase/functions/_shared/provedores.js + EMAIL_CHAVE/EMAIL_REMETENTE."
