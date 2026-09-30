// CSV pro Excel (P5 e P6), puro: BOM, ";", CRLF, data dd/mm/aaaa, dinheiro com vírgula, aspas, injeção de fórmula.
import { criarSuite, assert } from './lib-teste.mjs';
import { gerarCsv, dinheiroBR, dataBR } from '../src/domain/csv.js';

const t = criarSuite('CSV compatível com Excel');
const COLS = [{ titulo: 'Nome', campo: 'nome' }, { titulo: 'Data', campo: 'data', tipo: 'data' }, { titulo: 'Valor (R$)', campo: 'v', tipo: 'dinheiro' }, { titulo: 'Horas', campo: 'h', tipo: 'numero' }];

t.teste('formato: BOM, separador ;, CRLF, cabeçalho e valores em português', () => {
  const s = gerarCsv(COLS, [{ nome: 'Ana Maria', data: '2026-10-05', v: 17501, h: 4.5 }]);
  assert.equal(s, '﻿Nome;Data;Valor (R$);Horas\r\nAna Maria;05/10/2026;175,01;4,5\r\n');
});
t.teste('aspas, ponto e vírgula e quebra de linha no texto; vazio e nulo', () => {
  const s = gerarCsv(COLS, [{ nome: 'Rua "A"; casa 2\nfundos', data: null, v: undefined, h: 0 }]);
  assert.equal(s.split('\r\n')[1], '"Rua ""A""; casa 2\nfundos";;;0');
});
t.teste('fórmula vinda do banco não vira fórmula no Excel', () => {
  for (const x of ['=1+1', '+55 31', '-2', '@SOMA(A1)']) assert.ok(gerarCsv(COLS, [{ nome: x }]).split('\r\n')[1].startsWith(`'${x}`), x);
});
t.teste('dinheiro e data', () => {
  assert.equal(dinheiroBR(0), '0,00'); assert.equal(dinheiroBR(5), '0,05'); assert.equal(dinheiroBR(123456), '1234,56'); assert.equal(dinheiroBR(-150), '-1,50');
  assert.equal(dataBR('2026-01-02T10:00:00Z'), '02/01/2026'); assert.equal(dataBR(''), '');
});
await t.fim();
