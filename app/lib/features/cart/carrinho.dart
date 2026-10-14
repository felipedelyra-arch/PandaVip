import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/legacy.dart';

import '../../core/models/models.dart';
import '../../core/services/services.dart';
import '../../core/theme/colors.dart';

/// Um prato dentro da sacola: quanto, e o recado pra cozinha.
@immutable
class ItemSacola {
  const ItemSacola({
    required this.qtd,
    this.obs = '',
    this.promoId,
    this.descontoPct = 0,
  });
  final int qtd;
  final String obs;

  /// Promoção pela qual o prato entrou. Vai pro servidor, que confere e
  /// aplica o desconto de verdade; `descontoPct` aqui é só pra a tela.
  final String? promoId;
  final int descontoPct;

  ItemSacola copyWith({int? qtd, String? obs}) => ItemSacola(
    qtd: qtd ?? this.qtd,
    obs: obs ?? this.obs,
    promoId: promoId,
    descontoPct: descontoPct,
  );
}

/// Carrinho: só memória, morre quando o app fecha.
///
/// Não é descuido — é o que o carrinho precisa ser aqui. Guardar no disco faria
/// o sócio voltar dois dias depois com um rodízio de ontem na sacola e um preço
/// que já mudou; e guardar no Firestore custaria escrita a cada toque no "+".
/// O pedido só vira documento quando ele confirma, e aí quem manda no preço é
/// o servidor (functions/src/pedidos.ts).
///
/// A chave é o id do prato. Adicional e meia-porção não existem porque o
/// cardápio ainda não tem — quando a Starway mandar o formato deles, a chave
/// passa a ser item+adicionais.
class Carrinho extends StateNotifier<Map<String, ItemSacola>> {
  Carrinho() : super(const {});

  int qtdDe(String itemId) => state[itemId]?.qtd ?? 0;
  String obsDe(String itemId) => state[itemId]?.obs ?? '';

  /// Teto por item igual ao do backend (MAX_QTD): a tela não deixa o sócio
  /// montar um pedido que a função vai recusar depois.
  static const maxPorItem = 20;

  /// Soma unidades ao que já está na sacola. `obs` não nulo substitui o recado
  /// anterior — quem abriu o prato de novo e escreveu algo quis trocar.
  void adicionar(String itemId, {int quantos = 1, String? obs}) {
    final atual = state[itemId];
    final qtd = ((atual?.qtd ?? 0) + quantos).clamp(1, maxPorItem);
    state = {
      ...state,
      itemId: (atual ?? const ItemSacola(qtd: 1)).copyWith(
        qtd: qtd,
        obs: obs ?? atual?.obs ?? '',
      ),
    };
  }

  /// Define a quantidade exata. Zero (ou menos) tira o prato da sacola.
  ///
  /// Com `promoId`, o prato passa a valer pela promoção; sem, mantém a que
  /// já tinha — abrir o prato pelo cardápio pra mudar a quantidade não
  /// tira o desconto que o sócio pegou na Home.
  void definir(
    String itemId,
    int qtd, {
    String? obs,
    String? promoId,
    int? descontoPct,
  }) {
    if (qtd <= 0) {
      state = {...state}..remove(itemId);
      return;
    }
    final atual = state[itemId];
    state = {
      ...state,
      itemId: ItemSacola(
        qtd: qtd.clamp(1, maxPorItem),
        obs: obs ?? atual?.obs ?? '',
        promoId: promoId ?? atual?.promoId,
        descontoPct: promoId != null
            ? (descontoPct ?? 0)
            : (atual?.descontoPct ?? 0),
      ),
    };
  }

  void remover(String itemId) => definir(itemId, qtdDe(itemId) - 1);

  void limpar() => state = const {};
}

final carrinhoProvider =
    StateNotifierProvider<Carrinho, Map<String, ItemSacola>>((_) => Carrinho());

/// Quantos itens (somando as unidades) — é o número do balãozinho.
final carrinhoQtdProvider = Provider<int>((ref) {
  return ref.watch(carrinhoProvider).values.fold(0, (a, i) => a + i.qtd);
});

/// Linha do carrinho: o prato do cardápio + o que foi pedido dele.
@immutable
class LinhaCarrinho {
  const LinhaCarrinho({
    required this.item,
    required this.qtd,
    this.obs = '',
    this.promoId,
    this.descontoPct = 0,
  });
  final MenuItem item;
  final int qtd;
  final String obs;
  final String? promoId;
  final int descontoPct;

  /// Mesmo arredondamento do servidor (`montarPedido`): duas casas por unidade.
  double get precoUnitario => descontoPct > 0
      ? double.parse((item.preco * (1 - descontoPct / 100)).toStringAsFixed(2))
      : item.preco;
  double get subtotal => precoUnitario * qtd;
}

/// O carrinho resolvido contra o cardápio de agora.
///
/// Prato que saiu do ar enquanto a sacola estava aberta simplesmente some
/// daqui — o cardápio é a fonte da verdade, e é melhor sumir na tela do que
/// falhar na confirmação com "esse item acabou".
final linhasCarrinhoProvider = Provider<List<LinhaCarrinho>>((ref) {
  final sacola = ref.watch(carrinhoProvider);
  final menu = ref.watch(menuProvider).value ?? const <MenuItem>[];
  final linhas = <LinhaCarrinho>[];
  for (final item in menu) {
    final na = sacola[item.id];
    if (na != null && na.qtd > 0) {
      linhas.add(
        LinhaCarrinho(
          item: item,
          qtd: na.qtd,
          obs: na.obs,
          promoId: na.promoId,
          descontoPct: na.descontoPct,
        ),
      );
    }
  }
  return linhas;
});

/// Total da sacola. É estimativa pra mostrar na tela: quem fecha a conta de
/// verdade é o servidor, com o preço que estiver no banco na hora.
final carrinhoTotalProvider = Provider<double>((ref) {
  return ref
      .watch(linhasCarrinhoProvider)
      .fold(0.0, (soma, l) => soma + l.subtotal);
});

/// Aviso de "foi pra sacola", com atalho pra ela. Grande, laranja e com
/// botão branco: o sócio que adiciona pela Home precisa ver na hora que deu
/// certo e onde a sacola está — antes o aviso era cinza e passava batido.
///
/// Recebe o mensageiro e o router já lidos, porque quem chama costuma fechar
/// a folha (e perder o context) antes de mostrar.
void avisarSacola(
  ScaffoldMessengerState mensageiro,
  GoRouter rotas,
  String texto,
) {
  mensageiro
    ..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(
        behavior: SnackBarBehavior.floating,
        backgroundColor: PandaColors.laranja,
        elevation: 8,
        margin: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        padding: const EdgeInsets.fromLTRB(18, 14, 10, 14),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
        duration: const Duration(seconds: 5),
        content: Row(
          children: [
            const Icon(
              Icons.shopping_bag_rounded,
              color: Colors.white,
              size: 26,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                texto,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                  height: 1.25,
                ),
              ),
            ),
          ],
        ),
        action: SnackBarAction(
          label: 'Ver sacola',
          textColor: PandaColors.laranjaEscuro,
          backgroundColor: Colors.white,
          onPressed: () => rotas.push('/carrinho'),
        ),
      ),
    );
}
