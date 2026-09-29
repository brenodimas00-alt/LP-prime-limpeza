// P4: ocorrência pós-atendimento pela cliente (acompanhamento da diária). Tipo, descrição e foto opcional; os chamados
// abertos aparecem com a situação e os comentários da Prime. O banco confere dona, prazo (30 dias) e limite diário.
import { anexar, el, trocar } from './dom.js';
import { api } from '../services/api.js';
import { executarAcao, mensagemErro } from './acoes.js';
import { selo } from './comum.js';
import { formatarInstante } from '../domain/calendario.js';

export const TIPOS_OCORRENCIA = { dano: 'Algo foi danificado', item_nao_feito: 'Algo combinado não foi feito', atraso: 'Atraso', comportamento: 'Comportamento da profissional', outro: 'Outro assunto' };
export const ESTADOS_OCORRENCIA = { aberto: 'Aberto', em_analise: 'Em análise', resolvido: 'Resolvido' };
const SELO = { aberto: 'aviso', em_analise: 'aviso', resolvido: 'ok' };

export async function blocoOcorrencias(atendimento, aoMudar) {
  const lista = await api.listarOcorrencias({ atendimentoId: atendimento.id }).catch(() => []);
  const sec = el('section', { class: 'cartao reveal', id: 'ocorrencias', 'aria-labelledby': 'h-oc', style: 'margin-top:20px' }, [
    el('h2', { id: 'h-oc', text: 'Algum problema com a diária?', style: 'margin-top:0' }),
    lista.length ? el('ul', { class: 'lista' }, lista.map((o) => el('li', { dataset: { ocorrencia: o.id } }, [
      el('div', { class: 'topo' }, [el('strong', { text: TIPOS_OCORRENCIA[o.tipo] }), selo(ESTADOS_OCORRENCIA[o.estado], SELO[o.estado])]),
      el('p', { style: 'margin:6px 0 0', text: o.descricao }),
      ...o.historico.filter((h) => h.comentario).map((h) => el('p', { class: 'mudo', style: 'margin:6px 0 0', text: `Prime, ${formatarInstante(h.em)}: ${h.comentario}` })),
    ]))) : el('p', { class: 'mudo', text: 'Se algo não saiu como combinado, conte pra Prime por aqui. A equipe analisa e responde.' }),
  ]);
  const abrir = el('button', { class: 'btn btn-secundario', type: 'button', text: 'Relatar um problema' });
  abrir.addEventListener('click', () => formulario(atendimento, sec, aoMudar));
  anexar(sec, el('div', { class: 'acoes' }, [abrir]));
  return sec;
}

function formulario(atendimento, sec, aoMudar) {
  const dlg = el('dialog', { class: 'modal-legal', 'aria-labelledby': 'titulo-oc' });
  const tipo = el('select', { id: 'oc-tipo' }, [el('option', { value: '', text: 'Escolha' }), ...Object.entries(TIPOS_OCORRENCIA).map(([v, t]) => el('option', { value: v, text: t }))]);
  const desc = el('textarea', { id: 'oc-descricao', rows: 5, maxlength: 1000 });
  const foto = el('input', { type: 'file', id: 'oc-foto', accept: 'image/jpeg,image/png' });
  const aviso = el('p', { class: 'alerta alerta-erro', role: 'alert', hidden: true });
  const enviar = el('button', { class: 'btn btn-primary btn-pequeno', type: 'button', text: 'Enviar para a Prime' });
  enviar.addEventListener('click', () => executarAcao(enviar, async (k) => {
    aviso.hidden = true;
    if (!tipo.value) throw Object.assign(new Error('Escolha o tipo do problema'), { codigo: 'DADOS_INVALIDOS' });
    if (desc.value.trim().length < 10) throw Object.assign(new Error('Conte o que aconteceu (pelo menos 10 caracteres)'), { codigo: 'DADOS_INVALIDOS' });
    const r = await api.abrirOcorrencia(atendimento.id, { tipo: tipo.value, descricao: desc.value }, { chave: k });
    if (foto.files[0]) {
      try { await api.enviarFotoOcorrencia(r.ocorrencia.id, foto.files[0]); } catch (e) { return { ...r, erroFoto: mensagemErro(e) }; }
    }
    return r;
  }, {
    aoSucesso: (r) => { dlg.close(); trocar(sec, el('p', { class: 'alerta alerta-ok', role: 'status', text: r.erroFoto ? `Recebemos seu relato, mas a foto não foi: ${r.erroFoto}` : 'Recebemos seu relato. A Prime analisa e responde pelo WhatsApp.' })); aoMudar?.(); },
    aoErro: (e) => { aviso.hidden = false; aviso.textContent = mensagemErro(e); },
  }));
  anexar(dlg,
    el('h2', { id: 'titulo-oc', text: 'Relatar um problema' }),
    el('label', { for: 'oc-tipo', class: 'rotulo', text: 'O que aconteceu?' }), tipo,
    el('label', { for: 'oc-descricao', class: 'rotulo', text: 'Conte com detalhes' }), desc,
    el('label', { for: 'oc-foto', class: 'rotulo', text: 'Foto (opcional, JPG ou PNG até 5 MB)' }), foto,
    aviso,
    el('div', { class: 'acoes' }, [enviar, el('button', { class: 'btn btn-secundario btn-pequeno', type: 'button', text: 'Cancelar', on: { click: () => dlg.close() } })]));
  dlg.addEventListener('close', () => dlg.remove());
  document.body.appendChild(dlg);
  dlg.showModal();
}
