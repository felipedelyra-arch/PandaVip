// Smoke test básico. Testes de integração reais precisam do Firebase
// configurado (flutterfire configure) — ver README.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:clube_panda/core/widgets/panda_logo.dart';

void main() {
  testWidgets('PandaLogo renderiza sem erro', (WidgetTester tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: Scaffold(body: PandaLogo(size: 48))),
    );
    // A logo virou uma imagem única (o nome já está na arte). Basta renderizar.
    expect(find.byType(PandaLogo), findsOneWidget);
    expect(find.byType(Image), findsOneWidget);
  });
}
