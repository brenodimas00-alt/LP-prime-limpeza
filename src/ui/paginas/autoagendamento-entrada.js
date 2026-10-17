// Entrada do autoagendamento. Durante a construção do v3 (spec-agendamento-v3, entregas V2 a V4) o fluxo novo fica atrás
// de ?v3=1 e o v2 continua no ar; na entrega V5 o v3 vira o padrão e o v2 sai.
const v3 = new URLSearchParams(location.search).has('v3');
if (v3) await (await import('./agendamento-v3/index.js')).iniciar();
else await import('./autoagendamento.js');
