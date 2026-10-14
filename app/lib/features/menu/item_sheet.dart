import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/models/models.dart';
import '../../core/theme/colors.dart';
import '../../core/theme/dimens.dart';
import '../../core/widgets/app_image.dart';
import '../cart/carrinho.dart';

/// Abre o prato em tela cheia de folha: foto grande, descrição, recado pra
/// cozinha e o botão de adicionar com o valor já somado.
///
/// Folha e não rota nova de propósito: o sócio está montando um pedido, e
/// empilhar tela pra cada prato faz ele perder o lugar no cardápio. Fechar a
/// folha devolve exatamente onde ele estava, inclusive a rolagem.
void abrirItemSheet(BuildContext context, MenuItem item) {
  showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    backgroundColor: Theme.of(context).scaffoldBackgroundColor,
    builder: (_) => _ItemSheet(item: item),
  );
}

class _ItemSheet extends ConsumerStatefulWidget {
  const _ItemSheet({required this.item});
  final MenuItem item;

  @override
  ConsumerState<_ItemSheet> createState() => _ItemSheetState();
}

class _ItemSheetState extends ConsumerState<_ItemSheet> {
  late final _obs = TextEditingController(
    text: ref.read(carrinhoProvider.notifier).obsDe(widget.item.id),
  );

  /// Quantidade desta visita. Começa no que já está na sacola (mínimo 1) pra
  /// quem abriu o prato de novo só pra mexer no que já pediu.
  late int _qtd = () {
    final naSacola = ref.read(carrinhoProvider.notifier).qtdDe(widget.item.id);
    return naSacola > 0 ? naSacola : 1;
  }();

  bool get _jaEstaNaSacola =>
      ref.read(carrinhoProvider.notifier).qtdDe(widget.item.id) > 0;

  @override
  void dispose() {
    _obs.dispose();
    super.dispose();
  }

  void _confirmar() {
    HapticFeedback.mediumImpact();
    final novo = !_jaEstaNaSacola;
    ref
        .read(carrinhoProvider.notifier)
        .definir(widget.item.id, _qtd, obs: _obs.text.trim());
    // Lidos antes do pop: depois dele este context some.
    final mensageiro = ScaffoldMessenger.of(context);
    final rotas = GoRouter.of(context);
    Navigator.of(context).pop();
    // Sem isto, quem adiciona pela Home não via sinal nenhum e não sabia
    // que a sacola fica no Cardápio.
    avisarSacola(
      mensageiro,
      rotas,
      novo ? '${widget.item.nome} na sacola' : 'Sacola atualizada',
    );
  }

  @override
  Widget build(BuildContext context) {
    final item = widget.item;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final total = item.preco * _qtd;

    return SafeArea(
      top: false,
      child: Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.of(context).viewInsets.bottom,
        ),
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Foto em 16:9 e larga: é ela que vende o prato. Sem foto, um
              // bloco de acento com o ícone — nunca um retângulo branco.
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: ClipRRect(
                  borderRadius: PandaRadius.blg,
                  child: AspectRatio(
                    aspectRatio: 16 / 9,
                    child: item.imagem == null
                        ? Container(
                            color: isDark
                                ? PandaColors.cardDark
                                : PandaColors.laranjaSuave,
                            child: const Icon(
                              Icons.restaurant_rounded,
                              size: 48,
                              color: PandaColors.laranja,
                            ),
                          )
                        : appImage(
                            item.imagem!,
                            erro: Container(
                              color: PandaColors.laranja,
                              child: const Icon(
                                Icons.restaurant_rounded,
                                size: 48,
                                color: Colors.white,
                              ),
                            ),
                          ),
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(24, 20, 24, 24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      item.nome,
                      style: const TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.w800,
                        height: 1.2,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      item.precoFormatado,
                      style: TextStyle(
                        color: context.laranjaTexto,
                        fontWeight: FontWeight.w800,
                        fontSize: 17,
                      ),
                    ),
                    if (item.descricao.isNotEmpty) ...[
                      const SizedBox(height: 14),
                      Text(
                        item.descricao,
                        style: TextStyle(
                          color: context.textoSec,
                          fontSize: 14.5,
                          height: 1.45,
                        ),
                      ),
                    ],
                    const SizedBox(height: 22),
                    TextField(
                      controller: _obs,
                      maxLength: 200,
                      maxLines: 2,
                      textCapitalization: TextCapitalization.sentences,
                      decoration: InputDecoration(
                        labelText: 'Algum detalhe? (opcional)',
                        hintText: 'Ex.: sem cebola, molho à parte',
                        border: OutlineInputBorder(
                          borderRadius: PandaRadius.bmd,
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        _Stepper(
                          qtd: _qtd,
                          onMenos: _qtd > 1
                              ? () => setState(() => _qtd--)
                              : null,
                          onMais: _qtd < Carrinho.maxPorItem
                              ? () => setState(() => _qtd++)
                              : null,
                        ),
                        const SizedBox(width: 14),
                        Expanded(
                          child: FilledButton(
                            onPressed: _confirmar,
                            style: FilledButton.styleFrom(
                              minimumSize: const Size.fromHeight(54),
                              shape: RoundedRectangleBorder(
                                borderRadius: PandaRadius.bmd,
                              ),
                            ),
                            child: Text(
                              // "Atualizar" quando o prato já está na sacola:
                              // dizer "Adicionar" ali faria parecer que vai
                              // somar em cima do que já tem.
                              '${_jaEstaNaSacola ? 'Atualizar' : 'Adicionar'}'
                              ' · R\$ ${total.toStringAsFixed(2).replaceAll('.', ',')}',
                              style: const TextStyle(
                                fontWeight: FontWeight.w700,
                                fontSize: 15,
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                    if (_jaEstaNaSacola) ...[
                      const SizedBox(height: 4),
                      Center(
                        child: OutlinedButton(
                          onPressed: () {
                            ref
                                .read(carrinhoProvider.notifier)
                                .definir(item.id, 0);
                            Navigator.of(context).pop();
                          },
                          // Ação destrutiva: contorno vermelho legível, não
                          // texto cinza solto.
                          style: OutlinedButton.styleFrom(
                            foregroundColor: context.vermelhoTexto,
                            side: BorderSide(
                              color: context.vermelhoTexto,
                              width: 1.6,
                            ),
                          ),
                          child: const Text('Remover da sacola'),
                        ),
                      ),
                    ],
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

/// Contador redondo de quantidade. Botão desligado some de cor em vez de
/// sumir da tela — o campo não muda de largura ao chegar no 1.
class _Stepper extends StatelessWidget {
  const _Stepper({required this.qtd, this.onMenos, this.onMais});

  final int qtd;
  final VoidCallback? onMenos;
  final VoidCallback? onMais;

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      decoration: BoxDecoration(
        borderRadius: PandaRadius.bmd,
        border: Border.all(
          color: isDark ? PandaColors.hairlineDark : PandaColors.hairline,
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          IconButton(
            onPressed: onMenos,
            icon: const Icon(Icons.remove_rounded),
            tooltip: 'Tirar um',
          ),
          SizedBox(
            width: 24,
            child: Text(
              '$qtd',
              textAlign: TextAlign.center,
              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16),
            ),
          ),
          IconButton(
            onPressed: onMais,
            icon: const Icon(Icons.add_rounded),
            color: PandaColors.laranja,
            tooltip: 'Mais um',
          ),
        ],
      ),
    );
  }
}
