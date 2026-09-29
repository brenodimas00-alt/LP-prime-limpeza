// P3: botão "Recibo" (cliente em Minha conta e a Prime no painel). O banco devolve o recibo congelado na confirmação;
// o PDF é montado aqui (src/domain/pdf.js) e baixado sem passar por servidor nenhum.
import { el } from './dom.js';
import { api } from '../services/api.js';
import { executarAcao } from './acoes.js';
import { gerarPdf } from '../domain/pdf.js';
import { linhasRecibo } from '../domain/recibo.js';
import { EMPRESA } from '../config/seo.js';

export function botaoRecibo(pagamentoId, { classe = 'btn btn-secundario btn-pequeno' } = {}) {
  const b = el('button', { class: classe, type: 'button', text: 'Recibo', dataset: { recibo: pagamentoId } });
  b.addEventListener('click', () => executarAcao(b, async () => {
    const r = await api.obterRecibo(pagamentoId);
    const nome = `recibo-prime-${String(r.numero).padStart(6, '0')}.pdf`;
    const blob = new Blob([gerarPdf(linhasRecibo(r, EMPRESA), { titulo: `Recibo ${String(r.numero).padStart(6, '0')}` })], { type: 'application/pdf' });
    const a = el('a', { href: URL.createObjectURL(blob), download: nome, hidden: true });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    return r;
  }));
  return b;
}

/** Rótulo curto de uma cobrança (diária, pacote ou hora extra). */
export function rotuloCobranca(g, atendimentos, formatarData) {
  if (g.parcela === 'pacote') return 'Pacote';
  const d = formatarData(atendimentos.find((a) => a.id === g.atendimentoId)?.data || g.venceEm);
  return g.parcela === 'hora_extra' ? `Hora extra da diária de ${d}` : `Diária de ${d}`;
}
