import 'package:flutter/material.dart';

/// Escala única de arredondamento do app.
/// Antes havia 9 valores soltos (10, 12, 14, 15, 16, 18, 20, 22, 26) misturados
/// na mesma tela — o olho registra isso como descuido. Quatro degraus bastam.
abstract class PandaRadius {
  /// Pills, badges e selos.
  static const double xs = 8;

  /// Tiles de ícone, campos pequenos, thumbs.
  static const double sm = 12;

  /// Cards, botões, inputs — o valor padrão.
  static const double md = 18;

  /// Superfícies grandes: carteirinha, hero, banners.
  static const double lg = 24;

  /// Versões const — podem entrar em widgets `const` sem quebrar.
  static const BorderRadius bxs = BorderRadius.all(Radius.circular(xs));
  static const BorderRadius bsm = BorderRadius.all(Radius.circular(sm));
  static const BorderRadius bmd = BorderRadius.all(Radius.circular(md));
  static const BorderRadius blg = BorderRadius.all(Radius.circular(lg));
}
