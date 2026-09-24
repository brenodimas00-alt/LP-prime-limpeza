// Dados FICTÍCIOS de demonstração (nomes, CPFs e telefones inventados; CPF/CNPJ com dígito válido mas sem dono real).
// Usado pelo seed do mock (só com storage vazio) e pelos testes.
import { somarDias, dataBloqueada } from '../../src/domain/calendario.js';

export const CLIENTE_RESIDENCIAL = {
  tipo: 'residencial', nome: 'Ana Teste Fictícia', telefone: '31988887777', email: 'ana.teste@exemplo.com', cpf: '52998224725', dataNascimento: '1988-05-14',
  endereco: { cep: '30130010', logradouro: 'Rua Fictícia', numero: '100', complemento: 'apto 201', bairro: 'Savassi', cidade: 'Belo Horizonte', uf: 'MG' },
};

export const CLIENTE_EMPRESA = {
  tipo: 'empresa', nome: 'Carlos Teste', telefone: '31977776666', email: 'contato@empresa-teste.exemplo',
  cnpj: '12ABC34501DE35', razaoSocial: 'Empresa Teste de Exemplo Ltda', responsavel: 'Carlos Teste',
  endereco: { cep: '32010000', logradouro: 'Avenida Exemplo', numero: '500', complemento: 'sala 3', bairro: 'Centro', cidade: 'Contagem', uf: 'MG' },
};

export const DIARISTA_FICTICIA = {
  nome: 'Maria Teste Fictícia', cpf: '11144477735', telefone: '31966665555', email: 'maria.teste@exemplo.com', dataNascimento: '1985-04-12',
  endereco: { cep: '30140071', logradouro: 'Rua Modelo', numero: '45', complemento: '', bairro: 'Funcionários', cidade: 'Belo Horizonte', uf: 'MG' },
  experienciaAnos: 8, disponibilidade: { dias: [1, 2, 3, 4, 5], turnos: ['manha', 'tarde'], regioes: ['BH - Centro-Sul', 'Nova Lima'] },
};

/** Próxima data permitida a partir de hoje + n dias. */
export function proximaDataPermitida(hoje, n, cfg) {
  let d = somarDias(hoje, n);
  while (dataBloqueada(d, { diasBloqueados: cfg.diasBloqueados, datasBloqueadas: cfg.datasBloqueadas })) d = somarDias(d, 1);
  return d;
}

export const DIARISTA_PENDENTE = {
  nome: 'Joana Teste Pendente', cpf: '52998224725', telefone: '31955554444', email: 'joana.teste@exemplo.com', dataNascimento: '1990-09-30',
  endereco: { cep: '32010000', logradouro: 'Rua Exemplo', numero: '12', complemento: '', bairro: 'Centro', cidade: 'Contagem', uf: 'MG' },
  experienciaAnos: 3, disponibilidade: { dias: [2, 4, 6], turnos: ['tarde'], regioes: ['Contagem', 'BH - Oeste'] },
};

/** Credenciais do MODO DEMONSTRAÇÃO (mock). Nada disso existe de verdade. Listadas no README. */
export const CREDENCIAIS_MOCK = {
  // regra da cliente: por e-mail ou celular, os 6 primeiros números do CPF; pelo CPF, a data de nascimento (DDMMAAAA)
  clientes: [
    { id: '00000000-0000-4000-8000-00000000c001', telefone: CLIENTE_RESIDENCIAL.telefone, email: CLIENTE_RESIDENCIAL.email, cpf: CLIENTE_RESIDENCIAL.cpf, senha: '529982', senhaCpf: '14051988', nome: CLIENTE_RESIDENCIAL.nome },
    { id: '00000000-0000-4000-8000-00000000c002', telefone: CLIENTE_EMPRESA.telefone, email: CLIENTE_EMPRESA.email, senha: '12ABC3', nome: CLIENTE_EMPRESA.nome },
  ],
  diaristas: [
    { id: '00000000-0000-4000-8000-00000000d001', email: DIARISTA_FICTICIA.email, senha: 'diarista123', nome: DIARISTA_FICTICIA.nome },
    { id: '00000000-0000-4000-8000-00000000d002', email: DIARISTA_PENDENTE.email, senha: 'diarista123', nome: DIARISTA_PENDENTE.nome },
  ],
  prime: [{ id: '00000000-0000-4000-8000-0000000p0001', email: 'prime@exemplo.com', senha: 'prime123', nome: 'Equipe Prime' }],
};

export function montarSeed(hoje, cfg) {
  const c1 = { id: '00000000-0000-4000-8000-00000000c001', ...CLIENTE_RESIDENCIAL };
  const c2 = { id: '00000000-0000-4000-8000-00000000c002', ...CLIENTE_EMPRESA };
  const d1 = { id: '00000000-0000-4000-8000-00000000d001', ...DIARISTA_FICTICIA, identidade: 'cnh', documentos: [], status: 'aprovada' };
  const d2 = { id: '00000000-0000-4000-8000-00000000d002', ...DIARISTA_PENDENTE, identidade: 'rg', documentos: [], status: 'pendente' };
  return {
    clientes: [c1, c2],
    diaristas: [d1, d2],
    pedidos: [
      { clienteId: c1.id, pacote: { tipoServico: 'residencial', duracaoHoras: 6, metragem: 70, quantidadeDiarias: 1, frequencia: 'avulso' }, primeiraData: proximaDataPermitida(hoje, 2, cfg), turno: 'manha' },
      { clienteId: c2.id, pacote: { tipoServico: 'empresarial', duracaoHoras: 4, metragem: 90, quantidadeDiarias: 4, frequencia: 'semanal' }, primeiraData: proximaDataPermitida(hoje, 3, cfg), turno: 'tarde' },
    ],
  };
}
