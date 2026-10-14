import 'package:flutter/material.dart';

/// Renderiza imagem de asset local (assets/...) ou de URL (Firestore),
/// com widget de fallback em caso de erro.
Widget appImage(String path, {BoxFit fit = BoxFit.cover, Widget? erro}) {
  final fallback = erro ?? const SizedBox.shrink();
  if (path.startsWith('assets/')) {
    return Image.asset(path, fit: fit, errorBuilder: (_, _, _) => fallback);
  }
  return Image.network(path, fit: fit, errorBuilder: (_, _, _) => fallback);
}
