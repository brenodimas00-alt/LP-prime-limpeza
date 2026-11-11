// Modelo do Início com os MESMOS textos e números da referência da cliente (dashboard-isa.png). Usado pela maquete
// (_dev/inicio-maquete) e pela regressão visual. Pessoas fictícias; avatares ilustrados (nenhuma foto real).
const A = (n) => `../../assets/painel/avatar-${n}.svg`;
export const INICIO_REFERENCIA = {
  usuaria: { nome: 'Isa', papel: 'Administradora', avatar: A(5) },
  contadores: { solicitacoes: 6, sino: 6 },
  saudacao: 'Boa tarde, Isa!', frase: 'Tudo organizado para mais um dia de grandes resultados.',
  sistema: { total: 12, itens: [] },
  data: { dia: 'Terça-feira,', extenso: '15 de outubro de 2024' },
  solicitacoes: { total: 6, itens: [
    { data: '15/10', hora: '10:00', cliente: 'Juliana Costa', avatar: A(1), local: 'Sion - BH', servico: 'residencial', imovel: ['72 m² | 6 amb.', 'Animal | Alimentação'], horas: '6h', valor: 'R$ 203,00', origem: { tipo: 'instagram', l1: 'Instagram', l2: '@blogueira' } },
    { data: '16/10', hora: '08:00', cliente: 'Roberto Almeida', avatar: A(2), local: 'Funcionários - BH', servico: 'empresarial', imovel: ['120 m² | 8 amb.', 'Sem animal | Sem alimentação'], horas: '8h', valor: 'R$ 230,00', origem: { tipo: 'google', l1: 'Google' } },
    { data: '17/10', hora: '14:00', cliente: 'Camila Duarte', avatar: A(3), local: 'Buritis - BH', servico: 'passadoria', imovel: ['80 m² | 5 amb.', 'Sem animal | Alimentação'], horas: '4h', valor: 'R$ 175,00', origem: { tipo: 'indicacao', l1: 'Indicação', l2: 'Maria Silva' } },
  ] },
  hoje: { titulo: 'Diárias de hoje', total: 14, confirmadas: 13, pendentes: 1, itens: [
    { hora: '08:00', cliente: 'Mariana Silva', bairro: 'Buritis', servico: 'residencial', horas: '4h', prof: { nome: 'Ana Paula', avatar: A(1), hab: ['residencial', 'passadoria'] }, pago: true, forma: 'PIX', status: 'andamento', rotulo: 'Em andamento' },
    { hora: '10:00', cliente: 'Carlos Mendes', bairro: 'Funcionários', servico: 'empresarial', horas: '6h', prof: { nome: 'Juliana', avatar: A(3), hab: ['residencial', 'passadoria'] }, pago: false, forma: 'PIX', status: 'confirmada', rotulo: 'Confirmada' },
    { hora: '14:00', cliente: 'Patrícia Lima', bairro: 'Savassi', servico: 'passadoria', horas: '4h', prof: { nome: 'Carla', avatar: A(4), hab: ['residencial', 'passadoria'] }, pago: true, forma: 'PIX', status: 'concluida', nota: '5,0' },
  ] },
  amanha: { titulo: 'Diárias de amanhã', total: 18, confirmadas: 15, pendentes: 3, itens: [
    { hora: '08:00', cliente: 'Júlia Costa', bairro: 'Sion', servico: 'residencial', horas: '4h', prof: { nome: 'Letícia', avatar: A(5), hab: ['residencial', 'passadoria'] }, pago: true, forma: 'PIX', status: 'confirmada', rotulo: 'Confirmada' },
    { hora: '09:00', cliente: 'Eduardo Martins', bairro: 'Pampulha', servico: 'empresarial', horas: '8h', prof: { nome: 'Talita', avatar: A(6), hab: ['residencial', 'passadoria'] }, pago: false, forma: 'PIX', status: 'confirmada', rotulo: 'Confirmada' },
    { hora: '14:00', cliente: 'Fernanda Rocha', bairro: 'Santa Lúcia', servico: 'pre_pos_evento', horas: '6h', prof: { nome: 'Aline', avatar: A(2), hab: ['residencial', 'passadoria'] }, pago: true, forma: 'Cartão', status: 'confirmada', rotulo: 'Confirmada' },
  ] },
  precisa: { total: 6, urgentes: 2, abas: [['Todas', 6], ['Escala', 2], ['Financeiro', 2], ['Contratos', 1], ['Ocorrências', 1]], itens: [
    { ic: 'alerta', tom: 'erro', urgente: true, titulo: 'Diária de amanhã sem profissional', sub: '16/10 • 08h • Funcionários', acao: 'resolver' },
    { ic: 'relogio', tom: 'aviso', titulo: 'Pagamento pendente', sub: 'Juliana Costa • Diária de 15/10', acao: 'aprovar' },
    { ic: 'cadeado', tom: 'ouro', titulo: 'Aprovar adiantamento', sub: 'Ana Paula • R$ 80,00', acao: 'aprovar' },
    { ic: 'taxi', tom: 'ouro', titulo: 'Uber', sub: 'Juliana • R$ 23,40 • Diária #58321', acao: 'aprovar' },
  ] },
  standby: { total: 2, itens: [
    { nome: 'Maria', horario: '08h - 18h • BH', avatar: A(3), hab: ['residencial', 'passadoria'] },
    { nome: 'Carla', horario: '08h - 14h • BH/RM', avatar: A(4), hab: ['residencial', 'passadoria'] },
  ] },
  alertas: { total: 4, itens: [
    { ic: 'calendario_d', titulo: 'Pacote de Maria vence amanhã', sub: '5 diárias restantes' },
    { ic: 'calendario_d', titulo: 'Documento de Juliana vence em 3 dias', sub: 'RG / Comprovante de residência' },
    { ic: 'alerta', tom: 'erro', titulo: 'Avaliação baixa recebida', nota: '2,0', sub: 'Cliente: Fernanda Rocha • Diária #58321' },
    { ic: 'calendario_d', titulo: '3 pacotes vencem nos próximos 7 dias' },
  ] },
  cadastros: { total: 4, itens: [
    { nome: 'Ana Clara', local: 'Savassi - BH', quando: 'Hoje' }, { nome: 'Bruno Lopes', local: 'Buritis - BH', quando: 'Hoje' },
    { nome: 'Letícia Fernandes', local: 'Funcionários - BH', quando: 'Ontem' }, { nome: 'Rafael Souza', local: 'Sion - BH', quando: 'Ontem' },
  ] },
  meta: { mes: 'Outubro', anterior: 'setembro', rotAnterior: 'Setembro', percentual: 10, base: 162, meta: 179, realizadas: 96, agendadas: 58, faltam: 25 },
  motivos: { periodo: 'Este mês', itens: [['Cliente desistiu', 4], ['Sem profissional', 3], ['Falta de pagamento', 2], ['Não foi possível atender', 2], ['Outros', 1]] },
  regioes: { aba: 'cidades', itens: [['Belo Horizonte', 52], ['Contagem', 16], ['Vespasiano', 11], ['Nova Lima', 9], ['Outras', 12]] },
};
