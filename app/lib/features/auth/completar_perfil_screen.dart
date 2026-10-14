import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/services/services.dart';
import 'auth_perfil.dart';
import 'auth_widgets.dart';

/// Completa o cadastro de quem ficou sem algum dado do perfil.
///
/// O Google entrega nome, e-mail e foto — não entrega telefone nem data de
/// nascimento. E cadastros por e-mail cuja gravação falhou ficam sem nome. Os
/// três fazem falta: o telefone é como o salão acha o sócio na hora do
/// resgate, e o nascimento alimenta o aviso de aniversário.
///
/// O router só desvia pra cá quando o doc do perfil **já chegou** do Firestore
/// e está mesmo faltando campo — nunca durante o carregamento.
class CompletarPerfilScreen extends ConsumerStatefulWidget {
  const CompletarPerfilScreen({super.key});

  @override
  ConsumerState<CompletarPerfilScreen> createState() =>
      _CompletarPerfilScreenState();
}

class _CompletarPerfilScreenState extends ConsumerState<CompletarPerfilScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nome = TextEditingController();
  final _telefone = TextEditingController();
  DateTime? _nascimento;
  bool _salvando = false;
  bool _aceitou = false;
  String? _erro;

  /// Pede o nome só se o perfil chegou sem ele. Decidido uma vez, no início:
  /// se dependesse do doc ao vivo, o campo sumiria no meio da digitação.
  late final bool _pedirNome;

  /// Cadastro já completo, só falta aceitar a versão atual dos termos (conta
  /// antiga ou termos atualizados). Aí a tela pede apenas o aceite.
  late final bool _soTermos;

  @override
  void initState() {
    super.initState();
    // Se o doc já tinha algum dado (veio da function, por exemplo), não faz o
    // sócio digitar de novo.
    final atual = ref.read(currentUserProvider).value;
    _nome.text = atual?.nome ?? '';
    _telefone.text = atual?.telefone ?? '';
    _nascimento = atual?.nascimento;
    _pedirNome = _nome.text.trim().isEmpty;
    _soTermos =
        !_pedirNome && _telefone.text.trim().isNotEmpty && _nascimento != null;
  }

  @override
  void dispose() {
    _nome.dispose();
    _telefone.dispose();
    super.dispose();
  }

  Future<void> _escolherData() async {
    final escolhida = await escolherNascimento(context, _nascimento);
    if (escolhida != null && mounted) setState(() => _nascimento = escolhida);
  }

  Future<void> _salvar() async {
    if (!_formKey.currentState!.validate()) return;
    if (_nascimento == null) {
      setState(() => _erro = 'Escolha sua data de nascimento.');
      return;
    }

    if (!_aceitou) {
      setState(() => _erro = 'Aceite os Termos e a Política para continuar.');
      return;
    }

    // Tudo lido antes do primeiro await.
    final auth = ref.read(firebaseAuthProvider);
    final db = ref.read(firestoreProvider);
    final messenger = ScaffoldMessenger.of(context);
    final user = auth.currentUser;
    if (user == null) return;
    final nome = _nome.text.trim();
    final telefone = _telefone.text.trim();
    final nascimento = _nascimento!;

    // Fecha o teclado: ele cobria o botão e o erro.
    FocusScope.of(context).unfocus();
    setState(() {
      _salvando = true;
      _erro = null;
    });
    try {
      // `set` com merge cria o doc se ele ainda não existir. Os campos
      // `uid`/`email` entram pra passar nas regras de criação.
      await db
          .doc('users/${user.uid}')
          .set(
            _soTermos
                ? {
                    'termosAceitosEm': FieldValue.serverTimestamp(),
                    'termosVersao': termosVersao,
                  }
                : {
                    'uid': user.uid,
                    if (user.email != null) 'email': user.email,
                    if (_pedirNome) 'nome': nome,
                    'telefone': telefone,
                    'nascimento': Timestamp.fromDate(nascimento),
                    'termosAceitosEm': FieldValue.serverTimestamp(),
                    'termosVersao': termosVersao,
                  },
            SetOptions(merge: true),
          );
      // Sem navegação na mão: o doc muda, `perfilCompletoProvider` vira true e
      // o router solta pra /home sozinho.
    } on FirebaseException catch (e) {
      debugPrint('Completar perfil: ${e.code}: ${e.message}');
      final msg = e.code == 'permission-denied'
          ? 'Sem permissão para salvar (${e.code}). Fale com o restaurante.'
          : 'Não foi possível salvar agora (${e.code}). Tente de novo.';
      messenger.showSnackBar(SnackBar(content: Text(msg)));
      if (mounted) setState(() => _erro = msg);
    } catch (e) {
      debugPrint('Completar perfil: $e');
      const msg = 'Não foi possível salvar agora. Tente de novo.';
      messenger.showSnackBar(const SnackBar(content: Text(msg)));
      if (mounted) setState(() => _erro = msg);
    } finally {
      if (mounted) setState(() => _salvando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final nomeAtual = ref.watch(currentUserProvider).value?.nome ?? '';
    final primeiro = nomeAtual.trim().split(' ').first;

    return AuthScaffold(
      children: [
        AuthCabecalho(
          logo: false,
          titulo: _soTermos
              ? 'Atualizamos nossos termos'
              : (primeiro.isEmpty ? 'Quase lá' : 'Quase lá, $primeiro'),
          subtitulo: _soTermos
              ? 'Para continuar usando o app, leia e aceite os Termos de Uso e a Política de Privacidade.'
              : _pedirNome
              ? 'Faltam alguns dados para completar seu cadastro.'
              : 'Faltam dois dados para completar seu cadastro.',
        ),
        Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (_pedirNome) ...[
                AuthCampo(
                  controller: _nome,
                  rotulo: 'Nome',
                  hint: 'Seu nome',
                  icone: Icons.person_outline_rounded,
                  textCapitalization: TextCapitalization.words,
                  textInputAction: TextInputAction.next,
                  maxLength: 120,
                  validator: (v) => (v == null || v.trim().isEmpty)
                      ? 'Informe seu nome.'
                      : null,
                ),
                const SizedBox(height: 20),
              ],
              if (!_soTermos) ...[
                AuthCampo(
                  controller: _telefone,
                  rotulo: 'Telefone com DDD',
                  hint: '(14) 90000-0000',
                  icone: Icons.phone_outlined,
                  keyboardType: TextInputType.phone,
                  textInputAction: TextInputAction.done,
                  maxLength: 32,
                  ajuda:
                      'O restaurante usa o telefone para identificar você no resgate.',
                  validator: (v) {
                    final so = (v ?? '').replaceAll(RegExp(r'\D'), '');
                    return so.length < 10 ? 'Telefone incompleto.' : null;
                  },
                ),
                const SizedBox(height: 20),
                AuthCampoData(
                  valor: _nascimento,
                  onTap: _escolherData,
                  onChanged: (d) => setState(() => _nascimento = d),
                  ajuda: 'Assim o restaurante sabe a data do seu aniversário.',
                ),
                const SizedBox(height: 12),
              ],
              AuthAceiteTermos(
                aceito: _aceitou,
                onChanged: (v) => setState(() => _aceitou = v),
              ),
              const SizedBox(height: 12),
              // Erro colado ao botão, não no fim da rolagem.
              AuthErro(_erro),
              AuthBotao(
                texto: _soTermos ? 'Aceitar e continuar' : 'Concluir cadastro',
                carregando: _salvando,
                onPressed: _salvar,
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        AuthBotaoSecundario(
          texto: 'Sair',
          icone: Icons.logout_rounded,
          onPressed: _salvando ? null : () => sair(ref),
        ),
      ],
    );
  }
}
