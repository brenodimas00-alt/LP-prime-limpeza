// Etapa 6. "Revise sua solicitação" (itens 35, 36 e 47 a 55): três blocos numa tela só.
// - Resumo do atendimento: só o necessário ("Residencial • 200 m² • 8 ambientes", local com a identificação, chips de datas,
//   horário, duração, frequência).
// - Valores e pagamento: cálculo transparente (N diárias × valor, taxas separadas, desconto pela regra do item 44), cupom
//   com Aplicar e as mensagens literais, e o texto de pagamento da modalidade (ou o do faturamento autorizado).
// - Finalização: "Como você conheceu a Prime?", o aviso do item 51, o aceite ÚNICO do item 52 (botão só depois de abrir os
//   Termos e Condições e marcar) e ENVIAR SOLICITAÇÃO, desabilitado no clique (sem envio duplicado).
// O valor vem do servidor (cotação) e é conferido de novo no envio. Nada é cobrado no envio (item 37).
import { el, trocar, cardsEscolha, abrirPainel, mostrarErro, anexar } from './ui.js';
import { campo } from '../../form.js';
import { api, novaChave } from '../../../services/api.js';
import { mensagemErro } from '../../acoes.js';
import { url } from '../../../config/app.js';
import { VERSAO_CONDICOES, VERSAO_LEGAL } from '../../../config/legal.js';
import { SERVICOS_AGENDAMENTO as SERVICOS, ONDE } from '../../../config/agendamento.js';
import { T3 } from '../../../config/agendamento-v3.js';
import { formatarBRL } from '../../../domain/dinheiro.js';
import { totalAmbientes } from '../../../domain/agendamento-v3.js';
import { CONFIG_PRECOS as CFG } from '../../../config/precos.js';
import { estado, salvar, logada, apagarRascunho, novoRascunho, trocarRascunho } from './estado.js';
import { montarPedido, linhas, resolverEndereco } from './pedido.js';
import { enderecoEmLinha } from './passo-endereco.js';
import { rotuloData } from './passo-datas.js';

const brl = (c) => formatarBRL(c).replace('R$ ', 'R$');

/** Linhas de valores do item 49 a partir da cotação. */
export function linhasDeValor(cot) {
  const ls = [];
  const ats = cot.atendimentos;
  const nome = cot.modalidade === 'multi_profissional' ? ['profissional', 'profissionais'] : ['diária', 'diárias'];
  const porBase = new Map();
  for (const a of ats) porBase.set(a.baseCentavos, (porBase.get(a.baseCentavos) || 0) + 1);
  for (const [base, n] of porBase) {
    ls.push(n === 1 && ats.length === 1 ? ['Diária', brl(base), 'base'] : [`${n} ${n === 1 ? nome[0] : nome[1]} × ${brl(base)}`, brl(base * n), 'base']);
  }
  const taxa = (cod, rotulo) => {
    const itens = ats.flatMap((a) => a.itens.filter((i) => i.codigo === cod));
    if (!itens.length) return;
    const total = itens.reduce((s, i) => s + i.centavos, 0);
    ls.push([itens.length > 1 ? `${rotulo} (${itens.length}×)` : rotulo, `+ ${brl(total)}`, cod]);
  };
  taxa('sabado', 'Sábado'); taxa('feriado', 'Feriado'); taxa('sem_refeicao', 'Sem local para aquecer refeição');
  const desl = new Map();
  for (const a of ats) for (const i of a.itens) if (i.codigo === 'deslocamento') desl.set(i.descricao, (desl.get(i.descricao) || 0) + i.centavos);
  for (const [d, c] of desl) ls.push([d, `+ ${brl(c)}`, 'deslocamento']);
  if (cot.descontos.length) {
    ls.push(['Subtotal', brl(cot.subtotalCentavos), 'subtotal']);
    for (const d of cot.descontos) ls.push([`${d.descricao}:`, `– ${brl(d.centavos)}`, `desconto-${d.codigo}`]);
  }
  return ls;
}

function resumoMedida(r) {
  const c = r.caracteristicas || {};
  const partes = [ONDE[r.segmento === 'empresa' ? 'empresa' : 'residencial'].titulo];
  if (r.servico === 'passadoria') partes.push(`cerca de ${c.pecas} peças`);
  else {
    if (c.metragem) partes.push(`${c.metragem} m²`);
    const n = r.servico === 'pre_pos_evento' ? c.ambientesTotal : totalAmbientes(c.ambientes, CFG);
    if (n) partes.push(`${n} ${n === 1 ? 'ambiente' : 'ambientes'}`);
  }
  return partes.join(' • ');
}

export function passoRevisao(ctx) {
  const r = estado();
  const ls = linhas();
  const datas = [...new Set(ls.map((l) => l.data))].sort();
  const sec = el('section', { class: 'passo-fluxo revisao-v3', 'aria-labelledby': 'titulo-passo', dataset: { passo: 'revisao' } });
  const alterar = (rot, passo) => el('button', { type: 'button', class: 'btn-link', 'aria-label': `Alterar ${rot.toLowerCase()}`, text: 'Alterar', on: { click: () => { r.retornarRevisao = true; salvar(); ctx.irPara(passo); } } });
  const item = (rot, conteudo, passo) => el('div', { class: 'revisao-item', dataset: { item: rot.toLowerCase() } }, [
    el('div', { class: 'revisao-topo' }, [el('h4', { text: rot }), passo ? alterar(rot, passo) : null]), ...[].concat(conteudo).map((x) => (typeof x === 'string' ? el('p', { text: x }) : x)),
  ]);

  // ---------- 1. Resumo do atendimento (item 48) ----------
  const servicos = [...new Set(ls.map((l) => l.servico))];
  const enderecos = [...new Map(ls.map((l) => { const e = resolverEndereco(l.endereco, ctx); return [l.endereco, e]; })).values()].filter(Boolean);
  const local = enderecos.map((e) => {
    const apelido = e.endereco.apelido || (e.novo?.uso === 'salvar' && e.novo.apelido) || '';
    return el('p', { class: 'local' }, apelido ? [el('strong', { text: apelido }), el('br'), enderecoEmLinha(e.endereco)] : [enderecoEmLinha(e.endereco)]);
  });
  const horas = [...new Set(ls.map((l) => l.horaInicio))];
  const durs = [...new Set(ls.map((l) => l.duracaoHoras))];
  const blocoResumo = el('div', { class: 'revisao-bloco', dataset: { bloco: 'resumo' } }, [
    el('h3', { text: T3.blocoResumo }),
    item('Serviço', [servicos.map((k) => SERVICOS[k].nome).join(' e '), resumoMedida(r)], 'servico'),
    item('Local', local, 'endereco'),
    item('Datas', [el('ul', { class: 'lista-datas chips-resumo' }, datas.map((d) => el('li', { text: rotuloData(d, datas) })))], 'datas'),
    item('Horário', horas.length === 1 ? [`${horas[0]}${datas.length > 1 ? ' em todas as datas' : ''}`] : [ls.map((l) => `${r.modalidade === 'multi_profissional' ? l.rotulo : rotuloData(l.data, datas)} ${l.horaInicio}`).join(' · ')], 'datas'),
    item('Duração', durs.length === 1 ? [`${durs[0]} horas por ${r.modalidade === 'multi_profissional' ? 'profissional' : 'diária'}`] : [ls.map((l) => `${l.rotulo}: ${l.duracaoHoras}h`).join(' · ')], 'local'),
    r.modalidade === 'pacote' ? item('Frequência', [`${T3.frequencias[r.frequencia] || 'Datas avulsas'}, ${ls.length} diárias`], 'datas') : null,
    r.modalidade === 'multi_profissional' ? item('Profissionais', [`${ls.length} profissionais no mesmo dia`], 'configuracao') : null,
  ]);

  // ---------- 2. Valores e pagamento (itens 35, 38, 40, 49, 50) ----------
  const valores = el('div', { class: 'bloco-valor', 'aria-live': 'polite' }, [el('p', { class: 'mudo', text: 'Calculando o valor…' })]);
  const pagamento = el('div', { class: 'revisao-pagamento' });
  const avisoNovo = el('div', { class: 'aviso-novo-endereco' });
  const cupomCampo = campo({ id: 'cupom', rotulo: T3.cupomCampo, valor: r.cupomAplicado || r.cupom, attrs: { maxlength: 30, autocomplete: 'off', autocapitalize: 'characters' } });
  const cupomMsg = el('p', { class: 'cupom-msg', id: 'cupom-msg', 'aria-live': 'polite' });
  const cupomBtn = el('button', { type: 'button', class: 'btn btn-secundario btn-pequeno', dataset: { acao: 'aplicar-cupom' }, text: T3.cupomAplicar });
  const blocoValores = el('div', { class: 'revisao-bloco', dataset: { bloco: 'valores' } }, [
    el('h3', { text: T3.blocoValores }), valores,
    el('div', { class: 'cupom', role: 'group', 'aria-labelledby': 'cupom-pergunta' }, [el('p', { class: 'pergunta', id: 'cupom-pergunta', text: T3.cupomPergunta }), el('div', { class: 'cupom-linha' }, [cupomCampo.raiz, cupomBtn]), cupomMsg]),
    pagamento, avisoNovo,
  ]);

  // ---------- 3. Finalização (itens 36, 51 a 55) ----------
  const origemExtra = el('div', { class: 'origem-extra' });
  const desenharOrigemExtra = () => {
    const o = r.origem.origem;
    if (o !== 'indicacao' && o !== 'outro') { trocar(origemExtra); return; }
    const k = o === 'indicacao' ? 'quemIndicou' : 'outroQual';
    const f = campo({ id: k, rotulo: o === 'indicacao' ? T3.quemIndicou : 'Qual?', valor: r.origem[k], attrs: { maxlength: 80 } });
    f.input.addEventListener('input', () => { r.origem[k] = f.input.value; salvar(); });
    trocar(origemExtra, f.raiz);
  };
  const origem = cardsEscolha({
    nome: 'origem', legenda: T3.origemPergunta, valor: r.origem.origem, colunas: 3,
    opcoes: Object.entries(T3.origens).map(([k, v]) => ({ valor: k, titulo: v })),
    aoMudar: (v) => { r.origem.origem = v; salvar(); desenharOrigemExtra(); },
  });
  desenharOrigemExtra();
  let leuTermos = false;
  const aceite = el('input', { type: 'checkbox', id: 'aceite-termos-v3', name: 'aceite' });
  const abrirTermos = el('button', { type: 'button', class: 'btn btn-secundario', dataset: { acao: 'ler-termos' }, text: T3.lerTermos, on: { click: () => abrirCondicoes() } });
  const linkTermos = el('button', { type: 'button', class: 'btn-link link-texto', dataset: { acao: 'termos-condicoes' }, text: 'Termos e Condições do atendimento', on: { click: (ev) => { ev.preventDefault(); abrirCondicoes(); } } });
  const declaracao = el('label', { class: 'aceite-unico', for: 'aceite-termos-v3' }, [aceite, el('span', {}, [
    'Declaro que li e concordo com os ', linkTermos, ' e estou ciente dos ',
    el('a', { href: url('termos/'), target: '_blank', rel: 'noopener', text: 'Termos de Uso' }), ' e da ',
    el('a', { href: url('privacidade/'), target: '_blank', rel: 'noopener', text: 'Política de Privacidade' }), '.',
  ])]);
  const erroAceite = el('p', { class: 'erro-campo', id: 'aceite-erro', 'aria-live': 'polite' });
  const enviar = el('button', { type: 'button', class: 'btn btn-primary btn-enviar', text: T3.botaoFinal, disabled: true });
  const erroGeral = el('p', { class: 'alerta alerta-erro', role: 'alert', hidden: true, tabindex: -1 });
  let cot = null;
  const atualizarBotao = () => { enviar.disabled = !cot || !leuTermos || !aceite.checked; };
  aceite.addEventListener('change', () => { erroAceite.textContent = ''; atualizarBotao(); });
  const blocoFinal = el('div', { class: 'revisao-bloco', dataset: { bloco: 'finalizacao' } }, [
    el('h3', { text: T3.blocoFinalizacao }), origem.raiz, origemExtra,
    el('p', { class: 'alerta alerta-info aviso-final', id: 'aviso-disponibilidade', text: T3.avisoFinal }),
    el('div', { class: 'aceite-bloco', dataset: { aceite: 'unico' } }, [
      el('h4', { text: T3.aceiteTitulo }), el('p', { text: T3.aceiteTexto }), abrirTermos, declaracao, erroAceite,
    ]),
  ]);

  async function abrirCondicoes() {
    const corpo = el('div', { class: 'texto-legal texto-modal' }, [el('p', { class: 'mudo', text: 'Carregando…' })]);
    abrirPainel('Termos e Condições do atendimento', [corpo, el('p', {}, [el('a', { href: url('condicoes/'), target: '_blank', rel: 'noopener', text: 'Abrir em outra aba' })])]);
    leuTermos = true; atualizarBotao();
    try {
      const html = await (await fetch(url('condicoes/'))).text();
      const art = new DOMParser().parseFromString(html, 'text/html').getElementById('texto-legal');
      art?.querySelector('h1')?.remove();
      art?.querySelector('#escopo-servicos')?.remove();
      if (art) trocar(corpo, ...[...art.childNodes].map((n) => document.importNode(n, true)));
    } catch {
      trocar(corpo, el('p', {}, ['Não conseguimos carregar agora. ', el('a', { href: url('condicoes/'), target: '_blank', rel: 'noopener', text: 'Abra os Termos e Condições em outra aba' }), '.']));
    }
  }

  const dadosBase = () => ({ ...montarPedido(ctx), ...(logada() ? {} : { ticket: r.ticket }) });
  function mostrarCotacao(c) {
    const ls2 = linhasDeValor(c);
    trocar(valores, el('dl', { class: 'linhas-valor' }, ls2.flatMap(([a, b, cod]) => [el('dt', { dataset: { valor: cod }, text: a }), el('dd', { dataset: { valor: cod }, text: b })])),
      el('p', { class: 'valor-total' }, [el('span', { text: 'Total: ' }), el('strong', { dataset: { valor: 'total' }, text: brl(c.totalCentavos) })]));
    const p = [];
    if (c.faturamento) p.push(T3.pagamentoFaturamento);
    else if (c.modalidade === 'pacote') p.push(T3.pagamentoPacote, T3.pagamentoPacote2);
    else p.push(T3.pagamentoTexto);
    trocar(pagamento, el('h4', { text: T3.pagamento }), ...p.map((x) => el('p', { text: x })));
    trocar(avisoNovo, c.pacoteEnderecoNovo ? el('div', { class: 'alerta alerta-info', dataset: { aviso: 'pacote-endereco-novo' } }, [el('p', { class: 'forte', text: T3.novoEnderecoPacote }), el('p', { text: T3.novoEnderecoPacoteTexto })]) : null);
  }
  async function cotar(cupom) {
    const d = dadosBase();
    if (cupom !== undefined) d.pedido = { ...d.pedido, cupom: cupom || undefined };
    return api.cotarV3(d);
  }
  cupomBtn.addEventListener('click', async () => {
    const codigo = cupomCampo.input.value.trim().toUpperCase();
    cupomMsg.className = 'cupom-msg';
    if (!codigo) { cupomMsg.textContent = ''; r.cupomAplicado = ''; salvar(); return; }
    cupomBtn.disabled = true;
    try {
      const c = await cotar(codigo);
      if (c.cupom?.aplicado) { r.cupomAplicado = codigo; cupomMsg.textContent = T3.cupomOk; cupomMsg.classList.add('ok'); cot = c; mostrarCotacao(c); }
      else { r.cupomAplicado = ''; cupomMsg.textContent = T3.cupomErro; cupomMsg.classList.add('erro'); cot = await cotar(''); mostrarCotacao(cot); }
      r.cupom = codigo; salvar();
    } catch (e) { cupomMsg.textContent = mensagemErro(e); cupomMsg.classList.add('erro'); }
    finally { cupomBtn.disabled = false; atualizarBotao(); }
  });

  enviar.addEventListener('click', async () => {
    if (enviar.getAttribute('aria-busy') === 'true') return;
    if (!leuTermos) { erroAceite.textContent = 'Abra os Termos e Condições do atendimento antes de aceitar.'; abrirTermos.focus(); return; }
    if (!aceite.checked) { erroAceite.textContent = 'Marque a declaração para enviar.'; aceite.focus(); return; }
    // desabilita na hora (item 55): duplo clique não envia duas vezes; a chave repete o mesmo envio se a resposta se perder
    enviar.disabled = true; enviar.setAttribute('aria-busy', 'true'); erroGeral.hidden = true;
    const dados = { ...dadosBase(), origem: r.origem.origem ? r.origem : undefined, aceite: { condicoes: VERSAO_CONDICOES, legal: VERSAO_LEGAL, leuTermos: true }, valorEsperadoCentavos: cot.totalCentavos };
    const conteudo = JSON.stringify(dados);
    if (r.chaveConteudo !== conteudo) { r.chave = novaChave(); r.chaveConteudo = conteudo; salvar(); }
    try {
      const res = await api.solicitarV3(dados, { chave: r.chave });
      telaFinal(ctx, res);
    } catch (e) {
      enviar.removeAttribute('aria-busy');
      if (e.codigo === 'CONFLITO_IDEMPOTENCIA') { r.chave = novaChave(); r.chaveConteudo = ''; salvar(); }
      if (e.detalhes?.precoMudou) { try { cot = await cotar(r.cupomAplicado); mostrarCotacao(cot); } catch { /* segue com a mensagem */ } }
      mostrarErro(erroGeral, e.detalhes?.precoMudou ? 'O valor foi atualizado. Confira a revisão antes de enviar.' : e.codigo === 'SERVICO_INDISPONIVEL' ? 'Não conseguimos falar com o servidor. Sua solicitação está salva; tente de novo.' : mensagemErro(e));
      atualizarBotao();
    }
  });

  const voltarBtn = el('button', { class: 'btn btn-secundario', type: 'button', text: 'Voltar', on: { click: ctx.voltar } });
  anexar(sec, el('h2', { id: 'titulo-passo', class: 'titulo-passo', text: T3.tituloRevisao, tabindex: -1 }), blocoResumo, blocoValores, blocoFinal, erroGeral,
    el('div', { class: 'barra-acoes' }, [voltarBtn, el('span', { class: 'espaco' }), enviar]));

  (async () => {
    try { cot = await cotar(r.cupomAplicado || ''); mostrarCotacao(cot); if (r.cupomAplicado) { cupomMsg.textContent = T3.cupomOk; cupomMsg.classList.add('ok'); } }
    catch (e) { trocar(valores, el('p', { class: 'alerta alerta-erro', text: e.codigo === 'DATA_INVALIDA' ? `${e.message}. Altere as datas ou o horário.` : `${mensagemErro(e)} Recarregue a página para ver o valor.` })); }
    atualizarBotao();
  })();
  return sec;
}

/** Item 55: "Solicitação recebida!" com o número (6 dígitos) e o próximo passo. */
export function telaFinal(ctx, res) {
  const raiz = document.querySelector('.fluxo-agendamento');
  const numero = res?.pedido?.numero;
  const acompanhar = logada() && res?.pedido?.id ? url('acompanhamento/', { pedido: res.pedido.id }) : url('entrar/');
  trocar(raiz, el('section', { class: 'passo-fluxo enviado', 'aria-labelledby': 'titulo-passo', dataset: { passo: 'enviado' } }, [
    el('h2', { id: 'titulo-passo', class: 'titulo-passo', text: T3.recebida, tabindex: -1 }),
    numero ? el('p', { class: 'numero-solicitacao', dataset: { numero: String(numero) }, text: T3.numero(numero) }) : null,
    el('p', { text: T3.recebidaTexto }),
    el('div', { class: 'acoes' }, [el('a', { class: 'btn btn-primary', href: acompanhar, text: logada() ? 'Acompanhar a solicitação' : 'Entrar na minha conta' })]),
  ]));
  apagarRascunho(); trocarRascunho(novoRascunho()); apagarRascunho();
  document.getElementById('titulo-passo')?.focus?.();
  window.scrollTo?.({ top: 0 });
}
