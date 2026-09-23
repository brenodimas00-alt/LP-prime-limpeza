// Validações de campo. Funções puras, sem DOM. Cada validador devolve '' (ok) ou a mensagem de erro.
import { dataValida, diferencaDias } from './calendario.js';

export const soDigitos = (s) => String(s ?? '').replace(/\D/g, '');

const DDDS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

export function validarTelefone(v) {
  const d = soDigitos(v);
  if (!d) return 'Informe o telefone com DDD';
  if (d.length !== 10 && d.length !== 11) return 'Telefone deve ter DDD + 8 ou 9 dígitos';
  if (!DDDS.has(Number(d.slice(0, 2)))) return 'DDD inválido';
  if (d.length === 11 && d[2] !== '9') return 'Celular deve começar com 9 depois do DDD';
  if (/^(\d)\1+$/.test(d.slice(2))) return 'Telefone inválido';
  return '';
}

export function mascaraTelefone(v) {
  const d = soDigitos(v).slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export function validarCPF(v) {
  const d = soDigitos(v);
  if (!d) return 'Informe o CPF';
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return 'CPF inválido';
  for (const n of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i);
    const dv = ((soma * 10) % 11) % 10;
    if (dv !== Number(d[n])) return 'CPF inválido (dígito verificador)';
  }
  return '';
}

export function mascaraCPF(v) {
  const d = soDigitos(v).slice(0, 11);
  return d.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
}

/** CNPJ normalizado: 14 caracteres, maiúsculas, sem pontuação. Aceita o formato alfanumérico (IN RFB 2.229/2024). */
export function normalizarCNPJ(v) {
  return String(v ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

function dvCNPJ(base) {
  const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let soma = 0;
  for (let i = 0; i < base.length; i++) soma += (base.charCodeAt(i) - 48) * pesos[i];
  const r = soma % 11;
  return r < 2 ? 0 : 11 - r;
}

/** Calcula os 2 dígitos verificadores pra uma base de 12 caracteres (útil pra fixtures). */
export function calcularDVCNPJ(base12) {
  const b = normalizarCNPJ(base12);
  const d1 = dvCNPJ(b);
  const d2 = dvCNPJ(b + d1);
  return `${d1}${d2}`;
}

export function validarCNPJ(v) {
  const c = normalizarCNPJ(v);
  if (!c) return 'Informe o CNPJ';
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(c)) return 'CNPJ deve ter 12 letras/números + 2 dígitos';
  if (/^(.)\1{13}$/.test(c)) return 'CNPJ inválido';
  if (calcularDVCNPJ(c.slice(0, 12)) !== c.slice(12)) return 'CNPJ inválido (dígito verificador)';
  return '';
}

export function mascaraCNPJ(v) {
  const c = normalizarCNPJ(v).slice(0, 14);
  let out = c.slice(0, 2);
  if (c.length > 2) out += '.' + c.slice(2, 5);
  if (c.length > 5) out += '.' + c.slice(5, 8);
  if (c.length > 8) out += '/' + c.slice(8, 12);
  if (c.length > 12) out += '-' + c.slice(12, 14);
  return out;
}

export function validarCEP(v) {
  const d = soDigitos(v);
  if (!d) return 'Informe o CEP';
  if (d.length !== 8 || d === '00000000') return 'CEP deve ter 8 dígitos';
  return '';
}

export const mascaraCEP = (v) => soDigitos(v).slice(0, 8).replace(/^(\d{5})(\d)/, '$1-$2');

export function validarEmail(v) {
  const s = String(v ?? '').trim();
  if (!s) return 'Informe o e-mail';
  if (s.length > 254 || !/^[^\s@<>()]+@[^\s@<>()]+\.[A-Za-z]{2,}$/.test(s)) return 'E-mail inválido';
  return '';
}

export function validarNome(v, rotulo = 'o nome') {
  const s = String(v ?? '').trim();
  if (!s) return `Informe ${rotulo}`;
  if (s.length < 3 || s.length > 120) return 'Use entre 3 e 120 caracteres';
  if (/[<>{}]/.test(s)) return 'Use só letras, números e pontuação comum';
  return '';
}

export function validarTextoObrigatorio(v, rotulo, max = 120) {
  const s = String(v ?? '').trim();
  if (!s) return `Informe ${rotulo}`;
  if (s.length > max) return `Máximo de ${max} caracteres`;
  if (/[<>{}]/.test(s)) return 'Use só letras, números e pontuação comum';
  return '';
}

export function validarTextoOpcional(v, max = 500) {
  const s = String(v ?? '');
  if (s.length > max) return `Máximo de ${max} caracteres`;
  return '';
}

/** Data 'AAAA-MM-DD' existente; opcionalmente não no passado em relação a `hoje`. */
export function validarData(v, { hoje, permitirPassado = true } = {}) {
  if (!v) return 'Informe a data';
  if (!dataValida(v)) return 'Data inválida';
  if (!permitirPassado && hoje && diferencaDias(hoje, v) < 0) return 'A data não pode estar no passado';
  return '';
}

export function validarDataNascimento(v, hoje) {
  const e = validarData(v);
  if (e) return e;
  const anos = Math.floor(diferencaDias(v, hoje) / 365.25);
  if (anos < 18) return 'É preciso ter 18 anos ou mais';
  if (anos > 90) return 'Confira o ano de nascimento';
  return '';
}

export const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

/** Valida um endereço inteiro. @returns {Object<string,string>} campo -> erro */
export function validarEndereco(e = {}) {
  const erros = {};
  const put = (k, m) => { if (m) erros[k] = m; };
  put('cep', validarCEP(e.cep));
  put('logradouro', validarTextoObrigatorio(e.logradouro, 'a rua'));
  put('numero', validarTextoObrigatorio(e.numero, 'o número', 10));
  put('complemento', validarTextoOpcional(e.complemento, 60));
  put('bairro', validarTextoObrigatorio(e.bairro, 'o bairro', 80));
  put('cidade', validarTextoObrigatorio(e.cidade, 'a cidade', 80));
  if (!UFS.includes(String(e.uf || '').toUpperCase())) erros.uf = 'UF inválida';
  return erros;
}

/** Valida os dados do cliente conforme o tipo. @returns {Object<string,string>} */
export function validarCliente(c = {}) {
  const erros = {};
  const put = (k, m) => { if (m) erros[k] = m; };
  if (!['residencial', 'empresa'].includes(c.tipo)) erros.tipo = 'Escolha residencial ou empresa';
  put('nome', validarNome(c.nome));
  put('telefone', validarTelefone(c.telefone));
  put('email', validarEmail(c.email));
  if (c.tipo === 'empresa') {
    put('cnpj', validarCNPJ(c.cnpj));
    put('razaoSocial', validarTextoObrigatorio(c.razaoSocial, 'a razão social'));
    put('responsavel', validarNome(c.responsavel, 'o responsável'));
  } else if (c.cpf) {
    put('cpf', validarCPF(c.cpf));
  }
  const end = validarEndereco(c.endereco);
  for (const [k, v] of Object.entries(end)) erros[`endereco.${k}`] = v;
  return erros;
}

// ---------- documentos da diarista ----------

export const LIMITE_ARQUIVO_BYTES = 5 * 1024 * 1024;
export const MIMES_ACEITOS = ['image/jpeg', 'image/png', 'application/pdf'];

/** Confere a assinatura dos primeiros bytes (não confiar só na extensão/mime do navegador). */
export function mimePelaAssinatura(bytes) {
  const b = Array.from(bytes || []).slice(0, 8);
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'application/pdf';
  return '';
}

/**
 * @param {{nome:string, mime:string, tamanho:number, cabecalho?:Uint8Array}} arq
 */
export function validarArquivo(arq) {
  if (!arq) return 'Selecione um arquivo';
  if (!MIMES_ACEITOS.includes(arq.mime)) return 'Formato não aceito: use JPG, PNG ou PDF';
  if (!Number.isFinite(arq.tamanho) || arq.tamanho <= 0) return 'Arquivo vazio';
  if (arq.tamanho > LIMITE_ARQUIVO_BYTES) return 'Arquivo maior que 5 MB';
  if (arq.cabecalho) {
    const real = mimePelaAssinatura(arq.cabecalho);
    if (real !== arq.mime) return 'O conteúdo do arquivo não confere com o formato';
  }
  if (/[<>:"/\\|?*\u0000-\u001f]/.test(arq.nome || '')) return 'Nome de arquivo inválido';
  return '';
}

export const ROTULOS_DOCUMENTO = {
  rg_frente: 'RG (frente)', rg_verso: 'RG (verso)', cnh_frente: 'CNH (frente)', cnh_verso: 'CNH (verso)', cpf: 'CPF',
  comprovante_residencia: 'Comprovante de residência', foto_perfil: 'Foto de perfil', antecedentes: 'Certidão de antecedentes criminais',
};

/**
 * Regra: RG frente e verso + CPF, OU CNH frente e verso (CNH dispensa CPF); mais comprovante, foto e antecedentes.
 * @param {string[]} tipos tipos presentes
 * @param {'rg'|'cnh'} identidade escolha feita na tela
 * @returns {string[]} tipos faltando
 */
export function documentosFaltando(tipos, identidade) {
  const t = new Set(tipos);
  const exigidos = identidade === 'cnh' ? ['cnh_frente', 'cnh_verso'] : ['rg_frente', 'rg_verso', 'cpf'];
  exigidos.push('comprovante_residencia', 'foto_perfil', 'antecedentes');
  return exigidos.filter((x) => !t.has(x));
}

/** Valida dados da diarista (sem documentos). @returns {Object<string,string>} */
export function validarDiarista(d = {}, hoje) {
  const erros = {};
  const put = (k, m) => { if (m) erros[k] = m; };
  put('nome', validarNome(d.nome));
  put('cpf', validarCPF(d.cpf));
  put('telefone', validarTelefone(d.telefone));
  put('email', validarEmail(d.email));
  put('dataNascimento', validarDataNascimento(d.dataNascimento, hoje));
  const end = validarEndereco(d.endereco);
  for (const [k, v] of Object.entries(end)) erros[`endereco.${k}`] = v;
  if (!Number.isInteger(d.experienciaAnos) || d.experienciaAnos < 0 || d.experienciaAnos > 60) erros.experienciaAnos = 'Informe os anos de experiência (0 a 60)';
  const disp = d.disponibilidade || {};
  if (!Array.isArray(disp.dias) || !disp.dias.length || disp.dias.some((x) => !Number.isInteger(x) || x < 0 || x > 6)) erros['disponibilidade.dias'] = 'Marque pelo menos um dia';
  if (!Array.isArray(disp.turnos) || !disp.turnos.length || disp.turnos.some((x) => !['manha', 'tarde', 'integral'].includes(x))) erros['disponibilidade.turnos'] = 'Marque pelo menos um turno';
  if (!Array.isArray(disp.regioes) || !disp.regioes.length) erros['disponibilidade.regioes'] = 'Marque pelo menos uma região';
  return erros;
}

/** URL segura pra abrir: só https (ou http local) e só hosts permitidos. */
export function urlPermitida(u, hostsPermitidos) {
  try {
    const x = new URL(u);
    if (x.protocol !== 'https:') return false;
    return hostsPermitidos.includes(x.hostname);
  } catch { return false; }
}
