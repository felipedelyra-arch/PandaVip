import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/models/models.dart';
import '../../core/services/services.dart';
import '../../core/theme/colors.dart';
import '../../core/theme/dimens.dart';
import '../../core/widgets/app_image.dart';
import '../cart/carrinho.dart';

String _emReais(double v) => 'R\$ ${v.toStringAsFixed(2).replaceAll('.', ',')}';

/// Abre a promoção tocada na Home. Com prato e desconto no painel, oferece
/// "Pedir com X% off": o prato vai pra sacola marcado com a promoção, e quem
/// aplica o desconto de verdade é o servidor (`criarPedido`). Sem prato, é só
/// o aviso por inteiro, com atalho pro cardápio.
void abrirPromoSheet(BuildContext context, Promotion promo) {
  showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    backgroundColor: Theme.of(context).scaffoldBackgroundColor,
    builder: (_) => _PromoSheet(promo: promo),
  );
}

class _PromoSheet extends ConsumerWidget {
  const _PromoSheet({required this.promo});
  final Promotion promo;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final menu = ref.watch(menuProvider).value ?? const <MenuItem>[];
    final isSub = ref.watch(isSubscriberProvider);
    MenuItem? prato;
    if (promo.temDesconto) {
      for (final m in menu) {
        if (m.id == promo.itemId) prato = m;
      }
    }
    final precoPromo = prato == null
        ? null
        : double.parse(
            (prato.preco * (1 - promo.descontoPct / 100)).toStringAsFixed(2),
          );

    return SafeArea(
      top: false,
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (promo.imagem != null || prato?.imagem != null) ...[
              ClipRRect(
                borderRadius: PandaRadius.blg,
                child: AspectRatio(
                  aspectRatio: 16 / 9,
                  child: appImage(
                    promo.imagem ?? prato!.imagem!,
                    erro: Container(color: PandaColors.laranja),
                  ),
                ),
              ),
              const SizedBox(height: 18),
            ],
            Text(
              promo.titulo,
              style: const TextStyle(
                fontSize: 22,
                fontWeight: FontWeight.w800,
                height: 1.2,
              ),
            ),
            if (promo.descricao.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(
                promo.descricao,
                style: TextStyle(
                  color: context.textoSec,
                  fontSize: 14.5,
                  height: 1.45,
                ),
              ),
            ],
            if (prato != null && precoPromo != null) ...[
              const SizedBox(height: 18),
              Text(
                prato.nome,
                style: const TextStyle(
                  fontWeight: FontWeight.w600,
                  fontSize: 15,
                ),
              ),
              const SizedBox(height: 4),
              Row(
                crossAxisAlignment: CrossAxisAlignment.baseline,
                textBaseline: TextBaseline.alphabetic,
                children: [
                  Text(
                    _emReais(precoPromo),
                    style: TextStyle(
                      color: context.laranjaTexto,
                      fontWeight: FontWeight.w800,
                      fontSize: 20,
                    ),
                  ),
                  const SizedBox(width: 10),
                  Text(
                    _emReais(prato.preco),
                    style: TextStyle(
                      color: context.textoSec,
                      fontSize: 14,
                      decoration: TextDecoration.lineThrough,
                    ),
                  ),
                ],
              ),
            ],
            const SizedBox(height: 22),
            _acao(context, ref, prato, isSub),
          ],
        ),
      ),
    );
  }

  Widget _acao(
    BuildContext context,
    WidgetRef ref,
    MenuItem? prato,
    bool isSub,
  ) {
    const forma = Size.fromHeight(54);
    // Promoção só de sócio vista por quem não é: o caminho é assinar.
    if (promo.apenasAssinantes && !isSub) {
      return FilledButton(
        style: FilledButton.styleFrom(minimumSize: forma),
        onPressed: () {
          Navigator.of(context).pop();
          context.push('/planos');
        },
        child: const Text('Assine o Clube para usar'),
      );
    }
    if (prato == null || !prato.disponivel) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (promo.temDesconto)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Text(
                'Este prato não está disponível agora.',
                textAlign: TextAlign.center,
                style: TextStyle(color: context.textoSec, fontSize: 13.5),
              ),
            ),
          OutlinedButton(
            style: OutlinedButton.styleFrom(minimumSize: forma),
            onPressed: () {
              Navigator.of(context).pop();
              context.go('/cardapio');
            },
            child: const Text('Ver o cardápio'),
          ),
        ],
      );
    }
    return FilledButton(
      style: FilledButton.styleFrom(minimumSize: forma),
      onPressed: () {
        HapticFeedback.mediumImpact();
        final carrinho = ref.read(carrinhoProvider.notifier);
        final qtd = carrinho.qtdDe(prato.id);
        carrinho.definir(
          prato.id,
          qtd > 0 ? qtd : 1,
          promoId: promo.id,
          descontoPct: promo.descontoPct,
        );
        // Lidos antes do pop: depois dele este context some.
        final mensageiro = ScaffoldMessenger.of(context);
        final rotas = GoRouter.of(context);
        Navigator.of(context).pop();
        avisarSacola(
          mensageiro,
          rotas,
          '${prato.nome} com ${promo.descontoPct}% off na sacola',
        );
      },
      child: Text(
        'Pedir com ${promo.descontoPct}% off',
        style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
      ),
    );
  }
}
