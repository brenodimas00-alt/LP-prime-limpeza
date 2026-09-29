// Conta com mais de um papel (ex. cliente e equipe da Prime): escolha da área depois de entrar e troca de área.
// A escolha só muda o papel que a tela pede ao banco (header x-papel); o banco confere se a conta tem esse papel.
import { el, trocar } from './dom.js';
import { definirAbertura, ativarReveal } from './layout.js';
import { auth } from '../services/auth.js';
import { url } from '../config/app.js';
import { mensagemErro } from './acoes.js';

const AREAS = {
  cliente: { titulo: 'Área da cliente', texto: 'Suas solicitações, pagamentos e dados.', destino: 'minha-conta/' },
  prime: { titulo: 'Painel da Prime', texto: 'Operação, agenda, pagamentos e automações.', destino: 'painel/' },
  diarista: { titulo: 'Agenda da profissional', texto: 'Suas diárias e o check-in.', destino: 'diarista/agenda/' },
};

const IR_PARA = { cliente: 'Ir para a área da cliente', prime: 'Ir para o painel da Prime', diarista: 'Ir para a agenda da profissional' };

/** Destino da área (a equipe com troca de senha pendente vai pra criar a senha). */
export function destinoDaArea(s) {
  if (s?.ator === 'prime' && s.trocaSenha) return 'painel/entrar/';
  return AREAS[s?.ator]?.destino || 'entrar/';
}

async function irPara(ator, aviso) {
  try {
    const s = await auth.escolherArea(ator);
    location.href = url(destinoDaArea(s));
  } catch (e) { aviso.hidden = false; aviso.textContent = mensagemErro(e); }
}

/** Tela "Onde você quer entrar?" com um botão por área da conta. */
export function telaEscolhaArea(raiz, sessao) {
  definirAbertura({ rotulo: 'Sua conta', titulo: 'Onde você quer |entrar|?', lead: 'Sua conta tem acesso a mais de uma área. Dá pra trocar depois, pelo botão ao lado de Sair.' });
  const aviso = el('p', { class: 'alerta alerta-erro', role: 'alert', hidden: true });
  const botoes = sessao.areas.filter((a) => AREAS[a.ator]).map((a) => el('button', {
    class: 'cartao principal escolha-area reveal', type: 'button', dataset: { area: a.ator },
    on: { click: (ev) => { ev.currentTarget.disabled = true; irPara(a.ator, aviso); } },
  }, [el('strong', { text: AREAS[a.ator].titulo }), el('span', { class: 'mudo', text: AREAS[a.ator].texto })]));
  trocar(raiz, aviso, el('div', { class: 'escolhas-area' }, botoes));
  ativarReveal(raiz);
  botoes[0]?.focus();
}

/** Link discreto pra outra área, nas áreas logadas de uma conta com mais de um papel (null quando só tem uma). */
export function linkTrocarArea(sessao) {
  const outras = (sessao?.areas || []).filter((a) => a.ator !== sessao.ator && AREAS[a.ator]);
  if (!outras.length) return null;
  const aviso = el('span', { class: 'alerta alerta-erro', role: 'alert', hidden: true });
  const alvo = outras.length === 1 ? outras[0].ator : null;
  const rotulo = alvo ? IR_PARA[alvo] : 'Trocar de área';
  const b = el('button', { class: 'btn btn-secundario btn-pequeno', type: 'button', text: rotulo, dataset: { trocarArea: alvo || 'escolher' } });
  b.addEventListener('click', () => { if (alvo) irPara(alvo, aviso); else location.href = url('entrar/', { escolher: 1 }); });
  return el('span', { class: 'trocar-area' }, [b, aviso]);
}
