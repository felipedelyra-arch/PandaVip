import 'dart:convert';

import 'package:clube_panda/core/app_prefs.dart';
import 'package:clube_panda/core/connectivity.dart';
import 'package:clube_panda/core/models/models.dart';
import 'package:clube_panda/core/services/fila_pendentes.dart';
import 'package:clube_panda/core/services/services.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _User extends Fake implements User {
  @override
  String get uid => 'eu';
}

class _Auth extends Fake implements FirebaseAuth {
  @override
  User? get currentUser => _User();
}

void main() {
  test('maior18: aniversário de 18 anos conta no dia; sem data não vale', () {
    final hoje = DateTime(2026, 10, 13);
    expect(maior18(DateTime(2008, 10, 13), hoje: hoje), isTrue);
    expect(maior18(DateTime(2008, 10, 14), hoje: hoje), isFalse);
    expect(maior18(DateTime(1992, 7, 23), hoje: hoje), isTrue);
    expect(maior18(null, hoje: hoje), isFalse);
  });

  test('bloqueioDePagamento: menor e sem data recebem a mensagem', () {
    final hoje = DateTime(2026, 10, 13);
    AppUser u(DateTime? n) =>
        AppUser(uid: 'u', nome: 'n', email: 'e', nascimento: n);
    expect(bloqueioDePagamento(u(DateTime(2010, 1, 1)), hoje: hoje), kMsgSo18);
    expect(bloqueioDePagamento(u(null), hoje: hoje), kMsgSemNascimento);
    expect(bloqueioDePagamento(u(DateTime(2000, 1, 1)), hoje: hoje), isNull);
    expect(bloqueioDePagamento(null), isNull); // perfil carregando
  });

  test('fila descarta item de outro uid e de versão sem uid', () async {
    Map<String, dynamic> item(String id, String? uid) => {
          'id': id,
          'funcao': 'cancelSubscription',
          'dados': <String, dynamic>{},
          'criadoEm': DateTime(2026, 10, 13).toIso8601String(),
          'uid': uid,
          // desistiu: o item do dono fica guardado sem tentar chamar a rede
          'desistiu': true,
        };
    SharedPreferences.setMockInitialValues({
      'fila_pendentes_v1': [
        jsonEncode(item('a', 'outro')),
        jsonEncode(item('b', null)),
        jsonEncode(item('c', 'eu')),
      ],
    });
    final prefs = await SharedPreferences.getInstance();
    final c = ProviderContainer(overrides: [
      sharedPreferencesProvider.overrideWithValue(prefs),
      firebaseAuthProvider.overrideWithValue(_Auth()),
      authStateProvider.overrideWith((_) => const Stream<User?>.empty()),
      conexaoOnlineProvider.overrideWith((_) => const Stream<bool>.empty()),
    ]);
    addTearDown(c.dispose);

    expect(c.read(filaPendentesProvider), hasLength(3));
    await c.read(filaPendentesProvider.notifier).drenar();
    expect(c.read(filaPendentesProvider).map((p) => p.id), ['c']);

    await c.read(filaPendentesProvider.notifier).limpar();
    expect(c.read(filaPendentesProvider), isEmpty);
    expect(prefs.getStringList('fila_pendentes_v1'), isNull);
  });
}
