// Gera o HTML "casca" das páginas internas (cabeçalho, CSS e o módulo da página). Rodar após mudar o molde:
// node scripts/gera-paginas.mjs   (idempotente; não mexe no index.html da home)
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const PAGINAS = [
  { arq: 'autoagendamento/index.html', titulo: 'Agendar diária', modulo: 'autoagendamento.js', descricao: 'Agende sua diária com a Prime Limpeza Especializada em poucos passos.' },
  { arq: 'pagamento/index.html', titulo: 'Pagamento Pix', modulo: 'pagamento.js', noindex: true },
  { arq: 'acompanhamento/index.html', titulo: 'Acompanhamento', modulo: 'acompanhamento.js', noindex: true },
  { arq: 'avaliacao/index.html', titulo: 'Avaliar diária', modulo: 'avaliacao.js', noindex: true },
  { arq: 'diarista/cadastro/index.html', titulo: 'Cadastro de diarista', modulo: 'cadastro-diarista.js', descricao: 'Cadastre-se como diarista na Prime Limpeza Especializada.' },
  { arq: 'diarista/antecedentes/index.html', titulo: 'Certidão de antecedentes', modulo: 'antecedentes.js', descricao: 'Como emitir a certidão de antecedentes criminais em Minas Gerais e na Polícia Federal.' },
  { arq: 'entrar/index.html', titulo: 'Entrar', modulo: 'entrar.js', noindex: true },
  { arq: 'minha-conta/index.html', titulo: 'Minha conta', modulo: 'minha-conta.js', noindex: true },
  { arq: 'diarista/entrar/index.html', titulo: 'Entrar (diarista)', modulo: 'entrar-diarista.js', noindex: true },
  { arq: 'diarista/agenda/index.html', titulo: 'Minha agenda', modulo: 'agenda-diarista.js', noindex: true },
  { arq: 'painel/entrar/index.html', titulo: 'Entrar (Prime)', modulo: 'entrar-painel.js', noindex: true },
  { arq: 'painel/index.html', titulo: 'Painel da Prime', modulo: 'painel.js', noindex: true },
];

for (const p of PAGINAS) {
  const nivel = p.arq.split('/').length - 1;
  const r = '../'.repeat(nivel);
  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<script>if (!location.pathname.endsWith('/') && !/\.[a-z0-9]+$/i.test(location.pathname)) location.replace(location.pathname + '/' + location.search + location.hash);</script>
<title>${p.titulo} | Prime Limpeza Especializada</title>
${p.descricao ? `<meta name="description" content="${p.descricao}">\n` : ''}${p.noindex ? '<meta name="robots" content="noindex">\n' : ''}<meta name="theme-color" content="#2a2456">
<link rel="icon" href="${r}assets/logo.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${r}src/ui/tokens.css">
<link rel="stylesheet" href="${r}src/ui/base.css">
<link rel="stylesheet" href="${r}src/ui/paginas.css">
<script type="module" src="${r}src/ui/paginas/${p.modulo}"></script>
</head>
<body>
<noscript><p style="padding:24px">Esta página precisa de JavaScript. Se preferir, fale com a Prime pelo WhatsApp (31) 97236-3590.</p></noscript>
</body>
</html>
`;
  mkdirSync(dirname(p.arq), { recursive: true });
  writeFileSync(p.arq, html);
  console.log('gerado', p.arq);
}
