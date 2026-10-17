// Ícones do painel (traço fino, 24x24). Markup constante do código, nunca dado externo.
import { svg } from '../dom.js';

const P = {
  inicio: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  solicitacoes: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
  agenda: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  clientes: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.5-6.5 8-6.5s8 2.5 8 6.5"/>',
  profissionais: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.2c3 .2 5.5 2 5.5 5.3"/>',
  financeiro: '<circle cx="12" cy="12" r="9"/><path d="M12 7v10M14.5 9.5c0-1-1.1-1.5-2.5-1.5s-2.5.6-2.5 1.6c0 2.4 5 1.4 5 3.9 0 1-1.1 1.6-2.5 1.6s-2.5-.6-2.5-1.6"/>',
  gestao: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  config: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>',
  ajuda: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7"/><path d="M12 17h.01"/>',
  mais: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  busca: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  sino: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  fechar: '<path d="M6 6l12 12M18 6 6 18"/>',
  relogio: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  alerta: '<path d="M12 3 2.5 20h19L12 3z"/><path d="M12 10v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  seta: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  voltar: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  abaixo: '<path d="m6 9 6 6 6-6"/>',
  acima: '<path d="m6 15 6-6 6 6"/>',
  direita: '<path d="m9 6 6 6-6 6"/>',
  zap: '<path d="M4 20l1.5-4A8 8 0 1 1 8.5 19L4 20z"/><path d="M9.5 9.5c.5 2 2 3.5 4 4l1-1 2 1-.5 1.5c-3 .5-7-3.5-6.5-6.5L11 8l1 2z"/>',
  enviar: '<path d="M21 3 10 14"/><path d="M21 3 14 21l-4-7-7-4z"/>',
  baixar: '<path d="M12 4v11M7 10l5 5 5-5"/><path d="M4 19h16"/>',
  local: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  casa: '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/>',
  predio: '<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M11 21v-3h2v3"/>',
  ferro: '<path d="M3 17h15a3 3 0 0 0 3-3V9H9a6 6 0 0 0-6 6z"/><path d="M9 9V6h9"/>',
  caixa: '<path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  festa: '<path d="M4 20 9 7l8 8z"/><path d="M14 4l.5 2M19 5l-2 1.5M20 10l-2-.3"/>',
  vassoura: '<path d="M14 3l-4 9"/><path d="M6 13h8l2 8H4z"/>',
  estrela: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  usuario_mais: '<circle cx="10" cy="8" r="4"/><path d="M3 21c0-4 3-6.5 7-6.5 1.6 0 3 .4 4.2 1.1"/><path d="M18 14v6M15 17h6"/>',
  dinheiro_mao: '<path d="M3 14h4l5 2h5a2 2 0 0 0 0-4h-4"/><path d="M3 20h4l9-1 5-3"/><circle cx="16" cy="6" r="3"/>',
  carro: '<path d="M3 17h2l2-5h10l2 5h2"/><circle cx="7.5" cy="18" r="1.6"/><circle cx="16.5" cy="18" r="1.6"/><path d="M7 12l1.5-4h7L17 12"/>',
  documento: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  troca: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
  robo: '<rect x="5" y="8" width="14" height="11" rx="2"/><path d="M12 4v4M9 13h.01M15 13h.01M9.5 16h5"/>',
  calendario_x: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M10 14l4 4M14 14l-4 4"/>',
  meta: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  rosca: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/>',
  mapa: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
  sair: '<path d="M14 4h5v16h-5"/><path d="M10 12h10M6 8l-4 4 4 4"/>',
  ponto: '<circle cx="12" cy="12" r="3"/>',
  publicar: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 20h16"/>',
};

/** Ícone por nome (decorativo: aria-hidden; o texto do lado dá o significado). */
export function icone(nome, { pequeno = false, titulo } = {}) {
  const corpo = P[nome] || P.ponto;
  const s = svg(`<svg class="p-ic${pequeno ? ' p-pq' : ''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${corpo}</svg>`);
  if (titulo) { s.removeAttribute('aria-hidden'); s.setAttribute('role', 'img'); s.setAttribute('aria-label', titulo); }
  return s;
}

/** Ícone de cada serviço (texto alternativo = nome do serviço). */
export const ICONE_SERVICO = { residencial: 'casa', empresarial: 'predio', condominial: 'predio', passadoria: 'ferro', pre_pos_mudanca: 'caixa', pre_pos_evento: 'festa', pos_obra: 'vassoura' };
