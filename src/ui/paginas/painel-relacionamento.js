// P6 no painel (backend real): clientes pra renovação (M01) e reativação (M02) com quantos aceitam novidades, e as
// planilhas (CSV no formato do Excel). O envio das mensagens continua só com a regra ligada em Automações. Exportar é só
// prime_admin, fica registrado, e sai mascarado a menos que a pessoa marque "completo" e confirme.
import { el, trocar } from '../dom.js';
import { api } from '../../services/api.js';
import { executarAcao } from '../acoes.js';
import { selo } from '../comum.js';
import { url } from '../../config/app.js';
import { formatarDataCurta } from '../../domain/calendario.js';
import { gerarCsv, baixarCsv } from '../../domain/csv.js';

const COLUNAS = {
  clientes: [['Nome', 'nome'], ['Tipo', 'tipo'], ['CPF/CNPJ', 'documento'], ['Telefone', 'telefone'], ['E-mail', 'email'], ['Cidade', 'cidade'], ['Origem', 'origem'],
    ['Cadastrado em', 'cadastradoEm', 'data'], ['Pedidos', 'pedidos', 'numero'], ['Última diária', 'ultimaDiaria', 'data']],
  pedidos: [['Pedido', 'pedido'], ['Cliente', 'cliente'], ['Serviço', 'servico'], ['Situação', 'situacao'], ['Solicitado em', 'solicitadoEm', 'data'],
    ['Diárias', 'diarias', 'numero'], ['Primeira data', 'primeiraData', 'data'], ['Total (R$)', 'totalCentavos', 'dinheiro'], ['Cidade', 'cidade']],
  pagamentos: [['Pedido', 'pedido'], ['Cliente', 'cliente'], ['Cobrança', 'cobranca'], ['Valor (R$)', 'valorCentavos', 'dinheiro'], ['Situação', 'situacao'],
    ['Vencimento', 'vence', 'data'], ['Confirmado em', 'confirmadoEm', 'data'], ['Forma', 'metodo'], ['Recibo', 'recibo', 'numero']],
  repasses: [['Mês', 'mes', 'data'], ['Profissional', 'profissional'], ['CPF', 'cpf'], ['Diárias', 'diarias', 'numero'], ['Horas', 'horas', 'numero'],
    ['Horas extras', 'horasExtras', 'numero'], ['Valor (R$)', 'valorCentavos', 'dinheiro']],
};
const NOMES = { clientes: 'Clientes', pedidos: 'Pedidos', pagamentos: 'Pagamentos', repasses: 'Repasses' };

function lista(titulo, bloco, regra, extra) {
  return el('section', { style: 'margin-bottom:24px', dataset: { lista: regra } }, [
    el('h2', { text: `${titulo} (${bloco.total})`, style: 'margin-top:0' }),
    el('p', { class: 'mudo' }, [`${bloco.comConsentimento} ${bloco.comConsentimento === 1 ? 'aceita' : 'aceitam'} receber novidades. ${extra} `,
      selo(bloco.regraLigada ? `mensagem ${regra} ligada` : `mensagem ${regra} desligada`, bloco.regraLigada ? 'ok' : ''), ' ',
      el('a', { href: url('painel/', { aba: 'notificacoes' }), text: 'ligar ou desligar em Automações' })]),
    bloco.itens.length ? el('div', { class: 'tabela-wrap' }, [el('table', { class: 'painel' }, [
      el('thead', {}, [el('tr', {}, ['Cliente', 'Telefone', regra === 'M02' ? 'Última diária' : 'Pacote', 'Aceita novidades'].map((h) => el('th', { text: h })))]),
      el('tbody', {}, bloco.itens.map((i) => el('tr', { dataset: { cliente: i.clienteId } }, [
        el('td', { text: i.nome }), el('td', { text: i.telefone || '' }),
        el('td', {}, [regra === 'M02' ? formatarDataCurta(i.ultima) : el('a', { href: url('acompanhamento/', { pedido: i.pedidoId }), text: 'ver pedido' })]),
        el('td', { text: [i.consentimento.whatsapp ? 'WhatsApp' : null, i.consentimento.email ? 'e-mail' : null].filter(Boolean).join(' e ') || 'não' }),
      ]))),
    ])]) : el('p', { class: 'alerta alerta-info', text: 'Ninguém nesta lista agora.' }),
  ]);
}

export async function abaRelacionamento(admin) {
  const l = await api.listasRelacionamento();
  return el('div', { class: 'reveal' }, [
    lista('Renovação do pacote', l.renovacao, 'M01', 'Clientes com pacote neste mês; a mensagem sai no dia 25 com o link que já traz as datas do mês seguinte.'),
    lista('Reativação', l.reativacao, 'M02', `Clientes sem diária há ${l.diasReativacao} dias ou mais e nada marcado.`),
    blocoExportar(admin),
  ]);
}

function blocoExportar(admin) {
  if (!admin) return el('section', {}, [el('h2', { text: 'Planilhas' }), el('p', { class: 'mudo', text: 'Só a administração da Prime exporta planilhas.' })]);
  const completo = el('input', { type: 'checkbox', id: 'exportar-completo' });
  const aviso = el('p', { class: 'mudo', role: 'status' });
  const botoes = Object.keys(COLUNAS).map((tipo) => {
    const b = el('button', { class: 'btn btn-secundario btn-pequeno', type: 'button', text: NOMES[tipo], dataset: { exportar: tipo } });
    b.addEventListener('click', () => {
      if (completo.checked && !window.confirm('A planilha completa leva CPF, telefone e e-mail sem máscara. Só exporte se for mesmo necessário e guarde em local seguro. Exportar completa?')) return;
      executarAcao(b, async () => {
        const r = await api.exportar(tipo, completo.checked);
        const hoje = new Date().toISOString().slice(0, 10);
        baixarCsv(`prime-${tipo}-${hoje}${r.completo ? '-completa' : ''}.csv`, gerarCsv(COLUNAS[tipo].map(([titulo, campo, t]) => ({ titulo, campo, tipo: t })), r.linhas));
        trocar(aviso, `${NOMES[tipo]}: ${r.linhas.length} linha(s) exportada(s)${r.completo ? ', completa' : ', com CPF e contato mascarados'}.`);
      });
    });
    return b;
  });
  return el('section', {}, [
    el('h2', { text: 'Planilhas' }),
    el('p', { class: 'mudo', text: 'Arquivo CSV que abre direto no Excel (separado por ponto e vírgula, datas dd/mm/aaaa). Cada exportação fica registrada com quem fez e quando.' }),
    el('label', { class: 'opcao-check' }, [completo, ' Exportar completa (CPF, telefone e e-mail sem máscara)']),
    el('div', { class: 'acoes' }, botoes), aviso,
  ]);
}
