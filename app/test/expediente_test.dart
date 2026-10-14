// Horário de funcionamento visto pelo app (core/restaurante.dart).
//
// O servidor tem a mesma regra e a última palavra
// (firebase/functions/src/lib/expediente.ts). Esta suíte existe pra as duas
// não divergirem em silêncio: divergir aqui significa o sócio montar a sacola
// inteira e tomar erro no fim.
import 'package:flutter_test/flutter_test.dart';
import 'package:clube_panda/core/restaurante.dart';

RestauranteInfo comHorario(Map<String, String> horarios, {bool pausado = false}) {
  return RestauranteInfo.fromMap({
    'horarios': horarios,
    'pedidosPausados': pausado,
  });
}

const semana = {
  'dom': '18:00-23:00',
  'seg': '',
  'ter': '18:00-23:30',
  'qua': '18:00-23:30',
  'qui': '18:00-23:30',
  'sex': '18:00-01:00',
  'sab': '18:00-01:00',
};

void main() {
  test('aberto dentro da janela, fechado antes e no dia de folga', () {
    final r = comHorario(semana);
    expect(r.aceitandoPedidos(DateTime(2026, 9, 19, 21)), isTrue); // sábado 21h
    expect(r.aceitandoPedidos(DateTime(2026, 9, 19, 16)), isFalse); // antes de abrir
    expect(r.aceitandoPedidos(DateTime(2026, 9, 21, 20)), isFalse); // segunda
  });

  test('a janela do sábado segura a madrugada de domingo', () {
    final r = comHorario(semana);
    expect(r.aceitandoPedidos(DateTime(2026, 9, 20, 0, 30)), isTrue);
    expect(r.aceitandoPedidos(DateTime(2026, 9, 20, 1, 30)), isFalse);
  });

  test('pausar fecha, e semana em branco não fecha nada', () {
    expect(comHorario(semana, pausado: true).aceitandoPedidos(DateTime(2026, 9, 19, 21)),
        isFalse);
    expect(comHorario({}).aceitandoPedidos(DateTime(2026, 9, 21, 3)), isTrue);
  });

  test('o aviso diz quando abre', () {
    final r = comHorario(semana);
    expect(r.proximaAbertura(DateTime(2026, 9, 19, 16)), 'Abre hoje às 18:00');
    // Domingo 2h: hoje abre 18:00.
    expect(r.proximaAbertura(DateTime(2026, 9, 20, 2)), 'Abre hoje às 18:00');
    // Segunda é fechada: o próximo é terça.
    expect(r.proximaAbertura(DateTime(2026, 9, 21, 20)), 'Abre amanhã às 18:00');
    expect(comHorario({}).proximaAbertura(DateTime(2026, 9, 21, 20)), isNull);
  });

  test('taxa de entrega vem do painel', () {
    expect(RestauranteInfo.fromMap({'taxaEntrega': 5.5}).taxaEntrega, 5.5);
    expect(RestauranteInfo.fromMap({}).taxaEntrega, 0);
  });
}
