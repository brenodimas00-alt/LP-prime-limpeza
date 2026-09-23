// entrar/: conta da cliente. E-mail e senha como principal; "Esqueci minha senha"; "Entrar com Google" (bloqueado até o
// acesso do Google existir); código por WhatsApp só com LOGIN_WHATSAPP ligado em src/config/app.js.
import { anexar, el, param, trocar } from '../dom.js';
import { montarPagina, definirAbertura, ativarReveal } from '../layout.js';
import { formularioEntrada, linksOutrasEntradas } from '../login.js';
import { auth } from '../../services/auth.js';
import { url, LOGIN_WHATSAPP } from '../../config/app.js';
import { mascaraTelefone, validarTelefone, validarEmail } from '../../domain/validacao.js';
import { mensagemErro } from '../acoes.js';

const raiz = el('div');
montarPagina(raiz);
if (auth.sessaoAtual()?.ator === 'cliente') location.replace(url('minha-conta/'));

let modo = param('modo') === 'recuperar' ? 'recuperar' : 'senha';
let telefone = '';
const aviso = el('p', { class: 'alerta alerta-info', role: 'status', hidden: true });

function render() {
  aviso.hidden = true;
  if (modo === 'senha') {
    definirAbertura({ rotulo: 'Área da cliente', titulo: 'Entre na |sua conta|', lead: 'Acompanhe suas diárias, pague pelo Pix e avalie o atendimento.' });
    const google = el('button', { class: 'btn btn-secundario', type: 'button', text: 'Entrar com Google' });
    google.addEventListener('click', async () => { try { await auth.entrarGoogle(); location.href = url('minha-conta/'); } catch (e) { aviso.hidden = false; aviso.textContent = mensagemErro(e); } });
    const esqueci = el('button', { class: 'btn-link', type: 'button', text: 'Esqueci minha senha' });
    esqueci.addEventListener('click', () => { modo = 'recuperar'; render(); });
    const { form } = formularioEntrada({
      campos: [
        { id: 'email', rotulo: 'E-mail', tipo: 'email', attrs: { autocomplete: 'email', maxlength: 254 } },
        { id: 'senha', rotulo: 'Senha', tipo: 'password', attrs: { autocomplete: 'current-password', maxlength: 100 } },
      ],
      validar: (v) => ({ email: validarEmail(v.email), senha: v.senha ? '' : 'Digite sua senha' }),
      rotuloBotao: 'Entrar',
      aoEnviar: (v) => auth.entrarCliente({ email: v.email, senha: v.senha }),
      destino: 'minha-conta/',
      rodape: [
        el('div', { class: 'acoes', style: 'margin-top:8px;justify-content:space-between' }, [esqueci, google]),
        LOGIN_WHATSAPP ? el('p', { class: 'mudo' }, [el('button', { class: 'btn-link', type: 'button', text: 'Entrar com código pelo WhatsApp', on: { click: () => { modo = 'whatsapp'; render(); } } })]) : null,
        el('p', { class: 'mudo', style: 'margin-top:14px' }, ['Ainda não tem conta? Ela é criada no agendamento: ', el('a', { href: url('autoagendamento/'), text: 'agende sua diária' }), '.']),
        linksOutrasEntradas('cliente'),
      ],
    });
    trocar(raiz, aviso, form);
  } else if (modo === 'recuperar') {
    definirAbertura({ rotulo: 'Área da cliente', titulo: 'Recuperar |senha|', lead: 'Informe o e-mail da conta. Se ele existir, mandamos um link pra criar uma senha nova.' });
    const voltar = el('button', { class: 'btn-link', type: 'button', text: 'Voltar pra entrada' });
    voltar.addEventListener('click', () => { modo = 'senha'; render(); });
    const { form } = formularioEntrada({
      campos: [{ id: 'email', rotulo: 'E-mail da conta', tipo: 'email', attrs: { autocomplete: 'email', maxlength: 254 } }],
      validar: (v) => ({ email: validarEmail(v.email) }),
      rotuloBotao: 'Enviar link',
      aoEnviar: async (v) => {
        const r = await auth.recuperarSenha(v.email);
        aviso.hidden = false; aviso.textContent = r.demo || 'Se existir conta com este e-mail, o link chega em alguns minutos. Confira também o spam.';
        return { semRedirecionar: true };
      },
      destino: 'entrar/',
      rodape: [el('p', { class: 'mudo', style: 'margin-top:14px' }, [voltar])],
    });
    trocar(raiz, aviso, form);
  } else if (modo === 'whatsapp') {
    definirAbertura({ rotulo: 'Área da cliente', titulo: 'Entrar com |código|', lead: 'Você recebe um código de 6 dígitos no WhatsApp do agendamento.' });
    const { form } = formularioEntrada({
      campos: [{ id: 'telefone', rotulo: 'WhatsApp', tipo: 'tel', mascara: mascaraTelefone, valor: mascaraTelefone(telefone), attrs: { autocomplete: 'tel-national', inputmode: 'tel', maxlength: 15 } }],
      validar: (v) => ({ telefone: validarTelefone(v.telefone) }),
      rotuloBotao: 'Receber código',
      aoEnviar: async (v) => {
        telefone = v.telefone;
        const r = await auth.pedirCodigo(telefone);
        if (!r.existe) throw Object.assign(new Error('Não achamos agendamento com esse WhatsApp. Confira o número.'), { codigo: 'NAO_ENCONTRADO' });
        modo = 'codigo'; render();
        if (r.codigoDemo) { aviso.hidden = false; aviso.textContent = `Modo dev: o código de demonstração é ${r.codigoDemo}.`; }
        return { semRedirecionar: true };
      },
      destino: 'minha-conta/',
      rodape: [el('p', { class: 'mudo', style: 'margin-top:14px' }, [el('button', { class: 'btn-link', type: 'button', text: 'Entrar com e-mail e senha', on: { click: () => { modo = 'senha'; render(); } } })])],
    });
    trocar(raiz, aviso, form);
  } else {
    const { form } = formularioEntrada({
      campos: [{ id: 'codigo', rotulo: `Código enviado pra ${mascaraTelefone(telefone)}`, attrs: { inputmode: 'numeric', maxlength: 6, autocomplete: 'one-time-code' } }],
      validar: (v) => ({ codigo: /^\d{6}$/.test(v.codigo.trim()) ? '' : 'Digite os 6 dígitos do código' }),
      rotuloBotao: 'Entrar',
      aoEnviar: (v) => auth.entrarPorCodigo({ telefone, codigo: v.codigo.trim() }),
      destino: 'minha-conta/',
      rodape: [el('p', { class: 'mudo', style: 'margin-top:14px' }, [el('button', { class: 'btn-link', type: 'button', text: 'Trocar o número', on: { click: () => { modo = 'whatsapp'; render(); } } })])],
    });
    trocar(raiz, aviso, form);
  }
  ativarReveal(raiz);
  raiz.querySelector('input')?.focus();
}

render();
