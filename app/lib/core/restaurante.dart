import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'demo.dart';
import 'services/services.dart';

/// Dados de contato do restaurante.
///
/// A fonte da verdade é o doc `config/restaurante`, editado na tela de
/// Configurações do painel: o dono troca o telefone e o app pega na hora, sem
/// publicar versão nova na loja. As constantes de [RestauranteInfo.padrao] são
/// só o que aparece enquanto o doc não chegou (primeiro frame, app offline) ou
/// quando um campo está vazio no banco.
class RestauranteInfo {
  const RestauranteInfo({
    required this.nome,
    required this.telefone,
    required this.whatsapp,
    required this.endereco,
    required this.cidade,
    required this.politicaPrivacidadeUrl,
    required this.termosUrl,
    required this.playStoreUrl,
    required this.appStoreUrl,
    this.horarios = const {},
    this.pedidosPausados = false,
    this.taxaEntrega = 0,
    this.mpPublicKey = '',
  });

  final String nome;

  /// Telefone pra ligação — DDI 55 + DDD + número, só dígitos.
  final String telefone;

  /// WhatsApp no formato wa.me — DDI 55 + DDD + número, só dígitos.
  final String whatsapp;

  /// Endereço usado na busca do Google Maps.
  final String endereco;

  /// Cidade do recebedor no código Pix da gorjeta (campo 60 do BR Code, no
  /// máximo 15 caracteres depois de tirar acento). Não é endereço: é exigência
  /// do padrão do Banco Central.
  final String cidade;

  /// Política de privacidade pública (exigida pelas lojas).
  final String politicaPrivacidadeUrl;

  /// Termos de uso público.
  final String termosUrl;

  /// Links das lojas (tela de update obrigatório e "indique um amigo").
  final String playStoreUrl;
  final String appStoreUrl;

  /// Horário do delivery, um por dia: `{'ter': '18:00-23:30'}`. Dia ausente ou
  /// em branco = fechado nele. Fim menor que o começo atravessa a meia-noite.
  /// Mapa vazio = sem restrição (é o estado de antes da tela existir).
  ///
  /// Quem manda de verdade é o servidor (`functions/src/lib/expediente.ts`);
  /// aqui é só pra não deixar o sócio montar a sacola inteira à toa.
  final Map<String, String> horarios;

  /// Interruptor do painel: corta pedido agora, mesmo dentro do horário.
  final bool pedidosPausados;

  /// Taxa de entrega fixa, em reais. Só entra em pedido de entrega — o
  /// servidor soma de novo, com este mesmo número.
  final double taxaEntrega;

  /// Chave PÚBLICA do Mercado Pago, preenchida no painel. Só serve para
  /// transformar o cartão em token; vazia, a aba Cartão avisa que não está
  /// disponível.
  final String mpPublicKey;

  /// Valores de exemplo. Enquanto `config/restaurante` não for preenchido pelo
  /// painel, é isto que o app mostra — e os botões abrem contato fictício.
  static const padrao = RestauranteInfo(
    nome: 'Tio Panda',
    telefone: '551430000000',
    whatsapp: '5514990000000',
    endereco: 'Tio Panda restaurante',
    cidade: 'Bauru',
    // Páginas reais (Firebase Hosting do app); exemplo.com.br não as tem.
    politicaPrivacidadeUrl: 'https://seu-projeto-app.web.app/privacidade.html',
    termosUrl: 'https://seu-projeto-app.web.app/termos.html',
    playStoreUrl:
        'https://play.google.com/store/apps/details?id=com.tiopanda.pandavip',
    appStoreUrl: 'https://apps.apple.com/app/id000000000',
  );

  /// Monta a partir do doc do Firestore. Campo ausente ou em branco cai no
  /// padrão — meio preenchido é melhor que tela com buraco.
  factory RestauranteInfo.fromMap(Map<String, dynamic>? m) {
    String campo(String chave, String fallback) {
      final v = m?[chave];
      if (v is String && v.trim().isNotEmpty) return v.trim();
      return fallback;
    }

    const p = padrao;
    return RestauranteInfo(
      nome: campo('nome', p.nome),
      telefone: campo('telefone', p.telefone),
      whatsapp: campo('whatsapp', p.whatsapp),
      endereco: campo('endereco', p.endereco),
      cidade: campo('cidade', p.cidade),
      politicaPrivacidadeUrl: campo(
        'politicaPrivacidadeUrl',
        p.politicaPrivacidadeUrl,
      ),
      termosUrl: campo('termosUrl', p.termosUrl),
      playStoreUrl: campo('playStoreUrl', p.playStoreUrl),
      appStoreUrl: campo('appStoreUrl', p.appStoreUrl),
      horarios: {
        for (final e
            in (m?['horarios'] as Map<dynamic, dynamic>? ?? {}).entries)
          if (e.value is String) '${e.key}': e.value as String,
      },
      pedidosPausados: m?['pedidosPausados'] == true,
      taxaEntrega: (m?['taxaEntrega'] as num?)?.toDouble() ?? 0,
      mpPublicKey: m?['mercadoPagoPublicKey'] is String
          ? (m!['mercadoPagoPublicKey'] as String).trim()
          : '',
    );
  }

  /// Índice = `DateTime.weekday % 7` (domingo = 0), igual ao `DIAS` das
  /// functions. As duas listas têm que continuar iguais.
  static const diasSemana = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];

  /// `'18:00-23:30'` → começo e fim em minutos desde a meia-noite.
  static (int, int)? janela(String? valor) {
    if (valor == null) return null;
    final partes = valor.split('-');
    if (partes.length != 2) return null;
    int? minutos(String s) {
      final m = RegExp(r'^(\d{1,2}):(\d{2})$').firstMatch(s.trim());
      if (m == null) return null;
      final h = int.parse(m.group(1)!);
      final min = int.parse(m.group(2)!);
      if (h > 23 || min > 59) return null;
      return h * 60 + min;
    }

    final abre = minutos(partes[0]);
    final fecha = minutos(partes[1]);
    if (abre == null || fecha == null || abre == fecha) return null;
    return (abre, fecha);
  }

  /// O restaurante aceita pedido agora? Espelha `abertoAgora` das functions —
  /// se as duas discordarem, quem vale é o servidor, e o sócio leva um erro
  /// depois de montar a sacola. Por isso a regra é a mesma, linha por linha.
  bool aceitandoPedidos([DateTime? agora]) {
    if (pedidosPausados) return false;
    final semana = diasSemana.map((d) => janela(horarios[d])).toList();
    if (semana.every((j) => j == null)) return true;

    final hora = agora ?? DateTime.now();
    final dia = hora.weekday % 7;
    final minuto = hora.hour * 60 + hora.minute;

    final hoje = semana[dia];
    if (hoje != null) {
      final (abre, fecha) = hoje;
      if (fecha > abre ? minuto >= abre && minuto < fecha : minuto >= abre) {
        return true;
      }
    }

    // Madrugada: quem está aberto é a janela de ontem que virou o dia.
    final ontem = semana[(dia + 6) % 7];
    return ontem != null && ontem.$2 < ontem.$1 && minuto < ontem.$2;
  }

  /// "Abre hoje às 18:00" / "Abre amanhã às 18:00". `null` quando a semana
  /// inteira está em branco (aí não há o que avisar).
  String? proximaAbertura([DateTime? agora]) {
    final hora = agora ?? DateTime.now();
    final dia = hora.weekday % 7;
    final minuto = hora.hour * 60 + hora.minute;
    const nomes = [
      'domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', //
    ];

    for (var i = 0; i < 7; i++) {
      final j = janela(horarios[diasSemana[(dia + i) % 7]]);
      if (j == null) continue;
      if (i == 0 && minuto >= j.$1) continue; // hoje já passou da abertura
      final h =
          '${(j.$1 ~/ 60).toString().padLeft(2, '0')}:'
          '${(j.$1 % 60).toString().padLeft(2, '0')}';
      final quando = switch (i) {
        0 => 'hoje',
        1 => 'amanhã',
        _ => nomes[(dia + i) % 7],
      };
      return 'Abre $quando às $h';
    }
    return null;
  }

  /// Algum contato ainda é o valor de exemplo? Usado só no aviso de debug.
  bool get contatosPendentes =>
      telefone == padrao.telefone ||
      whatsapp == padrao.whatsapp ||
      endereco == padrao.endereco;
}

/// Doc `config/restaurante` em tempo real.
final _restauranteDocProvider = StreamProvider<RestauranteInfo>((ref) {
  if (kDemo) return Stream.value(RestauranteInfo.padrao);
  return ref
      .watch(firestoreProvider)
      .doc('config/restaurante')
      .snapshots()
      .map((d) => RestauranteInfo.fromMap(d.data()));
});

/// Dados do restaurante prontos pra usar na tela, sem estado de carregando:
/// enquanto o Firestore não responde, vale o compilado. Nenhum botão de
/// contato precisa esperar rede pra desenhar.
final restauranteProvider = Provider<RestauranteInfo>((ref) {
  return ref.watch(_restauranteDocProvider).value ?? RestauranteInfo.padrao;
});
