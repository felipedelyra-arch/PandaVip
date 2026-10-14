import 'package:flutter/material.dart';
import '../theme/colors.dart';

/// Estado de carregamento centralizado (spinner laranja).
class LoadingView extends StatelessWidget {
  const LoadingView({super.key});

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: CircularProgressIndicator(color: PandaColors.laranja),
    );
  }
}

/// Estado vazio com ícone, mensagem e ação opcional.
class EmptyView extends StatelessWidget {
  const EmptyView({
    super.key,
    required this.mensagem,
    this.icone = Icons.inbox_outlined,
    this.acao,
  });

  final String mensagem;
  final IconData icone;
  final Widget? acao;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icone, size: 64, color: context.textoSec),
            const SizedBox(height: 16),
            Text(
              mensagem,
              textAlign: TextAlign.center,
              style: TextStyle(color: context.textoSec, fontSize: 16),
            ),
            if (acao != null) ...[const SizedBox(height: 24), acao!],
          ],
        ),
      ),
    );
  }
}

/// Estado de erro com botão de tentar de novo.
class ErrorView extends StatelessWidget {
  const ErrorView({super.key, required this.mensagem, this.onRetry});

  final String mensagem;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              Icons.error_outline,
              size: 64,
              color: PandaColors.vermelhoAcento,
            ),
            const SizedBox(height: 16),
            Text(
              mensagem,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 16),
            ),
            if (onRetry != null) ...[
              const SizedBox(height: 24),
              OutlinedButton(
                onPressed: onRetry,
                child: const Text('Tentar de novo'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Ponto laranja que abre os rótulos de seção — discreto, só marca o início.
class PontoMarca extends StatelessWidget {
  const PontoMarca({super.key});

  @override
  Widget build(BuildContext context) => Container(
    width: 6,
    height: 6,
    decoration: const BoxDecoration(
      color: PandaColors.laranja,
      shape: BoxShape.circle,
    ),
  );
}

/// Rótulo de seção (eyebrow) — maiúsculas espaçadas com ponto laranja.
class SectionLabel extends StatelessWidget {
  const SectionLabel(this.texto, {super.key});
  final String texto;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        const PontoMarca(),
        const SizedBox(width: 8),
        Text(
          texto.toUpperCase(),
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w700,
            letterSpacing: 1.4,
            color: context.textoSec,
          ),
        ),
      ],
    );
  }
}
