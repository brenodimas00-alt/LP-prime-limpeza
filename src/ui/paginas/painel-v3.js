// Painel: o que o autoagendamento v3 acrescenta (spec-agendamento-v3, seção 4).
// - Solicitação v3: número, modalidade, cada diária/profissional com serviço, endereço, duração (sugerida x escolhida e a
//   justificativa), taxas, valores, origem, cupom, "Pacote com novo endereço · verificar" (item 46), faturamento ("A faturar").
// - Parcelas (item 39): cada uma com status próprio; a 2ª do pacote aparece "prevista" até a rotina gerar.
// - Motivo padronizado de recusa (rótulo + detalhe; o banco grava o código pro dashboard).
// - Cadastros sem solicitação (item 34), ficha do cliente (endereços, condições comerciais, faturamento: itens 9, 40 a 42).
// - Configurações: cupons (item 35), "Ver mais" e tipos de imóvel (itens 4 e 8), feriados e faixas de CEP (0.2 e 0.3).
// Escrita de regra comercial só prime_admin (o banco confere de novo).
import { anexar, el, trocar } from '../dom.js';
import { api } from '../../services/api.js';
import { executarAcao, mensagemErro } from '../acoes.js';
import { campo } from '../form.js';
import { selo } from '../comum.js';
import { formatarBRL } from '../../domain/dinheiro.js';
import { formatarData, formatarDataCurta, formatarInstante } from '../../domain/calendario.js';
import { calcularParcelas, totalAmbientes } from '../../domain/agendamento-v3.js';
import { CONFIG_PRECOS as CFG } from '../../config/precos.js';
import { SERVICOS_AGENDAMENTO as SERVICOS } from '../../config/agendamento.js';
import { T3 } from '../../config/agendamento-v3.js';
import { linhasDeValor } from './agendamento-v3/valores.js';
import { abrirPainel } from './agendamento-v3/ui.js';

const MODALIDADE = { avulsa: 'Diária avulsa', multi_profissional: 'Mais de uma profissional no mesmo dia', pacote: 'Pacote de diárias' };
const ORIGEM = { indicacao: 'Indicação', instagram: 'Instagram', google: 'Google', whatsapp: 'WhatsApp', outro: 'Outro' };
const PARCELA = { integral: 'Integral', metade_1: '1ª parte do pacote', metade_2: '2ª parte do pacote', faturamento: 'Faturamento empresarial', pacote: 'Pacote', diaria: 'Diária', hora_extra: 'Hora extra' };
const STATUS_PG = { pendente: 'Pendente', informado_pelo_cliente: 'Cliente avisou que pagou', confirmado: 'Pago', cancelado: 'Cancelada', estornado: 'Estornada' };
const qtdAmb = (n) => `${n} ${Number(n) === 1 ? 'ambiente' : 'ambientes'}`;
const numero = (n) => (n ? String(n).padStart(6, '0') : '');
const brl = (c) => formatarBRL(c);
const endLinha = (e) => (e ? `${e.logradouro || ''}, ${e.numero || ''}${e.complemento ? `, ${e.complemento}` : ''} - ${e.bairro || ''}, ${e.cidade || ''}/${e.uf || ''}` : '');

/** Rótulo curto de uma cobrança v3 (o v2 continua no recibo-ui). */
export function rotuloParcela(g) { return PARCELA[g.parcela] || g.parcela; }

/** Detalhe da solicitação v3 no cartão da aba Solicitações. */
export function detalhesSolicitacaoV3(p, c, atendimentos) {
  const cot = p.pacote;
  const flags = [];
  if (p.pacoteEnderecoNovo) flags.push(el('p', { class: 'alerta alerta-aviso', dataset: { flag: 'pacote-endereco-novo' }, text: 'Pacote com novo endereço · verificar' }));
  if (p.faturamento) flags.push(el('p', { class: 'alerta alerta-info', dataset: { flag: 'faturamento' }, text: 'Cliente com faturamento empresarial autorizado: confirmar gera a cobrança "A faturar", sem pagamento antecipado.' }));
  if (p.dadosInformados) flags.push(el('p', { class: 'alerta alerta-aviso', text: 'Enviada sem login por quem informou um CPF/CNPJ já cadastrado: conferir os dados informados antes de confirmar.' }));
  const linhasAt = atendimentos.map((a) => {
    const car = a.caracteristicas || {};
    const medida = a.servico === 'passadoria' ? `${car.pecas || '?'} peças` : [car.metragem ? `${car.metragem} m²` : '', a.servico === 'pre_pos_evento' ? (car.ambientesTotal ? qtdAmb(car.ambientesTotal) : '') : (car.ambientes ? qtdAmb(totalAmbientes(car.ambientes, CFG)) : '')].filter(Boolean).join(' · ');
    const dur = a.duracaoMinutos / 60;
    const rec = a.duracaoRecomendadaHoras;
    return el('li', { dataset: { atendimentoV3: a.id } }, [
      el('strong', { text: `${formatarDataCurta(a.data)} · ${a.horaInicio} · ${dur}h · ${SERVICOS[a.servico]?.nome || a.servico}` }),
      el('br'), el('span', { class: 'mudo', text: endLinha(a.endereco) + (a.endereco?.tipoImovel ? ` (${a.endereco.tipoImovel === 'Outro' ? a.endereco.tipoImovelOutro : a.endereco.tipoImovel})` : '') }),
      a.endereco?.pontoReferencia ? el('span', { class: 'mudo', text: ` · ref.: ${a.endereco.pontoReferencia}` }) : null,
      medida ? el('span', { class: 'mudo', text: ` · ${medida}` }) : null,
      car.animais?.tem ? el('span', { class: 'mudo', text: ` · animais: ${[car.animais.caes && `${car.animais.caes} cão(es)`, car.animais.gatos && `${car.animais.gatos} gato(s)`, car.animais.outros && `${car.animais.outros} ${car.animais.outrosQual || 'outro(s)'}`].filter(Boolean).join(', ')}` }) : null,
      car.mobiliado ? el('span', { class: 'mudo', text: ` · ${T3.mobiliado[car.mobiliado] || car.mobiliado}, condição ${car.condicao}` }) : null,
      car.momento ? el('span', { class: 'mudo', text: ` · ${T3.momentos[car.momento] || car.momento}${car.condicao ? `, ${car.condicao}` : ''}` }) : null,
      a.localRefeicao === false ? el('span', { class: 'mudo', text: ' · sem local para a refeição' }) : null,
      rec && rec !== dur ? el('p', { class: dur < rec ? 'alerta alerta-aviso' : 'mudo', style: 'margin:4px 0', text: `Sugerida: ${rec}h · escolhida: ${dur}h${a.justificativa ? ` · justificativa: ${a.justificativa}` : ''}` }) : null,
    ]);
  });
  const valores = cot.atendimentos ? linhasDeValor(cot) : [];
  return el('div', { class: 'detalhe-v3' }, [
    el('dl', { class: 'dados' }, [
      el('dt', { text: 'Nº da solicitação' }), el('dd', { dataset: { numero: String(p.numeroSolicitacao || '') }, text: numero(p.numeroSolicitacao) }),
      el('dt', { text: 'Modalidade' }), el('dd', { text: `${MODALIDADE[p.modalidade] || p.modalidade}${cot.frequencia ? ` · ${T3.frequencias[cot.frequencia] || cot.frequencia}` : ''} · ${atendimentos.length} ${p.modalidade === 'multi_profissional' ? 'profissionais' : atendimentos.length === 1 ? 'diária' : 'diárias'}` }),
      el('dt', { text: 'Contato' }), el('dd', { text: `${c.telefone || ''}${c.email ? ` · ${c.email}` : ''}` }),
      p.origemCliente ? el('dt', { text: 'Como conheceu' }) : null,
      p.origemCliente ? el('dd', { text: `${ORIGEM[p.origemCliente.origem]}${p.origemCliente.quemIndicou ? `: ${p.origemCliente.quemIndicou}` : ''}${p.origemCliente.outroQual ? `: ${p.origemCliente.outroQual}` : ''}` }) : null,
      p.cupomCodigo ? el('dt', { text: 'Cupom' }) : null, p.cupomCodigo ? el('dd', { text: p.cupomCodigo }) : null,
      p.dadosInformados ? el('dt', { text: 'Dados informados' }) : null,
      p.dadosInformados ? el('dd', { text: `${p.dadosInformados.nome || p.dadosInformados.responsavel} · ${p.dadosInformados.telefone} · ${p.dadosInformados.email}` }) : null,
      p.aceiteCondicoes ? el('dt', { text: 'Termos' }) : null, p.aceiteCondicoes ? el('dd', { text: `aceitos (versão ${p.aceiteCondicoes.versao})` }) : null,
    ]),
    ...flags,
    el('ul', { class: 'lista-v3' }, linhasAt),
    valores.length ? el('dl', { class: 'linhas-valor' }, valores.flatMap(([x, y]) => [el('dt', { text: x }), el('dd', { text: y })])) : null,
    el('p', { class: 'valor-total' }, [el('span', { text: 'Total: ' }), el('strong', { text: brl(cot.totalCentavos) })]),
  ]);
}

/** Parcelas do pedido v3: as geradas (status próprio) e a 2ª do pacote prevista pela agenda vigente. */
export function blocoParcelas(p, atendimentos, pagamentos) {
  if (p.pacote?.versao !== 3) return null;
  const ativos = atendimentos.filter((a) => a.status !== 'cancelado').map((a) => a.data);
  const linhas = pagamentos.filter((g) => g.status !== 'cancelado').map((g) => el('tr', { dataset: { parcela: g.parcela } }, [
    el('td', { text: rotuloParcela(g) }), el('td', { text: brl(g.valorCentavos) }),
    el('td', { text: g.parcela === 'faturamento' ? `${formatarData(g.venceEm)}` : `${formatarData(g.venceEm)} ${g.venceAs || ''}` }),
    el('td', {}, [g.parcela === 'faturamento' && g.status === 'pendente' ? selo('A faturar', 'aviso') : selo(STATUS_PG[g.status] || g.status, g.status === 'confirmado' ? 'ok' : '')]),
    el('td', { class: 'mudo', text: g.parcela === 'faturamento' ? `${g.formaFaturamento === 'transferencia' ? 'Transferência' : 'PIX'}${g.nfEmitir ? ' · NF: emitir' : ''}` : g.marcoData ? `marco ${formatarDataCurta(g.marcoData)}` : '' }),
  ]));
  if (p.modalidade === 'pacote' && !p.faturamento && !pagamentos.some((g) => g.parcela === 'metade_2' && g.status !== 'cancelado') && pagamentos.some((g) => g.parcela === 'metade_1')) {
    const prev = calcularParcelas({ modalidade: 'pacote', datas: ativos, totalCentavos: p.pacote.totalCentavos }, CFG)[1];
    if (prev) {
      linhas.push(el('tr', { dataset: { parcela: 'metade_2', prevista: '1' } }, [
        el('td', { text: rotuloParcela(prev) }), el('td', { text: brl(prev.valorCentavos) }), el('td', { text: `${formatarData(prev.venceEm)} ${prev.venceAs}` }),
        el('td', {}, [selo('Prevista', '')]), el('td', { class: 'mudo', text: `gerada e enviada em ${formatarDataCurta(prev.envioEm)} · marco ${formatarDataCurta(prev.marcoData)}` }),
      ]));
    }
  }
  if (!linhas.length) return null;
  return el('div', { class: 'parcelas-v3' }, [el('h3', { text: 'Parcelas' }), el('div', { class: 'tabela-rolagem' }, [el('table', { class: 'tabela' }, [
    el('thead', {}, [el('tr', {}, ['Parcela', 'Valor', 'Vencimento', 'Status', ''].map((t) => el('th', { text: t })))]), el('tbody', {}, linhas)])])]);
}

/** Motivo padronizado (rótulo da lista + detalhe que vai na mensagem). Devolve {raiz, valor(), erro()}. */
export function seletorMotivo(id, tipo, motivos) {
  const lista = motivos?.[tipo] || [];
  const sel = campo({ id: `${id}-motivo`, rotulo: 'Motivo', tipo: 'select', opcoes: [['', 'Escolha o motivo'], ...lista.map((m) => [m.rotulo, m.rotulo])] });
  const det = campo({ id: `${id}-detalhe`, rotulo: 'Detalhe (vai na mensagem pra cliente)', attrs: { maxlength: 240 } });
  return {
    raiz: el('div', { class: 'motivo-padrao' }, [sel.raiz, det.raiz]),
    valor() {
      const r = sel.input.value; const d = det.input.value.trim();
      if (!r) { sel.erro('Escolha o motivo'); return null; }
      if (r === 'Outro' && d.length < 3) { det.erro('Descreva o motivo'); return null; }
      return d ? `${r}: ${d}` : r;
    },
  };
}

function acao(texto, fn, depois, classe = 'btn-secundario') {
  const b = el('button', { class: `btn ${classe} btn-p`, type: 'button', text: texto });
  b.addEventListener('click', () => executarAcao(b, fn, { aoSucesso: depois }));
  return b;
}
const erro = (msg) => Object.assign(new Error(msg), { codigo: 'DADOS_INVALIDOS' });

/** Item 34: cadastros que nunca enviaram solicitação (prospecção), separados de quem já solicitou. */
export async function abaCadastrosSemSolicitacao() {
  const status = new URLSearchParams(location.search).get('status') || '';
  const r = await api.listarCadastrosSemSolicitacao(status ? { status } : {});
  const ST = { novo: 'Novo', contatado: 'Contatado', sem_interesse: 'Sem interesse', convertido: 'Convertido' };
  return el('div', { class: 'reveal', dataset: { aba: 'prospeccao' } }, [
    el('p', { class: 'mudo', text: 'Quem concluiu o cadastro no agendamento e não enviou nenhuma solicitação. Base legal: diligências pré-contratuais; mensagem de novidades só com o consentimento da pessoa.' }),
    el('p', {}, [`${r.total} cadastro(s)${status ? ` com a situação "${ST[status]}"` : ''}.`]),
    el('div', { class: 'tabela-rolagem' }, [el('table', { class: 'tabela', dataset: { tabela: 'prospeccao' } }, [
      el('thead', {}, [el('tr', {}, ['Nome', 'WhatsApp', 'Cadastro', 'Situação'].map((t) => el('th', { text: t })))]),
      el('tbody', {}, r.itens.map((c) => {
        const sel = el('select', { 'aria-label': `Situação de ${c.nome}` }, Object.entries(ST).map(([k, v]) => el('option', { value: k, text: v, selected: k === c.status })));
        sel.addEventListener('change', async () => { try { await api.definirStatusProspeccao(c.id, sel.value); } catch (e) { alert(mensagemErro(e)); } });
        return el('tr', { dataset: { cadastro: c.id } }, [
          el('td', {}, [el('strong', { text: c.nome }), el('br'), el('span', { class: 'mudo', text: `${c.tipo === 'empresa' ? 'Empresa' : 'Residencial'}${c.email ? ` · ${c.email}` : ''}` })]),
          el('td', { text: c.telefone || '' }), el('td', { text: formatarInstante(c.criadoEm) }), el('td', {}, [sel]),
        ]);
      })),
    ])]),
  ]);
}

/** Ficha do cliente (v3): endereços, condições comerciais e faturamento empresarial. */
export async function abrirFichaCliente(clienteId, { admin }) {
  const corpo = el('div', { class: 'ficha-v3' }, [el('p', { class: 'mudo', text: 'Carregando…' })]);
  abrirPainel('Ficha do cliente', [corpo]);
  const desenhar = async () => {
    let f;
    try { f = await api.fichaClienteV3(clienteId); } catch (e) { trocar(corpo, el('p', { class: 'alerta alerta-erro', text: mensagemErro(e) })); return; }
    const ends = el('ul', { class: 'lista-enderecos' }, f.enderecos.map((e) => el('li', { dataset: { endereco: e.id } }, [
      el('strong', { text: e.apelido || endLinha(e) }), e.apelido ? el('span', { class: 'mudo', text: ` · ${endLinha(e)}` }) : null, ' ',
      e.principal ? selo('principal', 'ok') : null, e.usoUnico ? selo('uso único', '') : e.ativo ? selo('ativo', 'ok') : selo(e.inativadoMotivo === 'substituido' ? 'substituído' : 'inativo', 'aviso'),
      e.ativo ? acao('Inativar', () => api.inativarEndereco(e.id), desenhar) : null,
    ])));
    trocar(corpo, el('h3', { text: f.nome }), el('h4', { text: 'Endereços' }), f.enderecos.length ? ends : el('p', { class: 'mudo', text: 'Nenhum endereço.' }),
      blocoCondicao(f, admin, desenhar), f.tipo === 'empresa' ? blocoFaturamento(f, admin, desenhar) : null);
  };
  await desenhar();
}

function blocoCondicao(f, admin, depois) {
  const c0 = f.condicao;
  // o banco devolve snake_case (to_jsonb); o mock, camelCase
  const c = c0 && { ...c0, valor: Number(c0.valor), quantidade_minima: c0.quantidade_minima ?? c0.quantidadeMinima, valido_ate: c0.valido_ate ?? c0.validoAte, consumida_em: c0.consumida_em ?? c0.consumidaEm, observacao_interna: c0.observacao_interna ?? c0.observacaoInterna };
  const atual = c ? `${c.tipo === 'percentual' ? `${c.valor}%` : brl(c.valor)} · ${c.modalidades?.length ? c.modalidades.map((m) => MODALIDADE[m]).join(', ') : 'todas as modalidades'}${c.quantidade_minima ? ` · a partir de ${c.quantidade_minima}` : ''} · ${{ uso_unico: 'uso único', recorrente: 'recorrente', periodo: `até ${c.valido_ate ? formatarData(c.valido_ate) : ''}` }[c.validade]}${c.acumula ? ' · acumula' : ' · não acumula'}${c.consumida_em ? ' · já usada' : ''}`
    : 'Desconto especial: Nenhum';
  const bloco = el('div', { class: 'bloco-condicao', dataset: { bloco: 'condicao' } }, [el('h4', { text: 'Condições comerciais' }), el('p', { text: atual }), c?.observacao_interna ? el('p', { class: 'mudo', text: c.observacao_interna }) : null]);
  if (!admin) { anexar(bloco, el('p', { class: 'mudo', text: 'Só a administração da Prime altera.' })); return bloco; }
  const tipo = campo({ id: 'cond-tipo', rotulo: 'Tipo do desconto', tipo: 'select', opcoes: [['valor', 'Valor fixo em R$'], ['percentual', 'Percentual (%)']] });
  const valor = campo({ id: 'cond-valor', rotulo: 'Valor do desconto (R$ ou %)', tipo: 'number', attrs: { min: 1, step: '0.01' } });
  const mods = el('fieldset', { class: 'grupo' }, [el('legend', { text: 'Onde pode ser aplicado' }), ...Object.entries(MODALIDADE).map(([k, v]) => el('label', { class: 'opcao-simples' }, [el('input', { type: 'checkbox', value: k }), ` ${v}`]))]);
  const qtd = campo({ id: 'cond-qtd', rotulo: 'Quantidade mínima de atendimentos/diárias', tipo: 'number', attrs: { min: 1 } });
  const val = campo({ id: 'cond-validade', rotulo: 'Validade da condição', tipo: 'select', opcoes: [['uso_unico', 'Uso único (próxima contratação que atender)'], ['recorrente', 'Recorrente'], ['periodo', 'Por período']] });
  const ate = campo({ id: 'cond-ate', rotulo: 'Até (por período)', tipo: 'date' });
  const acu = campo({ id: 'cond-acumula', rotulo: 'Acumula com outros descontos?', tipo: 'select', opcoes: [['nao', 'Não'], ['sim', 'Sim']] });
  const obs = campo({ id: 'cond-obs', rotulo: 'Observação interna', tipo: 'textarea', attrs: { maxlength: 500, rows: 2 } });
  const caixa = el('details', {}, [el('summary', { text: c ? 'Trocar a condição' : 'Cadastrar condição', style: 'cursor:pointer' }), tipo.raiz, valor.raiz, mods, qtd.raiz, val.raiz, ate.raiz, acu.raiz, obs.raiz,
    acao('Salvar condição', () => {
      const v = Number(valor.input.value);
      if (!(v > 0)) throw erro('Informe o valor');
      return api.salvarCondicaoComercial(f.id, { tipo: tipo.input.value, valor: tipo.input.value === 'valor' ? Math.round(v * 100) : Math.round(v), modalidades: [...mods.querySelectorAll('input:checked')].map((i) => i.value),
        quantidadeMinima: qtd.input.value || null, validade: val.input.value, validoAte: ate.input.value || null, acumula: acu.input.value === 'sim', observacao: obs.input.value });
    }, depois, 'btn-primario')]);
  anexar(bloco, caixa, c ? acao('Remover (Nenhum)', () => api.salvarCondicaoComercial(f.id, null), depois, 'btn-perigo') : null);
  return bloco;
}

function blocoFaturamento(f, admin, depois) {
  const f0 = f.faturamento;
  const fat = f0 && { ...f0, prazo_dias: f0.prazo_dias ?? f0.prazoDias };
  const bloco = el('div', { class: 'bloco-faturamento', dataset: { bloco: 'faturamento' } }, [el('h4', { text: 'Faturamento empresarial' }),
    el('p', { text: fat?.autorizado ? `Autorizado · ${fat.forma === 'transferencia' ? 'Transferência' : 'PIX'} · prazo ${fat.prazo_dias} dia(s) · NF: ${fat.nf ? 'Sim' : 'Não'}` : 'Não autorizado (padrão: pagamento antecipado).' })]);
  if (!admin) return bloco;
  const aut = campo({ id: 'fat-aut', rotulo: 'Faturamento empresarial', tipo: 'select', valor: fat?.autorizado ? 'sim' : 'nao', opcoes: [['nao', 'Não autorizado'], ['sim', 'Autorizado']] });
  const forma = campo({ id: 'fat-forma', rotulo: 'Forma de faturamento', tipo: 'select', valor: fat?.forma || 'pix', opcoes: [['pix', 'PIX'], ['transferencia', 'Transferência']] });
  const prazo = campo({ id: 'fat-prazo', rotulo: 'Prazo (dias depois da última diária)', tipo: 'number', valor: fat?.prazo_dias ?? 0, attrs: { min: 0, max: 120 } });
  const nf = campo({ id: 'fat-nf', rotulo: 'NF', tipo: 'select', valor: fat?.nf === false ? 'nao' : 'sim', opcoes: [['sim', 'Sim'], ['nao', 'Não']] });
  anexar(bloco, el('details', {}, [el('summary', { text: 'Alterar', style: 'cursor:pointer' }), aut.raiz, forma.raiz, prazo.raiz, nf.raiz,
    acao('Salvar faturamento', () => api.salvarFaturamento(f.id, { autorizado: aut.input.value === 'sim', forma: forma.input.value, prazoDias: Number(prazo.input.value) || 0, nf: nf.input.value === 'sim' }), depois, 'btn-primario')]));
  return bloco;
}

/** Configurações do agendamento v3: cupons, conteúdo ("Ver mais" e tipos de imóvel), feriados e faixas de CEP. */
export async function blocosConfigV3(admin, recarregar) {
  const [cupons, conteudo, ff] = await Promise.all([api.listarCupons().catch(() => []), api.conteudoAgendamento(), api.listarFeriadosEFaixas().catch(() => ({ feriados: [], faixasCep: [] }))]);
  const bloco = el('div', { class: 'config-v3' });
  // cupons
  const lc = el('div', { class: 'tabela-rolagem' }, [el('table', { class: 'tabela', dataset: { tabela: 'cupons' } }, [
    el('thead', {}, [el('tr', {}, ['Código', 'Desconto', 'Regras', 'Usos'].map((t) => el('th', { text: t })))]),
    el('tbody', {}, cupons.map((c) => el('tr', { dataset: { cupom: c.codigo } }, [el('td', { text: `${c.codigo}${c.ativo ? '' : ' (inativo)'}` }),
      el('td', { text: c.tipo === 'percentual' ? `${c.valor}%` : brl(Number(c.valor)) }),
      el('td', { class: 'mudo', text: [c.primeira_contratacao || c.primeiraContratacao ? '1ª contratação' : '', (c.valido_ate || c.validoAte) ? `até ${formatarData(c.valido_ate || c.validoAte)}` : '', (c.limite_de_uso || c.limiteDeUso) ? `limite ${c.limite_de_uso || c.limiteDeUso}` : '', c.acumula ? 'acumula' : 'não acumula'].filter(Boolean).join(' · ') }),
      el('td', { text: String(c.usos || 0) })]))),
  ])]);
  anexar(bloco, el('h3', { text: 'Cupons' }), lc);
  if (admin) {
    const cod = campo({ id: 'cupom-codigo', rotulo: 'Código', attrs: { maxlength: 30 } });
    const tp = campo({ id: 'cupom-tipo', rotulo: 'Tipo', tipo: 'select', opcoes: [['valor', 'Valor fixo em R$'], ['percentual', 'Percentual (%)']] });
    const vl = campo({ id: 'cupom-valor', rotulo: 'Valor (R$ ou %)', tipo: 'number', attrs: { min: 1, step: '0.01' } });
    const pc = campo({ id: 'cupom-primeira', rotulo: 'Primeira contratação', tipo: 'select', opcoes: [['nao', 'Não'], ['sim', 'Sim']] });
    const va = campo({ id: 'cupom-ate', rotulo: 'Válido até', tipo: 'date' });
    const li = campo({ id: 'cupom-limite', rotulo: 'Limite de usos', tipo: 'number', attrs: { min: 1 } });
    anexar(bloco, el('details', {}, [el('summary', { text: 'Criar ou alterar cupom', style: 'cursor:pointer' }), cod.raiz, tp.raiz, vl.raiz, pc.raiz, va.raiz, li.raiz,
      acao('Salvar cupom', () => {
        const v = Number(vl.input.value);
        if (!(v > 0)) throw erro('Informe o valor');
        return api.salvarCupom({ codigo: cod.input.value, tipo: tp.input.value, valor: tp.input.value === 'valor' ? Math.round(v * 100) : Math.round(v), primeiraContratacao: pc.input.value === 'sim', validoAte: va.input.value || null, limiteDeUso: li.input.value || null });
      }, recarregar, 'btn-primario')]));
  }
  // conteúdo do agendamento
  const area = el('textarea', { id: 'conteudo-agendamento', rows: 14, class: 'texto-json', 'aria-label': 'Tipos de imóvel e "Ver mais" de cada serviço', readonly: !admin }, []);
  area.value = JSON.stringify(conteudo, null, 2);
  anexar(bloco, el('h3', { text: '"Ver mais" e tipos de imóvel' }), el('p', { class: 'mudo', text: 'Cada serviço tem o próprio "Ver mais" (o que não está incluído e as observações) e cada segmento a lista de tipos de imóvel ("Outro" sempre no fim).' }), area,
    admin ? acao('Salvar conteúdo', () => { let j; try { j = JSON.parse(area.value); } catch { throw erro('Texto inválido: confira vírgulas e aspas'); } return api.salvarConteudoAgendamento(j); }, recarregar, 'btn-primario') : null);
  // feriados e faixas de CEP
  anexar(bloco, el('h3', { text: 'Feriados' }), el('p', { class: 'mudo', text: 'Feriado não bloqueia a agenda: identifica e cobra a taxa (R$ 20). Marque "bloqueia" só para dia sem atendimento.' }),
    el('ul', { class: 'lista-feriados' }, ff.feriados.map((x) => el('li', {}, [`${formatarData(x.data)} ${x.descricao || ''}${x.bloqueia ? ' (bloqueia)' : ''} `, admin ? acao('Remover', () => api.removerFeriado(x.data), recarregar) : null]))));
  if (admin) {
    const fd = campo({ id: 'feriado-data', rotulo: 'Data', tipo: 'date' });
    const fn = campo({ id: 'feriado-desc', rotulo: 'Descrição', attrs: { maxlength: 80 } });
    anexar(bloco, el('details', {}, [el('summary', { text: 'Incluir feriado', style: 'cursor:pointer' }), fd.raiz, fn.raiz, acao('Salvar feriado', () => { if (!fd.input.value) throw erro('Escolha a data'); return api.salvarFeriado(fd.input.value, fn.input.value, false); }, recarregar, 'btn-primario')]));
  }
  anexar(bloco, el('h3', { text: 'Faixas de CEP com taxa própria' }), el('p', { class: 'mudo', text: 'A faixa vence a cidade (ex.: Vila da Serra, dentro de Nova Lima, R$ 10).' }),
    ff.faixasCep.length ? el('ul', {}, ff.faixasCep.map((x) => el('li', { text: `${x.nome}: ${x.cep_inicio} a ${x.cep_fim} · ${brl(Number(x.taxa_centavos))}${x.ativa ? '' : ' (inativa)'}` }))) : el('p', { class: 'mudo', text: 'Nenhuma faixa (Vila da Serra cai em Nova Lima).' }));
  if (admin) {
    const nm = campo({ id: 'faixa-nome', rotulo: 'Nome', valor: 'Vila da Serra', attrs: { maxlength: 60 } });
    const ci = campo({ id: 'faixa-ini', rotulo: 'CEP inicial', attrs: { inputmode: 'numeric', maxlength: 9 } });
    const cf = campo({ id: 'faixa-fim', rotulo: 'CEP final', attrs: { inputmode: 'numeric', maxlength: 9 } });
    const tx = campo({ id: 'faixa-taxa', rotulo: 'Taxa (R$)', tipo: 'number', valor: 10, attrs: { min: 0, step: '0.01' } });
    anexar(bloco, el('details', {}, [el('summary', { text: 'Incluir faixa de CEP', style: 'cursor:pointer' }), nm.raiz, ci.raiz, cf.raiz, tx.raiz,
      acao('Salvar faixa', () => api.salvarFaixaCep({ nome: nm.input.value, cepInicio: ci.input.value, cepFim: cf.input.value, taxaCentavos: Math.round(Number(tx.input.value) * 100) }), recarregar, 'btn-primario')]));
  }
  return bloco;
}
