# Auditoria de segurança pré-lançamento (30/09/2026)

Feita como atacante externo, só contra a homologação, com contas de teste (`teste-*@example.com`) e dados fictícios. Nada foi derrubado e nenhum cliente real foi tocado. Cada achado virou teste que falha no código antigo e passa no novo.

Testes: `scripts/testa-auditoria.mjs` (banco, auth, Edge Functions e storage, no `--entrega`) e `scripts/testa-auditoria-preview.mjs` (XSS e dado pessoal no navegador, no `--completo`).

## Achados

| # | Severidade | Onde | Achado | Situação |
|---|---|---|---|---|
| M1 | Média | Auth / banco | Depois de trocar a senha (ou sair), o token de acesso de outra sessão seguia valendo até expirar (até 1 h). Quem invadiu a conta continuava dentro. | Corrigido: `privado.papel()` e a policy de `perfis` exigem a sessão viva no Auth (migration `20261002100000`). O front entra de novo depois da troca. |
| M2 | Média | Edge `conta` | A ação `cadastrar` respondia "Já existe cadastro com este CPF": dava pra testar se um CPF é cliente da Prime. Nenhuma tela usava mais. | Corrigido: ação removida (a conta nasce na solicitação, que nunca revela cadastro). |
| M3 | Média | Edge `conta` | Enumeração pelo tempo: senha errada de e-mail/celular cadastrado respondia ~80 ms mais devagar que de um não cadastrado. | Corrigido: toda recusa termina no mesmo piso (900 ms desde o início da tentativa). |
| M4 | Média | Edge `conta` | Ação com nome do protótipo do JavaScript: `constructor` devolvia 200 e `__proto__` 500, que gravava erro e alimentava os alertas do painel (qualquer anônimo enchia o painel de saúde). | Corrigido: só ação própria da tabela; corpo tem que ser objeto. |
| M5 | Média | Edge `conta` e `documentos` | Corpo lido inteiro na memória antes de conferir o tamanho. | Corrigido: leitura com limite (`_shared/corpo.js`): 8 KB e 4 KB. |
| M6 | Média | Front (cadastro de profissional) | Rascunho guardava CPF e nascimento no `localStorage` pra sempre (inclusive depois do envio). | Corrigido: CPF e nascimento só no `sessionStorage` (some ao fechar a aba); rascunho antigo é limpo ao abrir; sem esses dados, volta ao passo 1 (os dois últimos pontos vieram da revisão do GPT). |
| M7 | Média | Headers | Sem HSTS (páginas de login e de dado pessoal). | Corrigido: `Strict-Transport-Security: max-age=31536000` e `Cross-Origin-Opener-Policy: same-origin`. |
| B1 | Baixa | Edge `conta` | `cadastrar_diarista` diz "Já existe conta com este e-mail". | PENDENCIAS: mitigado (Turnstile e 10 cadastros por IP por hora); resposta igual só com SMTP próprio (mandar o aviso por e-mail). |
| B2 | Baixa | Painel | A busca de clientes põe CPF/telefone na URL (histórico do navegador da equipe). Não sai pra terceiros (Referrer-Policy corta a query). | PENDENCIAS. |
| B3 | Baixa | CSP | `style-src 'unsafe-inline'` (estilo inline nas telas). Script continua só por hash. Risco: injeção de CSS, não de script. | PENDENCIAS: tirar `style=` das telas antes de remover. |
| B4 | Baixa | Edge `notificacoes` | Corpo gigante sem segredo: responde 401 sem ler, e a conexão fica pendurada até o gateway (150 s). Só prende a conexão do próprio atacante. | PENDENCIAS. |
| B5 | Baixa | Dependências | `npm audit`: 23 (5 altas), todas em ferramentas de teste (Lighthouse, exceljs, nodemailer). Nada disso é publicado. | Versões fixadas (sem `^`, teste no B0). PENDENCIAS: nodemailer atualizado quando o SMTP entrar em produção. |
| B6 | Baixa | RPC `listar_documentos` | Id inexistente devolve lista vazia em vez de erro. Sem vazamento. | PENDENCIAS. |

Nenhum achado de severidade alta.

## Verificado sem achado

- **RLS e RPC:** as 97 RPCs chamadas como anônimo, cliente A (com ids da cliente B), profissional Y (com ids da X) e cliente/profissional contra ação da Prime. Nenhuma aceita fora do papel, nenhuma resposta traz dado da vítima e nenhuma linha da vítima ou configuração global muda. Tabelas: RLS forçada em todo o `public`, sem escrita direta, `privado` fora da API.
- **Auth:** `x-papel` de Prime em conta de cliente recusado; papel via `user_metadata` sem efeito; IP não falsificável (`X-Forwarded-For` ignorado, `cf-connecting-ip` forjado recusado pela Cloudflare); bloqueio por tentativas conta por conta (as três vias somam) e por IP; bloqueio pelo painel corta RPC, renovação e troca de senha na hora.
- **Edge Functions e webhooks:** worker e retenção exigem segredo; webhook do WhatsApp exige assinatura HMAC (e está desligado); ações da Prime recusam sem token (401) e com token de cliente (403); JSON malformado dá 400; reenvio idempotente (coberto em `testa-whatsapp` e na solicitação com a mesma chave).
- **Front:** nenhum texto livre vira HTML (nome, endereço, observação, dados informados, ocorrência, hora extra, folga, pedido LGPD, prévia de template), em todas as abas do painel, na Minha conta e no acompanhamento; depois de sair, nada de CPF, e-mail, nome ou telefone no `localStorage`/`sessionStorage` nem no console; CSV neutraliza fórmula; e-mail HTML escapado.
- **Storage:** sem URL pública, sem listar, sem gravar; URL assinada expirada, com token adulterado ou de outro arquivo recusada.
