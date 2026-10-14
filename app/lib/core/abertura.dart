/// Relógio da abertura do app.
///
/// Existe por um motivo só: a camada laranja do [SplashGate] precisa saber
/// **quanto tempo o sócio já ficou olhando pro laranja** antes de ela aparecer.
///
/// Sem isso, a animação de abertura era um tempo fixo somado a tudo que veio
/// antes — quanto mais devagar o aparelho, mais tempo de espera total, porque o
/// enfeite não descontava nada. O celular fraco, que é justamente onde a espera
/// já incomoda, era o que esperava mais.
library;

DateTime? _marcado;

/// Marca o começo. Primeira linha de `main()`, antes de qualquer `await`.
///
/// Idempotente: chamar de novo não mexe na marca (o `main` roda uma vez, mas
/// teste de widget instancia o app várias).
void marcarAbertura() => _marcado ??= DateTime.now();

/// Quanto já se passou desde [marcarAbertura].
///
/// `Duration.zero` quando ninguém marcou — caso dos testes de widget, onde o
/// certo é a animação rodar inteira em vez de ser cortada por um relógio que
/// não existe.
Duration get tempoDeAbertura =>
    _marcado == null ? Duration.zero : DateTime.now().difference(_marcado!);
