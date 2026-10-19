// Central de ajuda da equipe da Prime dentro do painel (Gestão > Ajuda). Texto curto por tarefa, partindo do Início, com o
// print da tela (dados fictícios: scripts/painel-v2/prints-ajuda.mjs pras telas novas, scripts/gera-prints-ajuda.mjs pras
// seções que vieram do painel antigo). Sem jargão: é o passo a passo de quem opera. O manual .docx sai deste mesmo texto.
import { el } from '../dom.js';
import { url } from '../../config/app.js';

export const TAREFAS = [
  ['aprovar', 'Aprovar uma solicitação nova', { tela: 'inicio' }, [
    'No Início, em "Solicitações novas", confira data, cliente, local, serviço, imóvel, horas e valor. A seta à esquerda mostra o resto (endereço completo, características, como a cliente conheceu a Prime).',
    'Clique em "Aprovar": a cobrança nasce e a cliente recebe no WhatsApp o valor e como pagar. É um clique só.',
    'Precisa ajustar o horário antes? Abra "Solicitações" no menu e use "Ajustar horários antes de aprovar".']],
  ['recusar-negociar', 'Recusar ou negociar a data', { tela: 'inicio' }, [
    '"Recusar" pede o motivo (lista padronizada, mais um detalhe se quiser). A cliente recebe a recusa com o motivo, e o motivo entra no gráfico de cancelamentos.',
    '"Negociar data" abre um calendário: escolha a nova data e o horário. A cliente recebe a proposta pelo WhatsApp e responde por lá.',
    'A solicitação continua na lista, marcada com a data proposta, até você aprovar ou recusar.']],
  ['designar', 'Designar ou substituir a profissional', { tela: 'inicio' }, [
    'Em "Precisa de você", "Diária sem profissional" e "Substituir" aparecem em vermelho quando são de hoje ou amanhã.',
    'Clique em "Resolver": aparecem as profissionais compatíveis, com quem está em stand-by primeiro. Clique em "Designar".',
    'A profissional recebe a diária no WhatsApp. A lista completa fica em Agenda e escala > Designar profissional.']],
  ['confirmar-pagamento', 'Conferir um pagamento', { tela: 'inicio' }, [
    'Em "Precisa de você", "Conferir pagamento" é a cliente avisando que pagou. Confira no extrato (o identificador do PIX está no detalhe).',
    'O botão verde confirma: a diária fica confirmada, a cliente é avisada e o recibo é emitido.',
    'Não achou no extrato? O botão vermelho pede o motivo: a cobrança volta pra pendente e a cliente recebe o PIX de novo.']],
  ['escala', 'Revisar e publicar a escala de amanhã', { tela: 'agenda', aba: 'escala' }, [
    'Em "Diárias de amanhã", o selo mostra a situação da escala: Em preparação, Revisada ou Publicada às HH:MM.',
    'Clique no selo: "Marcar como revisada" e depois "Publicar e avisar as profissionais". Só publica com todas as diárias com profissional.',
    'Se algo mudar depois, o selo avisa e dá pra publicar de novo. Reabrir pede o motivo e fica no histórico.']],
  ['standby', 'Stand-by do dia', { tela: 'inicio' }, [
    '"Stand-by de hoje" só aparece quando há profissional disponível hoje e sem diária.',
    '"Confirmar" designa ela numa diária de hoje sem profissional (ou deixa de prontidão, se não houver). "Liberar" dispensa por hoje.',
    'Os ícones embaixo do nome são as habilidades dela (Profissionais > Equipe > Habilidades).']],
  ['adiantamento', 'Adiantamento e Uber', { tela: 'financeiro', aba: 'adiantamentos' }, [
    'Pedidos de adiantamento e de reembolso de transporte aparecem em "Precisa de você", com o valor.',
    'Verde aprova; vermelho pede o motivo e registra no histórico. Pra registrar um pedido que chegou pelo WhatsApp: Financeiro > Adiantamentos e reembolsos.',
    'O pagamento em si é feito pela Prime, fora do sistema.']],
  ['buscar-cliente', 'Achar uma cliente', { tela: 'clientes' }, [
    'Use a busca do topo: nome, telefone, e-mail, endereço ou o número da solicitação.',
    'Enter abre a ficha: resumo, linha do tempo (solicitações, pagamentos, mensagens, ocorrências e acessos) e privacidade.',
    '"Endereços, condições e faturamento" mostra os endereços e as condições comerciais dela.']],
  ['remarcar', 'Remarcar uma diária', { tela: 'agenda' }, [
    'Na Agenda, arraste a diária pra outro dia (ou outra profissional). Sem mouse: clique na diária e use "Data", "Início" e "Profissional".',
    'Antes de salvar aparece o que impede (férias, outra diária no horário) e o que é só aviso. Clique em "Confirmar mudança".',
    'A cliente e a profissional são avisadas, e os lembretes passam a valer pra data nova.']],
  ['estornar', 'Registrar um estorno', { tela: 'financeiro' }, [
    'Em Financeiro > Pagamentos, "Recebidos", abra "Registrar estorno" no pagamento, escreva o motivo e confirme.',
    'A diária coberta, se ainda não aconteceu, é cancelada e a cliente é avisada. A devolução do dinheiro é feita pela Prime, fora do sistema.',
    'O recibo continua com o mesmo número e passa a mostrar que foi estornado.']],
  ['ocorrencia', 'Tratar uma ocorrência', { tela: 'clientes', aba: 'ocorrencias' }, [
    'Ocorrência aberta aparece em "Precisa de você" (em vermelho depois de 48 horas sem resposta).',
    'Em Clientes > Ocorrências, mude a situação (Em análise, Resolvido) e, se quiser, escreva um comentário: a cliente vê no acompanhamento e recebe o aviso.',
    'O histórico de cada chamado fica guardado com a data de cada mudança.']],
  ['automacao', 'Mensagens automáticas', { tela: 'gestao', sec: 'automacoes' }, [
    'Em Gestão > Automações estão todas as mensagens automáticas. "Desligar" para aquela mensagem na hora; "Ligar" volta a valer.',
    'Dá pra mudar horário e atraso (dentro dos limites) e o texto: "Editar texto" mostra uma prévia e não deixa salvar campo errado.',
    'Mensagem que não saiu vai pra "Precisa de você", com o botão "Reprocessar".']],
  ['exportar', 'Exportar uma planilha', { tela: 'clientes', aba: 'relacionamento' }, [
    'Em Clientes > Relacionamento, "Planilhas": clique em Clientes, Pedidos, Pagamentos ou Repasses. O arquivo abre direto no Excel.',
    'Por padrão, CPF, telefone e e-mail saem mascarados. A planilha completa só com a caixa marcada e a confirmação.',
    'Toda exportação fica registrada com quem fez e quando.']],
  ['motivos-meta', 'Motivos e meta do mês', { tela: 'gestao', sec: 'configuracoes', aba: 'motivos' }, [
    'Em Gestão > Configurações > Motivos e meta, a administração adiciona ou tira motivos de recusa e de cancelamento. "Outro" fica sempre.',
    'A meta de diárias é um percentual sobre o mês anterior (padrão: 10%). O gráfico do Início usa esse número.',
    'Quem é do atendimento vê, mas não muda.']],
];

export function abaAjuda() {
  return el('div', { class: 'reveal ajuda' }, [
    el('p', { class: 'mudo', text: 'O passo a passo das tarefas do dia a dia. As imagens são de exemplo, com dados fictícios.' }),
    el('p', {}, [el('a', { class: 'btn btn-secundario btn-pequeno', href: url('painel/', { tela: 'inicio', tour: 1 }), text: 'Ver o tour de novo' })]),
    el('nav', { class: 'ajuda-indice', 'aria-label': 'Tarefas' }, [el('ul', {}, TAREFAS.map(([id, titulo]) => el('li', {}, [el('a', { href: `#ajuda-${id}`, text: titulo })])))]),
    ...TAREFAS.map(([id, titulo, destino, passos]) => el('section', { class: 'cartao ajuda-tarefa', id: `ajuda-${id}`, 'aria-labelledby': `h-ajuda-${id}` }, [
      el('h2', { id: `h-ajuda-${id}`, text: titulo, style: 'margin-top:0' }),
      el('ol', {}, passos.map((p) => el('li', { text: p }))),
      el('img', { src: url(`assets/ajuda/${id}.png`), alt: `Tela do painel: ${titulo.toLowerCase()} (exemplo com dados fictícios)`, loading: 'lazy', class: 'print-ajuda' }),
      el('p', {}, [el('a', { href: url('painel/', destino), text: 'Abrir esta parte do painel' })]),
    ])),
  ]);
}
