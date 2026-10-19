// Painel v2, B3, contra a HOMOLOGAÇÃO (só fictícios; mensagens pelo simulado): estados novos e leituras do Início.
// Escala (revisar, publicar idempotente, republicar só com mudança, reabrir com motivo, D09), stand-by (aparece, liberar,
// confirmar), adiantamento/reembolso (pendência, recusa com motivo, decisão única), motivos editáveis e meta (só
// administração), negociar data (C18), pagamento não identificado (C19), pendências e contadores coerentes, busca global
// e os números dos indicadores conferidos contra SQL independente.
// Uso: bash scripts/cli.sh node22 scripts/testa-painel2-homolog.mjs
import { randomUUID } from 'node:crypto';
import { criarSuite, assert } from './lib-teste.mjs';
import { sql, fecharSql, limparFicticios, entrar, criarUsuario, cpfFicticio } from './lib-supabase.mjs';
import { montarApiDeTeste } from './lib-api-teste.mjs';
import { agendar, chave, liberarCobranca } from './cenarios.mjs';
import { CLIENTE_RESIDENCIAL, proximaDataSemTaxa } from './fixtures/seed.js';
import { CONFIG_PRECOS } from '../src/config/precos.js';
import { dataNoFuso, somarDias } from '../src/domain/calendario.js';

const t = criarSuite('painel v2 B3 (homologação)');
await limparFicticios();
const PRIME = { sessao: { ator: 'prime' } };
const { api } = await montarApiDeTeste('pv2');
const ADM = await entrar(await criarUsuario('pv2-adm', 'prime_admin'));
const ATD = await entrar(await criarUsuario('pv2-atd', 'prime_atendimento'));
const rpc = async (c, nome, args) => { const { data, error } = await c.rpc(nome, args); if (error) throw Object.assign(new Error(`${nome}: ${error.message} ${error.details || ''}`), { codigo: error.message }); return data; };
const falha = async (p, codigo) => { try { await p; } catch (e) { assert.equal(e.codigo, codigo, e.message); return e; } assert.fail(`esperava ${codigo}`); };
const HOJE = dataNoFuso(new Date().toISOString());
const D = proximaDataSemTaxa(HOJE, 3, CONFIG_PRECOS);
const dow = (d) => new Date(`${d}T12:00:00Z`).getUTCDay();
async function diarista(nome, dias = [0, 1, 2, 3, 4, 5, 6]) {
  const u = await criarUsuario(`pv2-${nome.toLowerCase()}`, 'diarista');
  const [r] = await sql(`insert into public.diaristas (usuario_id, nome, cpf, telefone, email, data_nascimento, identidade, status, aceite_termos_em, disponibilidade, ficticio)
    values ($1, $2, $3, '31955554444', $4, '1985-04-12', 'cnh', 'aprovada', now(), $5::jsonb, true) returning id`, [u.id, `${nome} Teste PV2`, cpfFicticio(), u.email, JSON.stringify({ dias, turnos: ['integral'], regioes: ['BH - Centro-Sul'] })]);
  return r.id;
}
const pedido = (data = D) => agendar(api, { cliente: CLIENTE_RESIDENCIAL, pacote: { tipoServico: 'residencial', duracaoHoras: 4, metragem: 45, quantidadeDiarias: 1, frequencia: 'avulso' }, primeiraData: data, turno: 'manha' }, chave('pv2'));

t.teste('escala: revisar, publicar avisa a profissional (D09), republicar só com mudança, sem profissional não publica, reabrir pede motivo', async () => {
  const dia = await diarista('Escala');
  const r = await pedido();
  await liberarCobranca(api, r);
  const at = r.atendimentos[0].id;
  await falha(rpc(ATD, 'marcar_escala', { p_data: D, p_acao: 'publicar', p_motivo: null, p_chave: `e-${randomUUID()}` }), 'CONDICAO_NAO_ATENDIDA');
  await api.atribuirDiarista(at, { diaristaId: dia }, { ...PRIME, chave: chave('atr') });
  const rev = await rpc(ATD, 'marcar_escala', { p_data: D, p_acao: 'revisar', p_motivo: null, p_chave: `e-${randomUUID()}` });
  assert.equal(rev.escala.estado, 'revisada');
  const k = `e-${randomUUID()}`;
  const pub = await rpc(ATD, 'marcar_escala', { p_data: D, p_acao: 'publicar', p_motivo: null, p_chave: k });
  assert.equal(pub.escala.estado, 'publicada'); assert.ok(pub.avisadas >= 1);
  const pub2 = await rpc(ATD, 'marcar_escala', { p_data: D, p_acao: 'publicar', p_motivo: null, p_chave: k });
  assert.equal(pub2._repetido, true); delete pub2._repetido;
  assert.deepEqual(pub2, pub, `mesma chave, mesma resposta: ${JSON.stringify(pub2)} x ${JSON.stringify(pub)}`);
  const ev = await sql(`select count(*)::int n from public.eventos where tipo = 'escala_publicada' and refs ->> 'atendimentoId' = $1`, [at]);
  assert.equal(ev[0].n, 1, 'um evento por diária escalada');
  await falha(rpc(ATD, 'marcar_escala', { p_data: D, p_acao: 'publicar', p_motivo: null, p_chave: `e-${randomUUID()}` }), 'TRANSICAO_PROIBIDA');
  const dd = await rpc(ATD, 'painel_diarias', { p_data: D });
  const item = dd.itens.find((x) => x.id === at);
  assert.equal(item.profissional.id, dia); assert.equal(dd.escala.estado, 'publicada'); assert.equal(dd.escala.alteradaDepois, false);
  await falha(rpc(ATD, 'marcar_escala', { p_data: D, p_acao: 'reabrir', p_motivo: '', p_chave: `e-${randomUUID()}` }), 'DADOS_INVALIDOS');
  const re = await rpc(ATD, 'marcar_escala', { p_data: D, p_acao: 'reabrir', p_motivo: 'Troca de profissional (teste)', p_chave: `e-${randomUUID()}` });
  assert.equal(re.escala.estado, 'em_preparacao');
  const [h] = await sql('select historico from public.escalas where data = $1', [D]);
  assert.match(JSON.stringify(h.historico), /Troca de profissional \(teste\)/);
  await falha(rpc(ATD, 'marcar_escala', { p_data: somarDias(HOJE, -1), p_acao: 'revisar', p_motivo: null, p_chave: `e-${randomUUID()}` }), 'DATA_INVALIDA');
});

t.teste('stand-by: aparece quem trabalha no dia sem diária; liberar some; confirmar marca; diarista ou cliente não leem', async () => {
  const dia = await diarista('Standby', [dow(HOJE)]);
  let s = await rpc(ATD, 'painel_standby', { p_data: HOJE });
  assert.ok(s.itens.some((x) => x.diaristaId === dia && x.estado === 'standby'));
  await rpc(ATD, 'decidir_standby', { p_diarista: dia, p_data: HOJE, p_decisao: 'confirmada', p_motivo: null });
  s = await rpc(ATD, 'painel_standby', { p_data: HOJE });
  assert.equal(s.itens.find((x) => x.diaristaId === dia).estado, 'confirmada');
  await rpc(ATD, 'decidir_standby', { p_diarista: dia, p_data: HOJE, p_decisao: 'liberada', p_motivo: 'teste' });
  s = await rpc(ATD, 'painel_standby', { p_data: HOJE });
  assert.ok(!s.itens.some((x) => x.diaristaId === dia), 'liberada some do bloco');
  const outra = await diarista('Fora', [(dow(HOJE) + 1) % 7]);
  s = await rpc(ATD, 'painel_standby', { p_data: HOJE });
  assert.ok(!s.itens.some((x) => x.diaristaId === outra), 'quem não trabalha no dia não entra');
});

t.teste('adiantamento e Uber: viram pendência; recusar exige motivo; decisão única; valor fora do limite recusado', async () => {
  const dia = await diarista('Vale');
  await falha(rpc(ATD, 'registrar_solicitacao_profissional', { p_dados: { diaristaId: dia, tipo: 'adiantamento', valorCentavos: 0 }, p_chave: `s-${randomUUID()}` }), 'DADOS_INVALIDOS');
  const a = await rpc(ATD, 'registrar_solicitacao_profissional', { p_dados: { diaristaId: dia, tipo: 'adiantamento', valorCentavos: 8000, descricao: 'teste' }, p_chave: `s-${randomUUID()}` });
  const u = await rpc(ATD, 'registrar_solicitacao_profissional', { p_dados: { diaristaId: dia, tipo: 'reembolso_transporte', valorCentavos: 2340 }, p_chave: `s-${randomUUID()}` });
  const pend = await rpc(ATD, 'painel_pendencias', {});
  assert.ok(pend.itens.some((x) => x.id === `sol:${a.id}` && x.tipo === 'adiantamento' && x.categoria === 'financeiro'));
  assert.ok(pend.itens.some((x) => x.id === `sol:${u.id}` && x.titulo === 'Uber / transporte'));
  await falha(rpc(ATD, 'decidir_solicitacao_profissional', { p_id: u.id, p_decisao: 'recusada', p_motivo: '', p_chave: `d-${randomUUID()}` }), 'DADOS_INVALIDOS');
  await rpc(ATD, 'decidir_solicitacao_profissional', { p_id: u.id, p_decisao: 'recusada', p_motivo: 'Corrida fora do horário (teste)', p_chave: `d-${randomUUID()}` });
  await rpc(ATD, 'decidir_solicitacao_profissional', { p_id: a.id, p_decisao: 'aprovada', p_motivo: null, p_chave: `d-${randomUUID()}` });
  await falha(rpc(ATD, 'decidir_solicitacao_profissional', { p_id: a.id, p_decisao: 'recusada', p_motivo: 'de novo', p_chave: `d-${randomUUID()}` }), 'TRANSICAO_PROIBIDA');
  const [x] = await sql('select estado, motivo from public.solicitacoes_profissional where id = $1', [u.id]);
  assert.deepEqual([x.estado, x.motivo], ['recusada', 'Corrida fora do horário (teste)']);
  const aud = await sql(`select count(*)::int n from public.auditoria where tabela = 'solicitacoes_profissional' and registro_id = $1`, [u.id]);
  assert.equal(aud[0].n, 1, 'recusa registrada no histórico');
});

t.teste('motivos e meta: só a administração muda; motivo novo entra na lista; "Outro" não desliga; meta muda o indicador', async () => {
  await falha(rpc(ATD, 'salvar_motivo', { p_dados: { tipo: 'recusa', rotulo: 'Motivo de teste PV2' } }), 'ATOR_SEM_PERMISSAO');
  await falha(rpc(ADM, 'salvar_motivo', { p_dados: { tipo: 'recusa', codigo: 'outro', rotulo: 'Outro', ativo: false } }), 'DADOS_INVALIDOS');
  const m = await rpc(ADM, 'salvar_motivo', { p_dados: { tipo: 'cancelamento', rotulo: 'Motivo de teste PV2' } });
  try {
    assert.equal(m.codigo, 'motivo_de_teste_pv2');
    assert.ok((await rpc(ATD, 'motivos_padrao', {})).cancelamento.some((x) => x.codigo === m.codigo));
    await rpc(ADM, 'salvar_motivo', { p_dados: { tipo: 'cancelamento', codigo: m.codigo, rotulo: m.rotulo, ativo: false } });
    assert.ok(!(await rpc(ATD, 'motivos_padrao', {})).cancelamento.some((x) => x.codigo === m.codigo), 'desativado sai da lista');
    const lista = await rpc(ATD, 'motivos_padrao', {});
    assert.equal(lista.recusa.at(-1).codigo, 'outro', '"Outro" por último');
  } finally { await sql(`delete from public.motivos where codigo = 'motivo_de_teste_pv2'`); }
  await falha(rpc(ATD, 'salvar_meta', { p_percentual: 20 }), 'ATOR_SEM_PERMISSAO');
  try {
    await rpc(ADM, 'salvar_meta', { p_percentual: 20 });
    assert.equal((await rpc(ATD, 'painel_indicadores_home', { p_mes: null })).meta.percentual, 20);
  } finally { await rpc(ADM, 'salvar_meta', { p_percentual: 10 }); }
});

t.teste('negociar data: proposta registrada com validade e mensagem C18 planejada; domingo e solicitação já respondida recusados', async () => {
  const r = await pedido();
  let dom = somarDias(HOJE, 2); while (dow(dom) !== 0) dom = somarDias(dom, 1);
  await falha(rpc(ATD, 'propor_nova_data', { p_pedido: r.pedido.id, p_dados: { data: dom, horaInicio: '08:00' }, p_chave: `n-${randomUUID()}` }), 'DATA_INVALIDA');
  const nova = proximaDataSemTaxa(HOJE, 6, CONFIG_PRECOS);
  const p = await rpc(ATD, 'propor_nova_data', { p_pedido: r.pedido.id, p_dados: { data: nova, horaInicio: '09:00', mensagem: 'teste' }, p_chave: `n-${randomUUID()}` });
  assert.equal(p.proposta.data, nova); assert.ok(p.proposta.validaAte);
  const ev = await sql(`select dados from public.eventos where tipo = 'proposta_nova_data' and refs ->> 'pedidoId' = $1`, [r.pedido.id]);
  assert.equal(ev.length, 1); assert.equal(ev[0].dados.horaInicio, '09:00');
  const lista = await rpc(ATD, 'painel_solicitacoes_novas', { p_limite: 100 });
  assert.equal(lista.itens.find((x) => x.pedidoId === r.pedido.id)?.proposta?.data, nova);
  await liberarCobranca(api, r);
  await falha(rpc(ATD, 'propor_nova_data', { p_pedido: r.pedido.id, p_dados: { data: nova, horaInicio: '09:00' }, p_chave: `n-${randomUUID()}` }), 'TRANSICAO_PROIBIDA');
});

t.teste('pagamento não identificado: volta pra pendente, registra a conferência e avisa a cliente (C19); pendência some', async () => {
  const r = await pedido();
  const [g] = await liberarCobranca(api, r);
  await api.informarPagamento(g.id, { sessao: { ator: 'cliente', id: r.cliente.id }, chave: chave('inf') });
  let pend = await rpc(ATD, 'painel_pendencias', {});
  assert.ok(pend.itens.some((x) => x.id === `pag:${g.id}`));
  await falha(rpc(ATD, 'recusar_informe_pagamento', { p_pagamento: g.id, p_motivo: '', p_chave: `r-${randomUUID()}` }), 'DADOS_INVALIDOS');
  await rpc(ATD, 'recusar_informe_pagamento', { p_pagamento: g.id, p_motivo: 'Não encontrei no extrato de hoje (teste)', p_chave: `r-${randomUUID()}` });
  const [x] = await sql('select status, conferencia from public.pagamentos where id = $1', [g.id]);
  assert.equal(x.status, 'pendente'); assert.match(JSON.stringify(x.conferencia), /nao_identificado/);
  assert.equal((await sql(`select count(*)::int n from public.eventos where tipo = 'pagamento_nao_identificado' and refs ->> 'pagamentoId' = $1`, [g.id]))[0].n, 1);
  pend = await rpc(ATD, 'painel_pendencias', {});
  assert.ok(!pend.itens.some((x) => x.id === `pag:${g.id}`));
  const res = await rpc(ATD, 'painel_resumo', {});
  assert.equal(res.pendencias, pend.itens.length, 'contador do sino = lista'); assert.equal(res.urgentes, pend.urgentes);
});

t.teste('indicadores da Home conferidos contra SQL independente; busca global pelo número da solicitação', async () => {
  const ind = await rpc(ATD, 'painel_indicadores_home', { p_mes: null });
  const ini = `${HOJE.slice(0, 7)}-01`;
  const [s] = await sql(`select
      (select count(*)::int from public.atendimentos where status in ('finalizado', 'avaliado') and data >= ($1::date - interval '1 month')::date and data < $1::date) ant,
      (select count(*)::int from public.atendimentos where status in ('finalizado', 'avaliado') and data >= $1::date and data < ($1::date + interval '1 month')::date) real,
      (select count(*)::int from public.atendimentos a join public.pedidos p on p.id = a.pedido_id where a.status in ('agendado', 'confirmado', 'diarista_a_caminho', 'em_andamento')
         and a.data >= greatest($1::date, $2::date) and a.data < ($1::date + interval '1 month')::date and p.status in ('aguardando_pagamento', 'confirmado')) agend,
      (select count(*)::int from public.atendimentos where status = 'cancelado' and data >= $1::date and data < ($1::date + interval '1 month')::date) canc`, [ini, HOJE]);
  assert.deepEqual([ind.meta.mesAnterior, ind.meta.realizadas, ind.meta.agendadas], [s.ant, s.real, s.agend]);
  assert.equal(ind.meta.meta, Math.ceil(s.ant * (1 + ind.meta.percentual / 100)));
  assert.equal(ind.cancelamentos.reduce((t2, x) => t2 + x.total, 0), s.canc);
  const r = await pedido();
  const [{ numero_solicitacao: n }] = await sql('select numero_solicitacao from public.pedidos where id = $1', [r.pedido.id]);
  if (n) {
    const b = await rpc(ATD, 'buscar_global', { p_termo: String(n) });
    assert.ok(b.itens.some((x) => x.tipo === 'solicitacao' && x.id === r.pedido.id));
  }
  await falha(rpc(ATD, 'buscar_global', { p_termo: 'ab' }), 'DADOS_INVALIDOS');
});

t.teste('B4 telas: solicitações com filtro, ficha da cliente com linha do tempo única e lista de profissionais com habilidades', async () => {
  const r = await pedido();
  const novas = await rpc(ATD, 'painel_solicitacoes', { p_filtro: { estado: 'novas', limite: 200 } });
  assert.ok(novas.itens.some((x) => x.pedidoId === r.pedido.id && x.status === 'solicitado'));
  assert.ok(novas.itens.every((x) => x.status === 'solicitado'));
  const conf = await rpc(ATD, 'painel_solicitacoes', { p_filtro: { estado: 'confirmadas', limite: 5 } });
  assert.ok(conf.itens.every((x) => x.status === 'confirmado'));
  await falha(rpc(ATD, 'painel_solicitacoes', { p_filtro: { de: 'ontem' } }), 'DADOS_INVALIDOS');
  const f = await rpc(ATD, 'painel_ficha_cliente', { p_cliente: r.cliente.id });
  assert.equal(f.cliente.id, r.cliente.id); assert.ok(f.resumo.pedidos >= 1);
  assert.ok(f.linhaDoTempo.some((x) => x.tipo === 'pedido' && x.titulo === 'Solicitação enviada'));
  assert.ok(!JSON.stringify(f.linhaDoTempo).includes('conteudo'), 'mensagem sem conteúdo');
  const dia = await diarista('Lista');
  await rpc(ATD, 'salvar_habilidades', { p_diarista: dia, p_habilidades: ['passadoria', 'residencial'] });
  const l = await rpc(ATD, 'painel_profissionais', { p_filtro: { busca: 'Lista Teste PV2' } });
  assert.deepEqual(l.itens.map((x) => [x.id, x.habilidades]), [[dia, ['passadoria', 'residencial']]]);
  await falha(rpc(ATD, 'salvar_habilidades', { p_diarista: dia, p_habilidades: ['voar'] }), 'DADOS_INVALIDOS');
});

const falhas = await t.fim();
await sql('delete from public.escalas where data = $1', [D]); // a escala de teste (o homolog ainda não usa escala real)
await limparFicticios({ soEstaExecucao: true });
await fecharSql();
process.exit(falhas ? 1 : 0);
