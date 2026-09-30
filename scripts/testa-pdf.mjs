// P3: PDF do recibo (puro). Estrutura válida (xref aponta pro início de cada objeto, startxref certo), acentos em
// WinAnsi, parênteses escapados, campo da empresa não preenchido sai "a preencher", estornado avisa. node scripts/testa-pdf.mjs
import { criarSuite, assert } from './lib-teste.mjs';
import { gerarPdf } from '../src/domain/pdf.js';
import { linhasRecibo } from '../src/domain/recibo.js';

const t = criarSuite('P3 recibo em PDF');
const texto = (bytes) => String.fromCharCode(...bytes);
const R = { numero: 7, pagador: 'Joana (teste) Ávila', tipoDocumento: 'cpf', documento: '01234567890', valorCentavos: 17501, metodo: 'manual',
  confirmadoEm: '2026-10-02T13:00:00Z', pedidoId: 'abcdef12-0000-4000-8000-000000000000', referente: 'Diária de limpeza de 05/10/2026, das 08:00 às 12:00', situacao: 'confirmado' };
const EMP = { razaoSocial: 'PREENCHER', cnpj: 'PREENCHER', endereco: { rua: 'PREENCHER', bairro: 'PREENCHER', cidade: 'Belo Horizonte', uf: 'MG' } };

t.teste('estrutura: cabeçalho, xref com os deslocamentos certos e startxref', () => {
  const s = texto(gerarPdf(linhasRecibo(R, EMP), { titulo: 'Recibo 000007' }));
  assert.ok(s.startsWith('%PDF-1.4'));
  assert.ok(s.trimEnd().endsWith('%%EOF'));
  const xref = s.indexOf('xref\n');
  assert.equal(Number(s.match(/startxref\n(\d+)/)[1]), xref);
  const offs = [...s.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  assert.equal(offs.length, 7);
  offs.forEach((o, i) => assert.ok(s.startsWith(`${i + 1} 0 obj`, o), `objeto ${i + 1}`));
  const len = Number(s.match(/<< \/Length (\d+) >>\nstream\n/)[1]);
  const ini = s.indexOf('stream\n') + 7;
  assert.equal(s.slice(ini + len, ini + len + 10), '\nendstream');
});

t.teste('texto do recibo: número, valor com centavo ímpar, documento formatado, acentos e parênteses', () => {
  const s = texto(gerarPdf(linhasRecibo(R, EMP)));
  assert.match(s, /RECIBO N\\272 000007/);
  assert.match(s, /R\$ 175,01/);
  assert.match(s, /CPF 012\.345\.678-90/);
  assert.match(s, /Joana \\\(teste\\\) \\301vila/);
  assert.match(s, /a preencher/);
  assert.match(s, /n\\343o substitui a nota fiscal/);
  assert.doesNotMatch(s, /PREENCHER/);
});

t.teste('estornado avisa no recibo; caractere fora do Latin-1 não quebra o arquivo', () => {
  const s = texto(gerarPdf(linhasRecibo({ ...R, situacao: 'estornado', estorno: { motivo: 'imprevisto' }, pagador: 'Ana \u2713' }, EMP)));
  assert.match(s, /ESTORNADO: imprevisto/);
  assert.match(s, /Ana \?/);
});

await t.fim();
