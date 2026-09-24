// Textos das mensagens de WhatsApp. Cada template tem a mesma forma do formato de aprovação da Meta:
// variáveis numeradas {{1}}, {{2}}... na ordem de `variaveis`. docs/WHATSAPP.md é verificado contra este arquivo
// por scripts/verifica-templates.mjs (texto idêntico, sem asterisco, sem variável no início ou no fim).
import { formatarBRL } from '../domain/dinheiro.js';
import { formatarData, formatarDataCurta } from '../domain/calendario.js';
import { FREQUENCIAS } from '../domain/modelo.js';

export const MENSAGENS = {
  // ---- cliente (fluxo de 24/09/2026: solicitação, disponibilidade, pagamento antecipado e integral)
  solicitacao_recebida: {
    destinatario: 'cliente',
    variaveis: ['nome', 'resumo', 'link'],
    texto: 'Oi, {{1}}! Recebemos sua solicitação de atendimento na Prime: {{2}}. A solicitação ainda não é a confirmação: agora a Prime verifica a disponibilidade e responde por aqui. Você acompanha em {{3}}\nQualquer dúvida, é só responder.',
    exemplo: ['Ana', '4 diárias semanais a partir de 05/10/2026', 'https://prime.exemplo/acompanhamento/?pedido=abc'],
  },
  disponibilidade_confirmada: {
    destinatario: 'cliente',
    variaveis: ['nome', 'resumo', 'valor', 'prazo', 'link'],
    texto: 'Oi, {{1}}! A Prime confirmou a disponibilidade para {{2}}. Para confirmar o atendimento, faça o pagamento antecipado de {{3}} por PIX, transferência ou depósito e envie o comprovante até {{4}}. Detalhes: {{5}}\nDúvidas? É só responder.',
    exemplo: ['Ana', '1 diária em 05/10/2026', 'R$ 175,00', '14h de sex, 02/10', 'https://prime.exemplo/pagamento/?pagamento=abc'],
  },
  solicitacao_recusada: {
    destinatario: 'cliente',
    variaveis: ['nome', 'resumo', 'motivo'],
    texto: 'Oi, {{1}}. Verificamos sua solicitação para {{2}} e, desta vez, não temos disponibilidade. Motivo: {{3}}. Se quiser, responda esta mensagem e a Prime ajuda a encontrar outra data.',
    exemplo: ['Ana', '1 diária em 05/10/2026', 'sem profissional livre no período da manhã'],
  },
  pagamento_confirmado: {
    destinatario: 'cliente',
    variaveis: ['nome', 'oque'],
    texto: 'Oi, {{1}}! A Prime confirmou o pagamento de {{2}}. Seu atendimento está confirmado e, na véspera, a gente te lembra por aqui.',
    exemplo: ['Ana', 'R$ 175,00 da diária de 05/10/2026'],
  },
  lembrete_prazo_pagamento: {
    destinatario: 'cliente',
    variaveis: ['nome', 'valor', 'data', 'prazo', 'link'],
    texto: 'Oi, {{1}}. Lembrete da Prime: o pagamento antecipado de {{2}}, da diária de {{3}}, vence {{4}}. Os detalhes estão em {{5}}\nSe já pagou, pode desconsiderar esta mensagem.',
    exemplo: ['Ana', 'R$ 175,00', '05/10/2026', 'hoje, até 14h', 'https://prime.exemplo/pagamento/?pagamento=abc'],
  },
  lembrete_vespera: {
    destinatario: 'cliente',
    variaveis: ['nome', 'quando', 'periodo'],
    texto: 'Oi, {{1}}! Passando pra lembrar: {{2}} tem atendimento da Prime no período da {{3}}. Se precisar mudar algo, responda esta mensagem.',
    exemplo: ['Ana', 'amanhã, 05/10/2026,', 'manhã, das 8h às 12h'],
  },
  profissional_a_caminho: {
    destinatario: 'cliente',
    variaveis: ['nome', 'profissional'],
    texto: 'Oi, {{1}}. A profissional designada pela Prime, {{2}}, já está a caminho do seu endereço. Qualquer imprevisto, responda esta mensagem.',
    exemplo: ['Ana', 'Maria'],
  },
  atendimento_iniciado: {
    destinatario: 'cliente',
    variaveis: ['nome', 'profissional'],
    texto: 'Oi, {{1}}! A profissional {{2}} chegou e começou o atendimento de hoje. A Prime avisa quando terminar.',
    exemplo: ['Ana', 'Maria'],
  },
  atendimento_finalizado: {
    destinatario: 'cliente',
    variaveis: ['nome', 'link'],
    texto: 'Oi, {{1}}. O atendimento de hoje terminou. Pode responder a pesquisa de satisfação da Prime? Sua resposta vai direto para a equipe da Prime: {{2}}\nObrigada!',
    exemplo: ['Ana', 'https://prime.exemplo/avaliacao/?atendimento=abc'],
  },
  obrigado_avaliacao: {
    destinatario: 'cliente',
    variaveis: ['nome'],
    texto: 'Obrigada pela resposta, {{1}}! Ela vai direto para a equipe da Prime e ajuda a acompanhar cada atendimento.',
    exemplo: ['Ana'],
  },
  remarcacao: {
    destinatario: 'cliente',
    variaveis: ['nome', 'quando', 'periodo'],
    texto: 'Oi, {{1}}. Seu atendimento foi remarcado para {{2}}, no período da {{3}}. Se precisar de outro ajuste, responda esta mensagem.',
    exemplo: ['Ana', 'seg, 12/10', 'manhã, com início às 8h'],
  },
  estorno_registrado: {
    destinatario: 'cliente',
    variaveis: ['nome', 'valor', 'oque'],
    texto: 'Oi, {{1}}. A Prime registrou o estorno de {{2}} ({{3}}). Se tiver qualquer dúvida, responda esta mensagem.',
    exemplo: ['Ana', 'R$ 175,00', 'diária de 05/10/2026'],
  },
  cancelamento: {
    destinatario: 'cliente',
    variaveis: ['nome', 'oque'],
    texto: 'Oi, {{1}}. Confirmamos o cancelamento de {{2}}. Se foi engano ou quiser remarcar, é só responder esta mensagem.',
    exemplo: ['Ana', 'todas as diárias pendentes do seu pedido'],
  },
  // ---- diarista
  cadastro_recebido: {
    destinatario: 'diarista',
    variaveis: ['nome', 'prazo'],
    texto: 'Oi, {{1}}! Recebemos seu cadastro na Prime. Vamos analisar seus documentos e responder por aqui em até {{2}} dias úteis.',
    exemplo: ['Maria', '5'],
  },
  cadastro_aprovado: {
    destinatario: 'diarista',
    variaveis: ['nome'],
    texto: 'Parabéns, {{1}}! Seu cadastro na Prime foi aprovado. As próximas diárias chegam por aqui.',
    exemplo: ['Maria'],
  },
  cadastro_reprovado: {
    destinatario: 'diarista',
    variaveis: ['nome'],
    texto: 'Oi, {{1}}. Analisamos seu cadastro e, por enquanto, não conseguimos seguir. Se quiser entender o motivo, responda esta mensagem.',
    exemplo: ['Maria'],
  },
  atendimento_atribuido: {
    destinatario: 'diarista',
    variaveis: ['nome', 'data', 'periodo', 'bairro'],
    texto: 'Oi, {{1}}! Você tem uma nova diária: {{2}}, período da {{3}}, no bairro {{4}}. O endereço completo chega por aqui antes da diária.',
    exemplo: ['Maria', '05/10/2026', 'manhã, das 8h às 12h', 'Savassi'],
  },
  lembrete_vespera_diarista: {
    destinatario: 'diarista',
    variaveis: ['nome', 'quando', 'periodo', 'endereco'],
    texto: 'Oi, {{1}}. Lembrete: {{2}} você tem diária no período da {{3}}. Endereço: {{4}}. Bom trabalho!',
    exemplo: ['Maria', 'amanhã, 05/10/2026,', 'manhã, das 8h às 12h', 'Rua Exemplo, 100, Savassi, Belo Horizonte'],
  },
  atendimento_cancelado_diarista: {
    destinatario: 'diarista',
    variaveis: ['nome', 'data', 'periodo'],
    texto: 'Oi, {{1}}. A diária de {{2}}, período da {{3}}, foi cancelada e saiu da sua agenda. Qualquer dúvida, responda esta mensagem.',
    exemplo: ['Maria', '05/10/2026', 'manhã, das 8h às 12h'],
  },
};

export const PERIODOS = { manha: 'manhã, com início às 8h', tarde: 'tarde, com início às 13h', integral: 'manhã e tarde, das 8h às 17h' };

/** Preenche {{n}} com os valores das variáveis nomeadas. Lança se faltar variável. */
export function renderizar(template, variaveis) {
  const m = MENSAGENS[template];
  if (!m) throw new Error(`template desconhecido: ${template}`);
  return m.texto.replace(/\{\{(\d+)\}\}/g, (_, n) => {
    const nome = m.variaveis[Number(n) - 1];
    const v = variaveis?.[nome];
    if (v === undefined || v === null || v === '') throw new Error(`variável ${nome} vazia em ${template}`);
    return String(v);
  });
}

/** Lista de valores na ordem {{1}}, {{2}}... (usada pelo payload da Meta). */
export function valoresOrdenados(template, variaveis) {
  return MENSAGENS[template].variaveis.map((n) => String(variaveis[n]));
}

/** "amanhã, 05/10/2026," ou "hoje, 05/10/2026," conforme o dia (no fuso) em que a mensagem sai. */
export function quandoRelativo(dataAtendimento, diaEnvio) {
  const rel = diaEnvio === dataAtendimento ? 'hoje' : 'amanhã';
  return `${rel}, ${formatarData(dataAtendimento)},`;
}

const primeiroNome = (s) => String(s || '').trim().split(/\s+/)[0] || 'tudo bem';

function resumoPedido(pedido, atendimentos) {
  const p = pedido.pacote;
  const primeira = atendimentos[0]?.data;
  if (p.frequencia === 'avulso') return `1 diária em ${primeira ? formatarData(primeira) : 'data a combinar'}`;
  return `${p.quantidadeDiarias} diárias (${FREQUENCIAS[p.frequencia].toLowerCase()}) a partir de ${formatarData(primeira)}`;
}

/**
 * Monta as variáveis nomeadas de um template a partir do contexto carregado pelo motor.
 * ctx: { cliente, pedido, atendimentos, atendimento, diarista, pagamento, pagamentos, urlSite, evento, diaEnvio }
 */
export function montarVariaveis(template, ctx) {
  const c = ctx.cliente;
  const a = ctx.atendimento;
  const d = ctx.diarista;
  const link = (caminho, params) => {
    const u = new URL(caminho, ctx.urlSite);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return u.toString();
  };
  const pg = ctx.pagamento;
  const prazo = (g) => `14h de ${formatarDataCurta(g.venceEm)}`;
  switch (template) {
    case 'solicitacao_recebida':
      return { nome: primeiroNome(c.nome), resumo: resumoPedido(ctx.pedido, ctx.atendimentos), link: link('acompanhamento/', { pedido: ctx.pedido.id }) };
    case 'disponibilidade_confirmada': {
      const primeira = ctx.pagamentos?.[0];
      const varias = (ctx.pagamentos?.length || 0) > 1;
      return {
        nome: primeiroNome(c.nome), resumo: resumoPedido(ctx.pedido, ctx.atendimentos.filter((x) => x.status !== 'cancelado')),
        valor: `${formatarBRL(primeira.valorCentavos)}${varias ? ' da primeira diária (as outras vencem até o dia útil anterior a cada uma)' : ''}`,
        prazo: prazo(primeira), link: link('pagamento/', { pagamento: primeira.id }),
      };
    }
    case 'solicitacao_recusada':
      return { nome: primeiroNome(c.nome), resumo: resumoPedido(ctx.pedido, ctx.atendimentos), motivo: ctx.evento.dados?.motivo || ctx.pedido.recusa?.motivo || 'sem disponibilidade na data' };
    case 'pagamento_confirmado':
      return { nome: primeiroNome(c.nome), oque: `${formatarBRL(pg.valorCentavos)} ${a ? `da diária de ${formatarData(a.data)}` : 'do pacote'}` };
    case 'lembrete_prazo_pagamento':
      return {
        nome: primeiroNome(c.nome), valor: formatarBRL(pg.valorCentavos), data: formatarData(a ? a.data : ctx.atendimentos[0].data),
        prazo: pg.venceEm === ctx.diaEnvio ? 'hoje, até 14h' : `até ${prazo(pg)}`, link: link('pagamento/', { pagamento: pg.id }),
      };
    case 'lembrete_vespera':
      return { nome: primeiroNome(c.nome), quando: quandoRelativo(a.data, ctx.diaEnvio), periodo: PERIODOS[a.turno] };
    case 'profissional_a_caminho':
    case 'atendimento_iniciado':
      return { nome: primeiroNome(c.nome), profissional: primeiroNome(d?.nome) || 'designada' };
    case 'atendimento_finalizado':
      return { nome: primeiroNome(c.nome), link: link('avaliacao/', { atendimento: a.id }) };
    case 'obrigado_avaliacao':
      return { nome: primeiroNome(c.nome) };
    case 'remarcacao':
      return { nome: primeiroNome(c.nome), quando: formatarDataCurta(a.data), periodo: PERIODOS[a.turno] };
    case 'estorno_registrado':
      return { nome: primeiroNome(c.nome), valor: formatarBRL(pg.valorCentavos), oque: pg.parcela === 'pacote' ? 'pacote de diárias' : `diária de ${formatarData(a.data)}` };
    case 'cancelamento': {
      const oque = a ? `a diária de ${formatarData(a.data)}` : 'todas as diárias pendentes do seu pedido';
      return { nome: primeiroNome(c.nome), oque };
    }
    case 'cadastro_recebido':
      return { nome: primeiroNome(d.nome), prazo: '5' };
    case 'cadastro_aprovado':
    case 'cadastro_reprovado':
      return { nome: primeiroNome(d.nome) };
    case 'atendimento_atribuido':
      return { nome: primeiroNome(d.nome), data: formatarData(a.data), periodo: PERIODOS[a.turno], bairro: c.endereco.bairro };
    case 'lembrete_vespera_diarista': {
      const e = c.endereco;
      return { nome: primeiroNome(d.nome), quando: quandoRelativo(a.data, ctx.diaEnvio), periodo: PERIODOS[a.turno], endereco: `${e.logradouro}, ${e.numero}${e.complemento ? ` ${e.complemento}` : ''}, ${e.bairro}, ${e.cidade}` };
    }
    case 'atendimento_cancelado_diarista':
      return { nome: primeiroNome(d.nome), data: formatarData(a.data), periodo: PERIODOS[a.turno] };
    default:
      throw new Error(`sem variáveis pra ${template}`);
  }
}
