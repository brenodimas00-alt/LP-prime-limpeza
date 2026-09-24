// Verifica docs/WHATSAPP.md (parte 2) contra src/automacoes/mensagens.js e as regras da Meta.
// node scripts/verifica-templates.mjs          -> verifica (sai com erro se divergir)
// node scripts/verifica-templates.mjs --gerar  -> regenera o bloco de templates no .md a partir do código
import { readFileSync, writeFileSync } from 'node:fs';
import { MENSAGENS } from '../src/automacoes/mensagens.js';
import { GATILHOS } from '../src/automacoes/gatilhos.js';

const ARQ = new URL('../docs/WHATSAPP.md', import.meta.url);
const INI = '<!-- TEMPLATES:INICIO (gerado por: node scripts/verifica-templates.mjs --gerar; não editar à mão) -->';
const FIM = '<!-- TEMPLATES:FIM -->';
const QUANDO = { imediato: 'na hora', vespera_18h: '18h da véspera (America/Sao_Paulo)', apos_finalizado: '2h depois de finalizada', prazo_pagamento: '9h do dia do vencimento (antes das 14h)' };

function gatilhosDe(tpl) {
  return Object.entries(GATILHOS).flatMap(([ev, gs]) => gs.filter((g) => g.template === tpl).map((g) => `\`${ev}\` (${QUANDO[g.quando]})`));
}

export function gerarBloco() {
  const linhas = [INI, '', '### Mapa gatilho → template → variáveis', '', '| template | destinatário | disparado por | variáveis |', '|---|---|---|---|'];
  for (const [k, m] of Object.entries(MENSAGENS)) {
    linhas.push(`| \`${k}\` | ${m.destinatario} | ${gatilhosDe(k).join('<br>')} | ${m.variaveis.map((v, i) => `{{${i + 1}}} ${v}`).join(', ')} |`);
  }
  for (const [k, m] of Object.entries(MENSAGENS)) {
    linhas.push('', `### ${k}`, '', `- Categoria: UTILITY · Idioma: pt_BR · Destinatário: ${m.destinatario}`,
      `- Variáveis: ${m.variaveis.map((v, i) => `{{${i + 1}}} = ${v} (ex.: "${m.exemplo[i]}")`).join('; ')}`, '', '```text', m.texto, '```');
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
  if (!md.includes(INI) || !md.includes(FIM)) return ['marcadores TEMPLATES ausentes no WHATSAPP.md'];
  const doc = lerTemplatesDoDoc(md);
  for (const [k, m] of Object.entries(MENSAGENS)) {
    const d = doc[k];
    if (!d) { erros.push(`${k}: ausente no WHATSAPP.md`); continue; }
    if (d.texto !== m.texto) erros.push(`${k}: texto diverge do mensagens.js`);
    if (d.categoria !== 'UTILITY') erros.push(`${k}: categoria ${d.categoria} (esperado UTILITY)`);
    if (d.idioma !== 'pt_BR') erros.push(`${k}: idioma ${d.idioma}`);
    if (!/^[a-z][a-z0-9_]*$/.test(k) || k.length > 512) erros.push(`${k}: nome fora de snake_case`);
    if (/[*_~`]/.test(m.texto)) erros.push(`${k}: tem caractere de formatação (* _ ~ \`)`);
    const nums = [...m.texto.matchAll(/\{\{(\d+)\}\}/g)].map((x) => Number(x[1]));
    if (nums.join() !== m.variaveis.map((_, i) => i + 1).join()) erros.push(`${k}: variáveis fora de sequência (${nums})`);
    if (/^\s*\{\{\d+\}\}/.test(m.texto) || /\{\{\d+\}\}\s*$/.test(m.texto)) erros.push(`${k}: variável no início ou no fim`);
    if (m.exemplo?.length !== m.variaveis.length) erros.push(`${k}: exemplos não batem com as variáveis`);
    if (/\n{3,}/.test(m.texto)) erros.push(`${k}: mais de 2 quebras de linha seguidas`);
    if (m.texto.length > 1024) erros.push(`${k}: corpo acima de 1024 caracteres`);
    if (!gatilhosDe(k).length) erros.push(`${k}: nenhum gatilho dispara este template`);
  }
  for (const k of Object.keys(doc)) if (!MENSAGENS[k]) erros.push(`${k}: está no WHATSAPP.md mas não no mensagens.js`);
  return erros;
}

const principal = process.argv[1] && new URL(import.meta.url).pathname === process.argv[1];
const md = readFileSync(ARQ, 'utf8');
if (!principal) { /* importado pelos testes */ } else if (process.argv.includes('--gerar')) {
  const novo = md.slice(0, md.indexOf(INI)) + gerarBloco() + md.slice(md.indexOf(FIM) + FIM.length);
  writeFileSync(ARQ, novo);
  console.log('bloco de templates regenerado');
} else {
  const erros = verificar(md);
  const n = Object.keys(MENSAGENS).length;
  if (erros.length) { console.log(`# verifica-templates: FALHOU\n  ${erros.join('\n  ')}`); process.exit(1); }
  console.log(`# verifica-templates: ${n}/${n} templates idênticos ao mensagens.js e dentro das regras da Meta`);
}
