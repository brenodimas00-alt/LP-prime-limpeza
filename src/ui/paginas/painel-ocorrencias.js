// P4 no painel (backend real): chamados de ocorrência (aberto, em análise, resolvido, com comentário que a cliente vê e
// o C15 avisa), checklist por serviço (só prime_admin edita) e os check-ins da diária (horário e localização aproximada).
import { el, param } from '../dom.js';
import { api } from '../../services/api.js';
import { executarAcao, mensagemErro } from '../acoes.js';
import { selo } from '../comum.js';
import { url } from '../../config/app.js';
import { formatarDataCurta, formatarInstante } from '../../domain/calendario.js';
import { TIPOS_OCORRENCIA, ESTADOS_OCORRENCIA } from '../ocorrencia-ui.js';
import { CONFIG_PRECOS } from '../../config/precos.js';

const SELO = { aberto: 'aviso', em_analise: 'aviso', resolvido: 'ok' };
const ROTULO_CHECKIN = { sair_a_caminho: 'Saiu (a caminho)', iniciar: 'Chegou (início)', finalizar: 'Check-out' };

export async function abaOcorrencias(recarregar) {
  const estado = ['aberto', 'em_analise', 'resolvido'].includes(param('estado')) ? param('estado') : null;
  const lista = await api.listarOcorrencias(estado ? { estado } : {});
  const filtro = el('p', { class: 'opcoes', style: 'margin-top:0' }, [['', 'Todos'], ...Object.entries(ESTADOS_OCORRENCIA)].map(([v, t]) =>
    el('a', { class: `btn btn-pequeno ${v === (estado || '') ? 'btn-primary' : 'btn-secundario'}`, href: url('painel/', { aba: 'ocorrencias', ...(v ? { estado: v } : {}) }), text: t })));
  if (!lista.length) return el('div', { class: 'reveal' }, [filtro, el('p', { class: 'alerta alerta-info', text: 'Nenhuma ocorrência aqui.' })]);
  return el('div', { class: 'reveal' }, [filtro,
    el('p', { class: 'mudo', text: 'Mudar a situação avisa a cliente no WhatsApp. O comentário aparece pra ela no acompanhamento da diária.' }),
    el('ul', { class: 'lista' }, lista.map((o) => cartao(o, recarregar)))]);
}

function cartao(o, recarregar) {
  const sel = el('select', { 'aria-label': 'Nova situação', id: `oc-estado-${o.id}` }, Object.entries(ESTADOS_OCORRENCIA).map(([v, t]) => el('option', { value: v, text: t, selected: v === o.estado })));
  const com = el('input', { type: 'text', maxlength: 500, 'aria-label': 'Comentário pra cliente (opcional)', placeholder: 'Comentário pra cliente (opcional)', id: `oc-com-${o.id}` });
  const salvar = el('button', { class: 'btn btn-primary btn-pequeno', type: 'button', text: 'Salvar' });
  salvar.addEventListener('click', () => executarAcao(salvar, (k) => api.atualizarOcorrencia(o.id, { estado: sel.value, comentario: com.value }, { chave: k }), { sucesso: 'Chamado atualizado.', aoSucesso: recarregar }));
  const foto = o.temFoto ? el('button', { class: 'btn-link', type: 'button', text: 'Ver foto' }) : null;
  foto?.addEventListener('click', () => executarAcao(foto, async () => { const r = await api.abrirFotoOcorrencia(o.id); window.open(r.url, '_blank', 'noopener'); }));
  return el('li', { dataset: { ocorrencia: o.id, estado: o.estado } }, [
    el('div', { class: 'topo' }, [el('strong', { text: `${o.cliente} · diária de ${formatarDataCurta(o.data)}` }), selo(ESTADOS_OCORRENCIA[o.estado], SELO[o.estado])]),
    el('p', { class: 'mudo', style: 'margin:4px 0', text: `${TIPOS_OCORRENCIA[o.tipo]}${o.profissional ? ` · profissional: ${o.profissional}` : ''} · aberta em ${formatarInstante(o.criadoEm)}` }),
    el('p', { style: 'margin:6px 0', text: o.descricao }),
    el('ol', { class: 'historico-oc' }, o.historico.map((h) => el('li', { text: `${formatarInstante(h.em)}: ${ESTADOS_OCORRENCIA[h.estado]}${h.comentario ? `. ${h.comentario}` : ''}` }))),
    el('div', { class: 'opcoes', style: 'margin-top:8px' }, [sel, com, salvar, foto, el('a', { class: 'btn-link', href: url('acompanhamento/', { atendimento: o.atendimentoId }), text: 'Abrir a diária' })]),
  ]);
}

/** Checklist por serviço (aba Configurações): um item por linha. */
export async function blocoChecklists(admin) {
  const nomes = CONFIG_PRECOS.PRECOS.tiposServico;
  const blocos = [];
  for (const [tipo, s] of Object.entries(nomes)) {
    const area = el('textarea', { rows: 6, id: `checklist-${tipo}`, disabled: !admin, 'aria-label': `Checklist de ${s.nome}`, style: 'width:100%' });
    blocos.push({ tipo, area, raiz: el('div', { class: 'checklist-servico', dataset: { checklist: tipo } }, [el('label', { for: `checklist-${tipo}`, class: 'rotulo', text: s.nome }), area]) });
  }
  const atuais = await api.listarChecklists().catch(() => []);
  for (const b of blocos) b.area.value = (atuais.find((x) => x.tipoServico === b.tipo)?.itens || []).join('\n');
  const salvar = admin ? el('button', { class: 'btn btn-primary btn-pequeno', type: 'button', text: 'Salvar checklists' }) : null;
  salvar?.addEventListener('click', () => executarAcao(salvar, async () => {
    for (const b of blocos) await api.salvarChecklist(b.tipo, b.area.value.split('\n').map((x) => x.trim()).filter(Boolean));
  }, { sucesso: 'Checklists salvos.' }));
  return el('section', { style: 'margin-top:28px' }, [
    el('h2', { text: 'Checklist do check-out' }),
    el('p', { class: 'mudo', text: 'Um item por linha. A profissional marca cada um no fim da diária; o que não foi feito exige o motivo.' }),
    ...blocos.map((b) => b.raiz), salvar ? el('div', { class: 'acoes' }, [salvar]) : null,
  ]);
}

/** Check-ins da diária (horário e, com autorização da profissional, localização aproximada). */
export async function blocoCheckins(atendimentoId) {
  try {
    const cs = await api.checkinsAtendimento(atendimentoId);
    if (!cs.length) return el('p', { class: 'mudo', text: 'Sem check-in ainda.' });
    return el('ul', { class: 'lista checkins' }, cs.map((c) => el('li', {}, [
      `${ROTULO_CHECKIN[c.evento]}: ${formatarInstante(c.em)}`,
      c.lat !== undefined ? el('a', { href: `https://www.openstreetmap.org/?mlat=${c.lat}&mlon=${c.lon}#map=16/${c.lat}/${c.lon}`, target: '_blank', rel: 'noopener', text: ' · ver no mapa (aproximado)' }) : null,
    ])));
  } catch (e) { return el('p', { class: 'mudo', text: mensagemErro(e) }); }
}
