// Tipos espelhando as coleções Firestore (mesmo backend do app).

export interface AppUser {
  uid: string;
  nome: string;
  email: string;
  telefone?: string;
  endereco?: string | null;
  role?: string | null;
  criadoEm?: Date | null;
  /** Código curto da carteirinha, lido no PDV pra identificar o sócio. */
  codigoSocio?: string | null;
}

export interface Plan {
  id: string;
  nome: string;
  preco: number;
  /**
   * Aparece cru no app: `R$ 4,90 / mês` (plans_screen.dart). Por isso é o
   * substantivo do período, não o adjetivo — "mensal" imprimiria "/ mensal".
   */
  intervalo: "mês" | "trimestre" | "ano";
  beneficios: string[];
  recomendado?: boolean;
  ativo?: boolean;
  /**
   * Desconto do sócio no salão, em %. Só entra em cena quando o PDV fecha a
   * conta sem informar quanto descontou — aí o backend calcula por aqui
   * (functions/src/webhooks/pdv.ts). Vazio/0 = quem manda é sempre o PDV.
   */
  descontoPercentual?: number | null;
}

export interface Promotion {
  id: string;
  titulo: string;
  descricao: string;
  imagem?: string | null;
  ativa: boolean;
  apenasAssinantes: boolean;
  validadeInicio?: Date | null;
  validadeFim?: Date | null;
  /**
   * Prato que a promoção barateia. Com ele (e `descontoPct`), o app mostra
   * "Pedir com X% off" e o pedido sai com desconto — calculado no servidor
   * (`criarPedido`), nunca no app. Sem prato, a promoção é só aviso.
   */
  itemId?: string | null;
  /** Desconto em %, inteiro de 1 a 90. */
  descontoPct?: number | null;
}

/**
 * Prato do cardápio (coleção `menu`). Categoria é campo, não subcoleção — o
 * app monta as seções em memória a partir dela.
 */
export interface MenuItem {
  id: string;
  nome: string;
  descricao: string;
  /** Em reais, como número. Quem formata é a tela. */
  preco: number;
  categoria: string;
  imagem?: string | null;
  /** Aparece na vitrine "Destaques do cardápio" da Home do app. */
  destaque: boolean;
  /** Fora do ar sem apagar — pro dia em que acaba o peixe. */
  disponivel: boolean;
  /** Menor primeiro, dentro da categoria. */
  ordem: number;
  /** Número do prato, igual no app, no painel e na Starway (ex.: temaki = 24). */
  codigo?: number | null;
}

export type RewardTipo = "rodizio" | "prato" | "sobremesa" | "cupom";

export interface Reward {
  id: string;
  titulo: string;
  descricao: string;
  imagem?: string | null;
  tipo: RewardTipo;
  /** Quantos ainda estão livres. Calculado pelo gatilho, não escreva. */
  estoque: number;
  /** Quantos o dono quer disponíveis. É este que o formulário grava. */
  estoqueAlvo?: number;
  /**
   * Quanto o prêmio vale em reais (preço de cardápio). É o que alimenta o
   * "você já economizou" na Home do app (`app/lib/core/services/services.dart`).
   * Zero = não entra na conta.
   */
  valor?: number;
  /** Prazo limite pra resgatar (definido pelo dono). Nulo = sem prazo. */
  resgatavelAte?: Date | null;
}

export interface Redemption {
  id: string;
  userId: string;
  rewardId: string;
  rewardTitulo: string;
  codigo: string;
  status: "disponivel" | "usado" | "expirado";
  criadoEm?: Date | null;
}

export interface Subscription {
  id: string;
  userId: string;
  planId: string;
  status: "active" | "canceled" | "past_due" | "pending";
  proximaCobranca?: Date | null;
  formaPagamento?: string | null;
}

/**
 * Doc `config/restaurante`. Espelha `app/lib/core/restaurante.dart` — a ideia é
 * o app passar a ler daqui em vez das constantes compiladas.
 */
/**
 * Alguém da equipe habilitado a receber gorjeta por Pix (coleção
 * `funcionarios`). O cliente escolhe o nome no app depois de resgatar um
 * prêmio, e o dinheiro vai direto pra chave — o restaurante não intermedeia.
 */
export interface Funcionario {
  id: string;
  nome: string;
  /** Chave Pix de destino. Deve ser chave aleatória: fica visível pros sócios. */
  chavePix: string;
  /** "Garçom", "Sushiman"… ajuda o cliente a reconhecer quem o atendeu. */
  funcao?: string;
  /** Desligado some da lista do app sem apagar o cadastro. */
  ativo: boolean;
  criadoEm?: Date;
}

export interface Restaurante {
  nome: string;
  /** Telefone pra ligação, só dígitos com DDI: 5514... */
  telefone: string;
  /** WhatsApp no formato wa.me, só dígitos com DDI. */
  whatsapp: string;
  /** Endereço usado na busca do Google Maps. */
  endereco: string;
  /** Cidade do recebedor no código Pix da gorjeta (campo exigido pelo padrão
   *  do Banco Central, no máximo 15 caracteres sem acento). */
  cidade: string;
  politicaPrivacidadeUrl: string;
  termosUrl: string;
  playStoreUrl: string;
  appStoreUrl: string;
  /** Horário do delivery, um por dia: `{ ter: "18:00-23:30" }`. Dia ausente ou
   *  em branco = fechado. Fim menor que o início atravessa a meia-noite. */
  horarios?: Record<string, string>;
  /** Interruptor de emergência: corta pedido agora sem mexer no horário. */
  pedidosPausados?: boolean;
  /** Taxa de entrega fixa, em reais. Só entra em pedido de entrega. */
  taxaEntrega?: number;
  mercadoPagoPublicKey?: string;
}

/**
 * Registro de um disparo de aviso (coleção `notificationLogs`, escrita só pelas
 * Cloud Functions). Sem isso a tela de Notificações é um formulário cego: manda
 * e nunca mostra o que já foi mandado.
 */
export interface PushLog {
  id: string;
  titulo: string;
  corpo: string;
  publico: "todos" | "assinantes";
  /** Aparelhos que aceitaram a entrega. */
  enviados: number;
  /** Quem disparou: o dono no painel, ou o gatilho de promoção/prêmio novo. */
  origem: "manual" | "promocao" | "premio";
  criadoEm?: Date | null;
}

/** Uma linha da comanda. Só existe em cobrança de consumo no salão. */
export interface ItemConsumo {
  nome: string;
  quantidade: number;
  /** Preço unitário em reais. */
  preco: number;
}

export interface Payment {
  id: string;
  userId: string;
  valor: number;
  metodo: "cartao" | "pix" | "dinheiro";
  status: string;
  gatewayRef?: string | null;
  data?: Date | null;

  /**
   * De onde veio o dinheiro. `assinatura` é a mensalidade do clube, cobrada
   * pelo gateway — é o que existe hoje. `consumo` é conta fechada no salão e
   * **só aparece se o sistema de comanda do restaurante gravar aqui**; sem essa
   * integração os campos abaixo nunca vêm preenchidos. Cobrança antiga, sem o
   * campo, é tratada como assinatura.
   */
  tipo?: "assinatura" | "consumo";
  /** Mesa ou comanda, quando a cobrança nasceu no salão. */
  mesa?: string | null;
  /** Quem atendeu. */
  atendente?: string | null;
  /** O que foi consumido — é a resposta pra "onde foi gasto". */
  itens?: ItemConsumo[] | null;
  /** Quanto o cliente economizou por ser do clube, em reais. */
  descontoClube?: number | null;
  /**
   * Só em `consumo`: `pdv` veio da integração, `manual` foi digitado no painel.
   * Número conferido por máquina e número conferido por gente têm peso
   * diferente na hora de fechar o mês.
   */
  origem?: "pdv" | "manual";
}

/** Um item dentro de um pedido, com nome e preço congelados na compra. */
export interface PedidoItem {
  itemId: string;
  nome: string;
  preco: number;
  qtd: number;
  obs?: string;
  codigo?: number | null;
  /** Só em linha que veio de promoção: `preco` já é o com desconto. */
  promoId?: string;
  descontoPct?: number;
  precoOriginal?: number;
}

/**
 * Pedido de delivery ou retirada, feito no app.
 *
 * Nasce só pela Cloud Function `criarPedido` (o total é calculado no servidor,
 * lendo `menu`), e o status muda por `mudarStatusPedido`. O painel não escreve
 * nada aqui direto — as rules barram.
 */
export interface Pedido {
  id: string;
  userId: string;
  /** Nome e telefone congelados: é o que vai na comanda do entregador. */
  nome: string;
  telefone: string;
  itens: PedidoItem[];
  total: number;
  taxaEntrega?: number;
  tipo: "entrega" | "retirada";
  /** Só em retirada: em qual balcão o cliente busca. */
  lojaNome?: string;
  endereco?: string;
  pagamento: "dinheiro" | "cartao_entrega" | "pix_entrega";
  /** Só em dinheiro: pra quanto o cliente pediu troco. 0 = não pediu. */
  troco?: number;
  observacao?: string;
  /** 4 dígitos que o entregador pede ao cliente para confirmar a entrega. */
  codigoEntrega?: string;
  status: "novo" | "aceito" | "preparando" | "saiu" | "entregue" | "cancelado";
  statusEm?: Date | null;
  criadoEm?: Date | null;
  /**
   * Quando o conector da Starway levou este pedido pro PDV. Nulo enquanto a
   * integração não existir — é o que o endpoint de polling vai marcar.
   */
  exportadoEm?: Date | null;
}
