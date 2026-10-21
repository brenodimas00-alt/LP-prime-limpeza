// Acabamento (21/10/2026): pendencias-cliente.docx a partir da seção "Para a cliente responder" de docs/PENDENCIAS.md (a
// única fonte; os itens da Gabrielle ficam de fora). Um tema por título, cada item numerado com um quadro para a resposta.
// O pacote docx não é dependência do projeto: instale numa pasta à parte.
// Uso: npm install --prefix /tmp/docx docx@9 && DOCX_DIR=/tmp/docx node scripts/gera-pendencias-docx.mjs <saida.docx>
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const saida = process.argv[2];
if (!saida || !process.env.DOCX_DIR) { console.error('uso: DOCX_DIR=<pasta com node_modules/docx> node scripts/gera-pendencias-docx.mjs <saida.docx>'); process.exit(2); }
const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType, BorderStyle, HeightRule, Footer, PageNumber } = createRequire(`${process.env.DOCX_DIR}/`)('docx');

const md = readFileSync(new URL('../docs/PENDENCIAS.md', import.meta.url), 'utf8');
const inicio = md.indexOf('## Para a cliente responder');
if (inicio < 0) { console.error('PENDENCIAS.md sem a seção "Para a cliente responder"'); process.exit(1); }
const fim = md.indexOf('\n## ', inicio + 5);
const secao = md.slice(inicio, fim < 0 ? undefined : fim).split('\n');
const temas = [];
for (const l of secao) {
  if (l.startsWith('### ')) temas.push({ titulo: l.slice(4).trim(), itens: [] });
  else if (l.startsWith('- ') && temas.length) {
    const m = l.slice(2).match(/^\*\*(.+?):?\*\*:?\s*(.*)$/);
    temas.at(-1).itens.push(m ? { titulo: m[1].replace(/:$/, ''), texto: m[2] } : { titulo: '', texto: l.slice(2) });
  }
}
const limpar = (t) => t.replace(/`([^`]+)`/g, '$1').replace(/\*\*/g, '');

const AZUL = '25225D'; const CINZA = '5C5853'; const LARGURA = 9638;
const borda = { style: BorderStyle.SINGLE, size: 6, color: '9A96B8' };
const quadro = () => new Table({ width: { size: LARGURA, type: WidthType.DXA }, columnWidths: [LARGURA], rows: [new TableRow({ height: { value: 1100, rule: HeightRule.ATLEAST }, children: [
  new TableCell({ width: { size: LARGURA, type: WidthType.DXA }, borders: { top: borda, bottom: borda, left: borda, right: borda }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({ children: [new TextRun({ text: 'Resposta:', color: CINZA, size: 18 })] })] })] })] });

let n = 0;
const corpo = [
  new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: 'Prime Limpeza: perguntas em aberto', color: AZUL })] }),
  new Paragraph({ spacing: { after: 240 }, children: [new TextRun({ text: 'Cada pergunta tem um quadro para a resposta. Onde está "Hoje", é como o sistema já funciona enquanto não houver resposta: se estiver bom, basta escrever "ok".', color: CINZA })] }),
];
for (const t of temas) {
  corpo.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t.titulo)] }));
  for (const it of t.itens) {
    n += 1;
    corpo.push(new Paragraph({ keepNext: true, spacing: { before: 200, after: 60 }, children: [new TextRun({ text: `${n}. ${limpar(it.titulo)}`, bold: true })] }));
    corpo.push(new Paragraph({ keepNext: true, spacing: { after: 100 }, children: [new TextRun(limpar(it.texto))] }));
    corpo.push(quadro());
  }
}
const doc = new Document({
  creator: 'Prime Limpeza Especializada', title: 'Prime Limpeza: perguntas em aberto',
  styles: { default: { document: { run: { font: 'Calibri', size: 22 } } },
    paragraphStyles: [{ id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 30, bold: true, color: AZUL }, paragraph: { spacing: { before: 400, after: 120 }, outlineLevel: 0, keepNext: true } }] },
  sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ children: ['Pendências da Prime · página ', PageNumber.CURRENT], color: CINZA, size: 18 })] })] }) },
    children: corpo }],
});
writeFileSync(saida, await Packer.toBuffer(doc));
console.log(`pendencias: ${saida} (${temas.length} temas, ${n} itens)`);
