// autoagendamento/: stepper de 6 passos. Rascunho salvo em localStorage a cada mudança (recarregar retoma).
// A chave de idempotência é criada UMA vez por rascunho: confirmar de novo (duplo clique, recarregar, nova
// tentativa após falha) nunca cria dois pedidos.
import { el } from '../dom.js';
import { montarPagina, definirAbertura, ativarReveal } from '../layout.js';
import { campo, grupoOpcoes, aplicarErros } from '../form.js';
import { api, agora, novaChave } from '../../services/api.js';
import { definirSessao } from '../../services/sessao.js';
import { buscarCEP } from '../../services/cep.js';
import { executarAcao } from '../acoes.js';
import { url } from '../../config/app.js';
import { CONFIG_PRECOS as CFG } from '../../config/precos.js';
import { calcularPacote, gerarAtendimentos, recomendarDuracao, recomendarPassadoria } from '../../domain/pacote.js';
import { CONTEUDO } from '../../config/conteudo.js';
import { botaoWhatsAppManual } from '../whatsapp-manual.js';
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
    pacote: { tipoServico: 'residencial', metragem: '', pecas: '', duracaoHoras: '', horasExtras: 0, passadoriaCombinada: false, semLocalAlmoco: false, frequencia: 'avulso', quantidadeDiarias: 1 },
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
  const exclusiva = p.tipoServico === 'passadoria';
  return {
    tipoCliente: r.tipo || 'residencial', tipoServico: p.tipoServico, duracaoHoras: Number(p.duracaoHoras) || undefined,
    horasExtras: Number(p.horasExtras) || 0,
    ...(exclusiva ? (p.pecas ? { pecas: Number(p.pecas) } : {}) : { metragem: p.metragem === '' ? undefined : Number(p.metragem) }),
    passadoriaCombinada: !exclusiva && !!p.passadoriaCombinada, semLocalAlmoco: !!p.semLocalAlmoco,
    quantidadeDiarias: p.frequencia === 'avulso' ? 1 : Number(p.quantidadeDiarias), frequencia: p.frequencia,
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
  const turno = r.turno || (pacote.duracaoHoras >= 8 ? 'integral' : 'manha');
  try { return gerarAtendimentos(pacote, { primeiraData: r.primeiraData, turno, hoje, endereco: r.endereco }, CFG); } catch (e) { return { erro: e }; }
}

function blocoInformativo() {
  return el('details', { class: 'info-prime' }, [
    el('summary', { text: 'O que está incluso, o que não fazemos e material' }),
    el('p', { text: CONTEUDO.material }),
    el('p', { text: CONTEUDO.incluso }),
    el('ul', {}, CONTEUDO.seguranca.map((x) => el('li', { text: x }))),
    el('p', {}, [el('strong', { text: 'Não realizamos: ' }), `${CONTEUDO.naoRealizamos.join('; ')}.`]),
  ]);
}

// ---------- layout ----------

function etapas() {
  return el('ol', { class: 'etapas', 'aria-label': `Etapa ${r.passo} de ${PASSOS.length}: ${PASSOS[r.passo - 1]}` }, PASSOS.map((n, i) => el('li', {
    class: i + 1 < r.passo ? 'feita' : i + 1 === r.passo ? 'atual' : '', 'aria-current': i + 1 === r.passo ? 'step' : null,
  }, [el('span', { class: 'num', text: String(i + 1).padStart(2, '0') }), el('span', { class: 'nome', text: n })])));
}

function tela(titulo, corpo, { validar, voltar = true, rotuloAvancar = 'Continuar' } = {}) {
  const form = el('form', { novalidate: true, class: 'cartao principal reveal', 'aria-labelledby': 'titulo-passo' });
  const erroGeral = el('p', { class: 'alerta alerta-erro', role: 'alert', hidden: true });
  const avancar = el('button', { class: 'btn btn-primary btn-seta', type: 'submit', text: rotuloAvancar });
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
  definirAbertura({ rotulo: `Agendamento · Etapa ${r.passo} de ${PASSOS.length}`, titulo: 'Agende sua |diária|', lead: 'Leva uns 3 minutos. A entrada de 50% é paga no Pix depois de conferir tudo.' });
  raiz.replaceChildren(etapas(), form);
  ativarReveal(raiz);
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
  tela('Quem contrata', [g.raiz, blocoEmpresa], {
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
  const sobConsulta = el('div', { class: 'alerta alerta-info', role: 'alert', hidden: true, dataset: { regiao: 'sob-consulta' }, tabindex: -1 }, [
    el('p', { text: 'Nova Lima é atendida sob consulta: a Prime confirma disponibilidade e valor com você pelo WhatsApp.' }),
    el('div', { class: 'acoes', style: 'margin-top:10px' }, [botaoWhatsAppManual({ texto: 'Oi! Quero agendar uma diária em Nova Lima. Vocês atendem meu endereço?', rotulo: 'Consultar no WhatsApp', contexto: 'nova-lima' })]),
  ]);
  tela('Endereço da limpeza', [c.cep.raiz, status, c.logradouro.raiz, el('div', { class: 'linha' }, [c.numero.raiz, c.complemento.raiz]), c.bairro.raiz, el('div', { class: 'linha' }, [c.cidade.raiz, c.uf.raiz]), sobConsulta], {
    validar: () => {
      const erros = V.validarEndereco(r.endereco);
      if (!aplicarErros(erros, c)) return false;
      const reg = regiaoDoEndereco(r.endereco, CFG.regioesAtendidas);
      if (!reg) return `Ainda não atendemos ${r.endereco.cidade}. Atendemos: ${CFG.regioesAtendidas.filter((x) => !x.sobConsulta).map((x) => x.cidade).join(', ')}.`;
      if (reg.sobConsulta) {
        sobConsulta.hidden = false; sobConsulta.focus?.();
        return false;
      }
      return true;
    },
  });
}

function tabelaDia(pacote) {
  return el('table', { class: 'tabela-preco', 'aria-label': 'Preço por diária' }, [el('tbody', {}, [
    ...pacote.itensDia.map((i) => el('tr', {}, [el('td', { text: i.descricao }), el('td', { text: formatarBRL(i.centavos) })])),
    el('tr', { class: 'total' }, [el('td', { text: 'Valor por diária' }), el('td', { text: formatarBRL(pacote.valorDiaBaseCentavos), dataset: { valor: 'dia' } })]),
    el('tr', { class: 'sub' }, [el('td', { text: 'Sábado ou feriado' }), el('td', { text: `+ ${formatarBRL(P.taxaSabadoFeriadoCentavos)}` })]),
  ])]);
}

function tabelaTotais(res) {
  const p = res.pacote;
  const n = res.itens.length;
  const comTaxa = res.itens.filter((i) => i.taxaDiaCentavos > 0);
  return el('table', { class: 'tabela-preco', 'aria-label': 'Total' }, [el('tbody', {}, [
    el('tr', {}, [el('td', { text: `${n} ${n === 1 ? 'diária' : 'diárias'} de ${formatarBRL(p.valorDiaBaseCentavos)}` }), el('td', { text: formatarBRL(p.valorDiaBaseCentavos * n) })]),
    comTaxa.length ? el('tr', {}, [el('td', { text: `Sábado ou feriado (${comTaxa.length})` }), el('td', { text: formatarBRL(comTaxa.reduce((s2, i) => s2 + i.taxaDiaCentavos, 0)) })]) : null,
    ...res.descontos.map((d) => el('tr', {}, [el('td', { text: `Desconto: ${d.diarias} diárias em ${d.mes.slice(5)}/${d.mes.slice(0, 4)}` }), el('td', { text: `- ${formatarBRL(d.centavos)}` })])),
    el('tr', { class: 'total' }, [el('td', { text: 'Total' }), el('td', { text: formatarBRL(p.totalCentavos), dataset: { valor: 'total' } })]),
    el('tr', { class: 'sub' }, [el('td', { text: 'Entrada (50%) no Pix, pra confirmar' }), el('td', { text: formatarBRL(p.entradaCentavos), dataset: { valor: 'entrada' } })]),
    el('tr', { class: 'sub' }, [el('td', { text: p.cobrancaRestante === 'no_primeiro' ? 'Restante, na primeira diária' : n > 1 ? 'Restante, dividido pelas diárias' : 'Restante, no dia da diária' }), el('td', { text: formatarBRL(p.restanteCentavos), dataset: { valor: 'restante' } })]),
  ])]);
}

function passoPacote() {
  const p = r.pacote;
  const empresa = r.tipo === 'empresa';
  const tipo = grupoOpcoes({ nome: 'tipoServico', legenda: 'Tipo de serviço', valor: p.tipoServico, opcoes: [
    ...Object.entries(P.tiposServico).map(([k, v]) => [k, v.nome, v.centavos ? `+ ${formatarBRL(v.centavos)} por diária` : null]),
    ['pos_obra', 'Pós-obra', P.naoOferecidos.pos_obra],
  ] });
  tipo.inputs.find((i) => i.value === 'pos_obra').disabled = true;
  const metr = campo({ id: 'metragem', rotulo: 'Metragem aproximada (m²)', tipo: 'number', valor: p.metragem, attrs: { min: P.metragem.minimo, max: P.metragem.maximo, step: 1, inputmode: 'numeric' }, ajuda: 'Usamos pra sugerir a duração. Você pode escolher outra.' });
  const pecas = campo({ id: 'pecas', rotulo: 'Quantas peças, mais ou menos?', tipo: 'number', valor: p.pecas, attrs: { min: 1, max: 500, step: 1, inputmode: 'numeric' }, ajuda: P.avisoPassadoria });
  const recomendacao = el('p', { class: 'alerta alerta-info', role: 'status', id: 'recomendacao', hidden: true });
  const acima = el('div', { class: 'alerta alerta-aviso', role: 'status', id: 'acima-120', hidden: true }, [
    el('p', { text: CONTEUDO.acimaDe120 }),
    el('div', { class: 'acoes', style: 'margin-top:10px' }, [botaoWhatsAppManual({ texto: `Oi! Meu imóvel tem ${p.metragem || 'mais de 120'} m². Como vocês montam a diária nesse caso?`, rotulo: 'Falar com a Prime', contexto: 'acima-120' })]),
  ]);
  const dur = grupoOpcoes({ nome: 'duracaoHoras', legenda: 'Duração da diária', valor: String(p.duracaoHoras), opcoes: Object.entries(P.duracoes).map(([h, v]) => [h, `${h} horas`, `${formatarBRL(v.centavos)}${v.metragemMaxima ? ` (até ${v.metragemMaxima} m²)` : ''}`]), cartoes: true });
  const extras = campo({ id: 'horasExtras', rotulo: `Horas extras (${formatarBRL(P.horaExtraCentavos)} cada)`, tipo: 'select', valor: String(p.horasExtras || 0), opcoes: Array.from({ length: P.horasExtrasMaximo + 1 }, (_, i) => [String(i), i === 0 ? 'Nenhuma' : `${i} hora${i > 1 ? 's' : ''}`]) });
  const combinada = grupoOpcoes({ nome: 'passadoriaCombinada', legenda: `Passar roupas junto com a limpeza (+ ${formatarBRL(P.passadoriaCombinada.centavos)})`, tipo: 'checkbox', valor: p.passadoriaCombinada ? ['sim'] : [], opcoes: [['sim', 'Sim, pouca demanda', P.passadoriaCombinada.aviso]] });
  const almoco = grupoOpcoes({ nome: 'semLocalAlmoco', legenda: 'Tem onde a profissional esquentar o almoço?', valor: p.semLocalAlmoco ? 'nao' : 'sim', opcoes: [['sim', 'Sim'], ['nao', `Não (+ ${formatarBRL(P.taxaSemLocalAlmocoCentavos)})`]] });
  const freq = grupoOpcoes({ nome: 'frequencia', legenda: 'Frequência', valor: p.frequencia, opcoes: Object.entries(FREQUENCIAS).map(([k, v]) => [k, v, k === 'avulso' ? 'Uma diária' : k === 'mensal' ? 'Mesmo dia do mês' : `A cada ${k === 'semanal' ? 7 : 14} dias`]) });
  if (empresa) { const av = freq.inputs.find((i) => i.value === 'avulso'); av.disabled = true; if (av.checked) av.checked = false; }
  const qtd = campo({ id: 'quantidadeDiarias', rotulo: 'Quantidade de diárias', tipo: 'number', valor: p.frequencia === 'avulso' ? 1 : p.quantidadeDiarias, attrs: { min: 2, max: P.quantidadeDiarias.maximo, step: 1, inputmode: 'numeric' }, ajuda: `3 ou mais diárias no mesmo mês: desconto de ${formatarBRL(P.descontoMensal.at(-1).centavos)}; 5 ou mais: ${formatarBRL(P.descontoMensal[0].centavos)}.` });
  const preco = el('div', { class: 'cartao-escuro', 'aria-live': 'polite', id: 'preco' });
  const avisoTempo = el('p', { class: 'ajuda', text: P.avisoTempo });

  const sync = () => {
    p.tipoServico = tipo.valor(); p.metragem = metr.input.value; p.pecas = pecas.input.value; p.duracaoHoras = dur.valor();
    p.horasExtras = Number(extras.input.value); p.passadoriaCombinada = combinada.valor().includes('sim'); p.semLocalAlmoco = almoco.valor() === 'nao';
    p.frequencia = freq.valor();
    const exclusiva = p.tipoServico === 'passadoria';
    metr.raiz.hidden = exclusiva; pecas.raiz.hidden = !exclusiva; combinada.raiz.hidden = exclusiva; avisoTempo.hidden = exclusiva;
    if (p.frequencia === 'avulso') { qtd.input.value = 1; qtd.input.disabled = true; p.quantidadeDiarias = 1; } else {
      qtd.input.disabled = false;
      if (Number(qtd.input.value) < 2) qtd.input.value = 4;
      p.quantidadeDiarias = qtd.input.value;
    }
    // recomendação de duração
    const m = Number(p.metragem); const pc = Number(p.pecas);
    let rec = null; let textoRec = '';
    if (exclusiva && pc > 0) { rec = recomendarPassadoria(pc, CFG); textoRec = `Para ${pc} peças, sugerimos ${rec} horas${pc > 60 ? ' ou mais' : ''}.`; }
    else if (!exclusiva && m >= P.metragem.minimo) { rec = recomendarDuracao(m, CFG); textoRec = rec ? `Para ${m} m², sugerimos ${rec} horas.` : ''; }
    acima.hidden = exclusiva || !(m > 120);
    recomendacao.hidden = !textoRec; recomendacao.textContent = textoRec;
    if (rec && !p.duracaoHoras) { const i = dur.inputs.find((x) => x.value === String(rec)); if (i) { i.checked = true; p.duracaoHoras = String(rec); } }
    for (const i of dur.inputs) { const d = P.duracoes[i.value]; i.disabled = !exclusiva && !!d.metragemMaxima && m > d.metragemMaxima; if (i.disabled && i.checked) { i.checked = false; p.duracaoHoras = ''; } }
    salvar();
    const t = tentarPacote();
    preco.replaceChildren(el('h3', { text: 'Valor da diária' }), t.pacote ? tabelaDia(t.pacote) : el('p', { class: 'mudo', text: exclusiva ? 'Escolha a duração pra ver o valor.' : 'Informe a metragem e a duração pra ver o valor.' }));
  };
  for (const g of [tipo, dur, combinada, almoco, freq]) g.raiz.addEventListener('change', sync);
  for (const c of [metr, pecas, qtd, extras]) c.input.addEventListener('input', sync);
  sync();
  tela('Monte sua diária', [tipo.raiz, metr.raiz, pecas.raiz, recomendacao, acima, dur.raiz, avisoTempo, extras.raiz, combinada.raiz, almoco.raiz, freq.raiz, qtd.raiz, preco, blocoInformativo()], {
    validar: () => {
      const erros = {};
      const exclusiva = p.tipoServico === 'passadoria';
      if (!p.tipoServico || p.tipoServico === 'pos_obra') erros.tipoServico = 'Escolha o tipo de serviço';
      if (!exclusiva) {
        const m = Number(p.metragem);
        if (!Number.isInteger(m) || m < P.metragem.minimo || m > P.metragem.maximo) erros.metragem = `Informe a metragem: um número inteiro entre ${P.metragem.minimo} e ${P.metragem.maximo}`;
      }
      if (!p.duracaoHoras) erros.duracaoHoras = 'Escolha a duração';
      if (!p.frequencia) erros.frequencia = 'Escolha a frequência';
      if (empresa && p.frequencia === 'avulso') erros.frequencia = 'Para empresa, escolha uma frequência';
      if (p.frequencia !== 'avulso') {
        const q = Number(p.quantidadeDiarias);
        if (!Number.isInteger(q) || q < 2 || q > P.quantidadeDiarias.maximo) erros.quantidadeDiarias = `Com frequência, escolha de 2 a ${P.quantidadeDiarias.maximo} diárias`;
      }
      if (!aplicarErros(erros, { tipoServico: tipo, metragem: metr, duracaoHoras: dur, frequencia: freq, quantidadeDiarias: qtd })) return false;
      const t = tentarPacote();
      if (t.erro) { if (t.erro.codigo === 'DADOS_INVALIDOS' && /2 horas/.test(t.erro.message)) { dur.erro(t.erro.message); return false; } return t.erro.message; }
      if (Number(p.duracaoHoras) >= 8) r.turno = 'integral'; else if (r.turno === 'integral') r.turno = '';
      return true;
    },
  });
}

function listaOcorrencias(itens) {
  return el('ul', { class: 'ocorrencias', 'aria-label': 'Datas das diárias' }, itens.map((o) => el('li', { class: o.deslocada ? 'deslocada' : '', dataset: { data: o.data } }, [
    el('span', { class: 'n', text: `Diária ${o.sequencia}` }), formatarDataCurta(o.data),
    o.taxaDiaCentavos ? el('span', { class: 'n', text: `+ ${formatarBRL(o.taxaDiaCentavos)} (sábado ou feriado)` }) : null,
    o.deslocada ? el('span', { class: 'n', text: `movida de ${formatarData(o.original).slice(0, 5)} (domingo)` }) : null,
  ])));
}

function passoData() {
  const { pacote } = tentarPacote();
  const integral = pacote.duracaoHoras >= 8;
  const min = somarDias(hoje, CFG.regrasCalendario.antecedenciaMinimaDias);
  const max = somarDias(hoje, CFG.regrasCalendario.horizonteMaximoDias);
  const data = campo({ id: 'primeiraData', rotulo: pacote.quantidadeDiarias > 1 ? 'Data da primeira diária' : 'Data da diária', tipo: 'date', valor: r.primeiraData, attrs: { min, max, required: true }, ajuda: `Não atendemos aos domingos. Sábado ou feriado tem acréscimo de ${formatarBRL(P.taxaSabadoFeriadoCentavos)}.` });
  const opcoesTurno = integral ? [['integral', TURNOS.integral]] : [['manha', TURNOS.manha], ['tarde', TURNOS.tarde]];
  if (integral) r.turno = 'integral';
  const turno = grupoOpcoes({ nome: 'turno', legenda: 'Período', valor: r.turno, opcoes: opcoesTurno });
  const cal = el('div', { id: 'calendario', 'aria-live': 'polite' });
  const sync = () => {
    r.primeiraData = data.input.value; r.turno = turno.valor(); salvar();
    if (!r.primeiraData) { cal.replaceChildren(); return; }
    const t = tentarDatas(pacote);
    if (t.erro) { cal.replaceChildren(el('p', { class: 'alerta alerta-erro', text: t.erro.message })); return; }
    cal.replaceChildren(el('h3', { text: pacote.quantidadeDiarias > 1 ? 'Suas datas' : 'Sua data' }), listaOcorrencias(t.itens), el('h3', { text: 'Total', style: 'margin-top:16px' }), tabelaTotais(t));
  };
  data.input.addEventListener('change', sync); data.input.addEventListener('input', sync);
  turno.raiz.addEventListener('change', sync);
  sync();
  tela('Escolha o dia', [data.raiz, turno.raiz, cal], {
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
  tela('Seus contatos', Object.values(c).map((x) => x.raiz), {
    validar: () => {
      const erros = { nome: V.validarNome(k.nome), telefone: V.validarTelefone(k.telefone), email: V.validarEmail(k.email) };
      if (c.cpf && k.cpf) erros.cpf = V.validarCPF(k.cpf);
      return aplicarErros(erros, c);
    },
  });
}

function passoResumo() {
  const { pacote: base, erro } = tentarPacote();
  if (erro) { irPara(3); return; }
  const t = tentarDatas(base);
  if (t.erro) { irPara(4); return; }
  const pacote = t.pacote;
  const e = r.endereco;
  const vencimentos = el('table', { class: 'tabela-preco', 'aria-label': 'Vencimentos' }, [el('tbody', {}, [
    el('tr', {}, [el('td', { text: 'Entrada (50%): agora, no Pix' }), el('td', { text: formatarBRL(pacote.entradaCentavos) })]),
    ...t.itens.filter((o) => o.parcelaCentavos > 0).map((o) => el('tr', {}, [el('td', { text: `Diária ${o.sequencia}: ${o.venceAs ? `até ${formatarData(o.venceEm)} às ${o.venceAs}` : `em ${formatarData(o.venceEm)}`}` }), el('td', { text: formatarBRL(o.parcelaCentavos) })])),
  ])]);
  const servico = `${P.tiposServico[pacote.tipoServico].nome}, ${pacote.duracaoHoras} horas${pacote.horasExtras ? ` + ${pacote.horasExtras} extra(s)` : ''}${pacote.metragem ? `, ${pacote.metragem} m²` : ''}${pacote.passadoriaCombinada ? ', com passadoria' : ''}${pacote.semLocalAlmoco ? ', sem local para o almoço' : ''}`;
  const dados = el('dl', { class: 'dados' }, [
    el('dt', { text: 'Cliente' }), el('dd', { text: r.tipo === 'empresa' ? `${r.razaoSocial} (CNPJ ${V.mascaraCNPJ(r.cnpj)})` : r.contato.nome }),
    el('dt', { text: 'Contato' }), el('dd', { text: `${r.contato.nome} · ${V.mascaraTelefone(r.contato.telefone)} · ${r.contato.email}` }),
    el('dt', { text: 'Endereço' }), el('dd', { text: `${e.logradouro}, ${e.numero}${e.complemento ? ` ${e.complemento}` : ''}, ${e.bairro}, ${e.cidade}/${e.uf}` }),
    el('dt', { text: 'Serviço' }), el('dd', { text: servico }),
    el('dt', { text: 'Frequência' }), el('dd', { text: pacote.frequencia === 'avulso' ? 'Avulso (1 diária)' : `${FREQUENCIAS[pacote.frequencia]}, ${pacote.quantidadeDiarias} diárias` }),
    el('dt', { text: 'Período' }), el('dd', { text: TURNOS[r.turno] }),
  ]);
  const { avancar, erroGeral } = tela('Confira e confirme', [
    dados, el('h3', { text: 'Datas', style: 'margin-top:20px' }), listaOcorrencias(t.itens),
    el('div', { class: 'cartao-escuro', style: 'margin-top:20px' }, [el('h3', { text: 'Valor' }), tabelaTotais(t)]),
    el('h3', { text: 'Vencimentos', style: 'margin-top:20px' }), vencimentos,
    el('p', { class: 'ajuda', style: 'margin-top:12px', text: `${CONTEUDO.material} ${CONTEUDO.incluso}` }),
  ], { rotuloAvancar: 'Confirmar e ir pro Pix' });
  avancar.type = 'button';
  avancar.classList.remove('btn-seta');
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
  avancar.dataset.chave = r.chave;
}

function render() {
  const f = [passoTipo, passoEndereco, passoPacote, passoData, passoContato, passoResumo][r.passo - 1];
  f();
}

(async () => {
  hoje = dataNoFuso((await agora()).toISOString(), CFG.regrasNotificacao.fuso);
  // ?servico= vindo dos cards da home: pré-seleciona o tipo de serviço (só valores conhecidos da tabela).
  const servico = new URLSearchParams(location.search).get('servico');
  if (servico && P.tiposServico[servico] && r.pacote.tipoServico !== servico) {
    r.pacote.tipoServico = servico;
    r.pacote.duracaoHoras = '';
    salvar();
  }
  // Não deixa pular etapa: volta ao primeiro passo inválido.
  if (r.passo > 1 && !r.tipo) r.passo = 1;
  render();
})();
