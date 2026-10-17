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
  // AUT (motor v2): execuções das regras, mensagens por canal e reserva do limite diário
  execucoes: { chave: 'id', indices: ['estado', 'chave'] },
  mensagens: { chave: 'id', indices: ['execucaoId'] },
  limites: { chave: 'chave', indices: [] },
  idempotencia: { chave: 'chave', indices: [] },
  credenciais: { chave: 'email', indices: ['refId'] }, // SÓ MOCK: e-mail -> hash da senha (o Supabase Auth substitui)
  // agendamento v3: endereços da cliente, ticket do cadastro antecipado, cupons, condições comerciais, faturamento, aceite
  enderecos: { chave: 'id', indices: ['clienteId'] },
  tickets: { chave: 'hash', indices: [] },
  cupons: { chave: 'codigo', indices: [] },
  cuponsUso: { chave: 'pedidoId', indices: ['cupomCodigo'] },
  condicoesComerciais: { chave: 'id', indices: ['clienteId'] },
  faturamento: { chave: 'clienteId', indices: [] },
  aceitesSolicitacao: { chave: 'pedidoId', indices: [] },
};
export const NOMES_STORES = Object.keys(STORES);
