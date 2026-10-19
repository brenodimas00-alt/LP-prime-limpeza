// Seed de DEMONSTRAÇÃO do painel v2 (só o build de demonstração usa: SEED_DEMO=painel). Tudo inventado: nomes, telefones,
// endereços e valores fictícios; datas sempre relativas a hoje, pra o Início ter o que mostrar em qualquer dia:
// solicitações novas, diárias de hoje e de amanhã (com e sem profissional, pagas e pendentes), stand-by, pendências de
// todos os tipos, alertas, cadastros sem solicitação, histórico do mês passado e deste (meta, cancelamentos, regiões) e as
// mensagens automáticas do dia. Os testes usam o seed normal (seed.js); este não muda nenhum deles.
import { somarDias, diaDaSemana } from '../../src/domain/calendario.js';

const PROF = [
  ['Ana Paula Moreira', ['residencial', 'passadoria'], [1, 2, 3, 4, 5, 6]],
  ['Juliana Costa Lima', ['residencial', 'pre_pos_evento'], [1, 2, 3, 4, 5]],
  ['Carla Mendes', ['empresarial', 'residencial'], [1, 2, 3, 4, 5, 6]],
  ['Letícia Rocha', ['residencial', 'pre_pos_mudanca'], [1, 2, 3, 4, 5, 6]],
  ['Talita Fernandes', ['empresarial', 'pos_obra'], [1, 2, 3, 4, 5]],
  ['Aline Batista', ['residencial', 'passadoria'], [1, 2, 3, 4, 5, 6]],
  ['Patrícia Duarte', ['residencial'], [1, 2, 3, 4, 5, 6]],
  ['Rosana Teixeira', ['passadoria', 'residencial'], [1, 2, 3, 4, 5, 6]],
  ['Simone Araújo', ['residencial', 'empresarial'], [0, 1, 2, 3, 4, 5, 6]],
];
const CLI = [
  ['Mariana Silva', 'Buritis', 'Belo Horizonte'], ['Carlos Mendes', 'Funcionários', 'Belo Horizonte'], ['Patrícia Lima', 'Savassi', 'Belo Horizonte'],
  ['Júlia Costa', 'Sion', 'Belo Horizonte'], ['Eduardo Martins', 'Pampulha', 'Belo Horizonte'], ['Fernanda Rocha', 'Santa Lúcia', 'Belo Horizonte'],
  ['Juliana Pereira', 'Sion', 'Belo Horizonte'], ['Roberto Almeida', 'Funcionários', 'Belo Horizonte'], ['Camila Duarte', 'Buritis', 'Belo Horizonte'],
  ['Beatriz Andrade', 'Lourdes', 'Belo Horizonte'], ['Ricardo Nunes', 'Belvedere', 'Belo Horizonte'], ['Luciana Prado', 'Castelo', 'Belo Horizonte'],
  ['Marcelo Souza', 'Centro', 'Contagem'], ['Adriana Gomes', 'Eldorado', 'Contagem'], ['Paula Vieira', 'Vila da Serra', 'Nova Lima'],
  ['Gustavo Ramos', 'Centro', 'Vespasiano'], ['Helena Castro', 'Cidade Nova', 'Belo Horizonte'], ['Vanessa Ribeiro', 'Anchieta', 'Belo Horizonte'],
  ['Thiago Barbosa', 'Gutierrez', 'Belo Horizonte'], ['Renata Carvalho', 'Serra', 'Belo Horizonte'],
];
const NOVOS = [['Ana Clara Moura', 'Savassi'], ['Bruno Lopes', 'Buritis'], ['Letícia Fernandes', 'Funcionários'], ['Rafael Souza', 'Sion']];
const RUAS = ['Rua das Acácias', 'Rua dos Ipês', 'Avenida das Palmeiras', 'Rua Jacarandá', 'Rua das Hortênsias', 'Alameda dos Cedros'];
const SERVICOS = ['residencial', 'residencial', 'residencial', 'empresarial', 'passadoria', 'residencial', 'pre_pos_mudanca'];
const VALOR = { 2: 12000, 4: 17500, 6: 20300, 8: 23000 };
const ORIGENS = [{ origem: 'instagram' }, { origem: 'google' }, { origem: 'indicacao', quemIndicou: 'Maria Silva' }, { origem: 'whatsapp' }, { origem: 'instagram' }, { origem: 'outro', outroQual: 'Panfleto' }];

/** Registros prontos por store (mock). `id(prefixo)` gera ids estáveis por execução. */
export function montarSeedPainel(hoje, { agoraISO }) {
  let n = 0;
  const id = (p) => `00000000-0000-4000-9000-${p}${String(++n).padStart(12 - p.length, '0')}`;
  const iso = (d, h = '09:00') => new Date(`${d}T${h}:00-03:00`).toISOString();
  const amanha = somarDias(hoje, 1);
  const r = { clientes: [], enderecos: [], diaristas: [], pedidos: [], atendimentos: [], pagamentos: [], avaliacoes: [], execucoes: [], solicitacoesProfissional: [] };
  let numero = 100;

  const dias = PROF.map(([nome, habilidades, ds], i) => {
    const d = { id: id('d'), nome, cpf: `000000000${i}`.slice(-11), telefone: `3198${String(7000000 + i * 1371).slice(0, 7)}`, email: `prof${i}@exemplo.com`, dataNascimento: '1985-05-10',
      status: 'aprovada', identidade: 'rg', documentos: [], habilidades, disponibilidade: { dias: ds, turnos: ['integral'], regioes: ['BH - Centro-Sul', 'BH - Oeste'] }, criadoEm: iso(somarDias(hoje, -200)) };
    r.diaristas.push(d); return d;
  });
  const clientes = CLI.map(([nome, bairro, cidade], i) => {
    const endereco = { cep: '30130010', logradouro: RUAS[i % RUAS.length], numero: String(100 + i * 7), complemento: i % 3 ? `apto ${101 + i}` : '', bairro, cidade, uf: 'MG' };
    const c = { id: id('c'), tipo: i === 1 || i === 12 ? 'empresa' : 'residencial', nome, telefone: `3199${String(1000000 + i * 4111).slice(0, 7)}`, email: `cliente${i}@exemplo.com`, endereco, origem: i % 2 ? 'site' : 'importado', criadoEm: iso(somarDias(hoje, -300 + i)) };
    r.clientes.push(c);
    r.enderecos.push({ id: id('e'), clienteId: c.id, ...endereco, pontoReferencia: i % 4 ? '' : 'Em frente à padaria', tipoImovel: c.tipo === 'empresa' ? 'Sala comercial' : 'Apartamento', tipoImovelOutro: '', apelido: null, principal: true, usoUnico: false, ativo: true, origem: 'importado', criadoEm: c.criadoEm });
    return c;
  });
  for (const [nome, bairro] of NOVOS) {
    const i = r.clientes.length;
    r.clientes.push({ id: id('c'), tipo: 'residencial', nome, telefone: `3197${String(2000000 + i * 3001).slice(0, 7)}`, email: `novo${i}@exemplo.com`, endereco: { bairro, cidade: 'Belo Horizonte', uf: 'MG' },
      origem: 'site', statusProspeccao: 'novo', baseLegal: 'execucao_contrato', criadoEm: agoraISO(r.clientes.length % 2 ? -3 : -26) });
  }

  const car = (servico, k) => (servico === 'passadoria' ? { pecas: 20 + k * 5, tipoPecas: 'basicas', animais: { tem: false } }
    : { metragem: [72, 120, 80, 55, 95, 64][k % 6], ambientes: { quartos: 2 + (k % 2), banheiros: 1 + (k % 2), salas: 1, cozinhas: 1 }, animais: { tem: k % 3 === 0, caes: k % 3 === 0 ? 1 : 0 }, ...(servico === 'pre_pos_mudanca' ? { mobiliado: 'vazio', condicao: 'moderada' } : {}) });

  /** Pedido + diárias + cobranças no estado pedido. */
  function pedido(cliente, { status, datas, horas = 4, hora = '08:00', servico = 'residencial', diarista = null, statusAt = null, pago = null, origem = null, k = 0, modalidade = null, enderecoNovo = false, cancel = null, informado = null, vencido = false, nota = null }) {
    const p = { id: id('p'), clienteId: cliente.id, numeroSolicitacao: ++numero, status, modalidade: modalidade || (datas.length > 1 ? 'pacote' : 'avulsa'), origemCliente: origem, pacoteEnderecoNovo: enderecoNovo,
      pacote: { tipoServico: servico, duracaoHoras: horas, quantidadeDiarias: datas.length, frequencia: datas.length > 1 ? 'semanal' : 'avulso', totalCentavos: VALOR[horas] * datas.length - (datas.length >= 3 ? 2000 : 0), metragem: car(servico, k).metragem },
      endereco: cliente.endereco, historico: [{ de: 'rascunho', para: 'solicitado', evento: 'solicitar', em: iso(somarDias(datas[0], -5), '10:12'), ator: 'cliente' }], criadoEm: iso(somarDias(datas[0], -5), '10:12'),
      ...(cancel ? { cancelamento: { em: iso(datas[0], '07:00'), ator: 'prime', motivo: cancel.rotulo, codigo: cancel.codigo, atendimentosCancelados: [] } } : {}) };
    if (status !== 'solicitado') p.historico.push({ de: 'solicitado', para: status === 'cancelado' ? 'cancelado' : 'confirmado', evento: 'confirmar_disponibilidade', em: iso(somarDias(datas[0], -4), '09:30'), ator: 'prime' });
    r.pedidos.push(p);
    datas.forEach((data, s) => {
      const st = statusAt?.[s] || (status === 'solicitado' ? 'agendado' : status === 'cancelado' ? 'cancelado' : data < hoje ? (nota !== null ? 'avaliado' : 'finalizado') : 'confirmado');
      const a = { id: id('a'), pedidoId: p.id, sequencia: s + 1, data, horaInicio: hora, duracaoMinutos: horas * 60, servico, caracteristicas: car(servico, k + s), localRefeicao: (k + s) % 4 !== 0,
        endereco: cliente.endereco, status: st, diaristaId: st === 'agendado' && status === 'solicitado' ? null : (Array.isArray(diarista) ? diarista[s] : diarista)?.id || null,
        valorDiaCentavos: VALOR[horas], historico: [], versao: 1, atualizadoEm: iso(somarDias(data, -3)) };
      r.atendimentos.push(a);
      if (status === 'solicitado' || status === 'cancelado') return;
      const pagoEsta = pago === null ? data < hoje || st !== 'agendado' : Array.isArray(pago) ? pago[s] : pago;
      const g = { id: id('g'), pedidoId: p.id, atendimentoId: a.id, parcela: 'diaria', valorCentavos: VALOR[horas], descontoCentavos: 0, metodo: k % 5 === 0 ? 'cartao' : 'pix',
        status: pagoEsta ? 'confirmado' : informado ? 'informado_pelo_cliente' : 'pendente', venceEm: vencido ? somarDias(hoje, -1) : somarDias(data, -1), venceAs: '14:00',
        informadoEm: informado ? new Date(Date.now() - informado * 60000).toISOString() : null, confirmadoEm: pagoEsta ? iso(somarDias(data, -2), '15:00') : null, criadoEm: iso(somarDias(data, -4)), pixTxid: `PRIMEDEMO${numero}${s}` };
      r.pagamentos.push(g);
      if ((st === 'finalizado' || st === 'avaliado') && nota !== null) r.avaliacoes.push({ id: id('v'), atendimentoId: a.id, notaFinal: nota, notas: { pontualidade: nota, qualidade: nota, cuidado: nota, comunicacao: nota }, comentario: '', criadoEm: iso(data, '17:30') });
    });
    return p;
  }
  const c = (i) => clientes[i % clientes.length];
  const d = (i) => dias[i % dias.length];

  // ---------- solicitações novas (6): imóvel, origem e horários variados; uma com endereço novo no pacote
  [[0, 2, 6, '10:00', 'residencial'], [7, 3, 8, '08:00', 'empresarial'], [8, 4, 4, '14:00', 'passadoria'], [5, 2, 6, '09:00', 'residencial'], [9, 5, 4, '08:30', 'pre_pos_mudanca'], [16, 6, 4, '13:00', 'residencial']]
    .forEach(([ci, dd, h, hora, serv], k) => pedido(c(ci), { status: 'solicitado', datas: k === 4 ? [somarDias(hoje, dd), somarDias(hoje, dd + 7)] : [diaUtil(hoje, dd)], horas: h, hora, servico: serv, origem: ORIGENS[k], k, enderecoNovo: k === 4 }));

  // ---------- diárias de hoje (só em dia de trabalho): em andamento, confirmadas, concluída com nota, uma pendente de pagamento
  if (diaDaSemana(hoje) !== 0) {
    pedido(c(0), { status: 'confirmado', datas: [hoje], horas: 4, hora: '08:00', diarista: d(0), statusAt: ['em_andamento'], k: 1, origem: ORIGENS[0] });
    pedido(c(1), { status: 'confirmado', datas: [hoje], horas: 6, hora: '10:00', servico: 'empresarial', diarista: d(2), k: 2 });
    pedido(c(2), { status: 'confirmado', datas: [hoje], horas: 4, hora: '14:00', servico: 'passadoria', diarista: d(5), statusAt: ['avaliado'], nota: 5, k: 3 });
    pedido(c(3), { status: 'aguardando_pagamento', datas: [hoje], horas: 4, hora: '13:00', diarista: d(3), statusAt: ['agendado'], pago: false, k: 4 });
    pedido(c(4), { status: 'confirmado', datas: [hoje], horas: 8, hora: '08:00', diarista: d(6), k: 5 });
  }
  // ---------- amanhã: confirmadas, duas sem profissional (urgente), uma pendente; escala em preparação
  if (diaDaSemana(amanha) !== 0) {
    pedido(c(5), { status: 'confirmado', datas: [amanha], horas: 4, hora: '08:00', diarista: d(3), k: 6 });
    pedido(c(6), { status: 'confirmado', datas: [amanha], horas: 8, hora: '09:00', servico: 'empresarial', diarista: d(4), k: 7 });
    pedido(c(7), { status: 'confirmado', datas: [amanha], horas: 6, hora: '14:00', servico: 'pre_pos_mudanca', diarista: null, k: 8 });
    pedido(c(8), { status: 'aguardando_pagamento', datas: [amanha], horas: 4, hora: '10:00', diarista: d(1), statusAt: ['agendado'], pago: false, informado: 190, k: 9 });
    pedido(c(9), { status: 'confirmado', datas: [amanha], horas: 4, hora: '13:00', diarista: null, k: 10 });
    pedido(c(10), { status: 'confirmado', datas: [amanha], horas: 6, hora: '08:00', servico: 'passadoria', diarista: d(0), k: 11 });
  }
  // ---------- pendências financeiras e de contrato
  pedido(c(11), { status: 'aguardando_pagamento', datas: [diaUtil(hoje, 3)], horas: 4, hora: '09:00', diarista: d(7), statusAt: ['agendado'], pago: false, informado: 35, k: 12 });
  pedido(c(12), { status: 'aguardando_pagamento', datas: [diaUtil(hoje, 2)], horas: 6, hora: '08:00', servico: 'empresarial', diarista: d(2), statusAt: ['agendado'], pago: false, vencido: true, k: 13 });
  r.solicitacoesProfissional.push({ id: id('s'), diaristaId: d(0).id, atendimentoId: null, tipo: 'adiantamento', valorCentavos: 8000, descricao: 'Adiantamento da quinzena', estado: 'pendente', criadoEm: agoraISO(-90) });
  r.solicitacoesProfissional.push({ id: id('s'), diaristaId: d(1).id, atendimentoId: null, tipo: 'reembolso_transporte', valorCentavos: 2340, descricao: 'Uber até a diária de ontem', estado: 'pendente', criadoEm: agoraISO(-45) });

  // ---------- pacotes: um vence amanhã (renovação), dois vencem na semana
  pedido(c(13), { status: 'confirmado', datas: [somarDias(amanha, -21), somarDias(amanha, -14), somarDias(amanha, -7), amanha].filter((x) => diaDaSemana(x) !== 0), horas: 4, hora: '15:00', diarista: d(8), k: 14 });
  pedido(c(14), { status: 'confirmado', datas: [somarDias(hoje, -11), somarDias(hoje, -4), somarDias(hoje, 3)].map((x) => (diaDaSemana(x) === 0 ? somarDias(x, 1) : x)), horas: 4, hora: '08:00', diarista: d(7), k: 15 });
  pedido(c(15), { status: 'confirmado', datas: [somarDias(hoje, -9), somarDias(hoje, -2), somarDias(hoje, 5)].map((x) => (diaDaSemana(x) === 0 ? somarDias(x, 1) : x)), horas: 6, hora: '09:00', diarista: d(5), k: 16 });

  // ---------- histórico: mês passado e este mês (meta), cancelamentos com motivo, avaliação baixa recente
  const ini = `${hoje.slice(0, 7)}-01`;
  const iniAnt = new Date(Date.UTC(Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7)) - 2, 1)).toISOString().slice(0, 10);
  let k = 0;
  for (let x = iniAnt; x < ini; x = somarDias(x, 1)) {
    if (diaDaSemana(x) === 0) continue;
    for (let j = 0; j < 2; j++) pedido(c(k), { status: 'concluido', datas: [x], horas: [4, 6, 4, 8][k % 4], hora: ['08:00', '13:00'][j], servico: SERVICOS[k % SERVICOS.length], diarista: d(k), nota: 4 + (k % 2), k: k++ });
  }
  for (let x = ini; x < hoje; x = somarDias(x, 1)) {
    if (diaDaSemana(x) === 0) continue;
    for (let j = 0; j < 2; j++) pedido(c(k), { status: 'concluido', datas: [x], horas: [4, 6, 4, 8][k % 4], hora: ['08:00', '13:00'][j], servico: SERVICOS[k % SERVICOS.length], diarista: d(k), nota: 4 + (k % 2), k: k++ });
  }
  const fim = somarDias(new Date(Date.UTC(Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7)), 1)).toISOString().slice(0, 10), -1);
  for (let x = somarDias(hoje, 2); x <= fim; x = somarDias(x, 2)) if (diaDaSemana(x) !== 0) pedido(c(k), { status: 'confirmado', datas: [x], horas: 4, hora: '08:00', diarista: d(k), k: k++ });
  const MOT = [['pedido_cliente', 'Pedido da cliente'], ['pedido_cliente', 'Pedido da cliente'], ['pedido_cliente', 'Pedido da cliente'], ['sem_profissional', 'Sem profissional disponível'], ['sem_profissional', 'Sem profissional disponível'],
    ['pagamento_nao_identificado', 'Pagamento não identificado no prazo'], ['imprevisto_local', 'Imprevisto no local (sem água, sem energia)'], ['outro', 'Outro']];
  MOT.forEach(([codigo, rotulo], j) => {
    let x = somarDias(ini, j * 2 + 1); if (x >= hoje) x = somarDias(hoje, j + 4);
    if (diaDaSemana(x) === 0) x = somarDias(x, 1);
    pedido(c(j + 3), { status: 'cancelado', datas: [x], horas: 4, cancel: { codigo, rotulo }, k: k++ });
  });
  pedido(c(17), { status: 'concluido', datas: [somarDias(hoje, diaDaSemana(hoje) === 1 ? -2 : -1)], horas: 4, diarista: d(6), statusAt: ['avaliado'], nota: 2, k: k++ });

  // ---------- mensagens automáticas de hoje ("Sistema trabalhando por você")
  ['C01', 'C02', 'D04', 'C05', 'D05', 'C04', 'C07', 'C01', 'D04', 'C10', 'C05', 'C02'].forEach((regra, j) => {
    r.execucoes.push({ id: id('x'), regra, chave: `demo:${regra}:${j}`, estado: 'enviada', teste: false, contexto: { clienteId: c(j).id }, criadoEm: agoraISO(-30 * (j + 1)), atualizadoEm: agoraISO(-30 * (j + 1)) });
  });
  return r;
}
function diaUtil(hoje, n) { let x = somarDias(hoje, n); while (diaDaSemana(x) === 0) x = somarDias(x, 1); return x; }
