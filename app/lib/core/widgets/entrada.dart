import 'package:flutter/material.dart';

/// Entrada suave: o bloco surge com fade + deslize curto de baixo pra cima.
///
/// Usado pra escalonar os blocos de uma tela (stagger). Sem dependência
/// externa e sem custo perceptível — só um AnimationController por bloco.
class FadeSlideIn extends StatefulWidget {
  const FadeSlideIn({
    super.key,
    required this.child,
    this.delay = Duration.zero,
    this.deslocamento = 0.06,
  });

  final Widget child;
  final Duration delay;

  /// Deslocamento inicial em fração da altura do próprio bloco.
  final double deslocamento;

  @override
  State<FadeSlideIn> createState() => _FadeSlideInState();
}

class _FadeSlideInState extends State<FadeSlideIn>
    with SingleTickerProviderStateMixin, AutomaticKeepAliveClientMixin {
  // Sem keep-alive o ListView descarta os blocos que saem da tela e a
  // animação recomeça do zero ao rolar de volta — o conteúdo pisca.
  @override
  bool get wantKeepAlive => true;

  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 460),
  );

  late final Animation<double> _fade = CurvedAnimation(
    parent: _c,
    curve: Curves.easeOut,
  );

  late final Animation<Offset> _slide = Tween<Offset>(
    begin: Offset(0, widget.deslocamento),
    end: Offset.zero,
  ).animate(CurvedAnimation(parent: _c, curve: Curves.easeOutCubic));

  @override
  void initState() {
    super.initState();
    if (widget.delay == Duration.zero) {
      _c.forward();
    } else {
      Future.delayed(widget.delay, () {
        if (mounted) _c.forward();
      });
    }
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    super.build(context); // exigido pelo AutomaticKeepAliveClientMixin
    return FadeTransition(
      opacity: _fade,
      child: SlideTransition(position: _slide, child: widget.child),
    );
  }
}

/// Escalona uma lista de blocos: cada um entra [passo] depois do anterior.
///
/// O atraso satura em [tetoMs] pra que listas longas não deixem o rodapé
/// aparecendo tarde demais — o usuário rola antes disso.
List<Widget> escalonar(
  List<Widget> blocos, {
  Duration passo = const Duration(milliseconds: 55),
  int tetoMs = 420,
}) {
  return [
    for (var i = 0; i < blocos.length; i++)
      FadeSlideIn(
        delay: Duration(
          milliseconds: (passo.inMilliseconds * i).clamp(0, tetoMs),
        ),
        child: blocos[i],
      ),
  ];
}
