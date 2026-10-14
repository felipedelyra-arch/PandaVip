/**
 * Corretude do resgate por cupons. Desempenho é `medir-resgate.js`; aqui o que
 * se testa é o que não pode dar errado nunca — e cada caso é uma coisa que o
 * sócio ou o dono perde dinheiro se falhar.
 *
 * Uso: node loadtest/verificar-resgate.js
 */
const path = require("path");
const { db, exigirEmulador } = require("./lib");

const { sincronizarPool, reservarCupom, liberarCupom, contarLivres } = require(
  path.join(__dirname, "..", "firebase", "functions", "lib", "lib", "cupons")
);

let falhas = 0;
function checar(nome, condicao, detalhe = "") {
  const ok = Boolean(condicao);
  if (!ok) falhas++;
  console.log(`  ${ok ? "OK    " : "FALHOU"} ${nome}${detalhe ? `  (${detalhe})` : ""}`);
}

const uid = (i) => `u${String(i).padStart(7, "0")}`;

/** Espelha o miolo de `redeemReward`, sem a camada de autenticação. */
async function resgatar(rewardId, u) {
  const ref = db.doc(`redemptions/${rewardId}__${u}`);
  const existente = await ref.get();
  if (existente.exists) {
    return { repetido: true, codigo: existente.get("codigo") };
  }

  const cupomId = await reservarCupom(rewardId, u, ref.id);
  if (!cupomId) return { semEstoque: true };

  const codigo = Math.random().toString(36).slice(2, 14).toUpperCase();
  try {
    await ref.create({ userId: u, rewardId, cupomId, codigo, status: "disponivel" });
  } catch (err) {
    if (err.code === 6) {
      await liberarCupom(rewardId, cupomId);
      const vencedor = await ref.get();
      return { repetido: true, codigo: vencedor.get("codigo") };
    }
    await liberarCupom(rewardId, cupomId).catch(() => undefined);
    throw err;
  }
  return { codigo, cupomId };
}

async function limpar(rewardId) {
  const snap = await db.collection("redemptions").get();
  for (let i = 0; i < snap.size; i += 450) {
    const b = db.batch();
    snap.docs.slice(i, i + 450).forEach((d) => b.delete(d.ref));
    await b.commit();
  }
  await db.recursiveDelete(db.doc(`rewards/${rewardId}`));
}

async function main() {
  exigirEmulador();
  console.log("\n=== Corretude do resgate por cupons ===\n");

  // -------------------------------------------------------------------------
  console.log("1. Repetir a chamada devolve o MESMO resgate");
  console.log("   (é a rede caindo depois de gravar: antes o sócio via");
  console.log('    "Você já resgatou este prêmio" como erro, sem o QR)');
  {
    const id = "t_idempotencia";
    await limpar(id);
    await sincronizarPool(id, 10);

    const a = await resgatar(id, uid(1));
    const b = await resgatar(id, uid(1));
    const c = await resgatar(id, uid(1));

    checar("segunda chamada não é erro", b.repetido === true);
    checar("mesmo código nas três", a.codigo === b.codigo && b.codigo === c.codigo, a.codigo);
    checar("consumiu 1 cupom, não 3", (await contarLivres(id)) === 9);
  }

  // -------------------------------------------------------------------------
  console.log("\n2. Três toques simultâneos da mesma pessoa");
  {
    const id = "t_corrida_mesma_pessoa";
    await limpar(id);
    await sincronizarPool(id, 10);

    const rs = await Promise.all([
      resgatar(id, uid(2)),
      resgatar(id, uid(2)),
      resgatar(id, uid(2)),
    ]);
    const codigos = new Set(rs.map((r) => r.codigo));

    checar("um único código para os três toques", codigos.size === 1);
    checar(
      "cupons devolvidos ao pool: sobra 9",
      (await contarLivres(id)) === 9,
      `livres=${await contarLivres(id)}`
    );
  }

  // -------------------------------------------------------------------------
  console.log("\n3. Mais gente que estoque: ninguém resgata a mais");
  {
    const id = "t_sem_estoque";
    await limpar(id);
    await sincronizarPool(id, 20);

    const rs = await Promise.all(
      Array.from({ length: 60 }, (_, i) => resgatar(id, uid(100 + i)))
    );
    const comCodigo = rs.filter((r) => r.codigo && !r.repetido).length;
    const semEstoque = rs.filter((r) => r.semEstoque).length;
    const resgatesGravados = (await db.collection("redemptions").count().get()).data().count;

    checar("exatamente 20 resgataram", comCodigo === 20, `${comCodigo}`);
    checar("os outros 40 receberam 'sem estoque'", semEstoque === 40, `${semEstoque}`);
    checar("nenhum resgate a mais no banco", resgatesGravados === 20, `${resgatesGravados}`);
    checar("pool zerado", (await contarLivres(id)) === 0);
  }

  // -------------------------------------------------------------------------
  console.log("\n4. Dono baixa o estoque: não tira o prêmio de quem já resgatou");
  {
    const id = "t_baixar_estoque";
    await limpar(id);
    await sincronizarPool(id, 30);

    for (let i = 0; i < 10; i++) await resgatar(id, uid(200 + i));
    checar("10 resgataram, sobram 20 livres", (await contarLivres(id)) === 20);

    // Dono decide que só quer mais 5 disponíveis.
    await sincronizarPool(id, 5);

    const usados = await db
      .collection(`rewards/${id}/cupons`)
      .where("status", "==", "usado")
      .count()
      .get();

    checar("sobram 5 livres", (await contarLivres(id)) === 5);
    checar("os 10 usados continuam intactos", usados.data().count === 10, `${usados.data().count}`);
  }

  // -------------------------------------------------------------------------
  console.log("\n5. Sincronizar duas vezes com o mesmo alvo não muda nada");
  console.log("   (gatilho do Firestore entrega pelo menos uma vez)");
  {
    const id = "t_idempotencia_pool";
    await limpar(id);
    await sincronizarPool(id, 25);
    const primeiro = await contarLivres(id);
    await sincronizarPool(id, 25);
    await sincronizarPool(id, 25);
    checar("continua 25", (await contarLivres(id)) === 25, `antes=${primeiro}`);
  }

  console.log(`\n${falhas === 0 ? "PASSOU — todos os casos" : `FALHOU em ${falhas} caso(s)`}`);
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
