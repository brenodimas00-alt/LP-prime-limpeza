// B3: paridade entre o domínio em JS (src/domain) e o portado pro banco (privado.*), contra a homologação.
// Mesmos casos nos dois lados: saída idêntica ou o mesmo código de erro. Uso: bash scripts/cli.sh node22 scripts/testa-paridade.mjs
import { criarSuite, assert } from './lib-teste.mjs';
import { admin, fecharSql } from './lib-supabase.mjs';
import { calcularPacote, gerarAtendimentos } from '../src/domain/pacote.js';
import { montarBRCode } from '../src/domain/brcode.js';
import { validarCliente, soDigitos, normalizarCNPJ } from '../src/domain/validacao.js';
import { CONFIG_PRECOS } from '../src/config/precos.js';
import { PRIME as PIX_TESTE } from '../src/config/prime.teste.js';
import { dataNoFuso, somarDias } from '../src/domain/calendario.js';
import { CLIENTE_RESIDENCIAL, CLIENTE_EMPRESA } from './fixtures/seed.js';
import { jsonEstavel } from '../src/app/casos-de-uso.js';

const t = criarSuite('B3 paridade JS x SQL (homologação)');
const HOJE = dataNoFuso(new Date().toISOString());
let semente = 20260923;
const rnd = () => { semente = (semente * 1103515245 + 12345) % 2147483648; return semente / 2147483648; };
const um = (xs) => xs[Math.floor(rnd() * xs.length)];

/** Primeiro caminho em que dois valores divergem (pra mensagem de erro útil). */
function onde(a, b, c = '') {
  if (typeof a !== typeof b || Array.isArray(a) !== Array.isArray(b) || (a === null) !== (b === null)) return `${c}: ${JSON.stringify(a)} x ${JSON.stringify(b)}`;
  if (a && typeof a === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const r = onde(a[k], b[k], `${c}.${k}`); if (r) return r; }
    return '';
  }
  return a === b ? '' : `${c}: ${JSON.stringify(a)} x ${JSON.stringify(b)}`;
}

function js(esp, primeira, turno, endereco) {
  try {
    const base = calcularPacote({ ...esp, ...(endereco ? { endereco } : {}) }, CONFIG_PRECOS);
    const r = gerarAtendimentos(base, { primeiraData: primeira, turno, hoje: HOJE, endereco }, CONFIG_PRECOS);
    // diferença INTENCIONAL: o banco devolve duracaoHoras como número mesmo quando chega "4" (o JS repassa o texto)
    return { ok: JSON.parse(JSON.stringify({ ...r, pacote: { ...r.pacote, duracaoHoras: Number(r.pacote.duracaoHoras) } })) };
  } catch (e) { return { erro: e.codigo || e.message }; }
}
async function sqlCalc(esp, primeira, turno, endereco) {
  const { data, error } = await admin.rpc('paridade_pacote', { p_esp: esp, p_primeira: primeira, p_turno: turno, p_hoje: HOJE, p_endereco: endereco ?? null });
  if (error) return { erro: error.message };
  return { ok: data };
}

const END = (cidade, uf = 'MG') => ({ ...CLIENTE_RESIDENCIAL.endereco, cidade, uf });
const CASOS_OFICIAIS = [
  // (precos-prime.txt) conferidos à mão no testa-pacote
  [{ tipoCliente: 'residencial', tipoServico: 'residencial', duracaoHoras: 4, metragem: 45, quantidadeDiarias: 1, frequencia: 'avulso' }, END('Belo Horizonte')],
  [{ tipoCliente: 'residencial', tipoServico: 'condominial', duracaoHoras: 6, metragem: 70, quantidadeDiarias: 1, frequencia: 'avulso' }, END('Contagem')],
  [{ tipoCliente: 'residencial', tipoServico: 'pre_pos_mudanca', duracaoHoras: 8, metragem: 110, quantidadeDiarias: 1, frequencia: 'avulso', semLocalAlmoco: true }, END('Betim')],
  [{ tipoCliente: 'residencial', tipoServico: 'residencial', duracaoHoras: 4, metragem: 45, quantidadeDiarias: 1, frequencia: 'avulso', passadoriaCombinada: true }, END('Belo Horizonte')],
  [{ tipoCliente: 'residencial', tipoServico: 'residencial', duracaoHoras: 4, metragem: 45, quantidadeDiarias: 5, frequencia: 'semanal' }, END('Belo Horizonte')],
  [{ tipoCliente: 'residencial', tipoServico: 'residencial', duracaoHoras: 2, metragem: 45, quantidadeDiarias: 1, frequencia: 'avulso' }, END('Belo Horizonte')],
  [{ tipoCliente: 'residencial', tipoServico: 'residencial', duracaoHoras: 4, metragem: 45, quantidadeDiarias: 1, frequencia: 'avulso' }, END('Nova Lima')],
  [{ tipoCliente: 'residencial', tipoServico: 'pos_obra', duracaoHoras: 4, metragem: 45, quantidadeDiarias: 1, frequencia: 'avulso' }, END('Belo Horizonte')],
  [{ tipoCliente: 'empresa', tipoServico: 'empresarial', duracaoHoras: 6, metragem: 100, quantidadeDiarias: 4, frequencia: 'semanal', semLocalAlmoco: true }, END('Ribeirão das Neves')],
  [{ tipoCliente: 'residencial', tipoServico: 'passadoria', duracaoHoras: 4, pecas: 22, quantidadeDiarias: 3, frequencia: 'mensal' }, END('sabara')],
  [{ tipoCliente: 'residencial', tipoServico: 'residencial', duracaoHoras: 4, metragem: 45, quantidadeDiarias: 1, frequencia: 'avulso' }, END('São Paulo', 'SP')],
];

t.teste('casos da tabela oficial: mesma saída (itens, descontos, totais, parcelas) ou mesmo erro', async () => {
  let prox = somarDias(HOJE, 3);
  for (const [esp, end] of CASOS_OFICIAIS) {
    const turno = esp.duracaoHoras >= 8 ? 'integral' : 'manha';
    const a = js(esp, prox, turno, end); const b = await sqlCalc(esp, prox, turno, end);
    assert.deepEqual(b, a, `${esp.tipoServico} ${esp.duracaoHoras}h ${end.cidade}`);
    prox = somarDias(prox, 1);
  }
});

t.teste('400 pacotes aleatórios (datas, frequências, taxas, sábado/feriado, desconto, erros): JS e SQL iguais', async () => {
  const tipos = ['residencial', 'empresarial', 'condominial', 'pre_pos_mudanca', 'pre_pos_evento', 'passadoria', 'pos_obra', 'inventado'];
  const cidades = [['Belo Horizonte', 'MG'], ['Contagem', 'MG'], ['Betim', 'MG'], ['Nova Lima', 'MG'], ['Ibirité', 'mg'], ['Curitiba', 'PR'], ['belo horizonte', 'MG']];
  let diferentes = 0; const exemplos = [];
  for (let i = 0; i < 400; i++) {
    const tipoServico = um(tipos);
    const freq = um(['avulso', 'semanal', 'quinzenal', 'mensal', 'diario']);
    const esp = {
      tipoCliente: um(['residencial', 'residencial', 'empresa', 'x']), tipoServico, duracaoHoras: um([2, 4, 6, 8, 3, '4']),
      horasExtras: um([0, 0, 1, 2, 4, 5, null, '1']), quantidadeDiarias: freq === 'avulso' ? um([1, 1, 2]) : um([2, 3, 4, 5, 6, 12, 13, 1]), frequencia: freq,
      passadoriaCombinada: um([false, true, undefined, 'sim']), semLocalAlmoco: um([false, true, undefined]),
      ...(tipoServico === 'passadoria' ? { pecas: um([10, 22, 45, 61, 0, undefined]) } : { metragem: um([10, 25, 30, 45, 80, 120, 121, 900, 1001, 5, '45', undefined]) }),
    };
    const [cidade, uf] = um(cidades);
    const primeira = somarDias(HOJE, um([-1, 0, 1, 2, 3, 5, 9, 20, 60, 118, 121, 130]));
    const turno = um(['manha', 'tarde', 'integral', 'noite']);
    const a = js(esp, primeira, turno, END(cidade, uf)); const b = await sqlCalc(esp, primeira, turno, END(cidade, uf));
    if (jsonEstavel(a) !== jsonEstavel(b)) { diferentes++; if (exemplos.length < 3) exemplos.push({ esp, primeira, turno, cidade, diferenca: onde(a, b) }); }
  }
  if (diferentes) console.log(`       ${diferentes} diferenças; exemplos:\n${JSON.stringify(exemplos, null, 1)}`);
  assert.equal(diferentes, 0);
});

t.teste('BR Code: o banco gera o mesmo copia e cola (com CRC) que o JS pra vários valores', async () => {
  for (const v of [1, 99, 100, 8750, 17500, 123456, 999999999]) {
    const txid = `TESTE${v}ABC`.slice(0, 25);
    const esperado = montarBRCode({ chave: PIX_TESTE.pix.chave, nome: PIX_TESTE.pix.nomeRecebedor, cidade: PIX_TESTE.pix.cidadeRecebedor, valorCentavos: v, txid });
    const { data, error } = await admin.rpc('paridade_brcode', { p_valor: v, p_txid: txid });
    assert.ok(!error, error?.message);
    assert.equal(data, esperado, `valor ${v}`);
  }
});

t.teste('validação de cliente: o banco aceita o que o JS aceita e recusa com os mesmos campos', async () => {
  const casos = [
    CLIENTE_RESIDENCIAL, CLIENTE_EMPRESA,
    { ...CLIENTE_RESIDENCIAL, cpf: '11111111111' }, { ...CLIENTE_RESIDENCIAL, telefone: '3198888777' }, { ...CLIENTE_RESIDENCIAL, telefone: '00988887777' },
    { ...CLIENTE_RESIDENCIAL, email: 'sem-arroba' }, { ...CLIENTE_RESIDENCIAL, nome: 'Jo' }, { ...CLIENTE_RESIDENCIAL, nome: '<script>' },
    { ...CLIENTE_EMPRESA, cnpj: '12ABC34501DE34' }, { ...CLIENTE_EMPRESA, razaoSocial: '' },
    { ...CLIENTE_RESIDENCIAL, endereco: { ...CLIENTE_RESIDENCIAL.endereco, cep: '123', uf: 'XX', numero: '12345678901' } },
    { ...CLIENTE_RESIDENCIAL, tipo: 'outro' }, { ...CLIENTE_RESIDENCIAL, telefone: '(31) 98888-7777', cpf: '529.982.247-25' },
  ];
  for (const c of casos) {
    const norm = { tipo: c.tipo, nome: c.nome?.trim().replace(/\s+/g, ' '), telefone: soDigitos(c.telefone), email: (c.email || '').trim().toLowerCase(), endereco: { ...c.endereco, cep: soDigitos(c.endereco?.cep), uf: String(c.endereco?.uf || '').toUpperCase() } };
    if (c.tipo === 'empresa') Object.assign(norm, { cnpj: normalizarCNPJ(c.cnpj), razaoSocial: c.razaoSocial, responsavel: c.responsavel }); else if (c.cpf) norm.cpf = soDigitos(c.cpf);
    const errosJs = Object.keys(validarCliente(norm)).sort();
    const { error } = await admin.rpc('paridade_validacao', { p_cliente: c });
    const errosSql = error ? Object.keys(JSON.parse(error.hint || '{}')).sort() : [];
    assert.deepEqual(errosSql, errosJs, JSON.stringify(c).slice(0, 80));
  }
});

const falhas = await t.fim();
await fecharSql();
process.exit(falhas ? 1 : 0);
