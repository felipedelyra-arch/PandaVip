import 'dart:async';
import 'dart:ui';

import 'package:flutter/foundation.dart' show kIsWeb, kReleaseMode;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_app_check/firebase_app_check.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_crashlytics/firebase_crashlytics.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'firebase_options.dart';
import 'core/theme/app_theme.dart';
import 'core/services/push_service.dart';
import 'core/services/fila_pendentes.dart';
import 'core/connectivity.dart';
import 'core/version_gate.dart';
import 'core/abertura.dart';
import 'core/demo.dart';
import 'core/analytics.dart';
import 'core/app_check.dart';
import 'core/app_prefs.dart';
import 'core/ui_prefs.dart';
import 'core/widgets/phone_frame.dart';
import 'core/widgets/splash_gate.dart';
import 'router/app_router.dart';

Future<void> main() async {
  // Primeira linha: é daqui que o SplashGate conta o orçamento da camada
  // laranja (ver core/abertura.dart).
  marcarAbertura();
  WidgetsFlutterBinding.ensureInitialized();
  // Ponta a ponta em todas as versões do Android (no 15 já é obrigatório): o
  // app desenha atrás das barras do sistema e as telas recuam pelo SafeArea.
  // O lado nativo chama `enableEdgeToEdge()` (MainActivity.kt).
  SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
  // Release não escreve no logcat: mensagens de erro do Firebase não vazam.
  if (kReleaseMode) debugPrint = (String? message, {int? wrapWidth}) {};

  // ⚠️ Estas três esperas não dependem uma da outra, e antes rodavam **em
  // fila**: dados de locale, depois preferências, depois Firebase. O sócio
  // pagava a soma das três olhando pro laranja. Começam todas agora e são
  // recolhidas no fim; o custo passa a ser o da mais lenta, não o do total.
  final futuroData = initializeDateFormatting('pt_BR', null);
  final futuroPrefs = SharedPreferences.getInstance();

  // Decodifica a logo enquanto o resto sobe. Ela é o primeiro pixel que o
  // Flutter pinta (SplashGate), e `Image.asset` resolve de forma assíncrona:
  // sem este empurrão, o primeiro frame saía laranja **sem logo** e ela
  // aparecia um ou dois frames depois — o pulo que fazia a abertura parecer
  // travada bem no começo.
  const AssetImage(
    'assets/logo/panda_logo.png',
  ).resolve(ImageConfiguration.empty);

  // Modo demo: não inicializa Firebase, usa dados fictícios (overrides).
  if (!kDemo) {
    await Firebase.initializeApp(
      options: DefaultFirebaseOptions.currentPlatform,
    );
    // E-mails do Firebase Auth (redefinir senha etc.) em português. Sem isto
    // saem no idioma padrão do projeto, que é inglês.
    FirebaseAuth.instance.setLanguageCode('pt-BR');

    // Cache em disco, explícito, antes de qualquer uso do Firestore.
    //
    // ⚠️ No Android e no iOS isto já é o padrão. **Na web não é**: com
    // `persistenceEnabled` em `null`, o cloud_firestore_web cai em
    // `memoryLocalCache` (cloud_firestore_web/lib/cloud_firestore_web.dart) —
    // sem cache em disco e sem fila de escrita que sobreviva a recarregar a
    // página. É esse o build que roda em seu-projeto-app.web.app.
    //
    // Com isto ligado, o app abre mostrando os últimos dados mesmo sem
    // internet, e uma escrita feita offline fica guardada e sobe sozinha
    // quando a conexão volta.
    //
    // `WebPersistentMultipleTabManager`: no modo padrão (aba única) a SEGUNDA
    // aba aberta no mesmo navegador não consegue a trava do IndexedDB e falha.
    // O dono abre o painel e o app lado a lado — isso ia acontecer com ele.
    FirebaseFirestore.instance.settings = const Settings(
      persistenceEnabled: true,
      webPersistentTabManager: WebPersistentMultipleTabManager(),
    );
    // App Check: prova ao Firebase que a chamada veio deste app, e não de um
    // script com a chave de API copiada do APK. Enquanto a imposição estiver
    // desligada no console, o token é enviado e ignorado — instalar agora não
    // derruba ninguém, e é pré-requisito pra poder impor depois.
    //
    // A web entra quando `RECAPTCHA_SITE_KEY` for passada no build (ver
    // `kChaveRecaptcha`, em core/app_check.dart). Sem a chave, o web continua
    // fora exatamente como antes: `activate` estoura se o provedor web for
    // nulo, e derrubar a abertura do app por causa disto seria pior que não
    // ter App Check na web.
    //
    // ⚠️ **Sem `await`.** Isto instala o provedor e conversa com o Play
    // Integrity; nada na primeira tela depende do resultado, e esperar por ele
    // era mais um passo de rede segurando o `runApp` — laranja parado enquanto
    // o app conversava com o Google. O erro precisa ser engolido aqui: como
    // ninguém espera esta Future, uma falha (aparelho sem Play Services,
    // emulador) subiria como erro assíncrono não tratado e o
    // `PlatformDispatcher.onError` logo abaixo a registraria como **fatal** no
    // Crashlytics — um crash inventado por causa de um enfeite de segurança
    // que nem está sendo imposto ainda.
    if (!kIsWeb || kChaveRecaptcha.isNotEmpty) {
      unawaited(
        FirebaseAppCheck.instance
            .activate(
              providerAndroid: kReleaseMode
                  ? const AndroidPlayIntegrityProvider()
                  : const AndroidDebugProvider(),
              providerApple: kReleaseMode
                  ? const AppleAppAttestProvider()
                  : const AppleDebugProvider(),
              providerWeb: kChaveRecaptcha.isEmpty
                  ? null
                  : ReCaptchaEnterpriseProvider(kChaveRecaptcha),
            )
            .catchError((Object e) {
              debugPrint('[AppCheck] não ativou: $e');
            }),
      );
    }
    // Crashlytics: captura erros de framework e assíncronos não tratados.
    // Não existe no web (o pacote só tem Android/iOS) — tocar na instância lá
    // estoura antes do runApp e deixa a página em branco.
    if (!kIsWeb) {
      FlutterError.onError =
          FirebaseCrashlytics.instance.recordFlutterFatalError;
      PlatformDispatcher.instance.onError = (error, stack) {
        FirebaseCrashlytics.instance.recordError(error, stack, fatal: true);
        return true;
      };
    }
  }

  // Recolhe o que foi disparado lá em cima. Na prática já terminaram: as duas
  // rodaram durante a inicialização do Firebase.
  await futuroData;
  final prefs = await futuroPrefs;

  runApp(
    ProviderScope(
      overrides: [
        sharedPreferencesProvider.overrideWithValue(prefs),
        ...(kDemo ? demoOverrides : const []),
      ],
      child: const ClubePandaApp(),
    ),
  );
}

class ClubePandaApp extends ConsumerWidget {
  const ClubePandaApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!kDemo) {
      ref.watch(pushServiceProvider); // liga o FCM ao logar
      ref.watch(coletaDeUsoProvider); // Analytics/Crashlytics conforme o perfil
      // Liga a fila de chamadas pendentes. Precisa ser observada aqui: o
      // provider é preguiçoso, e sem alguém olhando ele só nasceria quando
      // alguma tela enfileirasse algo — ou seja, nunca drenaria o que ficou da
      // sessão anterior.
      ref.watch(filaPendentesProvider);
    }
    final router = ref.watch(routerProvider);
    final textScale = ref.watch(textScaleProvider);
    final themeMode = ref.watch(themeModeProvider);
    return MaterialApp.router(
      title: 'PandaVip',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      darkTheme: AppTheme.dark,
      themeMode: themeMode,
      locale: const Locale('pt', 'BR'),
      supportedLocales: const [Locale('pt', 'BR')],
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      routerConfig: router,
      builder: (context, child) {
        // Acessibilidade: aplica o tamanho de letra escolhido em todo o app.
        final mq = MediaQuery.of(context);
        final escuro = Theme.of(context).brightness == Brightness.dark;
        // Barras do sistema transparentes, com ícones que acompanham o tema:
        // sem isto, no escuro (padrão) os ícones pretos sumiam no fundo.
        final barras =
            (escuro ? SystemUiOverlayStyle.light : SystemUiOverlayStyle.dark)
                .copyWith(
                  statusBarColor: Colors.transparent,
                  systemNavigationBarColor: Colors.transparent,
                  systemNavigationBarContrastEnforced: false,
                );
        return AnnotatedRegion<SystemUiOverlayStyle>(
          value: barras,
          child: MediaQuery(
            data: mq.copyWith(textScaler: TextScaler.linear(textScale)),
            child: PhoneFrame(
              // SplashGate por fora dos outros portões: o banner de offline e a
              // trava de versão não devem piscar por baixo da abertura.
              child: SplashGate(
                child: ConnectivityGate(
                  child: VersionGate(child: child ?? const SizedBox()),
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}
