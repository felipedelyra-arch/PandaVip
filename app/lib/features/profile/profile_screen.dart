import 'dart:io' show Platform;

import 'package:firebase_storage/firebase_storage.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/services/services.dart';
import '../../core/services/chamada.dart';
import '../../core/demo.dart';
import '../../core/restaurante.dart';
import '../../core/theme/colors.dart';
import '../../core/theme/dimens.dart';
import '../../core/widgets/state_views.dart';
import '../../core/widgets/entrada.dart';
import '../../core/models/models.dart';
import '../cart/endereco.dart';

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(currentUserProvider);
    final redemptions = ref.watch(redemptionsProvider);
    final isSub = ref.watch(isSubscriberProvider);
    final cupons = redemptions.value ?? const [];

    return Scaffold(
      body: SafeArea(
        child: user.when(
          loading: () => const LoadingView(),
          error: (e, _) =>
              const ErrorView(mensagem: 'Não foi possível carregar o perfil.'),
          data: (u) {
            if (u == null) return const EmptyView(mensagem: 'Sem dados.');
            return ListView(
              padding: const EdgeInsets.fromLTRB(24, 12, 24, 32),
              children: escalonar([
                // Engrenagem no topo: ajustes e dados de conta saíram daqui
                // pra não competir com o que o sócio abre o perfil pra ver.
                const Align(
                  alignment: Alignment.centerRight,
                  child: _BotaoConfiguracoes(),
                ),
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: _Header(user: u, isSub: isSub),
                ),
                Padding(
                  padding: const EdgeInsets.only(top: 18),
                  child: _StatsRow(cupons: cupons.length, socio: isSub),
                ),
                Padding(
                  padding: const EdgeInsets.only(top: 24),
                  child: _IndicarCard(indicacoes: u.indicacoes),
                ),
                const Padding(
                  padding: EdgeInsets.only(top: 30),
                  child: SectionLabel('Endereço de entrega'),
                ),
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: EnderecoCard(
                    linha: u.enderecoEntrega != null
                        ? EnderecoEntrega.fromMap(u.enderecoEntrega!).linha
                        : u.endereco,
                    onEditar: () => editarEndereco(
                      context,
                      atual: u.enderecoEntrega == null
                          ? null
                          : EnderecoEntrega.fromMap(u.enderecoEntrega!),
                    ),
                  ),
                ),
                const Padding(
                  padding: EdgeInsets.only(top: 30),
                  child: SectionLabel('Meus cupons'),
                ),
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: redemptions.when(
                    loading: () => const Padding(
                      padding: EdgeInsets.only(top: 16),
                      child: LoadingView(),
                    ),
                    error: (_, _) =>
                        const Text('Não foi possível carregar os cupons.'),
                    data: (list) {
                      if (list.isEmpty) {
                        return const _VazioLinha(
                          texto: 'Você ainda não resgatou nenhum prêmio.',
                        );
                      }
                      return Column(
                        children: [
                          for (final r in list) ...[
                            _CupomTile(r: r),
                            const SizedBox(height: 12),
                          ],
                        ],
                      );
                    },
                  ),
                ),
              ]),
            );
          },
        ),
      ),
    );
  }
}

/// Engrenagem que abre as configurações. Mesmo formato do sino da Home,
/// pra o usuário reconhecer o padrão de "botão de canto".
class _BotaoConfiguracoes extends StatelessWidget {
  const _BotaoConfiguracoes();

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Tooltip(
      message: 'Configurações',
      child: Material(
        color: isDark ? PandaColors.cardDark : PandaColors.branco,
        borderRadius: PandaRadius.bsm,
        child: InkWell(
          onTap: () => context.push('/configuracoes'),
          borderRadius: PandaRadius.bsm,
          child: Ink(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              borderRadius: PandaRadius.bsm,
              border: Border.all(
                color: isDark ? PandaColors.hairlineDark : PandaColors.hairline,
              ),
            ),
            child: const Icon(
              Icons.settings_outlined,
              size: 21,
              color: PandaColors.laranja,
            ),
          ),
        ),
      ),
    );
  }
}

/// Indicar amigos não é configuração — é o que faz o Clube crescer.
/// Fica em destaque no perfil em vez de virar mais um item de lista.
class _IndicarCard extends StatelessWidget {
  const _IndicarCard({required this.indicacoes});
  final int indicacoes;

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Material(
      color: isDark ? PandaColors.cardDark : PandaColors.laranjaSuave,
      borderRadius: PandaRadius.bmd,
      child: InkWell(
        onTap: () => _abrirIndicar(context),
        borderRadius: PandaRadius.bmd,
        child: Ink(
          decoration: BoxDecoration(
            borderRadius: PandaRadius.bmd,
            border: Border.all(
              color: isDark
                  ? PandaColors.laranja.withValues(alpha: 0.35)
                  : Colors.transparent,
            ),
          ),
          padding: const EdgeInsets.all(18),
          child: Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: PandaColors.laranja,
                  borderRadius: PandaRadius.bsm,
                ),
                child: const Icon(
                  Icons.group_add_rounded,
                  size: 22,
                  color: Colors.white,
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Indique um amigo',
                      style: TextStyle(
                        fontWeight: FontWeight.w700,
                        fontSize: 15.5,
                        height: 1.25,
                        color: isDark ? PandaColors.branco : PandaColors.preto,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      indicacoes > 0
                          ? '$indicacoes ${indicacoes == 1 ? 'indicação' : 'indicações'} até agora'
                          : 'Convide seus amigos para o Clube',
                      style: TextStyle(
                        fontSize: 13,
                        height: 1.3,
                        color: isDark ? context.textoSec : context.laranjaTexto,
                      ),
                    ),
                  ],
                ),
              ),
              Icon(
                Icons.chevron_right,
                color: isDark ? context.textoSec : context.laranjaTexto,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Avatar do perfil com edição — toca, escolhe foto, sobe pro Storage e
/// atualiza fotoUrl no doc do usuário.
class _AvatarEditavel extends ConsumerStatefulWidget {
  const _AvatarEditavel({required this.user});
  final AppUser user;

  @override
  ConsumerState<_AvatarEditavel> createState() => _AvatarEditavelState();
}

class _AvatarEditavelState extends ConsumerState<_AvatarEditavel> {
  bool _enviando = false;

  Future<void> _trocarFoto() async {
    if (_enviando) return;
    if (kDemo) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Troca de foto desativada no modo demo')),
      );
      return;
    }
    final img = await ImagePicker().pickImage(
      source: ImageSource.gallery,
      maxWidth: 800,
      imageQuality: 85,
    );
    if (img == null) return;
    setState(() => _enviando = true);
    try {
      final bytes = await img.readAsBytes();
      final uid = widget.user.uid;
      final ref_ = ref
          .read(storageProvider)
          .ref(
            'users/$uid/avatar_${DateTime.now().millisecondsSinceEpoch}.jpg',
          );
      await ref_.putData(bytes, SettableMetadata(contentType: 'image/jpeg'));
      final url = await ref_.getDownloadURL();
      final antiga = widget.user.fotoUrl;
      await ref.read(firestoreProvider).collection('users').doc(uid).update({
        'fotoUrl': url,
      });
      // Foto antiga não fica órfã no Storage (LGPD: dado pessoal sem uso).
      // Só apaga o que é nosso (users/<uid>/...); foto do Google não é.
      if (antiga != null && antiga != url) {
        try {
          final velha = ref.read(storageProvider).refFromURL(antiga);
          if (velha.fullPath.startsWith('users/$uid/')) await velha.delete();
        } catch (_) {} // URL de outro provedor ou já apagada: nada a fazer
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Não foi possível atualizar a foto.')),
        );
      }
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final u = widget.user;
    return Semantics(
      button: true,
      label: 'Trocar foto de perfil',
      child: GestureDetector(
        onTap: _trocarFoto,
        child: Stack(
          alignment: Alignment.bottomRight,
          children: [
            Container(
              padding: const EdgeInsets.all(4),
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(color: PandaColors.laranja, width: 2),
              ),
              child: CircleAvatar(
                radius: 42,
                backgroundColor: PandaColors.laranjaSuave,
                backgroundImage: u.fotoUrl != null
                    ? NetworkImage(u.fotoUrl!)
                    : null,
                child: _enviando
                    ? const CircularProgressIndicator(
                        color: PandaColors.laranja,
                        strokeWidth: 2,
                      )
                    : (u.fotoUrl == null
                          ? const Icon(
                              Icons.person_rounded,
                              size: 44,
                              color: PandaColors.laranja,
                            )
                          : null),
              ),
            ),
            Container(
              padding: const EdgeInsets.all(6),
              decoration: BoxDecoration(
                color: PandaColors.laranja,
                shape: BoxShape.circle,
                border: Border.all(
                  color: Theme.of(context).scaffoldBackgroundColor,
                  width: 2,
                ),
              ),
              child: const Icon(
                Icons.photo_camera_rounded,
                color: Colors.white,
                size: 16,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Cabeçalho — avatar grande (editável), nome, e-mail, status de sócio.
class _Header extends StatelessWidget {
  const _Header({required this.user, required this.isSub});
  final AppUser user;
  final bool isSub;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        _AvatarEditavel(user: user),
        const SizedBox(height: 14),
        if (user.nome.trim().isNotEmpty)
          Text(
            user.nome,
            style: Theme.of(context).textTheme.headlineSmall,
            textAlign: TextAlign.center,
          ),
        const SizedBox(height: 2),
        if (user.email.isNotEmpty)
          Text(user.email, style: TextStyle(color: context.textoSec)),
        const SizedBox(height: 12),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          decoration: BoxDecoration(
            color: isSub
                ? PandaColors.verdeSucesso.withValues(alpha: 0.12)
                : (Theme.of(context).brightness == Brightness.dark
                      ? PandaColors.cardDark
                      : PandaColors.cinzaClaro),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                isSub ? Icons.verified_rounded : Icons.person_outline,
                size: 16,
                color: isSub ? context.verdeTexto : context.textoSec,
              ),
              const SizedBox(width: 6),
              Text(
                isSub ? 'Sócio do Clube' : 'Cliente',
                style: TextStyle(
                  color: isSub ? context.verdeTexto : context.textoSec,
                  fontWeight: FontWeight.w600,
                  fontSize: 13,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

/// Linha de estatísticas: cupons e plano.
class _StatsRow extends StatelessWidget {
  const _StatsRow({required this.cupons, required this.socio});
  final int cupons;
  final bool socio;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        _Stat(
          valor: '$cupons',
          label: 'Cupons',
          icone: Icons.confirmation_number_outlined,
        ),
        const SizedBox(width: 12),
        _Stat(
          valor: socio ? 'Sim' : 'Não',
          label: 'Sócio',
          icone: Icons.workspace_premium_outlined,
        ),
      ],
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.valor, required this.label, required this.icone});
  final String valor;
  final String label;
  final IconData icone;

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 16),
        decoration: BoxDecoration(
          color: isDark ? PandaColors.cardDark : PandaColors.branco,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: isDark ? PandaColors.hairlineDark : PandaColors.hairline,
          ),
        ),
        child: Column(
          children: [
            Icon(icone, color: PandaColors.laranja, size: 22),
            const SizedBox(height: 8),
            Text(
              valor,
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 2),
            Text(
              label,
              style: TextStyle(color: context.textoSec, fontSize: 13),
            ),
          ],
        ),
      ),
    );
  }
}

class _CupomTile extends StatelessWidget {
  const _CupomTile({required this.r});
  final Redemption r;

  (String, Color) _status(BuildContext context, String s) {
    switch (s) {
      case 'disponivel':
        return ('Disponível', context.verdeTexto);
      case 'usado':
        return ('Usado', context.textoSec);
      default:
        return ('Expirado', context.vermelhoTexto);
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final (label, cor) = _status(context, r.status);
    final data = r.criadoEm != null
        ? DateFormat('dd/MM/yyyy').format(r.criadoEm!)
        : null;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: isDark ? PandaColors.cardDark : PandaColors.branco,
        borderRadius: PandaRadius.bmd,
        border: Border.all(
          color: isDark ? PandaColors.hairlineDark : PandaColors.hairline,
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: PandaColors.laranja,
              borderRadius: PandaRadius.bsm,
            ),
            child: const Icon(
              Icons.confirmation_number_outlined,
              color: Colors.white,
              size: 22,
            ),
          ),
          const SizedBox(width: 14),
          // Tudo empilhado: título ocupa a largura inteira, código na linha
          // dele, data e selo embaixo. Nada disputa espaço lateral com o
          // título — sobrevive ao "tamanho da letra: grande".
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  r.rewardTitulo,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontWeight: FontWeight.w600,
                    fontSize: 15,
                    height: 1.25,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  r.codigo,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: context.textoSec,
                    fontSize: 13,
                    letterSpacing: 0.8,
                    height: 1.3,
                  ),
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 9,
                        vertical: 3,
                      ),
                      decoration: BoxDecoration(
                        color: cor.withValues(alpha: 0.14),
                        borderRadius: PandaRadius.bxs,
                      ),
                      child: Text(
                        label,
                        style: TextStyle(
                          color: cor,
                          fontWeight: FontWeight.w700,
                          fontSize: 12,
                          height: 1.25,
                        ),
                      ),
                    ),
                    if (data != null) ...[
                      const SizedBox(width: 10),
                      Flexible(
                        child: Text(
                          data,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: context.textoSec,
                            fontSize: 13,
                            height: 1.25,
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _VazioLinha extends StatelessWidget {
  const _VazioLinha({required this.texto});
  final String texto;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Text(texto, style: TextStyle(color: context.textoSec)),
    );
  }
}

void _abrirIndicar(BuildContext context) {
  showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    backgroundColor: Theme.of(context).scaffoldBackgroundColor,
    builder: (_) => const _IndicarSheet(),
  );
}

/// Indique um amigo — mostra o código de indicação, copia e compartilha.
class _IndicarSheet extends ConsumerStatefulWidget {
  const _IndicarSheet();

  @override
  ConsumerState<_IndicarSheet> createState() => _IndicarSheetState();
}

class _IndicarSheetState extends ConsumerState<_IndicarSheet> {
  String? _codigo;
  bool _carregando = true;

  @override
  void initState() {
    super.initState();
    _carregar();
  }

  Future<void> _carregar() async {
    if (kDemo) {
      setState(() {
        _codigo = 'PANDA00';
        _carregando = false;
      });
      return;
    }
    try {
      // Só leitura, do ponto de vista do sócio: a função devolve o código que
      // já existe e cria na primeira vez. Repetir é inofensivo.
      final res = await Chamada.chamar(
        ref.read(functionsProvider),
        'ensureReferralCode',
        repetir: true,
      );
      if (mounted) {
        setState(() {
          _codigo = res.data['code'] as String?;
          _carregando = false;
        });
      }
    } catch (_) {
      // Sem código na tela: o cartão de indicação já tem estado vazio.
      // Insistir mais que isso atrasaria a abertura do perfil.
      if (mounted) setState(() => _carregando = false);
    }
  }

  /// O link da loja vem do painel (`config/restaurante`). Sem ele na mensagem,
  /// o amigo recebe o código e não sabe onde baixar.
  String get _mensagem {
    final r = ref.read(restauranteProvider);
    final loja = (!kIsWeb && Platform.isIOS) ? r.appStoreUrl : r.playStoreUrl;
    return 'Conheça o PandaVip, o clube do Tio Panda. Use meu código *$_codigo* no cadastro.\n'
        '$loja';
  }

  Future<void> _whatsapp() async {
    final uri = Uri.parse(
      'https://wa.me/?text=${Uri.encodeComponent(_mensagem)}',
    );
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  void _copiar() {
    if (_codigo == null) return;
    Clipboard.setData(ClipboardData(text: _codigo!));
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(const SnackBar(content: Text('Código copiado.')));
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: 24,
        right: 24,
        top: 8,
        bottom: MediaQuery.of(context).viewInsets.bottom + 28,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Icon(
            Icons.group_add_rounded,
            color: PandaColors.laranja,
            size: 44,
          ),
          const SizedBox(height: 12),
          Text(
            'Indique um amigo',
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.headlineSmall,
          ),
          const SizedBox(height: 8),
          Text(
            'Compartilhe seu código com quem ainda não é sócio. Quem se cadastrar com ele fica registrado como indicação sua.',
            textAlign: TextAlign.center,
            style: TextStyle(color: context.textoSec, height: 1.4),
          ),
          const SizedBox(height: 24),
          if (_carregando)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 24),
              child: LoadingView(),
            )
          else if (_codigo == null)
            Text(
              'Não foi possível gerar o código agora. Tente de novo.',
              textAlign: TextAlign.center,
              style: TextStyle(color: context.vermelhoTexto),
            )
          else ...[
            GestureDetector(
              onTap: _copiar,
              child: Container(
                padding: const EdgeInsets.symmetric(vertical: 18),
                decoration: BoxDecoration(
                  color: context.laranjaFundo,
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Column(
                  children: [
                    Text(
                      _codigo!,
                      style: TextStyle(
                        fontSize: 30,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 4,
                        color: context.laranjaTexto,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Toque para copiar',
                      style: TextStyle(
                        fontSize: 13,
                        color: context.laranjaTexto,
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 20),
            ElevatedButton.icon(
              onPressed: _whatsapp,
              icon: const Icon(Icons.chat_rounded, size: 20),
              label: const Text('Compartilhar no WhatsApp'),
              style: ElevatedButton.styleFrom(
                minimumSize: const Size.fromHeight(52),
              ),
            ),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: _copiar,
              icon: const Icon(Icons.copy_rounded, size: 18),
              label: const Text('Copiar código'),
              style: OutlinedButton.styleFrom(
                minimumSize: const Size.fromHeight(48),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
