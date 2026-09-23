// minha-conta/: pedidos da cliente, status de cada diária, pagamentos pendentes e avaliações a fazer.
import { el } from '../dom.js';
import { montarPagina, definirAbertura, ativarReveal } from '../layout.js';
import { api } from '../../services/api.js';
import { auth, exigirPapel } from '../../services/auth.js';
import { telaCarregando, telaErro, selo } from '../comum.js';
import { url } from '../../config/app.js';
import { ROTULOS_ESTADO, ROTULOS_PEDIDO, ROTULOS_PAGAMENTO } from '../../domain/estados.js';
import { formatarBRL } from '../../domain/dinheiro.js';
import { formatarData, formatarDataCurta } from '../../domain/calendario.js';
import { FREQUENCIAS, TURNOS } from '../../domain/modelo.js';

const raiz = el('div');
montarPagina(raiz);
const sessao = exigirPapel('cliente', url('entrar/'));

const TIPO_SELO = { cancelado: 'erro', avaliado: 'ok', finalizado: 'ok', agendado: 'neutro' };

async function iniciar() {
  if (!sessao) return;
  definirAbertura({ rotulo: 'Área da cliente', titulo: `Oi, |${sessao.nome.split(' ')[0]}|`, lead: 'Confira suas diárias, veja os pagamentos e avalie o atendimento.' });
  telaCarregando(raiz);
  try {
    const { itens } = await api.listarPedidos({});
    const completos = await Promise.all(itens.map((p) => api.obterPedido(p.id)));
    const pendentes = completos.flatMap((c) => c.pagamentos.filter((g) => ['pendente', 'informado_pelo_cliente'].includes(g.status) && (g.parcela === 'entrada' ? c.pedido.status === 'aguardando_entrada' : ['diarista_a_caminho', 'em_andamento', 'finalizado', 'avaliado'].includes(c.atendimentos.find((a) => a.id === g.atendimentoId)?.status))).map((g) => ({ g, c })));
    const avaliar = completos.flatMap((c) => c.atendimentos.filter((a) => a.status === 'finalizado').map((a) => ({ a, c })));
    const sair = el('button', { class: 'btn btn-secundario btn-pequeno', type: 'button', text: 'Sair' });
    sair.addEventListener('click', async () => { await auth.sair(); location.href = url(''); });

    raiz.replaceChildren(
      pendentes.length ? el('section', { class: 'cartao-escuro reveal', 'aria-labelledby': 'h-pag' }, [
        el('h2', { id: 'h-pag', text: `${pendentes.length === 1 ? 'Pagamento pendente' : `${pendentes.length} pagamentos pendentes`}` }),
        el('ul', { class: 'lista', style: 'margin-top:12px' }, pendentes.map(({ g, c }) => el('li', { style: 'background:transparent;border-color:rgba(255,255,255,.18)' }, [
          el('div', { class: 'topo' }, [
            el('span', { text: g.parcela === 'entrada' ? `Entrada do pedido de ${formatarData(c.atendimentos[0].data)}` : `Diária de ${formatarData(g.venceEm)}` }),
            el('strong', { text: formatarBRL(g.valorCentavos) }),
          ]),
          el('div', { class: 'acoes', style: 'margin-top:10px' }, [el('a', { class: 'btn btn-primary btn-pequeno btn-seta', href: url('pagamento/', { pagamento: g.id }), text: g.status === 'pendente' ? 'Pagar no Pix' : 'Ver cobrança' })]),
        ]))),
      ]) : null,
      avaliar.length ? el('section', { class: 'cartao principal reveal', 'aria-labelledby': 'h-av', style: 'margin-top:16px' }, [
        el('h2', { id: 'h-av', text: 'Como foi a diária?', style: 'margin-top:0' }),
        el('ul', { class: 'lista' }, avaliar.map(({ a }) => el('li', {}, [
          el('div', { class: 'topo' }, [el('span', { text: `Diária de ${formatarDataCurta(a.data)}` }), el('a', { class: 'btn btn-secundario btn-pequeno', href: url('avaliacao/', { atendimento: a.id }), text: 'Avaliar' })]),
        ]))),
      ]) : null,
      el('h2', { text: completos.length === 1 ? 'Seu pedido' : 'Seus pedidos' }),
      completos.length ? el('div', {}, completos.map(({ pedido: p, atendimentos }) => el('div', { class: 'cartao reveal', dataset: { pedido: p.id } }, [
        el('div', { class: 'topo', style: 'display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:10px' }, [
          el('h3', { text: p.pacote.frequencia === 'avulso' ? `Diária de ${formatarData(atendimentos[0].data)}` : `${p.pacote.quantidadeDiarias} diárias, ${FREQUENCIAS[p.pacote.frequencia].toLowerCase()}`, style: 'margin:0' }),
          selo(ROTULOS_PEDIDO[p.status], p.status === 'cancelado' ? 'erro' : p.status === 'concluido' ? 'ok' : ''),
        ]),
        el('ul', { class: 'lista' }, atendimentos.map((a) => el('li', { dataset: { atendimento: a.id, status: a.status } }, [
          el('div', { class: 'topo' }, [
            el('a', { href: url('acompanhamento/', { atendimento: a.id }), text: `${formatarDataCurta(a.data)} · ${TURNOS[a.turno]}` }),
            selo(ROTULOS_ESTADO[a.status], TIPO_SELO[a.status] || ''),
          ]),
        ]))),
        el('p', { style: 'margin-top:12px' }, [el('a', { href: url('acompanhamento/', { pedido: p.id }), text: `Acompanhar o pedido (total ${formatarBRL(p.pacote.totalCentavos)})` })]),
      ]))) : el('p', { class: 'alerta alerta-info' }, ['Você ainda não tem pedidos neste aparelho. ', el('a', { href: url('autoagendamento/'), text: 'Agende sua diária' }), '.']),
      el('div', { class: 'acoes' }, [el('a', { class: 'btn btn-primary btn-seta', href: url('autoagendamento/'), text: 'Agendar outra diária' }), sair]),
    );
    ativarReveal(raiz);
  } catch (e) { telaErro(raiz, e); }
}

iniciar();
