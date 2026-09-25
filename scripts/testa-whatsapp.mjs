// E2: payload de referência da Meta, simulador do mock, contato manual e verificador de templates.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { criarSuite, assert } from './lib-teste.mjs';
import { montarPayloadMeta, paraE164, limparParametro } from '../src/automacoes/payloadMeta.js';
import { MENSAGENS } from '../src/automacoes/mensagens.js';
import { canalSimulado, linkContatoManual } from '../src/services/whatsapp.js';
import { verificar } from './verifica-templates.mjs';
import { PRIME as TESTE } from '../src/config/prime.teste.js';
import { PRIME as REAL } from '../src/config/prime.js';

const t = criarSuite('whatsapp (E2)');
const ex = (k) => Object.fromEntries(MENSAGENS[k].variaveis.map((v, i) => [v, MENSAGENS[k].exemplo[i]]));

t.teste('payload da Cloud API: estrutura, idioma, parâmetros na ordem {{1}}..{{n}}', () => {
  const p = montarPayloadMeta({ template: 'lembrete_prazo_pagamento', variaveis: ex('lembrete_prazo_pagamento'), destinatario: { telefone: '31988887777' } });
  assert.deepEqual(p, {
    messaging_product: 'whatsapp', recipient_type: 'individual', to: '5531988887777', type: 'template',
    template: { name: 'lembrete_prazo_pagamento', language: { code: 'pt_BR' }, components: [{ type: 'body', parameters: [
      { type: 'text', text: 'Ana' }, { type: 'text', text: 'R$ 175,00' }, { type: 'text', text: '05/10/2026' }, { type: 'text', text: 'hoje, até 14h' },
      { type: 'text', text: 'https://prime.exemplo/pagamento/?pagamento=abc' },
    ] }] },
  });
});

t.teste('payload pra todos os templates com os exemplos', () => {
  for (const k of Object.keys(MENSAGENS)) {
    const p = montarPayloadMeta({ template: k, variaveis: ex(k), destinatario: { telefone: '(31) 98888-7777' } });
    assert.equal(p.template.components[0].parameters.length, MENSAGENS[k].variaveis.length, k);
  }
});

t.teste('telefone vira E.164 sem +; inválido lança', () => {
  assert.equal(paraE164('31988887777'), '5531988887777');
  assert.equal(paraE164('5531988887777'), '5531988887777');
  assert.equal(paraE164('3133334444'), '553133334444');
  assert.throws(() => paraE164('123'));
});

t.teste('parâmetro: tira quebra de linha/tab, rejeita vazio', () => {
  assert.equal(limparParametro('a\nb\tc'), 'a b c');
  assert.throws(() => limparParametro('  '));
  assert.throws(() => montarPayloadMeta({ template: 'obrigado_avaliacao', variaveis: { nome: '' }, destinatario: { telefone: '31988887777' } }));
  assert.throws(() => montarPayloadMeta({ template: 'nao_existe', variaveis: {}, destinatario: { telefone: '31988887777' } }));
});

t.teste('simulador do mock marca "simulada", nunca "enviada"', () => {
  const n = canalSimulado.simular({ id: 'x', status: 'pendente' }, '2026-10-01T12:00:00.000Z');
  assert.equal(n.status, 'simulada');
  assert.equal(n.simuladaEm, '2026-10-01T12:00:00.000Z');
});

t.teste('contato manual: wa.me com texto codificado; sem WhatsApp configurado não gera link', () => {
  const u = linkContatoManual(TESTE, 'Oi! Pedido & dúvida');
  assert.equal(u, 'https://wa.me/5531900000000?text=Oi!%20Pedido%20%26%20d%C3%BAvida');
  assert.equal(linkContatoManual(REAL, 'oi'), null);
});

t.teste('verificador pega divergência entre WHATSAPP.md e mensagens.js', () => {
  const md = readFileSync(new URL('../docs/WHATSAPP.md', import.meta.url), 'utf8');
  assert.deepEqual(verificar(md), []);
  const alterado = md.replace('Qualquer imprevisto, responda esta mensagem.', 'Até já!');
  assert.ok(verificar(alterado).some((e) => e.startsWith('profissional_a_caminho: texto diverge')));
  const semUm = md.replace('### obrigado_avaliacao', '### obrigado_avaliacao_x');
  assert.ok(verificar(semUm).some((e) => e.includes('obrigado_avaliacao: ausente')));
});

t.teste('front não usa payloadMeta nem fala com provedor (src/ui, src/services, src/app)', () => {
  const arquivos = [];
  const andar = (d) => { for (const f of readdirSync(d)) { const c = join(d, f); if (statSync(c).isDirectory()) andar(c); else if (c.endsWith('.js')) arquivos.push(c); } };
  for (const d of ['src/ui', 'src/services', 'src/app']) andar(d);
  for (const f of arquivos) {
    const s = readFileSync(f, 'utf8');
    assert.ok(!/payloadMeta|graph\.facebook\.com|messaging_product/.test(s), `${f} referencia provedor`);
  }
});

await t.fim();
