import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';

import '../theme/colors.dart';

/// Mostra o app dentro de um "celular" quando roda em tela larga no navegador
/// (só demonstração web). Em janela estreita ou app nativo, renderiza direto.
class PhoneFrame extends StatelessWidget {
  const PhoneFrame({super.key, required this.child});

  final Widget child;

  // Dimensões aproximadas de um celular moderno (lógicas).
  static const _w = 390.0;
  static const _h = 844.0;
  static const _bezel = 8.0; // espessura da borda preta
  static const _btn = 4.0; // saliência dos botões
  static const _frameW = _w + _bezel * 2;
  static const _frameH = _h + _bezel * 2;

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.sizeOf(context);
    final ehTelaLarga = kIsWeb && size.width > 600 && size.height > 400;

    if (!ehTelaLarga) return child;

    final isDark = Theme.of(context).brightness == Brightness.dark;

    // MediaQuery do conteúdo passa a valer o tamanho do "celular".
    final conteudo = MediaQuery(
      data: MediaQuery.of(context).copyWith(
        size: const Size(_w, _h),
        padding: const EdgeInsets.only(top: 44, bottom: 24), // notch + home bar
        viewPadding: const EdgeInsets.only(top: 44, bottom: 24),
      ),
      child: child,
    );

    return Container(
      color: isDark ? const Color(0xFF0A0A0A) : const Color(0xFFE8E8E8),
      alignment: Alignment.center,
      padding: const EdgeInsets.all(16),
      // Escala a moldura pra caber em qualquer altura de janela (sem overflow).
      child: FittedBox(
        fit: BoxFit.contain,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            SizedBox(
              width: _frameW + _btn * 2,
              height: _frameH,
              child: Stack(
                clipBehavior: Clip.none,
                alignment: Alignment.center,
                children: [
                  // ---- botões laterais (atrás da moldura) ----
                  // Esquerda: switch de mudo + volume +/-
                  _sideButton(left: 0, top: 130, height: 26),
                  _sideButton(left: 0, top: 180, height: 56),
                  _sideButton(left: 0, top: 248, height: 56),
                  // Direita: power
                  _sideButton(right: 0, top: 210, height: 96),

                  // ---- moldura + tela ----
                  Container(
                    width: _frameW,
                    height: _frameH,
                    padding: const EdgeInsets.all(_bezel),
                    decoration: BoxDecoration(
                      color: PandaColors.laranja, // moldura na cor da logo
                      borderRadius: BorderRadius.circular(52),
                      border: Border.all(
                        color: PandaColors.laranjaEscuro,
                        width: 2,
                      ),
                      boxShadow: [
                        BoxShadow(
                          color: PandaColors.laranja.withValues(alpha: 0.35),
                          blurRadius: 40,
                          spreadRadius: 4,
                          offset: const Offset(0, 16),
                        ),
                      ],
                    ),
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(44),
                      child: SizedBox(
                        width: _w,
                        height: _h,
                        child: Stack(
                          children: [
                            Positioned.fill(child: conteudo),
                            // Dynamic Island (pílula fina).
                            Positioned(
                              top: 12,
                              left: 0,
                              right: 0,
                              child: Center(
                                child: Container(
                                  width: 92,
                                  height: 24,
                                  decoration: BoxDecoration(
                                    color: const Color(0xFF000000),
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            Text(
              'PandaVip — pré-visualização (demo web)',
              style: TextStyle(
                color: isDark ? Colors.white54 : Colors.black45,
                fontSize: 13,
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Botão físico lateral (saliência arredondada na borda da moldura).
  Widget _sideButton({
    double? left,
    double? right,
    required double top,
    required double height,
  }) {
    return Positioned(
      left: left,
      right: right,
      top: top,
      child: Container(
        width: _btn + 3,
        height: height,
        decoration: BoxDecoration(
          color: PandaColors.laranjaEscuro,
          borderRadius: BorderRadius.horizontal(
            left: Radius.circular(right != null ? 3 : 0),
            right: Radius.circular(left != null ? 3 : 0),
          ),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.4),
              blurRadius: 2,
              offset: Offset(left != null ? -1 : 1, 0),
            ),
          ],
        ),
      ),
    );
  }
}
