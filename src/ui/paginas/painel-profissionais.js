// P5 no painel (backend real, aba Cadastros): certidões vencendo ou vencidas e o repasse mensal (só prime_admin, atrás da
// flag p5_repasse). A regra e o fechamento são decididos no banco; o CSV sai daqui, no formato do Excel.
import { anexar, el, trocar } from '../dom.js';
import { api } from '../../services/api.js';
import { executarAcao, mensagemErro } from '../acoes.js';
import { selo } from '../comum.js';
import { formatarBRL } from '../../domain/dinheiro.js';
import { formatarDataCurta } from '../../domain/calendario.js';
import { gerarCsv, baixarCsv } from '../../domain/csv.js';

const SITUACAO = { vencido: ['Vencida', 'erro'], vencendo: ['Vencendo', 'aviso'], sem_certidao: ['Sem certidão', 'erro'] };

export async function blocoCertidoes() {
  const lista = await api.documentosVencimento(30).catch(() => []);
  return el('section', { style: 'margin-top:28px', dataset: { certidoes: '' } }, [
    el('h2', { text: `Certidões de antecedentes (${lista.length})` }),
    el('p', { class: 'mudo', text: 'Vencidas, sem certidão ou vencendo nos próximos 30 dias. A profissional recebe o aviso 15 e 3 dias antes; ela envia a nova pelo cadastro.' }),
    lista.length ? el('ul', { class: 'lista' }, lista.map((d) => el('li', { dataset: { certidao: d.diaristaId } }, [el('div', { class: 'topo' }, [
      el('span', { text: `${d.nome}${d.validoAte ? ` · válida até ${formatarDataCurta(d.validoAte)}` : ''}` }), selo(...SITUACAO[d.situacao]),
    ])]))) : el('p', { class: 'alerta alerta-info', text: 'Nenhuma certidão vencendo.' }),
  ]);
}

const mesAnterior = () => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };

export function blocoRepasse(admin) {
  const sec = el('section', { style: 'margin-top:28px', dataset: { repasse: '' } }, [el('h2', { text: 'Repasse das profissionais' })]);
  if (!admin) { anexar(sec, el('p', { class: 'mudo', text: 'Só a administração da Prime vê o repasse.' })); return sec; }
  const mes = el('input', { type: 'month', id: 'repasse-mes', value: mesAnterior() });
  const corpo = el('div', {}, [el('p', { class: 'mudo', text: 'Escolha o mês.' })]);
  const carregar = async () => {
    trocar(corpo, el('p', { class: 'mudo', text: 'Carregando...' }));
    try {
      const r = await api.repasseMes(`${mes.value}-01`);
      const regra = r.regra?.tipo === 'percentual' ? `${r.regra.percentual}% do valor das diárias e horas extras` : r.regra?.tipo === 'por_carga' ? 'valor por carga horária' : 'regra ainda não definida';
      const csv = el('button', { class: 'btn btn-secundario btn-pequeno', type: 'button', text: 'Baixar planilha (CSV)', disabled: !r.linhas.length });
      csv.addEventListener('click', () => baixarCsv(`repasse-${mes.value}.csv`, gerarCsv([
        { titulo: 'Profissional', campo: 'nome' }, { titulo: 'Diárias', campo: 'diarias', tipo: 'numero' }, { titulo: 'Horas', campo: 'horas', tipo: 'numero' },
        { titulo: 'Horas extras', campo: 'horasExtras', tipo: 'numero' }, { titulo: 'Valor (R$)', campo: 'valorCentavos', tipo: 'dinheiro' },
      ], r.linhas)));
      const fechar = el('button', { class: 'btn btn-primary btn-pequeno', type: 'button', text: 'Fechar o mês' });
      fechar.addEventListener('click', () => {
        if (!window.confirm(`Fechar ${mes.value}? Os valores ficam gravados e não mudam mais.`)) return;
        executarAcao(fechar, (k) => api.fecharRepasse(`${mes.value}-01`, { chave: k }), { sucesso: 'Mês fechado.', aoSucesso: carregar });
      });
      trocar(corpo,
        el('p', {}, [selo(r.fechado ? 'Fechado' : 'Prévia', r.fechado ? 'ok' : 'aviso'), ` Regra: ${regra}.`]),
        r.fechado ? null : formRegra(r.regra, carregar),
        r.linhas.length ? el('div', { class: 'tabela-wrap' }, [el('table', { class: 'painel' }, [
          el('thead', {}, [el('tr', {}, ['Profissional', 'Diárias', 'Horas', 'Horas extras', 'Valor'].map((h) => el('th', { text: h })))]),
          el('tbody', {}, r.linhas.map((l) => el('tr', {}, [el('td', { text: l.nome }), el('td', { text: String(l.diarias) }), el('td', { text: String(l.horas).replace('.', ',') }), el('td', { text: String(l.horasExtras) }), el('td', { text: formatarBRL(l.valorCentavos) })]))),
        ])]) : el('p', { class: 'mudo', text: 'Nenhuma diária realizada neste mês.' }),
        el('div', { class: 'acoes' }, [csv, r.fechado ? null : fechar]));
    } catch (e) { trocar(corpo, el('p', { class: 'alerta alerta-info', text: mensagemErro(e) })); }
  };
  mes.addEventListener('change', carregar);
  anexar(sec, el('p', { class: 'mudo', text: 'Diárias realizadas no mês e horas extras aprovadas. Fechar grava os valores e trava: mudanças depois não alteram o mês fechado.' }),
    el('label', { for: 'repasse-mes', class: 'rotulo', text: 'Mês' }), mes, corpo);
  carregar();
  return sec;
}

/** Regra do repasse: percentual do valor cobrado ou valor fixo por carga horária (mais o valor da hora extra). */
function formRegra(atual, depois) {
  const caixa = el('details', { style: 'margin-bottom:12px' }, [el('summary', { text: 'Definir a regra do repasse', style: 'cursor:pointer' })]);
  const tipo = el('select', { id: 'regra-tipo', 'aria-label': 'Tipo de regra' }, [el('option', { value: 'percentual', text: 'Percentual do valor cobrado', selected: atual?.tipo !== 'por_carga' }), el('option', { value: 'por_carga', text: 'Valor por carga horária', selected: atual?.tipo === 'por_carga' })]);
  const pct = el('input', { type: 'number', min: 1, max: 100, step: '0.5', id: 'regra-pct', 'aria-label': 'Percentual', value: atual?.percentual ?? '' });
  const reais = (id, rot, cent) => el('label', { class: 'opcao-check' }, [`${rot} R$ `, el('input', { type: 'number', min: 0, step: '0.01', id, class: 'curto', value: cent !== undefined ? (cent / 100).toFixed(2) : '' })]);
  const cargas = el('div', { class: 'opcoes' }, [...['2', '4', '6', '8'].map((h) => reais(`regra-${h}`, `${h}h`, atual?.valores?.[h])), reais('regra-he', 'hora extra', atual?.horaExtraCentavos)]);
  const salvar = el('button', { class: 'btn btn-secundario btn-pequeno', type: 'button', text: 'Salvar regra' });
  const cent = (id) => String(Math.round(Number(caixa.querySelector(`#${id}`).value || 0) * 100));
  salvar.addEventListener('click', () => executarAcao(salvar, () => api.salvarRegraRepasse(tipo.value === 'percentual' ? { tipo: 'percentual', percentual: pct.value }
    : { tipo: 'por_carga', valores: { 2: cent('regra-2'), 4: cent('regra-4'), 6: cent('regra-6'), 8: cent('regra-8') }, horaExtraCentavos: cent('regra-he') }), { sucesso: 'Regra salva.', aoSucesso: depois }));
  anexar(caixa, el('div', { class: 'opcoes', style: 'margin-top:8px' }, [tipo, pct]), cargas, el('div', { class: 'acoes' }, [salvar]));
  return caixa;
}
