import 'package:clube_panda/features/auth/auth_senha.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('aceita senha forte', () {
    expect(validarSenhaForte('Abcdef1@'), isNull);
    expect(validarSenhaForte('Panda#2026ok'), isNull);
  });

  test('recusa cada requisito faltando', () {
    expect(validarSenhaForte('Ab1@xyz'), isNotNull); // 7 caracteres
    expect(validarSenhaForte('abcdef1@'), isNotNull); // sem maiúscula
    expect(validarSenhaForte('ABCDEF1@'), isNotNull); // sem minúscula
    expect(validarSenhaForte('Abcdefg@'), isNotNull); // sem número
    expect(validarSenhaForte('Abcdefg1'), isNotNull); // sem especial
    expect(validarSenhaForte('Abcdef1-'), isNotNull); // '-' não conta
    expect(validarSenhaForte('Abcdef1+'), isNotNull); // '+' não conta
    expect(validarSenhaForte(''), isNotNull);
  });
}
