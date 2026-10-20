// Etapa 5, datas e horário (itens 23 a 28), na mesma tela.
// - Avulsa: uma data. Mais de uma profissional: uma data + quantas profissionais. Pacote: frequência (semanal, quinzenal,
//   mensal ou datas avulsas), quantidade e calendário SINCRONIZADOS (item 26): o número é sempre o de datas marcadas; com
//   recorrência, a 1ª data gera as ocorrências, "+" acrescenta a próxima e "−" tira a última; marcar/desmarcar no
//   calendário ou na lixeira do chip também muda a quantidade. Trocar a frequência com datas pede "Alterar frequência?" e zera.
// - Domingo bloqueado; feriado e sábado marcados no calendário e cobrados (+R$ 20); todas as datas ficam destacadas.
// - "HORÁRIO DE INÍCIO" com o seletor Hora | Minutos; no pacote, "Deseja manter este horário nas próximas diárias?" na
//   mesma tela (Não abre um seletor por data); no multi, "Deseja utilizar este mesmo horário para as demais profissionais?".
import { iconeHTML } from '../../ds/icones.js';
import { el, trocar, svg, cardsEscolha, contador, moldura, confirmar } from './ui.js';
import { criarCalendario } from '../../calendario.js';
import { seletorHorario } from './seletor-horario.js';
import { CONFIG_PRECOS as CFG } from '../../../config/precos.js';
import { T3 } from '../../../config/agendamento-v3.js';
import { motivoDataIndisponivel, regrasAgenda } from '../../../domain/agenda.js';
import { gerarOcorrencias, somarDias, formatarDataCurta, formatarData, proximoPermitido } from '../../../domain/calendario.js';
import { horariosPermitidos, ehFeriado, ehSabado } from '../../../domain/agendamento-v3.js';
import { estado, salvar } from './estado.js';

const ICONE_LIXEIRA = iconeHTML('lixeira');
const LIMITE = CFG.PRECOS.v3.limites;

/** "24/10" ou, se houver mudança de ano entre as datas, "24/10/2026" (item 48). */
export function rotuloData(d, todas = []) {
  const anos = new Set(todas.map((x) => x.slice(0, 4)));
  return anos.size > 1 ? formatarData(d) : `${d.slice(8, 10)}/${d.slice(5, 7)}`;
}

/** Ocorrências de uma recorrência a partir da 1ª data, até a quantidade (pula dia bloqueado como o servidor). */
function ocorrencias(primeira, freq, n, hoje) {
  if (freq === 'datas') {
    const lista = [primeira];
    let d = primeira;
    while (lista.length < n) {
      d = proximoPermitido(somarDias(d, 1), regrasAgenda(CFG));
      if (motivoDataIndisponivel(d, hoje, CFG)) break;
      lista.push(d);
    }
    return lista;
  }
  try {
    return gerarOcorrencias({ frequencia: freq, quantidade: n, primeiraData: primeira }, regrasAgenda(CFG)).map((o) => o.data)
      .filter((d) => !motivoDataIndisponivel(d, hoje, CFG));
  } catch { return [primeira]; }
}

/** Próxima ocorrência depois da última data (o "+" do item 26). null se não houver dentro do horizonte. */
function proxima(datas, freq, hoje) {
  const ord = [...datas].sort();
  const ultima = ord.at(-1);
  const cands = freq === 'datas' ? ocorrencias(ultima, 'datas', 2, hoje).slice(1) : ocorrencias(ord[0], freq, ord.length + 12, hoje);
  return cands.find((d) => d > ultima && !ord.includes(d)) || null;
}

export function faltaDatas(ctx) {
  const r = estado();
  const ds = r.datas;
  if (!r.modalidade) return 'Escolha a modalidade';
  if (r.modalidade === 'pacote') {
    if (!r.frequencia) return 'Escolha a frequência';
    if (ds.length < 2) return 'Escolha 2 ou mais datas';
  } else if (ds.length !== 1) return 'Escolha a data do atendimento';
  const ruim = ds.find((d) => motivoDataIndisponivel(d, ctx.hoje, CFG));
  if (ruim) return `${formatarDataCurta(ruim)}: ${motivoDataIndisponivel(ruim, ctx.hoje, CFG)}`;
  const dur = r.duracaoHoras || 2;
  if (!horariosPermitidos(dur, ds[0], CFG).includes(r.horario)) return 'Escolha o horário de início';
  if (r.modalidade === 'pacote') {
    if (r.manterHorario === null) return 'Escolha se mantém o horário nas próximas diárias';
    if (r.manterHorario === false) {
      const d = ds.find((x) => !horariosPermitidos(dur, x, CFG).includes(r.horarios[x] || ''));
      if (d) return `Escolha o horário de ${formatarDataCurta(d)}`;
    } else {
      const d = ds.find((x) => !horariosPermitidos(dur, x, CFG).includes(r.horario));
      if (d) return `${formatarDataCurta(d)}: o horário ${r.horario} não cabe no expediente deste dia`;
    }
  }
  if (r.modalidade === 'multi_profissional' && r.manterHorario === null) return 'Escolha se usa o mesmo horário para as demais profissionais';
  return null;
}

export function passoDatas(ctx) {
  const r = estado();
  if (r.modalidade === 'multi_profissional' && !(r.qtdProfissionais >= 2)) r.qtdProfissionais = 2;
  const min = somarDias(ctx.hoje, CFG.regrasCalendario.antecedenciaMinimaDias ?? 1);
  const max = somarDias(ctx.hoje, CFG.regrasCalendario.horizonteMaximoDias ?? 120);
  const blocoFreq = el('div', { class: 'bloco-frequencia' });
  const blocoQtd = el('div', { class: 'bloco-quantidade' });
  const chips = el('div', { class: 'suas-datas', 'aria-live': 'polite' });
  const horario = el('div', { class: 'bloco-horario' });
  const aviso = el('p', { class: 'erro-campo', id: 'aviso-datas', 'aria-live': 'polite' });

  const mudarDatas = (novas) => {
    r.datas = [...new Set(novas)].sort();
    // a configuração por diária só vale pras datas que ficaram (item 26)
    for (const k of Object.keys(r.itens)) if (/^\d{4}-/.test(k) && !r.datas.includes(k)) delete r.itens[k];
    for (const k of Object.keys(r.horarios)) if (!r.datas.includes(k)) delete r.horarios[k];
    salvar(); cal.atualizar(); desenharChips(); desenharQtd(); desenharHorario();
  };
  const cal = criarCalendario({
    min, max, inicial: r.datas[0], rotulo: T3.tituloDatas,
    escolhidas: () => r.datas,
    motivo: (d) => motivoDataIndisponivel(d, ctx.hoje, CFG),
    marcador: (d) => (ehFeriado(d, CFG) ? { classe: 'cal-feriado', rotulo: T3.feriadoTaxa } : ehSabado(d) ? { classe: 'cal-sabado', rotulo: T3.sabadoTaxa } : null),
    aoEscolher: (d) => {
      aviso.textContent = '';
      if (r.modalidade !== 'pacote') { mudarDatas([d]); return; }
      if (!r.frequencia) { aviso.textContent = 'Escolha a frequência antes das datas.'; return; }
      if (r.datas.includes(d)) { mudarDatas(r.datas.filter((x) => x !== d)); return; }
      if (!r.datas.length && r.frequencia !== 'datas') { mudarDatas(ocorrencias(d, r.frequencia, Math.max(2, r.qtdDiarias || 4), ctx.hoje)); return; }
      if (r.datas.length >= LIMITE.maximoDiarias) { aviso.textContent = `No máximo ${LIMITE.maximoDiarias} diárias por solicitação.`; return; }
      mudarDatas([...r.datas, d]);
    },
  });

  function desenharFreq() {
    if (r.modalidade !== 'pacote') { trocar(blocoFreq); return; }
    const g = cardsEscolha({
      nome: 'frequencia', legenda: T3.frequencia, valor: r.frequencia, colunas: 4,
      opcoes: ['semanal', 'quinzenal', 'mensal', 'datas'].map((k) => ({ valor: k, titulo: T3.frequencias[k] })),
      aoMudar: async (v) => {
        if (v === r.frequencia) return;
        if (r.datas.length) {
          const ok = await confirmar({ titulo: T3.alterarFrequencia, texto: T3.alterarFrequenciaTexto, cancelar: T3.cancelar, confirmar: T3.alterar });
          if (!ok) { desenharFreq(); return; }
          Object.assign(r, { datas: [], itens: {}, horarios: {}, manterHorario: null });
        }
        r.frequencia = v; salvar(); cal.atualizar(); desenharChips(); desenharQtd(); desenharHorario();
      },
    });
    trocar(blocoFreq, g.raiz);
  }
  function desenharQtd() {
    if (r.modalidade === 'multi_profissional') {
      trocar(blocoQtd, contador({ id: 'qtd-profissionais', rotulo: 'Quantidade de profissionais', valor: r.qtdProfissionais, min: 2, max: LIMITE.maximoProfissionais,
        aoMudar: (v) => { r.qtdProfissionais = v; for (const k of Object.keys(r.itens)) if (/^p\d+$/.test(k) && Number(k.slice(1)) >= v) delete r.itens[k]; salvar(); } }));
      return;
    }
    if (r.modalidade !== 'pacote') { trocar(blocoQtd); return; }
    const n = r.datas.length || r.qtdDiarias || 4;
    const menos = (v) => {
      if (!r.datas.length) { r.qtdDiarias = v; salvar(); return; }
      mudarDatas(r.datas.slice(0, -1)); // "−" tira a última
    };
    const mais = () => {
      if (!r.datas.length) return;
      const p = proxima(r.datas, r.frequencia || 'datas', ctx.hoje);
      if (!p) { aviso.textContent = 'Não há outra data disponível dentro do período de agendamento.'; desenharQtd(); return; }
      if (r.datas.length >= LIMITE.maximoDiarias) { aviso.textContent = `No máximo ${LIMITE.maximoDiarias} diárias por solicitação.`; desenharQtd(); return; }
      mudarDatas([...r.datas, p]);
    };
    trocar(blocoQtd, contador({
      id: 'qtd-diarias', rotulo: T3.quantidadeDiarias, valor: n, min: r.datas.length ? 0 : 2, max: LIMITE.maximoDiarias,
      aoMudar: (v) => { if (!r.datas.length) { r.qtdDiarias = v; salvar(); } else if (v < r.datas.length) menos(v); else mais(); },
    }));
  }
  function desenharChips() {
    const ds = r.datas;
    if (!ds.length) { trocar(chips, r.modalidade === 'pacote' && r.frequencia && r.frequencia !== 'datas' ? el('p', { class: 'ajuda', text: 'Toque na data da primeira diária: as próximas são marcadas pela frequência.' }) : null); return; }
    trocar(chips, el('h3', { text: T3.suasDatas }), el('ul', { class: 'lista-datas chips-datas' }, ds.map((d) => el('li', { dataset: { data: d } }, [
      el('span', { text: rotuloData(d, ds) }),
      ehFeriado(d, CFG) ? el('small', { class: 'chip-taxa', text: 'feriado' }) : ehSabado(d) ? el('small', { class: 'chip-taxa', text: 'sábado' }) : null,
      el('button', { type: 'button', class: 'chip-remover', 'aria-label': `Remover ${formatarData(d)}`, on: { click: () => mudarDatas(r.datas.filter((x) => x !== d)) } }, [svg(ICONE_LIXEIRA)]),
    ]))));
  }
  function desenharHorario() {
    const ds = r.datas;
    if (!ds.length) { trocar(horario); return; }
    const dur = r.duracaoHoras || 2;
    const principal = seletorHorario({ id: 'horario', duracaoHoras: dur, data: ds[0], valor: r.horario, aoMudar: (v) => { r.horario = v; salvar(); desenharIndividuais(); } });
    const individuais = el('div', { class: 'horarios-individuais' });
    function desenharIndividuais() {
      if (r.modalidade !== 'pacote' || r.manterHorario !== false) { trocar(individuais); return; }
      trocar(individuais, ...ds.map((d) => el('div', { class: 'linha-horario', dataset: { data: d } }, [
        el('span', { class: 'linha-horario-data', text: rotuloData(d, ds) }),
        seletorHorario({ id: `horario-${d}`, rotulo: formatarDataCurta(d), duracaoHoras: dur, data: d, valor: r.horarios[d] || (d === ds[0] ? r.horario : ''), aoMudar: (v) => { r.horarios[d] = v; salvar(); } }).raiz,
      ])));
    }
    let pergunta = null;
    if (r.modalidade === 'pacote' && ds.length > 1) {
      pergunta = cardsEscolha({
        nome: 'manterHorario', legenda: T3.manterHorario, colunas: 2, valor: r.manterHorario === null ? '' : r.manterHorario ? 'sim' : 'nao',
        opcoes: [{ valor: 'sim', titulo: T3.manterSim }, { valor: 'nao', titulo: T3.manterNao }],
        aoMudar: (v) => { r.manterHorario = v === 'sim'; if (!r.manterHorario && r.horario) r.horarios[ds[0]] = r.horarios[ds[0]] || r.horario; salvar(); desenharIndividuais(); },
      }).raiz;
    } else if (r.modalidade === 'multi_profissional') {
      pergunta = cardsEscolha({
        nome: 'manterHorario', legenda: T3.mesmoHorarioProf, colunas: 2, valor: r.manterHorario === null ? '' : r.manterHorario ? 'sim' : 'nao',
        opcoes: [{ valor: 'sim', titulo: T3.manterSim }, { valor: 'nao', titulo: T3.manterNaoProf }],
        aoMudar: (v) => { r.manterHorario = v === 'sim'; salvar(); },
      }).raiz;
    } else if (r.modalidade === 'pacote') r.manterHorario = true;
    trocar(horario, el('h3', { class: 'subtitulo-passo', text: T3.horarioInicio }), el('p', { class: 'ajuda', text: T3.horarioComercial }),
      principal.raiz, pergunta, individuais);
    desenharIndividuais();
  }
  desenharFreq(); desenharQtd(); desenharChips(); desenharHorario();
  return moldura({
    passo: 'datas', titulo: T3.tituloDatas, aoVoltar: ctx.voltar, aoAvancar: ctx.avancar,
    corpo: [blocoFreq, blocoQtd, cal.raiz, el('p', { class: 'nota-discreta legenda-cal', text: `${T3.domingo} ${T3.sabadoTaxa} ${T3.feriadoTaxa}` }), aviso, chips, horario],
    validar: () => faltaDatas(ctx) || true,
  });
}
