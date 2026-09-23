// E6: screenshots de cada página em 375 e 1440 em docs/shots/e6/ (limite 24 imagens, 2 já são da referência).
import { abrirNavegador, subirServidor } from './pw.mjs';
import { CREDENCIAIS_MOCK } from './fixtures/seed.js';
import { readFileSync } from 'node:fs';

const { base, fechar } = await subirServidor();
const b = await abrirNavegador();
const png = readFileSync('scripts/fixtures/foto-ficticia.png');
const C = CREDENCIAIS_MOCK;
async function preparar(ctx) {
  const p = await ctx.newPage();
  await p.goto(`${base}_dev/servicos.html?dev=1`); await p.waitForSelector('[data-pedido]');
  const ids = await p.evaluate(async (raiz) => {
    const { api } = await import(`${raiz}src/services/api.js`);
    const PRIME = { sessao: { ator: 'prime' } };
    const { itens } = await api.listarPedidos({}, PRIME);
    const ped = await api.obterPedido(itens.find((x) => x.clienteId === '00000000-0000-4000-8000-00000000c001').id, PRIME);
    const at = ped.atendimentos[0]; const entrada = ped.pagamentos.find((g) => g.parcela === 'entrada');
    await api.atribuirDiarista(at.id, { diaristaId: '00000000-0000-4000-8000-00000000d001' }, { chave: crypto.randomUUID(), ...PRIME });
    await api.informarPagamento(entrada.id, { chave: crypto.randomUUID(), sessao: { ator: 'cliente', id: ped.cliente.id } });
    return { pedido: ped.pedido.id, at: at.id, entrada: entrada.id, cliente: ped.cliente.id };
  }, base);
  await p.close();
  return ids;
}
const PAGINAS = (ids) => [
  ['home', ''], ['autoagendamento', 'autoagendamento/'], ['pagamento', `pagamento/?pagamento=${ids.entrada}&dev=1`],
  ['acompanhamento', `acompanhamento/?atendimento=${ids.at}&dev=1`], ['avaliacao', `avaliacao/?atendimento=${ids.at}&dev=1`],
  ['cadastro-diarista', 'diarista/cadastro/'], ['entrar', 'entrar/'], ['minha-conta', 'minha-conta/'], ['agenda-diarista', 'diarista/agenda/'],
  ['painel', 'painel/?aba=agenda'], ['404', 'pagina-que-nao-existe/'],
];
for (const w of [375, 1440]) {
  const ctx = await b.newContext({ viewport: { width: w, height: 900 }, reducedMotion: 'reduce' });
  await ctx.route('**/src/config/prime.js', (route) => route.fulfill({ path: 'src/config/prime.teste.js', contentType: 'text/javascript' }));
  const ids = await preparar(ctx);
  for (const [nome, u] of PAGINAS(ids)) {
    const p = await ctx.newPage();
    const sessao = nome === 'minha-conta' ? { ator: 'cliente', id: ids.cliente, nome: 'Ana Teste Fictícia' } : nome === 'agenda-diarista' ? { ator: 'diarista', id: C.diaristas[0].id, nome: C.diaristas[0].nome } : nome === 'painel' ? { ator: 'prime', id: C.prime[0].id, nome: C.prime[0].nome } : null;
    await p.goto(base); // mesmo origin pra setar sessão
    await p.evaluate((s) => { if (s) localStorage.setItem('prime.sessao', JSON.stringify(s)); else localStorage.removeItem('prime.sessao'); }, sessao);
    if (nome === 'cadastro-diarista') await p.evaluate(() => { localStorage.removeItem('prime.rascunho.diarista'); });
    await p.goto(base + u, { waitUntil: 'networkidle' });
    await p.evaluate(() => { document.querySelectorAll('video').forEach((v) => { v.pause(); v.currentTime = 0; }); });
    await p.waitForTimeout(700);
    await p.screenshot({ path: `docs/shots/e6/${nome}-${w}.png`, fullPage: true });
    await p.close();
    process.stdout.write(`${nome}-${w} `);
  }
  await ctx.close();
}
console.log('\nfeito');
await b.close(); await fechar();
