import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app_prefs.dart';
import '../connectivity.dart';
import '../../router/app_router.dart';
import 'services.dart';

/// Gerencia FCM: pede permissão, salva o token no doc do usuário e o
/// mantém atualizado. Chamado quando há usuário logado.
class PushService {
  PushService(this._ref);
  final Ref _ref;
  bool _ouvindoRefresh = false;
  bool _ouvindoToque = false;
  String? _ultimoSalvo;

  Future<void> init() async {
    // Respeita o toggle das configurações: desligado, nem registra token.
    if (!_ref.read(notificationsEnabledProvider)) return;
    if (_ref.read(authStateProvider).value == null) return;
    final messaging = FirebaseMessaging.instance;
    _ouvirToque(messaging);

    try {
      await messaging.requestPermission(alert: true, badge: true, sound: true);
      final token = await messaging.getToken();
      if (token != null) await _salvarToken(token);
    } catch (e) {
      // `getToken` falha sem rede (4G caindo, Wi-Fi trocando). Antes isso
      // matava o registro até o próximo login: o servidor seguia mandando push
      // pro token de uma instalação que já não existe. Agora tenta de novo
      // quando a conexão volta ou o app abre outra vez.
      debugPrint('PushService: token não registrado agora: $e');
    }

    // Atualiza se o token rotacionar. Um listener só, mesmo com várias chamadas.
    if (!_ouvindoRefresh) {
      _ouvindoRefresh = true;
      messaging.onTokenRefresh.listen(_salvarToken);
    }
  }

  /// Toque no aviso abre a tela dele (hoje só "Meus pedidos"). Vale com o app
  /// em segundo plano e com o app fechado, que chega por `getInitialMessage`.
  void _ouvirToque(FirebaseMessaging messaging) {
    if (_ouvindoToque) return;
    _ouvindoToque = true;
    FirebaseMessaging.onMessageOpenedApp.listen(_abrir);
    FirebaseMessaging.onMessage.listen(_mostrarNaTela);
    messaging.getInitialMessage().then((m) {
      if (m != null) _abrir(m);
    });
  }

  /// Aviso que chega com o app aberto.
  ///
  /// O Android não desenha notificação de app em primeiro plano: o push
  /// "seu pedido saiu para entrega" simplesmente não aparecia pra quem estava
  /// com o app na mão — justo quem está esperando. A faixa resolve sem
  /// dependência nova; o aviso também já está na central, que é o histórico.
  void _mostrarNaTela(RemoteMessage m) {
    final aviso = m.notification;
    if (aviso == null) return;
    final texto = [
      aviso.title,
      aviso.body,
    ].whereType<String>().where((t) => t.trim().isNotEmpty).join(': ');
    if (texto.isEmpty) return;

    final contexto = _ref
        .read(routerProvider)
        .routerDelegate
        .navigatorKey
        .currentContext;
    if (contexto == null) return;
    final messenger = ScaffoldMessenger.maybeOf(contexto);
    if (messenger == null) return;

    messenger.showSnackBar(
      SnackBar(
        content: Text(texto),
        duration: const Duration(seconds: 6),
        action: m.data['rota'] == '/pedidos'
            ? SnackBarAction(
                label: 'Ver',
                onPressed: () => _ref.read(routerProvider).push('/pedidos'),
              )
            : null,
      ),
    );
  }

  void _abrir(RemoteMessage m) {
    // Só rota conhecida: o conteúdo do push não decide pra onde o app vai.
    if (m.data['rota'] == '/pedidos') {
      _ref.read(routerProvider).push('/pedidos');
    }
  }

  /// Aplica a preferência do usuário. Desligar apaga o token — sem token
  /// salvo o backend não tem pra quem enviar, que é o que o usuário pediu.
  Future<void> aplicarPreferencia(bool ativas) async {
    if (ativas) return init();
    _ultimoSalvo = null;
    try {
      await FirebaseMessaging.instance.deleteToken();
    } catch (_) {
      // Sem token pra apagar (ou plataforma sem suporte): segue.
    }
    final uid = _ref.read(authStateProvider).value?.uid;
    if (uid == null) return;
    await _ref.read(firestoreProvider).doc('users/$uid').set({
      'fcmToken': FieldValue.delete(),
    }, SetOptions(merge: true));
  }

  Future<void> _salvarToken(String token) async {
    final uid = _ref.read(authStateProvider).value?.uid;
    if (uid == null || token == _ultimoSalvo) return;
    _ultimoSalvo = token;
    await _ref.read(firestoreProvider).doc('users/$uid').set({
      'fcmToken': token,
    }, SetOptions(merge: true));
  }
}

/// Provider que liga o push quando há usuário logado.
final pushServiceProvider = Provider<PushService>((ref) {
  final service = PushService(ref);
  // `fireImmediately`: quem abre o app com a sessão já salva também registra o
  // token. Sem isso o registro só acontecia no momento do login.
  ref.listen(authStateProvider, (_, next) {
    if (next.value != null) service.init();
  }, fireImmediately: true);
  // A internet voltou: tenta de novo, caso o registro tenha falhado sem rede.
  ref.listen(conexaoOnlineProvider, (antes, depois) {
    if (depois.value == true && antes?.value != true) service.init();
  });
  return service;
});
