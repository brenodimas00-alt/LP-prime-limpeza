// CSV pro Excel em português (P5 repasse e P6 exportações). PURO.
// Separador ";", UTF-8 com BOM (acentos certos ao abrir com dois cliques), linhas CRLF, data dd/mm/aaaa, dinheiro com
// vírgula e sem separador de milhar ("1234,56"). Campo com ; " quebra de linha é citado. Texto que começa com = + - @
// ganha um apóstrofo na frente: o Excel não executa fórmula vinda do banco (injeção de CSV).

const PERIGOSO = /^[=+\-@\t\r]/;
function celula(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (PERIGOSO.test(s)) s = `'${s}`;
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function dataBR(iso) {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}
export const dinheiroBR = (centavos) => (centavos === null || centavos === undefined ? '' : `${centavos < 0 ? '-' : ''}${Math.floor(Math.abs(centavos) / 100)},${String(Math.abs(centavos) % 100).padStart(2, '0')}`);
export const numeroBR = (n) => (n === null || n === undefined ? '' : String(n).replace('.', ','));

/**
 * @param {{titulo:string, campo:string, tipo?:'texto'|'data'|'dinheiro'|'numero'}[]} colunas
 * @param {object[]} linhas
 */
export function gerarCsv(colunas, linhas) {
  const fmt = { data: dataBR, dinheiro: dinheiroBR, numero: numeroBR, texto: (x) => x };
  const corpo = [colunas.map((c) => celula(c.titulo)).join(';'),
    ...linhas.map((l) => colunas.map((c) => celula((fmt[c.tipo || 'texto'])(l[c.campo]))).join(';'))];
  return `﻿${corpo.join('\r\n')}\r\n`;
}

/** Baixa o CSV no navegador. */
export function baixarCsv(nome, conteudo) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([conteudo], { type: 'text/csv;charset=utf-8' }));
  a.download = nome; a.hidden = true;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
