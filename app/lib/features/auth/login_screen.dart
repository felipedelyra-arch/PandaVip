import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:go_router/go_router.dart';

import '../../core/services/services.dart';
import '../../core/demo.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/colors.dart';
import 'auth_mfa.dart';
import 'auth_perfil.dart';
import 'auth_senha.dart';
import 'auth_widgets.dart';
import 'botao_social.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  // No modo demo já vem preenchido com uma conta de teste.
  final _email = TextEditingController(text: kDemo ? 'cliente@teste.com' : '');
  final _senha = TextEditingController(text: kDemo ? '123456' : '');
  bool _loading = false;
  String? _erro;

  @override
  void dispose() {
    _email.dispose();
    _senha.dispose();
    super.dispose();
  }

  Future<void> _entrar() async {
    if (!_formKey.currentState!.validate()) return;
    if (kDemo) {
      context.go('/home');
      return;
    }
    final auth = ref.read(firebaseAuthProvider);
    final email = _email.text.trim();
    final senha = _senha.text;
    setState(() {
      _loading = true;
      _erro = null;
    });
    try {
      await auth.signInWithEmailAndPassword(email: email, password: senha);
    } on FirebaseAuthMultiFactorException catch (e) {
      // Conta com verificação em duas etapas: pede o código do autenticador.
      if (!mounted) return;
      await resolverSegundoFator(context, e);
    } on FirebaseAuthException catch (e) {
      debugPrint('Login: ${e.code}');
      if (mounted) setState(() => _erro = mensagemErroAuth(e));
    } catch (e) {
      debugPrint('Login: $e');
      if (mounted) {
        setState(() => _erro = 'Não foi possível entrar. Tente de novo.');
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  /// Login social. Requer os provedores habilitados no console + config de
  /// plataforma (client id no web/iOS, "Sign in with Apple" no Xcode).
  Future<void> _entrarComProvedor(Future<void> Function() fluxo) async {
    if (kDemo) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Login social desativado no modo demo')),
      );
      return;
    }
    final db = ref.read(firestoreProvider);
    setState(() {
      _loading = true;
      _erro = null;
    });
    try {
      await fluxo();
    } on FirebaseAuthMultiFactorException catch (e) {
      // Conta com 2FA entrando por Google/Apple: pede o código e só então
      // garante o perfil.
      if (!mounted) return;
      final cred = await resolverSegundoFator(context, e);
      final user = cred?.user;
      if (user != null) await garantirPerfil(db, user);
    } on FirebaseAuthException catch (e) {
      if (mounted) setState(() => _erro = mensagemErroAuth(e));
    } catch (_) {
      if (mounted) {
        setState(() => _erro = 'Não foi possível entrar. Tente de novo.');
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _entrarGoogle() =>
      _entrarComProvedor(() => entrarComGoogle(ref));

  Future<void> _entrarApple() => _entrarComProvedor(() => entrarComApple(ref));

  Future<void> _recuperarSenha() async {
    final email = _email.text.trim();
    if (email.isEmpty) {
      setState(() => _erro = 'Digite seu e-mail para recuperar a senha.');
      return;
    }
    // Sem esse desvio o demo chamava o Firebase, que nem foi inicializado.
    if (kDemo) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Recuperação de senha desativada no modo demo'),
        ),
      );
      return;
    }
    final auth = ref.read(firebaseAuthProvider);
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _erro = null);
    try {
      await auth.sendPasswordResetEmail(email: email);
      // Com a proteção contra enumeração de e-mail ligada, o Firebase responde
      // "ok" mesmo quando não manda nada (e-mail sem cadastro, ou conta que só
      // entra com Google/Apple). A mensagem não pode prometer que o e-mail saiu.
      messenger.showSnackBar(
        const SnackBar(
          duration: Duration(seconds: 10),
          content: Text(
            'Se esse e-mail tiver cadastro com senha, enviamos um link pra '
            'criar uma nova. Pode levar alguns minutos: confira também o spam. '
            'Se você entra com Google ou Apple, use o botão deles.',
          ),
        ),
      );
    } on FirebaseAuthException catch (e) {
      if (!mounted) return;
      setState(
        () => _erro = switch (e.code) {
          'invalid-email' => 'E-mail inválido.',
          'too-many-requests' =>
            'Muitas tentativas. Espere alguns minutos e tente de novo.',
          _ => 'Não foi possível enviar o e-mail agora. Tente de novo.',
        },
      );
    } catch (_) {
      if (!mounted) return;
      setState(
        () => _erro = 'Não foi possível enviar o e-mail agora. Tente de novo.',
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.of(context).size;
    final heroH = (size.height * 0.34).clamp(200.0, 300.0);

    // Tudo em FLUXO NORMAL dentro de um único SingleChildScrollView (um Stack
    // com a folha de login por cima da foto deixava o CanvasKit sem pintar o
    // form). O overlap da logo sobre a foto é feito num Stack pequeno que
    // contém só foto + logo — nunca por cima do form.
    return Theme(
      data: AppTheme.dark,
      child: Scaffold(
        backgroundColor: AuthCores.bg,
        resizeToAvoidBottomInset: true,
        body: SingleChildScrollView(
          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // ---------- HERO: foto + logo na emenda ----------
              // Container com fundo AuthCores.bg: a foto é pintada POR CIMA e dissolve no
              // mesmo AuthCores.bg, sem nenhuma linha/borda entre retângulos adjacentes.
              Container(
                height:
                    heroH + 56, // espaço extra pra logo descer sobre a emenda
                color: AuthCores.bg,
                child: Stack(
                  clipBehavior: Clip.none,
                  children: [
                    // Foto do prato preenche TODO o container (sem SizedBox
                    // interno em heroH) — não há borda entre foto e fundo.
                    Positioned.fill(
                      child: Stack(
                        fit: StackFit.expand,
                        children: [
                          // Bloco laranja em ângulo (eco da referência).
                          Positioned(
                            top: -60,
                            right: -70,
                            child: Transform.rotate(
                              angle: -0.35,
                              child: Container(
                                width: 230,
                                height: 230,
                                decoration: BoxDecoration(
                                  color: PandaColors.laranja,
                                  borderRadius: BorderRadius.circular(56),
                                ),
                              ),
                            ),
                          ),
                          Image.asset(
                            'assets/images/login_bg.jpg',
                            fit: BoxFit.cover,
                            errorBuilder: (_, _, _) =>
                                Container(color: PandaColors.laranja),
                          ),
                          // Escurecimento + fusão total com o fundo escuro.
                          // Chega a AuthCores.bg OPACO antes da base, então a foto dissolve
                          // no fundo sem nenhuma linha/emenda visível.
                          DecoratedBox(
                            decoration: BoxDecoration(
                              gradient: LinearGradient(
                                begin: Alignment.topCenter,
                                end: Alignment.bottomCenter,
                                colors: [
                                  AuthCores.bg.withValues(alpha: 0.45),
                                  AuthCores.bg.withValues(alpha: 0.0),
                                  AuthCores.bg.withValues(alpha: 0.5),
                                  AuthCores.bg,
                                  AuthCores.bg,
                                ],
                                stops: const [0, 0.25, 0.58, 0.82, 1],
                              ),
                            ),
                          ),
                          // Brilho laranja suave (glow de marca).
                          Positioned(
                            top: 30,
                            right: 24,
                            child: Container(
                              width: 140,
                              height: 140,
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                gradient: RadialGradient(
                                  colors: [
                                    PandaColors.laranja.withValues(alpha: 0.35),
                                    Colors.transparent,
                                  ],
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),

                    // Logo circular sobre a emenda — sem borda, a imagem
                    // preenche todo o círculo (BoxFit.cover recortado).
                    Positioned(
                      top: heroH - 52,
                      left: 0,
                      right: 0,
                      child: Center(
                        child: Container(
                          width: 104,
                          height: 104,
                          clipBehavior: Clip.antiAlias,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            boxShadow: [
                              BoxShadow(
                                color: Colors.black.withValues(alpha: 0.5),
                                blurRadius: 24,
                                offset: const Offset(0, 10),
                              ),
                            ],
                          ),
                          child: Image.asset(
                            'assets/logo/panda_logo.png',
                            fit: BoxFit.cover,
                            errorBuilder: (_, _, _) =>
                                Container(color: PandaColors.laranja),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),

              // ---------- FORM ----------
              Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 460),
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(24, 6, 24, 32),
                    child: Form(
                      key: _formKey,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          const AuthCabecalho(
                            logo: false,
                            titulo: 'Acesse sua conta',
                            subtitulo:
                                'Entre e aproveite suas vantagens de sócio.',
                          ),
                          AuthCampo(
                            controller: _email,
                            rotulo: 'E-mail',
                            hint: 'voce@email.com',
                            icone: Icons.alternate_email_rounded,
                            keyboardType: TextInputType.emailAddress,
                            textInputAction: TextInputAction.next,
                            autofillHints: const [AutofillHints.email],
                            validator: (v) => (v == null || !v.contains('@'))
                                ? 'E-mail inválido'
                                : null,
                          ),
                          const SizedBox(height: 20),
                          AuthCampoSenha(
                            controller: _senha,
                            hint: 'Sua senha',
                            textInputAction: TextInputAction.done,
                            onSubmitted: (_) => _loading ? null : _entrar(),
                            // Login aceita senhas antigas (6+); a regra forte
                            // vale só ao criar/trocar.
                            validator: (v) => (v == null || v.length < 6)
                                ? 'Mínimo 6 caracteres'
                                : null,
                          ),
                          Align(
                            alignment: Alignment.centerRight,
                            child: AuthLink(
                              texto: 'Esqueci a senha',
                              onPressed: _recuperarSenha,
                            ),
                          ),
                          const SizedBox(height: 4),
                          AuthErro(_erro),
                          AuthBotao(
                            texto: 'Entrar',
                            carregando: _loading,
                            onPressed: _entrar,
                          ),
                          const SizedBox(height: 20),
                          const AuthDivisorOu(),
                          const SizedBox(height: 16),
                          BotaoSocial(
                            onTap: _loading ? null : _entrarGoogle,
                            icone: const GoogleG(),
                            texto: 'Continuar com Google',
                            corFundo: AuthCores.card,
                            corBorda: AuthCores.borda,
                          ),
                          // Apple exige o botão em plataformas Apple (e web Safari).
                          if (defaultTargetPlatform == TargetPlatform.iOS ||
                              defaultTargetPlatform ==
                                  TargetPlatform.macOS) ...[
                            const SizedBox(height: 12),
                            BotaoSocial(
                              onTap: _loading ? null : _entrarApple,
                              icone: const Icon(
                                Icons.apple_rounded,
                                color: Colors.white,
                                size: 24,
                              ),
                              texto: 'Continuar com Apple',
                              corFundo: AuthCores.card,
                              corBorda: AuthCores.borda,
                            ),
                          ],
                          const SizedBox(height: 28),
                          const Text(
                            'Ainda não tem conta?',
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              color: AuthCores.textoSuave,
                              fontSize: 15,
                            ),
                          ),
                          const SizedBox(height: 10),
                          AuthBotaoSecundario(
                            texto: 'Criar conta',
                            onPressed: () => context.go('/signup'),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
