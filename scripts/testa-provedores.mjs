// AUT.5: provedores por canal do motor v2. meta_cloud e e-mail (API) contra servidor HTTP fake local; SMTP genérico
// contra servidor SMTP fake (socket); simulado travado fora de produção. Sem rede externa. node scripts/testa-provedores.mjs
import { createServer } from 'node:http';
import { createServer as criarTcp } from 'node:net';
import { criarSuite, assert } from './lib-teste.mjs';
import { PRODUCAO_REFS, EMAIL_HABILITADO, ambienteDoProjeto, criarProvedores, provedorMetaCloud, provedorEmailApi, provedorSmtp } from '../supabase/functions/_shared/provedores.js';
import { TEMPLATES } from '../src/automacoes/catalogo.js';
import { layoutEmail } from '../src/automacoes/email-html.js';
import { lerPrimeEnv } from './gera-ambiente.mjs';

const t = criarSuite('provedores por canal (AUT)');
const tpl = TEMPLATES.lembrete_vespera;
const PREP = { canal: 'whatsapp', destino: '31988887777', template: 'lembrete_vespera', templateVersao: 1, corpo: tpl.corpo, variaveis: tpl.exemplo, conteudo: 'Oi, Ana! texto', assunto: tpl.assunto };

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
await new Promise((r) => srv.listen(0, r));
const BASE = `http://127.0.0.1:${srv.address().port}`;
const meta = (op = {}) => provedorMetaCloud({ fetch, urlBase: BASE, phoneNumberId: '123', token: 'tk-teste', ...op });

t.teste('homologação: WhatsApp e e-mail SEMPRE simulados (o provedor real nunca é chamado); lista de produção vazia', async () => {
  assert.deepEqual(PRODUCAO_REFS, []);
  const env = lerPrimeEnv();
  assert.equal(ambienteDoProjeto(env.SUPABASE_URL || 'https://dkafhwekgvwjttbsfxvu.supabase.co'), 'homologacao');
  let chamou = false;
  const p = criarProvedores({ ambiente: 'homologacao', fetch: async () => { chamou = true; return new Response('{}'); }, meta: { phoneNumberId: '1', token: 'x' }, whatsappLigado: true });
  assert.deepEqual([(await p.whatsapp.enviar(PREP)).status, (await p.email.enviar(PREP)).status], ['simulada', 'simulada']);
  assert.equal(chamou, false);
  assert.equal(p.ambiente.emailHabilitado, false);
});

t.teste('produção: meta_cloud só com o WhatsApp ligado; e-mail só com EMAIL_HABILITADO', async () => {
  assert.equal(criarProvedores({ ambiente: 'producao', fetch, whatsappLigado: true }).whatsapp.nome, 'meta_cloud');
  assert.equal(criarProvedores({ ambiente: 'producao', fetch }).whatsapp.nome, 'simulado');
  assert.equal(criarProvedores({ ambiente: 'producao', fetch }).email.nome, EMAIL_HABILITADO ? 'email_api' : 'simulado');
});

t.teste('meta_cloud: POST /{phone}/messages com template aprovado, parâmetros na ordem de aparição e token; wamid', async () => {
  recebidos.length = 0; respostas = [[200, { messages: [{ id: 'wamid.X' }] }]];
  const r = await meta().enviar(PREP);
  assert.deepEqual(r, { ok: true, status: 'enviada', idExterno: 'wamid.X', provedor: 'meta_cloud' });
  const c = recebidos[0];
  assert.deepEqual([c.metodo, c.url, c.auth], ['POST', '/123/messages', 'Bearer tk-teste']);
  assert.deepEqual([c.corpo.to, c.corpo.template.name, c.corpo.template.language.code], ['5531988887777', 'lembrete_vespera', 'pt_BR']);
  assert.deepEqual(c.corpo.template.components[0].parameters.map((x) => x.text), [tpl.exemplo.nome, tpl.exemplo.quando, tpl.exemplo.horario, tpl.exemplo.carga]);
  respostas = [[200, { messages: [{ id: 'wamid.Y' }] }]];
  await meta().enviar({ ...PREP, templateVersao: 3 });
  assert.equal(recebidos[1].corpo.template.name, 'lembrete_vespera_v3', 'versão editada tem nome próprio na Meta');
});

t.teste('meta_cloud: 500/429/rede = retentável; 400, telefone inválido, sem config e resposta sem id = definitivos', async () => {
  respostas = [[500, {}], [429, {}], [400, { error: { code: 132000, message: 'número de parâmetros não confere' } }], [200, {}]];
  assert.deepEqual([(await meta().enviar(PREP)).retentavel, (await meta().enviar(PREP)).retentavel], [true, true]);
  const r400 = await meta().enviar(PREP);
  assert.deepEqual([r400.ok, r400.retentavel, r400.erro.codigo], [false, false, '132000']);
  assert.equal((await meta().enviar(PREP)).retentavel, false, 'sem wamid: não retenta às cegas');
  assert.equal((await meta().enviar({ ...PREP, destino: '123' })).erro.codigo, 'payload');
  assert.equal((await meta({ token: '' }).enviar(PREP)).erro.codigo, 'config');
  assert.equal((await meta({ urlBase: 'http://127.0.0.1:9' }).enviar(PREP)).retentavel, true, 'servidor fora = rede');
});

t.teste('e-mail (API): POST /emails com remetente, assunto, texto e HTML da marca', async () => {
  recebidos.length = 0; respostas = [[200, { id: 'em-1' }], [503, {}]];
  const p = provedorEmailApi({ fetch, urlBase: BASE, chave: 'ch', remetente: 'Prime <avisos@exemplo.com>', urlSite: 'https://prime.exemplo/' });
  const r = await p.enviar({ ...PREP, canal: 'email', destino: 'ana@exemplo.com', conteudo: 'Oi, Ana! Veja https://prime.exemplo/x.' });
  assert.deepEqual([r.ok, r.idExterno], [true, 'em-1']);
  const c = recebidos[0].corpo;
  assert.deepEqual([c.to, c.subject], [['ana@exemplo.com'], tpl.assunto]);
  assert.match(c.html, /Prime Limpeza Especializada.*<a href="https:\/\/prime\.exemplo\/x"/s);
  assert.equal((await p.enviar({ ...PREP, destino: 'a@b.c' })).retentavel, true);
});

t.teste('layout do e-mail escapa HTML do texto (nada de injeção) e mantém quebras de linha', () => {
  const m = layoutEmail({ assunto: 'A', texto: 'Oi <b>Ana</b>\nLinha 2' });
  assert.ok(!m.html.includes('<b>Ana</b>')); assert.ok(m.html.includes('&lt;b&gt;Ana&lt;/b&gt;'));
  assert.equal((m.html.match(/<p style="margin:0 0 12px/g) || []).length, 2);
});

t.teste('SMTP genérico contra servidor SMTP fake: entrega com HTML; 4xx retenta, 5xx é definitivo', async () => {
  const { default: nodemailer } = await import('nodemailer');
  let modo = '250';
  const cartas = [];
  const smtp = criarTcp((s) => {
    s.write('220 fake ESMTP\r\n');
    let dados = false; let buf = '';
    s.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const linha = buf.slice(0, i); buf = buf.slice(i + 2);
        if (dados) { if (linha === '.') { dados = false; cartas.push(true); s.write(modo === '250' ? '250 ok id=abc\r\n' : `${modo} falhou\r\n`); } continue; }
        const cmd = linha.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO' || cmd === 'HELO') s.write('250-fake\r\n250 OK\r\n');
        else if (cmd === 'MAIL' || cmd === 'RCPT') s.write('250 OK\r\n');
        else if (cmd === 'DATA') { dados = true; s.write('354 manda\r\n'); } else if (cmd === 'QUIT') { s.write('221 tchau\r\n'); s.end(); } else s.write('250 OK\r\n');
      }
    });
  });
  await new Promise((r) => smtp.listen(0, r));
  const transporte = nodemailer.createTransport({ host: '127.0.0.1', port: smtp.address().port, secure: false, ignoreTLS: true });
  const p = provedorSmtp({ transporte, remetente: 'avisos@exemplo.com', urlSite: 'https://prime.exemplo/' });
  const ok = await p.enviar({ ...PREP, canal: 'email', destino: 'ana@exemplo.com' });
  assert.deepEqual([ok.ok, ok.provedor], [true, 'smtp']);
  modo = '451';
  const tmp = await p.enviar({ ...PREP, destino: 'ana@exemplo.com' });
  assert.deepEqual([tmp.ok, tmp.retentavel], [false, true]);
  modo = '550';
  const def = await p.enviar({ ...PREP, destino: 'ana@exemplo.com' });
  assert.deepEqual([def.ok, def.retentavel], [false, false]);
  assert.equal(cartas.length, 3);
  transporte.close(); smtp.close();
});

await t.fim();
srv.close();
