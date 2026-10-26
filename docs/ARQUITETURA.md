# Arquitetura

Site estático em JavaScript puro (ES modules, sem bundler e sem framework), publicado no Cloudflare Pages, com backend no Supabase (Postgres com RPCs e RLS, Auth, Storage e Edge Functions).

## Pastas
- `index.html`, `autoagendamento/`, `entrar/`, `minha-conta/`, `acompanhamento/`, `pagamento/`, `avaliacao/`, `diarista/`, `painel/`, `condicoes/`, `privacidade/`, `termos/`: uma página por pasta, cada uma carrega o seu módulo de `src/ui`.
- `src/domain/`: regras puras, sem DOM e sem rede. Preço e duração do agendamento (`agendamento-v3.js`), pacote e desconto (`pacote.js`), agenda e horários (`agenda.js`, `horario.js`, `calendario.js`), estados e transições (`estados.js`), dinheiro, validação, Pix (`brcode.js`), PDF do recibo.
- `src/config/`: dados que a Prime muda sem código. Preços (`precos.js`, que lê a tabela vigente do banco), textos do agendamento (`agendamento-v3.js`), dados da empresa (`prime.js`, `seo.js`) e versão dos textos legais (`legal.js`).
- `src/services/`: `api.js` é a interface única da tela e escolhe o adapter. Em `adapters/`: `mock.js` (demonstração e testes, IndexedDB), `supabase.js` (RPC por caso de uso) e `http.js` (contrato com a API falsa dos testes). Também `auth.js` (login e papéis) e `sessao.js`.
- `src/app/`: casos de uso do modo mock (mesmas regras do banco), repositórios em memória e IndexedDB.
- `src/automacoes/`: catálogo das mensagens automáticas (dado) e o motor usado no mock; `email-html.js` e `payloadMeta.js` são usados pelas Edge Functions.
- `src/ui/`: telas.
  - `ds/`: design system, com `tokens.css` como único arquivo com valores, a biblioteca `componentes.css`, os ícones Lucide e a página viva em `/_dev/design-system/`.
  - `painel2/`: painel novo. As seções antigas que ele ainda reaproveita estão em `paginas/painel-*.js`.
  - `paginas/agendamento-v3/`: o fluxo de agendamento.
- `supabase/migrations/` (62 arquivos): tabelas, RLS e RPCs `security definer`. O banco decide preço, permissão, transição e idempotência.
- `supabase/functions/`: `conta` (cadastro e login), `documentos` (upload das profissionais), `notificacoes` (fila de WhatsApp e e-mail, simulada fora de produção) e `whatsapp-webhook`.
- `scripts/`: testes (`testa-*`), geradores (`gera-*`), deploy (`deploy-preview.sh`, `monta-dist.mjs`), go-live (`go-live/`) e ferramentas de design (`design/`).

## Fluxo de dados
1. A tela chama `api.algumaCoisa(args, { chave })`. `api.js` acrescenta a sessão e repassa ao adapter.
2. No Supabase, cada caso de uso é uma RPC. O SQL confere o papel, recalcula o preço e grava. Erro volta como código (`docs/API.md`) e o adapter traduz para `ErroNegocio`.
3. Ações da equipe passam por `executarAcao` (`src/ui/acoes.js`): chave de idempotência, botão ocupado, toast e redirecionamento quando a sessão vence.
4. Mensagens: o banco enfileira e a Edge Function `notificacoes` envia. O provedor só é real quando o ref do projeto está em `PRODUCAO_REFS` (hoje vazio).

## Onde fica cada regra
- Preço, duração, taxas e descontos: `src/domain/agendamento-v3.js` e `pacote.js` (pra mostrar), e o SQL das migrations `*agendamento_v3*` (pra cobrar). A paridade é conferida por `testa-paridade` e `testa-paridade-v3`.
- Horários e dias permitidos: `src/domain/agenda.js` e `agendamento-v3.js`. Os feriados e as faixas de CEP ficam no banco, editáveis no painel.
- Estados do pedido, da diária e do pagamento: `src/domain/estados.js`, espelhado nas RPCs.
- Permissão: RLS e checagem de papel dentro de cada RPC (`privado.exigir_admin` e afins).

## Testes
`cd ~/projetos/LP-prime-limpeza && node scripts/roda-testes.mjs --rapido` (só Node, segundos). `--entrega` acrescenta o navegador no mock e o banco de homologação, em fila. `--completo` acrescenta o preview publicado e o Lighthouse. Para rodar alguns: `--so a,b`. Os testes de banco usam só dados fictícios (`teste-*@example.com`).

## Publicar
- Preview da branch: `cd ~/projetos/LP-prime-limpeza && bash scripts/deploy-preview.sh`. Gera `src/config/ambiente.js` só dentro do `dist/`, varre segredos e publica no alias da branch.
- Demonstração fictícia: `AUTH=mock DADOS=mock SEED_DEMO=painel node scripts/monta-dist.mjs` e depois `wrangler pages deploy`.
- Produção: passos em `docs/GO-LIVE.md` (scripts em `scripts/go-live/`, com trava `GO_LIVE=sim`).
