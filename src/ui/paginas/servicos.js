// /_dev/servicos.html: painel de demonstração do mock. Só funciona com ADAPTER = 'mock' e ?dev=1.
// Lista o seed, transiciona atendimentos, confirma pagamentos, aprova diaristas e mostra a fila de notificações.
import { anexar, el, limpar, trocar } from '../dom.js';
import { montarPagina, definirAbertura } from '../layout.js';
import { api, adapterAtual } from '../../services/api.js';
import { ligarAcao } from '../acoes.js';
import { toast } from '../toast.js';
import { url, modoDev, ADAPTER } from '../../config/app.js';
import { eventosPossiveis, ROTULOS_ESTADO, ROTULOS_PEDIDO, ROTULOS_PAGAMENTO } from '../../domain/estados.js';
import { formatarBRL } from '../../domain/dinheiro.js';
import { formatarData, formatarInstante, instanteLocal, somarDias } from '../../domain/calendario.js';

const raiz = el('div');
const main = montarPagina(raiz);
main.classList.add('larga');

const ROTULO_EVENTO = {
  confirmar: 'Confirmar', sair_a_caminho: 'Diarista a caminho', iniciar: 'Iniciar', finalizar: 'Finalizar', cancelar: 'Cancelar', reagendar: 'Reagendar',
};

async function render() {
  if (ADAPTER !== 'mock' || !modoDev()) {
    trocar(raiz, el('h1', { text: 'Serviços (dev)' }), el('p', { class: 'alerta alerta-info', text: 'Esta tela só existe no modo mock com ?dev=1 na URL.' }));
    return;
  }
  const adapter = await adapterAtual();
  const [pedidos, diaristas, notifs, eventos] = await Promise.all([
    api.listarPedidos({}), api.listarDiaristas({}), api.listarNotificacoes({}), api.listarEventos({}),
  ]);
  const aprovadas = diaristas.itens.filter((d) => d.status === 'aprovada');
  const completos = await Promise.all(pedidos.itens.map((p) => api.obterPedido(p.id)));

  const relogio = el('div', { class: 'dev-bar', 'aria-label': 'Relógio simulado' }, [
    el('strong', { text: `Relógio: ${formatarInstante(adapter.relogio.agora().toISOString())}` }),
    botaoRelogio('+1 hora', () => adapter.relogio.avancar(3600e3)),
    botaoRelogio('+1 dia', () => adapter.relogio.avancar(86400e3)),
    botaoRelogio('Ir pra véspera 18h da próxima diária', () => {
      const prox = completos.flatMap((c) => c.atendimentos).filter((a) => ['agendado', 'confirmado'].includes(a.status)).map((a) => a.data).sort()[0];
      if (!prox) return toast('Nenhuma diária futura');
      adapter.relogio.irPara(instanteLocal(somarDias(prox, -1), 18, 0));
    }),
    botaoRelogio('Voltar ao relógio real', () => adapter.relogio.zerar()),
  ]);

  const secPedidos = el('section', { 'aria-labelledby': 'h-pedidos' }, [el('h2', { id: 'h-pedidos', text: `Pedidos (${completos.length})` })]);
  const lista = el('ul', { class: 'lista' });
  for (const c of completos) anexar(lista, itemPedido(c, aprovadas));
  anexar(secPedidos, lista);

  const secDiaristas = el('section', { 'aria-labelledby': 'h-diaristas' }, [
    el('h2', { id: 'h-diaristas', text: `Diaristas (${diaristas.itens.length})` }),
    el('ul', { class: 'lista' }, diaristas.itens.map((d) => el('li', { dataset: { diarista: d.id } }, [
      el('div', { class: 'topo' }, [el('strong', { text: d.nome }), el('span', { class: `selo ${d.status === 'aprovada' ? 'ok' : d.status === 'reprovada' ? 'erro' : 'aviso'}`, text: d.status })]),
      el('p', { class: 'mudo', text: `${d.telefone} · ${d.disponibilidade.regioes.join(', ')}` }),
      d.status === 'pendente' ? el('div', { class: 'acoes' }, [
        botaoAcao('Aprovar', (k) => api.aprovarDiarista(d.id, {}, { chave: k })),
        botaoAcao('Reprovar', (k) => api.reprovarDiarista(d.id, {}, { chave: k }), 'btn-perigo'),
      ]) : null,
    ]))),
  ]);

  const secNotifs = el('section', { 'aria-labelledby': 'h-notifs' }, [
    el('h2', { id: 'h-notifs', text: `Notificações WhatsApp simuladas (${notifs.itens.length})` }),
    el('p', { class: 'mudo', text: `Status "simulada" = prévia gerada no mock; nada foi enviado. Eventos na fila: ${eventos.itens.filter((e) => e.status === 'pendente').length} pendente(s) de ${eventos.itens.length}.` }),
    el('ul', { class: 'lista', id: 'lista-notificacoes' }, notifs.itens.map((n) => el('li', { dataset: { template: n.template, status: n.status } }, [
      el('div', { class: 'topo' }, [
        el('strong', { text: n.template }),
        el('span', { class: `selo ${n.status === 'simulada' ? 'ok' : n.status === 'cancelada' ? 'erro' : 'aviso'}`, text: n.status }),
      ]),
      el('p', { class: 'mudo', text: `${n.destinatario.tipo} · ${n.destinatario.telefone} · ${n.status === 'pendente' ? 'agendada para' : 'em'} ${formatarInstante(n.simuladaEm || n.agendadaPara)}${n.motivo ? ` · ${n.motivo}` : ''}` }),
      n.previa ? el('p', { class: 'previa-msg', text: n.previa }) : null,
    ]))),
  ]);

  const limparBtn = el('button', { class: 'btn btn-perigo btn-pequeno', type: 'button', text: 'Apagar dados do mock' });
  limparBtn.addEventListener('click', () => {
    if (limparBtn.dataset.confirmar !== '1') { limparBtn.dataset.confirmar = '1'; limparBtn.textContent = 'Clique de novo pra apagar tudo'; return; }
    adapter.fecharBanco?.();
    const r = indexedDB.deleteDatabase('prime-mock');
    r.onsuccess = r.onblocked = () => { try { localStorage.clear(); } catch { /* ignora */ } location.reload(); };
  });

  definirAbertura({ rotulo: 'Ferramenta de desenvolvimento', titulo: 'Serviços |(dev)|', lead: 'Painel de demonstração: age como a Prime. Os botões chamam os mesmos casos de uso do app.', larga: true });
  trocar(raiz, 
    relogio, secPedidos, secDiaristas, secNotifs, el('div', { class: 'acoes' }, [limparBtn]),
  );
}

function botaoRelogio(texto, fn) {
  const b = el('button', { class: 'btn btn-secundario btn-pequeno', type: 'button', text: texto });
  b.addEventListener('click', async () => { fn(); await (await adapterAtual()).motor.tique(); render(); });
  return b;
}

function botaoAcao(texto, fn, classe = 'btn-secundario') {
  const b = el('button', { class: `btn ${classe} btn-pequeno`, type: 'button', text: texto });
  ligarAcao(b, fn, { aoSucesso: () => render() });
  return b;
}

function itemPedido({ pedido, cliente, atendimentos, pagamentos }, aprovadas) {
  const p = pedido.pacote;
  const li = el('li', { dataset: { pedido: pedido.id } }, [
    el('div', { class: 'topo' }, [
      el('strong', { text: `${cliente.nome} · ${p.frequencia === 'avulso' ? 'avulso' : `${p.quantidadeDiarias} diárias ${p.frequencia}`}` }),
      el('span', { class: 'selo', text: ROTULOS_PEDIDO[pedido.status] }),
    ]),
    el('p', { class: 'mudo' }, [
      `Total ${formatarBRL(p.totalCentavos)} · entrada ${formatarBRL(p.entradaCentavos)} · `,
      el('a', { href: url('acompanhamento/', { pedido: pedido.id }), text: 'acompanhamento' }),
    ]),
  ]);
  const pags = el('ul', { class: 'lista' }, pagamentos.map((g) => el('li', { dataset: { pagamento: g.id } }, [
    el('div', { class: 'topo' }, [
      el('span', { text: `${g.parcela === 'entrada' ? 'Entrada' : `Parcela ${g.venceEm ? formatarData(g.venceEm) : ''}`} · ${formatarBRL(g.valorCentavos)}` }),
      el('span', { class: 'selo neutro', text: ROTULOS_PAGAMENTO[g.status] }),
    ]),
    el('div', { class: 'acoes' }, [
      el('a', { class: 'btn btn-secundario btn-pequeno', href: url('pagamento/', { pagamento: g.id }), text: 'Tela do Pix' }),
      ['pendente', 'informado_pelo_cliente'].includes(g.status) ? botaoAcao('Simular confirmação da Prime', (k) => api.confirmarPagamento(g.id, { chave: k })) : null,
    ]),
  ])));
  const ats = el('ul', { class: 'lista' }, atendimentos.map((a) => {
    const botoes = eventosPossiveis(a.status, 'prime').filter((e) => !['reagendar', 'avaliar'].includes(e)).map((ev) => {
      const sessao = ['sair_a_caminho', 'iniciar', 'finalizar'].includes(ev) && a.diaristaId ? { ator: 'diarista', id: a.diaristaId } : undefined;
      return botaoAcao(ROTULO_EVENTO[ev] || ev, (k) => api.transicionarAtendimento(a.id, { evento: ev }, { chave: k, ...(sessao ? { sessao } : {}) }), ev === 'cancelar' ? 'btn-perigo' : 'btn-secundario');
    });
    let atribuir = null;
    if (['agendado', 'confirmado'].includes(a.status) && aprovadas.length) {
      const sel = el('select', { 'aria-label': `Diarista da diária ${a.sequencia}` }, aprovadas.map((d) => el('option', { value: d.id, text: d.nome, selected: d.id === a.diaristaId })));
      atribuir = el('span', { class: 'opcoes' }, [sel, botaoAcao('Atribuir', (k) => api.atribuirDiarista(a.id, { diaristaId: sel.value }, { chave: k }))]);
    }
    return el('li', { dataset: { atendimento: a.id, status: a.status } }, [
      el('div', { class: 'topo' }, [
        el('span', { text: `Diária ${a.sequencia} · ${formatarData(a.data)} · ${a.turno}${a.deslocada ? ' (deslocada)' : ''}${a.diaristaId ? ' · com diarista' : ''}` }),
        el('span', { class: 'selo', text: ROTULOS_ESTADO[a.status] }),
      ]),
      el('div', { class: 'acoes' }, [...botoes, atribuir, el('a', { class: 'btn-link', href: url('acompanhamento/', { atendimento: a.id }), text: 'linha do tempo' }),
        ['finalizado', 'avaliado'].includes(a.status) ? el('a', { class: 'btn-link', href: url('avaliacao/', { atendimento: a.id }), text: 'avaliação' }) : null]),
    ]);
  }));
  anexar(li, el('h3', { text: 'Atendimentos' }), ats, el('h3', { text: 'Pagamentos' }), pags);
  return li;
}

anexar(raiz, el('p', { class: 'carregando', text: 'Carregando…' }));
render().catch((e) => { anexar(limpar(raiz), el('p', { class: 'alerta alerta-erro', text: `Erro: ${e.message}` })); console.error(e); });
