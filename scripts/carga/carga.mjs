// Teste de VOLUME no projeto separado prime-carga (nunca na homologação: lib-carga recusa).
//   gerar   -> dados sintéticos de ~2 anos (gera-carga.sql) + uma conta prime_admin sintética pra medir pelo caminho real
//   medir   -> tempo das RPCs que as telas do painel chamam (via API, logada como admin), 5 vezes cada, mediana e pior
//   tela    -> tempo de abrir cada aba do painel no navegador (site local apontando pro prime-carga)
// Uso: bash scripts/cli.sh node22 scripts/carga/carga.mjs gerar|medir [--json arquivo]
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { sql, fechar, admin, publico, ENV } from './lib-carga.mjs';

const cmd = process.argv[2];
const EMAIL_ADMIN = 'admin@carga.example';

async function gerar() {
  const ini = Date.now();
  await sql(readFileSync(new URL('./gera-carga.sql', import.meta.url), 'utf8'));
  console.log(`dados gerados em ${((Date.now() - ini) / 1000).toFixed(0)} s`);
  const [c] = await sql(`select (select count(*) from public.clientes)::int clientes, (select count(*) from public.pedidos)::int pedidos,
    (select count(*) from public.atendimentos)::int diarias, (select count(*) from public.pagamentos)::int pagamentos, (select count(*) from public.diaristas)::int profissionais,
    (select count(*) from public.eventos)::int eventos, (select count(*) from public.automacao_execucoes)::int execucoes, (select count(*) from public.mensagens)::int mensagens,
    (select count(*) from public.notificacoes)::int notificacoes, (select count(*) from public.acessos)::int acessos, (select count(*) from public.auditoria)::int auditoria,
    pg_size_pretty(pg_database_size(current_database())) tamanho`);
  console.log(JSON.stringify(c));
}

/** Conta prime_admin sintética (senha aleatória só em memória; o carga não tem o hook de senha da homologação). */
async function sessaoAdmin() {
  const senha = randomBytes(18).toString('base64url');
  const a = admin();
  const { data: lista } = await a.auth.admin.listUsers({ perPage: 200 });
  let u = lista.users.find((x) => x.email === EMAIL_ADMIN);
  if (u) await a.auth.admin.updateUserById(u.id, { password: senha });
  else u = (await a.auth.admin.createUser({ email: EMAIL_ADMIN, password: senha, email_confirm: true })).data.user;
  await sql(`update public.perfis set papel = 'prime_admin' where user_id = $1`, [u.id]);
  const c = publico();
  const { data, error } = await c.auth.signInWithPassword({ email: EMAIL_ADMIN, password: senha });
  if (error) throw new Error(`login admin carga: ${error.message}`);
  return { c, token: data.session.access_token };
}

// O que cada tela do painel chama ao abrir (src/ui/paginas/painel*.js), com os filtros de abertura.
const hoje = new Date().toISOString().slice(0, 10);
const somar = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const CONSULTAS = [
  // abertura de QUALQUER aba (painel.js iniciar): semana, profissionais, avaliações e a operação (antes: todas as diárias + 1 obter_pedido por pedido)
  ['Abertura: diárias da semana', 'listar_atendimentos', { p_filtro: { de: hoje, ate: somar(hoje, 6) } }],
  ['Abertura: todas as diárias (antes)', 'listar_atendimentos', { p_filtro: {} }],
  ['Abertura: operação (depois)', 'painel_operacao', { p_dias: 7 }],
  ['Abertura: profissionais', 'listar_diaristas', { p_filtro: {} }],
  ['Pesquisa de satisfação (antes: tudo)', 'listar_avaliacoes', { p_filtro: {} }],
  ['Pesquisa de satisfação (depois: 200)', 'listar_avaliacoes', { p_filtro: { limite: 200 } }],
  ['Agenda (semana)', 'agenda_profissionais', { p_de: hoje, p_ate: somar(hoje, 6) }],
  ['Clientes (1ª página)', 'listar_clientes', { p_filtro: {} }],
  ['Clientes (busca por nome)', 'listar_clientes', { p_filtro: { busca: 'Mariana' } }],
  ['Clientes (pendência)', 'listar_clientes', { p_filtro: { pendencia: 'sem_email' } }],
  ['Ocorrências', 'listar_ocorrencias', { p_filtro: {} }],
  ['Automações (execuções)', 'listar_execucoes', { p_filtro: {} }],
  ['Automações (eventos com erro)', 'listar_eventos', { p_filtro: { status: 'erro' } }],
  ['Linha do tempo de uma cliente', 'listar_execucoes', { p_filtro: { clienteId: '$CLIENTE' } }],
  ['Linha do tempo de um pedido', 'listar_execucoes', { p_filtro: { pedidoId: '$PEDIDO' } }],
  ['Automações (saúde)', 'saude_automacoes', {}],
  ['Automações (métricas 30 dias)', 'metricas_automacoes', { p_de: somar(hoje, -30), p_ate: hoje }],
  ['Relacionamento', 'listas_relacionamento', {}],
  ['Visão geral (indicadores 30 dias)', 'indicadores', { p_de: somar(hoje, -30), p_ate: hoje }],
  ['Visão geral (indicadores 1 ano)', 'indicadores', { p_de: somar(hoje, -364), p_ate: hoje }],
  ['Visão geral (saúde do sistema)', 'saude_sistema', {}],
  ['Busca global (nome)', 'buscar', { p_termo: 'Fernanda Costa' }],
  ['Busca global (telefone)', 'buscar', { p_termo: '31910004321' }],
  ['Busca global (e-mail)', 'buscar', { p_termo: 'cliente4321@carga.example' }],
  ['Horas extras', 'listar_horas_extras', { p_filtro: {} }],
];

async function medir() {
  const { c } = await sessaoAdmin();
  const saida = [];
  // a busca tem limite por minuto (P1): zera antes de cada rodada, só no carga
  const zerar = () => sql(`delete from privado.limites_acao where chave like 'busca:%'`);
  // ids reais da carga no lugar dos marcadores (uma cliente recorrente e um pedido dela)
  const [alvo] = await sql(`select p.cliente_id::text c, p.id::text p from public.pedidos p order by p.criado_em desc limit 1 offset 500`);
  const trocar = (o) => JSON.parse(JSON.stringify(o).replace('$CLIENTE', alvo.c).replace('$PEDIDO', alvo.p));
  for (const [tela, rpc, args0] of CONSULTAS) {
    const args = trocar(args0);
    const tempos = []; let erro = null; let tamanho = 0;
    for (let i = 0; i < 5; i++) {
      await zerar();
      const ini = performance.now();
      const { data, error } = await c.rpc(rpc, args);
      tempos.push(performance.now() - ini);
      if (error) { erro = error.message; break; }
      tamanho = JSON.stringify(data).length;
    }
    tempos.sort((a, b) => a - b);
    const r = { tela, rpc, mediana: Math.round(tempos[Math.floor(tempos.length / 2)]), pior: Math.round(tempos.at(-1)), kb: Math.round(tamanho / 1024), erro };
    saida.push(r);
    console.log(`${tela.padEnd(36)} ${String(r.mediana).padStart(6)} ms (pior ${r.pior} ms, ${r.kb} KB)${erro ? ` ERRO ${erro}` : ''}`);
  }
  const i = process.argv.indexOf('--json');
  if (i > 0) writeFileSync(process.argv[i + 1], JSON.stringify(saida, null, 2));
}

/**
 * Tela: abre o painel de verdade (Chromium, site servido local com o ambiente apontando pro prime-carga), logada como a
 * admin sintética, e mede do goto até a aba pronta (sem "Carregando" e com o conteúdo da aba). 3 vezes por aba, mediana.
 */
async function tela() {
  const { chromium } = await import('playwright');
  const { criarServidor } = await import('../serve.mjs');
  const { conteudoAmbiente } = await import('../gera-ambiente.mjs');
  const srv = criarServidor(); await new Promise((r) => srv.listen(0, r));
  const base = `http://localhost:${srv.address().port}/LP-prime-limpeza/`;
  const ambiente = conteudoAmbiente({ SUPABASE_URL: ENV.CARGA_URL, SUPABASE_PUBLISHABLE_KEY: ENV.CARGA_PUBLISHABLE_KEY }, { auth: 'supabase', dados: 'supabase' });
  const { c } = await sessaoAdmin();
  const { data: { session } } = await c.auth.getSession();
  const b = await chromium.launch();
  const saida = [];
  const ABAS = (process.env.ABAS || 'solicitacoes,agenda,atribuir,pagamentos,clientes,cadastros,ocorrencias,notificacoes,avaliacoes,relacionamento,visao').split(',');
  for (const aba of ABAS) {
    const tempos = []; let erro = null;
    for (let i = 0; i < 3; i++) {
      const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
      await ctx.route('**/src/config/ambiente.js', (r) => r.fulfill({ body: ambiente, contentType: 'text/javascript' }));
      await ctx.addInitScript(({ ref, s }) => {
        localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(s));
        localStorage.setItem('prime.sessao', JSON.stringify({ ator: 'prime', id: s.user.id, nome: 'admin', usuarioId: s.user.id, papel: 'prime_admin' }));
      }, { ref: ENV.CARGA_PROJECT_REF, s: session });
      const p = await ctx.newPage();
      const ini = performance.now();
      await p.goto(`${base}painel/?aba=${aba}`);
      try {
        await p.waitForFunction(() => document.querySelector('.kpis') && !document.querySelector('.carregando') && !document.querySelector('[data-carregando]'), null, { timeout: 30000 });
        tempos.push(performance.now() - ini);
        const falha = await p.locator('.alerta-erro, [data-erro]').count();
        if (falha) erro = (await p.locator('.alerta-erro, [data-erro]').first().textContent()).slice(0, 80);
      } catch { erro = 'não abriu em 30 s'; tempos.push(30000); }
      await ctx.close();
    }
    tempos.sort((x, y) => x - y);
    const r = { aba, mediana: Math.round(tempos[1]), pior: Math.round(tempos[2]), erro };
    saida.push(r);
    console.log(`painel ${aba.padEnd(16)} ${String(r.mediana).padStart(6)} ms (pior ${r.pior} ms)${erro ? ` ${erro}` : ''}`);
  }
  await b.close(); srv.close();
  const i = process.argv.indexOf('--json');
  if (i > 0) writeFileSync(process.argv[i + 1], JSON.stringify(saida, null, 2));
}

/**
 * Worker: N eventos pedido_criado pendentes (solicitações abertas da carga) e chamadas à function notificacoes do
 * prime-carga (provedor sempre simulado fora de produção) até a fila esvaziar. Mede eventos, execuções criadas e envios
 * por chamada e por minuto. Uso: carga.mjs worker [N]
 */
async function worker() {
  const n = Number(process.argv[3] ?? 600);
  if (n > 0) await sql(`insert into public.eventos (tipo, refs, dados)
    select 'pedido_criado', jsonb_build_object('pedidoId', p.id, 'clienteId', p.cliente_id), '{}'::jsonb
      from generate_series(1, $1) g cross join lateral (select id, cliente_id from public.pedidos where status = 'solicitado' order by id offset (g % 40) limit 1) p`, [n]);
  const chamadas = [];
  const ini = Date.now();
  for (let i = 0; i < 20; i++) {
    const t0 = Date.now();
    const r = await fetch(`${ENV.CARGA_URL}/functions/v1/notificacoes`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-worker-segredo': ENV.CARGA_WORKER_SEGREDO }, body: JSON.stringify({ motivo: 'carga' }) });
    const texto = await r.text();
    let corpo = {}; try { corpo = JSON.parse(texto); } catch { corpo = { erro: { detalhe: texto.slice(0, 120) } }; }
    const seg = (Date.now() - t0) / 1000;
    chamadas.push({ status: r.status, seg, eventos: corpo.eventos, criadas: corpo.criadas, enviadas: corpo.enviadas, outras: corpo.outras, falhas: corpo.falhas, erro: corpo.erro?.detalhe });
    console.log(`chamada ${i + 1}: ${r.status} em ${seg.toFixed(1)} s, eventos ${corpo.eventos}, criadas ${corpo.criadas}, enviadas ${corpo.enviadas}, outras ${corpo.outras}, falhas ${corpo.falhas}${corpo.erro ? ` ERRO ${JSON.stringify(corpo.erro)}` : ''}`);
    const [{ pend, venc }] = await sql(`select (select count(*) from public.eventos where status = 'pendente')::int pend,
      (select count(*) from public.automacao_execucoes where estado = 'agendada' and agendada_para <= now())::int venc`);
    if (!pend && !venc) break;
  }
  const total = (Date.now() - ini) / 1000;
  const env = chamadas.reduce((s, c) => s + (c.enviadas || 0), 0); const evs = chamadas.reduce((s, c) => s + (c.eventos || 0), 0);
  const [{ reag }] = await sql(`select count(*)::int reag from public.automacao_execucoes where estado = 'agendada' and agendada_para > now() and criado_em > now() - interval '1 hour'`);
  console.log(`total: ${evs} eventos e ${env} envios em ${total.toFixed(0)} s de worker (${chamadas.length} chamadas); ${reag} reagendadas pro horário permitido`);
  console.log(`envios por chamada (o cron chama 1 vez por minuto): ${chamadas.filter((c) => c.enviadas).map((c) => c.enviadas).join(', ')}`);
}

try {
  if (cmd === 'gerar') await gerar();
  else if (cmd === 'worker') await worker();
  else if (cmd === 'medir') await medir();
  else if (cmd === 'tela') await tela();
  else { console.error('uso: carga.mjs gerar|medir'); process.exitCode = 2; }
} finally { await fechar(); }
void ENV;
