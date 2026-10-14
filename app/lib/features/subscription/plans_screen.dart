import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/services/services.dart';
import '../../core/services/chamada.dart';
import '../../core/services/fila_pendentes.dart';
import '../../core/demo.dart';
import '../../core/theme/colors.dart';
import '../../core/theme/dimens.dart';
import '../../core/widgets/state_views.dart';
import '../../core/widgets/entrada.dart';
import '../../core/widgets/skeleton.dart';
import '../../core/models/models.dart';
import 'pagamento_screen.dart';

final _moeda = NumberFormat.currency(locale: 'pt_BR', symbol: 'R\$');

class PlansScreen extends ConsumerWidget {
  const PlansScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final plans = ref.watch(plansProvider);
    final sub = ref.watch(subscriptionProvider);

    return Scaffold(
      body: SafeArea(
        child: sub.value != null
            ? _AssinaturaAtiva(sub: sub.value!)
            : plans.when(
                loading: () => const SkeletonList(itens: 2),
                error: (e, _) => ErrorView(
                  mensagem: 'Não foi possível carregar os planos.',
                  onRetry: () => ref.invalidate(plansProvider),
                ),
                data: (list) {
                  return ListView(
                    padding: const EdgeInsets.fromLTRB(24, 16, 24, 32),
                    children: escalonar([
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Seja sócio',
                            style: Theme.of(context).textTheme.headlineMedium,
                          ),
                          const SizedBox(height: 6),
                          Text(
                            'Sem fidelidade. Cancele quando quiser.',
                            style: TextStyle(
                              color: context.textoSec,
                              fontSize: 15,
                              height: 1.4,
                            ),
                          ),
                        ],
                      ),
                      if (list.isEmpty)
                        const Padding(
                          padding: EdgeInsets.only(top: 28),
                          child: EmptyView(
                            mensagem: 'Nenhum plano disponível.',
                            icone: Icons.workspace_premium_outlined,
                          ),
                        )
                      else
                        for (final p in list)
                          Padding(
                            padding: const EdgeInsets.only(top: 28),
                            child: _PlanCard(plan: p),
                          ),
                    ]),
                  );
                },
              ),
      ),
    );
  }
}

class _PlanCard extends ConsumerStatefulWidget {
  const _PlanCard({required this.plan});
  final Plan plan;

  @override
  ConsumerState<_PlanCard> createState() => _PlanCardState();
}

class _PlanCardState extends ConsumerState<_PlanCard> {
  bool _loading = false;

  Future<void> _assinar() async {
    // No demo o checkout roda inteiro: simula o processamento, ativa a
    // assinatura e abre a tela de boas-vindas. É o momento-chave da
    // apresentação — não pode terminar num aviso de "desativado".
    if (kDemo) {
      setState(() => _loading = true);
      await Future<void>.delayed(const Duration(milliseconds: 1400));
      if (!mounted) return;
      HapticFeedback.mediumImpact();
      ref.read(demoIsSubscriber.notifier).state = true;
      setState(() => _loading = false);
      await showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (_) => _BoasVindasSocio(plano: widget.plan),
      );
      return;
    }
    // Pagamento dentro do app (Pix ou cartão). A tela fecha com `true`
    // quando a assinatura fica ativa.
    final pagou = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => PagamentoScreen(plano: widget.plan)),
    );
    if (pagou != true || !mounted) return;
    // Cartão aceito mas ainda `pending`: sem boas-vindas até a 1ª cobrança.
    if (ref.read(subscriptionProvider).value?.ativa != true) return;
    HapticFeedback.mediumImpact();
    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (_) => _BoasVindasSocio(plano: widget.plan),
    );
  }

  @override
  Widget build(BuildContext context) {
    final p = widget.plan;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final destaque = p.recomendado;
    final bloqueio = kDemo
        ? null
        : bloqueioDePagamento(ref.watch(currentUserProvider).value);

    return Container(
      decoration: BoxDecoration(
        color: isDark ? PandaColors.cardDark : PandaColors.branco,
        borderRadius: PandaRadius.blg,
        border: Border.all(
          color: destaque
              ? PandaColors.laranja
              : (isDark ? PandaColors.hairlineDark : PandaColors.hairline),
          width: destaque ? 1.6 : 1,
        ),
      ),
      padding: const EdgeInsets.all(22),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (destaque) ...[
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(
                color: PandaColors.laranja,
                borderRadius: PandaRadius.bxs,
              ),
              child: const Text(
                'PLANO ÚNICO',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 12,
                  letterSpacing: 1,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            const SizedBox(height: 14),
          ],
          Text(
            p.nome,
            style: Theme.of(
              context,
            ).textTheme.titleLarge?.copyWith(height: 1.25),
          ),
          const SizedBox(height: 12),
          // Preço e período em baseline, com folga explícita — antes o
          // espaçamento vinha de espaços dentro da string e colava.
          Wrap(
            crossAxisAlignment: WrapCrossAlignment.end,
            spacing: 8,
            children: [
              Text(
                _moeda.format(p.preco),
                style: Theme.of(context).textTheme.displaySmall?.copyWith(
                  fontWeight: FontWeight.w700,
                  color: PandaColors.laranja,
                  height: 1.05,
                ),
              ),
              Padding(
                padding: const EdgeInsets.only(bottom: 5),
                child: Text(
                  '/ ${p.intervaloCurto}',
                  style: TextStyle(
                    color: context.textoSec,
                    fontSize: 14,
                    height: 1.2,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            'Menos de ${_moeda.format(((p.preco / (30 * p.meses)) * 100 + 1e-9).floor() / 100 + 0.01)} por dia',
            style: TextStyle(
              color: context.textoSec.withValues(alpha: 0.9),
              fontSize: 13,
              height: 1.3,
            ),
          ),
          const SizedBox(height: 22),
          for (final b in p.beneficios)
            Padding(
              padding: const EdgeInsets.only(bottom: 13),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Padding(
                    padding: EdgeInsets.only(top: 2),
                    child: Icon(
                      Icons.check_circle,
                      color: context.verdeTexto,
                      size: 19,
                    ),
                  ),
                  const SizedBox(width: 11),
                  Expanded(
                    child: Text(
                      b,
                      style: const TextStyle(height: 1.4, fontSize: 14.5),
                    ),
                  ),
                ],
              ),
            ),
          const SizedBox(height: 12),
          if (bloqueio != null)
            Text(
              bloqueio,
              style: TextStyle(color: context.textoSec, height: 1.4),
            )
          else
            destaque
                ? ElevatedButton(
                    onPressed: _loading ? null : _assinar,
                    child: _loading
                        ? const _BtnSpinner()
                        : const Text('Assinar agora'),
                  )
                : OutlinedButton(
                    onPressed: _loading ? null : _assinar,
                    child: _loading
                        ? const _BtnSpinner()
                        : const Text('Assinar'),
                  ),
        ],
      ),
    );
  }
}

/// Boas-vindas depois de assinar. Selo cresce, texto entra em seguida —
/// fecha o fluxo com uma sensação de conquista em vez de um snackbar.
class _BoasVindasSocio extends StatefulWidget {
  const _BoasVindasSocio({required this.plano});
  final Plan plano;

  @override
  State<_BoasVindasSocio> createState() => _BoasVindasSocioState();
}

class _BoasVindasSocioState extends State<_BoasVindasSocio>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 700),
  )..forward();

  late final Animation<double> _selo = CurvedAnimation(
    parent: _c,
    curve: const Interval(0, 0.6, curve: Curves.elasticOut),
  );

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Dialog(
      insetPadding: const EdgeInsets.all(24),
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      shape: RoundedRectangleBorder(borderRadius: PandaRadius.blg),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(28, 34, 28, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ScaleTransition(
              scale: _selo,
              child: Container(
                width: 88,
                height: 88,
                decoration: const BoxDecoration(
                  gradient: LinearGradient(
                    colors: [PandaColors.laranja, PandaColors.laranjaEscuro],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.check_rounded,
                  color: Colors.white,
                  size: 48,
                ),
              ),
            ),
            const SizedBox(height: 22),
            FadeSlideIn(
              delay: const Duration(milliseconds: 260),
              child: Column(
                children: [
                  Text(
                    'Boas-vindas ao Clube',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.headlineSmall,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Sua assinatura está ativa. Os prêmios já estão liberados.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: context.textoSec,
                      height: 1.4,
                      fontSize: 14.5,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 22),
            FadeSlideIn(
              delay: const Duration(milliseconds: 400),
              child: Container(
                width: double.infinity,
                padding: const EdgeInsets.all(18),
                decoration: BoxDecoration(
                  color: isDark ? PandaColors.cardDark : PandaColors.cinzaClaro,
                  borderRadius: PandaRadius.bmd,
                  border: Border.all(
                    color: isDark
                        ? PandaColors.hairlineDark
                        : PandaColors.hairline,
                  ),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    for (final b in widget.plano.beneficios.take(3))
                      Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Padding(
                              padding: EdgeInsets.only(top: 2),
                              child: Icon(
                                Icons.check_circle,
                                color: context.verdeTexto,
                                size: 17,
                              ),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                b,
                                style: const TextStyle(
                                  fontSize: 13.5,
                                  height: 1.35,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 22),
            ElevatedButton(
              onPressed: () {
                Navigator.pop(context);
                context.go('/premiacoes');
              },
              child: const Text('Ver meus prêmios'),
            ),
            const SizedBox(height: 8),
            OutlinedButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Depois'),
            ),
          ],
        ),
      ),
    );
  }
}

class _BtnSpinner extends StatelessWidget {
  const _BtnSpinner();
  @override
  Widget build(BuildContext context) => const SizedBox(
    height: 22,
    width: 22,
    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
  );
}

class _AssinaturaAtiva extends ConsumerWidget {
  const _AssinaturaAtiva({required this.sub});
  final Subscription sub;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final plans = ref.watch(plansProvider).value ?? const [];
    Plan? plano;
    for (final p in plans) {
      if (p.id == sub.planId) plano = p;
    }
    final metodo = sub.formaPagamento == 'pix' ? 'Pix' : 'Cartão de crédito';
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final hairline = isDark ? PandaColors.hairlineDark : PandaColors.hairline;

    return ListView(
      padding: const EdgeInsets.fromLTRB(24, 16, 24, 32),
      children: [
        Text(
          'Sua assinatura',
          style: Theme.of(context).textTheme.headlineMedium,
        ),
        const SizedBox(height: 20),
        // Cartão recusado: o sócio precisa saber por que os benefícios
        // sumiram, e que o cancelamento continua na mão dele.
        if (sub.pendente || sub.aguardando) ...[
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: context.laranjaFundo,
              borderRadius: PandaRadius.bmd,
            ),
            child: Text(
              sub.aguardando
                  ? 'Aguardando a primeira cobrança. Os benefícios são '
                        'liberados assim que o Mercado Pago aprovar o pagamento.'
                  : 'A última cobrança não foi aprovada, e os benefícios estão '
                        'suspensos. O Mercado Pago fará novas tentativas nos próximos '
                        'dias. Se você trocou de cartão, cancele aqui e assine novamente.',
              style: TextStyle(
                color: context.laranjaTexto,
                fontSize: 13.5,
                height: 1.4,
              ),
            ),
          ),
          const SizedBox(height: 20),
        ],
        // Card principal do plano — mesma superfície dos outros cards do app
        // (creme claro / carvão no escuro), com a borda laranja marcando que
        // está ativo. Antes era um bloco creme fixo que virava mancha branca
        // no tema escuro.
        Container(
          padding: const EdgeInsets.all(22),
          decoration: BoxDecoration(
            color: isDark ? PandaColors.cardDark : PandaColors.branco,
            borderRadius: PandaRadius.blg,
            border: Border.all(color: PandaColors.laranja, width: 1.6),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Text(
                      plano != null ? 'Plano ${plano.nome}' : 'Plano ativo',
                      style: Theme.of(
                        context,
                      ).textTheme.titleLarge?.copyWith(height: 1.25),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 4,
                    ),
                    decoration: BoxDecoration(
                      color: sub.pendente || sub.aguardando
                          ? PandaColors.vermelhoAcento
                          : PandaColors.verdeSucesso,
                      borderRadius: PandaRadius.bxs,
                    ),
                    child: Text(
                      sub.aguardando
                          ? 'AGUARDANDO COBRANÇA'
                          : sub.pendente
                          ? 'PAGAMENTO PENDENTE'
                          : 'ATIVO',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 12,
                        letterSpacing: 0.8,
                        height: 1.25,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ],
              ),
              if (plano != null) ...[
                const SizedBox(height: 12),
                Wrap(
                  crossAxisAlignment: WrapCrossAlignment.end,
                  spacing: 8,
                  children: [
                    Text(
                      _moeda.format(plano.preco),
                      style: Theme.of(context).textTheme.displaySmall?.copyWith(
                        fontWeight: FontWeight.w700,
                        color: PandaColors.laranja,
                        height: 1.05,
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.only(bottom: 5),
                      child: Text(
                        '/ ${plano.intervaloCurto}',
                        style: TextStyle(
                          color: context.textoSec,
                          fontSize: 14,
                          height: 1.2,
                        ),
                      ),
                    ),
                  ],
                ),
              ],
              const SizedBox(height: 20),
              Container(height: 1, color: hairline),
              const SizedBox(height: 18),
              if (sub.ativaAte != null) ...[
                _linhaInfo(
                  context,
                  Icons.event_outlined,
                  'Ativa até',
                  DateFormat(
                    "dd 'de' MMMM 'de' y",
                    'pt_BR',
                  ).format(sub.ativaAte!),
                ),
                const SizedBox(height: 14),
              ],
              if (sub.proximaCobranca != null) ...[
                _linhaInfo(
                  context,
                  Icons.event_outlined,
                  'Próxima cobrança',
                  DateFormat(
                    "dd 'de' MMMM",
                    'pt_BR',
                  ).format(sub.proximaCobranca!),
                ),
                const SizedBox(height: 14),
              ],
              _linhaInfo(
                context,
                Icons.credit_card_outlined,
                'Pagamento',
                metodo,
              ),
            ],
          ),
        ),
        if (!sub.aguardando &&
            plano != null &&
            plano.beneficios.isNotEmpty) ...[
          const SizedBox(height: 28),
          const SectionLabel('Seus benefícios'),
          const SizedBox(height: 14),
          for (final b in plano.beneficios)
            Padding(
              padding: const EdgeInsets.only(bottom: 13),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Padding(
                    padding: EdgeInsets.only(top: 2),
                    child: Icon(
                      Icons.check_circle,
                      color: context.verdeTexto,
                      size: 19,
                    ),
                  ),
                  const SizedBox(width: 11),
                  Expanded(
                    child: Text(
                      b,
                      style: const TextStyle(height: 1.4, fontSize: 14.5),
                    ),
                  ),
                ],
              ),
            ),
        ],
        const SizedBox(height: 24),
        const SectionLabel('Gerenciar'),
        const SizedBox(height: 12),
        // Pix não renova sozinho: renovar antes de vencer soma o período.
        if (sub.pix && plano != null) ...[
          ElevatedButton.icon(
            onPressed: () => Navigator.of(context).push<bool>(
              MaterialPageRoute(
                builder: (_) => PagamentoScreen(plano: plano!, soPix: true),
              ),
            ),
            icon: const Icon(Icons.pix),
            label: const Text('Renovar com Pix'),
          ),
          const SizedBox(height: 12),
        ],
        // Direito de arrependimento (CDC art. 49): 7 dias, reembolso integral.
        if (sub.podeDesistir) ...[
          OutlinedButton(
            onPressed: () => _desistir(context, ref),
            child: const Text('Desistir e receber o valor de volta'),
          ),
          const SizedBox(height: 12),
        ],
        if (sub.cancelada)
          Text(
            'Assinatura cancelada. Não haverá novas cobranças, e os benefícios '
            'seguem até o fim do período já pago.',
            style: TextStyle(
              height: 1.4,
              fontSize: 14,
              color: context.vermelhoTexto,
            ),
          ),
        // Pix não renova sozinho, então não há o que cancelar: ele só vence.
        if (!sub.pix && !sub.cancelada)
          OutlinedButton(
            onPressed: () => _confirmarCancelamento(context, ref),
            style: OutlinedButton.styleFrom(
              foregroundColor: context.vermelhoTexto,
              side: BorderSide(color: context.vermelhoTexto),
            ),
            child: const Text('Cancelar assinatura'),
          ),
      ],
    );
  }

  /// Label em cima, valor embaixo. Lado a lado, "Próxima cobrança / 18 de
  /// agosto" quebrava em duas linhas torta quando a letra está em Grande.
  Widget _linhaInfo(
    BuildContext context,
    IconData icone,
    String label,
    String valor,
  ) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(top: 2),
          child: Icon(icone, size: 18, color: PandaColors.laranja),
        ),
        const SizedBox(width: 11),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label.toUpperCase(),
                style: TextStyle(
                  color: context.textoSec,
                  fontSize: 12,
                  letterSpacing: 1,
                  height: 1.3,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 3),
              Text(
                valor,
                style: TextStyle(
                  fontWeight: FontWeight.w600,
                  fontSize: 14.5,
                  height: 1.3,
                  // Cor do tema — antes era preto fixo e sumia no escuro.
                  color: isDark ? PandaColors.branco : PandaColors.preto,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  /// Frase do diálogo: até quando os benefícios continuam depois de cancelar.
  String _fimDoPeriodo(WidgetRef ref) {
    // Mesma regra do servidor (cancelSubscription): só quem está em dia tem
    // período pago a honrar; cobrança recusada encerra na hora.
    final sub = ref.read(subscriptionProvider).value;
    final fim = sub?.proximaCobranca;
    if (sub == null ||
        !sub.ativa ||
        fim == null ||
        !fim.isAfter(DateTime.now())) {
      return 'Os benefícios do Clube serão encerrados agora.';
    }
    return 'Seus benefícios continuam até o fim do período já pago.';
  }

  Future<void> _desistir(BuildContext context, WidgetRef ref) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctxDialogo) => AlertDialog(
        title: const Text('Desistir da assinatura?'),
        content: const Text(
          'Você recebe o valor pago de volta, pelo mesmo meio de pagamento, e '
          'os benefícios do Clube terminam agora.',
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
            child: const Text('Desistir e reembolsar'),
          ),
        ],
      ),
    );
    if (ok != true || !context.mounted) return;
    if (kDemo) {
      ref.read(demoIsSubscriber.notifier).state = false;
      return;
    }
    final nav = Navigator.of(context, rootNavigator: true);
    final messenger = ScaffoldMessenger.of(context);
    final functions = ref.read(functionsProvider);
    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (_) => const PopScope(
        canPop: false,
        child: Center(
          child: CircularProgressIndicator(color: PandaColors.laranja),
        ),
      ),
    );
    try {
      // Sem repetir: reembolso não é fila offline; se falhar, o sócio vê e tenta.
      await Chamada.chamar(functions, 'desistirAssinatura');
      messenger.showSnackBar(
        const SnackBar(
          duration: Duration(seconds: 6),
          content: Text(
            'Assinatura cancelada e valor reembolsado. O estorno aparece na '
            'sua fatura ou conta em alguns dias.',
          ),
        ),
      );
    } catch (e) {
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            mensagemDeErro(e, acaoFalhou: 'A desistência não foi concluída'),
          ),
        ),
      );
    } finally {
      nav.pop();
    }
  }

  Future<void> _confirmarCancelamento(
    BuildContext context,
    WidgetRef ref,
  ) async {
    final ok = await showDialog<bool>(
      context: context,
      // Usa o context do próprio diálogo: com o context de fora, o pop
      // atinge o Navigator do GoRouter e derruba a página inteira.
      builder: (ctxDialogo) => AlertDialog(
        title: const Text('Cancelar assinatura?'),
        content: Text('Não haverá novas cobranças. ${_fimDoPeriodo(ref)}'),
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
            child: const Text('Cancelar assinatura'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    // No demo o cancelamento também vale: volta pra visitante e libera
    // demonstrar o fluxo de assinatura do começo, ao vivo.
    if (kDemo) {
      ref.read(demoIsSubscriber.notifier).state = false;
      if (context.mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('Assinatura cancelada.')));
      }
      return;
    }
    // Feedback imediato: a chamada demora e, sem isso, o toque parecia não
    // ter feito nada (e o sócio tocava de novo).
    if (!context.mounted) return;
    final nav = Navigator.of(context, rootNavigator: true);
    final fila = ref.read(filaPendentesProvider.notifier);
    final functions = ref.read(functionsProvider);
    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (_) => const PopScope(
        canPop: false,
        child: Center(
          child: CircularProgressIndicator(color: PandaColors.laranja),
        ),
      ),
    );
    try {
      // Cancelar é idempotente por natureza: a função marca a assinatura para
      // terminar no fim do período, e repetir isso dá o mesmo estado. Vale
      // insistir, porque desistir calado deixaria o sócio achando que cancelou
      // quando não cancelou — e ele só descobriria na próxima fatura.
      await Chamada.chamar(functions, 'cancelSubscription', repetir: true);
      if (context.mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('Assinatura cancelada.')));
      }
    } catch (e) {
      // Não deu agora: entra na fila em disco e sai sozinho quando a rede
      // voltar. É o caso onde perder a ação custa dinheiro de verdade — o
      // sócio fecha o app achando que cancelou e é cobrado de novo no mês
      // seguinte.
      await fila.enfileirar('cancelSubscription');
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            duration: Duration(seconds: 6),
            content: Text(
              'Sem conexão no momento. O cancelamento foi registrado e será '
              'concluído quando a internet voltar. Não é preciso repetir.',
            ),
          ),
        );
      }
    } finally {
      nav.pop();
    }
  }
}
