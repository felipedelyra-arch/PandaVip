# PandaVip — regras do R8 para o build de release.
#
# O R8 encolhe, otimiza e renomeia o código Java/Kotlin do APK. Isso apaga do
# binário os nomes de classe e método que hoje saem legíveis num `jadx` — que é
# o que o item "ofuscação" pede. Ele NÃO toca no código Dart: quem ofusca o
# Dart é `--obfuscate --split-debug-info=` na linha do `flutter build` (ver
# LANCAMENTO.md). São duas camadas separadas e as duas são necessárias.
#
# O que precisa de regra explícita é só o que é alcançado por reflexão ou por
# nome, porque o R8 não enxerga essa referência e remove/renomeia a classe.
# A maior parte das bibliotecas daqui já embarca as próprias regras (Firebase,
# Play Services e o engine do Flutter trazem consumer rules), então esta lista
# é curta de propósito: regra de `-keep` a mais é código que deixou de ser
# ofuscado e de ser encolhido.

# --- Crashlytics -------------------------------------------------------------
# Sem os dois atributos abaixo o stack trace que chega na Play Console perde
# arquivo e linha, e o relatório de crash vira endereço de memória. Eles não
# desofuscam nada: o mapeamento continua no mapping.txt, que sobe junto com o
# bundle.
-keepattributes SourceFile,LineNumberTable
-keepattributes *Annotation*

# --- Play Core ---------------------------------------------------------------
# O engine do Flutter referencia as classes de entrega dinâmica (deferred
# components) mesmo quando o app não usa nenhuma — este app não usa. Sem isto o
# R8 reprova o build com "Missing class com.google.android.play.core...".
-dontwarn com.google.android.play.core.**

# --- Modelos serializados ----------------------------------------------------
# Nada em Java/Kotlin aqui é desserializado por reflexão: os modelos do app são
# Dart (core/models/models.dart) e o Firestore entrega Map, não classe Java.
# Se um dia entrar um plugin que use Gson/Moshi no lado nativo, a keep rule
# dele vem aqui — e junto com um teste que prove que o release ainda abre.
