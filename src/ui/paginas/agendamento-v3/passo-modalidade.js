// Etapa 5 (itens 21 e 22): três cards no lugar de "Quantas diárias você deseja?": DIÁRIA AVULSA, MAIS DE UMA PROFISSIONAL
// NO MESMO DIA e PACOTE DE DIÁRIAS, com as descrições e os selos da cliente. As condições de pagamento ficam DENTRO das
// "Informações da modalidade" (painel), não embaixo do título do card.
import { el, cardsEscolha, abrirPainel, moldura } from './ui.js';
import { T3 } from '../../../config/agendamento-v3.js';
import { estado, salvar } from './estado.js';

const ORDEM = ['avulsa', 'multi_profissional', 'pacote'];

export function abrirInfoModalidade(k) {
  const m = T3.modalidades[k];
  abrirPainel(m.titulo, [
    el('p', { text: m.sub }),
    el('h3', { text: T3.pagamento }),
    el('p', { text: T3.infoPagamento[k] }),
    el('p', { class: 'nota-discreta', text: T3.infoPagamentoForma }),
    T3.infoDesconto[k] ? el('h3', { text: 'Desconto' }) : null,
    T3.infoDesconto[k] ? el('p', { text: T3.infoDesconto[k] }) : null,
    el('p', { class: 'nota-discreta', text: T3.pagamentoTexto }),
  ]);
}

export function passoModalidade(ctx) {
  const r = estado();
  const g = cardsEscolha({
    nome: 'modalidade', legenda: T3.tituloModalidade, legendaVisivel: false, valor: r.modalidade, colunas: 1, classe: 'cards-modalidade',
    opcoes: ORDEM.map((k) => ({
      valor: k, titulo: T3.modalidades[k].titulo, sub: T3.modalidades[k].sub, selo: T3.modalidades[k].selo,
      extra: el('button', { type: 'button', class: 'btn-terciario ver-mais', dataset: { infoModalidade: k }, text: T3.infoModalidade, 'aria-label': `${T3.infoModalidade}: ${T3.modalidades[k].titulo}`, on: { click: () => abrirInfoModalidade(k) } }),
    })),
    aoMudar: (v) => {
      if (r.modalidade !== v) {
        // trocar de modalidade recomeça as datas e a configuração (avulsa e multi: uma data; pacote: várias)
        Object.assign(r, { modalidade: v, datas: r.datas.slice(0, 1), itens: {}, manterHorario: null, horarios: {}, frequencia: v === 'pacote' ? r.frequencia : '' });
        if (v === 'multi_profissional' && !(r.qtdProfissionais >= 2)) r.qtdProfissionais = 2;
      }
      salvar();
    },
  });
  return moldura({
    passo: 'modalidade', titulo: T3.tituloModalidade, corpo: [g.raiz], aoVoltar: ctx.voltar, aoAvancar: ctx.avancar,
    validar: () => (r.modalidade ? true : (g.erro('Escolha a modalidade'), false)),
  });
}
