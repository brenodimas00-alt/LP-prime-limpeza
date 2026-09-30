// D1: central de ajuda da equipe da Prime dentro do painel. Texto curto por tarefa, com o print da tela (gerado com dados
// fictícios por scripts/gera-prints-ajuda.mjs, em assets/ajuda/). Sem jargão: é o passo a passo de quem opera.
import { el } from '../dom.js';
import { url } from '../../config/app.js';

const TAREFAS = [
  ['confirmar-disponibilidade', 'Confirmar a disponibilidade', 'solicitacoes', [
    'Em Solicitações, confira o serviço, o local, as datas e o horário de cada diária. Se precisar, ajuste o horário de início ali mesmo.',
    'Em "Sugestões de profissional" o sistema mostra quem está livre, atende a região e tem menos diárias na semana. Dá pra designar já.',
    'Clique em "Confirmar disponibilidade": nasce a cobrança e a cliente recebe no WhatsApp o valor, as formas e o prazo. Sem vaga, escreva o motivo e clique em "Recusar".']],
  ['confirmar-pagamento', 'Confirmar um pagamento', 'pagamentos', [
    'Em Pagamentos, "Informados pela cliente" são os que ela avisou que pagou. Confira no extrato (PIX pelo identificador, ou o comprovante).',
    'Clique em "Confirmar recebimento": a diária fica confirmada, a cliente é avisada e o recibo é emitido.',
    'Prazo vencido sem pagamento aparece em cima: "Liberar vaga" cancela a diária; "Dar mais prazo" muda o vencimento e os lembretes.']],
  ['designar', 'Designar ou trocar a profissional', 'atribuir', [
    'Em Atribuir profissional, escolha na lista ou abra "Sugestões de profissional" e clique em "Designar".',
    'Se ela estiver de férias ou já tiver diária no horário, o sistema não deixa. Fora dos dias, turnos ou regiões dela, ele avisa e pergunta se é pra designar mesmo assim.',
    'A profissional recebe a diária no WhatsApp; se havia outra, ela recebe o aviso de que saiu da agenda.']],
  ['remarcar', 'Remarcar uma diária', 'agenda', [
    'Na Agenda, arraste a diária pra outro dia (ou outra profissional). Sem mouse: clique na diária e use "Data", "Início" e "Profissional".',
    'Antes de salvar aparece o que impede (férias, outra diária no horário) e o que é só aviso. Clique em "Confirmar mudança".',
    'A cliente e a profissional são avisadas, e os lembretes passam a valer pra data nova. Férias e folgas: clique no nome da profissional.']],
  ['estornar', 'Registrar um estorno', 'pagamentos', [
    'Em Pagamentos, "Recebidos", abra "Registrar estorno" no pagamento, escreva o motivo e confirme.',
    'A diária coberta, se ainda não aconteceu, é cancelada e a cliente é avisada. A devolução do dinheiro em si é feita pela Prime, fora do sistema.',
    'O recibo continua com o mesmo número e passa a mostrar que foi estornado.']],
  ['ocorrencia', 'Tratar uma ocorrência', 'ocorrencias', [
    'Em Ocorrências ficam os relatos das clientes depois da diária, com a foto quando ela mandou ("Ver foto").',
    'Mude a situação (Em análise, Resolvido) e, se quiser, escreva um comentário: a cliente vê no acompanhamento e recebe o aviso no WhatsApp.',
    'O histórico de cada chamado fica guardado com a data de cada mudança.']],
  ['automacao', 'Ligar ou desligar uma automação', 'notificacoes', [
    'Em Automações estão todas as mensagens automáticas. "Desligar" para aquela mensagem na hora; "Ligar" volta a valer.',
    'Dá pra mudar horário e atraso (dentro dos limites) e o texto: "Editar texto" mostra uma prévia com dados de exemplo e não deixa salvar variável errada.',
    'As mensagens de novidades (renovação, reativação, aniversário) só vão pra quem aceitou receber.']],
  ['exportar', 'Exportar uma planilha', 'relacionamento', [
    'Em Relacionamento, "Planilhas": clique em Clientes, Pedidos, Pagamentos ou Repasses. O arquivo abre direto no Excel.',
    'Por padrão, CPF, telefone e e-mail saem mascarados. A planilha completa só com a caixa marcada e a confirmação; guarde em local seguro.',
    'Toda exportação fica registrada com quem fez e quando.']],
];

export function abaAjuda() {
  return el('div', { class: 'reveal ajuda' }, [
    el('p', { class: 'mudo', text: 'O passo a passo das tarefas do dia a dia. As imagens são de exemplo, com dados fictícios.' }),
    el('nav', { class: 'ajuda-indice', 'aria-label': 'Tarefas' }, [el('ul', {}, TAREFAS.map(([id, titulo]) => el('li', {}, [el('a', { href: `#ajuda-${id}`, text: titulo })])))]),
    ...TAREFAS.map(([id, titulo, aba, passos]) => el('section', { class: 'cartao ajuda-tarefa', id: `ajuda-${id}`, 'aria-labelledby': `h-ajuda-${id}` }, [
      el('h2', { id: `h-ajuda-${id}`, text: titulo, style: 'margin-top:0' }),
      el('ol', {}, passos.map((p) => el('li', { text: p }))),
      el('img', { src: url(`assets/ajuda/${id}.png`), alt: `Tela do painel: ${titulo.toLowerCase()} (exemplo com dados fictícios)`, loading: 'lazy', class: 'print-ajuda' }),
      el('p', {}, [el('a', { href: url('painel/', { aba }), text: 'Abrir esta parte do painel' })]),
    ])),
  ]);
}
