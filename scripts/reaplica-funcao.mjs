// Desenvolvimento: reaplica no HOMOLOG as funções de uma migration ainda sem commit (depois de corrigi-las no arquivo),
// pro banco bater com o arquivo. Uso: bash scripts/cli.sh node22 scripts/reaplica-funcao.mjs <migration.sql> <nome da função>...
import { readFileSync } from 'node:fs';
import { sql, fecharSql } from './lib-supabase.mjs';

const [arq, ...nomes] = process.argv.slice(2);
const texto = readFileSync(arq, 'utf8');
for (const nome of nomes) {
  const i = texto.indexOf(`create or replace function ${nome}(`);
  if (i < 0) throw new Error(`função não achada: ${nome}`);
  const fimPlpgsql = texto.indexOf('end $$;', i); const fimSql = texto.indexOf('\n$$;', i);
  const fim = [fimPlpgsql < 0 ? Infinity : fimPlpgsql + 'end $$;'.length, fimSql < 0 ? Infinity : fimSql + '\n$$;'.length].sort((a, b) => a - b)[0];
  await sql(texto.slice(i, fim));
  console.log(`reaplicada: ${nome}`);
}
await fecharSql();
