// Home: comportamento sem script inline (a CSP não precisa de hash). Menu do celular, carrossel de serviços, entrada
// suave ao rolar, botões "FALAR COM A PRIME" (WhatsApp oficial de src/config/prime.js; sem ele, aviso claro e os contatos
// do rodapé) e avaliações (src/config/depoimentos.js; sem depoimento real, a seção continua oculta).
import { configPrime } from '../config/app.js';
import { linkWhatsApp } from '../domain/configuracao.js';
import { DEPOIMENTOS } from '../config/depoimentos.js';

const MSG_FALAR = 'Oi! Quero tirar uma dúvida sobre os serviços da Prime.';

function menu() {
  const botao = document.querySelector('.menu-btn');
  const nav = document.getElementById('mobileNav');
  if (!botao || !nav) return;
  const fechar = () => { nav.hidden = true; botao.setAttribute('aria-expanded', 'false'); };
  botao.addEventListener('click', () => { nav.hidden = !nav.hidden; botao.setAttribute('aria-expanded', String(!nav.hidden)); });
  nav.addEventListener('click', (e) => { if (e.target.closest('a')) fechar(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !nav.hidden) { fechar(); botao.focus(); } });
}

function falarComAPrime() {
  const href = linkWhatsApp(configPrime(), MSG_FALAR);
  const aviso = document.getElementById('aviso-falar');
  for (const a of document.querySelectorAll('[data-falar]')) {
    if (href) {
      a.href = href; a.target = '_blank'; a.rel = 'noopener';
      continue;
    }
    // sem WhatsApp oficial configurado: o link leva aos contatos do rodapé e o aviso explica (PENDÊNCIA)
    a.addEventListener('click', () => { if (aviso) { aviso.hidden = false; clearTimeout(aviso._t); aviso._t = setTimeout(() => { aviso.hidden = true; }, 8000); } });
  }
}

function avaliacoes() {
  const secao = document.getElementById('avaliacoes');
  const lista = document.getElementById('lista-avaliacoes');
  const reais = DEPOIMENTOS.filter((d) => d && d.texto && d.nome);
  if (!secao || !lista || !reais.length) return;
  for (const d of reais) {
    const card = document.createElement('figure');
    card.className = 'avaliacao-card reveal';
    const texto = document.createElement('blockquote');
    texto.textContent = `“${d.texto}”`;
    const quem = document.createElement('figcaption');
    const nome = document.createElement('strong');
    nome.textContent = d.nome;
    quem.append(nome);
    if (d.servico) { const s = document.createElement('span'); s.textContent = d.servico; quem.append(s); }
    card.append(texto, quem);
    lista.append(card);
  }
  secao.hidden = false;
}

function carrossel() {
  const track = document.getElementById('servicesTrack');
  if (!track) return;
  const slides = [...track.querySelectorAll('.service-slide')];
  const passo = () => (slides[1] ? slides[1].offsetLeft - slides[0].offsetLeft : track.clientWidth);
  const suave = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  // nas pontas, volta pro outro lado (como o carrossel original)
  document.getElementById('servicesPrev')?.addEventListener('click', () => {
    if (track.scrollLeft <= 4) track.scrollTo({ left: track.scrollWidth, behavior: suave });
    else track.scrollBy({ left: -passo(), behavior: suave });
  });
  document.getElementById('servicesNext')?.addEventListener('click', () => {
    if (track.scrollLeft + track.clientWidth >= track.scrollWidth - 4) track.scrollTo({ left: 0, behavior: suave });
    else track.scrollBy({ left: passo(), behavior: suave });
  });
}

function reveal() {
  const itens = document.querySelectorAll('.reveal, .reveal-up');
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) { itens.forEach((e) => e.classList.add('visible')); return; }
  const io = new IntersectionObserver((ents) => {
    for (const e of ents) if (e.isIntersecting) { e.target.classList.add('visible'); io.unobserve(e.target); }
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  itens.forEach((e) => io.observe(e));
}

menu();
falarComAPrime();
avaliacoes();
carrossel();
reveal();
