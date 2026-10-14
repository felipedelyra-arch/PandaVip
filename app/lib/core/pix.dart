/// Gerador de "Pix copia e cola" (BR Code), padrão EMV MPM do Banco Central.
///
/// Não depende de Firebase, de Riverpod nem de nada do PandaVip: entra chave +
/// nome + cidade, sai a string que o aplicativo do banco entende. Foi escrito
/// isolado de propósito — o cardápio digital do Tio Panda vai precisar do mesmo
/// código, e aí é só copiar este arquivo.
///
/// O que o app NÃO faz e não tem como fazer: conferir se a chave existe ou é de
/// quem diz ser. Quem protege o cliente é o banco dele, que mostra o nome do
/// favorecido antes de confirmar o pagamento.
library;

/// Um campo do BR Code: identificador + tamanho em 2 dígitos + conteúdo.
///
/// O tamanho é contado em caracteres, o que só bate com o esperado porque tudo
/// que entra aqui passou por [_ascii] antes — acento vira 2 bytes e faria o
/// leitor do banco ler o campo torto.
String _campo(String id, String valor) =>
    '$id${valor.length.toString().padLeft(2, '0')}$valor';

const _comAcento = 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ';
const _semAcento = 'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn';

/// Deixa o texto no que o BR Code aceita: ASCII, maiúsculo, sem acento, sem
/// pontuação, cortado no limite do campo.
String _ascii(String texto, int limite) {
  final buf = StringBuffer();
  for (var i = 0; i < texto.length; i++) {
    final char = texto[i];
    final pos = _comAcento.indexOf(char);
    buf.write(pos >= 0 ? _semAcento[pos] : char);
  }
  final limpo = buf
      .toString()
      .toUpperCase()
      .replaceAll(RegExp(r'[^A-Z0-9 ]'), '')
      .replaceAll(RegExp(r'\s+'), ' ')
      .trim();
  return limpo.length <= limite ? limpo : limpo.substring(0, limite).trim();
}

/// Identificador da transação: alfanumérico até 25, ou "***" quando não há.
String _refLabel(String txid) {
  final limpo = txid.replaceAll(RegExp(r'[^A-Za-z0-9]'), '');
  return limpo.isEmpty ? '***' : limpo.substring(0, limpo.length.clamp(0, 25));
}

/// CRC16/CCITT-FALSE — polinômio 0x1021, valor inicial 0xFFFF, sem reflexão.
/// É o que o campo 63 do BR Code exige; qualquer outra variante de CRC16 gera
/// um código que o banco recusa. Público só pra ser testável direto.
String pixCrc16(String payload) {
  var crc = 0xFFFF;
  for (final byte in payload.codeUnits) {
    crc ^= byte << 8;
    for (var i = 0; i < 8; i++) {
      crc = (crc & 0x8000) != 0 ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xFFFF;
    }
  }
  return crc.toRadixString(16).toUpperCase().padLeft(4, '0');
}

/// Monta o Pix copia e cola.
///
/// [chave] vai crua (só sem espaços nas pontas): e-mail, telefone, CPF/CNPJ ou
/// chave aleatória. [nome] e [cidade] são normalizados e cortados nos limites
/// do padrão (25 e 15).
///
/// [valor] nulo — que é o caso da gorjeta — deixa o campo 54 de fora, e o
/// cliente digita quanto quer no app do banco. O parâmetro existe porque o
/// cardápio digital vai cobrar valor fechado com o mesmo gerador.
String pixCopiaECola({
  required String chave,
  required String nome,
  required String cidade,
  double? valor,
  String txid = '***',
}) {
  final k = chave.trim();
  if (k.isEmpty) throw ArgumentError('chave Pix vazia');

  final contaPix = _campo('00', 'BR.GOV.BCB.PIX') + _campo('01', k);

  final payload = StringBuffer()
    ..write(_campo('00', '01')) // versão do padrão
    ..write(_campo('26', contaPix))
    ..write(_campo('52', '0000')) // categoria do estabelecimento: não informada
    ..write(_campo('53', '986')); // real

  if (valor != null && valor > 0) {
    payload.write(_campo('54', valor.toStringAsFixed(2)));
  }

  payload
    ..write(_campo('58', 'BR'))
    ..write(_campo('59', _ascii(nome, 25)))
    ..write(_campo('60', _ascii(cidade, 15)))
    // "***" é o identificador de transação livre: o padrão reserva esse valor
    // pra quando o recebedor não quer conciliar pagamento por código.
    ..write(_campo('62', _campo('05', _refLabel(txid))))
    ..write('6304'); // identificador + tamanho do CRC, que entra no cálculo

  return '$payload${pixCrc16(payload.toString())}';
}
