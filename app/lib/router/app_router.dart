import 'package:firebase_analytics/firebase_analytics.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/services/services.dart';
import '../core/app_prefs.dart';
import '../core/demo.dart';
import '../features/onboarding/onboarding_screen.dart';
import '../features/auth/login_screen.dart';
import '../features/auth/signup_screen.dart';
import '../features/auth/auth_perfil.dart';
import '../features/auth/verificar_email_screen.dart';
import '../features/auth/completar_perfil_screen.dart';
import '../features/shell/main_shell.dart';
import '../features/home/home_screen.dart';
import '../features/rewards/rewards_screen.dart';
import '../features/subscription/plans_screen.dart';
import '../features/profile/profile_screen.dart';
import '../features/settings/settings_screen.dart';
import '../features/menu/menu_screen.dart';
import '../features/cart/carrinho_screen.dart';
import '../features/cart/pedidos_screen.dart';
import '../features/notifications/notifications_screen.dart';

/// Router com guarda de autenticação e de onboarding.
/// Sem onboarding visto => manda pra /onboarding. Sem sessão => /login.
final routerProvider = Provider<GoRouter>((ref) {
  final authState = ref.watch(authStateProvider);
  final vistoOnboardingInicial = ref.read(onboardingSeenProvider);

  return GoRouter(
    initialLocation: !vistoOnboardingInicial
        ? '/onboarding'
        : (kDemo ? '/login' : '/home'),
    // Analytics de navegação (screen_view). Só fora do demo (precisa de Firebase).
    observers: [
      if (!kDemo)
        FirebaseAnalyticsObserver(analytics: FirebaseAnalytics.instance),
    ],
    refreshListenable: _AuthListenable(ref),
    redirect: (context, state) {
      final noOnboarding = state.matchedLocation == '/onboarding';
      final vistoOnboarding = ref.read(onboardingSeenProvider);

      // Ainda não viu o tour: força o onboarding.
      if (!vistoOnboarding) return noOnboarding ? null : '/onboarding';
      // Já viu, mas está na tela de onboarding: sai dela.
      if (noOnboarding) {
        if (kDemo) return '/login';
        return authState.value != null ? '/home' : '/login';
      }

      if (kDemo) return null; // demo: sem guarda de auth, navega livre

      final loggingIn =
          state.matchedLocation == '/login' ||
          state.matchedLocation == '/signup';
      final signedIn = authState.value != null;

      if (!signedIn) return loggingIn ? null : '/login';

      // Ordem importa: primeiro confirma quem é, depois pede o que falta.

      // 1) E-mail não confirmado (só quem entrou por e-mail/senha). Prende
      // aqui até o link ser aberto — é o que impede cadastro com e-mail de
      // outra pessoa ou inventado.
      const rotaVerificar = '/verificar-email';
      if (ref.read(precisaVerificarEmailProvider)) {
        return state.matchedLocation == rotaVerificar ? null : rotaVerificar;
      }
      if (state.matchedLocation == rotaVerificar) return '/home';

      // 2) Perfil sem telefone ou nascimento — o caso de quem entrou pelo
      // Google, que não informa nenhum dos dois.
      //
      // `null` = o doc ainda não chegou do Firestore. Não desvia: tratar
      // carregamento como "incompleto" jogaria todo mundo no formulário a
      // cada abertura do app.
      const rotaCompletar = '/completar-perfil';
      final completo = ref.read(perfilCompletoProvider);
      if (completo == false) {
        return state.matchedLocation == rotaCompletar ? null : rotaCompletar;
      }
      if (state.matchedLocation == rotaCompletar && completo == true) {
        return '/home';
      }

      if (loggingIn) return '/home';
      return null;
    },
    routes: [
      GoRoute(path: '/onboarding', builder: (_, _) => const OnboardingScreen()),
      GoRoute(path: '/login', builder: (_, _) => const LoginScreen()),
      GoRoute(path: '/signup', builder: (_, _) => const SignupScreen()),
      GoRoute(
        path: '/verificar-email',
        builder: (_, _) => const VerificarEmailScreen(),
      ),
      GoRoute(
        path: '/completar-perfil',
        builder: (_, _) => const CompletarPerfilScreen(),
      ),
      // Telas em foco (sem bottom nav), com botão de voltar.
      GoRoute(path: '/carrinho', builder: (_, _) => const CarrinhoScreen()),
      GoRoute(path: '/pedidos', builder: (_, _) => const PedidosScreen()),
      GoRoute(
        path: '/configuracoes',
        builder: (_, _) => const SettingsScreen(),
      ),
      GoRoute(
        path: '/notificacoes',
        builder: (_, _) => const NotificationsScreen(),
      ),
      ShellRoute(
        builder: (_, _, child) => MainShell(child: child),
        routes: [
          GoRoute(path: '/home', builder: (_, _) => const HomeScreen()),
          GoRoute(path: '/cardapio', builder: (_, _) => const MenuScreen()),
          GoRoute(
            path: '/premiacoes',
            builder: (_, _) => const RewardsScreen(),
          ),
          GoRoute(path: '/planos', builder: (_, _) => const PlansScreen()),
          GoRoute(path: '/perfil', builder: (_, _) => const ProfileScreen()),
        ],
      ),
    ],
  );
});

/// Refaz o redirect quando o estado de auth muda.
///
/// Ouve também o doc do perfil: sem isso, salvar telefone e nascimento em
/// `/completar-perfil` não faria o router reavaliar, e o sócio ficaria preso no
/// formulário que acabou de preencher.
class _AuthListenable extends ChangeNotifier {
  _AuthListenable(Ref ref) {
    ref.listen(authStateProvider, (_, _) => notifyListeners());
    if (!kDemo) {
      ref.listen(currentUserProvider, (_, _) => notifyListeners());
    }
  }
}
