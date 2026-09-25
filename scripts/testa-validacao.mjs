// E3/E5: validação de campos. node scripts/testa-validacao.mjs
import { criarSuite, assert } from './lib-teste.mjs';
import * as V from '../src/domain/validacao.js';
import { ARQUIVOS } from './fixtures/arquivos.mjs';

const t = criarSuite('validação');
const ok = (x) => assert.equal(x, '', `esperava válido, veio "${x}"`);
const erro = (x) => assert.notEqual(x, '', 'esperava erro');

t.teste('CPF: dígito verificador, repetidos, tamanho, máscara', () => {
  ok(V.validarCPF('529.982.247-25')); ok(V.validarCPF('11144477735'));
  erro(V.validarCPF('529.982.247-24')); erro(V.validarCPF('111.111.111-11')); erro(V.validarCPF('1234')); erro(V.validarCPF(''));
  assert.equal(V.mascaraCPF('52998224725'), '529.982.247-25');
});

t.teste('CNPJ numérico: DV e máscara', () => {
  ok(V.validarCNPJ('11.222.333/0001-81')); erro(V.validarCNPJ('11.222.333/0001-82')); erro(V.validarCNPJ('00000000000000'));
  assert.equal(V.mascaraCNPJ('11222333000181'), '11.222.333/0001-81');
});

t.teste('CNPJ alfanumérico (formato novo da Receita): exemplo oficial 12.ABC.345/01DE-35', () => {
  ok(V.validarCNPJ('12.ABC.345/01DE-35')); ok(V.validarCNPJ('12abc34501de35'));
  erro(V.validarCNPJ('12.ABC.345/01DE-36'));
  erro(V.validarCNPJ('12.ABC.345/01DE-3X'), 'DV tem que ser numérico');
  assert.equal(V.calcularDVCNPJ('12ABC34501DE'), '35');
  assert.equal(V.mascaraCNPJ('12abc34501de35'), '12.ABC.345/01DE-35');
});

t.teste('telefone: DDD, celular com 9, fixo, máscara', () => {
  ok(V.validarTelefone('(31) 98888-7777')); ok(V.validarTelefone('3133334444'));
  erro(V.validarTelefone('(20) 98888-7777')); erro(V.validarTelefone('31 88888-7777')); erro(V.validarTelefone('319999')); erro(V.validarTelefone('31999999999'));
  assert.equal(V.mascaraTelefone('31988887777'), '(31) 98888-7777');
});

t.teste('CEP, e-mail, data', () => {
  ok(V.validarCEP('30130-010')); erro(V.validarCEP('3013001')); erro(V.validarCEP('00000-000'));
  ok(V.validarEmail('ana@exemplo.com.br')); erro(V.validarEmail('ana@')); erro(V.validarEmail('ana exemplo.com')); erro(V.validarEmail('<a>@x.com'));
  ok(V.validarData('2026-02-28')); erro(V.validarData('2026-02-30')); erro(V.validarData('30/10/2026'));
  erro(V.validarData('2026-09-01', { hoje: '2026-10-01', permitirPassado: false }));
  erro(V.validarDataNascimento('2010-01-01', '2026-10-01'));
  ok(V.validarDataNascimento('1985-04-12', '2026-10-01'));
});

t.teste('cliente: empresa exige CNPJ, razão social e responsável; endereço completo', () => {
  const end = { cep: '30130010', logradouro: 'Rua X', numero: '1', bairro: 'Centro', cidade: 'Belo Horizonte', uf: 'MG' };
  assert.deepEqual(V.validarCliente({ tipo: 'residencial', nome: 'Ana Silva', telefone: '31988887777', email: 'a@b.com', endereco: end }), {});
  const e = V.validarCliente({ tipo: 'empresa', nome: 'Ana', telefone: '31988887777', email: 'a@b.com', endereco: { ...end, uf: 'XX', numero: '' } });
  assert.ok(e.cnpj && e.razaoSocial && e.responsavel && e['endereco.uf'] && e['endereco.numero']);
  assert.ok(V.validarCliente({ tipo: 'residencial', nome: '<script>', telefone: '31988887777', email: 'a@b.com', endereco: end }).nome);
});

t.teste('documentos da diarista: RG+verso+CPF ou CNH frente/verso; demais obrigatórios', () => {
  assert.deepEqual(V.documentosFaltando(['cnh_frente', 'cnh_verso', 'comprovante_residencia', 'foto_perfil', 'antecedentes'], 'cnh'), []);
  assert.deepEqual(V.documentosFaltando(['rg_frente', 'rg_verso', 'comprovante_residencia', 'foto_perfil', 'antecedentes'], 'rg'), ['cpf']);
  assert.deepEqual(V.documentosFaltando([], 'cnh'), ['cnh_frente', 'cnh_verso', 'comprovante_residencia', 'foto_perfil', 'antecedentes']);
});

t.teste('arquivo: tipo, tamanho, assinatura dos bytes, nome', () => {
  ok(V.validarArquivo({ nome: 'a.png', mime: 'image/png', tamanho: 100, cabecalho: ARQUIVOS.png.bytes.slice(0, 8) }));
  ok(V.validarArquivo({ nome: 'a.pdf', mime: 'application/pdf', tamanho: 100, cabecalho: ARQUIVOS.pdf.bytes.slice(0, 8) }));
  erro(V.validarArquivo({ nome: 'a.png', mime: 'image/png', tamanho: 100, cabecalho: ARQUIVOS.pdf.bytes.slice(0, 8) }));
  erro(V.validarArquivo({ nome: 'a.gif', mime: 'image/gif', tamanho: 100 }));
  erro(V.validarArquivo({ nome: 'a.png', mime: 'image/png', tamanho: 5 * 1024 * 1024 + 1 }));
  erro(V.validarArquivo({ nome: 'a.png', mime: 'image/png', tamanho: 0 }));
  erro(V.validarArquivo({ nome: '../a.png', mime: 'image/png', tamanho: 10, cabecalho: ARQUIVOS.png.bytes.slice(0, 8) }));
});

t.teste('URL permitida: só https e host da lista', () => {
  assert.equal(V.urlPermitida('https://wa.me/55', ['wa.me']), true);
  assert.equal(V.urlPermitida('http://wa.me/55', ['wa.me']), false);
  assert.equal(V.urlPermitida('javascript:alert(1)', ['wa.me']), false);
  assert.equal(V.urlPermitida('https://wa.me.mal.com/', ['wa.me']), false);
});

await t.fim();
