// Página viva do design system (/_dev/design-system/): fundamentos e componentes renderizados em todos os estados.
// Os valores dos tokens são lidos do CSS na hora (getComputedStyle): a página nunca diverge de src/ui/tokens.css.
// Cada componente fica numa <section data-componente> (o teste roda o axe em cada uma). Só dados fictícios.
import { el } from '../dom.js';
import { icone, ICONES } from './icones.js';

const raiz = document.getElementById('ds');
const css = getComputedStyle(document.documentElement);
const v = (n) => css.getPropertyValue(n).trim();

const secao = (id, titulo, intro, filhos, componente = false) => el('section', { id, class: 'ds-secao', 'aria-labelledby': `t-${id}`, ...(componente ? { dataset: { componente: id } } : {}) }, [
  el('h2', { id: `t-${id}`, class: 'titulo-secao', text: titulo }), intro ? el('p', { class: 'texto-2 texto-corrido', text: intro }) : null, ...filhos]);
const regra = (uso, naoUso) => el('dl', { class: 'ds-regras' }, [el('dt', { text: 'Use' }), el('dd', { text: uso }), el('dt', { text: 'Não use' }), el('dd', { text: naoUso })]);
const exemplo = (rotulo, ...filhos) => el('div', { class: 'ds-exemplo' }, [el('p', { class: 'ds-rotulo', text: rotulo }), el('div', { class: 'ds-palco' }, filhos)]);
const B = (t, c, extra = {}) => el('button', { type: 'button', class: `btn ${c}`, ...extra }, [t]);

// ---------- fundamentos ----------
const ESCALAS = [['marinho', [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]], ['dourado', [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]], ['neutro', [0, 25, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900]], ['rosado', [25, 50, 100]]];
const amostra = (nome) => el('li', { class: 'ds-cor' }, [el('span', { class: 'ds-cor-amostra', style: `background:var(${nome})` }), el('code', { text: nome }), el('span', { class: 'texto-2 num', text: v(nome) })]);
const cores = secao('cores', 'Cor', 'Marinho do logo na ação e no título; dourado só como acento fino; neutros quentes no resto. Cor de estado só pra estado, sempre com texto junto.', [
  ...ESCALAS.map(([n, passos]) => el('div', {}, [el('h3', { text: n }), el('ul', { class: 'ds-cores' }, passos.map((p) => amostra(`--${n}-${p}`)))])),
  el('h3', { text: 'Estados' }),
  el('div', { class: 'ds-linha' }, [['sucesso', 'Sucesso'], ['atencao', 'Atenção'], ['erro', 'Erro'], ['info', 'Informação']].map(([s, t]) => el('span', { class: `selo selo-${s}`, text: `${t}: texto ${v(`--${s}-texto`)} sobre ${v(`--${s}-fundo`)}` }))),
  el('h3', { text: 'Dados (gráficos)' }),
  el('ul', { class: 'ds-cores' }, [1, 2, 3, 4, 5].map((i) => amostra(`--dado-${i}`))),
]);
const TIPOS = [[48, 'titulo', 'Limpeza com cuidado'], [36, 'titulo', 'Solicite seu atendimento'], [28, 'titulo', 'Diárias de amanhã'], [22, 'texto', 'Precisa de você'], [18, 'texto', 'Título de cartão'], [16, 'texto', 'Texto corrido e de interface, legível em tela pequena.'], [14, 'texto', 'Texto de apoio, rótulo de campo, célula de tabela.'], [12, 'texto', 'Legenda e cabeçalho de tabela.']];
const tipografia = secao('tipografia', 'Tipografia', 'Source Serif 4 (600) nos títulos de página e de seção; Source Sans 3 (400 e 600) no texto e na interface. Números tabulares em valores, horários e tabelas.', [
  el('ul', { class: 'ds-tipos' }, TIPOS.map(([t, f, txt]) => el('li', {}, [el('code', { text: `--fs-${t} · ${f === 'titulo' ? 'Source Serif 4' : 'Source Sans 3'}` }), el('span', { style: `font-family:var(--fonte-${f});font-size:var(--fs-${t});line-height:var(--lh-${t});font-weight:var(--peso-forte);color:var(--cor-titulo)`, text: txt })]))),
  el('p', { class: 'num', text: 'Números tabulares: R$ 1.111,11 · R$ 888,00 · 08:30 às 14:00' }),
]);
const espaco = secao('espaco', 'Espaço, forma, sombra e movimento', 'Espaço em base 4; raio 6 (campo e botão), 10 (cartão), 999 só em avatar e chip; borda de 1 px como separador; sombra só em 2 níveis, pra quem flutua.', [
  el('ul', { class: 'ds-espacos' }, [1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => el('li', {}, [el('code', { text: `--e-${i} · ${v(`--e-${i}`)}` }), el('span', { class: 'ds-barra-espaco', style: `width:var(--e-${i})` })]))),
  el('div', { class: 'ds-linha' }, [['--r-campo', 'campo e botão'], ['--r-cartao', 'cartão'], ['--r-pilula', 'avatar e chip']].map(([r, t]) => el('div', { class: 'ds-forma', style: `border-radius:var(${r})` }, [el('code', { text: r }), el('span', { class: 'texto-2', text: t })]))),
  el('div', { class: 'ds-linha' }, [['--sombra-1', 'menu suspenso, busca'], ['--sombra-2', 'modal, painel lateral, toast']].map(([s, t]) => el('div', { class: 'ds-forma', style: `box-shadow:var(${s});border-radius:var(--r-cartao)` }, [el('code', { text: s }), el('span', { class: 'texto-2', text: t })]))),
  el('p', { class: 'texto-2', text: `Movimento: ${v('--dur-1')} e ${v('--dur-2')}, uma curva só; zerado com "reduzir movimento". Sem animação de entrada e sem cartão que sobe no hover.` }),
]);
const icones = secao('icones', 'Ícones', 'Lucide (licença ISC), traço fino, 16, 20 ou 24 px. Sempre com texto ao lado ou com nome acessível. Nada de ícone decorativo.', [
  el('ul', { class: 'ds-icones' }, Object.keys(ICONES).map((n) => el('li', {}, [icone(n, { tamanho: 24 }), el('code', { text: n })]))),
]);

// ---------- componentes ----------
const comp = [
  secao('botao', 'Botão', 'Primário: a ação principal (uma por área). Secundário: apoio. Terciário: ação com cara de link. Perigo: recusar ou apagar. M (padrão) e P (tabela e lista densa).', [
    ...[['M', ''], ['P', ' btn-p']].map(([t, c]) => exemplo(`Tamanho ${t}: normal, desabilitado, carregando`,
      B('Confirmar pagamento', `btn-primario${c}`), B('Ver detalhes', `btn-secundario${c}`), B('Ajustar horário', `btn-terciario${c}`), B('Recusar', `btn-perigo${c}`),
      B('Enviar', `btn-primario${c}`, { disabled: true }), B('Enviando', `btn-primario${c}`, { 'aria-busy': 'true' }))),
    exemplo('Com ícone e só ícone', el('button', { type: 'button', class: 'btn btn-secundario' }, [icone('baixar'), 'Baixar recibo']), el('button', { type: 'button', class: 'btn btn-secundario btn-icone', 'aria-label': 'Fechar' }, [icone('fechar')])),
    el('div', { class: 'ds-escuro escuro ds-linha' }, [B('Agendar minha limpeza', 'btn-primario'), B('Falar com a Prime', 'btn-secundario')]),
    regra('Verbo no rótulo ("Enviar solicitação"). Um primário por área.', 'Dois primários lado a lado; degradê; sombra; botão que sobe no hover.'),
  ], true),
  secao('campo', 'Campo de texto e select', 'Rótulo sempre visível em cima; ajuda embaixo; erro escrito, não só em cor.', [
    el('div', { class: 'ds-grade' }, [
      el('div', { class: 'campo' }, [el('label', { for: 'ds-nome', text: 'Nome completo' }), el('input', { id: 'ds-nome', placeholder: 'Como está no documento', autocomplete: 'off' })]),
      el('div', { class: 'campo' }, [el('label', { for: 'ds-tel', text: 'Celular com DDD' }), el('input', { id: 'ds-tel', value: '(31) 90000-0000', inputmode: 'tel', 'aria-describedby': 'ds-tel-a' }), el('p', { class: 'ajuda', id: 'ds-tel-a', text: 'A Prime avisa por WhatsApp.' })]),
      el('div', { class: 'campo invalido' }, [el('label', { for: 'ds-cep', text: 'CEP' }), el('input', { id: 'ds-cep', value: '3013', 'aria-invalid': 'true', 'aria-describedby': 'ds-cep-e' }), el('p', { class: 'erro-campo', id: 'ds-cep-e', text: 'O CEP tem 8 números.' })]),
      el('div', { class: 'campo' }, [el('label', { for: 'ds-tipo', text: 'Tipo de imóvel' }), el('select', { id: 'ds-tipo' }, ['Apartamento', 'Casa', 'Escritório'].map((t) => el('option', { text: t })))]),
      el('div', { class: 'campo' }, [el('label', { for: 'ds-obs', text: 'Observações' }), el('textarea', { id: 'ds-obs', rows: 3 })]),
      el('div', { class: 'campo' }, [el('label', { for: 'ds-des', text: 'E-mail (desabilitado)' }), el('input', { id: 'ds-des', value: 'teste@example.com', disabled: true })]),
    ]),
    regra('Placeholder como exemplo, nunca como rótulo.', 'Rótulo dentro do campo; borda colorida sem mensagem.'),
  ], true),
  secao('contador', 'Contador', 'Quantidade pequena (quartos, peças). Botões de 44 px com nome acessível.', [
    exemplo('Normal e no mínimo', el('div', { class: 'u-col', style: 'width:min(360px,100%)' }, [
      ...[['Quartos', 2, false], ['Banheiros', 0, true]].map(([r, n, min]) => el('div', { class: 'contador' }, [el('span', { class: 'contador-rotulo', id: `ds-c-${r}`, text: r }),
        el('div', { class: 'contador-controles', role: 'group', 'aria-labelledby': `ds-c-${r}` }, [el('button', { type: 'button', class: 'contador-btn', 'aria-label': `Diminuir ${r.toLowerCase()}`, disabled: min }, [icone('menos')]),
          el('span', { class: 'contador-valor', 'aria-live': 'polite', text: String(n) }), el('button', { type: 'button', class: 'contador-btn', 'aria-label': `Aumentar ${r.toLowerCase()}` }, [icone('mais_sinal')])])]))])),
  ], true),
  secao('opcao', 'Checkbox e opção em cartão', 'Opção em cartão quando a escolha precisa de uma linha de explicação.', [
    el('label', { class: 'check' }, [el('input', { type: 'checkbox', checked: true }), el('span', { text: 'Li e aceito os Termos e Condições' })]),
    el('fieldset', { class: 'grupo' }, [el('legend', { text: 'Tipo de serviço' }), el('div', { class: 'opcoes cartoes' }, [['Residencial', 'Casa ou apartamento', true], ['Empresarial', 'Escritório ou loja', false], ['Condominial', 'Áreas comuns', false]].map(([t, s, c], i) =>
      el('label', { class: 'opcao' }, [el('input', { type: 'radio', name: 'ds-servico', value: String(i), checked: c }), el('span', {}, [el('strong', { text: t }), el('small', { text: s })])])))]),
  ], true),
  secao('data-hora', 'Data e hora', 'Hora e minutos em dois selects (funciona no teclado e no leitor de tela); calendário no fluxo de agendamento.', [
    el('div', { class: 'ds-linha' }, [el('div', { class: 'campo' }, [el('label', { for: 'ds-data', text: 'Data' }), el('input', { id: 'ds-data', type: 'date', value: '2026-11-03' })]),
      el('div', { class: 'campo' }, [el('label', { for: 'ds-hora', text: 'Hora' }), el('select', { id: 'ds-hora' }, ['08', '09', '10'].map((h) => el('option', { text: h })))]),
      el('div', { class: 'campo' }, [el('label', { for: 'ds-min', text: 'Minutos' }), el('select', { id: 'ds-min' }, ['00', '30'].map((h) => el('option', { text: h })))])]),
  ], true),
  secao('chip', 'Chip', 'Filtro ligado ou desligado. Não é selo nem botão de ação.', [
    el('div', { class: 'chips', role: 'group', 'aria-label': 'Filtrar por período' }, [['Hoje', true], ['Amanhã', false], ['Semana', false]].map(([t, on]) => el('button', { type: 'button', class: 'chip', 'aria-pressed': String(on), text: t }))),
  ], true),
  secao('selo', 'Selo de estado e contagem', 'Selo: estado de uma coisa (pago, pendente, urgente), com texto. Contagem: quantos itens esperam.', [
    el('div', { class: 'ds-linha' }, [['Pago', 'sucesso'], ['Aguardando pagamento', 'atencao'], ['Sem profissional', 'erro'], ['Em andamento', 'info'], ['Cancelada', '']].map(([t, s]) => el('span', { class: `selo${s ? ` selo-${s}` : ''}`, text: t }))),
    el('div', { class: 'ds-linha' }, [el('span', {}, ['Solicitações ', el('span', { class: 'contagem contagem-urgente', text: '8' })]), el('span', {}, ['Financeiro ', el('span', { class: 'contagem', text: '6' })])]),
    regra('Um selo por informação de estado.', 'Selo decorativo, selo em todo item, emoji.'),
  ], true),
  secao('alerta', 'Alerta inline', 'Mensagem ligada a uma parte da tela. Erro diz o que fazer.', [
    el('div', { class: 'alerta alerta-info', role: 'note' }, [icone('info'), el('p', {}, [el('strong', { text: 'Ambiente de demonstração. ' }), 'Os dados ficam só neste navegador.'])]),
    el('div', { class: 'alerta alerta-ok' }, [icone('ok'), el('p', { text: 'Pagamento confirmado. O recibo foi enviado por e-mail.' })]),
    el('div', { class: 'alerta alerta-aviso' }, [icone('aviso'), el('p', { text: 'A duração escolhida é menor que a sugerida para este imóvel.' })]),
    el('div', { class: 'alerta alerta-erro' }, [icone('erro'), el('p', { text: 'Não deu pra salvar. Confira a conexão e tente de novo.' })]),
  ], true),
  secao('toast', 'Toast', 'Retorno curto de uma ação que já aconteceu. Some sozinho; o de erro fica até fechar.', [
    el('div', { class: 'ds-linha' }, [el('div', { class: 'toast', text: 'Disponibilidade confirmada.' }), el('div', { class: 'toast toast-erro', text: 'Não deu pra enviar. Tente de novo.' })]),
  ], true),
  secao('modal', 'Modal e painel lateral', 'Modal: decisão curta (confirmar, motivo); no celular vira folha de baixo. Painel lateral: detalhe sem sair da lista. Foco preso, Esc fecha.', [
    el('div', { class: 'ds-linha' }, [
      el('div', { class: 'modal ds-estatico', role: 'group', 'aria-labelledby': 'ds-modal-t' }, [el('h2', { id: 'ds-modal-t', text: 'Recusar a solicitação' }), el('div', { class: 'campo' }, [el('label', { for: 'ds-motivo', text: 'Motivo' }), el('select', { id: 'ds-motivo' }, [el('option', { text: 'Sem disponibilidade na data' })])]),
        el('div', { class: 'rodape' }, [B('Voltar', 'btn-secundario'), B('Recusar e avisar a cliente', 'btn-perigo')])]),
      el('div', { class: 'lateral ds-estatico', role: 'group', 'aria-labelledby': 'ds-lat-t' }, [el('div', { class: 'lateral-cab' }, [el('h2', { id: 'ds-lat-t', text: 'Solicitação nº 000123' }), el('button', { type: 'button', class: 'btn btn-terciario btn-icone', 'aria-label': 'Fechar' }, [icone('fechar')])]),
        el('div', { class: 'lateral-corpo' }, [el('dl', { class: 'metrica' }, [el('dt', { text: 'Valor' }), el('dd', { text: 'R$ 203,00' })]), el('p', { class: 'texto-2', text: 'Rua Fictícia, 100 · Savassi' })])]),
    ]),
  ], true),
  secao('abas', 'Abas', 'Partes de uma mesma tela. Até 6; no celular rolam de lado.', [
    el('div', { class: 'abas', role: 'tablist', 'aria-label': 'Minha conta' }, [['Pedidos', true], ['Pagamentos', false], ['Recibos', false], ['Privacidade', false]].map(([t, s]) => el('button', { type: 'button', role: 'tab', 'aria-selected': String(s), text: t }))),
  ], true),
  secao('acordeao', 'Acordeão', 'Perguntas frequentes e detalhes opcionais.', [
    el('div', { class: 'acordeao' }, [['Quais serviços a Prime oferece?', 'Limpeza residencial, empresarial, condominial, passadoria, pré e pós mudança e evento.'], ['Como funciona o pagamento?', 'Por PIX, cartão ou transferência, antes do atendimento.']].map(([q, r], i) => el('details', { open: i === 0 }, [el('summary', { text: q }), el('p', { text: r })]))),
  ], true),
  secao('tabela', 'Tabela', 'Densa no painel; no celular vira cartão. Valores à direita, com números tabulares.', [
    el('div', { class: 'tabela-rolagem' }, [el('table', { class: 'tabela' }, [el('caption', { class: 'sr', text: 'Diárias de hoje (exemplo)' }), el('thead', {}, [el('tr', {}, ['Horário', 'Cliente', 'Serviço', 'Situação', 'Valor'].map((t, i) => el('th', { scope: 'col', class: i === 4 ? 'num' : null, text: t })))]),
      el('tbody', {}, [['08:00', 'Mariana Fictícia', 'Residencial', ['Pago', 'sucesso'], 'R$ 203,00'], ['10:00', 'Carlos Fictício', 'Empresarial', ['Aguardando pagamento', 'atencao'], 'R$ 230,00']].map(([h, c, s, [st, tom], val]) =>
        el('tr', {}, [el('td', { class: 'num', text: h }), el('td', { text: c }), el('td', { text: s }), el('td', {}, [el('span', { class: `selo selo-${tom}`, text: st })]), el('td', { class: 'num', text: val })])))])]),
  ], true),
  secao('cartao', 'Cartão de conteúdo e de métrica', 'Cartão agrupa; não decora. Sem ícone em círculo colorido, sem sombra grande, sem grade de cartões iguais.', [
    el('div', { class: 'ds-grade' }, [
      el('article', { class: 'cartao' }, [el('h3', { text: 'Limpeza residencial' }), el('p', { class: 'texto-2', text: 'Casa ou apartamento, com a carga horária indicada pelo tamanho do imóvel.' })]),
      el('div', { class: 'cartao' }, [el('dl', { class: 'metrica' }, [el('dt', { text: 'Diárias no mês' }), el('dd', { text: '38' })])]),
      el('div', { class: 'cartao cartao-sutil' }, [el('dl', { class: 'metrica' }, [el('dt', { text: 'Recebido hoje' }), el('dd', { text: 'R$ 1.218,00' })])]),
    ]),
  ], true),
  secao('linha-tempo', 'Linha do tempo', 'Histórico de uma cliente ou de um pedido, o mais recente em cima.', [
    el('ol', { class: 'linha-tempo' }, [['19/10 14:02', 'Pagamento confirmado'], ['19/10 09:40', 'Solicitação aprovada'], ['18/10 21:15', 'Solicitação enviada']].map(([q, t]) => el('li', {}, [el('time', { text: q }), el('span', { text: t })]))),
  ], true),
  secao('avatar', 'Avatar', 'Iniciais quando não há foto. O nome vem sempre ao lado.', [
    el('div', { class: 'ds-linha' }, [el('span', { class: 'avatar', 'aria-hidden': 'true', text: 'AF' }), el('span', { text: 'Ana Fictícia' })]),
  ], true),
  secao('estados', 'Vazio, carregando e esqueleto', 'Vazio diz o que acontece e o próximo passo. Esqueleto estático com pulso sutil.', [
    el('div', { class: 'ds-grade' }, [
      el('div', { class: 'cartao' }, [el('div', { class: 'vazio' }, [el('strong', { text: 'Nenhuma solicitação nova' }), 'Quando chegar, ela aparece aqui.'])]),
      el('div', { class: 'cartao' }, [el('div', { class: 'carregando', role: 'status', text: 'Carregando' })]),
      el('div', { class: 'cartao' }, [el('div', { class: 'esqueleto', 'aria-hidden': 'true' }, [el('span'), el('span'), el('span')])]),
    ]),
  ], true),
  secao('paginacao', 'Paginação', 'Listas longas do painel.', [
    el('nav', { class: 'paginacao', 'aria-label': 'Páginas' }, [el('span', { text: '1 a 20 de 86' }), el('span', { class: 'ds-linha' }, [B('Anterior', 'btn-secundario btn-p', { disabled: true }), B('Próxima', 'btn-secundario btn-p')])]),
  ], true),
  secao('etapas', 'Progresso do agendamento', 'Onde a pessoa está e quanto falta: texto e barra fina.', [
    el('div', { class: 'progresso-fluxo' }, [el('p', { class: 'progresso-rotulo', text: 'Etapa 3 de 6 · Endereço' }), el('div', { class: 'progresso-linha', role: 'progressbar', 'aria-label': 'Progresso do agendamento', 'aria-valuemin': '1', 'aria-valuemax': '6', 'aria-valuenow': '3' }, [el('span', { style: 'width:calc(100% * 3 / 6)' })])]),
  ], true),
  secao('cabecalhos', 'Cabeçalho e rodapé', 'Site: logo, links, "Entrar" discreto e um único botão primário; no celular, ícone da conta e menu. Painel: menu lateral (inferior no celular), busca única, sino e conta. Veja nas páginas reais.', [
    el('ul', { class: 'ds-linha' }, [['Site', '../../'], ['Agendamento', '../../autoagendamento/'], ['Painel (entrar)', '../../painel/entrar/']].map(([t, h]) => el('li', {}, [el('a', { href: h, text: t })]))),
  ], true),
];

raiz.append(
  el('header', { class: 'ds-topo' }, [el('p', { class: 'sobretitulo', text: 'Prime Limpeza Especializada' }), el('h1', { text: 'Design system' }),
    el('p', { class: 'texto-2 texto-corrido', text: 'A referência visual do site, do agendamento, das áreas logadas e do painel. Tudo aqui usa os mesmos arquivos das páginas (src/ui/tokens.css e src/ui/ds/componentes.css). Dados fictícios.' }),
    el('nav', { 'aria-label': 'Nesta página' }, [el('ul', { class: 'ds-indice' }, [cores, tipografia, espaco, icones, ...comp].map((s) => el('li', {}, [el('a', { href: `#${s.id}`, text: s.querySelector('h2').textContent })])))])]),
  el('h2', { class: 'ds-parte', text: 'Fundamentos' }), cores, tipografia, espaco, icones,
  el('h2', { class: 'ds-parte', text: 'Componentes' }), ...comp,
);
