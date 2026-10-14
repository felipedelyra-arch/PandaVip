import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:clube_panda/core/models/models.dart';
import 'package:clube_panda/core/services/services.dart';
import 'package:clube_panda/features/cart/pedidos_screen.dart';

Pedido _pedido(String id, String status, DateTime quando, String prato) =>
    Pedido(
      id: id,
      userId: 'u1',
      itens: [PedidoItem(itemId: 'i', nome: prato, preco: 50, qtd: 2)],
      total: 100,
      status: status,
      criadoEm: quando,
    );

void main() {
  setUpAll(() => initializeDateFormatting('pt_BR', null));

  testWidgets('em andamento no topo, histórico agrupado por mês', (t) async {
    await t.pumpWidget(
      ProviderScope(
        overrides: [
          pedidosProvider.overrideWith(
            (_) => Stream.value([
              _pedido('a', 'preparando', DateTime(2026, 10, 7, 20), 'Combinado'),
              _pedido('b', 'entregue', DateTime(2026, 10, 2, 21), 'Temaki'),
              _pedido('c', 'cancelado', DateTime(2026, 9, 20, 19), 'Sashimi'),
            ]),
          ),
        ],
        child: const MaterialApp(home: PedidosScreen()),
      ),
    );
    await t.pump();

    expect(find.text('EM ANDAMENTO'), findsOneWidget);
    expect(find.text('OUTUBRO 2026'), findsOneWidget);
    expect(find.text('SETEMBRO 2026'), findsOneWidget);
    // Em andamento mostra os itens; o histórico só a linha resumida.
    expect(find.text('2x Combinado'), findsOneWidget);
    expect(find.text('2x Temaki'), findsNothing);
    expect(find.text('2 itens · Cancelado'), findsOneWidget);

    // Tocar na linha abre o detalhe com os itens do pedido.
    await t.tap(find.text('2 itens · Entregue'));
    // Sem pumpAndSettle: a barra de etapas do pedido em andamento anima sem parar.
    await t.pump(const Duration(seconds: 1));
    expect(find.text('2x Temaki'), findsOneWidget);
  });
}
