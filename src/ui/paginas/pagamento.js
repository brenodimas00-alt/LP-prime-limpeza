// pagamento/?pagamento=ID: pagamento ANTECIPADO e INTEGRAL da diária (ou do pacote), depois que a Prime confirmou a
// disponibilidade. PIX (QR e copia e cola), transferência ou depósito; "Já paguei" é só o aviso da cliente: quem confirma
// o recebimento é a Prime. Elegibilidade vem do backend/mock. Sem config Pix, o brcode vem null e a tela avisa.
import { anexar, el, param, svg, trocar } from '../dom.js';
import { montarPagina, definirAbertura, ativarReveal } from '../layout.js';
import { api } from '../../services/api.js';
import { executarAcao } from '../acoes.js';
import { grupoOpcoes } from '../form.js';
import { telaCarregando, telaErro, sessaoCliente, selo } from '../comum.js';
import { toast } from '../toast.js';
import { url, modoDev, configPrime, PAGAMENTO_CARTAO } from '../../config/app.js';
import { TEXTOS_CLIENTE } from '../../config/conteudo.js';
import { ROTULOS_PAGAMENTO } from '../../domain/estados.js';
import { formatarBRL } from '../../domain/dinheiro.js';
import { formatarData, formatarDataCurta } from '../../domain/calendario.js';
import { gerarQR, svgQR } from '../../domain/qrcode.js';
import { lerTLV } from '../../domain/brcode.js';
import { botaoWhatsAppManual } from '../whatsapp-manual.js';

const raiz = el('div');
montarPagina(raiz);

async function iniciar() {
  const id = param('pagamento');
  telaCarregando(raiz);
  try {
    if (!id) throw { codigo: 'NAO_ENCONTRADO' };
    render(await api.obterPagamento(id));
  } catch (e) { telaErro(raiz, e); }
}

function render({ pagamento: g, pedido, atendimento, elegibilidade }) {
  const pacote = g.parcela === 'pacote';
  definirAbertura({
    rotulo: pacote ? 'Pagamento · Pacote' : `Pagamento · Diária de ${formatarData(atendimento?.data || g.venceEm)}`,
    titulo: 'Pagamento |antecipado|',
    lead: g.venceEm ? `${TEXTOS_CLIENTE.pagamentoAntecipado} Envie o comprovante até ${String(g.venceAs || '14:00').replace(':00', 'h')} de ${formatarDataCurta(g.venceEm)}.` : TEXTOS_CLIENTE.pagamentoAntecipado,
    voltar: { href: url('acompanhamento/', { pedido: pedido.id }), texto: 'Acompanhar o pedido' },
  });
  const partes = [
    el('p', { class: 'lead', style: 'display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:0 0 20px' }, [
      el('span', { class: 'valor-grande', text: formatarBRL(g.valorCentavos), dataset: { valor: g.valorCentavos } }),
      selo(ROTULOS_PAGAMENTO[g.status], g.status === 'confirmado' ? 'ok' : g.status === 'cancelado' ? 'erro' : 'aviso'),
    ]),
  ];

  if (g.status === 'confirmado') {
    partes.push(el('p', { class: 'alerta alerta-ok', role: 'status', text: 'A Prime confirmou o recebimento. Seu atendimento está confirmado.' }));
  } else if (!elegibilidade.pagavel) {
    partes.push(el('p', { class: 'alerta alerta-info', role: 'status', text: elegibilidade.motivo }));
  } else if (!g.brcode) {
    partes.push(formaPagamento());
    partes.push(el('p', { class: 'alerta alerta-aviso', role: 'status', dataset: { pix: 'indisponivel' }, text: 'A chave PIX da Prime ainda não foi configurada neste site, então o QR não aparece. Pra pagar por PIX, transferência ou depósito, peça os dados à Prime pelo WhatsApp.' }));
    partes.push(el('div', { class: 'acoes' }, [botaoWhatsAppManual({ texto: `Oi! Quero pagar ${formatarBRL(g.valorCentavos)} do pedido ${pedido.id.slice(0, 8)}. Pode me passar os dados?`, rotulo: 'Pedir os dados à Prime', pedidoId: pedido.id, contexto: 'dados-pagamento', ...sessaoCliente(pedido.clienteId) })]));
  } else {
    partes.push(formaPagamento());
    partes.push(blocoPix(g, pedido));
  }

  if (g.status === 'informado_pelo_cliente') {
    partes.push(el('p', { class: 'alerta alerta-info', role: 'status', text: `Você avisou que pagou em ${new Date(g.informadoEm).toLocaleString('pt-BR')}. A Prime confere e confirma por aqui e pelo WhatsApp.` }));
  }
  if (modoDev() && ['pendente', 'informado_pelo_cliente'].includes(g.status) && elegibilidade.pagavel) {
    const b = el('button', { class: 'btn btn-secundario btn-pequeno', type: 'button', text: 'Simular confirmação da Prime' });
    b.addEventListener('click', () => executarAcao(b, (k) => api.confirmarPagamento(g.id, { chave: k }), { aoSucesso: () => iniciar() }));
    partes.push(el('div', { class: 'dev-bar' }, [el('span', { text: 'Modo dev:' }), b]));
  }
  trocar(raiz, ...partes);
  ativarReveal(raiz);
}

/**
 * Formas: PIX (QR e copia e cola aqui), transferência e depósito (dados bancários com a Prime pelo WhatsApp: PENDÊNCIA
 * enquanto a cliente não passar os dados). Cartão aparece desabilitado até o B4 (Asaas) ligar PAGAMENTO_CARTAO.
 */
function formaPagamento() {
  const g = grupoOpcoes({ nome: 'metodo', legenda: 'Forma de pagamento', valor: 'pix', cartoes: true, opcoes: [
    ['pix', 'PIX', 'QR ou copia e cola'],
    ['transferencia', 'Transferência', 'Dados com a Prime pelo WhatsApp'],
    ['deposito', 'Depósito', 'Dados com a Prime pelo WhatsApp'],
    ['cartao', 'Cartão de crédito', PAGAMENTO_CARTAO ? 'Pela página segura do Asaas' : 'Em breve'],
  ] });
  g.inputs.find((i) => i.value === 'cartao').disabled = !PAGAMENTO_CARTAO;
  g.raiz.classList.add('reveal');
  g.raiz.style.marginBottom = '20px';
  return g.raiz;
}

function blocoPix(g, pedido) {
  const prime = configPrime();
  const tlv = lerTLV(g.brcode);
  const chave = lerTLV(tlv['26'] || '')['01'] || prime.pix?.chave || '';
  const nome = tlv['59'] || '';
  const qr = el('div', { class: 'qr' });
  try { anexar(qr, svg(svgQR(gerarQR(g.brcode)))); } catch { anexar(qr, el('p', { class: 'mudo', text: 'Use o copia e cola.' })); }

  const copia = el('p', { class: 'copia', id: 'copia-cola', text: g.brcode, tabindex: 0, 'aria-label': 'Código Pix copia e cola' });
  const copiar = el('button', { class: 'btn btn-primary', type: 'button', text: 'Copiar código Pix' });
  copiar.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(g.brcode); toast('Código copiado. Cole no app do seu banco.', 'ok'); } catch {
      const r = document.createRange(); r.selectNodeContents(copia); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      toast('Selecione e copie o código acima.', 'info');
    }
  });

  const jaPaguei = el('button', { class: 'btn btn-secundario', type: 'button', text: 'Já paguei' });
  jaPaguei.addEventListener('click', () => executarAcao(jaPaguei, (k) => api.informarPagamento(g.id, { chave: k, ...sessaoCliente(pedido.clienteId) }), {
    id: `informar:${g.id}`, sucesso: 'Aviso enviado. A Prime vai conferir e confirmar.', aoSucesso: () => iniciar(),
  }));
  if (g.status === 'informado_pelo_cliente') { jaPaguei.textContent = 'Pagamento informado'; jaPaguei.disabled = true; }

  const wa = botaoWhatsAppManual({
    texto: `Oi! Acabei de pagar ${formatarBRL(g.valorCentavos)} (${g.parcela === 'pacote' ? 'pacote' : 'diária'}) do pedido ${pedido.id.slice(0, 8)}. Segue o comprovante.`,
    rotulo: 'Avisar a Prime no WhatsApp', pedidoId: pedido.id, contexto: 'pix', ...sessaoCliente(pedido.clienteId),
  });

  return el('div', { class: 'cartao principal reveal', dataset: { pix: 'ok' } }, [
    el('div', { class: 'pix-grid' }, [
      qr,
      el('div', {}, [
        el('h2', { text: 'Como pagar', style: 'margin-top:0' }),
        el('ol', { class: 'passos' }, [
          el('li', { text: 'Abra o app do seu banco e escolha PIX.' }),
          el('li', { text: 'Escaneie o QR ou use "Pix copia e cola" com o código abaixo.' }),
          el('li', { text: `Confira o nome ${nome ? `"${nome}"` : 'da Prime'} e o valor ${formatarBRL(g.valorCentavos)}.` }),
          el('li', { text: 'Depois toque em "Já paguei" e mande o comprovante pelo WhatsApp. A Prime confere e confirma o atendimento.' }),
        ]),
        el('dl', { class: 'dados' }, [el('dt', { text: 'Chave Pix' }), el('dd', { text: chave, id: 'chave-pix' }), el('dt', { text: 'Identificador' }), el('dd', { text: g.pixTxid })]),
      ]),
    ]),
    el('h3', { text: 'Pix copia e cola', style: 'margin-top:20px' }), copia,
    el('div', { class: 'acoes' }, [copiar, jaPaguei, wa]),
  ]);
}

iniciar();
