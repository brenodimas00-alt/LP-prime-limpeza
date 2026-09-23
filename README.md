# Prime Limpeza Especializada — Landing Page

Landing page estática (HTML/CSS/JS puro, sem build, sem framework, sem dependências de instalação) para a Prime Limpeza Especializada.

## Estrutura

```
prime-limpeza-site/
├── index.html                          → página inteira (HTML + CSS + JS em um único arquivo)
└── assets/
    ├── logo.svg / logo-branco.svg       → logo (versão colorida e branca)
    ├── limpeza-residencial.webp
    ├── limpeza-empresarial.webp
    ├── passadoria-de-roupas.webp
    ├── pre-pos-mudanca.webp
    ├── pre-pos-evento.webp              → imagens do slider "Nossos serviços"
    ├── diarista-v2.webp                 → imagem da seção "Você é diarista"
    ├── iphone-mockup.webp               → mockup usado em "Você sabe quem vai entrar na sua casa"
    ├── elipse.webp                      → elemento decorativo
    ├── icons/                           → ícones SVG (benefícios, cartão, substituição, verificado, whatsapp)
    ├── video/
    │   ├── hero-bg.mp4                  → vídeo de fundo do hero (todos os breakpoints)
    │   └── hero-poster.webp             → poster/thumbnail do vídeo do hero
    └── extras-nao-utilizados/           → imagens que já fizeram parte do site mas não estão mais em uso
                                            no HTML atual (mantidas apenas de referência; podem ser
                                            excluídas com segurança se não forem necessárias)
```

## Formato de imagem

Todas as imagens raster (fotos/mockups) estão em **WebP**, convertidas a partir dos PNG/JPG originais com qualidade 85 — redução média de ~90% no peso dos arquivos sem perda visível de qualidade, para melhor performance de carregamento. Os SVGs (logo e ícones) continuam em SVG, formato vetorial, que já é o mais leve e escalável para esse tipo de elemento.

Todos os navegadores modernos (Chrome, Edge, Firefox, Safari 14+) suportam WebP nativamente.

## Como visualizar

Não há build nem dependências para instalar. Basta abrir `index.html` diretamente no navegador, ou servir a pasta com qualquer servidor estático (ex: `npx serve`, GitHub Pages, Netlify, Vercel etc.), mantendo a pasta `assets/` no mesmo nível do `index.html`.

**Importante para GitHub Pages / hospedagem real:** este `index.html` já é um documento HTML completo e autocontido (`<!DOCTYPE html>`, `<html>`, `<head>` com a tag `viewport`, `<body>`). Isso é essencial para o site ser responsivo em celular/tablet — sem a tag `viewport` no `<head>`, o navegador mobile renderiza a página como se fosse desktop e apenas encolhe a tela, quebrando todo o layout responsivo. Se o arquivo for editado, mantenha essas tags no lugar.

## Detalhes técnicos

- Todo o CSS está em um único bloco `<style>` no `<head>`.
- Todo o JavaScript está em um único bloco `<script>` no final do `<body>`, dividido em duas partes:
  - Slider infinito da seção "Nossos serviços" (loop via clonagem de slides), com as setas de navegação agrupadas abaixo do slider, centralizadas, sem bullets/paginação.
  - Animações de entrada ao rolar a página (fade-in / fade-in com movimento), usando `IntersectionObserver`, com fallback para navegadores sem suporte e respeito à preferência `prefers-reduced-motion`.
- O vídeo de fundo do hero é o mesmo em todos os breakpoints (desktop, tablet e mobile).
- No FAQ, a pergunta (summary) fica no fundo azul da marca, e a resposta abre num bloco off-white com texto azul, em tamanho menor, para reforçar a hierarquia entre pergunta e resposta.
- Na dobra "O que está e o que não está incluso", o card "Está incluso" tem borda inferior verde e o card "Não está incluso" tem borda inferior vermelha.
- Fontes: Google Fonts (`DM Sans` e `Inter`), carregadas via `<link>` no `<head>`.
- Totalmente responsivo (breakpoints principais em 960px e 600px), com layouts próprios para desktop, tablet e mobile.

## Links externos configurados

- Botões "Agendar minha diária" → `https://primelimpezaespecializada.com.br/autoagendamento`
- Botão "Sou diarista" (hero) e "Quero me cadastrar como profissional" → `https://primelimpezaespecializada.com.br/diarista/autocadastro`
- WhatsApp (footer): `(31) 97236-3590` e `(31) 99735-7372`
- Instagram (footer): `@primelimpeza_especializada`

## Modo demonstração (mock): credenciais

Tudo fictício, guardado só no navegador (IndexedDB e localStorage). Nada chega à Prime.

| Área | Endereço | Credencial |
|---|---|---|
| Cliente | `entrar/` | WhatsApp `(31) 98888-7777`, código `123456` (com `?dev=1` o código aparece na tela) |
| Diarista aprovada | `diarista/entrar/` | `maria.teste@exemplo.com` / `diarista123` |
| Diarista pendente | `diarista/entrar/` | `joana.teste@exemplo.com` / `diarista123` |
| Equipe Prime | `painel/entrar/` | `prime@exemplo.com` / `prime123` |

Ferramentas de desenvolvimento: `_dev/servicos.html?dev=1` (relógio simulado, transições, apagar dados do mock).

## Observação

Este código foi desenvolvido de forma iterativa como protótipo/mockup navegável e visualmente fiel ao design aprovado. Antes de colocar em produção, recomenda-se que a desenvolvedora responsável revise: acessibilidade (labels, contraste, navegação por teclado), SEO (meta tags, sitemap), e integração real com os fluxos de agendamento/cadastro (atualmente links diretos para outra URL).
