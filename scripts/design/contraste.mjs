// Design system (D8): contraste de TODOS os pares de cor que as páginas usam de verdade (texto sobre fundo, borda de
// controle, foco), lidos de src/ui/tokens.css, e a paleta de dados distinguível em simulação de daltonismo.
// AA: texto 4,5:1; texto grande e componente/foco 3:1 (WCAG 1.4.3 e 1.4.11). Uso: node scripts/design/contraste.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const css = readFileSync(fileURLToPath(new URL('../../src/ui/tokens.css', import.meta.url)), 'utf8');
const raiz = css.slice(css.indexOf(':root{'), css.indexOf('\n}', css.indexOf(':root{')));
const tok = Object.fromEntries([...raiz.matchAll(/--([a-z0-9-]+):([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const cor = (n) => { let v = tok[n]; for (let i = 0; i < 5 && v?.startsWith('var('); i++) v = tok[v.slice(6, -1)]; if (!/^#[0-9a-f]{6}$/i.test(v || '')) throw new Error(`token ${n} sem cor sólida: ${v}`); return v; };

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (h) => { const [r, g, b] = rgb(h).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const razao = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// [frente, fundo, mínimo, onde aparece]
const T = 4.5; const G = 3;
const FUNDOS_CLAROS = ['cor-fundo', 'cor-superficie', 'cor-fundo-sutil', 'neutro-50'];
const PARES = [
  ...FUNDOS_CLAROS.flatMap((f) => [['cor-texto', f, T, 'texto'], ['cor-texto-2', f, T, 'texto de apoio'], ['cor-titulo', f, T, 'título e link'], ['dourado-700', f, T, 'sobretítulo e número de etapa'],
    ['cor-borda-campo', f, G, 'borda de campo e controle'], ['cor-foco', f, G, 'contorno de foco'], ['erro-texto', f, T, 'erro de campo'], ['sucesso-texto', f, T, 'confirmação']]),
  ['cor-titulo', 'marinho-50', T, 'item selecionado'], ['cor-texto-2', 'marinho-50', T, 'apoio em item selecionado'], ['marinho-600', 'marinho-50', T, 'apoio em opção escolhida'],
  ['cor-acao-texto', 'cor-acao', T, 'botão principal'], ['cor-acao-texto', 'cor-acao-hover', T, 'botão principal (hover)'],
  ['sucesso-texto', 'sucesso-fundo', T, 'selo e alerta de sucesso'], ['atencao-texto', 'atencao-fundo', T, 'selo e alerta de atenção'], ['erro-texto', 'erro-fundo', T, 'selo e alerta de erro'],
  ['info-texto', 'info-fundo', T, 'selo e alerta de informação'], ['neutro-estado-texto', 'neutro-estado-fundo', T, 'selo neutro'], ['atencao-texto', 'cor-superficie', T, 'pagamento pendente'],
  ['dourado-800', 'dourado-50', T, 'selo de sugestão'], ['neutro-0', 'erro-solido', T, 'contagem urgente'], ['neutro-700', 'neutro-100', T, 'contagem'],
  ['neutro-0', 'neutro-900', T, 'toast'], ['neutro-0', 'erro-texto', T, 'toast de erro'], ['neutro-0', 'sucesso-texto', T, 'toast de sucesso'],
  ['cor-escuro-texto', 'cor-escuro', T, 'texto na faixa escura'], ['cor-escuro-texto-2', 'cor-escuro', T, 'apoio na faixa escura'], ['dourado-300', 'cor-escuro', T, 'título do rodapé'],
  ['marinho-700', 'neutro-0', T, 'botão claro na faixa escura'], ['cor-foco-escuro', 'cor-escuro', G, 'foco na faixa escura'], ['marinho-300', 'cor-escuro', G, 'borda do botão na faixa escura'],
  ['erro-solido', 'cor-superficie', G, 'barra de urgência'], ['cor-acao', 'neutro-200', G, 'barra de progresso'],
];
let falhas = 0;
for (const [a, b, min, onde] of PARES) {
  const r = razao(cor(a), cor(b));
  if (r < min) { falhas++; console.log(`FALHA ${a} sobre ${b}: ${r.toFixed(2)} (mínimo ${min}) · ${onde}`); }
}
console.log(`contraste: ${PARES.length - falhas}/${PARES.length} pares no mínimo AA`);

// paleta de dados: cada par distinguível (ΔE em Lab ≥ 15) na visão normal e em protanopia, deuteranopia e tritanopia
// (matrizes de Machado, Oliveira e Fernandes, 2009, severidade 1)
const SIM = {
  normal: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};
const lab = ([r, g, b]) => {
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047; const y = 0.2126 * r + 0.7152 * g + 0.0722 * b; const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
};
const simular = (h, m) => { const c = rgb(h).map(lin); return m.map((l) => Math.min(1, Math.max(0, l[0] * c[0] + l[1] * c[1] + l[2] * c[2]))); };
const dados = [1, 2, 3, 4, 5].map((i) => cor(`dado-${i}`));
let piorDe = Infinity; let piorOnde = '';
for (const [nome, m] of Object.entries(SIM)) {
  for (let i = 0; i < dados.length; i++) for (let j = i + 1; j < dados.length; j++) {
    const [p, q] = [lab(simular(dados[i], m)), lab(simular(dados[j], m))];
    const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    if (d < piorDe) { piorDe = d; piorOnde = `${nome}: dado-${i + 1} x dado-${j + 1}`; }
    if (d < 15) { falhas++; console.log(`FALHA paleta de dados em ${nome}: dado-${i + 1} x dado-${j + 1} ΔE ${d.toFixed(1)} (mínimo 15)`); }
  }
}
console.log(`paleta de dados: menor ΔE ${piorDe.toFixed(1)} (${piorOnde})`);
process.exit(falhas ? 1 : 0);
