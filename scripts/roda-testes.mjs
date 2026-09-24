// Roda todos os scripts de teste em sequência e resume. node scripts/roda-testes.mjs [--rapido] [--homolog]
// --rapido pula os de navegador (Playwright) e o Lighthouse.
// --homolog roda TAMBÉM os testes contra o Supabase de homologação e o preview (Node 22 via scripts/cli.sh; só dados fictícios).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const rapido = process.argv.includes('--rapido');
const homolog = process.argv.includes('--homolog');
const HOMOLOG = ['testa-rls', 'testa-auth', 'testa-importacao', 'testa-paridade', 'testa-b3', 'testa-b0-preview', 'testa-b2-preview'];
const NODE = [
  'testa-dominio', 'testa-validacao', 'testa-pacote', 'testa-brcode', 'testa-app', 'testa-http', 'testa-automacoes', 'testa-whatsapp',
  'verifica-templates', 'verifica-texto', 'testa-b0',
];
const NAVEGADOR = ['compara-home', 'testa-home-navegador', 'testa-e0-navegador', 'testa-e1-navegador', 'testa-e3-navegador', 'testa-e4-navegador', 'testa-e5-navegador', 'testa-e6-navegador', 'testa-e7-fluxos', 'testa-f0-navegador', 'lighthouse-a11y'];
const libs = `${process.env.HOME}/.cache/pw-libs/root/usr/lib/x86_64-linux-gnu`;
const env = { ...process.env, LD_LIBRARY_PATH: existsSync(libs) ? `${libs}:${process.env.LD_LIBRARY_PATH || ''}` : process.env.LD_LIBRARY_PATH };
const resultados = [];
for (const s of [...(rapido ? NODE : [...NODE, ...NAVEGADOR]), ...(homolog ? HOMOLOG : [])]) {
  const ini = Date.now();
  const r = HOMOLOG.includes(s)
    ? spawnSync('bash', ['scripts/cli.sh', 'node22', `scripts/${s}.mjs`], { encoding: 'utf8', env, timeout: 900000 })
    : spawnSync('node', [`scripts/${s}.mjs`], { encoding: 'utf8', env, timeout: 600000 });
  const saida = (r.stdout || '') + (r.stderr || '');
  const resumo = saida.split('\n').filter((l) => /passaram|IDÊNTICA|DIFERENTE|acessibilidade|verifica-|FALHOU/.test(l)).map((l) => l.trim()).join(' | ');
  resultados.push({ s, ok: r.status === 0, t: ((Date.now() - ini) / 1000).toFixed(0), resumo });
  console.log(`${r.status === 0 ? 'ok  ' : 'FALHA'} ${s} (${resultados.at(-1).t}s) ${resumo.slice(0, 160)}`);
}
const falhas = resultados.filter((r) => !r.ok);
console.log(`\n${resultados.length - falhas.length}/${resultados.length} scripts verdes${falhas.length ? `. FALHARAM: ${falhas.map((f) => f.s).join(', ')}` : ''}`);
process.exit(falhas.length ? 1 : 0);
