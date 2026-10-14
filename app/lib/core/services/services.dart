import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/models.dart';

/// Instâncias Firebase (região das Functions = southamerica-east1).
final firebaseAuthProvider = Provider((_) => FirebaseAuth.instance);
final firestoreProvider = Provider((_) => FirebaseFirestore.instance);
final functionsProvider = Provider(
  (_) => FirebaseFunctions.instanceFor(region: 'southamerica-east1'),
);
final storageProvider = Provider((_) => FirebaseStorage.instance);

/// Stream do estado de autenticação.
final authStateProvider = StreamProvider<User?>((ref) {
  return ref.watch(firebaseAuthProvider).authStateChanges();
});

/// Doc do usuário logado em tempo real.
final currentUserProvider = StreamProvider<AppUser?>((ref) {
  final auth = ref.watch(authStateProvider).value;
  if (auth == null) return Stream.value(null);
  return ref
      .watch(firestoreProvider)
      .collection('users')
      .doc(auth.uid)
      .snapshots()
      .map((d) => d.exists ? AppUser.fromDoc(d) : null);
});

/// Promoções ativas em tempo real. Vem tudo que o dono deixou ligado — a
/// janela de validade é aplicada em [promocoesVigentesProvider].
final promotionsProvider = StreamProvider<List<Promotion>>((ref) {
  return ref
      .watch(firestoreProvider)
      .collection('promotions')
      .where('ativa', isEqualTo: true)
      .snapshots()
      .map((s) => s.docs.map(Promotion.fromDoc).toList());
});

/// Relógio do app: emite agora e a cada 30s.
///
/// Sem isso uma oferta que vence com o app aberto continuaria na tela até o
/// Firestore emitir de novo — e ele não emite, porque nada mudou no banco.
final agoraProvider = StreamProvider<DateTime>((ref) async* {
  yield DateTime.now();
  yield* Stream.periodic(const Duration(seconds: 30), (_) => DateTime.now());
});

/// Promoções no ar neste instante: dentro da janela que o dono definiu.
/// Ordena por quem termina antes (nulo = sem prazo, vai pro fim).
final promocoesVigentesProvider = Provider<AsyncValue<List<Promotion>>>((ref) {
  final agora = ref.watch(agoraProvider).value ?? DateTime.now();
  return ref.watch(promotionsProvider).whenData((list) {
    final vigentes = list.where((p) => p.vigenteEm(agora)).toList();
    vigentes.sort((a, b) {
      if (a.validadeFim == null && b.validadeFim == null) return 0;
      if (a.validadeFim == null) return 1;
      if (b.validadeFim == null) return -1;
      return a.validadeFim!.compareTo(b.validadeFim!);
    });
    return vigentes;
  });
});

/// Premiações disponíveis em tempo real.
final rewardsProvider = StreamProvider<List<Reward>>((ref) {
  return ref
      .watch(firestoreProvider)
      .collection('rewards')
      .snapshots()
      .map((s) => s.docs.map(Reward.fromDoc).toList());
});

/// Cardápio: só o que está disponível. Sem `orderBy` na query pra não exigir
/// índice composto — a ordenação acontece em memória, que aqui é barato.
final menuProvider = StreamProvider<List<MenuItem>>((ref) {
  return ref
      .watch(firestoreProvider)
      .collection('menu')
      .where('disponivel', isEqualTo: true)
      .snapshots()
      .map((s) => s.docs.map(MenuItem.fromDoc).toList());
});

/// Cardápio agrupado por categoria. Prato ordena por `ordem` e desempata pelo
/// nome; a categoria entra na posição do menor `ordem` que ela tem dentro.
final cardapioProvider = Provider<AsyncValue<List<MenuCategoria>>>((ref) {
  return ref.watch(menuProvider).whenData((itens) {
    final porCategoria = <String, List<MenuItem>>{};
    for (final i in itens) {
      porCategoria.putIfAbsent(i.categoria, () => []).add(i);
    }
    for (final lista in porCategoria.values) {
      lista.sort((a, b) {
        final c = a.ordem.compareTo(b.ordem);
        return c != 0 ? c : a.nome.compareTo(b.nome);
      });
    }
    final categorias = porCategoria.entries
        .map((e) => MenuCategoria(nome: e.key, itens: e.value))
        .toList();
    categorias.sort((a, b) {
      final c = a.itens.first.ordem.compareTo(b.itens.first.ordem);
      return c != 0 ? c : a.nome.compareTo(b.nome);
    });
    return categorias;
  });
});

/// Vitrine da Home: os pratos marcados como destaque, na mesma ordem.
final destaquesProvider = Provider<AsyncValue<List<MenuItem>>>((ref) {
  return ref.watch(menuProvider).whenData((itens) {
    final destaques = itens.where((i) => i.destaque).toList();
    destaques.sort((a, b) {
      final c = a.ordem.compareTo(b.ordem);
      return c != 0 ? c : a.nome.compareTo(b.nome);
    });
    return destaques;
  });
});

/// Equipe que pode receber gorjeta. Sem `orderBy` na query pra não exigir
/// índice composto; ordena em memória, que numa lista de funcionários é nada.
final funcionariosProvider = StreamProvider<List<Funcionario>>((ref) {
  return ref
      .watch(firestoreProvider)
      .collection('funcionarios')
      .where('ativo', isEqualTo: true)
      .snapshots()
      .map((s) {
        final lista = s.docs
            .map(Funcionario.fromDoc)
            .where((f) => f.recebeGorjeta)
            .toList();
        lista.sort(
          (a, b) => a.nome.toLowerCase().compareTo(b.nome.toLowerCase()),
        );
        return lista;
      });
});

/// Pedidos do sócio, mais recentes primeiro.
///
/// Sem `orderBy` na query pra não exigir índice composto — ordena em memória,
/// como os resgates. Sem `limit` também: o sócio quer o histórico inteiro, e
/// esta lista só é lida na tela de pedidos, não na abertura do app. Se um dia
/// pesar, o corte é por data, não por quantidade.
///
/// `criadoEm` nulo vai pro topo de propósito: é o pedido que acabou de sair
/// daqui e ainda não recebeu o carimbo do servidor.
final pedidosProvider = StreamProvider<List<Pedido>>((ref) {
  final auth = ref.watch(authStateProvider).value;
  if (auth == null) return Stream.value(const []);
  return ref
      .watch(firestoreProvider)
      .collection('pedidos')
      .where('userId', isEqualTo: auth.uid)
      .snapshots()
      .map((s) {
        final lista = s.docs.map(Pedido.fromDoc).toList();
        lista.sort((a, b) {
          final da = a.criadoEm, db = b.criadoEm;
          if (da == null && db == null) return 0;
          if (da == null) return -1;
          if (db == null) return 1;
          return db.compareTo(da);
        });
        return lista;
      });
});

/// O pedido que ainda está rolando, se houver. É o que a Home mostra no topo.
final pedidoEmAndamentoProvider = Provider<Pedido?>((ref) {
  final lista = ref.watch(pedidosProvider).value ?? const [];
  for (final p in lista) {
    if (p.emAndamento) return p;
  }
  return null;
});

/// Planos (vitrine).
final plansProvider = StreamProvider<List<Plan>>((ref) {
  return ref
      .watch(firestoreProvider)
      .collection('plans')
      .snapshots()
      .map((s) => s.docs.map(Plan.fromDoc).toList());
});

/// Assinatura do usuário: a ativa, ou a que está com cobrança pendente (ou
/// aguardando a 1ª cobrança do cartão).
///
/// Filtrar `status == 'active'` no banco escondia o `past_due` — quem estava
/// com o cartão recusado via a tela de planos como se nunca tivesse assinado,
/// sem aviso e sem botão de cancelar, enquanto o servidor recusava assinar de
/// novo. Sócio tem um punhado de documentos aqui, então vêm todos e a escolha
/// é local: ativa na frente, pendente depois, o resto não interessa.
final subscriptionProvider = StreamProvider<Subscription?>((ref) {
  final auth = ref.watch(authStateProvider).value;
  if (auth == null) return Stream.value(null);
  return ref
      .watch(firestoreProvider)
      .collection('subscriptions')
      .where('userId', isEqualTo: auth.uid)
      .snapshots()
      .map((s) {
        final assinaturas = s.docs.map(Subscription.fromDoc).toList();
        for (final a in assinaturas) {
          if (a.ativa) return a;
        }
        for (final a in assinaturas) {
          if (a.pendente || a.aguardando) return a;
        }
        return null;
      });
});

/// Se o usuário é assinante ativo.
final isSubscriberProvider = Provider<bool>((ref) {
  return ref.watch(subscriptionProvider).value?.ativa ?? false;
});

/// Quantos avisos a central carrega de uma vez.
///
/// A subcoleção cresce **para sempre**: cada push que o dono manda grava um
/// documento por sócio, e nada apaga. Sem teto, abrir o app passava a custar
/// uma leitura por aviso já recebido na vida — medido em 307 leituras por
/// abertura num sócio com 300 avisos, contra 19 num sócio novo. Ninguém rola
/// dois anos de histórico; quem quiser o resto tem o botão no fim da lista.
const kLimiteAvisos = 50;

/// Notificações do usuário (central de avisos), mais recentes primeiro.
final notificationsProvider = StreamProvider<List<AppNotification>>((ref) {
  final auth = ref.watch(authStateProvider).value;
  if (auth == null) return Stream.value(const []);
  return ref
      .watch(firestoreProvider)
      .collection('users')
      .doc(auth.uid)
      .collection('notifications')
      .orderBy('criadoEm', descending: true)
      .limit(kLimiteAvisos)
      .snapshots()
      .map((s) => s.docs.map(AppNotification.fromDoc).toList());
});

/// Quantidade de notificações não lidas (badge do sino).
///
/// Conta dentro dos [kLimiteAvisos] carregados. Passar disso exigiria uma
/// consulta de contagem separada, e o badge é decoração: quem tem mais de 50
/// avisos não lidos já entendeu o recado.
final unreadCountProvider = Provider<int>((ref) {
  final list = ref.watch(notificationsProvider).value ?? const [];
  return list.where((n) => !n.lida).length;
});

/// Resgates do usuário.
///
/// Sem `limit` **de propósito**, ao contrário da central de avisos. Dois
/// motivos: `redeemReward` só deixa resgatar cada prêmio uma vez, então o
/// tamanho da lista é o número de prêmios que o dono já cadastrou na vida (não
/// cresce por uso); e [economiaProvider] soma esta lista inteira pra dizer
/// quanto o sócio já economizou — cortar aqui faria o app mostrar um número
/// menor do que a verdade, em silêncio. Se um dia isso pesar, o caminho é
/// guardar o total acumulado no doc do sócio, não limitar a consulta.
final redemptionsProvider = StreamProvider<List<Redemption>>((ref) {
  final auth = ref.watch(authStateProvider).value;
  if (auth == null) return Stream.value(const []);
  return ref
      .watch(firestoreProvider)
      .collection('redemptions')
      .where('userId', isEqualTo: auth.uid)
      .snapshots()
      .map((s) => s.docs.map(Redemption.fromDoc).toList());
});

/// Quanto o sócio já economizou com os prêmios que resgatou.
/// Usa o valor congelado no resgate; se não houver, o valor atual do prêmio.
final economiaProvider = Provider<({double total, int resgates})>((ref) {
  final resgates = ref.watch(redemptionsProvider).value ?? const [];
  final premios = ref.watch(rewardsProvider).value ?? const [];

  var total = 0.0;
  for (final r in resgates) {
    if (r.valor > 0) {
      total += r.valor;
      continue;
    }
    for (final p in premios) {
      if (p.id == r.rewardId) {
        total += p.valor;
        break;
      }
    }
  }
  return (total: total, resgates: resgates.length);
});
