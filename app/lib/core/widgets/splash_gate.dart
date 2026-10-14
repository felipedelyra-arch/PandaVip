import 'package:flutter/material.dart';

import '../abertura.dart';
import '../theme/colors.dart';
import 'panda_logo.dart';

/// Continua a splash nativa dentro do Flutter e sai dela com animação.
///
/// A splash do Android some no primeiro frame do Flutter. Sem isto, o app
/// saltava do laranja direto pra tela de login — funcional, mas seco. Aqui a
/// logo cresce um tico e a camada se abre revelando a tela que o router já
/// montou por baixo.
///
/// Fica **por cima** de tudo em vez de ser uma rota: o router decide sozinho
/// entre onboarding, login e home enquanto a animação roda, e quando a camada
/// abre a tela certa já está pronta. Como rota, daria pra ver a tela errada
/// por um frame antes do redirect acontecer.
///
/// ## ⚠️ O tempo daqui é ORÇAMENTO, não duração fixa
///
/// Isto já foi `Duration(milliseconds: 1250)` cravado, e era o defeito: a
/// camada não cobria a abertura do app, ela **somava** 1,25s a tudo que veio
/// antes. E o que veio antes é justamente o que varia — engine do Flutter,
/// `Firebase.initializeApp`, leitura das preferências. Num aparelho bom o
/// sócio esperava ~1,8s; num fraco, ~3,5s, porque a parte fixa nunca descontava
/// a parte lenta. O celular ruim, onde a espera já dói, era o que esperava mais.
///
/// Agora a conta é ao contrário: **[_alvoTotal] é o teto de laranja na tela,
/// contado desde o começo do `main()`**. O que a abertura já gastou é
/// descontado. Aparelho rápido vê a animação inteira; aparelho lento vê só a
/// saída, porque ele já pagou o tempo de laranja lá atrás — em vez de pagar
/// duas vezes.
///
/// A logo também **não faz mais fade-in**. Ela entrava do zero, o que era
/// esquisito além de lento: a splash nativa acabara de mostrar a logo, e o
/// Flutter apagava pra acender de novo. Agora ela já nasce visível e só assenta
/// de escala, dando continuidade em vez de recomeço.
class SplashGate extends StatefulWidget {
  const SplashGate({super.key, required this.child});

  final Widget child;

  @override
  State<SplashGate> createState() => _SplashGateState();
}

class _SplashGateState extends State<SplashGate>
    with SingleTickerProviderStateMixin {
  /// Teto de laranja na tela, do começo do `main()` até a camada abrir.
  static const _alvoTotal = Duration(milliseconds: 1000);

  /// Piso da saída. Abaixo disto a camada sumiria num piscar, que lê como
  /// falha de renderização e não como transição.
  static const _saidaMinima = Duration(milliseconds: 240);

  /// Teto da saída, pra abertura instantânea não virar demora inventada.
  static const _saidaMaxima = Duration(milliseconds: 560);

  /// Quanto tempo a camada ainda deve ficar, descontado o que a abertura
  /// já gastou.
  static Duration get _duracao {
    final restante = _alvoTotal - tempoDeAbertura;
    if (restante < _saidaMinima) return _saidaMinima;
    if (restante > _saidaMaxima) return _saidaMaxima;
    return restante;
  }

  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: _duracao,
  );

  /// A abertura em si mora no último terço. O começo é só a logo assentando —
  /// e, quando o orçamento é curto, esse "último terço" já começa quase junto.
  static const _abertura = Interval(0.34, 1.0, curve: Curves.easeInOut);

  /// A logo **começa visível**, no tamanho quase certo, e assenta. Depois cresce
  /// junto com a abertura, dando a sensação de que a tela se abre a partir dela.
  late final Animation<double> _logoEscala = TweenSequence<double>([
    TweenSequenceItem(
      tween: Tween(
        begin: 0.94,
        end: 1.0,
      ).chain(CurveTween(curve: Curves.easeOut)),
      weight: 34,
    ),
    TweenSequenceItem(
      tween: Tween(
        begin: 1.0,
        end: 1.10,
      ).chain(CurveTween(curve: Curves.easeIn)),
      weight: 66,
    ),
  ]).animate(_c);

  /// Abertura da camada laranja.
  late final Animation<double> _camadaOpacidade = Tween<double>(
    begin: 1.0,
    end: 0.0,
  ).animate(CurvedAnimation(parent: _c, curve: _abertura));

  bool _pronto = false;
  bool _iniciado = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_iniciado) return;
    _iniciado = true;

    // Acessibilidade: com "reduzir animações" ligado no sistema, a camada
    // simplesmente sai. Animação de abertura é enfeite, não informação.
    if (MediaQuery.disableAnimationsOf(context)) {
      setState(() => _pronto = true);
      return;
    }

    _c.forward().whenComplete(() {
      if (mounted) setState(() => _pronto = true);
    });
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // Terminou: para de construir a camada e de pintar por cima do app.
    if (_pronto) return widget.child;

    return Stack(
      children: [
        widget.child,
        Positioned.fill(
          child: AnimatedBuilder(
            animation: _c,
            builder: (context, _) {
              // IgnorePointer: enquanto a camada abre ela já está
              // semitransparente, e sem isso um toque apressado do sócio
              // "atravessaria" pra tela de baixo sem ele ver o que apertou.
              return IgnorePointer(
                child: Opacity(
                  opacity: _camadaOpacidade.value,
                  child: ColoredBox(
                    // Exatamente o mesmo laranja de `panda_laranja` no
                    // colors.xml do Android. Qualquer diferença aqui vira uma
                    // emenda visível quando a splash nativa dá lugar a esta.
                    color: PandaColors.laranja,
                    child: Center(
                      child: Transform.scale(
                        scale: _logoEscala.value,
                        child: const PandaLogo(size: 132),
                      ),
                    ),
                  ),
                ),
              );
            },
          ),
        ),
      ],
    );
  }
}
