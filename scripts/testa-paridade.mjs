// B3: paridade entre o domínio em JS (src/domain) e o portado pro banco (privado.*), contra a homologação.
// Mesmos casos nos dois lados: saída idêntica ou o mesmo código de erro. Uso: bash scripts/cli.sh node22 scripts/testa-paridade.mjs
import { criarSuite, assert } from './lib-teste.mjs';
import { admin, fecharSql } from './lib-supabase.mjs';
import { calcularPacote, gerarAtendimentos } from '../src/domain/pacote.js';
import { cotarSolicitacao, estimarDuracao } from '../src/domain/agenda.js';
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

// ---------- agendamento v2 (agenda.js x privado.cotar_solicitacao / privado.estimar_duracao) ----------
function jsV2(sol, endereco) {
  try { return { ok: JSON.parse(JSON.stringify(cotarSolicitacao(sol, { hoje: HOJE, endereco }, CONFIG_PRECOS))) }; } catch (e) { return { erro: e.codigo || e.message }; }
}
async function sqlV2(sol, endereco) {
  const { data, error } = await admin.rpc('paridade_agenda', { p_sol: sol, p_hoje: HOJE, p_endereco: endereco ?? null });
  return error ? { erro: error.message } : { ok: data };
}

t.teste('v2 estimativa: metragem e cômodos (residencial e empresarial, limites e excesso) iguais no banco', async () => {
  const casos = [];
  for (const tipoCliente of ['residencial', 'empresa', 'x']) {
    for (const metragem of [undefined, 10, 30, 31, 40, 41, 50, 51, 80, 81, 90, 91, 120, 121, 130, 131]) {
      for (const n of [0, 3, 4, 5, 8, 9, 10, 11, 12]) casos.push({ tipoCliente, metragem, comodos: { quartos: Math.ceil(n / 2), banheiros: Math.floor(n / 2) } });
    }
  }
  let dif = 0; let ex = '';
  for (const e of casos) {
    const a = estimarDuracao(e, CONFIG_PRECOS);
    const { data, error } = await admin.rpc('paridade_estimativa', { p_entrada: e });
    if (error || jsonEstavel(a) !== jsonEstavel(data)) { dif++; ex = ex || `${JSON.stringify(e)}: ${JSON.stringify(a)} x ${error?.message || JSON.stringify(data)}`; }
  }
  assert.equal(dif, 0, ex);
});

t.teste('v2 cotação: casos da decisão (única, várias datas em 2 meses, recorrente, 2h no limite, horário fora, domingo, regiões) iguais', async () => {
  const d = (n) => somarDias(HOJE, n);
  const base = { tipoCliente: 'residencial', tipoServico: 'residencial', duracaoHoras: 4, metragem: 45 };
  const casos = [
    [{ ...base, agenda: { modo: 'unica', datas: [d(5)], horario: '08:00' } }, END('Belo Horizonte')],
    [{ ...base, semLocalAlmoco: true, agenda: { modo: 'unica', datas: [d(6)], horario: '14:30' } }, END('Contagem')],
    [{ ...base, agenda: { modo: 'unica', datas: [d(6)], horario: '15:00' } }, END('Belo Horizonte')],
    [{ ...base, duracaoHoras: 2, metragem: 31, agenda: { modo: 'unica', datas: [d(6)], horario: '08:00' } }, END('Belo Horizonte')],
    [{ tipoCliente: 'empresa', tipoServico: 'empresarial', duracaoHoras: 2, metragem: 40, agenda: { modo: 'unica', datas: [d(7)], horario: '16:30' } }, END('Betim')],
    [{ ...base, metragem: undefined, comodos: { quartos: 2, banheiros: 1, salas: 1, cozinhas: 1 }, agenda: { modo: 'datas_escolhidas', datas: [d(40), d(5), d(12), d(33), d(19)], horarios: { [d(5)]: '09:30' }, horario: '08:00' } }, END('Belo Horizonte')],
    [{ ...base, agenda: { modo: 'recorrente', primeiraData: d(3), frequencia: 'semanal', quantidade: 6, horario: '13:00' } }, END('Belo Horizonte')],
    [{ ...base, agenda: { modo: 'recorrente', primeiraData: d(3), frequencia: 'mensal', quantidade: 5, horario: '13:00' } }, END('Belo Horizonte')],
    [{ tipoCliente: 'residencial', tipoServico: 'passadoria', duracaoHoras: 6, pecas: 33, agenda: { modo: 'unica', datas: [d(9)], horario: '12:30' } }, END('Sabará')],
    [{ ...base, agenda: { modo: 'unica', datas: [d(5)], horario: '08:00' } }, END('Nova Lima')],
    [{ ...base, agenda: { modo: 'unica', datas: [d(5)], horario: '08:00' } }, END('Curitiba', 'PR')],
    [{ ...base, tipoServico: 'empresarial', agenda: { modo: 'unica', datas: [d(5)], horario: '08:00' } }, END('Belo Horizonte')],
    [{ ...base, agenda: { modo: 'datas_escolhidas', datas: [d(5), d(5)] } }, END('Belo Horizonte')],
  ];
  for (const [sol, end] of casos) {
    const a = jsV2(sol, end); const b = await sqlV2(sol, end);
    assert.equal(jsonEstavel(b), jsonEstavel(a), `${JSON.stringify(sol).slice(0, 120)}: ${onde(a, b)}`);
  }
});

t.teste('v2 cotação: 400 solicitações aleatórias (modos, horários, cômodos, peças, datas bloqueadas, erros) iguais', async () => {
  const tipos = ['residencial', 'empresarial', 'condominial', 'pre_pos_mudanca', 'pre_pos_evento', 'passadoria', 'pos_obra', 'inventado'];
  const cidades = [['Belo Horizonte', 'MG'], ['Contagem', 'MG'], ['Betim', 'MG'], ['Nova Lima', 'MG'], ['Ibirité', 'mg'], ['Curitiba', 'PR']];
  const horas = ['08:00', '08:30', '10:30', '12:30', '13:00', '14:30', '16:30', '17:00', '7:00', '', undefined];
  let dif = 0; let validas = 0; const exemplos = [];
  for (let i = 0; i < 400; i++) {
    const modo = um(['unica', 'datas_escolhidas', 'recorrente', 'x']);
    const datas = Array.from({ length: um([1, 2, 3, 5, 13]) }, () => somarDias(HOJE, Math.floor(rnd() * 130) - 2));
    const horarios = rnd() < 0.4 ? Object.fromEntries(datas.map((x) => [x, um(horas)])) : undefined;
    const boa = rnd() < 0.7; // ~70% quase válidas (exercita valor, taxa, desconto e horário); o resto, entrada qualquer
    const tipoCliente = boa ? um(['residencial', 'empresa']) : um(['residencial', 'residencial', 'empresa', 'x']);
    const tipoServico = boa ? um(CONFIG_PRECOS.PRECOS.servicosPorTipoCliente[tipoCliente]) : um(tipos);
    const duracaoHoras = boa ? um([4, 6, 8]) : um([2, 4, 6, 8, 3, '4']);
    if (boa) {
      for (let k = 0; k < datas.length; k++) while (new Date(`${datas[k]}T12:00:00Z`).getUTCDay() === 0 || datas[k] <= HOJE) datas[k] = somarDias(datas[k], 1);
      if (horarios) for (const x of Object.keys(horarios)) horarios[x] = um(['08:00', '09:30', '10:30']);
    }
    const sol = {
      tipoCliente, tipoServico, duracaoHoras,
      ...(rnd() < 0.6 ? { metragem: boa ? um([15, 30, 31, 45, 80, 121, 131]) : um([15, 30, 31, 45, 80, 121, 131, 5, 1001, 45.5]) } : {}),
      ...(rnd() < 0.4 ? { comodos: boa ? um([{ quartos: 2, banheiros: 1 }, { quartos: 12 }, { salas: 3, cozinhas: 1, areaExterna: 2 }, {}]) : um([{ quartos: 2, banheiros: 1 }, { quartos: 12 }, { salas: 21 }, { garagem: 1 }, { quartos: -1 }, {}]) } : {}),
      ...(rnd() < 0.3 ? { pecas: um([10, 30, 70, 0, 300]) } : {}),
      ...(rnd() < 0.3 ? { semLocalAlmoco: um([true, false, 'sim']) } : {}),
      agenda: boa
        ? { modo: um(['unica', 'datas_escolhidas', 'recorrente']), datas: [...new Set(datas)].slice(0, 5), primeiraData: datas[0], frequencia: um(['semanal', 'quinzenal']), quantidade: um([2, 3, 4, 5]), horario: um(['08:00', '08:30', '10:00']), horarios }
        : { modo, datas: modo === 'recorrente' ? undefined : (modo === 'unica' ? datas.slice(0, um([1, 1, 2])) : datas), primeiraData: datas[0], frequencia: um(['semanal', 'quinzenal', 'mensal', 'diario']), quantidade: um([2, 3, 4, 5, 12, 13, 1]), horario: um(horas), horarios },
    };
    const [cidade, uf] = um(cidades);
    const a = jsV2(sol, END(cidade, uf)); const b = await sqlV2(sol, END(cidade, uf));
    if (a.ok) validas++;
    if (jsonEstavel(a) !== jsonEstavel(b)) { dif++; if (exemplos.length < 3) exemplos.push({ sol, cidade, diferenca: onde(a, b) }); }
  }
  if (dif) console.log(`       ${dif} diferenças; exemplos:\n${JSON.stringify(exemplos, null, 1)}`);
  assert.equal(dif, 0);
  console.log(`       ${validas} das 400 cotaram (o resto: mesmo erro nos dois lados)`);
  assert.ok(validas >= 80, 'poucas cotações válidas: a bateria não exercita o caminho feliz');
});

const falhas = await t.fim();
await fecharSql();
process.exit(falhas ? 1 : 0);
