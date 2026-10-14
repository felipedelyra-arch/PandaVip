# PandaVip — App do Cliente (Flutter)

App do cliente do PandaVip (Tio Panda). iOS + Android a partir de um código.

## Stack

- Flutter 3.44+ / Dart 3.12+
- **Estado:** Riverpod 3
- **Navegação:** go_router (com guarda de auth)
- **Backend:** Firebase (Auth, Firestore, Functions `southamerica-east1`, Storage, Messaging)
- **Pagamento:** checkout do gateway via Cloud Function (`createCheckoutSession`). Gateway
  escolhido: Mercado Pago, ainda não integrado — ver `PAGAMENTOS.md` na raiz

## Estrutura

```
lib/
  main.dart                 # bootstrap Firebase + tema + router
  firebase_options.dart     # PLACEHOLDER — gerar com flutterfire configure
  core/
    theme/                  # cores, tema claro/escuro (Poppins)
    widgets/                # PandaLogo, estados (loading/vazio/erro), imagens, skeleton
    models/                 # AppUser, Plan, Promotion, Reward, Redemption, Subscription
    services/               # providers Riverpod (Firestore/Auth/Functions) + push FCM
  features/
    auth/                   # login, cadastro, recuperar senha
    home/                   # promoções em tempo real + banner assinar
    rewards/                # grid de prêmios, resgate -> código do cupom
    subscription/           # planos, checkout, gestão da assinatura
    profile/                # perfil, cupons, endereço, sair
    shell/                  # bottom navigation
  router/                   # go_router + redirect de auth
```

## Setup

```bash
flutter pub get

# Configurar Firebase (gera firebase_options.dart + arquivos nativos)
dart pub global activate flutterfire_cli
flutterfire configure --project=seu-projeto

flutter run
```

Sem o `flutterfire configure`, o app compila mas não conecta (chaves placeholder).

## Telas (spec)

1. Auth — login/cadastro/recuperar senha ✅
2. Home — promoções em tempo real, banner assinar ✅
3. Premiações — grid, resgate gera código de cupom único ✅
4. Assinatura — planos, gestão/cancelar ✅; checkout depende da integração do gateway
5. Perfil — dados, cupons, endereço, sair ✅
6. Push — FCM registra token, permissão, promo automática ✅

## Pendências

- Rodar `flutterfire configure` (precisa do projeto Firebase real).
- Substituir logo em `assets/logo/panda_logo.png` e ligar `PandaLogo(useAsset: true)`.
- Integração do Mercado Pago no backend (o app abre a URL de checkout via url_launcher).
- Build Android precisa Android Studio + SDK; iOS precisa macOS.
