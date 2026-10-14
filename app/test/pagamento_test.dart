import 'package:flutter_test/flutter_test.dart';
import 'package:clube_panda/features/subscription/pagamento_screen.dart';

void main() {
  test('cartão: Luhn aceita número válido e recusa um dígito trocado', () {
    expect(cartaoValido('4111 1111 1111 1111'), isTrue);
    expect(cartaoValido('4111 1111 1111 1112'), isFalse);
    expect(cartaoValido('1234'), isFalse);
  });

  test('validade: mês corrente vale, mês passado e mês 13 não', () {
    final hoje = DateTime(2026, 10, 2);
    expect(validadeOk('10/26', hoje), isTrue);
    expect(validadeOk('09/26', hoje), isFalse);
    expect(validadeOk('13/30', hoje), isFalse);
  });

  test('CPF: dígitos verificadores', () {
    expect(cpfValido('529.982.247-25'), isTrue);
    expect(cpfValido('529.982.247-24'), isFalse);
    expect(cpfValido('111.111.111-11'), isFalse);
  });
}
