import 'package:flutter/material.dart';
import 'colors.dart';
import 'dimens.dart';

/// Tema PandaVip — minimalista, quente, laranja sóbrio como acento.
/// Corpo sempre em Inter. Títulos dependem de [usarSerifa]:
/// Fraunces (serifa, ar de restaurante) ou Inter com tracking negativo
/// (ar de produto de tecnologia).
/// Fontes empacotadas localmente (ver pubspec) — sem download em runtime.
abstract class AppTheme {
  /// Chave única pra comparar as duas identidades tipográficas.
  ///
  /// `false` (atual): títulos em Inter apertado — visual mais tecnológico.
  /// `true`: volta tudo pra Fraunces, exatamente como era antes.
  ///
  /// Independente do valor, a saudação da Home continua em serifa
  /// (ver [assinatura]) — é o meio-termo: a serifa vira assinatura da
  /// marca num ponto só, em vez de tema de todas as telas.
  static const bool usarSerifa = false;

  static const _corpo = 'Inter';

  /// Família serifada, exposta pros pontos que a usam à parte do tema.
  static const serifa = 'Fraunces';

  static String get _titulo => usarSerifa ? serifa : _corpo;

  /// Tracking negativo proporcional ao tamanho. É o que separa "Inter tight"
  /// (produto de tecnologia) de "Inter padrão" (dashboard genérico).
  /// Em Fraunces fica zero — serifa apertada fica ilegível.
  static double _tracking(double? tamanho) {
    if (usarSerifa) return 0;
    final s = tamanho ?? 20;
    if (s >= 32) return -s * 0.032;
    if (s >= 24) return -s * 0.026;
    return -s * 0.018;
  }

  /// Força a serifa num estilo específico, seja qual for [usarSerifa].
  /// Usado na saudação da Home.
  static TextStyle assinatura(TextStyle? base) =>
      (base ?? const TextStyle()).copyWith(
        fontFamily: serifa,
        fontWeight: FontWeight.w600,
        letterSpacing: 0,
        height: 1.15,
      );

  static ThemeData get light => _base(Brightness.light);
  static ThemeData get dark => _base(Brightness.dark);

  static TextTheme _textTheme(Brightness b) {
    final corpo = ThemeData(brightness: b).textTheme.apply(fontFamily: _corpo);
    final cor = b == Brightness.dark ? PandaColors.branco : PandaColors.preto;

    TextStyle titulo(TextStyle? base) => (base ?? const TextStyle()).copyWith(
      fontFamily: _titulo,
      // Inter precisa de mais peso que Fraunces pra manter presença.
      fontWeight: usarSerifa ? FontWeight.w600 : FontWeight.w700,
      letterSpacing: _tracking(base?.fontSize),
      height: usarSerifa ? null : 1.12,
      color: cor,
    );

    return corpo
        .copyWith(
          displayLarge: titulo(corpo.displayLarge),
          displayMedium: titulo(corpo.displayMedium),
          headlineLarge: titulo(corpo.headlineLarge),
          headlineMedium: titulo(corpo.headlineMedium),
          headlineSmall: titulo(corpo.headlineSmall),
          titleLarge: titulo(corpo.titleLarge),
        )
        .apply(bodyColor: cor, displayColor: cor);
  }

  static ThemeData _base(Brightness brightness) {
    final isDark = brightness == Brightness.dark;

    final scheme = ColorScheme.fromSeed(
      seedColor: PandaColors.laranja,
      brightness: brightness,
      primary: PandaColors.laranja,
      onPrimary: Colors.white,
      secondary: PandaColors.laranja,
      surface: isDark ? PandaColors.superficieDark : PandaColors.branco,
    );

    final scaffoldBg = isDark ? PandaColors.fundoDark : PandaColors.fundo;
    final cardBg = isDark ? PandaColors.cardDark : PandaColors.branco;
    final hairline = isDark ? PandaColors.hairlineDark : PandaColors.hairline;
    final textoPrincipal = isDark ? PandaColors.branco : PandaColors.preto;
    // Cores de texto com contraste AA (espelham PandaTextoCores em colors.dart).
    final textoSec = isDark ? const Color(0xFFA39A8E) : const Color(0xFF6B6358);
    final laranjaTexto = isDark ? PandaColors.laranja : const Color(0xFFB8480F);

    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      fontFamily: _corpo,
      colorScheme: scheme,
      scaffoldBackgroundColor: scaffoldBg,
      textTheme: _textTheme(brightness),
      dividerTheme: DividerThemeData(color: hairline, thickness: 1, space: 1),
      appBarTheme: AppBarTheme(
        backgroundColor: scaffoldBg,
        surfaceTintColor: Colors.transparent,
        foregroundColor: textoPrincipal,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        titleTextStyle: TextStyle(
          fontFamily: _titulo,
          fontSize: 22,
          fontWeight: usarSerifa ? FontWeight.w600 : FontWeight.w700,
          letterSpacing: _tracking(22),
          color: textoPrincipal,
        ),
      ),
      cardTheme: CardThemeData(
        color: cardBg,
        elevation: 0,
        shadowColor: Colors.black.withValues(alpha: 0.04),
        shape: RoundedRectangleBorder(
          borderRadius: PandaRadius.bmd,
          side: BorderSide(color: hairline),
        ),
        margin: EdgeInsets.zero,
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          // Fundo um tom mais escuro que a marca: branco sobre laranja puro
          // dá 3.2:1; neste dá 4.5:1 (AA).
          backgroundColor: PandaColors.laranja,
          foregroundColor: Colors.white,
          disabledBackgroundColor: PandaColors.cinzaTexto.withValues(
            alpha: 0.3,
          ),
          disabledForegroundColor: textoSec,
          minimumSize: const Size.fromHeight(54),
          elevation: 0,
          textStyle: const TextStyle(
            fontFamily: _corpo,
            fontSize: 15,
            fontWeight: FontWeight.w600,
          ),
          shape: RoundedRectangleBorder(borderRadius: PandaRadius.bmd),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: PandaColors.laranja,
          foregroundColor: Colors.white,
          disabledForegroundColor: textoSec,
          minimumSize: const Size(64, 54),
          textStyle: const TextStyle(
            fontFamily: _corpo,
            fontSize: 15,
            fontWeight: FontWeight.w600,
          ),
          shape: RoundedRectangleBorder(borderRadius: PandaRadius.bmd),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: textoPrincipal,
          minimumSize: const Size.fromHeight(54),
          // Borda visível (>= 3:1); o hairline sumia pra quem enxerga mal.
          side: const BorderSide(color: Color(0xFF8C8377), width: 1.4),
          textStyle: const TextStyle(
            fontFamily: _corpo,
            fontSize: 15,
            fontWeight: FontWeight.w600,
          ),
          shape: RoundedRectangleBorder(borderRadius: PandaRadius.bmd),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: laranjaTexto,
          minimumSize: const Size(48, 48),
          textStyle: const TextStyle(
            fontFamily: _corpo,
            fontSize: 15,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: isDark ? PandaColors.cardDark : PandaColors.cinzaClaro,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 18,
          vertical: 18,
        ),
        hintStyle: TextStyle(color: textoSec),
        labelStyle: TextStyle(color: textoSec),
        border: OutlineInputBorder(
          borderRadius: PandaRadius.bmd,
          borderSide: BorderSide.none,
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: PandaRadius.bmd,
          borderSide: BorderSide(color: hairline),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: PandaRadius.bmd,
          borderSide: const BorderSide(color: PandaColors.laranja, width: 1.6),
        ),
      ),
      chipTheme: ChipThemeData(
        backgroundColor: isDark ? PandaColors.cardDark : PandaColors.cinzaClaro,
        side: BorderSide(color: hairline),
        // Cor explícita: sem ela o M3 deixava o rótulo do chip não
        // selecionado apagado no tema escuro, com cara de desabilitado.
        labelStyle: TextStyle(
          fontFamily: _corpo,
          fontSize: 13,
          fontWeight: FontWeight.w500,
          color: isDark ? PandaColors.branco : PandaColors.preto,
        ),
        shape: RoundedRectangleBorder(borderRadius: PandaRadius.bsm),
      ),
      // Barra inferior Material 3 — indicador em pill, sem o visual datado
      // do BottomNavigationBar (M2).
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: cardBg,
        surfaceTintColor: Colors.transparent,
        indicatorColor: PandaColors.laranja.withValues(
          alpha: isDark ? 0.24 : 0.13,
        ),
        indicatorShape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
        ),
        elevation: 0,
        height: 70,
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
        iconTheme: WidgetStateProperty.resolveWith(
          (estados) => IconThemeData(
            size: 24,
            color: estados.contains(WidgetState.selected)
                ? laranjaTexto
                : textoSec,
          ),
        ),
        labelTextStyle: WidgetStateProperty.resolveWith(
          (estados) => TextStyle(
            fontFamily: _corpo,
            fontSize: 12.5,
            fontWeight: estados.contains(WidgetState.selected)
                ? FontWeight.w700
                : FontWeight.w500,
            color: estados.contains(WidgetState.selected)
                ? laranjaTexto
                : textoSec,
          ),
        ),
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: PandaColors.preto,
        contentTextStyle: const TextStyle(
          fontFamily: _corpo,
          color: Colors.white,
        ),
        shape: RoundedRectangleBorder(borderRadius: PandaRadius.bsm),
      ),
    );
  }
}
