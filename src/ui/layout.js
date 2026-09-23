// Header e footer das páginas internas: mesma marcação e classes da home (src/ui/base.css).
import { el, svg } from './dom.js';
import { url, ADAPTER, modoDev } from '../config/app.js';

const ICONE_MENU = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
const ICONE_INSTA = '<svg class="footer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r="1.1" fill="currentColor" stroke="none"/></svg>';

const LINKS = [['Como funciona', '#como-funciona'], ['Serviços', '#servicos'], ['Cobertura', '#cobertura'], ['Sou diarista', '#sou-diarista'], ['FAQ', '#faq']];

export function montarHeader() {
  const nav = el('nav', { class: 'links', 'aria-label': 'Principal' }, LINKS.map(([t, h]) => el('a', { href: url(h), text: t })));
  const mobile = el('div', { id: 'mobileNav', hidden: true, class: 'mobile-nav' }, [
    ...LINKS.map(([t, h]) => el('a', { href: url(h), text: t })),
    el('a', { class: 'btn btn-primary', href: url('autoagendamento/'), text: 'Agendar minha diária' }),
  ]);
  const botao = el('button', { class: 'menu-btn', type: 'button', 'aria-label': 'Abrir menu', 'aria-expanded': 'false', 'aria-controls': 'mobileNav' }, [svg(ICONE_MENU)]);
  botao.addEventListener('click', () => { mobile.hidden = !mobile.hidden; botao.setAttribute('aria-expanded', String(!mobile.hidden)); });
  return el('header', {}, [
    el('div', { class: 'container nav-wrap' }, [
      el('a', { class: 'logo', href: url(''), 'aria-label': 'Prime Limpeza Especializada, página inicial' }, [
        el('img', { src: url('assets/logo.svg'), alt: 'Prime Limpeza Especializada', class: 'logo-img', width: 120, height: 44 }),
      ]),
      nav,
      el('div', { class: 'nav-cta' }, [el('a', { class: 'btn btn-primary', href: url('autoagendamento/'), text: 'Agendar minha diária' }), botao]),
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
      ]),
    ]),
  ]);
}

/** Aviso discreto de demonstração (só no mock). */
export function avisoDemonstracao() {
  if (ADAPTER !== 'mock') return null;
  return el('p', { class: 'aviso-demo', role: 'note' }, [
    el('strong', { text: 'Demonstração. ' }),
    'Os dados ficam só neste navegador: nada é enviado à Prime e outro aparelho não vê este pedido.',
    modoDev() ? ' Modo dev ligado (config fictícia de teste).' : '',
  ]);
}

/** Monta a página: header, <main> com o conteúdo, footer. */
export function montarPagina(conteudo, { demo = true } = {}) {
  const main = el('main', { id: 'conteudo', class: 'pagina' }, [demo ? avisoDemonstracao() : null, conteudo]);
  document.body.prepend(el('a', { class: 'pular', href: '#conteudo', text: 'Pular para o conteúdo' }));
  document.body.append(montarHeader(), main, montarFooter());
  return main;
}
