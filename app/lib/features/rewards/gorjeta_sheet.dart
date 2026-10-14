import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../core/analytics.dart';
import '../../core/models/models.dart';
import '../../core/pix.dart';
import '../../core/restaurante.dart';
import '../../core/services/services.dart';
import '../../core/theme/colors.dart';
import '../../core/theme/dimens.dart';
import '../../core/widgets/state_views.dart';

/// Abre a folha de gorjeta. O dinheiro vai direto do cliente pro funcionário
/// por Pix — o restaurante não entra no caminho e o app não movimenta valor
/// nenhum, só mostra o código que o banco do cliente vai ler.
void mostrarGorjeta(BuildContext context) {
  showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    backgroundColor: Theme.of(context).scaffoldBackgroundColor,
    builder: (_) => const _GorjetaSheet(),
  );
}

/// Gorjeta logo depois que o garçom validou o [resgate]: já vem com quem
/// atendeu escolhido, e o "Já fiz o Pix" conta no ranking do painel.
void mostrarGorjetaPara(BuildContext context, Redemption resgate) {
  showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    backgroundColor: Theme.of(context).scaffoldBackgroundColor,
    builder: (_) => _GorjetaSheet(resgate: resgate),
  );
}

/// Valores sugeridos (decisão do dono, 13/10/2026). "Outro" deixa o valor
/// fora do código e o cliente digita no banco.
const _valores = [5.0, 10.0, 20.0, 50.0];

class _GorjetaSheet extends ConsumerStatefulWidget {
  const _GorjetaSheet({this.resgate});

  final Redemption? resgate;

  @override
  ConsumerState<_GorjetaSheet> createState() => _GorjetaSheetState();
}

class _GorjetaSheetState extends ConsumerState<_GorjetaSheet> {
  Funcionario? _escolhido;
  bool _copiado = false;
  double? _valor;
  bool _enviando = false;

  /// "Já fiz o Pix": grava em `gorjetas/{resgate}` (rules conferem que o
  /// resgate é deste sócio, foi usado e por quem). Falhar aqui não pode
  /// atrapalhar o cliente — o Pix já saiu; só o ranking deixa de contar.
  Future<void> _informarPix(Funcionario f) async {
    setState(() => _enviando = true);
    try {
      await ref
          .read(firestoreProvider)
          .doc('gorjetas/${widget.resgate!.id}')
          .set({
            'funcionarioId': f.id,
            'valor': _valor,
            'criadoEm': FieldValue.serverTimestamp(),
          })
          .timeout(const Duration(seconds: 8));
      logEventoUi(ref, 'tip_informed');
    } catch (_) {
      // Já informado antes, ou sem rede: segue.
    }
    if (mounted) Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    final equipe = ref.watch(funcionariosProvider);
    final resgate = widget.resgate;

    // Veio da validação: pula a lista e vai direto pra quem atendeu.
    final Widget conteudo;
    if (resgate != null) {
      conteudo = equipe.when(
        loading: () => const Padding(
          padding: EdgeInsets.symmetric(vertical: 48),
          child: LoadingView(),
        ),
        error: (_, _) => _entregue(resgate),
        data: (lista) {
          final f = lista.where((x) => x.id == resgate.funcionarioId);
          return f.isEmpty ? _entregue(resgate) : _codigoPix(f.first);
        },
      );
    } else if (_escolhido == null) {
      conteudo = equipe.when(
        loading: () => const Padding(
          padding: EdgeInsets.symmetric(vertical: 48),
          child: LoadingView(),
        ),
        error: (_, _) => const Padding(
          padding: EdgeInsets.symmetric(vertical: 24),
          child: ErrorView(
            mensagem: 'Não foi possível carregar a equipe agora.',
          ),
        ),
        data: _listaEquipe,
      );
    } else {
      conteudo = _codigoPix(_escolhido!);
    }

    return Padding(
      padding: EdgeInsets.only(
        left: 24,
        right: 24,
        top: 8,
        bottom: MediaQuery.of(context).viewInsets.bottom + 28,
      ),
      child: conteudo,
    );
  }

  /// Validado por alguém sem Pix cadastrado: só confirma a entrega.
  Widget _entregue(Redemption r) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: 8),
        const Icon(
          Icons.check_circle_outline,
          size: 48,
          color: PandaColors.laranja,
        ),
        const SizedBox(height: 8),
        Text(
          '${r.rewardTitulo.isEmpty ? 'Prêmio' : r.rewardTitulo} entregue!',
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.headlineSmall,
        ),
        if ((r.funcionarioNome ?? '').isNotEmpty) ...[
          const SizedBox(height: 4),
          Text(
            'Atendido por ${r.funcionarioNome}. Bom proveito!',
            textAlign: TextAlign.center,
            style: TextStyle(color: context.textoSec),
          ),
        ],
        const SizedBox(height: 20),
        ElevatedButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Fechar'),
        ),
      ],
    );
  }

  /// Passo 1: quem te atendeu?
  Widget _listaEquipe(List<Funcionario> equipe) {
    if (equipe.isEmpty) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 24),
        child: EmptyView(
          icone: Icons.volunteer_activism_outlined,
          mensagem:
              'A equipe ainda não foi cadastrada. Fale com o restaurante para '
              'deixar sua gorjeta.',
        ),
      );
    }

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: 8),
        Text(
          'Deixar uma gorjeta',
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.headlineSmall,
        ),
        const SizedBox(height: 8),
        Text(
          'Escolha quem atendeu você. O Pix vai direto para a pessoa.',
          textAlign: TextAlign.center,
          style: TextStyle(color: context.textoSec, height: 1.4),
        ),
        const SizedBox(height: 20),
        // Lista rolável só quando precisa: com 3 nomes a folha fica curta.
        ConstrainedBox(
          constraints: BoxConstraints(
            maxHeight: MediaQuery.sizeOf(context).height * 0.42,
          ),
          child: ListView.separated(
            shrinkWrap: true,
            itemCount: equipe.length,
            separatorBuilder: (_, _) => const SizedBox(height: 8),
            itemBuilder: (_, i) => _ItemPessoa(
              funcionario: equipe[i],
              onTap: () {
                logEventoUi(ref, 'tip_person_selected');
                setState(() => _escolhido = equipe[i]);
              },
            ),
          ),
        ),
        const SizedBox(height: 16),
        OutlinedButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Agora não'),
        ),
      ],
    );
  }

  /// Passo 2: o código pra pagar.
  Widget _codigoPix(Funcionario f) {
    final restaurante = ref.watch(restauranteProvider);

    // Se a chave cadastrada for inválida a ponto de nem gerar código, é melhor
    // dizer isso do que mostrar um QR que o banco recusa na frente do cliente.
    String? codigo;
    try {
      codigo = pixCopiaECola(
        chave: f.chavePix,
        nome: f.nome,
        cidade: restaurante.cidade,
        valor: _valor,
      );
    } catch (_) {
      codigo = null;
    }

    if (codigo == null) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ErrorView(
              mensagem:
                  'A chave Pix de ${f.nome} está incompleta no cadastro. '
                  'Avise o restaurante.',
            ),
            const SizedBox(height: 12),
            OutlinedButton(
              onPressed: widget.resgate != null
                  ? () => Navigator.pop(context)
                  : () => setState(() => _escolhido = null),
              child: Text(
                widget.resgate != null ? 'Fechar' : 'Escolher outra pessoa',
              ),
            ),
          ],
        ),
      );
    }

    return SingleChildScrollView(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SizedBox(height: 8),
          if (widget.resgate != null) ...[
            Text(
              '${widget.resgate!.rewardTitulo.isEmpty ? 'Prêmio' : widget.resgate!.rewardTitulo} entregue!',
              textAlign: TextAlign.center,
              style: TextStyle(color: context.textoSec),
            ),
            const SizedBox(height: 4),
          ],
          Text(
            widget.resgate != null
                ? 'Atendido por ${f.nome}. Deixar uma gorjeta?'
                : 'Gorjeta para ${f.nome}',
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.headlineSmall,
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              for (final v in _valores) ...[
                if (v != _valores.first) const SizedBox(width: 8),
                Expanded(
                  child: _CardValor(
                    texto: 'R\$ ${v.toStringAsFixed(0)}',
                    selecionado: _valor == v,
                    onTap: () => setState(() {
                      _valor = v;
                      _copiado = false;
                    }),
                  ),
                ),
              ],
            ],
          ),
          const SizedBox(height: 8),
          _CardValor(
            texto: 'Outro valor',
            selecionado: _valor == null,
            onTap: () => setState(() {
              _valor = null;
              _copiado = false;
            }),
          ),
          const SizedBox(height: 12),
          Text(
            _valor == null
                ? 'Abra o app do seu banco, escolha Pix, leia o código e digite '
                      'quanto quiser.'
                : 'Abra o app do seu banco, escolha Pix e leia o código: o '
                      'valor já vem preenchido.',
            textAlign: TextAlign.center,
            style: TextStyle(color: context.textoSec, height: 1.4),
          ),
          const SizedBox(height: 20),
          // Fundo branco fixo de propósito: leitor de QR precisa do contraste,
          // e no tema escuro um QR sobre superfície escura não é lido.
          Center(
            child: Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: PandaRadius.blg,
                border: Border.all(color: PandaColors.hairline),
              ),
              child: QrImageView(
                data: codigo,
                size: 190,
                backgroundColor: Colors.white,
              ),
            ),
          ),
          const SizedBox(height: 20),
          OutlinedButton.icon(
            onPressed: () async {
              await Clipboard.setData(ClipboardData(text: codigo!));
              if (!mounted) return;
              logEventoUi(ref, 'tip_code_copied');
              setState(() => _copiado = true);
            },
            icon: Icon(_copiado ? Icons.check : Icons.copy_outlined, size: 18),
            label: Text(_copiado ? 'Código copiado' : 'Copiar código Pix'),
          ),
          const SizedBox(height: 16),
          // O único aviso que realmente protege o cliente: chave errada não tem
          // como o app detectar, mas o banco mostra o nome antes de confirmar.
          _AvisoFavorecido(),
          const SizedBox(height: 16),
          if (widget.resgate != null) ...[
            ElevatedButton(
              onPressed: _enviando ? null : () => _informarPix(f),
              child: const Text('Já fiz o Pix'),
            ),
            OutlinedButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Agora não'),
            ),
          ] else ...[
            OutlinedButton(
              onPressed: () => setState(() {
                _escolhido = null;
                _copiado = false;
              }),
              child: const Text('Escolher outra pessoa'),
            ),
            ElevatedButton(
              // Context do builder da folha: com o ShellRoute do GoRouter, um pop
              // com o context de fora derruba a página inteira em vez da folha.
              onPressed: () => Navigator.pop(context),
              child: const Text('Pronto'),
            ),
          ],
        ],
      ),
    );
  }
}

/// Valor sugerido da gorjeta, nas cores da marca: escolhido em laranja
/// cheio, os outros com véu e contorno laranja (lê bem nos dois temas).
class _CardValor extends StatelessWidget {
  const _CardValor({
    required this.texto,
    required this.selecionado,
    required this.onTap,
  });

  final String texto;
  final bool selecionado;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: selecionado,
      child: Material(
        color: selecionado ? PandaColors.laranja : context.laranjaFundo,
        shape: RoundedRectangleBorder(
          borderRadius: PandaRadius.bsm,
          side: BorderSide(
            color: PandaColors.laranja.withValues(
              alpha: selecionado ? 1 : 0.45,
            ),
            width: 1.5,
          ),
        ),
        child: InkWell(
          onTap: onTap,
          borderRadius: PandaRadius.bsm,
          child: SizedBox(
            height: 52,
            child: Center(
              child: Text(
                texto,
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                  color: selecionado ? Colors.white : context.laranjaTexto,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Aviso de conferir o favorecido antes de pagar.
///
/// Fundo cor fixa vira mancha clara no tema escuro — aqui o laranja entra como
/// véu sobre a superfície do tema, e o texto vem do próprio tema, então o bloco
/// tem o mesmo peso visual nos dois modos sem perder contraste.
class _AvisoFavorecido extends StatelessWidget {
  const _AvisoFavorecido();

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);
    final escuro = tema.brightness == Brightness.dark;

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: escuro
            ? PandaColors.laranja.withValues(alpha: 0.12)
            : PandaColors.laranjaSuave,
        borderRadius: PandaRadius.bsm,
        border: Border.all(
          color: PandaColors.laranja.withValues(alpha: escuro ? 0.38 : 0.22),
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.info_outline, size: 18, color: PandaColors.laranja),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              'Confira o nome do favorecido na tela do seu banco antes de '
              'confirmar.',
              style: TextStyle(
                fontSize: 13,
                height: 1.4,
                color: tema.textTheme.bodyMedium?.color,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ItemPessoa extends StatelessWidget {
  const _ItemPessoa({required this.funcionario, required this.onTap});

  final Funcionario funcionario;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);
    final iniciais = funcionario.nome.trim().isEmpty
        ? '?'
        : funcionario.nome.trim()[0].toUpperCase();

    return Material(
      color: tema.cardColor,
      borderRadius: PandaRadius.bsm,
      child: InkWell(
        onTap: onTap,
        borderRadius: PandaRadius.bsm,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              CircleAvatar(
                radius: 20,
                backgroundColor: PandaColors.laranjaSuave,
                child: Text(
                  iniciais,
                  style: const TextStyle(
                    color: PandaColors.laranja,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      funcionario.nome,
                      style: tema.textTheme.titleMedium,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    if (funcionario.funcao.isNotEmpty)
                      Text(
                        funcionario.funcao,
                        style: TextStyle(fontSize: 13, color: context.textoSec),
                      ),
                  ],
                ),
              ),
              Icon(Icons.chevron_right, color: context.textoSec),
            ],
          ),
        ),
      ),
    );
  }
}
