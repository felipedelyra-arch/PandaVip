// Modo demo/mock — liga com VITE_DEMO=true no .env.
// Bypassa auth (admin fake) e injeta dados fictícios nas telas, sem backend.
// Mutações (salvar/excluir/push) viram no-op com toast, não tocam Firebase.

import { toast } from "sonner";
import type {
  AppUser,
  Plan,
  Promotion,
  Reward,
  Redemption,
  Subscription,
  Payment,
  Restaurante,
  Funcionario,
  MenuItem,
  Pedido,
  PushLog,
} from "./types";

export const IS_DEMO = import.meta.env.VITE_DEMO === "true";

/**
 * No modo demo: mostra toast informando que é demo e retorna true (o chamador
 * deve dar `return` sem tocar o backend). Fora do demo: retorna false.
 */
export function demoBlock(msg = "Ação desativada no modo demo"): boolean {
  if (IS_DEMO) {
    toast.info(`${msg} (modo demo)`);
    return true;
  }
  return false;
}

const now = new Date();
const mes = (m: number, d = 10) => new Date(now.getFullYear(), m, d);
const diasAtras = (n: number) =>
  new Date(now.getTime() - n * 24 * 60 * 60 * 1000);
const horasAtras = (n: number) => new Date(now.getTime() - n * 60 * 60 * 1000);

const demoUsers: AppUser[] = [
  { uid: "u_ana", nome: "Ana Souza", email: "ana@email.com", telefone: "(14) 99911-0001", criadoEm: mes(0, 5) },
  { uid: "u_bruno", nome: "Bruno Lima", email: "bruno@email.com", telefone: "(14) 99911-0002", criadoEm: mes(1, 12) },
  { uid: "u_carla", nome: "Carla Dias", email: "carla@email.com", telefone: "(14) 99911-0003", criadoEm: mes(2, 3) },
  { uid: "u_diego", nome: "Diego Rocha", email: "diego@email.com", telefone: "(14) 99911-0004", criadoEm: mes(3, 20) },
  { uid: "u_elis", nome: "Elis Prado", email: "elis@email.com", telefone: "(14) 99911-0005", criadoEm: mes(4, 8) },
  { uid: "u_fabio", nome: "Fábio Nunes", email: "fabio@email.com", telefone: "(14) 99911-0006", criadoEm: mes(5, 14) },
  { uid: "u_gina", nome: "Gina Melo", email: "gina@email.com", telefone: "(14) 99911-0007", criadoEm: mes(6, 2) },
  { uid: "u_admin", nome: "João Couto (você)", email: "admin@exemplo.com.br", telefone: "", role: "admin", criadoEm: mes(0, 1) },
];

// Plano é um só, então toda assinatura aponta pra `p_mensal`.
const demoSubs: Subscription[] = [
  { id: "s1", userId: "u_ana", planId: "p_mensal", status: "active", proximaCobranca: diasAtras(-20), formaPagamento: "cartao" },
  { id: "s2", userId: "u_carla", planId: "p_mensal", status: "active", proximaCobranca: diasAtras(-12), formaPagamento: "cartao" },
  { id: "s3", userId: "u_elis", planId: "p_mensal", status: "active", proximaCobranca: diasAtras(-8), formaPagamento: "pix" },
  { id: "s4", userId: "u_gina", planId: "p_mensal", status: "active", proximaCobranca: diasAtras(-25), formaPagamento: "cartao" },
  { id: "s5", userId: "u_bruno", planId: "p_mensal", status: "canceled", proximaCobranca: null, formaPagamento: "cartao" },
];

/**
 * Dois tipos de dinheiro na mesma lista, que é o que a tela de Pagamentos
 * precisa mostrar: a mensalidade de R$ 4,90 (vem do gateway) e a conta fechada
 * no salão com mesa, atendente e itens.
 *
 * ⚠️ O consumo aqui é fictício pra demonstrar a tela. Em produção esses campos
 * só chegam se o sistema de comanda do restaurante gravar em `payments` —
 * enquanto isso não existir, só a mensalidade aparece de verdade.
 */
const demoPayments: Payment[] = [
  // ---- mensalidade (gateway) ----
  { id: "pay1", userId: "u_ana", valor: 4.9, metodo: "cartao", status: "aprovado", tipo: "assinatura", gatewayRef: "in_1AbcDef", data: diasAtras(2) },
  { id: "pay2", userId: "u_carla", valor: 4.9, metodo: "cartao", status: "aprovado", tipo: "assinatura", gatewayRef: "in_2GhiJkl", data: diasAtras(5) },
  { id: "pay3", userId: "u_elis", valor: 4.9, metodo: "pix", status: "aprovado", tipo: "assinatura", gatewayRef: "pix_abc123", data: diasAtras(9) },
  { id: "pay4", userId: "u_gina", valor: 4.9, metodo: "cartao", status: "aprovado", tipo: "assinatura", gatewayRef: "in_3MnoPqr", data: diasAtras(21) },
  { id: "pay5", userId: "u_bruno", valor: 4.9, metodo: "cartao", status: "recusado", tipo: "assinatura", gatewayRef: "in_4StuVwx", data: diasAtras(24) },
  { id: "pay6", userId: "u_ana", valor: 4.9, metodo: "cartao", status: "aprovado", tipo: "assinatura", gatewayRef: "in_5YzaBcd", data: diasAtras(33) },

  // ---- consumo no salão (comanda) ----
  {
    id: "cons1", userId: "u_ana", valor: 143.82, metodo: "cartao", status: "aprovado",
    tipo: "consumo", mesa: "12", atendente: "Juliana", descontoClube: 15.98,
    gatewayRef: "cmd_00841", data: horasAtras(20),
    itens: [
      { nome: "Combinado especial", quantidade: 1, preco: 89.9 },
      { nome: "Niguiri de maracujá", quantidade: 1, preco: 34.9 },
      { nome: "Refrigerante", quantidade: 2, preco: 17.5 },
    ],
  },
  {
    id: "cons2", userId: "u_carla", valor: 98.9, metodo: "pix", status: "aprovado",
    tipo: "consumo", mesa: "4", atendente: "Rafael", descontoClube: 10.99,
    gatewayRef: "cmd_00839", data: diasAtras(1),
    itens: [
      { nome: "Salmão grelhado", quantidade: 2, preco: 54.9 },
    ],
  },
  {
    id: "cons3", userId: "u_elis", valor: 39.9, metodo: "dinheiro", status: "aprovado",
    tipo: "consumo", mesa: "7", atendente: "Juliana", descontoClube: 0,
    gatewayRef: "cmd_00822", data: diasAtras(4),
    itens: [{ nome: "Burguer Panda", quantidade: 1, preco: 39.9 }],
  },
  {
    id: "cons4", userId: "u_gina", valor: 212.4, metodo: "cartao", status: "aprovado",
    tipo: "consumo", mesa: "9", atendente: "Marcos", descontoClube: 23.6,
    gatewayRef: "cmd_00810", data: diasAtras(12),
    itens: [
      { nome: "Combinado do chef", quantidade: 1, preco: 99.9 },
      { nome: "Sashimi premium", quantidade: 1, preco: 62 },
      { nome: "Filé gratinado", quantidade: 1, preco: 58 },
      { nome: "Sorvete de matchá", quantidade: 2, preco: 8.05 },
    ],
  },
  // Conta que veio do caixa sem a lista de itens — acontece, e a ficha precisa
  // dizer isso em vez de mostrar uma lista vazia.
  {
    id: "cons5", userId: "u_bruno", valor: 76.5, metodo: "pix", status: "aprovado",
    tipo: "consumo", mesa: "3", atendente: null, descontoClube: 0,
    gatewayRef: "cmd_00795", data: diasAtras(19), itens: null,
  },
  // Meses anteriores — sem eles o gráfico de receita vira um taco de hóquei e
  // dá a impressão errada de que o clube só começou a faturar agora.
  {
    id: "cons6", userId: "u_ana", valor: 118.8, metodo: "cartao", status: "aprovado",
    tipo: "consumo", mesa: "5", atendente: "Rafael", descontoClube: 13.2,
    gatewayRef: "cmd_00701", data: diasAtras(41),
    itens: [{ nome: "Combinado especial", quantidade: 1, preco: 89.9 }, { nome: "Sorvete de matchá", quantidade: 2, preco: 16.4 }],
  },
  {
    id: "cons7", userId: "u_carla", valor: 167.4, metodo: "pix", status: "aprovado",
    tipo: "consumo", mesa: "11", atendente: "Juliana", descontoClube: 18.6,
    gatewayRef: "cmd_00688", data: diasAtras(52),
    itens: [{ nome: "Sashimi premium", quantidade: 2, preco: 62 }, { nome: "Strogonoff da casa", quantidade: 1, preco: 44.9 }],
  },
  {
    id: "cons8", userId: "u_gina", valor: 88.9, metodo: "cartao", status: "aprovado",
    tipo: "consumo", mesa: "2", atendente: "Marcos", descontoClube: 9.9,
    gatewayRef: "cmd_00655", data: diasAtras(74),
    itens: [{ nome: "Salmão no purê", quantidade: 1, preco: 58.9 }, { nome: "Burguer Panda", quantidade: 1, preco: 39.9 }],
  },
  {
    id: "cons9", userId: "u_elis", valor: 134.1, metodo: "cartao", status: "aprovado",
    tipo: "consumo", mesa: "8", atendente: "Rafael", descontoClube: 14.9,
    gatewayRef: "cmd_00602", data: diasAtras(96),
    itens: [{ nome: "Combinado do chef", quantidade: 1, preco: 99.9 }, { nome: "Niguiri de maracujá", quantidade: 1, preco: 34.9 }],
  },
  {
    id: "cons10", userId: "u_fabio", valor: 201.7, metodo: "pix", status: "aprovado",
    tipo: "consumo", mesa: "14", atendente: "Juliana", descontoClube: 22.4,
    gatewayRef: "cmd_00571", data: diasAtras(128),
    itens: [{ nome: "Filé gratinado", quantidade: 2, preco: 58 }, { nome: "Salmão grelhado", quantidade: 1, preco: 54.9 }, { nome: "Refrigerante", quantidade: 2, preco: 17.5 }],
  },
];

const horas = (n: number) => new Date(now.getTime() + n * 60 * 60 * 1000);

/**
 * Fotos do demo. São os mesmos arquivos de `app/assets/images` — o cliente vê a
 * mesma imagem no painel e no app.
 *
 * Ficam em `admin/public/demo/` e são referenciadas por caminho, não importadas:
 * arquivo em `public` sai do bundle e só é baixado se a tela pedir. Como fora do
 * modo demo nada aponta pra cá, a build de produção não carrega nenhuma delas.
 */
const foto = (nome: string) => `${import.meta.env.BASE_URL}demo/${nome}.jpg`;

// Espelha os mesmos casos do demo do app (app/lib/core/demo.dart): no ar
// terminando hoje, no ar com folga, sem prazo, agendada e encerrada.
const demoPromotions: Promotion[] = [
  { id: "promo1", titulo: "Rodízio com 20% OFF", descricao: "Toda quarta, rodízio completo com desconto pra assinantes.", ativa: true, apenasAssinantes: true, imagem: foto("hero"), validadeInicio: null, validadeFim: horas(6) },
  { id: "promo2", titulo: "Temaki em dobro", descricao: "Compre 1 temaki e leve 2 na sexta-feira.", ativa: true, apenasAssinantes: false, imagem: foto("nigiri_maracuja"), validadeInicio: null, validadeFim: horas(72) },
  { id: "promo3", titulo: "Combo família", descricao: "40 peças + 2 refrigerantes por um preço especial.", ativa: true, apenasAssinantes: false, imagem: foto("combinado"), validadeInicio: null, validadeFim: null },
  { id: "promo4", titulo: "Festival de sashimi", descricao: "Começa amanhã — sashimi especial a preço de entrada.", ativa: true, apenasAssinantes: false, imagem: foto("sashimi"), validadeInicio: horas(24), validadeFim: horas(120) },
  { id: "promo5", titulo: "Quarta do hot roll", descricao: "Promoção da semana passada, já encerrada.", ativa: true, apenasAssinantes: false, imagem: foto("salmao_chef"), validadeInicio: horas(-192), validadeFim: horas(-24) },
];

const demoRewards: Reward[] = [
  { id: "rw1", titulo: "Rodízio grátis", descricao: "Um rodízio completo por nossa conta.", tipo: "rodizio", estoque: 10, resgatavelAte: diasAtras(-3), imagem: null },
  { id: "rw2", titulo: "Sushi especial do chef", descricao: "Combinado exclusivo de 12 peças.", tipo: "prato", estoque: 20, resgatavelAte: diasAtras(-1), imagem: null },
  { id: "rw3", titulo: "Sorvete de matchá", descricao: "Sobremesa tradicional japonesa.", tipo: "sobremesa", estoque: 0, resgatavelAte: null, imagem: null },
  { id: "rw4", titulo: "Saquê de boas-vindas", descricao: "Brinde pra quem é sócio.", tipo: "cupom", estoque: 50, resgatavelAte: null, imagem: null },
];

const demoRedemptions: Redemption[] = [
  { id: "rd1", userId: "u_ana", rewardId: "rw2", rewardTitulo: "Sushi especial do chef", codigo: "A1B2C3D4E5F6", status: "disponivel", criadoEm: diasAtras(1) },
  { id: "rd2", userId: "u_carla", rewardId: "rw1", rewardTitulo: "Rodízio grátis", codigo: "F6E5D4C3B2A1", status: "disponivel", criadoEm: diasAtras(2) },
  { id: "rd3", userId: "u_gina", rewardId: "rw3", rewardTitulo: "Sorvete de matchá", codigo: "9Z8Y7X6W5V4U", status: "usado", criadoEm: diasAtras(9) },
];

// Plano único de R$ 4,90/mês — mesmos dados de `app/lib/core/demo.dart`.
const demoPlans: Plan[] = [
  {
    id: "p_mensal",
    nome: "PandaVip",
    preco: 4.9,
    intervalo: "mês",
    beneficios: [
      "Descontos e promoções exclusivas todo mês",
      "Prêmios e pratos liberados pelo restaurante",
      "Sobremesa grátis no seu aniversário",
      "Sem fidelidade — cancele quando quiser",
    ],
    recomendado: true,
  },
];

/** Equipe fictícia — chaves Pix de e-mail inventadas, nada real. */
const demoFuncionarios: Funcionario[] = [
  { id: "f_lucas", nome: "Lucas Ferreira", funcao: "Garçom", chavePix: "lucas.demo@exemplo.com", ativo: true, criadoEm: diasAtras(120) },
  { id: "f_marina", nome: "Marina Alves", funcao: "Garçonete", chavePix: "marina.demo@exemplo.com", ativo: true, criadoEm: diasAtras(80) },
  { id: "f_rafael", nome: "Rafael Tanaka", funcao: "Sushiman", chavePix: "rafael.demo@exemplo.com", ativo: true, criadoEm: diasAtras(200) },
  { id: "f_paulo", nome: "Paulo Ribeiro", funcao: "Garçom", chavePix: "paulo.demo@exemplo.com", ativo: false, criadoEm: diasAtras(300) },
];

const demoRestaurante: Restaurante = {
  nome: "Tio Panda",
  telefone: "551430000000",
  whatsapp: "5514990000000",
  endereco: "Tio Panda restaurante",
  cidade: "Bauru",
  politicaPrivacidadeUrl: "https://exemplo.com.br/privacidade",
  termosUrl: "https://exemplo.com.br/termos",
  playStoreUrl: "https://play.google.com/store/apps/details?id=com.tiopanda.clube",
  appStoreUrl: "https://apps.apple.com/app/id000000000",
};

// Cardápio do demo — mesmos pratos e mesmas fotos de `app/lib/core/demo.dart`.
const demoMenu: MenuItem[] = [
  { id: "m1", nome: "Combinado especial", descricao: "20 peças variadas: sashimi, uramaki e niguiri.", preco: 89.9, categoria: "Combinados & Sushi", imagem: foto("combinado_box"), destaque: true, disponivel: true, ordem: 1 },
  { id: "m2", nome: "Combinado do chef", descricao: "Seleção do dia feita pelo sushiman.", preco: 99.9, categoria: "Combinados & Sushi", imagem: foto("combinado_chef"), destaque: false, disponivel: true, ordem: 2 },
  { id: "m3", nome: "Sashimi premium", descricao: "Fatias generosas de salmão fresco.", preco: 62, categoria: "Combinados & Sushi", imagem: foto("sashimi"), destaque: true, disponivel: true, ordem: 3 },
  { id: "m4", nome: "Niguiri de maracujá", descricao: "Salmão maçaricado com toque de maracujá.", preco: 34.9, categoria: "Combinados & Sushi", imagem: foto("nigiri_maracuja"), destaque: false, disponivel: true, ordem: 4 },
  { id: "m5", nome: "Salmão grelhado", descricao: "Ao molho da casa, acompanha arroz.", preco: 54.9, categoria: "Salmão", imagem: foto("salmao"), destaque: true, disponivel: true, ordem: 10 },
  { id: "m6", nome: "Salmão no purê", descricao: "Filé grelhado sobre purê rústico e cogumelos.", preco: 58.9, categoria: "Salmão", imagem: foto("salmao_pure"), destaque: false, disponivel: true, ordem: 11 },
  { id: "m7", nome: "Strogonoff da casa", descricao: "Carne, arroz e batata palha.", preco: 44.9, categoria: "Pratos quentes", imagem: foto("strogonoff"), destaque: true, disponivel: true, ordem: 20 },
  { id: "m8", nome: "Filé gratinado", descricao: "Filé com queijo gratinado, fritas e refil.", preco: 58, categoria: "Pratos quentes", imagem: foto("file_gratinado"), destaque: true, disponivel: true, ordem: 21 },
  { id: "m9", nome: "Burguer Panda", descricao: "Pão crocante, queijo derretido e fritas.", preco: 39.9, categoria: "Lanches", imagem: foto("burger"), destaque: true, disponivel: true, ordem: 30 },
  // Fora do ar e sem foto de propósito: são os dois casos que o painel precisa
  // saber desenhar — prato desligado e prato que o dono ainda não fotografou.
  { id: "m10", nome: "Ceviche de salmão", descricao: "Cubos de salmão, limão siciliano e cebola roxa.", preco: 48.9, categoria: "Pratos quentes", imagem: null, destaque: false, disponivel: false, ordem: 22 },
];

// Histórico de disparos. `origem` distingue o que o dono escreveu do que saiu
// sozinho quando ele publicou uma promoção ou um prêmio.
const demoPushLogs: PushLog[] = [
  { id: "log1", titulo: "Temaki em dobro", corpo: "Compre 1 temaki e leve 2 na sexta-feira.", publico: "todos", enviados: 6, origem: "promocao", criadoEm: horasAtras(3) },
  { id: "log2", titulo: "Recado do Tio Panda", corpo: "Hoje o salão abre às 18h. Te esperamos!", publico: "todos", enviados: 7, origem: "manual", criadoEm: diasAtras(2) },
  { id: "log3", titulo: "Rodízio grátis", corpo: "Entrou prêmio novo no app. Resgate pelo celular e retire no salão.", publico: "assinantes", enviados: 4, origem: "premio", criadoEm: diasAtras(5) },
  { id: "log4", titulo: "Rodízio com 20% OFF", corpo: "Toda quarta, rodízio completo com desconto pra assinantes.", publico: "assinantes", enviados: 4, origem: "promocao", criadoEm: diasAtras(8) },
];

// Mapa caminho do documento -> dado mock.
export const demoDocs: Record<string, unknown> = {
  "config/restaurante": demoRestaurante,
  "config/app": { minBuild: 1 },
};

// Mapa caminho da coleção -> dados mock.
/** Minutos atrás. Deixa a lista de pedidos parecendo uma noite de verdade. */
const haMin = (m: number) => new Date(Date.now() - m * 60 * 1000);

// Um pedido em cada estado que o dono precisa saber reconhecer de relance:
// recém-chegado esperando aceite, um em rota com troco, uma retirada de balcão
// e um encerrado — que é como a linha fica quando não há mais o que fazer.
const demoPedidos: Pedido[] = [
  {
    id: "ped1",
    userId: "u1",
    nome: "Felipe Souza",
    telefone: "(14) 99911-0001",
    itens: [
      { itemId: "m1", nome: "Combinado especial", preco: 89.9, qtd: 1 },
      { itemId: "m9", nome: "Burguer Panda", preco: 39.9, qtd: 2, obs: "sem cebola" },
    ],
    total: 169.7,
    tipo: "entrega",
    endereco: "Rua das Flores, 123 - Centro",
    pagamento: "dinheiro",
    troco: 200,
    observacao: "Interfone quebrado, ligar ao chegar.",
    status: "novo",
    criadoEm: haMin(4),
  },
  {
    id: "ped2",
    userId: "u2",
    nome: "Marina Alves",
    telefone: "(14) 99911-0002",
    itens: [{ itemId: "m5", nome: "Salmão grelhado", preco: 54.9, qtd: 1 }],
    total: 54.9,
    tipo: "entrega",
    endereco: "Av. Brasil, 900 - Jardim Aeroporto",
    pagamento: "cartao_entrega",
    status: "saiu",
    criadoEm: haMin(38),
  },
  {
    id: "ped3",
    userId: "u3",
    nome: "Rogério Lima",
    telefone: "(14) 99911-0003",
    itens: [
      { itemId: "m3", nome: "Sashimi premium", preco: 62, qtd: 1 },
      { itemId: "m4", nome: "Niguiri de maracujá", preco: 34.9, qtd: 1 },
    ],
    total: 96.9,
    tipo: "retirada",
    pagamento: "pix_entrega",
    status: "preparando",
    criadoEm: haMin(15),
  },
  {
    id: "ped4",
    userId: "u1",
    nome: "Felipe Souza",
    telefone: "(14) 99911-0001",
    itens: [{ itemId: "m7", nome: "Strogonoff da casa", preco: 44.9, qtd: 2 }],
    total: 89.8,
    tipo: "entrega",
    endereco: "Rua das Flores, 123 - Centro",
    pagamento: "dinheiro",
    status: "entregue",
    criadoEm: haMin(180),
    statusEm: haMin(120),
  },
];

export const demoData: Record<string, unknown[]> = {
  users: demoUsers,
  subscriptions: demoSubs,
  payments: demoPayments,
  promotions: demoPromotions,
  rewards: demoRewards,
  redemptions: demoRedemptions,
  plans: demoPlans,
  menu: demoMenu,
  notificationLogs: demoPushLogs,
  funcionarios: demoFuncionarios,
  pedidos: demoPedidos,
};

// Usuário admin fake pro AuthContext no modo demo. O `displayName` é de onde a
// saudação de abertura tira o primeiro nome.
export const demoAdminUser = {
  uid: "u_admin",
  email: "admin@exemplo.com.br",
  displayName: "João Couto",
} as const;
