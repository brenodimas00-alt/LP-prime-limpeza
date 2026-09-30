// Roda os scripts de teste e resume, com o tempo de cada um no fim.
//   node scripts/roda-testes.mjs [--rapido]  durante o trabalho: só Node, sem navegador e sem banco (paralelo).
//   node scripts/roda-testes.mjs --entrega    antes de cada commit: rápido + navegador no mock (paralelo) + banco de homologação (em fila).
//   node scripts/roda-testes.mjs --completo   fim do bloco: entrega + preview do Pages + Lighthouse de performance (faça o deploy do preview antes).
// --homolog é o antigo nome do --completo. --so a,b roda só esses scripts (no grupo certo de cada um).
// Paralelo só onde não há banco real: os de homologação dividem o mesmo Supabase (config, relógio, limites) e rodam um por vez,
// ao lado dos locais. O Lighthouse de performance roda sozinho no fim (CPU disputada derruba a nota).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cpus } from 'node:os';

const arg = (n) => process.argv.includes(n);
const modo = arg('--completo') || arg('--homolog') ? 'completo' : arg('--entrega') ? 'entrega' : 'rapido';
const so = (() => { const i = process.argv.indexOf('--so'); return i > 0 ? process.argv[i + 1].split(',') : null; })();

const NODE = [
  'testa-dominio', 'testa-validacao', 'testa-pacote', 'testa-agenda', 'testa-brcode', 'testa-app', 'testa-http', 'testa-aut', 'testa-provedores', 'testa-whatsapp',
  'verifica-templates', 'verifica-texto', 'verifica-seo', 'testa-b0', 'testa-pdf', 'testa-csv',
];
const NAVEGADOR = ['compara-home', 'testa-home-navegador', 'testa-e0-navegador', 'testa-e1-navegador', 'testa-e3-navegador', 'testa-e4-navegador', 'testa-e5-navegador', 'testa-e6-navegador', 'testa-e7-fluxos', 'testa-f0-navegador', 'lighthouse-a11y'];
const BANCO = ['testa-rls', 'testa-papeis', 'testa-auth', 'testa-l1', 'testa-importacao', 'testa-paridade', 'testa-b3', 'testa-agendamento-homolog', 'testa-aut-homolog', 'testa-b6', 'testa-agenda-p2', 'testa-pagamentos-p3', 'testa-atendimento-p4', 'testa-profissionais-p5', 'testa-relacionamento-p6', 'testa-protecao-p7', 'testa-indicadores-p1'];
const PREVIEW = ['testa-b0-preview', 'testa-b2-preview', 'testa-f2-preview', 'testa-i1-preview', 'testa-redirects', 'testa-q1-preview', 'testa-aut-preview', 'testa-bloco3-preview'];
const SOZINHO = ['lighthouse-q1'];

const filtra = (l) => (so ? l.filter((s) => so.includes(s)) : l);
const locais = filtra(modo === 'rapido' ? NODE : [...NODE, ...NAVEGADOR]);
const fila = filtra(modo === 'rapido' ? [] : modo === 'entrega' ? BANCO : [...BANCO, ...PREVIEW]);
const fim = filtra(modo === 'completo' ? SOZINHO : []);
if (so) for (const s of so) if (![...locais, ...fila, ...fim].includes(s)) console.log(`aviso: ${s} não faz parte do modo ${modo}`);

const libs = `${process.env.HOME}/.cache/pw-libs/root/usr/lib/x86_64-linux-gnu`;
// RODA_TESTES: o script sabe que veio daqui; TESTES_COMPLETOS: casos lentos (ex. upload que espera o gateway) só no --completo
const env = {
  ...process.env, RODA_TESTES: '1', ...(modo === 'completo' ? { TESTES_COMPLETOS: '1' } : {}),
  LD_LIBRARY_PATH: existsSync(libs) ? `${libs}:${process.env.LD_LIBRARY_PATH || ''}` : process.env.LD_LIBRARY_PATH,
};
const NAV_MAX = 4; // Chromium pesa na memória: no máximo 4 navegadores ao mesmo tempo
const resultados = [];

function rodar(s) {
  const node22 = BANCO.includes(s) || PREVIEW.includes(s) || SOZINHO.includes(s);
  const [cmd, args] = node22 ? ['bash', ['scripts/cli.sh', 'node22', `scripts/${s}.mjs`]] : ['node', [`scripts/${s}.mjs`]];
  const limite = node22 ? 900000 : 600000;
  return new Promise((ok) => {
    const ini = Date.now();
    const p = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let saida = '';
    p.stdout.on('data', (d) => { saida += d; });
    p.stderr.on('data', (d) => { saida += d; });
    const relogio = setTimeout(() => { saida += `\nFALHOU: tempo esgotado (${limite / 1000}s)`; p.kill('SIGKILL'); }, limite);
    p.on('close', (code) => {
      clearTimeout(relogio);
      const resumo = saida.split('\n').filter((l) => /passaram|IDÊNTICA|DIFERENTE|acessibilidade|verifica-|FALHOU|lighthouse-q1|pulado/.test(l)).map((l) => l.trim()).join(' | ');
      const r = { s, ok: code === 0, t: (Date.now() - ini) / 1000, resumo, saida };
      resultados.push(r);
      console.log(`${r.ok ? 'ok  ' : 'FALHA'} ${s} (${r.t.toFixed(0)}s) ${resumo.slice(0, 160)}`);
      ok(r);
    });
  });
}

// Pool simples: até `max` ao mesmo tempo, navegador limitado a NAV_MAX.
async function pool(lista, max) {
  const pendentes = [...lista];
  let nav = 0;
  const rodando = new Set();
  while (pendentes.length || rodando.size) {
    const i = pendentes.findIndex((s) => !NAVEGADOR.includes(s) || nav < NAV_MAX);
    if (i >= 0 && rodando.size < max) {
      const s = pendentes.splice(i, 1)[0];
      const eNav = NAVEGADOR.includes(s);
      if (eNav) nav++;
      const p = rodar(s).then(() => { rodando.delete(p); if (eNav) nav--; });
      rodando.add(p);
    } else await Promise.race(rodando);
  }
}

const ini = Date.now();
console.log(`modo ${modo}: ${locais.length} locais em paralelo${fila.length ? `, ${fila.length} de homologação em fila` : ''}${fim.length ? `, ${fim.length} no fim sozinho` : ''}\n`);
await Promise.all([
  pool(locais, Math.max(2, cpus().length - 2)),
  (async () => { for (const s of fila) await rodar(s); })(),
]);
for (const s of fim) await rodar(s);

const falhas = resultados.filter((r) => !r.ok);
for (const f of falhas) console.log(`\n===== saída de ${f.s} (últimas 40 linhas)\n${f.saida.trim().split('\n').slice(-40).join('\n')}`);
console.log('\ntempo por script (maior primeiro):');
for (const r of [...resultados].sort((a, b) => b.t - a.t)) console.log(`  ${r.t.toFixed(1).padStart(6)}s  ${r.ok ? '' : 'FALHA '}${r.s}`);
console.log(`\n${resultados.length - falhas.length}/${resultados.length} scripts verdes em ${((Date.now() - ini) / 1000).toFixed(0)}s (modo ${modo})${falhas.length ? `. FALHARAM: ${falhas.map((f) => f.s).join(', ')}` : ''}`);
process.exit(falhas.length ? 1 : 0);
