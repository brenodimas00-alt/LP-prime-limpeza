// avaliacao/?atendimento=ID: 4 critérios de 1 a 5, média, comentário opcional. Só abre com a diária finalizada;
// se já avaliada, mostra a avaliação.
import { el, param } from '../dom.js';
import { montarPagina } from '../layout.js';
import { api } from '../../services/api.js';
import { executarAcao } from '../acoes.js';
import { telaCarregando, telaErro, sessaoCliente } from '../comum.js';
import { url } from '../../config/app.js';
import { formatarData } from '../../domain/calendario.js';

const raiz = el('div');
montarPagina(raiz);

const CRITERIOS = [
  ['pontualidade', 'Pontualidade', 'Chegou no horário combinado?'],
  ['qualidade', 'Qualidade da limpeza', 'O resultado ficou no padrão?'],
  ['cuidado', 'Cuidado com a casa', 'Cuidou dos seus objetos e móveis?'],
  ['comunicacao', 'Comunicação', 'Foi educada e clara?'],
];

const virgula = (n) => String(n).replace('.', ',');

async function iniciar() {
  const id = param('atendimento');
  telaCarregando(raiz);
  try {
    if (!id) throw { codigo: 'NAO_ENCONTRADO' };
    const r = await api.obterAtendimento(id);
    const a = r.atendimento;
    const titulo = el('h1', { text: `Como foi a diária de ${formatarData(a.data)}?` });
    if (a.status === 'avaliado') {
      const av = r.avaliacao || (await api.obterAvaliacaoDoAtendimento(id));
      return mostrarAvaliacao(av, a);
    }
    if (a.status !== 'finalizado') {
      raiz.replaceChildren(titulo, el('p', { class: 'alerta alerta-info', role: 'status', text: 'A avaliação abre quando a diária for finalizada.' }),
        el('a', { class: 'btn btn-secundario', href: url('acompanhamento/', { atendimento: a.id }), text: 'Acompanhar a diária' }));
      return undefined;
    }
    return formulario(r, titulo);
  } catch (e) { return telaErro(raiz, e); }
}

function mostrarAvaliacao(av, a) {
  raiz.replaceChildren(
    el('h1', { text: 'Obrigada pela avaliação!' }),
    el('div', { class: 'cartao destaque', dataset: { avaliacao: av.id } }, [
      el('p', { class: 'valor-grande', text: `${virgula(av.notaFinal)} de 5` }),
      el('dl', { class: 'dados' }, CRITERIOS.flatMap(([k, rot]) => [el('dt', { text: rot }), el('dd', { text: `${av.notas[k]} de 5` })])),
      av.comentario ? el('p', { style: 'margin-top:14px', text: `“${av.comentario}”` }) : null,
    ]),
    el('p', { style: 'margin-top:18px' }, [el('a', { href: url('acompanhamento/', { atendimento: a.id }), text: 'Voltar pra diária' })]),
  );
}

function formulario(r, titulo) {
  const a = r.atendimento;
  const form = el('form', { novalidate: true, 'aria-describedby': 'media' });
  const media = el('p', { id: 'media', class: 'valor-grande', 'aria-live': 'polite', text: '–' });
  const erro = el('p', { class: 'alerta alerta-erro', role: 'alert', hidden: true });
  for (const [k, rot, ajuda] of CRITERIOS) {
    const fs = el('fieldset', { class: 'grupo', dataset: { criterio: k } }, [
      el('legend', { text: rot }), el('p', { class: 'mudo', text: ajuda, style: 'margin:-4px 0 8px' }),
      el('div', { class: 'opcoes notas' }, [1, 2, 3, 4, 5].map((n) => el('label', { class: 'opcao' }, [
        el('input', { type: 'radio', name: k, value: n, required: true, 'aria-label': `${rot}: ${n} de 5` }), el('span', { text: String(n), 'aria-hidden': 'true' }),
      ]))),
    ]);
    form.append(fs);
  }
  const comentario = el('textarea', { id: 'comentario', name: 'comentario', maxlength: 500, rows: 4 });
  const cont = el('span', { class: 'ajuda', text: '0/500' });
  comentario.addEventListener('input', () => { cont.textContent = `${comentario.value.length}/500`; });
  form.append(el('div', { class: 'campo' }, [el('label', { for: 'comentario', text: 'Comentário (opcional)' }), comentario, cont]));
  const enviar = el('button', { class: 'btn btn-primary', type: 'submit', text: 'Enviar avaliação' });
  form.append(erro, el('div', { class: 'acoes' }, [enviar]));

  const notas = () => Object.fromEntries(CRITERIOS.map(([k]) => [k, Number(form.querySelector(`input[name=${k}]:checked`)?.value) || 0]));
  form.addEventListener('change', () => {
    const n = notas();
    const vals = Object.values(n).filter(Boolean);
    media.textContent = vals.length ? `${virgula(Math.round((vals.reduce((s, x) => s + x, 0) / vals.length) * 10) / 10)} de 5` : '–';
  });
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const n = notas();
    const faltando = CRITERIOS.filter(([k]) => !n[k]).map(([, rot]) => rot);
    if (faltando.length) {
      erro.hidden = false; erro.textContent = `Dê uma nota pra: ${faltando.join(', ')}.`;
      form.querySelector(`[data-criterio="${CRITERIOS.find(([k]) => !n[k])[0]}"] input`).focus();
      return;
    }
    erro.hidden = true;
    executarAcao(enviar, (k) => api.criarAvaliacao(a.id, { notas: n, comentario: comentario.value }, { chave: k, ...sessaoCliente(r.pedido.clienteId) }), {
      id: `avaliacao:${a.id}`,
      aoSucesso: (res) => mostrarAvaliacao(res.avaliacao, res.atendimento),
      aoErro: (e) => {
        if (e.codigo === 'JA_AVALIADO') return iniciar();
        erro.hidden = false; erro.textContent = e.message || 'Não foi possível enviar. Tente de novo.';
        return undefined;
      },
    });
  });
  raiz.replaceChildren(titulo, el('p', { class: 'lead', text: 'Sua avaliação define quem continua na plataforma. Leva menos de um minuto.' }),
    el('div', { class: 'cartao' }, [form, el('p', { class: 'mudo', text: 'Média:' }), media]));
}

iniciar();
