// Vitrine dos componentes do painel v2 (B1), com dados fictícios: _dev/painel-componentes.html. Não vai pro ar.
import { el } from '../dom.js';
import { icone } from './icones.js';
import {
  botao, selo, contador, avatar, zap, esqueleto, erroBloco, tudoResolvido, bloco, tabelaExpansivel, detalhe, chips,
  filtrosVerticais, modal, confirmar, pedirMotivo, painelLateral, barras,
} from './componentes.js';

const MOTIVOS = [{ codigo: 'sem_disponibilidade', rotulo: 'Sem disponibilidade na data ou no horário' }, { codigo: 'outro', rotulo: 'Outro' }];
const secao = (titulo, ...filhos) => el('section', { class: 'p-bloco p-bloco-solto' }, [el('h2', { text: titulo }), ...filhos]);
const conteudo = el('main', { class: 'p-conteudo', id: 'conteudo' });
document.body.append(conteudo);

const tab = tabelaExpansivel({
  rotulo: 'Solicitações de exemplo',
  colunas: [{ rotulo: 'Data/Hora' }, { rotulo: 'Cliente', classe: 'p-principal-cel' }, { rotulo: 'Local' }, { rotulo: 'Valor', classe: 'p-dinheiro' }, { rotulo: 'Ações', classe: 'p-acoes-cel', sr: true }],
  linhas: [
    { rotulo: 'Ana Fictícia', celulas: [el('span', { class: 'p-num', text: '15/10 10:00' }), el('span', { class: 'p-forte', text: 'Ana Fictícia' }), 'Savassi, BH', 'R$ 203,00', el('span', {}, [botao('Aprovar', { tom: 'ok', ic: 'check' }), botao('Recusar', { tom: 'perigo', ic: 'fechar' })])],
      detalhe: () => detalhe([['Modalidade', 'Diária avulsa'], ['Imóvel', '72 m², 6 ambientes'], ['Endereço', 'Rua Fictícia, 100 - Savassi, Belo Horizonte/MG', true]]) },
    { rotulo: 'Bruno Fictício', celulas: [el('span', { class: 'p-num', text: '16/10 08:00' }), el('span', { class: 'p-forte', text: 'Bruno Fictício' }), 'Centro, Contagem', 'R$ 230,00', el('span', {}, [botao('Aprovar', { tom: 'ok', ic: 'check' }), botao('Recusar', { tom: 'perigo', ic: 'fechar' })])] },
  ],
});
const b = bloco({ id: 'vitrine', titulo: 'Bloco recolhível', ic: 'solicitacoes', carregar: async () => ({ conteudo: tab, contagem: 2, urgentes: 1, sub: 'Subtítulo curto do bloco.', extra: [botao('Ver todas', { ic: 'seta' })] }) });
b.recarregar();
const falha = bloco({ id: 'vitrine-erro', titulo: 'Bloco com erro', ic: 'alerta', carregar: async () => { throw Object.assign(new Error('Não conseguimos falar com o servidor. Tente de novo.'), { codigo: 'SERVICO_INDISPONIVEL' }); } });
falha.recarregar();

conteudo.append(
  el('div', { class: 'p-cabecalho' }, [el('div', {}, [el('h1', { text: 'Componentes do painel' }), el('p', { text: 'B1: tokens e componentes, com dados fictícios.' })])]),
  secao('Botões e selos',
    el('div', { class: 'p-chips' }, [botao('Primário', { tom: 'primario' }), botao('Aprovar', { tom: 'ok', ic: 'check' }), botao('Recusar', { tom: 'perigo', ic: 'fechar' }), botao('Negociar data', { tom: 'aviso', ic: 'agenda' }), botao('Discreto', { tom: 'discreto' }), botao('Mais opções', { ic: 'mais', soIcone: true })]),
    el('div', { class: 'p-chips' }, [selo('Confirmada', 'ok'), selo('Pendente PIX', 'aguardando'), selo('Urgente', 'urgente'), selo('Em andamento', 'info'), selo('A faturar', 'neutro'), selo('Publicada às 17:04', 'marca'), contador(6, { rotulo: '6 solicitações novas' })])),
  secao('Avatar com habilidades e WhatsApp', el('div', { class: 'p-chips' }, [avatar('Joana Fictícia', { habilidades: ['residencial', 'passadoria'], linha2: '08h às 18h' }), zap('31955554444', 'Joana Fictícia')])),
  b.raiz, falha.raiz,
  secao('Chips e filtros', chips([['todas', 'Todas', 6], ['escala', 'Escala', 2], ['financeiro', 'Financeiro', 2]], 'todas', () => {}), filtrosVerticais([['todas', 'Todas', 6], ['escala', 'Escala', 2]], 'todas', () => {})),
  secao('Esqueleto, erro e tudo resolvido', esqueleto(), erroBloco(Object.assign(new Error('Falha de exemplo'), { codigo: 'X' }), () => {}), tudoResolvido()),
  secao('Gráficos', el('div', { class: 'p-grade p-grade-3' }, [
    barras([{ rotulo: 'Cliente desistiu', valor: 4 }, { rotulo: 'Sem profissional', valor: 3 }, { rotulo: 'Outros', valor: 1 }], { rotuloColuna: 'Motivos de cancelamento' }),
    barras([{ rotulo: 'Belo Horizonte', valor: 52 }, { rotulo: 'Contagem', valor: 16 }, { rotulo: 'Nova Lima', valor: 9 }], { aoClicar: () => {} }),
  ])),
  secao('Sobreposições', el('div', { class: 'p-chips' }, [
    botao('Abrir modal', { aoClicar: () => modal({ titulo: 'Modal de exemplo', corpo: el('p', { text: 'Conteúdo fictício.' }) }) }),
    botao('Confirmar com consequência', { aoClicar: () => confirmar({ titulo: 'Liberar a vaga?', texto: 'A diária sai da agenda e a cliente é avisada.', rotuloConfirmar: 'Liberar a vaga e avisar a cliente', tom: 'perigo' }) }),
    botao('Pedir motivo', { aoClicar: () => pedirMotivo({ titulo: 'Recusar solicitação', motivos: MOTIVOS, rotuloConfirmar: 'Recusar e avisar a cliente', consequencia: 'A cliente recebe a recusa com o motivo pelo WhatsApp.' }) }),
    botao('Painel lateral', { aoClicar: () => painelLateral({ titulo: 'Detalhe', corpo: detalhe([['Cliente', 'Ana Fictícia'], ['Serviço', 'Residencial']]) }) }),
  ])),
  el('p', { class: 'p-sec' }, [icone('info', { pequeno: true }), ' Página de desenvolvimento: não vai pro ar.']),
);
