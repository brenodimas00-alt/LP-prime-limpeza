// E2 + AUT.5: WhatsApp. Payload da Cloud API a partir do catálogo, telefone E.164, parâmetros, contato manual (wa.me),
// verificador do WHATSAPP.md e fronteira (o front nunca monta payload nem fala com provedor). node scripts/testa-whatsapp.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { criarSuite, assert } from './lib-teste.mjs';
import { montarPayloadMeta, paraE164, limparParametro, nomeTemplateMeta } from '../src/automacoes/payloadMeta.js';
import { REGRAS, TEMPLATES, paraMeta } from '../src/automacoes/catalogo.js';
import { canalSimulado, linkContatoManual } from '../src/services/whatsapp.js';
import { PRIME as TESTE } from '../src/config/prime.teste.js';
import { PRIME as REAL } from '../src/config/prime.js';
import { verificar, gerarBloco } from './verifica-templates.mjs';
import { criarWebhook, assinatura } from '../supabase/functions/_shared/webhook-whatsapp.js';

const t = criarSuite('whatsapp (E2 + AUT.5)');
const externos = Object.entries(TEMPLATES).filter(([, x]) => x.categoriaMeta);

t.teste('payload da Cloud API: estrutura, idioma, parâmetros na ordem de aparição das variáveis', () => {
  const tpl = TEMPLATES.disponibilidade_confirmada;
  const p = montarPayloadMeta({ telefone: '(31) 98888-7777', template: 'disponibilidade_confirmada', corpo: tpl.corpo, variaveis: tpl.exemplo });
  assert.equal(p.messaging_product, 'whatsapp');
  assert.equal(p.to, '5531988887777');
  assert.deepEqual(p.template.language, { code: 'pt_BR' });
  assert.deepEqual(p.template.components[0].parameters.map((x) => x.text), paraMeta(tpl.corpo).ordem.map((k) => tpl.exemplo[k]));
  assert.equal(nomeTemplateMeta('lembrete_vespera', 2), 'lembrete_vespera_v2');
});

t.teste('payload pra todos os templates externos com os exemplos', () => {
  for (const [k, x] of externos) {
    const p = montarPayloadMeta({ telefone: '31988887777', template: k, corpo: x.corpo, variaveis: x.exemplo });
    assert.equal(p.template.components[0]?.parameters.length || 0, paraMeta(x.corpo).ordem.length, k);
  }
});

t.teste('telefone vira E.164 sem +; inválido lança', () => {
  assert.equal(paraE164('31988887777'), '5531988887777');
  assert.equal(paraE164('+55 (31) 98888-7777'), '5531988887777');
  assert.throws(() => paraE164('123'));
});

t.teste('parâmetro: tira quebra de linha/tab, rejeita vazio (variável faltando nunca vira parâmetro vazio)', () => {
  assert.equal(limparParametro('a\nb\tc'), 'a b c');
  assert.throws(() => limparParametro('  '));
  const tpl = TEMPLATES.lembrete_vespera;
  assert.throws(() => montarPayloadMeta({ telefone: '31988887777', template: 'lembrete_vespera', corpo: tpl.corpo, variaveis: { ...tpl.exemplo, carga: '' } }));
});

t.teste('simulador do mock marca "simulada", nunca "enviada"', () => {
  const r = canalSimulado.simular({ id: 'n', status: 'pendente' }, '2026-10-01T12:00:00.000Z');
  assert.equal(r.status, 'simulada');
});

t.teste('contato manual: wa.me com texto codificado; sem WhatsApp configurado não gera link', () => {
  assert.equal(linkContatoManual(TESTE, 'Oi! Pedido & dúvida'), 'https://wa.me/5531900000000?text=Oi!%20Pedido%20%26%20d%C3%BAvida');
  assert.equal(linkContatoManual(REAL, 'oi'), null);
});

t.teste('verificador pega divergência entre WHATSAPP.md e o catálogo, categoria errada e marketing sem SAIR', () => {
  const md = readFileSync(new URL('../docs/WHATSAPP.md', import.meta.url), 'utf8');
  assert.deepEqual(verificar(md), []);
  assert.ok(verificar(md.replace('Recebemos sua solicitação', 'Recebi a solicitação')).some((e) => /solicitacao_recebida: texto diverge/.test(e)));
  const i = md.indexOf('### renovacao_pacote');
  const trocado = md.slice(0, i) + md.slice(i).replace('Categoria: MARKETING', 'Categoria: UTILITY');
  assert.ok(verificar(trocado).some((e) => /renovacao_pacote: categoria/.test(e)));
  assert.ok(gerarBloco().includes('| M01 | `renovacao_pacote` | MARKETING |'));
  assert.equal(REGRAS.filter((r) => TEMPLATES[r.template].categoriaMeta === 'MARKETING').length, 3);
});

t.teste('front não usa payloadMeta nem fala com provedor (src/ui, src/services, src/app)', () => {
  const arqs = [];
  const andar = (d) => { for (const f of readdirSync(d)) { const c = join(d, f); if (statSync(c).isDirectory()) andar(c); else if (c.endsWith('.js')) arqs.push(c); } };
  for (const d of ['src/ui', 'src/services', 'src/app']) andar(d);
  for (const f of arqs) {
    const s = readFileSync(f, 'utf8');
    assert.ok(!/payloadMeta|graph\.facebook\.com|provedores\.js/.test(s), f);
  }
});

t.teste('webhook: corpo acima de 512 KiB é recusado (413) sem ler tudo, com ou sem content-length; o normal passa', async () => {
  let lidos = 0;
  const wh = criarWebhook({ verifyToken: 'v', appSecret: 's', status: async () => 'ok', mensagem: async () => 'ok' });
  const pedaco = new Uint8Array(64 * 1024);
  const infinito = new ReadableStream({ pull(c) { lidos++; if (lidos > 1000) c.close(); else c.enqueue(pedaco); } });
  const r1 = await wh(new Request('https://x/', { method: 'POST', body: infinito, duplex: 'half' }));
  assert.equal(r1.status, 413);
  assert.ok(lidos < 20, `leu ${lidos} pedaços de 64 KiB antes de desistir`);
  const r2 = await wh(new Request('https://x/', { method: 'POST', body: 'x', headers: { 'content-length': String(600 * 1024) } }).clone());
  assert.equal(r2.status, 413);
  const corpo = JSON.stringify({ entry: [] });
  const r3 = await wh(new Request('https://x/', { method: 'POST', body: corpo, headers: { 'x-hub-signature-256': await assinatura('s', corpo) } }));
  assert.equal(r3.status, 200);
});

await t.fim();
