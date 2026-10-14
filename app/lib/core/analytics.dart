import 'package:firebase_analytics/firebase_analytics.dart';
import 'package:firebase_crashlytics/firebase_crashlytics.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'demo.dart';
import 'models/models.dart';
import 'services/services.dart';

/// Instância do Firebase Analytics.
final analyticsProvider = Provider((_) => FirebaseAnalytics.instance);

/// Registra um evento de analytics. No modo demo vira no-op.
Future<void> logEvento(
  Ref ref,
  String nome, {
  Map<String, Object>? params,
}) async {
  if (kDemo) return;
  await ref.read(analyticsProvider).logEvent(name: nome, parameters: params);
}

/// Versão pra WidgetRef (telas). No modo demo vira no-op.
Future<void> logEventoUi(
  WidgetRef ref,
  String nome, {
  Map<String, Object>? params,
}) async {
  if (kDemo) return;
  await ref.read(analyticsProvider).logEvent(name: nome, parameters: params);
}

/// Liga/desliga Analytics e Crashlytics conforme o perfil: só 18+ que não
/// desligou em "Estatísticas de uso". Menor (ou sem data de nascimento) fica
/// desligado. Sem perfil carregado (deslogado) mantém o último ajuste.
final coletaDeUsoProvider = Provider<void>((ref) {
  ref.listen(currentUserProvider, (_, atual) {
    final u = atual.value;
    if (u == null) return;
    final ligada = maior18(u.nascimento) && u.analyticsOptIn != false;
    Future(() async {
      try {
        await FirebaseAnalytics.instance.setAnalyticsCollectionEnabled(ligada);
        if (!kIsWeb) {
          await FirebaseCrashlytics.instance.setCrashlyticsCollectionEnabled(
            ligada,
          );
        }
      } catch (_) {} // plataforma sem suporte: segue
    });
  }, fireImmediately: true);
});
