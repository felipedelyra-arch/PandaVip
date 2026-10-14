import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/restaurante.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/colors.dart';
import '../../core/widgets/panda_logo.dart';
import 'auth_senha.dart';

/// Cores das telas de auth. Sempre escuras (independem do tema do app) e com
/// contraste >= 4.5:1 sobre o fundo: o cinza antigo (`cinzaTexto`) ficava
/// apagado demais para quem enxerga mal.
abstract class AuthCores {
  static const bg = Color(0xFF14110E);
  static const card = Color(0xFF211C16);
  static const borda = Color(0x33FFFFFF);
  static const texto = Colors.white;
  static const textoSuave = Color(0xFFD0C7BA); // ~11:1 sobre bg
  static const erro = Color(0xFFFF8F85); // ~8:1 sobre bg
  static const ok = Color(0xFF5FD39A); // ~10:1 sobre bg
}

/// Moldura comum: fundo escuro, rolagem que acompanha o teclado, coluna
/// centralizada de largura limitada.
class AuthScaffold extends StatelessWidget {
  const AuthScaffold({super.key, required this.children, this.onVoltar});

  final List<Widget> children;
  final VoidCallback? onVoltar;

  @override
  Widget build(BuildContext context) {
    return Theme(
      data: AppTheme.dark,
      child: Scaffold(
        backgroundColor: AuthCores.bg,
        resizeToAvoidBottomInset: true,
        appBar: onVoltar == null
            ? null
            : AppBar(
                backgroundColor: AuthCores.bg,
                elevation: 0,
                leading: IconButton(
                  tooltip: 'Voltar',
                  icon: const Icon(Icons.arrow_back, color: Colors.white),
                  onPressed: onVoltar,
                ),
              ),
        body: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
              padding: const EdgeInsets.fromLTRB(24, 16, 24, 32),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 460),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: children,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Logo + título + subtítulo no topo das telas.
class AuthCabecalho extends StatelessWidget {
  const AuthCabecalho({
    super.key,
    required this.titulo,
    this.subtitulo,
    this.logo = true,
  });

  final String titulo;
  final String? subtitulo;
  final bool logo;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (logo) ...[
          const Center(child: PandaLogo(size: 80, showWordmark: false)),
          const SizedBox(height: 20),
        ],
        Semantics(
          header: true,
          child: Text(
            titulo,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: AuthCores.texto,
              fontSize: 28,
              fontWeight: FontWeight.w700,
              height: 1.15,
            ),
          ),
        ),
        if (subtitulo != null) ...[
          const SizedBox(height: 8),
          Text(
            subtitulo!,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: AuthCores.textoSuave,
              fontSize: 16,
              height: 1.45,
            ),
          ),
        ],
        const SizedBox(height: 28),
      ],
    );
  }
}

InputDecoration _decoracao({String? hint, Widget? prefixo, Widget? sufixo}) {
  OutlineInputBorder b(Color c, [double w = 1]) => OutlineInputBorder(
    borderRadius: BorderRadius.circular(14),
    borderSide: BorderSide(color: c, width: w),
  );
  return InputDecoration(
    hintText: hint,
    hintStyle: const TextStyle(color: Color(0xFFA89F93), fontSize: 15),
    prefixIcon: prefixo,
    suffixIcon: sufixo,
    filled: true,
    fillColor: AuthCores.card,
    contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
    border: b(AuthCores.borda),
    enabledBorder: b(AuthCores.borda),
    focusedBorder: b(PandaColors.laranja, 2),
    errorBorder: b(AuthCores.erro),
    focusedErrorBorder: b(AuthCores.erro, 2),
    errorStyle: const TextStyle(color: AuthCores.erro, fontSize: 14),
    errorMaxLines: 3,
  );
}

class _Rotulo extends StatelessWidget {
  const _Rotulo(this.texto);
  final String texto;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: Text(
      texto,
      style: const TextStyle(
        color: AuthCores.texto,
        fontSize: 15,
        fontWeight: FontWeight.w600,
      ),
    ),
  );
}

/// Campo de texto com rótulo visível acima.
class AuthCampo extends StatelessWidget {
  const AuthCampo({
    super.key,
    required this.controller,
    required this.rotulo,
    this.hint,
    this.ajuda,
    this.icone,
    this.keyboardType,
    this.textCapitalization = TextCapitalization.none,
    this.textInputAction,
    this.autofillHints,
    this.validator,
    this.obscure = false,
    this.sufixo,
    this.onChanged,
    this.onSubmitted,
    this.maxLength,
  });

  final TextEditingController controller;
  final String rotulo;
  final String? hint;
  final String? ajuda;
  final IconData? icone;
  final TextInputType? keyboardType;
  final TextCapitalization textCapitalization;
  final TextInputAction? textInputAction;
  final Iterable<String>? autofillHints;
  final String? Function(String?)? validator;
  final bool obscure;
  final Widget? sufixo;
  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onSubmitted;
  final int? maxLength;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _Rotulo(rotulo),
        TextFormField(
          controller: controller,
          obscureText: obscure,
          keyboardType: keyboardType,
          textCapitalization: textCapitalization,
          textInputAction: textInputAction,
          autofillHints: autofillHints,
          validator: validator,
          onChanged: onChanged,
          onFieldSubmitted: onSubmitted,
          maxLength: maxLength,
          autocorrect: false,
          enableSuggestions: !obscure,
          cursorColor: PandaColors.laranja,
          style: const TextStyle(color: AuthCores.texto, fontSize: 17),
          decoration: _decoracao(
            hint: hint,
            prefixo: icone == null
                ? null
                : Icon(icone, color: AuthCores.textoSuave, size: 22),
            sufixo: sufixo,
          ).copyWith(counterText: ''),
        ),
        if (ajuda != null)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
              ajuda!,
              style: const TextStyle(
                color: AuthCores.textoSuave,
                fontSize: 14,
                height: 1.4,
              ),
            ),
          ),
      ],
    );
  }
}

/// Campo de senha com botão de mostrar/ocultar.
class AuthCampoSenha extends StatefulWidget {
  const AuthCampoSenha({
    super.key,
    required this.controller,
    this.rotulo = 'Senha',
    this.hint,
    this.validator,
    this.onChanged,
    this.onSubmitted,
    this.textInputAction,
    this.autofillHints = const [AutofillHints.password],
  });

  final TextEditingController controller;
  final String rotulo;
  final String? hint;
  final String? Function(String?)? validator;
  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onSubmitted;
  final TextInputAction? textInputAction;
  final Iterable<String> autofillHints;

  @override
  State<AuthCampoSenha> createState() => _AuthCampoSenhaState();
}

class _AuthCampoSenhaState extends State<AuthCampoSenha> {
  bool _mostrar = false;

  @override
  Widget build(BuildContext context) {
    return AuthCampo(
      controller: widget.controller,
      rotulo: widget.rotulo,
      hint: widget.hint,
      icone: Icons.lock_outline_rounded,
      obscure: !_mostrar,
      validator: widget.validator,
      onChanged: widget.onChanged,
      onSubmitted: widget.onSubmitted,
      textInputAction: widget.textInputAction,
      autofillHints: widget.autofillHints,
      keyboardType: TextInputType.visiblePassword,
      sufixo: IconButton(
        tooltip: _mostrar ? 'Ocultar senha' : 'Mostrar senha',
        constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
        onPressed: () => setState(() => _mostrar = !_mostrar),
        icon: Icon(
          _mostrar ? Icons.visibility_off_rounded : Icons.visibility_rounded,
          color: AuthCores.textoSuave,
        ),
      ),
    );
  }
}

/// Checklist ao vivo dos requisitos de senha (verde quando cumprido).
class ChecklistSenha extends StatelessWidget {
  const ChecklistSenha({super.key, required this.senha});
  final String senha;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AuthCores.card,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AuthCores.borda),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final r in requisitosSenha)
            Builder(
              builder: (_) {
                final ok = r.ok(senha);
                return Semantics(
                  label: '${r.texto}: ${ok ? 'cumprido' : 'pendente'}',
                  excludeSemantics: true,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 3),
                    child: Row(
                      children: [
                        Icon(
                          ok
                              ? Icons.check_circle_rounded
                              : Icons.radio_button_unchecked,
                          size: 20,
                          color: ok ? AuthCores.ok : AuthCores.textoSuave,
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            r.texto,
                            style: TextStyle(
                              fontSize: 14.5,
                              color: ok ? AuthCores.ok : AuthCores.textoSuave,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
        ],
      ),
    );
  }
}

/// Caixa de erro visível, perto do botão. Some quando [mensagem] é nula.
class AuthErro extends StatelessWidget {
  const AuthErro(this.mensagem, {super.key});
  final String? mensagem;

  @override
  Widget build(BuildContext context) {
    final m = mensagem;
    if (m == null) return const SizedBox.shrink();
    return Semantics(
      liveRegion: true,
      child: Container(
        margin: const EdgeInsets.only(bottom: 16),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: const Color(0x33E23B2E),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AuthCores.erro),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Icon(
              Icons.error_outline_rounded,
              color: AuthCores.erro,
              size: 22,
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                m,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 15,
                  height: 1.4,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Ação principal (laranja, texto branco em negrito).
class AuthBotao extends StatelessWidget {
  const AuthBotao({
    super.key,
    required this.texto,
    required this.onPressed,
    this.carregando = false,
  });

  final String texto;
  final VoidCallback? onPressed;
  final bool carregando;

  @override
  Widget build(BuildContext context) {
    return FilledButton(
      onPressed: carregando ? null : onPressed,
      style: FilledButton.styleFrom(
        // Laranja escurecido: texto branco chega a 4.5:1 (o laranja da marca
        // dá ~3.2:1). Mesmo tom do FilledButtonTheme global.
        backgroundColor: PandaColors.laranja,
        disabledBackgroundColor: const Color(0xFF8A4220),
        foregroundColor: Colors.white,
        disabledForegroundColor: Colors.white,
        minimumSize: const Size.fromHeight(56),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        textStyle: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
      ),
      child: carregando
          ? const SizedBox(
              height: 24,
              width: 24,
              child: CircularProgressIndicator(
                strokeWidth: 2.5,
                color: Colors.white,
              ),
            )
          : Text(texto),
    );
  }
}

/// Ação secundária: com borda e texto claros (nada de texto cinza solto).
class AuthBotaoSecundario extends StatelessWidget {
  const AuthBotaoSecundario({
    super.key,
    required this.texto,
    required this.onPressed,
    this.icone,
  });

  final String texto;
  final VoidCallback? onPressed;
  final IconData? icone;

  @override
  Widget build(BuildContext context) {
    final estilo = OutlinedButton.styleFrom(
      foregroundColor: Colors.white,
      disabledForegroundColor: const Color(0xFF9C9387),
      side: const BorderSide(color: Color(0x99FFFFFF), width: 1.2),
      minimumSize: const Size.fromHeight(52),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
    );
    return icone == null
        ? OutlinedButton(
            onPressed: onPressed,
            style: estilo,
            child: Text(texto),
          )
        : OutlinedButton.icon(
            onPressed: onPressed,
            style: estilo,
            icon: Icon(icone, size: 20),
            label: Text(texto),
          );
  }
}

/// Link de texto legível (laranja, alvo >= 48dp).
class AuthLink extends StatelessWidget {
  const AuthLink({super.key, required this.texto, required this.onPressed});
  final String texto;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) => TextButton(
    onPressed: onPressed,
    style: TextButton.styleFrom(
      foregroundColor: const Color(0xFFFF9A5C),
      minimumSize: const Size(48, 48),
      textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
    ),
    child: Text(texto),
  );
}

/// Divisor "ou".
class AuthDivisorOu extends StatelessWidget {
  const AuthDivisorOu({super.key});

  @override
  Widget build(BuildContext context) => const Row(
    children: [
      Expanded(child: Divider(color: AuthCores.borda)),
      Padding(
        padding: EdgeInsets.symmetric(horizontal: 12),
        child: Text(
          'ou',
          style: TextStyle(color: AuthCores.textoSuave, fontSize: 15),
        ),
      ),
      Expanded(child: Divider(color: AuthCores.borda)),
    ],
  );
}

/// Data de nascimento mais recente aceita: idade mínima de 14 anos (Termos,
/// Política, público-alvo nas lojas e `idadeOk` em firestore.rules).
DateTime limiteNascimento() {
  final agora = DateTime.now();
  return DateTime(agora.year - 14, agora.month, agora.day);
}

/// Abre o seletor de data de nascimento no tema escuro. Datas abaixo do
/// limite de idade nem aparecem.
Future<DateTime?> escolherNascimento(BuildContext context, DateTime? atual) {
  final agora = DateTime.now();
  final limite = limiteNascimento();
  final inicial = atual ?? DateTime(agora.year - 25, agora.month, agora.day);
  return showDatePicker(
    context: context,
    // Perfil antigo com data acima do limite estouraria o assert do seletor.
    initialDate: inicial.isAfter(limite) ? limite : inicial,
    firstDate: DateTime(1920),
    lastDate: limite,
    locale: const Locale('pt', 'BR'),
    helpText: 'Sua data de nascimento (14 anos ou mais)',
    builder: (c, child) => Theme(data: AppTheme.dark, child: child!),
  );
}

/// Máscara dd/mm/aaaa: o sócio digita só os números e as barras entram
/// sozinhas. Barra só aparece quando já há dígito depois dela, então apagar
/// funciona normalmente.
class MascaraData extends TextInputFormatter {
  const MascaraData();

  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue antigo,
    TextEditingValue novo,
  ) {
    final texto = formatarData(novo.text);
    return TextEditingValue(
      text: texto,
      selection: TextSelection.collapsed(offset: texto.length),
    );
  }
}

/// `12122005` → `12/12/2005` (aceita também o texto já com barras).
String formatarData(String entrada) {
  final d = entrada.replaceAll(RegExp(r'\D'), '');
  final n = d.length > 8 ? d.substring(0, 8) : d;
  final b = StringBuffer();
  for (var i = 0; i < n.length; i++) {
    if (i == 2 || i == 4) b.write('/');
    b.write(n[i]);
  }
  return b.toString();
}

/// Lê `dd/mm/aaaa`. Devolve a data, ou a mensagem de erro para o campo.
/// Incompleta ainda não é erro: só não tem data.
({DateTime? data, String? erro}) lerNascimento(String texto, {DateTime? hoje}) {
  final d = texto.replaceAll(RegExp(r'\D'), '');
  if (d.length < 8) return (data: null, erro: null);
  final dia = int.parse(d.substring(0, 2));
  final mes = int.parse(d.substring(2, 4));
  final ano = int.parse(d.substring(4, 8));
  final data = DateTime(ano, mes, dia);
  // DateTime "conserta" 31/02 para 03/03: se mudou, a data não existe.
  if (data.day != dia || data.month != mes || ano < 1920) {
    return (data: null, erro: 'Data inválida.');
  }
  final h = hoje ?? DateTime.now();
  final limite = DateTime(h.year - 14, h.month, h.day);
  if (data.isAfter(limite)) {
    return (data: null, erro: 'É preciso ter 14 anos ou mais.');
  }
  return (data: data, erro: null);
}

/// Campo de data de nascimento: digita `ddmmaaaa` (as barras entram sozinhas)
/// ou toca no calendário. Rótulo acima.
class AuthCampoData extends StatefulWidget {
  const AuthCampoData({
    super.key,
    required this.valor,
    required this.onTap,
    required this.onChanged,
    this.rotulo = 'Data de nascimento',
    this.ajuda,
  });

  final DateTime? valor;

  /// Ícone do calendário.
  final VoidCallback onTap;

  /// Data válida digitada, ou `null` enquanto incompleta/inválida.
  final ValueChanged<DateTime?> onChanged;
  final String rotulo;
  final String? ajuda;

  @override
  State<AuthCampoData> createState() => _AuthCampoDataState();
}

class _AuthCampoDataState extends State<AuthCampoData> {
  static final _fmt = DateFormat('dd/MM/yyyy');
  late final _ctrl = TextEditingController(
    text: widget.valor == null ? '' : _fmt.format(widget.valor!),
  );
  String? _erro;

  @override
  void didUpdateWidget(AuthCampoData antigo) {
    super.didUpdateWidget(antigo);
    // Veio do calendário: mostra no campo.
    final v = widget.valor;
    if (v != null && v != antigo.valor && lerNascimento(_ctrl.text).data != v) {
      _ctrl.text = _fmt.format(v);
      _erro = null;
    }
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  void _mudou(String texto) {
    final r = lerNascimento(texto);
    setState(() => _erro = r.erro);
    widget.onChanged(r.data);
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _Rotulo(widget.rotulo),
        TextField(
          controller: _ctrl,
          onChanged: _mudou,
          keyboardType: TextInputType.number,
          inputFormatters: const [MascaraData()],
          autofillHints: const [AutofillHints.birthday],
          style: const TextStyle(fontSize: 17, color: AuthCores.texto),
          decoration: _decoracao(
            hint: 'dd/mm/aaaa',
            prefixo: const Icon(
              Icons.cake_outlined,
              color: AuthCores.textoSuave,
              size: 22,
            ),
            sufixo: IconButton(
              tooltip: 'Escolher no calendário',
              onPressed: widget.onTap,
              icon: const Icon(
                Icons.calendar_month_outlined,
                color: AuthCores.textoSuave,
              ),
            ),
          ).copyWith(errorText: _erro),
        ),
        if (widget.ajuda != null)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
              widget.ajuda!,
              style: const TextStyle(
                color: AuthCores.textoSuave,
                fontSize: 14,
                height: 1.4,
              ),
            ),
          ),
      ],
    );
  }
}

/// Versão dos termos/política que o sócio aceita no cadastro. Muda junto com
/// "Última atualização" em app/web/privacidade.html e termos.html.
const termosVersao = '2026-10-13';

/// Checkbox obrigatório "Li e aceito" com links para termos e privacidade.
class AuthAceiteTermos extends ConsumerWidget {
  const AuthAceiteTermos({
    super.key,
    required this.aceito,
    required this.onChanged,
  });
  final bool aceito;
  final ValueChanged<bool> onChanged;

  static Future<void> _abrir(String url) =>
      launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Mesmos links de Configurações: o dono pode trocá-los pelo painel.
    final restaurante = ref.watch(restauranteProvider);
    const estilo = TextStyle(color: AuthCores.textoSuave, fontSize: 15);
    const link = TextStyle(
      color: Color(0xFFFF9A5C),
      fontSize: 15,
      fontWeight: FontWeight.w600,
      decoration: TextDecoration.underline,
    );
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Checkbox(value: aceito, onChanged: (v) => onChanged(v ?? false)),
        Expanded(
          child: Padding(
            padding: const EdgeInsets.only(top: 12),
            child: Text.rich(
              TextSpan(
                style: estilo,
                children: [
                  const TextSpan(text: 'Li e aceito os '),
                  TextSpan(
                    text: 'Termos de Uso',
                    style: link,
                    recognizer: TapGestureRecognizer()
                      ..onTap = () => _abrir(restaurante.termosUrl),
                  ),
                  const TextSpan(text: ' e a '),
                  TextSpan(
                    text: 'Política de Privacidade',
                    style: link,
                    recognizer: TapGestureRecognizer()
                      ..onTap = () =>
                          _abrir(restaurante.politicaPrivacidadeUrl),
                  ),
                  const TextSpan(text: '.'),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}
