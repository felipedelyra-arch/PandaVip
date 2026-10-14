import 'package:flutter/material.dart';
import '../theme/colors.dart';

/// Logo oficial do Tio Panda / PandaVip.
/// O asset `assets/logo/panda_logo.png` já contém a arte circular com
/// o panda e o texto "TioPanda", então não precisa de wordmark separado.
///
/// [size] controla a altura da logo. A largura se ajusta automaticamente
/// para manter a proporção original da imagem (sem distorcer).
class PandaLogo extends StatelessWidget {
  const PandaLogo({super.key, this.size = 48, this.showWordmark = true});

  /// Altura desejada para a logo em pixels lógicos.
  final double size;

  /// Ignorado agora (a logo já traz o nome). Mantido para
  /// retrocompatibilidade com chamadas existentes.
  final bool showWordmark;

  @override
  Widget build(BuildContext context) {
    // Forçamos um tamanho quadrado estrito para que a imagem
    // seja enquadrada perfeitamente no centro, sem NENHUMA
    // chance de o layout pai esticá-la ou achatá-la (ficar oval).
    return SizedBox(
      width: size,
      height: size,
      child: Center(
        child: Image.asset(
          'assets/logo/panda_logo.png',
          width: size,
          height: size,
          fit: BoxFit.contain, // A imagem agora é um quadrado perfeito!
          filterQuality: FilterQuality.high,
          errorBuilder: (_, _, _) => _fallback(),
        ),
      ),
    );
  }

  /// Fallback caso o asset falhe ao carregar.
  Widget _fallback() {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: PandaColors.laranja,
        borderRadius: BorderRadius.circular(size * 0.28),
      ),
      alignment: Alignment.center,
      child: Icon(
        Icons.restaurant_rounded,
        color: Colors.white,
        size: size * 0.5,
      ),
    );
  }
}
