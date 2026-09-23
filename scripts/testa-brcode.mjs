// E4: BR Code Pix estático (EMV). node scripts/testa-brcode.mjs
import { criarSuite, assert, lancaCodigo } from './lib-teste.mjs';
import { crc16, montarBRCode, lerTLV, normalizarTextoPix, txidDeBytes, RE_TXID } from '../src/domain/brcode.js';
import { gerarQR } from '../src/domain/qrcode.js';

const t = criarSuite('brcode (E4)');

t.teste('CRC16-CCITT-FALSE contra vetores conhecidos', () => {
  assert.equal(crc16('123456789'), '29B1');
  assert.equal(crc16(''), 'FFFF');
  assert.equal(crc16('A'), 'B915');
});

t.teste('BR Code do manual do Bacen (exemplo oficial, CRC 1D3D)', () => {
  // Exemplo do "Manual de Padrões para Iniciação do Pix" (chave 123e4567-e12b-12d1-a456-426655440000, sem valor).
  const semCrc = '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304';
  assert.equal(crc16(semCrc), '1D3D');
});

t.teste('estrutura: campos obrigatórios, valor com centavos, txid, CRC válido', () => {
  const s = montarBRCode({ chave: '123e4567-e12b-12d1-a456-426655440000', nome: 'Prime Limpeza Teste', cidade: 'Belo Horizonte', valorCentavos: 13501, txid: 'ABC123' });
  const tlv = lerTLV(s);
  assert.equal(tlv['00'], '01');
  assert.equal(tlv['52'], '0000'); assert.equal(tlv['53'], '986'); assert.equal(tlv['58'], 'BR');
  assert.equal(tlv['54'], '135.01');
  assert.equal(tlv['59'], 'PRIME LIMPEZA TESTE'); assert.equal(tlv['60'], 'BELO HORIZONTE');
  const conta = lerTLV(tlv['26']);
  assert.equal(conta['00'], 'br.gov.bcb.pix'); assert.equal(conta['01'], '123e4567-e12b-12d1-a456-426655440000');
  assert.equal(lerTLV(tlv['62'])['05'], 'ABC123');
  assert.equal(tlv['63'].length, 4);
  assert.equal(crc16(s.slice(0, -4)), tlv['63']);
  assert.ok(!/[^\x20-\x7E]/.test(s), 'só ASCII imprimível');
});

t.teste('txid: 1 a 25 alfanuméricos; gerado tem 25 e charset válido', () => {
  const tx = txidDeBytes(new Uint8Array(25).map((_, i) => i * 7), 25);
  assert.equal(tx.length, 25); assert.ok(RE_TXID.test(tx));
  const base = { chave: 'x@y.com', nome: 'N', cidade: 'C', valorCentavos: 100 };
  assert.throws(() => montarBRCode({ ...base, txid: 'a-b' }));
  assert.throws(() => montarBRCode({ ...base, txid: 'A'.repeat(26) }));
  assert.throws(() => montarBRCode({ ...base, txid: '' }));
});

t.teste('valor: inteiro positivo em centavos; 1 -> 0.01; grande ok', () => {
  assert.equal(lerTLV(montarBRCode({ chave: 'k', nome: 'N', cidade: 'C', valorCentavos: 1, txid: 'T' }))['54'], '0.01');
  assert.equal(lerTLV(montarBRCode({ chave: 'k', nome: 'N', cidade: 'C', valorCentavos: 123456789, txid: 'T' }))['54'], '1234567.89');
  assert.throws(() => montarBRCode({ chave: 'k', nome: 'N', cidade: 'C', valorCentavos: 0, txid: 'T' }));
  assert.throws(() => montarBRCode({ chave: 'k', nome: 'N', cidade: 'C', valorCentavos: 10.5, txid: 'T' }));
});

t.teste('config incompleta bloqueia (CONFIG_INCOMPLETA)', async () => {
  await lancaCodigo(() => montarBRCode({ chave: '', nome: 'N', cidade: 'C', valorCentavos: 100, txid: 'T' }), 'CONFIG_INCOMPLETA');
  await lancaCodigo(() => montarBRCode({ chave: 'k', nome: 'PREENCHER'.replace(/./g, ''), cidade: 'C', valorCentavos: 100, txid: 'T' }), 'CONFIG_INCOMPLETA');
  await lancaCodigo(() => montarBRCode({ chave: 'k', nome: 'N', cidade: '§§§', valorCentavos: 100, txid: 'T' }), 'CONFIG_INCOMPLETA');
});

t.teste('nome e cidade: sem acento, maiúsculas, cortados em 25/15', () => {
  assert.equal(normalizarTextoPix('José da Silva Comércio & Limpeza Ltda', 25), 'JOSE DA SILVA COMERCIO LI');
  assert.equal(normalizarTextoPix('Belo Horizonte', 15), 'BELO HORIZONTE');
});

t.teste('QR: matriz quadrada, tamanho de versão válido, finder patterns nos 3 cantos', () => {
  const s = montarBRCode({ chave: '123e4567-e12b-12d1-a456-426655440000', nome: 'Prime Limpeza Teste', cidade: 'Belo Horizonte', valorCentavos: 13500, txid: 'ABCDEFGHJKLMNPQRSTUVWXYZ2' });
  const m = gerarQR(s);
  assert.ok(m.length >= 21 && (m.length - 21) % 4 === 0, `tamanho ${m.length}`);
  assert.ok(m.every((l) => l.length === m.length));
  const finder = (r, c) => [0, 6].every((i) => m[r + i][c + 3] === 1 && m[r + 3][c + i] === 1) && m[r + 3][c + 3] === 1 && m[r + 1][c + 1] === 0;
  assert.ok(finder(0, 0) && finder(0, m.length - 7) && finder(m.length - 7, 0));
});

t.teste('QR decodifica de volta pro mesmo BR Code (jsqr)', async () => {
  const jsQR = (await import('jsqr')).default;
  for (const tam of [60, 180, 320]) {
    const txt = montarBRCode({ chave: '123e4567-e12b-12d1-a456-426655440000', nome: 'Prime Limpeza Teste', cidade: 'Belo Horizonte', valorCentavos: 13500 + tam, txid: 'X'.repeat(Math.min(25, tam / 10)) });
    const m = gerarQR(txt);
    const esc = 4; const margem = 4; const n = (m.length + margem * 2) * esc;
    const img = new Uint8ClampedArray(n * n * 4).fill(255);
    m.forEach((l, r) => l.forEach((v, c) => { if (!v) return; for (let y = 0; y < esc; y++) for (let x = 0; x < esc; x++) { const i = (((r + margem) * esc + y) * n + (c + margem) * esc + x) * 4; img[i] = img[i + 1] = img[i + 2] = 0; } }));
    const lido = jsQR(img, n, n);
    assert.ok(lido, `jsqr não leu (versão ${(m.length - 17) / 4})`);
    assert.equal(lido.data, txt);
  }
});

await t.fim();
