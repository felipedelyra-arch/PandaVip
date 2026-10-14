import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/services/services.dart';
import 'auth_perfil.dart';
import '../../core/theme/colors.dart';
import 'auth_widgets.dart';

/// Porta de entrada de quem se cadastrou com e-mail e senha e ainda não
/// confirmou o endereço.
///
/// O router segura aqui enquanto `emailVerified` for falso. Quem entra pelo
/// Google nunca vê esta tela.
class VerificarEmailScreen extends ConsumerStatefulWidget {
  const VerificarEmailScreen({super.key});

  @override
  ConsumerState<VerificarEmailScreen> createState() =>
      _VerificarEmailScreenState();
}

class _VerificarEmailScreenState extends ConsumerState<VerificarEmailScreen> {
  bool _enviando = false;
  bool _conferindo = false;
  String? _aviso;
  Timer? _relogio;

  /// Segundos que faltam pra poder reenviar. O Firebase limita reenvio por IP;
  /// sem essa trava o sócio clica cinco vezes, toma `too-many-requests` e fica
  /// sem conseguir reenviar por muito mais tempo.
  int _espera = 0;

  @override
  void initState() {
    super.initState();
    // Confere sozinho a cada 5s: o sócio confirma no e-mail (às vezes em outro
    // aparelho) e volta pro app esperando estar dentro, sem apertar nada.
    _relogio = Timer.periodic(
      const Duration(seconds: 5),
      (_) => _conferir(silencioso: true),
    );
  }

  @override
  void dispose() {
    _relogio?.cancel();
    super.dispose();
  }

  Future<void> _reenviar() async {
    final user = ref.read(firebaseAuthProvider).currentUser;
    if (user == null || _espera > 0 || _enviando) return;
    setState(() {
      _enviando = true;
      _aviso = null;
    });
    try {
      await user.sendEmailVerification();
      if (!mounted) return;
      setState(() {
        _aviso = 'E-mail reenviado. Confira também a caixa de spam.';
        _espera = 60;
      });
      _contarRegressiva();
    } catch (_) {
      if (!mounted) return;
      setState(
        () => _aviso =
            'Não foi possível enviar agora. Tente novamente em um minuto.',
      );
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  void _contarRegressiva() {
    Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted || _espera <= 0) {
        t.cancel();
        return;
      }
      setState(() => _espera--);
    });
  }

  /// Relê o usuário no Firebase. `authStateChanges` **não** dispara depois de
  /// `reload()`, então o provider é invalidado na mão pra o router reavaliar o
  /// desvio e soltar a pessoa pra dentro.
  Future<void> _conferir({bool silencioso = false}) async {
    if (_conferindo) return;
    _conferindo = true;
    if (!silencioso && mounted) setState(() {});
    try {
      final auth = ref.read(firebaseAuthProvider);
      await auth.currentUser?.reload();
      if (auth.currentUser?.emailVerified ?? false) {
        // `reload()` não troca o token: sem forçar um novo, as Cloud Functions
        // seguiriam lendo `email_verified: false` por até 1 hora e recusando o
        // primeiro pedido e a assinatura de quem acabou de confirmar.
        await auth.currentUser?.getIdToken(true);
        if (mounted) ref.invalidate(authStateProvider);
        return;
      }
      if (!silencioso && mounted) {
        setState(() => _aviso = 'Ainda não confirmado. Abra o link do e-mail.');
      }
    } catch (_) {
      // Offline ou token velho: o timer tenta de novo em 5s.
    } finally {
      _conferindo = false;
      if (!silencioso && mounted) setState(() {});
    }
  }

  @override
  Widget build(BuildContext context) {
    final email = ref.watch(firebaseAuthProvider).currentUser?.email ?? '';

    return AuthScaffold(
      children: [
        const Icon(
          Icons.mark_email_unread_outlined,
          size: 64,
          color: PandaColors.laranja,
        ),
        const SizedBox(height: 20),
        AuthCabecalho(
          logo: false,
          titulo: 'Confirme seu e-mail',
          subtitulo: email.isEmpty
              ? 'Enviamos um link de confirmação para o seu e-mail.'
              : 'Enviamos um link de confirmação para\n$email',
        ),
        const Text(
          'Abra o link e volte para o app. Esta tela será liberada '
          'automaticamente.',
          textAlign: TextAlign.center,
          style: TextStyle(
            color: AuthCores.textoSuave,
            fontSize: 15,
            height: 1.45,
          ),
        ),
        if (_aviso != null) ...[
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: AuthCores.card,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: AuthCores.borda),
            ),
            child: Semantics(
              liveRegion: true,
              child: Text(
                _aviso!,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 15,
                  height: 1.4,
                ),
              ),
            ),
          ),
        ],
        const SizedBox(height: 24),
        AuthBotao(
          texto: 'Já confirmei',
          carregando: _conferindo,
          onPressed: () => _conferir(),
        ),
        const SizedBox(height: 12),
        AuthBotaoSecundario(
          texto: _espera > 0 ? 'Reenviar em ${_espera}s' : 'Reenviar e-mail',
          icone: Icons.send_rounded,
          onPressed: (_enviando || _espera > 0) ? null : _reenviar,
        ),
        const SizedBox(height: 12),
        AuthBotaoSecundario(
          texto: 'Sair e usar outro e-mail',
          icone: Icons.logout_rounded,
          onPressed: () => sair(ref),
        ),
      ],
    );
  }
}
