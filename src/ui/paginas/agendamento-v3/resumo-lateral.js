// Resumo lateral do agendamento (acabamento, 20/10/2026; referências, princípio 22): no computador, a partir da etapa 2,
// o que a pessoa já escolheu fica à vista ao lado do formulário. Só leitura e sem cálculo: o valor aparece na revisão,
// que confere com o servidor. No celular não aparece (a revisão já reúne tudo antes de enviar).
import { el } from './ui.js';
import { SERVICOS_AGENDAMENTO as SERVICOS } from '../../../config/agendamento.js';
import { T3 } from '../../../config/agendamento-v3.js';
import { estado } from './estado.js';
import { enderecoEmLinha } from './passo-endereco.js';
import { rotuloData } from './passo-datas.js';

function endereco(r, ctx) {
  if (r.endereco.modo === 'salvo') { const e = (ctx.enderecos || []).find((x) => x.id === r.endereco.id); return e ? enderecoEmLinha(e) : ''; }
  const n = r.endereco.novo || {};
  return n.logradouro && n.numero && r.endereco.cepSituacao === 'atendida' ? enderecoEmLinha(n) : '';
}

export function resumoLateral(ctx) {
  const r = estado();
  const datas = [...new Set(r.datas || [])].sort();
  const linhas = [
    ['Serviço', SERVICOS[r.servico]?.nome || ''],
    ['Local', endereco(r, ctx)],
    ['Duração', r.duracaoHoras ? `${r.duracaoHoras} horas por diária` : ''],
    ['Modalidade', r.modalidade === 'pacote' ? `Pacote${T3.frequencias?.[r.frequencia] ? `, ${T3.frequencias[r.frequencia].toLowerCase()}` : ''}` : r.modalidade === 'multi_profissional' ? 'Mais de uma profissional' : r.modalidade === 'avulsa' ? 'Diária avulsa' : ''],
    ['Datas', datas.length ? datas.map((d) => rotuloData(d, datas)).join(' · ') : ''],
    ['Horário', r.horario || ''],
  ].filter(([, v]) => v);
  return el('aside', { class: 'resumo-lateral', 'aria-label': 'Resumo da solicitação' }, [
    el('h2', { class: 'resumo-titulo', text: 'Sua solicitação' }),
    linhas.length ? el('dl', { class: 'resumo-lista' }, linhas.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })])) : null,
    el('p', { class: 'resumo-nota', text: 'O valor aparece na revisão, antes de enviar. Nada é cobrado no envio.' }),
  ]);
}
