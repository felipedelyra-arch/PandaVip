import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_sign_in/google_sign_in.dart';

import 'package:flutter/widgets.dart' show BuildContext;

import '../../core/services/fila_pendentes.dart';
import '../../core/services/services.dart';
import 'auth_mfa.dart' show reautenticar;
import 'auth_widgets.dart' show termosVersao;

/// Garante o doc `users/{uid}` depois de entrar.
///
/// O backend tem `onAuthUserCreate` (`beforeUserCreated`) fazendo isso, mas ele
/// é Cloud Function e **não está no ar** — Functions exige Blaze. Sem esta
/// função, quem entra pelo Google fica com conta no Auth e nenhum perfil no
/// Firestore, e o app inteiro lê esse doc: nome, foto, carteirinha, resgates.
///
/// É idempotente de propósito. Quando a function subir, as duas rodam e nada
/// quebra: `merge` não apaga campo, e cada campo só é escrito se ainda estiver
/// vazio — o nome que o sócio digitou no perfil vale mais que o da conta
/// Google.
Future<void> garantirPerfil(FirebaseFirestore db, User user) async {
  final ref = db.doc('users/${user.uid}');
  final snap = await ref.get();
  final atual = snap.data() ?? const <String, dynamic>{};

  bool vazio(String campo) => (atual[campo] ?? '').toString().trim().isEmpty;

  await ref.set({
    'uid': user.uid,
    if (vazio('nome')) 'nome': user.displayName ?? '',
    if (vazio('email')) 'email': user.email ?? '',
    if (atual['fotoUrl'] == null && user.photoURL != null)
      'fotoUrl': user.photoURL,
    if (!snap.exists) 'criadoEm': FieldValue.serverTimestamp(),
  }, SetOptions(merge: true));
}

/// Client OAuth **web** do projeto, de `google-services.json` (`client_type: 3`).
///
/// No Android é ele que define a audiência do `idToken` — sem isso o Firebase
/// recusa o token com `invalid-credential`. Não é segredo: acompanha o APK.
const _clientWebOAuth =
    '000000000000-SEU_CLIENT_ID.apps.googleusercontent.com';

bool _googleIniciado = false;

/// Entra com Google e deixa o perfil pronto.
///
/// Vive aqui, e não na tela, porque login e cadastro chamam os dois — e um
/// esquecer o [garantirPerfil] significa sócio sem perfil no banco.
///
/// ⚠️ No celular NÃO dá pra usar `signInWithProvider`. Ele abre a página de
/// OAuth numa aba do Chrome, e as chamadas que saem de lá não carregam o nome
/// do pacote nem a SHA-1 — chegam ao Google como `<empty>`. Com a chave de API
/// Android restrita por pacote+impressão digital, o Google devolve:
///
///   403 API_KEY_ANDROID_APP_BLOCKED
///   `Requests from this Android client application <empty> are blocked.`
///
/// O seletor nativo resolve os dois lados: a chave continua restrita (porque
/// as chamadas saem do app, com os cabeçalhos certos) e o sócio vê a folha de
/// contas do Android em vez de um navegador abrindo do nada.
Future<void> entrarComGoogle(WidgetRef ref) async {
  // Lido antes de qualquer await: o login muda o authState e a tela pode ser
  // desmontada antes do fim desta função.
  final auth = ref.read(firebaseAuthProvider);
  final db = ref.read(firestoreProvider);
  final UserCredential cred;

  if (kIsWeb || !GoogleSignIn.instance.supportsAuthenticate()) {
    // Web segue no popup do próprio firebase_auth: lá o google_sign_in exige um
    // clientId declarado no index.html e não implementa `authenticate()`. E a
    // restrição da chave web é por domínio, que o popup respeita.
    cred = await auth.signInWithProvider(GoogleAuthProvider());
  } else {
    if (!_googleIniciado) {
      await GoogleSignIn.instance.initialize(serverClientId: _clientWebOAuth);
      _googleIniciado = true;
    }
    final conta = await GoogleSignIn.instance.authenticate();
    final idToken = conta.authentication.idToken;
    if (idToken == null) {
      throw FirebaseAuthException(
        code: 'invalid-credential',
        message: 'O Google não devolveu o token de identificação.',
      );
    }
    cred = await auth.signInWithCredential(
      GoogleAuthProvider.credential(idToken: idToken),
    );
  }

  final user = cred.user;
  if (user != null) await garantirPerfil(db, user);
}

/// Sai do Firebase **e** do Google.
///
/// Só `FirebaseAuth.signOut()` deixa a sessão do Google viva no aparelho: o
/// próximo toque em "Continuar com Google" entraria de novo na mesma conta,
/// sem perguntar nada — e o botão "Sair e usar outro e-mail" não cumpriria o
/// que promete.
Future<void> sair(WidgetRef ref) async {
  final auth = ref.read(firebaseAuthProvider);
  // Fila offline é da conta que sai: não pode rodar com a sessão do próximo.
  await ref.read(filaPendentesProvider.notifier).limpar();
  // O signOut do Firebase é o que troca a tela: vai primeiro. O do Google fala
  // com a rede e não pode atrasar a saída (nem derrubá-la se falhar).
  await auth.signOut();
  // Erro aqui = nunca entrou pelo Google, ou o plugin não existe na plataforma.
  unawaited(Future(() => GoogleSignIn.instance.signOut()).catchError((_) {}));
}

/// Idem para a Apple. Os escopos precisam ser pedidos explicitamente: sem eles
/// a Apple devolve a conta sem nome nem e-mail.
Future<void> entrarComApple(WidgetRef ref) async {
  final auth = ref.read(firebaseAuthProvider);
  final db = ref.read(firestoreProvider);
  final provider = OAuthProvider('apple.com')
    ..addScope('email')
    ..addScope('name');
  final cred = await auth.signInWithProvider(provider);
  final user = cred.user;
  if (user != null) await garantirPerfil(db, user);
}

/// Revoga o acesso do app à conta Apple antes de excluir a conta.
///
/// A App Store exige (diretriz 5.1.1(v)): quem entrou com Apple e apaga a conta
/// tem que ter o token revogado, senão o app segue listado em "Usar ID Apple"
/// no iPhone. O código de autorização só vem de um login novo, por isso a folha
/// da Apple aparece de novo. Cancelar a folha lança erro e interrompe a
/// exclusão — melhor que apagar sem revogar.
Future<void> revogarAppleSeNecessario(WidgetRef ref) async {
  final auth = ref.read(firebaseAuthProvider);
  final user = auth.currentUser;
  if (kIsWeb || user == null) return;
  if (!user.providerData.any((p) => p.providerId == 'apple.com')) return;
  final cred = await user.reauthenticateWithProvider(AppleAuthProvider());
  final codigo = cred.additionalUserInfo?.authorizationCode;
  if (codigo != null) await auth.revokeTokenWithAuthorizationCode(codigo);
}

/// Login recente antes de excluir a conta: o servidor só aceita `auth_time` de
/// até 5 min. Senha pede a senha; Google abre o seletor; Apple já reautenticou
/// em [revogarAppleSeNecessario]. Cancelar lança erro e interrompe a exclusão.
Future<void> reautenticarParaExcluir(
  WidgetRef ref,
  BuildContext context,
) async {
  final user = ref.read(firebaseAuthProvider).currentUser;
  if (user == null) return;
  final provedores = user.providerData.map((p) => p.providerId);
  if (provedores.contains('password')) {
    if (!await reautenticar(context, user)) {
      throw FirebaseAuthException(code: 'cancelled', message: 'Cancelado.');
    }
  } else if (provedores.contains('google.com')) {
    if (kIsWeb || !GoogleSignIn.instance.supportsAuthenticate()) {
      await user.reauthenticateWithProvider(GoogleAuthProvider());
    } else {
      if (!_googleIniciado) {
        await GoogleSignIn.instance.initialize(serverClientId: _clientWebOAuth);
        _googleIniciado = true;
      }
      final conta = await GoogleSignIn.instance.authenticate();
      await user.reauthenticateWithCredential(
        GoogleAuthProvider.credential(idToken: conta.authentication.idToken),
      );
    }
  } else if (provedores.contains('apple.com') && kIsWeb) {
    await user.reauthenticateWithProvider(AppleAuthProvider());
  }
  await user.getIdToken(true); // força o token novo com o auth_time atual
}

/// Precisa confirmar o e-mail antes de entrar?
///
/// Só vale pra quem se cadastrou com e-mail e senha. Google e Apple entregam o
/// e-mail já verificado pelo provedor — cobrar confirmação deles seria pedir
/// pro cliente confirmar um endereço que ele nunca digitou.
final precisaVerificarEmailProvider = Provider<bool>((ref) {
  final user = ref.watch(authStateProvider).value;
  if (user == null || user.emailVerified) return false;
  return user.providerData.any((p) => p.providerId == 'password');
});

/// O perfil tem o que o clube precisa?
///
/// Retorna `null` enquanto o doc ainda não chegou do Firestore. O router usa
/// isso pra **não** desviar por engano: no primeiro frame depois do login o doc
/// ainda está carregando, e tratar isso como "incompleto" jogaria todo mundo na
/// tela de completar cadastro a cada abertura do app.
final perfilCompletoProvider = Provider<bool?>((ref) {
  if (ref.watch(authStateProvider).value == null) return null;

  final perfil = ref.watch(currentUserProvider);
  if (perfil.isLoading) return null;
  // Erro de leitura (offline, por exemplo): não é hora de empurrar formulário.
  if (perfil.hasError) return null;

  final u = perfil.value;
  if (u == null) return false; // doc ainda não existe
  // Termos numa versão antiga (ou nunca aceitos, contas de antes do aceite)
  // também contam como incompleto: o router leva a /completar-perfil, que
  // pede só o aceite quando o resto já está preenchido.
  return u.nome.trim().isNotEmpty &&
      u.telefone.trim().isNotEmpty &&
      u.nascimento != null &&
      u.termosVersao == termosVersao;
});
