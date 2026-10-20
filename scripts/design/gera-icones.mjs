// Design system (D2): gera src/ui/ds/icones.js, o conjunto ÚNICO de ícones da Prime, a partir do Lucide (ISC).
// O Lucide não é dependência do projeto: baixe numa pasta à parte e aponte LUCIDE_DIR.
// Uso: npm pack lucide-static@0.460.0 && tar xzf lucide-static-0.460.0.tgz -C /tmp/lucide
//      LUCIDE_DIR=/tmp/lucide/package/icons node scripts/design/gera-icones.mjs
// Também atualiza os SVGs dos .html marcados com data-icone="nome" (mesmo desenho do módulo).
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const DIR = process.env.LUCIDE_DIR;
if (!DIR) { console.error('defina LUCIDE_DIR (pasta icons do lucide-static)'); process.exit(2); }

// nome na Prime → nome no Lucide. Pra incluir um ícone: uma linha aqui e rodar de novo.
const MAPA = {
  // navegação e ações
  inicio: 'house', solicitacoes: 'file-text', agenda: 'calendar', clientes: 'user', profissionais: 'users', financeiro: 'circle-dollar-sign',
  gestao: 'chart-column', config: 'settings', ajuda: 'circle-help', mais: 'ellipsis', menu: 'menu', busca: 'search', sino: 'bell',
  check: 'check', fechar: 'x', seta: 'arrow-right', voltar: 'arrow-left', abaixo: 'chevron-down', acima: 'chevron-up', direita: 'chevron-right',
  esquerda: 'chevron-left', externo: 'arrow-up-right', enviar: 'send', baixar: 'download', subir: 'upload', publicar: 'megaphone', sair: 'log-out',
  editar: 'pencil', lixeira: 'trash-2', filtro: 'sliders-horizontal', recarregar: 'refresh-cw', olho: 'eye', olho_fechado: 'eye-off', cadeado: 'lock',
  menos: 'minus', mais_sinal: 'plus', ponto: 'circle',
  // estado
  relogio: 'clock', alerta: 'triangle-alert', info: 'info', ok: 'circle-check', erro: 'circle-x', aviso: 'circle-alert', ampulheta: 'hourglass',
  // assunto
  zap: 'message-circle', telefone: 'phone', email: 'mail', instagram: 'instagram', local: 'map-pin', mapa: 'map', pessoa: 'user',
  usuario_mais: 'user-plus', usuario_ok: 'user-round-check', documento: 'file', recibo: 'receipt', cartao: 'credit-card', carteira: 'wallet',
  dinheiro_mao: 'hand-coins', calendario_x: 'calendar-x', calendario_ok: 'calendar-check', meta: 'target', rosca: 'chart-pie', troca: 'repeat',
  robo: 'list-checks', prancheta: 'clipboard-check', escudo: 'shield-check', verificado: 'badge-check', aperto: 'heart-handshake', lampada: 'lightbulb',
  estrela: 'star', camera: 'camera', foto: 'image',
  // serviços e habilidades (mesmo traço)
  casa: 'house', predio: 'building-2', ferro: 'shirt', caixa: 'package', festa: 'party-popper', vassoura: 'brush', carro: 'car',
};

const corpo = (lucide) => {
  const svg = readFileSync(join(DIR, `${lucide}.svg`), 'utf8');
  return [...svg.matchAll(/<(path|circle|rect|line|polyline|polygon|ellipse)\b([^>]*?)\s*\/>/g)].map((m) => `<${m[1]}${m[2].replace(/\s+/g, ' ')}/>`).join('');
};
const ICONES = Object.fromEntries(Object.entries(MAPA).map(([k, v]) => [k, corpo(v)]));

const modulo = `// GERADO por scripts/design/gera-icones.mjs a partir do Lucide v0.460.0 (ISC, https://lucide.dev). Não editar à mão.
// O conjunto ÚNICO de ícones da Prime: traço fino, pontas arredondadas, 16, 20 ou 24 px, cor do texto (currentColor).
// Regra: ícone acompanha texto (aria-hidden) ou tem nome acessível (rotulo). Lint: scripts/design/lint-design.mjs.

export const ICONES = {
${Object.entries(ICONES).map(([k, v]) => `  ${k}: '${v}',`).join('\n')}
};

const TRACO = { 16: 2, 20: 1.75, 24: 1.5 };

/** Markup do ícone (HTML estático e módulos que montam string). */
export function iconeHTML(nome, { tamanho = 20, rotulo, classe = '' } = {}) {
  const a11y = rotulo ? \`role="img" aria-label="\${String(rotulo).replace(/[&"<>]/g, (c) => \`&#\${c.charCodeAt(0)};\`)}"\` : 'aria-hidden="true"';
  return \`<svg class="ic ic-\${tamanho}\${classe ? \` \${classe}\` : ''}" data-icone="\${nome}" viewBox="0 0 24 24" width="\${tamanho}" height="\${tamanho}" fill="none" stroke="currentColor" stroke-width="\${TRACO[tamanho] || 1.75}" stroke-linecap="round" stroke-linejoin="round" focusable="false" \${a11y}>\${ICONES[nome] || ICONES.ponto}</svg>\`;
}

/** Ícone como elemento. */
export function icone(nome, op) {
  const t = document.createElement('template');
  t.innerHTML = iconeHTML(nome, op); // eslint-disable-line no-unsanitized/property -- só constantes do código
  return t.content.firstChild;
}
`;
mkdirSync(join(RAIZ, 'src/ui/ds'), { recursive: true });
writeFileSync(join(RAIZ, 'src/ui/ds/icones.js'), modulo);

// HTML estático: troca cada <svg ... data-icone="x" ...>...</svg> pelo desenho do conjunto
const { iconeHTML } = await import(`${join(RAIZ, 'src/ui/ds/icones.js')}?v=${Date.now()}`);
let html = 0;
function listar(dir, acc = []) {
  for (const n of readdirSync(dir)) {
    if (['node_modules', 'dist', '.git', 'docs', 'painel-proposta', 'supabase', 'scripts', 'vendor'].includes(n)) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) listar(p, acc); else if (n.endsWith('.html')) acc.push(p);
  }
  return acc;
}
for (const arq of listar(RAIZ)) {
  const txt = readFileSync(arq, 'utf8');
  const novo = txt.replace(/<svg\b[^>]*data-icone="([a-z0-9_]+)"[^>]*>[\s\S]*?<\/svg>/g, (m, nome) => {
    const tamanho = Number(m.match(/\bic-(16|20|24)\b/)?.[1] || 20);
    const rotulo = m.match(/aria-label="([^"]*)"/)?.[1];
    const classe = (m.match(/class="([^"]*)"/)?.[1] || '').split(/\s+/).filter((c) => c && !/^ic(-\d+)?$/.test(c)).join(' ');
    return iconeHTML(nome, { tamanho, rotulo, classe });
  });
  if (novo !== txt) { writeFileSync(arq, novo); html++; }
}
console.log(`ícones: ${Object.keys(ICONES).length} no conjunto; ${html} página(s) HTML atualizada(s)`);
