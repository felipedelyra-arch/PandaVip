import 'package:flutter_test/flutter_test.dart';
import 'package:clube_panda/core/pix.dart';

void main() {
  group('pixCrc16', () {
    // Vetor canônico do CRC-16/CCITT-FALSE. Se este passa, o algoritmo está
    // certo — é o mesmo cálculo que o campo 63 do BR Code exige.
    test('"123456789" dá 29B1', () {
      expect(pixCrc16('123456789'), '29B1');
    });
  });

  group('pixCopiaECola', () {
    test('monta os campos obrigatórios na ordem do padrão', () {
      final codigo = pixCopiaECola(
        chave: 'chave-aleatoria-123',
        nome: 'João da Silva',
        cidade: 'Bauru',
      );

      expect(codigo, startsWith('000201')); // versão do payload
      expect(codigo, contains('0014BR.GOV.BCB.PIX'));
      expect(codigo, contains('chave-aleatoria-123'));
      expect(codigo, contains('5303986')); // moeda: real
      expect(codigo, contains('5802BR'));
      expect(codigo, contains('0503***')); // sem identificador de transação
    });

    test('o CRC do fim confere com o resto do payload', () {
      final codigo = pixCopiaECola(
        chave: 'teste@pandavip.app',
        nome: 'Maria',
        cidade: 'Bauru',
      );

      final semCrc = codigo.substring(0, codigo.length - 4);
      expect(semCrc, endsWith('6304'));
      expect(codigo.substring(codigo.length - 4), pixCrc16(semCrc));
    });

    test('sem valor não escreve o campo 54: quem digita é o cliente', () {
      final codigo = pixCopiaECola(
        chave: 'x@y.com',
        nome: 'Ana',
        cidade: 'Bauru',
      );
      expect(codigo.contains('5303986540'), isFalse);
    });

    test('com valor escreve o campo 54 com duas casas', () {
      final codigo = pixCopiaECola(
        chave: 'x@y.com',
        nome: 'Ana',
        cidade: 'Bauru',
        valor: 23.9,
      );
      expect(codigo, contains('540523.90'));
    });

    test('tira acento e caixa do nome — acento quebraria a contagem do campo',
        () {
      final codigo = pixCopiaECola(
        chave: 'x@y.com',
        nome: 'José Antônio Conceição',
        cidade: 'São Paulo',
      );
      expect(codigo, contains('JOSE ANTONIO CONCEICAO'));
      expect(codigo, contains('SAO PAULO'));
    });

    test('corta nome em 25 e cidade em 15, como manda o padrão', () {
      final codigo = pixCopiaECola(
        chave: 'x@y.com',
        nome: 'Um Nome Absurdamente Comprido De Funcionario',
        cidade: 'Cidade Com Nome Muito Grande',
      );
      // O tamanho declarado tem que bater com o conteúdo, senão o banco recusa.
      expect(codigo, contains('5925UM NOME ABSURDAMENTE COM'));
      expect(codigo, contains('6015CIDADE COM NOME'));
    });

    test('chave vazia é erro de programação, não código torto', () {
      expect(
        () => pixCopiaECola(chave: '  ', nome: 'Ana', cidade: 'Bauru'),
        throwsArgumentError,
      );
    });
  });
}
