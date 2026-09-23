# Fase 2: backend da Prime

O front desta fase já fala o contrato de `docs/API.md`; pros DADOS, trocar de mock pra real é `ADAPTER = 'http'` em `src/config/app.js` e apontar `API_BASE_URL`. A AUTENTICAÇÃO precisa do adapter `supabase` de `src/services/auth.js` implementado (hoje é só o esqueleto com a interface) e o adapter http passa a mandar o token da sessão no cabeçalho `Authorization` (hoje só manda `X-Ator-Teste` em localhost). Tudo abaixo é o que o backend precisa ter pra esse contrato funcionar de verdade. Recomendação de stack: **Supabase** (Postgres + Auth + Storage + Edge Functions) com as regras de negócio numa API própria em Node (ou Edge Functions), reaproveitando `src/domain/` e `src/app/casos-de-uso.js` como estão (são puros e já rodam no `scripts/fake-api.mjs`). Só o repositório muda: de IndexedDB/memória pra Postgres com transação.

## 1. Banco de dados (Postgres)

Mesmas tabelas do modelo (`src/domain/modelo.js`). Dinheiro em `integer` (centavos). Datas de calendário em `date`; instantes em `timestamptz`. Todas as tabelas têm `criado_em timestamptz default now()` e `atualizado_em`.

| tabela | colunas principais | índices e relações |
|---|---|---|
| `clientes` | id uuid pk, tipo (residencial\|empresa), nome, telefone (só dígitos), email, cpf?, cnpj? (14 chars, alfanumérico), razao_social?, responsavel?, endereco jsonb {cep, logradouro, numero, complemento, bairro, cidade, uf}, usuario_id uuid? → auth.users | unique(telefone); idx(usuario_id) |
| `pedidos` | id uuid pk, cliente_id → clientes, pacote jsonb (especificação + itensDia + totais), status (rascunho\|aguardando_entrada\|ativo\|concluido\|cancelado), historico jsonb[], cancelamento jsonb? | idx(cliente_id), idx(status) |
| `atendimentos` | id uuid pk, pedido_id → pedidos, sequencia int, data date, turno (manha\|tarde\|integral), diarista_id? → diaristas, status (7 estados), historico jsonb[], valor_dia_centavos int, taxa_dia_centavos int, deslocada bool, data_original date?, versao int | idx(pedido_id), idx(diarista_id), idx(data), idx(status); unique(pedido_id, sequencia) |
| `pagamentos` | id uuid pk, pedido_id → pedidos, atendimento_id? → atendimentos, parcela (entrada\|dia), valor_centavos int, metodo (pix), pix_txid varchar(25) unique, brcode text?, status (pendente\|informado_pelo_cliente\|confirmado\|cancelado), vence_em date?, vence_as time?, informado_em?, confirmado_em?, chave_idempotencia text, provedor_ref text? (id da cobrança no PSP) | idx(pedido_id), idx(atendimento_id), idx(status), unique(pix_txid) |
| `diaristas` | id uuid pk, usuario_id uuid? → auth.users, nome, cpf unique, telefone, email unique, data_nascimento date, endereco jsonb, experiencia_anos int, disponibilidade jsonb {dias[], turnos[], regioes[]}, identidade (rg\|cnh), status (pendente\|aprovada\|reprovada), decisao jsonb?, aceite_termos_em timestamptz, historico jsonb[] | idx(status), unique(cpf), unique(email) |
| `documentos` | id uuid pk, diarista_id → diaristas, tipo (8 tipos), nome_arquivo, mime, tamanho int, storage_path text (bucket privado), hash_sha256, excluido_em? | idx(diarista_id); unique(diarista_id, tipo) |
| `avaliacoes` | id uuid pk, atendimento_id → atendimentos unique, notas jsonb {4 critérios 1..5}, nota_final numeric(2,1), comentario text (≤500) | unique(atendimento_id) |
| `notificacoes` | id uuid pk, gatilho, canal (whatsapp), destinatario jsonb {tipo,id,telefone}, template, variaveis jsonb, agendada_para timestamptz?, status (pendente\|simulada\|enviada\|erro\|cancelada), refs jsonb, chave_idempotencia unique, previa text?, wamid text?, enviada_em?, entregue_em?, lida_em?, erro jsonb?, tentativas int | idx(status, agendada_para) (o agendador varre por aqui), unique(chave_idempotencia), idx(wamid) |
| `eventos` | id uuid pk, tipo, refs jsonb, dados jsonb, status (pendente\|processado), seq bigserial, processado_em? | idx(status, seq) |
| `idempotencia` | chave text pk (`operacao\|ator\|chave`), operacao, hash, resultado jsonb, criado_em | limpeza após 7 dias |
| `usuarios_prime` | usuario_id uuid pk → auth.users, nome, papel (admin\|atendimento), ativo bool | |
| `contatos_manuais` | id, pedido_id?, diarista_id?, contexto, ator, em | (hoje vai no `historico`; separar em tabela facilita relatório) |

Transação: cada caso de uso é **uma transação** (mudança + `idempotencia` + `eventos`), como no mock. Preço, entrada e parcelas sempre recalculados no servidor a partir de `pacote` (especificação) e `src/config/precos.js` (que vira tabela `precos` versionada, com `vigente_desde`).

## 2. Storage privado dos documentos

- Bucket **privado** `documentos-diaristas`, caminho `diaristas/{diarista_id}/{tipo}-{uuid}.{ext}` (nunca o nome enviado).
- Upload **multipart pela própria API** (`POST /diaristas/{id}/documentos`, como está em API.md e no adapter http): a API recebe com parser consolidado (busboy) e limite de 5 MB, valida (assinatura dos bytes, decodificação real com sharp pra imagem e pdf-lib/`pdfinfo` pra PDF, hash, antivírus opcional com ClamAV), grava no bucket e só então registra em `documentos`. Alternativa pra depois, se o volume crescer: URL assinada de upload direto, que muda o contrato do front.
- Leitura só por URL assinada de **5 minutos**, emitida pra Prime (painel) ou pra própria diarista.
- Retenção: documentos de cadastro **reprovado** apagados em 30 dias; de rascunho abandonado (sem `cadastrarDiarista`) em 7 dias; de diarista **aprovada** mantidos enquanto ativa e apagados 12 meses após desligamento. Exclusão a pedido em até 15 dias (LGPD, art. 18). Registrar `excluido_em` e apagar o objeto do bucket (job diário).

## 3. Autenticação e autorização (Supabase Auth + RLS)

- **Cliente:** OTP por SMS/WhatsApp no telefone do pedido (`signInWithOtp({ phone })` + `verifyOtp`). Alternativa: link mágico por e-mail. Na primeira entrada, vincular `clientes.usuario_id`. O `?pedido=` do link do WhatsApp abre a tela; a leitura só funciona logada como dona (hoje já é assim no contrato).
- **Diarista:** e-mail + senha (`signInWithPassword`), criada na aprovação do cadastro (convite por e-mail/WhatsApp com link de definir senha). `diaristas.usuario_id`.
- **Prime:** e-mail + senha, com papel em `usuarios_prime` (admin: tudo; atendimento: sem apagar nem mexer em preços). Ativar 2FA (TOTP) pros admins.
- **RLS (obrigatória):** `clientes`/`pedidos`/`atendimentos`/`pagamentos`/`avaliacoes`: cliente lê e escreve só onde `cliente_id` é o dela; diarista lê `atendimentos` com `diarista_id = ela` e só as colunas necessárias (view `agenda_diarista` que esconde endereço completo até a véspera); `usuarios_prime` lê tudo. Escritas de negócio passam pela API (service role) que revalida transições, permissões e condições com `src/domain/estados.js`; a RLS é a segunda barreira.
- O front (`src/services/auth.js`) já tem a interface pronta; o adapter `supabase` troca as chamadas `mock` por `supabase.auth.*` e lê o papel de `usuarios_prime`/`diaristas`/`clientes`.

## 4. Agendador de lembretes e motor de eventos

- `eventos` é a fila (outbox). Um worker (cron a cada minuto ou Supabase `pg_cron` + Edge Function) roda `motor.processarEventos()` e `motor.executarVencidas()` de `src/automacoes/motor.js`, com `SELECT ... FOR UPDATE SKIP LOCKED` nas linhas pendentes.
- Envio real: `canal.enviar(notificacao)` (interface `ProvedorWhatsApp`) no lugar de `canalSimulado`. Marca `enviada` só com o `wamid` de volta; erro de rede tenta de novo (1, 5, 15 min) e depois `erro`.
- Relógio: `America/Sao_Paulo`, gravado em UTC (as funções em `src/domain/calendario.js` já fazem isso).

## 5. WhatsApp

Ver `docs/WHATSAPP.md` (checklist de contratação, templates prontos pra aprovação, webhook, agendador, comparativo). O backend implementa `ProvedorWhatsApp { enviarTemplate(notificacao) -> wamid }` (payload de referência em `src/automacoes/payloadMeta.js`) e o webhook `POST /webhooks/whatsapp` (assinatura HMAC, statuses, mensagens recebidas, janela de 24h).

## 6. Pix dinâmico

Hoje o BR Code é **estático** (chave da Prime + valor + txid). Na fase 2, cobrança **dinâmica** com confirmação automática por webhook, o que elimina o "confirmar recebimento" manual:

| | Mercado Pago | Asaas | Efí (Gerencianet) |
|---|---|---|---|
| Custo por Pix recebido | ~0,99% | R$ 1,99 fixo por cobrança (ou plano) | ~1,19% + mensalidade zero |
| API | boa, SDK Node | simples, boa doc em português | API Pix oficial (certificado mTLS), mais burocrática |
| Webhook de confirmação | sim | sim | sim |
| Conciliação por txid | sim | sim (`externalReference`) | sim |
| Split pra diarista | sim (marketplace) | sim (subcontas) | não nativo |

**Recomendação: Asaas.** Valor fixo por cobrança (cabe em diárias de R$ 138 a 300), documentação em português, webhook simples, subcontas caso a Prime queira repassar à diarista no futuro. Implementação: `criarPagamento` chama o PSP, guarda `provedor_ref` e o `brcode` dinâmico; o webhook `pagamento confirmado` chama `confirmarPagamento` com ator `sistema` (já permitido em `exigirPrime`; mesma regra de elegibilidade). O "Já paguei" continua existindo como aviso enquanto o webhook não chega.

## 7. Domínio e hospedagem

- `primelimpezaespecializada.com.br`: DNS no Registro.br apontando pra hospedagem do front (Cloudflare Pages, Vercel ou o próprio GitHub Pages com domínio próprio); `api.primelimpezaespecializada.com.br` pra API (Supabase Edge Functions ou um Node em Railway/Fly). TLS automático (Let's Encrypt) nos dois.
- Remover o base path `/LP-prime-limpeza/` na publicação (o `url()` de `src/config/app.js` já é relativo; `404.html` detecta a raiz).
- **Homologação com senha:** subdomínio `homolog.primelimpezaespecializada.com.br` protegido por Basic Auth (Cloudflare Access ou cabeçalho na hospedagem), banco Supabase separado, `prime.js` com a config de teste e o WhatsApp num número de teste.

## 8. Painel da Prime

O `painel/` desta fase já cobre: agenda do dia e da semana, atribuir diarista, confirmar Pix informado, aprovar/reprovar cadastro vendo documentos, fila de notificações e avaliações com média. Na fase 2 ele passa a usar a API real sem mudar de tela; acrescentar: filtros por período, exportação CSV, reagendar pela tela (o caso de uso `reagendar` já existe), cancelar atendimento individual, editar preços (tabela `precos`), e log de auditoria (quem confirmou o quê).

## 9. Migração da base de clientes (Excel)

1. Exportar a planilha atual pra CSV com colunas: nome, telefone, e-mail, tipo, CPF/CNPJ, endereço (CEP, rua, número, complemento, bairro, cidade, UF), observações.
2. Script `scripts/importa-clientes.mjs` (a escrever) que passa cada linha por `validarCliente` de `src/domain/validacao.js`, normaliza telefone/CEP/CNPJ, e gera um relatório de linhas inválidas pra corrigir na planilha antes de importar.
3. Importar em `clientes` sem `usuario_id`; o vínculo acontece na primeira entrada por OTP no mesmo telefone.
4. Histórico de diárias antigas: opcional, importar como `pedidos` com status `concluido` e atendimentos `finalizado`, só se a planilha tiver data e valor.

## 10. Ordem e estimativa (dias úteis, 1 pessoa)

| # | Entrega | Dias |
|---|---|---|
| 1 | Projeto Supabase, tabelas, RLS, seeds, `precos` versionada | 3 |
| 2 | API dos casos de uso (reaproveitando `src/app`), repositório Postgres com transação, idempotência, testes de contrato (`scripts/cenarios.mjs` apontando pra API real) | 5 |
| 3 | Auth (OTP cliente, senha diarista/Prime, papéis) + adapter `supabase` no front | 3 |
| 4 | Storage privado, upload assinado, validação real de arquivo, retenção | 2 |
| 5 | Motor de eventos + agendador (cron) + `ProvedorWhatsApp` com o BSP contratado + webhook | 4 |
| 6 | Pix dinâmico (Asaas) + webhook de confirmação | 3 |
| 7 | Homologação com senha, domínio, DNS, TLS, migração dos clientes | 2 |
| 8 | Ajustes do painel (filtros, reagendar, auditoria) e testes E2E contra homologação | 3 |
| | **Total** | **25 dias úteis (5 semanas)**, mais o tempo de aprovação da Meta e do BSP, que corre em paralelo |

## Segurança (obrigatório na fase 2)

- **Autorização por papel e por dono (RLS)** em todas as tabelas; a API usa service role só dentro dos casos de uso, nunca exposta ao front. `?dev=1`, `?id=` e o cabeçalho `X-Ator-Teste` **não existem** em produção.
- **Validação server-side de tudo**: preço recalculado, transições e condições revalidadas (`estados.js`), campos normalizados (`validacao.js`), tamanho e conteúdo real dos arquivos, corpo JSON limitado (1 MB) e multipart por parser consolidado (busboy).
- **Rascunho de cadastro vinculado à sessão** (ou a um segredo emitido pelo servidor), não só ao UUID: listar, trocar e enviar documentos só pelo titular (apontado na revisão GPT #5).
- **LGPD dos documentos**: bucket privado, URL assinada curta, retenção e exclusão (seção 2), registro de consentimento (`aceite_termos_em`), acesso do painel auditado (quem abriu qual documento e quando), minimização (a diarista só vê o endereço da cliente na véspera; a cliente só vê o primeiro nome da diarista).
- **Rate limit**: OTP (5 por telefone por hora), login (10 por IP por 15 min), `POST /autoagendamentos` (20 por IP por hora), uploads (30 por rascunho). Bloqueio progressivo e log.
- **Webhook assinado**: WhatsApp (`X-Hub-Signature-256`, HMAC do corpo cru, comparação em tempo constante) e Pix (assinatura do PSP + IP allowlist); ambos idempotentes pelo id do evento.
- **Segredos** só em variáveis de ambiente (token do WhatsApp, chaves do PSP, service role); rotação semestral; nada no repositório.
- **Cabeçalhos**: CSP sem inline (o front já não usa `innerHTML` com dado), HSTS, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store` nas respostas com dado pessoal.
- **Backups** diários do Postgres com retenção de 30 dias e teste de restauração trimestral; os documentos no bucket entram no mesmo plano.
