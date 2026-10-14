import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/demo.dart';
import '../../core/services/chamada.dart';
import '../../core/services/fila_pendentes.dart';
import '../../core/services/services.dart';
import 'auth_mfa.dart';
import 'auth_perfil.dart';
import 'auth_senha.dart';
import 'auth_widgets.dart';
import 'botao_social.dart';

class SignupScreen extends ConsumerStatefulWidget {
  const SignupScreen({super.key});

  @override
  ConsumerState<SignupScreen> createState() => _SignupScreenState();
}

class _SignupScreenState extends ConsumerState<SignupScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nome = TextEditingController();
  final _email = TextEditingController();
  final _telefone = TextEditingController();
  final _senha = TextEditingController();
  final _confirma = TextEditingController();
  final _codigo = TextEditingController();
  DateTime? _nascimento;
  bool _loading = false;
  bool _aceitou = false;
  String? _erro;

  @override
  void dispose() {
    _nome.dispose();
    _email.dispose();
    _telefone.dispose();
    _senha.dispose();
    _confirma.dispose();
    _codigo.dispose();
    super.dispose();
  }

  Future<void> _escolherData() async {
    final escolhida = await escolherNascimento(context, _nascimento);
    if (escolhida != null && mounted) setState(() => _nascimento = escolhida);
  }

  /// Cadastro pelo Google. Não passa por aqui nada do formulário: o que falta
  /// (telefone e nascimento) é pedido depois, em /completar-perfil, pra não
  /// travar o atalho de um toque com um formulário.
  Future<void> _cadastrarComGoogle() async {
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
      await entrarComGoogle(ref);
    } on FirebaseAuthMultiFactorException catch (e) {
      if (!mounted) return;
      final cred = await resolverSegundoFator(context, e);
      final user = cred?.user;
      if (user != null) await garantirPerfil(db, user);
    } on FirebaseAuthException catch (e) {
      if (mounted) setState(() => _erro = mensagemErroAuth(e));
    } catch (_) {
      if (mounted) {
        setState(() => _erro = 'Não foi possível entrar com o Google.');
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _cadastrar() async {
    if (!_formKey.currentState!.validate()) return;
    if (!_aceitou) {
      setState(() => _erro = 'Aceite os Termos e a Política para continuar.');
      return;
    }
    // Demo: simula cadastro e entra direto.
    if (kDemo) {
      context.go('/home');
      return;
    }

    // TUDO que depende de `ref`/`context` é lido ANTES do primeiro `await`.
    // Quando o cadastro termina, o authState muda e o router desmonta esta
    // tela: usar `ref` depois disso lança erro em Riverpod 3 — foi o que
    // deixava o perfil sem nome, telefone e nascimento.
    final auth = ref.read(firebaseAuthProvider);
    final db = ref.read(firestoreProvider);
    final functions = ref.read(functionsProvider);
    final fila = ref.read(filaPendentesProvider.notifier);
    final messenger = ScaffoldMessenger.of(context);
    final nome = _nome.text.trim();
    final email = _email.text.trim();
    final telefone = _telefone.text.trim();
    final senha = _senha.text;
    final nascimento = _nascimento;
    final codigo = _codigo.text.trim();

    setState(() {
      _loading = true;
      _erro = null;
    });

    try {
      final cred = await auth.createUserWithEmailAndPassword(
        email: email,
        password: senha,
      );
      final user = cred.user!;

      // Perfil primeiro: é o que não pode se perder. O resto (nome na conta,
      // e-mail de confirmação, indicação) é secundário.
      try {
        await db.doc('users/${user.uid}').set({
          'uid': user.uid,
          'nome': nome,
          'email': email,
          'telefone': telefone,
          if (nascimento != null) 'nascimento': Timestamp.fromDate(nascimento),
          'criadoEm': FieldValue.serverTimestamp(),
          'termosAceitosEm': FieldValue.serverTimestamp(),
          'termosVersao': termosVersao,
        }, SetOptions(merge: true));
      } on FirebaseException catch (e) {
        // Não bloqueia: /completar-perfil pede de novo o que faltar.
        debugPrint('Cadastro: perfil não gravado (${e.code}): ${e.message}');
      }

      try {
        await user.updateDisplayName(nome);
      } catch (_) {}

      // Link de confirmação. O router segura em /verificar-email enquanto o
      // e-mail não for confirmado — é o que impede cadastro com endereço
      // inventado ou de outra pessoa.
      try {
        await user.sendEmailVerification();
      } catch (_) {
        // Limite de envio do Firebase: a tela de verificação tem "Reenviar".
      }

      // Código de indicação (opcional). Falha aqui não bloqueia o cadastro —
      // a conta já existe. Repete (a função recusa a segunda aplicação) e, se
      // ainda assim não for, avisa e guarda na fila.
      String? avisoIndicacao;
      if (codigo.isNotEmpty) {
        try {
          await Chamada.chamar(
            functions,
            'applyReferral',
            dados: {'code': codigo},
            repetir: true,
          );
        } catch (e) {
          final recusado =
              e is FirebaseFunctionsException &&
              (e.code == 'not-found' || e.code == 'already-exists');
          if (recusado) {
            avisoIndicacao = e.message ?? 'Código de indicação não aplicado.';
          } else {
            await fila.enfileirar('applyReferral', dados: {'code': codigo});
            avisoIndicacao =
                'Sem conexão para aplicar o código de indicação agora. '
                'Ele ficou guardado e será aplicado sozinho.';
          }
        }
      }

      if (avisoIndicacao != null) {
        messenger.showSnackBar(
          SnackBar(
            content: Text(avisoIndicacao),
            duration: const Duration(seconds: 6),
          ),
        );
      }
    } on FirebaseAuthException catch (e) {
      debugPrint('Cadastro: ${e.code}');
      if (mounted) setState(() => _erro = mensagemErroAuth(e));
    } catch (e) {
      debugPrint('Cadastro: $e');
      if (mounted) {
        setState(() => _erro = 'Não foi possível cadastrar. Tente de novo.');
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AuthScaffold(
      onVoltar: () => context.go('/login'),
      children: [
        const AuthCabecalho(
          titulo: 'Criar conta',
          subtitulo: 'Preencha seus dados para começar.',
        ),
        Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              AuthCampo(
                controller: _nome,
                rotulo: 'Nome',
                hint: 'Seu nome',
                icone: Icons.person_outline_rounded,
                textCapitalization: TextCapitalization.words,
                textInputAction: TextInputAction.next,
                autofillHints: const [AutofillHints.name],
                maxLength: 120,
                validator: (v) =>
                    (v == null || v.trim().isEmpty) ? 'Informe seu nome' : null,
              ),
              const SizedBox(height: 20),
              AuthCampo(
                controller: _email,
                rotulo: 'E-mail',
                hint: 'voce@email.com',
                icone: Icons.alternate_email_rounded,
                keyboardType: TextInputType.emailAddress,
                textInputAction: TextInputAction.next,
                autofillHints: const [AutofillHints.email],
                validator: (v) =>
                    (v == null || !v.contains('@')) ? 'E-mail inválido' : null,
              ),
              const SizedBox(height: 20),
              AuthCampo(
                controller: _telefone,
                rotulo: 'Telefone (WhatsApp)',
                hint: '(14) 90000-0000',
                icone: Icons.phone_outlined,
                keyboardType: TextInputType.phone,
                textInputAction: TextInputAction.next,
                autofillHints: const [AutofillHints.telephoneNumber],
                maxLength: 32,
                validator: (v) =>
                    (v ?? '').replaceAll(RegExp(r'\D'), '').length < 10
                    ? 'Telefone incompleto (com DDD).'
                    : null,
              ),
              const SizedBox(height: 20),
              AuthCampoData(
                rotulo: 'Aniversário',
                valor: _nascimento,
                onTap: _escolherData,
                onChanged: (d) => setState(() => _nascimento = d),
                ajuda: 'Assim o restaurante sabe a data do seu aniversário.',
              ),
              const SizedBox(height: 20),
              AuthCampoSenha(
                controller: _senha,
                rotulo: 'Senha',
                autofillHints: const [AutofillHints.newPassword],
                textInputAction: TextInputAction.next,
                onChanged: (_) => setState(() {}),
                // Só no cadastro: o login segue aceitando senhas antigas.
                validator: (v) => validarSenhaForte(v ?? ''),
              ),
              const SizedBox(height: 10),
              ChecklistSenha(senha: _senha.text),
              const SizedBox(height: 20),
              AuthCampoSenha(
                controller: _confirma,
                rotulo: 'Confirmar senha',
                autofillHints: const [AutofillHints.newPassword],
                textInputAction: TextInputAction.next,
                validator: (v) =>
                    v != _senha.text ? 'As senhas não são iguais.' : null,
              ),
              const SizedBox(height: 20),
              AuthCampo(
                controller: _codigo,
                rotulo: 'Código de indicação (opcional)',
                hint: 'Código de quem indicou você',
                icone: Icons.group_add_outlined,
                textCapitalization: TextCapitalization.characters,
                textInputAction: TextInputAction.done,
              ),
              const SizedBox(height: 12),
              AuthAceiteTermos(
                aceito: _aceitou,
                onChanged: (v) => setState(() => _aceitou = v),
              ),
              const SizedBox(height: 12),
              AuthErro(_erro),
              AuthBotao(
                texto: 'Criar conta',
                carregando: _loading,
                onPressed: _cadastrar,
              ),
            ],
          ),
        ),
        const SizedBox(height: 20),
        const AuthDivisorOu(),
        const SizedBox(height: 16),
        BotaoSocial(
          onTap: _loading ? null : _cadastrarComGoogle,
          icone: const GoogleG(),
          texto: 'Continuar com Google',
          corFundo: AuthCores.card,
          corBorda: AuthCores.borda,
        ),
        const SizedBox(height: 12),
        AuthBotaoSecundario(
          texto: 'Já tenho conta',
          onPressed: () => context.go('/login'),
        ),
      ],
    );
  }
}
