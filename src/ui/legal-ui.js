// L1 (LGPD) na tela: caixa de aceite dos termos, novo aceite quando a versão muda (modal) e o bloco
// "Privacidade e dados" de Minha conta (consentimentos, baixar e excluir). O banco confere tudo; aqui só orienta.
import { anexar, el } from './dom.js';
import { executarAcao, mensagemErro } from './acoes.js';
import { toast } from './toast.js';
import { api } from '../services/api.js';
import { auth } from '../services/auth.js';
import { url } from '../config/app.js';
import { VERSAO_LEGAL } from '../config/legal.js';

const linkNovo = (h, t) => el('a', { href: url(h), target: '_blank', rel: 'noopener', text: t });

/** Checkbox obrigatório "Li e aceito" com os dois links. */
export function caixaAceite({ id = 'aceite-termos' } = {}) {
  const input = el('input', { type: 'checkbox', id, name: id });
  const erro = el('p', { class: 'erro-campo', id: `${id}-erro`, 'aria-live': 'polite' });
  input.setAttribute('aria-describedby', `${id}-erro`);
  const raiz = el('div', { class: 'grupo aceite-termos', dataset: { campo: 'aceite' } }, [
    el('label', { class: 'opcao', for: id }, [input, el('span', {}, ['Li e aceito os ', linkNovo('termos/', 'Termos de Uso'), ' e a ', linkNovo('privacidade/', 'Política de Privacidade'), '.'])]),
    erro,
  ]);
  input.addEventListener('change', () => { erro.textContent = ''; raiz.classList.remove('invalido'); });
  return {
    raiz, input, aceito: () => input.checked, versao: VERSAO_LEGAL,
    erro: (m) => { erro.textContent = m || ''; raiz.classList.toggle('invalido', !!m); if (m) input.focus(); },
  };
}

/** Consentimentos opcionais de marketing (desmarcados), pra gravar depois que a conta existir. */
export function caixasMarketing() {
  const itens = [['marketing_whatsapp', 'Quero receber novidades da Prime pelo WhatsApp'], ['marketing_email', 'Quero receber novidades da Prime por e-mail']];
  const inputs = itens.map(([k]) => el('input', { type: 'checkbox', name: k, value: k }));
  const raiz = el('fieldset', { class: 'grupo' }, [
    el('legend', { text: 'Opcional' }),
    el('div', { class: 'opcoes' }, itens.map(([, t], i) => el('label', { class: 'opcao' }, [inputs[i], el('span', { text: t })]))),
    el('p', { class: 'ajuda', text: 'Sem marcar, você recebe só as mensagens do seu atendimento. Dá pra mudar quando quiser em Minha conta.' }),
  ]);
  return { raiz, marcados: () => inputs.filter((i) => i.checked).map((i) => i.value) };
}

/**
 * Novo aceite: se a versão vigente ainda não foi aceita por esta conta, abre um modal que só fecha aceitando
 * (ou saindo da conta). Devolve a situação legal (ou null se a consulta falhar: não trava a página).
 */
export async function exigirAceite({ destinoSair = '' } = {}) {
  let s;
  try { s = await api.situacaoLegal(); } catch { return null; }
  if (!s.pedirAceite || s.aceitouVigente) return s;
  await new Promise((resolve) => {
    const erro = el('p', { class: 'alerta alerta-erro', role: 'alert', hidden: true });
    const aceitar = el('button', { class: 'btn btn-primary', type: 'button', text: 'Li e aceito' });
    const sair = el('button', { class: 'btn btn-secundario', type: 'button', text: 'Agora não, sair' });
    const d = el('dialog', { class: 'modal-legal', 'aria-labelledby': 'titulo-aceite', 'aria-describedby': 'texto-aceite' }, [
      el('h2', { id: 'titulo-aceite', text: 'Atualizamos nossos termos' }),
      el('p', { id: 'texto-aceite' }, ['Para continuar, leia e aceite os ', linkNovo('termos/', 'Termos de Uso'), ' e a ', linkNovo('privacidade/', 'Política de Privacidade'), ` (versão ${s.versaoVigente}).`]),
      erro, el('div', { class: 'acoes' }, [aceitar, sair]),
    ]);
    d.addEventListener('cancel', (ev) => ev.preventDefault()); // Esc não fecha sem decidir
    aceitar.addEventListener('click', () => executarAcao(aceitar, () => api.registrarAceite(s.versaoVigente), {
      aoSucesso: () => { d.close(); d.remove(); s.aceitouVigente = true; resolve(); },
      aoErro: (e) => { erro.hidden = false; erro.textContent = mensagemErro(e); },
    }));
    sair.addEventListener('click', async () => { await auth.sair(); location.href = url(destinoSair); });
    document.body.append(d);
    d.showModal();
    aceitar.focus();
  });
  return s;
}

function baixarJson(dados) {
  const blob = new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `meus-dados-prime-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** Minha conta: consentimentos de marketing, "Baixar meus dados" e "Excluir meus dados". */
/**
 * Um consentimento por vez (revisão do GPT): a caixa fica desabilitada até o banco responder e passa a mostrar o valor
 * CONFIRMADO por ele; erro volta ao último valor confirmado (não inverte uma escolha mais nova).
 */
function ligarConsentimento(i, tipo, inicial, opcoes, mensagem) {
  let confirmado = inicial;
  i.addEventListener('change', async () => {
    const pedido = i.checked;
    i.disabled = true;
    try {
      const atual = await api.definirConsentimento(tipo, pedido, opcoes);
      confirmado = !!atual?.[tipo];
      toast(mensagem(confirmado), 'ok');
    } catch (e) {
      toast(mensagemErro(e), 'erro', 6000);
    } finally {
      i.checked = confirmado;
      i.disabled = false;
    }
  });
}

/** Quando a situação legal não carregou (rede): aviso com "tentar de novo", em vez de sumir com o bloco. */
function semSituacao() {
  const b = el('button', { class: 'btn btn-secundario btn-pequeno', type: 'button', text: 'Tentar de novo' });
  b.addEventListener('click', () => location.reload());
  return el('section', { class: 'cartao', id: 'privacidade', style: 'margin-top:28px' }, [
    el('h2', { text: 'Privacidade e dados', style: 'margin-top:0' }),
    el('p', { class: 'alerta alerta-erro', role: 'alert', text: 'Não conseguimos carregar suas preferências de privacidade agora.' }),
    el('div', { class: 'acoes' }, [b]),
  ]);
}

export function blocoPrivacidade(s) {
  if (!s) return semSituacao();
  const c = s.consentimentos || {};
  const opcoes = [['marketing_whatsapp', 'Novidades da Prime pelo WhatsApp'], ['marketing_email', 'Novidades da Prime por e-mail']];
  const lista = el('div', { class: 'opcoes' }, opcoes.map(([k, t]) => {
    const i = el('input', { type: 'checkbox', name: k, checked: !!c[k], dataset: { consentimento: k } });
    ligarConsentimento(i, k, !!c[k], {}, (v) => (v ? 'Autorização registrada.' : 'Autorização retirada. A partir de agora você não recebe mais essas mensagens.'));
    return el('label', { class: 'opcao' }, [i, el('span', { text: t })]);
  }));
  const acoes = el('div', { class: 'acoes', style: 'margin-top:16px' });
  const situacao = el('p', { class: 'alerta alerta-info', id: 'exclusao-andamento', hidden: !s.exclusaoEmAndamento, text: 'Seu pedido de exclusão foi registrado. A Prime confere se não há diária ou pagamento em aberto e avisa você.' });
  if (s.portal) {
    const baixar = el('button', { class: 'btn btn-secundario btn-pequeno', type: 'button', text: 'Baixar meus dados' });
    baixar.addEventListener('click', () => executarAcao(baixar, () => api.meusDados(), { aoSucesso: baixarJson }));
    const excluir = el('button', { class: 'btn btn-secundario btn-pequeno', type: 'button', text: 'Excluir meus dados', hidden: s.exclusaoEmAndamento });
    excluir.addEventListener('click', () => confirmarExclusao(excluir, situacao));
    anexar(acoes, baixar, excluir);
  } else {
    anexar(acoes, el('p', { class: 'mudo', text: 'Para receber seus dados ou pedir a exclusão, fale com a Prime.' }));
  }
  return el('section', { class: 'cartao', id: 'privacidade', 'aria-labelledby': 'h-priv', style: 'margin-top:28px' }, [
    el('h2', { id: 'h-priv', text: 'Privacidade e dados', style: 'margin-top:0' }),
    el('p', { class: 'mudo', text: 'Mensagens do seu atendimento chegam sempre. As de novidades, só se você autorizar:' }),
    lista, acoes, situacao,
    el('p', { class: 'mudo', style: 'margin-top:12px' }, ['Detalhes na ', el('a', { href: url('privacidade/'), text: 'Política de Privacidade' }), '.']),
  ]);
}

function confirmarExclusao(botao, situacao) {
  const motivo = el('textarea', { id: 'motivo-exclusao', rows: 3, maxlength: 500 });
  const confirmar = el('button', { class: 'btn btn-primary', type: 'button', text: 'Pedir a exclusão' });
  const voltar = el('button', { class: 'btn btn-secundario', type: 'button', text: 'Voltar' });
  const erro = el('p', { class: 'alerta alerta-erro', role: 'alert', hidden: true });
  const d = el('dialog', { class: 'modal-legal', 'aria-labelledby': 'titulo-exclusao' }, [
    el('h2', { id: 'titulo-exclusao', text: 'Excluir meus dados' }),
    el('p', { text: 'A Prime apaga seus dados de contato e identificação e encerra seu acesso. Pedidos e pagamentos ficam guardados pelo prazo que a lei exige. Se houver diária ou pagamento em aberto, a Prime fala com você antes.' }),
    el('label', { for: 'motivo-exclusao', text: 'Quer contar o motivo? (opcional)' }), motivo,
    erro, el('div', { class: 'acoes' }, [confirmar, voltar]),
  ]);
  voltar.addEventListener('click', () => { d.close(); d.remove(); botao.focus(); });
  confirmar.addEventListener('click', () => executarAcao(confirmar, () => api.pedirExclusao(motivo.value.trim()), {
    aoSucesso: () => { d.close(); d.remove(); botao.hidden = true; situacao.hidden = false; toast('Pedido de exclusão registrado.', 'ok'); },
    aoErro: (e) => { erro.hidden = false; erro.textContent = mensagemErro(e); },
  }));
  document.body.append(d);
  d.showModal();
  motivo.focus();
}

/** Área da diarista: consentimento de localização (opcional, pro acompanhamento do atendimento). */
export function blocoLocalizacao(s) {
  if (!s) return semSituacao();
  const i = el('input', { type: 'checkbox', name: 'localizacao_profissional', checked: !!s.consentimentos?.localizacao_profissional, dataset: { consentimento: 'localizacao_profissional' } });
  ligarConsentimento(i, 'localizacao_profissional', !!s.consentimentos?.localizacao_profissional, { origem: 'agenda_diarista' }, (v) => (v ? 'Autorização registrada.' : 'Autorização retirada.'));
  return el('section', { class: 'cartao', id: 'privacidade', 'aria-labelledby': 'h-priv', style: 'margin-top:28px' }, [
    el('h2', { id: 'h-priv', text: 'Privacidade', style: 'margin-top:0' }),
    el('label', { class: 'opcao' }, [i, el('span', {}, ['Autorizo a Prime a ver minha localização aproximada durante as diárias', el('small', { text: 'Opcional. Só a equipe da Prime vê, e ela é apagada em 30 dias. Você pode retirar quando quiser.' })])]),
    el('p', { class: 'mudo', style: 'margin-top:12px' }, ['Detalhes na ', el('a', { href: url('privacidade/'), text: 'Política de Privacidade' }), '. Para receber seus dados ou pedir a exclusão, fale com a Prime.']),
  ]);
}

