// Auditoria de segurança (pré-lançamento, 30/09): ataca cada RPC exposta e cada tabela como um atacante externo, CONTRA A HOMOLOGAÇÃO.
// Atacantes: anônimo, cliente A (contra os dados da cliente B), profissional Y (contra os da profissional X) e cliente/profissional
// tentando ação da Prime. Oráculos: (1) chamada fora do permitido pro papel que não dá erro; (2) resposta que contém marca da vítima
// (nome, e-mail, CPF, telefone, endereço); (3) linha da vítima ou configuração global que muda depois da chamada.
// Só dados fictícios (teste-*@example.com, ficticio = true); limpa o que criou. Uso: node scripts/testa-auditoria.mjs [--matriz]
import { randomUUID } from 'node:crypto';
import { criarSuite, assert } from './lib-teste.mjs';
import { ENV, admin, anonimo, conta, criarUsuario, entrar, sql, fecharSql, limparFicticios, cpfFicticio, aceitarTermos, emailTeste, TOKEN_TESTE_TURNSTILE } from './lib-supabase.mjs';

const MATRIZ = process.argv.includes('--matriz');
const t = criarSuite('Auditoria: RPC e tabelas contra atacante (homologação)');
await limparFicticios();

// ---------- fixture ----------
const u = {
  cliA: await criarUsuario('aud-cli-a'), cliB: await criarUsuario('aud-cli-b'),
  diaX: await criarUsuario('aud-dia-x', 'diarista'), diaY: await criarUsuario('aud-dia-y', 'diarista'),
};
const MARCA = `Vitima${randomUUID().slice(0, 6)}`;
const cpfB = cpfFicticio(); const cpfX = cpfFicticio();
const telB = `3197${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
const endB = JSON.stringify({ cep: '30130010', logradouro: `Rua ${MARCA}`, numero: '77', complemento: '', bairro: 'Savassi', cidade: 'Belo Horizonte', uf: 'MG' });
const endA = JSON.stringify({ cep: '30130010', logradouro: 'Rua Atacante', numero: '1', complemento: '', bairro: 'Savassi', cidade: 'Belo Horizonte', uf: 'MG' });
async function cliente(us, nome, cpf, tel, end) {
  const [r] = await sql(`insert into public.clientes (usuario_id, tipo, nome, telefone, email, tipo_documento, documento, endereco, data_nascimento, origem, ficticio)
    values ($1, 'residencial', $2, $3, $4, 'cpf', $5, $6::jsonb, '1980-02-03', 'site', true) returning id`, [us.id, nome, tel, us.email, cpf, end]);
  return r.id;
}
async function diarista(us, nome, cpf) {
  const [r] = await sql(`insert into public.diaristas (usuario_id, nome, cpf, telefone, email, data_nascimento, identidade, status, aceite_termos_em, ficticio)
    values ($1, $2, $3, '31955554444', $4, '1985-04-12', 'cnh', 'aprovada', now(), true) returning id`, [us.id, nome, cpf, us.email]);
  return r.id;
}
const id = {
  cliA: await cliente(u.cliA, 'Atacante Auditoria', cpfFicticio(), '31911112222', endA),
  cliB: await cliente(u.cliB, `Cliente ${MARCA}`, cpfB, telB, endB),
  diaX: await diarista(u.diaX, `Profissional ${MARCA}`, cpfX),
  diaY: await diarista(u.diaY, 'Profissional Atacante', cpfFicticio()),
};
for (const k of ['cliA', 'cliB']) await aceitarTermos(u[k].id);
const [pb] = await sql(`insert into public.pedidos (cliente_id, pacote, status, total_centavos, endereco, ficticio)
  values ($1, '{"tipoServico":"residencial","modoPagamento":"por_diaria","duracaoHoras":4}', 'aguardando_pagamento', 35000, $2::jsonb, true) returning id`, [id.cliB, endB]);
id.pedB = pb.id;
const [ab] = await sql(`insert into public.atendimentos (pedido_id, sequencia, data, hora_inicio, duracao_minutos, diarista_id, valor_dia_centavos, status)
  values ($1, 1, current_date - 2, '08:00', 240, $2, 17500, 'finalizado') returning id`, [id.pedB, id.diaX]);
id.ateB = ab.id;
const [ab2] = await sql(`insert into public.atendimentos (pedido_id, sequencia, data, hora_inicio, duracao_minutos, diarista_id, valor_dia_centavos)
  values ($1, 2, current_date + 9, '08:00', 240, $2, 17500) returning id`, [id.pedB, id.diaX]);
id.ateB2 = ab2.id;
const [pg1] = await sql(`insert into public.pagamentos (pedido_id, atendimento_id, parcela, valor_centavos, pix_txid, vence_em, vence_as)
  values ($1, $2, 'diaria', 17500, $3, current_date + 8, '14:00') returning id`, [id.pedB, id.ateB2, randomUUID().replace(/-/g, '').slice(0, 25)]);
id.pagB = pg1.id;
const [oc] = await sql(`insert into public.ocorrencias (atendimento_id, cliente_id, tipo, descricao) values ($1, $2, 'outro', $3) returning id`, [id.ateB, id.cliB, `Ocorrência ${MARCA}`]);
id.ocoB = oc.id;
const [he] = await sql(`insert into public.horas_extras (atendimento_id, horas, observacao) values ($1, 1, $2) returning id`, [id.ateB, `Hora ${MARCA}`]);
id.heB = he.id;
await sql(`insert into public.checklist_respostas (atendimento_id, itens) values ($1, $2::jsonb)`, [id.ateB, JSON.stringify([{ item: `Item ${MARCA}`, feito: true }])]);
const [bl] = await sql(`insert into public.bloqueios_profissional (diarista_id, de, ate, motivo, observacao) values ($1, current_date + 30, current_date + 31, 'folga', $2) returning id`, [id.diaX, `Folga ${MARCA}`]);
id.bloX = bl.id;
const [dc] = await sql(`insert into public.documentos (diarista_id, tipo, nome_arquivo, mime, tamanho, storage_path) values ($1, 'foto_perfil', $2, 'image/png', 10, $3) returning id`, [id.diaX, `${MARCA}.png`, `${u.diaX.id}/${randomUUID()}.png`]);
id.docX = dc.id;
await sql(`insert into public.acessos (user_id, email, resultado, ip) values ($1, $2, 'sucesso', '203.0.113.9')`, [u.cliB.id, u.cliB.email]);

const MARCAS = [MARCA, cpfB, cpfX, telB, u.cliB.email, u.diaX.email, cpfB.slice(3, 9), cpfX.slice(3, 9)];
const VITIMAS = [id.cliB, id.diaX, id.pedB, id.ateB, id.ateB2, id.pagB, id.ocoB, id.heB, id.bloX, id.docX];

// Estado da vítima e da configuração global (hash): muda = alguém escreveu onde não podia.
async function estado() {
  const [r] = await sql(`select md5(concat_ws('|',
    (select string_agg(row_to_json(x)::text, '' order by x.id) from public.clientes x where x.id = $1),
    (select string_agg(row_to_json(x)::text, '' order by x.id) from public.diaristas x where x.id = $2),
    (select string_agg(row_to_json(x)::text, '' order by x.id) from public.pedidos x where x.id = $3),
    (select string_agg(row_to_json(x)::text, '' order by x.id) from public.atendimentos x where x.pedido_id = $3),
    (select string_agg(row_to_json(x)::text, '' order by x.id) from public.pagamentos x where x.pedido_id = $3),
    (select string_agg(row_to_json(x)::text, '' order by x.id) from public.ocorrencias x where x.cliente_id = $1),
    (select string_agg(row_to_json(x)::text, '' order by x.id) from public.horas_extras x where x.atendimento_id = $4),
    (select string_agg(row_to_json(x)::text, '') from public.checklist_respostas x where x.atendimento_id = $4),
    (select string_agg(row_to_json(x)::text, '' order by x.id) from public.bloqueios_profissional x where x.diarista_id = $2),
    (select string_agg(row_to_json(x)::text, '' order by x.id) from public.documentos x where x.diarista_id = $2),
    (select string_agg(row_to_json(x)::text, '' order by x.user_id) from public.perfis x where x.user_id = any($5::uuid[])),
    (select string_agg(row_to_json(x)::text, '' order by x.chave) from public.configuracao x),
    (select string_agg(row_to_json(x)::text, '' order by x.chave) from public.config_flags x),
    (select string_agg(row_to_json(x)::text, '' order by x.id) from public.precos x),
    (select string_agg(row_to_json(x)::text, '' order by x.codigo) from public.automacao_regras x),
    (select string_agg(row_to_json(x)::text, '' order by 1) from public.automacao_config x),
    (select count(*)::text from public.templates),
    (select string_agg(row_to_json(x)::text, '' order by x.tipo_servico) from public.checklists x),
    (select string_agg(row_to_json(x)::text, '' order by x.cidade) from public.regioes x)
  )) h`, [id.cliB, id.diaX, id.pedB, id.ateB, [u.cliB.id, u.diaX.id]]);
  return r.h;
}

// ---------- o que cada papel PODE chamar (o resto tem que dar erro) ----------
const PUBLICAS = ['cotar_solicitacao', 'registrar_erro', 'registrar_funil', 'versao_condicoes', 'versao_legal'];
const DE_TITULAR = ['definir_consentimento', 'meus_dados', 'pedir_exclusao', 'registrar_aceite', 'situacao_legal', 'reservar_upload_documento',
  'iniciar_cadastro_diarista', 'cadastrar_diarista', 'registrar_documento'];
const PERMITIDAS = {
  // listar_* da cliente e da profissional devolvem só o que é dela (o oráculo de vazamento confere); com id que não existe, lista vazia
  cliente: new Set([...PUBLICAS, ...DE_TITULAR, 'solicitar_atendimento', 'confirmar_autoagendamento', 'listar_pedidos', 'listar_ocorrencias', 'listar_documentos']),
  diarista: new Set([...PUBLICAS, ...DE_TITULAR, 'listar_atendimentos_da_diarista', 'obter_diarista', 'listar_documentos', 'listar_horas_extras', 'registrar_localizacao']),
};
// Estas recebem id de recurso: pro atacante, com o id da VÍTIMA, têm que dar erro mesmo sendo do papel dele.
// (listar_* e obter_* próprios acima não recebem id da vítima de forma que devolva algo: o oráculo de vazamento cobre.)

const funcoes = await sql(`select p.proname nome, coalesce(p.proargnames, '{}') nomes, array(select format_type(x, null) from unnest(p.proargtypes) x) tipos,
    has_function_privilege('anon', p.oid, 'EXECUTE') anon
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('authenticated', p.oid, 'EXECUTE') order by 1`);
// o cadastro de profissional muda o papel principal de quem chama (cliente vira profissional): por último, pra não contaminar o resto
const MUDAM_PAPEL = ['iniciar_cadastro_diarista', 'cadastrar_diarista', 'registrar_documento'];
funcoes.sort((a, b) => MUDAM_PAPEL.includes(a.nome) - MUDAM_PAPEL.includes(b.nome));
const codigos = [];

const IDS_JSON = { id: id.pedB, pedidoId: id.pedB, atendimentoId: id.ateB2, pagamentoId: id.pagB, clienteId: id.cliB, diaristaId: id.diaX,
  ocorrenciaId: id.ocoB, documentoId: id.docX, horaExtraId: id.heB, bloqueioId: id.bloX, cliente: id.cliB, diarista: id.diaX, pedido: id.pedB,
  // campos plausíveis pra passar da validação e chegar na checagem de dono
  tipo: 'outro', descricao: 'Descrição plausível da auditoria de segurança', horas: 1, motivo: 'Motivo plausível da auditoria', observacao: 'obs',
  evento: 'iniciar', lat: -19.93, lon: -43.94, precisao: 50, estado: 'em_analise', resposta: 'ok', nota: 5, acao: 'iniciar', data: '2031-03-10', horaInicio: '08:00',
  notas: { pontualidade: 5, qualidade: 5, cuidado: 5, comunicacao: 5 }, itens: [], de: '2031-03-10', ate: '2031-03-11', dias: 1, canal: 'painel', texto: 'Contato plausível' };
function argumentos(f, alvo) {
  const a = {};
  f.nomes.forEach((n, i) => {
    const tp = f.tipos[i];
    if (tp === 'uuid') a[n] = alvo;
    else if (tp === 'jsonb') a[n] = { ...IDS_JSON, id: alvo };
    else if (tp === 'text') a[n] = n === 'p_chave' ? `aud-${randomUUID()}` : n === 'p_tipo' ? 'clientes' : n === 'p_termo' ? MARCA : n === 'p_versao' ? 'x' : 'x';
    else if (tp === 'date') a[n] = '2026-09-01';
    else if (tp === 'boolean') a[n] = true;
    else if (tp === 'integer') a[n] = 1;
    else a[n] = null;
  });
  return a;
}
const temUuid = (f) => f.tipos.includes('uuid') || f.tipos.includes('jsonb');

const sessoes = { anonimo: anonimo(), cliente: await entrar(u.cliA), diarista: await entrar(u.diaY) };
const achados = [];
const matriz = [];
let hash = await estado();

for (const f of funcoes) {
  for (const [papel, c] of Object.entries(sessoes)) {
    if (papel === 'anonimo' && f.anon) continue; // públicas: testadas à parte (tamanho, limite)
    const alvos = temUuid(f) ? VITIMAS : [null];
    let sucesso = 0;
    for (const alvo of alvos) {
      const { data, error } = await c.rpc(f.nome, argumentos(f, alvo));
      const txt = JSON.stringify(data ?? '') + JSON.stringify(error ?? '');
      const vaz = MARCAS.find((m) => m && txt.includes(m));
      if (vaz) achados.push(`${papel} ${f.nome}(${alvo ?? ''}): resposta traz dado da vítima`);
      if (!error) sucesso++;
      else codigos.push(`${papel} ${f.nome} ${error.code === 'P0001' ? error.message : error.code}`);
      const novo = await estado();
      if (novo !== hash) { achados.push(`${papel} ${f.nome}(${alvo ?? ''}): alterou dado da vítima ou configuração global`); hash = novo; }
      if (!error && papel !== 'anonimo' && !PERMITIDAS[papel].has(f.nome)) achados.push(`${papel} ${f.nome}(${alvo ?? ''}): chamada da Prime aceita`);
      if (!error && papel === 'anonimo') achados.push(`anonimo ${f.nome}: aceita sem login`);
    }
    matriz.push(`${f.nome.padEnd(34)} ${papel.padEnd(9)} ${sucesso}/${alvos.length} sem erro`);
  }
}
if (MATRIZ) { console.log(matriz.join('\n')); const n = {}; for (const c of codigos) n[c] = (n[c] || 0) + 1; for (const [k, v] of Object.entries(n)) console.log(`CODIGO ${k} x${v}`); }
for (const a of new Set(achados)) console.log(`ACHADO ${a}`);

t.teste(`nenhuma das ${funcoes.length} RPCs aceita ataque de anônimo, cliente ou profissional (sem erro fora do papel, sem vazamento, sem escrita)`, () => {
  const unicos = [...new Set(achados)];
  assert.ok(!unicos.length, `${unicos.length} achado(s):\n       ${unicos.join('\n       ')}`);
});

t.teste('funções liberadas pra anônimo são só as públicas previstas', () => {
  assert.deepEqual(funcoes.filter((f) => f.anon).map((f) => f.nome).sort(), [...PUBLICAS].sort());
});

t.teste('tabelas: RLS forçada em todo o public, nenhuma escrita direta pra anon/authenticated, privado fora da API', async () => {
  const r = await sql(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and (not c.relrowsecurity or not c.relforcerowsecurity
      or has_table_privilege('anon', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE') or has_table_privilege('authenticated', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE'))`);
  assert.deepEqual(r.map((x) => x.relname), []);
  const views = await sql(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('v', 'm') and (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('authenticated', c.oid, 'SELECT'))`);
  assert.deepEqual(views.map((x) => x.relname), []);
  const { error } = await anonimo().schema('privado').from('limites_acao').select('*').limit(1);
  assert.ok(error, 'schema privado exposto na API');
});

t.teste('anônimo: nenhuma tabela com dado pessoal devolve linha; escrita direta recusada', async () => {
  const anon = anonimo();
  const tabs = (await sql(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'`)).map((x) => x.relname);
  const LEITURA_PUBLICA = ['precos', 'regioes', 'feriados', 'configuracao'];
  for (const tb of tabs) {
    const { data } = await anon.from(tb).select('*').limit(5);
    if (!LEITURA_PUBLICA.includes(tb)) assert.equal(data?.length ?? 0, 0, `anônimo leu ${tb}`);
    const { error } = await anon.from(tb).insert({});
    assert.ok(error, `anônimo inseriu em ${tb}`);
  }
  const { data: cfg } = await anon.from('configuracao').select('chave');
  assert.deepEqual(cfg.map((x) => x.chave).filter((k) => !['pix', 'auth', 'regioes_diarista', 'documentos', 'horarios_trabalho', 'condicoes', 'cadastro'].includes(k)), []);
});

t.teste('cliente A e profissional Y não leem linha da vítima direto nas tabelas', async () => {
  const alvo = { clientes: [id.cliB], pedidos: [id.pedB], atendimentos: [id.ateB, id.ateB2], pagamentos: [id.pagB], ocorrencias: [id.ocoB],
    horas_extras: [id.heB], bloqueios_profissional: [id.bloX], documentos: [id.docX], diaristas: [id.diaX] };
  for (const papel of ['cliente', 'diarista']) {
    for (const [tb, ids] of Object.entries(alvo)) {
      const { data } = await sessoes[papel].from(tb).select('id').in('id', ids);
      assert.equal(data?.length ?? 0, 0, `${papel} leu ${tb} da vítima`);
    }
    const { data: ac } = await sessoes[papel].from('acessos').select('email').eq('email', u.cliB.email);
    assert.equal(ac?.length ?? 0, 0, `${papel} leu acessos da vítima`);
  }
});

t.teste('papel escalado: header x-papel de Prime em conta de cliente não dá acesso de Prime', async () => {
  for (const p of ['prime_admin', 'prime_atendimento', 'diarista']) {
    const r = await fetch(`${ENV.SUPABASE_URL}/rest/v1/rpc/listar_clientes`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ENV.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${sessoes.cliente.token}`, 'x-papel': p },
      body: JSON.stringify({ p_filtro: {} }),
    });
    assert.ok(r.status >= 400, `x-papel ${p} aceito (${r.status})`);
  }
});


// ---------- auth, Edge Functions e storage (achados da auditoria de 30/09; cada um falhava antes da correção) ----------
const funcao = (nome, init = {}) => fetch(`${ENV.SUPABASE_URL}/functions/v1/${nome}`, {
  method: 'POST', ...init, headers: { apikey: ENV.SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json', ...(init.headers || {}) },
});
const leMeusDados = async (c) => { const { error } = await c.rpc('meus_dados'); return error ? 'negado' : 'leu'; };

t.teste('sessão: troca de senha derruba na hora o token de acesso das OUTRAS sessões (não só a renovação)', async () => {
  const us = await criarUsuario('aud-sess', 'cliente', 'SenhaInicial-123');
  await sql(`insert into public.clientes (usuario_id, tipo, nome, telefone, email, tipo_documento, documento, origem, ficticio)
    values ($1, 'residencial', 'Sessão Auditoria', '31911112297', $2, 'cpf', $3, 'site', true)`, [us.id, us.email, cpfFicticio()]);
  await sql('update public.perfis set senha_propria = true where user_id = $1', [us.id]);
  await aceitarTermos(us.id);
  const s1 = await entrar(us); const s2 = await entrar(us);
  assert.equal(await leMeusDados(s2), 'leu');
  const tr = await conta('trocar_senha', { atual: 'SenhaInicial-123', nova: 'SenhaNova-456789' }, s1.token);
  assert.equal(tr.status, 200, JSON.stringify(tr.corpo));
  assert.equal(await leMeusDados(s2), 'negado', 'token antigo da outra sessão ainda lê');
  const { data: perfil } = await s2.from('perfis').select('user_id').eq('user_id', us.id);
  assert.equal(perfil?.length ?? 0, 0, 'token antigo ainda lê o próprio perfil');
  // a troca no Auth encerra todas as sessões, inclusive a de quem trocou: o front entra de novo com a nova (auth.js)
  assert.equal(await leMeusDados(await entrar({ ...us, senha: 'SenhaNova-456789' })), 'leu', 'entra com a senha nova');
  // "Sair" (encerra só esta sessão) também derruba o token dela
  const s3 = await entrar({ ...us, senha: 'SenhaNova-456789' });
  const token3 = s3.token;
  await s3.auth.signOut({ scope: 'local' });
  const c3 = anonimo(); await c3.auth.setSession({ access_token: token3, refresh_token: 'x' }).catch(() => {});
  const r = await fetch(`${ENV.SUPABASE_URL}/rest/v1/rpc/meus_dados`, { method: 'POST', headers: { apikey: ENV.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token3}`, 'Content-Type': 'application/json' }, body: '{}' });
  assert.ok(r.status >= 400, `token de sessão encerrada ainda lê (${r.status})`);
});

t.teste('enumeração: ação "cadastrar" (dizia se o CPF já é cliente) não existe mais', async () => {
  const r = await conta('cadastrar', { cliente: { tipo: 'residencial', nome: 'X', cpf: cpfB, email: emailTeste('enum'), telefone: '31911112296', dataNascimento: '1980-02-03' }, aceite: 'x' });
  assert.equal(r.status, 400); assert.equal(r.corpo?.erro?.codigo, 'DADOS_INVALIDOS');
  assert.doesNotMatch(JSON.stringify(r.corpo), /DOCUMENTO_EM_USO|EMAIL_EM_USO|cadastro/i);
});

t.teste('enumeração pelo tempo: senha errada de conta que existe e conta que não existe terminam no mesmo piso', async () => {
  const us = await criarUsuario('aud-tempo', 'diarista');
  const medir = async (email) => { const ini = performance.now(); const r = await conta('entrar', { area: 'diarista', email, senha: 'errada-123' }); assert.equal(r.status, 401); return performance.now() - ini; };
  const existe = []; const naoExiste = [];
  for (let i = 0; i < 3; i++) { existe.push(await medir(us.email)); naoExiste.push(await medir(emailTeste(`aud-nao${i}`))); }
  // o piso é 900 ms desde o início da tentativa no servidor; a rede só soma
  assert.ok(Math.min(...naoExiste) >= 880, `conta inexistente respondeu em ${Math.round(Math.min(...naoExiste))} ms`);
  assert.ok(Math.min(...existe) >= 880, `conta existente respondeu em ${Math.round(Math.min(...existe))} ms`);
  await sql('delete from public.acessos where user_id = $1 or identificador like $2', [us.id, `teste-%aud-nao%`]);
});

t.teste('payload malformado: ação do protótipo ("constructor", "__proto__", "toString") é ação desconhecida, sem 500', async () => {
  for (const acao of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    const r = await funcao('conta', { body: JSON.stringify({ acao }) });
    assert.equal(r.status, 400, `${acao}: ${r.status}`);
  }
  for (const corpo of ['[]', 'null', '"x"', '{"acao":']) assert.equal((await funcao('conta', { body: corpo })).status, 400, corpo);
});

t.teste('payload gigante: conta e documentos recusam pelo tamanho declarado, antes de ler o corpo', async () => {
  // (corpo em pedaços sem tamanho o gateway já derruba com ECONNRESET, antes da function: não dá pra testar por aí)
  for (const [nome, corpo] of [['conta', { acao: 'entrar', email: 'a@b.c', senha: 'x' }], ['documentos', { acao: 'abrir', documentoId: id.docX }]]) {
    const r = await funcao(nome, { body: JSON.stringify({ ...corpo, x: 'a'.repeat(64 * 1024) }) });
    assert.equal(r.status, 413, `${nome} com 64 KB: ${r.status}`);
  }
});

t.teste('Edge Functions sem autenticação: worker, webhook, ações da Prime e documentos recusam', async () => {
  assert.equal((await funcao('notificacoes', { body: '{}' })).status, 401);
  assert.equal((await funcao('notificacoes', { body: '{}', headers: { 'x-worker-segredo': 'a'.repeat(48) } })).status, 401);
  assert.ok([401, 503].includes((await funcao('whatsapp-webhook', { body: '{}' })).status), 'webhook sem assinatura');
  for (const acao of ['bloquear', 'desbloquear', 'redefinir_senha', 'completar_email', 'executar_exclusao', 'trocar_senha']) {
    const r = await funcao('conta', { body: JSON.stringify({ acao, userId: u.cliB.id }) });
    assert.equal(r.status, 401, `${acao}: ${r.status}`);
  }
  const cli = await entrar(u.cliA);
  for (const acao of ['bloquear', 'redefinir_senha', 'executar_exclusao']) {
    const r = await conta(acao, { userId: u.cliB.id, pedidoId: randomUUID() }, cli.token);
    assert.equal(r.status, 403, `cliente em ${acao}: ${r.status}`);
  }
  assert.equal((await funcao('documentos', { body: JSON.stringify({ acao: 'abrir', documentoId: id.docX }), headers: { Authorization: `Bearer ${cli.token}` } })).status >= 400, true);
  assert.equal((await funcao('documentos', { body: JSON.stringify({ acao: 'retencao' }) })).status, 401);
});

t.teste('storage: documento de profissional só por URL assinada válida (sem URL pública, sem listar, expirada ou adulterada recusa)', async () => {
  const caminho = (await sql('select storage_path from public.documentos where id = $1', [id.docX]))[0].storage_path;
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5f2d0a90000000049454e44ae426082', 'hex');
  const { error: eup } = await admin.storage.from('documentos-diaristas').upload(caminho, png, { contentType: 'image/png', upsert: true });
  assert.ifError(eup);
  const publica = `${ENV.SUPABASE_URL}/storage/v1/object/public/documentos-diaristas/${caminho}`;
  assert.ok((await fetch(publica)).status >= 400, 'URL pública abre');
  for (const [nome, c] of [['anônimo', anonimo()], ['cliente', await entrar(u.cliA)], ['outra profissional', await entrar(u.diaY)]]) {
    const { data, error } = await c.storage.from('documentos-diaristas').download(caminho);
    assert.ok(error || !data, `${nome} baixou o documento`);
    const { data: lista } = await c.storage.from('documentos-diaristas').list(u.diaX.id);
    assert.equal(lista?.length ?? 0, 0, `${nome} listou a pasta`);
    const { error: eu } = await c.storage.from('documentos-diaristas').upload(`${u.diaX.id}/intruso.png`, png, { contentType: 'image/png' });
    assert.ok(eu, `${nome} gravou no bucket`);
  }
  const { data: ass } = await admin.storage.from('documentos-diaristas').createSignedUrl(caminho, 2);
  assert.equal((await fetch(ass.signedUrl)).status, 200, 'URL assinada válida abre');
  const adulterada = ass.signedUrl.replace(/token=([^&]+)/, (m, tk) => `token=${tk.slice(0, -4)}AAAA`);
  assert.ok((await fetch(adulterada)).status >= 400, 'URL com token adulterado abre');
  await new Promise((r) => setTimeout(r, 3500));
  assert.ok((await fetch(ass.signedUrl)).status >= 400, 'URL assinada expirada abre');
  const outro = ass.signedUrl.replace(caminho, `${u.diaX.id}/${randomUUID()}.png`);
  assert.ok((await fetch(outro)).status >= 400, 'token de um arquivo abre outro');
});

const falhas = await t.fim();
await limparFicticios({ soEstaExecucao: true });
await fecharSql();
process.exit(falhas ? 1 : 0);
