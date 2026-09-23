// diarista/antecedentes/: passo a passo pra emitir a certidão de antecedentes criminais (MG e Polícia Federal).
import { el } from '../dom.js';
import { montarPagina, definirAbertura, ativarReveal } from '../layout.js';
import { url } from '../../config/app.js';

const raiz = el('div');
montarPagina(raiz, { demo: false });

const link = (href, texto) => el('a', { href, target: '_blank', rel: 'noopener', text: texto });

definirAbertura({ rotulo: 'Cadastro de diarista · Documentos', titulo: 'Certidão de |antecedentes|', lead: 'A Prime pede a certidão pra todas as profissionais. A emissão é gratuita, pela internet, e leva poucos minutos. Vale a estadual (Polícia Civil de MG) ou a federal (Polícia Federal); com as duas, melhor.' });
raiz.replaceChildren(
  el('div', { class: 'cartao principal reveal' }, [
    el('h2', { text: 'Polícia Civil de Minas Gerais', style: 'margin-top:0' }),
    el('ol', { class: 'passos' }, [
      el('li', {}, ['Acesse o site da Polícia Civil de MG: ', link('https://www.policiacivil.mg.gov.br/servicos/atestado-de-antecedentes-criminais', 'policiacivil.mg.gov.br, atestado de antecedentes criminais'), '.']),
      el('li', { text: 'Escolha "Emitir atestado" e entre com sua conta gov.br (a mesma do aplicativo do governo).' }),
      el('li', { text: 'Confira nome, CPF e data de nascimento. O atestado é gerado em PDF na hora.' }),
      el('li', { text: 'Salve o PDF no celular e envie no passo "Documentos" do cadastro.' }),
    ]),
    el('p', { class: 'ajuda', text: 'Se aparecer "consta" ou pedir comparecimento, entre em contato com a Prime antes de enviar.' }),
  ]),
  el('div', { class: 'cartao' }, [
    el('h2', { text: 'Polícia Federal', style: 'margin-top:0' }),
    el('ol', { class: 'passos' }, [
      el('li', {}, ['Acesse ', link('https://www.gov.br/pt-br/servicos/emitir-certidao-de-antecedentes-criminais', 'gov.br, emitir certidão de antecedentes criminais'), '.']),
      el('li', { text: 'Clique em "Iniciar" e informe nome completo, CPF, data de nascimento, nome da mãe e naturalidade.' }),
      el('li', { text: 'A certidão sai em PDF na hora. Ela vale por 90 dias.' }),
      el('li', { text: 'Salve o PDF e envie no cadastro.' }),
    ]),
  ]),
  el('div', { class: 'cartao' }, [
    el('h2', { text: 'Dicas', style: 'margin-top:0' }),
    el('ul', { class: 'passos' }, [
      el('li', { text: 'Se não tiver conta gov.br, crie pelo aplicativo gov.br com CPF e uma foto do rosto.' }),
      el('li', { text: 'Envie o PDF original, sem foto de tela: a Prime confere o código de autenticidade.' }),
      el('li', { text: 'A certidão precisa ter menos de 90 dias na data do envio.' }),
    ]),
  ]),
  el('div', { class: 'acoes' }, [el('a', { class: 'btn btn-primary btn-seta', href: url('diarista/cadastro/'), text: 'Voltar ao cadastro' })]),
);
ativarReveal(raiz);
