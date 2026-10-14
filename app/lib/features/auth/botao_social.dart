import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

/// Marca "G" do Google, das diretrizes oficiais.
///
/// Antes aqui entrava `Icons.g_mobiledata_rounded`, um "G" genérico do
/// Material. Fora de feio, as diretrizes de "Sign in with Google" exigem a
/// marca oficial sem modificação — usar outra coisa é motivo de reprovação na
/// revisão da Play.
class GoogleG extends StatelessWidget {
  const GoogleG({super.key, this.size = 22});

  final double size;

  @override
  Widget build(BuildContext context) =>
      SvgPicture.asset('assets/brand/google_g.svg', width: size, height: size);
}

/// Botão de entrar com provedor social. Vive fora da tela de login porque a de
/// cadastro usa o mesmo — quem chega em "Cadastre-se" também quer o atalho do
/// Google, e antes só a de login tinha.
class BotaoSocial extends StatelessWidget {
  const BotaoSocial({
    super.key,
    required this.onTap,
    required this.icone,
    required this.texto,
    required this.corFundo,
    required this.corBorda,
    this.corTexto = Colors.white,
  });

  final VoidCallback? onTap;
  final Widget icone;
  final String texto;
  final Color corFundo;
  final Color corBorda;

  /// A tela de login é sempre escura; a de cadastro segue o tema do app. Por
  /// isso a cor do texto vem de fora em vez de ser branca fixa — branco sobre
  /// fundo claro sumiria.
  final Color corTexto;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: corFundo,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Ink(
          height: 54,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: corBorda),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              icone,
              const SizedBox(width: 10),
              // Escala com a letra do sistema sem estourar a altura fixa.
              Flexible(
                child: Text(
                  texto,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: corTexto,
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
