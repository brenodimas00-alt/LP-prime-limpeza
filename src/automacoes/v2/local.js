// AUT: motor v2 no mock, no fake-api e nos testes Node (repositório em memória/IndexedDB, provedores simulados).
import { criarPortaRepo } from './porta-repo.js';
import { tique } from './motor.js';
import { mascararTelefone, mascararEmail } from './variaveis.js';

/** Provedores que não saem do processo: registram "simulada" (o mock nunca manda mensagem de verdade). */
export const PROVEDORES_SIMULADOS = Object.freeze({
  whatsapp: { nome: 'simulado', enviar: async () => ({ ok: true, status: 'simulada', provedor: 'simulado', idExterno: null }) },
  email: { nome: 'simulado', enviar: async () => ({ ok: true, status: 'simulada', provedor: 'simulado', idExterno: null }) },
  painel: { nome: 'painel', enviar: async () => ({ ok: true, status: 'enviada', provedor: 'painel', idExterno: null }) },
});

/**
 * @param {{repo, relogio:{agora:()=>Date}, gerarId, cfg, urlSite, provedores?, consentimentos?, feriados?, regras?}} op
 */
export function criarMotorLocal({ repo, relogio, gerarId, cfg, urlSite, provedores = PROVEDORES_SIMULADOS, consentimentos, feriados, regras, ambiente = {} }) {
  const porta = criarPortaRepo({ repo, cfg, urlSite, gerarId, feriados, regras, consentimentos, agora: () => relogio.agora() });
  return {
    porta,
    /** Um ciclo: eventos, agenda, envio e reconciliação, no relógio do mock. */
    tique: (op = {}) => tique({ porta, provedores, agoraISO: relogio.agora().toISOString(), ambiente, ...op }),
  };
}

/** Execuções + mensagens no formato antigo de "notificação" (painel do mock e testes que liam notificacoes). */
export async function listarComoNotificacoes(repo, { pedidoId, diaristaId, status } = {}) {
  return repo.leitura(null, async (tx) => {
    const execs = await tx.todos('execucoes');
    const msgs = await tx.todos('mensagens');
    const itens = execs.map((e) => {
      const ms = msgs.filter((m) => m.execucaoId === e.id).sort((a, b) => a.criadoEm.localeCompare(b.criadoEm));
      const ultima = ms.at(-1);
      const st = e.estado === 'agendada' || e.estado === 'enviando' ? 'pendente'
        : e.estado === 'enviada' ? (ultima?.estado === 'simulada' ? 'simulada' : 'enviada') : e.estado === 'falhou' ? 'erro' : e.estado;
      return {
        id: e.id, regra: e.regra, template: e.template || e.regra, gatilho: e.contexto?.eventoTipo, canal: ultima?.canal || null,
        // destino mascarado (listagem nunca mostra telefone ou e-mail inteiro)
        destinatario: { ...e.destinatario, telefone: !ultima ? '' : ultima.canal === 'whatsapp' ? mascararTelefone(ultima.destino) : ultima.canal === 'email' ? mascararEmail(ultima.destino) : 'painel' },
        agendadaPara: e.agendadaPara, status: st, estado: e.estado, motivo: e.motivo,
        refs: { pedidoId: e.contexto?.pedidoId, atendimentoId: e.contexto?.atendimentoId, diaristaId: e.contexto?.diaristaId, pagamentoId: e.contexto?.pagamentoId },
        previa: ultima?.conteudo || null, criadoEm: e.criadoEm,
        simuladaEm: ultima?.estado === 'simulada' || ultima?.estado === 'enviada' ? ultima.atualizadoEm : null,
      };
    });
    let out = itens;
    if (pedidoId) out = out.filter((n) => n.refs.pedidoId === pedidoId);
    if (diaristaId) out = out.filter((n) => n.refs.diaristaId === diaristaId || n.destinatario?.id === diaristaId);
    if (status) out = out.filter((n) => n.status === status);
    return { itens: out.sort((a, b) => `${a.agendadaPara}|${a.criadoEm}`.localeCompare(`${b.agendadaPara}|${b.criadoEm}`)) };
  });
}
