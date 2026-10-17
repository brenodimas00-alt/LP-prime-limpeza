// Passos do autoagendamento v3 no navegador, pros testes que rodam contra o PREVIEW (Supabase de homologação).
// O testa-v3-navegador (mock) tem as próprias cópias, com as asserções de cada tela; aqui é só o caminho.
import { CONFIG_PRECOS } from '../src/config/precos.js';
import { dataNoFuso, somarDias, diaDaSemana } from '../src/domain/calendario.js';

export const HOJE = () => dataNoFuso(new Date().toISOString());
/** Dia útil (seg a sex, sem feriado) a partir de hoje + n. */
export function diaUtil(n, desde = HOJE()) {
  let d = somarDias(desde, n);
  while ([0, 6].includes(diaDaSemana(d)) || CONFIG_PRECOS.feriados.includes(d)) d = somarDias(d, 1);
  return d;
}
export const continuar = (p) => p.getByRole('button', { name: 'Continuar', exact: true }).click();
export const marcar = (p, nome, valor) => p.locator(`input[name="${nome}"][value="${valor}"]`).evaluate((i) => { if (!i.checked) i.click(); });
export const titulo = (p) => p.locator('#titulo-passo').textContent();
export async function escolherData(p, d) {
  for (let i = 0; i < 6 && !(await p.locator(`.cal-dia[data-dia="${d}"]`).count()); i++) await p.getByRole('button', { name: 'Próximo mês' }).click();
  await p.locator(`.cal-dia[data-dia="${d}"]`).click();
}
export async function horario(p, id, hh, mm) { await p.selectOption(`#${id}-hora`, hh); await p.selectOption(`#${id}-min`, mm); }
export async function semOverflow(p) {
  const [sw, w] = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  if (sw > w) throw new Error(`overflow horizontal: ${sw} > ${w}`);
}

/** Serviço e identificação. */
export async function inicio(p, base, { segmento = 'residencial', servico = 'residencial' } = {}) {
  await p.goto(`${base}autoagendamento/`); await p.waitForSelector('[data-passo=servico]');
  await marcar(p, 'segmento', segmento); await marcar(p, 'servico', servico); await continuar(p);
  await p.waitForSelector('[data-passo=identificacao]');
}
/** "Ainda não sou cliente": preenche o cadastro (pf ou empresa) e continua. Não espera o próximo passo (o teste decide). */
export async function cadastro(p, c) {
  await marcar(p, 'identificacao', 'novo'); await continuar(p); await p.waitForSelector('[data-passo=cadastro]');
  if (c.cnpj) { await p.fill('#responsavel', c.responsavel); await p.fill('#razaoSocial', c.razaoSocial); await p.fill('#cnpj', c.cnpj); } else await p.fill('#nome', c.nome);
  await p.fill('#telefone', c.telefone); await p.getByRole('button', { name: 'Confirmar número' }).click();
  await p.fill('#email', c.email);
  if (!c.cnpj) { await p.fill('#cpf', c.cpf); await p.fill('#dataNascimento', c.nascimento || '1990-03-07'); }
  await continuar(p);
}
/** "Já sou cliente": entra sem sair do fluxo. */
export async function entrarNoFluxo(p, identificador, senha) {
  await marcar(p, 'identificacao', 'cliente'); await p.waitForSelector('#entrar-identificador');
  await p.fill('#entrar-identificador', identificador); await p.fill('#entrar-senha', senha);
  await p.getByRole('button', { name: 'Entrar', exact: true }).click();
  await p.waitForSelector('[data-passo=endereco]', { timeout: 30000 });
  await p.waitForFunction(() => !/Carregando seus endereços/.test(document.querySelector('[data-passo=endereco]')?.textContent || ''), null, { timeout: 30000 });
}
export async function enderecoNovo(p, { cep = '30130010', numero = '100', tipo = 'Apartamento', uso = 'salvar' } = {}) {
  await p.fill('#cep', cep); await p.waitForSelector('[data-regiao=atendida]', { timeout: 15000 });
  await p.fill('#numero', numero); await p.selectOption('#tipoImovel', tipo);
  await marcar(p, 'usoEndereco', uso);
  await continuar(p); await p.waitForSelector('[data-passo=local]');
}
/** Características padrão por serviço (sugestão de 4h), refeição e continua pra modalidade. */
export async function local(p, servico = 'residencial', { refeicao = 'sim', extra } = {}) {
  if (servico === 'passadoria') {
    for (let i = 0; i < 4; i++) await p.getByRole('button', { name: 'Aumentar peças' }).click();
    await marcar(p, 'tipoPecas', 'basicas');
  } else {
    await p.fill('#metragem', '45');
    if (servico === 'pre_pos_evento') { await marcar(p, 'momento', 'antes'); for (let i = 0; i < 3; i++) await p.getByRole('button', { name: 'Aumentar quantidade aproximada de ambientes utilizados' }).click(); } else await p.getByRole('button', { name: 'Aumentar quartos' }).click();
    if (servico === 'pre_pos_mudanca') { await marcar(p, 'mobiliado', 'mobiliado'); await marcar(p, 'condicao', 'leve'); }
  }
  if (extra) await extra();
  if (servico !== 'passadoria' || await p.locator('input[name=animais]').count()) await marcar(p, 'animais', 'nao');
  await marcar(p, 'localRefeicao', refeicao);
  await continuar(p); await p.waitForSelector('[data-passo=modalidade]');
}
export async function avulsa(p, data, [hh, mm] = ['08', '30']) {
  await marcar(p, 'modalidade', 'avulsa'); await continuar(p); await p.waitForSelector('[data-passo=datas]');
  await escolherData(p, data); await horario(p, 'horario', hh, mm);
  await continuar(p); await p.waitForSelector('[data-valor=total]', { timeout: 30000 });
}
export async function aceitarEEnviar(p, { duplo = false } = {}) {
  await p.getByRole('button', { name: 'Ler Termos e Condições' }).click();
  await p.waitForSelector('dialog.painel-lateral .texto-modal h2');
  await p.getByRole('button', { name: 'Fechar' }).click();
  await p.locator('#aceite-termos-v3').check();
  const btn = p.getByRole('button', { name: 'ENVIAR SOLICITAÇÃO' });
  if (duplo) await btn.dblclick(); else await btn.click();
  await p.waitForSelector('[data-passo=enviado]', { timeout: 30000 });
  return p.locator('[data-numero]').getAttribute('data-numero');
}
