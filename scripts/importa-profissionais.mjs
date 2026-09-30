// P5: importação das profissionais que já trabalham com a Prime (planilha em ~/.prime-dados, fora do repo), no padrão da
// importação de clientes. PADRÃO É SIMULAÇÃO: só lê e mostra contagens. Pra gravar: --importar. Nunca imprime nome, CPF,
// e-mail ou telefone.
// Uso: bash scripts/cli.sh node22 scripts/importa-profissionais.mjs [--importar] [--arquivo <xlsx>] [--ficticio]
//      bash scripts/cli.sh node22 scripts/importa-profissionais.mjs --modelo <xlsx>   (gera a planilha modelo, vazia)
// Colunas: Nome completo | CPF (só números) | Telefone | E-mail | Data de nascimento (dd/mm/aaaa) | Regiões | Dias | Turnos
//  (Regiões, Dias e Turnos opcionais, separados por vírgula: "BH - Oeste, Contagem" | "seg, ter, sab" | "manhã, tarde").
// Regras: idempotente pelo CPF (rodar de novo não duplica nem sobrescreve quem já está no sistema); CPF inválido ou
// vazio não entra (só conta); CPF repetido na planilha: só a primeira linha; entra APROVADA, origem "importada", SEM
// acesso (a Prime cria o acesso quando a regra de login das profissionais for definida; PENDENCIAS); o aceite dos
// termos é pedido no primeiro login. Telefone ou nascimento inválido: entra sem o dado e fica marcado pra revisar.
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const COLUNAS = ['Nome completo', 'CPF (só números)', 'Telefone', 'E-mail', 'Data de nascimento', 'Regiões', 'Dias', 'Turnos'];
const DIAS = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6, 'sáb': 6 };
const TURNOS = { manha: 'manha', 'manhã': 'manha', tarde: 'tarde', integral: 'integral' };
const texto = (v) => (v === null || v === undefined ? '' : typeof v === 'object' ? String(v.text ?? v.result ?? (v instanceof Date ? v.toISOString() : '')).trim() : String(v).trim());

export function cpfValido(d) {
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  for (const n of [9, 10]) { let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i); if (((s * 10) % 11) % 10 !== Number(d[n])) return false; }
  return true;
}
function data(dmy) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dmy);
  if (!m) return null;
  const dt = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  return dt.getUTCDate() === +m[1] && dt.getUTCMonth() === +m[2] - 1 && +m[3] > 1900 && dt < new Date() ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** Linhas -> plano. PURA. regioesValidas: lista oficial (configuracao.regioes_diarista). */
export function planejar(linhas, regioesValidas) {
  const vistos = new Set(); const plano = []; const ignorados = { cpf_invalido: 0, cpf_repetido: 0 };
  for (const l of linhas) {
    const cpf = l.cpf.replace(/\D/g, '').padStart(l.cpf.replace(/\D/g, '').length ? 11 : 0, '0');
    if (!cpfValido(cpf)) { ignorados.cpf_invalido++; continue; }
    if (vistos.has(cpf)) { ignorados.cpf_repetido++; continue; }
    vistos.add(cpf);
    const revisar = [];
    let tel = l.telefone.replace(/\D/g, ''); if (tel.startsWith('55') && tel.length > 11) tel = tel.slice(2);
    if (!/^\d{10,11}$/.test(tel)) { revisar.push('telefone'); tel = null; }
    const email = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(l.email) ? l.email.toLowerCase() : (l.email ? (revisar.push('email'), null) : null);
    const nasc = data(l.nascimento); if (l.nascimento && !nasc) revisar.push('nascimento');
    const regioes = l.regioes.split(',').map((x) => x.trim()).filter(Boolean);
    const dias = l.dias.split(',').map((x) => DIAS[x.trim().toLowerCase().slice(0, 3)]).filter((x) => x !== undefined);
    const turnos = l.turnos.split(',').map((x) => TURNOS[x.trim().toLowerCase()]).filter(Boolean);
    if (regioes.some((r) => !regioesValidas.includes(r))) revisar.push('regioes');
    const disp = { dias: [...new Set(dias)].sort(), turnos: [...new Set(turnos)], regioes: regioes.filter((r) => regioesValidas.includes(r)) };
    if (!tel) { ignorados.sem_telefone = (ignorados.sem_telefone || 0) + 1; }
    plano.push({ linha: l.linha, cpf, nome: l.nome.slice(0, 120), telefone: tel, email, nascimento: nasc, disponibilidade: disp, revisar });
  }
  return { plano: plano.filter((p) => p.telefone && p.nome.length >= 2), ignorados: { ...ignorados, sem_nome: plano.filter((p) => p.nome.length < 2).length } };
}

export async function lerPlanilha(caminho) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(caminho);
  const ws = wb.worksheets[0];
  const cab = ws.getRow(1).values.slice(1).map(texto);
  const col = (n, opcional) => { const i = cab.indexOf(n); if (i < 0 && !opcional) throw new Error(`coluna "${n}" não encontrada na planilha`); return i + 1; };
  const C = COLUNAS.map((n, i) => col(n, i >= 5));
  const linhas = [];
  ws.eachRow((r, n) => {
    if (n === 1) return;
    const v = (c) => (c ? r.getCell(c).value : '');
    const cpf = typeof v(C[1]) === 'number' ? String(v(C[1])) : texto(v(C[1]));
    linhas.push({ linha: n, nome: texto(v(C[0])), cpf, telefone: texto(v(C[2])), email: texto(v(C[3])), nascimento: texto(v(C[4])), regioes: texto(v(C[5])), dias: texto(v(C[6])), turnos: texto(v(C[7])) });
  });
  return linhas;
}

export async function gerarModelo(caminho) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Profissionais').addRow(COLUNAS);
  await wb.xlsx.writeFile(caminho);
}

/** Grava: novas entram; CPF que já existe não muda (idempotente). */
export async function executar(plano, { ficticio = false } = {}) {
  const { transacao } = await import('./lib-supabase.mjs');
  let criadas = 0; let jaExistiam = 0;
  await transacao(async (q) => {
    for (const p of plano) {
      const [r] = await q(`insert into public.diaristas (nome, cpf, telefone, email, data_nascimento, disponibilidade, status, origem, importacao, ficticio,
          historico, decisao)
        values ($1, $2, $3, (select $4 where not exists (select 1 from public.diaristas where email = $4)), $5::date, $6::jsonb, 'aprovada', 'importada',
          jsonb_build_object('em', now(), 'linha', $7::int, 'revisar', $8::jsonb), $9,
          jsonb_build_array(jsonb_build_object('de', null, 'para', 'aprovada', 'evento', 'importacao', 'em', now(), 'ator', 'sistema')),
          jsonb_build_object('em', now(), 'importada', true))
        on conflict (cpf) do nothing returning id`,
      [p.nome, p.cpf, p.telefone, p.email, p.nascimento, JSON.stringify(p.disponibilidade), p.linha, JSON.stringify(p.revisar), ficticio]);
      if (r) criadas++; else jaExistiam++;
    }
  }, { ator: 'importacao_profissionais' });
  return { criadas, jaExistiam };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
  if (arg('--modelo')) { await gerarModelo(arg('--modelo')); console.log('modelo gerado'); process.exit(0); }
  const { sql, fecharSql } = await import('./lib-supabase.mjs');
  const importar = process.argv.includes('--importar');
  const ficticio = process.argv.includes('--ficticio');
  const arquivo = arg('--arquivo') || `${homedir()}/.prime-dados/profissionais.xlsx`;
  const [{ valor: regioes }] = await sql(`select valor from public.configuracao where chave = 'regioes_diarista'`);
  const linhas = await lerPlanilha(arquivo);
  const { plano, ignorados } = planejar(linhas, regioes);
  const cpfs = new Set((await sql('select cpf from public.diaristas where cpf = any($1)', [plano.map((p) => p.cpf)])).map((x) => x.cpf));
  const revisar = {}; for (const p of plano) for (const r of p.revisar) revisar[r] = (revisar[r] || 0) + 1;
  console.log(JSON.stringify({ modo: importar ? 'IMPORTAÇÃO' : 'SIMULAÇÃO (nada gravado)', linhas: linhas.length, entram: plano.filter((p) => !cpfs.has(p.cpf)).length, jaNoSistema: cpfs.size, ignorados, revisar }, null, 1));
  if (importar) console.log(JSON.stringify({ resultado: await executar(plano, { ficticio }) }, null, 1));
  await fecharSql();
}
