// Ícones do painel: os do conjunto único (src/ui/ds/icones.js, Lucide). Decorativos por padrão (o texto do lado dá o
// significado); com titulo viram imagem com nome acessível.
import { icone as iconeDs } from '../ds/icones.js';

export const icone = (nome, { pequeno = false, titulo } = {}) => iconeDs(nome, { tamanho: pequeno ? 16 : 20, rotulo: titulo });

/** Ícone de cada serviço (texto alternativo = nome do serviço). */
export const ICONE_SERVICO = { residencial: 'casa', empresarial: 'predio', condominial: 'predio', passadoria: 'ferro', pre_pos_mudanca: 'caixa', pre_pos_evento: 'festa', pos_obra: 'vassoura' };
