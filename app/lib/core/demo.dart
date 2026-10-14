import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/legacy.dart';
import 'package:firebase_auth/firebase_auth.dart';

import 'models/models.dart';
import 'services/services.dart';

/// Liga com: flutter run -d chrome --dart-define=DEMO=true
/// Bypassa Firebase (sem initializeApp) e injeta dados fictícios nas telas.
const bool kDemo = bool.fromEnvironment('DEMO', defaultValue: false);

/// No demo, controla se o usuário é sócio ativo (alterna as telas).
final demoIsSubscriber = StateProvider<bool>((_) => true);

final _demoUser = AppUser(
  uid: 'u_demo',
  nome: '', // prints da loja: sem nome de ninguém
  email: '',
  telefone: '(14) 99911-0001',
  nascimento: DateTime(1992, 7, 23),
);

/// Central de notificações (demo) — mais recentes primeiro.
final _notificacoesIniciais = [
  AppNotification(
    id: 'n1',
    titulo: 'Rodízio com 20% OFF',
    corpo: 'Toda quarta, rodízio completo com desconto pra sócios. Bora?',
    tipo: 'promo',
    criadoEm: DateTime.now().subtract(const Duration(hours: 2)),
  ),
  AppNotification(
    id: 'n2',
    titulo: 'Seu pedido saiu para entrega',
    corpo: 'O Combinado especial já está a caminho.',
    tipo: 'info',
    criadoEm: DateTime.now().subtract(const Duration(hours: 8)),
  ),
  AppNotification(
    id: 'n3',
    titulo: 'Novidade no cardápio',
    corpo: 'Salmão no purê rústico com cogumelos já está disponível.',
    tipo: 'info',
    criadoEm: DateTime.now().subtract(const Duration(days: 2)),
    lida: true,
  ),
  AppNotification(
    id: 'n4',
    titulo: 'Rodízio grátis liberado',
    corpo: 'Resgate até hoje às 22h na aba de prêmios. Corre!',
    tipo: 'promo',
    criadoEm: DateTime.now().subtract(const Duration(days: 5)),
    lida: true,
  ),
];

/// Notificações do demo em memória. Abrir a central marca todas como lidas —
/// sem isso o badge do sino ficava preso no número inicial a demo inteira.
class DemoNotificationsNotifier extends Notifier<List<AppNotification>> {
  @override
  List<AppNotification> build() => _notificacoesIniciais;

  void marcarTodasLidas() {
    if (state.every((n) => n.lida)) return;
    state = [
      for (final n in state)
        AppNotification(
          id: n.id,
          titulo: n.titulo,
          corpo: n.corpo,
          tipo: n.tipo,
          criadoEm: n.criadoEm,
          lida: true,
        ),
    ];
  }

  void remover(String id) => state = [
    for (final n in state)
      if (n.id != id) n,
  ];

  void limpar() => state = const [];
}

final demoNotificationsProvider =
    NotifierProvider<DemoNotificationsNotifier, List<AppNotification>>(
      DemoNotificationsNotifier.new,
    );

/// Promoções do demo. Cobre os quatro casos da janela de validade pra dar
/// pra conferir na tela que o prazo funciona: no ar terminando hoje, no ar
/// com folga, sem prazo, agendada (não aparece) e expirada (não aparece).
final _demoPromotions = [
  Promotion(
    id: 'promo1',
    titulo: 'Rodízio com 20% OFF',
    descricao: 'Toda quarta, rodízio completo com desconto pra assinantes.',
    ativa: true,
    apenasAssinantes: true,
    imagem: 'assets/images/hero.jpg',
    validadeFim: DateTime.now().add(const Duration(hours: 6)),
  ),
  Promotion(
    id: 'promo2',
    titulo: 'Temaki em dobro',
    descricao: 'Compre 1 temaki e leve 2 na sexta-feira.',
    ativa: true,
    apenasAssinantes: false,
    imagem: 'assets/images/nigiri_maracuja.jpg',
    validadeFim: DateTime.now().add(const Duration(days: 3)),
  ),
  Promotion(
    id: 'promo3',
    titulo: 'Combo família',
    descricao: '40 peças + 2 refrigerantes por um preço especial.',
    ativa: true,
    apenasAssinantes: false,
    imagem: 'assets/images/combinado.jpg',
  ),
  // Agendada: começa amanhã. Não deve aparecer na Home hoje.
  Promotion(
    id: 'promo4',
    titulo: 'Festival de sashimi',
    descricao: 'Começa amanhã — sashimi especial a preço de entrada.',
    ativa: true,
    apenasAssinantes: false,
    validadeInicio: DateTime.now().add(const Duration(days: 1)),
    validadeFim: DateTime.now().add(const Duration(days: 5)),
  ),
  // Expirada: terminou ontem. Não deve aparecer na Home.
  Promotion(
    id: 'promo5',
    titulo: 'Quarta do hot roll',
    descricao: 'Promoção da semana passada, já encerrada.',
    ativa: true,
    apenasAssinantes: false,
    validadeInicio: DateTime.now().subtract(const Duration(days: 8)),
    validadeFim: DateTime.now().subtract(const Duration(days: 1)),
  ),
];

/// Cardápio do demo. Mesma forma do que vem do Firestore — o que muda é só a
/// origem da imagem (asset local em vez de URL do Storage).
final _demoMenu = <MenuItem>[
  MenuItem(
    id: 'm1',
    nome: 'Combinado especial',
    descricao: '20 peças variadas: sashimi, uramaki e niguiri.',
    preco: 89.90,
    categoria: 'Combinados & Sushi',
    imagem: 'assets/images/combinado_box.jpg',
    destaque: true,
    ordem: 1,
  ),
  MenuItem(
    id: 'm2',
    nome: 'Combinado do chef',
    descricao: 'Seleção do dia feita pelo sushiman.',
    preco: 99.90,
    categoria: 'Combinados & Sushi',
    imagem: 'assets/images/combinado_chef.jpg',
    ordem: 2,
  ),
  MenuItem(
    id: 'm3',
    nome: 'Sashimi premium',
    descricao: 'Fatias generosas de salmão fresco.',
    preco: 62.00,
    categoria: 'Combinados & Sushi',
    imagem: 'assets/images/sashimi.jpg',
    destaque: true,
    ordem: 3,
  ),
  MenuItem(
    id: 'm4',
    nome: 'Niguiri de maracujá',
    descricao: 'Salmão maçaricado com toque de maracujá.',
    preco: 34.90,
    categoria: 'Combinados & Sushi',
    imagem: 'assets/images/nigiri_maracuja.jpg',
    ordem: 4,
  ),
  MenuItem(
    id: 'm5',
    nome: 'Salmão grelhado',
    descricao: 'Ao molho da casa, acompanha arroz.',
    preco: 54.90,
    categoria: 'Salmão',
    imagem: 'assets/images/salmao.jpg',
    destaque: true,
    ordem: 10,
  ),
  MenuItem(
    id: 'm6',
    nome: 'Salmão no purê',
    descricao: 'Filé grelhado sobre purê rústico e cogumelos.',
    preco: 58.90,
    categoria: 'Salmão',
    imagem: 'assets/images/salmao_pure.jpg',
    ordem: 11,
  ),
  MenuItem(
    id: 'm7',
    nome: 'Strogonoff da casa',
    descricao: 'Carne, arroz e batata palha.',
    preco: 44.90,
    categoria: 'Pratos quentes',
    imagem: 'assets/images/strogonoff.jpg',
    destaque: true,
    ordem: 20,
  ),
  MenuItem(
    id: 'm8',
    nome: 'Filé gratinado',
    descricao: 'Filé com queijo gratinado, fritas e refil.',
    preco: 58.00,
    categoria: 'Pratos quentes',
    imagem: 'assets/images/file_gratinado.jpg',
    destaque: true,
    ordem: 21,
  ),
  MenuItem(
    id: 'm9',
    nome: 'Burguer Panda',
    descricao: 'Pão crocante, queijo derretido e fritas.',
    preco: 39.90,
    categoria: 'Lanches',
    imagem: 'assets/images/burger.jpg',
    destaque: true,
    ordem: 30,
  ),
];

final _demoRewards = [
  Reward(
    id: 'rw1',
    titulo: 'Rodízio grátis',
    descricao: 'Um rodízio completo por nossa conta.',
    tipo: 'rodizio',
    estoque: 10,
    resgatavelAte: DateTime.now().add(const Duration(hours: 8)),
    imagem: 'assets/images/reward_rodizio.jpg',
    valor: 89.90,
  ),
  Reward(
    id: 'rw2',
    titulo: 'Sushi especial do chef',
    descricao: 'Combinado exclusivo de 12 peças.',
    tipo: 'prato',
    estoque: 20,
    resgatavelAte: DateTime.now().add(const Duration(days: 2)),
    imagem: 'assets/images/reward_sushi.jpg',
    valor: 74.90,
  ),
  Reward(
    id: 'rw3',
    titulo: 'Sorvete de matchá',
    descricao: 'Sobremesa tradicional japonesa.',
    tipo: 'sobremesa',
    estoque: 0,
    valor: 18.00,
  ),
  Reward(
    id: 'rw4',
    titulo: 'Combo delivery grátis',
    descricao: 'Uma entrega por nossa conta. #PandaLovers',
    tipo: 'cupom',
    estoque: 50,
    imagem: 'assets/images/reward_delivery.jpg',
    valor: 15.00,
  ),
];

// Plano único, baratinho — cabe no bolso de todo mundo.
final _demoPlans = [
  Plan(
    id: 'p_mensal',
    nome: 'PandaVip',
    preco: 4.90,
    intervalo: 'mês',
    beneficios: [
      'Descontos e promoções exclusivas todo mês',
      'Prêmios e pratos liberados pelo restaurante',
      'Sem fidelidade — cancele quando quiser',
    ],
    recomendado: true,
  ),
];

/// Histórico de resgates. Os `rw_hist*` são prêmios de campanhas passadas —
/// não estão mais na lista ativa, então não bloqueiam o resgate ao vivo de
/// `rw1` e `rw4` (que ficam livres pra demonstrar o fluxo completo).
final _resgatesIniciais = [
  Redemption(
    id: 'rd1',
    userId: 'u_demo',
    rewardId: 'rw2',
    rewardTitulo: 'Sushi especial do chef',
    codigo: 'A1B2C3D4E5F6',
    status: 'disponivel',
    criadoEm: DateTime.now().subtract(const Duration(days: 1)),
    valor: 74.90,
  ),
  Redemption(
    id: 'rd2',
    userId: 'u_demo',
    rewardId: 'rw3',
    rewardTitulo: 'Sorvete de matchá',
    codigo: '9Z8Y7X6W5V4U',
    status: 'usado',
    criadoEm: DateTime.now().subtract(const Duration(days: 9)),
    valor: 18.00,
  ),
  Redemption(
    id: 'rd3',
    userId: 'u_demo',
    rewardId: 'rw_hist1',
    rewardTitulo: 'Rodízio grátis',
    codigo: 'K3M9P2Q7R1T5',
    status: 'usado',
    criadoEm: DateTime.now().subtract(const Duration(days: 45)),
    valor: 89.90,
  ),
  Redemption(
    id: 'rd4',
    userId: 'u_demo',
    rewardId: 'rw_hist2',
    rewardTitulo: 'Combinado do chef',
    codigo: 'F8G4H6J2L0N3',
    status: 'usado',
    criadoEm: DateTime.now().subtract(const Duration(days: 78)),
    valor: 99.90,
  ),
  Redemption(
    id: 'rd5',
    userId: 'u_demo',
    rewardId: 'rw_hist3',
    rewardTitulo: 'Temaki especial',
    codigo: 'W2X5Y8Z1B4C7',
    status: 'usado',
    criadoEm: DateTime.now().subtract(const Duration(days: 120)),
    valor: 24.90,
  ),
  Redemption(
    id: 'rd6',
    userId: 'u_demo',
    rewardId: 'rw_hist4',
    rewardTitulo: 'Rodízio grátis',
    codigo: 'D6E1F9G3H7J0',
    status: 'usado',
    criadoEm: DateTime.now().subtract(const Duration(days: 160)),
    valor: 89.90,
  ),
];

/// Resgates do demo em memória. Resgatar um prêmio ao vivo entra aqui: o
/// cupom aparece no perfil e o valor soma no "você já economizou" da Home.
class DemoRedemptionsNotifier extends Notifier<List<Redemption>> {
  @override
  List<Redemption> build() => _resgatesIniciais;

  void adicionar(Redemption r) => state = [r, ...state];
}

final demoRedemptionsProvider =
    NotifierProvider<DemoRedemptionsNotifier, List<Redemption>>(
      DemoRedemptionsNotifier.new,
    );

/// Equipe fictícia da demonstração. As chaves são aleatórias e inventadas: no
/// restaurante de verdade cada pessoa cadastra a própria chave pelo painel.
const _demoFuncionarios = [
  Funcionario(
    id: 'f_lucas',
    nome: 'Lucas Ferreira',
    funcao: 'Garçom',
    chavePix: 'lucas.demo@exemplo.com',
  ),
  Funcionario(
    id: 'f_marina',
    nome: 'Marina Alves',
    funcao: 'Garçonete',
    chavePix: 'marina.demo@exemplo.com',
  ),
  Funcionario(
    id: 'f_rafael',
    nome: 'Rafael Tanaka',
    funcao: 'Sushiman',
    chavePix: 'rafael.demo@exemplo.com',
  ),
];

/// Overrides do Riverpod pro modo demo — substituem os streams do Firebase.
final demoOverrides = [
  funcionariosProvider.overrideWith((_) => Stream.value(_demoFuncionarios)),
  authStateProvider.overrideWith((_) => Stream<User?>.value(null)),
  currentUserProvider.overrideWith((_) => Stream.value(_demoUser)),
  promotionsProvider.overrideWith((_) => Stream.value(_demoPromotions)),
  notificationsProvider.overrideWith(
    (ref) => Stream.value(ref.watch(demoNotificationsProvider)),
  ),
  rewardsProvider.overrideWith((_) => Stream.value(_demoRewards)),
  menuProvider.overrideWith((_) => Stream.value(_demoMenu)),
  plansProvider.overrideWith((_) => Stream.value(_demoPlans)),
  redemptionsProvider.overrideWith(
    (ref) => Stream.value(ref.watch(demoRedemptionsProvider)),
  ),
  subscriptionProvider.overrideWith((ref) {
    final ativo = ref.watch(demoIsSubscriber);
    return Stream.value(
      ativo
          ? Subscription(
              id: 's_demo',
              userId: 'u_demo',
              planId: 'p_mensal',
              status: 'active',
              proximaCobranca: DateTime.now().add(const Duration(days: 22)),
              formaPagamento: 'cartao',
            )
          : null,
    );
  }),
];
