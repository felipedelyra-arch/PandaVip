import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/analytics.dart';
import '../../core/restaurante.dart';
import '../../core/services/chamada.dart';
import '../../core/models/models.dart';
import '../../core/services/services.dart';
import '../../core/theme/colors.dart';
import '../../core/theme/dimens.dart';
import '../../core/widgets/state_views.dart';
import 'carrinho.dart';
import 'endereco.dart';

/// Ids iguais aos de `LOJAS` em functions/src/pedidos.ts.
const _lojas = [
  ('tabajaras', 'Tio Panda, Av. Tabajaras'),
  ('amigao', 'Tio Panda, Amigão (praça de alimentação)'),
];

String _emReais(double v) => 'R\$ ${v.toStringAsFixed(2).replaceAll('.', ',')}';

/// Sacola + fechamento do pedido.
///
/// Uma tela só, e não um fluxo de três passos: o pedido tem quatro decisões
/// (entrega ou retirada, endereço, pagamento, troco) e todas cabem numa
/// rolagem. Passo separado aqui só adicionaria toque pra quem está com fome.
class CarrinhoScreen extends ConsumerStatefulWidget {
  const CarrinhoScreen({super.key});

  @override
  ConsumerState<CarrinhoScreen> createState() => _CarrinhoScreenState();
}

class _CarrinhoScreenState extends ConsumerState<CarrinhoScreen> {
  final _observacao = TextEditingController();
  final _troco = TextEditingController();

  String _tipo = 'entrega';
  String? _loja;
  String _pagamento = 'dinheiro';
  bool _enviando = false;
  String? _erro;

  /// Endereço desta sacola. Começa no salvo do perfil; trocar salva de novo.
  EnderecoEntrega? _enderecoEditado;

  /// Id do pedido, sorteado uma vez por sacola.
  ///
  /// Fica no estado da tela de propósito: se a resposta se perder e o sócio
  /// tocar em "Confirmar" de novo, vai o MESMO id — e o backend devolve o
  /// pedido que já existe em vez de mandar duas comandas pra cozinha.
  late final String _pedidoId = _novoId();

  static String _novoId() {
    final r = Random();
    final sufixo = List.generate(
      8,
      (_) => r.nextInt(36).toRadixString(36),
    ).join();
    return 'p${DateTime.now().millisecondsSinceEpoch}$sufixo';
  }

  @override
  void dispose() {
    _observacao.dispose();
    _troco.dispose();
    super.dispose();
  }

  Future<void> _confirmar() async {
    final linhas = ref.read(linhasCarrinhoProvider);
    if (linhas.isEmpty) return;

    final endereco = _linhaEndereco();
    if (_tipo == 'entrega' && (endereco ?? '').length < 10) {
      setState(() => _erro = 'Adicione o endereço de entrega.');
      return;
    }
    if (_tipo == 'retirada' && _loja == null) {
      setState(() => _erro = 'Escolha onde retirar o pedido.');
      return;
    }

    // Vírgula é como se digita dinheiro aqui; o parse só entende ponto.
    final troco = _pagamento == 'dinheiro'
        ? double.tryParse(_troco.text.trim().replaceAll(',', '.')) ?? 0
        : 0.0;
    // Com a taxa dentro: é o que o entregador vai receber na mão, e é assim
    // que o servidor confere (functions/src/pedidos.ts).
    final total = ref.read(carrinhoTotalProvider) + _taxa();
    // Mesmo teto do servidor (TROCO_MAX em functions/src/pedidos.ts).
    if (troco > 5000) {
      setState(() => _erro = 'O troco pode ser para no máximo R\$ 5.000.');
      return;
    }
    if (troco > 0 && troco < total) {
      setState(
        () => _erro =
            'O troco precisa ser maior que o total (${_emReais(total)}).',
      );
      return;
    }

    setState(() {
      _enviando = true;
      _erro = null;
    });

    try {
      await Chamada.chamar(
        ref.read(functionsProvider),
        'criarPedido',
        dados: {
          'pedidoId': _pedidoId,
          'itens': [
            for (final l in linhas)
              {
                'id': l.item.id,
                'qtd': l.qtd,
                if (l.obs.isNotEmpty) 'obs': l.obs,
                if (l.promoId != null) 'promoId': l.promoId,
              },
          ],
          'tipo': _tipo,
          if (_tipo == 'retirada') 'loja': _loja,
          'endereco': _tipo == 'entrega' ? endereco : '',
          'pagamento': _pagamento,
          'troco': troco,
          'observacao': _observacao.text.trim(),
        },
        // Seguro repetir: o id acima é fixo, e o backend recusa o segundo
        // documento com o mesmo id (ver functions/src/pedidos.ts).
        repetir: true,
      );
      if (!mounted) return;
      HapticFeedback.mediumImpact();
      logEventoUi(ref, 'pedido_criado', params: {'itens': linhas.length});
      ref.read(carrinhoProvider.notifier).limpar();
      context.pushReplacement('/pedidos');
    } catch (e) {
      if (mounted) {
        setState(
          () =>
              _erro = mensagemDeErro(e, acaoFalhou: 'O pedido não foi enviado'),
        );
      }
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  /// Taxa de entrega desta sacola: só na entrega, e só o que o painel diz.
  double _taxa() =>
      _tipo == 'entrega' ? ref.read(restauranteProvider).taxaEntrega : 0;

  /// O endereço estruturado do perfil, se houver.
  EnderecoEntrega? _enderecoSalvo() {
    if (_enderecoEditado != null) return _enderecoEditado;
    final m = ref.read(currentUserProvider).value?.enderecoEntrega;
    return m == null ? null : EnderecoEntrega.fromMap(m);
  }

  /// Linha que vai no pedido. Conta antiga só tem o texto `endereco` de antes
  /// do CEP: continua valendo até o sócio trocar.
  String? _linhaEndereco() {
    final e = _enderecoSalvo();
    if (e != null) return e.linha;
    final antigo = ref.read(currentUserProvider).value?.endereco?.trim();
    return (antigo == null || antigo.isEmpty) ? null : antigo;
  }

  @override
  Widget build(BuildContext context) {
    final linhas = ref.watch(linhasCarrinhoProvider);
    final total = ref.watch(carrinhoTotalProvider);
    final carrinho = ref.read(carrinhoProvider.notifier);
    // Horário e taxa vêm do painel e mudam em tempo real: o sócio que estava
    // com a sacola aberta na hora de fechar vê o botão desligar sozinho.
    final restaurante = ref.watch(restauranteProvider);
    final aberto = restaurante.aceitandoPedidos();
    final bloqueio = bloqueioDePagamento(ref.watch(currentUserProvider).value);
    final taxa = _tipo == 'entrega' ? restaurante.taxaEntrega : 0.0;

    // Endereço do cadastro entra sozinho — quem pede em casa não quer digitar
    // de novo.
    ref.watch(currentUserProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Sua sacola'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          tooltip: 'Voltar',
          onPressed: () =>
              context.canPop() ? context.pop() : context.go('/cardapio'),
        ),
      ),
      body: SafeArea(
        child: linhas.isEmpty
            ? EmptyView(
                mensagem: 'Sua sacola está vazia.',
                icone: Icons.shopping_bag_outlined,
                acao: FilledButton(
                  onPressed: () => context.canPop()
                      ? context.pop()
                      : context.go('/cardapio'),
                  child: const Text('Ver o cardápio'),
                ),
              )
            : ListView(
                padding: const EdgeInsets.fromLTRB(24, 8, 24, 32),
                children: [
                  for (final l in linhas) ...[
                    _LinhaItem(
                      nome: l.descontoPct > 0
                          ? '${l.item.nome} (${l.descontoPct}% off)'
                          : l.item.nome,
                      subtotal: _emReais(l.subtotal),
                      obs: l.obs,
                      qtd: l.qtd,
                      onMais: () => carrinho.adicionar(l.item.id),
                      onMenos: () => carrinho.remover(l.item.id),
                    ),
                    const Divider(height: 24),
                  ],
                  const SizedBox(height: 4),
                  const SectionLabel('Como você quer receber'),
                  const SizedBox(height: 10),
                  SegmentedButton<String>(
                    segments: const [
                      ButtonSegment(
                        value: 'entrega',
                        label: Text('Entrega'),
                        icon: Icon(Icons.delivery_dining_outlined),
                      ),
                      ButtonSegment(
                        value: 'retirada',
                        label: Text('Retirar'),
                        icon: Icon(Icons.storefront_outlined),
                      ),
                    ],
                    selected: {_tipo},
                    onSelectionChanged: (s) => setState(() {
                      _tipo = s.first;
                      _erro = null;
                    }),
                  ),
                  if (_tipo == 'retirada') ...[
                    const SizedBox(height: 8),
                    RadioGroup<String>(
                      groupValue: _loja,
                      onChanged: (v) => setState(() {
                        _loja = v;
                        _erro = null;
                      }),
                      child: Column(
                        children: [
                          for (final l in _lojas)
                            RadioListTile<String>(
                              value: l.$1,
                              title: Text(l.$2),
                              contentPadding: EdgeInsets.zero,
                              activeColor: PandaColors.laranja,
                            ),
                        ],
                      ),
                    ),
                  ],
                  if (_tipo == 'entrega') ...[
                    const SizedBox(height: 16),
                    EnderecoCard(
                      linha: _linhaEndereco(),
                      onEditar: () async {
                        final novo = await editarEndereco(
                          context,
                          atual: _enderecoSalvo(),
                        );
                        if (novo != null) {
                          setState(() {
                            _enderecoEditado = novo;
                            _erro = null;
                          });
                        }
                      },
                    ),
                    const SizedBox(height: 8),
                  ],
                  const SizedBox(height: 8),
                  const SectionLabel('Pagamento'),
                  const SizedBox(height: 6),
                  // Pagar no app ainda não existe: o Mercado Pago aqui é só
                  // assinatura. Dizer isso na tela evita o sócio fechar o
                  // pedido achando que já pagou.
                  Text(
                    'O pagamento é feito na entrega ou na retirada.',
                    style: TextStyle(
                      color: context.textoSec,
                      fontSize: 13,
                      height: 1.3,
                    ),
                  ),
                  const SizedBox(height: 10),
                  RadioGroup<String>(
                    groupValue: _pagamento,
                    onChanged: (v) => setState(() => _pagamento = v!),
                    child: Column(
                      children: [
                        for (final opcao in const [
                          ('dinheiro', 'Dinheiro'),
                          ('cartao_entrega', 'Cartão na entrega'),
                          ('pix_entrega', 'Pix na entrega'),
                        ])
                          RadioListTile<String>(
                            value: opcao.$1,
                            title: Text(opcao.$2),
                            contentPadding: EdgeInsets.zero,
                            activeColor: PandaColors.laranja,
                          ),
                      ],
                    ),
                  ),
                  if (_pagamento == 'dinheiro') ...[
                    TextField(
                      controller: _troco,
                      keyboardType: const TextInputType.numberWithOptions(
                        decimal: true,
                      ),
                      decoration: const InputDecoration(
                        labelText: 'Troco para quanto? (opcional)',
                        prefixText: 'R\$ ',
                        border: OutlineInputBorder(),
                      ),
                    ),
                  ],
                  const SizedBox(height: 16),
                  TextField(
                    controller: _observacao,
                    maxLines: 2,
                    maxLength: 300,
                    textCapitalization: TextCapitalization.sentences,
                    decoration: const InputDecoration(
                      labelText: 'Observação (opcional)',
                      hintText: 'Ex.: sem cebola, interfone com defeito',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  if (_erro != null) ...[
                    const SizedBox(height: 8),
                    Text(
                      _erro!,
                      style: TextStyle(
                        color: context.vermelhoTexto,
                        fontSize: 13.5,
                      ),
                    ),
                  ],
                  const SizedBox(height: 20),
                  if (taxa > 0) ...[
                    _LinhaValor('Itens', _emReais(total)),
                    const SizedBox(height: 6),
                    _LinhaValor('Taxa de entrega', _emReais(taxa)),
                    const SizedBox(height: 10),
                  ],
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text(
                        'Total',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      Text(
                        _emReais(total + taxa),
                        style: TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.w800,
                          color: context.laranjaTexto,
                        ),
                      ),
                    ],
                  ),
                  if (!aberto) ...[
                    const SizedBox(height: 16),
                    _AvisoFechado(restaurante: restaurante),
                  ],
                  const SizedBox(height: 20),
                  if (bloqueio != null)
                    Text(
                      bloqueio,
                      textAlign: TextAlign.center,
                      style: TextStyle(color: context.textoSec, height: 1.4),
                    )
                  else
                    FilledButton(
                      onPressed: _enviando || !aberto ? null : _confirmar,
                      style: FilledButton.styleFrom(
                        minimumSize: const Size.fromHeight(54),
                        shape: RoundedRectangleBorder(
                          borderRadius: PandaRadius.bmd,
                        ),
                      ),
                      child: _enviando
                          ? const SizedBox(
                              height: 20,
                              width: 20,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                          : Text(aberto ? 'Confirmar pedido' : 'Fechado agora'),
                    ),
                ],
              ),
      ),
    );
  }
}

/// Linha de valor do resumo (itens, taxa). Discreta: o número que decide é o
/// total, logo abaixo.
class _LinhaValor extends StatelessWidget {
  const _LinhaValor(this.rotulo, this.valor);
  final String rotulo;
  final String valor;

  @override
  Widget build(BuildContext context) {
    final estilo = TextStyle(color: context.textoSec, fontSize: 14);
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(rotulo, style: estilo),
        Text(valor, style: estilo),
      ],
    );
  }
}

/// Por que o botão de confirmar está desligado.
///
/// Sem esta faixa, "Fechado agora" num botão cinza parece app quebrado — e o
/// sócio não tem onde descobrir que horas abre.
class _AvisoFechado extends StatelessWidget {
  const _AvisoFechado({required this.restaurante});
  final RestauranteInfo restaurante;

  @override
  Widget build(BuildContext context) {
    final proxima = restaurante.proximaAbertura();
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: context.laranjaFundo,
        borderRadius: PandaRadius.bmd,
      ),
      child: Row(
        children: [
          Icon(Icons.schedule_rounded, color: context.laranjaTexto, size: 20),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              restaurante.pedidosPausados
                  ? 'No momento não estamos aceitando pedidos. Tente novamente mais tarde.'
                  : proxima == null
                  ? 'Estamos fechados agora.'
                  : 'Estamos fechados agora. $proxima.',
              style: TextStyle(
                color: context.laranjaTexto,
                fontSize: 13.5,
                height: 1.35,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _LinhaItem extends StatelessWidget {
  const _LinhaItem({
    required this.nome,
    required this.subtotal,
    required this.qtd,
    required this.onMais,
    required this.onMenos,
    this.obs = '',
  });

  final String nome;
  final String subtotal;
  final String obs;
  final int qtd;
  final VoidCallback onMais;
  final VoidCallback onMenos;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                nome,
                style: const TextStyle(
                  fontWeight: FontWeight.w700,
                  fontSize: 15,
                ),
              ),
              if (obs.isNotEmpty) ...[
                const SizedBox(height: 2),
                Text(
                  obs,
                  style: TextStyle(
                    color: context.laranjaTexto,
                    fontSize: 13,
                    fontStyle: FontStyle.italic,
                  ),
                ),
              ],
              const SizedBox(height: 2),
              Text(
                subtotal,
                style: TextStyle(color: context.textoSec, fontSize: 13.5),
              ),
            ],
          ),
        ),
        IconButton(
          onPressed: onMenos,
          icon: const Icon(Icons.remove_circle_outline),
          tooltip: 'Tirar um',
        ),
        Text(
          '$qtd',
          style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16),
        ),
        IconButton(
          onPressed: onMais,
          icon: const Icon(Icons.add_circle_outline),
          color: PandaColors.laranja,
          tooltip: 'Mais um',
        ),
      ],
    );
  }
}
