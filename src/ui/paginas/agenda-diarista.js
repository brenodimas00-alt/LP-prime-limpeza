// diarista/agenda/: atendimentos atribuídos, com "A caminho", "Iniciei" e "Finalizei" (ator diarista).
// Diarista pendente ou reprovada vê o status do cadastro.
import { el } from '../dom.js';
import { montarPagina, definirAbertura, ativarReveal } from '../layout.js';
import { api } from '../../services/api.js';
import { auth, exigirPapel } from '../../services/auth.js';
import { executarAcao } from '../acoes.js';
import { telaCarregando, telaErro, selo } from '../comum.js';
import { url } from '../../config/app.js';
import { ROTULOS_ESTADO } from '../../domain/estados.js';
import { formatarData, formatarDataCurta, dataNoFuso } from '../../domain/calendario.js';
import { TURNOS } from '../../domain/modelo.js';
import { CONFIG_PRECOS as CFG } from '../../config/precos.js';

const raiz = el('div');
montarPagina(raiz);
const sessao = exigirPapel('diarista', url('diarista/entrar/'));
const P = CFG.PRECOS;
const PROXIMO = { confirmado: ['sair_a_caminho', 'Estou a caminho'], diarista_a_caminho: ['iniciar', 'Iniciei a diária'], em_andamento: ['finalizar', 'Finalizei'] };

async function iniciar() {
  if (!sessao) return;
  telaCarregando(raiz);
  try {
    const { diarista, itens } = await api.listarAtendimentosDaDiarista(sessao.id);
    const nome = diarista.nome.split(' ')[0];
    const sair = el('button', { class: 'btn btn-secundario btn-pequeno', type: 'button', text: 'Sair' });
    sair.addEventListener('click', async () => { await auth.sair(); location.href = url(''); });
    if (diarista.status !== 'aprovada') {
      definirAbertura({ rotulo: 'Área da diarista', titulo: `Oi, |${nome}|`, lead: diarista.status === 'pendente' ? 'Seu cadastro está em análise.' : 'Seu cadastro não foi aprovado desta vez.' });
      raiz.replaceChildren(
        el('div', { class: 'cartao principal reveal', dataset: { cadastro: diarista.status } }, [
          el('h2', { text: diarista.status === 'pendente' ? 'Cadastro em análise' : 'Cadastro não aprovado', style: 'margin-top:0' }),
          el('p', { text: diarista.status === 'pendente' ? 'A Prime confere os documentos em até 5 dias úteis e responde pelo WhatsApp. Quando aprovado, sua agenda aparece aqui.' : (diarista.decisao?.motivo ? `Motivo informado: ${diarista.decisao.motivo}.` : 'Se quiser entender o motivo, fale com a Prime pelos contatos do rodapé.') }),
        ]),
        el('div', { class: 'acoes' }, [sair]),
      );
      ativarReveal(raiz);
      return;
    }
    const hoje = dataNoFuso(new Date().toISOString(), CFG.regrasNotificacao.fuso);
    const ativos = itens.filter((i) => !['cancelado', 'avaliado', 'finalizado'].includes(i.atendimento.status));
    const passados = itens.filter((i) => ['avaliado', 'finalizado'].includes(i.atendimento.status));
    definirAbertura({ rotulo: 'Área da diarista', titulo: `Sua agenda, |${nome}|`, lead: ativos.length ? `${ativos.length} ${ativos.length === 1 ? 'diária marcada' : 'diárias marcadas'}. Avise cada etapa pelos botões: a cliente recebe no WhatsApp.` : 'Nenhuma diária marcada por enquanto. As próximas chegam pelo WhatsApp.' });

    const item = (i) => {
      const a = i.atendimento;
      const c = i.cliente || {};
      const prox = PROXIMO[a.status];
      const botao = prox ? el('button', { class: 'btn btn-primary btn-pequeno', type: 'button', text: prox[1], dataset: { evento: prox[0] } }) : null;
      if (botao) botao.addEventListener('click', () => executarAcao(botao, (k) => api.transicionarAtendimento(a.id, { evento: prox[0] }, { chave: k }), { aoSucesso: () => iniciar() }));
      const ehHoje = a.data === hoje;
      return el('li', { dataset: { atendimento: a.id, status: a.status } }, [
        el('div', { class: 'topo' }, [
          el('strong', { text: `${ehHoje ? 'Hoje, ' : ''}${formatarDataCurta(a.data)} · ${TURNOS[a.turno]}` }),
          selo(ROTULOS_ESTADO[a.status], a.status === 'cancelado' ? 'erro' : ['finalizado', 'avaliado'].includes(a.status) ? 'ok' : ''),
        ]),
        el('p', { class: 'mudo', text: `${P.tiposServico[i.pacote?.tipoServico]?.nome || 'Diária'}, ${i.pacote?.duracaoHoras || ''} horas${i.pacote?.passadoriaCombinada ? ', com passadoria' : ''} · ${c.nome || ''}, ${c.bairro || ''}, ${c.cidade || ''}` }),
        c.endereco ? el('p', { text: `Endereço: ${c.endereco.logradouro}, ${c.endereco.numero}${c.endereco.complemento ? ` ${c.endereco.complemento}` : ''}, ${c.endereco.bairro}. WhatsApp da cliente: ${c.telefone}` }) : el('p', { class: 'mudo', text: 'O endereço completo aparece na véspera.' }),
        a.status === 'agendado' ? el('p', { class: 'mudo', text: 'Aguardando a confirmação da entrada pela cliente.' }) : null,
        botao ? el('div', { class: 'acoes', style: 'margin-top:10px' }, [botao]) : null,
      ]);
    };
    raiz.replaceChildren(
      el('h2', { text: 'Próximas diárias' }),
      ativos.length ? el('ul', { class: 'lista reveal' }, ativos.map(item)) : el('p', { class: 'alerta alerta-info', text: 'Nada marcado. Quando a Prime atribuir uma diária a você, ela aparece aqui e no WhatsApp.' }),
      passados.length ? el('h2', { text: 'Realizadas' }) : null,
      passados.length ? el('ul', { class: 'lista reveal' }, passados.map((i) => el('li', {}, [el('div', { class: 'topo' }, [el('span', { text: `${formatarData(i.atendimento.data)} · ${i.cliente?.bairro || ''}` }), selo(ROTULOS_ESTADO[i.atendimento.status], 'ok')])]))) : null,
      el('div', { class: 'acoes' }, [sair]),
    );
    ativarReveal(raiz);
  } catch (e) { telaErro(raiz, e); }
}

iniciar();
