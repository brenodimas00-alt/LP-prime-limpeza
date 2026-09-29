// Unifica a conta da equipe (ex. a admin da cliente no e-mail com "+prime") na conta de cliente da mesma pessoa
// (e-mail normal), pela RPC conta_unificar (migration 20260930110000): a conta de cliente ganha o papel da equipe e a
// senha que a pessoa já usa no painel; a antiga fica bloqueada, com o histórico intacto. Nada é apagado; idempotente.
// Sem --aplicar só confere e mostra o que faria. O e-mail NÃO fica no repo (dado pessoal): vem do argumento.
// Uso: bash scripts/cli.sh node22 scripts/unifica-contas.mjs <email-de-cliente> [--origem <email-da-equipe>] [--aplicar]
//   sem --origem, procura a variação <nome>+prime@<domínio> do mesmo e-mail.
import { sql, fecharSql, conta } from './lib-supabase.mjs';

const args = process.argv.slice(2);
const aplicar = args.includes('--aplicar');
const iOrigem = args.indexOf('--origem');
const DESTINO = String(args.find((a, i) => a.includes('@') && (iOrigem < 0 || i !== iOrigem + 1)) || '').trim().toLowerCase();
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(DESTINO)) { console.error('Informe o e-mail da conta de cliente.'); process.exit(2); }
const ORIGEM = iOrigem > 0 ? String(args[iOrigem + 1]).trim().toLowerCase() : DESTINO.replace('@', '+prime@');

async function situacao(email) {
  const [r] = await sql(`select u.id, (u.raw_app_meta_data ->> 'troca_senha_obrigatoria') = 'true' troca, p.papeis, p.bloqueado, p.bloqueado_motivo,
      (select count(*)::int from public.clientes c where c.usuario_id = u.id) clientes,
      (select count(*)::int from public.diaristas d where d.usuario_id = u.id) diaristas,
      (select count(*)::int from public.pedidos pe join public.clientes c on c.id = pe.cliente_id where c.usuario_id = u.id) pedidos,
      (select count(*)::int from public.acessos a where a.user_id = u.id) acessos,
      (select count(*)::int from public.auditoria a where a.ator_user_id = u.id) auditoria
    from auth.users u join public.perfis p on p.user_id = u.id where lower(u.email) = $1`, [email]);
  return r || null;
}
const resumo = (r) => (r ? `papéis ${r.papeis.join('+')}${r.bloqueado ? ` (bloqueada: ${r.bloqueado_motivo})` : ''}; cadastro de cliente ${r.clientes}, profissional ${r.diaristas}, pedidos ${r.pedidos}, acessos ${r.acessos}, auditoria ${r.auditoria}` : 'não existe');

const o = await situacao(ORIGEM);
const d = await situacao(DESTINO);
console.log(`equipe (origem):   ${resumo(o)}`);
console.log(`cliente (destino): ${resumo(d)}`);
const problema = !o ? 'conta da equipe não encontrada'
  : !d ? 'conta de cliente não encontrada'
    : o.bloqueado_motivo === 'unificada em outra conta' ? null
      : !o.papeis.some((p) => p.startsWith('prime_')) ? 'a origem não é da equipe'
        : o.clientes || o.diaristas ? 'a origem tem cadastro próprio'
          : o.troca ? 'a origem ainda está com a senha temporária (entre no painel e crie a senha antes)'
            : d.bloqueado ? 'a conta de cliente está bloqueada' : null;
if (problema) { console.error(`ABORTADO: ${problema}. Nada foi alterado.`); await fecharSql(); process.exit(3); }
if (!aplicar) { console.log('\nSimulação: nada foi alterado. Rode de novo com --aplicar.'); await fecharSql(); process.exit(0); }

const [{ r }] = await sql('select public.conta_unificar($1, $2, true) r', [o.id, d.id]);
console.log(r.jaUnificada ? '\nJá estava unificada: nada mudou.' : `\nUnificada: a conta de cliente agora tem ${r.papeis.join(' + ')}.`);
const depois = await situacao(DESTINO);
const antiga = await situacao(ORIGEM);
console.log(`cliente (destino): ${resumo(depois)}`);
console.log(`equipe (origem):   ${resumo(antiga)}`);
// conferências sem precisar da senha dela: mesma senha no Auth, histórico da antiga intacto, pedidos da cliente intactos
const [{ igual }] = await sql('select (select encrypted_password from auth.users where id = $1) = (select encrypted_password from auth.users where id = $2) igual', [o.id, d.id]);
if (!igual) throw new Error('a senha não foi levada');
if (depois.pedidos !== d.pedidos || antiga.acessos < o.acessos || antiga.auditoria < o.auditoria) throw new Error('contagem mudou: conferir');
// a antiga não entra mais (senha qualquer: resposta de bloqueada ou de senha errada, nunca sessão)
const tent = await conta('entrar', { email: ORIGEM, senha: 'conferencia-sem-senha', area: 'prime' });
if (tent.status === 200) throw new Error('a conta antiga ainda entra');
console.log('Conferido: mesma senha na conta de cliente, pedidos e histórico intactos, conta antiga sem acesso.');
console.log('Ela entra pelo e-mail normal com a senha que já usava no painel; na entrada da cliente escolhe a área.');
await fecharSql();
