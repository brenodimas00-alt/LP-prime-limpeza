// Entrada do autoagendamento: o fluxo v3 (spec-agendamento-v3, 56 itens da cliente). O v2 saiu na entrega V5.
await (await import('./agendamento-v3/index.js')).iniciar();
