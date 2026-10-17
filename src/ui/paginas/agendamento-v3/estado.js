// Estado do autoagendamento v3: rascunho salvo a cada mudança (item 56: "salvar progresso"), SEM CPF e data de nascimento
// (ficam só em memória e, depois do cadastro, nem isso: o servidor guarda). O rascunho NUNCA vira solicitação sozinho.
// O ticket do cadastro (opaco, 24 h, só serve pra enviar esta solicitação) acompanha o rascunho pra recarregar não refazer
// o cadastro.
import { novaChave } from '../../../services/api.js';
import { sessaoAtual } from '../../../services/sessao.js';

export const LS = 'prime.rascunho.agendamento.v3';

export function novoRascunho() {
  return {
    versao: 3, passo: 'servico', chave: novaChave(), chaveConteudo: '',
    segmento: '', servico: '',
    identificacao: '', // 'cliente' (já sou) | 'novo' (quero me cadastrar)
    contato: { nome: '', telefone: '', email: '', cnpj: '', razaoSocial: '', responsavel: '' },
    telefoneConfirmado: '', // dígitos confirmados no "Confirme seu WhatsApp"
    ticket: '', ticketEm: '', chaveCadastro: '',
    // endereço do atendimento principal: salvo (id) ou novo (campos + uso)
    endereco: { modo: '', id: '', cepSituacao: '', novo: vazioEndereco(), uso: '', apelido: '' },
    enderecosExtras: [], // endereços novos usados nos cards de outras diárias/profissionais (V4)
    caracteristicas: {}, localRefeicao: null,
    duracaoHoras: 0, duracaoManual: false, cienteMenor: false, justificativa: '',
    modalidade: '', frequencia: '', datas: [], horario: '', manterHorario: null, horarios: {},
    itens: {}, // V4: configuração por diária (data) ou por profissional (índice)
    cupom: '', origem: { origem: '', quemIndicou: '', outroQual: '' },
    retornarRevisao: false,
  };
}
export function vazioEndereco() {
  return { cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', uf: 'MG', pontoReferencia: '', tipoImovel: '', tipoImovelOutro: '' };
}

export function carregar() {
  try {
    const j = JSON.parse(localStorage.getItem(LS) || 'null');
    if (j && j.versao === 3 && j.chave) {
      const r = { ...novoRascunho(), ...j };
      // ticket vencido (24 h) não vale mais: o cadastro é refeito
      if (r.ticketEm && Date.now() - Date.parse(r.ticketEm) > 23 * 3600000) Object.assign(r, { ticket: '', ticketEm: '', chaveCadastro: '' });
      return r;
    }
  } catch { /* rascunho corrompido */ }
  return novoRascunho();
}

let r = carregar();
export const estado = () => r;
export function trocarRascunho(novo) { r = novo; salvar(); }
export function salvar() { try { localStorage.setItem(LS, JSON.stringify(r)); } catch { /* sem storage: segue sem retomar */ } }
export function apagarRascunho() { try { localStorage.removeItem(LS); } catch { /* ignora */ } }

/** Só em memória: nunca no localStorage. */
export const mem = { cpf: '', dataNascimento: '' };

export const logada = () => sessaoAtual()?.ator === 'cliente';
export const empresa = () => r.segmento === 'empresa';
export const passadoria = () => r.servico === 'passadoria';
