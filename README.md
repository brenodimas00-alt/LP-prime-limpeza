# Prime Limpeza Especializada

Site da Prime (Belo Horizonte): home aprovada + plataforma de contratação de diaristas com dois lados, cliente e diarista. HTML, CSS e JS puros com módulos ES, sem framework e sem build. Publicado no GitHub Pages em `https://brenodimas00-alt.github.io/LP-prime-limpeza/`.

**Fase atual: site estático com backend simulado (mock).** Cadastros, pedidos e documentos ficam só no navegador (IndexedDB e localStorage): **nada chega à Prime e outro aparelho não vê os dados.** A fase 2 (backend real) está descrita em `docs/BACKEND.md`.

## Rodar local

```bash
cd ~/projetos/LP-prime-limpeza
node scripts/serve.mjs            # http://localhost:8080/LP-prime-limpeza/ (mesmo base path do Pages)
```

Sem dependência pra rodar o site. As dependências do `package.json` são só de teste (Playwright, Lighthouse, jsqr):

```bash
cd ~/projetos/LP-prime-limpeza
npm install
npx playwright install chromium
node scripts/roda-testes.mjs --rapido   # só os testes de Node (domínio, contrato http, automações, WhatsApp)
node scripts/roda-testes.mjs            # tudo, inclusive navegador e Lighthouse (uns 10 minutos)
```

No WSL/Ubuntu sem sudo, o Chromium do Playwright precisa de `libnspr4`, `libnss3` e `libasound2`. Elas foram extraídas com `apt-get download` + `dpkg -x` em `~/.cache/pw-libs/root/usr/lib/x86_64-linux-gnu`; `scripts/roda-testes.mjs` já põe esse caminho no `LD_LIBRARY_PATH`. Pra rodar um script isolado: `LD_LIBRARY_PATH=~/.cache/pw-libs/root/usr/lib/x86_64-linux-gnu node scripts/testa-e3-navegador.mjs`.

## Estrutura

```
index.html                 home aprovada (CSS em src/ui/tokens.css, base.css e home.css)
autoagendamento/ pagamento/ acompanhamento/ avaliacao/     fluxo da cliente
entrar/ minha-conta/                                       área da cliente
diarista/cadastro/ diarista/antecedentes/ diarista/entrar/ diarista/agenda/   lado da diarista
painel/entrar/ painel/                                     área da Prime
404.html  _dev/servicos.html (ferramenta de dev, só com ?dev=1)
src/config/    app.js (adapter, base path), prime.js (dados da Prime), prime.teste.js, precos.js (tabela oficial), conteudo.js
src/domain/    funções puras: modelo, estados, dinheiro, calendário, pacote, brcode, qrcode, validação, configuração
src/app/       casos de uso + repositórios (IndexedDB e memória) com transação e idempotência
src/services/  api.js (interface), adapters/{mock,http}.js, auth.js, sessao.js, cep.js, whatsapp.js
src/automacoes/ gatilhos.js, mensagens.js, motor.js, relogio.js, payloadMeta.js
src/ui/        layout, formulários, upload, páginas
scripts/       testes (.mjs), fake-api.mjs, fixtures/, gera-paginas.mjs, verifica-*.mjs
docs/          API.md, BACKEND.md, WHATSAPP.md, DECISOES.md, PENDENCIAS.md, shots/
```

## Trocar o adapter (mock → http)

Em `src/config/app.js`:

```js
export const ADAPTER = 'http';                       // era 'mock'
export const API_BASE_URL = 'https://api.primelimpezaespecializada.com.br';
```

O front passa a mandar só os comandos de negócio de `docs/API.md`. Isso cobre os dados; o login precisa do adapter `supabase` de `src/services/auth.js` implementado (fase 2, ver `docs/BACKEND.md`). Pra testar o contrato sem backend: `node scripts/fake-api.mjs` (porta 8787) e `API_BASE_URL = 'http://localhost:8787/api'`. Em `localhost` o adapter manda o cabeçalho `X-Ator-Teste` (só o fake-api aceita).

## Preencher antes de publicar

**`src/config/prime.js`** (hoje tudo `PREENCHER`):
- `pix.chave`, `pix.nomeRecebedor` (até 25 caracteres), `pix.cidadeRecebedor` (até 15). Sem os três, a tela de Pix mostra aviso e não gera cobrança.
- `whatsapp` no formato `5531...`. Sem ele, os botões "Falar com a Prime no WhatsApp" somem.
- `email` e `endereco` (opcionais).

**`src/config/precos.js`**: já está com a tabela oficial da cliente (23/09/2026). Conferir todo ano a lista `feriados` e as pendências de `docs/PENDENCIAS.md` (`prazoRestante`, `cobrancaRestante`, limite de horas extras).

Com `?dev=1` na URL o site usa `src/config/prime.teste.js` (config fictícia completa) e liga as ferramentas de demonstração.

## Modo demonstração (mock): credenciais

Tudo fictício, guardado só no navegador. Nada chega à Prime.

| Área | Endereço | Credencial |
|---|---|---|
| Cliente | `entrar/` | WhatsApp `(31) 98888-7777`, código `123456` (com `?dev=1` o código aparece na tela) |
| Diarista aprovada | `diarista/entrar/` | `maria.teste@exemplo.com` / `diarista123` |
| Diarista pendente | `diarista/entrar/` | `joana.teste@exemplo.com` / `diarista123` |
| Equipe Prime | `painel/entrar/` | `prime@exemplo.com` / `prime123` |

Ferramentas de desenvolvimento: `_dev/servicos.html?dev=1` (relógio simulado, transições, "simular confirmação da Prime", apagar dados do mock).

## Limites do mock

- Dados só neste navegador (IndexedDB `prime-mock` + localStorage). Limpar o site apaga tudo.
- Login é de demonstração: uma sessão em localStorage, sem senha de verdade. A autorização real é do backend (fase 2).
- WhatsApp: as mensagens são geradas e ficam como "simulada" na fila; nada é enviado. O botão "Falar com a Prime" abre o `wa.me` do número configurado.
- Pix: BR Code estático com a chave de `prime.js`; a confirmação é manual (painel). Pix dinâmico com confirmação automática é fase 2.
- Relógio simulado (`?dev=1`) vale por navegador; sem `?dev=1` as páginas usam o relógio real.

## Homologação (Supabase + Cloudflare Pages)
CLIs pinadas em `scripts/cli.sh` (Supabase 2.117.0; Wrangler 4.137.0 rodando com Node 22 via npx). Variáveis e senha do banco ficam em `~/.prime-env` (chmod 600, fora do repo).
```bash
cd ~/projetos/LP-prime-limpeza && bash scripts/cria-homolog.sh      # cria/linka o prime-homolog (idempotente)
cd ~/projetos/LP-prime-limpeza && bash scripts/deploy-preview.sh    # gera ambiente.js, monta dist/, varre segredos e publica o preview da branch
cd ~/projetos/LP-prime-limpeza && node scripts/testa-b0-preview.mjs # aceite contra o preview (headers, CSP, páginas, 404 do que não é site)
cd ~/projetos/LP-prime-limpeza && node scripts/varre-segredos.mjs   # antes de todo commit
cd ~/projetos/LP-prime-limpeza && node scripts/roda-testes.mjs --homolog  # + testes contra o Supabase de homologação e o preview (só dados fictícios)
```
Deploy do preview: `AUTH=supabase DADOS=mock bash scripts/deploy-preview.sh` (login real, dados de demonstração até o F2). Local roda sempre em mock; `AMBIENTE_HOMOLOG=1 node scripts/serve.mjs` serve o front apontando pro Supabase de homologação.
Auth: toda entrada por senha passa pela Edge Function `conta` (`supabase/functions/conta`); deploy com `bash scripts/cli.sh supabase functions deploy conta --no-verify-jwt`.
Preview da branch: `https://<branch com hífens>.prime-limpeza.pages.dev` (noindex). Só `dist/` é publicado: páginas, `assets/`, `src/` e o seed do mock.

## Fontes de verdade

- `docs/API.md`: contrato dos casos de uso (mock, fake-api e backend futuro).
- `docs/WHATSAPP.md`: checklist de contratação, templates pra aprovação da Meta, webhook.
- `docs/BACKEND.md`: fase 2 (banco, storage, auth, agendador, Pix dinâmico, domínio, estimativa, segurança).
- `docs/DECISOES.md` e `docs/PENDENCIAS.md`: decisões técnicas e o que confirmar com a cliente.
