// Home nova (ajustes da cliente, 24/09/2026): ordem do item 23, textos literais, CTAs com destino real, menu, acordeões
// por teclado, "FALAR COM A PRIME" (WhatsApp oficial ou aviso claro), avaliações ocultas sem depoimento real, sem erro
// de console nem requisição quebrada. Roda com o base path do GitHub Pages (/LP-prime-limpeza/) e na raiz (Cloudflare).
// Uso: node scripts/testa-home-navegador.mjs [--url https://<preview>/]
import { readFileSync } from 'node:fs';
import { criarSuite, assert } from './lib-teste.mjs';
import { abrirNavegador } from './pw.mjs';

const t = criarSuite('home nova (navegador)');
const ORDEM = ['inicio', 'diferenciais', 'voce-ja-passou', 'sobre', 'servicos', 'como-funciona-diaria', 'nao-realizamos', 'como-funciona', 'calculadora', 'por-que', 'pacotes', 'avaliacoes', 'onde-atendemos', 'faq', 'agendar'];
const i = process.argv.indexOf('--url');
const externa = i > 0 ? process.argv[i + 1] : null;

async function subir(raiz) {
  const antes = process.env.RAIZ;
  process.env.RAIZ = raiz ? '1' : '';
  const { criarServidor } = await import(`./serve.mjs?raiz=${raiz ? 1 : 0}`);
  const srv = criarServidor();
  await new Promise((r) => srv.listen(0, r));
  process.env.RAIZ = antes;
  return { srv, base: `http://localhost:${srv.address().port}${raiz ? '/' : '/LP-prime-limpeza/'}` };
}
const servidores = externa ? [] : [await subir(false), await subir(true)];
const bases = externa ? [['preview', externa]] : [['github', servidores[0].base], ['raiz', servidores[1].base]];
const b = await abrirNavegador();

async function pagina(base, { largura = 1440, dev = false } = {}) {
  const ctx = await b.newContext({ viewport: { width: largura, height: 900 }, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  p.erros = []; p.quebradas = [];
  p.on('console', (m) => m.type() === 'error' && p.erros.push(m.text()));
  p.on('pageerror', (e) => p.erros.push(e.message));
  p.on('response', (r) => { if (r.status() >= 400) p.quebradas.push(`${r.status()} ${r.url()}`); });
  p.on('requestfailed', (r) => { if (!/ERR_ABORTED/.test(r.failure()?.errorText || '')) p.quebradas.push(`falhou ${r.url()}`); });
  await p.goto(base + (dev ? '?dev=1' : ''), { waitUntil: 'networkidle' });
  return p;
}

for (const [rotulo, base] of bases) {
  t.teste(`${rotulo}: ordem das seções (item 23) e textos-chave literais`, async () => {
    const p = await pagina(base);
    const ids = await p.evaluate((ordem) => ordem.map((id) => { const e = document.getElementById(id); return e ? e.getBoundingClientRect().top + scrollY : null; }), ORDEM);
    const presentes = ids.map((y, k) => [ORDEM[k], y]).filter(([id, y]) => y !== null && id !== 'avaliacoes');
    assert.equal(presentes.length, ORDEM.length - 1, 'todas as seções existem');
    for (let k = 1; k < presentes.length; k++) assert.ok(presentes[k][1] > presentes[k - 1][1], `ordem: ${presentes[k - 1][0]} antes de ${presentes[k][0]}`);
    const txt = await p.evaluate(() => document.querySelector('main').innerText.replace(/\s+/g, ' '));
    for (const frase of ['Limpeza profissional, do jeito que você precisa.', 'Profissionais selecionadas', 'O pagamento da diária é realizado antecipadamente e de forma integral.',
      'Suporte em caso de imprevistos', 'Você já passou por isso?', 'Uma forma mais simples de contratar limpeza.', 'Como funciona a diária?',
      'O que a Prime não realiza', 'Segurança em primeiro lugar', 'Seu atendimento com a Prime, passo a passo', 'Tem preferência por alguma profissional?',
      'Não sabe quantas horas contratar?', 'Por que contratar a Prime?', 'Precisa de limpeza com frequência?',
      'A partir de 3 diárias no mês R$ 20 de desconto no valor total do pacote.', 'A partir de 5 diárias no mês R$ 40 de desconto no valor total do pacote.',
      'Onde atendemos', 'Sem acréscimo de deslocamento.', 'Atendimento com adicional de deslocamento.', 'Pronto para facilitar sua rotina?',
      'Atendimento em Belo Horizonte e Região Metropolitana']) assert.ok(txt.includes(frase), `falta: ${frase}`);
    assert.ok(!/R\$ ?(138|175|203|220)|por hora|taxa de deslocamento de/i.test(txt), 'sem preço de diária, tabela de horas ou valor de deslocamento');
    assert.equal(await p.locator('.faq-item').count(), 9, '9 perguntas do item 19');
    assert.deepEqual(p.erros, []); assert.deepEqual(p.quebradas, []);
  });

  t.teste(`${rotulo}: botões levam aos destinos reais (sem href="#")`, async () => {
    const p = await pagina(base);
    assert.equal(await p.locator('a[href="#"]').count(), 0);
    const h = async (sel) => p.locator(sel).first().getAttribute('href');
    for (const s of ['[data-cta=agendar-hero]', '[data-cta=agendar-final]', '[data-cta=agendar-faixa]', 'header .btn-primary']) assert.equal(await h(s), 'autoagendamento/', s);
    assert.equal(await h('[data-cta=carga-horaria]'), 'autoagendamento/', 'CALCULAR MINHA CARGA HORÁRIA: Agendar Diária');
    assert.equal(await h('[data-cta=calcular-diaria]'), 'autoagendamento/?etapa=calculadora', 'CALCULAR MINHA DIÁRIA: calculadora do fluxo');
    assert.equal(await h('[data-cta=pacotes]'), 'autoagendamento/?frequencia=semanal', 'CONHECER PACOTES: agendamento com frequência');
    // clique de verdade: a calculadora abre (depois do tipo) e os pacotes chegam com frequência
    await p.locator('[data-cta=pacotes]').click();
    await p.waitForSelector('#titulo-passo');
    await p.locator('input[name=tipo][value=residencial]').check({ force: true });
    await p.getByRole('button', { name: 'Continuar' }).click();
    await p.waitForSelector('#calculadora');
    assert.ok(await p.locator('input[name=frequencia][value=semanal]').isChecked());
  });

  t.teste(`${rotulo}: FALAR COM A PRIME no header (desktop e celular), no hero e no CTA final; sem WhatsApp configurado, aviso claro`, async () => {
    for (const largura of [1440, 375]) {
      const p = await pagina(base, { largura });
      assert.ok(await p.locator('header [data-falar]').isVisible(), `${largura}px: header`);
      assert.equal(await p.locator('[data-falar]').count(), 3);
      if (!externa) {
        // prime.js real (PREENCHER): leva aos contatos do rodapé e mostra o aviso
        await p.locator('header [data-falar]').click();
        await p.waitForSelector('#aviso-falar:not([hidden])');
        assert.match(await p.locator('#aviso-falar').textContent(), /WhatsApp oficial da Prime ainda não foi configurado/);
        assert.ok(p.url().endsWith('#contato'));
      }
    }
    if (!externa) {
      const d = await pagina(base, { dev: true }); // ?dev=1: configuração de teste com WhatsApp
      await d.waitForFunction(() => document.querySelector('header [data-falar]').href.startsWith('https://wa.me/'));
      assert.match(await d.locator('[data-falar=final]').getAttribute('href'), /^https:\/\/wa\.me\/5531900000000\?text=/);
    }
  });

  t.teste(`${rotulo}: menu do celular e acordeões por teclado (título visível, lista recolhida, aria)`, async () => {
    const p = await pagina(base, { largura: 375 });
    const menu = p.locator('.menu-btn');
    await menu.focus(); await p.keyboard.press('Enter');
    assert.equal(await menu.getAttribute('aria-expanded'), 'true');
    assert.ok(await p.locator('#mobileNav').isVisible());
    await p.keyboard.press('Escape');
    assert.equal(await menu.getAttribute('aria-expanded'), 'false');
    // "O que a Prime não realiza": fechado no início; abre no teclado; lista completa com pós-obra
    const nr = p.locator('#lista-nao-realiza');
    assert.equal(await nr.evaluate((d) => d.open), false);
    assert.ok(await p.locator('#titulo-nao-realiza').isVisible());
    await nr.locator('summary').focus(); await p.keyboard.press('Enter');
    assert.equal(await nr.evaluate((d) => d.open), true);
    assert.equal(await p.locator('.lista-nao-realiza li').count(), 15);
    assert.match(await p.locator('.pos-obra').textContent(), /não realizamos remoção de respingos de tinta, rejunte, cimento, cola ou retirada de entulho/);
    const foco = await nr.locator('summary').evaluate((s) => getComputedStyle(s).outlineStyle !== 'none' || getComputedStyle(s).boxShadow !== 'none');
    assert.ok(foco, 'foco visível no acordeão');
    // FAQ: recolhido, abre pelo teclado
    const f = p.locator('.faq-item').nth(4);
    assert.equal(await f.evaluate((d) => d.open), false);
    await f.locator('summary').focus(); await p.keyboard.press('Space');
    assert.equal(await f.evaluate((d) => d.open), true);
    assert.match(await f.locator('.faq-answer').textContent(), /antecipadamente e de forma integral/);
    // segurança fica visível (não recolhida)
    assert.ok(await p.locator('#seguranca').isVisible());
  });

  t.teste(`${rotulo}: avaliações ocultas sem depoimento real; componente mostra quando houver`, async () => {
    const p = await pagina(base);
    assert.ok(await p.locator('#avaliacoes').isHidden());
    if (!externa) {
      await p.route('**/src/config/depoimentos.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "export const DEPOIMENTOS = [{ texto: 'Teste do componente.', nome: 'Teste', servico: 'Residencial' }];" }));
      await p.reload({ waitUntil: 'networkidle' });
      assert.ok(await p.locator('#avaliacoes').isVisible());
      assert.equal(await p.locator('.avaliacao-card').count(), 1);
    }
  });

  t.teste(`${rotulo}: sem rolagem horizontal em 320, 375, 768 e 1440; headings em ordem`, async () => {
    for (const w of [320, 375, 768, 1440]) {
      const p = await pagina(base, { largura: w });
      const ov = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(ov <= 0, `${w}px: overflow ${ov}`);
    }
    const p = await pagina(base);
    const pulos = await p.evaluate(() => { const hs = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter((h) => h.offsetParent); const r = []; let ant = 0; for (const h of hs) { const n = Number(h.tagName[1]); if (ant && n > ant + 1) r.push(`${h.tagName}:${h.textContent.trim().slice(0, 30)}`); ant = n; } return r; });
    assert.deepEqual(pulos, [], 'sem pular nível de título');
  });
}

const falhas = await t.fim();
await b.close(); for (const s of servidores) s.srv.close();
process.exit(falhas ? 1 : 0);
