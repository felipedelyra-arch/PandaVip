/**
 * Verificação do garçom (role `atendente`): dá baixa em resgate e recebe o
 * que entregar; sócio comum não consegue; o mesmo código não vale duas vezes;
 * quem perde o papel cai na hora (sessão revogada).
 *
 * Precisa do emulador de Auth além do Firestore: `requireEquipe` confere a
 * revogação do token de verdade.
 *
 * Uso: npm --prefix firebase/functions run build &&
 *      firebase emulators:exec --only firestore,auth --project seu-projeto "node ../loadtest/verificar-garcom.js"
 */
const path = require("path");
const { db, exigirEmulador } = require("./lib");

const lib = path.join(__dirname, "..", "firebase", "functions", "lib");
const { validateRedemption } = require(path.join(lib, "redemptions.js"));
const { setAdminRole } = require(path.join(lib, "admin.js"));
const { auth } = require(path.join(lib, "lib", "admin.js"));
const SENHA_TESTE = process.env.SENHA_TESTE || "troque-no-emulador";

let falhas = 0;
function checar(nome, condicao, detalhe = "") {
  const ok = Boolean(condicao);
  if (!ok) falhas++;
  console.log(`  ${ok ? "OK    " : "FALHOU"} ${nome}${detalhe ? `  (${detalhe})` : ""}`);
}

const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";

async function idToken(email) {
  const r = await fetch(
    `http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=x`,
    { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: SENHA_TESTE, returnSecureToken: true }) }
  );
  return (await r.json()).idToken;
}

async function conta(uid, role) {
  const email = `${uid}@teste.dev`;
  await auth.createUser({ uid, email, password: SENHA_TESTE, emailVerified: true }).catch(() => {});
  await auth.setCustomUserClaims(uid, role ? { role } : null);
  return { uid, role, token: await idToken(email) };
}

const chamar = (c, codigo) =>
  validateRedemption.run({
    auth: { uid: c.uid, token: { role: c.role, email_verified: true, firebase: { sign_in_provider: "password" } } },
    rawRequest: { headers: { authorization: `Bearer ${c.token}` } },
    data: { codigo },
  });

const erro = (p) => p.then(() => null, (e) => e.message);

async function main() {
  exigirEmulador();
  const garcom = await conta("g_garcom", "atendente");
  const comum = await conta("g_comum", null);

  await db.doc("users/g_socio").set({ nome: "Maria Souza" });
  await db.doc("subscriptions/g_socio").set({
    userId: "g_socio", planId: "mensal", status: "active", formaPagamento: "cartao",
    proximaCobranca: new Date(Date.now() + 20 * 86400000),
  });
  await db.doc("rewards/g_premio").set({ titulo: "Temaki grátis" });
  const resgate = (id, codigo) => db.doc(`redemptions/${id}`).set({
    userId: "g_socio", rewardId: "g_premio", rewardTitulo: "Temaki grátis", codigo, status: "disponivel",
  });
  await resgate("r1", "AAAA1111BBBB");
  await resgate("r2", "CCCC2222DDDD");

  console.log("garçom");
  checar("sócio comum é recusado", /equipe/.test(await erro(chamar(comum, "AAAA1111BBBB")) ?? ""));
  const ok = await chamar(garcom, "aaaa1111bbbb");
  checar("garçom valida e recebe o prêmio", ok.premio === "Temaki grátis" && ok.socio === "Maria", JSON.stringify(ok));
  const r1 = (await db.doc("redemptions/r1").get()).data();
  checar("resgate fica usado com quem validou", r1.status === "usado" && r1.validadoPor === "g_garcom");
  checar("mesmo código não vale de novo", /já usado/.test(await erro(chamar(garcom, "AAAA1111BBBB")) ?? ""));

  await db.doc("redemptions/rg").set({
    userId: "g_garcom", rewardId: "g_premio", rewardTitulo: "Temaki grátis", codigo: "GGGG0000GGGG", status: "disponivel",
  });
  checar("garçom não valida o próprio prêmio", /outro atendente/.test(await erro(chamar(garcom, "GGGG0000GGGG")) ?? ""));

  // Dois garçons ao mesmo tempo: só um leva.
  const outro = await conta("g_garcom2", "atendente");
  const duplos = await Promise.allSettled([chamar(garcom, "CCCC2222DDDD"), chamar(outro, "CCCC2222DDDD")]);
  checar("duas baixas simultâneas: só uma passa", duplos.filter((d) => d.status === "fulfilled").length === 1);

  // Admin tira o papel: a sessão do garçom cai na hora. A revogação tem
  // resolução de segundo, então o token precisa ser de um segundo anterior.
  const admin = await conta("g_admin", "admin");
  await new Promise((r) => setTimeout(r, 1100));
  const rebaixa = await setAdminRole.run({
    auth: { uid: "g_admin", token: { role: "admin", firebase: { sign_in_second_factor: "totp" } } },
    rawRequest: { headers: { authorization: `Bearer ${admin.token}` } },
    data: { targetUid: "g_garcom2", makeAdmin: false, atendente: false },
  });
  const naoRebaixa = await erro(setAdminRole.run({
    auth: { uid: "g_admin", token: { role: "admin", firebase: { sign_in_second_factor: "totp" } } },
    rawRequest: { headers: { authorization: `Bearer ${admin.token}` } },
    data: { targetUid: "g_admin", atendente: true },
  }));
  checar("liberar garçom não rebaixa admin", /admin antes/.test(naoRebaixa ?? ""), naoRebaixa);
  checar("admin tira o papel de garçom", rebaixa.role === null);
  checar("espelho do papel limpo", (await db.doc("users/g_garcom2").get()).get("role") === null);
  await resgate("r3", "EEEE3333FFFF");
  const msg = await erro(chamar(outro, "EEEE3333FFFF"));
  checar("garçom rebaixado é recusado", /encerrada/.test(msg ?? ""), msg);

  console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
