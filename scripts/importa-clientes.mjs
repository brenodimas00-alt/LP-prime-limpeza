// B7: importação da base de clientes da Prime (planilha real em ~/.prime-dados, fora do repo).
// PADRÃO É SIMULAÇÃO: só lê e mostra contagens. Pra gravar: --importar. Nunca imprime nome, CPF, e-mail ou telefone.
// Uso: bash scripts/cli.sh node22 scripts/importa-clientes.mjs [--importar] [--arquivo <xlsx>] [--ficticio]
//  --ficticio: só pra testes (marca ficticio = true e exige e-mails @example.com).
// Regras (decisão da cliente, B7): senha = 6 primeiros dígitos do CPF/CNPJ (via Auth, com pepper), permanente;
// idempotente pelo documento; documento repetido = só a linha mais recente por "Cadastrado em", as outras vão pra revisão;
// sem e-mail, e-mail inválido, repetido ou já usado por outra conta = importa sem acesso; nascimento inválido = sem a data;
// sem CPF/CNPJ = não importa, só conta.
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

export const PENDENCIAS = {
  sem_email: 'sem e-mail', email_invalido: 'e-mail inválido', email_repetido: 'e-mail repetido na planilha',
  email_em_uso: 'e-mail já usado por outra conta', nascimento_invalido: 'data de nascimento inválida',
  telefone_invalido: 'telefone inválido', sem_endereco: 'sem endereço', endereco_revisar: 'endereço a revisar',
  documento_repetido: 'CPF/CNPJ repetido na planilha (outras linhas pra revisar)',
};
const SEM_ACESSO = ['sem_email', 'email_invalido', 'email_repetido', 'email_em_uso'];
const CIDADES_MG = ['belo horizonte', 'contagem', 'santa luzia', 'ribeirao das neves', 'sabara', 'betim', 'ibirite', 'vespasiano', 'nova lima'];
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

function texto(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return String(v.text ?? v.richText?.map((x) => x.text).join('') ?? v.result ?? '').trim();
  return String(v).trim();
}

/** Documento só com números; se a planilha guardou como número (perdendo zero à esquerda), recompõe pelo tipo. */
export function normalizarDocumento(bruto, tipo) {
  let d = String(bruto ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (!d) return null;
  const tam = tipo === 'CNPJ' ? 14 : 11;
  if (/^\d+$/.test(d) && d.length < tam) d = d.padStart(tam, '0');
  if (tipo === 'CNPJ' ? !/^[0-9A-Z]{12}\d{2}$/.test(d) : !/^\d{11}$/.test(d)) return null;
  return d;
}

export function lerData(ddmmaaaa) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(ddmmaaaa || '').trim());
  if (!m) return null;
  const [d, mes, a] = [+m[1], +m[2], +m[3]];
  const dt = new Date(Date.UTC(a, mes - 1, d));
  if (dt.getUTCFullYear() !== a || dt.getUTCMonth() !== mes - 1 || dt.getUTCDate() !== d || a < 1900 || dt > new Date()) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** "rua, número, bairro, cidade, UF" (formato da planilha, com variações). Guarda sempre o texto original. */
export function lerEndereco(bruto) {
  const textoOriginal = String(bruto || '').trim();
  if (!textoOriginal) return { endereco: {}, pendencias: ['sem_endereco'] };
  const p = textoOriginal.split(',').map((x) => x.trim());
  while (p.length && !p.at(-1)) p.pop();
  const base = { texto: textoOriginal, cep: '', complemento: '' };
  if (p.length < 4) return { endereco: base, pendencias: ['endereco_revisar'] };
  const ultimo = p.at(-1);
  let uf = ''; let cidade; let bairro;
  if (/^[A-Za-z]{2}$/.test(ultimo) && ultimo.toUpperCase() !== 'BH') { uf = ultimo.toUpperCase(); cidade = p.at(-2); bairro = p.slice(2, -2).join(', '); } else { cidade = ultimo.toUpperCase() === 'BH' ? 'Belo Horizonte' : ultimo; bairro = p.slice(2, -1).join(', '); }
  const endereco = { ...base, logradouro: p[0], numero: p[1], bairro, cidade, uf };
  if (!uf && CIDADES_MG.includes(semAcento(cidade))) { endereco.uf = 'MG'; endereco.ufInferida = true; }
  return { endereco, pendencias: endereco.uf && endereco.bairro ? [] : ['endereco_revisar'] };
}

/** Linhas da planilha -> registros (sem validar). */
export async function lerPlanilha(caminho) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(caminho);
  const ws = wb.worksheets[0];
  const cab = ws.getRow(1).values.slice(1).map(texto);
  const col = (nome) => { const i = cab.indexOf(nome); if (i < 0) throw new Error(`coluna "${nome}" não encontrada na planilha`); return i + 1; };
  const C = { tipo: col('Tipo'), doc: col('CPF/CNPJ (só números)'), nome: col('Nome completo'), nasc: col('Data de nascimento'), end: col('Endereço'), email: col('E-mail'), tel: col('Telefone'), cad: col('Cadastrado em') };
  const linhas = [];
  ws.eachRow((r, n) => {
    if (n === 1) return;
    const v = (c) => r.getCell(c).value;
    linhas.push({ linha: n, tipo: texto(v(C.tipo)).toUpperCase(), documentoBruto: typeof v(C.doc) === 'number' ? String(v(C.doc)) : texto(v(C.doc)), nome: texto(v(C.nome)), nascimento: texto(v(C.nasc)), endereco: texto(v(C.end)), email: texto(v(C.email)).toLowerCase(), telefone: texto(v(C.tel)).replace(/\D/g, ''), cadastradoEm: texto(v(C.cad)) });
  });
  return linhas;
}

/**
 * Decide o que fazer com cada linha. PURA (testável sem rede).
 * @param {object[]} linhas de lerPlanilha
 * @param {{emailsEmUso?:Set<string>}} op e-mails de contas que já existem no Auth e NÃO são desta importação
 */
export function planejar(linhas, { emailsEmUso = new Set() } = {}) {
  const ignorados = []; const porDoc = new Map();
  for (const l of linhas) {
    const tipo = l.tipo === 'CNPJ' || l.documentoBruto.replace(/\D/g, '').length === 14 ? 'CNPJ' : 'CPF';
    const documento = normalizarDocumento(l.documentoBruto, tipo);
    if (!documento) { ignorados.push({ linha: l.linha, motivo: l.documentoBruto ? 'documento_invalido' : 'sem_documento' }); continue; }
    const chave = `${tipo}:${documento}`;
    if (!porDoc.has(chave)) porDoc.set(chave, []);
    porDoc.get(chave).push({ ...l, tipo, documento });
  }
  const clientes = [];
  for (const grupo of porDoc.values()) {
    grupo.sort((a, b) => b.cadastradoEm.localeCompare(a.cadastradoEm) || b.linha - a.linha); // mais recente primeiro
    const [l, ...outras] = grupo;
    const pend = [];
    const nascimento = lerData(l.nascimento);
    if (l.nascimento && !nascimento) pend.push('nascimento_invalido');
    const telefone = /^\d{10,11}$/.test(l.telefone) ? l.telefone : null;
    if (!telefone) pend.push('telefone_invalido');
    const end = lerEndereco(l.endereco);
    pend.push(...end.pendencias);
    if (!l.email) pend.push('sem_email');
    else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(l.email) || l.email.length > 254) pend.push('email_invalido');
    if (outras.length) pend.push('documento_repetido');
    clientes.push({
      linha: l.linha, tipo: l.tipo === 'CNPJ' ? 'empresa' : 'residencial', tipoDocumento: l.tipo === 'CNPJ' ? 'cnpj' : 'cpf', documento: l.documento,
      nome: l.nome.slice(0, 120), email: l.email || null, telefone, dataNascimento: nascimento, endereco: end.endereco, pendencias: pend,
      importacao: { linha: l.linha, cadastradoEm: l.cadastradoEm, duplicatas: outras.map((o) => ({ linha: o.linha, nome: o.nome, email: o.email, telefone: o.telefone, cadastradoEm: o.cadastradoEm })) },
      revisao: outras.map((o) => o.linha),
    });
  }
  // e-mail repetido entre os que ficaram, ou já usado por outra conta: sem acesso
  const contagem = new Map();
  for (const c of clientes) if (c.email && !c.pendencias.includes('email_invalido')) contagem.set(c.email, (contagem.get(c.email) || 0) + 1);
  for (const c of clientes) {
    if (!c.email || c.pendencias.includes('email_invalido')) continue;
    if (contagem.get(c.email) > 1) c.pendencias.push('email_repetido');
    else if (emailsEmUso.has(c.email)) c.pendencias.push('email_em_uso');
  }
  for (const c of clientes) c.acesso = !c.pendencias.some((p) => SEM_ACESSO.includes(p));
  return { ignorados, clientes };
}

/** Contagens pra conferência com a planilha (só números). */
export function contar(linhas, plano) {
  const semAcesso = {}; const pendencias = {};
  for (const c of plano.clientes) {
    for (const p of c.pendencias) pendencias[p] = (pendencias[p] || 0) + 1;
    if (!c.acesso) { const m = c.pendencias.find((p) => SEM_ACESSO.includes(p)); semAcesso[m] = (semAcesso[m] || 0) + 1; }
  }
  const revisao = plano.clientes.reduce((s, c) => s + c.revisao.length, 0);
  const ignorados = {}; for (const i of plano.ignorados) ignorados[i.motivo] = (ignorados[i.motivo] || 0) + 1;
  return {
    linhas: linhas.length, clientes: plano.clientes.length, comAcesso: plano.clientes.filter((c) => c.acesso).length,
    semAcesso, linhasRepetidasParaRevisao: revisao, ignorados, pendencias,
    confere: plano.clientes.length + revisao + plano.ignorados.length === linhas.length,
  };
}

/** Grava no Supabase (service role). Idempotente: documento existente não é recriado; senha de conta existente nunca é trocada. */
/** Marca da importação no usuário do Auth (app_metadata): hash do documento, pra o CPF não ir no token. */
export const marcaDocumento = (documento) => createHash('sha256').update(`prime-importacao:${documento}`).digest('hex');

export async function executar(plano, { ficticio = false, concorrencia = 4, aoProgredir } = {}) {
  const { admin, sql, transacao, senhaDerivada } = await import('./lib-supabase.mjs');
  const r = { clientesCriados: 0, clientesJaExistiam: 0, acessosCriados: 0, acessosVinculados: 0, acessosJaExistiam: 0, semAcesso: 0, erros: 0 };
  let feitos = 0;
  async function um(c) {
    try {
      const [ins] = await transacao((q) => q(`insert into public.clientes (tipo, nome, telefone, email, tipo_documento, documento, endereco, data_nascimento, origem, pendencias, importacao, ficticio)
        values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, 'importado', $9, $10::jsonb, $11)
        on conflict (tipo_documento, documento) where documento is not null do nothing returning id`,
      [c.tipo, c.nome, c.telefone, c.email, c.tipoDocumento, c.documento, JSON.stringify(c.endereco), c.dataNascimento, c.pendencias, JSON.stringify(c.importacao), ficticio]), { ator: 'importacao' });
      if (ins) r.clientesCriados++; else r.clientesJaExistiam++;
      const [cli] = await sql('select id, usuario_id, email, origem from public.clientes where tipo_documento = $1 and documento = $2', [c.tipoDocumento, c.documento]);
      if (cli.usuario_id) { r.acessosJaExistiam++; return; }
      if (!c.acesso || cli.origem !== 'importado' || !cli.email) { r.semAcesso++; return; }
      // conta criada numa execução interrompida antes do vínculo: vincula, NUNCA troca a senha
      const [existente] = await sql(`select id, raw_app_meta_data ->> 'marca_importacao' as marca from auth.users where lower(email) = $1`, [cli.email]);
      if (existente) {
        if (existente.marca === marcaDocumento(c.documento)) { await vincular(transacao, cli.id, existente.id); r.acessosVinculados++; } else {
          await transacao((q) => q(`update public.clientes set pendencias = array_append(pendencias, 'email_em_uso') where id = $1 and not ('email_em_uso' = any(pendencias))`, [cli.id]), { ator: 'importacao' });
          r.semAcesso++;
        }
        return;
      }
      const { data, error } = await admin.auth.admin.createUser({
        email: cli.email, password: senhaDerivada(c.documento.slice(0, 6)), email_confirm: true,
        // marca em app_metadata: o usuário não edita (user_metadata ele edita pelo próprio token)
        app_metadata: { origem: 'importado', marca_importacao: marcaDocumento(c.documento) },
        user_metadata: { origem: 'importado', ...(ficticio ? { ficticio: true } : {}) },
      });
      if (error) throw new Error(`createUser: ${error.status}`);
      await vincular(transacao, cli.id, data.user.id);
      r.acessosCriados++;
    } catch (e) {
      r.erros++; console.error(`linha ${c.linha}: ${String(e.message).replace(/\S+@\S+/g, '<e-mail>').slice(0, 120)}`);
    } finally { feitos++; aoProgredir?.(feitos); }
  }
  const fila = [...plano.clientes];
  await Promise.all(Array.from({ length: concorrencia }, async () => { while (fila.length) await um(fila.shift()); }));
  return r;
}

async function vincular(transacao, clienteId, userId) {
  await transacao((q) => q('update public.clientes set usuario_id = $2 where id = $1 and usuario_id is null', [clienteId, userId]), { ator: 'importacao' });
}

/** E-mails de contas existentes que NÃO vieram desta importação (conflito = sem acesso). */
export async function emailsEmUso() {
  const { sql } = await import('./lib-supabase.mjs');
  const rs = await sql(`select lower(email) as email from auth.users where coalesce(raw_user_meta_data ->> 'origem', '') <> 'importado'`);
  return new Set(rs.map((x) => x.email));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
  const importar = process.argv.includes('--importar');
  const ficticio = process.argv.includes('--ficticio');
  const arquivo = arg('--arquivo') || `${homedir()}/.prime-dados/clientes-corrigido.xlsx`;
  const linhas = await lerPlanilha(arquivo);
  const plano = planejar(linhas, { emailsEmUso: await emailsEmUso() });
  if (ficticio && plano.clientes.some((c) => c.email && !c.email.endsWith('@example.com'))) { console.error('--ficticio exige e-mails @example.com'); process.exit(2); }
  console.log(JSON.stringify({ modo: importar ? 'IMPORTAÇÃO' : 'SIMULAÇÃO (nada gravado)', ...contar(linhas, plano) }, null, 1));
  if (importar) {
    const r = await executar(plano, { ficticio, aoProgredir: (n) => { if (n % 250 === 0) console.log(`  ${n}/${plano.clientes.length}`); } });
    console.log(JSON.stringify({ resultado: r }, null, 1));
  }
  const { fecharSql } = await import('./lib-supabase.mjs');
  await fecharSql();
}
