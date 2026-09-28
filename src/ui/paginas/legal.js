// privacidade/ e termos/: o texto está no HTML (legível sem JavaScript e pelos buscadores); aqui só entra o layout.
import { montarPagina, definirAbertura, ativarReveal } from '../layout.js';

const artigo = document.getElementById('texto-legal');
artigo.querySelector('h1')?.remove(); // o título vai pra abertura, no padrão das outras páginas
montarPagina(artigo, { demo: false });
definirAbertura({ rotulo: 'Prime Limpeza Especializada', titulo: artigo.dataset.titulo }); // a versão fica na 1ª linha do texto (vale sem JS)
ativarReveal(document);
