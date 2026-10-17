// Etapa 5, configuração (item 21): no pacote, um card recolhível por diária ("Diária 1 — 08/10"); em várias profissionais,
// um por profissional ("Profissional 1") e "+ Adicionar profissional". Cada um com Serviço, Endereço, Duração e Horário,
// por seleção (sem formulário extenso); só o primeiro aberto. Endereço novo num card: CEP + número + tipo, validado
// pela área atendida (item 6). Pacote com endereço novo: "Novo endereço no pacote" (item 46); a Prime valida.
import { el, trocar, cardsEscolha, moldura } from './ui.js';
import { campo, aplicarErros } from '../../form.js';
import { seletorHorario } from './seletor-horario.js';
import { buscarCEP } from '../../../services/cep.js';
import { CONFIG_PRECOS as CFG } from '../../../config/precos.js';
import { SERVICOS_AGENDAMENTO as SERVICOS } from '../../../config/agendamento.js';
import { T3 } from '../../../config/agendamento-v3.js';
import { horariosPermitidos, regiaoV3 } from '../../../domain/agendamento-v3.js';
import * as V from '../../../domain/validacao.js';
import { estado, salvar, logada, vazioEndereco } from './estado.js';
import { linhas, resolverEndereco } from './pedido.js';
import { enderecoEmLinha } from './passo-endereco.js';
import { rotuloData } from './passo-datas.js';
import { recomendacao } from './passo-local.js';

const P = CFG.PRECOS;

/** Opções de endereço: o da etapa 3, os salvos (cliente logada), os novos já criados nos cards e "Outro endereço". */
function opcoesEndereco(ctx) {
  const r = estado();
  const princ = resolverEndereco('principal', ctx);
  const op = [['principal', princ ? (r.endereco.modo === 'salvo' && princ.endereco.apelido) || enderecoEmLinha(princ.endereco) : 'Endereço da etapa anterior']];
  for (const e of ctx.enderecos || []) if (!(r.endereco.modo === 'salvo' && e.id === r.endereco.id)) op.push([`salvo:${e.id}`, e.apelido || enderecoEmLinha(e)]);
  r.enderecosExtras.forEach((e, i) => { if (e.cidade) op.push([`extra:${i}`, enderecoEmLinha(e)]); });
  op.push(['outro', 'Outro endereço']);
  return op;
}

/** O pacote usa endereço que ainda não é do cadastro (item 46)? */
export function pacoteComEnderecoNovo(ctx) {
  const r = estado();
  if (r.modalidade !== 'pacote') return false;
  const refs = new Set(linhas().map((l) => l.endereco));
  if ([...refs].some((x) => x.startsWith('extra:'))) return true;
  return refs.has('principal') && r.endereco.modo === 'novo' && (r.endereco.uso === 'unico' || (logada() && (ctx.enderecos || []).length > 0));
}

export function faltaConfiguracao(ctx) {
  const r = estado();
  if (!['pacote', 'multi_profissional'].includes(r.modalidade)) return null;
  const servicos = P.servicosPorTipoCliente[r.segmento] || [];
  const tipos = ctx.conteudo.tiposImovel[r.segmento === 'empresa' ? 'empresa' : 'residencial'];
  for (const l of linhas()) {
    if (!servicos.includes(l.servico)) return `${l.rotulo}: escolha o serviço`;
    if (!P.duracoes[l.duracaoHoras]) return `${l.rotulo}: escolha a duração`;
    if (Number(l.duracaoHoras) === 2 && l.servico !== 'passadoria' && l.servico === r.servico && Number(r.caracteristicas?.metragem) > P.duracoes[2].metragemMaxima) return `${l.rotulo}: a diária de 2 horas é só para locais até ${P.duracoes[2].metragemMaxima} m²`;
    if (!horariosPermitidos(l.duracaoHoras, l.data, CFG).includes(l.horaInicio)) return `${l.rotulo}: escolha o horário`;
    if (l.endereco === 'outro') return `${l.rotulo}: informe o outro endereço`;
    if (l.endereco.startsWith('extra:')) {
      const e = r.enderecosExtras[Number(l.endereco.slice(6))];
      const er = e ? V.validarEnderecoV3(e, tipos) : { cep: 'Informe o CEP' };
      if (Object.keys(er).length) return `${l.rotulo}: ${Object.values(er)[0]}`;
      const reg = regiaoV3(e, CFG);
      if (!reg || reg.sobConsulta) return `${l.rotulo}: ${T3.foraArea}`;
      if (!e.uso) return `${l.rotulo}: escolha como deseja utilizar este endereço`;
    }
    if (!resolverEndereco(l.endereco, ctx)) return `${l.rotulo}: escolha o endereço`;
    const rec = l.servico === r.servico ? recomendacao().horas : null;
    if (rec && l.duracaoHoras < rec && !(r.cienteMenor && l.duracaoHoras >= r.duracaoHoras) && !r.itens[l.chave]?.ciente) return `${l.rotulo}: confirme a duração menor que a sugerida`;
  }
  return null;
}

export function passoConfiguracao(ctx) {
  const r = estado();
  const lista = el('div', { class: 'lista-config' });
  const avisoNovo = el('div', { class: 'aviso-novo-endereco', 'aria-live': 'polite' });
  const servicos = P.servicosPorTipoCliente[r.segmento] || [];
  const tipos = ctx.conteudo.tiposImovel[r.segmento === 'empresa' ? 'empresa' : 'residencial'];
  const atualizarAviso = () => trocar(avisoNovo, pacoteComEnderecoNovo(ctx)
    ? el('div', { class: 'alerta alerta-info', dataset: { aviso: 'pacote-endereco-novo' } }, [el('p', { class: 'forte', text: T3.novoEnderecoPacote }), el('p', { text: T3.novoEnderecoPacoteTexto })]) : null);
  const ls = linhas();
  // cards abertos sobrevivem ao redesenho (mudar um campo não fecha o card em que a pessoa está)
  const abertos = new Set([ls[0]?.chave]);
  const desenhar = () => {
    // o evento toggle chega depois: o estado aberto vem do DOM na hora de redesenhar
    lista.querySelectorAll('details.card-config').forEach((d) => { if (d.open) abertos.add(d.dataset.linha); else abertos.delete(d.dataset.linha); });
    const ls2 = linhas();
    trocar(lista, ...ls2.map((l, i) => cardLinha(l, i, ls2)));
    atualizarAviso();
  };
  function cardLinha(l, i, todas) {
    const x = (r.itens[l.chave] ||= {});
    const titulo = r.modalidade === 'pacote' ? `${l.rotulo} · ${rotuloData(l.data, todas.map((y) => y.data))}` : l.rotulo; // "Diária 1 — 08/10" do item 21, sem o travessão (verifica-texto)
    const resumo = el('span', { class: 'config-resumo', text: `${SERVICOS[l.servico]?.nome || 'Serviço'} • ${l.duracaoHoras}h • ${l.horaInicio || '--:--'}` });
    const det = el('details', { class: 'card-config', dataset: { linha: l.chave }, open: abertos.has(l.chave) }, [el('summary', {}, [el('strong', { text: titulo }), resumo])]);
    det.addEventListener('toggle', () => { if (det.open) abertos.add(l.chave); else abertos.delete(l.chave); });
    const corpo = el('div', { class: 'card-config-corpo' });
    const sServ = campo({ id: `serv-${l.chave}`, rotulo: 'Serviço', tipo: 'select', valor: l.servico, opcoes: servicos.map((k) => [k, SERVICOS[k].nome]) });
    sServ.input.addEventListener('change', () => { x.servico = sServ.input.value; salvar(); desenhar(); });
    const sEnd = campo({ id: `end-${l.chave}`, rotulo: 'Endereço', tipo: 'select', valor: l.endereco, opcoes: opcoesEndereco(ctx) });
    sEnd.input.addEventListener('change', () => {
      if (sEnd.input.value === 'outro') { r.enderecosExtras.push({ ...vazioEndereco(), uso: '' }); x.endereco = `extra:${r.enderecosExtras.length - 1}`; } else x.endereco = sEnd.input.value;
      salvar(); desenhar();
    });
    const sDur = campo({ id: `dur-${l.chave}`, rotulo: 'Duração', tipo: 'select', valor: String(l.duracaoHoras), opcoes: Object.keys(P.duracoes).map((h) => [h, `${h} horas`]) });
    sDur.input.addEventListener('change', () => { x.duracaoHoras = Number(sDur.input.value); x.ciente = false; salvar(); desenhar(); });
    const individual = r.modalidade === 'pacote' ? r.manterHorario === false : (r.manterHorario === false && i > 0);
    // horário: individual (escolhido aqui) ou o mesmo de todas (só leitura; muda na tela de datas)
    const hora = individual ? seletorHorario({
      id: `hora-${l.chave}`, rotulo: `Horário (${titulo})`, duracaoHoras: l.duracaoHoras, data: l.data, valor: l.horaInicio,
      aoMudar: (v) => { if (r.modalidade === 'pacote') r.horarios[l.data] = v; else x.horaInicio = v; salvar(); resumo.textContent = `${SERVICOS[l.servico]?.nome} • ${l.duracaoHoras}h • ${v || '--:--'}`; },
    }) : { raiz: el('p', { class: 'mudo', text: horariosPermitidos(l.duracaoHoras, l.data, CFG).includes(l.horaInicio) ? `${l.horaInicio} (o mesmo em todas)` : `O horário ${l.horaInicio} não cabe com ${l.duracaoHoras} horas: escolha horários individuais na etapa anterior.` }) };
    const extra = l.endereco.startsWith('extra:') ? formularioExtra(Number(l.endereco.slice(6)), l.chave) : null;
    const rec = l.servico === r.servico ? recomendacao().horas : null;
    const menor = rec && l.duracaoHoras < rec && !(r.cienteMenor && l.duracaoHoras >= r.duracaoHoras);
    const alerta = menor ? el('div', { class: 'alerta alerta-aviso' }, [
      el('p', { class: 'alerta-titulo', text: T3.atencao }), el('p', { text: T3.alertaMenor }),
      x.ciente ? el('p', { class: 'mudo', text: 'Ciente.' }) : el('button', { type: 'button', class: 'btn btn-secundario btn-pequeno', text: T3.ciente, on: { click: () => { x.ciente = true; salvar(); desenhar(); } } }),
    ]) : null;
    corpo.append(sServ.raiz, sEnd.raiz, ...(extra ? [extra] : []), sDur.raiz, ...(alerta ? [alerta] : []),
      el('div', { class: 'campo' }, [el('span', { class: 'rotulo-campo', text: 'Horário' }), hora.raiz]));
    if (r.modalidade === 'multi_profissional' && i >= 2) {
      corpo.append(el('button', { type: 'button', class: 'btn-link', text: `Remover ${l.rotulo.toLowerCase()}`, on: { click: () => {
        // tira esta e renumera as seguintes
        const novos = {}; let j = 0;
        for (let k = 0; k < r.qtdProfissionais; k++) { if (k === i) continue; if (r.itens[`p${k}`]) novos[`p${j}`] = r.itens[`p${k}`]; j++; }
        for (const k of Object.keys(r.itens)) if (/^p\d+$/.test(k)) delete r.itens[k];
        Object.assign(r.itens, novos); r.qtdProfissionais -= 1; salvar(); desenhar();
      } } }));
    }
    det.append(corpo);
    return det;
  }
  /** Endereço novo dentro de um card: CEP, número, complemento, tipo e uso. */
  function formularioExtra(k, chaveLinha) {
    const e = r.enderecosExtras[k];
    const caixa = el('div', { class: 'endereco-extra' });
    const status = el('div', { class: 'status-cep', 'aria-live': 'polite' });
    const cep = campo({ id: `cep-${chaveLinha}`, rotulo: 'CEP', valor: V.mascaraCEP(e.cep), mascara: V.mascaraCEP, attrs: { inputmode: 'numeric', maxlength: 9 } });
    let ultimo = '';
    cep.input.addEventListener('input', async () => {
      const d = V.soDigitos(cep.input.value);
      if (d.length !== 8 || d === ultimo) return;
      ultimo = d; e.cep = d; trocar(status, el('p', { class: 'ajuda', text: 'Verificando…' }));
      const res = await buscarCEP(d);
      if (V.soDigitos(cep.input.value) !== d) return;
      if (!res || res.naoExiste) { trocar(status, el('p', { class: 'erro-campo', text: res?.naoExiste ? 'CEP não encontrado. Confira os números.' : 'Não conseguimos consultar o CEP agora.' })); return; }
      Object.assign(e, { logradouro: res.logradouro, bairro: res.bairro, cidade: res.cidade, uf: res.uf || 'MG' });
      salvar();
      const reg = regiaoV3(e, CFG);
      if (!reg || reg.sobConsulta) { trocar(status, el('p', { class: 'alerta alerta-info', dataset: { regiao: 'nao-atendida' }, text: `${T3.foraArea} ${T3.foraAreaContato}` })); return; }
      desenhar();
    });
    const partes = [cep.raiz, status];
    if (e.cidade && regiaoV3(e, CFG) && !regiaoV3(e, CFG).sobConsulta) {
      const c = {
        logradouro: campo({ id: `rua-${chaveLinha}`, rotulo: 'Rua', valor: e.logradouro, attrs: { maxlength: 120 } }),
        numero: campo({ id: `num-${chaveLinha}`, rotulo: 'Número', valor: e.numero, attrs: { maxlength: 10 } }),
        complemento: campo({ id: `comp-${chaveLinha}`, rotulo: 'Complemento', ajuda: T3.ajudaComplemento, valor: e.complemento, attrs: { maxlength: 60 } }),
        bairro: campo({ id: `bairro-${chaveLinha}`, rotulo: 'Bairro', valor: e.bairro, attrs: { maxlength: 80 } }),
        tipoImovel: campo({ id: `tipo-${chaveLinha}`, rotulo: T3.tipoImovel, tipo: 'select', valor: e.tipoImovel, opcoes: [['', 'Escolha o tipo do imóvel'], ...tipos.map((t) => [t, t])] }),
      };
      for (const kk of ['logradouro', 'numero', 'complemento', 'bairro']) c[kk].input.addEventListener('input', () => { e[kk] = c[kk].input.value; salvar(); });
      c.tipoImovel.input.addEventListener('change', () => { e.tipoImovel = c.tipoImovel.input.value; salvar(); desenhar(); });
      partes.push(el('p', { class: 'alerta alerta-ok', dataset: { regiao: 'atendida' }, text: `Atendemos ${e.cidade}.` }), c.logradouro.raiz, c.numero.raiz, c.complemento.raiz, c.bairro.raiz, c.tipoImovel.raiz);
      if (e.tipoImovel === 'Outro') {
        const o = campo({ id: `tipo-outro-${chaveLinha}`, rotulo: T3.tipoImovelOutro, valor: e.tipoImovelOutro, attrs: { maxlength: 40 } });
        o.input.addEventListener('input', () => { e.tipoImovelOutro = o.input.value; salvar(); });
        partes.push(o.raiz);
      }
      partes.push(cardsEscolha({
        nome: `uso-${chaveLinha}`, legenda: T3.usoEndereco, valor: e.uso, colunas: 2,
        opcoes: [{ valor: 'salvar', titulo: T3.salvar, sub: T3.salvarSub }, { valor: 'unico', titulo: T3.unico, sub: T3.unicoSub }],
        aoMudar: (v) => { e.uso = v; salvar(); atualizarAviso(); },
      }).raiz);
      if (ctx.errosExtra?.[k]) queueMicrotask(() => aplicarErros(ctx.errosExtra[k], c));
    }
    trocar(caixa, el('p', { class: 'subtitulo-passo', text: 'Outro endereço' }), ...partes);
    return caixa;
  }
  const adicionar = r.modalidade === 'multi_profissional'
    ? el('button', { type: 'button', class: 'btn btn-secundario', dataset: { acao: 'adicionar-profissional' }, text: T3.adicionarProfissional, on: { click: () => {
      if (r.qtdProfissionais >= CFG.PRECOS.v3.limites.maximoProfissionais) return;
      r.qtdProfissionais += 1; salvar(); desenhar();
      abertos.clear(); abertos.add(`p${r.qtdProfissionais - 1}`);
      lista.querySelectorAll('details').forEach((d) => { d.open = abertos.has(d.dataset.linha); });
      lista.querySelector(`[data-linha="p${r.qtdProfissionais - 1}"] summary`)?.focus();
    } } })
    : null;
  desenhar();
  const titulo = r.modalidade === 'pacote' ? 'Configure as diárias' : 'Configure as profissionais';
  return moldura({
    passo: 'configuracao', titulo, sub: ls.length > 1 ? 'Toque em cada uma para mudar serviço, endereço, duração ou horário.' : null,
    corpo: [lista, adicionar, avisoNovo], aoVoltar: ctx.voltar, aoAvancar: ctx.avancar,
    validar: () => {
      const f = faltaConfiguracao(ctx);
      if (f) { const l = linhas().find((x) => f.startsWith(x.rotulo)); if (l) { abertos.add(l.chave); const d = lista.querySelector(`[data-linha="${l.chave}"]`); if (d) d.open = true; } }
      return f || true;
    },
  });
}

