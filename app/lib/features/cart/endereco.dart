import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;

import '../../core/services/services.dart';
import '../../core/theme/colors.dart';
import '../../core/theme/dimens.dart';

/// Endereço de entrega salvo no perfil (`users/{uid}.enderecoEntrega`).
///
/// Guardado em partes pra reabrir o formulário preenchido; `linha` é o texto
/// pronto que vai no pedido e na comanda.
class EnderecoEntrega {
  const EnderecoEntrega({
    this.cep = '',
    this.rua = '',
    this.numero = '',
    this.complemento = '',
    this.bairro = '',
    this.cidade = '',
  });

  final String cep;
  final String rua;
  final String numero;
  final String complemento;
  final String bairro;
  final String cidade;

  factory EnderecoEntrega.fromMap(Map<String, dynamic> m) => EnderecoEntrega(
    cep: '${m['cep'] ?? ''}',
    rua: '${m['rua'] ?? ''}',
    numero: '${m['numero'] ?? ''}',
    complemento: '${m['complemento'] ?? ''}',
    bairro: '${m['bairro'] ?? ''}',
    cidade: '${m['cidade'] ?? ''}',
  );

  Map<String, String> toMap() => {
    'cep': cep,
    'rua': rua,
    'numero': numero,
    'complemento': complemento,
    'bairro': bairro,
    'cidade': cidade,
  };

  /// "Rua X, 123 - Apto 4, Centro, Tupã - SP, CEP 00000-000"
  String get linha {
    final ruaNumero = [
      [rua, numero].where((s) => s.isNotEmpty).join(', '),
      complemento,
    ].where((s) => s.isNotEmpty).join(' - ');
    return [
      ruaNumero,
      bairro,
      cidade,
      if (cep.isNotEmpty) 'CEP $cep',
    ].where((s) => s.isNotEmpty).join(', ');
  }
}

/// CEP só com dígitos, formatado "00000-000" quando completo.
String formatarCep(String bruto) {
  final d = bruto.replaceAll(RegExp(r'\D'), '');
  return d.length == 8 ? '${d.substring(0, 5)}-${d.substring(5)}' : d;
}

/// Consulta o ViaCEP. `null` = CEP inexistente ou sem rede — o sócio digita.
Future<EnderecoEntrega?> buscarCep(String cep) async {
  final d = cep.replaceAll(RegExp(r'\D'), '');
  if (d.length != 8) return null;
  try {
    final r = await http
        .get(Uri.parse('https://viacep.com.br/ws/$d/json/'))
        .timeout(const Duration(seconds: 8));
    if (r.statusCode != 200) return null;
    final m = jsonDecode(r.body) as Map<String, dynamic>;
    if (m['erro'] != null) return null;
    final uf = '${m['uf'] ?? ''}';
    final cidade = '${m['localidade'] ?? ''}';
    return EnderecoEntrega(
      cep: formatarCep(d),
      rua: '${m['logradouro'] ?? ''}',
      bairro: '${m['bairro'] ?? ''}',
      cidade: uf.isEmpty ? cidade : '$cidade - $uf',
    );
  } catch (_) {
    return null;
  }
}

/// Abre o formulário e, ao salvar, grava no perfil. Devolve o endereço salvo.
Future<EnderecoEntrega?> editarEndereco(
  BuildContext context, {
  EnderecoEntrega? atual,
}) {
  return showModalBottomSheet<EnderecoEntrega>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    backgroundColor: Theme.of(context).scaffoldBackgroundColor,
    builder: (_) => _EnderecoSheet(atual: atual ?? const EnderecoEntrega()),
  );
}

class _EnderecoSheet extends ConsumerStatefulWidget {
  const _EnderecoSheet({required this.atual});
  final EnderecoEntrega atual;

  @override
  ConsumerState<_EnderecoSheet> createState() => _EnderecoSheetState();
}

class _EnderecoSheetState extends ConsumerState<_EnderecoSheet> {
  late final _cep = TextEditingController(text: widget.atual.cep);
  late final _rua = TextEditingController(text: widget.atual.rua);
  late final _numero = TextEditingController(text: widget.atual.numero);
  late final _complemento = TextEditingController(
    text: widget.atual.complemento,
  );
  late final _bairro = TextEditingController(text: widget.atual.bairro);
  late final _cidade = TextEditingController(text: widget.atual.cidade);
  final _numeroFoco = FocusNode();

  bool _buscando = false;
  bool _salvando = false;
  String? _aviso;

  @override
  void dispose() {
    for (final c in [_cep, _rua, _numero, _complemento, _bairro, _cidade]) {
      c.dispose();
    }
    _numeroFoco.dispose();
    super.dispose();
  }

  Future<void> _aoMudarCep(String v) async {
    final digitos = v.replaceAll(RegExp(r'\D'), '');
    if (digitos.length != 8) return;
    setState(() {
      _buscando = true;
      _aviso = null;
    });
    final achado = await buscarCep(digitos);
    if (!mounted) return;
    setState(() {
      _buscando = false;
      if (achado == null) {
        _aviso = 'Não achamos esse CEP. Preencha o endereço à mão.';
        return;
      }
      _cep.text = achado.cep;
      if (achado.rua.isNotEmpty) _rua.text = achado.rua;
      if (achado.bairro.isNotEmpty) _bairro.text = achado.bairro;
      _cidade.text = achado.cidade;
    });
    // Rua e bairro vieram do CEP: o que falta é o número.
    if (achado != null) _numeroFoco.requestFocus();
  }

  Future<void> _salvar() async {
    final e = EnderecoEntrega(
      cep: formatarCep(_cep.text.trim()),
      rua: _rua.text.trim(),
      numero: _numero.text.trim(),
      complemento: _complemento.text.trim(),
      bairro: _bairro.text.trim(),
      cidade: _cidade.text.trim(),
    );
    if (e.rua.isEmpty || e.numero.isEmpty || e.bairro.isEmpty) {
      setState(() => _aviso = 'Preencha rua, número e bairro.');
      return;
    }
    setState(() => _salvando = true);
    final uid = ref.read(authStateProvider).value?.uid;
    try {
      if (uid != null) {
        await ref.read(firestoreProvider).doc('users/$uid').set({
          'enderecoEntrega': e.toMap(),
          'endereco': e.linha,
        }, SetOptions(merge: true));
      }
      if (mounted) Navigator.of(context).pop(e);
    } catch (_) {
      if (mounted) {
        setState(() {
          _salvando = false;
          _aviso = 'Não foi possível salvar agora. Verifique sua conexão.';
        });
      }
    }
  }

  InputDecoration _campo(String label, {String? hint, Widget? sufixo}) =>
      InputDecoration(
        labelText: label,
        hintText: hint,
        suffixIcon: sufixo,
        border: const OutlineInputBorder(),
      );

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        bottom: MediaQuery.of(context).viewInsets.bottom,
      ),
      child: SafeArea(
        top: false,
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Endereço de entrega',
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 4),
              Text(
                'O endereço fica salvo na sua conta para os próximos pedidos.',
                style: TextStyle(color: context.textoSec, fontSize: 13.5),
              ),
              const SizedBox(height: 20),
              TextField(
                controller: _cep,
                keyboardType: TextInputType.number,
                inputFormatters: [
                  FilteringTextInputFormatter.allow(RegExp(r'[\d-]')),
                  LengthLimitingTextInputFormatter(9),
                ],
                onChanged: _aoMudarCep,
                decoration: _campo(
                  'CEP',
                  hint: '00000-000',
                  sufixo: _buscando
                      ? const Padding(
                          padding: EdgeInsets.all(14),
                          child: SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          ),
                        )
                      : const Icon(Icons.search_rounded),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _rua,
                textCapitalization: TextCapitalization.words,
                decoration: _campo('Rua'),
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  SizedBox(
                    width: 110,
                    child: TextField(
                      controller: _numero,
                      focusNode: _numeroFoco,
                      decoration: _campo('Número'),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: TextField(
                      controller: _complemento,
                      textCapitalization: TextCapitalization.sentences,
                      decoration: _campo('Complemento', hint: 'Apto, bloco…'),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _bairro,
                textCapitalization: TextCapitalization.words,
                decoration: _campo('Bairro'),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _cidade,
                textCapitalization: TextCapitalization.words,
                decoration: _campo('Cidade'),
              ),
              if (_aviso != null) ...[
                const SizedBox(height: 10),
                Text(
                  _aviso!,
                  style: TextStyle(
                    color: context.vermelhoTexto,
                    fontSize: 13.5,
                  ),
                ),
              ],
              const SizedBox(height: 20),
              FilledButton(
                onPressed: _salvando ? null : _salvar,
                style: FilledButton.styleFrom(
                  minimumSize: const Size.fromHeight(52),
                  shape: RoundedRectangleBorder(borderRadius: PandaRadius.bmd),
                ),
                child: _salvando
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Text('Salvar endereço'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Cartão com o endereço salvo e o botão de trocar. Sem endereço, vira o
/// convite pra cadastrar — um toque abre o formulário com busca por CEP.
class EnderecoCard extends StatelessWidget {
  const EnderecoCard({super.key, required this.linha, required this.onEditar});
  final String? linha;
  final VoidCallback onEditar;

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final vazio = linha == null || linha!.isEmpty;
    return Material(
      color: isDark ? PandaColors.cardDark : PandaColors.branco,
      borderRadius: PandaRadius.bmd,
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onEditar,
        child: Ink(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            borderRadius: PandaRadius.bmd,
            border: Border.all(
              color: vazio
                  ? PandaColors.laranja
                  : (isDark ? PandaColors.hairlineDark : PandaColors.hairline),
            ),
          ),
          child: Row(
            children: [
              const Icon(
                Icons.location_on_rounded,
                color: PandaColors.laranja,
                size: 26,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  vazio ? 'Adicionar endereço de entrega' : linha!,
                  style: TextStyle(
                    fontSize: 14.5,
                    height: 1.35,
                    fontWeight: vazio ? FontWeight.w700 : FontWeight.w500,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Text(
                vazio ? 'Adicionar' : 'Trocar',
                style: const TextStyle(
                  color: PandaColors.laranja,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
