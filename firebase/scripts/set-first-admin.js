/**
 * Cria o PRIMEIRO admin (bootstrap). Rode uma vez local.
 *
 *   1. Baixe a service account key do Firebase Console
 *      (Configurações > Contas de serviço > Gerar nova chave).
 *   2. Salve como firebase/serviceAccountKey.json (já no .gitignore).
 *   3. node scripts/set-first-admin.js <uid-do-usuario>
 *
 * Depois disso, use o painel admin (função setAdminRole) para os demais.
 */
// API modular: o firebase-admin 14 removeu `admin.credential`, `admin.auth()`
// e `admin.firestore()`. Estes imports valem desde a 10.
const { initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");
const serviceAccount = require("../serviceAccountKey.json");

const uid = process.argv[2];
if (!uid) {
  console.error("Uso: node scripts/set-first-admin.js <uid>");
  process.exit(1);
}

initializeApp({ credential: cert(serviceAccount) });

getAuth()
  .setCustomUserClaims(uid, { role: "admin" })
  .then(() =>
    getFirestore().doc(`users/${uid}`).set({ role: "admin" }, { merge: true })
  )
  .then(() => {
    console.log(`✅ ${uid} agora é admin. Peça pra ele deslogar/logar de novo.`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("Erro:", err);
    process.exit(1);
  });
