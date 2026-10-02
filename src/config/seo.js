// SEO técnico (S1, fase 2). Fonte única: scripts/gera-seo.mjs escreve o bloco <!-- seo --> de cada página pública,
// sitemap.xml e robots.txt a partir daqui; scripts/verifica-seo.mjs confere o resultado.
// Dado da empresa que não temos fica 'PREENCHER' e NÃO é publicado (o gerador omite o campo e lista como pendente).
export const DOMINIO = 'https://primelimpezaespecializada.com.br'; // PENDENCIA: com ou sem www no go-live
export const VERSAO_SEO = '2026-09-28';

export const EMPRESA = {
  nome: 'Prime Limpeza Especializada',
  razaoSocial: 'PREENCHER',
  cnpj: 'PREENCHER',
  telefone: '+55-31-97236-3590', // o mesmo publicado no rodapé
  email: 'PREENCHER',
  endereco: { rua: 'PREENCHER', bairro: 'PREENCHER', cidade: 'Belo Horizonte', uf: 'MG', cep: 'PREENCHER' },
  instagram: 'https://instagram.com/primelimpeza_especializada',
  // mesmo horário do rodapé
  horario: [{ dias: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], abre: '08:00', fecha: '18:00' }, { dias: ['Saturday'], abre: '08:00', fecha: '14:00' }],
};

// Serviços da home (textos da cliente).
export const SERVICOS = [
  'Limpeza Residencial', 'Limpeza Empresarial e Comercial', 'Limpeza Condominial',
  'Limpeza Pré e Pós-Mudança', 'Limpeza Pré e Pós-Eventos', 'Passadoria de Roupas',
];

export const IMAGEM_OG = { caminho: 'assets/og-prime.jpg', largura: 1200, altura: 630, alt: 'Prime Limpeza Especializada: limpeza em Belo Horizonte e Região Metropolitana' };

/**
 * Páginas públicas (entram no sitemap). titulo até ~60 caracteres, descricao até ~155.
 * trilha: BreadcrumbList das internas. home: leva LocalBusiness, Service e FAQPage.
 */
export const PAGINAS = [
  {
    arquivo: 'index.html', caminho: '', home: true,
    titulo: 'Prime Limpeza Especializada | Limpeza em BH e região',
    descricao: 'Limpeza residencial, empresarial, condominial, pré e pós-mudança e eventos em Belo Horizonte e Região Metropolitana, com acompanhamento da Prime.',
  },
  {
    arquivo: 'autoagendamento/index.html', caminho: 'autoagendamento/',
    titulo: 'Solicitar limpeza | Prime Limpeza Especializada',
    descricao: 'Conte o que precisa, veja a carga horária e o valor e envie sua solicitação. A Prime verifica a disponibilidade e confirma com você.',
    trilha: 'Solicitar limpeza',
  },
  {
    arquivo: 'diarista/cadastro/index.html', caminho: 'diarista/cadastro/',
    titulo: 'Trabalhe com a Prime | Cadastro de profissional',
    descricao: 'Profissional de limpeza em BH e região: envie seu cadastro e seus documentos para a análise da Prime Limpeza Especializada.',
    trilha: 'Trabalhe com a Prime',
  },
  {
    arquivo: 'diarista/antecedentes/index.html', caminho: 'diarista/antecedentes/',
    titulo: 'Certidão de antecedentes | Prime Limpeza Especializada',
    descricao: 'Como emitir a certidão de antecedentes criminais em Minas Gerais e na Polícia Federal para o cadastro de profissional da Prime.',
    trilha: 'Certidão de antecedentes', pai: { nome: 'Trabalhe com a Prime', caminho: 'diarista/cadastro/' },
  },
  {
    arquivo: 'privacidade/index.html', caminho: 'privacidade/',
    titulo: 'Política de Privacidade | Prime Limpeza Especializada',
    descricao: 'Quais dados a Prime Limpeza Especializada coleta, para quê, com quem compartilha, por quanto tempo guarda e como exercer seus direitos.',
    trilha: 'Política de Privacidade',
  },
  {
    arquivo: 'condicoes/index.html', caminho: 'condicoes/',
    titulo: 'Condições do atendimento | Prime Limpeza Especializada',
    descricao: 'Regras do atendimento da Prime: confirmação, pagamento antecipado, cancelamento, atrasos, material, segurança e o que a Prime não realiza.',
    trilha: 'Condições do atendimento',
  },
  {
    arquivo: 'termos/index.html', caminho: 'termos/',
    titulo: 'Termos de Uso | Prime Limpeza Especializada',
    descricao: 'Regras de uso do site e da solicitação de atendimento da Prime Limpeza Especializada: cadastro, solicitação, pagamento e cancelamento.',
    trilha: 'Termos de Uso',
  },
];

// Fora do Google (robots.txt Disallow + noindex na página). Coerência conferida pelo verifica-seo.
export const BLOQUEADAS = ['/painel/', '/painel-proposta/', '/entrar/', '/minha-conta/', '/pagamento/', '/acompanhamento/', '/avaliacao/', '/diarista/entrar/', '/diarista/agenda/', '/_dev/'];
