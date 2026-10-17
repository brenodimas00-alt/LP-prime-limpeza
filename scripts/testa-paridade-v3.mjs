// V1 do agendamento v3: paridade entre src/domain/agendamento-v3.js e privado.*_v3 (spec 2.5): mesma configuração dos dois
// lados (a vigente do banco, com variações), recomendação nos limites, horários, 1000 cotações aleatórias (taxas, cupom,
// condição especial, faturamento, faixas de CEP, feriados) e a configuração do arquivo igual à do banco.
// Uso: bash scripts/cli.sh node22 scripts/testa-paridade-v3.mjs            (homologação)
//      PARIDADE_LOCAL=1 bash scripts/cli.sh node22 scripts/testa-paridade-v3.mjs  (supabase start local)
import { createClient } from '@supabase/supabase-js';
import { criarSuite, assert } from './lib-teste.mjs';
import { cotarV3, recomendarDuracao, horariosPermitidos } from '../src/domain/agendamento-v3.js';
import { CONFIG_PRECOS } from '../src/config/precos.js';
import { validarCadastroV3, validarEnderecoV3 } from '../src/domain/validacao.js';
import { normalizarEnderecoV3 } from '../src/app/casos-v3.js';
import { CONTEUDO_AGENDAMENTO_PADRAO, TIPOS_IMOVEL } from '../src/config/agendamento-v3.js';

const local = process.env.PARIDADE_LOCAL === '1';
const db = local
  ? createClient('http://127.0.0.1:54321', process.env.SUPABASE_LOCAL_SERVICE_KEY || '', { auth: { persistSession: false } })
  : (await import('./lib-supabase.mjs')).admin;
const t = criarSuite(`agendamento v3: paridade JS x SQL (${local ? 'local' : 'homologação'})`);
const HOJE = '2026-10-06';
let semente = 20261006;
const rnd = () => { semente = (semente * 1103515245 + 12345) % 2147483648; return semente / 2147483648; };
const um = (xs) => xs[Math.floor(rnd() * xs.length)];
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));

function onde(a, b, c = '') {
  if (typeof a !== typeof b || Array.isArray(a) !== Array.isArray(b) || (a === null) !== (b === null)) return `${c}: ${JSON.stringify(a)} x ${JSON.stringify(b)}`;
  if (a && typeof a === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const r = onde(a[k], b[k], `${c}.${k}`); if (r) return r; }
    return '';
  }
  return a === b ? '' : `${c}: ${JSON.stringify(a)} x ${JSON.stringify(b)}`;
}

const { data: CFG_DB, error: eCfg } = await db.rpc('config_v3_servico');
if (eCfg) throw new Error(`config_v3_servico: ${eCfg.message}`);

const js = (p, ctx, cfg) => { try { return { ok: JSON.parse(JSON.stringify(cotarV3(p, ctx, cfg))) }; } catch (e) { return { erro: e.codigo || e.message, msg: e.message }; } };
async function sqlCot(p, ctx, cfg) {
  const { data, error } = await db.rpc('paridade_v3', { p_pedido: p, p_ctx: ctx, p_cfg: cfg });
  return error ? { erro: error.message, msg: error.details } : { ok: data };
}

t.teste('configuração do arquivo (src/config/precos.js) igual à vigente no banco: PRECOS.v3, horários e Nova Lima', () => {
  assert.deepEqual(CFG_DB.PRECOS.v3, CONFIG_PRECOS.PRECOS.v3);
  assert.deepEqual(CFG_DB.horariosTrabalho, CONFIG_PRECOS.horariosTrabalho);
  const nl = CFG_DB.regioesAtendidas.find((r) => r.cidade === 'Nova Lima');
  assert.equal(nl.taxaCentavos, 2000);
  assert.equal(nl.sobConsulta, false);
});

t.teste('recomendação: todos os serviços nos limites de metragem, ambientes, peças, tipos e condição', async () => {
  const casos = [];
  const SEM = { tem: false };
  for (const seg of ['residencial', 'empresa']) {
    for (const metragem of [1, 10, 30, 31, 40, 41, 50, 51, 60, 70, 71, 90, 110, 111, 120, 121, 130, 131, 500]) {
      for (const n of [0, 1, 3, 4, 5, 6, 7, 8, 10, 11, 14]) {
        casos.push(['residencial', { metragem, ambientes: { quartos: Math.ceil(n / 2), banheiros: Math.floor(n / 2) }, animais: SEM }, seg]);
        casos.push(['pre_pos_evento', { metragem, ambientesTotal: n, momento: um(['antes', 'depois']), condicao: um(['leve', 'moderado', 'intenso']), animais: SEM }, seg]);
      }
      for (const c of ['leve', 'moderada', 'intensa', 'x']) casos.push(['pre_pos_mudanca', { metragem, ambientes: { cozinhas: 1, salas: 2 }, mobiliado: 'parcial', condicao: c, animais: SEM }, seg]);
    }
  }
  for (const pecas of [0, 1, 15, 16, 25, 26, 40, 41, 60, 61, 300]) for (const tipoPecas of ['basicas', 'roupas_cama', 'sociais', 'delicadas', 'mistas', 'x']) casos.push(['passadoria', { pecas, tipoPecas }, 'residencial']);
  casos.push(['residencial', null, 'residencial'], ['residencial', { metragem: 'x' }, 'residencial']);
  let dif = 0; let ex = '';
  for (const [s, car, seg] of casos) {
    const a = recomendarDuracao(s, car, seg, CFG_DB);
    const { data: b, error } = await db.rpc('paridade_v3_recomendar', { p_servico: s, p_car: car, p_segmento: seg, p_cfg: CFG_DB });
    if (error) throw new Error(error.message);
    const o = onde(a, b);
    if (o) { dif++; ex ||= `${s} ${JSON.stringify(car)} ${o}`; }
  }
  assert.equal(dif, 0, `${dif} de ${casos.length} divergem. Ex.: ${ex}`);
});

t.teste('horários permitidos: 2, 4, 6 e 8 h em dia útil e sábado, com e sem expediente de sábado', async () => {
  for (const sab of [null, '13:00']) {
    const cfg = structuredClone(CFG_DB); cfg.horariosTrabalho.fimExpedienteSabado = sab;
    for (const h of [2, 4, 6, 8]) {
      for (const d of ['2026-10-13', '2026-10-17']) {
        const { data, error } = await db.rpc('paridade_v3_horarios', { p_horas: h, p_data: d, p_cfg: cfg });
        if (error) throw new Error(error.message);
        assert.deepEqual(data, horariosPermitidos(h, d, cfg), `${h}h ${d} sábado=${sab}`);
      }
    }
  }
});

// ---------- 1000 cotações aleatórias ----------
const CIDADES = [
  { cep: '30140071', cidade: 'Belo Horizonte', uf: 'MG' }, { cep: '32600000', cidade: 'Betim', uf: 'MG' }, { cep: '32000000', cidade: 'contagem', uf: 'mg' },
  { cep: '34000000', cidade: 'Nova Lima', uf: 'MG' }, { cep: '34006100', cidade: 'Nova Lima', uf: 'MG' }, { cep: '33200000', cidade: 'Vespasiano', uf: 'MG' },
  { cep: '01000000', cidade: 'São Paulo', uf: 'SP' },
];
const datasAte = (n) => Array.from({ length: n }, (_, i) => { const d = new Date(Date.UTC(2026, 9, 7 + i)); return d.toISOString().slice(0, 10); });
const DATAS = datasAte(60);
const HORAS = ['08:00', '08:15', '09:30', '10:30', '10:45', '12:30', '13:00', '14:30', '14:45', '16:30', '17:00', '7:00'];

let R = false; // ruído: valores inválidos de propósito (20% dos casos)
const ou = (bom, ruim) => (R && rnd() < 0.3 ? um(ruim) : um(bom));

function caracteristicas(servico) {
  const animais = ou([{ tem: false }, { tem: false }, { tem: true, caes: int(1, 2), gatos: int(0, 1), outros: 0 }, { tem: true, caes: 0, gatos: 0, outros: 1, outrosQual: 'Calopsita' }],
    [{}, { tem: true, caes: 0, gatos: 0, outros: 0 }, { tem: true, caes: 0, gatos: 0, outros: 1 }]);
  if (servico === 'passadoria') return { pecas: ou([int(1, 70)], [0, 400]), tipoPecas: ou(['basicas', 'roupas_cama', 'sociais', 'delicadas', 'mistas'], ['x']), animais };
  const metragem = ou([int(10, 140)], [5, 1200]);
  if (servico === 'pre_pos_evento') {
    const momento = ou(['antes', 'depois'], ['x']);
    return { metragem, ambientesTotal: ou([int(1, 12)], [0]), momento, condicao: ou(['leve', 'moderado', 'intenso'], [undefined]), animais };
  }
  const c = { metragem, ambientes: { quartos: int(1, 5), banheiros: int(0, 3), salas: int(0, 2), cozinhas: int(0, 2), areaExterna: int(0, 1) }, animais };
  if (R && rnd() < 0.2) c.ambientes = { quartos: 0 };
  if (servico === 'pre_pos_mudanca') Object.assign(c, { mobiliado: ou(['vazio', 'parcial', 'mobiliado'], ['x']), condicao: ou(['leve', 'moderada', 'intensa'], [undefined]) });
  return c;
}

const HORAS_BOAS = ['08:00', '08:15', '09:30', '10:00', '10:30'];
function aleatorio() {
  R = rnd() < 0.2;
  const segmento = ou(['residencial', 'residencial', 'empresa'], ['x']);
  const modalidade = ou(['avulsa', 'pacote', 'pacote', 'multi_profissional'], ['x']);
  const servs = CONFIG_PRECOS.PRECOS.servicosPorTipoCliente[segmento] || ['residencial'];
  const n = modalidade === 'avulsa' ? ou([1], [2]) : int(2, 7);
  const diaMulti = um(DATAS);
  const datas = [...DATAS].sort(() => rnd() - 0.5).slice(0, n);
  const atendimentos = Array.from({ length: n }, (_, i) => {
    const servico = ou(servs, ['pos_obra']);
    const a = {
      servico, duracaoHoras: ou([4, 4, 6, 8, 8], [2, 3]), data: modalidade === 'multi_profissional' ? ou([diaMulti], [datas[i]]) : ou([datas[i]], [datas[0]]),
      horaInicio: ou(HORAS_BOAS, HORAS), endereco: ou(CIDADES.slice(0, 6), CIDADES), localRefeicao: ou([true, true, false], [undefined]),
    };
    if (i === 0 || rnd() < 0.3) a.caracteristicas = caracteristicas(servico);
    if (rnd() < 0.7) a.cienteDuracaoMenor = true;
    if (rnd() < 0.1) a.justificativa = 'Somente alguns cômodos';
    return a;
  });
  const p = { segmento, modalidade, atendimentos };
  if (modalidade === 'pacote') p.frequencia = ou(['semanal', 'quinzenal', 'mensal', 'datas'], ['x']);
  if (rnd() < 0.4) p.cupom = um(['prime10', 'BEMVINDA', 'NADA']);
  const ctx = { hoje: HOJE };
  if (p.cupom && rnd() < 0.8) {
    ctx.cupom = { codigo: p.cupom.toUpperCase(), tipo: um(['valor', 'percentual']), valor: um([5, 10, 50, 3000, 99999]), modalidades: um([[], [], ['pacote'], ['avulsa', 'multi_profissional']]),
      primeiraContratacao: rnd() < 0.3, validoAte: um([null, null, '2026-10-01', '2026-12-31']), ativo: rnd() < 0.9, esgotado: rnd() < 0.1, acumula: rnd() < 0.3 };
    if (ctx.cupom.tipo === 'percentual') ctx.cupom.valor = int(1, 100);
  }
  if (rnd() < 0.3) ctx.primeiraContratacao = rnd() < 0.5;
  if (rnd() < 0.3) {
    ctx.condicao = { tipo: um(['valor', 'percentual']), valor: um([10, 25, 10000, 50000]), modalidades: um([[], ['pacote']]), quantidadeMinima: um([null, 2, 5]),
      validade: um(['uso_unico', 'recorrente', 'periodo']), validoAte: um([null, '2026-10-01', '2026-12-31']), acumula: rnd() < 0.4, consumida: rnd() < 0.2, ativa: rnd() < 0.95 };
    if (ctx.condicao.tipo === 'percentual') ctx.condicao.valor = int(1, 50);
  }
  if (rnd() < 0.1) ctx.faturamento = { prazoDias: int(0, 30) };
  return { p, ctx };
}

t.teste('casos de borda: campos ausentes, tipos errados, datas impossíveis (mesma mensagem nos dois lados)', async () => {
  const A = { servico: 'residencial', duracaoHoras: 4, data: '2026-10-13', horaInicio: '08:00', endereco: CIDADES[0], localRefeicao: true,
    caracteristicas: { metragem: 45, ambientes: { quartos: 2 }, animais: { tem: false } } };
  const sem = (k) => { const x = { ...A }; delete x[k]; return x; };
  const P = (at, extra = {}) => ({ segmento: 'residencial', modalidade: 'avulsa', atendimentos: at, ...extra });
  const casos = [
    null, 'x', {}, P([]), P('x'), P([null]), P(['x']), P([sem('servico')]), P([sem('duracaoHoras')]), P([sem('data')]), P([sem('horaInicio')]),
    P([sem('endereco')]), P([sem('localRefeicao')]), P([sem('caracteristicas')]), P([{ ...A, duracaoHoras: '4' }]), P([{ ...A, horaInicio: 800 }]),
    P([{ ...A, data: '2026-02-30' }]), P([{ ...A, endereco: 'Rua X' }]), P([{ ...A, caracteristicas: [] }]), P([{ ...A, localRefeicao: 'sim' }]),
    P([{ ...A, caracteristicas: { metragem: 45, ambientes: { quartos: 2, sotao: 1 }, animais: { tem: true } } }]),
    P([{ ...A, caracteristicas: { metragem: 45.5, ambientes: { quartos: -1 }, animais: { tem: 'sim' } } }]),
    P([{ ...A, servico: 'passadoria', caracteristicas: { pecas: 10, tipoPecas: 3, animais: { tem: false } } }]),
    P([{ ...A, servico: 'pre_pos_evento', caracteristicas: { metragem: 45, ambientesTotal: '3', momento: 'depois', animais: { tem: false } } }]),
    P([{ ...A, justificativa: 'x'.repeat(501), duracaoHoras: 2, caracteristicas: { ...A.caracteristicas, metragem: 31 } }]),
    P([A, A], { modalidade: 'pacote' }), P([A, A], { modalidade: 'pacote', frequencia: 'semanal' }), P([A], { modalidade: 'multi_profissional' }),
    P([A, { ...A, data: null }], { modalidade: 'multi_profissional' }), P([A], { segmento: null, modalidade: null }),
    P([A], { cupom: '' }), P([A], { cupom: 'abc' }),
  ];
  let dif = 0; let ex = '';
  for (const p of casos) {
    const a = js(p, { hoje: HOJE }, CFG_DB);
    const b = await sqlCot(p, { hoje: HOJE }, CFG_DB);
    const o = a.erro || b.erro ? (a.erro === b.erro && a.msg === b.msg ? '' : `erro ${a.erro}: ${a.msg} x ${b.erro}: ${b.msg}`) : onde(a.ok, b.ok);
    if (o) { dif++; ex ||= `${JSON.stringify(p).slice(0, 200)}: ${o}`; }
  }
  assert.equal(dif, 0, `${dif} de ${casos.length} divergem. Ex.: ${ex}`);
});

t.teste('V2: conteúdo do agendamento (tipos de imóvel e "Ver mais") igual ao padrão do arquivo', async () => {
  const { data, error } = await db.rpc('conteudo_agendamento');
  if (error) throw new Error(error.message);
  assert.deepEqual(data, CONTEUDO_AGENDAMENTO_PADRAO);
});

t.teste('V2: validação do cadastro (nome completo, CPF, maioridade pela data inteira, WhatsApp, empresa) igual no banco', async () => {
  const HOJE_C = '2026-10-06';
  const base = { tipo: 'residencial', nome: 'Isabela Souza', telefone: '(31) 98888-7777', email: 'Teste@Example.com', cpf: '529.982.247-25', dataNascimento: '1990-05-10' };
  const emp = { tipo: 'empresa', responsavel: 'Carlos Lima', razaoSocial: 'Empresa X Ltda', cnpj: '11.222.333/0001-81', telefone: '31988887777', email: 'x@example.com' };
  const casos = [
    base, { ...base, nome: 'Isabela' }, { ...base, nome: 'Isabela S' }, { ...base, nome: 'Zé Lô' }, { ...base, nome: '  Ana   Maria  ' }, { ...base, nome: 'Jo' },
    { ...base, nome: 'Ana <b>' }, { ...base, cpf: '529.982.247-24' }, { ...base, cpf: '' }, { ...base, cpf: '111.111.111-11' },
    { ...base, dataNascimento: '2008-10-06' }, { ...base, dataNascimento: '2008-10-07' }, { ...base, dataNascimento: '2008-02-29' }, { ...base, dataNascimento: '2026-10-07' },
    { ...base, dataNascimento: '1899-12-31' }, { ...base, dataNascimento: '2001-02-30' }, { ...base, dataNascimento: '' }, { ...base, telefone: '(31) 8888-777' },
    { ...base, telefone: '(00) 98888-7777' }, { ...base, telefone: '' }, { ...base, telefone: '(31) 78888-7777' }, { ...base, email: 'sem-arroba' },
    { ...base, tipo: 'x' }, emp, { ...emp, responsavel: 'Carlos' }, { ...emp, cnpj: '11222333000180' }, { ...emp, razaoSocial: '' },
  ];
  for (const c of casos) {
    const { erros, cliente } = validarCadastroV3(c, HOJE_C);
    const { data, error } = await db.rpc('paridade_cadastro_v3', { p_dados: c, p_hoje: HOJE_C });
    if (error) throw new Error(error.message);
    const label = JSON.stringify(c).slice(0, 90);
    if (Object.keys(erros).length) assert.deepEqual(data.campos, erros, label);
    else assert.deepEqual(data.ok, cliente, label);
  }
});

t.teste('V2: validação do endereço novo (campos do item 7, ponto de referência, tipo do imóvel por segmento, "Outro") igual no banco', async () => {
  const e = { cep: '30140-071', logradouro: ' Rua  A ', numero: '10', complemento: 'Ap 2', bairro: 'Centro', cidade: 'Belo Horizonte', uf: 'mg', pontoReferencia: 'Perto da praça', tipoImovel: 'Apartamento' };
  const casos = [
    [e, 'residencial'], [{ ...e, tipoImovel: 'Galpão' }, 'residencial'], [{ ...e, tipoImovel: 'Galpão' }, 'empresa'], [{ ...e, tipoImovel: 'Outro', tipoImovelOutro: 'Sítio' }, 'residencial'],
    [{ ...e, tipoImovel: 'Outro', tipoImovelOutro: 'x' }, 'residencial'], [{ ...e, tipoImovel: '' }, 'residencial'], [{ ...e, pontoReferencia: 'x'.repeat(121) }, 'residencial'],
    [{ ...e, cep: '123' }, 'residencial'], [{ ...e, numero: '' }, 'empresa'], [{ ...e, uf: 'XX' }, 'residencial'], [{}, 'residencial'],
    [{ ...e, tipoImovel: 'Apartamento', tipoImovelOutro: 'sobra' }, 'residencial'],
  ];
  for (const [end, seg] of casos) {
    const n = normalizarEnderecoV3(end);
    const erros = validarEnderecoV3(n, TIPOS_IMOVEL[seg]);
    const { data, error } = await db.rpc('paridade_endereco_v3', { p_end: end, p_segmento: seg });
    if (error) throw new Error(error.message);
    const label = `${seg} ${JSON.stringify(end).slice(0, 80)}`;
    if (Object.keys(erros).length) assert.deepEqual(data.campos, Object.fromEntries(Object.entries(erros).map(([k, v]) => [`endereco.${k}`, v])), label);
    else assert.deepEqual(data.ok, n, label);
  }
});

t.teste('1000 cotações aleatórias: mesmo resultado (ou o mesmo código de erro) nos dois lados', async () => {
  const cfgs = [CFG_DB];
  const c2 = structuredClone(CFG_DB); c2.faixasCep = [{ nome: 'Vila da Serra', cepInicio: '34006000', cepFim: '34006999', taxaCentavos: 1000, ativa: true }];
  c2.feriados = [...c2.feriados, '2026-10-17', '2026-10-21']; c2.PRECOS.v3.taxas.acumulaSabadoFeriado = true; c2.horariosTrabalho.fimExpedienteSabado = '14:00';
  cfgs.push(c2);
  let dif = 0; let ex = ''; const codigos = {};
  for (let i = 0; i < 1000; i++) {
    const { p, ctx } = aleatorio();
    const cfg = cfgs[i % 2];
    const a = js(p, ctx, cfg);
    const b = await sqlCot(p, ctx, cfg);
    codigos[a.erro || 'ok'] = (codigos[a.erro || 'ok'] || 0) + 1;
    const o = a.erro || b.erro ? (a.erro === b.erro && a.msg === b.msg ? '' : `erro ${a.erro}: ${a.msg} x ${b.erro}: ${b.msg}`) : onde(a.ok, b.ok);
    if (o) { dif++; ex ||= `${o}\n  pedido ${JSON.stringify(p)}\n  ctx ${JSON.stringify(ctx)}`; }
  }
  console.log(`  resultados: ${JSON.stringify(codigos)}`);
  assert.ok((codigos.ok || 0) >= 150, `poucas cotações válidas (${codigos.ok}): o gerador precisa cobrir o caminho feliz`);
  assert.equal(dif, 0, `${dif} divergem. Primeiro: ${ex}`);
});

await t.fim();
