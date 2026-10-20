// Design system (D8): PDF antes e depois, uma página por tela, a partir das fotos de scripts/design/fotos.mjs (mesma
// lista no antes e no depois). Cada página: computador (1440) e celular (390), antes à esquerda e depois à direita,
// mostrando o começo da tela (a primeira dobra e um pouco mais). Fotos com dados fictícios; o texto do PDF passa pela
// varredura de dado real antes de gravar.
// Uso: LD_LIBRARY_PATH=... bash scripts/cli.sh node22 scripts/design/gera-pdf.mjs <pasta-antes> <pasta-depois> [destino.pdf]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { dadosReais, acharDadosReais } from '../varre-segredos.mjs';

const [antes, depois] = process.argv.slice(2);
const destino = process.argv[4] || '/mnt/c/Users/gabri/OneDrive/Área de Trabalho/Prime_Limpeza/design-system-antes-depois.pdf';
if (!antes || !depois) { console.error('uso: gera-pdf.mjs <pasta-antes> <pasta-depois> [destino.pdf]'); process.exit(2); }

const TELAS = [
  ['home', 'Home'], ['condicoes', 'Termos e Condições do atendimento'], ['privacidade', 'Política de Privacidade'], ['termos', 'Termos de Uso'], ['404', 'Página não encontrada'],
  ['cadastro-profissional', 'Cadastro de profissional'], ['antecedentes', 'Antecedentes da profissional'],
  ['agendamento-servico', 'Agendamento: serviço'], ['agendamento-identificacao', 'Agendamento: identificação'], ['agendamento-cadastro', 'Agendamento: cadastro'],
  ['agendamento-endereco', 'Agendamento: endereço'], ['agendamento-local', 'Agendamento: características do local'], ['agendamento-modalidade', 'Agendamento: modalidade'],
  ['agendamento-datas', 'Agendamento: data e horário'], ['agendamento-revisao', 'Agendamento: revisão'],
  ['entrar', 'Entrar (cliente)'], ['entrar-painel', 'Entrar (equipe)'], ['entrar-profissional', 'Entrar (profissional)'], ['minha-conta', 'Minha conta'],
  ['acompanhamento', 'Acompanhamento do pedido'], ['avaliacao', 'Avaliação'], ['pagamento', 'Pagamento'], ['agenda-profissional', 'Agenda da profissional'],
  ['painel-inicio', 'Painel: Início'], ['painel-solicitacoes', 'Painel: Solicitações'], ['painel-agenda', 'Painel: Agenda e escala'], ['painel-clientes', 'Painel: Clientes'],
  ['painel-ficha', 'Painel: ficha da cliente'], ['painel-profissionais', 'Painel: Profissionais'], ['painel-financeiro', 'Painel: Financeiro'], ['painel-gestao', 'Painel: Gestão'], ['painel-ajuda', 'Painel: Ajuda'],
];
const CAPA = ['Prime Limpeza Especializada', 'Design system e repaginação: antes e depois', `${new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })} · ${TELAS.length} telas, computador e celular · dados fictícios`];
const reais = await dadosReais();
if (acharDadosReais([...CAPA, ...TELAS.map((t) => t[1])].join('\n'), reais).length) { console.error('ABORTADO: dado da base real no texto do PDF'); process.exit(1); }

const b = await chromium.launch();
// recorte do começo de cada foto em JPEG (o PDF fica leve), na proporção do quadro: 1440x2450 e 390x2100
const recorte = async (arq, w) => {
  if (!existsSync(arq)) return null;
  const buf = readFileSync(arq); const h = Math.min(buf.readUInt32BE(20), w === 1440 ? 2450 : 2100); // proporção do quadro da página
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.setContent(`<body style="margin:0"><img src="data:image/png;base64,${buf.toString('base64')}" style="display:block;width:${w}px"></body>`);
  const jpg = await p.screenshot({ type: 'jpeg', quality: 72, clip: { x: 0, y: 0, width: w, height: h } });
  await p.close();
  return `data:image/jpeg;base64,${jpg.toString('base64')}`;
};
const paginas = [];
for (const [id, nome] of TELAS) {
  const [a14, a39, d14, d39] = await Promise.all([recorte(`${antes}/${id}-1440.png`, 1440), recorte(`${antes}/${id}-390.png`, 390), recorte(`${depois}/${id}-1440.png`, 1440), recorte(`${depois}/${id}-390.png`, 390)]);
  const lado = (t, g, c) => `<div class="lado"><p class="tag">${t}</p><div class="par"><div class="g">${g ? `<img src="${g}">` : '<span>sem foto</span>'}</div><div class="c">${c ? `<img src="${c}">` : '<span>sem foto</span>'}</div></div></div>`;
  paginas.push(`<section class="pg"><h2>${nome}</h2><div class="lados">${lado('Antes', a14, a39)}${lado('Depois', d14, d39)}</div></section>`);
  process.stdout.write('.');
}
const fonte = (arq, fam, peso) => `@font-face{font-family:'${fam}';font-weight:${peso};src:url(data:font/woff2;base64,${readFileSync(new URL(`../../assets/fonts/${arq}`, import.meta.url)).toString('base64')}) format('woff2')}`;
const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>
${fonte('source-serif-4-latin-600.woff2', 'Source Serif 4', 600)}${fonte('source-sans-3-latin-400.woff2', 'Source Sans 3', 400)}${fonte('source-sans-3-latin-600.woff2', 'Source Sans 3', 600)}
@page{size:A4 landscape;margin:10mm}
body{margin:0;font-family:'Source Sans 3',sans-serif;color:#1f1d1a}
.capa{height:180mm;display:flex;flex-direction:column;justify-content:center;gap:6mm;padding:0 12mm;break-after:page}
.capa h1{font-family:'Source Serif 4',serif;font-weight:600;font-size:30pt;color:#25225d;margin:0}
.capa p{font-size:14pt;margin:0;color:#4d4943}.capa .linha{width:60mm;border-top:1.5pt solid #c9a24a}
.pg{height:188mm;break-after:page;display:flex;flex-direction:column;gap:3mm}
.pg h2{font-family:'Source Serif 4',serif;font-weight:600;font-size:16pt;color:#25225d;margin:0}
.lados{display:grid;grid-template-columns:1fr 1fr;gap:6mm;flex:1;min-height:0}
.lado{display:flex;flex-direction:column;gap:2mm;min-height:0}
.tag{margin:0;font-size:10pt;font-weight:600;color:#67625a}
.par{display:grid;grid-template-columns:3.2fr 1fr;gap:3mm;flex:1;min-height:0}
.g,.c{border:0.5pt solid #cdc8be;overflow:hidden;background:#fff;height:172mm}
.g img,.c img{display:block;width:100%}
.g span,.c span{display:block;padding:4mm;font-size:9pt;color:#67625a}
</style></head><body>
<section class="capa"><h1>${CAPA[0]}</h1><p>${CAPA[1]}</p><div class="linha"></div><p>${CAPA[2]}</p><p>Em cada página: computador à esquerda e celular à direita de cada lado; o começo de cada tela.</p></section>
${paginas.join('\n')}
</body></html>`;
const p = await b.newPage();
await p.setContent(html, { waitUntil: 'load' });
writeFileSync(destino, await p.pdf({ format: 'A4', landscape: true, printBackground: true }));
// conferência visual sem leitor de PDF: PREVIA=arquivo.png grava a página da Home como imagem, no mesmo layout
if (process.env.PREVIA) { await p.emulateMedia({ media: 'print' }); await p.setViewportSize({ width: 1047, height: 718 }); await p.locator('.pg').first().screenshot({ path: process.env.PREVIA }); }
await b.close();
console.log(`\n${destino} (${TELAS.length + 1} páginas)`);
