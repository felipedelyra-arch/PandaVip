/**
 * Cenário 2 — corrida pelo mesmo prêmio (o fluxo principal do produto).
 *
 * É o que acontece quando o dono cadastra um rodízio grátis: `onRewardCreated`
 * dispara push para todos os assinantes, todo mundo abre o app no mesmo minuto
 * e toca "resgatar" no mesmo prêmio.
 *
 * Roda os DOIS desenhos sobre os mesmos dados:
 *
 *   ANTES  — transação que lia e escrevia `rewards/{id}`. Todas as pessoas
 *            disputando a MESMA linha do banco.
 *   DEPOIS — o estoque virou um documento por unidade
 *            (`rewards/{id}/cupons/{i}`), e resgatar é reservar um deles. Pessoas
 *            diferentes tocam documentos diferentes.
 *
 * Uso: node loadtest/medir-resgate.js [concorrentes] [estoque]
 */
const path = require("path");
const { db, exigirEmulador, cronometrar, percentis, ms } = require("./lib");

const { sincronizarPool, reservarCupom } = require(
  path.join(__dirname, "..", "firebase", "functions", "lib", "lib", "cupons")
);

const CONCORRENTES = Number(process.argv[2] || 50);
const ESTOQUE = Number(process.argv[3] || 1000);

const uid = (i) => `u${String(i).padStart(7, "0")}`;

// ---------------------------------------------------------------------------
// ANTES — transação no documento do prêmio
// ---------------------------------------------------------------------------

async function resgatarAntigo(rewardId, u) {
  const rewardRef = db.doc(`rewards/${rewardId}`);
  return db.runTransaction(async (tx) => {
    const jaResgatou = db
      .collection("redemptions")
      .where("userId", "==", u)
      .where("rewardId", "==", rewardId)
      .limit(1);

    const [rewardSnap, jaSnap] = await Promise.all([
      tx.get(rewardRef),
      tx.get(jaResgatou),
    ]);
    if (!rewardSnap.exists) throw new Error("not-found");
    if (!jaSnap.empty) throw new Error("already-exists");

    const estoque = rewardSnap.data().estoque ?? 0;
    if (estoque <= 0) throw new Error("sem-estoque");

    tx.update(rewardRef, { estoque: estoque - 1 });
    const ref = db.collection("redemptions").doc();
    tx.set(ref, {
      userId: u,
      rewardId,
      codigo: Math.random().toString(36).slice(2, 14).toUpperCase(),
      status: "disponivel",
      criadoEm: new Date(),
    });
    return ref.id;
  });
}

// ---------------------------------------------------------------------------
// DEPOIS — reserva de cupom + id de resgate determinístico
// ---------------------------------------------------------------------------

async function resgatarNovo(rewardId, u) {
  const ref = db.doc(`redemptions/${rewardId}__${u}`);

  const existente = await ref.get();
  if (existente.exists) return { repetido: true, id: ref.id };

  const cupomId = await reservarCupom(rewardId, u, ref.id);
  if (!cupomId) throw new Error("sem-estoque");

  await ref.create({
    userId: u,
    rewardId,
    cupomId,
    codigo: Math.random().toString(36).slice(2, 14).toUpperCase(),
    status: "disponivel",
    criadoEm: new Date(),
  });
  return { id: ref.id };
}

// ---------------------------------------------------------------------------

async function rodar(nome, rewardId, resgatar) {
  const latencias = [];
  const erros = {};

  const [, tTotal] = await cronometrar(async () => {
    await Promise.all(
      Array.from({ length: CONCORRENTES }, async (_, i) => {
        try {
          const [, t] = await cronometrar(() => resgatar(rewardId, uid(i)));
          latencias.push(t);
        } catch (e) {
          const chave = (e.message || String(e.code)).slice(0, 50);
          erros[chave] = (erros[chave] ?? 0) + 1;
        }
      })
    );
  });

  const ok = latencias.length;
  const falhas = CONCORRENTES - ok;
  const p = percentis(latencias.length ? latencias : [0]);

  console.log(`--- ${nome} ---`);
  console.log(`  sucesso       : ${ok}/${CONCORRENTES}`);
  console.log(
    `  falhas        : ${falhas} (${((falhas / CONCORRENTES) * 100).toFixed(1)}%)`
  );
  if (falhas) console.log(`    motivos     : ${JSON.stringify(erros)}`);
  console.log(`  tempo total   : ${ms(tTotal)}`);
  console.log(`  vazão         : ${((ok / tTotal) * 1000).toFixed(1)} resgates/s`);
  console.log(
    `  latência      : p50 ${ms(p.p50)} | p95 ${ms(p.p95)} | máx ${ms(p.max)}\n`
  );

  return { ok, falhas, tTotal };
}

async function limpar(rewardId) {
  for (const col of ["redemptions"]) {
    const snap = await db.collection(col).get();
    for (let i = 0; i < snap.size; i += 450) {
      const b = db.batch();
      snap.docs.slice(i, i + 450).forEach((d) => b.delete(d.ref));
      await b.commit();
    }
  }
  await db.recursiveDelete(db.doc(`rewards/${rewardId}`));
}

async function main() {
  exigirEmulador();
  console.log(
    `\n=== Corrida pelo mesmo prêmio — ${CONCORRENTES} pessoas, estoque ${ESTOQUE} ===\n`
  );

  // ANTES
  const antigoId = "premio_antigo";
  await limpar(antigoId);
  await db.doc(`rewards/${antigoId}`).set({ titulo: "Rodízio", valor: 45, estoque: ESTOQUE });
  const antes = await rodar("ANTES (transação no documento do prêmio)", antigoId, resgatarAntigo);
  const restanteAntes = (await db.doc(`rewards/${antigoId}`).get()).get("estoque");

  // DEPOIS
  const novoId = "premio_novo";
  await limpar(novoId);
  await db.doc(`rewards/${novoId}`).set({ titulo: "Rodízio", valor: 45, estoqueAlvo: ESTOQUE });
  process.stdout.write(`  (gerando ${ESTOQUE} cupons…)\n`);
  await sincronizarPool(novoId, ESTOQUE);
  const depois = await rodar("DEPOIS (reserva de cupom)", novoId, resgatarNovo);

  const livres = await db
    .collection(`rewards/${novoId}/cupons`)
    .where("status", "==", "livre")
    .count()
    .get();
  const usados = ESTOQUE - livres.data().count;

  console.log("=== antes -> depois ===");
  console.log(
    `  sucesso : ${antes.ok}/${CONCORRENTES} -> ${depois.ok}/${CONCORRENTES}`
  );
  console.log(`  tempo   : ${ms(antes.tTotal)} -> ${ms(depois.tTotal)}`);

  console.log("\n=== integridade do estoque ===");
  console.log(
    `  antes : baixou ${ESTOQUE - restanteAntes}, gravou ${antes.ok} resgates -> ` +
      `${ESTOQUE - restanteAntes === antes.ok ? "bate" : "DIVERGENTE"}`
  );
  console.log(
    `  depois: usou ${usados} cupons, gravou ${depois.ok} resgates -> ` +
      `${usados === depois.ok ? "bate" : "DIVERGENTE"}`
  );

  const ok = usados === depois.ok && depois.falhas === 0;
  console.log(`\n${ok ? "PASSOU" : "ATENÇÃO — ver acima"}`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
