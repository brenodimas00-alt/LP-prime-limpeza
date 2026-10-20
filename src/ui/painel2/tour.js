// Painel v2, B5: tour opcional de primeiro acesso (5 passos). Não bloqueia: no 1º acesso aparece um convite discreto
// ("Começar" / "Agora não"); depois, só pela Ajuda ("Ver o tour de novo"). Tour de cartões é esquecido (NN/g), então é
// curto, pula a qualquer momento (Esc ou "Pular") e cada passo aponta pra coisa real da tela.
import { el, trocar } from '../dom.js';
import { botao, guardado } from './componentes.js';

const PASSOS = [
  ['.p-menu .p-menu-lista, .p-barra-inferior', 'As partes do painel', 'Início, Solicitações, Agenda e escala, Clientes, Profissionais, Financeiro e Gestão. O número vermelho em Solicitações é quantas esperam por você.'],
  ['.p-busca', 'Uma busca só', 'Digite nome, telefone, e-mail, endereço ou o número da solicitação: o resultado abre a ficha.'],
  ['[data-bloco=inicio-solicitacoes]', 'Solicitações novas', 'A prioridade do dia. "Aprovar" confirma em um clique e a cliente recebe a cobrança no WhatsApp. A seta mostra o resto da solicitação.'],
  ['[data-bloco=inicio-pendencias]', 'Precisa de você', 'O que o sistema não resolve sozinho, com o mais urgente em cima e em vermelho. Cada item tem a ação ali mesmo; recusar sempre pede o motivo.'],
  ['.p-sistema', 'Sistema trabalhando por você', 'O que saiu sozinho hoje (confirmações, lembretes, cobranças). Se algo falhar, vai pra "Precisa de você" com o botão de reprocessar.'],
];

/** Faixa do convite (dentro do Início, sem cobrir nada). null quando já viu. */
export function convidarTour() {
  if (guardado.ler('tour') === 'visto') return null;
  const faixa = el('div', { class: 'p-tour-convite', role: 'region', 'aria-label': 'Conheça o painel' }, [
    el('span', {}, [el('strong', { text: 'Primeira vez no painel novo? ' }), 'Um passeio de 1 minuto pelas partes principais.']),
  ]);
  const fechar = () => { guardado.gravar('tour', 'visto'); faixa.remove(); };
  faixa.append(el('span', { class: 'p-tour-acoes' }, [botao('Agora não', { tom: 'discreto', aoClicar: fechar }), botao('Fazer o tour', { tom: 'primario', aoClicar: () => { fechar(); iniciarTour(); } })]));
  return faixa;
}

export function iniciarTour() {
  guardado.gravar('tour', 'visto');
  const passos = PASSOS.filter(([sel]) => [...document.querySelectorAll(sel)].some((x) => x.offsetParent !== null || x.getClientRects().length));
  if (!passos.length) return;
  let i = 0; let alvo = null;
  const antes = document.activeElement;
  const caixa = el('div', { class: 'p-tour', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'p-tour-titulo', tabindex: '-1' });
  const fim = () => { alvo?.classList.remove('p-tour-alvo'); caixa.remove(); document.removeEventListener('keydown', tecla, true); antes?.focus?.(); };
  function tecla(ev) { if (ev.key === 'Escape') { ev.preventDefault(); fim(); } }
  function mostrar() {
    alvo?.classList.remove('p-tour-alvo');
    const [sel, titulo, texto] = passos[i];
    alvo = [...document.querySelectorAll(sel)].find((x) => x.getClientRects().length) || null;
    alvo?.classList.add('p-tour-alvo');
    alvo?.scrollIntoView({ block: 'center', behavior: 'auto' });
    trocar(caixa, el('p', { class: 'p-tour-passo', text: `Passo ${i + 1} de ${passos.length}` }), el('h2', { id: 'p-tour-titulo', text: titulo }), el('p', { class: 'p-sec', text: texto }),
      el('div', { class: 'p-tour-acoes' }, [
        botao('Pular', { tom: 'discreto', aoClicar: fim }),
        i > 0 ? botao('Voltar', { aoClicar: () => { i--; mostrar(); } }) : null,
        botao(i === passos.length - 1 ? 'Concluir' : 'Próximo', { tom: 'primario', aoClicar: () => { if (i === passos.length - 1) fim(); else { i++; mostrar(); } } }),
      ]));
    caixa.focus();
  }
  document.addEventListener('keydown', tecla, true);
  document.body.append(caixa);
  mostrar();
}
