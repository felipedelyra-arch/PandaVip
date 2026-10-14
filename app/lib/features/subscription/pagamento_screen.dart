import 'dart:convert';

import 'package:flutter/foundation.dart'
    show TargetPlatform, defaultTargetPlatform, kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;
import 'package:intl/intl.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../core/models/models.dart';
import '../../core/restaurante.dart';
import '../../core/services/chamada.dart';
import '../../core/services/services.dart';
import '../../core/theme/colors.dart';
import '../../core/theme/dimens.dart';

final _moeda = NumberFormat.currency(locale: 'pt_BR', symbol: r'R$');

/// Pagamento da assinatura sem sair do app: Pix (QR e copia e cola) ou cartão
/// com cobrança mensal automática. O Mercado Pago fica por trás, recebendo.
///
/// Fecha com `true` quando a assinatura fica ativa (ou o Pix renova).
class PagamentoScreen extends ConsumerStatefulWidget {
  const PagamentoScreen({super.key, required this.plano, this.soPix = false});
  final Plan plano;

  /// Renovação do Pix: o cartão não entra, porque a assinatura já está ativa.
  final bool soPix;

  @override
  ConsumerState<PagamentoScreen> createState() => _PagamentoScreenState();
}

class _PagamentoScreenState extends ConsumerState<PagamentoScreen> {
  @override
  Widget build(BuildContext context) {
    final plano = widget.plano;
    final bloqueio = bloqueioDePagamento(ref.watch(currentUserProvider).value);
    if (bloqueio != null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Pagamento')),
        body: Padding(
          padding: const EdgeInsets.all(24),
          child: Center(
            child: Text(
              bloqueio,
              textAlign: TextAlign.center,
              style: TextStyle(color: context.textoSec, height: 1.4),
            ),
          ),
        ),
      );
    }
    if (widget.soPix) {
      return Scaffold(
        appBar: AppBar(title: const Text('Renovar com Pix')),
        body: SafeArea(child: _AbaPix(plano: plano)),
      );
    }
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Pagamento'),
          bottom: const TabBar(
            labelColor: PandaColors.laranja,
            indicatorColor: PandaColors.laranja,
            tabs: [
              Tab(icon: Icon(Icons.pix), text: 'Pix'),
              Tab(icon: Icon(Icons.credit_card), text: 'Cartão de crédito'),
            ],
          ),
        ),
        body: SafeArea(
          child: TabBarView(
            children: [
              _AbaPix(plano: plano),
              _AbaCartao(plano: plano),
            ],
          ),
        ),
      ),
    );
  }
}

String _periodo(Plan p) => switch (p.meses) {
  1 => '1 mês',
  12 => '1 ano',
  final n => '$n meses',
};

// ---------------------------------------------------------------- Pix

class _AbaPix extends ConsumerStatefulWidget {
  const _AbaPix({required this.plano});
  final Plan plano;

  @override
  ConsumerState<_AbaPix> createState() => _AbaPixState();
}

class _AbaPixState extends ConsumerState<_AbaPix>
    with AutomaticKeepAliveClientMixin {
  // Trocar para a aba Cartão não pode perder o QR nem quem espera o pagamento.
  @override
  bool get wantKeepAlive => true;

  String? _qr;
  bool _gerando = false;

  /// Vencimento antes de pagar. Na renovação a assinatura já está ativa, então
  /// o sinal de "pagou" é o vencimento mudar, não o status.
  DateTime? _vencimentoAntes;

  Future<void> _gerar() async {
    setState(() => _gerando = true);
    _vencimentoAntes = ref.read(subscriptionProvider).value?.ativaAte;
    try {
      final res = await Chamada.chamar(
        ref.read(functionsProvider),
        'criarPixAssinatura',
        dados: {'planId': widget.plano.id},
      );
      if (mounted) setState(() => _qr = res.data['qrCode'] as String?);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              mensagemDeErro(e, acaoFalhou: 'O código Pix não foi gerado'),
            ),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _gerando = false);
    }
  }

  Future<void> _copiar() async {
    await Clipboard.setData(ClipboardData(text: _qr!));
    if (!mounted) return;
    HapticFeedback.selectionClick();
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Código copiado. Cole no app do seu banco, na área Pix.'),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    // Quem libera é o webhook do Mercado Pago; a tela só espera o documento
    // da assinatura mudar e fecha sozinha.
    ref.listen(subscriptionProvider, (_, prox) {
      final s = prox.value;
      if (_qr != null &&
          s != null &&
          s.ativa &&
          s.pix &&
          s.ativaAte != _vencimentoAntes) {
        Navigator.of(context).pop(true);
      }
    });

    final p = widget.plano;
    return ListView(
      padding: const EdgeInsets.fromLTRB(24, 24, 24, 32),
      children: [
        Text(
          _moeda.format(p.preco),
          style: Theme.of(context).textTheme.displaySmall?.copyWith(
            color: PandaColors.laranja,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 6),
        Text(
          'Pagamento único que ativa o Clube por ${_periodo(p)}. '
          'O Pix não renova sozinho: avisamos antes de vencer.',
          style: TextStyle(color: context.textoSec, height: 1.4),
        ),
        const SizedBox(height: 24),
        if (_qr == null)
          ElevatedButton(
            onPressed: _gerando ? null : _gerar,
            style: ElevatedButton.styleFrom(
              minimumSize: const Size.fromHeight(52),
            ),
            child: _gerando
                ? const SizedBox(
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                    ),
                  )
                : const Text('Gerar código Pix'),
          )
        else ...[
          Center(
            child: Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: PandaRadius.bmd,
                border: Border.all(color: PandaColors.hairline),
              ),
              child: QrImageView(
                data: _qr!,
                size: 220,
                backgroundColor: Colors.white,
                semanticsLabel: 'QR Code do Pix',
              ),
            ),
          ),
          const SizedBox(height: 20),
          const Text(
            'Pix copia e cola',
            style: TextStyle(fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              borderRadius: PandaRadius.bsm,
              border: Border.all(color: PandaColors.hairline),
            ),
            child: Text(
              _qr!,
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 13, height: 1.35),
            ),
          ),
          const SizedBox(height: 12),
          ElevatedButton.icon(
            onPressed: _copiar,
            icon: const Icon(Icons.copy),
            label: const Text('Copiar código Pix'),
            style: ElevatedButton.styleFrom(
              minimumSize: const Size.fromHeight(52),
            ),
          ),
          const SizedBox(height: 24),
          const Row(
            children: [
              SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
              SizedBox(width: 12),
              Expanded(
                child: Text(
                  'Aguardando o pagamento. Esta tela fecha sozinha quando o '
                  'Pix for confirmado.',
                  style: TextStyle(height: 1.4),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Text(
            'O código vale por 1 hora.',
            style: TextStyle(color: context.textoSec, fontSize: 13),
          ),
        ],
      ],
    );
  }
}

// ---------------------------------------------------------------- Cartão

class _AbaCartao extends ConsumerStatefulWidget {
  const _AbaCartao({required this.plano});
  final Plan plano;

  @override
  ConsumerState<_AbaCartao> createState() => _AbaCartaoState();
}

class _AbaCartaoState extends ConsumerState<_AbaCartao> {
  final _form = GlobalKey<FormState>();
  final _numero = TextEditingController();
  final _nome = TextEditingController();
  final _validade = TextEditingController();
  final _cvv = TextEditingController();
  final _cpf = TextEditingController();
  bool _enviando = false;

  static const _canal = MethodChannel('pandavip/seguranca');

  /// FLAG_SECURE (Android): sem print, gravação nem miniatura nos recentes
  /// enquanto a aba do cartão está aberta (o QR do Pix pode ser salvo). No iOS e na web não faz nada.
  bool get _android =>
      !kIsWeb && defaultTargetPlatform == TargetPlatform.android;

  Future<void> _telaSegura(bool ligar) async {
    if (!_android) return;
    try {
      await _canal.invokeMethod<void>('telaSegura', ligar);
    } catch (_) {} // sem o canal (testes) o pagamento segue normal
  }

  @override
  void initState() {
    super.initState();
    _telaSegura(true);
  }

  @override
  void dispose() {
    _telaSegura(false);
    for (final c in [_numero, _nome, _validade, _cvv, _cpf]) {
      c.dispose();
    }
    super.dispose();
  }

  void _aviso(String texto) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(texto)));
  }

  /// O cartão vira token direto no Mercado Pago, com a chave pública. O número
  /// e o código de segurança nunca passam pelo nosso servidor.
  Future<String?> _tokenizar(String chavePublica) async {
    final validade = _digitos(_validade.text);
    final res = await http
        .post(
          Uri.https('api.mercadopago.com', '/v1/card_tokens', {
            'public_key': chavePublica,
          }),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode({
            'card_number': _digitos(_numero.text),
            'expiration_month': int.parse(validade.substring(0, 2)),
            'expiration_year': 2000 + int.parse(validade.substring(2, 4)),
            'security_code': _cvv.text.trim(),
            'cardholder': {
              'name': _nome.text.trim(),
              'identification': {'type': 'CPF', 'number': _digitos(_cpf.text)},
            },
          }),
        )
        .timeout(const Duration(seconds: 20));
    if (res.statusCode < 200 || res.statusCode >= 300) return null;
    return (jsonDecode(res.body) as Map<String, dynamic>)['id'] as String?;
  }

  Future<void> _assinar() async {
    if (!_form.currentState!.validate()) return;
    final chave = ref.read(restauranteProvider).mpPublicKey;
    if (chave.isEmpty) {
      _aviso('O pagamento com cartão está indisponível agora. Use o Pix.');
      return;
    }
    setState(() => _enviando = true);
    try {
      final String? token;
      try {
        token = await _tokenizar(chave);
      } catch (_) {
        _aviso(
          'Sem conexão com o Mercado Pago. Confira a internet e tente de novo.',
        );
        return;
      }
      if (token == null) {
        _aviso('Não foi possível validar o cartão. Confira os dados.');
        return;
      }
      final res = await Chamada.chamar(
        ref.read(functionsProvider),
        'assinarComCartao',
        dados: {'planId': widget.plano.id, 'cardToken': token},
      );
      if (!mounted) return;
      if (res.data['status'] == 'authorized') {
        // A assinatura nasce `pending`: benefício só na 1ª cobrança aprovada.
        _aviso(
          'Cartão aceito. Os benefícios são liberados assim que a 1ª cobrança '
          'for aprovada.',
        );
        Navigator.of(context).pop(true);
      } else {
        _aviso(
          'O Mercado Pago está analisando o pagamento. Você recebe um aviso '
          'assim que ele for aprovado.',
        );
        Navigator.of(context).pop(false);
      }
    } catch (e) {
      _aviso(mensagemDeErro(e, acaoFalhou: 'A assinatura não foi concluída'));
    } finally {
      // O código de segurança não fica na tela depois da tentativa.
      if (mounted) {
        _cvv.clear();
        setState(() => _enviando = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = widget.plano;
    return Form(
      key: _form,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(24, 24, 24, 32),
        children: [
          Text(
            '${_moeda.format(p.preco)} / ${p.intervaloCurto}',
            style: Theme.of(context).textTheme.headlineSmall?.copyWith(
              color: PandaColors.laranja,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 6),
          const SizedBox(height: 24),
          TextFormField(
            controller: _numero,
            keyboardType: TextInputType.number,
            autofillHints: const [AutofillHints.creditCardNumber],
            inputFormatters: [Mascara('#### #### #### ####')],
            decoration: const InputDecoration(labelText: 'Número do cartão'),
            validator: (v) =>
                cartaoValido(v ?? '') ? null : 'Número de cartão inválido.',
          ),
          const SizedBox(height: 14),
          TextFormField(
            controller: _nome,
            textCapitalization: TextCapitalization.characters,
            autofillHints: const [AutofillHints.creditCardName],
            decoration: const InputDecoration(
              labelText: 'Nome impresso no cartão',
            ),
            validator: (v) => (v ?? '').trim().length < 3
                ? 'Informe o nome como está no cartão.'
                : null,
          ),
          const SizedBox(height: 14),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: TextFormField(
                  controller: _validade,
                  keyboardType: TextInputType.number,
                  autofillHints: const [AutofillHints.creditCardExpirationDate],
                  inputFormatters: [Mascara('##/##')],
                  decoration: const InputDecoration(
                    labelText: 'Validade',
                    hintText: 'MM/AA',
                  ),
                  validator: (v) =>
                      validadeOk(v ?? '', DateTime.now()) ? null : 'Inválida.',
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: TextFormField(
                  controller: _cvv,
                  keyboardType: TextInputType.number,
                  obscureText: true,
                  autofillHints: const [AutofillHints.creditCardSecurityCode],
                  inputFormatters: [Mascara('####')],
                  decoration: const InputDecoration(labelText: 'CVV'),
                  validator: (v) => RegExp(r'^\d{3,4}$').hasMatch(v ?? '')
                      ? null
                      : 'Inválido.',
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          TextFormField(
            controller: _cpf,
            keyboardType: TextInputType.number,
            inputFormatters: [Mascara('###.###.###-##')],
            decoration: const InputDecoration(
              labelText: 'CPF do titular do cartão',
            ),
            validator: (v) => cpfValido(v ?? '') ? null : 'CPF inválido.',
          ),
          const SizedBox(height: 24),
          // Recorrência dita com todas as letras antes do botão (CDC art. 31).
          Text(
            'Cobrança automática de ${_moeda.format(p.preco)} a cada '
            '${p.intervaloCurto} no cartão, até você cancelar. Cancele quando '
            'quiser, sem multa. Desista em até 7 dias e receba tudo de volta.',
            style: TextStyle(color: context.textoSec, height: 1.4),
          ),
          const SizedBox(height: 14),
          ElevatedButton(
            onPressed: _enviando ? null : _assinar,
            style: ElevatedButton.styleFrom(
              minimumSize: const Size.fromHeight(52),
            ),
            child: _enviando
                ? const SizedBox(
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                    ),
                  )
                : Text('Assinar por ${_moeda.format(p.preco)}'),
          ),
          const SizedBox(height: 16),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(Icons.lock_outline, size: 16, color: context.textoSec),
              SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Os dados do cartão vão direto para o Mercado Pago, que '
                  'processa o pagamento. O Tio Panda não guarda o número do '
                  'cartão.',
                  style: TextStyle(
                    color: context.textoSec,
                    fontSize: 13,
                    height: 1.4,
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------- validação

String _digitos(String s) => s.replaceAll(RegExp(r'\D'), '');

/// Luhn: pega número digitado errado antes de gastar uma ida ao Mercado Pago.
bool cartaoValido(String entrada) {
  final d = _digitos(entrada);
  if (d.length < 13 || d.length > 19) return false;
  var soma = 0;
  for (var i = 0; i < d.length; i++) {
    var n = int.parse(d[d.length - 1 - i]);
    if (i.isOdd) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    soma += n;
  }
  return soma % 10 == 0;
}

/// "MM/AA" ainda dentro da validade (o cartão vale até o fim do mês impresso).
bool validadeOk(String entrada, DateTime hoje) {
  final d = _digitos(entrada);
  if (d.length != 4) return false;
  final mes = int.parse(d.substring(0, 2));
  final ano = 2000 + int.parse(d.substring(2));
  if (mes < 1 || mes > 12) return false;
  return ano > hoje.year || (ano == hoje.year && mes >= hoje.month);
}

/// CPF pelos dois dígitos verificadores.
bool cpfValido(String entrada) {
  final d = _digitos(entrada);
  if (d.length != 11 || RegExp(r'^(\d)\1{10}$').hasMatch(d)) return false;
  int dv(int ate) {
    var soma = 0;
    for (var i = 0; i < ate; i++) {
      soma += int.parse(d[i]) * (ate + 1 - i);
    }
    final r = (soma * 10) % 11;
    return r == 10 ? 0 : r;
  }

  return dv(9) == int.parse(d[9]) && dv(10) == int.parse(d[10]);
}

/// Máscara simples: `#` é dígito, o resto entra sozinho.
class Mascara extends TextInputFormatter {
  Mascara(this.padrao);
  final String padrao;

  @override
  TextEditingValue formatEditUpdate(TextEditingValue _, TextEditingValue novo) {
    final digitos = _digitos(novo.text);
    final saida = StringBuffer();
    var i = 0;
    for (final c in padrao.split('')) {
      if (i >= digitos.length) break;
      if (c == '#') {
        saida.write(digitos[i++]);
      } else {
        saida.write(c);
      }
    }
    final texto = saida.toString();
    return TextEditingValue(
      text: texto,
      selection: TextSelection.collapsed(offset: texto.length),
    );
  }
}
