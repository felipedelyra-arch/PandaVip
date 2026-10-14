import 'dart:io' show Platform;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import 'demo.dart';
import 'restaurante.dart';
import 'services/services.dart';
import 'theme/colors.dart';

/// minBuild exigido, publicado em config/app pelo painel. Null = sem exigência.
final _minBuildProvider = StreamProvider<int?>((ref) {
  if (kDemo) return Stream.value(null);
  return ref
      .watch(firestoreProvider)
      .doc('config/app')
      .snapshots()
      .map((d) => (d.data()?['minBuild'] as num?)?.toInt());
});

/// Build atual do app (versionCode/CFBundleVersion).
final _buildAtualProvider = FutureProvider<int>((ref) async {
  final info = await PackageInfo.fromPlatform();
  return int.tryParse(info.buildNumber) ?? 0;
});

/// Precisa atualizar? (build atual menor que o mínimo exigido).
final atualizacaoObrigatoriaProvider = Provider<bool>((ref) {
  if (kDemo) return false;
  final min = ref.watch(_minBuildProvider).value;
  final atual = ref.watch(_buildAtualProvider).value;
  if (min == null || atual == null) return false;
  return atual < min;
});

/// Bloqueia o app com uma tela de update quando a versão está velha demais.
class VersionGate extends ConsumerWidget {
  const VersionGate({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final precisa = ref.watch(atualizacaoObrigatoriaProvider);
    return precisa ? const _UpdateScreen() : child;
  }
}

class _UpdateScreen extends ConsumerWidget {
  const _UpdateScreen();

  Future<void> _abrirLoja(RestauranteInfo restaurante) async {
    final url = (!kIsWeb && (Platform.isIOS || Platform.isMacOS))
        ? restaurante.appStoreUrl
        : restaurante.playStoreUrl;
    final uri = Uri.parse(url);
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final restaurante = ref.watch(restauranteProvider);
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(
                Icons.system_update_rounded,
                size: 72,
                color: PandaColors.laranja,
              ),
              const SizedBox(height: 24),
              Text(
                'Atualização necessária',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              const SizedBox(height: 12),
              const Text(
                'Há uma nova versão do PandaVip. '
                'Atualize o app para continuar usando.',
                textAlign: TextAlign.center,
                style: TextStyle(color: PandaColors.cinzaTexto, height: 1.5),
              ),
              const SizedBox(height: 32),
              ElevatedButton(
                onPressed: () => _abrirLoja(restaurante),
                style: ElevatedButton.styleFrom(
                  minimumSize: const Size.fromHeight(52),
                ),
                child: const Text('Atualizar agora'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
