// Maquete estática do Início (fase 2): a mesma vista da tela real com o modelo fixo igual à referência.
import { el, trocar } from '../../src/ui/dom.js';
import { menuVista, topoVista, inicioVista } from '../../src/ui/painel2/inicio-vista.js';
import { INICIO_REFERENCIA as VM } from '../../scripts/fixtures/inicio-referencia.js';

trocar(document.body, el('div', { class: 'pn-app' }, [
  menuVista({ atual: 'inicio', contadores: VM.contadores, logo: '../../assets/marca/logo-branco.svg' }),
  el('main', { class: 'pn-principal' }, [topoVista({ usuaria: VM.usuaria, sino: VM.contadores.sino }), inicioVista(VM)]),
]));
document.body.dataset.pronto = '1';
