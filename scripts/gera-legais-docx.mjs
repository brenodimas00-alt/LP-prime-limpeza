// Acabamento (21/10/2026): os três textos legais do site (condicoes/, privacidade/, termos/) em .docx pra revisão da cliente
// e do advogado. O texto é o MESMO das páginas, sem cláusula nova: o script lê o <article id="texto-legal"> de cada uma.
// O que falta (span.preencher) e os avisos de pendência (p.pendente) saem destacados em amarelo.
// O pacote docx não é dependência do projeto: instale numa pasta à parte.
// Uso: npm install --prefix /tmp/docx docx@9 && DOCX_DIR=/tmp/docx node scripts/gera-legais-docx.mjs <pasta de saída>
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { abrirNavegador } from './pw.mjs';

const [pasta] = process.argv.slice(2);
if (!pasta || !process.env.DOCX_DIR) { console.error('uso: DOCX_DIR=<pasta com node_modules/docx> node scripts/gera-legais-docx.mjs <pasta de saída>'); process.exit(2); }
const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, LevelFormat, Table, TableRow, TableCell, WidthType, ShadingType, Footer, PageNumber } = createRequire(`${process.env.DOCX_DIR}/`)('docx');

const AZUL = '25225D'; const CINZA = '5C5853';
const PAGINAS = [['condicoes', 'termos-e-condicoes-do-atendimento.docx'], ['privacidade', 'politica-de-privacidade.docx'], ['termos', 'termos-de-uso.docx']];

// blocos: { tipo: h1|h2|p|li|tabela, runs: [{ t, b, amarelo }], linhas? }
function extrair() {
  const runs = (no, fmt = {}) => [...no.childNodes].flatMap((n) => {
    if (n.nodeType === 3) return n.textContent ? [{ t: n.textContent.replace(/\s+/g, ' '), ...fmt }] : [];
    if (n.nodeType !== 1) return [];
    return runs(n, { ...fmt, b: fmt.b || /^(STRONG|B|TH)$/.test(n.tagName), amarelo: fmt.amarelo || n.classList.contains('preencher') });
  });
  const limpar = (r) => { if (r.length) { r[0].t = r[0].t.trimStart(); r[r.length - 1].t = r[r.length - 1].t.trimEnd(); } return r.filter((x) => x.t); };
  const blocos = [];
  for (const n of document.querySelector('#texto-legal').children) {
    const tag = n.tagName;
    if (tag === 'UL' || tag === 'OL') for (const li of n.querySelectorAll(':scope > li')) blocos.push({ tipo: 'li', runs: limpar(runs(li)) });
    else if (tag === 'TABLE') blocos.push({ tipo: 'tabela', linhas: [...n.querySelectorAll('tr')].map((tr) => [...tr.children].map((c) => limpar(runs(c, { b: c.tagName === 'TH' })))) });
    else if (/^(H1|H2|H3|P)$/.test(tag)) blocos.push({ tipo: tag.toLowerCase(), runs: limpar(runs(n, { amarelo: n.classList.contains('pendente') })) });
  }
  return blocos;
}

const run = (r, extra = {}) => new TextRun({ text: r.t, bold: r.b, ...(r.amarelo ? { highlight: 'yellow' } : {}), ...extra });
const b = await abrirNavegador();
const p = await b.newPage();
for (const [dir, arq] of PAGINAS) {
  const html = readFileSync(new URL(`../${dir}/index.html`, import.meta.url), 'utf8');
  await p.setContent(html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<link[^>]*>/g, ''));
  const blocos = await p.evaluate(extrair);
  const corpo = [];
  for (const x of blocos) {
    if (x.tipo === 'h1') corpo.push(new Paragraph({ heading: HeadingLevel.TITLE, children: x.runs.map((r) => run(r, { color: AZUL })) }));
    else if (x.tipo === 'h2' || x.tipo === 'h3') corpo.push(new Paragraph({ heading: x.tipo === 'h2' ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2, children: x.runs.map((r) => run(r)) }));
    else if (x.tipo === 'li') corpo.push(new Paragraph({ numbering: { reference: 'marcadores', level: 0 }, spacing: { after: 80 }, children: x.runs.map((r) => run(r)) }));
    else if (x.tipo === 'p') corpo.push(new Paragraph({ spacing: { after: 160 }, children: x.runs.map((r) => run(r)) }));
    else if (x.tipo === 'tabela') {
      const n = x.linhas[0].length; const total = 9638; const larg = Array.from({ length: n }, (_, i) => (i === n - 1 ? total - Math.floor(total / n) * (n - 1) : Math.floor(total / n)));
      corpo.push(new Table({ width: { size: total, type: WidthType.DXA }, columnWidths: larg, rows: x.linhas.map((l, i) => new TableRow({ tableHeader: i === 0, children: l.map((c, j) => new TableCell({ width: { size: larg[j], type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, ...(i === 0 ? { shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'ECEAF4' } } : {}), children: [new Paragraph({ children: c.map((r) => run(r)) })] })) })) }));
      corpo.push(new Paragraph({ spacing: { after: 160 }, children: [] }));
    }
  }
  const titulo = blocos.find((x) => x.tipo === 'h1')?.runs.map((r) => r.t).join('') || dir;
  const amarelos = blocos.flatMap((x) => (x.runs || x.linhas.flat(2))).filter((r) => r.amarelo).length;
  const doc = new Document({
    creator: 'Prime Limpeza Especializada', title: titulo,
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } },
      paragraphStyles: [{ id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 28, bold: true, color: AZUL }, paragraph: { spacing: { before: 320, after: 120 }, outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 24, bold: true, color: AZUL }, paragraph: { spacing: { before: 240, after: 100 }, outlineLevel: 1 } }] },
    numbering: { config: [{ reference: 'marcadores', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 260 } } } }] }] },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ children: [`${titulo} · página `, PageNumber.CURRENT], color: CINZA, size: 18 })] })] }) },
      children: [new Paragraph({ spacing: { after: 240 }, children: [new TextRun({ text: 'Mesmo texto publicado no site. Em amarelo, o que falta preencher ou confirmar.', italics: true, color: CINZA })] }), ...corpo] }],
  });
  writeFileSync(`${pasta.replace(/\/?$/, '/')}${arq}`, await Packer.toBuffer(doc));
  console.log(`${arq}: ${blocos.length} blocos, ${amarelos} trecho(s) em amarelo`);
}
await b.close();
