// pagamento/?pagamento=ID: valor, chave, copia e cola, QR, "Já paguei" e contato manual. Serve a entrada e a
// parcela do dia. Elegibilidade vem do backend/mock (obterPagamento.elegibilidade). O brcode vem do registro:
// no modo http é o backend quem gera. Sem config Pix, o registro vem com brcode null e a tela avisa.
import { anexar, el, param, svg, trocar } from '../dom.js';
import { montarPagina, definirAbertura, ativarReveal } from '../layout.js';
import { api } from '../../services/api.js';
import { executarAcao } from '../acoes.js';
import { telaCarregando, telaErro, sessaoCliente, selo } from '../comum.js';
import { toast } from '../toast.js';
import { url, modoDev, configPrime } from '../../config/app.js';
import { ROTULOS_PAGAMENTO } from '../../domain/estados.js';
import { formatarBRL } from '../../domain/dinheiro.js';
import { formatarData } from '../../domain/calendario.js';
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
  const entrada = g.parcela === 'entrada';
  definirAbertura({
    rotulo: entrada ? 'Pagamento · Entrada de 50%' : `Pagamento · Diária de ${formatarData(atendimento?.data || g.venceEm)}`,
    titulo: entrada ? 'Pague a entrada e |garanta a data|' : 'Parcela da |diária|',
    voltar: { href: url('acompanhamento/', { pedido: pedido.id }), texto: 'Acompanhar o pedido' },
  });
  const partes = [
    el('p', { class: 'lead', style: 'display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:0 0 20px' }, [
      el('span', { class: 'valor-grande', text: formatarBRL(g.valorCentavos), dataset: { valor: g.valorCentavos } }),
      selo(ROTULOS_PAGAMENTO[g.status], g.status === 'confirmado' ? 'ok' : g.status === 'cancelado' ? 'erro' : 'aviso'),
    ]),
  ];

  if (g.status === 'confirmado') {
    partes.push(el('p', { class: 'alerta alerta-ok', role: 'status', text: entrada ? 'Entrada confirmada pela Prime. Sua diária está garantida.' : 'Parcela confirmada pela Prime. Obrigada.' }));
  } else if (!elegibilidade.pagavel) {
    partes.push(el('p', { class: 'alerta alerta-info', role: 'status', text: elegibilidade.motivo }));
  } else if (!g.brcode) {
    partes.push(el('p', { class: 'alerta alerta-aviso', role: 'status', dataset: { pix: 'indisponivel' }, text: 'O Pix da Prime ainda não foi configurado neste site, então não geramos a cobrança. Fale com a Prime pelos contatos do rodapé.' }));
  } else {
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
    texto: `Oi! Acabei de pagar o Pix de ${formatarBRL(g.valorCentavos)} (${g.parcela === 'entrada' ? 'entrada' : 'parcela do dia'}) do pedido ${pedido.id.slice(0, 8)}. Segue o comprovante.`,
    rotulo: 'Avisar a Prime no WhatsApp', pedidoId: pedido.id, contexto: 'pix', ...sessaoCliente(pedido.clienteId),
  });

  return el('div', { class: 'cartao principal reveal', dataset: { pix: 'ok' } }, [
    el('div', { class: 'pix-grid' }, [
      qr,
      el('div', {}, [
        el('h2', { text: 'Como pagar', style: 'margin-top:0' }),
        el('ol', { class: 'passos' }, [
          el('li', { text: 'Abra o app do seu banco e escolha Pix.' }),
          el('li', { text: 'Escaneie o QR ou use "Pix copia e cola" com o código abaixo.' }),
          el('li', { text: `Confira o nome ${nome ? `"${nome}"` : 'da Prime'} e o valor ${formatarBRL(g.valorCentavos)}.` }),
          el('li', { text: 'Depois toque em "Já paguei". Se quiser, mande o comprovante no WhatsApp.' }),
        ]),
        el('dl', { class: 'dados' }, [el('dt', { text: 'Chave Pix' }), el('dd', { text: chave, id: 'chave-pix' }), el('dt', { text: 'Identificador' }), el('dd', { text: g.pixTxid })]),
      ]),
    ]),
    el('h3', { text: 'Pix copia e cola', style: 'margin-top:20px' }), copia,
    el('div', { class: 'acoes' }, [copiar, jaPaguei, wa]),
  ]);
}

iniciar();
