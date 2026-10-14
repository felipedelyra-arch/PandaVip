import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/services/services.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/colors.dart';
import '../../core/theme/dimens.dart';
import '../../core/widgets/state_views.dart';
import '../../core/widgets/entrada.dart';
import '../../core/models/models.dart';
import '../cart/pedidos_screen.dart';
import '../menu/item_sheet.dart';
import 'promo_sheet.dart';

final _moeda = NumberFormat.currency(locale: 'pt_BR', symbol: 'R\$');

/// Saudação conforme a hora — detalhe pequeno que faz o app parecer atento.
String _saudacao() {
  final h = DateTime.now().hour;
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

/// Renderiza imagem de asset local ou de URL (Firestore), com fallback.
Widget _imagemPromo(String path, {BoxFit fit = BoxFit.cover, Widget? erro}) {
  final fallback = erro ?? const SizedBox.shrink();
  if (path.startsWith('assets/')) {
    return Image.asset(path, fit: fit, errorBuilder: (_, _, _) => fallback);
  }
  return Image.network(path, fit: fit, errorBuilder: (_, _, _) => fallback);
}

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(currentUserProvider);
    final promos = ref.watch(promocoesVigentesProvider);
    final temDestaques =
        (ref.watch(destaquesProvider).value ?? const []).isNotEmpty;
    final isSub = ref.watch(isSubscriberProvider);
    final primeiroNome = (user.value?.nome ?? '').trim().split(' ').first;

    return Scaffold(
      body: SafeArea(
        child: RefreshIndicator(
          color: PandaColors.laranja,
          onRefresh: () async => ref.invalidate(promotionsProvider),
          child: ListView(
            padding: const EdgeInsets.fromLTRB(24, 12, 24, 32),
            children: escalonar([
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: const [_SinoNotificacoes()],
              ),
              Padding(
                padding: const EdgeInsets.only(top: 26),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Único ponto em serifa: vira assinatura da marca em vez
                    // de tema geral do app.
                    Text(
                      // Sem nome cadastrado: só a saudação, sem vírgula solta.
                      primeiroNome.isEmpty
                          ? _saudacao()
                          : '${_saudacao()}, $primeiroNome',
                      style: AppTheme.assinatura(
                        Theme.of(context).textTheme.headlineLarge,
                      ),
                    ),
                    const SizedBox(height: 8),
                    if (isSub)
                      const _StatusSocio()
                    else
                      Text(
                        'Peça pelo app ou aproveite as promoções.',
                        style: TextStyle(color: context.textoSec, fontSize: 15),
                      ),
                  ],
                ),
              ),
              if (isSub)
                const Padding(
                  padding: EdgeInsets.only(top: 24),
                  child: _EconomiaCard(),
                )
              else
                const Padding(
                  padding: EdgeInsets.only(top: 24),
                  child: _AssineBanner(),
                ),
              const Padding(
                padding: EdgeInsets.only(top: 16),
                child: _PedidoHome(),
              ),
              Padding(
                padding: const EdgeInsets.only(top: 16),
                child: _AtalhosRow(),
              ),
              // Sem prato marcado como destaque no painel, a seção inteira sai
              // da Home — rótulo sozinho sobre espaço vazio parece defeito.
              if (temDestaques)
                Padding(
                  padding: const EdgeInsets.only(top: 32),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: const [
                      SectionLabel('Destaques do cardápio'),
                      SizedBox(height: 16),
                      _DestaquesRow(),
                    ],
                  ),
                ),
              Padding(
                padding: const EdgeInsets.only(top: 32),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const SectionLabel('Promoções'),
                    const SizedBox(height: 16),
                    promos.when(
                      loading: () => const Padding(
                        padding: EdgeInsets.only(top: 24),
                        child: LoadingView(),
                      ),
                      error: (e, _) => ErrorView(
                        mensagem: 'Não foi possível carregar as promoções.',
                        onRetry: () => ref.invalidate(promotionsProvider),
                      ),
                      data: (list) {
                        final visiveis = list
                            .where((p) => !p.apenasAssinantes || isSub)
                            .toList();
                        if (visiveis.isEmpty) {
                          return const EmptyView(
                            mensagem: 'Nenhuma promoção disponível no momento.',
                            icone: Icons.local_offer_outlined,
                          );
                        }
                        return Column(
                          children: [
                            _Tocavel(
                              promo: visiveis.first,
                              raio: PandaRadius.blg,
                              child: _PromoHero(promo: visiveis.first),
                            ),
                            for (final p in visiveis.skip(1)) ...[
                              const SizedBox(height: 14),
                              _Tocavel(
                                promo: p,
                                raio: PandaRadius.bmd,
                                child: _PromoCard(promo: p),
                              ),
                            ],
                          ],
                        );
                      },
                    ),
                  ],
                ),
              ),
            ]),
          ),
        ),
      ),
    );
  }
}

/// Sino de notificações com badge de não lidas — abre a central.
class _SinoNotificacoes extends ConsumerWidget {
  const _SinoNotificacoes();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final naoLidas = ref.watch(unreadCountProvider);
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Semantics(
      button: true,
      label: naoLidas > 0
          ? 'Notificações, $naoLidas não lidas'
          : 'Notificações',
      excludeSemantics: true,
      child: InkWell(
        onTap: () => context.push('/notificacoes'),
        borderRadius: PandaRadius.bsm,
        child: Container(
          width: 48,
          height: 48,
          decoration: BoxDecoration(
            color: isDark ? PandaColors.cardDark : PandaColors.branco,
            borderRadius: PandaRadius.bsm,
            border: Border.all(
              color: isDark ? PandaColors.hairlineDark : PandaColors.hairline,
            ),
          ),
          child: Stack(
            alignment: Alignment.center,
            children: [
              const Icon(
                Icons.notifications_none_rounded,
                size: 22,
                color: PandaColors.laranja,
              ),
              if (naoLidas > 0)
                Positioned(
                  top: 8,
                  right: 9,
                  child: Container(
                    padding: const EdgeInsets.all(2),
                    constraints: const BoxConstraints(
                      minWidth: 18,
                      minHeight: 18,
                    ),
                    decoration: BoxDecoration(
                      color: PandaColors.vermelhoAcento,
                      borderRadius: PandaRadius.bxs,
                      border: Border.all(
                        color: isDark
                            ? PandaColors.fundoDark
                            : PandaColors.fundo,
                        width: 1.5,
                      ),
                    ),
                    child: Text(
                      naoLidas > 9 ? '9+' : '$naoLidas',
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        height: 1,
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

/// Chip de status de sócio ativo.
class _StatusSocio extends StatelessWidget {
  const _StatusSocio();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: PandaColors.verdeSucesso.withValues(alpha: 0.12),
        borderRadius: PandaRadius.bsm,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.verified_rounded, color: context.verdeTexto, size: 16),
          SizedBox(width: 6),
          Text(
            'Sócio do Clube',
            style: TextStyle(
              color: context.verdeTexto,
              fontWeight: FontWeight.w600,
              fontSize: 13,
            ),
          ),
        ],
      ),
    );
  }
}

/// O número que vende o Clube: quanto o sócio já economizou em prêmios.
/// Card escuro pra contrastar com o papel quente — é o destaque da tela.
class _EconomiaCard extends ConsumerWidget {
  const _EconomiaCard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final economia = ref.watch(economiaProvider);
    if (economia.total <= 0) return const SizedBox.shrink();

    // No claro o card escuro salta do papel quente. No escuro ele sumiria
    // no fundo, então sobe pra superfície de card e ganha borda laranja.
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(22, 20, 22, 20),
      decoration: BoxDecoration(
        color: isDark ? PandaColors.cardDark : PandaColors.preto,
        borderRadius: PandaRadius.blg,
        border: isDark
            ? Border.all(color: PandaColors.laranja.withValues(alpha: 0.35))
            : null,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const PontoMarca(),
              const SizedBox(width: 8),
              Text(
                'VOCÊ JÁ ECONOMIZOU',
                style: TextStyle(
                  fontSize: 12,
                  letterSpacing: 1.4,
                  fontWeight: FontWeight.w700,
                  color: Colors.white.withValues(alpha: 0.55),
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          // Contador sobe do zero — dá vida ao número sem parecer enfeite.
          TweenAnimationBuilder<double>(
            tween: Tween(begin: 0, end: economia.total),
            duration: const Duration(milliseconds: 1100),
            curve: Curves.easeOutCubic,
            builder: (_, valor, _) => Text(
              _moeda.format(valor),
              style: Theme.of(context).textTheme.displaySmall?.copyWith(
                color: PandaColors.laranja,
                fontWeight: FontWeight.w700,
                height: 1,
              ),
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Icon(
                Icons.card_giftcard_rounded,
                size: 15,
                color: Colors.white.withValues(alpha: 0.6),
              ),
              const SizedBox(width: 6),
              Text(
                '${economia.resgates} ${economia.resgates == 1 ? 'prêmio resgatado' : 'prêmios resgatados'}',
                style: TextStyle(
                  fontSize: 13,
                  color: Colors.white.withValues(alpha: 0.75),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Linha de atalhos rápidos.
class _AtalhosRow extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    // IntrinsicHeight + stretch: os três cards com a mesma altura, mesmo
    // quando um rótulo precisa encolher para caber.
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _Atalho(
            icone: Icons.card_giftcard_outlined,
            label: 'Prêmios',
            onTap: () => context.go('/premiacoes'),
          ),
          const SizedBox(width: 12),
          _Atalho(
            icone: Icons.workspace_premium_outlined,
            label: 'Meu plano',
            onTap: () => context.go('/planos'),
          ),
          const SizedBox(width: 12),
          _Atalho(
            icone: Icons.receipt_long_outlined,
            label: 'Meus pedidos',
            onTap: () => context.push('/pedidos'),
          ),
        ],
      ),
    );
  }
}

class _Atalho extends StatelessWidget {
  const _Atalho({
    required this.icone,
    required this.label,
    required this.onTap,
  });
  final IconData icone;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Expanded(
      child: Material(
        color: isDark ? PandaColors.cardDark : PandaColors.branco,
        borderRadius: PandaRadius.bmd,
        child: InkWell(
          onTap: onTap,
          borderRadius: PandaRadius.bmd,
          child: Ink(
            decoration: BoxDecoration(
              borderRadius: PandaRadius.bmd,
              border: Border.all(
                color: isDark ? PandaColors.hairlineDark : PandaColors.hairline,
              ),
            ),
            padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 6),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(icone, color: PandaColors.laranja, size: 24),
                const SizedBox(height: 8),
                // Encolhe em vez de vazar: no iPhone, com fonte do sistema
                // maior, "Meus pedidos" passava da borda do card.
                FittedBox(
                  fit: BoxFit.scaleDown,
                  child: Text(
                    label,
                    maxLines: 1,
                    style: const TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Vitrine horizontal de pratos (fotos reais) — só no modo demo.
class _DestaquesRow extends ConsumerWidget {
  const _DestaquesRow();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final destaques = ref.watch(destaquesProvider).value ?? const <MenuItem>[];
    // Sem destaque marcado no painel, a faixa some — a seção inteira já é
    // escondida pela Home, então aqui é só a rede de segurança.
    if (destaques.isEmpty) return const SizedBox.shrink();
    return SizedBox(
      height: 200,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        clipBehavior: Clip.none,
        itemCount: destaques.length,
        separatorBuilder: (_, _) => const SizedBox(width: 14),
        itemBuilder: (_, i) => _DestaqueCard(prato: destaques[i]),
      ),
    );
  }
}

class _DestaqueCard extends StatelessWidget {
  const _DestaqueCard({required this.prato});
  final MenuItem prato;

  @override
  Widget build(BuildContext context) {
    // Foto de comida pede toque: abre o mesmo prato do cardápio.
    return InkWell(
      onTap: () => abrirItemSheet(context, prato),
      borderRadius: PandaRadius.bmd,
      child: SizedBox(
        width: 158,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            ClipRRect(
              borderRadius: PandaRadius.bmd,
              child: SizedBox(
                height: 132,
                width: double.infinity,
                child: prato.imagem == null
                    ? Container(
                        color: PandaColors.laranja,
                        child: const Icon(
                          Icons.restaurant_rounded,
                          color: Colors.white,
                        ),
                      )
                    : _imagemPromo(
                        prato.imagem!,
                        erro: Container(color: PandaColors.laranjaSuave),
                      ),
              ),
            ),
            const SizedBox(height: 10),
            Text(
              prato.nome,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontWeight: FontWeight.w600,
                fontSize: 14.5,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              prato.precoFormatado,
              style: TextStyle(
                color: context.laranjaTexto,
                fontWeight: FontWeight.w700,
                fontSize: 13.5,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// O cartão de pedido da Início. Com pedido rolando, mostra onde ele está;
/// sem pedido, é o convite pra pedir — a ação mais comum do app fica no alto
/// da tela, não escondida num atalho.
class _PedidoHome extends ConsumerWidget {
  const _PedidoHome();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final pedido = ref.watch(pedidoEmAndamentoProvider);
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final borda = pedido != null
        ? PandaColors.laranja
        : (isDark ? PandaColors.hairlineDark : PandaColors.hairline);

    return Material(
      color: isDark ? PandaColors.cardDark : PandaColors.branco,
      borderRadius: PandaRadius.blg,
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () =>
            pedido != null ? context.push('/pedidos') : context.go('/cardapio'),
        child: Ink(
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(
            borderRadius: PandaRadius.blg,
            border: Border.all(color: borda, width: pedido != null ? 1.5 : 1),
          ),
          child: pedido == null
              ? Row(
                  children: [
                    _IconeTile(Icons.delivery_dining_rounded),
                    SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Fazer um pedido',
                            style: TextStyle(
                              fontSize: 16.5,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          SizedBox(height: 4),
                          Text(
                            'Entrega em casa ou retirada no balcão',
                            style: TextStyle(
                              color: context.textoSec,
                              fontSize: 13,
                              height: 1.3,
                            ),
                          ),
                        ],
                      ),
                    ),
                    Icon(Icons.chevron_right, color: PandaColors.laranja),
                  ],
                )
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        IconePedidoAnimado(
                          icone: pedido.tipo == 'retirada'
                              ? Icons.storefront_rounded
                              : Icons.delivery_dining_rounded,
                        ),
                        const SizedBox(width: 14),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'SEU PEDIDO',
                                style: TextStyle(
                                  fontSize: 12,
                                  letterSpacing: 1.4,
                                  fontWeight: FontWeight.w700,
                                  color: context.textoSec,
                                ),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                pedido.statusTexto,
                                style: const TextStyle(
                                  fontSize: 16.5,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                            ],
                          ),
                        ),
                        Text(
                          pedido.totalFormatado,
                          style: TextStyle(
                            fontWeight: FontWeight.w800,
                            color: context.laranjaTexto,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    EtapasPedido(pedido: pedido),
                  ],
                ),
        ),
      ),
    );
  }
}

class _IconeTile extends StatelessWidget {
  const _IconeTile(this.icone);
  final IconData icone;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 52,
      height: 52,
      decoration: const BoxDecoration(
        color: PandaColors.laranja,
        borderRadius: PandaRadius.bsm,
      ),
      child: Icon(icone, color: Colors.white, size: 28),
    );
  }
}

class _AssineBanner extends StatelessWidget {
  const _AssineBanner();

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        // Superfície do tema, não creme fixo: no escuro virava mancha clara.
        color: isDark ? PandaColors.cardDark : PandaColors.laranjaSuave,
        borderRadius: PandaRadius.blg,
        border: Border.all(
          color: isDark
              ? PandaColors.laranja.withValues(alpha: 0.35)
              : Colors.transparent,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Entre para o Clube',
            style: Theme.of(context).textTheme.titleLarge?.copyWith(
              color: context.laranjaTexto,
              height: 1.25,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Prêmios e promoções exclusivas para sócios.',
            style: TextStyle(
              color: isDark ? PandaColors.branco : PandaColors.preto,
              height: 1.4,
            ),
          ),
          const SizedBox(height: 20),
          ElevatedButton(
            onPressed: () => context.go('/planos'),
            style: ElevatedButton.styleFrom(
              minimumSize: const Size.fromHeight(48),
            ),
            child: const Text('Ver planos'),
          ),
        ],
      ),
    );
  }
}

/// Promoção em destaque. Com imagem: foto + gradiente + texto branco.
/// Sem imagem: card suave (laranja claro), texto escuro, acento discreto.
/// Rótulo curto do prazo da oferta. Nulo quando não tem fim marcado.
String? _rotuloPrazo(DateTime? fim) {
  if (fim == null) return null;
  final agora = DateTime.now();
  final hoje = DateTime(agora.year, agora.month, agora.day);
  final diaFim = DateTime(fim.year, fim.month, fim.day);
  final dias = diaFim.difference(hoje).inDays;
  final hora = fim.minute == 0
      ? '${fim.hour}h'
      : '${fim.hour}h${fim.minute.toString().padLeft(2, '0')}';
  if (dias == 0) return 'Termina hoje às $hora';
  if (dias == 1) return 'Termina amanhã às $hora';
  final d = fim.day.toString().padLeft(2, '0');
  final m = fim.month.toString().padLeft(2, '0');
  return 'Até $d/$m às $hora';
}

/// Selo de prazo. Fica vermelho no último dia pra dar urgência.
class _PrazoPill extends StatelessWidget {
  const _PrazoPill({required this.fim, this.sobreImagem = false});
  final DateTime fim;
  final bool sobreImagem;

  @override
  Widget build(BuildContext context) {
    final rotulo = _rotuloPrazo(fim);
    if (rotulo == null) return const SizedBox.shrink();
    final ultimoDia = fim.difference(DateTime.now()).inHours < 24;
    final cor = ultimoDia ? context.vermelhoTexto : context.laranjaTexto;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: sobreImagem
            ? Colors.black.withValues(alpha: 0.45)
            : cor.withValues(alpha: 0.12),
        borderRadius: PandaRadius.bxs,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.schedule_rounded,
            size: 13,
            color: sobreImagem ? Colors.white : cor,
          ),
          const SizedBox(width: 4),
          Flexible(
            child: Text(
              rotulo,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                color: sobreImagem ? Colors.white : cor,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _PromoHero extends StatelessWidget {
  const _PromoHero({required this.promo});
  final Promotion promo;

  @override
  Widget build(BuildContext context) {
    return promo.imagem != null ? _comImagem(context) : _suave(context);
  }

  Widget _badge(Color bg, Color fg) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
    decoration: BoxDecoration(color: bg, borderRadius: PandaRadius.bxs),
    child: Text(
      'EXCLUSIVO CLUBE',
      style: TextStyle(
        color: fg,
        fontSize: 12,
        letterSpacing: 0.8,
        fontWeight: FontWeight.w700,
      ),
    ),
  );

  Widget _comImagem(BuildContext context) {
    return ClipRRect(
      borderRadius: PandaRadius.blg,
      child: Stack(
        children: [
          SizedBox(
            height: 210,
            width: double.infinity,
            child: _imagemPromo(
              promo.imagem!,
              erro: Container(color: PandaColors.laranjaSuave),
            ),
          ),
          Positioned.fill(
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    Colors.transparent,
                    Colors.black.withValues(alpha: 0.72),
                  ],
                  stops: const [0.35, 1],
                ),
              ),
            ),
          ),
          Positioned(
            left: 20,
            right: 20,
            bottom: 18,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (promo.apenasAssinantes) ...[
                  _badge(PandaColors.laranja, Colors.white),
                  const SizedBox(height: 8),
                ],
                Text(
                  promo.titulo,
                  style: Theme.of(
                    context,
                  ).textTheme.headlineSmall?.copyWith(color: Colors.white),
                ),
                const SizedBox(height: 4),
                Text(
                  promo.descricao,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.85),
                    height: 1.35,
                  ),
                ),
                if (promo.validadeFim != null) ...[
                  const SizedBox(height: 10),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: _PrazoPill(
                      fim: promo.validadeFim!,
                      sobreImagem: true,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _suave(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        color: context.laranjaFundo,
        borderRadius: PandaRadius.blg,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: PandaColors.laranja,
                  borderRadius: PandaRadius.bsm,
                ),
                child: const Icon(
                  Icons.local_fire_department_rounded,
                  color: Colors.white,
                  size: 24,
                ),
              ),
              const SizedBox(width: 12),
              if (promo.apenasAssinantes)
                _badge(PandaColors.laranja, Colors.white)
              else
                Text(
                  'EM DESTAQUE',
                  style: TextStyle(
                    color: context.laranjaTexto,
                    fontSize: 12,
                    letterSpacing: 1,
                    fontWeight: FontWeight.w700,
                  ),
                ),
            ],
          ),
          const SizedBox(height: 16),
          Text(promo.titulo, style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: 6),
          Text(promo.descricao, style: const TextStyle(height: 1.4)),
          if (promo.validadeFim != null) ...[
            const SizedBox(height: 12),
            Align(
              alignment: Alignment.centerLeft,
              child: _PrazoPill(fim: promo.validadeFim!),
            ),
          ],
        ],
      ),
    );
  }
}

/// Promoção da Home vira botão: abre o detalhe e, se tiver prato com
/// desconto, o "Pedir com X% off" (ver promo_sheet.dart).
class _Tocavel extends StatelessWidget {
  const _Tocavel({
    required this.promo,
    required this.raio,
    required this.child,
  });
  final Promotion promo;
  final BorderRadius raio;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: promo.temDesconto
          ? '${promo.titulo}. Toque para pedir com ${promo.descontoPct}% de desconto.'
          : '${promo.titulo}. Toque para ver a promoção.',
      excludeSemantics: true,
      child: Material(
        type: MaterialType.transparency,
        child: InkWell(
          borderRadius: raio,
          onTap: () => abrirPromoSheet(context, promo),
          child: child,
        ),
      ),
    );
  }
}

class _PromoCard extends StatelessWidget {
  const _PromoCard({required this.promo});
  final Promotion promo;

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      decoration: BoxDecoration(
        color: isDark ? PandaColors.cardDark : PandaColors.branco,
        borderRadius: PandaRadius.bmd,
        border: Border.all(
          color: isDark ? PandaColors.hairlineDark : PandaColors.hairline,
        ),
      ),
      padding: const EdgeInsets.all(14),
      child: Row(
        children: [
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              color: PandaColors.laranja,
              borderRadius: PandaRadius.bsm,
            ),
            clipBehavior: Clip.antiAlias,
            child: promo.imagem != null
                ? _imagemPromo(
                    promo.imagem!,
                    erro: const Icon(Icons.local_offer, color: Colors.white),
                  )
                : const Icon(Icons.local_offer, color: Colors.white),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  promo.titulo,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontWeight: FontWeight.w600,
                    fontSize: 15,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  promo.descricao,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: context.textoSec,
                    fontSize: 13,
                    height: 1.3,
                  ),
                ),
                if (promo.validadeFim != null) ...[
                  const SizedBox(height: 6),
                  _PrazoPill(fim: promo.validadeFim!),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
