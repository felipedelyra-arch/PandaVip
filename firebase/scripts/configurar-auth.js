/**
 * Liga no projeto a política de senha forte e o 2FA por app autenticador (TOTP).
 *
 * Nenhum dos dois tem botão no console do Firebase — só pela API do Identity
 * Platform. Rodar UMA vez no Google Cloud Shell (já vem autenticado):
 *
 *   npm i firebase-admin && node configurar-auth.js
 *
 * Senha: vale para senhas novas (cadastro e troca). Quem já tem senha fraca
 * continua entrando (forceUpgradeOnSignin: false) — forçar troca no login
 * travaria sócios que nem sabem que a regra mudou.
 */
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

initializeApp({ projectId: "seu-projeto" });

getAuth()
  .projectConfigManager()
  .updateProjectConfig({
    passwordPolicyConfig: {
      enforcementState: "ENFORCE",
      forceUpgradeOnSignin: false,
      constraints: {
        minLength: 8,
        requireUppercase: true,
        requireLowercase: true,
        requireNumeric: true,
        requireNonAlphanumeric: true,
      },
    },
    multiFactorConfig: {
      // Opcional por sócio: ENABLED libera o cadastro do fator, não obriga.
      state: "ENABLED",
      providerConfigs: [{ state: "ENABLED", totpProviderConfig: { adjacentIntervals: 5 } }],
    },
  })
  .then((cfg) => console.log("OK", JSON.stringify(cfg.toJSON(), null, 2)))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
