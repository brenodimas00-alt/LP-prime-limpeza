// Agenda e Escala: regras puras (src/domain/escala.js) e o mock (src/app/casos-escala.js) com o seed de demonstração
// num relógio fixo. O banco tem a bateria própria (testa-agenda-escala-banco). node scripts/testa-escala.mjs
import { criarSuite, assert, lancaCodigo } from './lib-teste.mjs';
import { montarAmbiente } from './ambiente.mjs';
import { montarSeedAgenda } from './fixtures/seed-agenda.js';
import { comGatilhoEscala } from '../src/app/casos-escala.js';
import { condicaoFalha } from '../src/automacoes/v2/motor.js';
import {
  transicionarEscala, avancaEscala, statusDaDiaria, acaoDaLinha, semRespostaNoPrazo, pontuarCandidata, escolherSugerida, agruparPorCidade, alteracaoRelevante,
} from '../src/domain/escala.js';

const t = criarSuite('Agenda e Escala (domínio e mock)');
const HOJE = '2026-10-21'; // quarta, como na imagem
const AGORA = '2026-10-21T10:30:00-03:00';
const ADMIN = { ator: 'prime', id: 'adm-1', papel: 'prime_admin', nome: 'Isa' };
const ATEND = { ator: 'prime', id: 'at-1', papel: 'prime_atendimento', nome: 'Bia' };
let k = 0; const ch = () => `chave-teste-${++k}`;

// ---------------------------------------------------------------- domínio
t.teste('máquina de estados: caminho feliz e transições proibidas', () => {
  let d = { escalaEstado: 'para_revisar', diaristaId: 'x' };
  for (const [ev, ator, para] of [['revisar', 'prime', 'revisada'], ['enviar', 'prime', 'aguardando_envio'], ['saiu', 'sistema', 'enviada'], ['entregue', 'sistema', 'aguardando_aceite'], ['aceitar', 'sistema', 'confirmada']]) {
    d = { ...d, escalaEstado: transicionarEscala(d, ev, { ator }) }; assert.equal(d.escalaEstado, para, ev);
  }
  assert.throws(() => transicionarEscala({ escalaEstado: 'para_revisar', diaristaId: 'x' }, 'enviar', { ator: 'prime' }), /TRANSICAO|Não é possível/);
  assert.throws(() => transicionarEscala({ escalaEstado: 'para_revisar' }, 'revisar', { ator: 'prime' }), /Selecione/);
  assert.throws(() => transicionarEscala({ escalaEstado: 'revisada', diaristaId: 'x' }, 'saiu', { ator: 'prime' }), /não pode/);
  assert.throws(() => transicionarEscala({ escalaEstado: 'aguardando_envio', diaristaId: 'x' }, 'enviar', { ator: 'prime' }), /já foi enviada/);
  assert.equal(transicionarEscala({ escalaEstado: 'aguardando_envio', diaristaId: 'x' }, 'enviar', { ator: 'prime', envioFalhou: true }), 'aguardando_envio');
  assert.equal(transicionarEscala({ escalaEstado: 'confirmada', diaristaId: 'x' }, 'recusar', { ator: 'sistema' }), 'para_revisar');
});
t.teste('retorno do provedor nunca regride (entregue antes de enviada, enviada depois do aceite)', () => {
  assert.equal(avancaEscala('aguardando_aceite', 'enviada'), false);
  assert.equal(avancaEscala('confirmada', 'aguardando_aceite'), false);
  assert.equal(transicionarEscala({ escalaEstado: 'aguardando_aceite', diaristaId: 'x' }, 'entregue', { ator: 'sistema' }), 'aguardando_aceite');
});
t.teste('status único: cancelada > ocorrência > finalizada > em andamento (real ou pelo horário) > escala', () => {
  const base = { data: HOJE, horaInicio: '08:00', duracaoMinutos: 240, status: 'confirmado', escalaEstado: 'confirmada' };
  const ms = (h) => Date.parse(`${HOJE}T${h}:00-03:00`);
  assert.equal(statusDaDiaria({ ...base, status: 'cancelado' }, { agoraMs: ms('09:00') }).codigo, 'cancelada');
  assert.equal(statusDaDiaria(base, { agoraMs: ms('09:00'), ocorrenciaAberta: true }).codigo, 'com_ocorrencia');
  assert.deepEqual(statusDaDiaria(base, { agoraMs: ms('09:00') }), { codigo: 'em_andamento', rotulo: 'Em andamento', porHorario: true });
  assert.deepEqual(statusDaDiaria(base, { agoraMs: ms('12:01') }), { codigo: 'finalizada', rotulo: 'Finalizada', porHorario: true });
  assert.equal(statusDaDiaria({ ...base, status: 'finalizado' }, { agoraMs: ms('12:01') }).porHorario, false);
  assert.equal(statusDaDiaria({ ...base, escalaEstado: 'aguardando_aceite' }, { agoraMs: ms('09:00') }).codigo, 'aguardando_aceite', 'sem aceite não vira em andamento');
  assert.equal(statusDaDiaria({ ...base, status: 'agendado', escalaEstado: 'revisada' }, { agoraMs: ms('07:00') }).rotulo, 'Revisada');
});
t.teste('ação da linha depende do estado, não da tela; sem profissional não tem Revisar', () => {
  assert.equal(acaoDaLinha({ status: 'agendado', diaristaId: 'x', escalaEstado: 'para_revisar' }), 'revisar');
  assert.equal(acaoDaLinha({ status: 'agendado', diaristaId: 'x', escalaEstado: 'revisada' }), 'enviar');
  assert.equal(acaoDaLinha({ status: 'confirmado', diaristaId: 'x', escalaEstado: 'aguardando_aceite' }), null);
  assert.equal(acaoDaLinha({ status: 'agendado', diaristaId: null, escalaEstado: 'para_revisar' }), null);
  assert.equal(acaoDaLinha({ status: 'finalizado', diaristaId: 'x', escalaEstado: 'confirmada' }), null);
});
t.teste('sem resposta: só sinaliza depois do prazo configurado; sem prazo, nunca', () => {
  const d = { escalaEstado: 'aguardando_aceite', escalaEnvio: { enviadaEm: '2026-10-21T08:00:00-03:00' } };
  const agora = Date.parse('2026-10-21T10:30:00-03:00');
  assert.equal(semRespostaNoPrazo(d, null, agora), false);
  assert.equal(semRespostaNoPrazo(d, 120, agora), true);
  assert.equal(semRespostaNoPrazo(d, 180, agora), false);
  assert.equal(semRespostaNoPrazo({ ...d, escalaEstado: 'confirmada' }, 60, agora), false);
});
t.teste('pontuação: impedimentos tiram da lista; região e habilidade pesam; empate pelo nome', () => {
  const diaria = { data: HOJE, horaInicio: '08:00', duracaoMinutos: 240, servico: 'residencial', cidade: 'Contagem' };
  const p = (nome, extra = {}) => ({ id: nome, nome, status: 'aprovada', habilidades: ['residencial'], disponibilidade: { dias: [3], turnos: ['integral'], regioes: ['Contagem'] }, ...extra });
  assert.equal(pontuarCandidata(diaria, p('A', { disponibilidade: { dias: [1], turnos: ['integral'], regioes: [] } })).impedida, true);
  assert.equal(pontuarCandidata(diaria, p('B'), { outras: [{ horaInicio: '10:00', duracaoMinutos: 240 }] }).impedida, true);
  assert.equal(pontuarCandidata(diaria, p('C'), { bloqueada: true }).impedida, true);
  const a = { nome: 'Ana', id: 'a', ...pontuarCandidata(diaria, p('Ana'), { mediaNota: 4.8 }) };
  const b = { nome: 'Bia', id: 'b', ...pontuarCandidata(diaria, p('Bia', { habilidades: [] }), { mediaNota: 4.8 }) };
  assert.ok(a.pontos > b.pontos);
  assert.equal(escolherSugerida([b, a]).nome, 'Ana');
  assert.equal(escolherSugerida([{ ...a, impedida: true }]), null);
});
t.teste('agrupamento: Contagem, Betim, outras da RMBH, BH por último; ordem por horário dentro', () => {
  const g = agruparPorCidade([{ local: { cidade: 'Belo Horizonte' }, horaInicio: '08:00' }, { local: { cidade: 'Betim' }, horaInicio: '14:00' }, { local: { cidade: 'Nova Lima' }, horaInicio: '07:00' },
    { local: { cidade: 'Contagem' }, horaInicio: '16:00' }, { local: { cidade: 'Contagem' }, horaInicio: '08:00' }]);
  assert.deepEqual(g.map((x) => x.cidade), ['Contagem', 'Betim', 'Nova Lima', 'Belo Horizonte']);
  assert.deepEqual(g[0].itens.map((x) => x.horaInicio), ['08:00', '16:00']);
});
t.teste('alteração relevante: profissional, data, hora, duração, endereço e serviço; status não', () => {
  assert.equal(alteracaoRelevante({ diaristaId: 'a' }, { diaristaId: 'b' }), true);
  assert.equal(alteracaoRelevante({ horaInicio: '08:00' }, { horaInicio: '09:00' }), true);
  assert.equal(alteracaoRelevante({ status: 'agendado' }, { status: 'confirmado' }), false);
});

// ---------------------------------------------------------------- mock com o seed
const amb = montarAmbiente(new Date(AGORA).toISOString());
const seed = montarSeedAgenda(HOJE, { agoraISO: (m = 0) => new Date(Date.parse(new Date(AGORA).toISOString()) + m * 60000).toISOString() });
await amb.casosBase.semearDemoAgenda(seed.registros);
const api = amb.casos;
const dia = async () => (await api.agendaEscala({ de: HOJE, ate: HOJE }, { sessao: ADMIN })).itens;
const porCliente = async (nome) => (await dia()).find((x) => x.cliente.nome === nome);
const execucoes = async (regra) => (await amb.repo.leitura(null, (tx) => tx.todos('execucoes'))).filter((e) => e.regra === regra);
const eventos = async (tipo) => (await amb.repo.leitura(null, (tx) => tx.todos('eventos'))).filter((e) => e.tipo === tipo);

t.teste('seed: o dia da imagem tem 11 diárias, stand-by e as marcas (coroa, pacote, fixa, sugerida, sem profissional)', async () => {
  const l = await dia();
  assert.equal(l.length, 11);
  const r = await api.agendaEscala({ de: HOJE, ate: HOJE }, { sessao: ADMIN });
  assert.equal(r.standby.length, 1); assert.equal(r.standby[0].nome, 'Roberta Almeida');
  const pat = l.find((x) => x.cliente.nome === 'Patrícia Souza');
  assert.equal(pat.cliente.parceria, true); assert.equal(pat.pacote, true); assert.equal(pat.designacaoOrigem, 'fixa'); assert.equal(pat.imovel.gatos, true); assert.equal(pat.profissional.nota, 4.8);
  assert.equal(l.find((x) => x.cliente.nome === 'Empresa ABC Ltda').designacaoOrigem, 'sugerida');
  assert.equal(l.find((x) => x.cliente.nome === 'Empresa XYZ').profissional, null);
  const c = await api.agendaContagens({ de: '2026-10-19', ate: '2026-10-25' }, { sessao: ADMIN });
  assert.deepEqual(c.dias.map((x) => x.total), [8, 10, 11, 9, 7, 5, 0]);
});
t.teste('pagamento pendente não bloqueia revisar nem enviar', async () => {
  const d = await porCliente('Empresa ABC Ltda');
  assert.equal(d.pagamento.estado, 'pendente');
  const r = await api.escalaRevisar(d.id, d.escalaVersao, { sessao: ATEND, chave: ch() });
  assert.equal(r.escalaEstado, 'revisada');
  const e = await api.escalaEnviar([d.id], { sessao: ATEND, chave: ch() });
  assert.deepEqual(e.enviadas, [d.id]);
});
t.teste('envio idempotente: D10 sai uma vez; enviar de novo (outra chave) e "todas as revisadas" ignoram a já enviada', async () => {
  const d = await porCliente('Empresa ABC Ltda');
  assert.equal(d.escalaEstado, 'enviada', 'o motor simulado já mandou');
  const e = await api.escalaEnviar([d.id], { sessao: ATEND, chave: ch() });
  assert.deepEqual(e.enviadas, []); assert.equal(e.ignoradas[0].motivo, 'já enviada');
  const revisadas = (await dia()).filter((x) => x.escalaEstado === 'revisada').map((x) => x.id);
  const todas = await api.escalaEnviar([...revisadas, d.id], { sessao: ATEND, chave: ch() });
  assert.equal(todas.enviadas.length, revisadas.length); assert.ok(!todas.enviadas.includes(d.id));
  assert.equal((await execucoes('D10')).filter((x) => x.contexto.atendimentoId === d.id).length, 1);
  assert.equal(await api.escalaEnviar([d.id], { sessao: ATEND, chave: 'chave-repetida' }).then(() => api.escalaEnviar([d.id], { sessao: ATEND, chave: 'chave-repetida' })).then((x) => x._repetido), true);
});
t.teste('preparar: sugerida e fixa sem avisar ninguém (nem D04, nem C07); diária removida não volta a ser preenchida', async () => {
  const xyz = await porCliente('Empresa XYZ');
  const antes = (await eventos('atendimento_atribuido')).length;
  const r = await api.escalaPreparar({ de: HOJE, ate: '2026-10-28' }, { sessao: ATEND });
  assert.equal((await eventos('atendimento_atribuido')).length, antes);
  assert.equal((await porCliente('Empresa XYZ')).profissional, null, 'sem profissional por decisão da equipe continua sem');
  assert.ok(r.fixas + r.sugeridas >= 0);
  assert.equal(xyz.escalaEstado, 'para_revisar');
});
t.teste('fixa nunca trocada sozinha: conflito vira alerta e pendência, preparar não mexe', async () => {
  const pat = await porCliente('Patrícia Souza');
  // outra diária da Ana Paula no mesmo horário, criada por designação manual
  const outra = await porCliente('Fernanda Lima'); // 13:00, cruza com as 08:00-14:00 da fixa
  await lancaCodigo(() => api.escalaAlterar(outra.id, { diaristaId: pat.profissional.id }, { sessao: ATEND, chave: ch() }), 'CONFLITO');
  await amb.repo.transacao(null, async (tx) => { const d = await tx.get('diaristas', pat.profissional.id); await tx.put('diaristas', { ...d, bloqueios: [{ de: HOJE, ate: HOJE }] }); });
  await api.escalaPreparar({ de: HOJE, ate: HOJE }, { sessao: ATEND });
  const depois = await porCliente('Patrícia Souza');
  assert.equal(depois.profissional.id, pat.profissional.id); assert.equal(depois.designacaoOrigem, 'fixa');
  assert.match(depois.alertaFixa, /férias ou folga/);
  assert.ok((await api.painelPendencias({ sessao: ATEND })).itens.some((x) => x.tipo === 'conflito_fixa' && x.ref.atendimentoId === pat.id));
  await amb.repo.transacao(null, async (tx) => { const d = await tx.get('diaristas', pat.profissional.id); await tx.put('diaristas', { ...d, bloqueios: [] }); });
});
t.teste('revisão invalidada por alteração relevante: volta pra Para revisar e a versão antiga não revisa', async () => {
  const r0 = await porCliente('Ricardo Almeida');
  await api.escalaRevisar(r0.id, r0.escalaVersao, { sessao: ATEND, chave: ch() });
  const d = await porCliente('Ricardo Almeida');
  assert.equal(d.escalaEstado, 'revisada', 'revisou');
  const candidatas = await api.escalaCandidatas(d.id, { sessao: ATEND });
  const outra = candidatas.itens.find((x) => !x.impedida && !x.atribuida);
  await api.escalaAlterar(d.id, { diaristaId: outra.id, escopo: 'so_esta' }, { sessao: ATEND, chave: ch() });
  const n = await porCliente('Ricardo Almeida');
  assert.equal(n.escalaEstado, 'para_revisar', 'estado'); assert.equal(n.designacaoOrigem, 'manual', 'origem'); assert.equal(n.escalaVersao, d.escalaVersao + 1, 'versão');
  await lancaCodigo(() => api.escalaRevisar(d.id, d.escalaVersao, { sessao: ATEND, chave: ch() }), 'DESATUALIZADA');
  // alteração por outro caminho (reagendar, painel antigo) também invalida: gatilho no repositório que os casos de uso usam
  const repoCasos = comGatilhoEscala(amb.repo);
  await amb.repo.transacao(null, async (tx) => { const a = await tx.get('atendimentos', d.id); await tx.put('atendimentos', { ...a, escalaEstado: 'revisada' }); });
  await repoCasos.transacao(null, async (tx) => { const a = await tx.get('atendimentos', d.id); await tx.put('atendimentos', { ...a, horaInicio: '10:00' }); });
  assert.equal((await porCliente('Ricardo Almeida')).escalaEstado, 'para_revisar', 'gatilho');
});
t.teste('vínculo futuro só administração; troca a fixa do dia da semana e aplica na próxima diária do pacote', async () => {
  const d = await porCliente('Juliana Costa');
  const outra = (await api.escalaCandidatas(d.id, { sessao: ADMIN })).itens.find((x) => !x.impedida && !x.atribuida);
  await lancaCodigo(() => api.escalaAlterar(d.id, { diaristaId: outra.id, escopo: 'vinculo_futuro' }, { sessao: ATEND, chave: ch() }), 'ATOR_SEM_PERMISSAO');
  await api.escalaAlterar(d.id, { diaristaId: outra.id, escopo: 'vinculo_futuro' }, { sessao: ADMIN, chave: ch() });
  const v = await api.vinculosFixos(d.pedidoId, { sessao: ADMIN });
  assert.equal(v.itens.filter((x) => !x.encerradoEm).length, 1); assert.equal(v.itens.find((x) => !x.encerradoEm).diaristaId, outra.id); assert.equal(v.itens.length, 2, 'o antigo fica no histórico');
  const prox = (await api.agendaEscala({ de: '2026-10-28', ate: '2026-10-28' }, { sessao: ADMIN })).itens.find((x) => x.pedidoId === d.pedidoId);
  assert.equal(prox.profissional.id, outra.id); assert.equal(prox.designacaoOrigem, 'fixa');
});
t.teste('remover depois de comunicada avisa a anterior (D08) e a rotina não repõe', async () => {
  const d = await porCliente('Empresa ABC Ltda');
  const ant = d.profissional.id;
  await api.escalaRemover(d.id, { sessao: ATEND, chave: ch() });
  const n = await porCliente('Empresa ABC Ltda');
  assert.equal(n.profissional, null); assert.equal(n.escalaEstado, 'para_revisar');
  assert.ok((await execucoes('D08')).some((e) => e.destinatario.id === ant && e.contexto.atendimentoId === d.id));
  await api.escalaPreparar({ de: HOJE, ate: HOJE }, { sessao: ATEND });
  assert.equal((await porCliente('Empresa ABC Ltda')).profissional, null);
});
t.teste('sem resposta não é recusa: continua aguardando, gera pendência com o prazo; recusa expressa volta pra equipe', async () => {
  const sem = (await api.agendaEscala({ de: '2026-10-22', ate: '2026-10-25' }, { sessao: ADMIN })).itens.filter((x) => x.escalaEstado === 'enviada');
  assert.ok(sem.length);
  const pend = (await api.painelPendencias({ sessao: ATEND })).itens;
  for (const s of sem) assert.ok(pend.some((p) => p.tipo === 'sem_resposta' && p.ref.atendimentoId === s.id), 'pendência de sem resposta');
  assert.equal((await api.agendaEscala({ de: sem[0].data, ate: sem[0].data }, { sessao: ADMIN })).itens.find((x) => x.id === sem[0].id).escalaEstado, 'enviada', 'nada mudou sozinho');
  await lancaCodigo(() => api.escalaResponder(sem[0].id, { resposta: 'recusa', versao: sem[0].escalaVersao - 1 }, { sessao: ATEND, chave: ch() }), 'DESATUALIZADA');
  await api.escalaResponder(sem[0].id, { resposta: 'recusa', versao: sem[0].escalaVersao }, { sessao: ATEND, chave: ch() });
  const r = (await api.agendaEscala({ de: sem[0].data, ate: sem[0].data }, { sessao: ADMIN })).itens.find((x) => x.id === sem[0].id);
  assert.equal(r.profissional, null); assert.equal(r.escalaEstado, 'para_revisar'); assert.ok(r.escalaRecusa);
  assert.ok((await api.painelPendencias({ sessao: ATEND })).itens.some((p) => p.tipo === 'recusa_profissional' && p.ref.atendimentoId === r.id));
});
t.teste('aceite registrado confirma; status da linha fica Confirmada (o pagamento segue à parte)', async () => {
  const x = (await api.agendaEscala({ de: '2026-10-22', ate: '2026-10-25' }, { sessao: ADMIN })).itens.find((i) => i.escalaEstado === 'aguardando_aceite');
  await api.escalaResponder(x.id, { resposta: 'aceite', versao: x.escalaVersao }, { sessao: ATEND, chave: ch() });
  const y = (await api.agendaEscala({ de: x.data, ate: x.data }, { sessao: ADMIN })).itens.find((i) => i.id === x.id);
  assert.equal(y.escalaEstado, 'confirmada'); assert.equal(y.status, x.status, 'atendimento.status (pagamento) não muda com o aceite');
});
t.teste('stand-by: reservar, utilizar numa diária (vira manual, para revisar) e liberar outra; não repete reserva', async () => {
  const r = await api.agendaEscala({ de: HOJE, ate: HOJE }, { sessao: ADMIN });
  const sb = r.standby[0];
  await lancaCodigo(() => api.standbyReservar({ diaristaId: sb.diaristaId, data: HOJE, horaInicio: '10:00', duracaoMinutos: 360 }, { sessao: ATEND, chave: ch() }), 'CONFLITO');
  const alvo = await porCliente('Empresa XYZ');
  await api.standbyUtilizar(sb.diaristaId, HOJE, alvo.id, { sessao: ATEND, chave: ch() });
  const n = await porCliente('Empresa XYZ');
  assert.equal(n.profissional.id, sb.diaristaId); assert.equal(n.designacaoOrigem, 'manual'); assert.equal(n.escalaEstado, 'para_revisar');
  assert.equal((await api.agendaEscala({ de: HOJE, ate: HOJE }, { sessao: ADMIN })).standby.length, 0);
  const livre = (await api.escalaCandidatas(alvo.id, { sessao: ADMIN })).itens.find((x) => !x.atribuida);
  await api.standbyReservar({ diaristaId: livre.id, data: '2026-10-22', horaInicio: '08:00', duracaoMinutos: 240, regiao: 'BH' }, { sessao: ATEND, chave: ch() });
  await api.standbyLiberar(livre.id, '2026-10-22', 'não precisou', { sessao: ATEND, chave: ch() });
  assert.equal((await api.agendaEscala({ de: '2026-10-22', ate: '2026-10-22' }, { sessao: ADMIN })).standby.length, 0);
});
t.teste('configuração: padrões desligados; só administração muda; canal ativo com motivo e histórico', async () => {
  const c = await api.configAgenda({ sessao: ATEND });
  assert.equal(c.verificacaoPagamento.ligada, false);
  await lancaCodigo(() => api.salvarConfigAgenda({ prazoSemRespostaMin: 60 }, { sessao: ATEND }), 'ATOR_SEM_PERMISSAO');
  await lancaCodigo(() => api.salvarConfigAgenda({ prazoSemRespostaMin: 5 }, { sessao: ADMIN }), 'DADOS_INVALIDOS');
  await lancaCodigo(() => api.definirCanalAtivo('portal', '', { sessao: ADMIN }), 'DADOS_INVALIDOS');
  await api.definirCanalAtivo('portal', 'teste de contingência', { sessao: ADMIN });
  const d = await api.configAgenda({ sessao: ATEND });
  assert.equal(d.canalAtivo, 'portal'); assert.equal(d.historicoCanal.at(-1).para, 'portal');
  await api.definirCanalAtivo('whatsapp', 'voltou', { sessao: ADMIN });
});
t.teste('só a equipe Prime: cliente e profissional não leem a agenda nem agem', async () => {
  for (const s of [{ ator: 'cliente', id: 'c' }, { ator: 'diarista', id: 'd' }, null]) {
    await lancaCodigo(() => api.agendaEscala({ de: HOJE, ate: HOJE }, { sessao: s }), 'ATOR_SEM_PERMISSAO');
    await lancaCodigo(() => api.escalaEnviar(['x'], { sessao: s, chave: ch() }), 'ATOR_SEM_PERMISSAO');
  }
});

t.teste('revisão do Codex: reenviar depois de falha também com a diária em "Enviada"; sem falha, não', () => {
  assert.equal(transicionarEscala({ escalaEstado: 'enviada', diaristaId: 'x' }, 'enviar', { ator: 'prime', envioFalhou: true }), 'aguardando_envio');
  assert.throws(() => transicionarEscala({ escalaEstado: 'enviada', diaristaId: 'x' }, 'enviar', { ator: 'prime' }), /já foi enviada/);
  assert.equal(acaoDaLinha({ status: 'confirmado', diaristaId: 'x', escalaEstado: 'enviada', escalaEnvio: { falhou: true } }), 'enviar');
});
t.teste('revisão do Codex: falha de envio reabre a mesma execução D10 (uma por versão) e a mensagem de versão antiga não sai', async () => {
  const d = (await api.agendaEscala({ de: '2026-10-22', ate: '2026-10-25' }, { sessao: ADMIN })).itens.find((x) => x.escalaEstado === 'revisada' && x.profissional);
  await api.escalaEnviar([d.id], { sessao: ATEND, chave: ch() });
  const [e] = (await execucoes('D10')).filter((x) => x.contexto.atendimentoId === d.id);
  await amb.repo.transacao(null, async (tx) => { await tx.put('execucoes', { ...e, estado: 'falhou', motivo: 'telefone inválido' }); });
  await amb.casosBase.sincronizarEscala();
  const f = (await api.agendaEscala({ de: d.data, ate: d.data }, { sessao: ADMIN })).itens.find((x) => x.id === d.id);
  assert.equal(f.escalaEnvio.falhou, true); assert.equal(acaoDaLinha({ ...f, diaristaId: f.profissional.id }), 'enviar');
  assert.ok((await api.painelPendencias({ sessao: ATEND })).itens.some((p) => p.tipo === 'falha_envio_escala' && p.ref.atendimentoId === d.id));
  const r = await api.escalaEnviar([d.id], { sessao: ATEND, chave: ch() });
  assert.deepEqual(r.enviadas, [d.id]);
  const l = (await execucoes('D10')).filter((x) => x.contexto.atendimentoId === d.id);
  assert.equal(l.length, 1, 'a mesma execução, não uma nova'); assert.notEqual(l[0].estado, 'falhou');
});
t.teste('revisão do Codex: fixa sem aprovação não dá lugar a sugerida; recusa em diária encerrada é recusada', async () => {
  const prox = (await api.agendaEscala({ de: '2026-10-28', ate: '2026-10-28' }, { sessao: ADMIN })).itens.find((x) => x.pacote && x.vinculoFixo);
  await api.escalaRemover(prox.id, { sessao: ADMIN, chave: ch() });
  await amb.repo.transacao(null, async (tx) => { const a = await tx.get('atendimentos', prox.id); await tx.put('atendimentos', { ...a, escalaSemAuto: false }); const dd = await tx.get('diaristas', prox.vinculoFixo.diaristaId); await tx.put('diaristas', { ...dd, status: 'reprovada' }); });
  const r = await api.escalaPreparar({ de: '2026-10-28', ate: '2026-10-28' }, { sessao: ADMIN });
  assert.ok(r.conflitosFixa >= 1);
  assert.equal((await api.agendaEscala({ de: '2026-10-28', ate: '2026-10-28' }, { sessao: ADMIN })).itens.find((x) => x.id === prox.id).profissional, null);
  await amb.repo.transacao(null, async (tx) => { const dd = await tx.get('diaristas', prox.vinculoFixo.diaristaId); await tx.put('diaristas', { ...dd, status: 'aprovada' }); });
  const fin = (await api.agendaEscala({ de: '2026-10-19', ate: '2026-10-20' }, { sessao: ADMIN })).itens.find((x) => ['finalizado', 'avaliado'].includes(x.status) && x.profissional);
  await lancaCodigo(() => api.escalaResponder(fin.id, { resposta: 'recusa', versao: fin.escalaVersao }, { sessao: ATEND, chave: ch() }), 'TRANSICAO_PROIBIDA');
});

t.teste('revisão do Codex: D10 e D11 de uma versão antiga da designação não saem (horário mudou com a mesma profissional)', () => {
  const regra = { condicoes: { mesmaProfissional: true, mesmaVersaoEscala: true } };
  assert.equal(condicaoFalha(regra, { atendimento: { diaristaId: 'x', escalaVersao: 2 } }, { contexto: { diaristaId: 'x', dados: { versao: 1 } } }), 'escala mudou de versão');
  assert.equal(condicaoFalha(regra, { atendimento: { diaristaId: 'x', escalaVersao: 2 } }, { contexto: { diaristaId: 'x', dados: { versao: 2 } } }), null);
});

await t.fim();
