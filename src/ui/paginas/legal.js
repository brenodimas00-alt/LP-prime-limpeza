// privacidade/ e termos/: o texto está no HTML (legível sem JavaScript e pelos buscadores); aqui só entra o layout.
import { montarPagina, definirAbertura, ativarReveal } from '../layout.js';
import { el, trocar } from '../dom.js';
import { SERVICOS_AGENDAMENTO } from '../../config/agendamento.js';

const artigo = document.getElementById('texto-legal');
artigo.querySelector('h1')?.remove(); // o título vai pra abertura, no padrão das outras páginas
montarPagina(artigo, { demo: false });
definirAbertura({ rotulo: 'Prime Limpeza Especializada', titulo: artigo.dataset.titulo }); // a versão fica na 1ª linha do texto (vale sem JS)
// condicoes/: o escopo de cada serviço vem da mesma fonte do agendamento ("Ver detalhes do serviço"), sem cópia
const escopo = document.getElementById('escopo-servicos');
if (escopo) {
  trocar(escopo, ...Object.values(SERVICOS_AGENDAMENTO).flatMap((s) => [el('h3', { text: s.nome }), el('ul', {}, s.incluido.map((i) => el('li', { text: i })))]));
}
ativarReveal(document);
