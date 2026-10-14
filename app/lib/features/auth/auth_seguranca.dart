import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/demo.dart';
import '../../core/services/services.dart';
import '../../core/theme/colors.dart';
import 'auth_mfa.dart';
import 'auth_senha.dart';
import 'auth_widgets.dart';

/// Seção "Segurança" das Configurações: troca de senha e verificação em duas
/// etapas (TOTP, opcional). Só aparece para quem tem senha; Google/Apple já têm
/// a própria verificação.
class SegurancaSection extends ConsumerStatefulWidget {
  const SegurancaSection({super.key});

  @override
  ConsumerState<SegurancaSection> createState() => _SegurancaSectionState();
}

class _SegurancaSectionState extends ConsumerState<SegurancaSection> {
  Future<List<MultiFactorInfo>>? _fatores;
  bool _ocupado = false;

  User? get _user => ref.read(firebaseAuthProvider).currentUser;

  void _recarregar() {
    final u = _user;
    setState(() => _fatores = u?.multiFactor.getEnrolledFactors());
  }

  @override
  void initState() {
    super.initState();
    if (!kDemo) {
      // ref.read em initState é seguro; o setState só roda aqui, sem await.
      _fatores = ref
          .read(firebaseAuthProvider)
          .currentUser
          ?.multiFactor
          .getEnrolledFactors();
    }
  }

  void _aviso(String texto) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(texto)));
  }

  /// Roda [acao]; se o Firebase pedir login recente, reautentica e repete.
  Future<T?> _comReautenticacao<T>(User user, Future<T> Function() acao) async {
    try {
      return await acao();
    } on FirebaseAuthException catch (e) {
      if (e.code != 'requires-recent-login') rethrow;
      if (!mounted) return null;
      if (!await reautenticar(context, user)) return null;
      return await acao();
    }
  }

  Future<void> _alterarSenha() async {
    final user = _user;
    if (user == null) return;
    final ok = await mostrarDialogoAuth<bool>(
      context,
      (_) => _DialogoNovaSenha(user: user),
    );
    if (ok == true) _aviso('Senha alterada.');
  }

  Future<void> _ativar() async {
    final user = _user;
    if (user == null || _ocupado) return;
    setState(() => _ocupado = true);
    try {
      final secret = await _comReautenticacao(user, () async {
        final sessao = await user.multiFactor.getSession();
        return TotpMultiFactorGenerator.generateSecret(sessao);
      });
      if (secret == null || !mounted) return;
      final url = await secret.generateQrCodeUrl(
        accountName: user.email,
        issuer: 'PandaVip',
      );
      if (!mounted) return;
      final ok = await mostrarDialogoAuth<bool>(
        context,
        (_) => _DialogoAtivarTotp(user: user, secret: secret, url: url),
      );
      if (ok == true) {
        _aviso('Verificação em duas etapas ativada.');
        _recarregar();
      }
    } on FirebaseAuthException catch (e) {
      debugPrint('MFA ativar: ${e.code}');
      _aviso(mensagemErroAuth(e));
    } finally {
      if (mounted) setState(() => _ocupado = false);
    }
  }

  Future<void> _desativar(MultiFactorInfo info) async {
    final user = _user;
    if (user == null || _ocupado) return;
    final sim = await mostrarDialogoAuth<bool>(
      context,
      (c) => DialogoAuthBase(
        titulo: 'Desativar verificação?',
        children: [
          const Text(
            'Sua conta voltará a entrar só com e-mail e senha, que fica menos '
            'protegida.',
            style: TextStyle(
              color: AuthCores.textoSuave,
              fontSize: 15.5,
              height: 1.45,
            ),
          ),
          const SizedBox(height: 18),
          AuthBotao(
            texto: 'Desativar',
            onPressed: () => Navigator.pop(c, true),
          ),
          const SizedBox(height: 10),
          AuthBotaoSecundario(
            texto: 'Manter ativada',
            onPressed: () => Navigator.pop(c, false),
          ),
        ],
      ),
    );
    if (sim != true || !mounted) return;
    setState(() => _ocupado = true);
    try {
      final feito = await _comReautenticacao(user, () async {
        await user.multiFactor.unenroll(multiFactorInfo: info);
        return true;
      });
      if (feito == true) {
        _aviso('Verificação em duas etapas desativada.');
        _recarregar();
      }
    } on FirebaseAuthException catch (e) {
      debugPrint('MFA desativar: ${e.code}');
      _aviso(mensagemErroAuth(e));
    } finally {
      if (mounted) setState(() => _ocupado = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(authStateProvider).value;
    final temSenha =
        user?.providerData.any((p) => p.providerId == 'password') ?? false;
    final tema = Theme.of(context);
    final suave = tema.textTheme.bodyMedium?.color?.withValues(alpha: 0.75);

    if (kDemo || user == null) return const SizedBox.shrink();

    if (!temSenha) {
      return Padding(
        padding: const EdgeInsets.only(top: 12),
        child: Text(
          'Sua conta entra com Google ou Apple, que já têm verificação em '
          'duas etapas própria. Ative na configuração da sua conta Google/Apple.',
          style: TextStyle(fontSize: 14.5, height: 1.45, color: suave),
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: 12),
        OutlinedButton.icon(
          onPressed: _ocupado ? null : _alterarSenha,
          icon: const Icon(Icons.password_rounded, size: 20),
          label: const Text('Alterar senha'),
          style: OutlinedButton.styleFrom(
            minimumSize: const Size.fromHeight(52),
          ),
        ),
        const SizedBox(height: 16),
        FutureBuilder<List<MultiFactorInfo>>(
          future: _fatores,
          builder: (context, snap) {
            final lista = snap.data ?? const <MultiFactorInfo>[];
            final ativo = lista.where((f) => f.factorId == 'totp').firstOrNull;
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'Verificação em duas etapas',
                  style: tema.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  ativo != null
                      ? 'Ativada. Ao entrar, você digita também um código do app autenticador.'
                      : 'Opcional. Pede um código do app autenticador (Google Authenticator, Authy…) ao entrar, além da senha.',
                  style: TextStyle(fontSize: 14.5, height: 1.45, color: suave),
                ),
                const SizedBox(height: 10),
                if (snap.connectionState == ConnectionState.waiting)
                  const Center(child: CircularProgressIndicator())
                else if (ativo != null)
                  OutlinedButton.icon(
                    onPressed: _ocupado ? null : () => _desativar(ativo),
                    icon: const Icon(Icons.shield_outlined, size: 20),
                    label: const Text('Desativar verificação'),
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size.fromHeight(52),
                      foregroundColor: PandaColors.vermelhoAcento,
                      side: const BorderSide(color: PandaColors.vermelhoAcento),
                    ),
                  )
                else
                  FilledButton.icon(
                    onPressed: _ocupado ? null : _ativar,
                    icon: const Icon(Icons.shield_outlined, size: 20),
                    label: const Text('Ativar verificação'),
                    style: FilledButton.styleFrom(
                      minimumSize: const Size.fromHeight(52),
                      backgroundColor: PandaColors.laranja,
                    ),
                  ),
              ],
            );
          },
        ),
      ],
    );
  }
}

class _DialogoNovaSenha extends StatefulWidget {
  const _DialogoNovaSenha({required this.user});
  final User user;

  @override
  State<_DialogoNovaSenha> createState() => _DialogoNovaSenhaState();
}

class _DialogoNovaSenhaState extends State<_DialogoNovaSenha> {
  final _form = GlobalKey<FormState>();
  final _atual = TextEditingController();
  final _nova = TextEditingController();
  final _confirma = TextEditingController();
  bool _enviando = false;
  String? _erro;

  @override
  void dispose() {
    _atual.dispose();
    _nova.dispose();
    _confirma.dispose();
    super.dispose();
  }

  Future<void> _salvar() async {
    if (!_form.currentState!.validate()) return;
    final email = widget.user.email;
    if (email == null) return;
    setState(() {
      _enviando = true;
      _erro = null;
    });
    try {
      final cred = EmailAuthProvider.credential(
        email: email,
        password: _atual.text,
      );
      try {
        await widget.user.reauthenticateWithCredential(cred);
      } on FirebaseAuthMultiFactorException catch (e) {
        if (!mounted) return;
        final r = await resolverSegundoFator(context, e);
        if (r == null) {
          if (mounted) setState(() => _enviando = false);
          return;
        }
      }
      await widget.user.updatePassword(_nova.text);
      if (mounted) Navigator.of(context).pop(true);
    } on FirebaseAuthException catch (e) {
      debugPrint('trocar senha: ${e.code}');
      if (mounted) {
        setState(() {
          _enviando = false;
          _erro = mensagemErroAuth(e);
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _enviando = false;
          _erro = 'Não foi possível concluir. Tente de novo.';
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return DialogoAuthBase(
      titulo: 'Alterar senha',
      children: [
        Form(
          key: _form,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              AuthCampoSenha(
                controller: _atual,
                rotulo: 'Senha atual',
                validator: (v) =>
                    (v == null || v.isEmpty) ? 'Digite sua senha atual.' : null,
              ),
              const SizedBox(height: 16),
              AuthCampoSenha(
                controller: _nova,
                rotulo: 'Nova senha',
                autofillHints: const [AutofillHints.newPassword],
                onChanged: (_) => setState(() {}),
                validator: (v) => validarSenhaForte(v ?? ''),
              ),
              const SizedBox(height: 10),
              ChecklistSenha(senha: _nova.text),
              const SizedBox(height: 16),
              AuthCampoSenha(
                controller: _confirma,
                rotulo: 'Confirmar nova senha',
                autofillHints: const [AutofillHints.newPassword],
                validator: (v) =>
                    v != _nova.text ? 'As senhas não são iguais.' : null,
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        AuthErro(_erro),
        AuthBotao(
          texto: 'Salvar senha',
          carregando: _enviando,
          onPressed: _salvar,
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

class _DialogoAtivarTotp extends StatefulWidget {
  const _DialogoAtivarTotp({
    required this.user,
    required this.secret,
    required this.url,
  });

  final User user;
  final TotpSecret secret;
  final String url;

  @override
  State<_DialogoAtivarTotp> createState() => _DialogoAtivarTotpState();
}

class _DialogoAtivarTotpState extends State<_DialogoAtivarTotp> {
  final _codigo = TextEditingController();
  bool _enviando = false;
  String? _erro;

  @override
  void dispose() {
    _codigo.dispose();
    super.dispose();
  }

  Future<void> _abrirApp() async {
    var aberto = false;
    try {
      aberto = await launchUrl(
        Uri.parse(widget.url),
        mode: LaunchMode.externalApplication,
      );
    } catch (_) {
      // Sem log: a exceção traz a URL otpauth:// com o segredo TOTP.
    }
    if (!aberto && mounted) {
      setState(
        () => _erro =
            'Nenhum app autenticador encontrado. Instale um e use a chave abaixo.',
      );
    }
  }

  Future<void> _ativar() async {
    final c = _codigo.text.trim();
    if (!RegExp(r'^\d{6}$').hasMatch(c)) {
      setState(() => _erro = 'Digite os 6 números que aparecem no app.');
      return;
    }
    setState(() {
      _enviando = true;
      _erro = null;
    });
    try {
      final assertion =
          await TotpMultiFactorGenerator.getAssertionForEnrollment(
            widget.secret,
            c,
          );
      await widget.user.multiFactor.enroll(
        assertion,
        displayName: 'App autenticador',
      );
      if (mounted) Navigator.of(context).pop(true);
    } on FirebaseAuthException catch (e) {
      debugPrint('MFA enroll: ${e.code}');
      if (mounted) {
        setState(() {
          _enviando = false;
          _erro = mensagemErroAuth(e);
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _enviando = false;
          _erro = 'Não foi possível concluir. Tente de novo.';
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final messenger = ScaffoldMessenger.of(context);
    return DialogoAuthBase(
      titulo: 'Ativar verificação',
      children: [
        const Text(
          '1. Abra um app autenticador (Google Authenticator, Authy…) e '
          'escaneie o QR code, ou copie a chave.',
          style: TextStyle(
            color: AuthCores.textoSuave,
            fontSize: 15.5,
            height: 1.45,
          ),
        ),
        const SizedBox(height: 14),
        Center(
          child: Container(
            padding: const EdgeInsets.all(10),
            color: Colors.white,
            child: QrImageView(data: widget.url, size: 190),
          ),
        ),
        const SizedBox(height: 14),
        SelectableText(
          widget.secret.secretKey,
          textAlign: TextAlign.center,
          style: const TextStyle(
            color: Colors.white,
            fontSize: 16,
            letterSpacing: 1.5,
            fontFamily: 'monospace',
          ),
        ),
        const SizedBox(height: 10),
        AuthBotaoSecundario(
          texto: 'Copiar chave',
          icone: Icons.copy_rounded,
          onPressed: () => copiarComAviso(
            messenger,
            widget.secret.secretKey,
            'Chave copiada.',
          ),
        ),
        const SizedBox(height: 10),
        AuthBotaoSecundario(
          texto: 'Abrir no app autenticador',
          icone: Icons.open_in_new_rounded,
          onPressed: _abrirApp,
        ),
        const SizedBox(height: 18),
        const Text(
          '2. Digite o código de 6 dígitos que o app mostra.',
          style: TextStyle(
            color: AuthCores.textoSuave,
            fontSize: 15.5,
            height: 1.45,
          ),
        ),
        const SizedBox(height: 12),
        AuthCampo(
          controller: _codigo,
          rotulo: 'Código de 6 dígitos',
          hint: '000000',
          icone: Icons.pin_outlined,
          keyboardType: TextInputType.number,
          maxLength: 6,
          onSubmitted: (_) => _ativar(),
        ),
        const SizedBox(height: 16),
        AuthErro(_erro),
        AuthBotao(texto: 'Ativar', carregando: _enviando, onPressed: _ativar),
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
