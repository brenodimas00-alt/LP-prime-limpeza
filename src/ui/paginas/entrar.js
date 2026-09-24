// entrar/: conta da cliente. Campo único "CPF, e-mail ou celular" (o tipo é detectado no servidor) e senha: por e-mail ou
// celular, os 6 primeiros números do CPF (ou CNPJ); pelo CPF, a data de nascimento (decisão da cliente, 24/09/2026).
// "Esqueci minha senha" virou dica na tela; quem criou senha própria fala com a Prime. "Entrar com Google" bloqueado até
// o acesso do Google existir; código por WhatsApp só com LOGIN_WHATSAPP. ?modo=nova-senha atende o link de recuperação.
import { anexar, el, param, trocar } from '../dom.js';
import { montarPagina, definirAbertura, ativarReveal } from '../layout.js';
import { formularioEntrada, linksOutrasEntradas } from '../login.js';
import { auth } from '../../services/auth.js';
import { url, LOGIN_WHATSAPP, SENHA_MINIMA_SITE } from '../../config/app.js';
import { mascaraTelefone, validarTelefone } from '../../domain/validacao.js';
import { mensagemErro } from '../acoes.js';
import { TEXTOS_CLIENTE } from '../../config/conteudo.js';
import { botaoWhatsAppManual } from '../whatsapp-manual.js';

const raiz = el('div');
montarPagina(raiz);
if (auth.sessaoAtual()?.ator === 'cliente' && param('modo') !== 'nova-senha') location.replace(url('minha-conta/'));

let modo = param('modo') === 'nova-senha' ? 'nova-senha' : 'senha';
let telefone = '';
const aviso = el('p', { class: 'alerta alerta-info', role: 'status', hidden: true });

function render() {
  aviso.hidden = true;
  if (modo === 'senha') {
    definirAbertura({ rotulo: 'Área da cliente', titulo: 'Entre na |sua conta|', lead: 'Acompanhe suas solicitações, os pagamentos e o atendimento.' });
    const google = el('button', { class: 'btn btn-secundario', type: 'button', text: 'Entrar com Google' });
    google.addEventListener('click', async () => { try { await auth.entrarGoogle(); location.href = url('minha-conta/'); } catch (e) { aviso.hidden = false; aviso.textContent = mensagemErro(e); } });
    const { form } = formularioEntrada({
      campos: [
        { id: 'identificador', rotulo: 'CPF, e-mail ou celular', attrs: { autocomplete: 'username', maxlength: 254, autocapitalize: 'off', spellcheck: 'false' } },
        { id: 'senha', rotulo: 'Senha', tipo: 'password', attrs: { autocomplete: 'current-password', maxlength: 100 } },
      ],
      validar: (v) => ({ identificador: v.identificador.trim() ? '' : 'Digite seu CPF, e-mail ou celular', senha: v.senha ? '' : 'Digite sua senha' }),
      rotuloBotao: 'Entrar',
      aoEnviar: (v) => auth.entrarCliente({ identificador: v.identificador.trim(), senha: v.senha }),
      destino: 'minha-conta/',
      rodape: [
        // "Esqueci minha senha" vira dica (texto da cliente)
        el('div', { class: 'alerta alerta-info', id: 'dica-senha', style: 'margin-top:14px' }, [
          el('p', { style: 'margin:0', text: TEXTOS_CLIENTE.dicaLogin }),
          el('p', { style: 'margin:6px 0 0', text: TEXTOS_CLIENTE.dicaLoginEmpresa }),
        ]),
        el('div', { class: 'acoes', style: 'margin-top:8px;justify-content:space-between;align-items:center' }, [
          el('span', { class: 'mudo', text: TEXTOS_CLIENTE.senhaPropria }),
          botaoWhatsAppManual({ texto: 'Oi! Criei uma senha própria na Prime e não lembro. Podem me ajudar?', rotulo: 'Fale com a Prime', contexto: 'senha-propria' }),
        ]),
        el('div', { class: 'acoes', style: 'margin-top:8px' }, [google]),
        LOGIN_WHATSAPP ? el('p', { class: 'mudo' }, [el('button', { class: 'btn-link', type: 'button', text: 'Entrar com código pelo WhatsApp', on: { click: () => { modo = 'whatsapp'; render(); } } })]) : null,
        el('p', { class: 'mudo', style: 'margin-top:14px' }, ['Ainda não tem conta? Ela nasce com a sua primeira solicitação: ', el('a', { href: url('autoagendamento/'), text: 'solicite seu atendimento' }), '.']),
        linksOutrasEntradas('cliente'),
      ],
    });
    trocar(raiz, aviso, form);
  } else if (modo === 'nova-senha') {
    definirAbertura({ rotulo: 'Área da cliente', titulo: 'Crie uma |senha nova|', lead: `Use pelo menos ${SENHA_MINIMA_SITE} caracteres.` });
    trocar(raiz, el('p', { class: 'mudo', text: 'Conferindo o link...' }));
    auth.modoNovaSenha().then((valido) => {
      if (!valido) {
        modo = 'senha'; render();
        aviso.hidden = false; aviso.textContent = 'O link de recuperação expirou ou já foi usado. Fale com a Prime pra receber outro.';
        return;
      }
      const { form } = formularioEntrada({
        campos: [
          { id: 'nova', rotulo: 'Senha nova', tipo: 'password', attrs: { autocomplete: 'new-password', maxlength: 72 } },
          { id: 'nova2', rotulo: 'Repita a senha nova', tipo: 'password', attrs: { autocomplete: 'new-password', maxlength: 72 } },
        ],
        validar: (v) => ({
          nova: v.nova.length < SENHA_MINIMA_SITE ? `Use pelo menos ${SENHA_MINIMA_SITE} caracteres` : '',
          nova2: v.nova2 && v.nova2 !== v.nova ? 'As duas senhas não são iguais' : '',
        }),
        rotuloBotao: 'Salvar senha',
        aoEnviar: async (v) => {
          await auth.definirNovaSenha(v.nova);
          history.replaceState(null, '', url('entrar/'));
          modo = 'senha'; render();
          aviso.hidden = false; aviso.textContent = 'Senha salva. Entre com a senha nova.';
          return { semRedirecionar: true };
        },
        destino: 'entrar/',
      });
      trocar(raiz, aviso, form);
      ativarReveal(raiz);
      raiz.querySelector('input')?.focus();
    }).catch((e) => { aviso.hidden = false; aviso.textContent = mensagemErro(e); trocar(raiz, aviso); });
    return;
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
