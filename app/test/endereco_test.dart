import 'package:clube_panda/features/cart/endereco.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('linha do pedido junta as partes e pula as vazias', () {
    const e = EnderecoEntrega(
      cep: '00000-000',
      rua: 'Rua Exemplo',
      numero: '100',
      bairro: 'Centro',
      cidade: 'Tupã - SP',
    );
    expect(e.linha, 'Rua Exemplo, 100, Centro, Tupã - SP, CEP 00000-000');
    expect(
      EnderecoEntrega.fromMap({...e.toMap(), 'complemento': 'Apto 4'}).linha,
      'Rua Exemplo, 100 - Apto 4, Centro, Tupã - SP, CEP 00000-000',
    );
  });

  test('CEP vira 00000-000 só quando tem 8 dígitos', () {
    expect(formatarCep('12345678'), '12345-678');
    expect(formatarCep('12345-678'), '12345-678');
    expect(formatarCep('1234'), '1234');
  });
}
