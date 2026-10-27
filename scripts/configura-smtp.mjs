// Pré-lançamento (27/10/2026): liga o SMTP próprio do Auth ("esqueci a senha", troca de e-mail) só com variáveis, sem
// mexer em código: lê SMTP_* do arquivo de ambiente e aplica pela API de gestão do Supabase (PATCH /config/auth).
// Padrão é CONFERÊNCIA: diz o que aplicaria (nomes e formato, nunca a senha) e sai. Pra aplicar: --aplicar.
// Variáveis (no ~/.prime-env de produção): SMTP_HOST, SMTP_PORTA (465 ou 587), SMTP_USUARIO, SMTP_SENHA,
// SMTP_REMETENTE (e-mail do domínio verificado no provedor), SMTP_NOME (ex.: Prime Limpeza Especializada).
// Precisa do token da API de gestão (~/.supabase/access-token, o mesmo do CLI).
// Uso: cd ~/projetos/LP-prime-limpeza && node scripts/configura-smtp.mjs [--env <arquivo>] [--aplicar]
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { lerPrimeEnv } from './gera-ambiente.mjs';
import { HOMOLOG_REFS } from '../supabase/functions/_shared/provedores.js';

const i = process.argv.indexOf('--env');
const env = lerPrimeEnv(i > 0 ? process.argv[i + 1] : undefined);
const APLICAR = process.argv.includes('--aplicar');
const ref = (env.SUPABASE_URL || '').match(/^https:\/\/([a-z0-9]{20})\.supabase\.co$/)?.[1];
const problemas = [];
if (!ref) problemas.push('SUPABASE_URL ausente ou inválida');
const porta = Number(env.SMTP_PORTA);
if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(env.SMTP_HOST || '')) problemas.push('SMTP_HOST ausente ou inválido');
if (![465, 587].includes(porta)) problemas.push('SMTP_PORTA deve ser 465 ou 587');
if (!env.SMTP_USUARIO) problemas.push('SMTP_USUARIO ausente');
if (!env.SMTP_SENHA) problemas.push('SMTP_SENHA ausente');
if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(env.SMTP_REMETENTE || '')) problemas.push('SMTP_REMETENTE ausente ou não é e-mail');
if (!env.SMTP_NOME) problemas.push('SMTP_NOME ausente');
console.log(`projeto ${ref || '?'}${HOMOLOG_REFS.includes(ref) ? ' (homologação)' : ''}: host ${env.SMTP_HOST || '-'}, porta ${porta || '-'}, usuário ${env.SMTP_USUARIO ? 'definido' : '-'}, senha ${env.SMTP_SENHA ? 'definida' : '-'}, remetente ${env.SMTP_REMETENTE || '-'}, nome ${env.SMTP_NOME || '-'}`);
if (problemas.length) { console.log(`não aplicável: ${problemas.join('; ')}`); process.exit(1); }
if (!APLICAR) { console.log('conferência ok. Pra aplicar no projeto: node scripts/configura-smtp.mjs --aplicar (depois: node scripts/confere-config.mjs)'); process.exit(0); }

const tokenArq = `${homedir()}/.supabase/access-token`;
if (!existsSync(tokenArq)) { console.error('sem ~/.supabase/access-token (rode o login do CLI do Supabase)'); process.exit(2); }
const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
  method: 'PATCH', headers: { Authorization: `Bearer ${readFileSync(tokenArq, 'utf8').trim()}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ smtp_host: env.SMTP_HOST, smtp_port: String(porta), smtp_user: env.SMTP_USUARIO, smtp_pass: env.SMTP_SENHA, smtp_admin_email: env.SMTP_REMETENTE, smtp_sender_name: env.SMTP_NOME }),
});
console.log(r.ok ? 'SMTP aplicado no Auth do projeto. Confira: node scripts/confere-config.mjs' : `a API recusou (HTTP ${r.status})`);
process.exit(r.ok ? 0 : 1);
