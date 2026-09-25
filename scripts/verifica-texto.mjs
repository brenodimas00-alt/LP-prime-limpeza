// E6: varre o código (fora da home) por emoji, palavras proibidas na microcopy e gradientes fora do dourado.
// Ajustes da cliente (24/09/2026): em TODO texto voltado ao cliente (home, telas, mensagens, WHATSAPP.md), nada de
// posicionamento de plataforma (item 22 de home-isa.txt) nem de 50/50 (entrada, segunda parcela, saldo no dia).
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
// ---- posicionamento e 50/50: só texto (literais de string no JS, texto do HTML, templates do WHATSAPP.md)
const POSICIONAMENTO = ['plataforma', 'marketplace', 'escolha sua diarista', 'encontre sua diarista', 'diaristas disponíveis', 'substituição garantida',
  'diarista garantida', 'diaristas verificadas', 'perfil verificado', 'pagamento garantido', 'avaliação de outros clientes'];
const CINQUENTA = ['entrada de 50', '50%', 'segunda parcela', 'saldo no dia', 'parcela do dia', 'restante no dia', 'entrada (50', 'pix da entrada'];
const textuais = [];
const andarTxt = (d) => { for (const f of readdirSync(d)) { const c = join(d, f); if (statSync(c).isDirectory()) andarTxt(c); else if (/\.js$/.test(c)) textuais.push(c); } };
andarTxt('src');
for (const f of [...textuais, 'index.html', '404.html', 'docs/WHATSAPP.md']) {
  const conteudo = readFileSync(f, 'utf8');
  const trechos = f.endsWith('.js')
    ? [...conteudo.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)].map((m) => m[2])
    : f.endsWith('.md') ? [conteudo.slice(conteudo.indexOf('TEMPLATES:INICIO'), conteudo.indexOf('TEMPLATES:FIM'))]
      : [conteudo.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ')];
  for (const tr of trechos) {
    const t2 = tr.toLowerCase();
    for (const x of POSICIONAMENTO) if (t2.includes(x)) problemas.push(`${f}: posicionamento "${x}" (item 22)`);
    for (const x of CINQUENTA) if (t2.includes(x)) problemas.push(`${f}: 50/50 "${x}" em texto ativo`);
  }
}
if (problemas.length) { console.log(`# verifica-texto: ${problemas.length} ocorrência(s)\n  ${problemas.join('\n  ')}`); process.exit(1); }
console.log(`# verifica-texto: 0 ocorrências em ${arquivos.length} arquivos (emoji, palavras proibidas, gradiente fora do dourado, travessão); 0 de posicionamento de plataforma e de 50/50 em texto ao cliente`);
