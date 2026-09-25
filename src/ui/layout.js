// Header e footer das páginas internas: mesma marcação e classes da home (src/ui/base.css).
import { anexar, el, svg, trocar } from './dom.js';
import { url, ADAPTER, modoDev } from '../config/app.js';
import { ICONE_PESSOA } from './icones.js';

const ICONE_MENU = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
const ICONE_INSTA = '<svg class="footer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r="1.1" fill="currentColor" stroke="none"/></svg>';

// Mesmas âncoras do menu da home (ordem do item 23 de home-isa.txt).
const LINKS = [['Serviços', '#servicos'], ['Como funciona', '#como-funciona'], ['Pacotes', '#pacotes'], ['Onde atendemos', '#onde-atendemos'], ['FAQ', '#faq']];

/** Destino e rótulo do acesso à conta conforme a sessão: deslogado "Entrar"; logado "Minha conta" (área do papel). */
export function acessoConta() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem('prime.sessao') || 'null'); } catch { /* sem storage */ }
  const destino = { cliente: 'minha-conta/', diarista: 'diarista/agenda/', prime: 'painel/' }[s?.ator];
  return destino ? { rotulo: 'Minha conta', href: url(destino) } : { rotulo: 'Entrar', href: url('entrar/') };
}

export function montarHeader({ ctaDiscreto = false } = {}) {
  const conta = acessoConta();
  const nav = el('nav', { class: 'links', 'aria-label': 'Principal' }, LINKS.map(([t, h]) => el('a', { href: url(h), text: t })));
  const mobile = el('div', { id: 'mobileNav', hidden: true, class: 'mobile-nav' }, [
    ...LINKS.map(([t, h]) => el('a', { href: url(h), text: t })),
    el('a', { class: 'mobile-conta', href: conta.href, dataset: { conta: 'menu' } }, [svg(ICONE_PESSOA), conta.rotulo]),
    el('a', { class: 'btn btn-primary', href: url('autoagendamento/'), text: 'Agendar minha limpeza' }),
  ]);
  const botao = el('button', { class: 'menu-btn', type: 'button', 'aria-label': 'Abrir menu', 'aria-expanded': 'false', 'aria-controls': 'mobileNav' }, [svg(ICONE_MENU)]);
  botao.addEventListener('click', () => { mobile.hidden = !mobile.hidden; botao.setAttribute('aria-expanded', String(!mobile.hidden)); });
  return el('header', {}, [
    el('div', { class: 'container nav-wrap' }, [
      el('a', { class: 'logo', href: url(''), 'aria-label': 'Prime Limpeza Especializada, página inicial' }, [
        el('img', { src: url('assets/logo.svg'), alt: 'Prime Limpeza Especializada', class: 'logo-img', width: 120, height: 44 }),
      ]),
      nav,
      el('div', { class: 'nav-cta' }, [
        el('span', { class: 'nav-divisor', 'aria-hidden': 'true' }),
        el('a', { class: 'btn-conta', href: conta.href, dataset: { conta: 'header' } }, [svg(ICONE_PESSOA), conta.rotulo]),
        el('a', { class: ctaDiscreto ? 'btn btn-secundario' : 'btn btn-primary', href: url('autoagendamento/'), text: 'Agendar minha limpeza' }),
        el('a', { class: 'conta-icone', href: conta.href, 'aria-label': conta.rotulo, dataset: { conta: 'icone' } }, [svg(ICONE_PESSOA)]),
        botao,
      ]),
    ]),
    mobile,
  ]);
}

export function montarFooter() {
  const wa = (num, txt) => el('a', { class: 'footer-icon-link', href: `https://wa.me/${num}`, target: '_blank', rel: 'noopener' }, [
    el('img', { class: 'footer-icon', src: url('assets/icons/whatsapp.svg'), alt: '' }), txt,
  ]);
  return el('footer', {}, [
    el('div', { class: 'footer-grid' }, [
      el('div', { class: 'footer-brand' }, [
        el('a', { class: 'logo', href: url('') }, [el('img', { src: url('assets/logo-branco.svg'), alt: 'Prime Limpeza Especializada', class: 'logo-img' })]),
        el('p', {}, ['© 2026 Prime Limpeza Especializada.', el('br'), 'Todos os direitos reservados.']),
      ]),
      el('div', { class: 'footer-col' }, [
        el('h2', { class: 'footer-titulo', text: 'Atendimento' }),
        el('p', {}, ['Segunda a sexta', el('br'), '08:00 às 18:00']),
        el('p', {}, ['Sábado', el('br'), '08:00 às 14:00']),
      ]),
      el('div', { class: 'footer-col' }, [
        el('h2', { class: 'footer-titulo', text: 'Contato' }),
        wa('5531972363590', '(31) 97236-3590'),
        wa('5531997357372', '(31) 99735-7372'),
        el('a', { class: 'footer-icon-link', href: 'https://instagram.com/primelimpeza_especializada', target: '_blank', rel: 'noopener' }, [svg(ICONE_INSTA), '@primelimpeza_especializada']),
      ]),
      el('div', { class: 'footer-col' }, [
        el('h2', { class: 'footer-titulo', text: 'Página' }),
        ...LINKS.map(([t, h]) => el('a', { href: url(h), text: t })),
        el('a', { href: url('diarista/cadastro/'), text: 'Trabalhe com a Prime' }),
      ]),
    ]),
  ]);
}

/** Aviso discreto de demonstração (só no mock). */
export function avisoDemonstracao() {
  if (ADAPTER !== 'mock') return null;
  return el('p', { class: 'aviso-demo', role: 'note' }, [
    el('strong', { text: 'Ambiente de demonstração. ' }),
    'Os dados ficam só neste navegador: nada chega à Prime e outro aparelho não vê o que você fizer aqui.',
    modoDev() ? ' Modo dev ligado, com a configuração fictícia de teste.' : '',
  ]);
}

/**
 * Abertura da página: banda azul com rótulo em caixa alta, título (com trecho em destaque dourado) e lead.
 * titulo: 'Agende sua |diária|' -> o trecho entre barras vira o destaque.
 */
export function abertura({ rotulo, titulo, lead, voltar, larga = false }) {
  const partes = String(titulo).split('|');
  const h1 = el('h1', {}, partes.map((p, i) => (i % 2 ? el('span', { class: 'destaque', text: p }) : p)));
  return el('div', { class: `abertura banda-escura${larga ? ' larga' : ''}` }, [el('div', { class: 'miolo' }, [
    voltar ? el('a', { class: 'voltar', href: voltar.href, text: `← ${voltar.texto}` }) : null,
    rotulo ? el('span', { class: 'rotulo', text: rotulo }) : null,
    h1,
    lead ? el('p', { class: 'lead', text: lead }) : null,
  ])]);
}

/** Liga a entrada suave nos elementos .reveal (mesma ideia da home; respeita prefers-reduced-motion). */
export function ativarReveal(raiz = document) {
  const itens = raiz.querySelectorAll('.reveal:not(.visible)');
  if (!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) { itens.forEach((e) => e.classList.add('visible')); return; }
  const io = new IntersectionObserver((ents) => { for (const e of ents) if (e.isIntersecting) { e.target.classList.add('visible'); io.unobserve(e.target); } }, { threshold: 0.08 });
  itens.forEach((e) => io.observe(e));
}

/**
 * Monta a página: header, abertura (opcional), <main> com o conteúdo, footer.
 * A abertura é um elemento vivo: use `definirAbertura()` pra trocar rótulo/título depois.
 */
export function montarPagina(conteudo, { demo = true, larga = false, ctaDiscreto = false } = {}) {
  const slot = el('div', { id: 'abertura' });
  const main = el('main', { id: 'conteudo', class: `pagina${larga ? ' larga' : ''}` }, [demo ? avisoDemonstracao() : null, conteudo]);
  document.body.prepend(el('a', { class: 'pular', href: '#conteudo', text: 'Pular para o conteúdo' }));
  anexar(document.body, montarHeader({ ctaDiscreto }), slot, main, montarFooter());
  return main;
}

export function definirAbertura(op) {
  const slot = document.getElementById('abertura');
  if (slot) trocar(slot, abertura(op));
}
