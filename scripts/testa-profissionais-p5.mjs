// P5 (bloco 3) CONTRA A HOMOLOGAÇÃO, só fictícios: validade da certidão (padrão 90 dias), lista de vencendo/vencida/sem
// certidão, D07 (candidata da varredura, 15 e 3 dias antes, texto com os dias contados no envio), repasse (flag, só
// admin, regra validada, cálculo = SQL direto, fechamento trava), importação de profissionais (planilha fictícia).
// Uso: bash scripts/cli.sh node22 scripts/testa-profissionais-p5.mjs
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { criarSuite, assert } from './lib-teste.mjs';
import { sql, transacao, fecharSql, limparFicticios, entrar, criarUsuario, cpfFicticio } from './lib-supabase.mjs';
import { montarApiDeTeste } from './lib-api-teste.mjs';
import { agendar, chave, levarAteFinalizado } from './cenarios.mjs';
import { CLIENTE_RESIDENCIAL, proximaDataPermitida } from './fixtures/seed.js';
import { CONFIG_PRECOS } from '../src/config/precos.js';
import { REGRAS } from '../src/automacoes/catalogo.js';
import { dataNoFuso, somarDias } from '../src/domain/calendario.js';
import { criarPortaPg } from '../supabase/functions/_shared/porta-pg.js';
import { instantesDaAgenda } from '../src/automacoes/v2/tempo.js';
import { variaveisDe } from '../src/automacoes/v2/variaveis.js';
import { lerPlanilha, planejar, executar } from './importa-profissionais.mjs';

const t = criarSuite('P5 profissionais (homologação)');
await limparFicticios();
const PRIME = { ator: 'prime' };
const { api, porDiaristaId } = await montarApiDeTeste('p5');
const falha = async (p, codigo) => { try { await p; } catch (e) { assert.equal(e.codigo, codigo, e.message); return e; } assert.fail(`esperava ${codigo}`); };
const HOJE = dataNoFuso(new Date().toISOString());
const MES = '2025-01-01'; // mês passado e sem diária real: só as fictícias deste teste
const admin = await entrar(await criarUsuario('p5-adm', 'prime_admin'));
const atend = await entrar(await criarUsuario('p5-atend', 'prime_atendimento'));
const rpc = async (c, nome, args = {}) => { const { data, error } = await c.rpc(nome, args); if (error) throw Object.assign(new Error(error.details || error.message), { codigo: error.message }); return data; };

async function diarista(nome) {
  const u = await criarUsuario(`p5-${nome.toLowerCase()}`, 'diarista');
  const [{ id }] = await sql(`insert into public.diaristas (usuario_id, nome, cpf, telefone, email, data_nascimento, identidade, status, aceite_termos_em, disponibilidade, ficticio)
    values ($1, $2, $3, '31955554444', $4, '1985-04-12', 'cnh', 'aprovada', now(), '{"dias":[1,2,3,4,5,6],"turnos":["integral"],"regioes":["BH - Centro-Sul"]}', true) returning id`, [u.id, `${nome} Teste P5`, cpfFicticio(), u.email]);
  porDiaristaId.set(id, entrar(u));
  return id;
}
const certidao = (dia, criadoEm) => sql(`insert into public.documentos (diarista_id, tipo, nome_arquivo, mime, tamanho, storage_path, criado_em)
  values ($1, 'antecedentes', 'c.pdf', 'application/pdf', 10, $2, $3::timestamptz) returning id, to_char(valido_ate, 'YYYY-MM-DD') valido_ate`, [dia, `teste/${crypto.randomUUID()}`, criadoEm]).then((r) => r[0]);
const A = await diarista('Ana'); const B = await diarista('Bia'); const C = await diarista('Cora'); const E = await diarista('Edi');

t.teste('certidão: válida por 90 dias da data do envio; lista vencida, vencendo em 30 dias e sem certidão; só Prime', async () => {
  const a = await certidao(A, `${somarDias(HOJE, -85)}T15:00:00-03:00`); // vence em 5 dias
  assert.equal(a.valido_ate, somarDias(HOJE, 5));
  await certidao(B, `${somarDias(HOJE, -100)}T15:00:00-03:00`); // venceu há 10 dias
  await certidao(C, `${somarDias(HOJE, -10)}T15:00:00-03:00`); // vence em 80: fora da lista
  const lista = await api.documentosVencimento(30, { sessao: PRIME });
  const minha = (id) => lista.find((x) => x.diaristaId === id);
  assert.deepEqual([minha(A)?.situacao, minha(A)?.dias], ['vencendo', 5]);
  assert.equal(minha(B)?.situacao, 'vencido');
  assert.equal(minha(C), undefined);
  assert.equal(minha(E)?.situacao, 'sem_certidao');
  await falha(api.documentosVencimento(30, { sessao: { ator: 'diarista', id: A } }), 'ATOR_SEM_PERMISSAO');
});

t.teste('D07: a varredura acha a certidão atual que vence dentro de 15 dias; marcos 15 e 3 dias antes; texto com os dias', async () => {
  await sql(`update public.documentos set excluido_em = now() where diarista_id = $1 and tipo = 'antecedentes' and excluido_em is null`, [C]); // como no reenvio
  const d15 = await certidao(C, `${somarDias(HOJE, -75)}T15:00:00-03:00`); // a mais nova da Cora vence em 15 (a de 80 dias fica velha)
  const regra = REGRAS.find((r) => r.codigo === 'D07');
  const porta = criarPortaPg({ transacao: (fn) => transacao(fn), urlSite: 'https://turno-2026-09-28.prime-limpeza.pages.dev/' });
  const cands = await porta.transacao((tx) => tx.candidatos(regra, { hoje: HOJE, diasAFrente: 2 }));
  const daCora = cands.filter((c) => c.documento?.diaristaId === C);
  assert.equal(daCora.length, 1, 'só a certidão mais nova');
  assert.equal(daCora[0].documento.id, d15.id);
  assert.equal(daCora[0].diarista.id, C);
  const inst = instantesDaAgenda(regra.atraso, daCora[0], {});
  assert.deepEqual(inst.map((i) => i.marco), [`${somarDias(HOJE, 15)}:15`]);
  const v = variaveisDe('documento_vencendo', daCora[0], { urlSite: 'https://x/', diaEnvio: HOJE, destinatario: { tipo: 'diarista' } });
  assert.deepEqual([v.documento, v.dias, v.nome], ['certidão de antecedentes', '15', 'Cora']);
  assert.ok(!cands.some((c) => c.documento?.diaristaId === B), 'vencida não recebe "vencendo"');
});

// ---------- repasse
async function diariaNoMes(dia, dataMes, horasExtras = 0) {
  let D = proximaDataPermitida(somarDias(HOJE, 12), 1, CONFIG_PRECOS);
  while ([0, 6].includes(new Date(`${D}T12:00:00Z`).getUTCDay()) || CONFIG_PRECOS.feriados.includes(D)) D = somarDias(D, 1);
  const r = await agendar(api, { cliente: CLIENTE_RESIDENCIAL, pacote: { tipoServico: 'residencial', duracaoHoras: 4, metragem: 45, quantidadeDiarias: 1, frequencia: 'avulso' }, primeiraData: D, turno: 'manha' }, chave('p5'));
  await levarAteFinalizado(api, r, dia, r.atendimentos[0].id);
  if (horasExtras) {
    const x = await api.registrarHoraExtra(r.atendimentos[0].id, { horas: horasExtras }, { sessao: { ator: 'diarista', id: dia }, chave: chave('he') });
    await api.decidirHoraExtra(x.horaExtra.id, { aprovar: true }, { sessao: PRIME, chave: chave('dec') });
  }
  await sql('update public.atendimentos set data = $2 where id = $1', [r.atendimentos[0].id, dataMes]);
  return r.atendimentos[0].id;
}
const ligar = (v) => sql(`update public.config_flags set ligada = $1 where chave = 'p5_repasse'`, [v]);

t.teste('repasse: desligado por padrão; só a admin; regra validada', async () => {
  await falha(rpc(admin, 'repasse_mes', { p_mes: MES }), 'CONDICAO_NAO_ATENDIDA');
  await ligar(true);
  try {
    await falha(rpc(atend, 'repasse_mes', { p_mes: MES }), 'ATOR_SEM_PERMISSAO');
    for (const r of [{ tipo: 'percentual', percentual: '0' }, { tipo: 'percentual', percentual: '101' }, { tipo: 'por_carga', valores: { 2: '1', 4: '1' }, horaExtraCentavos: '1' }, { tipo: 'x' }]) {
      await falha(rpc(admin, 'salvar_regra_repasse', { p_regra: r }), 'DADOS_INVALIDOS');
    }
    const { data, error } = await atend.from('configuracao').select('chave').eq('chave', 'repasse');
    assert.ok(!error && data.length === 0, 'regra fora da leitura pública');
  } finally { await ligar(false); }
});

t.teste('repasse: cálculo = SQL direto (percentual e por carga); fechar grava e trava; mês atual e segundo fechamento recusados', async () => {
  const [{ valor: regraOriginal }] = await sql(`select valor from public.configuracao where chave = 'repasse'`);
  const a1 = await diariaNoMes(A, '2025-01-10', 1);
  const a2 = await diariaNoMes(A, '2025-01-17');
  await diariaNoMes(B, '2025-01-20', 2);
  await ligar(true);
  try {
    await rpc(admin, 'salvar_regra_repasse', { p_regra: { tipo: 'percentual', percentual: '50' } });
    const previa = await rpc(admin, 'repasse_mes', { p_mes: '2025-01-15' });
    assert.equal(previa.fechado, false);
    const esperado = await sql(`select a.diarista_id, count(*)::int n, sum(a.duracao_minutos)::int / 60.0 horas,
        round((sum(a.valor_dia_centavos) + coalesce((select sum(h.horas) from public.horas_extras h join public.atendimentos x on x.id = h.atendimento_id
          where h.status = 'aprovada' and x.diarista_id = a.diarista_id and x.data between '2025-01-01' and '2025-01-31'), 0) * 3000) * 0.5)::bigint valor
      from public.atendimentos a where a.diarista_id = any($1::uuid[]) and a.status in ('finalizado', 'avaliado') and a.data between '2025-01-01' and '2025-01-31' group by 1`, [[A, B]]);
    for (const e of esperado) {
      const l = previa.linhas.find((x) => x.diaristaId === e.diarista_id);
      assert.deepEqual([l.diarias, Number(l.horas), Number(l.valorCentavos)], [e.n, Number(e.horas), Number(e.valor)], `profissional ${e.diarista_id}`);
    }
    assert.equal(previa.linhas.find((x) => x.diaristaId === A).horasExtras, 1);
    // por carga: 4h = R$ 100, hora extra R$ 20
    const [{ c }] = await sql(`select privado.calcular_repasse('2025-01-01', '{"tipo":"por_carga","valores":{"2":"5000","4":"10000","6":"15000","8":"20000"},"horaExtraCentavos":"2000"}') c`);
    assert.equal(Number(c.find((x) => x.diaristaId === A).valorCentavos), 2 * 10000 + 2000);
    assert.equal(Number(c.find((x) => x.diaristaId === B).valorCentavos), 10000 + 2 * 2000);
    await falha(rpc(admin, 'fechar_repasse', { p_mes: `${HOJE.slice(0, 7)}-01`, p_chave: chave('fec') }), 'CONDICAO_NAO_ATENDIDA');
    // revisão do GPT: hora extra esperando a Prime impede fechar; depois de fechado, aprovar é recusado
    const [{ id: he }] = await sql('insert into public.horas_extras (atendimento_id, horas) values ($1, 1) returning id', [a2]);
    await falha(rpc(admin, 'fechar_repasse', { p_mes: MES, p_chave: chave('fec') }), 'CONDICAO_NAO_ATENDIDA');
    await sql(`update public.horas_extras set status = 'recusada', motivo_recusa = 'teste' where id = $1`, [he]);
    const k = chave('fec');
    const f = await rpc(admin, 'fechar_repasse', { p_mes: MES, p_chave: k });
    const [{ g }] = await sql('select id g from public.pagamentos where atendimento_id = $1 limit 1', [a2]);
    await sql(`update public.horas_extras set status = 'registrada', motivo_recusa = null where id = $1`, [he]);
    await assert.rejects(sql(`update public.horas_extras set status = 'aprovada', pagamento_id = $2 where id = $1`, [he, g]), /CONDICAO_NAO_ATENDIDA/);
    assert.equal(f.fechado, true);
    const valorA = f.linhas.find((x) => x.diaristaId === A).valorCentavos;
    await falha(rpc(admin, 'fechar_repasse', { p_mes: MES, p_chave: chave('fec') }), 'CONDICAO_NAO_ATENDIDA');
    // mudar a diária e a regra depois do fechamento não muda o mês fechado
    await sql('update public.atendimentos set valor_dia_centavos = valor_dia_centavos + 99900 where id = $1', [a1]);
    await rpc(admin, 'salvar_regra_repasse', { p_regra: { tipo: 'percentual', percentual: '90' } });
    const depois = await rpc(admin, 'repasse_mes', { p_mes: MES });
    assert.equal(depois.linhas.find((x) => x.diaristaId === A).valorCentavos, valorA);
    await assert.rejects(sql('update public.repasses set valor_centavos = 1 where mes = $1', [MES]), /REPASSE_FECHADO/);
    await assert.rejects(sql('delete from public.repasses_fechamentos where mes = $1', [MES]), /REPASSE_FECHADO/);
  } finally {
    await ligar(false);
    await sql(`update public.configuracao set valor = $1::jsonb where chave = 'repasse'`, [JSON.stringify(regraOriginal)]);
    await transacao(async (q) => { await q('delete from public.repasses where mes = $1', [MES]); await q('delete from public.repasses_fechamentos where mes = $1', [MES]); }, { ator: 'limpeza_teste' });
  }
});

// ---------- importação
t.teste('importação de profissionais: simulação conta, grava aprovadas sem acesso, rodar de novo não duplica', async () => {
  const pasta = mkdtempSync(`${tmpdir()}/prime-imp-`);
  try {
    const { default: ExcelJS } = await import('exceljs');
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('P');
    ws.addRow(['Nome completo', 'CPF (só números)', 'Telefone', 'E-mail', 'Data de nascimento', 'Regiões', 'Dias', 'Turnos']);
    const cpf1 = cpfFicticio(); const cpf2 = cpfFicticio();
    ws.addRow(['Rosa Importada Teste', cpf1, '(31) 98888-1111', `teste-imp-${cpf1}@example.com`, '12/04/1980', 'BH - Oeste, Contagem', 'seg, qua, sáb', 'manhã, tarde']);
    ws.addRow(['Rosa Repetida', cpf1, '31988881111', '', '', '', '', '']);
    ws.addRow(['CPF Ruim', '12345678900', '31988881111', '', '', '', '', '']);
    ws.addRow(['Sem Telefone', cpfFicticio(), 'x', '', '', '', '', '']);
    ws.addRow(['Lia Importada Teste', Number(cpf2), '31977772222', 'email-invalido', '31/02/1990', 'Marte', '', '']);
    await wb.xlsx.writeFile(`${pasta}/p.xlsx`);
    const [{ valor: regioes }] = await sql(`select valor from public.configuracao where chave = 'regioes_diarista'`);
    const { plano, ignorados } = planejar(await lerPlanilha(`${pasta}/p.xlsx`), regioes);
    assert.equal(plano.length, 2);
    assert.deepEqual([ignorados.cpf_repetido, ignorados.cpf_invalido, ignorados.sem_telefone], [1, 1, 1]);
    const lia = plano.find((p) => p.nome.startsWith('Lia'));
    assert.equal(lia.cpf, cpf2.padStart(11, '0'));
    assert.deepEqual(lia.revisar.sort(), ['email', 'nascimento', 'regioes']);
    assert.deepEqual(plano.find((p) => p.nome.startsWith('Rosa')).disponibilidade, { dias: [1, 3, 6], turnos: ['manha', 'tarde'], regioes: ['BH - Oeste', 'Contagem'] });
    assert.deepEqual(await executar(plano, { ficticio: true }), { criadas: 2, jaExistiam: 0 });
    assert.deepEqual(await executar(plano, { ficticio: true }), { criadas: 0, jaExistiam: 2 });
    const [x] = await sql(`select status, origem, usuario_id, aceite_termos_em from public.diaristas where cpf = $1`, [cpf1]);
    assert.deepEqual([x.status, x.origem, x.usuario_id, x.aceite_termos_em], ['aprovada', 'importada', null, null]);
  } finally {
    rmSync(pasta, { recursive: true, force: true });
    await transacao((q) => q(`delete from public.diaristas where ficticio and origem = 'importada' and usuario_id is null and nome like '%Importada Teste'`), { ator: 'limpeza_teste' });
  }
});

await t.fim();
await limparFicticios({ soEstaExecucao: true });
await fecharSql();
