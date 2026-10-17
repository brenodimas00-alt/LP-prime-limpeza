// Etapa 4 (itens 10 a 20). "Conte um pouco sobre o local": campos e lógica por serviço (item 10), seleções rápidas.
// - Limpezas: metragem obrigatória (sem "Não sei a metragem", item 11), aviso discreto acima de 120 m² (item 12, uma vez),
//   ambientes com − / + (item 13); mudança: mobiliado e condição; eventos: antes/após, metragem do espaço, ambientes
//   utilizados e, após, a condição. Passadoria: só peças e tipos (calculadora própria).
// - Animais (item 15) e local para refeição (item 16) em Sim/Não; "Precisa de uma limpeza mais detalhada?" perto da
//   recomendação, só nas limpezas (item 17).
// - Recomendação na mesma tela, logo abaixo, na ordem do item 18; escolher menos horas abre o alerta do item 19 na hora,
//   com o campo opcional e "Estou ciente e quero continuar"; mais horas não alerta. A justificativa fica só na solicitação.
import { el, trocar, svg, cardsEscolha, simNao, contador, moldura } from './ui.js';
import { campo } from '../../form.js';
import { ICONE_LAMPADA } from '../../icones.js';
import { CONFIG_PRECOS as CFG } from '../../../config/precos.js';
import { T3 } from '../../../config/agendamento-v3.js';
import { recomendarDuracao, validarCaracteristicas } from '../../../domain/agendamento-v3.js';
import { estado, salvar, passadoria } from './estado.js';

const P = CFG.PRECOS;
const V3 = P.v3;
const ICONE_ALERTA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 2 21h20L12 3z"/><path d="M12 10v5M12 18h.01"/></svg>';

/** Características iniciais do serviço (o que muda de serviço zera, ctx.servicoMudou). */
export function caracteristicasPadrao(servico) {
  const animais = { tem: null, caes: 0, gatos: 0, outros: 0, outrosQual: '' };
  if (servico === 'passadoria') return { pecas: 0, tipoPecas: '', animais };
  if (servico === 'pre_pos_evento') return { metragem: '', momento: '', ambientesTotal: 0, condicao: '', animais };
  const c = { metragem: '', ambientes: { quartos: 0, banheiros: 0, salas: 0, cozinhas: 0, areaExterna: 0 }, animais };
  if (servico === 'pre_pos_mudanca') Object.assign(c, { mobiliado: '', condicao: '' });
  return c;
}

/** As características no formato do servidor (números, animais só com "tem"). */
export function caracteristicasParaEnvio(servico, c) {
  if (!c) return undefined;
  const a = c.animais || {};
  const animais = a.tem === true ? { tem: true, caes: a.caes || 0, gatos: a.gatos || 0, outros: a.outros || 0, ...(a.outros > 0 ? { outrosQual: a.outrosQual || '' } : {}) } : { tem: a.tem === false ? false : null };
  const n = (v) => (v === '' || v === null || v === undefined ? undefined : Number(v));
  if (servico === 'passadoria') return { pecas: c.pecas, tipoPecas: c.tipoPecas, animais };
  if (servico === 'pre_pos_evento') return { metragem: n(c.metragem), momento: c.momento, ambientesTotal: c.ambientesTotal, ...(c.momento === 'depois' ? { condicao: c.condicao } : {}), animais };
  const r = { metragem: n(c.metragem), ambientes: { ...c.ambientes }, animais };
  if (servico === 'pre_pos_mudanca') Object.assign(r, { mobiliado: c.mobiliado, condicao: c.condicao });
  return r;
}

export function recomendacao() {
  const r = estado();
  return recomendarDuracao(r.servico, caracteristicasParaEnvio(r.servico, r.caracteristicas), r.segmento, CFG);
}

/** O que falta na tela (guarda de navegação e Continuar). */
export function faltaLocal() {
  const r = estado();
  const e = validarCaracteristicas(r.servico, caracteristicasParaEnvio(r.servico, r.caracteristicas), CFG);
  if (e.length) return e[0];
  if (typeof r.localRefeicao !== 'boolean') return 'Responda sobre o local para a refeição';
  if (!P.duracoes[r.duracaoHoras]) return 'Escolha a duração da diária';
  const lim2 = P.duracoes[2].metragemMaxima;
  if (Number(r.duracaoHoras) === 2 && !passadoria() && Number(r.caracteristicas.metragem) > lim2) return `A diária de 2 horas é só para locais até ${lim2} m²`;
  const rec = recomendacao();
  if (rec.horas && r.duracaoHoras < rec.horas && !r.cienteMenor) return 'Confirme que está ciente da duração menor que a sugerida';
  return null;
}

export function passoLocal(ctx) {
  const r = estado();
  if (!r.caracteristicas || r.caracteristicas._servico !== r.servico) { r.caracteristicas = { ...caracteristicasPadrao(r.servico), _servico: r.servico }; salvar(); }
  const c = r.caracteristicas;
  const blocos = [];
  const recBloco = el('div', { class: 'sugestao-duracao', 'aria-live': 'polite', id: 'sugestao' });
  const duracoes = el('div', { id: 'duracoes' });
  const alerta = el('div', { class: 'alerta-duracao', id: 'alerta-duracao' });
  const aviso120 = el('p', { class: 'nota-discreta aviso-120', id: 'aviso-120', hidden: true, text: T3.aviso120 });
  const mudou = () => { salvar(); desenharRecomendacao(); };

  // ---------- campos por serviço ----------
  if (passadoria()) {
    blocos.push(el('p', { class: 'pergunta', text: T3.pecas }),
      contador({ id: 'pecas', rotulo: 'Peças', valor: c.pecas, min: 0, max: V3.passadoria.maximoPecas, passo: 5, aoMudar: (v) => { c.pecas = v; mudou(); } }));
    blocos.push(cardsEscolha({
      nome: 'tipoPecas', legenda: T3.tiposPecas, valor: c.tipoPecas, colunas: 2,
      opcoes: V3.passadoria.tipos.map((k) => ({ valor: k, titulo: T3.opcoesPecas[k][0], sub: T3.opcoesPecas[k][1] })),
      aoMudar: (v) => { c.tipoPecas = v; mudou(); },
    }).raiz);
  } else {
    if (r.servico === 'pre_pos_evento') {
      blocos.push(cardsEscolha({
        nome: 'momento', legenda: T3.momentoEvento, valor: c.momento, colunas: 2,
        opcoes: ['antes', 'depois'].map((k) => ({ valor: k, titulo: T3.momentos[k] })),
        aoMudar: (v) => { c.momento = v; if (v === 'antes') c.condicao = ''; mudou(); desenharCondicaoEvento(); },
      }).raiz);
    }
    const m = campo({
      id: 'metragem', rotulo: r.servico === 'pre_pos_evento' ? T3.metragemEspaco : T3.metragem, ajuda: T3.metragemAjuda, tipo: 'number', valor: c.metragem,
      attrs: { min: P.metragem.minimo, max: P.metragem.maximo, step: 1, inputmode: 'numeric' },
    });
    m.input.addEventListener('input', () => { c.metragem = m.input.value; aviso120.hidden = !(Number(c.metragem) > V3.avisoMetragemAcima); mudou(); });
    aviso120.hidden = !(Number(c.metragem) > V3.avisoMetragemAcima);
    blocos.push(m.raiz, aviso120);
    if (r.servico === 'pre_pos_evento') {
      blocos.push(contador({ id: 'ambientesTotal', rotulo: T3.ambientesEvento, valor: c.ambientesTotal, min: 0, max: V3.ambientes.maximoTotalEventos, aoMudar: (v) => { c.ambientesTotal = v; mudou(); } }));
    } else {
      blocos.push(el('p', { class: 'pergunta', text: 'Quantidade de ambientes' }),
        el('div', { class: 'contadores' }, V3.ambientes.tipos.map((k) => contador({
          id: `ambiente-${k}`, rotulo: T3.ambientes[k], valor: c.ambientes[k] || 0, max: V3.ambientes.maximoPorTipo,
          aoMudar: (v) => { c.ambientes[k] = v; mudou(); },
        }))));
    }
    if (r.servico === 'pre_pos_mudanca') {
      blocos.push(cardsEscolha({
        nome: 'mobiliado', legenda: T3.imovelEsta, valor: c.mobiliado, colunas: 3,
        opcoes: Object.entries(T3.mobiliado).map(([k, v]) => ({ valor: k, titulo: v })),
        aoMudar: (v) => { c.mobiliado = v; mudou(); },
      }).raiz);
      blocos.push(cardsEscolha({
        nome: 'condicao', legenda: T3.condicaoMudanca, valor: c.condicao, colunas: 3,
        opcoes: Object.entries(T3.opcoesCondicaoMudanca).map(([k, [t, s]]) => ({ valor: k, titulo: t, sub: s })),
        aoMudar: (v) => { c.condicao = v; mudou(); },
      }).raiz);
    }
  }
  const condEvento = el('div', { class: 'condicao-evento' });
  const desenharCondicaoEvento = () => {
    if (r.servico !== 'pre_pos_evento' || c.momento !== 'depois') { trocar(condEvento); return; }
    trocar(condEvento, cardsEscolha({
      nome: 'condicao', legenda: T3.condicaoEvento, valor: c.condicao, colunas: 3,
      opcoes: Object.entries(T3.opcoesCondicaoEvento).map(([k, [t, s]]) => ({ valor: k, titulo: t, sub: s })),
      aoMudar: (v) => { c.condicao = v; mudou(); },
    }).raiz);
  };
  if (r.servico === 'pre_pos_evento') { blocos.push(condEvento); desenharCondicaoEvento(); }

  // ---------- animais (item 15) ----------
  const qtdAnimais = el('div', { class: 'animais-quantidades' });
  const desenharAnimais = () => {
    if (c.animais.tem !== true) { trocar(qtdAnimais); return; }
    const qual = el('div', { class: 'animal-qual' });
    const desenharQual = () => {
      if (!(c.animais.outros > 0)) { trocar(qual); return; }
      const q = campo({ id: 'outrosQual', rotulo: T3.animalQual, valor: c.animais.outrosQual, attrs: { maxlength: 60 } });
      q.input.addEventListener('input', () => { c.animais.outrosQual = q.input.value; salvar(); });
      trocar(qual, q.raiz);
    };
    trocar(qtdAnimais, el('div', { class: 'contadores' }, ['caes', 'gatos', 'outros'].map((k) => contador({
      id: `animal-${k}`, rotulo: T3.animaisTipos[k], valor: c.animais[k] || 0, max: 20,
      aoMudar: (v) => { c.animais[k] = v; salvar(); if (k === 'outros') desenharQual(); },
    }))), qual);
    desenharQual();
  };
  const animais = simNao({ nome: 'animais', legenda: T3.animais, valor: c.animais.tem, aoMudar: (v) => { c.animais.tem = v; salvar(); desenharAnimais(); } });
  desenharAnimais();

  // ---------- refeição (item 16) ----------
  const refeicao = cardsEscolha({
    nome: 'localRefeicao', legenda: T3.refeicao, colunas: 2, valor: r.localRefeicao === null ? '' : r.localRefeicao ? 'sim' : 'nao',
    opcoes: [{ valor: 'sim', titulo: 'Sim' }, { valor: 'nao', titulo: 'Não', sub: T3.refeicaoNaoSub }],
    aoMudar: (v) => { r.localRefeicao = v === 'sim'; salvar(); },
  });

  // ---------- recomendação (itens 17 a 19) ----------
  const detalhada = passadoria() ? null : el('aside', { class: 'aviso-discreto', 'aria-label': T3.detalhadaTitulo }, [
    el('span', { class: 'aviso-icone' }, [svg(ICONE_LAMPADA)]), el('div', {}, [el('strong', { text: T3.detalhadaTitulo }), el('p', { text: T3.detalhada })]),
  ]);
  function desenharRecomendacao() {
    const rec = recomendacao();
    if (rec.horas && !r.duracaoManual) { r.duracaoHoras = rec.horas; r.cienteMenor = false; }
    const lim2 = P.duracoes[2].metragemMaxima;
    const doisBloqueado = !passadoria() && Number(c.metragem) > lim2;
    if (doisBloqueado && Number(r.duracaoHoras) === 2) { r.duracaoHoras = rec.horas || 0; r.duracaoManual = false; }
    salvar();
    if (rec.horas) {
      trocar(recBloco, el('div', { class: 'cartao-sugestao', dataset: { sugestao: rec.horas } }, [
        el('p', { class: 'sugestao-texto', text: passadoria() ? T3.sugestaoPassadoria(rec.horas) : T3.sugestao(rec.horas) }),
        el('p', { class: 'sugestao-aviso', text: T3.sugestaoAviso }),
        passadoria() ? el('p', { class: 'sugestao-aviso', text: T3.passadoriaEstimativa }) : null,
      ]));
    } else if (rec.excedente) {
      trocar(recBloco, el('div', { class: 'alerta alerta-info', dataset: { sugestao: rec.orientacao } }, [
        el('p', { text: rec.orientacao === 'dividir_diarias' ? T3.passadoriaDividir : T3.maisProfissionais }),
        passadoria() ? el('p', { class: 'sugestao-aviso', text: T3.passadoriaEstimativa }) : null,
      ]));
    } else trocar(recBloco);
    const g = cardsEscolha({
      nome: 'duracaoHoras', legenda: T3.duracao, valor: String(r.duracaoHoras || ''), colunas: 4,
      opcoes: Object.keys(P.duracoes).map((h) => ({
        valor: h, titulo: `${h} horas`, selo: rec.horas === Number(h) ? 'sugerida' : null,
        sub: Number(h) === 2 && !passadoria() ? `até ${lim2} m²` : null, desabilitado: Number(h) === 2 && doisBloqueado,
      })),
      aoMudar: (v) => { r.duracaoHoras = Number(v); r.duracaoManual = true; r.cienteMenor = false; salvar(); desenharAlerta(); },
    });
    trocar(duracoes, g.raiz);
    desenharAlerta();
  }
  function desenharAlerta() {
    const rec = recomendacao();
    if (!(rec.horas && r.duracaoHoras && r.duracaoHoras < rec.horas)) { trocar(alerta); return; }
    if (r.cienteMenor) {
      trocar(alerta, el('p', { class: 'alerta alerta-ok', dataset: { ciente: '1' }, text: `Duração escolhida: ${r.duracaoHoras} horas.${r.justificativa ? ` ${r.justificativa}` : ''}` }),
        el('button', { type: 'button', class: 'btn-link', text: 'Rever a observação', on: { click: () => { r.cienteMenor = false; salvar(); desenharAlerta(); } } }));
      return;
    }
    const j = campo({ id: 'justificativa', rotulo: T3.alertaCampo, tipo: 'textarea', valor: r.justificativa, attrs: { maxlength: 500, rows: 3 } });
    j.input.addEventListener('input', () => { r.justificativa = j.input.value; salvar(); });
    const ok = el('button', { type: 'button', class: 'btn btn-primary', dataset: { acao: 'ciente' }, text: T3.ciente });
    ok.addEventListener('click', () => { r.cienteMenor = true; salvar(); desenharAlerta(); document.querySelector('form.passo-fluxo button[type=submit]')?.focus(); });
    trocar(alerta, el('div', { class: 'alerta alerta-aviso', role: 'alertdialog', 'aria-labelledby': 'alerta-titulo', dataset: { alerta: 'duracao-menor' } }, [
      el('p', { class: 'alerta-titulo', id: 'alerta-titulo' }, [svg(ICONE_ALERTA), ` ${T3.atencao}`]),
      el('p', { text: T3.alertaMenor }), el('p', { text: T3.alertaPergunta }), el('p', { class: 'mudo', text: T3.alertaEx }),
      j.raiz, el('p', { class: 'nota-discreta', text: T3.alertaReferencia }), ok,
    ]));
  }
  desenharRecomendacao();

  return moldura({
    passo: 'local', titulo: T3.tituloLocal, aoVoltar: ctx.voltar, aoAvancar: ctx.avancar,
    corpo: [el('div', { class: 'bloco-medida' }, blocos), animais.raiz, qtdAnimais, refeicao.raiz, detalhada, recBloco, duracoes, alerta],
    validar: () => {
      const f = faltaLocal();
      if (!f) return true;
      if (/refeição/.test(f)) { refeicao.erro(f); return false; }
      if (/animais|animal/.test(f) && c.animais.tem === null) { animais.erro(f); return false; }
      if (/ciente/.test(f)) { alerta.querySelector('button')?.focus(); return f; }
      if (/metragem|Metragem/.test(f)) { document.getElementById('metragem')?.focus(); return f; }
      return f;
    },
  });
}
