// Autoagendamento v3 (spec-agendamento-v3.txt + autoagendamento-v3-isa.txt, 56 itens da cliente, 06/10/2026).
// Funções puras, espelhadas no banco (privado.*_v3 em supabase/migrations/20261006100000_agendamento_v3.sql; paridade em
// scripts/testa-paridade.mjs). Dinheiro em centavos inteiros. Nada aqui confirma disponibilidade nem gera cobrança.
//
// - recomendarDuracao: faixa-base pela metragem cruzada com os ambientes (pesos), + condição (mudança, evento após),
//   passadoria pela tabela de peças; nunca acima de 8h (excedente: mais de uma profissional ou dividir em diárias).
// - horariosPermitidos: 08:00 até (fim do expediente − duração), minutos 00/15/30/45.
// - cotarV3: valor por atendimento (duração + serviço + sábado/feriado + refeição + deslocamento por endereço), desconto
//   por quantidade, cupom e condição especial (regra de não acumular), total e parcelas previstas.
// - marcoSegundaMetade / calcularParcelas: 100% (avulsa e multi), 50% + 50% (pacote), faturamento (empresa autorizada).
import { ErroNegocio } from './modelo.js';
import { dataValida, diaDaSemana, diaUtilAnterior, somarDias } from './calendario.js';
import { motivoDataIndisponivel } from './agenda.js';
import { paraMinutos, deMinutos } from './horario.js';

export const MODALIDADES = ['avulsa', 'multi_profissional', 'pacote'];
export const FREQUENCIAS_PACOTE = ['semanal', 'quinzenal', 'mensal', 'datas'];
export const MOBILIADO = ['vazio', 'parcial', 'mobiliado'];
export const CONDICAO_MUDANCA = ['leve', 'moderada', 'intensa'];
export const CONDICAO_EVENTO = ['leve', 'moderado', 'intenso'];
export const ORIGENS = ['indicacao', 'instagram', 'google', 'whatsapp', 'outro'];

const inteiro = (v) => Number.isInteger(v);
const temValor = (v) => v !== undefined && v !== null && v !== '';
const objeto = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const RE_HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

// ---------------------------------------------------------------- recomendação de duração

/** Ambientes ponderados (banheiro e cozinha pesam mais). Só os tipos configurados entram. */
export function ambientesPonderados(ambientes, cfg) {
  const V = cfg.PRECOS.v3;
  if (!objeto(ambientes)) return 0;
  return V.ambientes.tipos.reduce((s, k) => s + (inteiro(ambientes[k]) && ambientes[k] > 0 ? ambientes[k] * (V.pesosAmbientes[k] ?? 1) : 0), 0);
}

/** Total simples de ambientes (o que o cliente vê no resumo: "8 ambientes"). */
export function totalAmbientes(ambientes, cfg) {
  if (!objeto(ambientes)) return 0;
  return cfg.PRECOS.v3.ambientes.tipos.reduce((s, k) => s + (inteiro(ambientes[k]) && ambientes[k] > 0 ? ambientes[k] : 0), 0);
}

/** Índice da faixa-base: metragem (acima da última fica na última) cruzada com ambientes (sobe no máximo N faixas). */
function faixaBase(tabela, metragem, ambientes, subidaMaxima) {
  let iM = tabela.findIndex((f) => metragem <= f.metragem);
  if (iM < 0) iM = tabela.length - 1;
  if (!(ambientes > 0)) return iM;
  let iA = tabela.findIndex((f) => ambientes <= f.ambientes);
  if (iA < 0) iA = tabela.length;
  return Math.max(iM, Math.min(iA, iM + subidaMaxima));
}

/**
 * Duração recomendada pra um atendimento. car: características do serviço (ver validarCaracteristicas).
 * @returns {{horas:number|null, excedente:boolean, orientacao:null|'mais_profissionais'|'dividir_diarias', avisoMetragem:boolean}}
 *  horas null sem dados suficientes (motivo 'sem_dados') ou acima de 8h (excedente).
 */
export function recomendarDuracao(servico, car, segmento, cfg) {
  const V = cfg.PRECOS.v3;
  const vazio = { horas: null, excedente: false, orientacao: null, avisoMetragem: false };
  if (!objeto(car)) return vazio;
  if (servico === 'passadoria') {
    if (!inteiro(car.pecas) || car.pecas < 1) return vazio;
    const fx = V.passadoria.faixas;
    let i = fx.findIndex((f) => car.pecas <= f.ate);
    if (i < 0) i = fx.length;
    if (V.passadoria.tiposQueSobem.includes(car.tipoPecas)) i += 1;
    if (i >= fx.length) return { horas: null, excedente: true, orientacao: 'dividir_diarias', avisoMetragem: false };
    return { horas: fx[i].horas, excedente: false, orientacao: null, avisoMetragem: false };
  }
  if (!inteiro(car.metragem) || car.metragem < 1) return vazio;
  const tabela = V.faixas[segmento === 'empresa' ? 'empresa' : 'residencial'];
  const evento = servico === 'pre_pos_evento';
  const amb = evento ? (inteiro(car.ambientesTotal) ? car.ambientesTotal : 0) : ambientesPonderados(car.ambientes, cfg);
  let i = faixaBase(tabela, car.metragem, amb, V.subidaMaximaPorAmbientes);
  if (servico === 'pre_pos_mudanca' || (evento && car.momento === 'depois')) i += V.condicao[car.condicao] ?? 0;
  const avisoMetragem = car.metragem > V.avisoMetragemAcima;
  if (i >= tabela.length) return { horas: null, excedente: true, orientacao: 'mais_profissionais', avisoMetragem };
  return { horas: tabela[i].horas, excedente: false, orientacao: null, avisoMetragem };
}

// ---------------------------------------------------------------- validação das características

/** @returns {string[]} erros legíveis (mesmas mensagens e ordem no SQL). */
export function validarCaracteristicas(servico, car, cfg) {
  const V = cfg.PRECOS.v3;
  const P = cfg.PRECOS;
  const e = [];
  if (!objeto(car)) return ['Conte um pouco sobre o local'];
  const ambOk = (a) => objeto(a) && Object.keys(a).every((k) => V.ambientes.tipos.includes(k))
    && Object.values(a).every((v) => inteiro(v) && v >= 0 && v <= V.ambientes.maximoPorTipo);
  if (servico === 'passadoria') {
    if (!inteiro(car.pecas) || car.pecas < 1 || car.pecas > V.passadoria.maximoPecas) e.push(`Quantidade de peças: de 1 a ${V.passadoria.maximoPecas}`);
    if (!V.passadoria.tipos.includes(car.tipoPecas)) e.push('Escolha os tipos de peças que predominam');
  } else {
    if (!inteiro(car.metragem) || car.metragem < P.metragem.minimo || car.metragem > P.metragem.maximo) e.push(`Metragem deve ser um inteiro entre ${P.metragem.minimo} e ${P.metragem.maximo} m²`);
    if (servico === 'pre_pos_evento') {
      if (!['antes', 'depois'].includes(car.momento)) e.push('Informe se o atendimento será antes ou após o evento');
      if (!inteiro(car.ambientesTotal) || car.ambientesTotal < 1 || car.ambientesTotal > V.ambientes.maximoTotalEventos) e.push(`Quantidade de ambientes: de 1 a ${V.ambientes.maximoTotalEventos}`);
      if (car.momento === 'depois' && !CONDICAO_EVENTO.includes(car.condicao)) e.push('Informe como estará o espaço após o evento');
    } else {
      if (!ambOk(car.ambientes)) e.push('Quantidade de ambientes inválida');
      else if (totalAmbientes(car.ambientes, cfg) < 1) e.push('Informe pelo menos um ambiente');
      if (servico === 'pre_pos_mudanca') {
        if (!MOBILIADO.includes(car.mobiliado)) e.push('Informe se o imóvel está vazio ou mobiliado');
        if (!CONDICAO_MUDANCA.includes(car.condicao)) e.push('Informe a condição atual do imóvel');
      }
    }
  }
  const a = car.animais;
  if (!objeto(a) || typeof a.tem !== 'boolean') e.push('Responda se há animais no local');
  else if (a.tem) {
    const n = ['caes', 'gatos', 'outros'].map((k) => a[k]);
    if (n.some((v) => !inteiro(v) || v < 0 || v > 20)) e.push('Quantidade de animais inválida');
    else if (n.reduce((s, v) => s + v, 0) < 1) e.push('Informe quantos animais há no local');
    else if (a.outros > 0 && !(typeof a.outrosQual === 'string' && a.outrosQual.trim().length >= 2 && a.outrosQual.length <= 60)) e.push('Informe qual animal');
  }
  return e;
}

// ---------------------------------------------------------------- horários

/** Fim do expediente do dia (sábado pode ter o próprio). */
export function fimExpediente(data, cfg) {
  const ht = cfg.horariosTrabalho;
  return data && dataValida(data) && diaDaSemana(data) === 6 && ht.fimExpedienteSabado ? ht.fimExpedienteSabado : ht.fimExpediente;
}

/** 'HH:MM' permitidos: de primeiroInicio até fim − duração, nos minutos configurados (00, 15, 30, 45). */
export function horariosPermitidos(duracaoHoras, data, cfg) {
  const ini = paraMinutos(cfg.horariosTrabalho.primeiroInicio);
  const ultimo = paraMinutos(fimExpediente(data, cfg)) - Number(duracaoHoras) * 60;
  const mins = cfg.PRECOS.v3.minutos;
  const out = [];
  for (let h = Math.floor(ini / 60); h * 60 <= ultimo; h++) {
    for (const m of mins) { const t = h * 60 + m; if (t >= ini && t <= ultimo) out.push(deMinutos(t)); }
  }
  return out;
}

/** Pro seletor compacto Hora | Minutos: {horas:['08',...], minutos:{'08':['00',...]}}. */
export function opcoesHoraMinuto(duracaoHoras, data, cfg) {
  const minutos = {};
  const horas = [];
  for (const h of horariosPermitidos(duracaoHoras, data, cfg)) {
    const hh = h.slice(0, 2);
    if (!minutos[hh]) { minutos[hh] = []; horas.push(hh); } // a lista guarda a ordem (chave '10' de objeto vem antes de '08')
    minutos[hh].push(h.slice(3));
  }
  return { horas, minutos };
}

// ---------------------------------------------------------------- região e taxas

/** Região do endereço: faixa de CEP (vence a cidade) ou cidade atendida. {nome, taxaCentavos} | {sobConsulta} | null. */
export function regiaoV3(endereco, cfg) {
  if (!objeto(endereco)) return null;
  const cep = String(endereco.cep || '').replace(/\D/g, '');
  if (cep.length === 8) {
    const f = (cfg.faixasCep || []).find((x) => x.ativa !== false && cep >= x.cepInicio && cep <= x.cepFim);
    if (f) return { nome: f.nome, taxaCentavos: f.taxaCentavos };
  }
  const sem = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
  const r = (cfg.regioesAtendidas || []).find((x) => x.ativa !== false && sem(x.cidade) === sem(endereco.cidade) && sem(x.uf) === sem(endereco.uf));
  if (!r) return null;
  if (r.sobConsulta) return { nome: r.cidade, sobConsulta: true };
  return { nome: r.cidade, taxaCentavos: r.taxaCentavos || 0 };
}

export const ehFeriado = (data, cfg) => (cfg.feriados || []).includes(data);
export const ehSabado = (data) => diaDaSemana(data) === 6;

// ---------------------------------------------------------------- descontos

/** Desconto por quantidade (uma vez sobre o total). */
export function descontoQuantidade(modalidade, quantidade, cfg) {
  const V = cfg.PRECOS.v3;
  if (!V.modalidadesComDescontoQuantidade.includes(modalidade)) return 0;
  const f = [...V.descontoQuantidade].sort((a, b) => b.minimo - a.minimo).find((x) => quantidade >= x.minimo);
  return f ? f.centavos : 0;
}

const percentual = (base, p) => Math.round((base * p) / 100);

/**
 * Cupom já resolvido pelo servidor: {codigo, tipo:'valor'|'percentual', valor, modalidades[], primeiraContratacao, validoAte, ativo,
 * esgotado, acumula}. ctx: {modalidade, hoje, primeiraContratacao (a cliente não tem contratação confirmada)}.
 * @returns {{ok:true}|{ok:false, motivo:string}}
 */
export function avaliarCupom(c, { modalidade, hoje, primeiraContratacao }) {
  if (!objeto(c) || !c.ativo) return { ok: false, motivo: 'inexistente' };
  if (c.esgotado) return { ok: false, motivo: 'esgotado' };
  if (c.validoAte && hoje > c.validoAte) return { ok: false, motivo: 'vencido' };
  if (Array.isArray(c.modalidades) && c.modalidades.length && !c.modalidades.includes(modalidade)) return { ok: false, motivo: 'modalidade' };
  if (c.primeiraContratacao && !primeiraContratacao) return { ok: false, motivo: 'primeira_contratacao' };
  return { ok: true };
}

/** Condição comercial do cliente: {tipo, valor, modalidades[], quantidadeMinima, validade, validoAte, acumula, consumida, ativa}. */
export function avaliarCondicao(c, { modalidade, quantidade, hoje }) {
  if (!objeto(c) || c.ativa === false) return false;
  if (Array.isArray(c.modalidades) && c.modalidades.length && !c.modalidades.includes(modalidade)) return false;
  if (inteiro(c.quantidadeMinima) && quantidade < c.quantidadeMinima) return false;
  if (c.validade === 'uso_unico' && c.consumida) return false;
  if (c.validade === 'periodo' && (!c.validoAte || hoje > c.validoAte)) return false;
  return true;
}

// ---------------------------------------------------------------- parcelas

/** Data da primeira diária da segunda metade (agenda vigente): a de índice floor(n/2) nas datas ordenadas. */
export function marcoSegundaMetade(datas) {
  const ds = [...new Set(datas)].sort();
  if (ds.length < 2) return null;
  return ds[Math.floor(ds.length / 2)];
}

/**
 * Parcelas previstas. modalidade avulsa/multi: 'integral'; pacote: 'metade_1' (confirmação) + 'metade_2' (segunda metade);
 * faturamento autorizado: 'faturamento' (vence prazoDias depois da última diária).
 */
export function calcularParcelas({ modalidade, datas, totalCentavos, faturamento }, cfg) {
  const pg = cfg.PRECOS.v3.pagamento;
  const ds = [...new Set(datas)].sort();
  if (!ds.length) return [];
  const fer = cfg.feriados || [];
  const vence = (d) => ({ venceEm: diaUtilAnterior(d, fer), venceAs: pg.horaPrazo });
  if (faturamento) {
    return [{ parcela: 'faturamento', marco: 'confirmacao', valorCentavos: totalCentavos, venceEm: somarDias(ds.at(-1), faturamento.prazoDias || 0), venceAs: null }];
  }
  // pacote que ficou com uma data só (cancelamento das outras): não há segunda metade, a cobrança é única
  if (modalidade !== 'pacote' || ds.length < 2) return [{ parcela: 'integral', marco: 'confirmacao', valorCentavos: totalCentavos, ...vence(ds[0]) }];
  const p1 = percentual(totalCentavos, pg.percentualPrimeiraParcela);
  const marco = marcoSegundaMetade(ds);
  const v2 = vence(marco);
  return [
    { parcela: 'metade_1', marco: 'confirmacao', valorCentavos: p1, ...vence(ds[0]) },
    { parcela: 'metade_2', marco: 'segunda_metade', marcoData: marco, valorCentavos: totalCentavos - p1, ...v2, envioEm: somarDias(v2.venceEm, -pg.parcela2DiasAntesEnvio) },
  ];
}

// ---------------------------------------------------------------- validação do pedido

/**
 * pedido: {segmento, modalidade, frequencia?, atendimentos:[{servico, caracteristicas?, duracaoHoras, data, horaInicio,
 * endereco:{cep,cidade,uf,...}, localRefeicao:boolean, cienteDuracaoMenor?, justificativa?}]}. O 1º atendimento leva as
 * características (as demais diárias/profissionais podem omitir). @returns {string[]}
 */
export function validarPedidoV3(pedido, cfg) {
  const P = cfg.PRECOS;
  const V = P.v3;
  const e = [];
  if (!objeto(pedido)) return ['Solicitação não informada'];
  if (!['residencial', 'empresa'].includes(pedido.segmento)) e.push('Escolha onde será realizado o atendimento');
  if (!MODALIDADES.includes(pedido.modalidade)) e.push('Escolha a modalidade');
  if (pedido.modalidade === 'pacote' && !FREQUENCIAS_PACOTE.includes(pedido.frequencia)) e.push('Escolha a frequência');
  const at = pedido.atendimentos;
  if (!Array.isArray(at) || at.length < 1) { e.push('Escolha a data do atendimento'); return e; }
  if (pedido.modalidade === 'avulsa' && at.length !== 1) e.push('Diária avulsa é uma diária em uma única data');
  if (pedido.modalidade === 'multi_profissional') {
    if (at.length < 2) e.push('Escolha 2 ou mais profissionais');
    else if (at.length > V.limites.maximoProfissionais) e.push(`No máximo ${V.limites.maximoProfissionais} profissionais`);
    if (new Set(at.map((a) => a?.data)).size > 1) e.push('Todas as profissionais atendem no mesmo dia');
  }
  if (pedido.modalidade === 'pacote') {
    if (at.length < 2) e.push('Escolha 2 ou mais datas');
    else if (at.length > V.limites.maximoDiarias) e.push(`No máximo ${V.limites.maximoDiarias} diárias por solicitação`);
    if (new Set(at.map((a) => a?.data)).size !== at.length) e.push('A mesma data foi escolhida duas vezes');
  }
  const servicos = P.servicosPorTipoCliente[pedido.segmento] || [];
  at.forEach((a, i) => {
    const n = `Diária ${i + 1}: `;
    if (!objeto(a)) { e.push(`${n}dados inválidos`); return; }
    if (!servicos.includes(a.servico)) e.push(`${n}escolha o serviço`);
    if (!inteiro(a.duracaoHoras) || !P.duracoes[a.duracaoHoras]) e.push(`${n}escolha a duração (2, 4, 6 ou 8 horas)`);
    if (!dataValida(a.data)) e.push(`${n}escolha a data`);
    if (!RE_HORA.test(a.horaInicio || '')) e.push(`${n}escolha o horário`);
    if (!objeto(a.endereco)) e.push(`${n}escolha o endereço`);
    if (typeof a.localRefeicao !== 'boolean') e.push(`${n}responda sobre o local para a refeição`);
    if (i === 0 || temValor(a.caracteristicas)) {
      if (servicos.includes(a.servico)) for (const x of validarCaracteristicas(a.servico, a.caracteristicas, cfg)) e.push(`${n}${x}`);
    }
    const lim2 = P.duracoes[2]?.metragemMaxima;
    if (a.duracaoHoras === 2 && lim2 && a.servico !== 'passadoria' && inteiro(a.caracteristicas?.metragem) && a.caracteristicas.metragem > lim2) {
      e.push(`${n}a diária de 2 horas é só para locais até ${lim2} m²`);
    }
    if (temValor(a.justificativa) && (typeof a.justificativa !== 'string' || a.justificativa.length > 500)) e.push(`${n}justificativa com no máximo 500 caracteres`);
  });
  return e;
}

// ---------------------------------------------------------------- cotação

/**
 * Cotação completa (o servidor refaz igual no envio e na confirmação).
 * ctx: {hoje, cupom?: objeto resolvido, condicao?: objeto resolvido, primeiraContratacao?: boolean, faturamento?: {prazoDias}}.
 */
export function cotarV3(pedido, ctx, cfg) {
  const erros = validarPedidoV3(pedido, cfg);
  if (erros.length) throw new ErroNegocio('DADOS_INVALIDOS', erros.join('; '), erros);
  const P = cfg.PRECOS;
  const V = P.v3;
  const { hoje } = ctx;
  const problemas = [];
  // ordem estável: data, hora, posição informada
  const ordem = pedido.atendimentos.map((a, i) => ({ a, i })).sort((x, y) => x.a.data.localeCompare(y.a.data) || x.a.horaInicio.localeCompare(y.a.horaInicio) || x.i - y.i);
  const atendimentos = ordem.map(({ a, i }, k) => {
    const seq = k + 1;
    const motivo = motivoDataIndisponivel(a.data, hoje, cfg);
    if (motivo) problemas.push({ sequencia: seq, data: a.data, motivo });
    else if (!horariosPermitidos(a.duracaoHoras, a.data, cfg).includes(a.horaInicio)) {
      problemas.push({ sequencia: seq, data: a.data, motivo: `horário ${a.horaInicio} fora do horário de atendimento para ${a.duracaoHoras} horas` });
    }
    const reg = regiaoV3(a.endereco, cfg);
    if (!reg) throw new ErroNegocio('REGIAO_NAO_ATENDIDA', `No momento, não atendemos esta região (${a.endereco.cidade || 'CEP'})`);
    if (reg.sobConsulta) throw new ErroNegocio('REGIAO_SOB_CONSULTA', `${reg.nome}: atendimento sob consulta. Fale com a Prime pelo WhatsApp.`);
    const tipo = P.tiposServico[a.servico];
    const itens = [{ codigo: 'diaria', descricao: `Diária de ${a.duracaoHoras} horas`, centavos: P.duracoes[a.duracaoHoras].centavos }];
    if (tipo.centavos) itens.push({ codigo: `servico:${a.servico}`, descricao: tipo.nome, centavos: tipo.centavos });
    const base = itens.reduce((s, x) => s + x.centavos, 0);
    const sab = ehSabado(a.data);
    const fer = ehFeriado(a.data, cfg);
    const taxas = {
      sabado: sab && (!fer || V.taxas.acumulaSabadoFeriado) ? V.taxas.sabadoCentavos : 0,
      feriado: fer ? V.taxas.feriadoCentavos : 0,
      refeicao: a.localRefeicao ? 0 : V.taxas.semRefeicaoCentavos,
      deslocamento: reg.taxaCentavos || 0,
    };
    if (taxas.sabado) itens.push({ codigo: 'sabado', descricao: 'Sábado', centavos: taxas.sabado });
    if (taxas.feriado) itens.push({ codigo: 'feriado', descricao: 'Feriado', centavos: taxas.feriado });
    if (taxas.refeicao) itens.push({ codigo: 'sem_refeicao', descricao: 'Sem local para aquecer refeição', centavos: taxas.refeicao });
    if (taxas.deslocamento) itens.push({ codigo: 'deslocamento', descricao: `Deslocamento (${reg.nome})`, centavos: taxas.deslocamento });
    const rec = temValor(a.caracteristicas) ? recomendarDuracao(a.servico, a.caracteristicas, pedido.segmento, cfg) : null;
    const recomendada = rec?.horas ?? null;
    if (recomendada && a.duracaoHoras < recomendada && a.cienteDuracaoMenor !== true) {
      problemas.push({ sequencia: seq, data: a.data, motivo: 'confirme que está ciente da duração menor que a sugerida' });
    }
    return {
      sequencia: seq, posicao: i, servico: a.servico, data: a.data, horaInicio: a.horaInicio, duracaoMinutos: a.duracaoHoras * 60,
      regiao: reg.nome, itens, baseCentavos: base, taxas, valorCentavos: itens.reduce((s, x) => s + x.centavos, 0),
      duracaoRecomendadaHoras: recomendada,
    };
  });
  if (problemas.length) {
    throw new ErroNegocio('DATA_INVALIDA', problemas.map((p) => `Diária ${p.sequencia} (${p.data}): ${p.motivo}`).join('; '), problemas);
  }
  const subtotal = atendimentos.reduce((s, x) => s + x.valorCentavos, 0);
  const qtd = atendimentos.length;
  const descQtd = descontoQuantidade(pedido.modalidade, qtd, cfg);
  // cupom
  let cupom = null;
  let valorCupom = 0;
  if (temValor(ctx.cupom) || temValor(pedido.cupom)) {
    const av = avaliarCupom(ctx.cupom, { modalidade: pedido.modalidade, hoje, primeiraContratacao: !!ctx.primeiraContratacao });
    cupom = { codigo: String(pedido.cupom || ctx.cupom?.codigo || '').toUpperCase(), aplicado: av.ok, ...(av.ok ? {} : { motivo: av.motivo }) };
    if (av.ok) {
      const c = ctx.cupom;
      const baseCupom = c.primeiraContratacao ? atendimentos[0].valorCentavos : subtotal;
      valorCupom = c.tipo === 'percentual' ? percentual(baseCupom, c.valor) : Math.min(c.valor, baseCupom);
    }
  }
  // condição especial do cliente
  const cond = ctx.condicao && avaliarCondicao(ctx.condicao, { modalidade: pedido.modalidade, quantidade: qtd, hoje }) ? ctx.condicao : null;
  const valorEsp = cond ? (cond.tipo === 'percentual' ? percentual(subtotal, cond.valor) : cond.valor) : 0;
  // regra de não acumular (item 44): especial não cumulativo vale sozinho; cupom não cumulativo substitui o de quantidade
  const candidatos = [];
  const semEspecial = () => {
    if (cupom?.aplicado && !ctx.cupom.acumula) return [{ codigo: 'cupom', descricao: `Cupom ${cupom.codigo}`, centavos: valorCupom }];
    const l = [];
    if (descQtd) l.push({ codigo: 'quantidade', descricao: pedido.modalidade === 'pacote' ? 'Desconto do pacote' : 'Desconto por profissionais', centavos: descQtd });
    if (cupom?.aplicado) l.push({ codigo: 'cupom', descricao: `Cupom ${cupom.codigo}`, centavos: valorCupom });
    return l;
  };
  if (cond) {
    candidatos.push({ codigo: 'especial', descricao: 'Desconto especial', centavos: valorEsp });
    if (cond.acumula) candidatos.push(...semEspecial());
    else if (cupom?.aplicado) cupom = { ...cupom, aplicado: false, motivo: 'nao_acumula' };
  } else candidatos.push(...semEspecial());
  let restante = subtotal;
  const descontos = [];
  for (const d of candidatos) {
    const c = Math.min(d.centavos, restante);
    if (c > 0) { descontos.push({ ...d, centavos: c }); restante -= c; }
  }
  const descontoCentavos = subtotal - restante;
  const totalCentavos = restante;
  const parcelas = calcularParcelas({ modalidade: pedido.modalidade, datas: atendimentos.map((x) => x.data), totalCentavos, faturamento: ctx.faturamento || null }, cfg);
  return {
    versao: 3, modalidade: pedido.modalidade, segmento: pedido.segmento, frequencia: pedido.modalidade === 'pacote' ? pedido.frequencia : null,
    atendimentos, subtotalCentavos: subtotal, descontos, descontoCentavos, totalCentavos,
    cupom, condicaoAplicada: !!cond, parcelas,
  };
}
