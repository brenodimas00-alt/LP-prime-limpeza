// P3: recibo de pagamento (não é nota fiscal). PURO: dados do banco (obter_recibo) + empresa -> linhas do PDF.
// Campo da empresa ainda PREENCHER sai como "a preencher" (não inventa dado).
import { formatarBRL } from './dinheiro.js';
import { dataNoFuso, formatarData } from './calendario.js';

const METODO = { pix: 'PIX', manual: 'PIX, transferência ou depósito (conferido pela Prime)', cartao: 'Cartão' };
const ou = (v) => (!v || v === 'PREENCHER' ? 'a preencher' : v);
function documento(tipo, d) {
  const x = String(d || '').replace(/\D/g, '');
  if (tipo === 'cnpj' && x.length === 14) return `CNPJ ${x.slice(0, 2)}.${x.slice(2, 5)}.${x.slice(5, 8)}/${x.slice(8, 12)}-${x.slice(12)}`;
  if (x.length === 11) return `CPF ${x.slice(0, 3)}.${x.slice(3, 6)}.${x.slice(6, 9)}-${x.slice(9)}`;
  return d ? String(d) : '';
}
const extenso = (n) => String(n).padStart(6, '0');

export function linhasRecibo(r, empresa, fuso = 'America/Sao_Paulo') {
  const quando = r.confirmadoEm ? formatarData(dataNoFuso(r.confirmadoEm, fuso)) : '';
  const pagador = r.razaoSocial ? `${r.razaoSocial} (${r.pagador})` : r.pagador;
  const l = [
    { texto: 'Prime Limpeza Especializada', tamanho: 18, negrito: true },
    { texto: `Razão social: ${ou(empresa.razaoSocial)} · CNPJ: ${ou(empresa.cnpj)}`, tamanho: 9, cor: [0.35, 0.33, 0.45] },
    { texto: `${ou(empresa.endereco?.rua)}, ${ou(empresa.endereco?.bairro)}, ${empresa.endereco?.cidade || ''}/${empresa.endereco?.uf || ''}`, tamanho: 9, cor: [0.35, 0.33, 0.45], linha: true },
    { texto: `RECIBO Nº ${extenso(r.numero)}`, tamanho: 15, negrito: true, espaco: 18 },
    { texto: `Recebemos de ${pagador}${r.documento ? `, ${documento(r.tipoDocumento, r.documento)}` : ''}, a quantia de ${formatarBRL(r.valorCentavos)}, referente a: ${r.referente}.`, espaco: 12 },
    { texto: `Forma de pagamento: ${METODO[r.metodo] || r.metodo || ''}`, espaco: 10 },
    { texto: `Pagamento confirmado em ${quando}.` },
    { texto: `Pedido: ${String(r.pedidoId || '').slice(0, 8)}`, tamanho: 9, cor: [0.35, 0.33, 0.45] },
  ];
  if (r.situacao === 'estornado') l.push({ texto: `Pagamento ESTORNADO${r.estorno?.motivo ? `: ${r.estorno.motivo}` : ''}. Este recibo perdeu o efeito.`, negrito: true, cor: [0.6, 0.1, 0.1], espaco: 14 });
  l.push({ texto: `Belo Horizonte, ${quando}.`, espaco: 28 });
  l.push({ texto: 'Este recibo não substitui a nota fiscal.', tamanho: 9, cor: [0.35, 0.33, 0.45], espaco: 24 });
  return l;
}
