import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/app_prefs.dart';
import '../../core/demo.dart';
import '../../core/theme/colors.dart';
import '../../core/widgets/panda_logo.dart';

/// Tour inicial (primeira abertura). Mostra o que o PandaVip oferece e,
/// no último passo, oferece ativar as notificações. Visto só uma vez —
/// controlado por [onboardingSeenProvider] (shared_preferences).
class OnboardingScreen extends ConsumerStatefulWidget {
  const OnboardingScreen({super.key});

  @override
  ConsumerState<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends ConsumerState<OnboardingScreen> {
  final _controller = PageController();
  int _pagina = 0;

  static const _slides = [
    _Slide(
      icone: Icons.delivery_dining_rounded,
      titulo: 'Peça pelo app',
      texto:
          'Escolha no cardápio e receba em casa ou retire no balcão. Você acompanha cada etapa do pedido.',
    ),
    _Slide(
      icone: Icons.card_giftcard_rounded,
      titulo: 'Prêmios liberados pelo restaurante',
      texto:
          'O Tio Panda libera pratos e brindes com prazo. Resgate no app e mostre o código do prêmio no caixa.',
    ),
    _Slide(
      icone: Icons.notifications_active_rounded,
      titulo: 'Fique por dentro',
      texto: 'Receba promoções exclusivas e novidades do clube.',
      ehUltimo: true,
    ),
  ];

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _concluir({required bool comNotificacoes}) async {
    await ref
        .read(notificationsEnabledProvider.notifier)
        .definir(comNotificacoes);
    await ref.read(onboardingSeenProvider.notifier).concluir();
    if (!mounted) return;
    context.go(kDemo ? '/login' : '/home');
  }

  void _proximo() {
    if (_pagina < _slides.length - 1) {
      _controller.nextPage(
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeOut,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final ultimo = _pagina == _slides.length - 1;
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            // Pular (some no último passo).
            Align(
              alignment: Alignment.centerRight,
              child: AnimatedOpacity(
                opacity: ultimo ? 0 : 1,
                duration: const Duration(milliseconds: 200),
                child: TextButton(
                  onPressed: ultimo
                      ? null
                      : () => _concluir(comNotificacoes: true),
                  child: const Text('Pular'),
                ),
              ),
            ),
            Expanded(
              child: PageView.builder(
                controller: _controller,
                itemCount: _slides.length,
                onPageChanged: (i) => setState(() => _pagina = i),
                itemBuilder: (_, i) => _slides[i],
              ),
            ),
            _Indicadores(total: _slides.length, atual: _pagina),
            const SizedBox(height: 24),
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
              child: ultimo
                  ? Column(
                      children: [
                        ElevatedButton.icon(
                          onPressed: () => _concluir(comNotificacoes: true),
                          icon: const Icon(
                            Icons.notifications_active_rounded,
                            size: 20,
                          ),
                          label: const Text('Ativar notificações'),
                          style: ElevatedButton.styleFrom(
                            minimumSize: const Size.fromHeight(52),
                          ),
                        ),
                        const SizedBox(height: 8),
                        OutlinedButton(
                          onPressed: () => _concluir(comNotificacoes: false),
                          child: const Text('Agora não'),
                        ),
                      ],
                    )
                  : ElevatedButton(
                      onPressed: _proximo,
                      style: ElevatedButton.styleFrom(
                        minimumSize: const Size.fromHeight(52),
                      ),
                      child: const Text('Continuar'),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Slide extends StatelessWidget {
  const _Slide({
    required this.icone,
    required this.titulo,
    required this.texto,
    this.ehUltimo = false,
  });
  final IconData icone;
  final String titulo;
  final String texto;
  final bool ehUltimo;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 32),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          if (ehUltimo)
            const PandaLogo(size: 96, showWordmark: false)
          else
            Container(
              width: 130,
              height: 130,
              decoration: BoxDecoration(
                color: PandaColors.laranja,
                borderRadius: BorderRadius.circular(36),
              ),
              child: Icon(icone, size: 76, color: Colors.white),
            ),
          const SizedBox(height: 40),
          Text(
            titulo,
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.headlineMedium,
          ),
          const SizedBox(height: 14),
          Text(
            texto,
            textAlign: TextAlign.center,
            style: TextStyle(
              color: context.textoSec,
              fontSize: 15.5,
              height: 1.45,
            ),
          ),
        ],
      ),
    );
  }
}

class _Indicadores extends StatelessWidget {
  const _Indicadores({required this.total, required this.atual});
  final int total;
  final int atual;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        for (var i = 0; i < total; i++)
          AnimatedContainer(
            duration: const Duration(milliseconds: 250),
            margin: const EdgeInsets.symmetric(horizontal: 4),
            width: i == atual ? 24 : 8,
            height: 8,
            decoration: BoxDecoration(
              color: i == atual
                  ? PandaColors.laranja
                  : context.textoSec.withValues(alpha: 0.35),
              borderRadius: BorderRadius.circular(4),
            ),
          ),
      ],
    );
  }
}
