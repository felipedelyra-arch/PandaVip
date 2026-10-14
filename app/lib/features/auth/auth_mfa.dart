import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/theme/app_theme.dart';
import 'auth_senha.dart';
import 'auth_widgets.dart';

/// Abre um diálogo escuro (mesmo visual das telas de auth, seja qual for o
/// tema do app).
Future<T?> mostrarDialogoAuth<T>(BuildContext context, WidgetBuilder builder) {
  return showDialog<T>(
    context: context,
    barrierDismissible: false,
    builder: (c) => Theme(
      data: AppTheme.dark,
      child: Builder(builder: builder),
    ),
  );
}

/// Layout comum dos diálogos: rola quando o teclado sobe, para o erro e os
/// botões nunca ficarem escondidos.
class DialogoAuthBase extends StatelessWidget {
  const DialogoAuthBase({
    super.key,
    required this.titulo,
    required this.children,
  });

  final String titulo;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: AuthCores.card,
      insetPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 24),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 440),
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                titulo,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 22,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 14),
              ...children,
            ],
          ),
        ),
      ),
    );
  }
}

/// Pede o código de 6 dígitos do app autenticador. [confirmar] devolve `null`
/// quando deu certo (o diálogo fecha com `true`) ou a mensagem de erro (o
/// diálogo continua aberto para tentar de novo).
Future<bool> pedirCodigoTotp(
  BuildContext context, {
  required String titulo,
  required String texto,
  required Future<String?> Function(String codigo) confirmar,
}) async {
  final ok = await mostrarDialogoAuth<bool>(
    context,
    (_) => _DialogoCodigo(titulo: titulo, texto: texto, confirmar: confirmar),
  );
  return ok == true;
}

class _DialogoCodigo extends StatefulWidget {
  const _DialogoCodigo({
    required this.titulo,
    required this.texto,
    required this.confirmar,
  });

  final String titulo;
  final String texto;
  final Future<String?> Function(String) confirmar;

  @override
  State<_DialogoCodigo> createState() => _DialogoCodigoState();
}

class _DialogoCodigoState extends State<_DialogoCodigo> {
  final _codigo = TextEditingController();
  bool _enviando = false;
  String? _erro;

  @override
  void dispose() {
    _codigo.dispose();
    super.dispose();
  }

  Future<void> _enviar() async {
    final c = _codigo.text.trim();
    if (!RegExp(r'^\d{6}$').hasMatch(c)) {
      setState(() => _erro = 'Digite os 6 números que aparecem no app.');
      return;
    }
    setState(() {
      _enviando = true;
      _erro = null;
    });
    final erro = await widget.confirmar(c);
    if (!mounted) return;
    if (erro == null) {
      Navigator.of(context).pop(true);
    } else {
      setState(() {
        _enviando = false;
        _erro = erro;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return DialogoAuthBase(
      titulo: widget.titulo,
      children: [
        Text(
          widget.texto,
          style: const TextStyle(
            color: AuthCores.textoSuave,
            fontSize: 15.5,
            height: 1.45,
          ),
        ),
        const SizedBox(height: 18),
        AuthCampo(
          controller: _codigo,
          rotulo: 'Código de 6 dígitos',
          hint: '000000',
          icone: Icons.pin_outlined,
          keyboardType: TextInputType.number,
          maxLength: 6,
          autofillHints: const [AutofillHints.oneTimeCode],
          onSubmitted: (_) => _enviar(),
        ),
        const SizedBox(height: 16),
        AuthErro(_erro),
        AuthBotao(
          texto: 'Confirmar',
          carregando: _enviando,
          onPressed: _enviar,
        ),
        const SizedBox(height: 10),
        AuthBotaoSecundario(
          texto: 'Cancelar',
          onPressed: _enviando ? null : () => Navigator.of(context).pop(false),
        ),
        const SizedBox(height: 12),
        const Text(
          'Perdeu o acesso ao autenticador? Fale com o restaurante.',
          style: TextStyle(
            color: AuthCores.textoSuave,
            fontSize: 14,
            height: 1.4,
          ),
        ),
      ],
    );
  }
}

/// Segundo passo do login quando a conta tem verificação em duas etapas.
/// Devolve a credencial, ou `null` se a pessoa cancelou.
Future<UserCredential?> resolverSegundoFator(
  BuildContext context,
  FirebaseAuthMultiFactorException e,
) async {
  final resolver = e.resolver;
  final hint = resolver.hints.firstWhere(
    (h) => h.factorId == 'totp',
    orElse: () => resolver.hints.first,
  );
  UserCredential? cred;
  await pedirCodigoTotp(
    context,
    titulo: 'Verificação em duas etapas',
    texto:
        'Abra o app autenticador e digite o código de 6 dígitos do PandaVip.',
    confirmar: (codigo) async {
      try {
        final assertion = await TotpMultiFactorGenerator.getAssertionForSignIn(
          hint.uid,
          codigo,
        );
        cred = await resolver.resolveSignIn(assertion);
        return null;
      } on FirebaseAuthException catch (err) {
        debugPrint('MFA signIn: ${err.code}');
        return mensagemErroAuth(err);
      } catch (err) {
        debugPrint('MFA signIn: $err');
        return 'Não foi possível verificar o código. Tente de novo.';
      }
    },
  );
  return cred;
}

/// Pede a senha atual e reautentica [user]. Resolve o segundo fator se a conta
/// tiver 2FA. `false` = cancelou ou falhou (o diálogo já mostrou o motivo).
Future<bool> reautenticar(BuildContext context, User user) async {
  final email = user.email;
  if (email == null) return false;
  final ok = await mostrarDialogoAuth<bool>(
    context,
    (_) => _DialogoSenhaAtual(user: user, email: email),
  );
  return ok == true;
}

class _DialogoSenhaAtual extends StatefulWidget {
  const _DialogoSenhaAtual({required this.user, required this.email});
  final User user;
  final String email;

  @override
  State<_DialogoSenhaAtual> createState() => _DialogoSenhaAtualState();
}

class _DialogoSenhaAtualState extends State<_DialogoSenhaAtual> {
  final _senha = TextEditingController();
  bool _enviando = false;
  String? _erro;

  @override
  void dispose() {
    _senha.dispose();
    super.dispose();
  }

  Future<void> _confirmar() async {
    if (_senha.text.isEmpty) {
      setState(() => _erro = 'Digite sua senha atual.');
      return;
    }
    setState(() {
      _enviando = true;
      _erro = null;
    });
    final cred = EmailAuthProvider.credential(
      email: widget.email,
      password: _senha.text,
    );
    try {
      await widget.user.reauthenticateWithCredential(cred);
      if (mounted) Navigator.of(context).pop(true);
    } on FirebaseAuthMultiFactorException catch (e) {
      // Conta com 2FA: reautenticar também exige o código.
      if (!mounted) return;
      final r = await resolverSegundoFator(context, e);
      if (!mounted) return;
      if (r != null) {
        Navigator.of(context).pop(true);
      } else {
        setState(() => _enviando = false);
      }
    } on FirebaseAuthException catch (e) {
      debugPrint('reauth: ${e.code}');
      if (mounted) {
        setState(() {
          _enviando = false;
          _erro = mensagemErroAuth(e);
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return DialogoAuthBase(
      titulo: 'Confirme sua senha',
      children: [
        const Text(
          'Por segurança, digite sua senha atual para continuar.',
          style: TextStyle(
            color: AuthCores.textoSuave,
            fontSize: 15.5,
            height: 1.45,
          ),
        ),
        const SizedBox(height: 18),
        AuthCampoSenha(
          controller: _senha,
          rotulo: 'Senha atual',
          onSubmitted: (_) => _confirmar(),
        ),
        const SizedBox(height: 16),
        AuthErro(_erro),
        AuthBotao(
          texto: 'Continuar',
          carregando: _enviando,
          onPressed: _confirmar,
        ),
        const SizedBox(height: 10),
        AuthBotaoSecundario(
          texto: 'Cancelar',
          onPressed: _enviando ? null : () => Navigator.of(context).pop(false),
        ),
      ],
    );
  }
}

/// Copia texto e avisa.
Future<void> copiarComAviso(
  ScaffoldMessengerState messenger,
  String texto,
  String aviso,
) async {
  await Clipboard.setData(ClipboardData(text: texto));
  messenger.showSnackBar(SnackBar(content: Text(aviso)));
}
