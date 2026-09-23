// entrar/: cliente entra com WhatsApp + código de 6 dígitos. No mock o código é fixo e aparece com ?dev=1.
import { el } from '../dom.js';
import { montarPagina, definirAbertura, ativarReveal } from '../layout.js';
import { formularioEntrada, linksOutrasEntradas } from '../login.js';
import { auth } from '../../services/auth.js';
import { url, modoDev } from '../../config/app.js';
import { mascaraTelefone, validarTelefone } from '../../domain/validacao.js';

const raiz = el('div');
montarPagina(raiz);
definirAbertura({ rotulo: 'Área da cliente', titulo: 'Entre com seu |WhatsApp|', lead: 'Você recebe um código de 6 dígitos no número usado no agendamento.' });

if (auth.sessaoAtual()?.ator === 'cliente') location.replace(url('minha-conta/'));

let etapa = 1;
let telefone = '';
const dica = el('p', { class: 'alerta alerta-info', role: 'status', hidden: true });

function render() {
  if (etapa === 1) {
    const { form } = formularioEntrada({
      campos: [{ id: 'telefone', rotulo: 'WhatsApp', tipo: 'tel', mascara: mascaraTelefone, valor: mascaraTelefone(telefone), attrs: { autocomplete: 'tel-national', inputmode: 'tel', maxlength: 15 } }],
      rotuloBotao: 'Receber código',
      aoEnviar: async (v, inputs) => {
        const e = validarTelefone(v.telefone);
        if (e) { inputs.telefone.erro(e); throw Object.assign(new Error(e), { codigo: 'DADOS_INVALIDOS' }); }
        telefone = v.telefone;
        const r = await auth.pedirCodigo(telefone);
        if (!r.existe) throw Object.assign(new Error('Não achamos agendamento com esse WhatsApp. Confira o número ou faça um agendamento.'), { codigo: 'NAO_ENCONTRADO' });
        etapa = 2;
        if (r.codigoDemo) { dica.hidden = false; dica.textContent = `Modo dev: o código de demonstração é ${r.codigoDemo}.`; }
        render();
        return { semRedirecionar: true };
      },
      destino: 'minha-conta/',
      rodape: [el('p', { class: 'mudo', style: 'margin-top:14px' }, ['Ainda não agendou? ', el('a', { href: url('autoagendamento/'), text: 'Agende sua diária' }), '.']), linksOutrasEntradas('cliente')],
    });
    raiz.replaceChildren(form);
  } else {
    const { form } = formularioEntrada({
      campos: [{ id: 'codigo', rotulo: `Código enviado pra ${mascaraTelefone(telefone)}`, attrs: { inputmode: 'numeric', maxlength: 6, autocomplete: 'one-time-code' }, ajuda: modoDev() ? '' : 'Seis dígitos. Chega no WhatsApp em até 1 minuto.' }],
      rotuloBotao: 'Entrar',
      aoEnviar: (v) => auth.entrarCliente({ telefone, codigo: v.codigo.trim() }),
      destino: 'minha-conta/',
      rodape: [el('p', { class: 'mudo', style: 'margin-top:14px' }, [el('button', { class: 'btn-link', type: 'button', text: 'Trocar o número', on: { click: () => { etapa = 1; dica.hidden = true; render(); } } })])],
    });
    raiz.replaceChildren(dica, form);
  }
  ativarReveal(raiz);
  raiz.querySelector('input')?.focus();
}

render();
