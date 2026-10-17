// Linhas de valores do item 49 (revisão e painel): N diárias × valor-base, cada taxa numa linha, subtotal e descontos. PURO.
import { formatarBRL } from '../../../domain/dinheiro.js';

const brl = (c) => formatarBRL(c).replace('R$ ', 'R$');

/** Linhas de valores do item 49 a partir da cotação. */
export function linhasDeValor(cot) {
  const ls = [];
  const ats = cot.atendimentos;
  const nome = cot.modalidade === 'multi_profissional' ? ['profissional', 'profissionais'] : ['diária', 'diárias'];
  const porBase = new Map();
  for (const a of ats) porBase.set(a.baseCentavos, (porBase.get(a.baseCentavos) || 0) + 1);
  for (const [base, n] of porBase) {
    ls.push(n === 1 && ats.length === 1 ? ['Diária', brl(base), 'base'] : [`${n} ${n === 1 ? nome[0] : nome[1]} × ${brl(base)}`, brl(base * n), 'base']);
  }
  const taxa = (cod, rotulo) => {
    const itens = ats.flatMap((a) => a.itens.filter((i) => i.codigo === cod));
    if (!itens.length) return;
    const total = itens.reduce((s, i) => s + i.centavos, 0);
    ls.push([itens.length > 1 ? `${rotulo} (${itens.length}×)` : rotulo, `+ ${brl(total)}`, cod]);
  };
  taxa('sabado', 'Sábado'); taxa('feriado', 'Feriado'); taxa('sem_refeicao', 'Sem local para aquecer refeição');
  const desl = new Map();
  for (const a of ats) for (const i of a.itens) if (i.codigo === 'deslocamento') desl.set(i.descricao, (desl.get(i.descricao) || 0) + i.centavos);
  for (const [d, c] of desl) ls.push([d, `+ ${brl(c)}`, 'deslocamento']);
  if (cot.descontos.length) {
    ls.push(['Subtotal', brl(cot.subtotalCentavos), 'subtotal']);
    for (const d of cot.descontos) ls.push([`${d.descricao}:`, `– ${brl(d.centavos)}`, `desconto-${d.codigo}`]);
  }
  return ls;
}

