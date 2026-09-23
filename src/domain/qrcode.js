// Gerador de QR Code próprio (sem CDN): modo byte, nível de correção M, versões 1 a 40. Função pura.
// Devolve matriz de 0/1. Suficiente pro BR Code Pix (até ~300 caracteres cabe em versão 10 a 15).
// Referência: ISO/IEC 18004. Implementação enxuta, sem otimizações desnecessárias.

const NIVEL = 0; // M
const EC_POR_VERSAO = [ // [blocos, ecPorBloco, totalDados] pra nível M, versões 1..40
  [1, 10, 16], [1, 16, 28], [1, 26, 44], [2, 18, 64], [2, 24, 86], [4, 16, 108], [4, 18, 124], [4, 22, 154], [5, 22, 182], [5, 26, 216],
  [5, 30, 254], [8, 22, 290], [9, 22, 334], [9, 24, 365], [10, 24, 415], [10, 28, 453], [11, 28, 507], [13, 26, 563], [14, 26, 627], [16, 26, 669],
  [17, 26, 714], [17, 28, 782], [18, 28, 860], [20, 28, 914], [21, 28, 1000], [23, 28, 1062], [25, 28, 1128], [26, 28, 1193], [28, 28, 1267], [29, 28, 1373],
  [31, 28, 1455], [33, 28, 1541], [35, 28, 1631], [37, 28, 1725], [38, 28, 1812], [40, 28, 1914], [43, 28, 1992], [45, 28, 2102], [47, 28, 2216], [49, 28, 2334],
];
const ALINHAMENTO = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54], [6, 32, 58], [6, 34, 62],
  [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74], [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90], [6, 28, 50, 72, 94], [6, 26, 50, 74, 98],
  [6, 30, 54, 78, 102], [6, 28, 54, 80, 106], [6, 32, 58, 84, 110], [6, 30, 58, 86, 114], [6, 34, 62, 90, 118], [6, 26, 50, 74, 98, 122], [6, 30, 54, 78, 102, 126],
  [6, 26, 52, 78, 104, 130], [6, 30, 56, 82, 108, 134], [6, 34, 60, 86, 112, 138], [6, 30, 58, 86, 114, 142], [6, 34, 62, 90, 118, 146], [6, 30, 54, 78, 102, 126, 150],
  [6, 24, 50, 76, 102, 128, 154], [6, 28, 54, 80, 106, 132, 158], [6, 32, 58, 84, 110, 136, 162], [6, 26, 54, 82, 110, 138, 166], [6, 30, 58, 86, 114, 142, 170]];

// Galois field GF(256)
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; })();
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

function polinomioGerador(n) {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const novo = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) { novo[j] ^= g[j]; novo[j + 1] ^= mul(g[j], EXP[i]); }
    g = novo;
  }
  return g;
}

function reedSolomon(dados, n) {
  const g = polinomioGerador(n);
  const resto = new Array(n).fill(0);
  for (const d of dados) {
    const f = d ^ resto[0];
    resto.shift(); resto.push(0);
    if (f) for (let j = 0; j < n; j++) resto[j] ^= mul(g[j + 1], f);
  }
  return resto;
}

function bytesDeTexto(s) { return new TextEncoder().encode(s); }

function escolherVersao(nBytes) {
  for (let v = 1; v <= 40; v++) {
    const bitsContador = v <= 9 ? 8 : 16;
    const necessario = Math.ceil((4 + bitsContador + nBytes * 8) / 8);
    if (necessario <= EC_POR_VERSAO[v - 1][2]) return v;
  }
  throw new Error('conteúdo grande demais pro QR');
}

function montarDados(bytes, v) {
  const [blocos, ecPorBloco, total] = EC_POR_VERSAO[v - 1];
  const bits = [];
  const push = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  push(0b0100, 4); push(bytes.length, v <= 9 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, total * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const dados = [];
  for (let i = 0; i < bits.length; i += 8) dados.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let k = 0; dados.length < total; k++) dados.push(k % 2 ? 0x11 : 0xec);
  // divide em blocos (os últimos blocos podem ter 1 byte a mais)
  const curto = Math.floor(total / blocos);
  const longos = total % blocos;
  const blocosD = []; const blocosE = [];
  let pos = 0;
  for (let i = 0; i < blocos; i++) {
    const tam = curto + (i >= blocos - longos ? 1 : 0);
    const d = dados.slice(pos, pos + tam); pos += tam;
    blocosD.push(d); blocosE.push(reedSolomon(d, ecPorBloco));
  }
  const saida = [];
  for (let i = 0; i <= curto; i++) for (const d of blocosD) if (i < d.length) saida.push(d[i]);
  for (let i = 0; i < ecPorBloco; i++) for (const e of blocosE) saida.push(e[i]);
  return saida;
}

function matrizBase(v) {
  const n = v * 4 + 17;
  const m = Array.from({ length: n }, () => new Array(n).fill(null)); // null = livre
  const fixo = (r, c, val) => { if (r >= 0 && r < n && c >= 0 && c < n) m[r][c] = val; };
  const finder = (r0, c0) => {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
      const borda = r === -1 || r === 7 || c === -1 || c === 7;
      const anel = r === 0 || r === 6 || c === 0 || c === 6;
      const centro = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      fixo(r0 + r, c0 + c, borda ? 0 : anel || centro ? 1 : 0);
    }
  };
  finder(0, 0); finder(0, n - 7); finder(n - 7, 0);
  const al = ALINHAMENTO[v - 1];
  for (const r of al) for (const c of al) {
    if (m[r][c] !== null) continue; // colide com um finder
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) fixo(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1 ? 1 : 0);
  }
  for (let i = 8; i < n - 8; i++) { if (m[6][i] === null) fixo(6, i, i % 2 === 0 ? 1 : 0); if (m[i][6] === null) fixo(i, 6, i % 2 === 0 ? 1 : 0); }
  // áreas reservadas de formato (e versão) ficam marcadas como 0 por enquanto
  for (let i = 0; i < 8; i++) { fixo(8, i, 0); fixo(i, 8, 0); fixo(8, n - 1 - i, 0); fixo(n - 1 - i, 8, 0); }
  fixo(8, 8, 0); fixo(n - 8, 8, 1);
  if (v >= 7) for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) { fixo(i, n - 11 + j, 0); fixo(n - 11 + j, i, 0); }
  return m;
}

function colocarDados(m, bytes) {
  const n = m.length;
  const bits = [];
  for (const b of bytes) for (let i = 7; i >= 0; i--) bits.push((b >> i) & 1);
  let k = 0;
  let sobe = true;
  for (let c = n - 1; c > 0; c -= 2) {
    if (c === 6) c--;
    for (let i = 0; i < n; i++) {
      const r = sobe ? n - 1 - i : i;
      for (const dc of [0, -1]) if (m[r][c + dc] === null) m[r][c + dc] = { d: bits[k++] || 0 };
    }
    sobe = !sobe;
  }
}

const MASCARAS = [
  (r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0, (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function bch(valor, bitsValor, poli, bitsPoli) {
  let v = valor << (bitsPoli - 1);
  for (let i = bitsValor + bitsPoli - 2; i >= bitsPoli - 1; i--) if (v & (1 << i)) v ^= poli << (i - (bitsPoli - 1));
  return v;
}

function aplicarFormato(m, mask, v) {
  const n = m.length;
  const dado = (NIVEL << 3) | mask; // M = 00
  const f = ((dado << 10) | bch(dado, 5, 0b10100110111, 11)) ^ 0b101010000010010;
  const bit = (i) => (f >> i) & 1;
  for (let i = 0; i < 6; i++) { m[8][i] = bit(14 - i); m[i][8] = bit(i); }
  m[8][7] = bit(8); m[8][8] = bit(7); m[7][8] = bit(6);
  for (let i = 0; i < 8; i++) { m[8][n - 1 - i] = bit(i); m[n - 1 - i][8] = bit(14 - i); }
  m[n - 8][8] = 1;
  if (v >= 7) {
    const vv = (v << 12) | bch(v, 6, 0b1111100100101, 13);
    for (let i = 0; i < 18; i++) { const b = (vv >> i) & 1; m[Math.floor(i / 3)][n - 11 + (i % 3)] = b; m[n - 11 + (i % 3)][Math.floor(i / 3)] = b; }
  }
}

function penalidade(m) {
  const n = m.length;
  let p = 0;
  for (let r = 0; r < n; r++) for (let c = 0, run = 0, ant = -1; c < n; c++) { if (m[r][c] === ant) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else { ant = m[r][c]; run = 1; } }
  for (let c = 0; c < n; c++) for (let r = 0, run = 0, ant = -1; r < n; r++) { if (m[r][c] === ant) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else { ant = m[r][c]; run = 1; } }
  for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) if (m[r][c] === m[r][c + 1] && m[r][c] === m[r + 1][c] && m[r][c] === m[r + 1][c + 1]) p += 3;
  let escuros = 0;
  for (const l of m) for (const x of l) escuros += x;
  p += Math.floor(Math.abs((escuros * 100) / (n * n) - 50) / 5) * 10;
  return p;
}

/** @returns {number[][]} matriz 0/1 */
export function gerarQR(texto) {
  const bytes = bytesDeTexto(texto);
  const v = escolherVersao(bytes.length);
  const dados = montarDados(bytes, v);
  let melhor = null;
  for (let mask = 0; mask < 8; mask++) {
    const m = matrizBase(v);
    colocarDados(m, dados);
    const n = m.length;
    const out = m.map((linha, r) => linha.map((cel, c) => (cel && typeof cel === 'object' ? (MASCARAS[mask](r, c) ? cel.d ^ 1 : cel.d) : cel)));
    aplicarFormato(out, mask, v);
    const p = penalidade(out);
    if (!melhor || p < melhor.p) melhor = { p, out };
  }
  return melhor.out;
}

/** SVG do QR (markup só com números, seguro pra inserir). */
export function svgQR(matriz, { margem = 2 } = {}) {
  const n = matriz.length + margem * 2;
  let caminho = '';
  matriz.forEach((l, r) => l.forEach((v, c) => { if (v) caminho += `M${c + margem} ${r + margem}h1v1h-1z`; }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img" aria-label="QR Code do Pix"><rect width="${n}" height="${n}" fill="#fff"/><path d="${caminho}" fill="#000"/></svg>`;
}
