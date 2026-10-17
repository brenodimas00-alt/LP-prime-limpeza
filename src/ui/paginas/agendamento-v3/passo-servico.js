// Etapa 1 (itens 3 e 4): "Onde será realizado o atendimento?" (Residencial / Empresarial, que também filtra os tipos de imóvel)
// e os cards de serviço, cada um com o próprio "Ver mais" (só as restrições daquele serviço; a lista completa fica nos
// Termos e Condições do atendimento).
import { el, trocar, cardsEscolha, abrirPainel, moldura } from './ui.js';
import { ICONE_CASA, ICONE_PREDIO } from '../../icones.js';
import { CONFIG_PRECOS as CFG } from '../../../config/precos.js';
import { ONDE, SERVICOS_AGENDAMENTO as SERVICOS } from '../../../config/agendamento.js';
import { T3 } from '../../../config/agendamento-v3.js';
import { estado, salvar } from './estado.js';

const P = CFG.PRECOS;

/** Conteúdo do "Ver mais" de um serviço (painel). */
export function abrirVerMais(chave, conteudo) {
  const s = SERVICOS[chave];
  const vm = conteudo?.verMais?.[chave] || {};
  const incluido = (s.incluido || []).filter((i) => !/^PREENCHER/.test(i));
  abrirPainel(s.nome, [
    el('p', { class: 'mudo', text: s.descricao }),
    incluido.length ? el('h3', { text: T3.incluido }) : null,
    incluido.length ? el('ul', { class: 'lista-incluido' }, incluido.map((i) => el('li', { text: i }))) : null,
    vm.naoInclui?.length ? el('h3', { text: T3.naoInclui }) : null,
    vm.naoInclui?.length ? el('ul', { class: 'lista-incluido lista-nao' }, vm.naoInclui.map((i) => el('li', { text: i }))) : null,
    ...(vm.observacoes || []).map((o) => el('p', { class: 'nota-discreta', text: o })),
    el('p', { class: 'nota-discreta', text: T3.termosCompletos }),
  ]);
}

export function passoServico(ctx) {
  const r = estado();
  const servicos = el('div', { class: 'bloco-servicos' });
  let grupoServico = null;
  const desenharServicos = () => {
    if (!r.segmento) { trocar(servicos); grupoServico = null; return; }
    const lista = P.servicosPorTipoCliente[r.segmento === 'empresa' ? 'empresa' : 'residencial'];
    grupoServico = cardsEscolha({
      nome: 'servico', legenda: 'Qual serviço?', valor: r.servico, colunas: 2, classe: 'cards-servico',
      opcoes: lista.map((k) => ({
        valor: k, titulo: SERVICOS[k].nome, sub: SERVICOS[k].descricao,
        extra: el('button', { type: 'button', class: 'btn-link ver-mais', dataset: { verMais: k }, 'aria-label': `${T3.verMais}: ${SERVICOS[k].nome}`, text: T3.verMais, on: { click: () => abrirVerMais(k, ctx.conteudo) } }),
      })),
      aoMudar: (v) => { if (r.servico !== v) { r.servico = v; ctx.servicoMudou(); } salvar(); },
    });
    trocar(servicos, grupoServico.raiz, el('p', { class: 'nota-discreta', text: T3.posObra }));
  };
  const onde = cardsEscolha({
    nome: 'segmento', legenda: T3.perguntaOnde, valor: r.segmento, colunas: 2,
    opcoes: [
      { valor: 'residencial', titulo: ONDE.residencial.titulo, sub: ONDE.residencial.sub, icone: ICONE_CASA },
      { valor: 'empresa', titulo: ONDE.empresa.titulo, sub: ONDE.empresa.sub, icone: ICONE_PREDIO },
    ],
    aoMudar: (v) => {
      if (r.segmento !== v) ctx.segmentoMudou(v);
      salvar(); desenharServicos();
    },
  });
  desenharServicos();
  return moldura({
    passo: 'servico', titulo: T3.tituloServico, corpo: [onde.raiz, servicos], aoAvancar: ctx.avancar,
    validar: () => {
      if (!r.segmento) { onde.erro('Escolha onde será realizado o atendimento'); return false; }
      if (!r.servico) { grupoServico?.erro('Escolha o serviço'); return false; }
      return true;
    },
  });
}
