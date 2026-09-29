// painel/entrar/: equipe da Prime, e-mail + senha (mock). Fase 2: Supabase Auth com papel em tabela própria.
import { anexar, el, trocar } from '../dom.js';
import { montarPagina, definirAbertura, ativarReveal } from '../layout.js';
import { formularioEntrada, linksOutrasEntradas } from '../login.js';
import { auth } from '../../services/auth.js';
import { url } from '../../config/app.js';
import { validarEmail } from '../../domain/validacao.js';
import { SENHA_MINIMA_SITE } from '../../config/app.js';

const raiz = el('div');
montarPagina(raiz);
definirAbertura({ rotulo: 'Painel da Prime', titulo: 'Entrada da |equipe|', lead: 'Agenda, atribuição de diaristas, pagamentos, cadastros e notificações.' });
const atual = auth.sessaoAtual();
if (atual?.ator === 'prime' && !atual.trocaSenha) location.replace(url('painel/'));

/** A0: senha temporária. O banco não libera nada até a troca; esta tela só leva até ela. */
function formularioTroca() {
  definirAbertura({ rotulo: 'Primeiro acesso', titulo: 'Crie sua |senha|', lead: 'Você entrou com uma senha temporária. Crie a sua pra abrir o painel.' });
  const { form } = formularioEntrada({
    campos: [
      { id: 'atual', rotulo: 'Senha temporária', tipo: 'password', attrs: { autocomplete: 'current-password', maxlength: 100 } },
      { id: 'nova', rotulo: 'Senha nova', tipo: 'password', ajuda: `Pelo menos ${SENHA_MINIMA_SITE} caracteres.`, attrs: { autocomplete: 'new-password', maxlength: 72 } },
      { id: 'confirma', rotulo: 'Repita a senha nova', tipo: 'password', attrs: { autocomplete: 'new-password', maxlength: 72 } },
    ],
    validar: (v) => ({
      nova: v.nova.length < SENHA_MINIMA_SITE ? `Pelo menos ${SENHA_MINIMA_SITE} caracteres` : v.nova === v.atual ? 'Use uma senha diferente da temporária' : '',
      confirma: v.confirma && v.confirma !== v.nova ? 'As duas senhas não conferem' : '',
    }),
    rotuloBotao: 'Salvar e abrir o painel',
    aoEnviar: (v) => auth.trocarSenha({ atual: v.atual, nova: v.nova }),
    destino: 'painel/',
  });
  form.id = 'form-troca-senha';
  trocar(raiz, form);
  ativarReveal(raiz);
}

const { form } = formularioEntrada({
  campos: [
    { id: 'email', rotulo: 'E-mail', tipo: 'email', attrs: { autocomplete: 'email', maxlength: 254 } },
    { id: 'senha', rotulo: 'Senha', tipo: 'password', attrs: { autocomplete: 'current-password', maxlength: 100 } },
  ],
  validar: (v) => ({ email: validarEmail(v.email), senha: v.senha ? '' : 'Digite sua senha' }),
  rotuloBotao: 'Entrar',
  aoEnviar: async (v) => {
    const s = await auth.entrarPrime({ email: v.email, senha: v.senha });
    if (s?.trocaSenha) { formularioTroca(); return { semRedirecionar: true }; }
    return s;
  },
  destino: 'painel/',
  rodape: [linksOutrasEntradas('prime')],
});
if (atual?.ator === 'prime' && atual.trocaSenha) formularioTroca();
else { trocar(raiz, form); ativarReveal(raiz); }
