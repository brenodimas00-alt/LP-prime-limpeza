// Textos das mensagens de WhatsApp. Cada template tem a mesma forma do formato de aprovação da Meta:
// variáveis numeradas {{1}}, {{2}}... na ordem de `variaveis`. docs/WHATSAPP.md é verificado contra este arquivo
// por scripts/verifica-templates.mjs (texto idêntico, sem asterisco, sem variável no início ou no fim).
import { formatarBRL } from '../domain/dinheiro.js';
import { formatarData, formatarDataCurta } from '../domain/calendario.js';
import { FREQUENCIAS } from '../domain/modelo.js';

export const MENSAGENS = {
  // ---- cliente
  pedido_recebido: {
    destinatario: 'cliente',
    variaveis: ['nome', 'resumo', 'valorEntrada', 'link'],
    texto: 'Oi, {{1}}! Recebemos seu pedido na Prime: {{2}}. Pra garantir a data, falta o Pix da entrada de {{3}}. Você paga e acompanha por aqui: {{4}}\nQualquer dúvida, é só responder.',
    exemplo: ['Ana', '4 diárias semanais a partir de 05/10/2026', 'R$ 350,00', 'https://prime.exemplo/acompanhamento/?pedido=abc'],
  },
  entrada_confirmada: {
    destinatario: 'cliente',
    variaveis: ['nome', 'primeiraData'],
    texto: 'Oi, {{1}}! Confirmamos o pagamento da entrada. Sua primeira diária está marcada pra {{2}}. Na véspera a gente te lembra por aqui.',
    exemplo: ['Ana', 'segunda, 05/10/2026 (manhã, das 8h às 12h)'],
  },
  lembrete_vespera: {
    destinatario: 'cliente',
    variaveis: ['nome', 'data', 'periodo'],
    texto: 'Oi, {{1}}! Passando pra lembrar: amanhã, {{2}}, tem diária da Prime no período da {{3}}. Se precisar mudar algo, responda esta mensagem.',
    exemplo: ['Ana', '05/10/2026', 'manhã, das 8h às 12h'],
  },
  diarista_a_caminho: {
    destinatario: 'cliente',
    variaveis: ['nome', 'diarista'],
    texto: 'Oi, {{1}}! A {{2}} já está a caminho do seu endereço. Até daqui a pouco!',
    exemplo: ['Ana', 'Maria'],
  },
  atendimento_iniciado: {
    destinatario: 'cliente',
    variaveis: ['nome', 'diarista'],
    texto: 'Oi, {{1}}! A {{2}} chegou e começou a diária de hoje. A gente avisa quando terminar.',
    exemplo: ['Ana', 'Maria'],
  },
  atendimento_finalizado: {
    destinatario: 'cliente',
    variaveis: ['nome', 'link'],
    texto: 'Oi, {{1}}! A diária de hoje terminou. Conta pra gente como foi? Leva menos de um minuto: {{2}}\nObrigada!',
    exemplo: ['Ana', 'https://prime.exemplo/avaliacao/?atendimento=abc'],
  },
  cobranca_dia: {
    destinatario: 'cliente',
    variaveis: ['nome', 'data', 'valor', 'link'],
    texto: 'Oi, {{1}}! A parcela da diária de {{2}} ficou em {{3}}. Você paga pelo Pix neste link: {{4}}\nObrigada pela confiança!',
    exemplo: ['Ana', '05/10/2026', 'R$ 175,00', 'https://prime.exemplo/pagamento/?pagamento=abc'],
  },
  obrigado_avaliacao: {
    destinatario: 'cliente',
    variaveis: ['nome'],
    texto: 'Obrigada pela avaliação, {{1}}! Sua opinião ajuda a manter o padrão da Prime em cada diária.',
    exemplo: ['Ana'],
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
    texto: 'Oi, {{1}}! Você tem uma nova diária: {{2}}, período da {{3}}, no bairro {{4}}. O endereço completo chega na véspera.',
    exemplo: ['Maria', '05/10/2026', 'manhã, das 8h às 12h', 'Savassi'],
  },
  lembrete_vespera_diarista: {
    destinatario: 'diarista',
    variaveis: ['nome', 'data', 'periodo', 'endereco'],
    texto: 'Oi, {{1}}! Lembrete: amanhã, {{2}}, você tem diária no período da {{3}}. Endereço: {{4}}. Bom trabalho!',
    exemplo: ['Maria', '05/10/2026', 'manhã, das 8h às 12h', 'Rua Exemplo, 100, Savassi, Belo Horizonte'],
  },
};

export const PERIODOS = { manha: 'manhã, das 8h às 12h', tarde: 'tarde, das 13h às 17h', integral: 'manhã e tarde, das 8h às 17h' };

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

const primeiroNome = (s) => String(s || '').trim().split(/\s+/)[0] || 'tudo bem';

function resumoPedido(pedido, atendimentos) {
  const p = pedido.pacote;
  const primeira = atendimentos[0]?.data;
  if (p.frequencia === 'avulso') return `1 diária em ${primeira ? formatarData(primeira) : 'data a combinar'}`;
  return `${p.quantidadeDiarias} diárias (${FREQUENCIAS[p.frequencia].toLowerCase()}) a partir de ${formatarData(primeira)}`;
}

/**
 * Monta as variáveis nomeadas de um template a partir do contexto carregado pelo motor.
 * ctx: { cliente, pedido, atendimentos, atendimento, diarista, pagamento, urlSite, evento }
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
  switch (template) {
    case 'pedido_recebido':
      return { nome: primeiroNome(c.nome), resumo: resumoPedido(ctx.pedido, ctx.atendimentos), valorEntrada: formatarBRL(ctx.pedido.pacote.entradaCentavos), link: link('acompanhamento/', { pedido: ctx.pedido.id }) };
    case 'entrada_confirmada': {
      const p = ctx.atendimentos.find((x) => x.status !== 'cancelado') || ctx.atendimentos[0];
      return { nome: primeiroNome(c.nome), primeiraData: `${formatarDataCurta(p.data)} (${PERIODOS[p.turno]})` };
    }
    case 'lembrete_vespera':
      return { nome: primeiroNome(c.nome), data: formatarData(a.data), periodo: PERIODOS[a.turno] };
    case 'diarista_a_caminho':
    case 'atendimento_iniciado':
      return { nome: primeiroNome(c.nome), diarista: primeiroNome(d?.nome) || 'profissional' };
    case 'atendimento_finalizado':
      return { nome: primeiroNome(c.nome), link: link('avaliacao/', { atendimento: a.id }) };
    case 'cobranca_dia':
      return { nome: primeiroNome(c.nome), data: formatarData(a.data), valor: formatarBRL(ctx.pagamento.valorCentavos), link: link('pagamento/', { pagamento: ctx.pagamento.id }) };
    case 'obrigado_avaliacao':
      return { nome: primeiroNome(c.nome) };
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
      return { nome: primeiroNome(d.nome), data: formatarData(a.data), periodo: PERIODOS[a.turno], endereco: `${e.logradouro}, ${e.numero}${e.complemento ? ` ${e.complemento}` : ''}, ${e.bairro}, ${e.cidade}` };
    }
    default:
      throw new Error(`sem variáveis pra ${template}`);
  }
}
