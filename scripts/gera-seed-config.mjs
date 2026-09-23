// Gera o SQL dos dados oficiais (tabela de preços, regiões, feriados) a partir de src/config/precos.js,
// pra o banco e o front partirem da MESMA fonte. Uso: node scripts/gera-seed-config.mjs > supabase/migrations/<ts>_dados_oficiais.sql
// O teste de paridade (testa-paridade.mjs) confere depois que o banco bate com o precos.js.
import { CONFIG_PRECOS } from '../src/config/precos.js';
import { PRIME as PIX_TESTE } from '../src/config/prime.teste.js';

const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** A parte da configuração que vira a linha versionada de public.precos (regiões e feriados têm tabela própria). */
export function tabelaDePrecos(cfg = CONFIG_PRECOS) {
  const { PRECOS, cobrancaRestante, prazoRestante, diasBloqueados, regrasCalendario, regrasNotificacao, regioesDiarista } = cfg;
  return { PRECOS, cobrancaRestante, prazoRestante, diasBloqueados, regrasCalendario, regrasNotificacao, regioesDiarista };
}

export function gerarSQL(cfg = CONFIG_PRECOS) {
  const l = [];
  l.push('-- GERADO por scripts/gera-seed-config.mjs a partir de src/config/precos.js. Não editar à mão.');
  l.push('-- Mudança de preço depois do go-live: nova linha em public.precos (vigente_desde), pela RPC da Prime.');
  l.push(`insert into public.precos (vigente_desde, tabela) values ('2026-01-01T00:00:00Z', ${lit(JSON.stringify(tabelaDePrecos(cfg)))}::jsonb);`);
  for (const r of cfg.regioesAtendidas) {
    l.push(`insert into public.regioes (cidade, uf, taxa_centavos, sob_consulta) values (${lit(r.cidade)}, ${lit(r.uf)}, ${r.sobConsulta ? 'null' : r.taxaCentavos}, ${Boolean(r.sobConsulta)});`);
  }
  for (const d of cfg.feriados) l.push(`insert into public.feriados (data, bloqueia) values (${lit(d)}, false);`);
  for (const d of cfg.datasBloqueadas) l.push(`insert into public.feriados (data, bloqueia) values (${lit(d)}, true) on conflict (data) do update set bloqueia = true;`);
  // Homologação: Pix FICTÍCIO (o mesmo de prime.teste.js). A chave real entra no go-live (PENDENCIAS).
  l.push(`insert into public.configuracao (chave, valor) values ('pix', ${lit(JSON.stringify({ ...PIX_TESTE.pix, ficticio: true }))}::jsonb);`);
  return `${l.join('\n')}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(gerarSQL());
