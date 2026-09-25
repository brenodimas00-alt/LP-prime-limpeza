// B5: provedores de notificação. meta_cloud e email contra servidor HTTP fake local; simulado travado fora de produção;
// retentativa com backoff e erro definitivo. Sem rede externa.
import { createServer } from 'node:http';
import { criarSuite, assert } from './lib-teste.mjs';
import {
  PRODUCAO_REFS, EMAIL_HABILITADO, BACKOFF_MINUTOS, MAX_TENTATIVAS, ambienteDoProjeto, nomeDoProvedor, criarProvedor,
  provedorMetaCloud, provedorEmail, enviarNotificacao,
} from '../supabase/functions/_shared/provedores.js';
import { montarPayloadMeta } from '../src/automacoes/payloadMeta.js';
import { lerPrimeEnv } from './gera-ambiente.mjs';

const t = criarSuite('provedores de notificação (B5)');
const AGORA = '2026-10-04T21:00:30.000Z';
const FUSO = 'America/Sao_Paulo';
const N = {
  id: 'n1', template: 'obrigado_avaliacao', variaveis: { nome: 'Ana' }, destinatario: { tipo: 'cliente', id: 'c1', telefone: '31988887777' },
  refs: {}, tentativas: 0, agendadaPara: AGORA,
};

// Servidor fake: responde conforme a fila `respostas` e guarda o que recebeu.
const recebidos = [];
let respostas = [];
const srv = createServer((req, res) => {
  let corpo = '';
  req.on('data', (c) => { corpo += c; });
  req.on('end', () => {
    recebidos.push({ metodo: req.method, url: req.url, auth: req.headers.authorization, corpo: corpo ? JSON.parse(corpo) : null });
    const [status, json] = respostas.shift() || [500, {}];
    res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(json));
  });
});
await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
const BASE = `http://127.0.0.1:${srv.address().port}`;
const meta = provedorMetaCloud({ fetch, urlBase: BASE, phoneNumberId: 'PNID', token: 'tok-fake' });
const email = provedorEmail({ fetch, urlBase: BASE, chave: 'chave-fake', remetente: 'Prime <avisos@exemplo.invalid>' });
const limpar = () => { recebidos.length = 0; respostas = []; };

t.teste('homologação é SEMPRE simulado, mesmo configurada pra meta_cloud; o provedor real nunca é chamado', async () => {
  const env = lerPrimeEnv();
  assert.equal(ambienteDoProjeto(env.SUPABASE_URL), 'homologacao');
  assert.ok(!PRODUCAO_REFS.includes(env.SUPABASE_PROJECT_REF));
  for (const configurado of ['meta_cloud', 'email', 'simulado', undefined, 'qualquer']) {
    assert.equal(nomeDoProvedor({ ambiente: 'homologacao', configurado }), 'simulado');
  }
  let chamadas = 0;
  const espiao = async () => { chamadas++; throw new Error('provedor real chamado'); };
  const p = criarProvedor({ ambiente: ambienteDoProjeto(env.SUPABASE_URL), configurado: 'meta_cloud', fetch: espiao, meta: { phoneNumberId: 'x', token: 'y' } });
  assert.equal(p.nome, 'simulado');
  const r = await enviarNotificacao(N, { atual: {}, agoraISO: AGORA, fuso: FUSO, provedor: p });
  assert.equal(r.status, 'simulada');
  assert.equal(r.provedor, 'simulado');
  assert.match(r.previa, /Obrigada pela resposta, Ana/);
  assert.equal(chamadas, 0);
});

t.teste('produção: meta_cloud quando configurado; e-mail só com EMAIL_HABILITADO', async () => {
  assert.equal(nomeDoProvedor({ ambiente: 'producao', configurado: 'meta_cloud' }), 'meta_cloud');
  assert.equal(EMAIL_HABILITADO, false);
  assert.equal(nomeDoProvedor({ ambiente: 'producao', configurado: 'email' }), 'simulado');
  assert.equal(nomeDoProvedor({ ambiente: 'producao', configurado: undefined }), 'simulado');
});

t.teste('meta_cloud: POST /{phone}/messages com o payload de payloadMeta.js e token; wamid gravado', async () => {
  limpar();
  respostas = [[200, { messaging_product: 'whatsapp', messages: [{ id: 'wamid.ABC' }] }]];
  const r = await enviarNotificacao(N, { atual: {}, agoraISO: AGORA, fuso: FUSO, provedor: meta });
  assert.equal(r.status, 'enviada');
  assert.equal(r.idExterno, 'wamid.ABC');
  assert.equal(r.tentativas, 1);
  assert.equal(recebidos.length, 1);
  assert.equal(recebidos[0].url, '/PNID/messages');
  assert.equal(recebidos[0].auth, 'Bearer tok-fake');
  assert.deepEqual(recebidos[0].corpo, montarPayloadMeta(N));
  assert.equal(recebidos[0].corpo.to, '5531988887777');
});

t.teste('meta_cloud: 500 e 429 voltam pra fila com backoff; 4ª falha vira erro', async () => {
  limpar();
  respostas = [[500, { error: { code: 1, message: 'falha' } }], [429, { error: { code: 130429, message: 'limite' } }], [503, {}], [500, {}]];
  let n = { ...N };
  const horarios = [];
  for (let i = 0; i < MAX_TENTATIVAS; i++) {
    const r = await enviarNotificacao(n, { atual: {}, agoraISO: AGORA, fuso: FUSO, provedor: meta });
    horarios.push(r.status);
    if (r.status === 'pendente') assert.equal(Date.parse(r.agendadaPara) - Date.parse(AGORA), BACKOFF_MINUTOS[i] * 60000);
    n = { ...n, tentativas: r.tentativas, previa: r.previa };
  }
  assert.deepEqual(horarios, ['pendente', 'pendente', 'pendente', 'erro']);
  assert.equal(recebidos.length, 4);
});

t.teste('meta_cloud: 400 (template ou número recusado) e telefone inválido vão direto pra erro', async () => {
  limpar();
  respostas = [[400, { error: { code: 132001, message: 'Template name does not exist' } }]];
  const r = await enviarNotificacao(N, { atual: {}, agoraISO: AGORA, fuso: FUSO, provedor: meta });
  assert.equal(r.status, 'erro');
  assert.equal(r.erro.codigo, '132001');
  assert.match(r.erro.mensagem, /Template name/);
  const r2 = await enviarNotificacao({ ...N, destinatario: { tipo: 'cliente', id: 'c1', telefone: '123' } }, { atual: {}, agoraISO: AGORA, fuso: FUSO, provedor: meta });
  assert.equal(r2.status, 'erro');
  assert.equal(r2.erro.codigo, 'payload');
  assert.equal(recebidos.length, 1, 'telefone inválido nem chega ao provedor');
});

t.teste('meta_cloud: servidor fora do ar = erro de rede retentável', async () => {
  const fora = provedorMetaCloud({ fetch, urlBase: 'http://127.0.0.1:1', phoneNumberId: 'PNID', token: 't', timeoutMs: 2000 });
  const r = await enviarNotificacao(N, { atual: {}, agoraISO: AGORA, fuso: FUSO, provedor: fora });
  assert.equal(r.status, 'pendente');
  assert.equal(r.erro.codigo, 'rede');
});

t.teste('email: POST /emails com remetente e texto da prévia; sem e-mail ou sem remetente = erro definitivo', async () => {
  limpar();
  respostas = [[200, { id: 'em_123' }]];
  const n = { ...N, destinatario: { ...N.destinatario, email: 'ana@exemplo.invalid' } };
  const r = await enviarNotificacao(n, { atual: {}, agoraISO: AGORA, fuso: FUSO, provedor: email });
  assert.equal(r.status, 'enviada');
  assert.equal(r.idExterno, 'em_123');
  assert.equal(recebidos[0].url, '/emails');
  assert.deepEqual(recebidos[0].corpo.to, ['ana@exemplo.invalid']);
  assert.equal(recebidos[0].corpo.text, r.previa);
  const semEmail = await enviarNotificacao(N, { atual: {}, agoraISO: AGORA, fuso: FUSO, provedor: email });
  assert.equal(semEmail.status, 'erro');
  const semRemetente = provedorEmail({ fetch, urlBase: BASE, chave: 'c' });
  assert.equal((await enviarNotificacao(n, { atual: {}, agoraISO: AGORA, fuso: FUSO, provedor: semRemetente })).status, 'erro');
  assert.equal(recebidos.length, 1);
});

t.teste('obsoleta no horário do envio = cancelada sem chamar provedor; template quebrado = erro sem retentar', async () => {
  limpar();
  const lembrete = { ...N, template: 'lembrete_vespera', variaveis: { nome: 'Ana', quando: 'amanhã, 05/10/2026,', periodo: 'manhã' }, refs: { atendimentoId: 'a1', data: '2026-10-05', turno: 'manha', diaEnvio: '2026-10-04' } };
  const cancelado = await enviarNotificacao(lembrete, { atual: { atendimento: { status: 'cancelado', data: '2026-10-05', turno: 'manha' } }, agoraISO: AGORA, fuso: FUSO, provedor: meta });
  assert.equal(cancelado.status, 'cancelada');
  const quebrado = await enviarNotificacao({ ...N, template: 'nao_existe' }, { atual: {}, agoraISO: AGORA, fuso: FUSO, provedor: meta });
  assert.equal(quebrado.status, 'erro');
  assert.equal(recebidos.length, 0);
});

await t.fim();
srv.close();
