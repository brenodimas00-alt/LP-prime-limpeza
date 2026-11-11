// Seed de DEMONSTRAÇÃO da Agenda e Escala (SEED_DEMO=agenda). Tudo inventado; os nomes seguem as imagens de referência
// da cliente (Prime_Limpeza/agenda-escala), sem foto (avatar de iniciais). Datas relativas a hoje: o dia de hoje fica
// igual à imagem principal (11 diárias em Contagem, Betim e Belo Horizonte, stand-by, fixas, sugeridas, sem
// profissional) e a semana tem diárias passadas (finalizadas, cancelada, com ocorrência) e futuras (enviada sem
// resposta, aguardando aceite, confirmada, recusada). Prazo de "sem resposta" configurado em 2 horas só na demonstração.
import { somarDias, diaDaSemana } from '../../src/domain/calendario.js';

const PROF = [
  // nome, nota, habilidades, regiões
  ['Ana Paula Silva', 4.8, ['residencial', 'empresarial'], ['BH - Centro-Sul', 'BH - Oeste', 'Contagem']],
  ['Letícia Fernandes', 4.5, ['residencial', 'empresarial'], ['BH - Centro-Sul', 'Contagem', 'Betim']],
  ['Talita Souza', 4.2, ['residencial'], ['Contagem', 'Betim', 'BH - Oeste']],
  ['Roberta Almeida', 4.9, ['residencial', 'empresarial'], ['Contagem', 'BH - Oeste']],
  ['Maria Ferreira', 4.6, ['residencial', 'passadoria'], ['Betim', 'Contagem']],
  ['Fernanda Silva', 4.3, ['empresarial', 'residencial'], ['Betim', 'BH - Centro-Sul']],
  ['Carla Mendes', 4.7, ['residencial', 'pre_pos_evento'], ['BH - Oeste', 'BH - Centro-Sul']],
  ['Ana Beatriz Rocha', 4.4, ['residencial'], ['BH - Centro-Sul']],
  ['Mariana Alves', 4.6, ['residencial', 'pos_obra'], ['BH - Centro-Sul', 'BH - Leste']],
  ['Carlos Eduardo', 4.7, ['residencial', 'empresarial'], ['Betim', 'BH - Centro-Sul']],
];
// cliente, tipo, parceria, logradouro, número, complemento, bairro, cidade, m², cômodos, cães, gatos
const CLI = [
  ['Patrícia Souza', 'residencial', true, 'Rua das Acácias', '120', 'Apto. 301', 'Eldorado', 'Contagem', 90, 4, 0, 1],
  ['Empresa ABC Ltda', 'empresa', false, 'Av. João César', '321', '', 'Centro', 'Contagem', 120, 5, 0, 0],
  ['Fernanda Lima', 'residencial', false, 'Rua Uirapuru', '55', '', 'Inconfidentes', 'Contagem', 70, 3, 0, 0],
  ['Marcos Vieira', 'residencial', false, 'Rua das Orquídeas', '890', '', 'Ressaca', 'Contagem', 100, 4, 1, 0],
  ['Juliana Costa', 'residencial', false, 'Rua do Sol', '210', '', 'Ingá', 'Betim', 65, 3, 0, 0],
  ['Camila Duarte', 'empresa', true, 'Av. Amazonas', '450', '', 'Centro', 'Betim', 80, 4, 0, 0],
  ['Juliana Mendes', 'residencial', true, 'Rua da Paz', '123', 'ap. 201', 'Buritis', 'Belo Horizonte', 110, 4, 0, 0],
  ['Ricardo Almeida', 'residencial', false, 'Rua Professor Moraes', '350', '', 'Savassi', 'Belo Horizonte', 50, 2, 0, 0],
  ['Larissa Nogueira', 'residencial', false, 'Rua do Ouro', '900', '', 'Serra', 'Belo Horizonte', 160, 4, 0, 0],
  ['Empresa XYZ', 'empresa', false, 'Rua Contorno', '1000', '', 'Funcionários', 'Belo Horizonte', 200, 5, 0, 0],
  ['Cláudia Ramos', 'residencial', false, 'Rua das Palmeiras', '75', '', 'Santo Agostinho', 'Belo Horizonte', 95, 3, 0, 0],
  ['Ricardo Mendes', 'residencial', false, 'Rua das Flores', '75', '', 'Centro', 'Betim', 120, 5, 0, 0],
  ['Beatriz Andrade', 'residencial', false, 'Rua Alagoas', '1200', 'apto 802', 'Funcionários', 'Belo Horizonte', 85, 3, 0, 1],
  ['Paulo Henrique', 'residencial', false, 'Rua Rio Comprido', '40', '', 'Riacho', 'Contagem', 75, 3, 1, 0],
];
const VALOR = { 4: 17500, 6: 20300, 8: 23000 };
// hoje (imagem 1): [cliente, hora, horas, serviço, profissional|null, origem, pago, escala, pacote]
const HOJE = [
  [0, '08:00', 6, 'residencial', 0, 'fixa', true, 'revisada', true],
  [1, '10:00', 4, 'empresarial', 1, 'sugerida', false, 'para_revisar', false],
  [2, '13:00', 4, 'residencial', 2, 'sugerida', true, 'revisada', true],
  [3, '16:00', 6, 'residencial', 3, 'manual', false, 'para_revisar', false],
  [4, '09:00', 6, 'residencial', 4, 'fixa', true, 'revisada', true],
  [5, '14:00', 4, 'empresarial', 5, 'sugerida', false, 'para_revisar', false],
  [6, '08:00', 6, 'residencial', 6, 'fixa', true, 'revisada', true],
  [7, '09:30', 4, 'residencial', 7, 'sugerida', false, 'para_revisar', true],
  [8, '11:00', 8, 'residencial', 8, 'sugerida', true, 'revisada', false],
  [9, '14:00', 6, 'pre_pos_evento', null, null, false, 'para_revisar', false],
  [10, '16:00', 6, 'residencial', 1, 'sugerida', true, 'revisada', true],
];
const CONTAGEM_SEMANA = { 1: 8, 2: 10, 3: 11, 4: 9, 5: 7, 6: 5, 0: 0 }; // Seg..Dom, como na imagem
const HORAS = ['08:00', '09:00', '10:00', '12:00', '13:00', '14:00', '16:00', '08:30', '11:00', '15:00'];

/** Registros prontos por store (mock). */
export function montarSeedAgenda(hoje, { agoraISO }) {
  let n = 0;
  const id = (p) => `00000000-0000-4000-9100-${p}${String(++n).padStart(12 - p.length, '0')}`;
  const iso = (d, h = '09:00') => new Date(`${d}T${h}:00-03:00`).toISOString();
  const r = { clientes: [], enderecos: [], diaristas: [], pedidos: [], atendimentos: [], pagamentos: [], avaliacoes: [], standbyDecisoes: [], vinculosFixos: [], configPainel: [] };
  let numero = 10300;
  const dias = PROF.map(([nome, nota, habilidades, regioes], i) => {
    const d = { id: id('d'), nome, cpf: `100000000${i}`.slice(-11), telefone: `3198${String(8100000 + i * 1373).slice(0, 7)}`, email: `agenda.prof${i}@exemplo.com`, dataNascimento: '1986-03-12',
      status: 'aprovada', identidade: 'rg', documentos: [], habilidades, disponibilidade: { dias: [1, 2, 3, 4, 5, 6], turnos: ['integral'], regioes }, criadoEm: iso(somarDias(hoje, -300)), notaDemo: nota };
    r.diaristas.push(d); return d;
  });
  const clientes = CLI.map(([nome, tipo, parceria, logradouro, numeroEnd, complemento, bairro, cidade, metragem, comodos, caes, gatos], i) => {
    const endereco = { cep: cidade === 'Belo Horizonte' ? '30130010' : cidade === 'Contagem' ? '32310000' : '32600000', logradouro, numero: numeroEnd, complemento, bairro, cidade, uf: 'MG' };
    const c = { id: id('c'), tipo, nome, parceria, telefone: `3199${String(3100000 + i * 4111).slice(0, 7)}`, email: `agenda.cli${i}@exemplo.com`, endereco, origem: 'site', criadoEm: iso(somarDias(hoje, -120)),
      imovelDemo: { metragem, comodos, caes, gatos } };
    r.clientes.push(c);
    r.enderecos.push({ id: id('e'), clienteId: c.id, ...endereco, pontoReferencia: '', tipoImovel: tipo === 'empresa' ? 'Sala comercial' : 'Apartamento', tipoImovelOutro: '', apelido: null, principal: true, usoUnico: false, ativo: true, criadoEm: c.criadoEm });
    return c;
  });
  const car = (c, servico) => {
    const im = c.imovelDemo;
    const base = { metragem: im.metragem, ambientesTotal: im.comodos, animais: { tem: im.caes + im.gatos > 0, caes: im.caes, gatos: im.gatos, outros: 0 } };
    return servico === 'pre_pos_evento' ? { ...base, momento: 'depois', condicao: 'normal' } : base;
  };

  /** Pedido (avulso ou pacote) com as diárias dadas: [{data, hora, horas, prof, origem, escala, status, pago, envio, ocorrencia}] */
  function pedido(cliente, servico, diarias, { pacote = false } = {}) {
    const p = { id: id('p'), clienteId: cliente.id, numeroSolicitacao: ++numero, modalidade: pacote ? 'pacote' : 'avulsa', origemCliente: null, pacoteEnderecoNovo: false,
      status: diarias.every((x) => x.pago) ? 'confirmado' : 'aguardando_pagamento',
      pacote: { tipoServico: servico, duracaoHoras: diarias[0].horas, quantidadeDiarias: diarias.length, frequencia: pacote ? 'semanal' : 'avulso', totalCentavos: VALOR[diarias[0].horas] * diarias.length, metragem: cliente.imovelDemo.metragem },
      endereco: cliente.endereco, historico: [{ de: 'rascunho', para: 'solicitado', evento: 'solicitar', em: iso(somarDias(diarias[0].data, -8), '10:00'), ator: 'cliente' }], criadoEm: iso(somarDias(diarias[0].data, -8), '10:00') };
    r.pedidos.push(p);
    const ats = diarias.map((x, s) => {
      const passado = x.data < hoje;
      const status = x.status || (passado ? 'avaliado' : x.pago ? 'confirmado' : 'agendado');
      const d = x.prof === null || x.prof === undefined ? null : dias[x.prof];
      const a = { id: id('a'), pedidoId: p.id, sequencia: s + 1, data: x.data, horaInicio: x.hora, duracaoMinutos: x.horas * 60, servico, caracteristicas: car(cliente, servico), localRefeicao: true,
        endereco: cliente.endereco, status, diaristaId: d?.id || null, valorDiaCentavos: VALOR[x.horas], versao: 1, atualizadoEm: iso(somarDias(x.data, -2)),
        escalaEstado: passado ? 'confirmada' : x.escala || 'para_revisar', escalaVersao: 1, designacaoOrigem: d ? (x.origem || 'manual') : null, escalaEnvio: x.envio || (passado ? { enviadaEm: iso(somarDias(x.data, -1), '15:00'), canal: 'whatsapp', resposta: 'aceite' } : null),
        escalaRecusa: x.recusa || null, escalaSemAuto: !!x.recusa || x.prof === null, escalaSugestao: x.origem === 'sugerida' ? { pontos: 70, motivos: ['disponível e sem conflito', `atende ${cliente.endereco.cidade}`, 'tem a habilidade do serviço'], criteriosSemDado: ['deslocamento', 'imovel', 'perfil', 'preferencia'] } : null,
        ocorrencia: x.ocorrencia ? { estado: 'aberto' } : null, historico: [] };
      r.atendimentos.push(a);
      const g = { id: id('g'), pedidoId: p.id, atendimentoId: a.id, parcela: 'diaria', valorCentavos: VALOR[x.horas], descontoCentavos: 0, metodo: 'pix', status: x.pago || passado ? 'confirmado' : 'pendente',
        venceEm: somarDias(x.data, -1), venceAs: '14:00', informadoEm: null, confirmadoEm: x.pago || passado ? iso(somarDias(x.data, -2), '15:00') : null, criadoEm: iso(somarDias(x.data, -6)), pixTxid: `AGENDADEMO${numero}${s}` };
      r.pagamentos.push(g);
      if (status === 'avaliado' && d) r.avaliacoes.push({ id: id('v'), atendimentoId: a.id, notaFinal: d.notaDemo, notas: { pontualidade: Math.round(d.notaDemo), qualidade: Math.round(d.notaDemo), cuidado: Math.round(d.notaDemo), comunicacao: Math.round(d.notaDemo) }, comentario: '', criadoEm: iso(x.data, '18:00') });
      return a;
    });
    return { p, ats };
  }

  // ---------- hoje: igual à imagem 1 (os pacotes têm a mesma diária na semana seguinte)
  const diaD = diaDaSemana(hoje) === 0 ? somarDias(hoje, 1) : hoje;
  HOJE.forEach(([ci, hora, horas, servico, prof, origem, pago, escala, pacote]) => {
    const linha = { data: diaD, hora, horas, prof, origem, pago, escala };
    const { p } = pedido(clientes[ci], servico, pacote ? [linha, { ...linha, data: somarDias(diaD, 7), escala: 'para_revisar', pago }] : [linha], { pacote });
    if (origem === 'fixa') r.vinculosFixos.push({ id: id('f'), pedidoId: p.id, diaSemana: diaDaSemana(diaD), diaristaId: dias[prof].id, vigenteDesde: iso(somarDias(hoje, -30)), encerradoEm: null, criadoPor: 'seed' });
  });
  // ---------- o resto da semana (contagens como na imagem): passadas finalizadas, futuras em várias situações
  const segunda = somarDias(diaD, -((diaDaSemana(diaD) + 6) % 7));
  for (let i = -7; i < 7; i++) { // semana anterior (histórico) e a semana do dia
    const data = somarDias(segunda, i);
    if (data === diaD) continue;
    const total = CONTAGEM_SEMANA[diaDaSemana(data)];
    for (let k = 0; k < total; k++) {
      const ci = (((k + i * 3) % CLI.length) + CLI.length) % CLI.length; const c = clientes[ci];
      const passado = data < hoje;
      const x = { data, hora: HORAS[k % HORAS.length], horas: [4, 6, 4, 8][k % 4], prof: k % dias.length, origem: k % 3 === 0 ? 'fixa' : 'sugerida', pago: true };
      if (passado) {
        if (k === 3) x.status = 'cancelado';
        if (k === 2) { x.status = 'finalizado'; x.ocorrencia = true; }
      } else {
        const sit = (((k + i) % 6) + 6) % 6;
        x.pago = sit !== 3;
        if (sit === 0) { x.escala = 'enviada'; x.envio = { enviadaEm: agoraISO(-180), canal: 'whatsapp', versao: 1 }; } // sem resposta há 3 h
        else if (sit === 1) { x.escala = 'aguardando_aceite'; x.envio = { enviadaEm: agoraISO(-40), canal: 'whatsapp', versao: 1, entregueEm: agoraISO(-39) }; }
        else if (sit === 2) { x.escala = 'confirmada'; x.envio = { enviadaEm: agoraISO(-600), canal: 'whatsapp', versao: 1, resposta: 'aceite', respondidaEm: agoraISO(-560) }; }
        else if (sit === 3) x.escala = 'revisada';
        else if (sit === 4 && k === 4) { x.prof = null; x.origem = null; x.escala = 'para_revisar'; x.recusa = { diaristaId: dias[(k + 1) % dias.length].id, nome: dias[(k + 1) % dias.length].nome, em: agoraISO(-90), canal: 'whatsapp', motivo: null }; }
        else x.escala = 'para_revisar';
      }
      pedido(c, ['residencial', 'empresarial', 'residencial', 'residencial'][k % 4], [x]);
    }
  }
  // ---------- avaliações antigas (a nota de cada profissional nos selos)
  dias.forEach((d, i) => {
    const data = somarDias(hoje, -40 - i);
    pedido(clientes[i % CLI.length], 'residencial', [{ data: diaDaSemana(data) === 0 ? somarDias(data, -1) : data, hora: '08:00', horas: 4, prof: i, pago: true }]);
  });
  // ---------- stand-by: Roberta reservada pra hoje, 10:00, 6 horas (decisão 1 h antes)
  r.standbyDecisoes.push({ chave: `${dias[3].id}:${diaD}`, diaristaId: dias[3].id, data: diaD, estado: 'confirmada', horaInicio: '10:00', duracaoMinutos: 360, regiao: 'Contagem/BH',
    decidirAte: iso(diaD, '09:00'), atendimentoId: null, motivo: null, decididoPor: 'seed', em: agoraISO(-600), historico: [{ estado: 'reservada', em: agoraISO(-700), por: 'Isa' }, { estado: 'confirmada', em: agoraISO(-600), por: 'Isa' }] });
  r.configPainel.push({ chave: 'agenda_escala', valor: { prazoSemRespostaMin: 120, verificacaoPagamento: { ligada: false, hora: null }, standbyAlertaMin: 60, canalAtivo: 'whatsapp', historicoCanal: [] } });
  for (const d of r.diaristas) delete d.notaDemo;
  for (const c of r.clientes) delete c.imovelDemo;
  return { registros: r, dia: diaD };
}
