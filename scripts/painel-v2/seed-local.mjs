// Painel v2 (etapa A1): mundo FICTÍCIO realista no Supabase LOCAL pra fotografar o painel atual. Nenhum nome, CPF,
// e-mail ou telefone vem da base real: tudo inventado aqui.
// Uso: SUPABASE_LOCAL_STATUS=<json do status> bash scripts/cli.sh node22 scripts/painel-v2/seed-local.mjs
import { writeFileSync } from 'node:fs';
import { sql, fecharSql, criarUsuario, entrar, montarApi, cpfFicticio, chave, PRIME, SENHA_PRIME_LOCAL } from './lib-local.mjs';
import { CONFIG_PRECOS } from '../../src/config/precos.js';
import { dataNoFuso } from '../../src/domain/calendario.js';
import { proximaDataPermitida } from '../fixtures/seed.js';

const HOJE = dataNoFuso(new Date().toISOString());
const D = (n) => proximaDataPermitida(HOJE, n, CONFIG_PRECOS);
const SAIDA = new URL('../../docs/painel-v2/seed-local.json', import.meta.url);

const END = (logradouro, numero, bairro, cidade = 'Belo Horizonte', cep = '30140071', complemento = '') => ({ cep, logradouro, numero, complemento, bairro, cidade, uf: 'MG' });
const res = (nome, email, telefone, endereco, nasc = '1986-03-12') => ({ tipo: 'residencial', nome, email, telefone, cpf: cpfFicticio(), dataNascimento: nasc, endereco });
const emp = (nome, razaoSocial, responsavel, email, telefone, endereco) => ({ tipo: 'empresa', nome, razaoSocial, responsavel, email, telefone, cnpj: cnpjFicticio(), endereco });
function cnpjFicticio() {
  const d = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10));
  const pesos = (n) => Array.from({ length: n }, (_, i) => ((n - 1 - i) % 8) + 2);
  for (const n of [12, 13]) { const p = pesos(n); const s = d.reduce((acc, x, i) => acc + x * p[i], 0); const r = s % 11; d.push(r < 2 ? 0 : 11 - r); }
  return d.join('');
}

const CLIENTES = {
  beatriz: res('Beatriz Andrade', 'beatriz.andrade@exemplo.com', '31991110001', END('Rua das Acácias', '218', 'Buritis', 'Belo Horizonte', '30575120', 'apto 402')),
  renata: res('Renata Carvalho', 'renata.carvalho@exemplo.com', '31991110002', END('Rua Curitiba', '1450', 'Lourdes', 'Belo Horizonte', '30170121', 'apto 1201'), '1979-07-30'),
  juliana: res('Juliana Freitas', 'juliana.freitas@exemplo.com', '31991110003', END('Rua Castelo de Óbidos', '77', 'Castelo', 'Belo Horizonte', '31330200'), '1990-11-05'),
  marcos: res('Marcos Oliveira', 'marcos.oliveira@exemplo.com', '31991110004', END('Rua Pernambuco', '960', 'Savassi', 'Belo Horizonte', '30130151', 'apto 302'), '1983-01-22'),
  patricia: res('Patrícia Gomes', 'patricia.gomes@exemplo.com', '31991110005', END('Rua Grão Mogol', '320', 'Sion', 'Belo Horizonte', '30310010'), '1988-09-14'),
  luciana: res('Luciana Martins', 'luciana.martins@exemplo.com', '31991110006', END('Rua Ouro Preto', '1102', 'Santo Agostinho', 'Belo Horizonte', '30170041', 'apto 804'), '1995-04-02'),
  condominio: emp('Condomínio Vila das Flores', 'Condomínio Vila das Flores', 'Sérgio Almeida (síndico)', 'sindico@viladasflores.exemplo', '31991110007', END('Avenida Luiz Paulo Franco', '600', 'Belvedere', 'Belo Horizonte', '30320570')),
  padaria: emp('Padaria Pão da Serra', 'Pão da Serra Alimentos Ltda', 'Dona Lúcia', 'contato@paodaserra.exemplo', '31991110008', END('Rua Tiradentes', '45', 'Centro', 'Contagem', '32010010')),
  escritorio: emp('Escritório Lemos e Silva', 'Lemos e Silva Advogados Associados', 'Dra. Carla Lemos', 'contato@lemosesilva.exemplo', '31991110009', END('Rua dos Inconfidentes', '911', 'Funcionários', 'Belo Horizonte', '30140120', 'sala 1104')),
};
const DIARISTAS = [
  ['maria', 'Maria das Graças Souza', '31992220001', ['BH - Centro-Sul', 'BH - Oeste'], 'aprovada', 12],
  ['claudia', 'Cláudia Ferreira Lima', '31992220002', ['BH - Pampulha', 'BH - Norte'], 'aprovada', 7],
  ['fernanda', 'Fernanda Lopes', '31992220003', ['Contagem', 'BH - Oeste', 'BH - Centro-Sul'], 'aprovada', 5],
  ['simone', 'Simone Alves Rocha', '31992220004', ['BH - Centro-Sul', 'Nova Lima'], 'aprovada', 9],
  ['joana', 'Joana Ribeiro', '31992220005', ['BH - Leste', 'Sabará'], 'pendente', 3],
];
// empresa e condomínio: frequência obrigatória (regra do banco)
const pac = (duracaoHoras, metragem, tipoServico = 'residencial', quantidadeDiarias = 1, frequencia = 'avulso', extra = {}) => ({ tipoServico, duracaoHoras, metragem, quantidadeDiarias, frequencia, ...extra });

const ids = { clientes: {}, diaristas: {}, pedidos: {}, atendimentos: {}, pagamentos: {}, ocorrencias: {} };
const falhas = [];
async function passo(nome, fn) {
  try { return await fn(); } catch (e) { falhas.push(`${nome}: ${e.message} ${JSON.stringify(e.detalhes || '')}`); console.log(`FALHA ${nome}: ${e.message}`); return null; }
}

const prime = await criarUsuario('isa@prime-exemplo.com', 'prime_admin', SENHA_PRIME_LOCAL);
await sql(`update public.perfis set senha_propria = true where user_id = $1`, [prime.id]);
const { api, porDiaristaId } = await montarApi(prime);

// profissionais: linha direta (o cadastro real sobe documentos pela function, que não roda no local)
for (const [k, nome, tel, regioes, status, anos] of DIARISTAS) {
  const u = await criarUsuario(`${k}@exemplo.com`, 'diarista');
  const [{ id }] = await sql(`insert into public.diaristas (usuario_id, nome, cpf, telefone, email, data_nascimento, endereco, experiencia_anos, identidade, status, aceite_termos_em, disponibilidade, ficticio, criado_em)
    values ($1, $2, $3, $4, $5, '1984-05-20', $6, $7, 'cnh', $8, now(), $9, true, now() - interval '40 days') returning id`,
  [u.id, nome, cpfFicticio(), tel, u.email, JSON.stringify(END('Rua Padre Eustáquio', '1200', 'Padre Eustáquio', 'Belo Horizonte', '30720010')), anos, status,
    JSON.stringify({ dias: [1, 2, 3, 4, 5, 6], turnos: ['integral'], regioes })]);
  ids.diaristas[k] = id;
  porDiaristaId.set(id, entrar(u));
  if (status === 'pendente') {
    for (const [tipo, arq, mime, tam] of [['cnh_frente', 'cnh-frente.jpg', 'image/jpeg', 412000], ['cnh_verso', 'cnh-verso.jpg', 'image/jpeg', 398000], ['comprovante_residencia', 'conta-de-luz.pdf', 'application/pdf', 150200], ['foto_perfil', 'foto.jpg', 'image/jpeg', 220100], ['antecedentes', 'antecedentes.pdf', 'application/pdf', 98000]]) {
      await sql(`insert into public.documentos (diarista_id, tipo, nome_arquivo, mime, tamanho, storage_path) values ($1, $2, $3, $4, $5, $6)`, [id, tipo, arq, mime, tam, `ficticio/${id}/${tipo}`]);
    }
  }
}

const SC = (r) => ({ ator: 'cliente', id: r.cliente.id });
const SD = (k) => ({ ator: 'diarista', id: ids.diaristas[k] });
async function pedido(nome, cliente, pacote, primeiraData, turno = 'manha', extra = {}) {
  const r = await api.confirmarAutoagendamento({ cliente, pacote, primeiraData, turno, ...extra }, { chave: chave(nome) });
  ids.clientes[cliente.nome] = r.cliente.id; ids.pedidos[nome] = r.pedido.id; ids.atendimentos[nome] = r.atendimentos.map((a) => a.id);
  return r;
}
const liberar = (r) => api.confirmarDisponibilidade(r.pedido.id, {}, { sessao: PRIME, chave: chave('disp') });
async function pagar(r, i = 0, { soInformar = false } = {}) {
  const { pagamentos } = await api.obterPedido(r.pedido.id, { sessao: PRIME });
  const g = pagamentos.find((p) => p.atendimentoId === r.atendimentos[i].id) || pagamentos[0];
  await api.informarPagamento(g.id, { sessao: SC(r), chave: chave('inf') });
  if (!soInformar) await api.confirmarPagamento(g.id, { sessao: PRIME, chave: chave('conf') });
  return g;
}
const atribuir = (r, k, i = 0) => api.atribuirDiarista(r.atendimentos[i].id, { diaristaId: ids.diaristas[k] }, { sessao: PRIME, chave: chave('atr') });
async function executar(r, k, i = 0) {
  for (const ev of ['sair_a_caminho', 'iniciar', 'finalizar']) await api.transicionarAtendimento(r.atendimentos[i].id, { evento: ev }, { sessao: SD(k), chave: chave('t') });
}
const avaliar = (r, notas, comentario, i = 0) => api.criarAvaliacao(r.atendimentos[i].id, { notas, comentario }, { sessao: SC(r), chave: chave('av') });
const N = (p, q, c, m) => ({ pontualidade: p, qualidade: q, cuidado: c, comunicacao: m });
/** diária completa: disponibilidade, pagamento, profissional e execução até finalizada */
async function feita(nome, cliente, pacote, data, k, turno = 'manha') {
  const r = await pedido(nome, cliente, pacote, data, turno); await liberar(r); await pagar(r); await atribuir(r, k); await executar(r, k); return r;
}

// ---- passado (criado no futuro e deslocado por SQL no fim) ----
const p1 = await passo('p1', async () => { const r = await feita('p1', CLIENTES.beatriz, pac(4, 70), D(2), 'maria'); await avaliar(r, N(5, 5, 4, 5), 'Tudo impecável. A Maria é super atenciosa e caprichosa.'); return r; });
const p2 = await passo('p2', async () => { const r = await feita('p2', CLIENTES.renata, pac(6, 110), D(1), 'claudia'); await avaliar(r, N(4, 5, 5, 4), 'Ficou ótimo, só chegou uns minutinhos depois do combinado.'); return r; });
await passo('p3', async () => {
  const r = await feita('p3', CLIENTES.padaria, pac(4, 60, 'empresarial', 2, 'quinzenal'), D(1), 'maria', 'tarde');
  await passo('p3 hora extra', () => api.registrarHoraExtra(r.atendimentos[0].id, { horas: 1, observacao: 'A cliente pediu pra limpar o estoque também.' }, { sessao: SD('maria'), chave: chave('he') }));
  await avaliar(r, N(5, 4, 5, 5), 'Loja brilhando pra abrir no dia seguinte.');
  return r;
});
await passo('p4', async () => {
  const r = await feita('p4', CLIENTES.juliana, pac(4, 65), D(2), 'fernanda');
  const oc = await api.abrirOcorrencia(r.atendimentos[0].id, { tipo: 'item_nao_feito', descricao: 'O banheiro de serviço não foi limpo e a área externa ficou com folhas.' }, { sessao: SC(r), chave: chave('oc') });
  ids.ocorrencias.p4 = oc.ocorrencia.id;
  return r;
});
await passo('p5', async () => { const r = await feita('p5', CLIENTES.marcos, pac(4, 55), D(2), 'simone'); await avaliar(r, N(3, 4, 3, 4), 'Bom, mas atrasou uns 20 minutos e esqueceu de passar pano na varanda.'); return r; });
// recorrente (renovação): semanal, 4 diárias, a primeira já feita e a segunda paga
const p6 = await passo('p6', async () => {
  const r = await pedido('p6', CLIENTES.escritorio, pac(6, 140, 'empresarial', 4, 'semanal', { semLocalAlmoco: true }), D(1)); await liberar(r);
  await pagar(r, 0); await atribuir(r, 'fernanda', 0); await executar(r, 'fernanda', 0); await pagar(r, 1); await atribuir(r, 'fernanda', 1);
  return r;
});

// ---- hoje (criado em D+1 e deslocado 1 dia) ----
await passo('p7', async () => { const r = await pedido('p7', CLIENTES.beatriz, pac(4, 70), D(1)); await liberar(r); await pagar(r); await atribuir(r, 'simone'); await passo('p7 confirmar', () => api.transicionarAtendimento(r.atendimentos[0].id, { evento: 'confirmar' }, { sessao: SD('simone'), chave: chave('t') })); });
await passo('p8', async () => { const r = await pedido('p8', CLIENTES.condominio, pac(8, 220, 'condominial', 4, 'semanal'), D(1), 'integral'); await liberar(r); await pagar(r); await atribuir(r, 'maria'); });

// ---- futuro ----
await passo('p9', async () => { const r = await pedido('p9', CLIENTES.renata, pac(4, 110), D(2)); await liberar(r); await pagar(r); }); // paga, sem profissional
await passo('p10', async () => { const r = await pedido('p10', CLIENTES.juliana, pac(4, 65), D(3)); await liberar(r); await pagar(r, 0, { soInformar: true }); await atribuir(r, 'claudia'); }); // Pix informado
await passo('p11', async () => { const r = await pedido('p11', CLIENTES.patricia, pac(6, 95), D(4)); await liberar(r); }); // pendente: vai virar vencida
await passo('p12', async () => { const r = await pedido('p12', CLIENTES.marcos, pac(4, 55), D(5), 'tarde'); await liberar(r); await pagar(r); await atribuir(r, 'simone'); });
await passo('p13', async () => { const r = await pedido('p13', CLIENTES.padaria, pac(4, 60, 'empresarial', 4, 'semanal'), D(6), 'tarde'); await liberar(r); await pagar(r); await atribuir(r, 'maria'); });
// solicitações esperando a Prime
await passo('p14', () => pedido('p14', CLIENTES.patricia, pac(4, 95), D(3), 'manha', { preferenciaProfissional: 'Maria, que já atendeu minha mãe' }));
await passo('p15', () => pedido('p15', CLIENTES.condominio, pac(6, 220, 'condominial', 2, 'quinzenal'), D(7)));
await passo('p16', () => pedido('p16', CLIENTES.luciana, pac(2, 28), D(2), 'tarde'));

// consentimento de marketing de algumas clientes (listas do Relacionamento)
for (const r of [p1, p2, p6].filter(Boolean)) await passo('consentimento', () => api.definirConsentimento('marketing_whatsapp', true, { sessao: SC(r), origem: 'minha_conta' }));

// ---- deslocar datas pro passado (só SQL; o banco não aceita diária no passado pela API) ----
const voltar = async (nome, dias, i = 0) => {
  const at = ids.atendimentos[nome]?.[i];
  if (!at) return;
  await passo(`voltar ${nome}`, async () => {
    await sql(`update public.atendimentos set data = data - $2::int where id = $1`, [at, dias]);
    await sql(`update public.pagamentos set vence_em = vence_em - $2::int, confirmado_em = confirmado_em - make_interval(days => $2), informado_em = informado_em - make_interval(days => $2), criado_em = criado_em - make_interval(days => $2) where atendimento_id = $1`, [at, dias]);
    await sql(`update public.avaliacoes set criado_em = criado_em - make_interval(days => $2) where atendimento_id = $1`, [at, dias]);
    await sql(`update public.ocorrencias set criado_em = criado_em - make_interval(days => $2) where atendimento_id = $1`, [at, dias]);
  });
};
await voltar('p1', 8); await voltar('p2', 6); await voltar('p3', 4); await voltar('p4', 3); await voltar('p5', 72);
for (const i of [0, 1, 2, 3]) await voltar('p6', 8, i);
await voltar('p7', 1); await voltar('p8', 1);
// cobrança da Patrícia vencida ontem
if (ids.pedidos.p11) await sql(`update public.pagamentos set vence_em = current_date - 1 where pedido_id = $1 and status = 'pendente'`, [ids.pedidos.p11]);

writeFileSync(SAIDA, JSON.stringify({ hoje: HOJE, prime: { email: prime.email }, ...ids }, null, 2));
if (falhas.length) console.log(`\n${falhas.length} falha(s):\n${falhas.join('\n')}`);
console.log(`seed fictício pronto: ${Object.keys(ids.pedidos).length} pedidos, ${Object.keys(ids.diaristas).length} profissionais, ${Object.keys(ids.clientes).length} clientes`);
await fecharSql();
