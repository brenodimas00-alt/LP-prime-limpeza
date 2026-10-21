// Painel v2, B5: manual da equipe em .docx, com o MESMO texto da central de ajuda (src/ui/paginas/painel-ajuda.js) e os
// prints de assets/ajuda/ (dados fictícios). O pacote docx não é dependência do projeto: instale numa pasta à parte.
// Uso: npm install --prefix /tmp/docx docx@9 && DOCX_DIR=/tmp/docx node scripts/painel-v2/gera-manual.mjs <saida.docx>
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { TAREFAS } from '../../src/ui/paginas/painel-ajuda.js';

const saida = process.argv[2];
if (!saida || !process.env.DOCX_DIR) { console.error('uso: DOCX_DIR=<pasta com node_modules/docx> node scripts/painel-v2/gera-manual.mjs <saida.docx>'); process.exit(2); }
const { Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun, AlignmentType, LevelFormat, Footer, PageNumber } = createRequire(`${process.env.DOCX_DIR}/`)('docx');

const AZUL = '2A2456'; const CINZA = '5C5853';
const pngTamanho = (buf) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });
const img = (id) => {
  const arq = new URL(`../../assets/ajuda/${id}.png`, import.meta.url);
  if (!existsSync(arq)) return null;
  const buf = readFileSync(arq); const { w, h } = pngTamanho(buf);
  const largura = Math.round(Math.min(440, w, (300 * w) / h)); // pontos: até 440 de largura e 300 de altura, pro manual ficar em 5 a 8 páginas
  return new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 240 }, children: [new ImageRun({ type: 'png', data: buf, transformation: { width: largura, height: Math.round((h / w) * largura) }, altText: { title: id, description: `Tela do painel (exemplo com dados fictícios)`, name: id } })] });
};

const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const corpo = [
  new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: 'Painel da Prime', color: AZUL })] }),
  new Paragraph({ children: [new TextRun({ text: `Manual da equipe · versão de ${hoje}`, color: CINZA })] }),
  new Paragraph({ spacing: { before: 240 }, children: [new TextRun('O passo a passo das tarefas do dia a dia, a partir da tela Início. As imagens são de exemplo, com dados fictícios. O mesmo texto está no painel, em Gestão > Ajuda.')] }),
  new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Como o painel está organizado')] }),
  ...[
    'Início: solicitações novas, diárias de hoje e de amanhã, "Precisa de você", stand-by, alertas, novos cadastros e três indicadores (meta, motivos de cancelamento e regiões).',
    'Solicitações, Agenda e escala, Clientes, Profissionais e Financeiro: a lista completa de cada assunto, com filtros.',
    'Gestão: indicadores, mensagens automáticas, configurações (preços, motivos, meta) e esta ajuda.',
    'No topo: a busca única (nome, telefone, e-mail, endereço ou número da solicitação), o sino com o que é urgente e a sua conta.',
    'No celular, o menu fica embaixo: Início, Solicitações, Agenda, Clientes e "Mais".',
  ].map((t) => new Paragraph({ numbering: { reference: 'marcadores', level: 0 }, children: [new TextRun(t)] })),
  new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Tarefas do dia a dia')] }),
];
TAREFAS.forEach(([id, titulo, , passos], i) => {
  corpo.push(new Paragraph({ heading: HeadingLevel.HEADING_2, keepNext: true, children: [new TextRun(titulo)] }));
  passos.forEach((t) => corpo.push(new Paragraph({ numbering: { reference: `passos-${i}`, level: 0 }, spacing: { after: 80 }, children: [new TextRun(t)] })));
  const fig = img(id); if (fig) corpo.push(fig);
});

const doc = new Document({
  creator: 'Prime Limpeza Especializada', title: 'Painel da Prime: manual da equipe',
  styles: { default: { document: { run: { font: 'Calibri', size: 22 } } },
    paragraphStyles: [{ id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 30, bold: true, color: AZUL }, paragraph: { spacing: { before: 120, after: 160 }, outlineLevel: 1 } },
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 34, bold: true, color: AZUL }, paragraph: { spacing: { before: 360, after: 160 }, outlineLevel: 0 } }] },
  numbering: { config: [{ reference: 'marcadores', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 260 } } } }] },
    ...TAREFAS.map((_, i) => ({ reference: `passos-${i}`, levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 300 } } } }] }))] },
  sections: [{ properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ children: ['Painel da Prime · página ', PageNumber.CURRENT], color: CINZA, size: 18 })] })] }) },
    children: corpo }],
});
writeFileSync(saida, await Packer.toBuffer(doc));
console.log(`manual: ${saida} (${TAREFAS.length} tarefas)`);
