// PDF mínimo de texto (P3, recibo), sem biblioteca: A4, Helvetica e Helvetica-Bold com WinAnsiEncoding (acentos do
// português). PURO: recebe linhas e devolve os bytes. Caractere fora do Latin-1 vira "?" (nunca quebra o arquivo).
// linhas: [{ texto, tamanho?, negrito?, espaco? (pontos antes da linha), cor? ([r,g,b] 0-1) }]

const LARGURA = 595; const ALTURA = 842; const MARGEM = 56;

function latin1(s) {
  const out = [];
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    out.push(c <= 0xff ? c : ({ 0x2013: 0x96, 0x2014: 0x97, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x20ac: 0x80 }[c] ?? 0x3f));
  }
  return out;
}
/** Texto de string PDF: escapa \\ ( ) e passa pra octal o que não é ASCII imprimível. */
function literal(s) {
  return latin1(s).map((c) => (c === 0x5c || c === 0x28 || c === 0x29 ? `\\${String.fromCharCode(c)}` : c < 0x20 || c > 0x7e ? `\\${c.toString(8).padStart(3, '0')}` : String.fromCharCode(c))).join('');
}
/** Quebra aproximada por largura média da Helvetica (0,5 do tamanho por caractere). */
function quebrar(texto, tamanho, largura) {
  const max = Math.max(10, Math.floor(largura / (tamanho * 0.5)));
  const palavras = String(texto).split(/\s+/); const saida = []; let atual = '';
  for (const p of palavras) {
    if ((atual ? `${atual} ${p}` : p).length > max && atual) { saida.push(atual); atual = p; } else atual = atual ? `${atual} ${p}` : p;
  }
  if (atual || !saida.length) saida.push(atual);
  return saida;
}

export function gerarPdf(linhas, { titulo = 'Documento' } = {}) {
  let y = ALTURA - MARGEM;
  const cmds = [];
  for (const l of linhas) {
    const t = l.tamanho || 11;
    y -= (l.espaco ?? 4);
    for (const parte of quebrar(l.texto ?? '', t, LARGURA - 2 * MARGEM)) {
      y -= t * 1.35;
      const cor = l.cor || [0.16, 0.14, 0.34];
      cmds.push(`BT /${l.negrito ? 'F2' : 'F1'} ${t} Tf ${cor.map((c) => c.toFixed(3)).join(' ')} rg ${MARGEM} ${y.toFixed(1)} Td (${literal(parte)}) Tj ET`);
    }
    if (l.linha) { y -= 6; cmds.push(`0.69 0.54 0.18 RG 1 w ${MARGEM} ${y.toFixed(1)} m ${LARGURA - MARGEM} ${y.toFixed(1)} l S`); }
  }
  const conteudo = cmds.join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${LARGURA} ${ALTURA}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Length ${latin1(conteudo).length} >>\nstream\n${conteudo}\nendstream`,
    `<< /Title (${literal(titulo)}) /Producer (Prime Limpeza) >>`,
  ];
  const partes = ['%PDF-1.4\n%âãÏÓ\n'];
  const offsets = [];
  let tam = latin1(partes[0]).length;
  objs.forEach((o, i) => { offsets.push(tam); const s = `${i + 1} 0 obj\n${o}\nendobj\n`; partes.push(s); tam += latin1(s).length; });
  const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  partes.push(`${xref}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${objs.length} 0 R >>\nstartxref\n${tam}\n%%EOF\n`);
  return new Uint8Array(latin1(partes.join('')));
}
