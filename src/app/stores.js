// Stores (tabelas) do mock e seus índices. O backend terá as mesmas tabelas (ver docs/BACKEND.md).
export const STORES = {
  clientes: { chave: 'id', indices: [] },
  pedidos: { chave: 'id', indices: ['clienteId'] },
  atendimentos: { chave: 'id', indices: ['pedidoId', 'diaristaId'] },
  pagamentos: { chave: 'id', indices: ['pedidoId', 'atendimentoId'] },
  diaristas: { chave: 'id', indices: ['status'] },
  documentos: { chave: 'id', indices: ['diaristaId'] },
  arquivos: { chave: 'id', indices: [] }, // blobs dos documentos (mock)
  avaliacoes: { chave: 'id', indices: ['atendimentoId'] },
  notificacoes: { chave: 'id', indices: ['status', 'chaveIdempotencia'] },
  eventos: { chave: 'id', indices: ['status'] },
  idempotencia: { chave: 'chave', indices: [] },
  credenciais: { chave: 'email', indices: ['refId'] }, // SÓ MOCK: e-mail -> hash da senha (o Supabase Auth substitui)
};
export const NOMES_STORES = Object.keys(STORES);
