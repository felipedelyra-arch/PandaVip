/**
 * Recuperação de admin que perdeu o celular: remove o segundo fator (TOTP)
 * da conta e derruba as sessões. No próximo login o painel pede para ativar
 * a verificação em duas etapas de novo.
 *
 *   1. Service account key em firebase/serviceAccountKey.json (no .gitignore).
 *   2. node scripts/remover-2fa.js <email-do-admin>
 */
const { initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const serviceAccount = require("../serviceAccountKey.json");

const email = process.argv[2];
if (!email) {
  console.error("Uso: node scripts/remover-2fa.js <email>");
  process.exit(1);
}

initializeApp({ credential: cert(serviceAccount) });
const auth = getAuth();

auth
  .getUserByEmail(email)
  .then(async ({ uid }) => {
    await auth.updateUser(uid, { multiFactor: { enrolledFactors: null } });
    await auth.revokeRefreshTokens(uid);
    console.log(`✅ 2FA removido de ${email}. No próximo login ele ativa de novo.`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("Erro:", err);
    process.exit(1);
  });
