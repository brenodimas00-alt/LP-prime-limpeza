// O1: registra no banco que um backup foi feito (tamanho e onde), pra "Saúde do sistema" mostrar o último.
// Chamado por scripts/backup-homolog.sh. Uso: bash scripts/cli.sh node22 scripts/registra-backup.mjs <bytes> <destino>
import { sql, fecharSql } from './lib-supabase.mjs';
await sql('select public.registrar_backup($1, $2)', [Number(process.argv[2]) || null, String(process.argv[3] || '').slice(0, 120)]);
await fecharSql();
