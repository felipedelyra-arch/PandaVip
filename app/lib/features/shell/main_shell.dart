import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/services/services.dart';
import '../../core/theme/colors.dart';
import '../rewards/gorjeta_sheet.dart';

/// Casca com bottom navigation. Início, Cardápio, Prêmios, Perfil.
///
/// Cardápio tomou o lugar de Planos: pedir comida é o que se faz toda semana,
/// trocar de plano quase nunca. Planos continua a um toque, pelo atalho
/// "Meu plano" da Início e pelo banner de assinatura.
class MainShell extends ConsumerStatefulWidget {
  const MainShell({super.key, required this.child});

  final Widget child;

  @override
  ConsumerState<MainShell> createState() => _MainShellState();
}

class _MainShellState extends ConsumerState<MainShell> {
  static const _tabs = ['/home', '/cardapio', '/premiacoes', '/perfil'];

  int _indexFor(String location) {
    // Planos é assunto da conta: acende Perfil em vez de fingir que é Início.
    if (location.startsWith('/planos')) return 3;
    final i = _tabs.indexWhere((t) => location.startsWith(t));
    return i < 0 ? 0 : i;
  }

  /// Quando o voltar do celular foi tocado na Home pela última vez.
  DateTime? _voltarNaHome;

  /// O que o botão voltar do Android faz numa aba.
  ///
  /// Sem isto o app fechava a qualquer toque no voltar, de qualquer aba: as
  /// abas trocam com `context.go`, que substitui a pilha em vez de empilhar,
  /// então não sobra nada pra desempilhar e o sistema encerra o app. Quem
  /// estava em Prêmios e quis voltar pra Home era jogado pra fora.
  ///
  /// Fora da Home, voltar leva pra Home. Na Home, exige dois toques — é o que
  /// impede o toque distraído de fechar o app com a sacola montada dentro.
  void _aoVoltar(bool didPop) {
    if (didPop) return;

    final location = GoRouterState.of(context).uri.path;
    if (location != '/home') {
      context.go('/home');
      return;
    }

    final agora = DateTime.now();
    final recente =
        _voltarNaHome != null &&
        agora.difference(_voltarNaHome!) < const Duration(seconds: 2);
    if (recente) {
      SystemNavigator.pop();
      return;
    }
    _voltarNaHome = agora;
    ScaffoldMessenger.of(context).clearSnackBars();
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Toque em voltar de novo para sair'),
        duration: Duration(seconds: 2),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    // Garçom validou o prêmio na mesa: o resgate passa de disponível a usado
    // com o nome de quem atendeu, e a gorjeta abre sozinha, em qualquer aba —
    // é o instante em que o cliente está com o celular na mão (como o iFood
    // faz ao fim da entrega). Com o cache do Firestore, abrir o app depois
    // também mostra a virada (cache "disponível", servidor "usado"): o
    // `usadoEm` recente é o que impede convite velho.
    ref.listen(redemptionsProvider, (antes, depois) {
      final anteriores = {
        for (final r in antes?.value ?? const []) r.id: r.status,
      };
      for (final r in depois.value ?? const []) {
        if (r.status == 'usado' &&
            anteriores[r.id] == 'disponivel' &&
            r.funcionarioId != null &&
            r.usadoEm != null &&
            DateTime.now().difference(r.usadoEm!) <
                const Duration(minutes: 10)) {
          mostrarGorjetaPara(context, r);
          break;
        }
      }
    });

    final location = GoRouterState.of(context).uri.path;
    final index = _indexFor(location);

    final isDark = Theme.of(context).brightness == Brightness.dark;
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) => _aoVoltar(didPop),
      child: Scaffold(
        body: widget.child,
        bottomNavigationBar: Container(
          decoration: BoxDecoration(
            border: Border(
              top: BorderSide(
                color: isDark ? PandaColors.hairlineDark : PandaColors.hairline,
              ),
            ),
          ),
          child: NavigationBar(
            selectedIndex: index,
            onDestinationSelected: (i) {
              HapticFeedback.selectionClick();
              context.go(_tabs[i]);
            },
            destinations: const [
              NavigationDestination(
                icon: Icon(Icons.home_outlined),
                selectedIcon: Icon(Icons.home_rounded),
                label: 'Início',
              ),
              NavigationDestination(
                icon: Icon(Icons.restaurant_menu_outlined),
                selectedIcon: Icon(Icons.restaurant_menu_rounded),
                label: 'Cardápio',
              ),
              NavigationDestination(
                icon: Icon(Icons.card_giftcard_outlined),
                selectedIcon: Icon(Icons.card_giftcard_rounded),
                label: 'Prêmios',
              ),
              NavigationDestination(
                icon: Icon(Icons.person_outline_rounded),
                selectedIcon: Icon(Icons.person_rounded),
                label: 'Perfil',
              ),
            ],
          ),
        ),
      ),
    );
  }
}
