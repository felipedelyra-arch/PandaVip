import 'package:clube_panda/features/auth/auth_widgets.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('máscara põe as barras sozinha', () {
    expect(formatarData('12'), '12');
    expect(formatarData('121'), '12/1');
    expect(formatarData('1212'), '12/12');
    expect(formatarData('12122005'), '12/12/2005');
    expect(formatarData('121220059'), '12/12/2005'); // não passa de 8 dígitos
    expect(formatarData('12/12/2005'), '12/12/2005'); // colado com barras
  });

  test('lê a data e aplica a idade mínima de 14 anos', () {
    final hoje = DateTime(2026, 10, 12);
    expect(lerNascimento('12/12/2005', hoje: hoje).data, DateTime(2005, 12, 12));
    expect(lerNascimento('12/12', hoje: hoje).erro, isNull); // incompleta
    expect(lerNascimento('31/02/2000', hoje: hoje).erro, 'Data inválida.');
    expect(lerNascimento('10/13/2000', hoje: hoje).erro, 'Data inválida.');
    expect(lerNascimento('01/01/1900', hoje: hoje).erro, 'Data inválida.');
    expect(lerNascimento('12/10/2012', hoje: hoje).data, DateTime(2012, 10, 12));
    expect(
      lerNascimento('13/10/2012', hoje: hoje).erro,
      'É preciso ter 14 anos ou mais.',
    );
  });

  testWidgets('digitar só números preenche a data', (t) async {
    DateTime? recebida;
    await t.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: AuthCampoData(
            valor: null,
            onTap: () {},
            onChanged: (d) => recebida = d,
          ),
        ),
      ),
    );
    await t.enterText(find.byType(TextField), '12122005');
    expect(find.text('12/12/2005'), findsOneWidget);
    expect(recebida, DateTime(2005, 12, 12));
  });
}
