import 'package:firebase_auth/firebase_auth.dart';

/// Um requisito da política de senha, para o checklist ao vivo do cadastro.
typedef RequisitoSenha = ({String texto, bool Function(String) ok});

// Só o que o Identity Platform conta como não alfanumérico.
final _especial = RegExp(r'''[\^$*.\[\]{}()?"!@#%&/\\,><':;|_~]''');

/// Política única de senha (cadastro, troca e definição). O servidor impõe a
/// mesma regra via password policy do Identity Platform.
final List<RequisitoSenha> requisitosSenha = [
  (texto: 'Mínimo de 8 caracteres', ok: (s) => s.length >= 8),
  (texto: 'Uma letra maiúscula', ok: (s) => RegExp(r'[A-Z]').hasMatch(s)),
  (texto: 'Uma letra minúscula', ok: (s) => RegExp(r'[a-z]').hasMatch(s)),
  (texto: 'Um número', ok: (s) => RegExp(r'[0-9]').hasMatch(s)),
  (texto: 'Um caractere especial (@ # \$ ! % * ? &)', ok: _especial.hasMatch),
];

/// `null` = senha forte. Senão, a mensagem para mostrar no campo.
String? validarSenhaForte(String senha) {
  if (requisitosSenha.every((r) => r.ok(senha))) return null;
  return 'Use 8 ou mais caracteres, com maiúscula, minúscula, número e '
      'caractere especial (@ # \$ ! % * ? &).';
}

/// Mensagem em pt-BR para os erros de autenticação mais comuns.
String mensagemErroAuth(FirebaseAuthException e) {
  switch (e.code) {
    case 'email-already-in-use':
      return 'Esse e-mail já tem conta. Faça login.';
    case 'invalid-email':
      return 'E-mail inválido.';
    case 'weak-password':
    case 'password-does-not-meet-requirements':
      return 'Senha fraca. Use 8 ou mais caracteres, com maiúscula, '
          'minúscula, número e caractere especial.';
    case 'invalid-credential':
    case 'wrong-password':
    case 'user-not-found':
      return 'E-mail ou senha incorretos.';
    case 'too-many-requests':
      return 'Muitas tentativas. Espere alguns minutos e tente de novo.';
    case 'network-request-failed':
      return 'Sem conexão. Verifique a internet e tente de novo.';
    case 'invalid-verification-code':
      return 'Código incorreto. Confira o app autenticador e tente de novo.';
    case 'requires-recent-login':
      return 'Por segurança, confirme sua senha para continuar.';
    default:
      return 'Não foi possível concluir. Tente de novo.';
  }
}
