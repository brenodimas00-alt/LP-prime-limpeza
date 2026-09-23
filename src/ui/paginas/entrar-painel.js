// painel/entrar/: equipe da Prime, e-mail + senha (mock). Fase 2: Supabase Auth com papel em tabela própria.
import { el } from '../dom.js';
import { montarPagina, definirAbertura, ativarReveal } from '../layout.js';
import { formularioEntrada, linksOutrasEntradas } from '../login.js';
import { auth } from '../../services/auth.js';
import { url } from '../../config/app.js';

const raiz = el('div');
montarPagina(raiz);
definirAbertura({ rotulo: 'Painel da Prime', titulo: 'Entrada da |equipe|', lead: 'Agenda, atribuição de diaristas, pagamentos, cadastros e notificações.' });
if (auth.sessaoAtual()?.ator === 'prime') location.replace(url('painel/'));

const { form } = formularioEntrada({
  campos: [
    { id: 'email', rotulo: 'E-mail', tipo: 'email', attrs: { autocomplete: 'email', maxlength: 254 } },
    { id: 'senha', rotulo: 'Senha', tipo: 'password', attrs: { autocomplete: 'current-password', maxlength: 100 } },
  ],
  rotuloBotao: 'Entrar',
  aoEnviar: (v) => auth.entrarPrime({ email: v.email, senha: v.senha }),
  destino: 'painel/',
  rodape: [linksOutrasEntradas('prime')],
});
raiz.replaceChildren(form);
ativarReveal(raiz);
