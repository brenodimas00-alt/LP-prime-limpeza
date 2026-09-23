// Dados da Prime. Substitua cada 'PREENCHER' pelo valor real antes de publicar.
// Sem Pix completo (chave, nome e cidade) a tela de pagamento mostra aviso e NÃO gera cobrança.
// Sem WhatsApp, os botões "abrir no WhatsApp" somem com aviso. E-mail é opcional.
export const PRIME = {
  pix: {
    chave: 'PREENCHER', // CPF, CNPJ, e-mail, telefone (+55...) ou chave aleatória
    nomeRecebedor: 'PREENCHER', // até 25 caracteres, como aparece no banco
    cidadeRecebedor: 'PREENCHER', // até 15 caracteres, ex.: BELO HORIZONTE vira BELO HORIZONTE
  },
  whatsapp: 'PREENCHER', // só números com DDI, ex.: 5531972363590
  email: 'PREENCHER',
  endereco: 'PREENCHER',
};
