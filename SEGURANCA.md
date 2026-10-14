# Segurança — PandaVip

Como o app, o painel e o backend se defendem, o que testar antes de publicar, e
o que fazer quando alguma chave vazar.

Este documento é para quem opera o clube, não só para quem programa. Onde há
comando, ele está pronto para copiar.

---

## 1. O mapa: o que protege o quê

O app é Flutter + Firebase. Não há servidor próprio no meio: o cliente fala
direto com o Firestore e com as Cloud Functions. Isso muda onde a defesa mora —
ela está nas **regras** e nas **functions**, nunca no aplicativo.

| Ameaça | O que barra | Onde está |
|---|---|---|
| Sócio lendo dados de outro sócio | Security Rules por `uid` | `firebase/firestore.rules` |
| Sócio se promovendo a admin, forjando `codigoSocio` ou `gatewayCustomerId` | Lista branca de campos | `firestore.rules` → `camposDoCliente()` |
| Documento inflado / campo com tipo errado | Validação de tipo e tamanho | `firestore.rules` → `bemFormado()` |
| Script com a chave de API copiada do APK | App Check (Play Integrity / App Attest / reCAPTCHA) | `app/lib/main.dart`, `admin/src/lib/firebase.ts` |
| Abuso por conta (laço de retry, script bobo) | Limite de chamadas por sócio e ação | `functions/src/lib/rateLimit.ts` |
| Consumo ou pagamento falso injetado | HMAC-SHA256 do corpo cru + idempotência | `functions/src/webhooks/*.ts` |
| Segredo vivo (PDV hoje; gateway quando integrado) lido por quem tem acesso ao projeto | Google Secret Manager | `functions/src/lib/segredos.ts` |
| Cobrança/assinatura alterada pelo cliente | Escrita fechada; só Admin SDK | `firestore.rules` (`allow write: if false`) |
| Redirect aberto no checkout | Destino fixo no servidor | `functions/src/subscriptions.ts` |
| Backup do Android levando dados do app | `allowBackup=false` + regras de extração | `app/android/.../AndroidManifest.xml` |
| Toque sequestrado por app sobreposto | `filterTouchesWhenObscured` | idem |
| Engenharia reversa do binário | R8 (Java/Kotlin) + `--obfuscate` (Dart) | `build.gradle.kts`, `LANCAMENTO.md` |
| XSS / clickjacking no painel | CSP, HSTS, `X-Frame-Options` | `firebase/firebase.json` |
| Dependência vulnerável, segredo no diff | `npm audit` + gitleaks, semanal | `.github/workflows/dependencias.yml` |

**A regra de ouro:** cobrança, assinatura, concessão de admin, baixa de estoque
e envio de push rodam **apenas em Cloud Functions**. O cliente nunca escreve
isso direto — e as rules garantem que não consiga nem tentando.

---

## 2. Checklist antes de cada release

### 2.1 Automático (roda sozinho, mas confira o verde)

```bash
# Regras do Firestore e do Storage, contra o emulador.
cd firebase
firebase emulators:exec --only firestore,storage --project pandavip-rules-test \
  "node --test test/rules.test.js && node --test test/storage.rules.test.js"
# esperado: 30 + 11 testes, 0 falhas

# Backend: tipos e lint.
cd functions && npx tsc --noEmit && npm run lint

# Painel: tipos e build.
cd ../../admin && npm run build

# App.
cd ../app && flutter analyze && flutter test
```

O emulador do Firestore precisa de Java. Sem ele, `emulators:exec` falha com
"Could not start Firestore Emulator" — instale um JRE 21.

### 2.2 Manual, no aparelho — o que os testes não alcançam

O R8 e a ofuscação do Dart **só rodam no build de release**. `flutter run` e
`flutter test` não exercitam nenhum dos dois: "compilou" não quer dizer "abre".

```bash
cd app
flutter build apk --release --obfuscate --split-debug-info=symbols/
adb install -r build/app/outputs/flutter-apk/app-release.apk
```

Percorra, no aparelho, uma vez:

- [ ] Abrir o app — tela branca ou crash na abertura é R8/ofuscação até prova
      em contrário
- [ ] Cadastro novo e login por e-mail
- [ ] Login com Google (ver a armadilha da assinatura, abaixo)
- [ ] Carteirinha: o QR do sócio aparece e o número embaixo bate
- [ ] Cardápio, prêmios: fotos carregam
- [ ] Resgatar um prêmio: o **código** de 12 caracteres aparece inteiro na tela
- [ ] Dar baixa nesse código no painel (`validateRedemption`) e ver o app
      refletir o resgate
- [ ] Receber um push do painel
- [ ] Cancelar assinatura
- [ ] Editar dados do perfil e trocar a foto

Duas armadilhas fazem este teste mentir:

**O APK do CI é assinado com chave de debug, e isso derruba o login com
Google.** Sem `key.properties`, o `build.gradle.kts:54` cai na config de
`debug`, e o keystore de debug nasce novo em cada runner: o SHA-1 não está
registrado no projeto Firebase, e o Google valida pacote + fingerprint contra o
cliente OAuth Android. Sintoma: o seletor de conta abre e o login morre depois.
Tem a cara exata de classe comida pelo R8 — **não é**. Use login por e-mail pra
percorrer o resto. Só o APK assinado com a chave de upload testa o Google de
verdade.

**Não existe QR de resgate.** Ninguém no sistema lê código de resgate: a baixa é
o dono digitando o código no painel. O único QR do app é o da carteirinha, que
identifica o sócio, e o do Pix da gorjeta, lido pelo banco do cliente.

O teste tem que rodar **antes** de impor o App Check (seção 3, passo 5): depois
disso, APK instalado fora da Play não consegue token do Play Integrity e o
Firestore/Auth/Storage recusam — some a possibilidade de testar release fora da
loja.

Sumiu algo só no release? O culpado é uma classe removida pelo R8. A correção é
uma regra `-keep` em `app/android/app/proguard-rules.pro` — **não** desligar o
`isMinifyEnabled`.

### 2.3 Guardar (uma vez por versão publicada)

- [ ] `app/symbols/` — desofusca as pilhas Dart no Crashlytics
- [ ] `build/app/outputs/mapping/release/mapping.txt` — idem, lado Java

Os dois estão no `.gitignore` de propósito: quem os tem consegue **ler** o
binário ofuscado. O lugar deles é o cofre onde já está o keystore. Perdidos, os
crashes daquela versão ficam ilegíveis para sempre.

### 2.4 Uma vez, antes do primeiro release público

- [ ] Restringir a chave de API do Firebase no Google Cloud Console ao
      fingerprint SHA-256 do certificado de assinatura + bundle id, e habilitar
      só as APIs em uso (Firestore, Auth, Storage, App Check, FCM)
- [ ] Ligar o App Check (seção 3)
- [ ] Conferir que `REQUER_APP_CHECK=true` só entrou **depois** do passo acima

---

## 3. Ligar o App Check — a ordem importa

O App Check é o controle mais valioso da lista: é o que separa "uma chamada do
app" de "uma chamada de um script com a chave de API copiada do APK". A chave
de API do Firebase é pública por construção — ela acompanha o binário e o
bundle do painel. O App Check é o que a torna inútil fora do app.

O código já está nos três clientes. Falta o passo que não é código: criar a
chave. **Fora de ordem, esta sequência derruba o app em produção.**

1. Criar a chave: Google Cloud Console → Segurança → **reCAPTCHA Enterprise**
   → criar chave do tipo **Site**, listando os quatro domínios de hosting
   (`seu-projeto.web.app`, `seu-projeto.firebaseapp.com`, `seu-projeto-app.web.app`,
   `seu-projeto-app.firebaseapp.com`) mais qualquer domínio próprio. Depois:
   Firebase Console → App Check → registrar o app **Web** com reCAPTCHA
   Enterprise, colando o **ID da chave**.

   > Enterprise, e não v3: o Google descontinuou o reCAPTCHA clássico e o
   > console de administração recusa criar chave nova. Na prática ficou mais
   > simples — Enterprise emite uma chave só, pública, sem par secreto. Os dois
   > clientes usam `ReCaptchaEnterpriseProvider`.
2. Publicar os dois clientes web com a chave:
   - painel: `VITE_RECAPTCHA_SITE_KEY=...` no `.env`
   - app web: `flutter build web --dart-define=RECAPTCHA_SITE_KEY=...`
3. **Esperar e conferir.** Console → App Check → Métricas. Só siga quando as
   três plataformas aparecerem enviando token verificado. Esta métrica é a
   prova de que os passos 4 e 5 são seguros.
4. `REQUER_APP_CHECK=true` nas functions e deploy.
5. Só então **impor** no console — o que fecha também o acesso direto ao
   Firestore e ao Storage pelos SDKs.

> O ID da chave do reCAPTCHA **não é segredo**: ele vai no HTML de qualquer
> página que use reCAPTCHA, e o Google o valida contra o domínio de origem.
> Copiá-lo para outro domínio não serve para nada.

---

## 4. Chaves: onde mora cada uma

| Chave | Onde vive | Rotação |
|---|---|---|
| Credencial e segredo de webhook do gateway (Mercado Pago) | Secret Manager, **quando integrado** — ver `PAGAMENTOS.md` | 90 dias, ou na hora se vazar |
| `PDV_WEBHOOK_SECRET` | Secret Manager | 90 dias |
| Chave de API do Firebase | pública, no binário | restringir, não esconder |
| ID da chave do reCAPTCHA Enterprise | público, no build | — |
| Keystore de upload Android | cofre, fora do git | **nunca** (perder = fim das atualizações) |
| Tokens de sessão do sócio | Keychain/Keystore, pelo SDK do Firebase | 1 h, o SDK renova |

```bash
# Definir ou trocar um segredo (lê da entrada padrão, não fica no histórico):
firebase functions:secrets:set PDV_WEBHOOK_SECRET
firebase deploy --only functions       # o deploy passa a usar a versão nova

# Conferir o valor atual:
firebase functions:secrets:access PDV_WEBHOOK_SECRET

# Revogar a versão antiga, depois que o deploy novo estiver no ar:
firebase functions:secrets:destroy PDV_WEBHOOK_SECRET@1
```

**Os tokens do sócio nunca passam pelo nosso código.** Quem os guarda é o SDK
do Firebase Auth, no Keychain (iOS) e no armazenamento interno respaldado pelo
Keystore (Android). O app não lê, não copia e não grava token em lugar nenhum —
por isso não há `flutter_secure_storage` aqui. O único uso de
`SharedPreferences` é preferência de interface e a fila de chamadas pendentes,
e o backup do Android está desligado para que nem isso saia do aparelho.

---

## 5. Plano de resposta a incidente

Ordem geral: **cortar o acesso → medir o estrago → reemitir → contar o que
houve.** Reemitir antes de cortar é o erro clássico: a chave velha continua
valendo enquanto você troca a nova.

### 5.1 Vazou a credencial do gateway de pagamento

> O gateway é o **Mercado Pago**, ainda não integrado (ver `PAGAMENTOS.md`).
> Os passos abaixo valem para qualquer gateway; complete com o caminho exato no
> painel do Mercado Pago quando a integração existir.

É a pior. Ela move dinheiro.

1. **Agora:** no painel do gateway, renove (revogue) a credencial vazada. Isso
   a invalida imediatamente; o app cai para "não foi possível iniciar o
   pagamento", e é o comportamento certo.
2. `firebase functions:secrets:set <NOME>` com a nova, e
   `firebase deploy --only functions`.
3. Nos logs e eventos do gateway: procure requisições fora da nossa faixa de
   horário, fora da região, ou estornos e saques que ninguém fez.
4. Confira `payments` e `subscriptions` no Firestore contra o gateway.
   Divergiu? O gateway é a verdade; corrija pelo Admin SDK, nunca pelo cliente.
5. Se houve movimentação de terceiros, avise o contador e o suporte do gateway
   (abre disputa e ajuda no estorno).

### 5.2 Vazou um segredo de webhook (gateway ou PDV)

Quem tem o segredo consegue **inventar pagamento ou consumo** — vira ponto e
desconto de graça, e relatório financeiro errado.

1. Gere um segredo novo (`openssl rand -hex 32`), ponha no Secret Manager e faça
   deploy. O emissor antigo passa a levar 401 na hora.
2. Combine o novo com o gateway / a empresa do PDV **por canal separado**
   (telefone, não e-mail com o valor no corpo).
3. Varra o período suspeito: `payments` com `metodo: "pix"` ou origem `pdv` sem
   contrapartida no extrato do gateway ou no fechamento do salão.
4. Estorne pontos creditados indevidamente por Cloud Function, com registro.

### 5.3 Vazou o keystore de upload do Android

1. Play Console → Configuração → Integridade do app → solicitar **redefinição da
   chave de upload** (o Google reemite; a chave de assinatura do app é dele
   desde o Play App Signing, então os usuários não são afetados).
2. Gere um keystore novo, guarde no cofre, atualize `android/key.properties`.
3. Se o keystore estava num diretório versionado, reescreva o histórico
   (`git filter-repo`) e force o push — mas só depois de rotacionar.

### 5.4 Conta de admin comprometida

O papel de admin lê todos os sócios e escreve promoções, prêmios e planos.

1. Firebase Console → Authentication → desabilitar a conta. Isso não expira os
   tokens já emitidos: rode também a revogação de refresh tokens
   (`admin.auth().revokeRefreshTokens(uid)`) — o ID token morre em até 1 h.
2. Remova a custom claim `role: admin` (`functions/src/admin.ts` faz o caminho
   inverso; use o Admin SDK direto para tirar).
3. Audite `notificationLogs`, `promotions`, `rewards` e `plans` no período.
4. Reative com senha nova e MFA.

### 5.5 Suspeita de acesso indevido a dados de sócio

1. Cloud Audit Logs + métricas do Firestore: pico de leitura fora do padrão.
2. Se a via foi a chave de API sem App Check, **imponha o App Check agora**
   (seção 3) — é o corte mais rápido.
3. LGPD: dado pessoal de titular brasileiro exposto exige comunicação à ANPD e
   aos titulares em **3 dias úteis** a partir do conhecimento do incidente
   (Res. CD/ANPD nº 15/2024). Quem comunica é o **controlador** (Tio Panda); o
   operador avisa o dono em até **24 horas**, com escopo e medidas tomadas.
   Registre data, escopo e o que foi feito, e guarde o registro do incidente
   por **5 anos**.

### 5.6 Sempre, depois de qualquer um dos casos

- [ ] Escreva o que houve, quando, e o que cortou o acesso
- [ ] Um teste, uma regra ou um alerta que teria pego isso mais cedo
- [ ] Se o vazamento foi por commit: confirme que o gitleaks do CI pegaria hoje

---

## 6. O que foi decidido **não** fazer, e por quê

Registrar isto vale tanto quanto o resto: sem o registro, alguém reabre a
discussão daqui a seis meses sem os motivos.

**Certificate pinning.** Não se aplica aqui. As chamadas saem dos SDKs nativos
do Firebase, que fazem a própria rede — o Dart não vê o socket e não tem onde
pinar. Mesmo que desse, o Google rotaciona os certificados de `googleapis.com`
sem avisar clientes, e um pin vencido derruba **todo o parque instalado** sem
caminho de conserto remoto: o app não abre nem para receber a correção. O ganho
seria contra MITM com CA no dispositivo, cenário que exige o aparelho já
comprometido. TLS já é obrigatório (`usesCleartextTraffic="false"`).

**Assinatura HMAC das requisições do app (`X-Signature`).** Contradiz a regra
"nenhum segredo em texto puro no binário": assinar no cliente exige uma chave
compartilhada dentro do APK, e qualquer um a extrai em minutos — a assinatura
passa a provar apenas que o atacante leu o binário. É exatamente o problema que
o **App Check** resolve certo, com atestação do Play Integrity / App Attest,
que não pode ser copiada porque a prova vem do sistema operacional, não do app.
Nos webhooks, onde o segredo mora nos **dois servidores**, o HMAC existe e está
correto (`webhooks/pdv.ts`, `webhooks/pix.ts`).

**Camada própria de AES-256-GCM no armazenamento local.** Não há o que
criptografar. O app não guarda token (o SDK do Firebase Auth cuida disso, no
Keychain/Keystore), não tem SQLite nem Hive, e o único uso de
`SharedPreferences` é preferência de interface e a fila de chamadas pendentes.
Contra extração por backup — o vetor real — a defesa é `allowBackup=false`, que
já está aplicada; contra aparelho com root, uma chave no Keystore cai junto.
Somar cifra própria traria uma chave para gerenciar, mais código para errar, e
tornaria falsa a declaração `ITSAppUsesNonExemptEncryption=false` do
`Info.plist` — o que significa papelada de exportação a cada envio à App Store.

**Detecção de root / jailbreak / debugger.** Bypassável por quem é o alvo (quem
tem root desliga a checagem), e caro para quem não é: falso positivo tranca um
sócio pagante para fora, e a nossa superfície é uma assinatura de R$ 4,90. Se
um dia entrar, que seja com uma biblioteca mantida (`freerasp`) e em modo de
**telemetria**, não de bloqueio.

**Verificação de SHA-256 do binário em runtime.** Mesma família: o código que
compara o hash roda dentro do binário que o atacante controla, e a primeira
coisa que ele faz é remover a comparação. O Play Integrity já responde a essa
pergunta a partir de fora, que é o único lugar de onde a resposta vale.

---

## 7. Onde procurar quando algo não fecha

| Sintoma | Provável causa |
|---|---|
| `permission-denied` ao salvar perfil | Campo novo na tela sem entrada em `camposDoCliente()`, ou fora do tipo/tamanho de `bemFormado()`. `firebase/test/rules.test.js` aponta qual. |
| `resource-exhausted` | Teto de `lib/rateLimit.ts`. Legítimo? Suba o número lá, com comentário. |
| `failed-precondition: Chamada sem verificação de app` | `REQUER_APP_CHECK=true` com algum cliente sem chave. Refaça a seção 3. |
| Webhook levando 401 | Segredo divergente entre o Secret Manager e quem chama. |
| Tela some só no APK de release | R8 removeu uma classe. `-keep` em `proguard-rules.pro`. |
| Crash ilegível no Crashlytics | Faltou subir `symbols/` e `mapping.txt` daquela versão. |

## 8. Auditoria de 02/10/2026 (lançamento iOS)

Item por item da lista pedida, com o que foi visto no código e o que mudou.

| Item | Situação |
|---|---|
| `.env` exposto | OK. `.env*`, keystores, `GoogleService-Info.plist` e `google-services.json` no `.gitignore`; nenhum arquivo de segredo rastreado. Os 4 segredos do backend estão no Secret Manager. A chave de site do reCAPTCHA e a config do Firebase no app são públicas por construção. |
| Validação no front-end | OK. Formulários com `validator`; botões travam durante o envio (cadastro, login, sacola, resgate, cancelar). **Mudou:** senha nova exige 8+ caracteres, com letras e números. |
| Validação no back-end | **Corrigido.** Ids vindos do cliente agora passam por `idValido` (`lib/guards.ts`). Antes, um id com `/` montava caminho de outro documento ou estourava em erro 500. Pedido: preço, taxa e total já eram calculados no servidor. |
| SQL injection | Não se aplica: não há SQL. O equivalente no Firestore (caminho montado pelo cliente) foi fechado com `idValido`. |
| Autenticação fraca | Firebase Auth (senha com hash scrypt, nunca no nosso banco). Proteção contra enumeração de e-mail ligada. **Pendente no console:** política de senha (Auth > Configurações > Política de senha) com 8 caracteres para valer também no servidor. |
| IDOR | OK. Rules checam dono em `users`, `pedidos`, `subscriptions`, `redemptions`, `payments`. `cancelarPedido` responde "não encontrado" para pedido de outra pessoa. **Corrigido:** o dono podia reescrever título/texto das próprias notificações; agora só `lida`. |
| Senha direto no banco | OK. Nenhuma senha é gravada no Firestore. |
| Força bruta | Firebase Auth bloqueia tentativas repetidas no login. Indicação e demais chamadas têm limite por conta (`lib/rateLimit.ts`). Código de resgate tem 48 bits e só o admin valida. |
| Bloquear durante o envio | OK (ver front-end). No servidor, pedido e resgate são idempotentes (`create()` com id fixo). |
| CSRF | Não se aplica: nada usa cookie de sessão. Callables usam token no cabeçalho; webhooks usam assinatura HMAC (Mercado Pago, PDV) ou token Bearer (Starway). |
| Upload sem validação | OK. Storage aceita só imagem até 5 MB, cada sócio só na própria pasta, e pastas do cardápio/promoções só admin. |
| Não revelar informação | **Corrigido:** o app mostrava "INTERNAL" cru; agora mostra mensagem em português. Login responde "e-mail ou senha incorretos" sem dizer qual. |
| Dependências vulneráveis | **Corrigido nas Functions** (`npm audit fix`: grpc-js e brace-expansion). Resta 1 moderada (`uuid` via `gaxios`, caminho que não usamos). No painel, os 4 alertas são do `@grpc/grpc-js`, que só roda em Node e não entra no bundle do navegador. |
| Tokens | Tokens do Firebase expiram em 1 h e renovam sozinhos. Token FCM só o dono grava, com tamanho limitado. **Pendente:** App Check está em modo "não impor" (ver seção 3); iOS precisa do App Attest registrado no console antes de impor. |
| Rate limit | OK. Toda callable passa por `consumir()`; `cancelarPedido` entrou na lista. |
| Conteúdo sensível exposto | OK. `config/*` é a única leitura pública (sem dado pessoal). Chave Pix dos funcionários é visível a sócios logados por desenho (chave aleatória). |
| SSRF | OK. O servidor só faz `fetch` para `api.mercadopago.com`, com caminho fixo e id codificado. |
| Cookies inseguros | Não se aplica: sem cookies próprios. Hosting com HSTS, CSP, `X-Frame-Options: DENY` e `nosniff`. |
| CORS | Callables exigem token do Firebase, então CORS aberto não dá acesso. Webhooks são servidor a servidor, com assinatura. |

Também nesta rodada: `aplicarStatus` virou transacional, para o "aceito" da cozinha não apagar um cancelamento do cliente feito no mesmo instante.
