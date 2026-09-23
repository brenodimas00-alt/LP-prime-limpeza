# Decisões técnicas (reversíveis)

Formato: **contexto**, **decisão**, **motivo**. Decisões marcadas DECIDIDO na especificação não aparecem aqui (não se reabrem).

## Turno 2026-09-22

### D1. Branch de trabalho
- **Contexto:** `main` limpa, último commit de hoje, branch `turno/2026-09-22` inexistente.
- **Decisão:** `git pull` na main e criar `turno/2026-09-22` a partir dela. Sem worktree (não havia alteração local).
- **Motivo:** regra G1.

### D2. Playwright só como dependência de teste
- **Contexto:** o site não tem build; os testes E2E precisam de navegador. O Chromium do Playwright precisa de `libnspr4`, `libnss3` e `libasound2`, ausentes no WSL e sem sudo.
- **Decisão:** `package.json` com `playwright` em `devDependencies` (o site continua sem build nem dependência em runtime). As 3 libs foram baixadas com `apt-get download` e extraídas em `~/.cache/pw-libs`; os scripts de teste rodam com `LD_LIBRARY_PATH` apontando pra lá (ver README).
- **Motivo:** A2 proíbe framework/bundler no site, não ferramenta de teste. Extrair libs evita pedir sudo.

### D3. CSS da home extraído em 3 arquivos
- **Contexto:** G4 pede extrair tokens e componentes da home mantendo o visual idêntico.
- **Decisão:** `src/ui/tokens.css` (variáveis), `src/ui/base.css` (reset, botões, header, footer e o responsivo deles) e `src/ui/home.css` (seções). A marcação da home continua estática (SEO e funciona sem JS). As páginas internas usam `tokens.css + base.css + paginas.css` e montam header/footer por `src/ui/layout.js`, com as mesmas classes.
- **Motivo:** reaproveitar sem mexer no HTML aprovado. Verificado: `scripts/compara-home.mjs` dá 0 pixel diferente em 375 e 1440 (e acusa diferença quando um token muda 1 unidade).

### D4. Caminhos relativos + raiz derivada do módulo
- **Contexto:** A4 exige funcionar em `/LP-prime-limpeza/` e local.
- **Decisão:** HTML usa caminhos relativos. `src/config/app.js` deriva a raiz do site de `import.meta.url` (`RAIZ`) e expõe `url()`. `scripts/serve.mjs` imita o Pages servindo em `/LP-prime-limpeza/` (e em `/` com `RAIZ=1`). `.nojekyll` na raiz porque o Jekyll do Pages ignora pastas com `_` (`_dev/`).
- **Motivo:** nenhum caminho absoluto fixo; o mesmo arquivo funciona em qualquer base.

### D5. Mesmo núcleo de casos de uso no mock e no fake-api
- **Contexto:** o fake-api precisa implementar API.md com a mesma semântica do backend futuro.
- **Decisão:** `src/app/casos-de-uso.js` recebe um repositório com `transacao(fn)`. Implementações: IndexedDB (navegador) e memória (Node, com cópia e troca atômica). O fake-api usa os casos de uso sobre memória e roda o motor (papel de backend).
- **Motivo:** uma regra, um lugar. O teste de contrato http passa pelos mesmos cenários do mock (`scripts/cenarios.mjs`).

### D6. Escopo da idempotência = operação + ator + chave
- **Contexto:** revisão GPT #1 apontou que a chave sozinha poderia devolver resultado de outra operação/cliente.
- **Decisão:** registro em `idempotencia` com id `operacao|ator:id|chave` e hash do conteúdo (JSON com chaves ordenadas, cyrb53).
- **Motivo:** evita colisão entre operações e entre clientes.

### D7. Dono do recurso na máquina de estados
- **Contexto:** revisão GPT #1: papel não basta; cliente precisa ser dono e diarista precisa ser a atribuída.
- **Decisão:** `transicionar` recebe `atorId` e `clienteIdDoPedido`; ator `cliente` só age no próprio pedido e `diarista` só no atendimento atribuído a ela. Leituras de recurso alheio devolvem `NAO_ENCONTRADO` (não vaza existência).
- **Motivo:** autorização por recurso, não só por papel.

### D8. Versão no atendimento + revalidação no envio
- **Contexto:** revisão GPT #1: evento antigo podia recriar lembrete depois de cancelamento/reagendamento/reatribuição.
- **Decisão:** `Atendimento.versao` incrementa a cada mudança; a notificação guarda `refs.data/turno/diaristaId`; no horário do envio `aindaValida()` confere o estado atual e cancela a notificação obsoleta.
- **Motivo:** o motor pode reprocessar eventos sem mandar mensagem errada.

### D9. Colisão e busca limitada no calendário
- **Contexto:** revisão GPT #1: deslocar dia bloqueado pode colidir com a ocorrência seguinte ou não terminar.
- **Decisão:** busca do próximo dia permitido limitada a `buscaDeslocamentoMaxDias` (7); ocorrência que cai no mesmo dia ou antes da anterior gera `DATA_INVALIDA`. A primeira data (escolhida pela cliente) não é deslocada: é validada.
- **Motivo:** termina sempre e nunca gera duas diárias no mesmo dia.

### D10. Confirmação de entrada não reativa pedido terminal
- **Contexto:** revisão GPT #1.
- **Decisão:** `derivarStatusPedido` nunca tira o pedido de `cancelado`/`concluido`. `confirmarPagamento` exige elegibilidade (entrada de pedido cancelado não é confirmável) e só aplica `confirmar` em atendimentos `agendado`.
- **Motivo:** estado terminal é terminal.

### D11. Campos extras no modelo
- **Decisão:** `Pagamento.venceEm` (a parcela vence na data do atendimento), `Atendimento.versao`, `Atendimento.deslocada/dataOriginal`, `Notificacao.refs/previa/ordem`, `Pedido.cancelamento`, `Diarista.identidade` (rg|cnh), `Diarista.historico` (contato manual). Todos opcionais; nenhum campo do modelo decidido foi removido ou renomeado.
- **Motivo:** necessários pras regras decididas (vencimento, idempotência de eventos, deslocamento, contato manual).

### D12. Pix sem config: pagamento existe, cobrança não
- **Contexto:** A5 diz que funcionalidade sem config mostra aviso e não gera cobrança.
- **Decisão:** o pedido e o registro de Pagamento são criados (a dívida existe), mas com `brcode: null`; a tela de Pix mostra aviso e não exibe QR nem copia e cola. `criarPagamento` avulso (fora do autoagendamento) devolve `CONFIG_INCOMPLETA`.
- **Motivo:** não perder o pedido da cliente por falta de config da Prime, e ao mesmo tempo nunca mostrar cobrança inválida.

### D13. Sessão de demonstração no mock
- **Contexto:** no mock não há login, mas `?id=` não pode ser autorização.
- **Decisão:** após o autoagendamento o navegador guarda `prime.sessao = {ator:'cliente', id}`; as telas de cliente só mostram o que é dessa sessão. Com `?dev=1` (só mock) a sessão vira `prime`. No http o backend deriva a sessão do login; o adapter só envia `X-Ator-Teste` quando `API_BASE_URL` é localhost (fake-api), e o backend real ignora esse cabeçalho.
- **Motivo:** demonstrar a regra de autorização sem inventar login nesta fase.

### D14. Ordem dos eventos na fila
- **Decisão:** eventos têm `criadoEm` + `seq` (contador do processo); o motor ordena pelos dois. Notificações têm `ordem`.
- **Motivo:** vários eventos na mesma transação têm o mesmo instante.

### D15. Lembretes com "amanhã/hoje" calculado no envio e validade por dia (revisão GPT #2)
- **Contexto:** GPT apontou que um lembrete atrasado (agendador parado) sairia no dia da diária dizendo "amanhã", e que atribuição no próprio dia deixava a diarista sem endereço.
- **Decisão:** a variável `quando` dos lembretes vira "amanhã, dd/mm/aaaa," ou "hoje, dd/mm/aaaa," conforme o dia (no fuso) do envio agendado; a notificação guarda `refs.diaEnvio` e `aindaValida` descarta o lembrete se o envio real cair em outro dia. O lembrete da diarista pode sair no mesmo dia (`mesmoDia`), o da cliente não. `aindaValida` do lembrete da diarista agora também compara o turno.
- **Motivo:** mensagem nunca mente sobre a data; diarista sempre recebe o endereço.

### D16. Template extra `atendimento_cancelado_diarista` (revisão GPT #2)
- **Contexto:** reatribuição e cancelamento só cancelavam lembretes pendentes; a diarista que já tinha recebido "nova diária" não era avisada e poderia ir ao local.
- **Decisão:** novo template UTILITY pra diarista, disparado na reatribuição (pra anterior), no cancelamento de atendimento e no cancelamento de pedido (uma por diária cancelada que tinha diarista). Entra no checklist de aprovação da Meta.
- **Motivo:** risco operacional real (diarista indo a um endereço cancelado). Ver PENDENCIAS.

### D17. Merge da origin/main (ajustes do Breno, 5655300)
- **Contexto:** Breno subiu pela main um gradiente dourado novo (#A57E37 → #F7F4C0 → #BA984D), ajustes de line-height e os 6 ícones de benefício, com o CSS ainda inline no index.html. Conflitou com a extração da E0.
- **Decisão:** conflito resolvido pegando o index.html dele inteiro, refazendo o screenshot de referência (`docs/shots/home-antes-*.png` agora é a home do Breno) e reextraindo o CSS com `scripts/extrai-css-home.mjs`. Resultado: 0 pixel diferente em 375 e 1440 contra a versão dele. `paginas.css` passou a usar o gradiente novo.
- **Motivo:** preservar 100% do que ele mudou. O script fica pra próximos uploads com CSS inline.

## Revisões GPT (registro)
- **#1 plano/modelo (antes da E0):** executada. 7 apontamentos, todos incorporados (D6 a D10).
- **#2 gatilhos + mensagens (E1):** executada. 4 apontamentos, todos incorporados (D15, D16), com testes.
- **#3 WHATSAPP.md x Meta (E2):** revisão GPT NÃO EXECUTADA: motivo: limite de uso do Codex atingido ("try again at 4:28 PM"). E2 segue com os testes próprios verdes; revisar quando o limite voltar.

### D18. Bloco de templates do WHATSAPP.md gerado do código
- **Decisão:** a parte 2 do WHATSAPP.md é gerada por `node scripts/verifica-templates.mjs --gerar` a partir de `mensagens.js` + `gatilhos.js`; sem `--gerar` o script verifica (texto idêntico, UTILITY, pt_BR, snake_case, variáveis em sequência, nada no início/fim, sem formatação, exemplos, algum gatilho dispara). `testa-whatsapp.mjs` confirma que o verificador acusa divergência.
- **Motivo:** o documento que vai pra aprovação da Meta nunca fica diferente do que o sistema manda.
