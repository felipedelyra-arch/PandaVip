/**
 * Verificação da faxina da central de avisos (functions/src/push.ts).
 *
 * O risco não é performance, é apagar o que não devia: a consulta é de GRUPO de
 * coleção, então ela alcança a subcoleção `notifications` de todos os sócios de
 * uma vez. Errar o corte apagaria aviso recente de gente que não tem nada a ver.
 *
 * Uso: node loadtest/verificar-faxina.js
 */
const { db, exigirEmulador } = require("./lib");

const DIAS = 180;
const SOCIOS = ["fx_a", "fx_b", "fx_c"];

let falhas = 0;
function checar(nome, condicao, detalhe = "") {
  const ok = Boolean(condicao);
  if (!ok) falhas++;
  console.log(`  ${ok ? "OK    " : "FALHOU"} ${nome}${detalhe ? `  (${detalhe})` : ""}`);
}

const diasAtras = (n) => new Date(Date.now() - n * 86400000);

/** Cópia da faxina, sem a camada de agendamento. */
async function faxinar() {
  const corte = diasAtras(DIAS);
  let apagados = 0;
  for (let volta = 0; volta < 40; volta++) {
    const velhos = await db
      .collectionGroup("notifications")
      .where("criadoEm", "<", corte)
      .limit(450)
      .get();
    if (velhos.empty) break;
    const lote = db.batch();
    velhos.docs.forEach((d) => lote.delete(d.ref));
    await lote.commit();
    apagados += velhos.size;
    if (velhos.size < 450) break;
  }
  return apagados;
}

async function contar(uid) {
  return (await db.collection(`users/${uid}/notifications`).count().get()).data().count;
}

async function main() {
  exigirEmulador();
  console.log("\n=== Faxina da central de avisos ===\n");

  for (const uid of SOCIOS) {
    await db.recursiveDelete(db.doc(`users/${uid}`));
    await db.doc(`users/${uid}`).set({ uid });

    const col = db.collection(`users/${uid}/notifications`);
    const b = db.batch();
    // 5 antigos (1 ano), 3 na borda de dentro (179 dias), 4 recentes.
    for (let i = 0; i < 5; i++) {
      b.set(col.doc(), { titulo: `velho ${i}`, criadoEm: diasAtras(365) });
    }
    for (let i = 0; i < 3; i++) {
      b.set(col.doc(), { titulo: `borda ${i}`, criadoEm: diasAtras(DIAS - 1) });
    }
    for (let i = 0; i < 4; i++) {
      b.set(col.doc(), { titulo: `novo ${i}`, criadoEm: diasAtras(2) });
    }
    await b.commit();
  }

  checar("semeado: 12 avisos por sócio", (await contar("fx_a")) === 12);

  const apagados = await faxinar();

  checar("apagou 5 por sócio, 15 no total", apagados === 15, `${apagados}`);
  for (const uid of SOCIOS) {
    checar(`${uid}: sobraram 7 (3 na borda + 4 recentes)`, (await contar(uid)) === 7);
  }

  // A consulta de grupo alcança todos os sócios: nenhum pode ter passado batido.
  const restantes = await db.collectionGroup("notifications").get();
  const velhoSobrando = restantes.docs.filter(
    (d) => d.get("criadoEm").toDate() < diasAtras(DIAS)
  );
  checar("nenhum aviso velho sobrou em nenhum sócio", velhoSobrando.length === 0);

  const segunda = await faxinar();
  checar("rodar de novo não apaga mais nada", segunda === 0, `${segunda}`);

  for (const uid of SOCIOS) await db.recursiveDelete(db.doc(`users/${uid}`));

  console.log(`\n${falhas === 0 ? "PASSOU — todos os casos" : `FALHOU em ${falhas} caso(s)`}`);
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
