// B6: documentos das diaristas contra a HOMOLOGAÇÃO (só fictícios). Bucket sem acesso direto; upload pela Edge Function
// "documentos" com tipo, tamanho e assinatura real conferidos no servidor; leitura só da Prime, por URL assinada curta
// e registrada; retenção apaga arquivos de reprovadas depois do prazo.
// Uso: bash scripts/cli.sh node22 scripts/testa-b6.mjs
import { criarSuite, assert, lancaCodigo } from './lib-teste.mjs';
import { criarDiaristaPendente, criarAvulso, chave } from './cenarios.mjs';
import { ARQUIVOS } from './fixtures/arquivos.mjs';
import { CLIENTE_RESIDENCIAL } from './fixtures/seed.js';
import { montarApiDeTeste } from './lib-api-teste.mjs';
import { admin, sql, fecharSql, limparFicticios, ENV } from './lib-supabase.mjs';

const t = criarSuite('B6 documentos das diaristas (homologação)');
const URL_DOC = `${ENV.SUPABASE_URL}/functions/v1/documentos`;
const BUCKET = 'documentos-diaristas';
const PRIME = { sessao: { ator: 'prime' } };
await limparFicticios();
const { api, porDiaristaId, porEmail } = await montarApiDeTeste('b6');

const idA = await criarDiaristaPendente(api);
const idB = await criarDiaristaPendente(api);
// rascunho (cadastro ainda não enviado): é onde a dona ainda pode mandar e trocar documento
const idR = crypto.randomUUID();
await api.salvarDocumento({ diaristaId: idR, tipo: 'cpf', nomeArquivo: 'cpf.pdf', mime: 'application/pdf', tamanho: ARQUIVOS.pdf.bytes.length, conteudo: ARQUIVOS.pdf.bytes }, { sessao: { ator: 'diarista', id: idR }, chave: chave('up') });
const sA = await porDiaristaId.get(idA);
const sR = await porDiaristaId.get(idR);
const docB = (await api.listarDocumentos(idB, PRIME)).itens[0];
const docA = (await api.listarDocumentos(idA, PRIME)).itens[0];
await criarAvulso(api, chave('b6'));
const cliente = await porEmail.get(CLIENTE_RESIDENCIAL.email);

const token = async (sb) => (await sb.auth.getSession()).data.session.access_token;
async function chamar(sb, corpo, extra = {}) {
  const r = await fetch(URL_DOC, {
    method: 'POST', body: corpo instanceof FormData ? corpo : JSON.stringify(corpo),
    headers: { ...(sb ? { Authorization: `Bearer ${await token(sb)}` } : {}), ...(corpo instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...extra },
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}
function form(diaristaId, tipo, bytes, mime, nome = 'arquivo.bin') {
  const f = new FormData();
  f.append('diaristaId', diaristaId); f.append('tipo', tipo); f.append('nomeArquivo', nome); f.append('chave', chave('up'));
  f.append('arquivo', new File([bytes], nome, { type: mime }));
  return f;
}

t.teste('diarista A não lê documento da diarista B (nem o próprio); cliente não lê documento nenhum', async () => {
  for (const [quem, sessao] of [['diarista A', { ator: 'diarista', id: idA }], ['cliente', { ator: 'cliente', id: 'x' }]]) {
    for (const doc of [docA, docB]) {
      const r = await chamar(quem === 'cliente' ? cliente : sA, { acao: 'abrir', documentoId: doc.id });
      assert.equal(r.status, 404, `${quem} abrindo ${doc.id === docA.id ? 'A' : 'B'}`);
    }
    await lancaCodigo(() => api.obterArquivo(docB.id, { sessao }), 'NAO_ENCONTRADO');
  }
  // direto no bucket, sem a function: nada
  for (const sb of [sA, cliente]) {
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(docB.blobRef, 60);
    assert.ok(error || !data?.signedUrl, 'bucket não assina pra ninguém do front');
    const l = await sb.storage.from(BUCKET).list(docB.blobRef.split('/').slice(0, 2).join('/'));
    assert.ok(!l.data?.length, 'nem lista');
    const d = await sb.storage.from(BUCKET).download(docA.blobRef);
    assert.ok(d.error, 'nem baixa');
  }
  const up = await sA.storage.from(BUCKET).upload(`${docA.blobRef.split('/').slice(0, 2).join('/')}/foto_perfil-${crypto.randomUUID()}.png`, ARQUIVOS.png.bytes, { contentType: 'image/png' });
  assert.ok(up.error, 'upload direto no bucket (contornando a validação) é recusado');
});

t.teste('Prime abre por URL assinada curta; o acesso fica registrado; a URL expira', async () => {
  const antes = (await sql('select count(*)::int n from public.acessos_documentos where documento_id = $1', [docB.id]))[0].n;
  const ok = await api.obterArquivo(docB.id, PRIME);
  assert.ok(ok.conteudo.size > 0);
  const r = await chamar(null, { acao: 'abrir', documentoId: docB.id });
  assert.equal(r.status, 401, 'sem token');
  const [{ n }] = await sql('select count(*)::int n from public.acessos_documentos where documento_id = $1', [docB.id]);
  assert.equal(n, antes + 1);
  const [acesso] = await sql('select papel, user_id from public.acessos_documentos where documento_id = $1 order by id desc limit 1', [docB.id]);
  assert.equal(acesso.papel, 'prime_atendimento');
  assert.ok(acesso.user_id);
  // validade vem da configuração (120 s): confere no token da própria URL
  const tk = new URL(ok.url).searchParams.get('token');
  const claims = JSON.parse(Buffer.from(tk.split('.')[1], 'base64url').toString());
  assert.equal(claims.exp - claims.iat, 120);
  assert.equal((await fetch(ok.url)).status, 200);
  // e o Storage recusa depois de vencer
  const { data } = await admin.storage.from(BUCKET).createSignedUrl(docB.blobRef, 2);
  assert.equal((await fetch(data.signedUrl)).status, 200);
  await new Promise((ok2) => setTimeout(ok2, 4000));
  assert.ok((await fetch(data.signedUrl)).status >= 400, 'URL vencida não abre');
});

t.teste('servidor barra o que o front deixaria passar: bytes que não conferem, > 5 MB, executável, tipo e dona', async () => {
  const casos = [
    ['PDF com cara de PNG', form(idR, 'foto_perfil', ARQUIVOS.pdf.bytes, 'image/png', 'foto.png'), /não confere/],
    ['PNG declarado PDF', form(idR, 'antecedentes', ARQUIVOS.png.bytes, 'application/pdf', 'a.pdf'), /não confere/],
    ['executável', form(idR, 'antecedentes', new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4]), 'application/pdf', 'a.pdf'), /não confere/],
    ['texto', form(idR, 'cpf', new TextEncoder().encode('oi'), 'text/plain', 'a.txt'), /Formato não aceito/],
    ['maior que 5 MB', form(idR, 'foto_perfil', (() => { const b = new Uint8Array(5 * 1024 * 1024 + 10); b.set(ARQUIVOS.png.bytes.slice(0, 8)); return b; })(), 'image/png', 'g.png'), /5 MB/],
    ['tipo inexistente', form(idR, 'passaporte', ARQUIVOS.png.bytes, 'image/png', 'p.png'), /Tipo de documento/],
  ];
  for (const [nome, f, msg] of casos) {
    const r = await chamar(sR, f);
    assert.equal(r.status, 400, `${nome}: ${JSON.stringify(r.json)}`);
    assert.match(r.json.erro.mensagem, msg, nome);
  }
  const alheio = await chamar(sR, form(idA, 'foto_perfil', ARQUIVOS.png.bytes, 'image/png', 'f.png'));
  assert.equal(alheio.status, 404, 'cadastro de outra diarista (' + JSON.stringify(alheio.json) + ')');
  assert.equal((await chamar(null, form(idR, 'foto_perfil', ARQUIVOS.png.bytes, 'image/png', 'f.png'))).status, 401, 'sem token');
  // registrar direto pela RPC sem o arquivo ter passado pela function
  const { error } = await sR.rpc('registrar_documento', { p_dados: { diaristaId: idR, tipo: 'foto_perfil', nomeArquivo: 'f.png', storagePath: `${(await sR.auth.getUser()).data.user.id}/${idR}/foto_perfil-${crypto.randomUUID()}.png` }, p_chave: chave('rg') });
  assert.equal(error?.message, 'DADOS_INVALIDOS', `registrar sem arquivo: ${error?.message}`);
  const { error: e2 } = await sR.rpc('registrar_documento', { p_dados: { diaristaId: idR, tipo: 'foto_perfil', nomeArquivo: 'f.png', storagePath: docB.blobRef }, p_chave: chave('rg') });
  assert.equal(e2?.message, 'DADOS_INVALIDOS', 'caminho de outra diarista');
  const [{ n }] = await sql(`select count(*)::int n from storage.objects where bucket_id = $1 and name like $2`, [BUCKET, `%/${idR}/%`]);
  const [{ m }] = await sql('select count(*)::int m from public.documentos where diarista_id = $1', [idR]);
  assert.equal(n, m, 'nenhum arquivo órfão no bucket');
});

t.teste('upload válido grava no caminho <user_id>/<diarista>/ com tipo, tamanho e hash do servidor', async () => {
  const [{ id: uid }] = await sql('select usuario_id id from public.diaristas where id = $1', [idR]);
  const doc = await api.salvarDocumento({ diaristaId: idR, tipo: 'cpf', nomeArquivo: 'cpf-novo.png', mime: 'image/png', tamanho: ARQUIVOS.png.bytes.length, conteudo: ARQUIVOS.png.bytes }, { sessao: { ator: 'diarista', id: idR }, chave: chave('up') });
  assert.ok(doc.blobRef.startsWith(`${uid}/${idR}/cpf-`));
  const [x] = await sql('select mime, tamanho, hash_sha256 from public.documentos where id = $1', [doc.id]);
  assert.equal(x.mime, 'image/png');
  assert.equal(x.tamanho, ARQUIVOS.png.bytes.length);
  assert.match(x.hash_sha256, /^[0-9a-f]{64}$/);
  const [{ velhos }] = await sql(`select count(*)::int velhos from public.documentos where diarista_id = $1 and tipo = 'cpf' and excluido_em is not null`, [idR]);
  assert.equal(velhos, 1, 'o anterior do mesmo tipo sai de uso');
});

t.teste('repetir o mesmo arquivo com a mesma chave devolve o mesmo documento e não deixa arquivo sobrando', async () => {
  const k = chave('rep-up');
  const f = () => { const x = new FormData(); x.append('diaristaId', idR); x.append('tipo', 'foto_perfil'); x.append('nomeArquivo', 'f.png'); x.append('chave', k); x.append('arquivo', new File([ARQUIVOS.png.bytes], 'f.png', { type: 'image/png' })); return x; };
  const a = await chamar(sR, f());
  const b = await chamar(sR, f());
  assert.equal(a.status, 200, JSON.stringify(a.json));
  assert.equal(b.status, 200, JSON.stringify(b.json));
  assert.equal(b.json.id, a.json.id);
  const [{ n }] = await sql(`select count(*)::int n from storage.objects where bucket_id = $1 and name like $2`, [BUCKET, `%/${idR}/foto_perfil-%`]);
  assert.equal(n, 1, 'o arquivo da repetição saiu do bucket');
});

t.teste('corpo grande enviado em pedaços, sem tamanho declarado, cai no limite de 5 MB antes de ser lido', async () => {
  // o gateway junta os pedaços e declara o tamanho; a function recusa pelo Content-Length (ou 411 se faltar)
  const pedacos = new ReadableStream({ start(c) { for (let i = 0; i < 6; i++) c.enqueue(new Uint8Array(1024 * 1024)); c.close(); } });
  const r = await fetch(URL_DOC, { method: 'POST', body: pedacos, duplex: 'half', headers: { Authorization: `Bearer ${await token(sR)}`, 'Content-Type': 'multipart/form-data; boundary=x' } });
  const json = await r.json().catch(() => ({}));
  // visto no homolog: o gateway recusa (503) antes de chegar na function; qualquer recusa serve, nada pode ser gravado
  assert.ok(r.status >= 400, `${r.status} ${JSON.stringify(json)}`);
  const [{ n }] = await sql(`select count(*)::int n from storage.objects where bucket_id = $1 and (metadata ->> 'size')::bigint > $2`, [BUCKET, 5 * 1024 * 1024]);
  assert.equal(n, 0);
});

t.teste('limite de envios por hora por usuária', async () => {
  const uid = (await sA.auth.getUser()).data.user.id;
  await sql(`insert into privado.uploads_usuario (user_id) select $1 from generate_series(1, 30)`, [uid]);
  try {
    const r = await chamar(sA, form(idA, 'cpf', ARQUIVOS.png.bytes, 'image/png', 'c.png'));
    assert.equal(r.status, 429);
    assert.match(r.json.erro.mensagem, /Muitos envios/);
  } finally { await sql('delete from privado.uploads_usuario where user_id = $1', [uid]); }
});

t.teste('reprovação com motivo; retenção apaga os arquivos de reprovadas depois do prazo (e só elas)', async () => {
  await lancaCodigo(() => api.reprovarDiarista(idB, {}, { ...PRIME, chave: chave('rep') }), 'DADOS_INVALIDOS');
  const rb = await api.reprovarDiarista(idB, { motivo: 'documento ilegível' }, { ...PRIME, chave: chave('rep') });
  assert.equal(rb.decisao.motivo, 'documento ilegível');
  const idC = await criarDiaristaPendente(api);
  await api.reprovarDiarista(idC, { motivo: 'teste' }, { ...PRIME, chave: chave('rep') });
  // B reprovada há 91 dias, C há 89 (padrão 90, PENDENCIAS)
  await sql(`update public.diaristas set decisao = jsonb_set(decisao, '{em}', to_jsonb(to_char((now() - interval '91 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))) where id = $1 and ficticio`, [idB]);
  await sql(`update public.diaristas set decisao = jsonb_set(decisao, '{em}', to_jsonb(to_char((now() - interval '89 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))) where id = $1 and ficticio`, [idC]);
  assert.equal((await chamar(null, { acao: 'retencao' })).status, 401);
  assert.equal((await chamar(null, { acao: 'retencao' }, { 'x-worker-segredo': 'x'.repeat(48) })).status, 401);
  const r = await chamar(null, { acao: 'retencao' }, { 'x-worker-segredo': ENV.WORKER_SEGREDO });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(r.json.apagados >= 5, JSON.stringify(r.json));
  const docsB = await sql('select storage_path, arquivo_apagado_em from public.documentos where diarista_id = $1', [idB]);
  assert.ok(docsB.every((d) => d.arquivo_apagado_em));
  for (const d of docsB) assert.ok((await admin.storage.from(BUCKET).download(d.storage_path)).error, 'arquivo saiu do bucket');
  await lancaCodigo(() => api.obterArquivo(docB.id, PRIME), 'NAO_ENCONTRADO');
  const [hist] = await sql(`select historico from public.diaristas where id = $1`, [idB]);
  assert.ok(hist.historico.some((h) => h.evento === 'documentos_apagados'), 'fica no histórico (auditado)');
  const docsC = await sql('select arquivo_apagado_em from public.documentos where diarista_id = $1', [idC]);
  assert.ok(docsC.length && docsC.every((d) => !d.arquivo_apagado_em), 'reprovada há 89 dias fica');
  const docsA = await sql('select arquivo_apagado_em, excluido_em from public.documentos where diarista_id = $1', [idA]);
  assert.ok(docsA.filter((d) => !d.excluido_em).every((d) => !d.arquivo_apagado_em), 'pendente fica');
  const docsR = await sql('select arquivo_apagado_em, excluido_em from public.documentos where diarista_id = $1', [idR]);
  assert.ok(docsR.some((d) => d.excluido_em) && docsR.filter((d) => d.excluido_em).every((d) => d.arquivo_apagado_em), 'o substituído sai do bucket');
  assert.ok(docsR.filter((d) => !d.excluido_em).every((d) => !d.arquivo_apagado_em), 'o atual fica');
});

t.teste('pg_cron: retenção agendada', async () => {
  const [j] = await sql(`select schedule, active from cron.job where jobname = 'prime-retencao-documentos'`);
  assert.equal(j?.schedule, '0 7 * * *');
  assert.ok(j.active);
});

try {
  await t.fim();
} finally {
  await limparFicticios({ soEstaExecucao: true });
  await fecharSql();
}
