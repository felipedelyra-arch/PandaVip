/**
 * Cenário 1 — disparo de aviso (o caminho mais caro do backend).
 *
 * Reproduz fielmente `coletarAlvos` + `gravarNaCentral` de
 * firebase/functions/src/push.ts (linhas 22-70), medindo cada etapa separada.
 * Não chama o FCM: o que trava não é o envio, é a varredura de `users` e a
 * gravação de um documento de aviso por pessoa.
 *
 * Uso: node loadtest/medir-push.js [publico]
 *      publico = "todos" (padrão) ou "assinantes"
 */
const { db, exigirEmulador, cronometrar, ms } = require("./lib");

const PUBLICO = process.argv[2] || "todos";

const pedacos = (xs, n) => {
  const out = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

async function emParalelo(ps, simultaneos, fn) {
  const out = [];
  for (const grupo of pedacos(ps, simultaneos)) {
    out.push(...(await Promise.all(grupo.map(fn))));
  }
  return out;
}

/** Como era antes do commit desta Onda 1: `in` de 30 em 30, em fila. */
async function coletarAlvosAntigo(onlySubscribers) {
  const alvos = new Map();
  let leituras = 0;
  let idas = 0;

  const somar = (uid, token) => {
    if (!uid) return;
    alvos.set(uid, { uid, token: typeof token === "string" ? token : undefined });
  };

  if (onlySubscribers) {
    const subs = await db
      .collection("subscriptions")
      .where("status", "==", "active")
      .get();
    leituras += subs.size;
    idas += 1;

    const uids = [...new Set(subs.docs.map((d) => d.get("userId")))].filter(Boolean);
    for (let i = 0; i < uids.length; i += 30) {
      const lote = uids.slice(i, i + 30);
      if (lote.length === 0) continue;
      const users = await db.collection("users").where("uid", "in", lote).get();
      leituras += users.size;
      idas += 1;
      users.forEach((u) => somar(u.get("uid") ?? u.id, u.get("fcmToken")));
    }
  } else {
    const users = await db.collection("users").get();
    leituras += users.size;
    idas += 1;
    users.forEach((u) => somar(u.get("uid") ?? u.id, u.get("fcmToken")));
  }

  return { alvos: [...alvos.values()], leituras, idasAoBanco: idas };
}

/** Espelha push.ts depois da Onda 1: getAll por id, em pedaços paralelos. */
async function coletarAlvos(onlySubscribers) {
  const alvos = new Map();
  let leituras = 0;
  let idas = 0;

  const somar = (uid, token) => {
    if (!uid) return;
    alvos.set(uid, { uid, token: typeof token === "string" ? token : undefined });
  };

  if (onlySubscribers) {
    const subs = await db
      .collection("subscriptions")
      .where("status", "==", "active")
      .get();
    leituras += subs.size;
    idas += 1;

    const uids = [...new Set(subs.docs.map((d) => d.get("userId")))].filter(Boolean);
    const lotes = pedacos(uids, 300);
    const snaps = await emParalelo(lotes, 4, (lote) =>
      db.getAll(...lote.map((uid) => db.doc(`users/${uid}`)), {
        fieldMask: ["fcmToken"],
      })
    );
    idas += lotes.length;
    snaps.flat().forEach((u) => {
      if (u.exists) {
        leituras += 1;
        somar(u.id, u.get("fcmToken"));
      }
    });
  } else {
    const users = await db.collection("users").select("fcmToken").get();
    leituras += users.size;
    idas += 1;
    users.forEach((u) => somar(u.id, u.get("fcmToken")));
  }

  return { alvos: [...alvos.values()], leituras, idasAoBanco: idas };
}

/** Como era antes: um commit de cada vez. */
async function gravarNaCentralAntigo(alvos) {
  let commits = 0;
  for (const lote of pedacos(alvos, 450)) {
    const batch = db.batch();
    lote.forEach((a) => escrever(batch, a));
    await batch.commit();
    commits += 1;
  }
  return { commits, escritas: alvos.length };
}

/** Depois: os commits vão em pedaços paralelos. */
async function gravarNaCentral(alvos) {
  const lotes = pedacos(alvos, 450);
  await emParalelo(lotes, 4, async (lote) => {
    const batch = db.batch();
    lote.forEach((a) => escrever(batch, a));
    await batch.commit();
  });
  return { commits: lotes.length, escritas: alvos.length };
}

function escrever(batch, a) {
  const ref = db.collection("users").doc(a.uid).collection("notifications").doc();
  batch.set(ref, {
    titulo: "Medição",
    corpo: "Medição de carga",
    tipo: "info",
    lida: false,
    criadoEm: new Date(),
  });
}

async function rodar(nome, coletar, gravar, onlySubs) {
  const [coleta, tColeta] = await cronometrar(() => coletar(onlySubs));
  const [grav, tGrav] = await cronometrar(() => gravar(coleta.alvos));
  const total = tColeta + tGrav;
  console.log(`--- ${nome} ---`);
  console.log(`  alvos             : ${coleta.alvos.length}`);
  console.log(`  leituras Firestore: ${coleta.leituras}`);
  console.log(`  idas ao banco     : ${coleta.idasAoBanco} (coleta)`);
  console.log(`  commits de lote   : ${grav.commits} (gravação)`);
  console.log(`  tempo coleta      : ${ms(tColeta)}`);
  console.log(`  tempo gravação    : ${ms(tGrav)}`);
  console.log(
    `  TOTAL             : ${ms(total)}  ` +
      `(${((total / 60000) * 100).toFixed(1)}% do timeout de 60s)\n`
  );
  return { total, leituras: coleta.leituras, idas: coleta.idasAoBanco };
}

async function main() {
  exigirEmulador();
  const onlySubs = PUBLICO === "assinantes";
  console.log(`\n=== Disparo de aviso — público: ${PUBLICO} ===\n`);

  const antes = await rodar("ANTES (main anterior)", coletarAlvosAntigo, gravarNaCentralAntigo, onlySubs);
  const depois = await rodar("DEPOIS (Onda 1)", coletarAlvos, gravarNaCentral, onlySubs);

  const fator = (a, d) => (d === 0 ? "—" : `${(a / d).toFixed(1)}x`);
  console.log("=== antes -> depois ===");
  console.log(`  tempo         : ${ms(antes.total)} -> ${ms(depois.total)}  (${fator(antes.total, depois.total)} melhor)`);
  console.log(`  leituras      : ${antes.leituras} -> ${depois.leituras}  (${fator(antes.leituras, depois.leituras)} melhor)`);
  console.log(`  idas ao banco : ${antes.idas} -> ${depois.idas}  (${fator(antes.idas, depois.idas)} melhor)`);

  const heap = process.memoryUsage().heapUsed / 1024 / 1024;
  console.log(`\nHeap: ${heap.toFixed(0)}MB  |  memória padrão da Function: 256MB`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
