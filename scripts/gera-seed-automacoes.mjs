// AUT: gera o SQL da semente de automacao_regras e templates a partir de src/automacoes/catalogo.js.
// Usado UMA vez pra escrever a migration 20260929100000 (migration aplicada não se edita); depois, mudanças do
// catálogo entram por migration nova ou pelo painel. testa-aut-homolog confere que o banco nasceu igual ao catálogo.
// Uso: node scripts/gera-seed-automacoes.mjs > /tmp/seed.sql
import { REGRAS, TEMPLATES, VARIAVEIS_PERMITIDAS } from '../src/automacoes/catalogo.js';

const lit = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const arr = (a) => `array[${a.map(lit).join(', ')}]::text[]`;
const j = (o) => `${lit(JSON.stringify(o))}::jsonb`;

export function sqlSemente() {
  const l = ['-- semente gerada por scripts/gera-seed-automacoes.mjs a partir de src/automacoes/catalogo.js'];
  for (const [codigo, t] of Object.entries(TEMPLATES)) {
    const canais = t.categoriaMeta ? ['whatsapp', 'email'] : ['painel'];
    for (const canal of canais) {
      l.push(`insert into public.templates (codigo, canal, versao, corpo, assunto, variaveis_permitidas, variaveis_obrigatorias, categoria_meta, ativo) values (${lit(codigo)}, ${lit(canal)}, 1, ${lit(t.corpo)}, ${lit(canal === 'email' ? t.assunto : null)}, ${arr(VARIAVEIS_PERMITIDAS[codigo])}, ${arr(t.variaveis)}, ${lit(canal === 'whatsapp' ? t.categoriaMeta : null)}, true);`);
    }
  }
  for (const r of REGRAS) {
    l.push(`insert into public.automacao_regras (codigo, template_codigo, descricao, categoria, destinatario, canais_ordem, gatilho, atraso, condicoes, cancelamento, entidade, marco, do_dia, validade_min, ligada) values (${lit(r.codigo)}, ${lit(r.template)}, ${lit(r.descricao)}, ${lit(r.categoria)}, ${lit(r.destinatario)}, ${arr(r.canais)}, ${j(r.gatilho)}, ${j(r.atraso)}, ${j(r.condicoes || {})}, ${arr(r.cancelamento || [])}, ${lit(r.entidade)}, ${lit(r.marco || null)}, ${r.doDia ? 'true' : 'false'}, ${r.validadeMin ?? 'null'}, ${r.ligada ? 'true' : 'false'});`);
  }
  return l.join('\n');
}

if (process.argv[1] === new URL(import.meta.url).pathname) console.log(sqlSemente());
