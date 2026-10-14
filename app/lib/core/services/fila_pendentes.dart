import 'dart:async';
import 'dart:convert';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../app_prefs.dart';
import '../connectivity.dart';
import 'chamada.dart';
import 'services.dart';

/// Fila em disco das chamadas de Cloud Function que ficaram pendentes.
///
/// ## O buraco que isto fecha
///
/// O Firestore guarda sozinho as escritas diretas: sobrevivem a fechar o app e
/// sobem quando a rede volta. Chamada de função não tinha nada disso. Ganhou
/// retentativa em [Chamada], mas retentativa mora na memória — fechar o app no
/// meio, ou o Android matar o processo em segundo plano, e a ação sumia.
///
/// A que mais doía: **cancelar assinatura**. O sócio toca em cancelar, a rede
/// oscila, ele fecha o app achando que cancelou — e descobre o contrário na
/// fatura seguinte.
///
/// ## Só entra aqui o que pode ser repetido
///
/// Item na fila é executado até dar certo. Isso exige que repetir a chamada
/// seja inofensivo. `createCheckoutSession` **não entra**: além de não ser
/// idempotente, ela devolve uma URL que só serve se alguém estiver olhando a
/// tela naquele instante.
///
/// ## O que a fila não promete
///
/// Ordem entre itens diferentes, nem execução com o app fechado. Ela drena
/// quando o app está aberto e há rede. Para o resto, o servidor é quem tem as
/// redes de segurança (`finalizarExclusoes`, `conferirEstoques`).

/// Uma chamada esperando para ser executada.
@immutable
class Pendente {
  const Pendente({
    required this.id,
    required this.funcao,
    required this.dados,
    required this.criadoEm,
    this.uid,
    this.tentativas = 0,
    this.ultimoErro,
    this.desistiu = false,
  });

  final String id;
  final String funcao;
  final Map<String, dynamic> dados;
  final DateTime criadoEm;

  /// Quem enfileirou. Item de outra conta (ou de versão antiga, sem uid) nunca
  /// é executado com a sessão de quem entrou depois.
  final String? uid;
  final int tentativas;
  final String? ultimoErro;

  /// Esgotou as tentativas. Fica guardado e visível, nunca é descartado calado.
  final bool desistiu;

  /// Texto para a tela de pendências. Genérico é pior que nada aqui: a pessoa
  /// precisa saber o que exatamente não foi.
  String get descricao => switch (funcao) {
    'cancelSubscription' => 'Cancelamento da assinatura',
    'redeemReward' => 'Resgate de prêmio',
    'applyReferral' => 'Código de indicação',
    'deleteAccount' => 'Exclusão da conta',
    _ => funcao,
  };

  Pendente copyWith({int? tentativas, String? ultimoErro, bool? desistiu}) =>
      Pendente(
        id: id,
        funcao: funcao,
        dados: dados,
        criadoEm: criadoEm,
        uid: uid,
        tentativas: tentativas ?? this.tentativas,
        ultimoErro: ultimoErro ?? this.ultimoErro,
        desistiu: desistiu ?? this.desistiu,
      );

  Map<String, dynamic> toJson() => {
    'id': id,
    'funcao': funcao,
    'dados': dados,
    'criadoEm': criadoEm.toIso8601String(),
    'uid': uid,
    'tentativas': tentativas,
    'ultimoErro': ultimoErro,
    'desistiu': desistiu,
  };

  static Pendente fromJson(Map<String, dynamic> m) => Pendente(
    id: m['id'] as String,
    funcao: m['funcao'] as String,
    dados: Map<String, dynamic>.from(m['dados'] as Map? ?? const {}),
    criadoEm:
        DateTime.tryParse(m['criadoEm'] as String? ?? '') ?? DateTime.now(),
    uid: m['uid'] as String?,
    tentativas: (m['tentativas'] as num?)?.toInt() ?? 0,
    ultimoErro: m['ultimoErro'] as String?,
    desistiu: m['desistiu'] as bool? ?? false,
  );
}

/// Funções que podem ser enfileiradas — a lista é branca de propósito.
///
/// Entrar aqui é afirmar que a função é idempotente. Erro nesse julgamento
/// custa caro: a fila insiste, e uma função não idempotente executaria o efeito
/// várias vezes.
const _permitidas = {
  'cancelSubscription',
  'redeemReward',
  'applyReferral',
  'deleteAccount',
};

const _chave = 'fila_pendentes_v1';

/// Tentativas antes de desistir e mostrar na caixa de não enviados.
const _maxTentativas = 8;

class FilaPendentes extends Notifier<List<Pendente>> {
  late final SharedPreferences _prefs;
  bool _drenando = false;

  @override
  List<Pendente> build() {
    _prefs = ref.watch(sharedPreferencesProvider);

    // Drena quando a rede volta. Exigir que ANTES estivesse offline evita
    // drenar por causa da primeira emissão da stream na abertura — a abertura
    // já é tratada logo abaixo.
    ref.listen<AsyncValue<bool>>(conexaoOnlineProvider, (anterior, atual) {
      if (anterior?.value == false && atual.value == true) drenar();
    });

    // E uma vez ao abrir o app, para o que sobrou da sessão passada. Fora do
    // `build` porque drenar mexe em `state`.
    Future.microtask(drenar);

    // Sessão restaurada/trocada depois da abertura: tenta de novo (e descarta o
    // que for de outra conta).
    ref.listen(authStateProvider, (_, atual) {
      if (atual.value != null) drenar();
    });

    return _lerDoDisco();
  }

  List<Pendente> _lerDoDisco() {
    final bruto = _prefs.getStringList(_chave) ?? const [];
    return bruto
        .map((s) {
          try {
            return Pendente.fromJson(jsonDecode(s) as Map<String, dynamic>);
          } catch (_) {
            // Item corrompido não pode impedir a fila inteira de carregar.
            return null;
          }
        })
        .whereType<Pendente>()
        .toList();
  }

  Future<void> _salvar() async {
    await _prefs.setStringList(
      _chave,
      state.map((p) => jsonEncode(p.toJson())).toList(),
    );
  }

  /// Põe uma chamada na fila. Grava em disco ANTES de devolver.
  Future<void> enfileirar(String funcao, {Map<String, dynamic>? dados}) async {
    assert(
      _permitidas.contains(funcao),
      'Só função idempotente pode ser enfileirada. Ver _permitidas.',
    );
    final p = Pendente(
      id: '${DateTime.now().microsecondsSinceEpoch}_$funcao',
      funcao: funcao,
      dados: dados ?? const {},
      criadoEm: DateTime.now(),
      uid: ref.read(firebaseAuthProvider).currentUser?.uid,
    );
    state = [...state, p];
    await _salvar();
  }

  /// Remove um item — usado quando o sócio desiste de uma pendência.
  Future<void> descartar(String id) async {
    state = state.where((p) => p.id != id).toList();
    await _salvar();
  }

  /// Esvazia a fila — chamado ao sair da conta.
  Future<void> limpar() async {
    state = const [];
    await _prefs.remove(_chave);
  }

  /// Manda tentar de novo um item que já tinha desistido.
  Future<void> tentarDeNovo(String id) async {
    state = [
      for (final p in state)
        if (p.id == id) p.copyWith(tentativas: 0, desistiu: false) else p,
    ];
    await _salvar();
    await drenar();
  }

  /// Executa o que está na fila, um de cada vez.
  ///
  /// Um de cada vez, e não tudo em paralelo, porque a fila drena logo depois de
  /// a rede voltar — e nesse instante o celular inteiro está tentando
  /// reconectar. Disparar tudo junto é justamente o que derruba servidor quando
  /// a conexão volta para todo mundo ao mesmo tempo.
  Future<void> drenar() async {
    if (_drenando) return;
    // Sem sessão ainda (restaurando): espera. O listener de auth chama de novo.
    final uid = ref.read(firebaseAuthProvider).currentUser?.uid;
    if (uid == null) return;
    _drenando = true;
    try {
      // Item de outra conta ou sem dono (versão antiga): descarta, não executa.
      if (state.any((p) => p.uid != uid)) {
        state = state.where((p) => p.uid == uid).toList();
        await _salvar();
      }
      for (final p in [...state]) {
        if (p.desistiu) continue;

        try {
          await Chamada.chamar(
            ref.read(functionsProvider),
            p.funcao,
            dados: p.dados.isEmpty ? null : p.dados,
            repetir: true,
          );
          state = state.where((x) => x.id != p.id).toList();
          await _salvar();
        } catch (e) {
          final tentativas = p.tentativas + 1;
          final desistiu = tentativas >= _maxTentativas;
          final permanente =
              e is FirebaseFunctionsException &&
              const {
                'permission-denied',
                'unauthenticated',
                'invalid-argument',
                'not-found',
                'failed-precondition',
                'already-exists',
              }.contains(e.code);

          state = [
            for (final x in state)
              if (x.id == p.id)
                x.copyWith(
                  tentativas: tentativas,
                  ultimoErro: e is FirebaseFunctionsException
                      ? (e.message ?? e.code)
                      : 'Falha de conexão',
                  // Erro permanente não melhora com insistência: para agora e
                  // mostra na caixa, em vez de tentar oito vezes à toa.
                  desistiu: desistiu || permanente,
                )
              else
                x,
          ];
          await _salvar();
          // Sem rede não adianta seguir para o próximo item.
          if (!permanente) break;
        }
      }
    } finally {
      _drenando = false;
    }
  }
}

final filaPendentesProvider = NotifierProvider<FilaPendentes, List<Pendente>>(
  FilaPendentes.new,
);

/// Itens que esgotaram as tentativas e esperam decisão do sócio.
final naoEnviadosProvider = Provider<List<Pendente>>((ref) {
  return ref.watch(filaPendentesProvider).where((p) => p.desistiu).toList();
});
