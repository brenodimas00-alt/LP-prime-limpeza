// Etapa 2. Identificação (item 5): JÁ SOU CLIENTE (entra com a regra de login atual, sem sair do fluxo) ou AINDA NÃO SOU
// CLIENTE (cadastro). Não pede CEP antes disso.
// Cadastro (itens 29 a 34): nome completo (duas palavras), WhatsApp com máscara, validação em tempo real e "Confirme seu
// WhatsApp" na própria tela, e-mail, CPF com máscara e conferência ao completar 11 dígitos (check "CPF válido"), data de
// nascimento com maioridade pela data inteira. Ao concluir, o cadastro é SALVO (item 34) mesmo que a solicitação não seja
// enviada; a resposta do servidor é sempre a mesma (não revela CPF já cadastrado) e traz o ticket do fluxo.
import { el, trocar, svg, cardsEscolha, moldura, mostrarErro } from './ui.js';
import { campo, aplicarErros } from '../../form.js';
import { ICONE_CHECK, ICONE_PESSOA } from '../../icones.js';
import { api } from '../../../services/api.js';
import { auth } from '../../../services/auth.js';
import { sessaoAtual } from '../../../services/sessao.js';
import { executarAcao, mensagemErro } from '../../acoes.js';
import { blocoVerificacao } from '../../turnstile.js';
import { T3 } from '../../../config/agendamento-v3.js';
import { TEXTOS_CLIENTE } from '../../../config/conteudo.js';
import * as V from '../../../domain/validacao.js';
import { estado, salvar, mem, empresa } from './estado.js';

const ICONE_CADASTRO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10" cy="8" r="4"/><path d="M2 21c0-4 3.6-7 8-7"/><path d="M18 14v6M15 17h6"/></svg>';

export function passoIdentificacao(ctx) {
  const r = estado();
  const login = el('div', { class: 'entrar-inline', id: 'entrar-inline', hidden: r.identificacao !== 'cliente' });
  const g = cardsEscolha({
    nome: 'identificacao', legenda: T3.tituloIdentificacao, legendaVisivel: false, valor: r.identificacao, colunas: 2, classe: 'cards-identificacao',
    opcoes: [
      { valor: 'cliente', titulo: T3.jaSouCliente, sub: T3.jaTenhoCadastro, icone: ICONE_PESSOA },
      { valor: 'novo', titulo: T3.naoSouCliente, sub: T3.quero, icone: ICONE_CADASTRO },
    ],
    aoMudar: (v) => {
      r.identificacao = v; salvar();
      login.hidden = v !== 'cliente';
      if (v === 'cliente') { if (!login.firstChild) montarEntrar(login, ctx); login.querySelector('input')?.focus(); }
    },
  });
  if (r.identificacao === 'cliente') montarEntrar(login, ctx);
  const m = moldura({
    passo: 'identificacao', titulo: T3.tituloIdentificacao, corpo: [g.raiz, login], aoVoltar: ctx.voltar, aoAvancar: ctx.avancar,
    validar: () => {
      if (!r.identificacao) { g.erro('Escolha uma opção'); return false; }
      if (r.identificacao === 'cliente') { login.querySelector('input')?.focus(); return 'Entre com seus dados de acesso para continuar.'; }
      return true;
    },
  });
  return m;
}

/** Login inline (regra atual: CPF, e-mail ou celular + senha), sem sair do fluxo e sem perder o rascunho. */
function montarEntrar(caixa, ctx) {
  const id = campo({ id: 'entrar-identificador', rotulo: 'E-mail, celular ou CPF', attrs: { autocomplete: 'username', maxlength: 254 } });
  const senha = campo({ id: 'entrar-senha', rotulo: 'Senha', tipo: 'password', attrs: { autocomplete: 'current-password', maxlength: 72 } });
  const erro = el('p', { class: 'alerta alerta-erro', role: 'alert', hidden: true, tabindex: -1 });
  const b = el('button', { type: 'button', class: 'btn btn-primary', dataset: { acao: 'entrar' }, text: 'Entrar' });
  const entrar = () => executarAcao(b, () => auth.entrarCliente({ identificador: id.input.value, senha: senha.input.value }), {
    aoSucesso: (s) => {
      if (s?.ator !== 'cliente') { mostrarErro(erro, 'Esta conta não é de cliente. Use o e-mail ou CPF da sua conta de cliente.'); return; }
      ctx.entrou();
    },
    aoErro: (e) => mostrarErro(erro, mensagemErro(e)),
  });
  b.addEventListener('click', entrar);
  senha.input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); entrar(); } });
  // a mesma dica de senha da tela de entrada (texto da cliente)
  trocar(caixa, id.raiz, senha.raiz, blocoVerificacao(), erro, b,
    el('p', { class: 'nota-discreta', id: 'dica-senha', text: TEXTOS_CLIENTE.dicaLogin }),
    el('p', { class: 'nota-discreta', text: TEXTOS_CLIENTE.dicaLoginEmpresa }));
}

// ---------------------------------------------------------------- cadastro

/** Indicador do CPF: nada enquanto incompleto; ao completar 11 dígitos, check verde ou o erro literal (item 31). */
function estadoCpf(valor) {
  const d = V.soDigitos(valor);
  if (d.length < 11) return '';
  return V.validarCPF(d) ? 'invalido' : 'valido';
}

export function passoCadastro(ctx) {
  const r = estado();
  const k = r.contato;
  if (r.ticket) return cadastroConcluido(ctx);
  const c = {};
  if (empresa()) {
    c.responsavel = campo({ id: 'responsavel', rotulo: 'Nome completo do responsável', valor: k.responsavel, attrs: { autocomplete: 'name', maxlength: 120 } });
    c.razaoSocial = campo({ id: 'razaoSocial', rotulo: 'Razão social', valor: k.razaoSocial, attrs: { autocomplete: 'organization', maxlength: 120 } });
    c.cnpj = campo({ id: 'cnpj', rotulo: 'CNPJ', valor: k.cnpj, mascara: V.mascaraCNPJ, attrs: { autocomplete: 'off', inputmode: 'text', maxlength: 18 } });
  } else {
    c.nome = campo({ id: 'nome', rotulo: T3.nomeCompleto, valor: k.nome, attrs: { autocomplete: 'name', maxlength: 120 } });
  }
  c.telefone = campo({ id: 'telefone', rotulo: 'WhatsApp', tipo: 'tel', valor: V.mascaraTelefone(k.telefone), mascara: V.mascaraTelefone, attrs: { autocomplete: 'tel-national', inputmode: 'tel', maxlength: 15, placeholder: '(XX) XXXXX-XXXX' } });
  c.email = campo({ id: 'email', rotulo: 'E-mail', tipo: 'email', valor: k.email, attrs: { autocomplete: 'email', maxlength: 254 } });
  if (!empresa()) {
    c.cpf = campo({ id: 'cpf', rotulo: 'CPF', valor: V.mascaraCPF(mem.cpf), mascara: V.mascaraCPF, attrs: { inputmode: 'numeric', maxlength: 14, autocomplete: 'off', placeholder: '000.000.000-00' } });
    c.dataNascimento = campo({ id: 'dataNascimento', rotulo: 'Data de nascimento', tipo: 'date', valor: mem.dataNascimento, attrs: { max: ctx.hoje, min: '1900-01-01' } });
  }
  // CPF em tempo real (item 31)
  const okCpf = el('p', { class: 'campo-ok', id: 'cpf-ok', 'aria-live': 'polite', hidden: true }, [svg(ICONE_CHECK), T3.cpfValido]);
  const atualizarCpf = () => {
    const e = estadoCpf(c.cpf.input.value);
    okCpf.hidden = e !== 'valido';
    c.cpf.raiz.classList.toggle('valido', e === 'valido');
    c.cpf.erro(e === 'invalido' ? T3.cpfInvalido : '');
  };
  if (c.cpf) { c.cpf.raiz.append(okCpf); c.cpf.input.addEventListener('input', atualizarCpf); if (mem.cpf) queueMicrotask(atualizarCpf); }
  // maioridade (item 32): ao preencher a data inteira
  if (c.dataNascimento) {
    const checar = () => {
      const v = c.dataNascimento.input.value;
      if (V.validarNascimentoCliente(v, ctx.hoje)) return;
      c.dataNascimento.erro(V.maiorDeIdade(v, ctx.hoje) ? '' : T3.menorIdade);
    };
    c.dataNascimento.input.addEventListener('change', checar);
    c.dataNascimento.input.addEventListener('blur', checar);
  }
  // WhatsApp (item 33): check quando o formato é válido; depois, a confirmação na própria tela
  const okTel = el('p', { class: 'campo-ok', 'aria-live': 'polite', hidden: true }, [svg(ICONE_CHECK), 'Número válido']);
  c.telefone.raiz.append(okTel);
  const confirmacao = el('div', { class: 'confirma-whatsapp', id: 'confirma-whatsapp', 'aria-live': 'polite' });
  const desenharConfirmacao = () => {
    const d = V.soDigitos(c.telefone.input.value);
    const valido = !V.validarTelefone(d);
    okTel.hidden = !valido;
    if (!valido) {
      trocar(confirmacao);
      if (d.length >= 10) c.telefone.erro(T3.whatsappInvalido);
      return;
    }
    if (r.telefoneConfirmado === d) {
      trocar(confirmacao, el('p', { class: 'alerta alerta-ok', dataset: { whatsapp: 'confirmado' } }, [svg(ICONE_CHECK), ` WhatsApp confirmado: ${V.mascaraTelefone(d)}`]));
      return;
    }
    const bOk = el('button', { type: 'button', class: 'btn btn-primary btn-pequeno', dataset: { acao: 'confirmar-whatsapp' }, text: T3.confirmarNumero });
    const bCorrigir = el('button', { type: 'button', class: 'btn btn-secundario btn-pequeno', text: T3.corrigir });
    bOk.addEventListener('click', () => { r.telefoneConfirmado = d; salvar(); desenharConfirmacao(); c.email.input.focus(); });
    bCorrigir.addEventListener('click', () => { c.telefone.input.focus(); c.telefone.input.select(); });
    trocar(confirmacao, el('div', { class: 'cartao-confirma', role: 'group', 'aria-labelledby': 'confirma-titulo' }, [
      el('h3', { id: 'confirma-titulo', text: T3.confirmeWhatsapp }), el('p', { text: T3.confirmeWhatsappTexto }),
      el('p', { class: 'numero-confirma', text: V.mascaraTelefone(d) }), el('div', { class: 'acoes-confirma' }, [bOk, bCorrigir]),
    ]));
  };
  c.telefone.input.addEventListener('input', () => { if (r.telefoneConfirmado && r.telefoneConfirmado !== V.soDigitos(c.telefone.input.value)) { r.telefoneConfirmado = ''; salvar(); } desenharConfirmacao(); });
  desenharConfirmacao();
  for (const [kk, cc] of Object.entries(c)) {
    cc.input.addEventListener('input', () => { if (kk === 'cpf' || kk === 'dataNascimento') mem[kk] = cc.input.value; else { r.contato[kk] = cc.input.value; salvar(); } });
    if (kk === 'dataNascimento') cc.input.addEventListener('change', () => { mem.dataNascimento = cc.input.value; });
  }
  if (ctx.errosPendentes) { const ep = ctx.errosPendentes; ctx.errosPendentes = null; queueMicrotask(() => aplicarErros(ep, c)); }
  const ordem = empresa() ? ['responsavel', 'razaoSocial', 'cnpj', 'telefone', 'email'] : ['nome', 'telefone', 'email', 'cpf', 'dataNascimento'];
  const corpo = [];
  for (const kk of ordem) { corpo.push(c[kk].raiz); if (kk === 'telefone') corpo.push(confirmacao); }
  corpo.push(blocoVerificacao());
  const m = moldura({
    passo: 'cadastro', titulo: T3.tituloCadastro, corpo, aoVoltar: ctx.voltar, aoAvancar: ctx.avancar,
    validar: async () => {
      const dados = empresa()
        ? { tipo: 'empresa', responsavel: k.responsavel, razaoSocial: k.razaoSocial, cnpj: k.cnpj, telefone: k.telefone, email: k.email }
        : { tipo: 'residencial', nome: k.nome, telefone: k.telefone, email: k.email, cpf: mem.cpf, dataNascimento: mem.dataNascimento };
      const { erros } = V.validarCadastroV3(dados, ctx.hoje);
      if (!erros.telefone && r.telefoneConfirmado !== V.soDigitos(k.telefone)) erros.telefone = 'Confirme seu WhatsApp para continuar.';
      if (Object.keys(erros).length) { aplicarErros(erros, c); return false; }
      // salva o cadastro (item 34): chave nova se os dados mudaram desde a última tentativa
      const conteudo = JSON.stringify(dados);
      if (ctx.cadastroConteudo !== conteudo) { r.chaveCadastro = crypto.randomUUID(); ctx.cadastroConteudo = conteudo; salvar(); }
      return new Promise((ok) => {
        executarAcao(m.avancarBtn, () => api.cadastrarClienteV3(dados, { chave: r.chaveCadastro }), {
          aoSucesso: (res) => {
            r.ticket = res.ticket; r.ticketEm = new Date().toISOString(); salvar();
            mem.cpf = ''; mem.dataNascimento = ''; // o servidor guardou: não precisa mais no aparelho
            ok(true);
          },
          aoErro: (e) => {
            if (e.detalhes && Object.keys(e.detalhes).some((x) => c[x])) { aplicarErros(e.detalhes, c); ok(false); return; }
            ok(mensagemErro(e));
          },
        });
      });
    },
  });
  return m;
}

/** Cadastro já salvo neste fluxo: resumo e a opção de corrigir (gera outro cadastro). */
function cadastroConcluido(ctx) {
  const r = estado();
  const k = r.contato;
  const corrigir = el('button', { type: 'button', class: 'btn-link', text: 'Corrigir meus dados', on: { click: () => { r.ticket = ''; r.ticketEm = ''; r.chaveCadastro = ''; salvar(); ctx.render(); } } });
  return moldura({
    passo: 'cadastro', titulo: T3.tituloCadastro, aoVoltar: ctx.voltar, aoAvancar: ctx.avancar,
    corpo: [
      el('p', { class: 'alerta alerta-ok', dataset: { cadastro: 'salvo' }, text: 'Seus dados foram salvos.' }),
      el('dl', { class: 'dados dados-travados' }, [
        el('dt', { text: empresa() ? 'Responsável' : T3.nomeCompleto }), el('dd', { text: empresa() ? k.responsavel : k.nome }),
        el('dt', { text: 'WhatsApp' }), el('dd', { text: V.mascaraTelefone(k.telefone) }),
        el('dt', { text: 'E-mail' }), el('dd', { text: k.email }),
      ]),
      el('p', {}, [corrigir]),
    ],
  });
}

export const sessaoNome = () => sessaoAtual()?.nome || '';
