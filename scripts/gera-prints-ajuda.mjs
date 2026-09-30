// D1: prints da central de ajuda (assets/ajuda/*.png) tirados do preview com dados FICTÍCIOS criados aqui e apagados no
// fim. Cada print é recortado no elemento do registro fictício (nunca uma lista que possa ter dado real).
// Uso: LD_LIBRARY_PATH=... bash scripts/cli.sh node22 scripts/gera-prints-ajuda.mjs [url]
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { abrirNavegador } from './pw.mjs';
import { sql, fecharSql, limparFicticios, criarUsuario, cpfFicticio, entrar } from './lib-supabase.mjs';
import { montarApiDeTeste } from './lib-api-teste.mjs';
import { agendar, chave, liberarCobranca, levarAteFinalizado } from './cenarios.mjs';
import { CLIENTE_RESIDENCIAL, proximaDataPermitida } from './fixtures/seed.js';
import { CONFIG_PRECOS } from '../src/config/precos.js';
import { dataNoFuso, somarDias } from '../src/domain/calendario.js';

const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim().replace(/[/_.]/g, '-').toLowerCase();
const BASE = (process.argv[2] || `https://${branch}.prime-limpeza.pages.dev/`).replace(/\/?$/, '/');
const PASTA = new URL('../assets/ajuda/', import.meta.url).pathname;
mkdirSync(PASTA, { recursive: true });
await limparFicticios();
const PRIME = { ator: 'prime' };
const { api, porDiaristaId, porEmail } = await montarApiDeTeste('ajuda');
let D = proximaDataPermitida(somarDias(dataNoFuso(new Date().toISOString()), 8), 1, CONFIG_PRECOS);
while ([0, 6].includes(new Date(`${D}T12:00:00Z`).getUTCDay()) || CONFIG_PRECOS.feriados.includes(D)) D = somarDias(D, 1);
const pacote = { tipoServico: 'residencial', duracaoHoras: 4, metragem: 45, quantidadeDiarias: 1, frequencia: 'avulso' };
const CPF = cpfFicticio();
const cli = (email) => ({ ...CLIENTE_RESIDENCIAL, nome: 'Ana Exemplo', email, cpf: CPF });

async function diarista(nome) {
  const u = await criarUsuario(`ajuda-${nome.toLowerCase()}`, 'diarista');
  const [{ id }] = await sql(`insert into public.diaristas (usuario_id, nome, cpf, telefone, email, data_nascimento, identidade, status, aceite_termos_em, disponibilidade, ficticio)
    values ($1, $2, $3, '31955554444', $4, '1985-04-12', 'cnh', 'aprovada', now(), '{"dias":[1,2,3,4,5,6],"turnos":["integral"],"regioes":["BH - Centro-Sul"]}', true) returning id`, [u.id, `${nome} Exemplo`, cpfFicticio(), u.email]);
  porDiaristaId.set(id, entrar(u));
  return id;
}
const MARIA = await diarista('Maria'); await diarista('Joana');
const uCli = await criarUsuario('ajuda-cli'); porEmail.set(uCli.email, entrar(uCli));
const sol = await agendar(api, { cliente: cli(uCli.email), pacote, primeiraData: D, turno: 'manha' }, chave('aj'));
const pag = await agendar(api, { cliente: cli(uCli.email), pacote, primeiraData: somarDias(D, 1), turno: 'manha' }, chave('aj'));
const [gPag] = await liberarCobranca(api, pag);
await api.atribuirDiarista(pag.atendimentos[0].id, { diaristaId: MARIA }, { sessao: PRIME, chave: chave('atr') });
await api.informarPagamento(gPag.id, { sessao: { ator: 'cliente', id: pag.cliente.id }, chave: chave('inf') });
const fim = await agendar(api, { cliente: cli(uCli.email), pacote, primeiraData: somarDias(D, 2), turno: 'manha' }, chave('aj'));
await levarAteFinalizado(api, fim, MARIA, fim.atendimentos[0].id);
const [gFim] = (await api.obterPedido(fim.pedido.id, { sessao: PRIME })).pagamentos;
const oc = await api.abrirOcorrencia(fim.atendimentos[0].id, { tipo: 'dano', descricao: 'Um copo quebrou durante a limpeza da cozinha.' }, { sessao: { ator: 'cliente', id: fim.cliente.id }, chave: chave('oc') });

const adm = await criarUsuario('ajuda-adm', 'prime_admin');
const b = await abrirNavegador();
const ctx = await b.newContext({ viewport: { width: 1100, height: 900 }, reducedMotion: 'reduce', deviceScaleFactor: 1 });
const p = await ctx.newPage();
await p.goto(`${BASE}painel/entrar/`);
await p.fill('#email', adm.email); await p.fill('#senha', adm.senha);
await p.getByRole('button', { name: 'Entrar', exact: true }).click();
await p.waitForURL(/painel\/(\?|$)/);
const ir = async (aba, extra = '') => { await p.goto(`${BASE}painel/?aba=${aba}${extra}`); await p.waitForFunction(() => !document.querySelector('.carregando')); };
const foto = async (loc, nome) => { await loc.scrollIntoViewIfNeeded(); await loc.screenshot({ path: `${PASTA}${nome}.png` }); console.log(`assets/ajuda/${nome}.png`); };

await ir('solicitacoes');
await p.locator(`[data-sugestoes="${sol.atendimentos[0].id}"] summary`).click();
await p.locator(`[data-sugestoes="${sol.atendimentos[0].id}"] [data-sugestao="${MARIA}"]`).waitFor();
await foto(p.locator(`[data-solicitacao="${sol.pedido.id}"]`), 'confirmar-disponibilidade');
await ir('pagamentos');
await foto(p.locator(`[data-pagamento="${gPag.id}"]`), 'confirmar-pagamento');
await ir('atribuir');
const linhaAtr = p.locator(`tr[data-atendimento="${sol.atendimentos[0].id}"]`);
await linhaAtr.locator('details summary').click();
await linhaAtr.locator(`[data-sugestao="${MARIA}"]`).waitFor();
await foto(linhaAtr, 'designar');
await ir('agenda', `&data=${D}`);
await p.locator(`[data-diaria="${pag.atendimentos[0].id}"]`).click();
await p.locator('dialog[open] .conflitos p, dialog[open] .conflitos li').first().waitFor();
await p.waitForTimeout(800);
await foto(p.locator('dialog[open]'), 'remarcar');
await p.keyboard.press('Escape');
await ir('pagamentos');
const rec = p.locator(`[data-tabela=recebidos] tr[data-pagamento="${gFim.id}"]`);
await rec.locator('details summary').click();
await foto(rec, 'estornar');
await ir('ocorrencias');
await foto(p.locator(`[data-ocorrencia="${oc.ocorrencia.id}"]`), 'ocorrencia');
await ir('notificacoes');
await foto(p.locator('table').first().locator('tbody tr').first(), 'automacao');
await ir('relacionamento');
await foto(p.locator('section').filter({ hasText: 'Planilhas' }).last(), 'exportar');

await b.close();
await sql('delete from public.ocorrencias where id = $1', [oc.ocorrencia.id]);
await limparFicticios({ soEstaExecucao: true });
await fecharSql();
