// diarista/cadastro/: stepper de 5 passos (dados, endereço, experiência e disponibilidade, documentos, termos).
// Rascunho em localStorage; o id do cadastro (UUID) nasce com o rascunho e é usado nos uploads e no envio.
// Documentos ficam no IndexedDB (mock) via salvarDocumento; recarregar mostra o que já foi enviado.
import { anexar, el, svg, trocar } from '../dom.js';
import { ICONE_CHECK } from '../icones.js';
import { montarPagina, definirAbertura, ativarReveal } from '../layout.js';
import { campo, grupoOpcoes, aplicarErros } from '../form.js';
import { campoUpload, AJUDA_UPLOAD } from '../upload.js';
import { api, agora, novaChave } from '../../services/api.js';
import { definirSessao } from '../../services/sessao.js';
import { buscarCEP } from '../../services/cep.js';
import { executarAcao } from '../acoes.js';
import { url } from '../../config/app.js';
import { CONFIG_PRECOS as CFG } from '../../config/precos.js';
import { dataNoFuso, NOMES_DIA } from '../../domain/calendario.js';
import { TURNOS } from '../../domain/modelo.js';
import * as V from '../../domain/validacao.js';
import { botaoWhatsAppManual } from '../whatsapp-manual.js';

const LS = 'prime.rascunho.diarista';
const PASSOS = ['Você', 'Endereço', 'Disponibilidade', 'Documentos', 'Envio'];
const DIAS = [[1, 'Segunda'], [2, 'Terça'], [3, 'Quarta'], [4, 'Quinta'], [5, 'Sexta'], [6, 'Sábado']];

const raiz = el('div');
montarPagina(raiz, { ctaDiscreto: true });
let hoje = '';
let r = carregar();

function novoRascunho() {
  return {
    id: crypto.randomUUID(), passo: 1, chave: novaChave(), enviado: false,
    nome: '', cpf: '', telefone: '', email: '', dataNascimento: '',
    endereco: { cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', uf: 'MG' },
    experienciaAnos: '', dias: [], turnos: [], regioes: [], identidade: 'rg', aceiteTermos: false,
  };
}
function carregar() {
  try { const j = JSON.parse(localStorage.getItem(LS) || 'null'); if (j && j.id && j.chave) return j; } catch { /* começa de novo */ }
  return novoRascunho();
}
function salvar() { try { localStorage.setItem(LS, JSON.stringify(r)); } catch { /* sem storage */ } }

function etapas() {
  // Concluídas são botões (voltar direto pra elas); atual tem aria-current; futuras não são clicáveis.
  return el('ol', { class: 'etapas', 'aria-label': `Etapa ${r.passo} de ${PASSOS.length}: ${PASSOS[r.passo - 1]}` }, PASSOS.map((n, i) => {
    const num = i + 1;
    const estado = num < r.passo ? 'feita' : num === r.passo ? 'atual' : 'futura';
    const conteudo = [el('span', { class: 'num' }, [estado === 'feita' ? svg(ICONE_CHECK) : null, String(num).padStart(2, '0')]), el('span', { class: 'nome', text: n })];
    const etapa = estado === 'feita'
      ? el('button', { class: 'etapa', type: 'button', 'aria-label': `Voltar pra etapa ${num}: ${n} (concluída)`, on: { click: () => irPara(num) } }, conteudo)
      : el('span', { class: 'etapa', 'aria-current': estado === 'atual' ? 'step' : null }, conteudo);
    return el('li', { class: estado, dataset: { etapa: num } }, [etapa]);
  }));
}

function tela(titulo, corpo, { validar, rotuloAvancar = 'Continuar' } = {}) {
  const form = el('form', { novalidate: true, class: 'cartao principal reveal', 'aria-labelledby': 'titulo-passo' });
  const erroGeral = el('p', { class: 'alerta alerta-erro', role: 'alert', hidden: true });
  const avancar = el('button', { class: 'btn btn-primary btn-seta', type: 'submit', text: rotuloAvancar });
  const botoes = [];
  if (r.passo > 1) { const b = el('button', { class: 'btn btn-secundario', type: 'button', text: 'Voltar' }); b.addEventListener('click', () => irPara(r.passo - 1)); botoes.push(b); }
  botoes.push(el('span', { class: 'espaco' }), avancar);
  anexar(form, el('h2', { id: 'titulo-passo', text: titulo, style: 'margin-top:0', tabindex: -1 }), ...[].concat(corpo), erroGeral, el('div', { class: 'acoes' }, botoes));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault(); erroGeral.hidden = true;
    const res = await validar?.();
    if (res === true || res === undefined) { salvar(); irPara(r.passo + 1); return; }
    if (typeof res === 'string') { erroGeral.hidden = false; erroGeral.textContent = res; }
  });
  definirAbertura({ rotulo: `Trabalhe com a Prime · Etapa ${r.passo} de ${PASSOS.length}`, titulo: 'Trabalhe com a |Prime|', lead: 'Preencha seus dados, envie os documentos e a Prime analisa em até 5 dias úteis. Dá pra parar e continuar depois: o rascunho fica salvo neste aparelho.' });
  trocar(raiz, etapas(), form);
  ativarReveal(raiz);
  return { form, erroGeral, avancar };
}

function irPara(n) { r.passo = Math.max(1, Math.min(PASSOS.length, n)); salvar(); render(); document.getElementById('titulo-passo')?.focus?.(); window.scrollTo?.({ top: 0 }); }

function passoDados() {
  const c = {
    nome: campo({ id: 'nome', rotulo: 'Nome completo', valor: r.nome, attrs: { autocomplete: 'name', maxlength: 120 } }),
    cpf: campo({ id: 'cpf', rotulo: 'CPF', valor: V.mascaraCPF(r.cpf), mascara: V.mascaraCPF, attrs: { inputmode: 'numeric', maxlength: 14 } }),
    dataNascimento: campo({ id: 'dataNascimento', rotulo: 'Data de nascimento', tipo: 'date', valor: r.dataNascimento, attrs: { max: hoje }, ajuda: 'É preciso ter 18 anos ou mais.' }),
    telefone: campo({ id: 'telefone', rotulo: 'WhatsApp', tipo: 'tel', valor: V.mascaraTelefone(r.telefone), mascara: V.mascaraTelefone, attrs: { autocomplete: 'tel-national', inputmode: 'tel', maxlength: 15 }, ajuda: 'As diárias e os lembretes chegam por aqui.' }),
    email: campo({ id: 'email', rotulo: 'E-mail', tipo: 'email', valor: r.email, attrs: { autocomplete: 'email', maxlength: 254 } }),
  };
  for (const [k, cc] of Object.entries(c)) cc.input.addEventListener('input', () => { r[k] = cc.input.value; salvar(); });
  tela('Seus dados', Object.values(c).map((x) => x.raiz), {
    validar: () => aplicarErros({
      nome: V.validarNome(r.nome), cpf: V.validarCPF(r.cpf), dataNascimento: V.validarDataNascimento(r.dataNascimento, hoje),
      telefone: V.validarTelefone(r.telefone), email: V.validarEmail(r.email),
    }, c),
  });
}

function passoEndereco() {
  const e = r.endereco;
  const c = {
    cep: campo({ id: 'cep', rotulo: 'CEP', valor: V.mascaraCEP(e.cep), mascara: V.mascaraCEP, attrs: { inputmode: 'numeric', autocomplete: 'postal-code', maxlength: 9 } }),
    logradouro: campo({ id: 'logradouro', rotulo: 'Rua / avenida', valor: e.logradouro, attrs: { autocomplete: 'address-line1', maxlength: 120 } }),
    numero: campo({ id: 'numero', rotulo: 'Número', valor: e.numero, attrs: { maxlength: 10 } }),
    complemento: campo({ id: 'complemento', rotulo: 'Complemento (opcional)', valor: e.complemento, attrs: { maxlength: 60 } }),
    bairro: campo({ id: 'bairro', rotulo: 'Bairro', valor: e.bairro, attrs: { maxlength: 80 } }),
    cidade: campo({ id: 'cidade', rotulo: 'Cidade', valor: e.cidade, attrs: { maxlength: 80 } }),
    uf: campo({ id: 'uf', rotulo: 'UF', tipo: 'select', valor: e.uf || 'MG', opcoes: V.UFS.map((u) => [u, u]) }),
  };
  const status = el('p', { class: 'ajuda', role: 'status', 'aria-live': 'polite' });
  for (const [k, cc] of Object.entries(c)) cc.input.addEventListener('input', () => { r.endereco[k] = cc.input.value; salvar(); });
  c.uf.input.addEventListener('change', () => { r.endereco.uf = c.uf.input.value; salvar(); });
  let ultimo = '';
  c.cep.input.addEventListener('input', async () => {
    const d = V.soDigitos(c.cep.input.value);
    if (d.length !== 8 || d === ultimo) return;
    ultimo = d; status.textContent = 'Buscando endereço…';
    const res = await buscarCEP(d);
    if (V.soDigitos(c.cep.input.value) !== d) return; // CEP mudou enquanto buscava: resposta velha não sobrescreve (F0)
    if (!res) { status.textContent = 'Não conseguimos buscar o CEP agora. Preencha o endereço à mão.'; c.logradouro.input.focus(); return; }
    if (res.naoExiste) { c.cep.erro('CEP não encontrado. Confira os 8 números ou preencha o endereço à mão.'); status.textContent = ''; return; }
    for (const k of ['logradouro', 'bairro', 'cidade']) if (res[k]) { c[k].input.value = res[k]; r.endereco[k] = res[k]; }
    if (res.uf) { c.uf.input.value = res.uf; r.endereco.uf = res.uf; }
    salvar(); status.textContent = 'Endereço encontrado. Confira e informe o número.'; c.numero.input.focus();
  });
  tela('Onde você mora', [c.cep.raiz, status, c.logradouro.raiz, el('div', { class: 'linha' }, [c.numero.raiz, c.complemento.raiz]), c.bairro.raiz, el('div', { class: 'linha' }, [c.cidade.raiz, c.uf.raiz])], {
    validar: () => aplicarErros(V.validarEndereco(r.endereco), c),
  });
}

function passoDisponibilidade() {
  const exp = campo({ id: 'experienciaAnos', rotulo: 'Anos de experiência com limpeza', tipo: 'number', valor: r.experienciaAnos, attrs: { min: 0, max: 60, step: 1, inputmode: 'numeric' } });
  const dias = grupoOpcoes({ nome: 'dias', legenda: 'Dias em que você pode trabalhar', tipo: 'checkbox', valor: r.dias.map(String), opcoes: DIAS.map(([n, t]) => [String(n), t]) });
  const turnos = grupoOpcoes({ nome: 'turnos', legenda: 'Períodos', tipo: 'checkbox', valor: r.turnos, opcoes: Object.entries(TURNOS).map(([k, v]) => [k, v]) });
  const regioes = grupoOpcoes({ nome: 'regioes', legenda: 'Regiões que você atende', tipo: 'checkbox', valor: r.regioes, opcoes: CFG.regioesDiarista.map((x) => [x, x]) });
  exp.input.addEventListener('input', () => { r.experienciaAnos = exp.input.value; salvar(); });
  dias.raiz.addEventListener('change', () => { r.dias = dias.valor().map(Number); salvar(); });
  turnos.raiz.addEventListener('change', () => { r.turnos = turnos.valor(); salvar(); });
  regioes.raiz.addEventListener('change', () => { r.regioes = regioes.valor(); salvar(); });
  tela('Experiência e disponibilidade', [exp.raiz, dias.raiz, turnos.raiz, regioes.raiz], {
    validar: () => {
      const n = Number(r.experienciaAnos);
      return aplicarErros({
        experienciaAnos: r.experienciaAnos === '' || !Number.isInteger(n) || n < 0 || n > 60 ? 'Informe os anos de experiência (0 a 60)' : '',
        dias: r.dias.length ? '' : 'Marque pelo menos um dia',
        turnos: r.turnos.length ? '' : 'Marque pelo menos um período',
        regioes: r.regioes.length ? '' : 'Marque pelo menos uma região',
      }, { experienciaAnos: exp, dias, turnos, regioes });
    },
  });
}

async function passoDocumentos() {
  const { itens } = await api.listarDocumentos(r.id, { sessao: { ator: 'publico' } });
  const porTipo = Object.fromEntries(itens.map((d) => [d.tipo, d]));
  const identidade = grupoOpcoes({ nome: 'identidade', legenda: 'Documento de identidade', valor: r.identidade, opcoes: [['rg', 'RG (frente e verso) + CPF'], ['cnh', 'CNH (frente e verso)', 'A CNH dispensa o CPF']] });
  const grupos = { rg: ['rg_frente', 'rg_verso', 'cpf'], cnh: ['cnh_frente', 'cnh_verso'] };
  const fixos = ['comprovante_residencia', 'foto_perfil', 'antecedentes'];
  const uploads = {};
  const enviar = (tipo) => async ({ file }) => {
    await api.salvarDocumento({ diaristaId: r.id, tipo, nomeArquivo: file.name, mime: file.type, tamanho: file.size, conteudo: file }, { chave: novaChave(), sessao: { ator: 'publico' } });
  };
  const previa = (tipo) => async () => { const d = porTipo[tipo]; if (!d) return null; const a = await api.obterArquivo(d.id, { sessao: { ator: 'publico' } }); return a.conteudo instanceof Blob ? a.conteudo : new Blob([a.conteudo], { type: d.mime }); };
  const criar = (tipo) => { uploads[tipo] = campoUpload({ tipo, existente: porTipo[tipo], aoEscolher: enviar(tipo), obterPrevia: previa(tipo) }); return uploads[tipo].raiz; };
  const blocoRg = el('div', { hidden: r.identidade !== 'rg' }, grupos.rg.map(criar));
  const blocoCnh = el('div', { hidden: r.identidade !== 'cnh' }, grupos.cnh.map(criar));
  identidade.raiz.addEventListener('change', () => { r.identidade = identidade.valor(); blocoRg.hidden = r.identidade !== 'rg'; blocoCnh.hidden = r.identidade !== 'cnh'; salvar(); });
  const ajudaAntecedentes = el('p', { class: 'ajuda' }, ['Certidão de antecedentes criminais: ', el('a', { href: url('diarista/antecedentes/'), target: '_blank', rel: 'noopener', text: 'veja como emitir (Polícia Civil de MG e Polícia Federal)' }), '.']);
  tela('Documentos', [
    el('p', { class: 'ajuda', text: `${AJUDA_UPLOAD} Você pode trocar qualquer arquivo antes de enviar.` }),
    identidade.raiz, blocoRg, blocoCnh, ...fixos.map(criar), ajudaAntecedentes,
  ], {
    validar: async () => {
      const { itens: atuais } = await api.listarDocumentos(r.id, { sessao: { ator: 'publico' } });
      const faltando = V.documentosFaltando(atuais.map((d) => d.tipo), r.identidade);
      for (const [tipo, u] of Object.entries(uploads)) u.erro('');
      for (const tipo of faltando) uploads[tipo]?.erro('Falta este documento');
      if (faltando.length) { uploads[faltando[0]]?.input.focus(); return `Anexe os documentos que faltam pra continuar: ${faltando.map((t) => V.ROTULOS_DOCUMENTO[t]).join(', ')}.`; }
      return true;
    },
  });
}

function passoEnvio() {
  const termos = grupoOpcoes({ nome: 'aceiteTermos', legenda: 'Termos', tipo: 'checkbox', valor: r.aceiteTermos ? ['sim'] : [], opcoes: [['sim', 'Li e aceito os termos da Prime', 'Seus documentos são usados só pra análise do cadastro e guardados com acesso restrito. Você pode pedir a exclusão a qualquer momento.']] });
  termos.raiz.addEventListener('change', () => { r.aceiteTermos = termos.valor().includes('sim'); salvar(); });
  const resumo = el('dl', { class: 'dados' }, [
    el('dt', { text: 'Nome' }), el('dd', { text: r.nome }),
    el('dt', { text: 'WhatsApp' }), el('dd', { text: V.mascaraTelefone(r.telefone) }),
    el('dt', { text: 'Cidade' }), el('dd', { text: `${r.endereco.cidade}/${r.endereco.uf}` }),
    el('dt', { text: 'Dias' }), el('dd', { text: r.dias.map((d) => NOMES_DIA[d]).join(', ') }),
    el('dt', { text: 'Regiões' }), el('dd', { text: r.regioes.join(', ') }),
  ]);
  const { avancar, erroGeral } = tela('Conferir e enviar', [resumo, termos.raiz], { rotuloAvancar: 'Enviar cadastro' });
  avancar.type = 'button';
  avancar.classList.remove('btn-seta');
  avancar.dataset.chave = r.chave;
  avancar.addEventListener('click', () => {
    if (!r.aceiteTermos) { termos.erro('Marque o aceite pra enviar'); termos.inputs[0].focus(); return; }
    executarAcao(avancar, (chave) => api.cadastrarDiarista({
      id: r.id, nome: r.nome, cpf: r.cpf, telefone: r.telefone, email: r.email, dataNascimento: r.dataNascimento, endereco: r.endereco,
      experienciaAnos: Number(r.experienciaAnos), disponibilidade: { dias: r.dias, turnos: r.turnos, regioes: r.regioes }, identidade: r.identidade, aceiteTermos: true,
    }, { chave, sessao: { ator: 'publico' } }), {
      aoSucesso: (d) => { r.enviado = true; salvar(); definirSessao({ ator: 'diarista', id: d.id }); sucesso(d); },
      aoErro: (e) => {
        if (e.codigo === 'DADOS_INVALIDOS' && e.detalhes?.documentos) { irPara(4); return; }
        if (e.codigo === 'DADOS_INVALIDOS' && /já foi enviado/.test(e.message)) { r.enviado = true; salvar(); sucesso({ id: r.id, nome: r.nome }); return; }
        if (e.codigo === 'CONFLITO_IDEMPOTENCIA') { r.chave = novaChave(); salvar(); avancar.dataset.chave = r.chave; }
        erroGeral.hidden = false; erroGeral.textContent = e.message || 'Não foi possível enviar. Tente de novo.';
      },
    });
  });
}

function sucesso(d) {
  definirAbertura({ rotulo: 'Trabalhe com a Prime', titulo: 'Cadastro |enviado|', lead: `Obrigada, ${d.nome.split(' ')[0]}. Recebemos seu cadastro e seus documentos.` });
  trocar(raiz, 
    el('div', { class: 'cartao principal', dataset: { cadastro: d.id } }, [
      el('h2', { text: 'Próximos passos', style: 'margin-top:0' }),
      el('ol', { class: 'passos' }, [
        el('li', { text: 'A Prime analisa seus documentos em até 5 dias úteis.' }),
        el('li', { text: 'Você recebe a resposta pelo WhatsApp informado.' }),
        el('li', { text: 'Se o cadastro for aprovado, você recebe pelo WhatsApp as diárias na sua região e nos dias em que pode trabalhar.' }),
      ]),
      el('div', { class: 'acoes' }, [botaoWhatsAppManual({ texto: `Oi! Acabei de enviar meu cadastro de diarista (${d.id.slice(0, 8)}).`, rotulo: 'Falar com a Prime no WhatsApp', diaristaId: d.id, contexto: 'cadastro', sessao: { ator: 'diarista', id: d.id } })]),
    ]),
  );
}

function render() {
  if (r.enviado) { sucesso({ id: r.id, nome: r.nome }); return; }
  const f = [passoDados, passoEndereco, passoDisponibilidade, passoDocumentos, passoEnvio][r.passo - 1];
  Promise.resolve(f()).catch((e) => { trocar(raiz, el('p', { class: 'alerta alerta-erro', role: 'alert', text: e.message || 'Não foi possível abrir esta etapa. Recarregue a página.' })); });
}

(async () => {
  hoje = dataNoFuso((await agora()).toISOString(), CFG.regrasNotificacao.fuso);
  render();
})();
