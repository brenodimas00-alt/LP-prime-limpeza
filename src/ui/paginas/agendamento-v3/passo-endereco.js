// Etapa 3. Endereço do atendimento (itens 6 a 9).
// - Cliente que entrou: escolhe um endereço salvo ou "Adicionar novo endereço"; em cada salvo, "Substituir endereço" (o
//   anterior fica inativo, nunca apagado) e, discreto, "Solicitar remoção" (WhatsApp com o endereço já na mensagem).
// - Endereço novo (inclusive de quem já é cliente): CEP primeiro ("Informe o CEP do local do atendimento"); fora da área, o
//   texto do item 6 e "Falar com a Prime", sem prosseguir. Atendido: os campos do item 7 aparecem na MESMA tela, tipo do
//   imóvel filtrado pelo segmento (item 8) e "Como deseja utilizar este endereço?" com a identificação opcional só no salvo.
import { el, trocar, cardsEscolha, moldura } from './ui.js';
import { campo, aplicarErros } from '../../form.js';
import { api } from '../../../services/api.js';
import { buscarCEP } from '../../../services/cep.js';
import { linkContatoManual } from '../../../services/whatsapp.js';
import { configPrime } from '../../../config/app.js';
import { hrefSeguro } from '../../dom.js';
import { executarAcao, mensagemErro } from '../../acoes.js';
import { botaoWhatsAppManual } from '../../whatsapp-manual.js';
import { CONFIG_PRECOS as CFG } from '../../../config/precos.js';
import { T3 } from '../../../config/agendamento-v3.js';
import { regiaoV3 } from '../../../domain/agendamento-v3.js';
import * as V from '../../../domain/validacao.js';
import { estado, salvar, logada, vazioEndereco } from './estado.js';

/** "Rua X, 10, ap 2 - Bairro, Cidade/UF" (uma linha, pro card e pra mensagem de remoção). */
export function enderecoEmLinha(e) {
  return `${e.logradouro}, ${e.numero}${e.complemento ? `, ${e.complemento}` : ''} - ${e.bairro}, ${e.cidade}/${e.uf}`;
}

function linkRemocao(e) {
  const href = hrefSeguro(linkContatoManual(configPrime(), T3.remocaoMensagem(enderecoEmLinha(e))) || '');
  return href ? el('a', { class: 'btn-terciario link-discreto', href, target: '_blank', rel: 'noopener', dataset: { acao: 'solicitar-remocao' }, text: T3.solicitarRemocao }) : null;
}

export function passoEndereco(ctx) {
  const r = estado();
  const raiz = el('div', { class: 'bloco-endereco' });
  const desenhar = () => {
    if (logada() && !r.endereco.substituindo) {
      if (!ctx.enderecos) {
        trocar(raiz, el('p', { class: 'mudo', text: 'Carregando seus endereços…' }));
        api.meusEnderecos().then((l) => { ctx.enderecos = l; }).catch(() => { ctx.enderecos = []; }).finally(desenhar);
        return;
      }
      const salvos = ctx.enderecos;
      if (salvos.length && !r.endereco.modo) { r.endereco.modo = 'salvo'; r.endereco.id = salvos[0].id; salvar(); }
      const g = cardsEscolha({
        nome: 'enderecoSalvo', legenda: 'Endereço do atendimento', valor: r.endereco.modo === 'novo' ? 'novo' : r.endereco.id, colunas: 1, classe: 'cards-endereco',
        opcoes: [
          ...salvos.map((e) => ({
            valor: e.id, titulo: e.apelido || enderecoEmLinha(e), sub: e.apelido ? enderecoEmLinha(e) : (e.tipoImovel || null),
            extra: el('div', { class: 'acoes-endereco' }, [
              el('button', { type: 'button', class: 'btn-terciario', dataset: { acao: 'substituir', endereco: e.id }, text: T3.substituir, on: { click: () => { r.endereco.substituindo = e.id; r.endereco.novo = vazioEndereco(); r.endereco.cepSituacao = ''; salvar(); desenhar(); } } }),
              linkRemocao(e),
            ]),
          })),
          { valor: 'novo', titulo: T3.adicionarEndereco },
        ],
        aoMudar: (v) => { if (v === 'novo') { r.endereco.modo = 'novo'; r.endereco.id = ''; } else { r.endereco.modo = 'salvo'; r.endereco.id = v; } salvar(); desenhar(); },
      });
      trocar(raiz, g.raiz, r.endereco.modo === 'novo' || !salvos.length ? formularioNovo(ctx, desenhar) : null);
      if (!salvos.length && r.endereco.modo !== 'novo') { r.endereco.modo = 'novo'; salvar(); }
      return;
    }
    if (!logada()) r.endereco.modo = 'novo';
    trocar(raiz, formularioNovo(ctx, desenhar));
  };
  desenhar();
  const titulo = r.endereco.substituindo ? T3.substituir : logada() ? 'Onde será o atendimento?' : T3.tituloCep;
  return moldura({
    passo: 'endereco', titulo, sub: !logada() && !r.endereco.substituindo ? T3.subCep : null, corpo: [raiz], aoVoltar: ctx.voltar, aoAvancar: ctx.avancar,
    validar: () => validarEndereco(ctx, raiz),
  });
}

/** Valida o passo (e, na substituição, grava já: é uma ação da conta da cliente). */
async function validarEndereco(ctx, raiz) {
  const r = estado();
  if (r.endereco.modo === 'salvo' && !r.endereco.substituindo) {
    const e = (ctx.enderecos || []).find((x) => x.id === r.endereco.id);
    if (!e) return 'Escolha o endereço do atendimento';
    const reg = regiaoV3(e, CFG);
    if (!reg || reg.sobConsulta) return `${T3.foraArea} ${T3.foraAreaContato}`;
    return true;
  }
  if (r.endereco.cepSituacao !== 'atendida') {
    const cep = raiz.querySelector('#cep');
    if (V.soDigitos(cep?.value).length !== 8) { cep?.focus(); return 'Informe o CEP com 8 números'; }
    return r.endereco.cepSituacao === 'nao_atendida' ? T3.foraArea : 'Aguarde a verificação do CEP';
  }
  const tipos = ctx.conteudo.tiposImovel[r.segmento === 'empresa' ? 'empresa' : 'residencial'];
  const erros = V.validarEnderecoV3(r.endereco.novo, tipos);
  if (Object.keys(erros).length) { aplicarErros(erros, ctx.camposEndereco || {}); return false; }
  if (r.endereco.substituindo) {
    const b = raiz.closest('form')?.querySelector('button[type=submit]');
    return new Promise((ok) => executarAcao(b, (chave) => api.substituirEndereco(r.endereco.substituindo, { endereco: r.endereco.novo, apelido: r.endereco.apelido }, { chave }), {
      aoSucesso: (novo) => {
        ctx.enderecos = null; r.endereco = { ...r.endereco, substituindo: '', modo: 'salvo', id: novo.id, novo: vazioEndereco(), cepSituacao: '', apelido: '' };
        salvar(); ctx.render(); ok(false);
      },
      aoErro: (e) => { if (e.detalhes) aplicarErros(Object.fromEntries(Object.entries(e.detalhes).map(([k, v]) => [k.replace('endereco.', ''), v])), ctx.camposEndereco || {}); ok(mensagemErro(e)); },
    }));
  }
  if (!r.endereco.uso) { ctx.grupoUso?.erro('Escolha como deseja utilizar este endereço'); return false; }
  return true;
}

/** CEP + campos do endereço novo + uso (salvar / só neste atendimento). */
function formularioNovo(ctx, redesenhar) {
  const r = estado();
  const n = r.endereco.novo;
  const caixa = el('div', { class: 'endereco-novo' });
  const cep = campo({ id: 'cep', rotulo: 'CEP', valor: V.mascaraCEP(n.cep), mascara: V.mascaraCEP, attrs: { inputmode: 'numeric', autocomplete: 'postal-code', maxlength: 9 } });
  const status = el('div', { class: 'status-cep', 'aria-live': 'polite', id: 'status-cep' });
  const detalhes = el('div', { class: 'detalhes-endereco' });
  let ultimo = '';
  const mostrar = () => {
    if (r.endereco.cepSituacao === 'atendida') {
      trocar(status, el('p', { class: 'alerta alerta-ok', dataset: { regiao: 'atendida' }, text: `Atendemos ${n.cidade}.` }));
      desenharDetalhes();
    } else if (r.endereco.cepSituacao === 'nao_atendida') {
      trocar(detalhes);
      trocar(status, el('div', { class: 'alerta alerta-info', dataset: { regiao: 'nao-atendida' } }, [
        el('p', { class: 'forte', text: T3.foraArea }), el('p', { text: T3.foraAreaContato }),
        el('div', { class: 'acoes' }, [botaoWhatsAppManual({ texto: `Olá! Gostaria de confirmar se a Prime atende o CEP ${V.mascaraCEP(n.cep)}${n.cidade ? ` (${n.cidade})` : ''}.`, rotulo: T3.falarComPrime, contexto: 'fora-area' })]),
      ]));
    } else if (r.endereco.cepSituacao === 'manual') {
      trocar(detalhes);
      const cidades = CFG.regioesAtendidas.filter((x) => !x.sobConsulta);
      const sel = campo({ id: 'cidade-manual', rotulo: 'Cidade', tipo: 'select', valor: n.cidade, opcoes: [['', 'Escolha a cidade'], ...cidades.map((x) => [x.cidade, x.cidade]), ['__outra', 'Outra cidade']] });
      sel.input.addEventListener('change', () => {
        const v = sel.input.value;
        if (!v) return;
        if (v === '__outra') { n.cidade = ''; r.endereco.cepSituacao = 'nao_atendida'; } else { Object.assign(n, { cidade: v, uf: 'MG' }); r.endereco.cepSituacao = 'atendida'; }
        salvar(); mostrar();
      });
      trocar(status, el('p', { class: 'ajuda', text: 'Não conseguimos consultar o CEP agora. Escolha a cidade para continuar.' }), sel.raiz);
    } else { trocar(status); trocar(detalhes); }
  };
  const consultar = async () => {
    const d = V.soDigitos(cep.input.value);
    if (d.length !== 8) { if (d !== n.cep) { n.cep = d; r.endereco.cepSituacao = ''; salvar(); mostrar(); } return; }
    if (d === ultimo) return;
    ultimo = d; n.cep = d; r.endereco.cepSituacao = ''; salvar();
    trocar(status, el('p', { class: 'ajuda', text: 'Verificando…' })); trocar(detalhes);
    const res = await buscarCEP(d);
    if (V.soDigitos(cep.input.value) !== d) return; // CEP mudou enquanto buscava: resposta velha não vale
    if (!res) { Object.assign(n, { logradouro: '', bairro: '', cidade: '', uf: 'MG' }); r.endereco.cepSituacao = 'manual'; salvar(); mostrar(); return; }
    if (res.naoExiste) { r.endereco.cepSituacao = ''; salvar(); trocar(status); cep.erro('CEP não encontrado. Confira os números.'); return; }
    Object.assign(n, { logradouro: res.logradouro || n.logradouro, bairro: res.bairro || n.bairro, cidade: res.cidade || '', uf: res.uf || 'MG' });
    const reg = regiaoV3(n, CFG);
    r.endereco.cepSituacao = reg && !reg.sobConsulta ? 'atendida' : 'nao_atendida';
    salvar(); mostrar();
  };
  cep.input.addEventListener('input', consultar);

  const desenharDetalhes = () => {
    if (detalhes.firstChild) return;
    const c = {
      logradouro: campo({ id: 'logradouro', rotulo: 'Rua', valor: n.logradouro, attrs: { autocomplete: 'address-line1', maxlength: 120 } }),
      numero: campo({ id: 'numero', rotulo: 'Número', valor: n.numero, attrs: { maxlength: 10, inputmode: 'text' } }),
      complemento: campo({ id: 'complemento', rotulo: 'Complemento', ajuda: T3.ajudaComplemento, valor: n.complemento, attrs: { autocomplete: 'address-line2', maxlength: 60 } }),
      bairro: campo({ id: 'bairro', rotulo: 'Bairro', valor: n.bairro, attrs: { maxlength: 80 } }),
      cidade: campo({ id: 'cidade', rotulo: 'Cidade', valor: n.cidade, attrs: { readonly: true } }),
      uf: campo({ id: 'uf', rotulo: 'Estado', valor: n.uf, attrs: { readonly: true, maxlength: 2 } }),
      pontoReferencia: campo({ id: 'pontoReferencia', rotulo: T3.pontoReferencia, ajuda: T3.ajudaReferencia, valor: n.pontoReferencia, attrs: { maxlength: 120 } }),
    };
    const tipos = ctx.conteudo.tiposImovel[r.segmento === 'empresa' ? 'empresa' : 'residencial'];
    c.tipoImovel = campo({ id: 'tipoImovel', rotulo: T3.tipoImovel, tipo: 'select', valor: n.tipoImovel, opcoes: [['', 'Escolha o tipo do imóvel'], ...tipos.map((t) => [t, t])] });
    const outro = el('div', { class: 'tipo-outro' });
    const desenharOutro = () => {
      if (n.tipoImovel !== 'Outro') { trocar(outro); delete c.tipoImovelOutro; return; }
      c.tipoImovelOutro = campo({ id: 'tipoImovelOutro', rotulo: T3.tipoImovelOutro, valor: n.tipoImovelOutro, attrs: { maxlength: 40 } });
      c.tipoImovelOutro.input.addEventListener('input', () => { n.tipoImovelOutro = c.tipoImovelOutro.input.value; salvar(); });
      trocar(outro, c.tipoImovelOutro.raiz);
    };
    for (const k of ['logradouro', 'numero', 'complemento', 'bairro', 'pontoReferencia']) c[k].input.addEventListener('input', () => { n[k] = c[k].input.value; salvar(); });
    c.tipoImovel.input.addEventListener('change', () => { n.tipoImovel = c.tipoImovel.input.value; salvar(); desenharOutro(); if (n.tipoImovel === 'Outro') c.tipoImovelOutro?.input.focus(); });
    desenharOutro();
    ctx.camposEndereco = c;
    if (ctx.errosPendentes) { const ep = ctx.errosPendentes; ctx.errosPendentes = null; queueMicrotask(() => aplicarErros(Object.fromEntries(Object.entries(ep).map(([k, v]) => [k.replace('endereco.', ''), v])), c)); }
    // uso do endereço (item 9); na substituição o endereço é sempre salvo
    let uso = null;
    if (!r.endereco.substituindo) {
      const apelido = el('div', { class: 'bloco-apelido' });
      const desenharApelido = () => {
        if (r.endereco.uso !== 'salvar') { trocar(apelido); return; }
        const a = campo({ id: 'apelido', rotulo: T3.apelido, ajuda: `${T3.apelidoAjuda} ${T3.apelidoEx}`, valor: r.endereco.apelido, attrs: { maxlength: 40 } });
        a.input.addEventListener('input', () => { r.endereco.apelido = a.input.value; salvar(); });
        trocar(apelido, a.raiz);
      };
      const g = cardsEscolha({
        nome: 'usoEndereco', legenda: T3.usoEndereco, valor: r.endereco.uso, colunas: 2,
        opcoes: [{ valor: 'salvar', titulo: T3.salvar, sub: T3.salvarSub }, { valor: 'unico', titulo: T3.unico, sub: T3.unicoSub }],
        aoMudar: (v) => { r.endereco.uso = v; if (v === 'unico') r.endereco.apelido = ''; salvar(); desenharApelido(); },
      });
      ctx.grupoUso = g;
      desenharApelido();
      uso = [g.raiz, apelido];
    } else {
      const a = campo({ id: 'apelido', rotulo: T3.apelido, ajuda: `${T3.apelidoAjuda} ${T3.apelidoEx}`, valor: r.endereco.apelido, attrs: { maxlength: 40 } });
      a.input.addEventListener('input', () => { r.endereco.apelido = a.input.value; salvar(); });
      uso = [a.raiz, el('button', { type: 'button', class: 'btn-terciario', text: 'Cancelar a substituição', on: { click: () => { r.endereco.substituindo = ''; salvar(); redesenhar(); } } })];
    }
    trocar(detalhes, el('h3', { class: 'subtitulo-passo', text: T3.tituloEndereco }),
      el('div', { class: 'grade-endereco' }, [c.logradouro.raiz, c.numero.raiz, c.complemento.raiz, c.bairro.raiz, c.cidade.raiz, c.uf.raiz, c.pontoReferencia.raiz, c.tipoImovel.raiz, outro]),
      ...uso);
  };
  const tituloCep = logada() || r.endereco.substituindo ? [el('h3', { class: 'subtitulo-passo', text: T3.tituloCep }), el('p', { class: 'sub-passo', text: T3.subCep })] : [];
  trocar(caixa, ...tituloCep, cep.raiz, status, detalhes);
  mostrar();
  return caixa;
}

