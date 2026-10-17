// Casos de uso do autoagendamento v3 no mock e no fake-api (o Supabase faz o mesmo em RPC: migrations 20261006*).
// Mesmo contrato dos três adapters (scripts/cenarios-v3.mjs).
// - cadastrarClienteV3: cadastro ANTES do endereço, salvo ao concluir a etapa (item 34). Resposta SEMPRE {ok, ticket}: não
//   revela se o CPF/CNPJ existe. Documento novo: cliente + acesso pela regra padrão. Documento existente: o ticket só deixa
//   enviar uma solicitação vinculada (dados digitados guardados à parte), sem ler nem alterar a conta.
// - meusEnderecos / substituirEndereco: endereços da cliente logada (item 9).
// - conteudoAgendamento: tipos de imóvel e "Ver mais" (editáveis no painel; aqui o padrão do arquivo).
import { ErroNegocio } from '../domain/modelo.js';
import { validarCadastroV3, validarEnderecoV3, soDigitos } from '../domain/validacao.js';
import { regiaoV3 } from '../domain/agendamento-v3.js';
import { CONTEUDO_AGENDAMENTO_PADRAO } from '../config/agendamento-v3.js';

const TODOS = null;
const HORAS_TICKET = 24;

export async function sha256Hex(texto) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const limpa = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');

function erroCampos(erros, prefixo = '') {
  const ks = Object.keys(erros);
  if (!ks.length) return;
  const det = Object.fromEntries(ks.map((k) => [`${prefixo}${k}`, erros[k]]));
  throw new ErroNegocio('DADOS_INVALIDOS', erros[ks[0]], det);
}

/** Endereço normalizado do v3 (mesmo formato de privado.v3_endereco). */
export function normalizarEnderecoV3(e = {}) {
  const t = limpa(e.tipoImovel);
  return {
    cep: soDigitos(e.cep), logradouro: limpa(e.logradouro), numero: limpa(e.numero), complemento: limpa(e.complemento), bairro: limpa(e.bairro),
    cidade: limpa(e.cidade), uf: String(e.uf ?? '').toUpperCase(), pontoReferencia: limpa(e.pontoReferencia), tipoImovel: t,
    tipoImovelOutro: t === 'Outro' ? limpa(e.tipoImovelOutro) : '',
  };
}

export function criarCasosV3({ repo, idem, agoraISO, hojeSP, gerarId, bytesAleatorios, cfg, conteudo = () => CONTEUDO_AGENDAMENTO_PADRAO }) {
  const exigirCliente = (sessao) => {
    if (sessao?.ator !== 'cliente' || !sessao.id) throw new ErroNegocio('ATOR_SEM_PERMISSAO', 'Entre na sua conta');
    return sessao.id;
  };
  const tiposDe = (segmento) => conteudo().tiposImovel[segmento === 'empresa' ? 'empresa' : 'residencial'] || [];

  /** Endereço novo do fluxo: valida (erros com "endereco.") e normaliza. */
  function enderecoValido(e, segmento) {
    const n = normalizarEnderecoV3(e);
    erroCampos(validarEnderecoV3(n, tiposDe(segmento)), 'endereco.');
    return n;
  }

  /** Ticket válido (não vencido nem usado) ou null. Chamar FORA da transação (sha256 é assíncrono). */
  async function hashTicket(ticket) {
    return /^[0-9a-f]{64}$/.test(String(ticket || '')) ? sha256Hex(ticket) : null;
  }

  return {
    async cadastrarClienteV3(dados = {}, { sessao, chave } = {}) {
      const { erros, cliente: c } = validarCadastroV3(dados, hojeSP());
      erroCampos(erros);
      // o ticket nasce fora da transação (o IndexedDB fecha a transação se ela esperar outra coisa)
      const bruto = hex(bytesAleatorios(32));
      const hash = await sha256Hex(bruto);
      const r = await repo.transacao(TODOS, (tx) => idem(tx, 'cadastrarV3', { ator: 'publico' }, chave, c, async () => {
        const doc = c.cnpj || c.cpf;
        const existente = (await tx.todos('clientes')).find((x) => !x.anonimizadoEm && (x.cnpj || x.cpf) === doc);
        let cliente = existente;
        if (!existente) {
          const emailEmUso = !!(await tx.get('credenciais', c.email)) || (await tx.todos('clientes')).some((x) => x.email === c.email);
          cliente = { id: gerarId(), ...c, endereco: {}, origem: 'site', baseLegal: 'execucao_contrato', statusProspeccao: 'novo', ...(emailEmUso ? { pendencias: ['email_em_uso'] } : {}), criadoEm: agoraISO() };
          await tx.put('clientes', cliente);
          if (!emailEmUso) await tx.put('credenciais', { email: c.email, tipo: 'cliente', refId: cliente.id, hash: null, criadoEm: agoraISO() });
        }
        const expira = new Date(Date.parse(agoraISO()) + HORAS_TICKET * 3600000).toISOString();
        await tx.put('tickets', { hash, clienteId: cliente.id, novo: !existente, dadosInformados: existente ? c : null, criadoEm: agoraISO(), expiraEm: expira, usadoEm: null });
        return { ok: true, ticket: bruto };
      }));
      return { ok: true, ticket: r.ticket };
    },

    async meusEnderecos({ sessao } = {}) {
      const id = exigirCliente(sessao);
      return repo.leitura(TODOS, async (tx) => (await tx.por('enderecos', 'clienteId', id))
        .filter((e) => e.ativo).sort((a, b) => Number(b.principal) - Number(a.principal) || a.criadoEm.localeCompare(b.criadoEm)));
    },

    async substituirEndereco(id, dados = {}, { sessao, chave } = {}) {
      const dona = exigirCliente(sessao);
      return repo.transacao(TODOS, (tx) => idem(tx, 'substituirEndereco', sessao, chave, { id, dados }, async () => {
        const ant = await tx.get('enderecos', id);
        if (!ant || ant.clienteId !== dona || !ant.ativo) throw new ErroNegocio('NAO_ENCONTRADO', 'Endereço não encontrado');
        const cli = await tx.get('clientes', dona);
        const e = enderecoValido(dados.endereco, cli.tipo);
        const reg = regiaoV3(e, cfg);
        if (!reg || reg.sobConsulta) throw new ErroNegocio('REGIAO_NAO_ATENDIDA', 'No momento, não atendemos esta região.', { 'endereco.cep': 'No momento, não atendemos esta região.' });
        const apelido = limpa(dados.apelido).slice(0, 40) || null;
        const novo = { id: gerarId(), clienteId: dona, ...e, apelido, principal: ant.principal, usoUnico: false, ativo: true, origem: 'site', criadoEm: agoraISO() };
        await tx.put('enderecos', { ...ant, ativo: false, principal: false, inativadoEm: agoraISO(), inativadoMotivo: 'substituido', substituidoPor: novo.id });
        await tx.put('enderecos', novo);
        return novo;
      }));
    },

    async conteudoAgendamento() { return structuredClone(conteudo()); },

    // usados pelos próximos passos (V5): o ticket e o endereço novo
    _v3: { enderecoValido, hashTicket },
  };
}
