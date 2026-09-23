// autoagendamento/: stepper de 6 passos. Rascunho salvo em localStorage a cada mudança (recarregar retoma).
// A chave de idempotência é criada UMA vez por rascunho: confirmar de novo (duplo clique, recarregar, nova
// tentativa após falha) nunca cria dois pedidos.
import { el } from '../dom.js';
import { montarPagina } from '../layout.js';
import { campo, grupoOpcoes, aplicarErros } from '../form.js';
import { api, agora, novaChave } from '../../services/api.js';
import { definirSessao } from '../../services/sessao.js';
import { buscarCEP } from '../../services/cep.js';
import { executarAcao } from '../acoes.js';
import { url } from '../../config/app.js';
import { CONFIG_PRECOS as CFG } from '../../config/precos.js';
import { calcularPacote, gerarAtendimentos } from '../../domain/pacote.js';
import { dataNoFuso, somarDias, formatarData, formatarDataCurta, regiaoDoEndereco } from '../../domain/calendario.js';
import { formatarBRL } from '../../domain/dinheiro.js';
import { TURNOS, FREQUENCIAS } from '../../domain/modelo.js';
import * as V from '../../domain/validacao.js';

const LS = 'prime.rascunho.autoagendamento';
const PASSOS = ['Tipo', 'Endereço', 'Pacote', 'Data', 'Contato', 'Resumo'];
const P = CFG.PRECOS;

const raiz = el('div');
montarPagina(raiz);

let hoje = '';
let r = carregar();

function novoRascunho() {
  return {
    passo: 1, chave: novaChave(), tipo: '', cnpj: '', razaoSocial: '', responsavel: '',
    endereco: { cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', uf: 'MG' },
    pacote: { tipoLimpeza: 'padrao', medida: 'metragem', metragem: '', comodos: '', frequencia: 'avulso', quantidadeDiarias: 1, adicionais: [] },
    primeiraData: '', turno: '', contato: { nome: '', telefone: '', email: '', cpf: '' },
  };
}
function carregar() {
  try { const j = JSON.parse(localStorage.getItem(LS) || 'null'); if (j && j.chave) return j; } catch { /* rascunho corrompido: começa de novo */ }
  return novoRascunho();
}
function salvar() { try { localStorage.setItem(LS, JSON.stringify(r)); } catch { /* sem storage: segue sem retomar */ } }

// ---------- montagem dos dados ----------

function especPacote() {
  const p = r.pacote;
  return {
    tipoCliente: r.tipo || 'residencial', tipoLimpeza: p.tipoLimpeza,
    ...(p.medida === 'metragem' ? { metragem: Number(p.metragem) } : { comodos: Number(p.comodos) }),
    quantidadeDiarias: p.frequencia === 'avulso' ? 1 : Number(p.quantidadeDiarias), frequencia: p.frequencia, adicionais: [...p.adicionais],
  };
}
function dadosCliente() {
  const c = { tipo: r.tipo, nome: r.contato.nome, telefone: r.contato.telefone, email: r.contato.email, endereco: { ...r.endereco } };
  if (r.tipo === 'empresa') Object.assign(c, { cnpj: r.cnpj, razaoSocial: r.razaoSocial, responsavel: r.responsavel });
  else if (r.contato.cpf) c.cpf = r.contato.cpf;
  return c;
}
function tentarPacote() {
  try { return { pacote: calcularPacote({ ...especPacote(), endereco: r.endereco }, CFG) }; } catch (e) { return { erro: e }; }
}
function tentarDatas(pacote) {
  try { return { itens: gerarAtendimentos(pacote, { primeiraData: r.primeiraData, turno: r.turno || 'manha', hoje, endereco: r.endereco }, CFG) }; } catch (e) { return { erro: e }; }
}

// ---------- layout ----------

function stepper() {
  return el('ol', { class: 'stepper', 'aria-label': `Passo ${r.passo} de ${PASSOS.length}: ${PASSOS[r.passo - 1]}` }, PASSOS.map((n, i) => el('li', {
    class: i + 1 < r.passo ? 'feito' : i + 1 === r.passo ? 'atual' : '', 'aria-current': i + 1 === r.passo ? 'step' : null,
  }, [el('span', { class: 'rotulo', text: `${i + 1}. ${n}` })])));
}

function tela(titulo, corpo, { validar, voltar = true, rotuloAvancar = 'Continuar' } = {}) {
  const form = el('form', { novalidate: true, class: 'cartao', 'aria-labelledby': 'titulo-passo' });
  const erroGeral = el('p', { class: 'alerta alerta-erro', role: 'alert', hidden: true });
  const avancar = el('button', { class: 'btn btn-primary', type: 'submit', text: rotuloAvancar });
  const botoes = [];
  if (voltar && r.passo > 1) {
    const b = el('button', { class: 'btn btn-secundario', type: 'button', text: 'Voltar' });
    b.addEventListener('click', () => irPara(r.passo - 1));
    botoes.push(b);
  }
  botoes.push(el('span', { class: 'espaco' }), avancar);
  form.append(el('h2', { id: 'titulo-passo', text: titulo, style: 'margin-top:0', tabindex: -1 }), ...[].concat(corpo), erroGeral, el('div', { class: 'acoes' }, botoes));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erroGeral.hidden = true;
    const res = await validar?.();
    if (res === true || res === undefined) { salvar(); irPara(r.passo + 1); return; }
    if (typeof res === 'string') { erroGeral.hidden = false; erroGeral.textContent = res; erroGeral.focus?.(); }
  });
  raiz.replaceChildren(
    el('h1', { text: 'Agende sua diária' }),
    el('p', { class: 'lead', text: 'Leva uns 3 minutos. Você só paga a entrada (50%) no Pix depois de conferir tudo.' }),
    stepper(), form,
  );
  return { form, erroGeral, avancar };
}

function irPara(n) {
  r.passo = Math.max(1, Math.min(PASSOS.length, n));
  salvar();
  render();
  document.getElementById('titulo-passo')?.focus?.();
  window.scrollTo?.({ top: 0 });
}

// ---------- passos ----------

function passoTipo() {
  const g = grupoOpcoes({
    nome: 'tipo', legenda: 'Para onde é a limpeza?', cartoes: true, valor: r.tipo,
    opcoes: [['residencial', 'Minha casa ou apartamento', 'Pessoa física'], ['empresa', 'Empresa ou escritório', 'Com CNPJ, frequência obrigatória']],
  });
  const cnpj = campo({ id: 'cnpj', rotulo: 'CNPJ', valor: r.cnpj, mascara: V.mascaraCNPJ, ajuda: 'Aceita o formato novo com letras.', attrs: { autocomplete: 'off', inputmode: 'text', maxlength: 18 } });
  const razao = campo({ id: 'razaoSocial', rotulo: 'Razão social', valor: r.razaoSocial, attrs: { autocomplete: 'organization', maxlength: 120 } });
  const resp = campo({ id: 'responsavel', rotulo: 'Nome do responsável', valor: r.responsavel, attrs: { autocomplete: 'name', maxlength: 120 } });
  const blocoEmpresa = el('div', { hidden: r.tipo !== 'empresa' }, [cnpj.raiz, razao.raiz, resp.raiz]);
  g.raiz.addEventListener('change', () => { r.tipo = g.valor(); blocoEmpresa.hidden = r.tipo !== 'empresa'; salvar(); });
  for (const [c, k] of [[cnpj, 'cnpj'], [razao, 'razaoSocial'], [resp, 'responsavel']]) c.input.addEventListener('input', () => { r[k] = c.input.value; salvar(); });
  tela('1. Tipo de cliente', [g.raiz, blocoEmpresa], {
    validar: () => {
      const erros = {};
      if (!r.tipo) erros.tipo = 'Escolha uma opção';
      if (r.tipo === 'empresa') {
        erros.cnpj = V.validarCNPJ(r.cnpj); erros.razaoSocial = V.validarTextoObrigatorio(r.razaoSocial, 'a razão social'); erros.responsavel = V.validarNome(r.responsavel, 'o responsável');
      }
      if (!aplicarErros(erros, { tipo: g, cnpj, razaoSocial: razao, responsavel: resp })) return false;
      if (r.tipo === 'empresa' && r.pacote.frequencia === 'avulso') { r.pacote.frequencia = 'semanal'; r.pacote.quantidadeDiarias = 4; }
      return true;
    },
  });
}

function passoEndereco() {
  const e = r.endereco;
  const c = {
    cep: campo({ id: 'cep', rotulo: 'CEP', valor: V.mascaraCEP(e.cep), mascara: V.mascaraCEP, attrs: { inputmode: 'numeric', autocomplete: 'postal-code', maxlength: 9 } }),
    logradouro: campo({ id: 'logradouro', rotulo: 'Rua / avenida', valor: e.logradouro, attrs: { autocomplete: 'address-line1', maxlength: 120 } }),
    numero: campo({ id: 'numero', rotulo: 'Número', valor: e.numero, attrs: { maxlength: 10 } }),
    complemento: campo({ id: 'complemento', rotulo: 'Complemento (opcional)', valor: e.complemento, attrs: { autocomplete: 'address-line2', maxlength: 60 } }),
    bairro: campo({ id: 'bairro', rotulo: 'Bairro', valor: e.bairro, attrs: { maxlength: 80 } }),
    cidade: campo({ id: 'cidade', rotulo: 'Cidade', valor: e.cidade, attrs: { autocomplete: 'address-level2', maxlength: 80 } }),
    uf: campo({ id: 'uf', rotulo: 'UF', tipo: 'select', valor: e.uf || 'MG', opcoes: V.UFS.map((u) => [u, u]) }),
  };
  const status = el('p', { class: 'ajuda', role: 'status', 'aria-live': 'polite' });
  for (const [k, cc] of Object.entries(c)) cc.input.addEventListener('input', () => { r.endereco[k] = cc.input.value; salvar(); });
  c.uf.input.addEventListener('change', () => { r.endereco.uf = c.uf.input.value; salvar(); });
  let ultimo = '';
  c.cep.input.addEventListener('input', async () => {
    const d = V.soDigitos(c.cep.input.value);
    if (d.length !== 8 || d === ultimo) return;
    ultimo = d;
    status.textContent = 'Buscando endereço…';
    const res = await buscarCEP(d);
    if (!res) { status.textContent = 'Não conseguimos buscar o CEP agora. Preencha o endereço à mão.'; c.logradouro.input.focus(); return; }
    if (res.naoExiste) { c.cep.erro('CEP não encontrado. Confira ou preencha o endereço à mão.'); status.textContent = ''; return; }
    for (const k of ['logradouro', 'bairro', 'cidade']) if (res[k]) { c[k].input.value = res[k]; r.endereco[k] = res[k]; }
    if (res.uf) { c.uf.input.value = res.uf; r.endereco.uf = res.uf; }
    salvar();
    status.textContent = 'Endereço encontrado. Confira e informe o número.';
    c.numero.input.focus();
  });
  tela('2. Endereço da limpeza', [c.cep.raiz, status, c.logradouro.raiz, el('div', { class: 'linha' }, [c.numero.raiz, c.complemento.raiz]), c.bairro.raiz, el('div', { class: 'linha' }, [c.cidade.raiz, c.uf.raiz])], {
    validar: () => {
      const erros = V.validarEndereco(r.endereco);
      if (!aplicarErros(erros, c)) return false;
      if (!regiaoDoEndereco(r.endereco, CFG.regioesAtendidas)) {
        return `Ainda não atendemos ${r.endereco.cidade}. Atendemos: ${CFG.regioesAtendidas.map((x) => x.cidade).join(', ')}.`;
      }
      return true;
    },
  });
}

function tabelaPreco(pacote, { comParcelas } = {}) {
  const linhas = pacote.itens.map((i) => el('tr', {}, [el('td', { text: i.descricao }), el('td', { text: formatarBRL(i.centavos) })]));
  const n = pacote.quantidadeDiarias;
  return el('table', { class: 'tabela-preco', 'aria-label': 'Preço' }, [el('tbody', {}, [
    ...linhas,
    el('tr', { class: 'total' }, [el('td', { text: 'Valor por diária' }), el('td', { text: formatarBRL(pacote.valorDiaCentavos), dataset: { valor: 'dia' } })]),
    n > 1 ? el('tr', { class: 'total' }, [el('td', { text: `Total (${n} diárias)` }), el('td', { text: formatarBRL(pacote.totalCentavos), dataset: { valor: 'total' } })]) : null,
    el('tr', { class: 'sub' }, [el('td', { text: 'Entrada (50%) no Pix pra confirmar' }), el('td', { text: formatarBRL(pacote.entradaCentavos), dataset: { valor: 'entrada' } })]),
    el('tr', { class: 'sub' }, [el('td', { text: comParcelas || (pacote.cobrancaRestante === 'no_primeiro' ? 'Restante, no dia da 1ª diária' : 'Restante, dividido nas diárias') }), el('td', { text: formatarBRL(pacote.restanteCentavos), dataset: { valor: 'restante' } })]),
  ])]);
}

function passoPacote() {
  const p = r.pacote;
  const empresa = r.tipo === 'empresa';
  const tipo = grupoOpcoes({ nome: 'tipoLimpeza', legenda: 'Tipo de limpeza', valor: p.tipoLimpeza, opcoes: Object.entries(P.tiposLimpeza).map(([k, v]) => [k, v.nome]) });
  const medida = grupoOpcoes({ nome: 'medida', legenda: 'Como prefere informar o tamanho?', valor: p.medida, opcoes: [['metragem', 'Metragem (m²)'], ['comodos', 'Número de cômodos']] });
  const metr = campo({ id: 'metragem', rotulo: 'Metragem aproximada (m²)', tipo: 'number', valor: p.metragem, attrs: { min: P.metragem.minimo, max: P.metragem.maximo, step: 1, inputmode: 'numeric' }, ajuda: 'Acima de 120 m² indicamos 8 horas ou dividir em mais dias.' });
  const com = campo({ id: 'comodos', rotulo: 'Quantos cômodos (incluindo banheiros e cozinha)?', tipo: 'number', valor: p.comodos, attrs: { min: P.comodos.minimo, max: P.comodos.maximo, step: 1, inputmode: 'numeric' } });
  const freq = grupoOpcoes({ nome: 'frequencia', legenda: 'Frequência', valor: p.frequencia, opcoes: Object.entries(FREQUENCIAS).map(([k, v]) => [k, v, k === 'avulso' ? 'Uma diária' : k === 'mensal' ? 'Mesmo dia do mês' : `A cada ${k === 'semanal' ? 7 : 14} dias`]) });
  if (empresa) { const av = freq.inputs.find((i) => i.value === 'avulso'); av.disabled = true; if (av.checked) av.checked = false; }
  const qtd = campo({ id: 'quantidadeDiarias', rotulo: 'Quantidade de diárias', tipo: 'number', valor: p.frequencia === 'avulso' ? 1 : p.quantidadeDiarias, attrs: { min: 2, max: P.quantidadeDiarias.maximo, step: 1, inputmode: 'numeric' } });
  const ad = grupoOpcoes({ nome: 'adicionais', legenda: 'Adicionais (opcional, por diária)', tipo: 'checkbox', valor: p.adicionais, opcoes: Object.entries(P.adicionais).map(([k, v]) => [k, `${v.nome} (+${formatarBRL(v.centavos)})`]) });
  const preco = el('div', { class: 'cartao destaque', 'aria-live': 'polite', id: 'preco' });

  const sync = () => {
    p.tipoLimpeza = tipo.valor(); p.medida = medida.valor(); p.metragem = metr.input.value; p.comodos = com.input.value;
    p.frequencia = freq.valor(); p.adicionais = ad.valor();
    if (p.frequencia === 'avulso') { qtd.input.value = 1; qtd.input.disabled = true; p.quantidadeDiarias = 1; } else {
      qtd.input.disabled = false;
      if (Number(qtd.input.value) < 2) qtd.input.value = 4;
      p.quantidadeDiarias = qtd.input.value;
    }
    metr.raiz.hidden = p.medida !== 'metragem'; com.raiz.hidden = p.medida !== 'comodos';
    salvar();
    const t = tentarPacote();
    preco.replaceChildren(el('h3', { text: 'Seu preço' }), t.pacote ? tabelaPreco(t.pacote) : el('p', { class: 'mudo', text: 'Preencha o tamanho e a frequência pra ver o preço.' }));
  };
  for (const g of [tipo, medida, freq, ad]) g.raiz.addEventListener('change', sync);
  for (const c of [metr, com, qtd]) c.input.addEventListener('input', sync);
  sync();
  tela('3. Monte seu pacote', [tipo.raiz, medida.raiz, metr.raiz, com.raiz, freq.raiz, qtd.raiz, ad.raiz, preco], {
    validar: () => {
      const erros = {};
      if (!p.tipoLimpeza) erros.tipoLimpeza = 'Escolha o tipo';
      if (p.medida === 'metragem') {
        const m = Number(p.metragem);
        if (!Number.isInteger(m) || m < P.metragem.minimo || m > P.metragem.maximo) erros.metragem = `Informe um número inteiro entre ${P.metragem.minimo} e ${P.metragem.maximo}`;
      } else {
        const m = Number(p.comodos);
        if (!Number.isInteger(m) || m < P.comodos.minimo || m > P.comodos.maximo) erros.comodos = `Informe entre ${P.comodos.minimo} e ${P.comodos.maximo} cômodos`;
      }
      if (!p.frequencia) erros.frequencia = 'Escolha a frequência';
      if (empresa && p.frequencia === 'avulso') erros.frequencia = 'Para empresa, escolha uma frequência';
      if (p.frequencia !== 'avulso') {
        const q = Number(p.quantidadeDiarias);
        if (!Number.isInteger(q) || q < 2 || q > P.quantidadeDiarias.maximo) erros.quantidadeDiarias = `Com frequência, escolha de 2 a ${P.quantidadeDiarias.maximo} diárias`;
      }
      if (!aplicarErros(erros, { tipoLimpeza: tipo, metragem: metr, comodos: com, frequencia: freq, quantidadeDiarias: qtd })) return false;
      const t = tentarPacote();
      return t.pacote ? true : t.erro.message;
    },
  });
}

function listaOcorrencias(itens) {
  return el('ul', { class: 'ocorrencias', 'aria-label': 'Datas das diárias' }, itens.map((o) => el('li', { class: o.deslocada ? 'deslocada' : '', dataset: { data: o.data } }, [
    el('span', { class: 'n', text: `Diária ${o.sequencia}` }), formatarDataCurta(o.data),
    o.deslocada ? el('span', { class: 'selo aviso', text: `deslocada de ${formatarData(o.original).slice(0, 5)}` }) : null,
  ])));
}

function passoData() {
  const { pacote } = tentarPacote();
  const min = somarDias(hoje, CFG.regrasCalendario.antecedenciaMinimaDias);
  const max = somarDias(hoje, CFG.regrasCalendario.horizonteMaximoDias);
  const data = campo({ id: 'primeiraData', rotulo: pacote.quantidadeDiarias > 1 ? 'Data da primeira diária' : 'Data da diária', tipo: 'date', valor: r.primeiraData, attrs: { min, max, required: true }, ajuda: 'Não atendemos aos domingos. As demais datas são calculadas pela frequência.' });
  const turno = grupoOpcoes({ nome: 'turno', legenda: 'Período', valor: r.turno, opcoes: Object.entries(TURNOS).map(([k, v]) => [k, v]) });
  const cal = el('div', { id: 'calendario', 'aria-live': 'polite' });
  const sync = () => {
    r.primeiraData = data.input.value; r.turno = turno.valor(); salvar();
    if (!r.primeiraData) { cal.replaceChildren(); return; }
    const t = tentarDatas(pacote);
    if (t.erro) { cal.replaceChildren(el('p', { class: 'alerta alerta-erro', text: t.erro.message })); return; }
    cal.replaceChildren(el('h3', { text: 'Suas datas' }), listaOcorrencias(t.itens),
      t.itens.some((o) => o.deslocada) ? el('p', { class: 'ajuda', text: 'Datas marcadas caíram em dia sem atendimento e foram pro próximo dia disponível.' }) : null);
  };
  data.input.addEventListener('change', sync); data.input.addEventListener('input', sync);
  turno.raiz.addEventListener('change', sync);
  sync();
  tela('4. Data e período', [data.raiz, turno.raiz, cal], {
    validar: () => {
      const erros = {};
      erros.primeiraData = V.validarData(r.primeiraData, { hoje, permitirPassado: false });
      if (!r.turno) erros.turno = 'Escolha o período';
      if (!aplicarErros(erros, { primeiraData: data, turno })) return false;
      const t = tentarDatas(pacote);
      if (t.erro) { data.erro(t.erro.message); data.input.focus(); return false; }
      return true;
    },
  });
}

function passoContato() {
  const k = r.contato;
  const c = {
    nome: campo({ id: 'nome', rotulo: r.tipo === 'empresa' ? 'Seu nome' : 'Nome completo', valor: k.nome, attrs: { autocomplete: 'name', maxlength: 120 } }),
    telefone: campo({ id: 'telefone', rotulo: 'WhatsApp', tipo: 'tel', valor: V.mascaraTelefone(k.telefone), mascara: V.mascaraTelefone, attrs: { autocomplete: 'tel-national', inputmode: 'tel', maxlength: 15 }, ajuda: 'É por aqui que avisamos cada etapa da diária.' }),
    email: campo({ id: 'email', rotulo: 'E-mail', tipo: 'email', valor: k.email, attrs: { autocomplete: 'email', maxlength: 254 } }),
  };
  if (r.tipo !== 'empresa') c.cpf = campo({ id: 'cpf', rotulo: 'CPF (opcional)', valor: V.mascaraCPF(k.cpf), mascara: V.mascaraCPF, attrs: { inputmode: 'numeric', maxlength: 14 } });
  for (const [kk, cc] of Object.entries(c)) cc.input.addEventListener('input', () => { r.contato[kk] = cc.input.value; salvar(); });
  tela('5. Seus contatos', Object.values(c).map((x) => x.raiz), {
    validar: () => {
      const erros = { nome: V.validarNome(k.nome), telefone: V.validarTelefone(k.telefone), email: V.validarEmail(k.email) };
      if (c.cpf && k.cpf) erros.cpf = V.validarCPF(k.cpf);
      return aplicarErros(erros, c);
    },
  });
}

function passoResumo() {
  const { pacote, erro } = tentarPacote();
  if (erro) { irPara(3); return; }
  const t = tentarDatas(pacote);
  if (t.erro) { irPara(4); return; }
  const e = r.endereco;
  const vencimentos = el('table', { class: 'tabela-preco', 'aria-label': 'Vencimentos' }, [el('tbody', {}, [
    el('tr', {}, [el('td', { text: 'Entrada (50%): agora, no Pix' }), el('td', { text: formatarBRL(pacote.entradaCentavos) })]),
    ...t.itens.filter((o) => o.parcelaCentavos > 0).map((o) => el('tr', {}, [el('td', { text: `Parcela da diária ${o.sequencia}: vence em ${formatarData(o.data)}` }), el('td', { text: formatarBRL(o.parcelaCentavos) })])),
  ])]);
  const dados = el('dl', { class: 'dados' }, [
    el('dt', { text: 'Cliente' }), el('dd', { text: r.tipo === 'empresa' ? `${r.razaoSocial} (CNPJ ${V.mascaraCNPJ(r.cnpj)})` : r.contato.nome }),
    el('dt', { text: 'Contato' }), el('dd', { text: `${r.contato.nome} · ${V.mascaraTelefone(r.contato.telefone)} · ${r.contato.email}` }),
    el('dt', { text: 'Endereço' }), el('dd', { text: `${e.logradouro}, ${e.numero}${e.complemento ? ` ${e.complemento}` : ''}, ${e.bairro}, ${e.cidade}/${e.uf}` }),
    el('dt', { text: 'Serviço' }), el('dd', { text: `${P.tiposLimpeza[pacote.tipoLimpeza].nome}, ${pacote.metragem ? `${pacote.metragem} m²` : `${pacote.comodos} cômodos`}` }),
    el('dt', { text: 'Frequência' }), el('dd', { text: pacote.frequencia === 'avulso' ? 'Avulso (1 diária)' : `${FREQUENCIAS[pacote.frequencia]}, ${pacote.quantidadeDiarias} diárias` }),
    el('dt', { text: 'Período' }), el('dd', { text: TURNOS[r.turno] }),
  ]);
  const { avancar, erroGeral } = tela('6. Confira e confirme', [
    dados, el('h3', { text: 'Datas', style: 'margin-top:20px' }), listaOcorrencias(t.itens),
    el('h3', { text: 'Preço', style: 'margin-top:20px' }), tabelaPreco(pacote),
    el('h3', { text: 'Vencimentos', style: 'margin-top:20px' }), vencimentos,
    el('p', { class: 'ajuda', style: 'margin-top:12px', text: 'O valor final é recalculado pela Prime na confirmação. Sem surpresa: é o mesmo desta tela.' }),
  ], { rotuloAvancar: 'Confirmar e ir pro Pix' });
  avancar.type = 'button';
  avancar.addEventListener('click', () => executarAcao(avancar, (chave) => api.confirmarAutoagendamento(
    { cliente: dadosCliente(), pacote: especPacote(), primeiraData: r.primeiraData, turno: r.turno }, { chave },
  ), {
    aoSucesso: (res) => {
      definirSessao({ ator: 'cliente', id: res.cliente.id });
      try { localStorage.removeItem(LS); } catch { /* ignora */ }
      location.href = url('pagamento/', { pagamento: res.pagamentoEntradaId });
    },
    aoErro: (e2) => {
      if (e2.codigo === 'CONFLITO_IDEMPOTENCIA') { r.chave = novaChave(); salvar(); avancar.dataset.chave = r.chave; }
      erroGeral.hidden = false;
      erroGeral.textContent = e2.codigo === 'SERVICO_INDISPONIVEL' ? 'Não conseguimos falar com o servidor. Seus dados estão salvos; tente de novo.' : (e2.message || 'Não foi possível confirmar. Tente de novo.');
    },
  }));
  // A chave do rascunho é a da confirmação (fixa até dar certo).
  avancar.dataset.chave = r.chave;
}

function render() {
  const f = [passoTipo, passoEndereco, passoPacote, passoData, passoContato, passoResumo][r.passo - 1];
  f();
}

(async () => {
  hoje = dataNoFuso((await agora()).toISOString(), CFG.regrasNotificacao.fuso);
  // Não deixa pular etapa: volta ao primeiro passo inválido.
  if (r.passo > 1 && !r.tipo) r.passo = 1;
  render();
})();
