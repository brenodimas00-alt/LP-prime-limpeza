// Proposta do painel da Prime. Comportamentos do protótipo: painel lateral, abas, filtros,
// folha "Mais" do celular, busca única e tour de primeiro acesso. Sem dependências.
(function () {
  'use strict';
  const doc = document;
  const $ = (sel, raiz) => (raiz || doc).querySelector(sel);
  const $$ = (sel, raiz) => Array.from((raiz || doc).querySelectorAll(sel));
  doc.documentElement.classList.add('js');

  /* ---------- Guarda no aparelho (localStorage pode falhar) ---------- */
  const guarda = {
    ler(chave) { try { return localStorage.getItem(chave); } catch (e) { return null; } },
    gravar(chave, valor) { try { localStorage.setItem(chave, valor); } catch (e) { /* modo privado etc. */ } },
  };

  /* ---------- Painel lateral de detalhe (drawer) ---------- */
  const app = $('.app');
  const drawer = $('.drawer');
  let drawerAbertoPorHistorico = false;

  function mostrarPainel(id) {
    if (!drawer) return false;
    const paineis = $$('.drawer-painel', drawer);
    let alvo = null;
    paineis.forEach((p) => { const bate = !id || p.id === id; p.hidden = !bate && paineis.length > 1; if (bate && !alvo) alvo = p; });
    if (id && !alvo) return false;
    if (!id && paineis.length > 1) paineis.forEach((p, i) => { p.hidden = i !== 0; });
    return true;
  }
  function abrirDrawer(id, origem, semHistorico) {
    if (!drawer || !mostrarPainel(id)) return;
    drawer.classList.add('aberta');
    drawer.hidden = false;
    if (app) app.classList.add('com-drawer');
    $$('.item.aberto').forEach((i) => i.classList.remove('aberto'));
    if (origem) { const item = origem.closest('.item'); if (item) item.classList.add('aberto'); }
    if (!semHistorico) { history.pushState({ drawer: id || true }, '', id ? '#' + id : location.pathname); drawerAbertoPorHistorico = true; }
    const foco = $('.drawer-cabeca h2', drawer) || drawer;
    foco.setAttribute('tabindex', '-1');
    foco.focus({ preventScroll: window.innerWidth >= 760 });
    if (window.innerWidth < 760) drawer.scrollTop = 0;
  }
  function fecharDrawer(semHistorico) {
    if (!drawer || !drawer.classList.contains('aberta')) return;
    drawer.classList.remove('aberta');
    if (app) app.classList.remove('com-drawer');
    $$('.item.aberto').forEach((i) => i.classList.remove('aberto'));
    if (!semHistorico && drawerAbertoPorHistorico && history.state && history.state.drawer) { history.back(); return; }
    drawerAbertoPorHistorico = false;
  }
  doc.addEventListener('click', (ev) => {
    const abre = ev.target.closest('[data-drawer]');
    if (abre) {
      ev.preventDefault();
      const id = abre.getAttribute('data-drawer') || (abre.getAttribute('href') || '').replace(/^#/, '');
      abrirDrawer(id || null, abre);
      return;
    }
    if (ev.target.closest('[data-fecha-drawer]')) { ev.preventDefault(); fecharDrawer(); }
  });
  window.addEventListener('popstate', (ev) => {
    if (ev.state && ev.state.drawer) abrirDrawer(typeof ev.state.drawer === 'string' ? ev.state.drawer : null, null, true);
    else fecharDrawer(true);
  });
  doc.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { fecharDrawer(); fecharFolha(); fecharTour(); } });
  // Sem JS a tela de solicitações já abre com o painel; com JS, respeita o hash (#id) que veio pelo link do Início.
  if (drawer) {
    const hash = location.hash.replace(/^#/, '');
    if (hash && $('#' + CSS.escape(hash) + '.drawer-painel', drawer)) {
      abrirDrawer(hash, null, true);
      history.replaceState({ drawer: hash }, '', location.href);
      drawerAbertoPorHistorico = true;
    } else if (drawer.classList.contains('aberta')) {
      mostrarPainel(drawer.getAttribute('data-painel-inicial') || null);
      // No celular o painel cobre a tela inteira: começa fechado e abre no toque, pra lista aparecer primeiro.
      if (window.innerWidth < 760) fecharDrawer(true);
    } else {
      mostrarPainel(null);
    }
  }

  /* ---------- Abas internas ---------- */
  $$('.abas').forEach((abas) => {
    const botoes = $$('.aba[role="tab"]', abas);
    if (!botoes.length) return;
    function ativar(botao, focar) {
      botoes.forEach((b) => {
        const ativo = b === botao;
        b.setAttribute('aria-selected', ativo ? 'true' : 'false');
        b.tabIndex = ativo ? 0 : -1;
        const painel = doc.getElementById(b.getAttribute('aria-controls'));
        if (painel) painel.hidden = !ativo;
      });
      if (focar) botao.focus();
    }
    botoes.forEach((b) => {
      b.addEventListener('click', () => ativar(b));
      b.addEventListener('keydown', (ev) => {
        const i = botoes.indexOf(b);
        if (ev.key === 'ArrowRight') ativar(botoes[(i + 1) % botoes.length], true);
        if (ev.key === 'ArrowLeft') ativar(botoes[(i - 1 + botoes.length) % botoes.length], true);
      });
    });
    const inicial = botoes.find((b) => b.getAttribute('aria-selected') === 'true') || botoes[0];
    const pedida = location.hash && botoes.find((b) => '#' + b.getAttribute('aria-controls') === location.hash);
    ativar(pedida || inicial);
  });

  /* ---------- Filtros como etiquetas: só mostram e ocultam ---------- */
  $$('[data-filtros]').forEach((grupo) => {
    const alvoSel = grupo.getAttribute('data-filtros');
    const atributo = grupo.getAttribute('data-filtra-por') || 'data-tipo';
    const etiquetas = $$('.etiqueta', grupo);
    const vazio = grupo.getAttribute('data-vazio') ? doc.getElementById(grupo.getAttribute('data-vazio')) : null;
    function aplicar(valor) {
      etiquetas.forEach((e) => e.setAttribute('aria-pressed', e.getAttribute('data-valor') === valor ? 'true' : 'false'));
      let visiveis = 0;
      $$(alvoSel).forEach((item) => {
        const tipos = (item.getAttribute(atributo) || '').split(/\s+/);
        const mostra = valor === 'todos' || tipos.includes(valor);
        item.hidden = !mostra;
        if (mostra) visiveis++;
      });
      if (vazio) vazio.hidden = visiveis > 0;
    }
    etiquetas.forEach((e) => e.addEventListener('click', () => aplicar(e.getAttribute('data-valor'))));
  });
  // Filtro por <select> (agenda por profissional)
  $$('select[data-filtra]').forEach((sel) => {
    const alvoSel = sel.getAttribute('data-filtra');
    sel.addEventListener('change', () => {
      const v = sel.value;
      $$(alvoSel).forEach((el) => { el.hidden = v !== 'todas' && el.getAttribute('data-prof') !== v; });
      // Na lista por dia (celular), um dia sem diária da profissional escolhida mostra uma linha explicando.
      $$('[data-dia]').forEach((dia) => {
        const vazio = $('[data-vazio-prof]', dia);
        if (vazio) vazio.hidden = $$('[data-prof]', dia).some((x) => !x.hidden);
      });
    });
  });

  /* ---------- Aviso de conflito na remarcação (agenda) ---------- */
  $$('form[data-conflitos]').forEach((form) => {
    let conflitos = {};
    try { conflitos = JSON.parse(form.getAttribute('data-conflitos')); } catch (e) { conflitos = {}; }
    const aviso = $('[data-aviso-conflito]', form);
    function checar() {
      const prof = $('select[name="profissional"]', form); const data = $('input[name="data"]', form);
      if (!prof || !data || !aviso) return;
      const msg = conflitos[prof.value + '|' + data.value];
      aviso.hidden = !msg;
      if (msg) $('span', aviso).textContent = msg;
    }
    form.addEventListener('change', checar);
    checar();
  });

  /* ---------- Folha "Mais" do celular ---------- */
  const folha = $('.folha');
  const folhaFundo = $('.folha-fundo');
  const botaoMais = $('[data-abre-folha]');
  function abrirFolha() { if (!folha) return; folha.hidden = false; if (folhaFundo) folhaFundo.hidden = false; botaoMais && botaoMais.setAttribute('aria-expanded', 'true'); ($('a,button', folha) || folha).focus(); }
  function fecharFolha() { if (!folha || folha.hidden) return; folha.hidden = true; if (folhaFundo) folhaFundo.hidden = true; botaoMais && botaoMais.setAttribute('aria-expanded', 'false'); botaoMais && botaoMais.focus(); }
  if (botaoMais) botaoMais.addEventListener('click', () => (folha.hidden ? abrirFolha() : fecharFolha()));
  if (folhaFundo) folhaFundo.addEventListener('click', fecharFolha);
  $$('[data-fecha-folha]').forEach((b) => b.addEventListener('click', fecharFolha));

  /* ---------- Busca única: nome, telefone ou e-mail ---------- */
  const CLIENTES = [
    ['Beatriz Andrade', 'Buritis', '(31) 99111-0001', 'beatriz.andrade@exemplo.com'],
    ['Renata Carvalho', 'Lourdes', '(31) 99111-0002', 'renata.carvalho@exemplo.com'],
    ['Juliana Freitas', 'Castelo', '(31) 99111-0003', 'juliana.freitas@exemplo.com'],
    ['Marcos Oliveira', 'Savassi', '(31) 99111-0004', 'marcos.oliveira@exemplo.com'],
    ['Patrícia Gomes', 'Sion', '(31) 99111-0005', 'patricia.gomes@exemplo.com'],
    ['Luciana Martins', 'Santo Agostinho', '(31) 99111-0006', 'luciana.martins@exemplo.com'],
    ['Condomínio Vila das Flores', 'Belvedere', '(31) 99111-0007', 'sindico@viladasflores.exemplo.com'],
    ['Padaria Pão da Serra', 'Centro, Contagem', '(31) 99111-0008', 'contato@paodaserra.exemplo.com'],
    ['Escritório Lemos e Silva', 'Funcionários', '(31) 99111-0009', 'adm@lemosesilva.exemplo.com'],
  ];
  const semAcento = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  $$('.busca').forEach((form) => {
    const input = $('input', form);
    const lista = $('.busca-resultados', form);
    if (!input || !lista) return;
    function render() {
      const q = semAcento(input.value.trim());
      if (q.length < 2) { lista.hidden = true; lista.innerHTML = ''; return; }
      const digitos = q.replace(/\D/g, '');
      const achados = CLIENTES.filter((c) => semAcento(c[0]).includes(q) || semAcento(c[3]).includes(q) || (digitos.length >= 3 && c[2].replace(/\D/g, '').includes(digitos)));
      lista.innerHTML = '';
      if (!achados.length) { const p = doc.createElement('p'); p.className = 'vazio'; p.textContent = 'Nenhuma cliente com esse nome, telefone ou e-mail.'; lista.appendChild(p); }
      achados.slice(0, 5).forEach((c) => {
        const a = doc.createElement('a'); a.href = 'cliente.html';
        const n = doc.createElement('strong'); n.textContent = c[0];
        const s = doc.createElement('small'); s.textContent = c[1] + ' · ' + c[2];
        a.append(n, s); lista.appendChild(a);
      });
      lista.hidden = false;
    }
    input.addEventListener('input', render);
    input.addEventListener('focus', render);
    form.addEventListener('submit', (ev) => { ev.preventDefault(); const a = $('a', lista); if (a) location.href = a.href; });
    doc.addEventListener('click', (ev) => { if (!form.contains(ev.target)) lista.hidden = true; });
  });

  /* ---------- Tour de primeiro acesso ---------- */
  const PASSOS = [
    { titulo: 'Aqui está o que precisa de você hoje', texto: 'O Início mostra só o que espera uma decisão sua. Resolveu, some da lista.', alvo: '[data-tour="precisa"]', link: ['index.html', 'Ir pro Início'] },
    { titulo: 'Cada número leva direto pra lista', texto: 'Clique no card e você cai na lista já filtrada, com a ação pronta pra resolver.', alvo: '[data-tour="contagem"]', link: ['index.html', 'Ir pro Início'] },
    { titulo: 'O sistema já fez o repetitivo', texto: 'Lembretes, confirmações e pesquisas saem sozinhos. Aqui você vê o que foi enviado hoje.', alvo: '[data-tour="feito"]', link: ['index.html', 'Ir pro Início'] },
    { titulo: 'A agenda por profissional', texto: 'Uma linha por profissional, uma coluna por dia. Quem está sem profissional fica numa bandeja separada, em cima.', alvo: '[data-tour="agenda"]', link: ['agenda.html', 'Ver a agenda'] },
    { titulo: 'Busque qualquer cliente pelo nome ou telefone', texto: 'Uma busca só, no topo de todas as telas. Aceita nome, telefone ou e-mail.', alvo: '[data-tour="busca"]' },
  ];
  const CHAVE_TOUR = 'prime-proposta-tour-visto';
  let tour = null, tourFundo = null, passoAtual = 0, alvoAtual = null, focoAntes = null;
  function montarTour() {
    if (tour) return;
    tourFundo = doc.createElement('div'); tourFundo.className = 'tour-fundo';
    tour = doc.createElement('div'); tour.className = 'tour'; tour.setAttribute('role', 'dialog'); tour.setAttribute('aria-modal', 'true'); tour.setAttribute('aria-labelledby', 'tour-titulo'); tour.tabIndex = -1;
    tour.innerHTML = '<p class="passo"></p><h2 id="tour-titulo"></h2><p class="texto"></p><p class="ir" hidden><a href="#"></a></p>'
      + '<div class="acoes"><button type="button" class="botao discreto pular">Pular</button><button type="button" class="botao voltar">Voltar</button><button type="button" class="botao primario proximo">Próximo</button></div>';
    doc.body.append(tourFundo, tour);
    $('.pular', tour).addEventListener('click', fecharTour);
    $('.voltar', tour).addEventListener('click', () => irPasso(passoAtual - 1));
    $('.proximo', tour).addEventListener('click', () => (passoAtual >= PASSOS.length - 1 ? fecharTour() : irPasso(passoAtual + 1)));
    tourFundo.addEventListener('click', fecharTour);
  }
  function irPasso(n) {
    passoAtual = Math.max(0, Math.min(PASSOS.length - 1, n));
    const p = PASSOS[passoAtual];
    $('.passo', tour).textContent = (passoAtual + 1) + ' de ' + PASSOS.length;
    $('#tour-titulo', tour).textContent = p.titulo;
    $('.texto', tour).textContent = p.texto;
    $('.voltar', tour).hidden = passoAtual === 0;
    $('.proximo', tour).textContent = passoAtual === PASSOS.length - 1 ? 'Entendi' : 'Próximo';
    if (alvoAtual) alvoAtual.classList.remove('tour-alvo');
    alvoAtual = $$(p.alvo).find((el) => el.offsetParent !== null) || null;
    const ir = $('.ir', tour);
    if (alvoAtual) { alvoAtual.classList.add('tour-alvo'); alvoAtual.scrollIntoView({ block: 'center', behavior: 'smooth' }); ir.hidden = true; }
    else if (p.link) { ir.hidden = false; $('a', ir).href = p.link[0]; $('a', ir).textContent = p.link[1]; }
    else ir.hidden = true;
    tour.focus();
  }
  function abrirTour() { montarTour(); tour.hidden = false; tourFundo.hidden = false; focoAntes = doc.activeElement; fecharFolha(); irPasso(0); }
  function fecharTour() {
    if (!tour || tour.hidden) return;
    tour.hidden = true; tourFundo.hidden = true;
    if (alvoAtual) alvoAtual.classList.remove('tour-alvo');
    guarda.gravar(CHAVE_TOUR, '1');
    if (focoAntes && focoAntes.focus) focoAntes.focus();
  }
  $$('[data-abre-tour]').forEach((b) => b.addEventListener('click', (ev) => { ev.preventDefault(); abrirTour(); }));
  if (doc.body.classList.contains('pagina-inicio') && !guarda.ler(CHAVE_TOUR)) setTimeout(abrirTour, 600);

  /* ---------- Ações do protótipo: botões que "resolvem" um item ---------- */
  // No protótipo, uma ação primária some com o item e oferece "Desfazer" por alguns segundos.
  doc.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-resolve]');
    if (!b) return;
    ev.preventDefault();
    const item = b.closest('[data-item]');
    if (!item) return;
    const texto = b.getAttribute('data-resolve');
    const aviso = doc.createElement('div');
    aviso.className = 'aviso ok'; aviso.setAttribute('role', 'status');
    aviso.innerHTML = '<span></span> <button type="button" class="botao discreto">Desfazer</button>';
    $('span', aviso).textContent = texto + ' ';
    item.hidden = true; item.after(aviso);
    const t = setTimeout(() => aviso.remove(), 8000);
    $('button', aviso).addEventListener('click', () => { clearTimeout(t); aviso.remove(); item.hidden = false; });
  });
})();
