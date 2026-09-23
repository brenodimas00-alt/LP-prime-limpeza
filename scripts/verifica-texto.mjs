// E6: varre o código (fora da home) por emoji, palavras proibidas na microcopy e gradientes fora do dourado.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PROIBIDAS = ['transforme', 'experiência incrível', 'solução completa', 'descubra', 'de forma simples e rápida', 'sem complicação', 'seu lar merece', 'ops!', 'algo deu errado'];
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/u;
const GRADIENTE_OK = /linear-gradient\(135deg,\s*#A57E37 0%,\s*#F7F4C0 50%,\s*#BA984D 100%\)/;
const TRAVESSAO = /—/;
const arquivos = [];
const andar = (d) => { for (const f of readdirSync(d)) { const c = join(d, f); if (statSync(c).isDirectory()) { if (!/node_modules|\.git|shots/.test(c)) andar(c); } else if (/\.(js|mjs|css|html)$/.test(c) && !/index\.html$/.test(c) || /\/(entrar|minha-conta|painel|diarista|autoagendamento|pagamento|acompanhamento|avaliacao)\/.*index\.html$/.test(c)) arquivos.push(c); } };
andar('src'); andar('scripts'); arquivos.push('404.html');
const PROPRIO = 'scripts/verifica-texto.mjs';
const problemas = [];
for (const f of arquivos.filter((x) => x !== PROPRIO)) {
  const linhas = readFileSync(f, 'utf8').split('\n');
  linhas.forEach((l, i) => {
    const n = `${f}:${i + 1}`;
    if (EMOJI.test(l)) problemas.push(`${n}: emoji`);
    for (const p of PROIBIDAS) if (l.toLowerCase().includes(p)) problemas.push(`${n}: palavra proibida "${p}"`);
    if (/linear-gradient\(/.test(l) && !GRADIENTE_OK.test(l) && !/var\(--dourado\)/.test(l) && !/rgba\(37,31,79/.test(l)) problemas.push(`${n}: gradiente fora do dourado`);
    if (TRAVESSAO.test(l) && !/'—'/.test(l)) problemas.push(`${n}: travessão longo`);
    // exclamações em série: só dentro de um literal de texto
    for (const m of l.matchAll(/(['"`])((?:(?!\1).)*)\1/g)) if ((m[2].match(/!/g) || []).length >= 2) problemas.push(`${n}: exclamações em série`);
  });
}
if (problemas.length) { console.log(`# verifica-texto: ${problemas.length} ocorrência(s)\n  ${problemas.join('\n  ')}`); process.exit(1); }
console.log(`# verifica-texto: 0 ocorrências em ${arquivos.length} arquivos (emoji, palavras proibidas, gradiente fora do dourado, travessão)`);
