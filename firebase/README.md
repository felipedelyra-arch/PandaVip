# PandaVip — Backend Firebase

Backend único compartilhado pelo app (Flutter) e pelo painel (React).

## Serviços

- **Auth** — email/senha (e provedores extras se quiser).
- **Firestore** — coleções `users`, `subscriptions`, `plans`, `promotions`, `rewards`, `redemptions`, `payments`, e os índices reversos `socioCodes`/`referralCodes` (código → uid, fechados pro cliente).
- **Cloud Functions** (TS, região `southamerica-east1`).
- **Storage** — imagens de promoções/premiações/perfil.
- **Cloud Messaging** — push.

## Setup

```bash
# 1. Instalar CLI e logar
npm i -g firebase-tools
firebase login

# 2. Criar/selecionar projeto
firebase projects:create pandavip   # ou use um existente
firebase use --add

# 3. Dependências das functions
npm --prefix functions install

# 4. Env das functions
cp functions/.env.example functions/.env   # só pro emulador; segredo de produção vai no Secret Manager

# 5. Deploy
firebase deploy --only firestore:rules,firestore:indexes,storage,functions
```

## Primeiro admin (bootstrap)

Custom claim `role:admin` só é concedida por outro admin. O primeiro é manual:

```bash
# baixe a service account key -> firebase/serviceAccountKey.json
node scripts/set-first-admin.js <UID_DO_USUARIO>
```

Depois, novos admins pela função `setAdminRole` (painel > Configurações).

## Cloud Functions

| Função | Tipo | O quê |
|---|---|---|
| `setAdminRole` | callable (admin) | concede/revoga `role:admin` |
| `onAuthUserCreate` | trigger auth | cria doc `users/{uid}` com pontos=0 |
| `createCheckoutSession` | callable | inicia assinatura (retorna URL). Sem gateway integrado ainda: responde erro claro |
| `cancelSubscription` | callable | cancela no gateway, depois marca `canceled`. Idem |
| `redeemReward` | callable | resgata premiação (transação: assinatura + cupom) |
| `validateRedemption` | callable (admin) | marca resgate como usado |
| `sendPush` | callable (admin) | push p/ todos ou só assinantes |
| `onPromotionCreated` | trigger firestore | push automático em nova promoção ativa |
| `pdvConsumo` | HTTPS | consumo do salão vindo do PDV, HMAC em `x-pdv-signature` |

### Pagamento

Gateway: **Mercado Pago**, integrado (assinatura por `preapproval`, webhook
`mercadoPagoWebhook`). O contrato, os segredos e o que ainda falta testar estão
em `PAGAMENTOS.md` (documento interno, fora desta versão).

> ⚠️ Segredo de gateway **não** vai no `.env`: vai no Secret Manager
> (`src/lib/segredos.ts`).

## Emuladores (dev local)

```bash
npm --prefix functions run build
firebase emulators:start
```

## Hosting do Painel Admin

O `firebase.json` já tem a seção `hosting` configurada: serve `admin/dist`,
faz build automático no deploy (`predeploy`) e trata SPA (rewrite `** -> /index.html`).

**Pré-requisito (o sócio faz quando tiver o projeto):**

1. Preencher `admin/.env` com as chaves do app Web do Firebase.
2. Segredos das functions no Secret Manager (`src/lib/segredos.ts`), não no `.env`.
3. Logar e selecionar o projeto:

```bash
firebase login
firebase use --add          # escolhe o projeto real

# deploy do painel (roda npm install + build do admin sozinho)
firebase deploy --only hosting

# ou tudo de uma vez
firebase deploy --only hosting,functions,firestore:rules,firestore:indexes,storage
```

O painel fica em `https://<projeto>.web.app`. Sem as chaves e o `firebase use`,
o deploy não roda — é só isso que falta.

## Segurança

### O que já está no código

- Escrita de `subscriptions`, `payments`, `redemptions` bloqueada nas rules — só backend.
- `role` nunca é auto-atribuída pelo cliente (rules + claim).
- Segredos (PDV e Mercado Pago) só no Secret Manager, nunca no
  `.env`, no app ou no painel.
- `users` aceita só a lista branca de campos do cliente (`camposDoCliente()` nas
  rules). Campo que decide dinheiro ou identidade — `gatewayCustomerId`,
  `codigoSocio`, `role` — só entra por Cloud Function.
- O webhook do PDV confere a assinatura do corpo cru antes de olhar o conteúdo,
  com comparação em tempo constante. O do gateway tem que fazer igual
  (`PAGAMENTOS.md`).
- Toda `onCall` passa por `requireAuth`/`requireAdmin` (`functions/src/lib/guards.ts`).
- Limite de chamadas por sócio e por ação (`functions/src/lib/rateLimit.ts`).
  Os tetos estão em `LIMITES`, no topo do arquivo — é lá que se mexe.
- Storage aceita só imagem de até 5 MB, e foto de perfil só do próprio dono.
- Cabeçalhos de segurança (CSP, HSTS, `X-Frame-Options`, `Referrer-Policy`,
  `Permissions-Policy`) servidos pelo Hosting nos dois sites — ver `firebase.json`.
  Por causa do CSP, **nada de `<script>` inline ou `onclick=` no
  `app/web/index.html`**: o navegador ignora em silêncio.
- Varredura semanal de dependência e de segredo vazado
  (`.github/workflows/dependencias.yml`) + Dependabot.

### O que depende de console e ainda não está feito

Estas quatro não têm como morar no código. Sem elas, metade do que está acima
fica valendo só pela metade.

1. **Restringir as chaves de API** (Google Cloud > APIs e serviços >
   Credenciais). A chave Web do painel deve ser restrita por referenciador HTTP
   (`seu-projeto.web.app`, `seu-projeto-app.web.app`); a Android por nome de pacote +
   SHA-1; a iOS por bundle id. Elas são públicas por natureza — acompanham o APK
   e o JavaScript —, e a restrição é o que impede que sejam usadas fora dali.
2. **Impor o App Check** (Firebase > App Check). Já está instalado no app
   Android/iOS e o token é enviado; falta a chave de site do reCAPTCHA para a
   web e ligar a imposição. Depois disso, `REQUER_APP_CHECK=true` no `.env` das
   functions fecha também as `onCall`. Ver `functions/src/lib/guards.ts`.
3. **Política de senha** (Firebase > Authentication > Settings). O mínimo hoje é
   o padrão de 6 caracteres. Subir para 8 com exigência de número basta.
4. **TTL de `rateLimits`**, para os contadores sumirem sem custo de escrita:

   ```
   gcloud firestore fields ttls update expiraEm \
     --collection-group=rateLimits --enable-ttl --project=seu-projeto
   ```

   Enquanto não estiver ligado, quem limpa é `limparRateLimits`
   (`functions/src/manutencao.ts`), uma vez por dia.

### Depois de cada deploy do Hosting

Conferir que os cabeçalhos saíram, porque o emulador de Hosting não aplica o
bloco `headers` e o erro só apareceria em produção:

```
curl -sI https://seu-projeto.web.app/ | grep -i -E "content-security|strict-transport"
```

E abrir `https://seu-projeto-app.web.app` uma vez com o console do navegador
aberto: violação de CSP aparece lá, e no app web ela deixaria a tela presa no
splash laranja.
