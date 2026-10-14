/**
 * Verificação do backfill paginado (functions/src/users.ts).
 *
 * O risco da mudança não é desempenho, é o cursor: avançar demais **pula**
 * sócios, que ficam sem código de carteirinha para sempre e sem ninguém saber.
 * Este script cria sócios sem código, roda a paginação de verdade e confere que
 * TODOS terminaram com código, sem laço infinito.
 *
 * Uso: node loadtest/verificar-backfill.js [quantos]
 */
const path = require("path");
const { db, FieldPath, exigirEmulador, cronometrar, ms } = require("./lib");

const { garantirCodigoSocio } = require(
  path.join(__dirname, "..", "firebase", "functions", "lib", "lib", "codigoSocio")
);

const QUANTOS = Number(process.argv[2] || 600);
const PREFIXO = "bf";

// Mesmos valores de functions/src/users.ts.
const VARREDURA = 2000;
const GERADOS = 250;
const PARALELO = 10;

/** Cópia fiel do corpo da function, sem a camada de autenticação. */
async function umPedaco(cursor) {
  let q = db
    .collection("users")
    .orderBy(FieldPath.documentId())
    .select("codigoSocio")
    .limit(VARREDURA);
  if (cursor) q = q.startAfter(cursor);

  const snap = await q.get();
  const pendentes = snap.docs.filter((d) => !d.get("codigoSocio"));
  const lote = pendentes.slice(0, GERADOS);

  let gerados = 0;
  const falhas = [];
  for (let i = 0; i < lote.length; i += PARALELO) {
    await Promise.all(
      lote.slice(i, i + PARALELO).map(async (doc) => {
        try {
          await garantirCodigoSocio(doc.id);
          gerados++;
        } catch (err) {
          falhas.push(doc.id);
        }
      })
    );
  }

  const ultimo =
    lote.length < pendentes.length
      ? lote[lote.length - 1]?.id
      : snap.docs[snap.docs.length - 1]?.id;
  const continua = snap.size === VARREDURA || lote.length < pendentes.length;

  return { varridos: snap.size, gerados, falhas, continua, cursor: continua ? ultimo : null };
}

async function main() {
  exigirEmulador();
  console.log(`\n=== Backfill paginado — ${QUANTOS} sócios sem código ===\n`);

  // Limpa restos de execução anterior.
  const antigos = await db.collection("users").orderBy(FieldPath.documentId())
    .startAt(`${PREFIXO}_`).endAt(`${PREFIXO}_`).get();
  for (let i = 0; i < antigos.size; i += 450) {
    const b = db.batch();
    antigos.docs.slice(i, i + 450).forEach((d) => b.delete(d.ref));
    await b.commit();
  }

  for (let i = 0; i < QUANTOS; i += 450) {
    const b = db.batch();
    for (let j = i; j < Math.min(i + 450, QUANTOS); j++) {
      // Sem `codigoSocio` — o campo fica AUSENTE, como nos perfis antigos.
      b.set(db.doc(`users/${PREFIXO}_${String(j).padStart(6, "0")}`), {
        uid: `${PREFIXO}_${String(j).padStart(6, "0")}`,
        nome: `Antigo ${j}`,
      });
    }
    await b.commit();
  }
  console.log(`Semeados ${QUANTOS} perfis sem codigoSocio.`);

  let cursor = null;
  let voltas = 0;
  let total = 0;
  const [, t] = await cronometrar(async () => {
    for (voltas = 0; voltas < 200; voltas++) {
      const r = await umPedaco(cursor);
      total += r.gerados;
      console.log(
        `  volta ${String(voltas + 1).padStart(2)}: varreu ${String(r.varridos).padStart(5)}` +
          `, gerou ${String(r.gerados).padStart(4)}, falhas ${r.falhas.length}` +
          `, continua=${r.continua}`
      );
      if (!r.continua) break;
      cursor = r.cursor;
    }
  });

  // Conferência: ninguém pode ter ficado para trás.
  const restantes = await db.collection("users").select("codigoSocio").get();
  const semCodigo = restantes.docs.filter((d) => !d.get("codigoSocio"));
  const codigos = new Set(
    restantes.docs.map((d) => d.get("codigoSocio")).filter(Boolean)
  );

  console.log(`\nvoltas          : ${voltas + 1}`);
  console.log(`códigos gerados : ${total}`);
  console.log(`tempo           : ${ms(t)}`);
  console.log(`perfis sem código depois: ${semCodigo.length}`);
  console.log(
    `códigos únicos  : ${codigos.size} de ${restantes.size} perfis ` +
      `-> ${codigos.size === restantes.size ? "OK, sem colisão" : "COLISÃO"}`
  );

  const ok = semCodigo.length === 0 && codigos.size === restantes.size;
  console.log(`\n${ok ? "PASSOU" : "FALHOU"}`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
