// BR Code estático do Pix (padrão EMV MPM do Banco Central). Função pura.
import { ErroNegocio } from './modelo.js';
import { centavosParaDecimal } from './dinheiro.js';

function campo(id, valor) {
  const v = String(valor);
  if (v.length > 99) throw new ErroNegocio('DADOS_INVALIDOS', `Campo ${id} passa de 99 caracteres`);
  return id + String(v.length).padStart(2, '0') + v;
}

/** CRC16-CCITT-FALSE (poly 0x1021, init 0xFFFF), 4 hex maiúsculos. */
export function crc16(texto) {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(texto)) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Remove acento e caracteres fora do conjunto aceito pelos bancos; corta no limite. */
export function normalizarTextoPix(s, max) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9 .\-]/g, '').replace(/\s+/g, ' ').trim().toUpperCase().slice(0, max);
}

export const RE_TXID = /^[A-Za-z0-9]{1,25}$/;

/** Gera txid alfanumérico de até 25 caracteres a partir de bytes aleatórios fornecidos (pureza: o app passa o aleatório). */
export function txidDeBytes(bytes, tamanho = 25) {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < tamanho; i++) s += A[bytes[i % bytes.length] % A.length];
  return s;
}

/**
 * Monta o "copia e cola".
 * @param {{chave:string, nome:string, cidade:string, valorCentavos:number, txid:string}} p
 */
export function montarBRCode({ chave, nome, cidade, valorCentavos, txid }) {
  if (!chave || !nome || !cidade) throw new ErroNegocio('CONFIG_INCOMPLETA', 'Pix exige chave, nome e cidade do recebedor');
  if (!RE_TXID.test(txid || '')) throw new ErroNegocio('DADOS_INVALIDOS', 'txid deve ter 1 a 25 caracteres alfanuméricos');
  if (!Number.isSafeInteger(valorCentavos) || valorCentavos <= 0) throw new ErroNegocio('DADOS_INVALIDOS', 'Valor do Pix inválido');
  const nomeN = normalizarTextoPix(nome, 25);
  const cidadeN = normalizarTextoPix(cidade, 15);
  if (!nomeN || !cidadeN) throw new ErroNegocio('CONFIG_INCOMPLETA', 'Nome ou cidade do recebedor inválidos');
  const conta = campo('00', 'br.gov.bcb.pix') + campo('01', String(chave).trim());
  const semCrc =
    campo('00', '01') +
    campo('26', conta) +
    campo('52', '0000') +
    campo('53', '986') +
    campo('54', centavosParaDecimal(valorCentavos)) +
    campo('58', 'BR') +
    campo('59', nomeN) +
    campo('60', cidadeN) +
    campo('62', campo('05', txid)) +
    '6304';
  return semCrc + crc16(semCrc);
}

/** Lê os campos TLV de primeiro nível (usado nos testes e na tela de dev). */
export function lerTLV(s) {
  const out = {};
  let i = 0;
  while (i < s.length) {
    const id = s.slice(i, i + 2);
    const n = Number(s.slice(i + 2, i + 4));
    out[id] = s.slice(i + 4, i + 4 + n);
    i += 4 + n;
  }
  return out;
}
