import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Instância única de SharedPreferences, carregada no main() e injetada via
/// override no ProviderScope. Permite ler as preferências de forma SÍNCRONA
/// (sem "flash" do valor padrão na inicialização).
final sharedPreferencesProvider = Provider<SharedPreferences>(
  (_) => throw UnimplementedError('Defina o override no main.dart.'),
);

const _kOnboardingSeen = 'onboarding_seen';
const _kNotificationsEnabled = 'notifications_enabled';

/// Se o usuário já viu o tour inicial (onboarding).
class OnboardingNotifier extends Notifier<bool> {
  @override
  bool build() =>
      ref.watch(sharedPreferencesProvider).getBool(_kOnboardingSeen) ?? false;

  /// Marca como concluído e persiste.
  Future<void> concluir() async {
    state = true;
    await ref.read(sharedPreferencesProvider).setBool(_kOnboardingSeen, true);
  }
}

final onboardingSeenProvider = NotifierProvider<OnboardingNotifier, bool>(
  OnboardingNotifier.new,
);

/// Preferência de receber notificações (push). Padrão: ligado.
class NotificationsNotifier extends Notifier<bool> {
  @override
  bool build() =>
      ref.watch(sharedPreferencesProvider).getBool(_kNotificationsEnabled) ??
      true;

  Future<void> definir(bool valor) async {
    state = valor;
    await ref
        .read(sharedPreferencesProvider)
        .setBool(_kNotificationsEnabled, valor);
  }
}

final notificationsEnabledProvider =
    NotifierProvider<NotificationsNotifier, bool>(NotificationsNotifier.new);
