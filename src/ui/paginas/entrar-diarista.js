// diarista/entrar/: e-mail + senha (mock). Fase 2: Supabase Auth.
import { anexar, el, trocar } from '../dom.js';
import { montarPagina, definirAbertura, ativarReveal } from '../layout.js';
import { formularioEntrada, linksOutrasEntradas } from '../login.js';
import { auth } from '../../services/auth.js';
import { url } from '../../config/app.js';
import { validarEmail } from '../../domain/validacao.js';

const raiz = el('div');
montarPagina(raiz);
definirAbertura({ rotulo: 'Área da diarista', titulo: 'Sua |agenda|', lead: 'Entre pra ver as diárias atribuídas a você e avisar cada etapa do dia.' });
if (auth.sessaoAtual()?.ator === 'diarista') location.replace(url('diarista/agenda/'));

const { form } = formularioEntrada({
  campos: [
    { id: 'email', rotulo: 'E-mail', tipo: 'email', attrs: { autocomplete: 'email', maxlength: 254 } },
    { id: 'senha', rotulo: 'Senha', tipo: 'password', attrs: { autocomplete: 'current-password', maxlength: 100 } },
  ],
  validar: (v) => ({ email: validarEmail(v.email), senha: v.senha ? '' : 'Digite sua senha' }),
  rotuloBotao: 'Entrar',
  aoEnviar: (v) => auth.entrarDiarista({ email: v.email, senha: v.senha }),
  destino: 'diarista/agenda/',
  rodape: [el('p', { class: 'mudo', style: 'margin-top:14px' }, ['Ainda não se cadastrou? ', el('a', { href: url('diarista/cadastro/'), text: 'Faça seu cadastro' }), '.']), linksOutrasEntradas('diarista')],
});
trocar(raiz, form);
ativarReveal(raiz);
