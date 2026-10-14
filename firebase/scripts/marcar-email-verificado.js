/**
 * Marca o e-mail de uma conta como verificado, à força.
 *
 * O app passou a exigir confirmação de e-mail pra quem entra com e-mail e
 * senha (o router segura em /verificar-email). Isso vale também pras contas
 * criadas ANTES da regra existir — e as contas de teste usam endereços em
 * `@pandavip.app`, que não têm caixa de entrada de verdade: sem este script
 * elas ficam presas na tela de verificação pra sempre.
 *
 * O console do Firebase não expõe esse campo; só o Admin SDK muda.
 *
 *   1. Baixe a service account key do Firebase Console
 *      (Configurações > Contas de serviço > Gerar nova chave).
 *   2. Salve como firebase/serviceAccountKey.json (já no .gitignore).
 *   3. node scripts/marcar-email-verificado.js cliente.teste@pandavip.app
 *
 * Aceita e-mail ou uid. Vários de uma vez também:
 *
 *   node scripts/marcar-email-verificado.js a@x.com b@x.com
 *
 * ⚠️ Use só em conta de teste ou em conta cujo dono você confirmou por fora.
 * Marcar verificado sem verificar é exatamente o que a regra existe pra
 * impedir — o script é a exceção, não o atalho padrão.
 */
// API modular: o firebase-admin 14 removeu `admin.credential` e `admin.auth()`.
// Estes imports valem desde a 10.
const { initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const serviceAccount = require("../serviceAccountKey.json");

const alvos = process.argv.slice(2);
if (alvos.length === 0) {
  console.error(
    "Uso: node scripts/marcar-email-verificado.js <email-ou-uid> [mais...]"
  );
  process.exit(1);
}

initializeApp({ credential: cert(serviceAccount) });

const ehEmail = (v) => v.includes("@");

async function marcar(alvo) {
  const auth = getAuth();
  const user = ehEmail(alvo)
    ? await auth.getUserByEmail(alvo)
    : await auth.getUser(alvo);

  if (user.emailVerified) {
    console.log(`•  ${user.email ?? user.uid} já estava verificado.`);
    return;
  }

  await auth.updateUser(user.uid, { emailVerified: true });
  console.log(`✅ ${user.email ?? user.uid} marcado como verificado.`);
}

(async () => {
  let falhou = false;
  for (const alvo of alvos) {
    try {
      await marcar(alvo);
    } catch (err) {
      falhou = true;
      console.error(`❌ ${alvo}: ${err.message}`);
    }
  }
  // A sessão aberta no aparelho continua com o token antigo: o app só enxerga
  // a mudança depois de `reload()`. A tela de verificação faz isso sozinha a
  // cada 5s, então basta deixá-la aberta — ou sair e entrar de novo.
  console.log("\nAbra o app: a tela de verificação libera em até 5 segundos.");
  process.exit(falhou ? 1 : 0);
})();
