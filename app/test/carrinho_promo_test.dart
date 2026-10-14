import 'package:flutter_test/flutter_test.dart';
import 'package:clube_panda/core/models/models.dart';
import 'package:clube_panda/features/cart/carrinho.dart';

void main() {
  final rodizio = MenuItem(id: 'rodizio', nome: 'Rodízio', preco: 89.9);

  test('preço com promoção arredonda igual ao servidor (montarPedido)', () {
    final l = LinhaCarrinho(item: rodizio, qtd: 2, promoId: 'p', descontoPct: 20);
    expect(l.precoUnitario, 71.92);
    expect(l.subtotal, closeTo(143.84, 1e-9));
  });

  test('mudar a quantidade pelo cardápio não tira a promoção', () {
    final c = Carrinho()
      ..definir('rodizio', 1, promoId: 'p', descontoPct: 20)
      ..definir('rodizio', 3)
      ..adicionar('rodizio');
    expect(c.state['rodizio']!.qtd, 4);
    expect(c.state['rodizio']!.promoId, 'p');
    expect(c.state['rodizio']!.descontoPct, 20);
  });
}
