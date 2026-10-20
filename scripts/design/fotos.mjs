// Design system (D1 e D8): screenshots de TODAS as telas em 390 e 1440, no mock local com dados fictícios (seed de
// teste + seed rico de demonstração do painel). Mesma lista no antes e no depois, pro PDF comparativo. Na passada de 390
// também mede a rolagem lateral em 320 (sem foto).
// Uso: node scripts/design/fotos.mjs <pasta-saida> [--so=nome1,nome2] [--larguras=390,1440]
// Grava <pasta>/<nome>-<largura>.png e <pasta>/fotos.json (overflow em 320/390/1440 e erros de console por tela).
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { abrirNavegador, subirServidor } from '../pw.mjs';
import { CREDENCIAIS_MOCK as C } from '../fixtures/seed.js';
import { diaUtil, continuar, marcar, escolherData, horario } from '../lib-v3-pw.mjs';

const [saida] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!saida) { console.error('uso: node scripts/design/fotos.mjs <pasta-saida> [--so=a,b] [--larguras=390,1440]'); process.exit(2); }
const so = process.argv.find((a) => a.startsWith('--so='))?.slice(5).split(',');
const LARGURAS = (process.argv.find((a) => a.startsWith('--larguras='))?.slice(11) || '390,1440').split(',').map(Number);
mkdirSync(saida, { recursive: true });

const CLIENTE = { ator: 'cliente', id: C.clientes[0].id, nome: C.clientes[0].nome };
const DIARISTA = { ator: 'diarista', id: C.diaristas[0].id, nome: C.diaristas[0].nome };
const PRIME = { ator: 'prime', id: C.prime[1]?.id || C.prime[0].id, nome: 'Equipe Prime', papel: 'prime_admin' };

// um pedido do mock com atendimento e cobrança (pra acompanhamento, avaliação e pagamento)
async function preparar(p, base) {
  await p.goto(`${base}_dev/servicos.html?dev=1`); await p.waitForSelector('[data-pedido]');
  return p.evaluate(async (raiz) => {
    const { api } = await import(`${raiz}src/services/api.js`);
    const S = { sessao: { ator: 'prime' } };
    const { itens } = await api.listarPedidos({}, S);
    for (const it of itens) {
      const ped = await api.obterPedido(it.id, S);
      const at = ped.atendimentos?.[0]; const pg = ped.pagamentos?.find((g) => g.parcela === 'entrada') || ped.pagamentos?.[0];
      if (at && pg) return { at: at.id, entrada: pg.id };
    }
    return { at: 'x', entrada: 'x' };
  }, base);
}

// agendamento v3: chega até o passo pedido (mock, cliente fictícia já cadastrada)
async function agendamento(p, base, ate) {
  await p.goto(`${base}autoagendamento/`); await p.waitForSelector('[data-passo=servico]');
  if (ate === 'servico') return;
  await marcar(p, 'segmento', 'residencial'); await marcar(p, 'servico', 'residencial'); await continuar(p);
  await p.waitForSelector('[data-passo=identificacao]');
  if (ate === 'identificacao') return;
  if (ate === 'cadastro') { await marcar(p, 'identificacao', 'novo'); await continuar(p); await p.waitForSelector('[data-passo=cadastro]'); return; }
  await marcar(p, 'identificacao', 'cliente'); await p.waitForSelector('#entrar-identificador');
  await p.fill('#entrar-identificador', C.clientes[0].email); await p.fill('#entrar-senha', C.clientes[0].senha);
  await p.getByRole('button', { name: 'Entrar', exact: true }).click();
  await p.waitForSelector('[data-passo=endereco]', { timeout: 30000 });
  await p.waitForFunction(() => !/Carregando seus endereços/.test(document.querySelector('[data-passo=endereco]')?.textContent || ''));
  if (ate === 'endereco') return;
  if (!(await p.locator('[data-passo=endereco] input[type=radio]:checked').count())) {
    await p.fill('#cep', '30130010'); await p.waitForSelector('[data-regiao=atendida]'); await p.fill('#numero', '100'); await p.selectOption('#tipoImovel', 'Apartamento'); await marcar(p, 'usoEndereco', 'salvar');
  }
  await continuar(p); await p.waitForSelector('[data-passo=local]');
  if (ate === 'local') return;
  await p.fill('#metragem', '45'); await p.getByRole('button', { name: 'Aumentar quartos' }).click();
  await marcar(p, 'animais', 'nao'); await marcar(p, 'localRefeicao', 'sim');
  await continuar(p); await p.waitForSelector('[data-passo=modalidade]');
  if (ate === 'modalidade') return;
  await marcar(p, 'modalidade', 'avulsa'); await continuar(p); await p.waitForSelector('[data-passo=datas]');
  await escolherData(p, diaUtil(3)); await horario(p, 'horario', '08', '30');
  if (ate === 'datas') return;
  await continuar(p); await p.waitForSelector('[data-valor=total]', { timeout: 30000 });
}

const painel = (tela, extra = '') => ({ sessao: PRIME, demo: true, url: `painel/?tela=${tela}${extra}`, espera: '.p-casca' });
export const PAGINAS = [
  // site público
  ['home', { url: '' }], ['condicoes', { url: 'condicoes/' }], ['privacidade', { url: 'privacidade/' }], ['termos', { url: 'termos/' }],
  ['404', { url: 'pagina-que-nao-existe/' }], ['cadastro-profissional', { url: 'diarista/cadastro/' }], ['antecedentes', { url: 'diarista/antecedentes/' }],
  // agendamento v3
  ...['servico', 'identificacao', 'cadastro', 'endereco', 'local', 'modalidade', 'datas', 'revisao'].map((ate) => [`agendamento-${ate}`, { agendamento: ate }]),
  // áreas logadas
  ['entrar', { url: 'entrar/' }], ['entrar-painel', { url: 'painel/entrar/' }], ['entrar-profissional', { url: 'diarista/entrar/' }],
  ['minha-conta', { url: 'minha-conta/', sessao: CLIENTE }],
  ['acompanhamento', { url: (ids) => `acompanhamento/?atendimento=${ids.at}&dev=1` }],
  ['avaliacao', { url: (ids) => `avaliacao/?atendimento=${ids.at}&dev=1` }],
  ['pagamento', { url: (ids) => `pagamento/?pagamento=${ids.entrada}&dev=1` }],
  // profissional
  ['agenda-profissional', { url: 'diarista/agenda/', sessao: DIARISTA }],
  // painel (demonstração com seed rico fictício)
  ['painel-inicio', painel('inicio')], ['painel-solicitacoes', painel('solicitacoes')], ['painel-agenda', painel('agenda')],
  ['painel-clientes', painel('clientes')], ['painel-ficha', { ...painel('clientes'), ficha: true }], ['painel-profissionais', painel('profissionais')],
  ['painel-financeiro', painel('financeiro')], ['painel-gestao', painel('gestao')], ['painel-ajuda', painel('gestao', '&sec=ajuda')],
].filter(([n]) => !so || so.includes(n));

const ARQ = `${saida}/fotos.json`;
const relatorio = existsSync(ARQ) ? JSON.parse(readFileSync(ARQ, 'utf8')) : {};
const { base, fechar } = await subirServidor();
const b = await abrirNavegador();
const largura = async (p) => p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
for (const w of LARGURAS) {
  const ctx = await b.newContext({ viewport: { width: w, height: 900 }, reducedMotion: 'reduce', locale: 'pt-BR' });
  await ctx.route('https://viacep.com.br/**', (r) => r.fulfill({ json: { cep: '30130-010', logradouro: 'Rua Fictícia', bairro: 'Centro', localidade: 'Belo Horizonte', uf: 'MG' } }));
  await ctx.route('**/src/config/prime.js', (r) => r.fulfill({ path: 'src/config/prime.teste.js', contentType: 'text/javascript' }));
  const prep = await ctx.newPage(); const ids = await preparar(prep, base); await prep.close();
  for (const [nome, cfg] of PAGINAS) {
    const p = await ctx.newPage(); const erros = [];
    p.on('console', (m) => m.type() === 'error' && !/status of 404/.test(m.text()) && erros.push(m.text())); p.on('pageerror', (e) => erros.push(e.message));
    try {
      await p.goto(base);
      await p.evaluate(([s, demo]) => {
        localStorage.clear(); sessionStorage.clear();
        if (s) localStorage.setItem('prime.sessao', JSON.stringify(s));
        if (demo) localStorage.setItem('prime.seedDemo', 'painel');
        localStorage.setItem('prime.painel.tour', '"visto"');
      }, [cfg.sessao || null, !!cfg.demo]);
      if (cfg.agendamento) await agendamento(p, base, cfg.agendamento);
      else await p.goto(base + (typeof cfg.url === 'function' ? cfg.url(ids) : cfg.url), { waitUntil: 'networkidle' });
      if (cfg.espera) await p.waitForSelector(cfg.espera, { timeout: 20000 });
      await p.locator('.esqueleto, .p-esqueleto').first().waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
      if (cfg.ficha) { await p.getByRole('combobox', { name: /Buscar cliente/ }).fill('Mariana'); await p.getByRole('option').first().waitFor(); await p.keyboard.press('Enter'); await p.getByRole('heading', { name: 'Linha do tempo' }).waitFor(); }
      await p.evaluate(() => document.querySelectorAll('video').forEach((v) => { v.pause(); v.currentTime = 0; }));
      await p.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 700) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 40)); } scrollTo(0, 0); });
      await p.waitForTimeout(600);
      const [sw, iw] = await largura(p);
      await p.screenshot({ path: `${saida}/${nome}-${w}.png`, fullPage: true });
      const r = { overflow: sw > iw ? `${sw}>${iw}` : null, erros };
      if (w === 390) { await p.setViewportSize({ width: 320, height: 900 }); await p.waitForTimeout(300); const [s3, i3] = await largura(p); r.overflow320 = s3 > i3 ? `${s3}>${i3}` : null; }
      relatorio[`${nome}-${w}`] = r;
      process.stdout.write(`${nome}-${w}${r.overflow || r.overflow320 ? ' (overflow)' : ''}${erros.length ? ` (${erros.length} erro)` : ''} · `);
    } catch (e) { relatorio[`${nome}-${w}`] = { falhou: e.message.split('\n')[0] }; process.stdout.write(`${nome}-${w} FALHOU · `); }
    await p.close();
  }
  await ctx.close();
}
writeFileSync(ARQ, JSON.stringify(relatorio, null, 1));
const ruins = Object.entries(relatorio).filter(([, r]) => r.falhou || r.overflow || r.overflow320 || r.erros?.length);
console.log(`\n${Object.keys(relatorio).length} telas em ${saida}; com problema: ${ruins.length ? ruins.map(([k]) => k).join(', ') : 'nenhuma'}`);
await b.close(); await fechar();
