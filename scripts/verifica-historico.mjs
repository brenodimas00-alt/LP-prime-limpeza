// B7 (aceite): nenhum dado real no HISTÓRICO do git. Varre todos os blobs de todos os commits e refs atrás de
// CPF/CNPJ, e-mail ou telefone da base real (lidos de ~/.prime-dados) e de qualquer planilha. Só imprime contagens.
// Uso: node scripts/verifica-historico.mjs
import { execFileSync, spawnSync } from 'node:child_process';
import { dadosReais, acharDadosReais } from './varre-segredos.mjs';

const reais = await dadosReais();
if (!reais) { console.error('Base real ausente em ~/.prime-dados: não dá pra conferir.'); process.exit(2); }
const objetos = execFileSync('git', ['rev-list', '--all', '--objects'], { encoding: 'utf8', maxBuffer: 256 << 20 }).split('\n').filter(Boolean);
const planilhas = objetos.filter((l) => /\.(xlsx|xls|xlsm|csv|ods)$/i.test(l.split(' ').slice(1).join(' ')));
const blobs = [...new Set(objetos.map((l) => l.split(' ')[0]))];
const tipos = spawnSync('git', ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], { input: blobs.join('\n'), encoding: 'utf8', maxBuffer: 256 << 20 }).stdout
  .split('\n').filter(Boolean).map((l) => l.split(' ')).filter(([, t, tam]) => t === 'blob' && +tam < 5_000_000).map(([o]) => o);
let comDado = 0;
for (const o of tipos) {
  const txt = execFileSync('git', ['cat-file', 'blob', o], { encoding: 'latin1', maxBuffer: 64 << 20 });
  if (acharDadosReais(txt, reais).length) comDado++;
}
console.log(JSON.stringify({ commitsVarridos: execFileSync('git', ['rev-list', '--all', '--count'], { encoding: 'utf8' }).trim(), blobs: tipos.length, blobsComDadoReal: comDado, planilhasNoHistorico: planilhas.length, itensDaBase: reais.size }));
process.exit(comDado || planilhas.length ? 1 : 0);
