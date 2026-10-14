import 'package:cloud_firestore/cloud_firestore.dart';

/// Modelos das coleções Firestore do PandaVip.
/// Espelham o backend — mudou aqui, confira as rules e as Functions.

/// Pagar (assinar, pedir) é só para maiores de 18 anos; 14–17 usam a conta
/// grátis. O servidor também confere — isto só evita mostrar o botão.
const kMsgSo18 = 'Assinaturas e pedidos são só para maiores de 18 anos.';
const kMsgSemNascimento =
    'Informe sua data de nascimento no perfil para continuar.';

/// Tem 18 anos completos em [hoje]? Sem data = não.
bool maior18(DateTime? nascimento, {DateTime? hoje}) {
  if (nascimento == null) return false;
  final h = hoje ?? DateTime.now();
  final fez18 = DateTime(
    nascimento.year + 18,
    nascimento.month,
    nascimento.day,
  );
  return !fez18.isAfter(DateTime(h.year, h.month, h.day));
}

/// Mensagem que substitui o botão de pagar, ou `null` se pode pagar.
/// Perfil ainda carregando (`null`) não bloqueia: o servidor é a barreira.
String? bloqueioDePagamento(AppUser? u, {DateTime? hoje}) {
  if (u == null) return null;
  if (u.nascimento == null) return kMsgSemNascimento;
  return maior18(u.nascimento, hoje: hoje) ? null : kMsgSo18;
}

class AppUser {
  AppUser({
    required this.uid,
    required this.nome,
    required this.email,
    this.telefone = '',
    this.endereco,
    this.enderecoEntrega,
    this.fotoUrl,
    this.role,
    this.nascimento,
    this.codigoIndicacao,
    this.termosVersao,
    this.codigoSocio,
    this.indicacoes = 0,
    this.marketingOptIn,
    this.analyticsOptIn,
  });

  final String uid;
  final String nome;
  final String email;
  final String telefone;
  final String? endereco;

  /// Partes do endereço salvo pelo carrinho (cep, rua, numero…). Ver
  /// `features/cart/endereco.dart`.
  final Map<String, dynamic>? enderecoEntrega;
  final String? fotoUrl;
  final String? role;
  final DateTime? nascimento;

  /// Código pra indicar amigos (gerado sob demanda no backend).
  final String? codigoIndicacao;

  /// Versão dos termos que o sócio aceitou (ver `termosVersao` em auth_widgets).
  final String? termosVersao;

  /// Código curto da carteirinha, o que o atendente lê no PDV pra identificar
  /// o sócio. Nasce junto com a conta; contas antigas só têm depois do backfill.
  final String? codigoSocio;

  /// Quantos amigos já foram indicados por este usuário.
  final int indicacoes;

  /// Ofertas por push. Ausente = ligado para 18+ (o servidor nunca manda
  /// marketing a menor).
  final bool? marketingOptIn;

  /// Estatísticas de uso (Analytics/Crashlytics). Ausente = ligado para 18+,
  /// desligado para menores.
  final bool? analyticsOptIn;

  bool get isAdmin => role == 'admin';

  factory AppUser.fromDoc(DocumentSnapshot<Map<String, dynamic>> d) {
    final m = d.data() ?? {};
    return AppUser(
      uid: d.id,
      nome: m['nome'] ?? '',
      email: m['email'] ?? '',
      telefone: m['telefone'] ?? '',
      endereco: m['endereco'],
      enderecoEntrega: m['enderecoEntrega'] as Map<String, dynamic>?,
      fotoUrl: m['fotoUrl'],
      role: m['role'],
      nascimento: (m['nascimento'] as Timestamp?)?.toDate(),
      codigoIndicacao: m['codigoIndicacao'],
      termosVersao: m['termosVersao'] as String?,
      codigoSocio: m['codigoSocio'],
      indicacoes: (m['indicacoes'] ?? 0) as int,
      marketingOptIn: m['marketingOptIn'] as bool?,
      analyticsOptIn: m['analyticsOptIn'] as bool?,
    );
  }
}

/// Notificação (aviso/promo) exibida na central e enviada por push.
class AppNotification {
  AppNotification({
    required this.id,
    required this.titulo,
    required this.corpo,
    this.tipo = 'info',
    this.criadoEm,
    this.lida = false,
  });

  final String id;
  final String titulo;
  final String corpo;
  final String tipo; // promo | aniversario | info
  final DateTime? criadoEm;
  final bool lida;

  factory AppNotification.fromDoc(DocumentSnapshot<Map<String, dynamic>> d) {
    final m = d.data() ?? {};
    return AppNotification(
      id: d.id,
      titulo: m['titulo'] ?? '',
      corpo: m['corpo'] ?? '',
      tipo: m['tipo'] ?? 'info',
      criadoEm: (m['criadoEm'] as Timestamp?)?.toDate(),
      lida: m['lida'] ?? false,
    );
  }
}

class Plan {
  Plan({
    required this.id,
    required this.nome,
    required this.preco,
    required this.intervalo,
    this.beneficios = const [],
    this.recomendado = false,
  });

  final String id;
  final String nome;
  final double preco;
  final String
  intervalo; // mês | trimestre | ano (painel) ou mensal | trimestral | anual (seed)

  /// Meses por cobrança, nas duas grafias.
  int get meses =>
      const {
        'mensal': 1,
        'mês': 1,
        'trimestral': 3,
        'trimestre': 3,
        'anual': 12,
        'ano': 12,
      }[intervalo] ??
      1;

  /// Como aparece depois do preço: "R\$ 4,90 / mês".
  String get intervaloCurto =>
      const {1: 'mês', 3: 'trimestre', 12: 'ano'}[meses]!;
  final List<String> beneficios;
  final bool recomendado;

  factory Plan.fromDoc(DocumentSnapshot<Map<String, dynamic>> d) {
    final m = d.data() ?? {};
    return Plan(
      id: d.id,
      nome: m['nome'] ?? '',
      preco: (m['preco'] ?? 0).toDouble(),
      intervalo: m['intervalo'] ?? 'mensal',
      beneficios: List<String>.from(m['beneficios'] ?? const []),
      recomendado: m['recomendado'] ?? false,
    );
  }
}

class Promotion {
  Promotion({
    required this.id,
    required this.titulo,
    required this.descricao,
    this.imagem,
    this.ativa = true,
    this.apenasAssinantes = false,
    this.validadeInicio,
    this.validadeFim,
    this.itemId,
    this.descontoPct = 0,
  });

  final String id;
  final String titulo;
  final String descricao;
  final String? imagem;
  final bool ativa;
  final bool apenasAssinantes;

  /// Prato que a promoção barateia (do painel). Sem ele, é só aviso.
  final String? itemId;

  /// Desconto em %, 1 a 90. Só pra mostrar: quem aplica é o servidor.
  final int descontoPct;

  bool get temDesconto => itemId != null && descontoPct > 0;

  /// Início da janela. Nulo = já vale.
  final DateTime? validadeInicio;

  /// Fim da janela. Nulo = não expira.
  final DateTime? validadeFim;

  /// Está no ar neste instante? Recebe o "agora" de fora pra a Home poder
  /// reavaliar num relógio (ver `agoraProvider`) — usar `DateTime.now()` aqui
  /// dentro só reavaliaria quando o Firestore emitisse.
  bool vigenteEm(DateTime agora) {
    if (!ativa) return false;
    if (validadeInicio != null && agora.isBefore(validadeInicio!)) return false;
    if (validadeFim != null && agora.isAfter(validadeFim!)) return false;
    return true;
  }

  factory Promotion.fromDoc(DocumentSnapshot<Map<String, dynamic>> d) {
    final m = d.data() ?? {};
    return Promotion(
      id: d.id,
      titulo: m['titulo'] ?? '',
      descricao: m['descricao'] ?? '',
      imagem: m['imagem'],
      ativa: m['ativa'] ?? true,
      apenasAssinantes: m['apenasAssinantes'] ?? false,
      validadeInicio: (m['validadeInicio'] as Timestamp?)?.toDate(),
      validadeFim: (m['validadeFim'] as Timestamp?)?.toDate(),
      itemId: (m['itemId'] as String?)?.isNotEmpty == true
          ? m['itemId'] as String
          : null,
      descontoPct: (m['descontoPct'] as num?)?.toInt() ?? 0,
    );
  }
}

/// Prato do cardápio. Coleção `menu`, um doc por prato — a categoria é campo,
/// não subcoleção, pra tela inteira caber num `snapshots()` só.
class MenuItem {
  MenuItem({
    required this.id,
    required this.nome,
    this.descricao = '',
    this.preco = 0,
    this.categoria = 'Outros',
    this.imagem,
    this.destaque = false,
    this.disponivel = true,
    this.ordem = 0,
  });

  final String id;
  final String nome;
  final String descricao;

  /// Em reais. Guardado como número — quem formata é a tela.
  final double preco;
  final String categoria;
  final String? imagem;

  /// Aparece na vitrine "Destaques do cardápio" da Home.
  final bool destaque;

  /// Fora do ar sem apagar — pro dia em que acaba o peixe.
  final bool disponivel;

  /// Menor primeiro. Ordena o prato dentro da categoria, e a categoria pelo
  /// menor valor entre os pratos dela.
  final int ordem;

  String get precoFormatado =>
      'R\$ ${preco.toStringAsFixed(2).replaceAll('.', ',')}';

  factory MenuItem.fromDoc(DocumentSnapshot<Map<String, dynamic>> d) {
    final m = d.data() ?? {};
    return MenuItem(
      id: d.id,
      nome: m['nome'] ?? '',
      descricao: m['descricao'] ?? '',
      preco: (m['preco'] as num?)?.toDouble() ?? 0,
      categoria: (m['categoria'] as String?)?.trim().isNotEmpty == true
          ? m['categoria'] as String
          : 'Outros',
      imagem: m['imagem'],
      destaque: m['destaque'] ?? false,
      disponivel: m['disponivel'] ?? true,
      ordem: (m['ordem'] as num?)?.toInt() ?? 0,
    );
  }
}

/// Categoria montada em memória a partir dos pratos.
class MenuCategoria {
  const MenuCategoria({required this.nome, required this.itens});
  final String nome;
  final List<MenuItem> itens;
}

class Reward {
  Reward({
    required this.id,
    required this.titulo,
    required this.descricao,
    this.imagem,
    this.tipo = 'cupom',
    this.estoque = 0,
    this.resgatavelAte,
    this.valor = 0,
  });

  final String id;
  final String titulo;
  final String descricao;
  final String? imagem;
  final String tipo; // rodizio | prato | sobremesa | cupom
  final int estoque;

  /// Quanto o prêmio vale em reais (preço de cardápio). Alimenta o
  /// "você já economizou" na Home. Zero = não entra na conta.
  final double valor;

  /// Prazo limite pra resgatar (definido pelo dono). Nulo = sem prazo.
  final DateTime? resgatavelAte;

  /// Janela de resgate ainda aberta?
  bool noPrazoEm(DateTime agora) =>
      resgatavelAte == null || !agora.isAfter(resgatavelAte!);

  bool get noPrazo => noPrazoEm(DateTime.now());

  bool get disponivel => estoque > 0 && noPrazo;

  factory Reward.fromDoc(DocumentSnapshot<Map<String, dynamic>> d) {
    final m = d.data() ?? {};
    return Reward(
      id: d.id,
      titulo: m['titulo'] ?? '',
      descricao: m['descricao'] ?? '',
      imagem: m['imagem'],
      tipo: m['tipo'] ?? 'cupom',
      estoque: (m['estoque'] ?? 0) as int,
      resgatavelAte: (m['resgatavelAte'] as Timestamp?)?.toDate(),
      valor: (m['valor'] ?? 0).toDouble(),
    );
  }
}

class Redemption {
  Redemption({
    required this.id,
    required this.userId,
    required this.rewardId,
    required this.rewardTitulo,
    required this.codigo,
    required this.status,
    this.criadoEm,
    this.valor = 0,
    this.funcionarioId,
    this.funcionarioNome,
    this.usadoEm,
  });

  final String id;
  final String userId;
  final String rewardId;
  final String rewardTitulo;
  final String codigo;
  final String status; // disponivel | usado | expirado
  final DateTime? criadoEm;

  /// Valor do prêmio no momento do resgate (congelado). Se zero, o app
  /// cai no valor atual do reward correspondente.
  final double valor;

  /// Quem da Equipe entregou o prêmio (gravado pelo `validateRedemption`).
  /// É pra quem vai o convite de gorjeta.
  final String? funcionarioId;
  final String? funcionarioNome;
  final DateTime? usadoEm;

  factory Redemption.fromDoc(DocumentSnapshot<Map<String, dynamic>> d) {
    final m = d.data() ?? {};
    return Redemption(
      id: d.id,
      userId: m['userId'] ?? '',
      rewardId: m['rewardId'] ?? '',
      rewardTitulo: m['rewardTitulo'] ?? '',
      codigo: m['codigo'] ?? '',
      status: m['status'] ?? 'disponivel',
      criadoEm: (m['criadoEm'] as Timestamp?)?.toDate(),
      valor: (m['valor'] ?? 0).toDouble(),
      funcionarioId: m['funcionarioId'] as String?,
      funcionarioNome: m['funcionarioNome'] as String?,
      usadoEm: (m['usadoEm'] as Timestamp?)?.toDate(),
    );
  }
}

class Subscription {
  Subscription({
    required this.id,
    required this.userId,
    required this.planId,
    required this.status,
    this.proximaCobranca,
    this.formaPagamento,
    this.ativaAte,
    this.inicioEm,
  });

  final String id;
  final String userId;
  final String planId;
  final String status; // active | canceled | past_due | pending

  /// Quando a assinatura nasceu (1ª tentativa de pagamento).
  final DateTime? inicioEm;
  final DateTime? proximaCobranca;
  final String? formaPagamento;

  /// Até quando o Pix pago vale, ou o fim do período pago de um cartão
  /// cancelado. No cartão em dia é nulo: renova sozinho.
  final DateTime? ativaAte;

  bool get pix => formaPagamento == 'pix';

  /// Cartão cancelado pelo sócio que ainda vale até [ativaAte]: não cobra mais.
  bool get cancelada => !pix && ativaAte != null;

  /// `active` com [ativaAte] vencido espera a faxina de hora em hora no
  /// servidor: já não vale.
  bool get ativa =>
      status == 'active' &&
      !(ativaAte != null && !ativaAte!.isAfter(DateTime.now()));

  /// Cobrança recusada: o Mercado Pago ainda vai tentar de novo. Não dá
  /// benefício (por isso não entra em [ativa]), mas precisa aparecer na tela —
  /// e o cancelamento continua valendo.
  bool get pendente => status == 'past_due';

  /// Cartão cadastrado, mas a 1ª cobrança ainda não foi aprovada: sem
  /// benefícios (não entra em [ativa]).
  bool get aguardando => status == 'pending';

  /// Dentro dos 7 dias de desistência (CDC art. 49). Contado do início; quem
  /// decide de verdade é o servidor, a partir do 1º pagamento aprovado.
  bool get podeDesistir =>
      ativa &&
      inicioEm != null &&
      DateTime.now().difference(inicioEm!) <= const Duration(days: 7);

  factory Subscription.fromDoc(DocumentSnapshot<Map<String, dynamic>> d) {
    final m = d.data() ?? {};
    return Subscription(
      id: d.id,
      userId: m['userId'] ?? '',
      planId: m['planId'] ?? '',
      status: m['status'] ?? 'canceled',
      proximaCobranca: (m['proximaCobranca'] as Timestamp?)?.toDate(),
      formaPagamento: m['formaPagamento'],
      ativaAte: (m['ativaAte'] as Timestamp?)?.toDate(),
      inicioEm: (m['inicioEm'] as Timestamp?)?.toDate(),
    );
  }
}

/// Alguém da equipe que pode receber gorjeta, cadastrado pelo dono no painel.
///
/// A chave Pix fica visível pra qualquer sócio que resgatar um prêmio — por
/// isso o painel orienta a cadastrar chave aleatória, e não CPF ou telefone.
class Funcionario {
  const Funcionario({
    required this.id,
    required this.nome,
    required this.chavePix,
    this.funcao = '',
    this.ativo = true,
  });

  final String id;
  final String nome;

  /// Chave Pix de destino. O app não valida (não tem como): quem confere é o
  /// banco do cliente, que mostra o nome do favorecido antes de confirmar.
  final String chavePix;

  /// "Garçom", "Cozinha"… só pra ajudar o cliente a reconhecer quem o atendeu.
  final String funcao;

  /// Desligado some da lista do app sem perder o histórico do cadastro.
  final bool ativo;

  /// Dá pra receber gorjeta? Sem chave não adianta aparecer na lista.
  bool get recebeGorjeta => ativo && chavePix.trim().isNotEmpty;

  factory Funcionario.fromDoc(DocumentSnapshot<Map<String, dynamic>> d) {
    final m = d.data() ?? {};
    return Funcionario(
      id: d.id,
      nome: m['nome'] ?? '',
      chavePix: m['chavePix'] ?? '',
      funcao: m['funcao'] ?? '',
      ativo: m['ativo'] ?? true,
    );
  }
}

/// Um item dentro de um pedido, com nome e preço congelados no momento da
/// compra. O cardápio muda de preço; a comanda que já saiu, não.
class PedidoItem {
  const PedidoItem({
    required this.itemId,
    required this.nome,
    required this.preco,
    required this.qtd,
    this.obs = '',
  });

  final String itemId;
  final String nome;
  final double preco;
  final int qtd;
  final String obs;

  double get subtotal => preco * qtd;

  factory PedidoItem.fromMap(Map<String, dynamic> m) {
    return PedidoItem(
      itemId: m['itemId'] ?? '',
      nome: m['nome'] ?? '',
      preco: (m['preco'] as num?)?.toDouble() ?? 0,
      qtd: (m['qtd'] as num?)?.toInt() ?? 0,
      obs: m['obs'] ?? '',
    );
  }
}

/// Pedido de delivery ou retirada. Criado só pela Cloud Function `criarPedido`
/// — o app manda o que quer, nunca por quanto (ver functions/src/pedidos.ts).
class Pedido {
  const Pedido({
    required this.id,
    required this.userId,
    required this.itens,
    required this.total,
    required this.status,
    this.tipo = 'entrega',
    this.endereco = '',
    this.lojaNome = '',
    this.codigoEntrega = '',
    this.noPdv = false,
    this.pagamento = 'dinheiro',
    this.troco = 0,
    this.observacao = '',
    this.criadoEm,
  });

  final String id;
  final String userId;
  final List<PedidoItem> itens;
  final double total;

  /// novo | aceito | preparando | saiu | entregue | cancelado
  final String status;

  /// entrega | retirada
  final String tipo;
  final String endereco;

  /// Onde retirar (só em `retirada`).
  final String lojaNome;

  /// 4 dígitos que o entregador (ou o balcão) pede pra confirmar o pedido.
  final String codigoEntrega;

  /// A Starway já levou a comanda: cancelar agora só ligando (ver `cancelarPedido`).
  final bool noPdv;

  /// dinheiro | cartao_entrega | pix_entrega — tudo pago na entrega por
  /// enquanto. Pagar no app depende do checkout avulso do Mercado Pago.
  final String pagamento;
  final double troco;
  final String observacao;
  final DateTime? criadoEm;

  /// Ainda está acontecendo? Decide se aparece no topo como "em andamento".
  bool get emAndamento => status != 'entregue' && status != 'cancelado';

  String get totalFormatado =>
      'R\$ ${total.toStringAsFixed(2).replaceAll('.', ',')}';

  /// Rótulo pro sócio. Texto do dia a dia, não jargão de sistema.
  String get statusTexto => switch (status) {
    'novo' => 'Enviado para a cozinha',
    'aceito' => 'Pedido aceito',
    'preparando' => 'Preparando',
    'saiu' => tipo == 'retirada' ? 'Pronto para retirar' : 'Saiu para entrega',
    'entregue' => tipo == 'retirada' ? 'Retirado' : 'Entregue',
    'cancelado' => 'Cancelado',
    _ => status,
  };

  factory Pedido.fromDoc(DocumentSnapshot<Map<String, dynamic>> d) {
    final m = d.data() ?? {};
    return Pedido(
      id: d.id,
      userId: m['userId'] ?? '',
      itens: ((m['itens'] as List?) ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(PedidoItem.fromMap)
          .toList(),
      total: (m['total'] as num?)?.toDouble() ?? 0,
      status: m['status'] ?? 'novo',
      tipo: m['tipo'] ?? 'entrega',
      endereco: m['endereco'] ?? '',
      lojaNome: m['lojaNome'] ?? '',
      codigoEntrega: m['codigoEntrega'] ?? '',
      noPdv: m['exportadoEm'] != null,
      pagamento: m['pagamento'] ?? 'dinheiro',
      troco: (m['troco'] as num?)?.toDouble() ?? 0,
      observacao: m['observacao'] ?? '',
      criadoEm: (m['criadoEm'] as Timestamp?)?.toDate(),
    );
  }
}
