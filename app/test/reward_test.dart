import 'package:flutter_test/flutter_test.dart';
import 'package:clube_panda/core/models/models.dart';
import 'package:clube_panda/core/restaurante.dart';

void main() {
  group('Reward.disponivel / noPrazo', () {
    Reward reward({int estoque = 5, DateTime? ate}) => Reward(
          id: 'x',
          titulo: 'Prêmio',
          descricao: '',
          estoque: estoque,
          resgatavelAte: ate,
        );

    test('sem estoque não fica disponível', () {
      expect(reward(estoque: 0).disponivel, isFalse);
    });

    test('com estoque e sem prazo fica disponível', () {
      final r = reward();
      expect(r.noPrazo, isTrue);
      expect(r.disponivel, isTrue);
    });

    test('prazo no futuro continua disponível', () {
      final r = reward(ate: DateTime.now().add(const Duration(hours: 2)));
      expect(r.noPrazo, isTrue);
      expect(r.disponivel, isTrue);
    });

    test('prazo no passado não fica disponível', () {
      final r = reward(ate: DateTime.now().subtract(const Duration(hours: 1)));
      expect(r.noPrazo, isFalse);
      expect(r.disponivel, isFalse);
    });

    test('estoque ok mas prazo vencido = indisponível', () {
      final r = reward(
          estoque: 10, ate: DateTime.now().subtract(const Duration(days: 1)));
      expect(r.disponivel, isFalse);
    });
  });

  group('RestauranteInfo', () {
    test('sem doc no Firestore, cai nos valores de exemplo', () {
      // Enquanto o painel não preencher, o app sabe que faltam dados.
      final r = RestauranteInfo.fromMap(null);
      expect(r.telefone, RestauranteInfo.padrao.telefone);
      expect(r.contatosPendentes, isTrue);
    });

    test('campo preenchido no painel vence o compilado', () {
      final r = RestauranteInfo.fromMap({
        'telefone': '551433221100',
        'whatsapp': '5514991234567',
        'endereco': 'Rua das Flores, 10 — Bauru/SP',
      });
      expect(r.telefone, '551433221100');
      expect(r.contatosPendentes, isFalse);
      // O que o painel não mandou continua vindo do padrão.
      expect(r.termosUrl, RestauranteInfo.padrao.termosUrl);
    });

    test('campo em branco ou de outro tipo não apaga o padrão', () {
      final r = RestauranteInfo.fromMap({'nome': '  ', 'telefone': 42});
      expect(r.nome, RestauranteInfo.padrao.nome);
      expect(r.telefone, RestauranteInfo.padrao.telefone);
    });
  });
}
