import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/models/models.dart';
import '../../core/services/chamada.dart';
import '../../core/services/services.dart';
import '../../core/theme/colors.dart';
import '../../core/theme/dimens.dart';
import '../../core/widgets/state_views.dart';

/// Meus pedidos: o que está acontecendo agora, e o histórico embaixo.
///
/// O status vem do painel (a cozinha muda), não do PDV — enquanto a Starway
/// não devolver evento, "Saiu para entrega" é alguém clicando lá.
class PedidosScreen extends ConsumerWidget {
  const PedidosScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final pedidos = ref.watch(pedidosProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Meus pedidos'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          tooltip: 'Voltar',
          onPressed: () =>
              context.canPop() ? context.pop() : context.go('/home'),
        ),
      ),
      body: SafeArea(
        child: pedidos.when(
          loading: () => const LoadingView(),
          error: (e, _) => ErrorView(
            mensagem: 'Não foi possível carregar seus pedidos.',
            onRetry: () => ref.invalidate(pedidosProvider),
          ),
          data: (lista) {
            if (lista.isEmpty) {
              return EmptyView(
                mensagem: 'Você ainda não fez nenhum pedido.',
                icone: Icons.receipt_long_outlined,
                acao: FilledButton(
                  onPressed: () => context.go('/cardapio'),
                  child: const Text('Ver o cardápio'),
                ),
              );
            }
            final ativos = lista.where((p) => p.emAndamento).toList();
            final historico = lista.where((p) => !p.emAndamento).toList();
            // Agrupa o histórico por mês, na ordem em que já vem (mais novo
            // primeiro). Pedido sem data cai num grupo próprio no fim.
            final porMes = <String, List<Pedido>>{};
            for (final p in historico) {
              final chave = p.criadoEm == null
                  ? 'Sem data'
                  : toBeginningOfSentenceCase(
                      DateFormat('MMMM yyyy', 'pt_BR').format(p.criadoEm!),
                    );
              porMes.putIfAbsent(chave, () => []).add(p);
            }

            return ListView(
              padding: const EdgeInsets.fromLTRB(24, 16, 24, 32),
              children: [
                if (ativos.isNotEmpty) ...[
                  const SectionLabel('Em andamento'),
                  const SizedBox(height: 12),
                  for (final p in ativos) ...[
                    _PedidoCard(pedido: p),
                    const SizedBox(height: 12),
                  ],
                  const SizedBox(height: 16),
                ],
                for (final mes in porMes.entries) ...[
                  SectionLabel(mes.key),
                  const SizedBox(height: 8),
                  _GrupoHistorico(pedidos: mes.value),
                  const SizedBox(height: 24),
                ],
              ],
            );
          },
        ),
      ),
    );
  }
}

/// Pedidos encerrados de um mês, num cartão só com uma linha por pedido.
/// O registro continua inteiro: tocar abre o detalhe (itens, observação).
class _GrupoHistorico extends StatelessWidget {
  const _GrupoHistorico({required this.pedidos});
  final List<Pedido> pedidos;

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final linha = isDark ? PandaColors.hairlineDark : PandaColors.hairline;
    return Container(
      decoration: BoxDecoration(
        color: isDark ? PandaColors.cardDark : PandaColors.branco,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: linha),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          for (var i = 0; i < pedidos.length; i++) ...[
            if (i > 0) Divider(height: 1, thickness: 1, color: linha),
            _PedidoLinha(pedido: pedidos[i]),
          ],
        ],
      ),
    );
  }
}

class _PedidoLinha extends StatelessWidget {
  const _PedidoLinha({required this.pedido});
  final Pedido pedido;

  @override
  Widget build(BuildContext context) {
    final cancelado = pedido.status == 'cancelado';
    final quando = pedido.criadoEm;
    final qtdItens = pedido.itens.fold<int>(0, (s, i) => s + i.qtd);
    return InkWell(
      onTap: () => showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        showDragHandle: true,
        builder: (_) => SafeArea(
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
            child: _PedidoCard(pedido: pedido),
          ),
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        child: Row(
          children: [
            Icon(
              pedido.tipo == 'retirada'
                  ? Icons.storefront_outlined
                  : Icons.delivery_dining_outlined,
              size: 22,
              color: context.textoSec,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    quando == null
                        ? 'Pedido'
                        : DateFormat(
                            "d 'de' MMM, HH:mm",
                            'pt_BR',
                          ).format(quando),
                    style: const TextStyle(
                      fontWeight: FontWeight.w600,
                      fontSize: 14.5,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    '$qtdItens ${qtdItens == 1 ? 'item' : 'itens'} · '
                    '${pedido.statusTexto}',
                    style: TextStyle(
                      fontSize: 13,
                      color: cancelado
                          ? context.vermelhoTexto
                          : context.textoSec,
                    ),
                  ),
                ],
              ),
            ),
            Text(
              pedido.totalFormatado,
              style: TextStyle(
                fontWeight: FontWeight.w700,
                fontSize: 14.5,
                color: cancelado ? context.textoSec : null,
                decoration: cancelado ? TextDecoration.lineThrough : null,
              ),
            ),
            const SizedBox(width: 4),
            Icon(Icons.chevron_right_rounded, color: context.textoSec),
          ],
        ),
      ),
    );
  }
}

class _PedidoCard extends StatelessWidget {
  const _PedidoCard({required this.pedido});
  final Pedido pedido;

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final quando = pedido.criadoEm;
    return Container(
      decoration: BoxDecoration(
        color: isDark ? PandaColors.cardDark : PandaColors.branco,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: pedido.emAndamento
              ? PandaColors.laranja
              : (isDark ? PandaColors.hairlineDark : PandaColors.hairline),
        ),
      ),
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                pedido.tipo == 'retirada'
                    ? Icons.storefront_outlined
                    : Icons.delivery_dining_outlined,
                size: 20,
                color: pedido.emAndamento
                    ? PandaColors.laranja
                    : context.textoSec,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  pedido.statusTexto,
                  style: TextStyle(
                    fontWeight: FontWeight.w700,
                    fontSize: 15,
                    color: pedido.status == 'cancelado'
                        ? context.vermelhoTexto
                        : null,
                  ),
                ),
              ),
              Text(
                pedido.totalFormatado,
                style: TextStyle(
                  fontWeight: FontWeight.w800,
                  color: context.laranjaTexto,
                ),
              ),
            ],
          ),
          if (quando != null) ...[
            const SizedBox(height: 4),
            Text(
              DateFormat("d 'de' MMMM, HH:mm", 'pt_BR').format(quando),
              style: TextStyle(color: context.textoSec, fontSize: 13),
            ),
          ],
          if (pedido.lojaNome.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(
              'Retirar em: ${pedido.lojaNome}',
              style: TextStyle(color: context.textoSec, fontSize: 13),
            ),
          ],
          if (pedido.emAndamento) ...[
            const SizedBox(height: 14),
            EtapasPedido(pedido: pedido),
            if (pedido.codigoEntrega.isNotEmpty) ...[
              const SizedBox(height: 12),
              Text(
                pedido.tipo == 'retirada'
                    ? 'Código para retirar: ${pedido.codigoEntrega}'
                    : 'Código de entrega: ${pedido.codigoEntrega}',
                style: TextStyle(
                  fontWeight: FontWeight.w800,
                  fontSize: 15,
                  color: context.laranjaTexto,
                ),
              ),
              Text(
                'Diga este número ao receber o pedido.',
                style: TextStyle(color: context.textoSec, fontSize: 13),
              ),
            ],
          ],
          const SizedBox(height: 10),
          for (final item in pedido.itens)
            Padding(
              padding: const EdgeInsets.only(bottom: 2),
              child: Text(
                '${item.qtd}x ${item.nome}',
                style: const TextStyle(fontSize: 13.5, height: 1.35),
              ),
            ),
          if (pedido.observacao.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(
              'Obs.: ${pedido.observacao}',
              style: TextStyle(
                color: context.textoSec,
                fontSize: 13,
                fontStyle: FontStyle.italic,
              ),
            ),
          ],
          // Só antes do restaurante aceitar; depois disso o servidor recusa.
          if (pedido.status == 'novo' && !pedido.noPdv)
            _CancelarPedido(pedidoId: pedido.id),
        ],
      ),
    );
  }
}

class _CancelarPedido extends ConsumerStatefulWidget {
  const _CancelarPedido({required this.pedidoId});
  final String pedidoId;

  @override
  ConsumerState<_CancelarPedido> createState() => _CancelarPedidoState();
}

class _CancelarPedidoState extends ConsumerState<_CancelarPedido> {
  bool _enviando = false;

  Future<void> _cancelar() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctxDialogo) => AlertDialog(
        title: const Text('Cancelar pedido?'),
        content: const Text(
          'O restaurante ainda não aceitou o pedido, então nada será cobrado.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctxDialogo, false),
            child: const Text('Voltar'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctxDialogo, true),
            style: TextButton.styleFrom(
              foregroundColor: ctxDialogo.vermelhoTexto,
            ),
            child: const Text('Cancelar pedido'),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    setState(() => _enviando = true);
    final mensageiro = ScaffoldMessenger.of(context);
    try {
      // Repetir é seguro: cancelar o que já está cancelado não muda nada.
      await Chamada.chamar(
        ref.read(functionsProvider),
        'cancelarPedido',
        dados: {'pedidoId': widget.pedidoId},
        repetir: true,
      );
      mensageiro.showSnackBar(
        const SnackBar(content: Text('Pedido cancelado.')),
      );
    } catch (e) {
      mensageiro.showSnackBar(
        SnackBar(
          content: Text(
            mensagemDeErro(e, acaoFalhou: 'O pedido não foi cancelado'),
          ),
        ),
      );
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: SizedBox(
        width: double.infinity,
        child: OutlinedButton(
          onPressed: _enviando ? null : _cancelar,
          style: OutlinedButton.styleFrom(
            foregroundColor: context.vermelhoTexto,
            side: BorderSide(color: context.vermelhoTexto),
          ),
          child: _enviando
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Text('Cancelar pedido'),
        ),
      ),
    );
  }
}

/// Barra de etapas do pedido: quatro traços que acendem conforme a cozinha
/// avança, com o nome da etapa embaixo. A etapa atual tem um brilho correndo
/// por dentro — diz "está acontecendo agora" sem precisar ler.
class EtapasPedido extends StatefulWidget {
  const EtapasPedido({super.key, required this.pedido});
  final Pedido pedido;

  @override
  State<EtapasPedido> createState() => _EtapasPedidoState();
}

class _EtapasPedidoState extends State<EtapasPedido>
    with SingleTickerProviderStateMixin {
  late final _brilho = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1600),
  );

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Quem pediu menos movimento no sistema vê a barra parada.
    if (MediaQuery.of(context).disableAnimations) {
      _brilho.stop();
    } else if (!_brilho.isAnimating) {
      _brilho.repeat();
    }
  }

  @override
  void dispose() {
    _brilho.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final pedido = widget.pedido;
    final retirada = pedido.tipo == 'retirada';
    final etapas = [
      'Enviado',
      'Aceito',
      'Preparando',
      retirada ? 'Pronto' : 'A caminho',
    ];
    final atual = const [
      'novo',
      'aceito',
      'preparando',
      'saiu',
    ].indexOf(pedido.status);
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final apagado = isDark ? PandaColors.hairlineDark : PandaColors.hairline;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (var i = 0; i < etapas.length; i++) ...[
          if (i > 0) const SizedBox(width: 6),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(3),
                  // Largura explícita: o brilho é um DecoratedBox, que sem
                  // filho encolhe pra 0 e sumia com a etapa atual.
                  child: SizedBox(
                    height: 6,
                    width: double.infinity,
                    child: i != atual
                        ? AnimatedContainer(
                            duration: const Duration(milliseconds: 400),
                            color: i < atual ? PandaColors.laranja : apagado,
                          )
                        : AnimatedBuilder(
                            animation: _brilho,
                            builder: (_, _) {
                              final v = _brilho.value * 1.6 - 0.3;
                              return DecoratedBox(
                                decoration: BoxDecoration(
                                  gradient: LinearGradient(
                                    colors: [
                                      PandaColors.laranja,
                                      PandaColors.laranja.withValues(
                                        alpha: 0.35,
                                      ),
                                      PandaColors.laranja,
                                    ],
                                    stops: [
                                      (v - 0.3).clamp(0.0, 1.0),
                                      v.clamp(0.0, 1.0),
                                      (v + 0.3).clamp(0.0, 1.0),
                                    ],
                                  ),
                                ),
                              );
                            },
                          ),
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  etapas[i],
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: i == atual ? FontWeight.w700 : FontWeight.w500,
                    color: i <= atual ? null : context.textoSec,
                  ),
                ),
              ],
            ),
          ),
        ],
      ],
    );
  }
}

/// Ícone do pedido em andamento: um halo pulsa atrás e o ícone balança de
/// leve, como a moto andando. Parado quando o sistema pede menos movimento.
class IconePedidoAnimado extends StatefulWidget {
  const IconePedidoAnimado({super.key, required this.icone});
  final IconData icone;

  @override
  State<IconePedidoAnimado> createState() => _IconePedidoAnimadoState();
}

class _IconePedidoAnimadoState extends State<IconePedidoAnimado>
    with SingleTickerProviderStateMixin {
  late final _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1400),
  );

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (MediaQuery.of(context).disableAnimations) {
      _c.stop();
    } else if (!_c.isAnimating) {
      _c.repeat();
    }
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 52,
      height: 52,
      child: AnimatedBuilder(
        animation: _c,
        builder: (_, child) {
          final t = _c.value;
          // Balanço: vai e volta 3 px, duas vezes por ciclo.
          final dx = 3 * (t < 0.5 ? (t * 4 - 1) : (3 - t * 4));
          return Stack(
            alignment: Alignment.center,
            children: [
              // Halo que cresce e some.
              Transform.scale(
                scale: 0.85 + 0.35 * t,
                child: Container(
                  decoration: BoxDecoration(
                    color: PandaColors.laranja.withValues(
                      alpha: 0.28 * (1 - t),
                    ),
                    borderRadius: PandaRadius.bsm,
                  ),
                ),
              ),
              Container(
                decoration: const BoxDecoration(
                  color: PandaColors.laranja,
                  borderRadius: PandaRadius.bsm,
                ),
              ),
              Transform.translate(offset: Offset(dx, 0), child: child),
            ],
          );
        },
        child: Icon(widget.icone, color: Colors.white, size: 28),
      ),
    );
  }
}
