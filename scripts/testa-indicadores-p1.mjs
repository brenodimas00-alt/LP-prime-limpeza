// P1 CONTRA A HOMOLOGAÇÃO: indicadores conferidos contra um conjunto fictício montado num mês sem mais nada (março de
// 2031), dentro de uma transação DESFEITA no fim (ninguém vê); busca global mascarada, auditada sem o termo, só Prime.
// Uso: bash scripts/cli.sh node22 scripts/testa-indicadores-p1.mjs
import { criarSuite, assert } from './lib-teste.mjs';
import { sql, transacao, fecharSql, limparFicticios, entrar, criarUsuario, cpfFicticio } from './lib-supabase.mjs';

const t = criarSuite('P1 indicadores e busca (homologação)');
await limparFicticios();
const adm = await criarUsuario('p1-adm', 'prime_admin');
const atend = await criarUsuario('p1-atend', 'prime_atendimento');
const BH = { cep: '30130010', logradouro: 'Rua Fictícia', numero: '1', bairro: 'Savassi', cidade: 'Belo Horizonte', uf: 'MG' };
const CT = { ...BH, cidade: 'Contagem' };
const desfaz = (fn) => transacao(async (q) => { await fn(q); throw new Error('desfaz'); }).catch((e) => { if (e.message !== 'desfaz') throw e; });
const comoAdmin = (q, id) => q(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: id, role: 'authenticated' })]);

t.teste('indicadores de março de 2031 = o que o conjunto fictício tem (solicitações, recusa, tempo, faturamento, diárias, clientes, ticket, pesquisa, ocorrências)', async () => {
  await desfaz(async (q) => {
    const cli = async (nome) => (await q(`insert into public.clientes (tipo, nome, email, tipo_documento, documento, endereco, origem, ficticio) values ('residencial', $1, $2, 'cpf', $3, $4::jsonb, 'site', true) returning id`,
      [nome, `p1-${cpfFicticio()}@example.com`, cpfFicticio(), JSON.stringify(BH)]))[0].id;
    const C1 = await cli('Antiga Teste P1'); const C2 = await cli('Nova Teste P1');
    const [{ id: D1 }] = await q(`insert into public.diaristas (nome, cpf, telefone, email, data_nascimento, identidade, status, aceite_termos_em, ficticio) values ('Pro Teste P1', $1, '31955554444', $2, '1985-04-12', 'cnh', 'aprovada', now(), true) returning id`, [cpfFicticio(), `p1-dia-${cpfFicticio()}@example.com`]);
    const ped = async (c, criado, status, total, tipo, ende, extra = {}) => (await q(`insert into public.pedidos (cliente_id, pacote, status, total_centavos, endereco, recusa, historico, ficticio, criado_em)
      values ($1, $2::jsonb, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, true, $8::timestamptz) returning id`,
      [c, JSON.stringify({ tipoServico: tipo, modoPagamento: 'por_diaria', duracaoHoras: 4 }), status, total, JSON.stringify(ende), extra.recusa ? JSON.stringify(extra.recusa) : null,
        JSON.stringify(extra.confirmouEm ? [{ evento: 'confirmar_disponibilidade', em: extra.confirmouEm }] : []), criado]))[0].id;
    await ped(C1, '2031-02-10T10:00:00-03:00', 'concluido', 17500, 'residencial', BH); // fora do período: faz da C1 recorrente
    const P1 = await ped(C1, '2031-03-02T10:00:00-03:00', 'confirmado', 35000, 'residencial', BH, { confirmouEm: '2031-03-02T16:00:00.000Z' }); // 3 h
    await ped(C2, '2031-03-05T10:00:00-03:00', 'recusado', 17500, 'residencial', BH, { recusa: { motivo: 'sem profissional' } });
    const P3 = await ped(C2, '2031-03-10T10:00:00-03:00', 'aguardando_pagamento', 20000, 'empresarial', CT, { confirmouEm: '2031-03-10T18:00:00.000Z' }); // 5 h
    const at = async (p, seq, data, min, status, dia = null) => (await q(`insert into public.atendimentos (pedido_id, sequencia, data, hora_inicio, duracao_minutos, status, valor_dia_centavos, diarista_id)
      values ($1, $2, $3, '08:00', $4, $5, 17500, $6) returning id`, [p, seq, data, min, status, dia]))[0].id;
    const A1 = await at(P1, 1, '2031-03-10', 240, 'avaliado', D1);
    const A2 = await at(P1, 2, '2031-03-17', 360, 'confirmado');
    await at(P1, 3, '2031-03-24', 240, 'cancelado');
    const A4 = await at(P3, 1, '2031-03-20', 240, 'agendado');
    const pag = (p, a, v, vence, status, conf) => q(`insert into public.pagamentos (pedido_id, atendimento_id, parcela, valor_centavos, pix_txid, vence_em, vence_as, status, confirmado_em)
      values ($1, $2, 'diaria', $3, $4, $5, '14:00', $6, $7::timestamptz)`, [p, a, v, `p1${Math.random().toString(36).slice(2, 20)}`, vence, status, conf]);
    await pag(P1, A1, 17500, '2031-03-09', 'confirmado', '2031-03-08T12:00:00-03:00');
    await pag(P1, A2, 17500, '2031-03-16', 'confirmado', '2031-03-15T12:00:00-03:00');
    await pag(P3, A4, 20000, '2031-03-19', 'pendente', null);
    await q(`insert into public.avaliacoes (atendimento_id, notas, nota_final, criado_em) values ($1, '{"pontualidade":4,"qualidade":5,"cuidado":5,"comunicacao":4}', 4.5, '2031-03-11T12:00:00-03:00')`, [A1]);
    await q(`insert into public.ocorrencias (atendimento_id, cliente_id, tipo, descricao, criado_em) values ($1, $2, 'dano', 'Riscou a mesa da sala', '2031-03-12T12:00:00-03:00')`, [A1, C1]);
    await comoAdmin(q, adm.id);
    const [{ r }] = await q(`select public.indicadores('2031-03-01', '2031-03-31') r`);
    assert.deepEqual(r.solicitacoes, { total: 3, porEstado: { confirmado: 1, recusado: 1, aguardando_pagamento: 1 } });
    assert.deepEqual([Number(r.recusa.total), Number(r.recusa.taxa), r.recusa.motivos], [1, 33.3, [{ motivo: 'sem profissional', n: 1 }]]);
    assert.equal(Number(r.horasAteConfirmar), 4);
    assert.deepEqual([Number(r.faturamento.previstoCentavos), Number(r.faturamento.recebidoCentavos)], [55000, 35000]);
    assert.deepEqual(r.diarias, { total: 3, porServico: { residencial: 2, empresarial: 1 }, porCarga: { '4h': 2, '6h': 1 }, porRegiao: { 'Belo Horizonte': 2, Contagem: 1 } });
    assert.deepEqual(r.clientes, { novos: 1, recorrentes: 1 });
    assert.equal(Number(r.ticketMedioCentavos), 27500);
    assert.equal(r.pesquisa.respostas, 1);
    assert.deepEqual(Object.fromEntries(Object.entries(r.pesquisa.porCriterio).map(([k, v]) => [k, Number(v)])), { pontualidade: 4, qualidade: 5, cuidado: 5, comunicacao: 4 });
    assert.deepEqual(r.pesquisa.porProfissional.map((x) => [x.nome, Number(x.media), x.n]), [['Pro Teste P1', 4.5, 1]]);
    assert.deepEqual(r.ocorrencias, { dano: 1 });
    // conferência cruzada com SQL direto (o que a spec pede)
    const [{ n, soma }] = await q(`select count(*)::int n, sum(valor_centavos)::int soma from public.pagamentos where status = 'confirmado' and confirmado_em >= '2031-03-01T00:00:00-03:00' and confirmado_em < '2031-04-01T00:00:00-03:00'`);
    assert.deepEqual([n, soma], [2, Number(r.faturamento.recebidoCentavos)]);
  });
});

t.teste('indicadores: só a administração; período de até 1 ano', async () => {
  await desfaz(async (q) => {
    await comoAdmin(q, atend.id);
    await assert.rejects(q(`select public.indicadores('2031-03-01', '2031-03-31')`), /ATOR_SEM_PERMISSAO/);
  });
  await desfaz(async (q) => {
    await comoAdmin(q, adm.id);
    await assert.rejects(q(`select public.indicadores('2030-01-01', '2031-03-31')`), /DADOS_INVALIDOS/);
  });
});

t.teste('busca: por nome, CPF, telefone e e-mail; resultado mascarado; auditada sem o termo; mínimo 3 letras; só Prime', async () => {
  const u = await criarUsuario('p1-busca');
  const cpf = cpfFicticio(); const nome = `Zuleide Busca ${Math.random().toString(36).replace(/[^a-z]/g, '').slice(0, 6)}`;
  await sql(`insert into public.clientes (usuario_id, tipo, nome, email, telefone, tipo_documento, documento, endereco, origem, ficticio) values ($1, 'residencial', $2, $3, '31955501234', 'cpf', $4, $5::jsonb, 'site', true)`,
    [u.id, nome, u.email, cpf, JSON.stringify(BH)]);
  const c = await entrar(atend);
  for (const termo of [nome.slice(0, 12).toLowerCase(), cpf, `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`, u.email, '(31) 95550-1234']) {
    const { data, error } = await c.rpc('buscar', { p_termo: termo });
    assert.equal(error, null, `${termo}: ${JSON.stringify(error)}`);
    const achado = data.find((x) => x.nome === nome);
    assert.ok(achado, `achou por ${termo.includes('@') ? 'e-mail' : /\d/.test(termo) ? 'número' : 'nome'}`);
    assert.equal(achado.documento, `***.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-**`);
    assert.equal(achado.telefone, '(31) 9****-1234');
    assert.match(achado.email, /^t\*\*\*@example\.com$/);
  }
  const [a] = await sql(`select depois from public.auditoria where tabela = 'busca' order by id desc limit 1`);
  assert.deepEqual(Object.keys(a.depois).sort(), ['resultados', 'tamanho', 'tipo']);
  assert.ok(!JSON.stringify(a.depois).includes(cpf.slice(3, 9)), 'o termo não fica na auditoria');
  assert.equal((await c.rpc('buscar', { p_termo: 'ab' })).error?.message, 'DADOS_INVALIDOS');
  const cli = await entrar(u);
  assert.ok((await cli.rpc('buscar', { p_termo: nome })).error, 'cliente não busca');
});

await t.fim();
await limparFicticios({ soEstaExecucao: true });
await fecharSql();
