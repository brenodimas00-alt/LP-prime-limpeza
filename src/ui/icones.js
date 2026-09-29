// Ícones de linha no mesmo estilo dos da home (stroke 2, pontas arredondadas, currentColor). Markup constante.
// A home não tinha ícone de pessoa; este foi desenhado no mesmo traço (registrado em docs/DECISOES.md).
export const ICONE_PESSOA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/></svg>';
export const ICONE_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>';
// Agendamento v2: ícones de linha no padrão da home (24x24, traço 2, pontas arredondadas). Nada de emoji na interface.
const L = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const ICONE_CASA = L('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/><path d="M10 20v-5h4v5"/>');
export const ICONE_PREDIO = L('<path d="M4 21V4h11v17"/><path d="M15 9h5v12"/><path d="M8 8h3M8 12h3M8 16h3"/><path d="M2 21h20"/>');
export const ICONE_LAMPADA = L('<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>');
export const ICONE_MENOS = L('<path d="M5 12h14"/>');
export const ICONE_MAIS = L('<path d="M12 5v14M5 12h14"/>');
export const ICONE_ANTERIOR = L('<path d="m15 18-6-6 6-6"/>');
export const ICONE_PROXIMO = L('<path d="m9 18 6-6-6-6"/>');
export const ICONE_FECHAR = L('<path d="M18 6 6 18M6 6l12 12"/>');
