/**
 * Cenário 4 — abrir o app (custo por sócio, por abertura).
 *
 * O app mantém listeners permanentes declarados em
 * app/lib/core/services/services.dart. Nenhum deles tem `limit`. Os dois que
 * crescem para sempre são:
 *   - notificationsProvider (services.dart:173) — 1 documento por aviso enviado,
 *     por pessoa, sem teto;
 *   - redemptionsProvider (services.dart:193) — 1 por prêmio resgatado.
 *
 * Este medidor enche o histórico de um sócio e mede o que ele passa a pagar em
 * leitura toda vez que abre o app.
 *
 * Uso: node loadtest/medir-app.js [avisos_no_historico]
 */
const { db, exigirEmulador, cronometrar, ms } = require("./lib");

const AVISOS = Number(process.argv[2] || 300);
const UID = "u0000000";

/** Espelha `kLimiteAvisos` de app/lib/core/services/services.dart. */
const LIMITE_AVISOS = 50;

// Leituras fixas por abertura, das coleções compartilhadas (services.dart).
const COMPARTILHADAS = ["promotions", "rewards", "menu", "plans", "funcionarios"];

async function encherHistorico(n) {
  const col = db.collection("users").doc(UID).collection("notifications");
  const atual = (await col.count().get()).data().count;
  if (atual >= n) return atual;
  for (let i = atual; i < n; i += 450) {
    const lote = db.batch();
    for (let j = i; j < Math.min(i + 450, n); j++) {
      lote.set(col.doc(), {
        titulo: `Aviso ${j}`,
        corpo: "Histórico de medição",
        tipo: "promo",
        lida: true,
        criadoEm: new Date(Date.now() - j * 3600000),
      });
    }
    await lote.commit();
  }
  return n;
}

async function main() {
  exigirEmulador();
  console.log(`\n=== Abrir o app — sócio com ${AVISOS} avisos no histórico ===\n`);

  await encherHistorico(AVISOS);

  let leituras = 0;
  const detalhe = [];

  const [, t] = await cronometrar(async () => {
    // currentUserProvider (services.dart:22)
    await db.doc(`users/${UID}`).get();
    leituras += 1;
    detalhe.push(["users/{uid}", 1]);

    // subscriptionProvider (services.dart:154) — tem limit(1)
    const sub = await db
      .collection("subscriptions")
      .where("userId", "==", UID)
      .where("status", "==", "active")
      .limit(1)
      .get();
    leituras += sub.size;
    detalhe.push(["subscriptions (limit 1)", sub.size]);

    for (const col of COMPARTILHADAS) {
      const snap = await db.collection(col).get();
      leituras += snap.size;
      detalhe.push([col, snap.size]);
    }

    // notificationsProvider (services.dart) — agora com limit(kLimiteAvisos)
    const notif = await db
      .collection("users")
      .doc(UID)
      .collection("notifications")
      .orderBy("criadoEm", "desc")
      .limit(LIMITE_AVISOS)
      .get();
    leituras += notif.size;
    detalhe.push([`notifications (limit ${LIMITE_AVISOS})`, notif.size]);

    // redemptionsProvider (services.dart:193) — SEM limit
    const resg = await db
      .collection("redemptions")
      .where("userId", "==", UID)
      .get();
    leituras += resg.size;
    detalhe.push(["redemptions (SEM limit)", resg.size]);
  });

  console.log("Leituras por abertura:");
  for (const [nome, n] of detalhe) {
    console.log(`  ${nome.padEnd(26)} ${String(n).padStart(6)}`);
  }
  console.log(`  ${"TOTAL".padEnd(26)} ${String(leituras).padStart(6)}  (${ms(t)})`);

  const USD_POR_LEITURA = 0.06 / 100000;
  console.log("\nProjeção de custo mensal só de abertura de app:");
  console.log("  (2 aberturas por dia por sócio, 30 dias)");
  for (const socios of [1000, 10000, 50000]) {
    const lidas = leituras * 2 * 30 * socios;
    const usd = lidas * USD_POR_LEITURA;
    console.log(
      `  ${String(socios).padStart(6)} sócios: ${(lidas / 1e6).toFixed(1)}M leituras/mês` +
        `  ~US$ ${usd.toFixed(2)}  (~R$ ${(usd * 5.4).toFixed(2)})`
    );
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
