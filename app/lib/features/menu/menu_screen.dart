import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/models/models.dart';
import '../../core/restaurante.dart';
import '../../core/services/services.dart';
import '../../core/theme/colors.dart';
import '../../core/theme/dimens.dart';
import '../../core/widgets/app_image.dart';
import '../../core/widgets/state_views.dart';
import '../cart/carrinho.dart';
import 'item_sheet.dart';

/// Cardápio com fotos reais, vindo do Firestore. Lista simples por categoria —
/// fácil de rolar e enxergar, em qualquer idade.
class MenuScreen extends ConsumerWidget {
  const MenuScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final cardapio = ref.watch(cardapioProvider);
    final naSacola = ref.watch(carrinhoQtdProvider);
    final restaurante = ref.watch(restauranteProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Cardápio'),
        // Aba do menu de baixo: sem seta de voltar, quem sai usa as abas.
        automaticallyImplyLeading: false,
        actions: [
          // Com texto, não só ícone: um recibo solto ninguém adivinha o que é.
          TextButton.icon(
            onPressed: () => context.push('/pedidos'),
            icon: const Icon(Icons.receipt_long_outlined),
            label: const Text('Meus pedidos'),
          ),
          const SizedBox(width: 8),
        ],
      ),
      // Barra da sacola só aparece com algo dentro — tela de cardápio vazia
      // de sacola não perde espaço com botão que não faz nada.
      bottomNavigationBar: naSacola == 0
          ? null
          : SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(24, 8, 24, 16),
                child: FilledButton.icon(
                  onPressed: () => context.push('/carrinho'),
                  icon: const Icon(Icons.shopping_bag_outlined),
                  label: Text(
                    naSacola == 1
                        ? 'Ver sacola (1 item)'
                        : 'Ver sacola ($naSacola itens)',
                  ),
                  style: FilledButton.styleFrom(
                    minimumSize: const Size.fromHeight(52),
                    shape: RoundedRectangleBorder(
                      borderRadius: PandaRadius.bmd,
                    ),
                  ),
                ),
              ),
            ),
      body: SafeArea(
        child: cardapio.when(
          loading: () => const LoadingView(),
          error: (e, _) => ErrorView(
            mensagem: 'Não foi possível carregar o cardápio.',
            onRetry: () => ref.invalidate(menuProvider),
          ),
          data: (categorias) {
            if (categorias.isEmpty) {
              return const EmptyView(
                mensagem:
                    'O cardápio está sendo atualizado.\nTente novamente em instantes.',
                icone: Icons.restaurant_menu_outlined,
              );
            }
            return ListView(
              padding: const EdgeInsets.fromLTRB(24, 8, 24, 32),
              children: [
                // Fora do horário o cardápio continua à vista (é vitrine),
                // mas o aviso vem antes de alguém montar a sacola à toa.
                if (!restaurante.aceitandoPedidos()) ...[
                  _FaixaFechado(restaurante: restaurante),
                  const SizedBox(height: 16),
                ],
                Text(
                  'Toque no prato para ver detalhes e adicionar à sacola. '
                  'Entrega ou retirada, com pagamento no recebimento.',
                  style: TextStyle(
                    color: context.textoSec,
                    fontSize: 14.5,
                    height: 1.4,
                  ),
                ),
                const SizedBox(height: 20),
                for (final cat in categorias) ...[
                  _CategoriaTitulo(cat.nome),
                  const SizedBox(height: 14),
                  for (final item in cat.itens) ...[
                    _ItemCard(item: item),
                    const SizedBox(height: 12),
                  ],
                  const SizedBox(height: 16),
                ],
              ],
            );
          },
        ),
      ),
    );
  }
}

/// "Fechado agora" no topo do cardápio. A mesma informação aparece na sacola;
/// aqui é pra economizar o caminho inteiro de quem abriu fora de hora.
class _FaixaFechado extends StatelessWidget {
  const _FaixaFechado({required this.restaurante});
  final RestauranteInfo restaurante;

  @override
  Widget build(BuildContext context) {
    final proxima = restaurante.proximaAbertura();
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: context.laranjaFundo,
        borderRadius: PandaRadius.bmd,
      ),
      child: Row(
        children: [
          Icon(Icons.schedule_rounded, color: context.laranjaTexto, size: 20),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              restaurante.pedidosPausados
                  ? 'Não estamos aceitando pedidos no momento.'
                  : proxima == null
                  ? 'Estamos fechados agora.'
                  : 'Estamos fechados agora. $proxima.',
              style: TextStyle(
                color: context.laranjaTexto,
                fontSize: 13.5,
                height: 1.35,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _CategoriaTitulo extends StatelessWidget {
  const _CategoriaTitulo(this.texto);
  final String texto;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        const PontoMarca(),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            texto,
            style: const TextStyle(
              fontSize: 17,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.2,
            ),
          ),
        ),
      ],
    );
  }
}

class _ItemCard extends ConsumerWidget {
  const _ItemCard({required this.item});
  final MenuItem item;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final naSacola = ref.watch(carrinhoProvider)[item.id];
    final qtd = naSacola?.qtd ?? 0;
    final carrinho = ref.read(carrinhoProvider.notifier);

    return Material(
      color: isDark ? PandaColors.cardDark : PandaColors.branco,
      borderRadius: PandaRadius.bmd,
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        // O card inteiro abre o prato. Antes só o "+" respondia, e quem tocava
        // na foto ou no nome — que é onde a mão vai primeiro — não recebia
        // nada e concluía que o cardápio era só uma lista pra olhar.
        onTap: () => abrirItemSheet(context, item),
        child: Ink(
          decoration: BoxDecoration(
            borderRadius: PandaRadius.bmd,
            border: Border.all(
              // Prato na sacola ganha borda laranja: dá pra varrer a lista e
              // ver o que já foi escolhido sem abrir a sacola.
              color: qtd > 0
                  ? PandaColors.laranja
                  : (isDark ? PandaColors.hairlineDark : PandaColors.hairline),
              width: qtd > 0 ? 1.5 : 1,
            ),
          ),
          padding: const EdgeInsets.all(12),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              ClipRRect(
                borderRadius: PandaRadius.bsm,
                child: SizedBox(
                  width: 88,
                  height: 88,
                  // Prato sem foto continua aparecendo: cai num ícone em vez de
                  // buraco branco. Nem todo item vai ter imagem.
                  child: item.imagem == null
                      ? Container(
                          color: PandaColors.laranja,
                          child: const Icon(
                            Icons.restaurant_rounded,
                            color: Colors.white,
                          ),
                        )
                      : appImage(
                          item.imagem!,
                          erro: Container(color: PandaColors.laranjaSuave),
                        ),
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      item.nome,
                      style: const TextStyle(
                        fontWeight: FontWeight.w700,
                        fontSize: 15.5,
                      ),
                    ),
                    if (item.descricao.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Text(
                        item.descricao,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: context.textoSec,
                          fontSize: 13,
                          height: 1.3,
                        ),
                      ),
                    ],
                    if (naSacola?.obs.isNotEmpty == true) ...[
                      const SizedBox(height: 4),
                      Text(
                        naSacola!.obs,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: context.laranjaTexto,
                          fontSize: 13,
                          fontStyle: FontStyle.italic,
                        ),
                      ),
                    ],
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            item.precoFormatado,
                            style: TextStyle(
                              color: context.laranjaTexto,
                              fontWeight: FontWeight.w800,
                              fontSize: 15,
                            ),
                          ),
                        ),
                        // Atalho pra quem só quer mais um do mesmo, sem abrir
                        // o prato. Quem quer detalhe ou observação toca no card.
                        if (qtd > 0) ...[
                          IconButton(
                            onPressed: () => carrinho.remover(item.id),
                            icon: const Icon(Icons.remove_circle_outline),
                            tooltip: 'Tirar um',
                          ),
                          Text(
                            '$qtd',
                            style: const TextStyle(
                              fontWeight: FontWeight.w800,
                              fontSize: 15,
                            ),
                          ),
                        ],
                        IconButton(
                          onPressed: () => carrinho.adicionar(item.id),
                          icon: const Icon(Icons.add_circle),
                          color: PandaColors.laranja,
                          tooltip: 'Adicionar',
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
