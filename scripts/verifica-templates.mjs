// AUT.5: docs/WHATSAPP.md (parte 2) contra o catálogo (src/automacoes/catalogo.js) e as regras da Meta.
// Todos os templates que saem por WhatsApp/e-mail (cliente e profissional) no formato de aprovação da Meta:
// UTILITY pra atendimento e lembrete, MARKETING pra M01 a M03. Os internos (equipe, canal painel) ficam fora.
// node scripts/verifica-templates.mjs          -> verifica (sai com erro se divergir)
// node scripts/verifica-templates.mjs --gerar  -> regenera o bloco de templates no .md a partir do catálogo
import { readFileSync, writeFileSync } from 'node:fs';
import { REGRAS, TEMPLATES, paraMeta, validarCorpo } from '../src/automacoes/catalogo.js';

const ARQ = new URL('../docs/WHATSAPP.md', import.meta.url);
const INI = '<!-- TEMPLATES:INICIO (gerado por: node scripts/verifica-templates.mjs --gerar; não editar à mão) -->';
const FIM = '<!-- TEMPLATES:FIM -->';

function quando(r) {
  const a = r.atraso;
  if (r.gatilho.tipo === 'evento') return `${r.gatilho.eventos.map((e) => `\`${e}\``).join(', ')}${a.tipo === 'apos' ? ` + ${a.minutos / 60}h` : ' (na hora)'}`;
  switch (a.tipo) {
    case 'vespera': return `véspera, ${a.hora}`;
    case 'antes_prazo': return `${a.minutos.map((m) => (m >= 60 ? `${m / 60}h` : `${m} min`)).join(' e ')} antes do prazo`;
    case 'apos_inicio_turno': return `${a.minutos} min depois do início do turno`;
    case 'mensal': return `dia ${a.dia}, ${a.hora}`;
    case 'aniversario': return `aniversário, ${a.hora}`;
    case 'inatividade': return `sem diária há ${a.dias} dias (no máximo a cada ${a.intervaloDias}), ${a.hora}`;
    case 'antes_vencimento_documento': return `${a.dias.join(' e ')} dias antes do vencimento, ${a.hora}`;
    default: return a.tipo;
  }
}

const EXTERNOS = REGRAS.filter((r) => TEMPLATES[r.template].categoriaMeta);
export function gerarBloco() {
  const linhas = [INI, '', '### Mapa regra → template → variáveis', '', '| regra | template | categoria | destinatário | quando | variáveis |', '|---|---|---|---|---|---|'];
  for (const r of EXTERNOS) {
    const t = TEMPLATES[r.template];
    linhas.push(`| ${r.codigo} | \`${r.template}\` | ${t.categoriaMeta} | ${r.destinatario} | ${quando(r)}${r.ligada ? '' : ' (nasce desligada)'} | ${paraMeta(t.corpo).ordem.map((v, i) => `{{${i + 1}}} ${v}`).join(', ') || 'nenhuma'} |`);
  }
  for (const r of EXTERNOS) {
    const t = TEMPLATES[r.template];
    const { texto, ordem } = paraMeta(t.corpo);
    linhas.push('', `### ${r.template}`, '', `- Regra: ${r.codigo} (${r.descricao}) · Categoria: ${t.categoriaMeta} · Idioma: pt_BR`,
      `- Variáveis: ${ordem.map((v, i) => `{{${i + 1}}} = ${v} (ex.: "${t.exemplo[v]}")`).join('; ') || 'nenhuma'}`, '', '```text', texto, '```');
  }
  linhas.push('', FIM);
  return linhas.join('\n');
}

export function lerTemplatesDoDoc(md) {
  const bloco = md.slice(md.indexOf(INI), md.indexOf(FIM));
  const out = {};
  const re = /^### ([a-z0-9_]+)\n[\s\S]*?Categoria: (\w+) · Idioma: (\w+)[\s\S]*?```text\n([\s\S]*?)\n```/gm;
  let m;
  while ((m = re.exec(bloco))) out[m[1]] = { categoria: m[2], idioma: m[3], texto: m[4] };
  return out;
}

export function verificar(md) {
  const erros = [];
  if (!md.includes(INI) || !md.includes(FIM)) return ['WHATSAPP.md sem o bloco de templates'];
  const doc = lerTemplatesDoDoc(md);
  for (const r of EXTERNOS) {
    const t = TEMPLATES[r.template];
    const d = doc[r.template];
    if (!d) { erros.push(`${r.template}: falta no WHATSAPP.md`); continue; }
    const { texto } = paraMeta(t.corpo);
    if (d.texto !== texto) erros.push(`${r.template}: texto diverge do catálogo`);
    if (d.categoria !== t.categoriaMeta) erros.push(`${r.template}: categoria ${d.categoria} (catálogo: ${t.categoriaMeta})`);
    if ((r.categoria === 'marketing') !== (t.categoriaMeta === 'MARKETING')) erros.push(`${r.template}: categoria da Meta não bate com a regra (${r.categoria})`);
    if (d.idioma !== 'pt_BR') erros.push(`${r.template}: idioma ${d.idioma}`);
    for (const e of validarCorpo(r.template, t.corpo, 'whatsapp')) erros.push(`${r.template}: ${e}`);
    if (texto.length > 1024) erros.push(`${r.template}: mais de 1024 caracteres`);
    if (/[\u{1F300}-\u{1FAFF}]/u.test(texto)) erros.push(`${r.template}: emoji`);
    if (t.categoriaMeta === 'MARKETING' && !/SAIR/.test(texto)) erros.push(`${r.template}: marketing sem a opção de sair`);
  }
  for (const k of Object.keys(doc)) if (!EXTERNOS.some((r) => r.template === k)) erros.push(`${k}: está no WHATSAPP.md mas não no catálogo`);
  return erros;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const md = readFileSync(ARQ, 'utf8');
  if (process.argv.includes('--gerar')) {
    const novo = md.includes(INI) ? md.slice(0, md.indexOf(INI)) + gerarBloco() + md.slice(md.indexOf(FIM) + FIM.length) : `${md}\n${gerarBloco()}\n`;
    writeFileSync(ARQ, novo);
    console.log('bloco de templates regenerado');
  }
  const erros = verificar(readFileSync(ARQ, 'utf8'));
  if (erros.length) { for (const e of erros) console.log(`  FALHOU ${e}`); process.exitCode = 1; }
  const n = EXTERNOS.length;
  console.log(`# verifica-templates: ${n - erros.length}/${n} templates idênticos ao catálogo e dentro das regras da Meta${erros.length ? ` (${erros.length} problema(s))` : ''}`);
}
