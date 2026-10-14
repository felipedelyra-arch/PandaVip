import 'package:flutter/material.dart';

/// Paleta PandaVip (Tio Panda) — laranja sóbrio e minimalista.
/// Laranja é acento (CTA, destaques), não preenchimento. Base em neutros quentes.
abstract class PandaColors {
  // Marca
  static const laranja = Color(0xFFE86A22); // primária / CTA (modesto)
  static const laranjaEscuro = Color(0xFFC9591A); // pressed
  static const laranjaSuave = Color(0xFFF6EDE4); // fundo de acento leve

  // Neutros quentes (claro)
  static const fundo = Color(0xFFFBF9F5); // papel quente
  static const branco = Color(0xFFFFFFFF); // superfície de card
  static const cinzaClaro = Color(0xFFF4EFE8); // superfície alternativa
  static const hairline = Color(0xFFEBE4D9); // divisores/bordas
  static const preto = Color(0xFF201B15); // texto principal (carvão quente)
  static const cinzaTexto = Color(0xFF8C8377); // texto secundário

  // Estados
  static const verdeSucesso = Color(0xFF2FA36B);
  static const vermelhoAcento = Color(0xFFE23B2E); // sushi da logo (raro)

  // Neutros quentes (escuro)
  static const fundoDark = Color(0xFF141210);
  static const superficieDark = Color(0xFF1E1B17);
  static const cardDark = Color(0xFF262119);
  static const hairlineDark = Color(0x14FFFFFF);
}

/// Variantes de texto com contraste mínimo de 4.5:1 (WCAG AA) nos dois temas.
/// Os tokens acima (cinzaTexto, laranja, vermelhoAcento) ficam como estão pra
/// bordas/ícones/preenchimentos; pra TEXTO use estes, que mudam com o tema.
/// Medidos: claro >= 4.5 sobre fundo/branco/cinzaClaro/laranjaSuave;
/// escuro >= 4.9 sobre fundoDark/superficieDark/cardDark.
extension PandaTextoCores on BuildContext {
  bool get _escuro => Theme.of(this).brightness == Brightness.dark;

  /// Texto secundário/ajuda (antes cinzaTexto: 3.2 a 3.7 no claro).
  Color get textoSec =>
      _escuro ? const Color(0xFFA39A8E) : const Color(0xFF6B6358);

  /// Laranja pra texto/link (laranja puro dá 3.1 no claro).
  Color get laranjaTexto =>
      _escuro ? PandaColors.laranja : const Color(0xFFB8480F);

  /// Vermelho pra texto/ação destrutiva (vermelhoAcento dá 4.1 no claro e 3.7 no card escuro).
  Color get vermelhoTexto =>
      _escuro ? const Color(0xFFFF6B5B) : const Color(0xFFC62E20);

  /// Verde pra texto (verdeSucesso dá 3.2 no claro).
  Color get verdeTexto =>
      _escuro ? PandaColors.verdeSucesso : const Color(0xFF1B7A4B);

  /// Fundo de aviso/destaque com texto laranja. No escuro, o creme
  /// (laranjaSuave) virava um bloco claro com laranjaTexto ilegível em cima;
  /// este tom escuro quente mantém >= 4.5:1 com laranjaTexto.
  Color get laranjaFundo =>
      _escuro ? const Color(0xFF2E1D12) : PandaColors.laranjaSuave;

  /// Borda visível (>= 3:1) de botões secundários.
  Color get bordaForte => const Color(0xFF8C8377);
}
